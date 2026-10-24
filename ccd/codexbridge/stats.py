"""codexbridge.stats — the bridge's one non-secret output: counts, sizes, names and request ids, per lane.

Codex-bridge spec 2026-10-15 §2.7 ("It records every request's real prompt size and every context refusal, per route
and model, in a non-secret stats file"), §2.9 D3 (names only, never content), D24 (the count ratio) and D25 (a refusal
lowers the window through the hourly refresh); plan 2026-10-22, Task 5 and D-6418 (D3's names go to this file, not to
the credential's status file, which is written only under the credential's lock).

THE FILE, VERSION 1 (`bridge.stats.json` in the lane directory; the name is `lane.json`'s `bridgeFiles.stats`):
  {"version": 1, "lane", "since", "startedAt", "updatedAt",
   "routes": {"<route>/<model>": {"requests", "bytesPerToken", "promptTokensMax", "promptTokensLast"}},
   "refusals": {"<route>/<model>": {"tokens", "window", "at", "estimated": true}},
   "outcomes": {"<key>": n}, "names": {"<family>": {"<name>": n}}, "unexplained": {"<family>": ["<name>", ...]},
   "usageHeaders": {"at", "values": {...}} or null, "lastUpstreamRequestId": <id> or null}
`since` is the file's first start, carried across restarts; `startedAt` is this process's. `promptTokensMax` is the
largest upstream `input_tokens` of a reply the model accepted (the caller reports only those); a refusal's `tokens`
is D24's estimate, so it says `estimated: true`. Times are ISO-8601 UTC with milliseconds.

NOTHING HERE HOLDS CONTENT. A name is bounded by NAME_RE (else `unrecognised`), at most NAMES_MAX per family (then
`overflow`); a header's value is never kept, except an `x-codex-` header's, bounded to VALUE_MAX printable
characters, for the usage poller; a request id is kept only under errors.REQUEST_ID_RE.

A RESTART LOSES NOTHING THE READERS NEED: construction loads a valid version-1 file of the same lane and carries its
refusals (the hourly refresh may not have read them yet, Task 15), each route's ratio, request count and largest
prompt (D24's calibration), the names, the unexplained list, the outcomes and `since` (the 7-day watch's counters).
Any other file (unreadable, another version, another lane) starts fresh and counts `stats:reset`. At load, and at
every `name()`, a name `known.explained` now covers leaves `unexplained`; when the load changed what it carried, the
constructor flushes at once, so the file the doctor reads changes at the restart (Task 17's WARN clears on an idle
lane too).

One writer per lane (the lane's one bridge process); every method takes one lock, so handler threads share one Stats.
A flush is tmp + fchmod 0600 + fsync + rename, at most every FLUSH_S unless forced; a failed one is counted in memory
(`stats:flush-failed`) and retried at the next flush call, whatever FLUSH_S says, so nothing is lost. No method raises
into a request.

Every constant is read when it is used, so the test driver's `consts` reach it.
"""

import datetime
import json
import math
import os
import re
import threading
import time
from typing import Dict, Mapping, Optional

from . import count, errors, known

VERSION = 1
FAMILIES = tuple(known.KNOWN)  # the ten D3 families, in the plan's order; spelled once, in known.KNOWN
NAME_RE = re.compile(r"^[A-Za-z0-9_.:/-]{1,64}$")
UNRECOGNISED = errors.UNRECOGNISED_CODE  # "unrecognised"
OVERFLOW = "overflow"
NAMES_MAX = 256  # names per family (and routes, refusals and outcome keys) before OVERFLOW
VALUE_MAX = 64  # an x-codex- header value's length
HEADERS_MAX = 64  # x-codex- headers kept from one response
FLUSH_S = 10.0  # an unforced flush writes at most this often
READ_MAX = 16 * 2**20  # a stats file larger than this is unreadable, so the start resets it
FLUSH_FAILED = "stats:flush-failed"
RESET = "stats:reset"
UNKNOWN_FAMILY = "stats:unknown-family"


def _iso(t: float) -> str:
    stamp = datetime.datetime.fromtimestamp(t, tz=datetime.timezone.utc)
    return stamp.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (stamp.microsecond // 1000)


def _bounded(value: object) -> str:
    """A name as the file may hold it: itself when it matches NAME_RE, else UNRECOGNISED."""
    if isinstance(value, str) and NAME_RE.fullmatch(value):
        return value
    return UNRECOGNISED


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _is_ratio(value: object) -> bool:
    return (isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            and count.RATIO_MIN <= value <= count.RATIO_MAX)


def _printable(value: str) -> bool:
    return all(" " <= ch <= "~" for ch in value)


class Stats:
    """The lane's stats file, held in memory and written by `flush`."""

    def __init__(self, path: str, lane: str) -> None:
        self.path = path
        self.lane = lane
        self._lock = threading.RLock()
        self._dirty = False
        self._retry = False
        self._last_flush = None  # type: Optional[float]
        started = _iso(time.time())
        self._doc = {
            "version": VERSION, "lane": lane, "since": started, "startedAt": started, "updatedAt": started,
            "routes": {}, "refusals": {}, "outcomes": {}, "names": {}, "unexplained": {}, "usageHeaders": None,
            "lastUpstreamRequestId": None,
        }  # type: dict
        if self._load():
            self.flush(force=True)

    # ── the load ──
    def _read(self) -> Optional[object]:
        """The file's JSON, or None when it is absent. Raises ValueError when it is unreadable."""
        try:
            fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        except FileNotFoundError:
            return None
        except OSError:
            raise ValueError("unreadable")
        try:
            chunks, size = [], 0
            while True:
                chunk = os.read(fd, 1 << 16)
                if not chunk:
                    break
                size += len(chunk)
                if size > READ_MAX:
                    raise ValueError("too large")
                chunks.append(chunk)
            return json.loads(b"".join(chunks).decode("utf-8"))
        except (OSError, UnicodeDecodeError) as e:
            raise ValueError(type(e).__name__)
        finally:
            os.close(fd)

    def _load(self) -> bool:
        """Carry what a valid file of this lane holds; True when the carried data changed (a reset, or an explained
        name dropped), so the constructor writes the file at once."""
        try:
            old = self._read()
        except ValueError:
            old = False
        if old is None:  # absent: a fresh file, nothing to say yet
            return False
        version = old.get("version") if isinstance(old, dict) else None
        if not (isinstance(old, dict) and _is_int(version) and version == VERSION and old.get("lane") == self.lane):
            self._doc["outcomes"][RESET] = 1
            self._dirty = True
            return True
        doc = self._doc
        if isinstance(old.get("since"), str) and NAME_RE.fullmatch(old["since"]):
            doc["since"] = old["since"]
        for key, row in (old.get("routes") or {}).items() if isinstance(old.get("routes"), dict) else ():
            if isinstance(row, dict) and _bounded(key) == key:
                doc["routes"][key] = {
                    "requests": row["requests"] if _is_int(row.get("requests")) else 0,
                    "bytesPerToken": row["bytesPerToken"] if _is_ratio(row.get("bytesPerToken"))
                    else count.SEED_BYTES_PER_TOKEN,
                    "promptTokensMax": row["promptTokensMax"] if _is_int(row.get("promptTokensMax")) else 0,
                    "promptTokensLast": 0,
                }
        for key, row in (old.get("refusals") or {}).items() if isinstance(old.get("refusals"), dict) else ():
            if (isinstance(row, dict) and _bounded(key) == key and _is_int(row.get("tokens"))
                    and _is_int(row.get("window")) and isinstance(row.get("at"), str)
                    and NAME_RE.fullmatch(row["at"])):
                doc["refusals"][key] = {"tokens": row["tokens"], "window": row["window"], "at": row["at"],
                                        "estimated": True}
        for key, n in (old.get("outcomes") or {}).items() if isinstance(old.get("outcomes"), dict) else ():
            if _bounded(key) == key and _is_int(n):
                doc["outcomes"][key] = n
        names = old.get("names") if isinstance(old.get("names"), dict) else {}
        for family in FAMILIES:
            held = names.get(family)
            if isinstance(held, dict):
                kept = {k: n for k, n in held.items() if _bounded(k) == k and _is_int(n)}
                if kept:
                    doc["names"][family] = kept
        changed = False
        unexplained = old.get("unexplained") if isinstance(old.get("unexplained"), dict) else {}
        for family in FAMILIES:
            held = unexplained.get(family)
            if not isinstance(held, list):
                continue
            kept = sorted({n for n in held if isinstance(n, str) and _bounded(n) == n})
            still = [n for n in kept if not known.explained(family, n)]
            if len(still) != len(kept):
                changed = True
            if still:
                doc["unexplained"][family] = still
        if changed:
            self._dirty = True
        return changed

    # ── the counters ──
    def _slot(self, table: Dict[str, object], key: str) -> str:
        """`key`, or OVERFLOW when `table` already holds NAMES_MAX other keys."""
        if key in table or len(table) - (OVERFLOW in table) < NAMES_MAX:
            return key
        return OVERFLOW

    def _count(self, key: str) -> None:
        outcomes = self._doc["outcomes"]
        key = self._slot(outcomes, _bounded(key))
        outcomes[key] = outcomes.get(key, 0) + 1
        self._dirty = True

    def name(self, family: str, value: str) -> None:
        """Count one name of a D3 family; a name `known.explained` does not cover joins `unexplained`."""
        with self._lock:
            if family not in FAMILIES:
                self._count(UNKNOWN_FAMILY)
                return
            held = self._doc["names"].setdefault(family, {})
            value = self._slot(held, _bounded(value))
            held[value] = held.get(value, 0) + 1
            if not known.explained(family, value):
                listed = self._doc["unexplained"].setdefault(family, [])
                if value not in listed:
                    listed.append(value)
                    listed.sort()
            self._dirty = True

    def header_names(self, headers: Mapping[str, str]) -> None:
        """Count each response header's NAME, lower-cased, under `responseHeader`; never its value."""
        with self._lock:
            for header in list(headers.keys()):
                self.name("responseHeader", header.lower() if isinstance(header, str) else UNRECOGNISED)

    def outcome(self, key: str) -> None:
        with self._lock:
            self._count(key)

    def _route(self, route: str, model: str) -> dict:
        routes = self._doc["routes"]
        key = self._slot(routes, _bounded(route) + "/" + _bounded(model))
        row = routes.get(key)
        if row is None:
            row = routes[key] = {"requests": 0, "bytesPerToken": count.SEED_BYTES_PER_TOKEN, "promptTokensMax": 0,
                                 "promptTokensLast": 0}
        return row

    def request(self, route: str, model: str, countable_bytes: int) -> None:
        """One request sent upstream on this route and model. Its bytes are D24's input; the ratio moves only at
        `usage`, from a reply's real tokens."""
        with self._lock:
            self._route(route, model)["requests"] += 1
            self._dirty = True

    def usage(self, route: str, model: str, countable_bytes: int, input_tokens: int, *, image_count: int,
              continued: bool = False) -> None:
        """A successful reply's real `input_tokens`: the largest and the last prompt, always; the ratio only when the
        request carried no image (each counts a fixed IMAGE_TOKENS, D-6427) and the message was not continued (its
        last response's input counts the earlier responses' output against the first request's bytes)."""
        if not _is_int(input_tokens):
            return
        with self._lock:
            row = self._route(route, model)
            row["promptTokensMax"] = max(row["promptTokensMax"], input_tokens)
            row["promptTokensLast"] = input_tokens
            if image_count == 0 and not continued:
                row["bytesPerToken"] = count.updated_ratio(row["bytesPerToken"], countable_bytes, input_tokens)
            self._dirty = True

    def refusal(self, route: str, model: str, tokens: int, window: int, *, now: Optional[float] = None) -> None:
        """The latest context refusal per route and model (spec §2.7): D24's estimate and the lane's window then."""
        if not (_is_int(tokens) and _is_int(window)):
            return
        with self._lock:
            refusals = self._doc["refusals"]
            key = self._slot(refusals, _bounded(route) + "/" + _bounded(model))
            refusals[key] = {"tokens": tokens, "window": window, "at": _iso(time.time() if now is None else now),
                             "estimated": True}
            self._dirty = True

    def usage_headers(self, headers: Mapping[str, str], *, now: Optional[float] = None) -> None:
        """Keep the `x-codex-` headers of one response, by prefix: a printable value, cut to VALUE_MAX characters.
        Every other header's value is never kept. A response with none leaves the last snapshot standing."""
        prefix = known.CODEX_HEADER_PREFIX
        values = {}  # type: Dict[str, str]
        for header, value in list(headers.items()):
            name = header.lower() if isinstance(header, str) else ""
            if not name.startswith(prefix) or not NAME_RE.fullmatch(name) or not isinstance(value, str):
                continue
            value = value.strip()
            if not _printable(value):
                continue
            values[name] = value[:VALUE_MAX]
            if len(values) >= HEADERS_MAX:
                break
        if not values:
            return
        with self._lock:
            self._doc["usageHeaders"] = {"at": _iso(time.time() if now is None else now), "values": values}
            self._dirty = True

    def request_id(self, rid: Optional[str]) -> None:
        """The last upstream request id, kept only when it matches errors.REQUEST_ID_RE."""
        if isinstance(rid, str) and errors.REQUEST_ID_RE.fullmatch(rid):
            with self._lock:
                self._doc["lastUpstreamRequestId"] = rid
                self._dirty = True

    def ratio(self, route: str, model: str) -> float:
        """D24's bytes per token for this route and model: the calibrated ratio, else the seed."""
        with self._lock:
            row = self._doc["routes"].get(_bounded(route) + "/" + _bounded(model))
            return row["bytesPerToken"] if row is not None else count.SEED_BYTES_PER_TOKEN

    def snapshot(self) -> dict:
        """A copy of the document as the next flush writes it (but its `updatedAt`)."""
        with self._lock:
            return json.loads(json.dumps(self._doc))

    # ── the write ──
    def _write(self, data: bytes) -> None:
        tmp = "%s.tmp.%d" % (self.path, os.getpid())
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
            try:
                os.fchmod(fd, 0o600)
                view = memoryview(data)
                while view:
                    view = view[os.write(fd, view):]
                os.fsync(fd)
            finally:
                os.close(fd)
            os.replace(tmp, self.path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def flush(self, *, force: bool = False) -> bool:
        """Write the file when something changed, at most every FLUSH_S (a forced flush, and the first call after a
        failed one, write at once). True when it wrote; a failure is counted and kept for the next call, never
        raised."""
        with self._lock:
            tick = time.monotonic()
            if not force:
                if not self._dirty:
                    return False
                if not self._retry and self._last_flush is not None and tick - self._last_flush < FLUSH_S:
                    return False
            self._doc["updatedAt"] = _iso(time.time())
            data = json.dumps(self._doc, sort_keys=True, separators=(",", ":")).encode("utf-8")
            try:
                self._write(data)
            except Exception:  # a full disk, a removed directory: counted, retried at the next call
                self._count(FLUSH_FAILED)
                self._retry = True
                return False
            self._last_flush = tick
            self._dirty = False
            self._retry = False
            return True

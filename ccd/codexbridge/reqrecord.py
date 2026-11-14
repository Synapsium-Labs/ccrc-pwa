"""codexbridge.reqrecord — the per-request record: one JSON line per upstream answer, behind an operator's marker.

Plan 2026-11-13 (codex-bridge GPT-lane parity), Task 4, D-8619; the parity eval's spec §4.1 (a lane run's rows are
joined by the Claude Code session id and a time window) and §4.2 (the metrics read from these rows). The stats file's
`parity` section (D-8618) holds per route and model aggregates, which cannot be split by run; this file holds one row
per upstream answer.

OPT-IN. A row is written only while the lane directory holds REQUESTS_MARKER (existence-only, read at each upstream
answer, no writer in the tree), as `record.RECORD_MARKER` turns on the stream recordings. With no marker nothing is
written, and nothing on the wire or in the client's answer changes either way: the row is built from what the bridge
already measured for the parity section (`Answer`, below). The rows carry session ids and per-request timings, which
only the eval's lane needs.

THE FILE is `lane.json`'s `bridgeFiles.requests` (spelled once, in `laneManifest`), a JSON Lines file in the lane
directory, mode 0600, opened `O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW | O_NONBLOCK` and used only when it is a
regular file: never through a symlink, never a FIFO, a directory or a device. The key is optional: a `lane.json` an
older `laneManifest` wrote names none, and then no row is written and the bridge says so once in its log (UNNAMED).
BOUNDED: a write that would take the file past REQUESTS_MAX_BYTES first renames it to `<name>` + GENERATION (replacing
any older one) and starts a fresh file, so at most two generations and 2 x REQUESTS_MAX_BYTES are on disk. A row is
bounded too (every field below), so one row never approaches the cap. Each row is ONE `write` of the whole line, under
the record's lock, so two requests never interleave; a short write is cut back to the line's start.

A FAILURE (a full disk, a permission, a symlink or a directory in the file's place) never raises into a request and
never changes the client's answer: it is counted in the stats file's `outcomes` as WRITE_FAILED (beside
`stats:flush-failed` and the `store:*` keys, outside the closed outcome list) and logged at most once per process,
`record-requests write-failed <errno name>`, never a path or a value.

THE ROW (`row`), ROW_VERSION 1, its keys in this order, every value bounded:
  v, at, postAt, session, subagent, message, post, route, model, status, outcome, served, effort, inputTokens,
  cachedTokens, outputTokens, reasoningTokens, firstOutputMs, totalMs, inputTransformations, replay (a message's
  first POST only), markers, fallback, turnState (only when set).
- `at`: UTC milliseconds when the answer ended (its terminal event, its error or its close; for a POST that got no
  answer, when that failure was known); `postAt`: UTC milliseconds when the POST started.
- `session`: the `x-claude-code-session-id` the client sent when it matches SESSION_RE, else null; `subagent`: true
  when the client sent `x-claude-code-agent-id`, never the id itself.
- `message`: the client message's sequence number in this process, from 1, taken at its first POST; `post`: this POST's
  index in that message, from 0 (continuations, the 401 retry and the fallback's retry each add one).
- `route`, `model`: the parity row's `<route>` and `<model>`, each bounded by `stats.NAME_RE` as its key is.
- `status`: the upstream's HTTP status, or null when the POST got no answer (a connect failure, a transport error).
- `outcome`: the word the bridge counted for what it did with this answer, from the stats file's own outcome keys:
  `2xx` (the message's last answer, answered), `continuations` and `continuation-cap`, `refresh-after-401` (the 401 it
  refreshed for), and for an answer whose failure reached the client the word `server._count_failure` counted
  (`4xx`, `5xx`, `client-gone`, or `drain-cut`); and FALLBACK for the 400 that started Task 5's fallback, which the
  stats file counts in the parity row's `fallbacks`, never as an outcome. Bounded by NAME_RE.
- `served`, the four token counts, `inputTransformations`: from the terminal `response.completed` or
  `response.incomplete` the parity section counted (`stats.served_word`, `stats.count_transformations`); null when
  this answer reached none (a non-2xx, a stream that broke), and a token count null when the terminal's usage carried
  no valid one. `inputTransformations` is null too when the response carried no array, and is capped as the parity
  row's map is (PARITY_TRANSFORMS_MAX keys, then OVERFLOW).
- `effort`: `stats.effort_word` of the body this POST sent: its `reasoning.effort`, or `none`.
- `firstOutputMs`, `totalMs`: integers, the parity section's own instants (the POST's start to the first output released
  and to the terminal event) rounded UP, so each lies in the bucket the parity histogram counted it in; null when not
  reached. A stream that released output and then broke has a `firstOutputMs` and no `totalMs`.
- `replay`: the message's reasoning-store lookups by `stats.REPLAY_OUTCOMES`, on its `post` 0 row only.
- `markers`: the request markers (`backend.MARKERS`) this POST carried; `fallback`: true on the row whose 400 started
  the fallback; `turnState`: `captured` or `echoed` (`stats.TURN_STATE_EVENTS`) when this POST did either.
NEVER IN A ROW: any text of the conversation, a tool name, the `prompt_cache_key`, a turn-state value, any header value
but the bounded session id, an account id, a token, or anything `stats.TOKEN_HEADERS` refuses.

Every constant is read when it is used, so the test driver's `consts` reach it.
"""

import errno
import json
import math
import os
import re
import stat
import threading
import time
from typing import Callable, Dict, Mapping, Optional, Tuple

from . import backend, stats

REQUESTS_MARKER = "record-requests"  # D-8619: the operator's; no writer in the tree
REQUESTS_MAX_BYTES = 16 * 2**20  # one generation's size; the older one is GENERATION
GENERATION = ".1"
FILE_MODE = 0o600
ROW_VERSION = 1
SESSION_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")  # a Claude Code session id's shape (a UUID), bounded
FALLBACK = "fallback"  # the outcome of the 400 that started Task 5's fallback (the parity row's `fallbacks`)
WRITE_FAILED = "requests:write-failed"  # the stats file's outcome key for a row that could not be written
UNNAMED = ("record-requests unnamed: lane.json names no bridgeFiles.requests, so no request record is written; run "
           "'ccrc update', which re-renders it")
_CODE_RE = re.compile(r"^[a-z0-9_-]{1,32}$")


def now_ms() -> int:
    """The wall clock, UTC milliseconds."""
    return int(time.time() * 1000)


class Answer:
    """One upstream POST, observed once on the request's path (D-8619 R4): the parity section's counts and the row are
    both read from this object, so neither computes a figure the other does not see. Filled by `server._Request`."""

    def __init__(self, message: int, post: int, model: object, posted: float, post_ms: int) -> None:
        self.message = message
        self.post = post
        self.model = model  # the model the body asked for (the parity row's)
        self.posted = posted  # time.monotonic() at the POST's start: the parity section's clock
        self.post_ms = post_ms
        self.end_ms = None  # type: Optional[int]
        self.status = None  # type: Optional[int]
        self.effort = None  # type: Optional[str]  (the body's reasoning.effort; None: it carried none)
        self.markers = ()  # type: Tuple[str, ...]
        self.fallback = False
        self.turn_state = None  # type: Optional[str]
        self.measured = False  # the reducer saw a terminal completed or incomplete response (the parity row counted it)
        self.served = None  # type: Optional[str]
        self.usage = {}  # type: Dict[str, int]
        self.transformations = None  # type: Optional[list]
        self.first_ms = None  # type: Optional[float]
        self.total_ms = None  # type: Optional[float]

    def since_post(self, at: Optional[float]) -> Optional[float]:
        """Milliseconds from the POST's start to the monotonic instant `at`, or None."""
        return None if at is None else (at - self.posted) * 1000.0

    def ended(self) -> None:
        """The answer ended now, unless an earlier instant was recorded."""
        if self.end_ms is None:
            self.end_ms = now_ms()

    def measure(self, diagnostics: Mapping[str, object]) -> None:
        """The reducer's `diagnostics` of a terminal response (reducer R21)."""
        self.measured = True
        served = diagnostics.get("model")
        self.served = served if isinstance(served, str) else None
        usage = diagnostics.get("usage")
        self.usage = dict(usage) if isinstance(usage, Mapping) else {}
        transformations = diagnostics.get("transformations")
        self.transformations = transformations if isinstance(transformations, list) else None


def _ms(value: Optional[float]) -> Optional[int]:
    if not (isinstance(value, float) or isinstance(value, int)) or isinstance(value, bool):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return int(math.ceil(value))


def row(ans: Answer, *, session: object, subagent: bool, route: str, outcome: str,
        replay: Optional[Mapping[str, int]]) -> Dict[str, object]:
    """The record's row of one answer (the module docstring), its keys in order. `replay` is given for a message's
    first POST only."""
    out = {"v": ROW_VERSION, "at": ans.end_ms if ans.end_ms is not None else now_ms(), "postAt": ans.post_ms,
           "session": session if isinstance(session, str) and SESSION_RE.fullmatch(session) else None,
           "subagent": bool(subagent), "message": ans.message, "post": ans.post,
           "route": stats.bounded(route), "model": stats.bounded(ans.model),
           "status": ans.status if isinstance(ans.status, int) and 100 <= ans.status <= 599 else None,
           "outcome": stats.bounded(outcome),
           "served": stats.served_word(ans.served, ans.model) if ans.measured else None,
           "effort": stats.effort_word(ans.effort)}  # type: Dict[str, object]
    for name, field in stats.PARITY_TOKENS:
        value = ans.usage.get(name) if ans.measured else None
        out[field] = value if stats.is_count(value) else None
    out["firstOutputMs"] = _ms(ans.first_ms)
    out["totalMs"] = _ms(ans.total_ms)
    held = None  # type: Optional[Dict[str, int]]
    if ans.measured and ans.transformations is not None:
        held = {}
        stats.count_transformations(held, ans.transformations)
    out["inputTransformations"] = held
    if replay is not None:
        out["replay"] = {k: (replay[k] if stats.is_count(replay.get(k)) else 0) for k in stats.REPLAY_OUTCOMES}
    out["markers"] = [m for m in backend.MARKERS if m in ans.markers]
    out["fallback"] = bool(ans.fallback)
    if ans.turn_state in stats.TURN_STATE_EVENTS:
        out["turnState"] = ans.turn_state
    return out


def _code(e: BaseException) -> str:
    code = "internal"
    if isinstance(e, OSError) and isinstance(e.errno, int):
        code = errno.errorcode.get(e.errno, "oserror")
    code = code.lower()
    return code if _CODE_RE.fullmatch(code) else "unrecognised"


def _open(path: str) -> int:
    """The record file for appending, created 0600; raises unless it is a regular file (a symlink in its place is
    ELOOP, never followed; a FIFO is never waited on: O_NONBLOCK)."""
    flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0)
    fd = os.open(path, flags, FILE_MODE)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise OSError(errno.EINVAL, "not a regular file")
        if st.st_mode & 0o777 != FILE_MODE:
            os.fchmod(fd, FILE_MODE)
    except BaseException:
        os.close(fd)
        raise
    return fd


class RequestRecord:
    """The lane's record file: `write` appends one row while the marker exists. Shared by the handler threads; one
    lock orders the writes (and the message sequence)."""

    def __init__(self, lane_dir: str, path: str, outcome: Callable[[str], None], log: Callable[[str], None]) -> None:
        self._lane_dir = lane_dir
        self._path = path  # "" when lane.json names no record
        self._outcome = outcome
        self._log = log
        self._lock = threading.Lock()
        self._seq = 0
        self._said = set()  # type: set  (the log lines already written: each at most once per process)

    def next_message(self) -> int:
        """The next client message's sequence number, from 1."""
        with self._lock:
            self._seq += 1
            return self._seq

    def on(self) -> bool:
        """Whether the operator's marker is in the lane directory, read now."""
        return os.path.exists(os.path.join(self._lane_dir, REQUESTS_MARKER))

    def _say_once(self, line: str) -> None:
        with self._lock:
            if line in self._said:
                return
            self._said.add(line)
        try:
            self._log(line)
        except Exception:  # a log that cannot be written is dropped
            pass

    def write(self, build: Callable[[], Dict[str, object]]) -> bool:
        """Append the row `build` makes, when the marker exists and lane.json named the file; True when written. Never
        raises: a failure is counted (WRITE_FAILED) and logged once per process."""
        try:
            if not self.on():
                return False
            if not self._path:
                self._say_once(UNNAMED)
                return False
            line = (json.dumps(build(), separators=(",", ":"), ensure_ascii=True) + "\n").encode("ascii")
            with self._lock:
                self._append(line)
            return True
        except Exception as e:
            try:
                self._outcome(WRITE_FAILED)
            except Exception:
                pass
            self._say_once("record-requests write-failed " + _code(e))
            return False

    def _append(self, line: bytes) -> None:
        fd = _open(self._path)
        try:
            size = os.fstat(fd).st_size
            if size > 0 and size + len(line) > REQUESTS_MAX_BYTES:
                os.close(fd)
                fd = -1
                os.replace(self._path, self._path + GENERATION)  # renames a symlink there, never what it points at
                fd = _open(self._path)
                size = os.fstat(fd).st_size
            written = os.write(fd, line)
            if written != len(line):
                os.ftruncate(fd, size)  # never a split row
                raise OSError(errno.ENOSPC, "a short write")
        finally:
            if fd >= 0:
                os.close(fd)


"""codexbridge.store — the reasoning store: the model's encrypted reasoning, kept so a later request can replay it.

Codex-bridge spec 2026-10-15 §2.5 ("stdlib `sqlite3`, mode 0600"; the key is the `call_id` of the first tool call that
followed the reasoning, or a hash of the assistant text; "14 days, and a size cap that evicts the oldest first"), D23
("oldest-first eviction past 256 MB"); plan 2026-10-22, Task 4. The Codex CLI replays the same items on every
request (`include: ["reasoning.encrypted_content"]`, upstream openai/codex @ 092d3ac:
codex-rs/core/src/client.rs:891-1014); nothing carried them on a lane before the bridge.

WHAT IS STORED, AND NOTHING ELSE. A row is `key -> {"items": [reasoning items], "phase": <name or None>}`. The key is
`inbound.call_key(call_id)`, the call id, or `inbound.text_key(session, text)`, a session-scoped sha256: no reply
text and no tool input is ever a key or a value. An item keeps only `type`, `id`, `summary` and `encrypted_content`
(KEPT_FIELDS), and only when it is a `reasoning` item with encrypted content; its `summary` is always stored as `[]`
(the bridge never asks for one, and a summary would be plaintext reasoning); a phase is kept only when it is a bounded
name (PHASE_RE). Every emitted text of a reply gets its row, with no items and no phase when it has neither, so a
later reply of the same text replaces an earlier reply's reasoning rather than inheriting it. A reply with no session
id writes no text-keyed row at all (its text key would be shared by every sessionless request); its call rows stand.
The file is 0600 (`os.open(..., O_CREAT | O_NOFOLLOW, 0o600)`, then `os.fchmod`, so neither a umask nor a symlink
planted at the path decides it), in a lane directory the tier's start made 0700; sqlite gives its `-wal` and `-shm`
the database's mode.

THE STORE NEVER FAILS A REQUEST. Any exception inside it (an `sqlite3.Error`, an `OSError`, anything else) disables it
for the process: `disabled` becomes `store:<exception class>` (or `store:newer-version`, a store written by a newer
bridge, which is then never written), every later call answers as an empty store, and the optional `outcome` callback
is told once, so the stats file can count it and say so (D-7677's `Stats.store_event`).

THE START CHECK (D-7676). A store damaged before the start used to be disabled at its first write and stay so for the
life of the process (both lanes' stores, carried to a new box with a torn primary-key index, ran six hours with nothing
replayed). So the constructor, once the file is made and the schema ensured on its own thread, runs `PRAGMA
integrity_check` on that connection when the store is not disabled and its `user_version` is USER_VERSION; healthy is
one row, `ok` (a 50 MB store checks in about 10 ms). Not `quick_check`: it counts an index's entries but never compares
them with the table, so a torn index whose count still matches (the table page from after an `INSERT OR REPLACE`, the
store's own write, and the index page from before it) passes it, and the first `get` of that key raises `DatabaseError`
at every start. DAMAGE is a check that answers anything else, or an `sqlite3.DatabaseError` whose class is EXACTLY that
(a file that is not sqlite's, a malformed image) raised while opening, reading `user_version`, ensuring the schema or
checking. Its subclasses are not damage: `OperationalError` (locked, busy, I/O, a read-only file), `IntegrityError` and
the rest name a condition of the moment, not of the file, so they disable the store as above and leave the file
untouched; a newer store is never checked, never touched. A damaged store is SET ASIDE: the constructing thread's
connection is closed without a checkpoint (a damaged WAL is never folded into the copy), the file is renamed
`<path>.damaged-<UTC YYYYmmddTHHMMSSZ>` and its `-wal` and `-shm`, each when present, `<that name>-wal` and
`<that name>-shm`, so the copy opens as one database and no damaged WAL is left at `<path>-wal` for the fresh store.
Only then is ONE copy kept: every other name of that shape in the directory (an older copy, a stray sibling) is removed,
a failed removal ignored. The fresh store is made as a first start makes one (`_create`, then `_conn`), and the callback
is told `store:set-aside` once, with what was found (`integrity-check` or the exception's class name) and the copy's
basename, never a path. A set-aside that cannot finish (a rename's `OSError`, the fresh store failing) disables the
store as `store:set-aside-failed`. Nothing raises, and nothing else changes: a failure after the start still disables
the store for the process, and the next start's check is what repairs a store damaged while it ran.

ONE CONNECTION PER THREAD. The server is a ThreadingHTTPServer and sqlite3's default `check_same_thread=True` makes a
shared connection raise `ProgrammingError` on the first handler thread; each thread opens its own on first use, after
checking that the path is still the file this store created (a file swapped in after the start disables the store).
A thread's connection is not freed when the thread ends (it sits in reference cycles until a garbage collection), so
the caller must call `store.close()` in a `finally` on each thread that used the store: the server's request handler,
once per request, on its own thread. Nothing in this module does it for the caller.

Expiry: `get` never answers a row older than `ttl_s` (default TTL_S), whether or not an eviction has run. Eviction:
expired rows, then the oldest first until the rows' total `size` is at most `max_bytes` (default MAX_BYTES); run by
`evict()`, and by `put()` at most once every EVICT_EVERY_S of the monotonic clock (so a wall-clock step back never
stalls it). Every default is read when it is used, so a test lowers it through the driver's `consts`.
"""

import json
import os
import re
import sqlite3
import stat
import threading
import time
from typing import Callable, Dict, List, Optional, Set

from . import inbound

MAX_BYTES = 256 * 2**20  # D23
TTL_S = 14 * 86400  # spec §2.5
EVICT_EVERY_S = 60.0  # put() evicts at most this often
USER_VERSION = 1  # the schema this module writes; a newer file is never written
BUSY_TIMEOUT_S = 5.0  # sqlite's wait for another thread's write lock

NEWER_VERSION = "store:newer-version"
NOT_REGULAR = "store:not-a-regular-file"
REPLACED = "store:replaced"
SET_ASIDE = "store:set-aside"  # D-7676: a damaged store was set aside at the start and a fresh one made
SET_ASIDE_FAILED = "store:set-aside-failed"  # D-7676: the set-aside could not finish; the store is disabled
INTEGRITY_CHECK = "integrity-check"  # what a set-aside found when the check, not an exception, named the damage
DAMAGED_STAMP = "%Y%m%dT%H%M%SZ"  # the UTC stamp of a set-aside copy's name

# The fields a stored reasoning item keeps; every other field of the upstream item is dropped.
KEPT_FIELDS = ("type", "id", "summary", "encrypted_content")
# A phase is a short name (`commentary`, `final_answer`); anything else is not stored.
PHASE_RE = re.compile(r"^[a-z_]{1,32}$")

_SCHEMA = ("CREATE TABLE IF NOT EXISTS reasoning(key TEXT PRIMARY KEY, items TEXT NOT NULL, "
           "created INTEGER NOT NULL, size INTEGER NOT NULL)")


class _Disabled(Exception):
    """A condition that disables the store with a reason of its own (not an exception class name)."""

    def __init__(self, reason: str) -> None:
        Exception.__init__(self, reason)
        self.reason = reason


def _close_unchecked(conn: sqlite3.Connection) -> None:
    """Close `conn` without the checkpoint sqlite runs at the last close, so a WAL it read is left as it was (the
    connection option is Python 3.12's; an older Python's close may checkpoint)."""
    no_ckpt = getattr(sqlite3, "SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE", None)
    try:
        if no_ckpt is not None and hasattr(conn, "setconfig"):
            conn.setconfig(no_ckpt, True)
    finally:
        conn.close()


def _keep_one(path: str, kept: Set[str]) -> None:
    """Remove every name in `path`'s directory of a set-aside copy's shape (`<base>.damaged-<stamp>`, with `-wal` or
    `-shm` or neither) but the `kept` names; a removal that fails is ignored, never raised."""
    directory, base = os.path.split(path)
    shape = re.compile(re.escape(base) + r"\.damaged-[0-9]{8}T[0-9]{6}Z(?:-wal|-shm)?")
    try:
        names = os.listdir(directory or ".")
    except OSError:
        return
    for name in names:
        if name not in kept and shape.fullmatch(name):
            try:
                os.remove(os.path.join(directory, name))
            except OSError:
                pass


def _clean_item(item: object) -> Optional[dict]:
    """A reasoning item with encrypted content, reduced to KEPT_FIELDS; None for anything else."""
    if not isinstance(item, dict) or item.get("type") != "reasoning":
        return None
    enc = item.get("encrypted_content")
    if not isinstance(enc, str) or not enc:
        return None
    out = {"type": "reasoning", "encrypted_content": enc}
    if isinstance(item.get("id"), str):
        out["id"] = item["id"]
    out["summary"] = []  # never the upstream's summary: the bridge never asks for one, and it would be plaintext
    return {k: out[k] for k in KEPT_FIELDS if k in out}


def _clean_turn(turn: object) -> Optional[dict]:
    """The turn as stored: its reasoning items and its phase (either may be empty); None for a turn that is no dict."""
    if not isinstance(turn, dict):
        return None
    raw = turn.get("items")
    items = [c for c in (_clean_item(i) for i in (raw if isinstance(raw, list) else [])) if c is not None]
    phase = turn.get("phase")
    phase = phase if isinstance(phase, str) and PHASE_RE.fullmatch(phase) else None
    return {"items": items, "phase": phase}


class ReasoningStore:
    """The lane's reasoning store at `path`. Never raises: a failure sets `disabled` and the store answers as empty."""

    def __init__(self, path: str, *, max_bytes: Optional[int] = None, ttl_s: Optional[float] = None,
                 outcome: Optional[Callable[..., None]] = None) -> None:
        self.path = path
        self.disabled = None  # type: Optional[str]
        self._max_bytes = max_bytes
        self._ttl_s = ttl_s
        self._outcome = outcome
        self._local = threading.local()
        self._lock = threading.Lock()
        self._identity = None  # type: Optional[tuple]  ((st_dev, st_ino) of the file this store created)
        self._last_evict = None  # type: Optional[float]  (time.monotonic() of the last eviction)
        self._guard(self._create)
        self._guard(self._start)  # the schema and the start check, on the constructing thread (D-7676)

    # ── the one failure path ──
    def _guard(self, fn: Callable, *args: object) -> object:
        if self.disabled is not None:
            return None
        try:
            return fn(*args)
        except _Disabled as e:
            self._disable(e.reason)
        except Exception as e:  # any failure disables the store; a request never fails because of it
            self._disable("store:" + type(e).__name__)
        return None

    def _disable(self, reason: str) -> None:
        with self._lock:
            if self.disabled is not None:
                return
            self.disabled = reason
        self._tell(reason)

    def _tell(self, reason: str, **detail: str) -> None:
        if self._outcome is not None:
            try:
                self._outcome(reason, **detail)
            except Exception:  # the count is best effort; the store's state is already set
                pass

    # ── the start check (D-7676, the module docstring) ──
    def _start(self) -> None:
        try:
            conn = self._conn()
            rows = conn.execute("PRAGMA integrity_check").fetchall()
            found = None if rows == [("ok",)] else INTEGRITY_CHECK
        except sqlite3.DatabaseError as e:
            if type(e) is not sqlite3.DatabaseError:  # a subclass names the moment, not the file: disabled as before
                raise
            found = type(e).__name__
        if found is None:
            return
        try:
            copy = self._set_aside()
            self._create()
            self._conn()
        except Exception:  # never raised: the store is disabled with the set-aside's own reason
            raise _Disabled(SET_ASIDE_FAILED)
        self._tell(SET_ASIDE, found=found, file=os.path.basename(copy))

    def _set_aside(self) -> str:
        """Close this thread's connection without a checkpoint, rename the file and its WAL files to the copy's name,
        then keep only that copy; the copy's path. Raises when a rename fails."""
        conn = getattr(self._local, "conn", None)
        self._local.conn = None
        if conn is not None:
            _close_unchecked(conn)
        copy = self.path + ".damaged-" + time.strftime(DAMAGED_STAMP, time.gmtime())
        os.rename(self.path, copy)
        kept = {os.path.basename(copy)}
        for suffix in ("-wal", "-shm"):
            if os.path.lexists(self.path + suffix):
                os.rename(self.path + suffix, copy + suffix)
                kept.add(os.path.basename(copy + suffix))
        self._identity = None
        _keep_one(self.path, kept)
        return copy

    # ── the file and the connections ──
    def _create(self) -> None:
        flags = os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
        fd = os.open(self.path, flags, 0o600)
        try:
            os.fchmod(fd, 0o600)
            st = os.fstat(fd)
        finally:
            os.close(fd)
        if not stat.S_ISREG(st.st_mode):
            raise _Disabled(NOT_REGULAR)
        self._identity = (st.st_dev, st.st_ino)

    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            return conn
        st = os.stat(self.path)
        if (st.st_dev, st.st_ino) != self._identity:
            raise _Disabled(REPLACED)
        conn = sqlite3.connect(self.path, timeout=BUSY_TIMEOUT_S, isolation_level=None)
        try:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version > USER_VERSION:  # read before anything is written: a newer store's bytes are never touched
                raise _Disabled(NEWER_VERSION)
            if version < USER_VERSION:
                conn.execute("BEGIN IMMEDIATE")
                try:
                    if conn.execute("PRAGMA user_version").fetchone()[0] < USER_VERSION:
                        conn.execute(_SCHEMA)
                        conn.execute("PRAGMA user_version = %d" % USER_VERSION)
                    conn.execute("COMMIT")
                except BaseException:
                    conn.execute("ROLLBACK")
                    raise
            conn.execute("PRAGMA journal_mode = WAL")
        except BaseException:
            _close_unchecked(conn)  # a store this open refused is never checkpointed into (D-7676)
            raise
        self._local.conn = conn
        return conn

    # ── the reads and writes ──
    def get(self, key: str) -> Optional[dict]:
        """The stored turn under `key`, `{"items": [...], "phase": ...}`, or None."""
        return self._guard(self._get, key)

    def _get(self, key: str) -> Optional[dict]:
        ttl = TTL_S if self._ttl_s is None else self._ttl_s
        row = self._conn().execute("SELECT items FROM reasoning WHERE key = ? AND created >= ?",
                                   (key, int(time.time() - ttl))).fetchone()
        if row is None:
            return None
        return _clean_turn(json.loads(row[0]))

    def put(self, key: str, turn: dict, *, now: Optional[float] = None) -> None:
        """Store `turn` under `key`, replacing a row there (a turn with no reasoning item and no phase too)."""
        self._guard(self._put, key, turn, time.time() if now is None else now)

    def _put(self, key: str, turn: dict, now: float) -> None:
        clean = _clean_turn(turn)
        if clean is None:
            return
        text = json.dumps(clean, sort_keys=True, separators=(",", ":"))
        size = len(text.encode("utf-8")) + len(key.encode("utf-8"))
        self._conn().execute("INSERT OR REPLACE INTO reasoning(key, items, created, size) VALUES (?, ?, ?, ?)",
                             (key, text, int(now), size))
        tick = time.monotonic()
        with self._lock:
            due = self._last_evict is None or tick - self._last_evict >= EVICT_EVERY_S
            if due:
                self._last_evict = tick
        if due:
            self._evict(now)

    def evict(self, *, now: Optional[float] = None) -> int:
        """Remove expired rows, then the oldest until the total size is within the cap; the number removed."""
        n = self._guard(self._evict, time.time() if now is None else now)
        return n if isinstance(n, int) else 0

    def _evict(self, now: float) -> int:
        ttl = TTL_S if self._ttl_s is None else self._ttl_s
        cap = MAX_BYTES if self._max_bytes is None else self._max_bytes
        conn = self._conn()
        conn.execute("BEGIN IMMEDIATE")
        try:
            removed = conn.execute("DELETE FROM reasoning WHERE created < ?", (int(now - ttl),)).rowcount
            total = conn.execute("SELECT COALESCE(SUM(size), 0) FROM reasoning").fetchone()[0]
            doomed = []  # type: List[str]
            if total > cap:
                freed = 0
                for key, size in conn.execute("SELECT key, size FROM reasoning ORDER BY created ASC, rowid ASC"):
                    if total - freed <= cap:
                        break
                    doomed.append(key)
                    freed += size
                conn.executemany("DELETE FROM reasoning WHERE key = ?", [(k,) for k in doomed])
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        with self._lock:
            self._last_evict = time.monotonic()
        return max(0, removed) + len(doomed)

    def close(self) -> None:
        """Close this thread's connection, if it opened one."""
        conn = getattr(self._local, "conn", None)
        self._local.conn = None
        if conn is not None:
            try:
                conn.close()
            except Exception:  # closing is best effort
                pass


def remember(store: Optional[ReasoningStore], reducer: object, session_id: Optional[str]) -> None:
    """Store one reply's reasoning for replay. Each reasoning item goes under the key of the first item released after
    it (`Reducer.reasoning`): `call_key(call_id)` for a call, `text_key(session_id, <emitted text>)` for a message;
    each message's emitted text gets a row under its `text_key` carrying its `phase`, with no items when no reasoning
    preceded it. With no `session_id` no text-keyed row is written. A reasoning item nothing was released after is
    not stored. Never raises."""
    if store is None or store.disabled is not None:
        return
    store._guard(_remember, store, reducer, session_id)


def _remember(store: ReasoningStore, reducer: object, session_id: Optional[str]) -> None:
    rows = {}  # type: Dict[str, dict]  (key -> turn, in the order first keyed)

    def row(key: str) -> dict:
        return rows.setdefault(key, {"items": [], "phase": None})

    for item, keyed in reducer.reasoning:
        if keyed is None:
            continue
        kind, value = keyed
        if kind == "call":
            row(inbound.call_key(value))["items"].append(item)
        elif kind == "text" and session_id:
            row(inbound.text_key(session_id, value))["items"].append(item)
    phases = reducer.phases
    for index in (sorted(reducer.emitted_text) if session_id else []):
        text = reducer.emitted_text[index]
        if not text:
            continue
        turn = row(inbound.text_key(session_id, text))
        phase = phases.get(text)
        if isinstance(phase, str) and phase:
            turn["phase"] = phase
    for key, turn in rows.items():
        store.put(key, turn)

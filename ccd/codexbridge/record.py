"""codexbridge.record — recordings of upstream streams, and the scrubber that makes one a corpus stream.

Codex-bridge spec 2026-10-15 §5 (the first live step, "Scrub the recordings into the corpus"); plan 2026-10-22,
Task 18, "The bridge's contract" (the lane directory's files and markers) and the runbook's step 2; D-6430 (the
synthetic streams stay until recordings replace them).

A RECORDING is the operator's, and only while the lane directory holds the marker RECORD_MARKER (no writer in the
tree): the bridge (`server._Request._one_response`) hands each 2xx upstream answer to `start`, which writes it into
the lane's recordings directory (the name `lane.json`'s `bridgeFiles` carries, 0700) as `<utc>-<n>.sse` (0600): the
status line and the response headers, a blank line, then the body's raw bytes as they are read. At most RECORD_MAX
files: once the directory holds that many, nothing more is recorded. A recording is raw: it holds content, ids and
encrypted reasoning, which is why it is 0600, in a 0700 directory, and never leaves the box unscrubbed. A recording
that cannot be written is dropped; the stream it would have recorded is never touched.

THE SCRUBBER (`python3 -I <tree>/ccd/codexbridge/record.py scrub <in.sse> <out.sse>`) writes a corpus stream (Task 3's
format, `make_streams.py`'s `Stream.add`: `event: <name>`, `data: <compact JSON>`, a blank line): the head is dropped
(every header line), as are `:` comments and the SSE `id:`/`retry:` fields; every id (ID_KEYS) becomes `<prefix>_fx<n>`
(one number per distinct id and prefix, so an item's id and a delta's `item_id` still agree); every `encrypted_content`
becomes `ENC-<n>`; every tool or function `name` becomes `tool_fx<n>` (one number per distinct name, so a call still
names the tool its echo declares); and EVERY OTHER STRING, under any key but the few the corpus reader needs to parse
and replay a stream (STRUCTURAL_KEYS, and TERMINAL_KEYS in a terminal's place), becomes a synthetic string of the same
structure: each letter or digit becomes `x` and every other character is kept, so a text keeps its length, its
whitespace and its punctuation, and the live deltas of a message still join to its done text (the whole-wave fix round,
Z3: a string under a key this module has never heard of, such as a web search's query, an image's revised prompt or a
tool schema's enum, never reaches the public corpus). A function call's `arguments` that parse as JSON keep their keys,
numbers and shape, and only their strings are rewritten. Object KEYS are kept everywhere (an argument's or a schema
property's name included), so a recording still needs a human read before it enters the corpus. A `data:` line that is
not JSON becomes a fixed malformed line. Then the output is checked against SCRUB_PATTERNS (an unscrubbed id, a JWT, an
encrypted content that is not `ENC-<n>`, a key, a line that is not an `event:` or `data:` line), which a structural
key's value can still match: any match refuses (rc 1) and writes nothing. Its expectation in `expect.json` is written by
hand in the reviewed change that adds it (make_streams.py's rule).

The module's CLI runs only under `__main__` (the block below), so importing it through `load_all()` does nothing.
"""

if __name__ == "__main__":  # run as a file under -I: the package's parent goes first on sys.path, nothing else
    import os as _os
    import sys as _sys

    _sys.dont_write_bytecode = True
    _sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
    from codexbridge import record as _record

    _sys.exit(_record.main(_sys.argv[1:]))

import json
import os
import re
import sys
import threading
import time
from typing import Callable, Dict, List, Mapping, Optional, Tuple

from . import sse

RECORD_MAX = 20
RECORD_MARKER = "record-streams"
DIR_MODE = 0o700
FILE_MODE = 0o600
# A bridge recording's name: `<utc>-<n>.sse`. The live probe names its own otherwise, so it never counts here.
RECORDING_RE = re.compile(r"^[0-9]{8}T[0-9]{6}Z-[0-9]{1,6}\.sse$")
UTC_FORMAT = "%Y%m%dT%H%M%SZ"

_LOCK = threading.Lock()  # one recording is reserved at a time, so two streams never take one name or pass the cap


# ── the recording ────────────────────────────────────────────────────────────────────────────────────────────────
class Recording:
    """One open recording file. `write` and `close` may be called from two threads; a write that fails closes it and
    sets `failed` (the recording is cut short; the live probe says so), and a write after the close is dropped."""

    def __init__(self, fd: int) -> None:
        self._fd = fd  # type: Optional[int]
        self._lock = threading.Lock()
        self.failed = False

    def write(self, data: bytes) -> None:
        with self._lock:
            if self._fd is None:
                return
            try:
                view = memoryview(data)
                while view:
                    n = os.write(self._fd, view)
                    view = view[n:]
            except OSError:
                self.failed = True
                self._close_locked()

    def _close_locked(self) -> None:
        if self._fd is not None:
            try:
                os.close(self._fd)
            except OSError:
                pass
            self._fd = None

    def close(self) -> None:
        with self._lock:
            self._close_locked()


def head(status: int, headers: Mapping[str, str]) -> bytes:
    """The recording's head: `HTTP/1.1 <status>`, one `name: value` line per header, then a blank line."""
    lines = ["HTTP/1.1 %d" % int(status)] + ["%s: %s" % (k, v) for k, v in headers.items()]
    return ("\n".join(lines) + "\n\n").encode("utf-8", "replace")


def ensure_dir(rec_dir: str) -> bool:
    """The recordings directory, made 0700 when absent; False (record nothing) when the path is a symlink or not a
    directory, or cannot be made."""
    try:
        os.mkdir(rec_dir, DIR_MODE)
    except FileExistsError:
        pass
    except OSError:
        return False
    try:
        st = os.lstat(rec_dir)
        if not os.path.isdir(rec_dir) or os.path.islink(rec_dir):
            return False
        if st.st_mode & 0o777 != DIR_MODE:
            os.chmod(rec_dir, DIR_MODE)
    except OSError:
        return False
    return True


def open_file(rec_dir: str, name: str) -> Optional[Recording]:
    """A new file `name` in `rec_dir` (0600, never over an existing one or through a symlink), else None."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        fd = os.open(os.path.join(rec_dir, name), flags, FILE_MODE)
    except OSError:
        return None
    try:
        os.fchmod(fd, FILE_MODE)
    except OSError:
        os.close(fd)
        return None
    return Recording(fd)


def recording_count(rec_dir: str) -> int:
    """How many bridge recordings `rec_dir` holds (RECORDING_RE), 0 when it cannot be listed."""
    try:
        return sum(1 for n in os.listdir(rec_dir) if RECORDING_RE.fullmatch(n))
    except OSError:
        return 0


def start(lane_dir: str, rec_dir: str, status: int, headers: Mapping[str, str]) -> Optional[Recording]:
    """A new recording of one upstream answer, its head written, when the lane's RECORD_MARKER exists, `rec_dir` is
    set and holds fewer than RECORD_MAX recordings; else None. Read when called, so the operator's marker reaches a
    running bridge."""
    if not rec_dir or not os.path.exists(os.path.join(lane_dir, RECORD_MARKER)):
        return None
    with _LOCK:
        if not ensure_dir(rec_dir):
            return None
        n = recording_count(rec_dir)
        if n >= RECORD_MAX:
            return None
        rec = open_file(rec_dir, "%s-%d.sse" % (time.strftime(UTC_FORMAT, time.gmtime()), n + 1))
    if rec is not None:
        rec.write(head(status, headers))
    return rec


def tee(up: object, rec: Recording) -> object:
    """`up` (a `backend.Upstream`) with every chunk it yields written to `rec` first; its `close` closes the
    recording, then the connection. The recording is also closed when the body ends."""
    source = getattr(up, "chunks")
    close_up = getattr(up, "close")

    def chunks():  # type: ignore[no-untyped-def]
        try:
            for chunk in source:
                rec.write(chunk)
                yield chunk
        finally:
            rec.close()

    def close() -> None:
        rec.close()
        close_up()

    return up._replace(chunks=chunks(), close=close)  # type: ignore[attr-defined]


def split_head(data: bytes) -> Tuple[Optional[int], bytes]:
    """A recording's status and its body: the head (from `HTTP/` to the first blank line) is cut off. A file with
    no head (a stream saved by hand) is all body, with status None."""
    if not data.startswith(b"HTTP/"):
        return None, data
    cuts = [i for i in (data.find(b"\n\n"), data.find(b"\r\n\r\n")) if i >= 0]
    if not cuts:
        return None, b""
    at = min(cuts)
    end = at + (2 if data[at:at + 2] == b"\n\n" else 4)
    m = re.match(rb"HTTP/[0-9.]+ ([0-9]{3})", data)
    return (int(m.group(1)) if m else None), data[end:]


# ── the scrubber ─────────────────────────────────────────────────────────────────────────────────────────────────
ID_KEYS = frozenset({"id", "item_id", "call_id", "response_id", "previous_response_id", "tool_call_id"})
ENCRYPTED_KEY = "encrypted_content"
ARGUMENTS_KEY = "arguments"
NAME_KEY = "name"  # a tool's or a function call's name: `tool_fx<n>`, one per distinct name
# The only string values kept as they are: what Task 3's corpus reader (`sse.SseParser`, whose event type is
# `data.type`, and `reducer.Reducer`) needs to parse and replay a stream. STRUCTURAL_KEYS anywhere: `type` names the
# event, the item and each part; `status`, `role` and `phase` the item and the message; `object` the response.
# TERMINAL_KEYS only in a terminal's place: `reason` in `incomplete_details` (`reducer`'s incomplete reason) and
# `code` in an `error` object or a top-level `error` event (`errors.classify_failed`), because a `code` elsewhere can
# be content (a code interpreter call's source). Every other string is rewritten (`_synthetic`), whatever its key.
STRUCTURAL_KEYS = frozenset({"type", "status", "role", "phase", "object"})
# Each TERMINAL_KEYS key maps to the one object it is kept in.
TERMINAL_KEYS = {"reason": "incomplete_details", "code": "error"}  # type: Dict[str, str]
MALFORMED_LINE = 'data: {"malformed"'

# What a scrubbed stream must not hold. Each pattern is searched in the whole output text. `encrypted-content` and
# `header-line` are defence in depth: `scrub` rewrites every string under ENCRYPTED_KEY and writes only `event:` and
# `data:` lines (json.dumps escapes a newline), so only a change to `scrub` itself can make either match.
SCRUB_PATTERNS = (
    ("id", re.compile(r"(?<![A-Za-z0-9_])[a-z]{1,8}_(?!fx[0-9]+(?![A-Za-z0-9-]))(?=[A-Za-z0-9-]*[0-9])"
                      r"[A-Za-z0-9-]{8,}")),
    ("jwt", re.compile(r"eyJ[A-Za-z0-9_-]{10,}")),
    ("encrypted-content", re.compile(r'"encrypted_content":"(?!ENC-[0-9]+")')),
    ("key", re.compile(r"sk-[A-Za-z0-9_-]{20,}")),
    ("header-line", re.compile(r"^(?!event: |data: )[^\n]+$", re.MULTILINE)),
)


def _synthetic(text: str) -> str:
    """A text of the same structure: every letter or digit becomes `x`, every other character is kept."""
    return "".join("x" if c.isalnum() else c for c in text)


class _Scrubber:
    def __init__(self) -> None:
        self.ids = {}  # type: Dict[str, str]
        self.per_prefix = {}  # type: Dict[str, int]
        self.encrypted = {}  # type: Dict[str, str]
        self.tools = {}  # type: Dict[str, str]

    def id_of(self, value: str) -> str:
        if value in self.ids:
            return self.ids[value]
        prefix = value.split("_", 1)[0] if "_" in value else "id"
        if not re.fullmatch(r"[a-z]{1,8}", prefix):
            prefix = "id"
        n = self.per_prefix.get(prefix, 0) + 1
        self.per_prefix[prefix] = n
        self.ids[value] = "%s_fx%d" % (prefix, n)
        return self.ids[value]

    def encrypted_of(self, value: str) -> str:
        if value not in self.encrypted:
            self.encrypted[value] = "ENC-%d" % (len(self.encrypted) + 1)
        return self.encrypted[value]

    def tool_of(self, value: str) -> str:
        if value not in self.tools:
            self.tools[value] = "tool_fx%d" % (len(self.tools) + 1)
        return self.tools[value]

    def arguments(self, value: str) -> str:
        try:
            parsed = json.loads(value)
        except (ValueError, RecursionError):
            return _synthetic(value)
        return json.dumps(self.strings(parsed), separators=(",", ":"), ensure_ascii=False)

    def strings(self, value: object) -> object:
        """Every string inside an argument document rewritten; keys, numbers and shape kept."""
        if isinstance(value, str):
            return _synthetic(value)
        if isinstance(value, list):
            return [self.strings(v) for v in value]
        if isinstance(value, dict):
            return {k: self.strings(v) for k, v in value.items()}
        return value

    def value(self, key: Optional[str], value: object, within: Optional[str] = None) -> object:
        """`value`, found under `key` in an object that sits under `within` (None at an event's top level)."""
        if isinstance(value, dict):
            # an `error` event's own fields are its error object's (`errors._error_object`)
            here = key if key is not None else ("error" if value.get("type") == "error" else None)
            return {k: self.value(k, v, here) for k, v in value.items()}
        if isinstance(value, list):
            return [self.value(key, v, within) for v in value]
        if not isinstance(value, str):
            return value
        if key == ENCRYPTED_KEY:
            return self.encrypted_of(value)
        if key in ID_KEYS:
            return self.id_of(value)
        if key == ARGUMENTS_KEY:
            return self.arguments(value)
        if key == NAME_KEY:
            return self.tool_of(value)
        if key in STRUCTURAL_KEYS or (key in TERMINAL_KEYS and TERMINAL_KEYS[key] == within):
            return value
        return _synthetic(value)  # a text that looks like an id keeps its length too, so deltas join


def _dumps(value: object) -> str:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    try:
        text.encode("utf-8")
    except UnicodeEncodeError:  # a lone surrogate: escaped, so the output is UTF-8
        return json.dumps(value, ensure_ascii=True, separators=(",", ":"))
    return text


def scrub(data: bytes) -> bytes:
    """A recording (or a raw stream) as a corpus stream (the module docstring)."""
    _, body = split_head(data)
    parser = sse.SseParser()
    events = parser.feed(body) + parser.close()
    s = _Scrubber()
    out = []  # type: List[str]
    for ev in events:
        if ev.name is not None:
            out.append("event: " + ev.name + "\n")
        if ev.data is None:
            out.append(MALFORMED_LINE + "\n\n")
            continue
        out.append("data: " + _dumps(s.value(None, ev.data)) + "\n\n")
    return "".join(out).encode("utf-8")


def residue(data: bytes) -> List[str]:
    """The names of the SCRUB_PATTERNS the bytes still match, in the table's order."""
    text = data.decode("utf-8", "replace")
    return [name for name, pattern in SCRUB_PATTERNS if pattern.search(text)]


# ── the CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────
def _say(write: Callable[[str], object], line: str) -> None:
    write("record: " + line + "\n")


def main(argv: List[str]) -> int:
    """`scrub <in.sse> <out.sse>`: 0 written, 1 refused (the output still matched; nothing written), 2 usage."""
    err = sys.stderr.write
    if len(argv) != 3 or argv[0] != "scrub":
        _say(err, "usage: record.py scrub <in.sse> <out.sse>")
        return 2
    try:
        with open(argv[1], "rb") as f:
            data = f.read()
    except OSError as e:
        _say(err, "refused: the input cannot be read (%s)" % type(e).__name__)
        return 1
    out = scrub(data)
    left = residue(out)
    if left:
        _say(err, "refused: the output still matches " + ", ".join(left) + "; nothing written")
        return 1
    try:
        with open(argv[2], "wb") as f:
            f.write(out)
    except OSError as e:
        _say(err, "refused: the output cannot be written (%s)" % type(e).__name__)
        return 1
    _say(sys.stdout.write, "scrubbed %d bytes into a corpus stream" % len(out))
    return 0

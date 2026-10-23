"""codexbridge.sse — the incremental server-sent-events parser (upstream) and the frame writer (downstream).

Codex-bridge spec 2026-10-15 §2.4; plan 2026-10-22, Task 1. The parser reads the Responses route's event stream as
the Codex CLI does (upstream openai/codex @ 092d3ac, codex-rs/codex-api/src/sse/responses.rs): one event per blank
line, `event:` and `data:` fields, `:` comments skipped, the `[DONE]` sentinel skipped. It is the prototype's
incremental scan: bytes are buffered and each feed looks for a line end only from the offset where the last feed's
look stopped, never from zero, so a byte is examined a bounded number of times however the stream is chunked
(`scanned` counts every byte examined, from the offset each search actually starts at). A line ends at LF; a CR
before it is dropped, so CRLF and LF streams, and a CRLF split across two chunks, parse alike.

A malformed `data:` field (not JSON, or JSON that is not an object) is an event with `data` None and one warning,
never fatal; a warning names what was wrong, never the content. A line that is not UTF-8 makes its whole event
malformed the same way: the event is answered with `data` None, never dropped and never rebuilt from its other lines.
"""

import json
from typing import List, NamedTuple, Optional

DONE = "[DONE]"
WARNINGS_MAX = 64  # warnings past this many are counted in the last one, never kept
_COMPACT = (",", ":")


class SseEvent(NamedTuple):
    name: Optional[str]  # the `event:` field, None when the event had none
    data: Optional[dict]  # the `data:` field parsed as a JSON object; None when it was malformed
    type: Optional[str]  # data["type"] when it is a string, else `name`


class SseParser:
    """Feed bytes as they arrive; each call answers the events completed so far. `close()` answers an event still
    open when the stream ended (its fields are parsed as if a blank line had followed)."""

    def __init__(self) -> None:
        self._buf = bytearray()
        self._start = 0  # the offset of the first byte not yet consumed into a line
        self._look = 0  # the offset from which no LF has been found yet: the next look starts here
        self._name = None  # type: Optional[str]
        self._data = []  # type: List[str]
        self._seen_field = False
        self._poisoned = False  # a line of this event was not UTF-8
        self.warnings = []  # type: List[str]
        self.scanned = 0

    def _warn(self, what: str) -> None:
        if len(self.warnings) < WARNINGS_MAX:
            self.warnings.append(what)
        elif len(self.warnings) == WARNINGS_MAX:
            self.warnings.append("further warnings dropped")

    def feed(self, chunk: bytes) -> List[SseEvent]:
        out = []  # type: List[SseEvent]
        self._buf += chunk
        buf = self._buf
        while True:
            start = self._look
            nl = buf.find(b"\n", start)
            # counted from `start`, the offset the search was given, so a search that starts earlier counts more
            self.scanned += (nl + 1 if nl >= 0 else len(buf)) - start
            if nl < 0:
                self._look = len(buf)
                break
            line = bytes(buf[self._start:nl])
            self._start = self._look = nl + 1
            if line.endswith(b"\r"):
                line = line[:-1]
            ev = self._line(line)
            if ev is not None:
                out.append(ev)
        if self._start:
            del buf[:self._start]
            self._look -= self._start
            self._start = 0
        return out

    def close(self) -> List[SseEvent]:
        out = []  # type: List[SseEvent]
        rest = bytes(self._buf[self._start:])
        self._buf = bytearray()
        self._start = self._look = 0
        if rest:
            if rest.endswith(b"\r"):
                rest = rest[:-1]
            ev = self._line(rest)
            if ev is not None:
                out.append(ev)
        ev = self._dispatch()
        if ev is not None:
            out.append(ev)
        return out

    def _line(self, raw: bytes) -> Optional[SseEvent]:
        if not raw:
            return self._dispatch()
        try:
            line = raw.decode("utf-8")
        except UnicodeDecodeError:
            self._warn("a line that is not UTF-8")
            self._seen_field = True
            self._poisoned = True
            return None
        if line.startswith(":"):
            return None
        field, sep, value = line.partition(":")
        if sep and value.startswith(" "):
            value = value[1:]
        self._seen_field = True
        if field == "event":
            self._name = value
        elif field == "data":
            self._data.append(value)
        # id:, retry: and unknown fields are ignored, as the SSE format says
        return None

    def _dispatch(self) -> Optional[SseEvent]:
        name, data_lines, seen, poisoned = self._name, self._data, self._seen_field, self._poisoned
        self._name, self._data, self._seen_field, self._poisoned = None, [], False, False
        if poisoned:  # its warning was given when the line was read
            return SseEvent(name, None, name)
        if not seen or not data_lines:
            return None
        text = "\n".join(data_lines)
        if text.strip() == DONE:
            return None
        data = None  # type: Optional[dict]
        try:
            parsed = json.loads(text)
        except (ValueError, RecursionError):
            self._warn("a data field that is not JSON")
        else:
            if isinstance(parsed, dict):
                data = parsed
            else:
                self._warn("a data field that is not a JSON object")
        etype = data.get("type") if data is not None else None
        if not isinstance(etype, str):
            etype = name
        return SseEvent(name, data, etype)


def _dumps(data: dict) -> str:
    try:
        return json.dumps(data, separators=_COMPACT, ensure_ascii=False).encode("utf-8").decode("utf-8")
    except UnicodeEncodeError:  # a lone surrogate: escape it rather than write bytes that are not UTF-8
        return json.dumps(data, separators=_COMPACT, ensure_ascii=True)


def frame(event_type: str, data: dict) -> bytes:
    """One Anthropic SSE frame: `event: <t>\\ndata: <compact json>\\n\\n`. `data["type"]` must equal `event_type`,
    as every Anthropic stream event's does; a mismatch is a programming error and raises ValueError."""
    if data.get("type") != event_type:
        raise ValueError("frame: data.type differs from the event name")
    return ("event: " + event_type + "\ndata: " + _dumps(data) + "\n\n").encode("utf-8")


PING = frame("ping", {"type": "ping"})

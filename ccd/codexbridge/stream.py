"""codexbridge.stream — the Anthropic side of one `/v1/messages` answer: the stream writer and the fold.

Codex-bridge spec 2026-10-15 §2.4 ("Zeros in `message_start` and the real figures in `message_delta`", "A `ping` after
15 s of upstream silence", "errors mid-stream become an Anthropic `error` event with no `message_stop`"); plan
2026-10-22, Task 8 and "The bridge's contract": the commit point (R17), the continuation (block indexes run on across
the responses of one message), D-6431 (`stream:false` is folded).

`AnthropicStream` owns every byte written to one client connection once a request is in flight: the HTTP head, the
SSE frames, and an HTTP answer that is not a stream (an error before the commit point, or a folded `stream:false`
message). It takes one lock per write, so the drain (a thread of its own, `server.serve`) can cut a stream the
request's own thread is writing: `cut` answers whatever the stream's state allows (an `error` frame after the commit
point, a 503 before it), and from then on the stream is `closed` and every later write is dropped, so the request's
thread sees `closed` and stops reading upstream. A write the client cannot take (it went away) closes the stream the
same way; the bytes never raise into the request.

THE STREAM. `commit` writes the head (`Connection: close`: the body ends when the bridge closes the connection, so no
chunked framing) and `message_start`, with zero usage and the REQUESTED model id. `blocks` writes the reducer's block
events, renumbering each response's LOCAL indexes (0, 1, 2… per reducer) onto the message's running count, so a
continued message's blocks run on (`continuation` starts the next response's numbering). `finish` writes
`message_delta` (the stop reason and the usage, R15) and `message_stop`. `fail` closes an open block, then writes one
`error` frame, and never a `message_stop`.

THE BUFFER. With `buffered=True` (a `stream:false` request) nothing is written by `commit`, `blocks`, `ping` or
`finish`: the events are only kept (`events`), `fold` builds the one JSON message from them, and `http` writes it.
Every event is kept in a streaming stream too, so a test can read what was sent.
"""

import http.client
import json
import threading
import time
from typing import Callable, Dict, List, Optional, Tuple

from . import errors, reducer, sse

ZERO_USAGE = reducer.anthropic_usage(reducer.ZERO_USAGE)  # the four keys spelled once, by the reducer
WRITE_LOCK_S = 1.0  # the drain's wait for a write in flight before it gives the stream up


def _reason(status: int) -> str:
    return http.client.responses.get(status, "Status")


def head_bytes(status: int, headers: List[Tuple[str, str]]) -> bytes:
    """An HTTP/1.1 status line and headers, ending with the blank line."""
    lines = ["HTTP/1.1 %d %s" % (status, _reason(status))]
    lines.extend("%s: %s" % (k, v) for k, v in headers)
    return ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1")


def answer_bytes(status: int, headers: Dict[str, str], body: bytes) -> bytes:
    """A whole HTTP answer with a body, `Connection: close`."""
    pairs = [(k, v) for k, v in headers.items() if k.lower() not in ("content-length", "connection")]
    pairs.append(("Content-Length", str(len(body))))
    pairs.append(("Connection", "close"))
    return head_bytes(status, pairs) + body


class AnthropicStream:
    """One client connection's answer. `write` takes raw bytes (the handler's socket writer)."""

    def __init__(self, write: Callable[[bytes], None], *, model: str, message_id: str,
                 buffered: bool = False) -> None:
        self._write = write
        self.model = model
        self.message_id = message_id
        self.buffered = buffered
        self.committed = False
        self.finished = False
        self.closed = False  # cut, failed, answered or the client went away: nothing more is written
        self.client_gone = False
        self.drain_cut = False  # the drain cut it (`cut`), which counts it `drain-cut` itself (D-6835)
        self.events = []  # type: List[Tuple[str, dict]]
        self.last_write_at = time.monotonic()
        self._lock = threading.Lock()
        self._base = 0  # this response's first message-level index
        self._next = 0  # the next message-level index no block has used
        self._open = None  # type: Optional[int]  (the message-level index of the open block)

    # ── the one writer ──
    def _send(self, data: bytes) -> None:
        """Write under the caller's hold of the lock; a failed write closes the stream (the client went away)."""
        if self.closed:
            return
        try:
            self._write(data)
        except (OSError, ValueError):  # a reset or a closed socket: the client is gone
            self.closed = True
            self.client_gone = True
            return
        self.last_write_at = time.monotonic()

    def _frame(self, name: str, data: dict) -> None:
        self.events.append((name, data))
        if not self.buffered:
            self._send(sse.frame(name, data))

    # ── the stream ──
    def commit(self, status: int = 200) -> None:
        """The commit point: the head (a streaming stream only), then `message_start` with zero usage."""
        with self._lock:
            if self.committed or self.closed:
                return
            self.committed = True
            if not self.buffered:
                self._send(head_bytes(status, [("Content-Type", "text/event-stream; charset=utf-8"),
                                               ("Cache-Control", "no-cache"), ("Connection", "close")]))
            self._frame("message_start", {"type": "message_start", "message": {
                "id": self.message_id, "type": "message", "role": "assistant", "model": self.model, "content": [],
                "stop_reason": None, "stop_sequence": None, "usage": dict(ZERO_USAGE)}})

    def continuation(self) -> None:
        """The next response of a continued message: its local index 0 follows the last block written."""
        with self._lock:
            self._base = self._next

    def blocks(self, events: List[Tuple[str, dict]]) -> None:
        """The reducer's block events, their local indexes renumbered onto the message's."""
        with self._lock:
            if not self.committed or self.closed:
                return
            for name, data in events:
                data = dict(data)
                index = self._base + int(data.get("index", 0))
                data["index"] = index
                self._next = max(self._next, index + 1)
                if name == "content_block_start":
                    self._open = index
                elif name == "content_block_stop" and self._open == index:
                    self._open = None
                self._frame(name, data)

    def ping(self) -> None:
        with self._lock:
            if self.committed and not self.buffered and not self.closed:
                self._send(sse.PING)

    def finish(self, stop_reason: str, usage: dict) -> None:
        """`message_delta` with the stop reason and the usage, then `message_stop`."""
        with self._lock:
            if not self.committed or self.closed:
                return
            self._frame("message_delta", {"type": "message_delta",
                                          "delta": {"stop_reason": stop_reason, "stop_sequence": None},
                                          "usage": dict(usage)})
            self._frame("message_stop", {"type": "message_stop"})
            self.finished = True

    def _fail_locked(self, e: errors.BridgeError) -> None:
        if self._open is not None:
            self._frame("content_block_stop", {"type": "content_block_stop", "index": self._open})
            self._open = None
        self.events.append(("error", {"type": "error", "error": {"type": e.etype, "message": e.message}}))
        if not self.buffered:
            self._send(errors.event(e))
        self.closed = True

    def fail(self, e: errors.BridgeError) -> None:
        """After the commit point: close an open block, then one `error` frame; never a `message_stop`."""
        with self._lock:
            if self.closed or not self.committed:
                return
            self._fail_locked(e)

    def http(self, status: int, headers: Dict[str, str], body: bytes) -> None:
        """An HTTP answer that is not a stream: an error before the commit point, or a folded message."""
        with self._lock:
            if self.closed or (self.committed and not self.buffered):
                return
            self._send(answer_bytes(status, headers, body))
            self.closed = True

    def error(self, e: errors.BridgeError) -> None:
        """A failure wherever the stream stands: a real status before the commit point (and always for a buffered
        stream), an `error` frame after it."""
        if self.committed and not self.buffered:
            self.fail(e)
        else:
            status, headers, body = errors.http_answer(e)
            self.http(status, headers, body)

    def cut(self, e: errors.BridgeError) -> bool:
        """The drain's act from its own thread: `error` as it stands. False when a write in flight held the lock
        past WRITE_LOCK_S, or the stream was already closed."""
        if not self._lock.acquire(timeout=WRITE_LOCK_S):
            return False
        try:
            if self.closed or self.finished:
                return False
            self.drain_cut = True  # before `closed`, so a request thread that sees it closed sees this too
            if self.committed and not self.buffered:
                self._fail_locked(e)
            else:
                status, headers, body = errors.http_answer(e)
                self._send(answer_bytes(status, headers, body))
                self.closed = True
            return True
        finally:
            self._lock.release()


def fold(events: List[Tuple[str, dict]]) -> dict:
    """The non-streaming message a stream's events describe: `{id, type, role, model, content, stop_reason,
    stop_sequence: null, usage}`. A text block's deltas are joined; a tool_use block's `input_json_delta`s are joined
    and parsed (the reducer sends one, with a JSON object or `{}`)."""
    msg = {"id": None, "type": "message", "role": "assistant", "model": None, "content": [], "stop_reason": None,
           "stop_sequence": None, "usage": dict(ZERO_USAGE)}  # type: dict
    blocks = {}  # type: Dict[int, dict]
    partial = {}  # type: Dict[int, str]
    for name, data in events:
        if name == "message_start":
            m = data.get("message") or {}
            msg["id"] = m.get("id")
            msg["model"] = m.get("model")
        elif name == "content_block_start":
            block = dict(data.get("content_block") or {})
            blocks[data["index"]] = block
            if block.get("type") == "tool_use":
                partial[data["index"]] = ""
        elif name == "content_block_delta":
            block = blocks.get(data.get("index"))
            delta = data.get("delta") or {}
            if block is None:
                continue
            if delta.get("type") == "text_delta":
                block["text"] = block.get("text", "") + delta.get("text", "")
            elif delta.get("type") == "input_json_delta":
                partial[data["index"]] = partial.get(data["index"], "") + delta.get("partial_json", "")
        elif name == "message_delta":
            delta = data.get("delta") or {}
            msg["stop_reason"] = delta.get("stop_reason")
            msg["stop_sequence"] = delta.get("stop_sequence")
            msg["usage"] = dict(data.get("usage") or ZERO_USAGE)
    for index in sorted(blocks):
        block = blocks[index]
        if block.get("type") == "tool_use":
            try:
                parsed = json.loads(partial.get(index) or "{}")
            except ValueError:
                parsed = {}
            block["input"] = parsed if isinstance(parsed, dict) else {}
        msg["content"].append(block)
    return msg

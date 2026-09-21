#!/usr/bin/env python3
"""ccgpt-proxy — ccrc's front shim between Claude Code and the LiteLLM proxy
that fronts a ChatGPT/Codex subscription lane.

Binds a port, answers its own identity, and forwards every request
byte-for-byte — except a POST body on a path ending `/messages`, which is
parsed as JSON and rewritten. Codex refuses a `system` entry by EITHER of the
two doors Claude Code sends one through, and both are folded, in this order:

  1. `_fold_midturn_system` — every mid-conversation `role: "system"` entry
     inside `messages` becomes `role: "user"`, in place. Because the entry is
     replayed with the conversation history, one unfolded injection fails
     every later turn of that session.
  2. `_fold_system` — the top-level Anthropic `system` field is removed and
     folded into the conversation's own leading turn: MERGED into an
     existing leading `user` message when there is one, otherwise inserted
     as a new one (spec §6.1 item 2, "folds into the leading user turn";
     production's own hybrid, adopted here — D-3152).

Mid-turn conversion runs FIRST, deliberately, and this is not merely a
documentation convention — it changes which branch `_fold_system` takes. A
`role: "system"` entry sitting at `messages[0]` has already become `user` by
the time the top-level fold runs, so the MERGE branch fires and the
top-level instruction lands first inside that turn. Run in the reverse
order, `messages[0]` is still `role: "system"` when `_fold_system` looks, its
`role == "user"` check is false, and the INSERT branch fires instead —
structurally different output, not a cosmetic reordering. D-3152 records
that an unconditional insert (no merge branch) was tried first and measured
to make the two folds commute regardless of call order on every input
tested, which is why this function does not take that simpler shape. A body
on that path the shim cannot parse at all is still forwarded unrewritten
today — three call sites, catalogued as D-3151 in the plan's `## Deviations
found`, until Task 7 replaces them with an explicit refusal.

A `/messages` POST body carrying `Content-Encoding: gzip` or `deflate` is
decompressed before the two folds above run and the folded result is
re-compressed in the same encoding before forwarding — the identical fold
pipeline, never a second one built for compressed input. Any other
encoding (absent, `identity`, or one this shim does not implement) is left
alone, exactly as an unencoded body already was. A body that CLAIMS one of
these two encodings but does not actually decode as one is refused
explicitly with an HTTP 400, rather than forwarded still-compressed with
`system` intact (the exact production hazard this closes — see
`_decode_body`) or left to drop the connection the way a malformed chunked
frame does (see `_read_chunked_body`); this is neither a fourth D-3151 arm
nor that dropped-connection shape, for reasons `_decode_body`'s own
docstring gives.

Listens on 127.0.0.1:$CCGPT_PROXY_PORT; forwards to the LiteLLM proxy at
127.0.0.1:$CCGPT_LITELLM_PORT. No credentials are stored here — the
Authorization header passes through unexamined.

THE LANE'S NAME, ANSWERED LOCALLY. A caller asks GET /ccgpt/lane before it
trusts a listening shim port, because a port is only a number: two lanes can
have their proxy ports collide with something else entirely (a stray test
mock, another lane's leftover listener), and the only way to tell this
listener apart from one of those is to ask it who it is. The answer is the
account id this shim was started with — the same id a later task will use to
resolve this lane's own effort defaults and credentials. Plan 2b's adoption
check refuses to attach to a listener that answers a DIFFERENT lane's id.

THERE ARE NO DEFAULT PORTS OR LANE ID. `CCGPT_ACCOUNT_ID`, `CCGPT_PROXY_PORT`
and `CCGPT_LITELLM_PORT` are all required; a missing one is a refusal to
start, loudly, naming the variable — not a guessed port. A defaulted port is
the exact mechanism by which one lane's shim would silently reach another
lane's gateway and bill the wrong account.
"""
import os
import sys
import json
import gzip
import zlib
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _required_env(name: str) -> str:
    """Read one required environment variable, or refuse to start.

    No default is offered for any of the three variables this shim reads —
    see the module docstring's note on why a defaulted port is unsafe here,
    not merely unhelpful.
    """
    value = os.environ.get(name)
    if not value:
        sys.exit(f"ccgpt-proxy: refusing to start — {name} is not set")
    return value


def _required_port(name: str) -> int:
    """Like `_required_env`, but for a variable that must parse as a port
    number. Left unwrapped, a non-numeric value escaped as a bare
    `ValueError` traceback instead of the same named refusal every other
    missing or invalid variable gets (fix round 1, M-3)."""
    raw = _required_env(name)
    try:
        return int(raw)
    except ValueError:
        sys.exit(f"ccgpt-proxy: refusing to start — {name} is not a valid port number: {raw!r}")


def _fold_midturn_system(data):
    """Every messages[*] with role 'system' becomes 'user', IN PLACE.

    The beta that produces these entries exists because position carries
    meaning, so this never hoists. Both content shapes convert: the sender
    draws no distinction between a plain string and a content-block list, and
    the string arm survives today only because a layer below happens to hoist
    it. Codex refuses either, and the entry is replayed with the history, so
    one unfolded injection fails every later turn.
    """
    msgs = data.get("messages")
    if not isinstance(msgs, list):
        # D-3151, arm 3 of 3: `messages` present but not a list (e.g. a
        # dict) leaves any `role: "system"` entries inside it untouched —
        # `data` is returned as-is and the caller re-encodes and forwards it.
        # Safe today only because the measured fact D-3151 records: every
        # body reaching this shape is one the real upstream parser also
        # rejects, so it can never become the sticky replay hazard the fold
        # exists to close. Task 7 replaces this arm; it does not add a
        # fourth branch beside it.
        return data
    for m in msgs:
        if isinstance(m, dict) and m.get("role") == "system":
            m["role"] = "user"
    return data


def _system_to_text(system):
    """Flatten a top-level `system` value to plain text.

    Same two shapes `_fold_midturn_system` already tolerates on a message's
    own `content`: a plain string, or a list of Anthropic content blocks.
    Blocks are joined in the order the sender wrote them — one instruction in
    sequence, not concatenated ad hoc — and a non-dict entry or a block with
    no string `text` contributes nothing rather than raising, since this
    function's caller must never let a malformed block crash a request that
    a well-formed one would have folded cleanly.
    """
    if isinstance(system, str):
        return system
    if isinstance(system, list):
        parts = [
            b.get("text", "") for b in system
            if isinstance(b, dict) and isinstance(b.get("text"), str)
        ]
        return "\n\n".join(parts)
    return ""


def _fold_system(data):
    """Remove the top-level `system` field and fold its content into the
    conversation's own leading turn (spec §6.1 item 2, "folds into the
    leading user turn"; production's own hybrid, adopted here — D-3152):
    MERGE into an existing leading `role: "user"` message when there is one,
    otherwise INSERT a new one.

    Must run AFTER `_fold_midturn_system` has already processed the same
    `data` — not just a documentation convention, but what decides which
    branch fires. In the documented order, a `role: "system"` entry sitting
    at `messages[0]` has already become `user` by the time this runs, so the
    MERGE branch fires and the top-level text lands first, folded INTO that
    turn. Called before `_fold_midturn_system` (the order this fold must
    never run in), `messages[0].role` is still `"system"`, the merge
    branch's own `role == "user"` check is false, and the INSERT branch
    fires instead — a new leading `user` message ahead of the
    still-`system` entry, which `_fold_midturn_system` then converts
    afterwards. That is a structurally different forwarded body, not a
    cosmetic reordering, which is what makes call order genuinely
    load-bearing here (D-3152's measurement: an unconditional insert with no
    merge branch was tried first, and made the two folds commute regardless
    of order on every input tested — this hybrid is why that shape was
    rejected).

    Merging a string `content` prepends `sys_text` with a blank-line
    separator; merging a content-block-list `content` prepends a new text
    block instead of stringifying. Either way the top-level instruction
    reads first, ahead of what was already in that turn.

    Codex refuses the FIELD, not merely a non-empty value of it, so the key
    is popped unconditionally whenever it is present. An absent, null, or
    empty `system` — or a content-block list with no usable text — folds to
    no text at all, and no leading turn is invented for an instruction that
    said nothing.

    `messages` absent or `null` folds to `[]` before the branch above runs,
    so a request with only a top-level `system` and no history still gets
    one leading `user` turn, not none. `messages` present but not a list, or
    a non-empty list whose first entry is not a dict, is genuinely
    malformed — nothing safe to fold into — so `system` stays popped
    (removed either way) and `messages` is forwarded untouched: the same
    D-3151-consistent contract `_fold_midturn_system`'s own non-list arm
    already uses, not a fourth silent passthrough arm of this function's
    own.
    """
    sys_text = _system_to_text(data.pop("system", None))
    if not sys_text:
        return data
    msgs = data.get("messages") or []
    if not isinstance(msgs, list) or (msgs and not isinstance(msgs[0], dict)):
        return data
    if msgs and msgs[0].get("role") == "user":
        content = msgs[0].get("content")
        if isinstance(content, str):
            msgs[0]["content"] = f"{sys_text}\n\n{content}"
        elif isinstance(content, list):
            msgs[0]["content"] = [{"type": "text", "text": sys_text}] + content
        else:
            msgs[0]["content"] = sys_text
    else:
        msgs.insert(0, {"role": "user", "content": sys_text})
    data["messages"] = msgs
    return data


def _rewrite_messages_body(body: bytes) -> bytes:
    """The `/messages`-path rewrite: fold mid-conversation `system` turns,
    then the top-level `system` field, then re-encode. `ensure_ascii=False`
    (fix round 1, M-5): the default would re-escape every non-ASCII byte the
    client sent even when nothing needed folding, and a proxy that rewrites
    more of the wire than it must is a proxy whose diffs are harder to reason
    about — keep the forwarded body as close to what arrived as re-encoding
    allows.

    A body that cannot be turned into a JSON object at all — malformed JSON,
    a non-object top level, or JSON nested deep enough that the decoder
    itself gives up (fix round 1, I-1: `RecursionError` is a `RuntimeError`
    subclass, not a `ValueError`, and used to escape this except arm
    entirely, dropping the connection with no HTTP response) — has nothing
    safe to fold into, so it is forwarded exactly as received. D-3151, arms 1
    and 2 of 3 (the third is `_fold_midturn_system`'s own non-list arm):
    recorded in the plan's `## Deviations found`, safe only because every
    body reaching either arm today is one the real upstream parser also
    rejects. Task 7 replaces both with an explicit refusal rather than
    adding a fourth branch beside them.
    """
    try:
        data = json.loads(body)
    except (TypeError, ValueError, RecursionError):
        # D-3151, arm 1 of 3.
        return body
    if not isinstance(data, dict):
        # D-3151, arm 2 of 3: valid JSON whose top level is not an object —
        # e.g. a bare array — carries no `messages` key and so cannot be
        # routed as an Anthropic request either; see the docstring above.
        return body
    # Order is the whole point (module docstring): mid-turn conversion runs
    # FIRST, so a system entry already sitting at messages[0] has become
    # `user` by the time the top-level fold decides where to insert — the
    # top-level instruction then lands ABOVE it, not reordered beneath it.
    data = _fold_midturn_system(data)
    if "system" in data:
        data = _fold_system(data)
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


def _is_chunked(headers) -> bool:
    """True iff the request declares `Transfer-Encoding: chunked` — checked
    against the LAST comma-separated token (RFC 7230 §3.3.1: chunked, when
    present, must be the final encoding applied), so a header naming another
    encoding ahead of it (e.g. `gzip, chunked`) is still recognised while a
    value that merely mentions the word elsewhere is not."""
    te = headers.get("Transfer-Encoding", "")
    if not te:
        return False
    return te.strip().split(",")[-1].strip().lower() == "chunked"


def _read_chunked_body(rfile) -> bytes:
    """Decode an HTTP/1.1 chunked request body (RFC 7230 §4.1) from the
    handler's own buffered `rfile` and return the reassembled bytes.

    This is the fix for the measured production defect: `_relay` used to
    read `Content-Length` only, and a `Transfer-Encoding: chunked` request
    carries no `Content-Length` header at all — so the prior code read zero
    bytes and forwarded an empty body while reporting success. Chunked
    framing is: a hex chunk-size line (optional `;`-delimited extensions,
    ignored here — this shim does not act on any chunk extension), CRLF,
    exactly that many body bytes, CRLF, repeated until a zero-size chunk,
    optionally followed by trailer header lines, terminated by a blank line.

    A malformed or truncated chunked body RAISES `ValueError` rather than
    being forwarded as an empty or partial body. This is deliberately not
    the same shape as `_rewrite_messages_body`'s three D-3151 passthrough
    arms: those forward a body that was read COMPLETELY but could not be
    parsed as JSON — the bytes are real and complete, and forwarding them
    unrewritten is what D-3151 records as safe today. Here, the chunk
    framing IS the only description of where the body ends; a body whose
    framing cannot be trusted has no complete, trustworthy byte string to
    forward at all, so there is no passthrough available that would not
    silently ship truncated or misframed bytes upstream. Letting this raise
    surfaces as a loud, visible failure (the connection drops; the box's own
    traceback lands in the unit's journal) rather than a fourth silent
    passthrough arm. Task 7's explicit-refusal shape (an HTTP-level
    response) is deliberately not reproduced here for this different failure
    surface — see the module's Task 5 note for why.
    """
    chunks = []
    while True:
        size_line = rfile.readline()
        if not size_line:
            raise ValueError(
                "ccgpt-proxy: truncated chunked body: connection closed while reading a chunk-size line"
            )
        size_token = size_line.split(b";", 1)[0].strip()
        try:
            size = int(size_token, 16)
        except ValueError:
            raise ValueError(
                f"ccgpt-proxy: malformed chunked body: not a hex chunk-size: {size_token!r}"
            ) from None
        if size < 0:
            raise ValueError(f"ccgpt-proxy: malformed chunked body: negative chunk-size: {size_token!r}")
        if size == 0:
            # Terminating chunk: drain optional trailer header lines up to
            # the blank line that closes the body (RFC 7230 §4.1.2).
            while True:
                trailer_line = rfile.readline()
                if not trailer_line:
                    raise ValueError(
                        "ccgpt-proxy: truncated chunked body: connection closed while reading trailers"
                    )
                if trailer_line in (b"\r\n", b"\n"):
                    break
            break
        chunk = rfile.read(size)
        if len(chunk) != size:
            raise ValueError("ccgpt-proxy: truncated chunked body: connection closed mid-chunk")
        chunks.append(chunk)
        crlf = rfile.read(2)
        if crlf != b"\r\n":
            raise ValueError(f"ccgpt-proxy: malformed chunked body: missing CRLF after chunk data, got {crlf!r}")
    return b"".join(chunks)


def _read_request_body(headers, rfile) -> bytes:
    """The one place `_relay` decides how many body bytes to read and how.

    `Transfer-Encoding: chunked` is checked first and, when present, wins
    outright: RFC 7230 §3.3.3 item 3 treats a message that somehow declares
    both as chunked, and the two framings describe the body length in
    mutually exclusive ways, so there is nothing to reconcile between them.
    Otherwise this is the original `Content-Length`-only read, unchanged.
    """
    if _is_chunked(headers):
        return _read_chunked_body(rfile)
    length = int(headers.get("Content-Length") or 0)
    return rfile.read(length) if length else b""


def _content_encoding(headers) -> str:
    """The request's `Content-Encoding`, lower-cased and stripped — `''`
    when absent. Case-insensitive header lookup, the same contract
    `_is_chunked` above relies on for `Transfer-Encoding`. This shim
    recognises exactly two values below, `gzip` and `deflate`; anything
    else (absent, `identity`, or an encoding this shim does not implement)
    is left for the caller to treat as unrecognised and pass the body
    through untouched — unchanged from every `/messages` body's contract
    before this task, just now scoped to the encodings this shim cannot
    decode rather than to every encoding there is."""
    return (headers.get("Content-Encoding") or "").strip().lower()


class _BadEncoding(Exception):
    """Raised by `_decode_body` when a request claims `Content-Encoding:
    gzip`/`deflate` but its bytes do not actually decode as one. Caught by
    `_relay` alone, which answers an explicit HTTP refusal — see
    `_decode_body`'s own docstring for why that is neither a fourth
    D-3151-style silent passthrough arm nor a second `_read_chunked_body`
    -style dropped connection."""


def _decode_body(body: bytes, encoding: str) -> bytes:
    """Reverse `Content-Encoding: gzip`/`deflate` so `_rewrite_messages_body`
    sees the same plain JSON bytes it already handles for an unencoded
    body — one fold pipeline, not a second one built for compressed input.
    Any OTHER encoding, including `''` (absent/identity), is returned
    unchanged; the caller decides what to do with an encoding this
    function does not recognise.

    Raises `_BadEncoding` when the body claims one of these two encodings
    but does not actually decode as one — a failure mode that is
    deliberately NOT shaped like either of this shim's two existing "body
    could not be used" outcomes:

    - It is not a fourth D-3151 silent-passthrough arm. `_rewrite_messages_
      body`'s own three arms forward a body that was read to completion and
      simply isn't JSON once decoded; forwarding STILL-COMPRESSED,
      unrewritten bytes here instead would repeat, byte for byte, the exact
      production hazard this task closes — the client's original `system`
      field would still be sitting inside them, compressed but intact.
    - It is not `_read_chunked_body`'s let-it-raise-and-drop-the-connection
      shape either. That shape is accepted there only because chunk framing
      is the sole description of where the body ends, so a malformed frame
      leaves nothing complete and trustworthy either to forward or to
      refuse cleanly with. A gzip/deflate body, by contrast, was already
      read to completion (via `_read_request_body`, chunked-decoded first
      if needed) by the time this function sees it: the shim knows exactly
      how many bytes arrived and can name the failure precisely, so there
      is no reason to drop the connection instead of answering it.

    So the caller answers an explicit HTTP-level refusal instead — spec
    §6.3's own stated preference ("the hazard is the silent arm, not the
    encoding") applied to a failure mode neither D-3151 nor Task 5's
    chunked-body work anticipated.
    """
    if encoding == "gzip":
        try:
            return gzip.decompress(body)
        except (OSError, EOFError) as e:
            # Measured directly (not assumed): a structurally-bad gzip
            # header, a CRC/length mismatch, or a corrupted member all raise
            # `gzip.BadGzipFile`, an `OSError` subclass. But a body that is
            # simply CUT SHORT — valid header, compressed data ends before
            # the stream's own end-of-stream marker — raises `EOFError`
            # instead, which is NOT an `OSError` subclass. Catching only
            # `OSError` would have let that one case escape this function
            # uncaught, propagate out of `_relay`, and drop the connection —
            # reproducing, for a truncated gzip body specifically, the exact
            # shape this task was told not to replicate.
            raise _BadEncoding(f"invalid gzip body: {e}") from None
    if encoding == "deflate":
        try:
            return zlib.decompress(body)
        except zlib.error as e:
            raise _BadEncoding(f"invalid deflate body: {e}") from None
    return body


def _encode_body(body: bytes, encoding: str) -> bytes:
    """The inverse of `_decode_body`: re-apply `gzip`/`deflate` framing
    after the fold so the forwarded body matches the `Content-Encoding`
    header the shim still forwards unchanged (that header is not a member
    of `HOP_BY_HOP`, below). Any other encoding is returned unchanged,
    mirroring `_decode_body`."""
    if encoding == "gzip":
        return gzip.compress(body)
    if encoding == "deflate":
        return zlib.compress(body)
    return body


ACCOUNT_ID = _required_env("CCGPT_ACCOUNT_ID")
PROXY_PORT = _required_port("CCGPT_PROXY_PORT")
LITELLM_PORT = _required_port("CCGPT_LITELLM_PORT")
UPSTREAM = f"http://127.0.0.1:{LITELLM_PORT}"

LANE_PATH = "/ccgpt/lane"

# Per-hop headers (RFC 7230 §6.1, plus accept-encoding) must never be copied
# from one connection onto the next — they describe THIS hop, not the
# message, and copying content-length/transfer-encoding across a body this
# shim may later rewrite would describe a size that no longer matches.
HOP_BY_HOP = {
    "host", "connection", "content-length", "transfer-encoding", "keep-alive",
    "proxy-authenticate", "proxy-authorization", "te", "trailers", "upgrade",
    "accept-encoding",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _lane(self):
        payload = json.dumps({"lane": ACCOUNT_ID}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(payload)

    def _relay(self):
        body = _read_request_body(self.headers, self.rfile)
        path_only = self.path.split("?", 1)[0].rstrip("/")
        if path_only == LANE_PATH:
            # A body on this endpoint is unexpected but drained above so a
            # client that sent one (a generic HTTP client dressing every
            # verb with headers) doesn't leave bytes on the wire.
            self._lane()
            return
        # Every other path is forwarded exactly as received, except one
        # ending `/messages`: that body is JSON, and Codex refuses a
        # mid-conversation `role: "system"` entry inside its `messages` —
        # _fold_midturn_system converts each one to `user`, in place, before
        # the request ever leaves this shim. Suffix match, not the exact
        # literal `/v1/messages` (fix round 1, M-4): spec §6.4 speaks of
        # "non-/messages paths", and nothing in this repo yet pins the
        # generated launcher's base URL to an empty path component — a
        # prefixed mount (e.g. a path-carrying `ANTHROPIC_BASE_URL`) must
        # not silently bypass the fold.
        #
        # A gzip/deflate-encoded body on this same path is decoded first so
        # the SAME fold pipeline (`_rewrite_messages_body`) sees plain JSON
        # bytes exactly as it does for an unencoded body, then the folded
        # result is re-compressed before forwarding — `Content-Encoding`
        # itself is not in HOP_BY_HOP, so the header below still reaches
        # upstream unchanged and must describe bytes that actually match it.
        # `_read_request_body` above has already stripped any chunked
        # transfer framing by this point, so a request carrying BOTH
        # `Transfer-Encoding: chunked` and `Content-Encoding: gzip` is
        # already down to the plain gzip bytes here — transport framing
        # peeled off first, content encoding second, each handled once.
        if body and path_only.endswith("/messages"):
            encoding = _content_encoding(self.headers)
            if encoding in ("gzip", "deflate"):
                try:
                    plain = _decode_body(body, encoding)
                except _BadEncoding as e:
                    self.send_error(400, f"ccgpt-proxy: {e}")
                    return
                body = _encode_body(_rewrite_messages_body(plain), encoding)
            else:
                body = _rewrite_messages_body(body)
        req = urllib.request.Request(UPSTREAM + self.path, data=body or None, method=self.command)
        for key, value in self.headers.items():
            if key.lower() not in HOP_BY_HOP:
                req.add_header(key, value)
        if body:
            req.add_header("Content-Length", str(len(body)))
        try:
            resp = urllib.request.urlopen(req, timeout=900)
        except urllib.error.HTTPError as e:
            resp = e
        except (urllib.error.URLError, OSError) as e:
            self.send_error(502, f"ccgpt-proxy: upstream unreachable: {e}")
            return
        self.send_response(resp.status)
        for key, value in resp.headers.items():
            if key.lower() not in HOP_BY_HOP:
                self.send_header(key, value)
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            while True:
                chunk = resp.read(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            resp.close()

    # Every verb Claude Code or ccgpt itself might issue is forwarded — GET
    # and HEAD for probes/health checks, OPTIONS for a preflight-shaped
    # client, the rest for the actual traffic. Without HEAD/OPTIONS here,
    # `BaseHTTPRequestHandler`'s own default answers a bare 501 for either,
    # which would make "everything else forwarded untouched" (module
    # docstring) not literally true (fix round 1, M-5).
    do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = _relay


if __name__ == "__main__":
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PROXY_PORT), Handler)
    except OSError as e:
        # Unwrapped, a bind failure (most commonly EADDRINUSE) is a bare
        # socketserver traceback with no ccrc-shaped message (fix round 1,
        # M-4) — easy to miss in a unit's journal next to everything else a
        # crashing process prints.
        sys.exit(f"ccgpt-proxy: failed to bind 127.0.0.1:{PROXY_PORT}: {e}")
    server.serve_forever()

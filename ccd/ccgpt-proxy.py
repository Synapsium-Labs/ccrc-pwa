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
tested, which is why this function does not take that simpler shape.

A body on that path the shim cannot parse at all is REFUSED, never forwarded
unexamined. D-3151 — three silent passthrough arms, one in
`_rewrite_messages_body` for a body that is not valid JSON at all, a second
in the same function for valid JSON whose top level is not an object, a
third in `_fold_midturn_system` for a `messages` field present but not a
list — is CLOSED as of this task (Task 7a): each now raises `_UnusableBody`,
caught once in `_relay`, and answered as an explicit HTTP 400 naming what
was wrong. See the plan's `## Deviations found` for the full history of why
those three arms were accepted for two tasks' worth of time, and D-3151's
own CLOSED entry there (durable, unlike the gitignored `task-7a-rulings.md`
this paragraph also cites) for what retired them.

A `/messages` POST body carrying `Content-Encoding: gzip` or `deflate` is
decompressed before the two folds above run and the folded result is
re-compressed in the same encoding before forwarding — the identical fold
pipeline, never a second one built for compressed input. An absent or
`identity` `Content-Encoding` is left alone, exactly as an unencoded body
already was: folded and forwarded like any other. Any OTHER encoding this
shim does not implement — `br`, or the list/trailing-comma forms
`"gzip, br"` / `"gzip,"` (D-3151 arm 1 used to swallow both silently) — is
refused outright with an HTTP 415 naming the encoding, rather than forwarded
unexamined. A body that CLAIMS `gzip`/`deflate` but does not actually decode
as one is refused with an HTTP 400 naming what was wrong (see
`_decode_body`) — neither a fourth D-3151 arm nor left to drop the
connection the way a malformed chunked frame does (see `_read_chunked_body`).

Every refusal in this file — the two encoding refusals above, the three
closed D-3151 arms, and malformed chunked framing below — answers the SAME
shape (D-3153): a JSON body `{"error": "..."}`, `Content-Type:
application/json`, never `send_error`'s HTML body with the exception text
folded into the status-line reason phrase. See `Handler._refuse`.

Malformed or truncated `Transfer-Encoding: chunked` framing — and a
non-numeric `Content-Length` on the non-chunked path (fix round 1, M-1) —
is refused with an HTTP 400 too, for every path, not only `/messages`: this
is a transport-framing failure, not a parsed-content one, so a body whose
length cannot be trusted has no complete bytes to examine, refuse
specifically, or forward anywhere. See `_read_request_body`.

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


class _UnusableBody(Exception):
    """Raised when a `/messages` body cannot be safely folded at all: not
    JSON, not a JSON object once parsed, or a `messages` field present but
    not a list. Raised by `_rewrite_messages_body` and the
    `_fold_midturn_system` it calls, caught by `_relay` alone, which answers
    an explicit HTTP 400 via `Handler._refuse` — this is D-3151's CLOSURE:
    three arms that used to `return` the body (or `data`) unrewritten now
    raise this instead, rather than adding a fourth silent branch beside
    them.

    Follows `_BadEncoding`'s own precedent below (a dedicated exception
    raised where the condition is detected, caught once, turned into one
    explicit response) rather than overloading `_rewrite_messages_body`'s
    return value: it must not return `None` for "refuse" and `bytes` for
    "rewritten" — two conditions a caller handles differently collapsing to
    the same value is a seam defect, not a style note (ring conventions,
    project CLAUDE.md).
    """


def _fold_midturn_system(data):
    """Every messages[*] with role 'system' becomes 'user', IN PLACE.

    The beta that produces these entries exists because position carries
    meaning, so this never hoists. Both content shapes convert: the sender
    draws no distinction between a plain string and a content-block list, and
    the string arm survives today only because a layer below happens to hoist
    it. Codex refuses either, and the entry is replayed with the history, so
    one unfolded injection fails every later turn.

    Raises `_UnusableBody` — D-3151, arm 3 of 3, CLOSED — when `messages` is
    PRESENT but not a list (e.g. a dict): there is nothing inside it to
    examine for a `role: "system"` entry, and forwarding it unexamined is
    exactly the sticky-replay hazard this whole task exists to close. This
    arm used to `return data` unmodified; Task 7a replaces it with an
    explicit refusal instead of a fourth branch beside it.

    ABSENT or explicit `null` `messages` is NOT this arm and must not become
    it (fix round 1, C-1): `data.get("messages")` returns `None` for both,
    and D-3151 arm 3's own census — the plan's and the deleted comment's —
    was always "present but not a list", never "absent". A body carrying
    only a top-level `system` and no `messages` at all is one this shim
    folds perfectly well (`_fold_system`'s `data.get("messages") or []`
    turns the missing key into `[]` and inserts one leading `user` turn),
    so refusing it is the over-refusal task-7a-rulings.md §6 (fix round 1,
    C-1) exists to prevent — it buys nothing, since a `messages` key that is not there
    cannot hide an unfolded mid-turn `system` entry either. `None` is
    checked and returned on FIRST, before the `isinstance` refusal, so the
    absent/`null` case keeps returning `data` unmodified exactly as it did
    before this task, and only a `messages` key that is PRESENT with the
    wrong type earns the refusal.
    """
    msgs = data.get("messages")
    if msgs is None:
        # Absent key or explicit `null` — not D-3151 arm 3's condition, see
        # above. `_fold_system`'s `or []` handles this exactly as before.
        return data
    if not isinstance(msgs, list):
        raise _UnusableBody("ccgpt-proxy: 'messages' is present but not a list")
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
    one leading `user` turn, not none (fix round 1, C-1: this sentence was
    briefly false between the parent commit and this fix — see
    `_fold_midturn_system`'s own docstring for the defect and the remedy;
    re-verified true again here, not merely re-asserted). A non-empty list
    whose first entry is not a dict is genuinely malformed — nothing safe
    to fold into — so `system` stays popped (removed either way) and
    `messages` is forwarded untouched. This guard is written as `not
    isinstance(msgs, list) or (msgs and not isinstance(msgs[0], dict))`,
    but by the time this function runs its only caller
    (`_rewrite_messages_body`) has already run `_fold_midturn_system`,
    which returns `data` unmodified for an ABSENT or `null` `messages` and
    raises `_UnusableBody` for a PRESENT non-list `messages` (fix round 1,
    C-1) — so `data.get("messages")` here is always either `None` or an
    actual list by the time `msgs = data.get("messages") or []` runs,
    never a present-but-wrong-type value, and `not isinstance(msgs, list)`
    can never be True: defensive dead code from this call site, same shape
    as `_decode_body`/`_encode_body`'s own unreachable tails below, not a
    D-3151 arm and never was — the Tasks 5+6 review's §6 census confirmed
    exactly three arms, and this pre-existing pair (this branch, and the
    identical-shaped empty-`sys_text` early return above it) is not among
    them. The `first entry not a dict` half remains live and is left
    exactly as it was.
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

    Raises `_UnusableBody` — D-3151, arms 1 and 2 of 3, CLOSED — when the
    body cannot be turned into a JSON object at all: malformed JSON, a
    non-object top level (e.g. a bare array — carries no `messages` key and
    cannot be routed as an Anthropic request either), or JSON nested deep
    enough that the decoder itself gives up (fix round 1, I-1:
    `RecursionError` is a `RuntimeError` subclass, not a `ValueError`, and
    used to escape this except arm entirely, dropping the connection with no
    HTTP response). Both arms used to `return body` unrewritten; Task 7a
    replaces them with the explicit refusal D-3151 always said Task 7 would
    ship, rather than adding a fourth branch beside `_fold_midturn_system`'s
    own arm 3.
    """
    try:
        data = json.loads(body)
    except (TypeError, ValueError, RecursionError) as e:
        raise _UnusableBody(f"ccgpt-proxy: malformed JSON body: {e}") from None
    if not isinstance(data, dict):
        raise _UnusableBody("ccgpt-proxy: top-level JSON value is not an object")
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
    being forwarded as an empty or partial body: the chunk framing IS the
    only description of where the body ends, so a body whose framing cannot
    be trusted has no complete, trustworthy byte string to forward at all —
    there is no passthrough available that would not silently ship
    truncated or misframed bytes upstream, the same reasoning D-3151's three
    (now closed) arms never had to make because THEY always had a complete
    byte string in hand, just not one that parsed as JSON.

    Caught once, at the `_read_request_body` call site in `_relay`, and
    answered as an explicit HTTP 400 (Task 7a, task-7a-rulings.md §4; the
    durable version of this rule is spec §6.3,
    `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md`) — for
    EVERY path, not only `/messages`, because the failure is in the
    transport, below the path: there is no body to relay anywhere, so the
    non-`/messages` passthrough guarantee has nothing to apply to here. This
    supersedes the design this function shipped with through Tasks 5 and 6,
    which deliberately left the `ValueError` uncaught (a loud traceback and
    a dropped connection, on the argument that Task 7's explicit-refusal
    shape was for a different failure surface); the controller's ruling for
    Task 7a is that giving every "cannot use this body" condition ONE
    explicit shape now includes this one too.
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

    Can raise `ValueError` from EITHER of its two raisers (fix round 1,
    M-1 — the docstring here used to name only the first): `_read_chunked_body`
    on malformed or truncated chunk framing, and the `int()` parse below on
    a `Content-Length` that is not a valid integer (e.g. `Content-Length:
    abc`). `_relay` catches it at this function's own call site and answers
    an explicit HTTP 400, for every path (see `_read_chunked_body`'s
    docstring). The `int()` failure is wrapped with a `ccgpt-proxy:`-
    prefixed message so it matches every other refusal in the file — a bare
    `ValueError` from a stdlib call is otherwise the one refusal message in
    the file that would not name the shim.
    """
    if _is_chunked(headers):
        return _read_chunked_body(rfile)
    try:
        length = int(headers.get("Content-Length") or 0)
    except ValueError as e:
        raise ValueError(f"ccgpt-proxy: invalid Content-Length: {e}") from None
    return rfile.read(length) if length else b""


def _content_encoding(headers) -> str:
    """The request's `Content-Encoding`, lower-cased and stripped — `''`
    when absent. Case-insensitive header lookup, the same contract
    `_is_chunked` above relies on for `Transfer-Encoding`.

    `_relay` treats the result three ways (task-7a-rulings.md §3; spec
    §6.3's "an encoding the shim cannot decode is answered with an
    explicit error" is the durable version): absent
    (`''`) or `identity` means no encoding at all — folded and forwarded
    like any other unencoded body. `gzip`/`deflate` — this shim's only two
    implemented codecs, `_CODECS` below — are decoded, folded, and
    re-encoded. Anything else, INCLUDING the list/trailing-comma forms
    `"gzip, br"` and `"gzip,"` (neither equals the bare token `"gzip"`, so
    neither ever reaches the decode branch), is refused outright with an
    HTTP 415 naming the encoding rather than forwarded unexamined — the
    D-3151 arm-1 hole both shapes used to fall into.
    """
    return (headers.get("Content-Encoding") or "").strip().lower()


# M4 (task-7a-rulings.md §8): the encoding vocabulary this shim can
# decode/re-encode, enumerated ONCE — the repo's own "enumerated once and
# derived" convention (project CLAUDE.md). Before this, "gzip"/"deflate"
# were named three separate times with nothing forcing them to agree: the
# `_relay` call site's `encoding in ("gzip", "deflate")` tuple, and once
# each inside `_decode_body`'s and `_encode_body`'s own `if` chains —
# widening the decoder without widening the call site's tuple would have
# silently left the new branch unreachable, with nothing red, and
# `single-definition.test.ts` cannot catch it (its roots are the four TS
# trees, not `ccd/`). Both the `_relay` call site's membership check and
# §3's 415 refusal now key off this same dict.
_CODECS = {
    "gzip": (gzip.decompress, gzip.compress),
    "deflate": (zlib.decompress, zlib.compress),
}


class _BadEncoding(Exception):
    """Raised by `_decode_body` when a request claims `Content-Encoding:
    gzip`/`deflate` but its bytes do not actually decode as one. Caught by
    `_relay` alone, which answers an explicit HTTP 400 via `Handler._refuse`
    (D-3153) — see `_decode_body`'s own docstring for why that is neither a
    fourth D-3151-style silent passthrough arm nor a second
    `_read_chunked_body`-style dropped connection."""


def _decode_body(body: bytes, encoding: str) -> bytes:
    """Reverse `Content-Encoding: gzip`/`deflate` so `_rewrite_messages_body`
    sees the same plain JSON bytes it already handles for an unencoded
    body — one fold pipeline, not a second one built for compressed input.
    An `encoding` not present in `_CODECS` (absent/identity, or anything
    this shim does not implement) is returned unchanged; `_relay` decides
    what to do with it — see `_content_encoding`'s docstring: absent/
    identity are folded normally, anything else is refused with a 415
    before this function is ever called with it.

    Raises `_BadEncoding` when the body claims a recognised encoding but
    does not actually decode as one — a failure mode that is deliberately
    NOT shaped like either of this shim's two other "body could not be
    used" outcomes:

    - It is not a fourth D-3151 silent-passthrough arm. Those three arms
      forward a body that was read to completion and simply is not JSON
      once decoded; forwarding STILL-COMPRESSED, unrewritten bytes here
      instead would repeat, byte for byte, the exact production hazard this
      task closes — the client's original `system` field would still be
      sitting inside them, compressed but intact.
    - It is not `_read_chunked_body`'s let-it-raise-and-drop-the-connection
      shape either. That shape is accepted there only because chunk framing
      is the sole description of where the body ends, so a malformed frame
      leaves nothing complete and trustworthy either to forward or to
      refuse cleanly with. A gzip/deflate body, by contrast, was already
      read to completion (via `_read_request_body`, chunked-decoded first
      if needed) by the time this function sees it: the shim knows exactly
      how many bytes arrived and can name the failure precisely, so there
      is no reason to drop the connection instead of answering it.

    So the caller answers an explicit HTTP-level refusal instead (a 400 via
    `Handler._refuse` — D-3153 unified this and Task 6's own gzip/deflate
    refusal into one JSON shape) — spec §6.3's own stated preference ("the
    hazard is the silent arm, not the encoding") applied to a failure mode
    neither D-3151 nor Task 5's chunked-body work anticipated.

    ONE shared `except (OSError, EOFError, zlib.error)` covers BOTH codecs
    (C1, task-7a-rulings.md §1) — measured directly, not assumed:
    `gzip.decompress` raises `gzip.BadGzipFile` (an `OSError` subclass) for
    a structurally-bad header or a CRC/length mismatch, `EOFError` (NOT an
    `OSError` subclass) for data simply cut short before its own
    end-of-stream marker, and — the case `except (OSError, EOFError)` alone
    used to miss, dropping the connection with no HTTP response — a bare
    `zlib.error` for a valid gzip header wrapping a corrupted DEFLATE
    payload; `zlib.error`'s MRO is `(zlib.error, Exception, BaseException,
    object)`, neither `OSError` nor `EOFError`. `zlib.decompress` (the
    `deflate` codec) only ever raises `zlib.error` in practice, so widening
    its catch to include `OSError`/`EOFError` too is harmless — one shared
    except clause for both codecs beats two codec-specific ones that could
    individually go stale the way gzip's just did.
    """
    codec = _CODECS.get(encoding)
    if codec is None:
        return body
    decode, _encode = codec
    try:
        return decode(body)
    except (OSError, EOFError, zlib.error) as e:
        raise _BadEncoding(f"ccgpt-proxy: invalid {encoding} body: {e}") from None


def _encode_body(body: bytes, encoding: str) -> bytes:
    """The inverse of `_decode_body`: re-apply `gzip`/`deflate` framing
    after the fold so the forwarded body matches the `Content-Encoding`
    header the shim still forwards unchanged (that header is not a member
    of `HOP_BY_HOP`, below). An `encoding` not present in `_CODECS` is
    returned unchanged, mirroring `_decode_body`."""
    codec = _CODECS.get(encoding)
    if codec is None:
        return body
    _decode, encode = codec
    return encode(body)


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

    def _refuse(self, status: int, message: str) -> None:
        """Answer ONE refusal shape for the entire file (D-3153): a JSON
        body `{"error": message}`, `Content-Type: application/json` — never
        `send_error`'s HTML body with the exception text folded into the
        status-line reason phrase (measured, pre-D-3153:
        `HTTP/1.1 400 ccgpt-proxy: invalid gzip body: …`,
        `Content-Type: text/html;charset=utf-8`). A client of `/v1/messages`
        speaks JSON, and two shapes for one problem class — "I cannot use
        this body" — is a seam defect, not a style choice. Status is a
        DECISION the caller makes (415: this shim does not implement the
        claimed content-encoding; 400: what you sent is malformed; 502: the
        upstream is unreachable).

        Fix round 1, I-1: the upstream handler being never reached is an
        INVARIANT, but only at the BODY-REFUSAL call sites — the chunked/
        `_UnusableBody`/`_BadEncoding`/415 sites above `_relay`'s own
        `urlopen` call — because those are the ones this method's own
        docstring used to (falsely) claim it upholds universally. The 502
        upstream-unreachable call site is the DELIBERATE EXCEPTION: it
        fires AFTER `urlopen`, i.e. after the request body WAS offered
        upstream — measured, an upstream that reads the body and then
        drops its socket makes `_refuse(502, …)` answer with the recording
        sink already having seen the request. What every call to this
        method upholds unconditionally is narrower and still real: the ONE
        JSON refusal shape (D-3153), never `send_error`'s HTML/status-line
        one. Every refusal in this file — Task 6's gzip/deflate decode
        failure and the upstream-unreachable 502 included — now calls this
        instead of `send_error`.
        Fix round 1, M-3: a HEAD request gets headers describing the body
        (including its real `Content-Length`) but not the body bytes
        themselves, matching `send_error`'s own `self.command != 'HEAD'`
        behaviour — `_refuse` used to write the body unconditionally, a
        protocol wart on the two paths that can reach a refusal via HEAD
        (malformed chunked framing, upstream down). Harmless in practice
        (`Connection: close` means no desync window), but wrong.
        """
        payload = json.dumps({"error": message}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def _relay(self):
        try:
            body = _read_request_body(self.headers, self.rfile)
        except ValueError as e:
            # Task 7a, §4: malformed/truncated chunked framing, OR (fix
            # round 1, M-1) a non-numeric Content-Length — both raised by
            # `_read_request_body`, not only the chunked one. The transport
            # itself, not the parsed content, is what's wrong — there is no
            # complete byte string to examine at all, so this is refused
            # for EVERY path, not only `/messages` (the deliberate
            # exception to the non-`/messages` passthrough guarantee below:
            # framing that cannot be parsed cannot be forwarded anywhere,
            # because there is no body to relay).
            self._refuse(400, str(e))
            return
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
        #
        # An encoding this shim does not implement is refused outright
        # (task-7a-rulings.md §3; spec §6.3) rather than left to fall into the old
        # D-3151 arm 1: absent (`''`) and `identity` are the two values
        # that mean "no encoding", checked first and folded like any other
        # unencoded body; everything else that is not a known codec —
        # `br`, `"gzip, br"`, `"gzip,"` among them — earns a 415 naming the
        # encoding, never a silent, still-compressed forward.
        if body and path_only.endswith("/messages"):
            encoding = _content_encoding(self.headers)
            if encoding not in ("", "identity") and encoding not in _CODECS:
                self._refuse(415, f"ccgpt-proxy: unimplemented content-encoding: {encoding!r}")
                return
            try:
                if encoding in _CODECS:
                    body = _encode_body(_rewrite_messages_body(_decode_body(body, encoding)), encoding)
                else:
                    body = _rewrite_messages_body(body)
            except (_BadEncoding, _UnusableBody) as e:
                self._refuse(400, str(e))
                return
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
            self._refuse(502, f"ccgpt-proxy: upstream unreachable: {e}")
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

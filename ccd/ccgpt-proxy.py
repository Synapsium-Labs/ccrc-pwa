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

Once a `/messages` body is safely parsed and both system folds have run,
`_apply_effort` resolves Codex's own `reasoning.effort`: an explicit client
`output_config.effort` wins outright, else this lane's own per-model default
from `~/.ccrc/models/<id>.effort.json` (materialised by `effortFile()`,
`shared/modelenv.mjs`, reloaded here by a single-slot `(path, mtime)` cache),
else nothing at all, and the provider's own default applies untouched.
`output_config` and `thinking` are popped unconditionally either way, so
neither field reaches LiteLLM's own order-dependent translation of them
(Task 8; design doc §6.2/§6.4). A broken effort file — absent, unreadable or
malformed — is ccrc's OWN config, not client input, so it falls through to
"no lane default" rather than refusing an otherwise-usable client request.

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
import functools
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
    data = _apply_effort(data)
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


# Effort resolution and its single-slot (path, mtime) cache (Task 8; design
# doc §6.2/§6.4). Claude Code sends `output_config: {"effort": "..."}` and
# `thinking: {"type": "adaptive"}` on EVERY request, under the
# `effort-2025-11-24` beta header. Measured against the installed LiteLLM
# (design doc §4.1): neither field is discarded by `drop_params` —
# `output_config.effort` is LIFTED into LiteLLM's own `reasoning_effort`, and
# `thinking` competes for that SAME key inside one LiteLLM key-iteration
# loop, order-dependently. This shim resolves the level itself, sets Codex's
# own `reasoning.effort` directly, and pops both client fields on every
# `/messages` request so nothing downstream reinterprets either one.
_EFFORT_CACHE = {"key": None, "map": {}}


def _effort_path() -> str:
    """`~/.ccrc/models/<id>.effort.json` for THIS lane — the same path
    `deploy/models-op.mjs`'s `effortPath` and the materialiser
    (`effortFile`, `shared/modelenv.mjs`) write, keyed by account id, never
    by model: one lane, one file, holding every model that lane can reach.
    `os.path.expanduser` resolves against the process's own `HOME` — the
    fixture HOME under test, never the real one, exactly like every other
    home-relative path this shim or its test harness touches."""
    return os.path.expanduser(os.path.join("~", ".ccrc", "models", f"{ACCOUNT_ID}.effort.json"))


def _lane_effort_map() -> dict:
    """This lane's per-model effort defaults — the `byModel` object
    `effortFile()` materialises, `{"<model>": "<level>", ...}` — reloaded by
    `(path, mtime)` in a SINGLE-SLOT cache (task-8-brief.md/task-8-
    rulings.md §1): one key, one value, sound because the materialiser
    writes tmp-then-rename and a rename always moves mtime, so this shim
    never sees a same-mtime content change in practice — the documented,
    accepted consequence of keying on mtime at all, pinned observably (not
    by an unfalsifiable "did not re-read" assertion) in
    `ccgpt-proxy.test.ts`'s case 4 by writing DIFFERENT bytes at the SAME
    mtime and asserting the OLD value still applies.

    `st_mtime_ns`, not `st_mtime` (task-8-rulings.md §2): an integer
    nanosecond count compares exactly, with no float-precision surprise
    across a rewrite the test harness pins with `fs.utimesSync`.

    A broken file must not break the lane (task-8-rulings.md §3): this is
    ccrc's OWN config, not client input — every refusal Task 7a built
    answers a client that sent something unusable, and refusing a perfectly
    good client request because *our* config is broken would break the lane
    for a fault the client cannot fix or even see. So:
      - ABSENT (`os.stat` raises `OSError`, typically `FileNotFoundError`) —
        no lane default at all; ordinary, not an error. Caught before the
        cache is even consulted, since there is no mtime to key on.
      - UNREADABLE or MALFORMED (`open`/`json.loads` raises `OSError` or a
        `json.JSONDecodeError`, a `ValueError` subclass) — also no lane
        default, for the identical reason. Deliberately NOT shaped like
        `_UnusableBody`/`_BadEncoding`: those answer a CLIENT body this shim
        cannot use; this is ccrc's own local file, and the client's request
        is examined and folded exactly as always regardless of what this
        function returns.
    Either way this function returns `{}`, `_apply_effort` finds nothing for
    the request's own model, and the provider default applies untouched.
    """
    path = _effort_path()
    try:
        mtime_ns = os.stat(path).st_mtime_ns
    except OSError:
        return {}
    key = (path, mtime_ns)
    if _EFFORT_CACHE["key"] == key:
        return _EFFORT_CACHE["map"]
    try:
        with open(path, "rb") as f:
            raw = f.read()
        parsed = json.loads(raw)
        by_model = parsed.get("byModel") if isinstance(parsed, dict) else None
        effort_map = by_model if isinstance(by_model, dict) else {}
    except (OSError, ValueError):
        effort_map = {}
    _EFFORT_CACHE["key"] = key
    _EFFORT_CACHE["map"] = effort_map
    return effort_map


def _apply_effort(data: dict) -> dict:
    """Resolve `reasoning.effort` and strip both client-side effort fields,
    IN PLACE, on an already-parsed `/messages` body. Called from
    `_rewrite_messages_body` alone, AFTER both system folds — task-8-
    rulings.md §4: this must run only where the folds already run, a POST
    body on a path ending `/messages`, and nowhere else, and it introduces
    no new "cannot use this body" condition of its own — nothing here
    raises.

    Precedence (task-8-brief.md, unchanged from production): an explicit
    client `output_config.effort` wins outright over the lane default; with
    none, `_lane_effort_map()`'s entry for THIS request's own `model`
    applies; with neither, nothing is set here and the provider's own
    default applies untouched.

    `output_config` and `thinking` are popped UNCONDITIONALLY — independent
    of whether either one actually carries a usable effort value at all
    (task-8-rulings.md §5): a body carrying `thinking` and no `output_config`
    whatsoever must still come out with `thinking` gone, so a mutation that
    stops stripping `thinking` cannot hide behind the effort path.

    Malformed client shapes (a non-dict `output_config`, a `model` that is
    not a string) are tolerated, never refused — this is the SAME body the
    two folds above already accepted; effort resolution adds no new refusal
    surface (task-8-rulings.md §4).
    """
    output_config = data.pop("output_config", None)
    data.pop("thinking", None)
    explicit = output_config.get("effort") if isinstance(output_config, dict) else None
    model = data.get("model")
    lane_default = _lane_effort_map().get(model) if isinstance(model, str) else None
    level = explicit or lane_default
    if level:
        data["reasoning"] = {"effort": level}
    return data


def _joined_header(headers, name: str) -> str:
    """Read a header RFC 7230 §3.2.2 permits a sender to spell EITHER as one
    comma-separated line or as several repeated lines carrying the same
    field name — `Transfer-Encoding` and `Content-Encoding`, this file's two
    callers, are both exactly this shape — by reading every occurrence via
    `email.message.Message.get_all` (7b fix round 1, M-3: corrects a garbled
    parenthetical the first draft of this docstring shipped with, that named
    `get_all` and `Content-Encoding` side by side with nothing saying what
    connected them) and joining them with a comma. `headers.get(name)` — what both
    `_is_chunked` and `_content_encoding` used before task-7b-rulings.md §1 —
    reads only the FIRST occurrence on an `http.client.HTTPMessage`; a
    request splitting `Transfer-Encoding: gzip, chunked` across two lines
    (`Transfer-Encoding: gzip` then `Transfer-Encoding: chunked`) would then
    answer `'gzip'` alone, `chunked` never seen, and reopen exactly the
    zero-bytes-forwarded hole Task 5 closed for the single-line spelling.
    Absent entirely, `get_all` returns `None`, not `[]` — the `or []` here
    keeps this function's own `''` contract for "not present" identical to
    the single-line read it replaces."""
    return ",".join(headers.get_all(name) or [])


def _is_chunked(headers) -> bool:
    """True iff the request declares `Transfer-Encoding: chunked` — checked
    against the LAST comma-separated token (RFC 7230 §3.3.1: chunked, when
    present, must be the final encoding applied), so a header naming another
    encoding ahead of it (e.g. `gzip, chunked`) is still recognised while a
    value that merely mentions the word elsewhere is not. The value read is
    every `Transfer-Encoding` LINE joined first (`_joined_header`,
    task-7b-rulings.md §1/I4) — the same last-token check applied to a
    header split across repeated lines, not only the single-line spelling
    it was written against, so the two cases (one line, several lines) are
    not two separate readings of this function's own contract.

    `False` here does NOT mean "read Content-Length instead" is always
    safe — `chunked` named but not last (`"chunked, gzip"`) also answers
    `False`, and that condition has its own dedicated refusal,
    `_chunked_named_but_not_final` below (task-7b-fix-rulings.md I-2), not
    a silent fallthrough. This function only ever decides whether to
    ACTUALLY DECODE chunked framing; it was never the place that decided
    whether an absent decode is safe to treat as "no framing at all"."""
    te = _joined_header(headers, "Transfer-Encoding")
    if not te:
        return False
    return te.strip().split(",")[-1].strip().lower() == "chunked"


def _chunked_named_but_not_final(headers) -> bool:
    """True iff `Transfer-Encoding` names `chunked` among its tokens but NOT
    as the final one — e.g. `"chunked, gzip"`, or `chunked`/`gzip` split
    across two separate header lines in that order. RFC 7230 §3.3.3 item 3:
    when chunked is present anywhere but is not the last encoding applied,
    the message's length cannot be determined by ANY means this shim
    implements, and a server receiving it MUST respond 400 (and close the
    connection, which every refusal in this file already does via
    `Connection: close`).

    Before this (task-7b-fix-rulings.md I-2; durable anchor for the class of
    hazard, not this specific spelling: spec §6.3, "the hazard is the
    silent arm, not the encoding" — 7b fix round 1, M-4), that condition
    fell through `_is_chunked` (`False`, correctly — `chunked` is not what
    this shim should decode AS chunked-framed) straight to the
    `Content-Length` branch below, which a request naming
    `Transfer-Encoding` at all is RFC-forbidden from also carrying reliably
    — measured, the shim forwards ZERO bytes, the exact silent-empty-body
    symptom this whole wave exists to kill, reached by a spelling
    `_is_chunked`'s own fix did not close (task-7b-review.md I-2:
    `"gzip, chunked"` split across lines, chunked LAST, was the hole task-7b
    closed; `"chunked, gzip"`, chunked NOT last, is this one — joining split
    lines made the split spelling agree with the single-line one, which was
    already wrong).

    Deliberately narrow, matching the over-refusal hazard every refusal in
    this file is written against: `Transfer-Encoding` ABSENT answers
    `False` (nothing to name `chunked` about — falls through to
    `Content-Length` exactly as always), and a `Transfer-Encoding` that
    never mentions `chunked` at all — `"gzip"` alone, say — also answers
    `False` and keeps falling through to `Content-Length` exactly as it
    does today. Refusing either of those would be refusing a request this
    shim already forwards correctly, which is the worse failure this
    project's own convention names explicitly."""
    te = _joined_header(headers, "Transfer-Encoding")
    if not te:
        return False
    tokens = [t.strip().lower() for t in te.split(",")]
    return "chunked" in tokens and tokens[-1] != "chunked"


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

    Both `readline()` calls below are bound at 65537 bytes (task-7b-
    rulings.md §2/I2), matching the exact figure
    `BaseHTTPRequestHandler.handle_one_request` already uses for its own
    request-line read: an unbounded `readline()` blocks the calling thread
    growing an ever-larger buffer for as long as the client keeps sending
    bytes with no CRLF in sight, a client-controlled memory/CPU hazard
    distinct from the stalled-with-no-bytes-at-all one that `_relay`'s
    scoped `settimeout(30)` around the body read guards against (7b fix
    round 1, I-1: that bound was a class-level `Handler.timeout` until it
    was found to bound the RESPONSE write too, and no such attribute
    exists now). A line this shim would ever legitimately need to
    read — a hex chunk-size plus a short `;`-extension, or one trailer
    header — is nowhere near that bound, so truncating there costs nothing
    real: it either still parses as a normal chunk-size/trailer, or it was
    already garbage and now fails the existing hex/format checks below
    instead of growing forever first.
    """
    chunks = []
    while True:
        size_line = rfile.readline(65537)
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
                trailer_line = rfile.readline(65537)
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
    `chunked` named but NOT last (`_chunked_named_but_not_final`, task-7b-
    fix-rulings.md I-2) is checked second and refused outright, for the
    same RFC 7230 §3.3.3 item 3 reason: that shape's length is undeterminable
    by any means this shim implements, and forwarding it via `Content-Length`
    (which a `Transfer-Encoding`-bearing request is RFC-forbidden from also
    carrying reliably) is the silent-empty-body hazard measured in
    task-7b-review.md I-2. Otherwise this is the original `Content-Length`-
    only read, unchanged.

    Can raise `ValueError` from any of its THREE raisers (task-7b-fix-
    rulings.md I-2 adds the second; task 7a's own fix round 1, M-1 — the
    docstring here used to name only the first, then only two):
    `_read_chunked_body` on malformed or truncated chunk framing,
    `_chunked_named_but_not_final` on `chunked` present but not final, and
    the `int()` parse below on a `Content-Length` that is not a valid
    integer (e.g. `Content-Length: abc`). `_relay` catches it at this
    function's own call site and answers an explicit HTTP 400, for every
    path (see `_read_chunked_body`'s docstring). The `int()` failure is
    wrapped with a `ccgpt-proxy:`-prefixed message so it matches every
    other refusal in the file — a bare `ValueError` from a stdlib call is
    otherwise the one refusal message in the file that would not name the
    shim.
    """
    if _is_chunked(headers):
        return _read_chunked_body(rfile)
    if _chunked_named_but_not_final(headers):
        raise ValueError(
            "ccgpt-proxy: Transfer-Encoding names chunked but not as the final "
            f"encoding, so the body length cannot be determined: {_joined_header(headers, 'Transfer-Encoding')!r}"
        )
    try:
        length = int(headers.get("Content-Length") or 0)
    except ValueError as e:
        raise ValueError(f"ccgpt-proxy: invalid Content-Length: {e}") from None
    return rfile.read(length) if length else b""


def _content_encoding(headers) -> str:
    """The request's `Content-Encoding`, lower-cased and stripped — `''`
    when absent. Case-insensitive header lookup (`.lower()`, task-7b-
    rulings.md §3/M9 — content-coding values are case-insensitive per
    RFC 7231's Content-Coding section), the same contract `_is_chunked`
    above relies on for `Transfer-Encoding` — and, like it, every LINE
    named `Content-Encoding`
    is joined first (`_joined_header`, task-7b-rulings.md §1/I4), not only
    the first one `headers.get` alone would see, for the same reason: RFC
    7230 §3.2.2 permits a comma-list header to be split across repeated
    lines, and reading only the first would silently lose whatever a later
    line named.

    `_relay` treats the result three ways (task-7a-rulings.md §3; spec
    §6.3's "an encoding the shim cannot decode is answered with an
    explicit error" is the durable version): absent
    (`''`) or `identity` means no encoding at all — folded and forwarded
    like any other unencoded body. `gzip`/`deflate` — this shim's only two
    implemented codecs, `_CODECS` below — are decoded, folded, and
    re-encoded. Anything else, INCLUDING the list/trailing-comma forms
    `"gzip, br"` and `"gzip,"` (neither equals the bare token `"gzip"`, so
    neither ever reaches the decode branch) and a value split across
    repeated lines that does not join back into a bare recognised token
    (e.g. `"identity"` then `"gzip"` — two real lines joining to
    `"identity,gzip"`, not `"gzip"`), is refused outright with an HTTP 415
    naming the encoding rather than forwarded unexamined — the D-3151 arm-1
    hole both shapes used to fall into.
    """
    return _joined_header(headers, "Content-Encoding").strip().lower()


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
#
# gzip's entry is a `functools.partial`, not a bare function reference like
# every other slot here (task-7b-rulings.md §5/M6-minor, addendum §2 —
# judged deliberately, not a default): `gzip.compress` embeds the current
# wall-clock time in its container header, so two calls on IDENTICAL bytes a
# second apart produce different output (measured: `c550b16a` vs
# `c650b16a`). Harmless to the upstream, which never inspects it, but this
# shim's OWN re-encoded output is then not byte-for-byte reproducible run to
# run — worth pinning in something whose whole job is to be legible on the
# wire, and cheap enough (`mtime=0`) that the one-slot asymmetry it costs
# this otherwise-uniform mapping is a fair trade. `zlib.compress` (deflate)
# carries no such field, so it stays a bare reference; widening
# `compresslevel` off its default was considered and rejected — it buys
# nothing here and only adds a second knob to this same judgment call.
_CODECS = {
    "gzip": (gzip.decompress, functools.partial(gzip.compress, mtime=0)),
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
        return body  # unreachable: the sole call site (_relay) only invokes this inside `if encoding in _CODECS`
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
        return body  # unreachable: same pre-filtered call site as _decode_body's tail above
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
        # I2 (task-7b-rulings.md §2) / 7b fix round 1, I-1 (task-7b-fix-
        # rulings.md) — durable anchor: D-3155,
        # docs/superpowers/plans/2026-09-21-gpt-lane-ownership-2a-request-path.md,
        # which already names "the handler gains a socket timeout there"
        # while holding the two chunk/decompress SIZE caps open (7b fix
        # round 1, M-4: cited alongside the scratch rulings/review this
        # round, not only them). Bounds ONLY the request-BODY read below,
        # not the whole connection. The first shape of this guard was a class-level
        # `Handler.timeout`, which `socketserver.StreamRequestHandler.setup`
        # applies to the client socket for the WHOLE connection — reads
        # AND the response write together — and the review measured what
        # that costs: a genuinely wedged reader (draining below ~0.3 KB/s,
        # once kernel send buffers fill) got its RESPONSE silently
        # truncated by the same bound, undetectably at both ends. Neither
        # `Content-Length` nor `Transfer-Encoding` survives `HOP_BY_HOP`
        # below, so the response body is delimited by connection close —
        # a short body then looks exactly like a complete one — and
        # `log_message` is `pass`, so nothing prints either (measured:
        # 1,982,645 of 134,217,909 expected bytes delivered, `hadError=
        # false`, empty stderr). Scoped here instead — 30s armed only while
        # `_read_request_body` is actually blocked reading from the client,
        # disarmed the instant it returns, in EITHER outcome, before any
        # response (including this method's own `_refuse` calls) is
        # written — bounds the ORIGINAL I2 hazard exactly (30s with no
        # request bytes arriving at all) and leaves the response leg, and
        # the initial request-line/header read `handle_one_request` does
        # before this method is ever called, exactly as unbounded as they
        # were before any of this task's work.
        #
        # An unset timeout is not "reaped by TCP keepalive, on the order of
        # hours" (7b fix round 1, M-1 — corrects an error in task-7b-
        # rulings.md §2 that this comment's own first draft carried forward
        # verbatim): measured, `SO_KEEPALIVE` on the accepted client socket
        # is 0 — `socketserver` never sets it — so nothing reaps a
        # half-open connection at all; without this guard the thread hangs
        # indefinitely, which makes the guard MORE valuable than that
        # sentence argued, not less.
        #
        # No `handle_timeout` override is added alongside this (measured
        # against this box's own `/usr/lib/python3.12/socketserver.py`
        # before writing this, not assumed, and independently re-verified
        # by 7b's review): that hook is defined on `socketserver.
        # BaseServer`, called ONLY from `handle_request()`, which
        # `serve_forever()` (what `__main__` below runs) never calls —
        # `_handle_request_noblock()` is called instead, and its own
        # docstring says it "Ignores self.timeout." A blocking
        # `rfile.read()`/`rfile.readline()` inside `_read_request_body`
        # raises `TimeoutError` once `settimeout` below fires; that
        # propagates up through this method (uncaught here — only
        # `ValueError` is caught below) to `BaseHTTPRequestHandler.
        # handle_one_request`'s own `except TimeoutError` clause (stdlib,
        # unmodified), which sets `self.close_connection = True` and
        # returns — the connection closes in `finish()` exactly as a
        # dropped connection already does for every other transport-level
        # failure in this file, with no second mechanism needed here.
        # `handle_one_request` calls `self.log_error(...)` on that path,
        # but it prints nothing (7b fix round 1, M-2 — the first draft of
        # this comment said "logs it"): `log_error` calls `self.
        # log_message`, overridden to `pass` above, deliberately, for a
        # shim in a hot path — every timeout on this shim is silent, which
        # is the operational half of the response-truncation hazard this
        # scoping fixes.
        #
        # 30s: comfortably above any real transfer time on loopback (this
        # shim's only client) for even a large conversation body — the
        # review measured a 10 MB chunked body arriving complete over 40s
        # of deliberately-paced wall clock without tripping this bound at
        # all, confirming the rule is "30s with NO bytes arriving", not "30s
        # to finish the upload" — and nowhere near the unrelated 900s
        # `urlopen` timeout on the UPSTREAM leg in this same method, below,
        # which bounds a completely different wait (Codex's own response
        # latency, not this shim's client-facing socket).
        #
        # DELIBERATELY UNPINNED (task-7b-rulings.md, "Mutations required"
        # §7; reaffirmed for the narrower scope by task-7b-fix-rulings.md's
        # own mutation 1): measured, removing either `settimeout` call
        # below leaves the full suite green. A case that proves the read
        # leg's hang is bounded, or that the response leg is no longer
        # bound by it, needs an actual wedged socket and real wall-clock —
        # judged not worth the suite's runtime for either; this comment and
        # the manual verification in the task-7b report(s) are the record.
        self.connection.settimeout(30)
        try:
            body = _read_request_body(self.headers, self.rfile)
        except ValueError as e:
            self.connection.settimeout(None)
            # Task 7a, §4: malformed/truncated chunked framing, a
            # non-numeric Content-Length (task 7a's own fix round 1, M-1),
            # or (7b fix round 1, I-2) chunked named but not the final
            # Transfer-Encoding — all three raised by `_read_request_body`,
            # not only the chunked-framing one. The transport itself, not
            # the parsed content, is what's wrong — there is no complete
            # byte string to examine at all, so this is refused for EVERY
            # path, not only `/messages` (the deliberate exception to the
            # non-`/messages` passthrough guarantee below: framing that
            # cannot be parsed cannot be forwarded anywhere, because there
            # is no body to relay).
            self._refuse(400, str(e))
            return
        self.connection.settimeout(None)
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

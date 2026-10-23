"""codexbridge.reducer — the upstream Responses event stream becomes Anthropic block events, a stop reason and usage.

Codex-bridge spec 2026-10-15 §2.4 ("The reducer builds each Anthropic block only from the upstream's **finished**
items"); plan 2026-10-22, Task 3 and "The bridge's contract": the commit point (R17), the stop reasons (R13), the
usage rule (R15), D-6410 (`end_turn:false` is continued, never `pause_turn`) and D-6416 (a cache write is reported as
cache creation). The Codex CLI builds its items the same way, from `response.output_item.done` alone (upstream
openai/codex @ 092d3ac: codex-rs/codex-api/src/sse/responses.rs:353-358).

THE RULES (each is a case or a mutation row in codex-bridge-replay.test.ts):
- R2  blocks are strictly nested and contiguous, one open at a time, with LOCAL indexes 0, 1, 2…
- R3  a stream ends in one terminal; an open live block gets its `content_block_stop` before a failure is reported.
- R4  blocks come only from `response.output_item.done`: argument deltas, `.done` events, `content_part.*` and
      reasoning deltas are ignored. The one exception is R14's live text.
- R5  `response.completed.output` (and `.incomplete.output`) fills an item that never got a done event, matched by
      position, with a warning; an item there whose status is set and is not `completed` is skipped, except a
      MESSAGE already streaming live at that position (R9 closes its block); a call there is skipped like any other.
- R6  items are released in `output_index` order; a gap holds the later items until the terminal.
- R7  a repeated `output_index` is dropped.
- R8  `function_call` -> `tool_use{id: call_id, name: name_map.get(n, n), input: {}}` and ONE `input_json_delta`
      carrying the arguments verbatim when they parse as a JSON object; `''`, invalid JSON or a non-object is `{}`,
      counted `invalidArguments` (the raw text is never counted or kept); an emitted `{}` for a tool in
      `tools_required` is counted `emptyArguments`. `custom_tool_call` -> `{"input": <raw>}`.
- R9  an `incomplete` item not yet released (a call, a message never streamed live) is skipped with a warning; a
      message already streaming live keeps its block, closed with what was sent, and that text is what is keyed.
- R10 a message's consecutive `output_text` parts merge into one text block; a `refusal` part is a text block of its
      own and sets the refusal flag; an empty text gives no block; the `phase` is kept (`phases`), and the whole item
      is kept in `output_items`.
- R11 a reasoning item with `encrypted_content` is recorded (`reasoning`) with the first call or message released
      after it, never emitted as a block; one without it is counted and not recorded.
- R12 an unmapped item (`web_search_call`, `image_generation_call`, `compaction`, unknown) is skipped and its type
      counted `itemType:<type>`; an unknown event type is counted `eventType:<type>`.
- R14 live text: an `output_text.delta` of the item at the release cursor is forwarded as a `text_delta` at once
      (content part 0 only, an absent `content_index` read as 0: a later part is sent at the done event, as a
      suffix when R10 merges it, else as a block of its own, so a message whose first part is a refusal is never
      live); at the item's done event a missing suffix is sent; a text that does not extend what was sent is
      counted `liveTextMismatch` and nothing is re-sent, and so is a finished item at the live index that is not a
      message (the live block is closed before it is released, keeping R2). The text keyed and recorded is always
      the text EMITTED, which is what Claude Code sends back, so `emitted_text` is keyed by the output_index whose
      text was sent: a live block closed that way keeps its entry under an index that finished as a call or as
      reasoning (Claude Code still sends that text back).
- R15 usage comes from the terminal event's `usage` (`anthropic_usage`).
- R16 `response.failed` and a top-level `error` event are classified by `errors.classify_failed`; blocks already
      released stay, and nothing held is released after a failure.
- R17 `committable` is true once a block was released or a NON-failure terminal was seen.
- R19 the `tool_use` id is the upstream `call_id`, never the item `id`.

NOTHING HERE HOLDS CONTENT IN A COUNT OR A NAME. Names go to the NameSink by family (`itemType`, `eventType`,
`incompleteReason`); counts are integers; warnings name what was wrong, never a value. Encrypted reasoning leaves this
module only through `reasoning` and `output_items` (for the reasoning store and a continuation), never in a block.
"""

import json
import time
from typing import Dict, FrozenSet, List, NamedTuple, Optional, Tuple

from . import NameSink, errors, sse

WARNINGS_MAX = 64  # warnings past this many are counted in the last one, never kept

# The incomplete reasons the stop-reason table maps (R13); any other is an `api_error` failure.
INCOMPLETE_STOP = {"max_output_tokens": "max_tokens", "content_filter": "refusal"}
INCOMPLETE_CONTINUE = frozenset({"interrupted"})
KNOWN_INCOMPLETE = frozenset(INCOMPLETE_STOP) | INCOMPLETE_CONTINUE

# The item types that become blocks or reasoning records; every other finished item is R12's.
TOOL_ITEMS = frozenset({"function_call", "custom_tool_call"})

# The event types read for nothing (R4): known, so never counted as drift.
IGNORED_EVENTS = frozenset({
    "response.in_progress", "response.queued",
    "response.content_part.added", "response.content_part.done",
    "response.output_text.done", "response.output_text.annotation.added",
    "response.refusal.delta", "response.refusal.done",
    "response.function_call_arguments.delta", "response.function_call_arguments.done",
    "response.custom_tool_call_input.delta", "response.custom_tool_call_input.done",
    "response.reasoning_summary_part.added", "response.reasoning_summary_part.done",
    "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done",
    "response.reasoning_text.delta", "response.reasoning_text.done",
})

W_REPEAT = "a repeated output_index was dropped"
W_FILLED = "an item was filled from the final output"
W_UNFINISHED = "an unfinished item was skipped"
W_NO_CALL_ID = "a tool call with no call_id was skipped"
W_NOT_OBJECT = "a finished item that is not an object was skipped"

UNREADABLE_REASONING = "reasoning-without-encrypted-content"


class Usage(NamedTuple):
    input: int
    cached: int
    cache_write: int
    output: int


ZERO_USAGE = Usage(0, 0, 0, 0)


def anthropic_usage(u: Usage) -> dict:
    """The contract's rule (R15, D-6416): the three input fields Claude Code sums equal the upstream `input_tokens`."""
    return {
        "input_tokens": max(0, u.input - u.cached - u.cache_write),
        "cache_read_input_tokens": u.cached,
        "cache_creation_input_tokens": u.cache_write,
        "output_tokens": u.output,
    }


class Terminal(NamedTuple):
    kind: str  # "completed" | "incomplete" | "failed" | "truncated"
    reason: Optional[str]  # an incomplete reason, bounded
    error: Optional[errors.BridgeError]  # set for every failure: failed, truncated, an unknown incomplete reason
    usage: Usage
    end_turn: Optional[bool]


def _count(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return 0
    return value


def _usage(response: object) -> Usage:
    u = response.get("usage") if isinstance(response, dict) else None
    if not isinstance(u, dict):
        return ZERO_USAGE
    details = u.get("input_tokens_details")
    details = details if isinstance(details, dict) else {}
    return Usage(_count(u.get("input_tokens")), _count(details.get("cached_tokens")),
                 _count(details.get("cache_write_tokens")), _count(u.get("output_tokens")))


def _bounded(value: object) -> str:
    """A reason as a message or a name may carry it: lower-cased under errors.CODE_RE, else `unrecognised`."""
    if not isinstance(value, str) or not value:
        return "none"
    lowered = value.lower()
    return lowered if errors.CODE_RE.fullmatch(lowered) else errors.UNRECOGNISED_CODE


def _reject_constant(name: str) -> object:
    raise ValueError("not JSON: " + name)


def _json_object(raw: object) -> Optional[dict]:
    """`raw` parsed as a JSON object, else None. NaN and Infinity are not JSON, though Python's parser takes them."""
    if not isinstance(raw, str):
        return None
    try:
        parsed = json.loads(raw, parse_constant=_reject_constant)
    except (ValueError, RecursionError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _index(value: object) -> Optional[int]:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


class Reducer:
    """One upstream response, event by event. Feed every parsed event; drain `release()` after each feed and write
    what it returns; stop reading upstream the moment `terminal` is set; call `finish()` at EOF or then."""

    def __init__(self, *, name_map: Dict[str, str], names: NameSink, tools_required: FrozenSet[str] = frozenset(),
                 live_text: bool = True) -> None:
        self.name_map = dict(name_map)
        self.names = names
        self.tools_required = frozenset(tools_required)
        self.live_text = live_text
        self.terminal = None  # type: Optional[Terminal]
        self.emitted_tool_use = False
        self.refusal = False
        self.emitted_text = {}  # type: Dict[int, str]
        self.phases = {}  # type: Dict[str, str]
        self.response_id = None  # type: Optional[str]
        self.counts = {"emptyArguments": 0, "invalidArguments": 0, "liveTextMismatch": 0}  # type: Dict[str, int]
        self.warnings = []  # type: List[str]
        self._out = []  # type: List[Tuple[str, dict]]
        self._blocks = 0  # the next local block index
        self._released_any = False
        self._cursor = 0  # every output_index below it is released or skipped
        self._held = {}  # type: Dict[int, dict]  (finished items waiting for the cursor)
        self._seen = set()  # type: set  (every output_index that got a finished item)
        self._finished = {}  # type: Dict[int, dict]
        self._added = {}  # type: Dict[str, int]  (item id -> output_index, from output_item.added)
        self._live = None  # type: Optional[dict]  ({"oi", "block", "sent"})
        self._reasoning = []  # type: List[list]  ([item, key])
        self._unkeyed = []  # type: List[int]  (indexes into _reasoning still waiting for their key)

    # ── what the server reads ──
    @property
    def committable(self) -> bool:
        return self._released_any or (self.terminal is not None and self.terminal.error is None)

    @property
    def reasoning(self) -> List[Tuple[dict, Optional[Tuple[str, str]]]]:
        return [(item, key) for item, key in self._reasoning]

    @property
    def output_items(self) -> List[dict]:
        return [self._finished[k] for k in sorted(self._finished)]

    def release(self) -> List[Tuple[str, dict]]:
        out, self._out = self._out, []
        return out

    def finish(self) -> Terminal:
        if self.terminal is None:
            self._fail(errors.unavailable("the stream closed before a terminal event"), None, "truncated", None)
        return self.terminal

    # ── the feed ──
    def feed(self, ev: sse.SseEvent) -> None:
        if self.terminal is not None:  # nothing after the terminal event is read
            return
        d, etype = ev.data, ev.type
        if d is None or etype is None:  # a malformed event: the parser already warned
            return
        if etype == "response.created":
            resp = d.get("response")
            rid = resp.get("id") if isinstance(resp, dict) else None
            if isinstance(rid, str):
                self.response_id = rid
        elif etype == "response.output_item.added":
            item = d.get("item")
            oi = _index(d.get("output_index"))
            if isinstance(item, dict) and isinstance(item.get("id"), str) and oi is not None:
                self._added[item["id"]] = oi
        elif etype == "response.output_text.delta":
            self._live_delta(d)
        elif etype == "response.output_item.done":
            self._done(d)
        elif etype in ("response.completed", "response.incomplete"):
            self._end(etype[len("response."):], d.get("response"))
        elif etype == "response.failed":
            resp = d.get("response")
            err = resp.get("error") if isinstance(resp, dict) else None
            self._fail(errors.classify_failed(err if isinstance(err, dict) else None, now=time.time()), resp,
                       "failed", None)
        elif etype == "error":
            self._fail(errors.classify_failed(d, now=time.time()), None, "failed", None)
        elif etype not in IGNORED_EVENTS:
            self.names.name("eventType", etype)

    # ── blocks ──
    def _emit(self, name: str, data: dict) -> None:
        self._out.append((name, data))

    def _open(self, block: dict) -> int:
        idx = self._blocks
        self._blocks += 1
        self._released_any = True
        self._emit("content_block_start", {"type": "content_block_start", "index": idx, "content_block": block})
        return idx

    def _delta(self, idx: int, delta: dict) -> None:
        self._emit("content_block_delta", {"type": "content_block_delta", "index": idx, "delta": delta})

    def _stop(self, idx: int) -> None:
        self._emit("content_block_stop", {"type": "content_block_stop", "index": idx})

    def _text_block(self, text: str) -> None:
        idx = self._open({"type": "text", "text": ""})
        self._delta(idx, {"type": "text_delta", "text": text})
        self._stop(idx)

    def _warn(self, what: str) -> None:
        if len(self.warnings) < WARNINGS_MAX:
            self.warnings.append(what)
        elif len(self.warnings) == WARNINGS_MAX:
            self.warnings.append("further warnings dropped")

    def _key(self, key: Tuple[str, str]) -> None:
        """R11: every reasoning item recorded since the last release is keyed by this call or message."""
        for i in self._unkeyed:
            self._reasoning[i][1] = key
        self._unkeyed = []

    # ── live text (R14) ──
    def _live_delta(self, d: dict) -> None:
        if not self.live_text:
            return
        oi = _index(d.get("output_index"))
        if oi is None and isinstance(d.get("item_id"), str):
            oi = self._added.get(d["item_id"])
        if oi is None or oi != self._cursor or oi in self._seen:
            return
        delta = d.get("delta")
        if not isinstance(delta, str) or not delta:
            return
        if _index(d.get("content_index", 0)) != 0:  # a later part: sent at the done event, as a suffix or a block
            return
        if self._live is None:
            self._live = {"oi": oi, "block": self._open({"type": "text", "text": ""}), "sent": ""}
        self._delta(self._live["block"], {"type": "text_delta", "text": delta})
        self._live["sent"] += delta

    def _close_live(self, item: Optional[dict]) -> Optional[str]:
        """Close the live block, keyed and recorded by what was sent; None when no block is live."""
        live, self._live = self._live, None
        if live is None:
            return None
        self._stop(live["block"])
        self.emitted_text[live["oi"]] = live["sent"]
        self._key(("text", live["sent"]))
        phase = item.get("phase") if isinstance(item, dict) else None
        if isinstance(phase, str) and phase:
            self.phases[live["sent"]] = phase
        return live["sent"]

    # ── finished items ──
    def _done(self, d: dict) -> None:
        item = d.get("item")
        if not isinstance(item, dict):
            self._warn(W_NOT_OBJECT)
            return
        oi = _index(d.get("output_index"))
        if oi is None and isinstance(item.get("id"), str):
            oi = self._added.get(item["id"])
        if oi is None:
            oi = max(max(self._seen) + 1 if self._seen else 0, self._cursor)
        if oi in self._seen or oi < self._cursor:  # R7
            self._warn(W_REPEAT)
            return
        self._seen.add(oi)
        self._finished[oi] = item
        self._held[oi] = item
        while self._cursor in self._held:  # R6
            self._release(self._cursor, self._held.pop(self._cursor))
            self._cursor += 1

    def _release(self, oi: int, item: dict) -> None:
        kind = item.get("type")
        if kind != "message" and self._live is not None and self._live["oi"] == oi:  # R14, R2: not the live message
            self.counts["liveTextMismatch"] += 1
            self._close_live(None)
        if kind == "message":
            self._message(oi, item)
        elif kind in TOOL_ITEMS:
            self._tool(item)
        elif kind == "reasoning":
            enc = item.get("encrypted_content")
            if isinstance(enc, str) and enc:
                self._unkeyed.append(len(self._reasoning))
                self._reasoning.append([item, None])
            else:
                self.names.name("itemType", UNREADABLE_REASONING)
        else:  # R12
            self.names.name("itemType", kind if isinstance(kind, str) and kind else "untyped")

    def _message(self, oi: int, item: dict) -> None:
        groups = []  # type: List[list]  ([is_refusal, text])
        content = item.get("content")
        for part in content if isinstance(content, list) else []:
            if not isinstance(part, dict):
                continue
            ptype = part.get("type")
            if ptype == "output_text" and isinstance(part.get("text"), str):
                if groups and not groups[-1][0]:
                    groups[-1][1] += part["text"]
                else:
                    groups.append([False, part["text"]])
            elif ptype == "refusal" and isinstance(part.get("refusal"), str):
                groups.append([True, part["refusal"]])
        groups = [g for g in groups if g[1]]
        incomplete = item.get("status") == "incomplete"
        live = self._live is not None and self._live["oi"] == oi
        if incomplete and not live:  # R9
            self._warn(W_UNFINISHED)
            return
        texts = []  # type: List[str]
        if live:
            sent = self._live["sent"]
            if incomplete:  # R9: closed with what was sent, and nothing more of it
                groups = []
            elif groups and not groups[0][0] and groups[0][1].startswith(sent):
                suffix = groups.pop(0)[1][len(sent):]
                if suffix:
                    self._delta(self._live["block"], {"type": "text_delta", "text": suffix})
                    self._live["sent"] += suffix
            else:
                self.counts["liveTextMismatch"] += 1
                if groups and not groups[0][0]:
                    groups.pop(0)
            texts.append(self._close_live(item))
        for is_refusal, text in groups:
            if not texts:
                self.emitted_text[oi] = text
                self._key(("text", text))
            self._text_block(text)
            if is_refusal:
                self.refusal = True
            texts.append(text)
        phase = item.get("phase")
        if isinstance(phase, str) and phase:
            for text in texts:
                self.phases[text] = phase

    def _tool(self, item: dict) -> None:
        if item.get("status") == "incomplete":  # R9
            self._warn(W_UNFINISHED)
            return
        call_id = item.get("call_id")
        if not isinstance(call_id, str) or not call_id:
            self._warn(W_NO_CALL_ID)
            return
        upstream = item.get("name")
        upstream = upstream if isinstance(upstream, str) else ""
        if item.get("type") == "custom_tool_call":
            raw = item.get("input")
            partial = json.dumps({"input": raw if isinstance(raw, str) else ""}, ensure_ascii=False,
                                 separators=(",", ":"))
            empty = False
        else:
            raw = item.get("arguments")
            obj = _json_object(raw)
            if obj is None:
                self.counts["invalidArguments"] += 1
                partial, obj = "{}", {}
            else:
                partial = raw
            empty = not obj
        if empty and upstream in self.tools_required:
            self.counts["emptyArguments"] += 1
        idx = self._open({"type": "tool_use", "id": call_id, "name": self.name_map.get(upstream, upstream),
                          "input": {}})
        self._delta(idx, {"type": "input_json_delta", "partial_json": partial})
        self._stop(idx)
        self.emitted_tool_use = True
        self._key(("call", call_id))

    # ── terminals ──
    def _end(self, kind: str, response: object) -> None:
        resp = response if isinstance(response, dict) else {}
        reason = None  # type: Optional[str]
        if kind == "incomplete":
            details = resp.get("incomplete_details")
            reason = _bounded(details.get("reason") if isinstance(details, dict) else None)
            self.names.name("incompleteReason", reason)
            if reason not in KNOWN_INCOMPLETE:
                self._fail(errors.unavailable("an incomplete response: " + reason), resp, kind, reason)
                return
        output = resp.get("output")
        for pos, it in enumerate(output if isinstance(output, list) else []):  # R5
            if pos in self._seen or pos < self._cursor or not isinstance(it, dict):
                continue
            status = it.get("status")
            live = it.get("type") == "message" and self._live is not None and self._live["oi"] == pos
            if status not in (None, "completed") and not live:  # R9's live message only, never a call
                self._warn(W_UNFINISHED)
                continue
            self._warn(W_FILLED)
            self._seen.add(pos)
            self._finished[pos] = it
            self._held[pos] = it
        for oi in sorted(self._held):  # R6: the terminal releases every held item, past any gap
            if self._live is not None and self._live["oi"] != oi:
                self._close_live(None)
            self._cursor = oi
            self._release(oi, self._held.pop(oi))
        self._cursor += 1
        self._close_live(None)
        end_turn = resp.get("end_turn")
        self.terminal = Terminal(kind, reason, None, _usage(resp), end_turn if isinstance(end_turn, bool) else None)

    def _fail(self, err: errors.BridgeError, response: object, kind: str, reason: Optional[str]) -> None:
        self._close_live(None)  # R3: the open block is closed before the failure is reported
        self._held = {}
        self.terminal = Terminal(kind, reason, err, _usage(response), None)


def stop_reason(t: Terminal, emitted_tool_use: bool, refusal: bool) -> Optional[str]:
    """R13, the contract's table. None means "continue" (D-6410: never `pause_turn`). A failed terminal has no stop
    reason: its error is the answer, so asking for one is a programming error (ValueError)."""
    if t.error is not None:
        raise ValueError("stop_reason: a failed terminal has no stop reason")
    if emitted_tool_use:
        return "tool_use"
    if refusal:
        return "refusal"
    if t.kind == "incomplete":
        if t.reason in INCOMPLETE_STOP:
            return INCOMPLETE_STOP[t.reason]
        if t.reason in INCOMPLETE_CONTINUE:
            return None
    if t.end_turn is False:
        return None
    return "end_turn"


def needs_continuation(t: Terminal, emitted_tool_use: bool, *, refusal: bool) -> bool:
    """True when a non-failed reply asks to be continued (`end_turn:false`, or `interrupted`) and emitted no
    `tool_use`, exactly when `stop_reason` answers None. The refusal flag wins as it does there, and it is REQUIRED
    (keyword-only, no default): a caller that leaves it out gets a TypeError, never a refused `end_turn:false` reply
    continued upstream. The server passes the reducer's `refusal`."""
    return t.error is None and stop_reason(t, emitted_tool_use, refusal) is None

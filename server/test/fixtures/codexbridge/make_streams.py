"""make_streams.py — writes the reducer's replay corpus: `streams/<name>.sse` and `streams/expect.json`.

Codex-bridge Stage 2 plan 2026-10-22, Task 3 (spec 2026-10-15 §2.4 and §5). Run as `python3 -I make_streams.py
[<out dir>]` (default: `streams/` beside this file). The output is deterministic, and
`codex-bridge-replay.test.ts` checks that the committed files are exactly what this writes, so a stream or an
expectation is changed here, never by hand.

THE CORPUS. 32 streams ported from the throwaway prototype (8 rebuilt from shapes in this repository: the runtime
probe's scripted streams in `ccd/ccgpt-runtime` and the patch driver's in `server/test/ccgpt-runtime.test.ts`; 24
synthetic until the operator's scrubbed recordings replace them, D-6430), then 16 `synth2-` streams: the second guard
for each rule the prototype guarded once, and the spec §5 reducer list. Every stream is synthetic: tiny texts, ids of
the form `<prefix>_fx<n>`, encrypted content `ENC-<n>`, neutral tool names.

THE EXPECTATIONS are written here by hand, never computed by the reducer: per stream, `setup` (the reducer's
`name_map` and `tools_required`), the folded `blocks` (`{type: "text", text}` or `{type: "tool_use", id, name, input,
json}`, `json` being the concatenated `partial_json`), `stop` and `continue` (for a non-failure terminal) or `error`
(`{type, status, message}`), the Anthropic `usage`, the `reasoning` keys (one per recorded reasoning item: `["call",
<call_id>]`, `["text", <emitted text>]` or null), `counted` (`names` in report order, nonzero `counts`),
`committable`, `phases` and the reducer's `warnings`. Standard library only.
"""

import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# The reducer's warnings, spelled as the reducer spells them (codex-bridge-replay.test.ts compares them).
W_REPEAT = "a repeated output_index was dropped"
W_FILLED = "an item was filled from the final output"
W_UNFINISHED = "an unfinished item was skipped"

ARGS = (json.dumps({"q": "one"}), json.dumps({"q": "two"}))  # the runtime probe's two arguments, as it spells them


class Stream:
    """One upstream stream, built event by event; `sse()` is its bytes."""

    def __init__(self, crlf=False):
        self.parts = []
        self.seq = 0
        self.nl = "\r\n" if crlf else "\n"

    def add(self, etype, **fields):
        data = {"type": etype}
        data.update(fields)
        data["sequence_number"] = self.seq
        self.seq += 1
        self.parts.append("event: " + etype + self.nl + "data: " + json.dumps(data, ensure_ascii=False,
                                                                              separators=(",", ":"))
                          + self.nl + self.nl)
        return self

    def raw(self, text):
        self.parts.append(text)
        return self

    def sse(self):
        return "".join(self.parts).encode("utf-8")

    # ── the shared shapes ──
    def created(self):
        return self.add("response.created", response={"id": "resp_fx1", "object": "response", "status": "in_progress",
                                                      "output": []})

    def added(self, n, item):
        return self.add("response.output_item.added", output_index=n, item=item)

    def done(self, n, item):
        return self.add("response.output_item.done", output_index=n, item=item)

    def text_delta(self, n, delta, item_id=None, content_index=0):
        return self.add("response.output_text.delta", item_id=item_id or ("msg_fx%d" % n), output_index=n,
                        content_index=content_index, delta=delta)

    def completed(self, output, usage=None, end_turn=None):
        response = {"id": "resp_fx1", "object": "response", "status": "completed", "output": output}
        if usage is not None:
            response["usage"] = usage
        if end_turn is not None:
            response["end_turn"] = end_turn
        return self.add("response.completed", response=response)

    def incomplete(self, reason, output, usage=None):
        response = {"id": "resp_fx1", "object": "response", "status": "incomplete",
                    "incomplete_details": {"reason": reason}, "output": output}
        if usage is not None:
            response["usage"] = usage
        return self.add("response.incomplete", response=response)

    def failed(self, code, message="the request failed"):
        return self.add("response.failed", response={"id": "resp_fx1", "object": "response", "status": "failed",
                                                     "error": {"code": code, "message": message}, "output": []})


# ── the items ──
def fc(n, args, name="probe_tool", status="completed"):
    return {"type": "function_call", "id": "fc_fx%d" % n, "call_id": "call_fx%d" % n, "name": name,
            "arguments": args, "status": status}


def ctc(n, raw, name="probe_custom", status="completed"):
    return {"type": "custom_tool_call", "id": "ctc_fx%d" % n, "call_id": "call_fx%d" % n, "name": name,
            "input": raw, "status": status}


def out_text(text):
    return {"type": "output_text", "text": text, "annotations": []}


def refusal_part(text):
    return {"type": "refusal", "refusal": text}


def msg(n, parts, status="completed", phase=None):
    item = {"type": "message", "id": "msg_fx%d" % n, "role": "assistant", "status": status, "content": parts}
    if phase is not None:
        item["phase"] = phase
    return item


def say(n, text, **kw):
    return msg(n, [out_text(text)], **kw)


def rs(n, encrypted=True, summary=None):
    item = {"type": "reasoning", "id": "rs_fx%d" % n, "summary": summary or []}
    if encrypted:
        item["encrypted_content"] = "ENC-%d" % n
    return item


def usage(inp, out, cached=None, cache_write=None):
    u = {"input_tokens": inp, "output_tokens": out, "total_tokens": inp + out}
    details = {}
    if cached is not None:
        details["cached_tokens"] = cached
    if cache_write is not None:
        details["cache_write_tokens"] = cache_write
    if details:
        u["input_tokens_details"] = details
    return u


# ── the expectations ──
def T(text):
    return {"type": "text", "text": text}


def C(n, args, name="probe_tool"):
    try:
        parsed = json.loads(args)
    except ValueError:
        parsed = None
    if isinstance(parsed, dict):
        return {"type": "tool_use", "id": "call_fx%d" % n, "name": name, "input": parsed, "json": args}
    return {"type": "tool_use", "id": "call_fx%d" % n, "name": name, "input": {}, "json": "{}"}


def CUSTOM(n, raw, name="probe_custom"):
    return {"type": "tool_use", "id": "call_fx%d" % n, "name": name, "input": {"input": raw},
            "json": json.dumps({"input": raw}, ensure_ascii=False, separators=(",", ":"))}


def AU(inp, read, creation, out):
    return {"input_tokens": inp, "cache_read_input_tokens": read, "cache_creation_input_tokens": creation,
            "output_tokens": out}


def ERR(etype, status, message):
    return {"type": etype, "status": status, "message": message}


TRUNCATED = ERR("api_error", 503, "upstream unavailable (the stream closed before a terminal event)")


def expect(blocks=(), stop=None, cont=False, error=None, use=None, reasoning=(), names=(), counts=None,
           committable=True, phases=None, warnings=(), name_map=None, tools_required=()):
    return {
        "setup": {"name_map": name_map or {}, "tools_required": list(tools_required)},
        "blocks": list(blocks), "stop": stop, "continue": cont, "error": error,
        "usage": use if use is not None else AU(0, 0, 0, 0), "reasoning": list(reasoning),
        "counted": {"names": [list(n) for n in names], "counts": counts or {}},
        "committable": committable, "phases": phases or {}, "warnings": list(warnings),
    }


STREAMS = []  # (name, bytes, expectation)


def stream(name, s, exp):
    STREAMS.append((name, s.sse() if isinstance(s, Stream) else s, exp))


# ── 1-3: the runtime probe's scripted streams (ccd/ccgpt-runtime, `_scripted`) ──
def probe(with_deltas, args_in_added=False):
    s = Stream().created()
    for n, a in enumerate(ARGS):
        s.added(n, fc(n, a if args_in_added else "", status="in_progress"))
        if with_deltas:
            s.add("response.function_call_arguments.delta", item_id="fc_fx%d" % n, output_index=n, delta=a[:4])
            s.add("response.function_call_arguments.delta", item_id="fc_fx%d" % n, output_index=n, delta=a[4:])
        s.add("response.function_call_arguments.done", item_id="fc_fx%d" % n, output_index=n, arguments=a)
        s.done(n, fc(n, a))
    s.added(2, msg(2, [], status="in_progress"))
    if with_deltas:
        s.text_delta(2, "o")
        s.text_delta(2, "k")
    s.done(2, say(2, "ok"))
    s.completed([fc(0, ARGS[0]), fc(1, ARGS[1]), say(2, "ok")], usage(1, 1))
    return s


PROBE = expect([C(0, ARGS[0]), C(1, ARGS[1]), T("ok")], stop="tool_use", use=AU(1, 0, 0, 1))
stream("probe-with-deltas", probe(True), PROBE)
stream("probe-no-deltas", probe(False), PROBE)
stream("probe-args-in-added", probe(False, args_in_added=True), PROBE)

# ── 4: a lone response.completed carrying its output (ccd/ccgpt-runtime, `_SSE`) ──
stream("probe-completed-only", Stream().completed([say(0, "ok")], usage(1, 1)),
       expect([T("ok")], stop="end_turn", use=AU(1, 0, 0, 1), warnings=[W_FILLED]))

# ── 5-8: the patch driver's shapes (server/test/ccgpt-runtime.test.ts, HOOK_DRIVER_PY) ──
stream("hook-custom-tool-call-no-delta",
       Stream().created().added(0, ctc(0, "", status="in_progress")).done(0, ctc(0, "RAW INPUT"))
       .completed([ctc(0, "RAW INPUT")], usage(4, 2)),
       expect([CUSTOM(0, "RAW INPUT")], stop="tool_use", use=AU(4, 0, 0, 2)))
stream("hook-message-text-refusal-text",
       Stream().created().added(0, msg(0, [], status="in_progress"))
       .done(0, msg(0, [out_text("o"), refusal_part("no"), out_text("k")])).completed([], usage(4, 3)),
       expect([T("o"), T("no"), T("k")], stop="refusal", use=AU(4, 0, 0, 3)))
three = Stream().created()
for _n in range(3):
    three.added(_n, fc(_n, "", status="in_progress")).done(_n, fc(_n, ARGS[0]))
three.completed([fc(n, ARGS[0]) for n in range(3)], usage(5, 6))
CCC = expect([C(n, ARGS[0]) for n in range(3)], stop="tool_use", use=AU(5, 0, 0, 6))
stream("hook-three-calls-in-order", three, CCC)
first = Stream().created()
for _n in range(3):
    first.added(_n, fc(_n, "", status="in_progress"))
for _n in range(3):
    first.done(_n, fc(_n, ARGS[0]))
first.completed([fc(n, ARGS[0]) for n in range(3)], usage(5, 6))
stream("hook-three-calls-added-first", first, CCC)

# ── 9: reasoning, live text, a call; usage with cached tokens ──
READ_ARGS = json.dumps({"path": "a.txt"})
stream("synth-reasoning-text-call-cache",
       Stream().created().added(0, rs(0)).done(0, rs(0)).added(1, msg(1, [], status="in_progress"))
       .text_delta(1, "Looking").text_delta(1, " now.").done(1, say(1, "Looking now."))
       .added(2, fc(2, "", name="read_file", status="in_progress")).done(2, fc(2, READ_ARGS, name="read_file"))
       .completed([rs(0), say(1, "Looking now."), fc(2, READ_ARGS, name="read_file")], usage(100, 20, cached=60)),
       expect([T("Looking now."), C(2, READ_ARGS, name="read_file")], stop="tool_use", use=AU(40, 60, 0, 20),
              reasoning=[["text", "Looking now."]]))

# ── 10: encrypted-only reasoning, two calls, one with 30 KB of arguments, escapes and unicode ──
_LINE = 'line %d: a "quote", a \\ backslash,\ta tab, é ü 字 \U0001f600   end\n'
BIG_ARGS = json.dumps({"path": "big.txt", "content": "".join(_LINE % i for i in range(460))}, ensure_ascii=False)
assert len(BIG_ARGS.encode("utf-8")) >= 30 * 1024, "the big arguments must be at least 30 KB"
stream("synth-encrypted-only-big-parallel",
       Stream().created().done(0, rs(0)).done(1, fc(1, BIG_ARGS, name="write_file")).done(2, fc(2, ARGS[1]))
       .completed([rs(0), fc(1, BIG_ARGS, name="write_file"), fc(2, ARGS[1])], usage(50, 3000)),
       expect([C(1, BIG_ARGS, name="write_file"), C(2, ARGS[1])], stop="tool_use", use=AU(50, 0, 0, 3000),
              reasoning=[["call", "call_fx1"]]))

# ── 11-14: response.incomplete, each reason ──
# 11: the cap lands inside a live-streamed message whose done item is `incomplete`: the block keeps what was sent
# (no suffix repair) and that text is what the reasoning is keyed by.
stream("synth-incomplete-max_output_tokens",
       Stream().created().done(0, rs(0)).added(1, msg(1, [], status="in_progress"))
       .text_delta(1, "Partial ").text_delta(1, "answer").done(1, say(1, "Partial answer, cu", status="incomplete"))
       .incomplete("max_output_tokens", [rs(0), say(1, "Partial answer, cu", status="incomplete")], usage(30, 16)),
       expect([T("Partial answer")], stop="max_tokens", use=AU(30, 0, 0, 16), reasoning=[["text", "Partial answer"]],
              names=[["incompleteReason", "max_output_tokens"]]))
# 12: interrupted inside a live message that never got a done event; its item arrives only in the final output.
stream("synth-incomplete-interrupted",
       Stream().created().added(0, msg(0, [], status="in_progress")).text_delta(0, "Working on").text_delta(0, " it")
       .incomplete("interrupted", [say(0, "Working on it", status="incomplete")], usage(20, 4)),
       expect([T("Working on it")], stop=None, cont=True, use=AU(20, 0, 0, 4),
              names=[["incompleteReason", "interrupted"]], warnings=[W_FILLED]))
# 13: a content filter, with an incomplete call that was never released (R9: skipped).
stream("synth-incomplete-content-filter",
       Stream().created().done(0, say(0, "Some text")).done(1, fc(1, '{"q":', status="incomplete"))
       .incomplete("content_filter", [say(0, "Some text"), fc(1, '{"q":', status="incomplete")], usage(20, 5)),
       expect([T("Some text")], stop="refusal", use=AU(20, 0, 0, 5), names=[["incompleteReason", "content_filter"]],
              warnings=[W_UNFINISHED]))
stream("synth-incomplete-unknown-reason",
       Stream().created().done(0, say(0, "Text")).incomplete("something_else", [say(0, "Text")], usage(10, 2)),
       expect([T("Text")], error=ERR("api_error", 503, "upstream unavailable (an incomplete response: something_else)"),
              use=AU(10, 0, 0, 2), names=[["incompleteReason", "something_else"]]))

# ── 15-21: each failure before any block ──
# 15 carries a call after its failure: nothing after the terminal event is read.
stream("synth-failed-cyber-policy",
       Stream().created().failed("cyber_policy").done(0, fc(0, ARGS[0])),
       expect(error=ERR("policy_blocked", 400, "policy_blocked: the upstream refused the request (cyber_policy)"),
              committable=False))
stream("synth-failed-context-length-exceeded",
       Stream().created().failed("context_length_exceeded", "Your input exceeds the context window of this model."),
       expect(error=ERR("invalid_request_error", 400, "prompt is too long"), committable=False))
stream("synth-failed-rate-limit-exceeded", Stream().created().failed("rate_limit_exceeded"),
       expect(error=ERR("rate_limit_error", 429, "rate limited upstream (rate_limit_exceeded)"), committable=False))
stream("synth-failed-server-is-overloaded", Stream().created().failed("server_is_overloaded"),
       expect(error=ERR("overloaded_error", 529, "upstream overloaded (server_is_overloaded)"), committable=False))
stream("synth-failed-usage-not-included", Stream().created().failed("usage_not_included"),
       expect(error=ERR("permission_error", 403,
                        "usage_not_included: this account's plan does not include Codex usage"), committable=False))
stream("synth-failed-something-new", Stream().created().failed("something_new"),
       expect(error=ERR("api_error", 503, "upstream unavailable (the response failed: something_new)"),
              committable=False))
stream("synth-error-event-top-level",
       Stream().created().add("error", code="insufficient_quota", message="quota", param=None),
       expect(error=ERR("billing_error", 429,
                        "usage limit reached (insufficient_quota): the lane's plan limit is spent until it resets"),
              committable=False))

# ── 22: a complete call, then a failure: the call stays, the failure follows it ──
stream("synth-failed-after-a-call", Stream().created().done(0, fc(0, ARGS[0])).failed("server_is_overloaded"),
       expect([C(0, ARGS[0])], error=ERR("overloaded_error", 529, "upstream overloaded (server_is_overloaded)")))

# ── 23-24: EOF before a terminal; zero bytes ──
stream("synth-truncated-no-terminal", Stream().created().done(0, rs(0)).added(1, msg(1, [], status="in_progress")),
       expect(error=TRUNCATED, reasoning=[None], committable=False))
stream("synth-empty-stream", b"", expect(error=TRUNCATED, committable=False))

# ── 25-28: order, reconcile, dedupe ──
stream("synth-no-created-first", Stream().done(0, fc(0, ARGS[0])).created().completed([fc(0, ARGS[0])], usage(3, 1)),
       expect([C(0, ARGS[0])], stop="tool_use", use=AU(3, 0, 0, 1)))
stream("synth-dones-out-of-order",
       Stream().created().added(0, fc(0, "", status="in_progress")).added(1, fc(1, "", status="in_progress"))
       .done(1, fc(1, ARGS[1])).done(0, fc(0, ARGS[0])).completed([fc(0, ARGS[0]), fc(1, ARGS[1])], usage(3, 2)),
       expect([C(0, ARGS[0]), C(1, ARGS[1])], stop="tool_use", use=AU(3, 0, 0, 2)))
stream("synth-call-only-in-completed-output",
       Stream().created().done(0, fc(0, ARGS[0])).completed([fc(0, ARGS[0]), fc(1, ARGS[1])], usage(3, 2)),
       expect([C(0, ARGS[0]), C(1, ARGS[1])], stop="tool_use", use=AU(3, 0, 0, 2), warnings=[W_FILLED]))
AGAIN = json.dumps({"q": "again"})
stream("synth-duplicate-done",
       Stream().created().done(0, fc(0, ARGS[0])).done(0, fc(0, AGAIN)).completed([fc(0, ARGS[0])], usage(3, 1)),
       expect([C(0, ARGS[0])], stop="tool_use", use=AU(3, 0, 0, 1), warnings=[W_REPEAT]))

# ── 29: '' and invalid JSON, for a tool whose schema requires a field ──
stream("synth-empty-and-bad-arguments",
       Stream().created().done(0, fc(0, "", name="needs_args")).done(1, fc(1, "{not json", name="needs_args"))
       .completed([fc(0, "", name="needs_args"), fc(1, "{not json", name="needs_args")], usage(3, 2)),
       expect([C(0, "", name="needs_args"), C(1, "{not json", name="needs_args")], stop="tool_use",
              use=AU(3, 0, 0, 2), counts={"emptyArguments": 2, "invalidArguments": 2},
              tools_required=["needs_args"]))

# ── 30: unmapped items, unknown events, end_turn false ──
WEB = {"type": "web_search_call", "id": "ws_fx0", "status": "completed", "action": {"type": "search", "query": "q"}}
COMPACTION = {"type": "compaction", "id": "cmp_fx1", "encrypted_content": "ENC-1"}
MYSTERY = {"type": "mystery_item", "id": "mys_fx2", "status": "completed"}
stream("synth-unhandled-items-and-noise",
       Stream().created().add("response.in_progress", response={"id": "resp_fx1"})
       .add("response.mystery.event", detail="x").done(0, WEB).done(1, COMPACTION).done(2, MYSTERY)
       .added(3, msg(3, [], status="in_progress")).done(3, say(3, "Done."))
       .add("response.another_unknown").completed([WEB, COMPACTION, MYSTERY, say(3, "Done.")], usage(9, 2),
                                                  end_turn=False),
       expect([T("Done.")], stop=None, cont=True, use=AU(9, 0, 0, 2),
              names=[["eventType", "response.mystery.event"], ["itemType", "web_search_call"],
                     ["itemType", "compaction"], ["itemType", "mystery_item"],
                     ["eventType", "response.another_unknown"]]))

# ── 31: CRLF, and a data line that is not JSON ──
stream("synth-crlf-and-malformed-line",
       Stream(crlf=True).created().raw("event: response.output_text.delta\r\ndata: {bad json\r\n\r\n")
       .done(0, say(0, "Fine.")).completed([say(0, "Fine.")], usage(2, 1)),
       expect([T("Fine.")], stop="end_turn", use=AU(2, 0, 0, 1)))

# ── 32: a reasoning item with a summary and no encrypted_content ──
stream("synth-reasoning-without-encrypted",
       Stream().created().done(0, rs(0, encrypted=False, summary=[{"type": "summary_text", "text": "thinking"}]))
       .done(1, say(1, "Answer.")).completed([], usage(4, 2)),
       expect([T("Answer.")], stop="end_turn", use=AU(4, 0, 0, 2),
              names=[["itemType", "reasoning-without-encrypted-content"]]))

# ── synth2: the second guard for each single-guarded rule, then the spec §5 list ──
stream("synth2-dedupe-two-calls",
       Stream().created().done(0, fc(0, ARGS[0])).done(0, fc(0, ARGS[0])).done(1, fc(1, ARGS[1]))
       .done(1, fc(1, ARGS[1])).completed([], usage(3, 2)),
       expect([C(0, ARGS[0]), C(1, ARGS[1])], stop="tool_use", use=AU(3, 0, 0, 2), warnings=[W_REPEAT, W_REPEAT]))
NS = [json.dumps({"n": n}) for n in range(3)]
stream("synth2-order-three-calls",
       Stream().created().done(2, fc(2, NS[2])).done(0, fc(0, NS[0])).done(1, fc(1, NS[1])).completed([], usage(3, 3)),
       expect([C(0, NS[0]), C(1, NS[1]), C(2, NS[2])], stop="tool_use", use=AU(3, 0, 0, 3)))
stream("synth2-cache-write-nonzero",
       Stream().created().done(0, say(0, "ok")).completed([], usage(1000, 5, cached=400, cache_write=100)),
       expect([T("ok")], stop="end_turn", use=AU(500, 400, 100, 5)))
stream("synth2-crlf-reasoning",
       Stream(crlf=True).created().done(0, rs(0)).done(1, fc(1, ARGS[0])).completed([], usage(3, 1)),
       expect([C(1, ARGS[0])], stop="tool_use", use=AU(3, 0, 0, 1), reasoning=[["call", "call_fx1"]]))
stream("synth2-refusal-only-message",
       Stream().created().done(0, msg(0, [refusal_part("I can't help with that.")])).completed([], usage(3, 6)),
       expect([T("I can't help with that.")], stop="refusal", use=AU(3, 0, 0, 6)))
stream("synth2-failed-first-event", Stream().failed("context_length_exceeded"),
       expect(error=ERR("invalid_request_error", 400, "prompt is too long"), committable=False))
stream("synth2-drop-inside-live-text",
       Stream().created().added(0, msg(0, [], status="in_progress")).text_delta(0, "Hello ").text_delta(0, "wor"),
       expect([T("Hello wor")], error=TRUNCATED))
stream("synth2-live-text-prefix-then-suffix",
       Stream().created().added(0, msg(0, [], status="in_progress")).text_delta(0, "The answer")
       .done(0, say(0, "The answer is 42.")).completed([], usage(3, 5)),
       expect([T("The answer is 42.")], stop="end_turn", use=AU(3, 0, 0, 5)))
stream("synth2-live-text-mismatch",
       Stream().created().done(0, rs(0)).added(1, msg(1, [], status="in_progress")).text_delta(1, "Hello there")
       .done(1, say(1, "Goodbye now")).completed([], usage(3, 3)),
       expect([T("Hello there")], stop="end_turn", use=AU(3, 0, 0, 3), reasoning=[["text", "Hello there"]],
              counts={"liveTextMismatch": 1}))
stream("synth2-phase-commentary-then-final",
       Stream().created().done(0, say(0, "Checking.", phase="commentary")).done(1, say(1, "All good.", phase="final"))
       .completed([], usage(3, 4)),
       expect([T("Checking."), T("All good.")], stop="end_turn", use=AU(3, 0, 0, 4),
              phases={"Checking.": "commentary", "All good.": "final"}))
stream("synth2-end-turn-false-no-call",
       Stream().created().done(0, say(0, "Part one.")).completed([], usage(3, 3), end_turn=False),
       expect([T("Part one.")], stop=None, cont=True, use=AU(3, 0, 0, 3)))
stream("synth2-end-turn-false-with-call",
       Stream().created().done(0, say(0, "Calling.")).done(1, fc(1, ARGS[0]))
       .completed([], usage(3, 3), end_turn=False),
       expect([T("Calling."), C(1, ARGS[0])], stop="tool_use", use=AU(3, 0, 0, 3)))
LONG = "mcp__a_long_server_name__a_very_long_tool_name_that_runs_past_the_limi"
assert len(LONG) == 70, len(LONG)
CUT = LONG[:55] + "_" + hashlib.sha256(LONG.encode("utf-8")).hexdigest()[:8]
stream("synth2-long-tool-name",
       Stream().created().done(0, fc(0, ARGS[0], name=CUT)).completed([], usage(3, 1)),
       expect([C(0, ARGS[0], name=LONG)], stop="tool_use", use=AU(3, 0, 0, 1), name_map={CUT: LONG}))
stream("synth2-completed-empty-output-after-dones",
       Stream().created().done(0, fc(0, ARGS[0])).done(1, say(1, "After.")).completed([], usage(3, 2)),
       expect([C(0, ARGS[0]), T("After.")], stop="tool_use", use=AU(3, 0, 0, 2)))
stream("synth2-cache-write-only",
       Stream().created().done(0, say(0, "ok")).completed([], usage(800, 2, cache_write=300)),
       expect([T("ok")], stop="end_turn", use=AU(500, 0, 300, 2)))
stream("synth2-reasoning-message-reasoning-call",
       Stream().created().done(0, rs(0)).done(1, say(1, "First I look.")).done(2, rs(2)).done(3, fc(3, ARGS[0]))
       .completed([], usage(3, 4)),
       expect([T("First I look."), C(3, ARGS[0])], stop="tool_use", use=AU(3, 0, 0, 4),
              reasoning=[["text", "First I look."], ["call", "call_fx3"]]))


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "streams")
    os.makedirs(out, exist_ok=True)
    names = [n for n, _, _ in STREAMS]
    assert len(names) == len(set(names)), "a stream name is repeated"
    for name, data, _ in STREAMS:
        with open(os.path.join(out, name + ".sse"), "wb") as f:
            f.write(data)
    expectations = {"order": names, "streams": {name: exp for name, _, exp in STREAMS}}
    with open(os.path.join(out, "expect.json"), "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(expectations, indent=1, sort_keys=True, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

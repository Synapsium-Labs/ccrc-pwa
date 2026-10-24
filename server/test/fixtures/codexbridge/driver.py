"""driver.py — runs a sequence of `ccd/codexbridge` operations in ONE process, for the codex-bridge suites.

Spawned by `runBridgeDriver` (`server/test/codexBridgeFixture.ts`) as `python3 -I driver.py <action-json>`, in a
fixture HOME, with CCGPT_BRIDGE_UPSTREAM_BASE and CCRC_CODEX_AUTH_BASE always set to loopback URLs. Standard library
only.

THE ACTION, one JSON object in argv[1], or `@<path>` naming a file that holds it (for an action past Linux's 128 KiB
limit on one argument, which `runBridgeDriver` writes into the fixture HOME):
  {"pkg": <the ccd directory>, "ops": [{"op": ..., ...}, ...], "consts": {"<module>.<NAME>": value, ...}}
`sys.dont_write_bytecode = True` is set before anything is imported (`-I` implies `-E`, so PYTHONDONTWRITEBYTECODE
is ignored and an import would write `__pycache__` into the tree), then `pkg` is put first on `sys.path`, as the
shim's direct entry does, and `codexbridge` is imported (its `load_all()` imports every module). Each `consts` entry
is set on `codexbridge.<module>` after the import; a module or a name the package does not define is a usage error
(exit 2), so a typo never passes as an override.

THE OPS, run in order; each prints ONE JSON line `{"op": <name>, ...}` and the run continues after an op that raised:
  modules          -> {"version", "modules": MODULES, "loaded": the codexbridge.* names in sys.modules}
  census           {dir?} -> {"files": [{"file", "syntaxError"?, "imports", "pep604", "timeoutError"}]}: an ast walk
                   of every *.py in `dir` (default `<pkg>/codexbridge`) at feature_version (3, 9); the file is read,
                   never imported
  sse-feed         {bytes_b64, chunk: <int> | "whole"} -> {"events", "warnings", "scanned", "found"}: one SseParser
                   fed in `chunk`-byte pieces, then closed; `found` is the bytes its buffer's find() examined, counted
                   by the buffer itself (a bytearray subclass swapped in before the first feed), never by the parser
  frame            {type, data} -> {"result": sse.frame(type, data) as text}
  ping             -> {"result": sse.PING as text}
  classify-http    {status, body? (text) | bodyB64?, headers?, now} -> a BridgeError
  classify-failed  {error, now} -> a BridgeError
  overflow         {n, m} -> a BridgeError
  capability       {cls, detail} -> a BridgeError
  from-auth        {word, sentence} -> a BridgeError
  sets             -> {"<SET NAME>": sorted list, ...} for the seven code sets, ALL_CODES and the two word sets, and
                   {"CODE_RE", "REQUEST_ID_RE"}: errors' two patterns as text
  auth-lib         {lib} -> {"words": every AuthError subclass's `word`, sorted, "CODE_RE", "REQUEST_ID_RE"}: Stage 1's
                   library loaded by path (`spec_from_file_location`, as the bridge loads it), never through sys.path
  endpoints        -> {"CCGPT_BRIDGE_UPSTREAM_BASE", "CCRC_CODEX_AUTH_BASE", "HOME"}: the two endpoint variables and
                   HOME as this process received them (None when unset); URLs and a fixture path, never a credential
  from-anthropic   {body, headers? | headerLines?, output_config?, stored?} -> {"request": the NeutralRequest as a
                   dict (`tools_required` sorted), "names": [[family, value], ...]}, or a BridgeError (below) with
                   "names": `inbound.from_anthropic` with a ListSink; `headers` is a plain dict, `headerLines` a list
                   of [name, value] pairs put in an http.client.HTTPMessage (the server's own header type, a repeated
                   name kept as repeated lines); `output_config` is passed only when the op names it, and
                   `stored` is the lookup stub: a list of {"call": <id>, "turn"} or {"session", "text", "turn"}, each
                   keyed by `inbound.call_key` / `inbound.text_key`, so a test never spells a key itself; "lookups"
                   lists the keys asked for, in order
  inbound-keys     {cut?: [names], text?: [[session, text]], call?: [ids], cache?: [[session, agent]]} -> each list
                   mapped through cut_name / text_key / call_key / cache_key, and "consts": BILLING_PREFIX,
                   COMPACTION_MARKER, IMAGE_TOKENS
  reduce           {stream (a path) | bytes_b64, chunk: <int> | "whole", name_map?, tools_required?, live_text?,
                   trace?} -> {"events": [[name, data], ...] (every block event released, in order), "terminal":
                   {kind, reason, endTurn, usage, anthropicUsage, stop, continue, error}, "reasoning": [{"id", "key"}]
                   (item ids and keys only, never an item), "counted": {"names", "counts"}, "committable",
                   "emittedToolUse", "refusal", "phases", "emittedText", "warnings", "terminalBeforeEof",
                   "outputItems" (a count), "responseId", "trace"? (per parsed event: its type, the events released,
                   and whether terminal and committable were then set)}: one SseParser and one Reducer, the
                   reducer's release() drained after every event, finish() after the parser is closed
  stop-reasons     -> {"rows": [{"in": [kind, reason, end_turn, emitted_tool_use, refusal], "stop", "cont"}],
                   "failedRaises": the class stop_reason raises for a failed terminal,
                   "twoArgContinuationRaises": the class the two-argument needs_continuation call raises (None if it
                   answers)}
  THE REASONING STORE (Task 4): one ReasoningStore per driver process, opened by store-open and used by every later
  store-* op, by store-remember (over the reducer the LAST reduce op built) and by from-anthropic with
  "lookup": "store" (its get in place of the stub). A store key is never passed in: each op names a `call` (keyed by
  inbound.call_key) or a `session` and a `text` (keyed by inbound.text_key). Every store-* op but store-plant and
  store-dump also prints "disabled": the store's reason, or None.
  store-open       {path, max_bytes?, ttl_s?, umask?} -> {"disabled"}: os.umask(umask) first when given
  store-put        {call | session + text, turn, now?} -> {"disabled"}
  store-get        {call | session + text} -> {"turn", "disabled"}
  store-evict      {now?} -> {"evicted", "disabled"}
  store-remember   {session} -> {"disabled"}: store.remember over the last reduce op's Reducer
  store-threads    {n, each} -> {"mismatches", "raised_in_threads", "disabled"}: `n` threads, each `each` puts and
                   gets of its own call keys through the one store
  store-plant      {path, user_version} -> {}: a raw sqlite file with the store's table at that user_version, written
                   without the store
  store-dump       {path} -> {"rows": [{"key", "turn", "created", "size"}] by key, "userVersion", "journalMode"}: read
                   through a raw sqlite connection of its own
A BridgeError prints as {"error": {status, etype, message, headers, state, code, requestId, kind}, "answer":
{"status", "headers", "body": parsed JSON}, "event": errors.event(e) as text}. An op that raised prints
{"raised": <class name>}. Exit 0, or 1 when an op raised, 2 for a usage error, 3 when the package failed to import.
"""

import ast
import base64
import http.client
import importlib
import importlib.util
import json
import os
import sqlite3
import sys
import threading

sys.dont_write_bytecode = True

# The process's one reasoning store and the Reducer the last reduce op built (the store-* ops, above).
_STATE = {"store": None, "reducer": None}


def _emit(line):
    sys.stdout.write(json.dumps(line, sort_keys=True) + "\n")
    sys.stdout.flush()


def _usage(msg):
    sys.stderr.write("driver.py: " + msg + "\n")
    sys.exit(2)


def _bridge_error(errors, e):
    status, headers, body = errors.http_answer(e)
    return {
        "error": {
            "status": e.status, "etype": e.etype, "message": e.message, "headers": dict(e.headers),
            "state": e.state, "code": e.code, "requestId": e.request_id, "kind": e.kind,
        },
        "answer": {"status": status, "headers": dict(headers), "body": json.loads(body.decode("utf-8"))},
        "event": errors.event(e).decode("utf-8"),
    }


class _CountingBuffer(bytearray):
    """The parser's buffer, counting what each find() examines from the offset it was actually given: (the match's
    end, or the buffer's length) minus that offset. In-place `+=` and `del` keep the subclass."""

    found = 0

    def find(self, sub, start=0, end=None):
        r = bytearray.find(self, sub, start) if end is None else bytearray.find(self, sub, start, end)
        self.found += (r + 1 if r >= 0 else len(self)) - start
        return r


def _has_bitor(node):
    return any(isinstance(x, ast.BinOp) and isinstance(x.op, ast.BitOr) for x in ast.walk(node))


def _census_file(path):
    """Stage 1's PEP 604 walk (codex-auth-lib.test.ts), the imports, and every `except TimeoutError`."""
    src = open(path, encoding="utf-8").read()
    out = {"file": os.path.basename(path), "imports": [], "pep604": [], "timeoutError": []}
    try:
        tree = ast.parse(src, filename=path, feature_version=(3, 9))
    except SyntaxError as e:
        out["syntaxError"] = "%s:%s" % (e.msg, e.lineno)
        return out
    for node in ast.walk(tree):
        anns = []
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            a = node.args
            for arg in a.posonlyargs + a.args + a.kwonlyargs + [a.vararg, a.kwarg]:
                if arg is not None and arg.annotation is not None:
                    anns.append(arg.annotation)
            if node.returns is not None:
                anns.append(node.returns)
        elif isinstance(node, ast.AnnAssign):
            anns.append(node.annotation)
        elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
              and node.func.id in ("isinstance", "issubclass") and len(node.args) > 1):
            anns.append(node.args[1])
        out["pep604"].extend(node.lineno for a in anns if _has_bitor(a))
        if isinstance(node, ast.Import):
            out["imports"].extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            out["imports"].append("codexbridge" if node.level > 0 else (node.module or ""))
        elif isinstance(node, ast.ExceptHandler) and node.type is not None:
            kinds = node.type.elts if isinstance(node.type, ast.Tuple) else [node.type]
            for k in kinds:
                name = k.id if isinstance(k, ast.Name) else (k.attr if isinstance(k, ast.Attribute) else None)
                if name == "TimeoutError":
                    out["timeoutError"].append(node.lineno)
    out["imports"] = sorted(set(out["imports"]))
    return out


# (kind, reason, end_turn, emitted_tool_use, refusal): the stop-reasons op's table rows, in the test's order.
_STOP_ROWS = (
    ("completed", None, None, True, False), ("completed", None, None, False, True),
    ("completed", None, None, False, False), ("completed", None, True, False, False),
    ("completed", None, False, False, False), ("completed", None, False, True, False),
    ("incomplete", "max_output_tokens", None, False, False), ("incomplete", "content_filter", None, False, False),
    ("incomplete", "interrupted", None, False, False), ("incomplete", "interrupted", None, True, False),
    ("completed", None, False, False, True),
)


def _reduce(op, cb):
    """One SseParser and one Reducer over a stream fed in `chunk`-byte pieces, `release()` drained after every event;
    the reducer's reasoning is reported as item ids and keys only, never the items."""
    reducer = cb.reducer
    if "stream" in op:
        with open(op["stream"], "rb") as f:
            data = f.read()
    else:
        data = base64.b64decode(op["bytes_b64"])
    chunk = op.get("chunk", "whole")
    size = max(1, len(data) if chunk == "whole" else int(chunk))
    sink = cb.ListSink()
    r = reducer.Reducer(name_map=op.get("name_map") or {}, names=sink,
                        tools_required=frozenset(op.get("tools_required") or []), live_text=op.get("live_text", True))
    parser = cb.sse.SseParser()
    events, trace = [], []

    def take(parsed):
        for ev in parsed:
            r.feed(ev)
            got = r.release()
            events.extend([n, d] for n, d in got)
            trace.append({"type": ev.type, "terminal": r.terminal is not None, "committable": r.committable,
                          "released": [n + ":" + d["delta"]["type"] if n == "content_block_delta" else n
                                       for n, d in got]})

    for i in range(0, len(data), size):
        take(parser.feed(data[i:i + size]))
    take(parser.close())
    before_eof = r.terminal is not None
    t = r.finish()
    events.extend([n, d] for n, d in r.release())
    term = {"kind": t.kind, "reason": t.reason, "endTurn": t.end_turn,
            "usage": {"input": t.usage.input, "cached": t.usage.cached, "cacheWrite": t.usage.cache_write,
                      "output": t.usage.output},
            "anthropicUsage": reducer.anthropic_usage(t.usage), "stop": None, "continue": False, "error": None}
    if t.error is None:
        term["stop"] = reducer.stop_reason(t, r.emitted_tool_use, r.refusal)
        term["continue"] = reducer.needs_continuation(t, r.emitted_tool_use, refusal=r.refusal)
    else:
        term["error"] = {"type": t.error.etype, "status": t.error.status, "message": t.error.message,
                         "code": t.error.code}
    out = {
        "chunk": chunk, "events": events, "terminal": term,
        "reasoning": [{"id": item.get("id"), "key": list(key) if key is not None else None}
                      for item, key in r.reasoning],
        "counted": {"names": [list(n) for n in sink.names], "counts": {k: v for k, v in r.counts.items() if v}},
        "committable": r.committable, "emittedToolUse": r.emitted_tool_use, "refusal": r.refusal,
        "phases": r.phases, "emittedText": {str(k): v for k, v in r.emitted_text.items()},
        "warnings": list(r.warnings), "terminalBeforeEof": before_eof, "outputItems": len(r.output_items),
        "responseId": r.response_id,
    }
    if op.get("trace"):
        out["trace"] = trace
    _STATE["reducer"] = r
    return out


def _store_key(op, cb):
    if "call" in op:
        return cb.inbound.call_key(op["call"])
    return cb.inbound.text_key(op.get("session"), op["text"])


def _store_threads(store, cb, n, each):
    """`n` threads, each putting and getting `each` turns under call keys of its own through the ONE store."""
    mismatches, raised = [0], []

    def work(t):
        try:
            for i in range(each):
                key = cb.inbound.call_key("call_fx%d_%d" % (t, i))
                turn = {"items": [{"type": "reasoning", "id": "rs_fx%d_%d" % (t, i), "summary": [],
                                   "encrypted_content": "ENC-%d-%d" % (t, i)}], "phase": None}
                store.put(key, turn)
                if store.get(key) != turn:
                    mismatches[0] += 1
        except Exception as e:  # reported, never swallowed
            raised.append(type(e).__name__)

    threads = [threading.Thread(target=work, args=(t,)) for t in range(n)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    return {"mismatches": mismatches[0], "raised_in_threads": raised}


def _store_op(name, op, cb):
    if name == "store-plant":
        conn = sqlite3.connect(op["path"])
        conn.execute("CREATE TABLE reasoning(key TEXT PRIMARY KEY, items TEXT NOT NULL, created INTEGER NOT NULL, "
                     "size INTEGER NOT NULL)")
        conn.execute("PRAGMA user_version = %d" % int(op["user_version"]))
        conn.commit()
        conn.close()
        return {}
    if name == "store-dump":
        conn = sqlite3.connect(op["path"])
        try:
            rows = [{"key": k, "turn": json.loads(v), "created": c, "size": z}
                    for k, v, c, z in conn.execute("SELECT key, items, created, size FROM reasoning ORDER BY key")]
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        finally:
            conn.close()
        return {"rows": rows, "userVersion": version, "journalMode": mode}
    if name == "store-open":
        if "umask" in op:
            os.umask(int(op["umask"]))
        _STATE["store"] = cb.store.ReasoningStore(op["path"], max_bytes=op.get("max_bytes"), ttl_s=op.get("ttl_s"))
        out = {}
    elif name == "store-put":
        _STATE["store"].put(_store_key(op, cb), op["turn"], now=op.get("now"))
        out = {}
    elif name == "store-get":
        out = {"turn": _STATE["store"].get(_store_key(op, cb))}
    elif name == "store-evict":
        out = {"evicted": _STATE["store"].evict(now=op.get("now"))}
    elif name == "store-remember":
        cb.store.remember(_STATE["store"], _STATE["reducer"], op.get("session"))
        out = {}
    elif name == "store-threads":
        out = _store_threads(_STATE["store"], cb, int(op["n"]), int(op["each"]))
    else:
        _usage("unknown op " + json.dumps(name))
        return None
    out["disabled"] = _STATE["store"].disabled
    return out


def _run(op, pkg, cb):
    name = op.get("op")
    sse = cb.sse
    errors = cb.errors
    if name == "modules":
        loaded = sorted(k for k in sys.modules if k == "codexbridge" or k.startswith("codexbridge."))
        return {"version": cb.VERSION, "modules": list(cb.MODULES), "loaded": loaded}
    if name == "census":
        d = op.get("dir") or os.path.join(pkg, "codexbridge")
        files = sorted(f for f in os.listdir(d) if f.endswith(".py"))
        return {"files": [_census_file(os.path.join(d, f)) for f in files]}
    if name == "sse-feed":
        data = base64.b64decode(op["bytes_b64"])
        chunk = op.get("chunk", "whole")
        size = len(data) if chunk == "whole" else int(chunk)
        p = sse.SseParser()
        counting = p._buf = _CountingBuffer()
        events = []
        for i in range(0, len(data), max(1, size)):
            events.extend(p.feed(data[i:i + max(1, size)]))
        events.extend(p.close())
        return {"events": [{"name": e.name, "data": e.data, "type": e.type} for e in events],
                "warnings": list(p.warnings), "scanned": p.scanned, "found": counting.found}
    if name == "frame":
        return {"result": sse.frame(op["type"], op["data"]).decode("utf-8")}
    if name == "ping":
        return {"result": sse.PING.decode("utf-8")}
    if name == "classify-http":
        if "bodyB64" in op:
            body = base64.b64decode(op["bodyB64"])
        else:
            body = op.get("body", "").encode("utf-8")
        return _bridge_error(errors, errors.classify_http(op["status"], body, op.get("headers", {}), now=op["now"]))
    if name == "classify-failed":
        return _bridge_error(errors, errors.classify_failed(op.get("error"), now=op["now"]))
    if name == "overflow":
        return _bridge_error(errors, errors.overflow(op["n"], op["m"]))
    if name == "capability":
        return _bridge_error(errors, errors.capability(op["cls"], op["detail"]))
    if name == "from-auth":
        return _bridge_error(errors, errors.from_auth(op["word"], op["sentence"]))
    if name == "sets":
        names = ("OVERFLOW_CODES", "QUOTA_CODES", "USAGE_LIMIT_TYPES", "TRANSIENT_RATE_CODES", "INELIGIBLE_CODES",
                 "POLICY_CODES", "OVERLOAD_CODES", "ALL_CODES", "AUTH_DEAD_WORDS", "AUTH_TRANSIENT_WORDS")
        out = {n: sorted(getattr(errors, n)) for n in names}
        out.update({"CODE_RE": errors.CODE_RE.pattern, "REQUEST_ID_RE": errors.REQUEST_ID_RE.pattern})
        return out
    if name == "auth-lib":
        spec = importlib.util.spec_from_file_location("ccgpt_auth", op["lib"])
        lib = importlib.util.module_from_spec(spec)
        sys.modules["ccgpt_auth"] = lib
        spec.loader.exec_module(lib)
        words, todo = set(), list(lib.AuthError.__subclasses__())
        while todo:
            cls = todo.pop()
            words.add(cls.word)
            todo.extend(cls.__subclasses__())
        return {"words": sorted(words), "CODE_RE": lib.CODE_RE.pattern, "REQUEST_ID_RE": lib.REQUEST_ID_RE.pattern}
    if name == "from-anthropic":
        inbound = cb.inbound
        stored = {}
        for row in op.get("stored") or []:
            key = inbound.call_key(row["call"]) if "call" in row else inbound.text_key(row.get("session"), row["text"])
            stored[key] = row["turn"]
        lookups = []

        def lookup(key):
            lookups.append(key)
            if op.get("lookup") == "store":
                return _STATE["store"].get(key)
            return stored.get(key)

        sink = cb.ListSink()
        kwargs = {"names": sink, "lookup": lookup}
        if "output_config" in op:
            kwargs["output_config"] = op["output_config"]
        headers = op.get("headers") or {}
        if "headerLines" in op:
            headers = http.client.HTTPMessage()
            for k, v in op["headerLines"]:
                headers[k] = v  # Message.__setitem__ appends: a repeated name stays two lines
        try:
            req = inbound.from_anthropic(op["body"], headers, **kwargs)
        except errors.BridgeError as e:
            out = _bridge_error(errors, e)
            out.update({"names": [list(n) for n in sink.names], "lookups": lookups})
            return out
        request = req._asdict()
        request["tools_required"] = sorted(request["tools_required"])
        return {"request": request, "names": [list(n) for n in sink.names], "lookups": lookups}
    if name == "inbound-keys":
        inbound = cb.inbound
        return {
            "cut": [inbound.cut_name(n) for n in op.get("cut") or []],
            "text": [inbound.text_key(s, t) for s, t in op.get("text") or []],
            "call": [inbound.call_key(c) for c in op.get("call") or []],
            "cache": [inbound.cache_key(s, a) for s, a in op.get("cache") or []],
            "consts": {"BILLING_PREFIX": inbound.BILLING_PREFIX, "COMPACTION_MARKER": inbound.COMPACTION_MARKER,
                       "IMAGE_TOKENS": inbound.IMAGE_TOKENS},
        }
    if name == "endpoints":
        keys = ("CCGPT_BRIDGE_UPSTREAM_BASE", "CCRC_CODEX_AUTH_BASE", "HOME")
        return {k: os.environ.get(k) for k in keys}
    if name == "reduce":
        return _reduce(op, cb)
    if name == "stop-reasons":
        reducer = cb.reducer
        rows = []
        for kind, reason, end_turn, tool, refusal in _STOP_ROWS:
            t = reducer.Terminal(kind, reason, None, reducer.ZERO_USAGE, end_turn)
            rows.append({"in": [kind, reason, end_turn, tool, refusal], "stop": reducer.stop_reason(t, tool, refusal),
                         "cont": reducer.needs_continuation(t, tool, refusal=refusal)})
        failed = reducer.Terminal("failed", None, errors.classify_failed(None, now=0), reducer.ZERO_USAGE, None)
        try:
            reducer.stop_reason(failed, False, False)
            raised = None
        except Exception as e:  # the answer this op reports
            raised = type(e).__name__
        try:  # the plan's two-argument spelling, the refusal flag left out
            reducer.needs_continuation(reducer.Terminal("completed", None, None, reducer.ZERO_USAGE, False), False)
            two_arg = None
        except Exception as e:  # the answer this op reports
            two_arg = type(e).__name__
        return {"rows": rows, "failedRaises": raised, "twoArgContinuationRaises": two_arg}
    if name.startswith("store-"):
        return _store_op(name, op, cb)
    _usage("unknown op " + json.dumps(name))
    return None


def main():
    if len(sys.argv) != 2:
        _usage("one argument: the action as JSON")
    arg = sys.argv[1]
    if arg.startswith("@"):
        with open(arg[1:], encoding="utf-8") as f:
            arg = f.read()
    action = json.loads(arg)
    pkg = action["pkg"]
    sys.path.insert(0, pkg)
    try:
        cb = importlib.import_module("codexbridge")
    except Exception as e:  # the red phase: no package yet
        _emit({"op": "load", "raised": type(e).__name__, "message": str(e)})
        return 3
    for key, value in (action.get("consts") or {}).items():
        mod_name, _, const = key.partition(".")
        mod = sys.modules.get("codexbridge." + mod_name)
        if mod is None or not const or not hasattr(mod, const):
            _usage("no constant " + json.dumps(key))
        setattr(mod, const, value)
    rc = 0
    for op in action.get("ops", []):
        try:
            line = _run(op, pkg, cb)
        except Exception as e:  # report and continue
            line = {"raised": type(e).__name__}
            rc = 1
        line["op"] = op.get("op")
        _emit(line)
    return rc


if __name__ == "__main__":
    sys.exit(main())

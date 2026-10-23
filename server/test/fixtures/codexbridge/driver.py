"""driver.py — runs a sequence of `ccd/codexbridge` operations in ONE process, for the codex-bridge suites.

Spawned by `runBridgeDriver` (`server/test/codexBridgeFixture.ts`) as `python3 -I driver.py <action-json>`, in a
fixture HOME, with CCGPT_BRIDGE_UPSTREAM_BASE and CCRC_CODEX_AUTH_BASE always set to loopback URLs. Standard library
only.

THE ACTION, one JSON object in argv[1]:
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
  sse-feed         {bytes_b64, chunk: <int> | "whole"} -> {"events", "warnings", "scanned"}: one SseParser fed in
                   `chunk`-byte pieces, then closed
  frame            {type, data} -> {"result": sse.frame(type, data) as text}
  ping             -> {"result": sse.PING as text}
  classify-http    {status, body? (text) | bodyB64?, headers?, now} -> a BridgeError
  classify-failed  {error, now} -> a BridgeError
  overflow         {n, m} -> a BridgeError
  capability       {cls, detail} -> a BridgeError
  from-auth        {word, sentence} -> a BridgeError
  sets             -> {"<SET NAME>": sorted list, ...} for the seven code sets, ALL_CODES and the two word sets
A BridgeError prints as {"error": {status, etype, message, headers, state, code, requestId, kind}, "answer":
{"status", "headers", "body": parsed JSON}, "event": errors.event(e) as text}. An op that raised prints
{"raised": <class name>}. Exit 0, or 1 when an op raised, 2 for a usage error, 3 when the package failed to import.
"""

import ast
import base64
import importlib
import json
import os
import sys

sys.dont_write_bytecode = True


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
        events = []
        for i in range(0, len(data), max(1, size)):
            events.extend(p.feed(data[i:i + max(1, size)]))
        events.extend(p.close())
        return {"events": [{"name": e.name, "data": e.data, "type": e.type} for e in events],
                "warnings": list(p.warnings), "scanned": p.scanned}
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
        return {n: sorted(getattr(errors, n)) for n in names}
    _usage("unknown op " + json.dumps(name))
    return None


def main():
    if len(sys.argv) != 2:
        _usage("one argument: the action as JSON")
    action = json.loads(sys.argv[1])
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

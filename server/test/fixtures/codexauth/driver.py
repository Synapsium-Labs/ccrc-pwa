"""driver.py — runs a sequence of `ccd/ccgpt-auth.py` operations in ONE process, for the codex-auth suites.

Spawned by `runAuthDriver` (`server/test/codexAuthFixture.ts`) as `python3 -I driver.py <action-json>`, in a fixture
HOME, with CCRC_CODEX_AUTH_BASE always set to a loopback URL. Standard library only.

THE ACTION, one JSON object in argv[1]:
  {"lib": <path to ccgpt-auth.py>, "authDir": <absolute>, "ops": [{"op": ..., ...}, ...],
   "faults": ["enospc-writes:1", ...], "consts": {"EXPIRY_SKEW_S": 7200, ...}, "umask": <int>}
The library is loaded lazily, by `importlib.util.spec_from_file_location("ccgpt_auth", lib)` with
`sys.dont_write_bytecode = True`, at the first op that needs it (or at once when `faults` is not empty), so an op
that needs no library (`env`, `wait`) runs even when the file is missing. Each `consts` entry is set on the module
right after it loads; a name the module does not define is a usage error (exit 2), so a typo never passes as an
override. `umask` is applied before anything else.

THE OPS, run in order (an optional argument an op leaves out is not passed, so the library's default runs); each
prints ONE JSON line `{"op": <name>, "ms": <elapsed>, ...}` and the run continues after
an op that raised:
  read          read(authDir) -> a Reading
  expired       {withinS?, now?} -> {"result": expired(read(authDir), ...)}
  paths         paths_for(authDir) -> its four fields
  env           {name} -> {"result": the variable's value or null}
  commit        {record} -> {"result": commit_record(authDir, record)}, inside held(authDir)
  held-retry    -> {"result": retry_unsaved(authDir)}, inside held(authDir)
  recover       -> {"result": recover_pending(authDir)}, inside held(authDir)
  ensure_fresh  {withinS?, lane?} -> a Reading
  sign_in       {lane?, timeoutS?} -> {"result": sign_in_device(...), "out": what it printed to `out`}
  wait          {path, timeoutMs?} -> blocks until the file exists (forever when no timeoutMs is given)
  hold          {ms, touch?} -> takes held(authDir), creates `touch` (a ready signal) once held, keeps it ms
  reenter       -> enters held(authDir) inside held(authDir) in one thread
  status        -> {"result": status_report(authDir)}
  main          {argv} -> {"rc": main(argv), "stdout": ..., "stderr": ...}: in-process, so every fault applies
A Reading prints with every token field replaced by its length (`access_token`, `refresh_token`: an int or null) and
its identity as {"ino", "mtimeNs" (a decimal STRING, exact past 2**53), "size"}. An op that raised prints
{"error": <the AuthError's word, else the exception's class name>, "class": <class name>, "message": str(e)}.
Exit 0, or 1 when an op raised, 2 for a usage error, 3 when the library failed to load.

THE FAULTS, applied by monkeypatching `os` after the library loads (the library calls `os.open`, `os.write`,
`os.fsync`, `os.close` and `os.replace` through the module, so it sees them):
  enospc-writes:N   the first N `os.write` calls on an fd opened on a path ending in the checkpoint's name raise
                    OSError(ENOSPC) (the driver maps each such fd to its path by wrapping `os.open`, and forgets it
                    at `os.close`)
  enospc-fsync:N    the first N `os.fsync` calls on such an fd raise OSError(ENOSPC)
  enospc-replace:N  the first N `os.replace` calls onto the credential raise OSError(ENOSPC)
  die-before-rename `os.replace` onto the credential calls `os._exit(9)` (stdout flushed first)
  uid:<n>           `os.getuid` answers <n>
"""

import contextlib
import errno
import importlib.util
import io
import json
import os
import sys
import time

sys.dont_write_bytecode = True

_state = {"lib": None}


def _emit(line):
    sys.stdout.write(json.dumps(line, sort_keys=True) + "\n")
    sys.stdout.flush()


def _usage(msg):
    sys.stderr.write("driver.py: " + msg + "\n")
    sys.exit(2)


def _identity_json(identity):
    if identity is None:
        return None
    ino, mtime_ns, size = identity
    return {"ino": ino, "mtimeNs": str(mtime_ns), "size": size}


def _reading_json(r):
    d = r._asdict()
    for key in ("access_token", "refresh_token"):
        d[key] = None if d[key] is None else len(d[key])
    d["identity"] = _identity_json(d["identity"])
    return d


def _is_reading(value):
    return hasattr(value, "_fields") and "credential" in getattr(value, "_fields", ())


def _install_faults(lib, faults):
    counts = {}
    flags = set()
    for f in faults:
        name, _, n = f.partition(":")
        if name in ("enospc-writes", "enospc-fsync", "enospc-replace", "uid"):
            if not n.lstrip("-").isdigit():
                _usage("fault " + f + " needs a number")
            counts[name] = int(n)
        elif name == "die-before-rename" and not n:
            flags.add(name)
        else:
            _usage("unknown fault " + f)
    pending_name = getattr(lib, "PENDING_NAME", "auth.pending.json")
    credential_name = getattr(lib, "CREDENTIAL_NAME", "auth.json")
    pending_fds = set()
    real_open, real_close, real_write = os.open, os.close, os.write
    real_fsync, real_replace = os.fsync, os.replace

    def enospc():
        return OSError(errno.ENOSPC, os.strerror(errno.ENOSPC))

    def take(name):
        if counts.get(name, 0) > 0:
            counts[name] -= 1
            return True
        return False

    def f_open(path, flags_, *args, **kwargs):
        fd = real_open(path, flags_, *args, **kwargs)
        if os.fspath(path).endswith(pending_name):
            pending_fds.add(fd)
        return fd

    def f_close(fd):
        pending_fds.discard(fd)
        return real_close(fd)

    def f_write(fd, data):
        if fd in pending_fds and take("enospc-writes"):
            raise enospc()
        return real_write(fd, data)

    def f_fsync(fd):
        if fd in pending_fds and take("enospc-fsync"):
            raise enospc()
        return real_fsync(fd)

    def f_replace(src, dst, *args, **kwargs):
        if os.path.basename(os.fspath(dst)) == credential_name:
            if "die-before-rename" in flags:
                sys.stdout.flush()
                sys.stderr.flush()
                os._exit(9)
            if take("enospc-replace"):
                raise enospc()
        return real_replace(src, dst, *args, **kwargs)

    os.open, os.close, os.write, os.fsync, os.replace = f_open, f_close, f_write, f_fsync, f_replace
    if "uid" in counts:
        uid = counts.pop("uid")
        os.getuid = lambda: uid


def _load(action):
    if _state["lib"] is not None:
        return _state["lib"]
    path = action.get("lib")
    if not isinstance(path, str):
        _usage("the action names no lib")
    try:
        spec = importlib.util.spec_from_file_location("ccgpt_auth", path)
        mod = importlib.util.module_from_spec(spec)
        sys.modules["ccgpt_auth"] = mod
        spec.loader.exec_module(mod)
    except BaseException as e:  # noqa: B902 — report any load failure, then stop
        _emit({"op": "load", "error": "load-failed", "class": type(e).__name__, "message": str(e)})
        sys.exit(3)
    for name, value in (action.get("consts") or {}).items():
        if not hasattr(mod, name):
            _usage("the library defines no constant " + name)
        setattr(mod, name, value)
    _install_faults(mod, action.get("faults") or [])
    _state["lib"] = mod
    return mod


def _kw(op, **names):
    """The keyword arguments an op names, and ONLY those: an argument the op leaves out is not passed at all, so the
    library's own default (None, resolved to its module constant at call time) is what runs."""
    return {py: op[js] for js, py in names.items() if js in op}


def _run(op, action, auth_dir, extra):
    name = op.get("op")
    if name == "env":
        return {"result": os.environ.get(op["name"])}
    if name == "wait":
        deadline = None if op.get("timeoutMs") is None else time.monotonic() + op["timeoutMs"] / 1000.0
        while not os.path.lexists(op["path"]):
            if deadline is not None and time.monotonic() > deadline:
                raise TimeoutError("wait: " + op["path"] + " never appeared")
            time.sleep(0.01)
        return {"result": "present"}
    lib = _load(action)
    if name == "read":
        return lib.read(auth_dir)
    if name == "expired":
        return {"result": lib.expired(lib.read(auth_dir), **_kw(op, withinS="within_s", now="now"))}
    if name == "paths":
        return dict(lib.paths_for(auth_dir)._asdict())
    if name == "commit":
        with lib.held(auth_dir):
            return {"result": lib.commit_record(auth_dir, op["record"])}
    if name == "held-retry":
        with lib.held(auth_dir):
            return {"result": lib.retry_unsaved(auth_dir)}
    if name == "recover":
        with lib.held(auth_dir):
            return {"result": lib.recover_pending(auth_dir)}
    if name == "ensure_fresh":
        return lib.ensure_fresh(auth_dir, **_kw(op, withinS="within_s", lane="lane"))
    if name == "sign_in":
        out = io.StringIO()
        extra["out"] = out
        return {"result": lib.sign_in_device(auth_dir, lane=op.get("lane", "codex-a"), out=out,
                                             **_kw(op, timeoutS="timeout_s"))}
    if name == "hold":
        with lib.held(auth_dir):
            if op.get("touch"):
                with open(op["touch"], "w"):
                    pass
            time.sleep(op.get("ms", 0) / 1000.0)
        return {"result": "released"}
    if name == "reenter":
        with lib.held(auth_dir):
            with lib.held(auth_dir):
                pass
        return {"result": "entered-twice"}
    if name == "status":
        return {"result": lib.status_report(auth_dir)}
    if name == "main":
        out, err = io.StringIO(), io.StringIO()
        extra["out"], extra["err"] = out, err
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                rc = lib.main(list(op["argv"]))
            except SystemExit as e:
                rc = e.code if isinstance(e.code, int) else 1
        return {"rc": rc, "stdout": out.getvalue(), "stderr": err.getvalue()}
    _usage("unknown op " + json.dumps(name))


def main():
    if len(sys.argv) != 2:
        _usage("one JSON action argument")
    try:
        action = json.loads(sys.argv[1])
    except ValueError:
        _usage("the action is not JSON")
    if not isinstance(action, dict) or not isinstance(action.get("ops"), list):
        _usage("the action has no ops list")
    if action.get("umask") is not None:
        os.umask(int(action["umask"]))
    if action.get("faults"):
        _load(action)
    auth_dir = action.get("authDir")
    raised = False
    for op in action["ops"]:
        start = time.monotonic()
        extra = {}
        line = {"op": op.get("op")}
        try:
            value = _run(op, action, op.get("authDir", auth_dir), extra)
            if _is_reading(value):
                line.update(_reading_json(value))
            else:
                line.update(value)
        except Exception as e:  # noqa: B902 — every op's failure is a line, and the run goes on
            raised = True
            word = getattr(e, "word", None)
            line.update({"error": word if isinstance(word, str) else type(e).__name__,
                         "class": type(e).__name__, "message": str(e)})
            for key, buf in extra.items():
                line[key] = buf.getvalue()
        line["ms"] = round((time.monotonic() - start) * 1000.0, 1)
        _emit(line)
    sys.exit(1 if raised else 0)


if __name__ == "__main__":
    main()

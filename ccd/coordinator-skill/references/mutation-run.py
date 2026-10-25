#!/usr/bin/env python3
"""mutation-run.py: mutation testing that leaves nothing on disk and runs only what it must.

Stdlib only. Ships inside the coordinator skill's references (so every home that has
the skill has the helper; the worker skill points at the same copy).

    mutation-run.py --module PATH --tests FILE.py:FUNC --mutations FILE.json
                    [--out RESULTS.json] [--previous RESULTS.json --diff FILE.diff]
                    [--no-coverage] [--timeout SECONDS] [--tmp-root DIR]

--tests names a Python file and a function in it. FUNC(module) receives the module
under test and returns a mapping {test name: zero-argument callable}; a callable that
raises has failed. The same function is called once for the unmutated module (the
baseline, which must pass) and once per mutant.

--mutations is a JSON list of {"id": str, "old": str, "new": str}. `old` must occur
exactly once in the module source, else the mutant is reported `invalid`.

What it does differently from writing mutant files:
  * a mutant is compiled in memory and executed into a fresh module object, no file;
  * each mutant's tests run with cwd and the temp dir set to a private
    TemporaryDirectory (under /dev/shm when it exists, else the session's temp dir)
    that is removed after the mutant, on failure and on interrupt alike;
  * one traced baseline run maps every test to the module lines it executes, and a
    mutant runs only the tests that execute its lines (none: `uncovered`);
  * with --previous and --diff, a mutant whose lines the diff did not touch keeps
    its previous result (`carried`) and is not run.

One line per mutant: `<id>\\t<status>\\t<detail>`, then a summary line. Statuses:
killed, survived, uncovered, invalid, carried. Exit 0 when nothing survived or went
uncovered, 1 otherwise, 2 when the baseline fails or the input is unusable.
"""
import argparse
import importlib.util
import json
import os
import re
import signal
import sys
import tempfile
import types


def pick_root(override=None):
    """RAM-backed root when the box has one, else the session's own temp dir."""
    if override:
        return override
    shm = "/dev/shm"
    if os.path.isdir(shm) and os.access(shm, os.W_OK | os.X_OK):
        return shm
    return tempfile.gettempdir()


def load_entry(spec):
    path, _, func = spec.rpartition(":")
    if not path or not func:
        raise SystemExit("--tests must be FILE.py:FUNC")
    s = importlib.util.spec_from_file_location("_mutation_tests", path)
    mod = importlib.util.module_from_spec(s)
    s.loader.exec_module(mod)
    return getattr(mod, func)


def build_module(name, filename, source):
    """Compile `source` as if it lived at `filename` and execute it into a new module object."""
    code = compile(source, filename, "exec")
    mod = types.ModuleType(name)
    mod.__file__ = filename
    sys.modules[name] = mod
    exec(code, mod.__dict__)
    return mod


class _Timeout(Exception):
    pass


def _alarm(signum, frame):
    raise _Timeout()


def run_tests(entry, mod, names, root, timeout):
    """Run the named tests (None: all) in a private temp dir; return the failing test name or None.

    The temp dir is removed in `finally`, so a failing test, a timeout, a KeyboardInterrupt
    and a SIGTERM (turned into SystemExit by main) all clean up.
    """
    old_cwd, old_tmp = os.getcwd(), tempfile.tempdir
    old_env = {k: os.environ.get(k) for k in ("TMPDIR", "TEMP", "TMP")}
    old_alarm = signal.signal(signal.SIGALRM, _alarm)
    try:
        with tempfile.TemporaryDirectory(prefix="mut-", dir=root) as tmp:
            try:
                os.chdir(tmp)
                tempfile.tempdir = tmp
                for k in old_env:
                    os.environ[k] = tmp
                tests = entry(mod)
                for name, fn in tests.items():
                    if names is not None and name not in names:
                        continue
                    signal.alarm(timeout)
                    try:
                        fn()
                    except _Timeout:
                        return name + " (timeout)"
                    except Exception:  # noqa: BLE001 - any failure kills the mutant
                        return name
                    finally:
                        signal.alarm(0)
                return None
            finally:
                os.chdir(old_cwd)
                tempfile.tempdir = old_tmp
                for k, v in old_env.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v
    finally:
        signal.signal(signal.SIGALRM, old_alarm)


def trace_baseline(entry, mod, filename, root):
    """One run of every test under settrace: {test name: set of executed lines of the module}."""
    cov = {}
    tests = entry(mod)
    for name, fn in tests.items():
        lines = set()

        def local(frame, event, arg, lines=lines):
            if event == "line":
                lines.add(frame.f_lineno)
            return local

        def glob(frame, event, arg):
            if frame.f_code.co_filename == filename:
                lines.add(frame.f_lineno)
                return local
            return None

        with tempfile.TemporaryDirectory(prefix="mut-", dir=root) as tmp:
            old_cwd = os.getcwd()
            os.chdir(tmp)
            sys.settrace(glob)
            try:
                fn()
            except Exception:  # noqa: BLE001 - a failing baseline test is reported by the caller
                lines.add(-1)
            finally:
                sys.settrace(None)
                os.chdir(old_cwd)
        cov[name] = lines
    return cov


def span_of(source, old):
    """(first, last) 1-based lines covered by `old`, or None unless it occurs exactly once."""
    if source.count(old) != 1:
        return None
    start = source.index(old)
    first = source.count("\n", 0, start) + 1
    return first, first + old.count("\n")


def changed_lines(diff_text, module_path):
    """New-file line numbers a unified diff touches in the file whose path ends like module_path."""
    want = os.path.basename(module_path)
    out, current = set(), False
    new_line = 0
    for line in diff_text.splitlines():
        if line.startswith("+++ "):
            current = os.path.basename(line[4:].split("\t")[0].strip()) == want
            continue
        m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
        if m:
            new_line = int(m.group(1))
            continue
        if not current or line.startswith("---"):
            continue
        if line.startswith("+"):
            out.add(new_line)
            new_line += 1
        elif line.startswith("-"):
            out.add(new_line)  # a deletion touches the line now at that spot
        elif line.startswith(" "):
            new_line += 1
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--module", required=True)
    ap.add_argument("--tests", required=True)
    ap.add_argument("--mutations", required=True)
    ap.add_argument("--out")
    ap.add_argument("--previous")
    ap.add_argument("--diff")
    ap.add_argument("--no-coverage", action="store_true")
    ap.add_argument("--timeout", type=int, default=60)
    ap.add_argument("--tmp-root")
    a = ap.parse_args(argv)

    def _term(signum, frame):
        raise SystemExit(143)

    signal.signal(signal.SIGTERM, _term)

    filename = os.path.abspath(a.module)
    with open(filename, encoding="utf-8") as f:
        source = f.read()
    with open(a.mutations, encoding="utf-8") as f:
        mutations = json.load(f)
    entry = load_entry(a.tests)
    root = pick_root(a.tmp_root)
    name = os.path.splitext(os.path.basename(filename))[0]

    saved = sys.modules.get(name)
    try:
        base = build_module(name, filename, source)
        failed = run_tests(entry, base, None, root, a.timeout)
        if failed:
            print("baseline fails: " + failed, file=sys.stderr)
            return 2
        cov = None if a.no_coverage else trace_baseline(entry, base, filename, root)

        previous = {}
        touched = None
        if a.previous and a.diff:
            with open(a.previous, encoding="utf-8") as f:
                previous = {r["id"]: r for r in json.load(f)}
            with open(a.diff, encoding="utf-8") as f:
                touched = changed_lines(f.read(), filename)

        results = []
        for m in mutations:
            mid, old, new = m["id"], m["old"], m["new"]
            span = span_of(source, old)
            if span is None:
                results.append({"id": mid, "status": "invalid", "detail": "old text must occur exactly once"})
                continue
            lines = set(range(span[0], span[1] + 1))
            prev = previous.get(mid)
            if touched is not None and prev and prev.get("old") == old and prev.get("new") == new \
                    and not (lines & touched):
                results.append({"id": mid, "status": "carried", "detail": prev["status"],
                                "old": old, "new": new, "lines": [span[0], span[1]]})
                continue
            names = None
            if cov is not None:
                names = {t for t, ls in cov.items() if ls & lines}
                if not names:
                    results.append({"id": mid, "status": "uncovered", "detail": "no test executes these lines",
                                    "old": old, "new": new, "lines": [span[0], span[1]]})
                    continue
            mutant_src = source.replace(old, new, 1)
            try:
                mod = build_module(name, filename, mutant_src)
            except Exception as e:  # noqa: BLE001 - a mutant that will not even load is dead
                results.append({"id": mid, "status": "killed", "detail": "load: " + type(e).__name__,
                                "old": old, "new": new, "lines": [span[0], span[1]]})
                continue
            failed = run_tests(entry, mod, names, root, a.timeout)
            results.append({"id": mid, "status": "killed" if failed else "survived",
                            "detail": failed or "", "old": old, "new": new, "lines": [span[0], span[1]]})
    finally:
        if saved is not None:
            sys.modules[name] = saved
        else:
            sys.modules.pop(name, None)

    for r in results:
        print("%s\t%s\t%s" % (r["id"], r["status"], r["detail"]))
    counts = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print("summary: " + " ".join("%s=%d" % kv for kv in sorted(counts.items())) + " total=%d" % len(results))
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=1)
    bad = counts.get("survived", 0) + counts.get("uncovered", 0)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

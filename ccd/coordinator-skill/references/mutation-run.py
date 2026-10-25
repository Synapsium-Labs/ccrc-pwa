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
exactly once in the module source, else the mutant is reported `invalid` (and the run
exits 2: an invalid mutation is unusable input, not a pass).

What it does differently from writing mutant files:
  * a mutant is compiled in memory and executed into a fresh module object, no file;
  * each mutant's tests run with cwd and the temp dir set to a private
    TemporaryDirectory (under /dev/shm when it exists, else the session's temp dir)
    that is removed after the mutant, on failure and on interrupt alike;
  * one traced baseline run maps every test to the module lines it executes, and a
    mutant runs only the tests that execute its lines (none: `uncovered`);
  * with --previous and --diff, a mutant whose lines the diff did not touch keeps
    its previous killed result (`carried`) and is not run; survivors and uncovered mutants
    always re-run, and a diff touching the tests file re-runs everything.

One line per mutant, printed as it is produced: `<id>\\t<status>\\t<detail>`, then a
summary line. Statuses: killed, survived, uncovered, invalid, carried. Exit 0 when nothing
survived or went uncovered, 1 otherwise, 2 when the baseline fails or the input is
unusable (unreadable or malformed --mutations, an entry without string id/old/new, a
missing --module/--tests, or any `invalid` mutation), with one line on stderr for the
input errors. SIGTERM exits 143 and writes the results so far to --out as
{"partial": true, "results": [...]}; SIGINT exits 130 and writes no --out. Neither
interrupt is ever counted as a mutant's kill.
"""
import argparse
import contextlib
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


class _Unusable(Exception):
    """Input the helper cannot run from; reported as one line, exit 2."""


def load_entry(spec):
    path, _, func = spec.rpartition(":")
    if not path or not func:
        raise _Unusable("--tests must be FILE.py:FUNC")
    if not os.path.isfile(path):
        raise _Unusable("--tests file not found: " + path)
    s = importlib.util.spec_from_file_location("_mutation_tests", path)
    if s is None or s.loader is None:
        raise _Unusable("--tests file is not loadable Python: " + path)
    mod = importlib.util.module_from_spec(s)
    try:
        s.loader.exec_module(mod)
    except Exception as e:
        raise _Unusable("--tests file failed to load: %s: %s" % (type(e).__name__, e))
    fn = getattr(mod, func, None)
    if not callable(fn):
        raise _Unusable("--tests names no function %s in %s" % (func, path))
    return fn


def load_mutations(path):
    """The --mutations list, validated: every entry needs string id, old and new."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        raise _Unusable("--mutations unreadable: %s" % e)
    if not isinstance(data, list):
        raise _Unusable("--mutations must be a JSON list")
    for i, m in enumerate(data):
        if not isinstance(m, dict) or not all(isinstance(m.get(k), str) for k in ("id", "old", "new")):
            raise _Unusable("--mutations entry %d needs string id, old and new" % i)
    return data


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


@contextlib.contextmanager
def sandbox(root):
    """Private temp dir with cwd, tempfile.tempdir and TMPDIR/TEMP/TMP pointed at it.

    Everything is restored and the dir removed on exit, on failure and on interrupt alike,
    so a test (or an import) that calls mkdtemp leaves nothing in the session's temp dir.
    """
    old_cwd, old_tmp = os.getcwd(), tempfile.tempdir
    old_env = {k: os.environ.get(k) for k in ("TMPDIR", "TEMP", "TMP")}
    try:
        with tempfile.TemporaryDirectory(prefix="mut-", dir=root) as tmp:
            try:
                os.chdir(tmp)
                tempfile.tempdir = tmp
                for k in old_env:
                    os.environ[k] = tmp
                yield tmp
            finally:
                os.chdir(old_cwd)
    finally:
        tempfile.tempdir = old_tmp
        for k, v in old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class _Terminated(BaseException):
    """The helper itself was asked to stop (SIGTERM or SIGINT); never mistaken for a mutant's exit."""

    def __init__(self, signum):
        super().__init__(signum)
        self.signum = signum


# whatever a mutant does, it is not the helper's end. KeyboardInterrupt is not here: SIGINT
# is the operator stopping the run, raised as _Terminated, and must never read as a kill.
_KILLS = (Exception, SystemExit)


def run_tests(entry, build, names, root, timeout):
    """Build the module and run the named tests (None: all) in one sandbox.

    `build()` returns the module. Import, fixture setup and tests all run under the sandbox
    and the per-call alarm. Returns the failing test name (or a `load:` / `(exit)` /
    `(timeout)` note) or None when everything passed.
    """
    old_alarm = signal.signal(signal.SIGALRM, _alarm)
    try:
        with sandbox(root):
            signal.alarm(timeout)
            try:
                mod = build()
                tests = entry(mod)
            except _Timeout:
                return "load (timeout)"
            except _Terminated:
                raise
            except _KILLS as e:
                return "load: " + type(e).__name__
            finally:
                signal.alarm(0)
            for name, fn in tests.items():
                if names is not None and name not in names:
                    continue
                signal.alarm(timeout)
                try:
                    fn()
                except _Timeout:
                    return name + " (timeout)"
                except _Terminated:
                    raise
                except SystemExit:
                    return name + " (exit)"
                except _KILLS:  # any failure kills the mutant
                    return name
                finally:
                    signal.alarm(0)
            return None
    finally:
        signal.signal(signal.SIGALRM, old_alarm)


def _traced(call, filename):
    """Run call() under settrace; return (lines of `filename` executed, result or None)."""
    lines = set()

    def local(frame, event, arg):
        if event == "line":
            lines.add(frame.f_lineno)
        return local

    def glob(frame, event, arg):
        if frame.f_code.co_filename == filename:
            lines.add(frame.f_lineno)
            return local
        return None

    sys.settrace(glob)
    try:
        return lines, call()
    except _Terminated:
        raise
    except _KILLS:  # a failing baseline test is reported by the caller
        lines.add(-1)
        return lines, None
    finally:
        sys.settrace(None)


def trace_baseline(entry, name, filename, source, root):
    """One traced run: ({test name: executed lines of the module}, lines no single test owns).

    The module build and the entry function's fixture setup are traced too, inside the same
    sandbox as the tests, so lines that run at import or setup (constants, tables, class
    bodies, `load_table()` before the dict is returned) are not misread as covered by no test.
    """
    cov = {}
    with sandbox(root):
        shared, mod = _traced(lambda: build_module(name, filename, source), filename)
        lines, tests = _traced(lambda: entry(mod), filename)
        shared |= lines
        for tname, fn in (tests or {}).items():
            cov[tname], _ = _traced(fn, filename)
    return cov, shared


def span_of(source, old):
    """(first, last) 1-based lines covered by `old`, or None unless it occurs exactly once."""
    if source.count(old) != 1:
        return None
    start = source.index(old)
    first = source.count("\n", 0, start) + 1
    return first, first + old.count("\n")


_HUNK = re.compile(r"@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def changed_lines(diff_text, module_path):
    """New-file line numbers a unified diff touches in the file whose path ends like module_path.

    Inside a hunk its @@ counts decide what each line is, so an empty line (a context line
    whose trailing space was stripped) is context and a line reading `--- ` or `+++ ` is
    content; file headers are only read between hunks.
    """
    want = os.path.basename(module_path)
    out, current = set(), False
    new_line = old_left = new_left = 0
    for line in diff_text.splitlines():
        if old_left > 0 or new_left > 0:
            if line.startswith("+"):
                if current:
                    out.add(new_line)
                new_line += 1
                new_left -= 1
            elif line.startswith("-"):
                if current:
                    out.add(new_line)  # a deletion touches the line now at that spot
                old_left -= 1
            elif line.startswith("\\"):
                pass  # "\ No newline at end of file"
            else:  # " text" or an empty line: context on both sides
                new_line += 1
                old_left -= 1
                new_left -= 1
            continue
        if line.startswith("+++ "):
            current = os.path.basename(line[4:].split("\t")[0].strip()) == want
            continue
        m = _HUNK.match(line)
        if m:
            old_left = int(m.group(1)) if m.group(1) is not None else 1
            new_line = int(m.group(2))
            new_left = int(m.group(3)) if m.group(3) is not None else 1
    return out


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        print("mutation-run: " + message, file=sys.stderr)
        raise SystemExit(2)


def _emit(r):
    print("%s\t%s\t%s" % (r["id"], r["status"], r["detail"]), flush=True)


def main(argv=None):
    ap = _Parser(description=__doc__.split("\n")[0])
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
        raise _Terminated(signum)

    signal.signal(signal.SIGTERM, _term)
    signal.signal(signal.SIGINT, _term)

    filename = os.path.abspath(a.module)
    try:
        try:
            with open(filename, encoding="utf-8") as f:
                source = f.read()
        except OSError as e:
            raise _Unusable("--module unreadable: %s" % e)
        mutations = load_mutations(a.mutations)
        entry = load_entry(a.tests)
    except _Unusable as e:
        print("mutation-run: %s" % e, file=sys.stderr)
        return 2
    except _Terminated as t:  # stopped while loading: no results exist yet
        return 130 if t.signum == signal.SIGINT else 143
    root = pick_root(a.tmp_root)
    name = os.path.splitext(os.path.basename(filename))[0]

    saved = sys.modules.get(name)
    results = []
    try:
        failed = run_tests(entry, lambda: build_module(name, filename, source), None, root, a.timeout)
        if failed:
            print("baseline fails: " + failed, file=sys.stderr)
            return 2
        cov, import_lines = (None, set()) if a.no_coverage else trace_baseline(entry, name, filename, source, root)

        previous = {}
        touched = None
        if a.previous and a.diff:
            with open(a.previous, encoding="utf-8") as f:
                prev_data = json.load(f)
            if isinstance(prev_data, dict):  # a partial run's {"partial": true, "results": [...]}
                prev_data = prev_data.get("results", [])
            previous = {r["id"]: r for r in prev_data}
            with open(a.diff, encoding="utf-8") as f:
                diff_text = f.read()
            touched = changed_lines(diff_text, filename)
            if changed_lines(diff_text, a.tests.rpartition(":")[0]):
                touched = None  # the tests changed: every earlier result is stale

        for m in mutations:
            mid, old, new = m["id"], m["old"], m["new"]
            span = span_of(source, old)
            if span is None:
                results.append({"id": mid, "status": "invalid", "detail": "old text must occur exactly once"})
                _emit(results[-1])
                continue
            lines = set(range(span[0], span[1] + 1))
            prev = previous.get(mid)
            prev_outcome = prev and prev.get("outcome", prev["status"])
            # survivors and uncovered mutants are few and cheap: always re-run them
            if touched is not None and prev and prev.get("old") == old and prev.get("new") == new \
                    and prev_outcome == "killed" and not (lines & touched):
                results.append({"id": mid, "status": "carried", "outcome": prev_outcome, "detail": prev_outcome,
                                "old": old, "new": new, "lines": [span[0], span[1]]})
                _emit(results[-1])
                continue
            names = None
            if cov is not None:
                names = None if lines & import_lines else {t for t, ls in cov.items() if ls & lines}
                if names is not None and not names:
                    results.append({"id": mid, "status": "uncovered", "detail": "no test executes these lines",
                                    "old": old, "new": new, "lines": [span[0], span[1]]})
                    _emit(results[-1])
                    continue
            mutant_src = source.replace(old, new, 1)
            failed = run_tests(entry, lambda src=mutant_src: build_module(name, filename, src), names, root, a.timeout)
            results.append({"id": mid, "status": "killed" if failed else "survived",
                            "detail": failed or "", "old": old, "new": new, "lines": [span[0], span[1]]})
            _emit(results[-1])
    except _Terminated as t:
        if t.signum == signal.SIGINT:
            return 130  # the operator stopped it: nothing here is a result to keep
        if a.out:
            with open(a.out, "w", encoding="utf-8") as f:
                json.dump({"partial": True, "results": results}, f, indent=1)
        return 143
    finally:
        if saved is not None:
            sys.modules[name] = saved
        else:
            sys.modules.pop(name, None)

    counts = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print("summary: " + " ".join("%s=%d" % kv for kv in sorted(counts.items())) + " total=%d" % len(results))
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=1)
    if any(r["status"] == "invalid" for r in results):
        return 2
    bad = sum(1 for r in results if r.get("outcome", r["status"]) in ("survived", "uncovered"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

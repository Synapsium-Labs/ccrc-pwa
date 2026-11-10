#!/usr/bin/env python3
"""The Codex bridge watch's instrument (plan 2026-11-10 codex-bridge Stage 4, Task 0). READ-ONLY.

Run by hand on the fleet box, as the fleet user, once per lane. It takes the five readings that decide whether a
lane leaves LiteLLM (codex-bridge spec 2026-10-15 §2.8; the Stage 2 plan's operator runbook, step 5) and prints each
as `pass`, `fail` or `unmeasured` with its numbers. It opens every file read-only, writes nothing, and runs no other
program.

    python3 -I deploy/measure-codex-watch.py --lane lane-b --flip 2026-10-27T06:26:03Z
    python3 -I deploy/measure-codex-watch.py --lane lane-b --flip 2026-10-27T06:26:03Z \\
        --baseline-since 2026-10-22T10:48:00Z --json

`--flip` is when the lane went `direct`. The baseline window is [`--baseline-since`, flip), seven days by default; the
watch window is [flip, `--until`), up to now by default. Stamps are UTC, `YYYY-MM-DDTHH:MM[:SS]Z`. `--home` is the
home to read (default: this user's). `--now` (epoch seconds) pins the clock for the test suite.

WHAT IT READS, AND NOTHING ELSE:
  <home>/.ccrc/codex/<lane>/lane.json            the mode, the config directory, the auth directory, the stats name
  <home>/.ccrc/codex/<lane>/<stats name>         the bridge's stats file, version 1 (ccd/codexbridge/stats.py),
                                                 under the name lane.json gives it
  <home>/<auth directory>/                       the auth library's non-secret status, through that library's own
                                                 `read_status` (ccd/ccgpt-auth.py, loaded from this tree). It stats
                                                 the credential to tell a current status from a stale one, and
                                                 never opens it.
  <home>/.ccrc/logs/codex/<lane>/litellm.log     the LiteLLM tier's log: access lines only, method, path and status
  <home>/.claude*/projects/**/*.jsonl            transcripts. From a row: `type`, `subtype`, `timestamp`, `uuid`,
                                                 `isApiErrorMessage`, `compactMetadata.trigger`, `message.id` and
                                                 `message.model`. Never a row's text.

WHAT LEAVES: counts, rates, stamps, model names, the lane id and its mode, the status file's state and last error
code, and the names the bridge's drift counters hold (bounded by the bridge when it wrote them, bounded again here).
No session id, path below the home, prompt, request id or account identity is printed
(`measure-codex-watch.test.ts` pins it with sentinels).

THE FIVE CRITERIA:
  empty-tool-calls  `outcomes.emptyArguments` is 0.
  5xx-rate          `outcomes.5xx` over the requests the bridge answered (`2xx` + `4xx` + `5xx`), against the 5xx
                    share of the POST lines in litellm.log. `client-gone` and `drain-cut` are shown and are not in
                    the rate (they are not upstream failures). The stats file counts from its `since`, which the
                    report prints: it is the whole time on `direct`, not one week of it. The log has no stamps, so
                    its share is over the whole file.
  compaction-rate   automatic `compact_boundary` rows over assistant calls, in the baseline window against the watch
                    window, for rows a GPT model answered, in transcripts under the lane's config directory. A call
                    is counted once by its `message.id`, a boundary once by its `uuid`, and a boundary belongs to
                    the model that answered last before it in its file. The same figures for every config directory
                    under the home are printed beside it (`box`): a session carried between lanes keeps its rows.
  credential        the status file reads `ok`, carries no last error code, and its token has not expired. This is
                    one moment, not the week: whether it stayed so is the doctor's history and the operator's.
  drift             every family's `unexplained` list in the stats file is empty.

UNMEASURED IS NEVER PASS. A file that is absent, unreadable or of another shape, a log with no access line and a
window with no call each read `unmeasured`, with the reason. The lane's verdict is `fail` when any criterion fails,
else `unmeasured` when any is unmeasured, else `pass`.
"""
import argparse
import calendar
import glob
import importlib.util
import json
import os
import re
import sys
import time

LANE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
STAMP_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z$")
NAME_RE = re.compile(r"^[A-Za-z0-9_.:/<>-]{1,64}$")   # a model, a family, a counter's name: printed only when bounded
REL_RE = re.compile(r"^[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*$")   # a path below the home, as lane.json names one
ACCESS_RE = re.compile(r'"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \S+ HTTP/[0-9.]+" ([1-5][0-9]{2})\b')
ROW_STAMP_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$")
STATS_VERSION = 1
OTHER = "other"
# The auth library of the tree this instrument ships in. Its file names are the library's own
# (single-definition/late-census.test.ts), so the status is read through it and no name is spelled here.
AUTH_LIBRARY = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "ccd", "ccgpt-auth.py")


class Refusal(Exception):
    """A request this instrument cannot serve: exit 2, one line on stderr, nothing on stdout."""


def stamp(text):
    m = STAMP_RE.match(text or "")
    if not m:
        raise Refusal("not a UTC stamp (YYYY-MM-DDTHH:MM[:SS]Z): %r" % (text,))
    y, mo, d, h, mi, s = (int(g) if g is not None else 0 for g in m.groups())
    try:
        return calendar.timegm((y, mo, d, h, mi, s, 0, 0, 0))
    except (ValueError, OverflowError):
        raise Refusal("not a UTC stamp (YYYY-MM-DDTHH:MM[:SS]Z): %r" % (text,))


def iso(epoch):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))


def row_epoch(value):
    m = ROW_STAMP_RE.match(value) if isinstance(value, str) else None
    if not m:
        return None
    try:
        return calendar.timegm(tuple(int(g) for g in m.groups()) + (0, 0, 0))
    except (ValueError, OverflowError):
        return None


def read_json(path):
    """(object, None) or (None, why): absent, unreadable, or not a JSON object."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
    except FileNotFoundError:
        return None, "absent"
    except (OSError, UnicodeError):
        return None, "unreadable"
    except (ValueError, RecursionError):
        return None, "not JSON"
    if not isinstance(obj, dict):
        return None, "not a JSON object"
    return obj, None


def count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def bounded(name):
    return name if isinstance(name, str) and NAME_RE.match(name) else OTHER


def rate(part, whole):
    return round(part / whole, 6) if whole > 0 else None


# ── the lane ───────────────────────────────────────────────────────────────────────────────────────────────────────
def read_lane(home, lane):
    path = os.path.join(home, ".ccrc", "codex", lane, "lane.json")
    obj, why = read_json(path)
    if obj is None:
        raise Refusal("~/.ccrc/codex/%s/lane.json is %s, so this is not a codex lane this instrument can read. "
                      "'ccrc codex status %s' says what the lane is." % (lane, why, lane))
    out = {"mode": bounded(obj.get("bridge")), "configDir": None, "authDir": None, "stats": None}
    for key in ("configDir", "authDir"):
        value = obj.get(key)
        if isinstance(value, str) and REL_RE.match(value) and ".." not in value.split("/"):
            out[key] = value
    files = obj.get("bridgeFiles")
    name = files.get("stats") if isinstance(files, dict) else None
    if isinstance(name, str) and REL_RE.match(name) and "/" not in name:
        out["stats"] = name
    return out


# ── the bridge's stats file ────────────────────────────────────────────────────────────────────────────────────────
def read_stats(home, lane, name):
    if name is None:
        return None, "lane.json names no stats file"
    obj, why = read_json(os.path.join(home, ".ccrc", "codex", lane, name))
    if obj is None:
        return None, "the stats file is " + why
    if obj.get("version") != STATS_VERSION:
        return None, "the stats file is not version %d" % STATS_VERSION
    if obj.get("lane") != lane:
        return None, "the stats file names another lane"
    return obj, None


def bridge_section(st):
    outcomes = st.get("outcomes") if isinstance(st.get("outcomes"), dict) else {}
    routes = st.get("routes") if isinstance(st.get("routes"), dict) else {}
    unexplained = st.get("unexplained") if isinstance(st.get("unexplained"), dict) else {}
    refusals = st.get("refusals") if isinstance(st.get("refusals"), dict) else {}
    store = st.get("store") if isinstance(st.get("store"), dict) else None
    shown = {}
    for key, value in outcomes.items():
        name = bounded(key)
        shown[name] = shown.get(name, 0) + count(value)
    names = {}
    for family, listed in unexplained.items():
        if isinstance(listed, list) and listed:
            names[bounded(family)] = sorted({bounded(n) for n in listed})
    return {
        "since": st.get("since") if row_epoch(st.get("since")) is not None else None,
        "updatedAt": st.get("updatedAt") if row_epoch(st.get("updatedAt")) is not None else None,
        "requests": sum(count(r.get("requests")) for r in routes.values() if isinstance(r, dict)),
        "answered": count(outcomes.get("2xx")) + count(outcomes.get("4xx")) + count(outcomes.get("5xx")),
        "outcomes": dict(sorted(shown.items())),
        "unexplained": dict(sorted(names.items())),
        "refusals": len(refusals),
        "store": bounded(store.get("state")) if store is not None else None,
    }


# ── the credential's status ────────────────────────────────────────────────────────────────────────────────────────
def read_auth_status(home, auth_dir):
    """(the status, None) or (None, why), through the auth library's `read_status`. Nothing is written: the library is
    loaded with bytecode off, and `read_status` neither writes nor locks."""
    if auth_dir is None:
        return None, "lane.json names no auth directory"
    was = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location("ccgpt_auth", AUTH_LIBRARY)
        if spec is None or spec.loader is None:
            return None, "the auth library beside this instrument did not load"
        lib = importlib.util.module_from_spec(spec)
        sys.modules["ccgpt_auth"] = lib
        spec.loader.exec_module(lib)
        status = lib.read_status(os.path.join(home, auth_dir))
    except Exception as e:   # a library that does not load, whatever the reason, is a reading not taken
        return None, "the auth library beside this instrument did not load (%s)" % type(e).__name__
    finally:
        sys.dont_write_bytecode = was
    if not isinstance(status, dict):
        return None, "the auth library reads no current status for this lane"
    return status, None


# ── the LiteLLM log ────────────────────────────────────────────────────────────────────────────────────────────────
def log_section(home, lane):
    """Access lines by method and status class, or None with why. Only the method and the status are kept."""
    path = os.path.join(home, ".ccrc", "logs", "codex", lane, "litellm.log")
    posts = five = lines = 0
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                m = ACCESS_RE.search(line)
                if not m:
                    continue
                lines += 1
                if m.group(1) == "POST":
                    posts += 1
                    if m.group(2).startswith("5"):
                        five += 1
    except FileNotFoundError:
        return None, "litellm.log is absent"
    except OSError:
        return None, "litellm.log is unreadable"
    if posts == 0:
        return None, "litellm.log holds no POST access line this reader recognises (%d access lines)" % lines
    return {"accessLines": lines, "posts": posts, "fiveXx": five, "rate": rate(five, posts)}, None


# ── transcripts ────────────────────────────────────────────────────────────────────────────────────────────────────
def is_gpt(model):
    return isinstance(model, str) and bool(model) and not model.startswith("claude") and not model.startswith("<")


def new_window():
    return {"calls": 0, "automatic": 0, "manual": 0, "apiErrors": 0, "models": {}}


class Tally:
    """One scope's counts: a call is counted once by its message id and a boundary once by its uuid."""

    def __init__(self, windows):
        self.out = {name: new_window() for name in windows}
        self.calls, self.rows = set(), set()

    def call(self, where, key, model):
        if key in self.calls:
            return
        self.calls.add(key)
        self.out[where]["calls"] += 1
        name = bounded(model)
        self.out[where]["models"][name] = self.out[where]["models"].get(name, 0) + 1

    def row(self, where, key, what):
        if key in self.rows:
            return
        self.rows.add(key)
        self.out[where][what] += 1

    def done(self):
        for counts in self.out.values():
            counts["models"] = dict(sorted(counts["models"].items()))
            counts["rate"] = rate(counts["automatic"], counts["calls"])
        return self.out


def scan(home, dirs, lane_dir, windows):
    """(the lane's counts or None, the box's counts), in one pass over every transcript under the config directories
    `dirs`. The lane's are the files under `lane_dir`; the box's are all of them. A boundary, and an API error row,
    belongs to the model that answered last before it in its own file."""
    box = Tally(windows)
    lane = Tally(windows) if lane_dir is not None else None
    for cfg in dirs:
        tallies = [box, lane] if lane is not None and cfg == lane_dir else [box]
        for path in sorted(glob.glob(os.path.join(home, cfg, "projects", "**", "*.jsonl"), recursive=True)):
            last_model = None
            try:
                f = open(path, "r", encoding="utf-8", errors="replace")
            except OSError:
                continue
            with f:
                for line in f:
                    # every row this reads names one of these two words; most of a transcript's bytes do not
                    if '"assistant"' not in line and "compact_boundary" not in line:
                        continue
                    try:
                        row = json.loads(line)
                    except (ValueError, RecursionError):
                        continue
                    if not isinstance(row, dict):
                        continue
                    kind = row.get("type")
                    where = window_of(row_epoch(row.get("timestamp")), windows)
                    uuid = row.get("uuid") if isinstance(row.get("uuid"), str) else None
                    if kind == "assistant":
                        msg = row.get("message") if isinstance(row.get("message"), dict) else {}
                        if row.get("isApiErrorMessage") is True:
                            if where and uuid and is_gpt(last_model):
                                for t in tallies:
                                    t.row(where, uuid, "apiErrors")
                            continue
                        model = msg.get("model")
                        if not isinstance(model, str) or not model or model.startswith("<"):
                            continue
                        last_model = model
                        key = msg.get("id") if isinstance(msg.get("id"), str) else uuid
                        if where and key and is_gpt(model):
                            for t in tallies:
                                t.call(where, key, model)
                    elif kind == "system" and row.get("subtype") == "compact_boundary":
                        if where and uuid and is_gpt(last_model):
                            meta = row.get("compactMetadata") if isinstance(row.get("compactMetadata"), dict) else {}
                            what = "manual" if meta.get("trigger") == "manual" else "automatic"
                            for t in tallies:
                                t.row(where, uuid, what)
    return (lane.done() if lane is not None else None), box.done()


def window_of(at, windows):
    if at is None:
        return None
    for name, (start, end) in windows.items():
        if start <= at < end:
            return name
    return None


def config_dirs(home):
    return sorted(os.path.basename(p) for p in glob.glob(os.path.join(home, ".claude*")) if os.path.isdir(p))


# ── the five criteria ──────────────────────────────────────────────────────────────────────────────────────────────
def criteria(mode, bridge, bridge_why, log, log_why, lane_tx, auth, auth_why, now):
    out = []

    def add(name, verdict, **fields):
        out.append(dict(name=name, verdict=verdict, **fields))

    # 1. empty tool calls
    if bridge is None:
        add("empty-tool-calls", "unmeasured", reason=bridge_why)
    else:
        n = bridge["outcomes"].get("emptyArguments", 0)
        add("empty-tool-calls", "pass" if n == 0 else "fail", emptyArguments=n)

    # 2. the 5xx rate
    if bridge is None:
        add("5xx-rate", "unmeasured", reason=bridge_why)
    else:
        five = bridge["outcomes"].get("5xx", 0)
        watch = {"fiveXx": five, "answered": bridge["answered"], "rate": rate(five, bridge["answered"])}
        extra = {"watch": watch, "clientGone": bridge["outcomes"].get("client-gone", 0),
                 "drainCut": bridge["outcomes"].get("drain-cut", 0), "since": bridge["since"]}
        if watch["rate"] is None:
            add("5xx-rate", "unmeasured", reason="the stats file counts no answered request", **extra)
        elif log is None:
            add("5xx-rate", "unmeasured", reason="no baseline: " + log_why, **extra)
        else:
            base = {"fiveXx": log["fiveXx"], "posts": log["posts"], "rate": log["rate"]}
            add("5xx-rate", "pass" if watch["rate"] <= base["rate"] else "fail", baseline=base, **extra)

    # 3. the compaction rate
    if lane_tx is None:
        add("compaction-rate", "unmeasured", reason="lane.json names no config directory")
    else:
        base, watch = lane_tx["baseline"], lane_tx["watch"]
        fields = {"baseline": base, "watch": watch}
        if base["rate"] is None or watch["rate"] is None:
            empty = "baseline" if base["rate"] is None else "watch"
            add("compaction-rate", "unmeasured", reason="no GPT-model call in the %s window" % empty, **fields)
        else:
            add("compaction-rate", "pass" if watch["rate"] <= base["rate"] else "fail", **fields)

    # 4. the credential
    if auth is None:
        add("credential", "unmeasured", reason=auth_why)
    else:
        state = auth.get("state")
        code = auth.get("lastErrorCode")
        expires = auth.get("expiresAt")
        refreshed = auth.get("lastRefreshAt")
        expires_in = int(expires - now) if isinstance(expires, (int, float)) and not isinstance(expires, bool) else None
        since = int(now - refreshed) if isinstance(refreshed, (int, float)) and not isinstance(refreshed, bool) else None
        ok = state == "ok" and code is None and expires_in is not None and expires_in > 0
        add("credential", "pass" if ok else "fail", state=bounded(state),
            lastErrorCode=bounded(code) if code is not None else None, expiresInSeconds=expires_in,
            sinceRefreshSeconds=since, mode=mode)

    # 5. drift
    if bridge is None:
        add("drift", "unmeasured", reason=bridge_why)
    else:
        add("drift", "pass" if not bridge["unexplained"] else "fail", unexplained=bridge["unexplained"])
    return out


def overall(items):
    verdicts = {c["verdict"] for c in items}
    if "fail" in verdicts:
        return "fail"
    return "unmeasured" if "unmeasured" in verdicts else "pass"


# ── printing ───────────────────────────────────────────────────────────────────────────────────────────────────────
def show(value):
    if isinstance(value, dict):
        return "{" + ", ".join("%s=%s" % (k, show(v)) for k, v in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ", ".join(show(v) for v in value) + "]"
    return "none" if value is None else str(value)


def text(rep):
    lines = ["lane: %s (%s)" % (rep["lane"], rep["mode"]),
             "baseline window: %s to %s" % tuple(rep["windows"]["baseline"]),
             "watch window: %s to %s" % tuple(rep["windows"]["watch"]),
             "verdict: %s" % rep["verdict"], ""]
    for c in rep["criteria"]:
        rest = ", ".join("%s=%s" % (k, show(v)) for k, v in c.items() if k not in ("name", "verdict"))
        lines.append("%s: %s%s" % (c["name"], c["verdict"], (" (" + rest + ")") if rest else ""))
    lines.append("")
    lines.append("bridge: %s" % show(rep["bridge"]))
    lines.append("litellm log: %s" % show(rep["litellmLog"]))
    for scope in ("lane", "box"):
        lines.append("transcripts, %s: %s" % (scope, show(rep["transcripts"][scope])))
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description="The Codex bridge watch's readings for one lane. Read-only.")
    ap.add_argument("--lane", required=True)
    ap.add_argument("--flip", required=True)
    ap.add_argument("--baseline-since")
    ap.add_argument("--until")
    ap.add_argument("--home", default=os.path.expanduser("~"))
    ap.add_argument("--now", type=float)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    try:
        if not LANE_RE.match(args.lane):
            raise Refusal("not a lane id: %r" % (args.lane,))
        now = args.now if args.now is not None else time.time()
        flip = stamp(args.flip)
        base = stamp(args.baseline_since) if args.baseline_since else flip - 7 * 86400
        until = stamp(args.until) if args.until else int(now)
        if not base < flip < until:
            raise Refusal("the windows are empty or out of order: baseline %s, flip %s, until %s"
                          % (iso(base), iso(flip), iso(until)))
        home = os.path.abspath(args.home)
        lane = read_lane(home, args.lane)
        windows = {"baseline": (base, flip), "watch": (flip, until)}

        st, bridge_why = read_stats(home, args.lane, lane["stats"])
        bridge = bridge_section(st) if st is not None else None
        log, log_why = log_section(home, args.lane)
        auth, auth_why = read_auth_status(home, lane["authDir"])
        lane_tx, box_tx = scan(home, config_dirs(home), lane["configDir"], windows)

        items = criteria(lane["mode"], bridge, bridge_why, log, log_why, lane_tx, auth, auth_why, now)
        rep = {
            "lane": args.lane, "mode": lane["mode"],
            "windows": {name: [iso(a), iso(b)] for name, (a, b) in windows.items()},
            "verdict": overall(items), "criteria": items,
            "bridge": bridge if bridge is not None else {"unmeasured": bridge_why},
            "litellmLog": log if log is not None else {"unmeasured": log_why},
            "transcripts": {"lane": lane_tx if lane_tx is not None else {"unmeasured": "no config directory"},
                            "box": box_tx},
        }
    except Refusal as e:
        sys.stderr.write("measure-codex-watch: %s\n" % e)
        return 2
    sys.stdout.write(json.dumps(rep, indent=1) + "\n" if args.json else text(rep))
    return 0


if __name__ == "__main__":
    sys.exit(main())

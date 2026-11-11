#!/usr/bin/env python3
"""The Codex bridge watch's instrument (plan 2026-11-10 codex-bridge Stage 4, Task 0). READ-ONLY.

Run by hand on the fleet box, as the fleet user, once per lane. It takes the five readings that decide whether a
lane leaves LiteLLM (codex-bridge spec 2026-10-15 §2.8: "no worse than its own LiteLLM baseline, no credential
incident, and no unexplained new name"; the Stage 2 plan's operator runbook, step 5) and prints each as `pass`,
`fail` or `unmeasured` with its numbers. It opens every file read-only, writes nothing, and runs no other program.
Every comparison is like for like: the same kind of request on both sides, the same context window, the main thread.

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
  <home>/.ccrc/models/<lane>.advance.json        the class advances (shared/model-advance.mjs; written by
                                                 deploy/models-op.mjs): each `classes.<class>.history[]` entry's
                                                 `at`, `how`, `from`, `to` and `ok`. Never its `reason`.
  <home>/.ccrc/models/<lane>.windows.json        the measured windows (shared/models.mjs `parseWindows`; written by
                                                 deploy/models-op.mjs): each entry's `tokens`, `setAt` and `source`
  <home>/.claude*/projects/**/*.jsonl            transcripts. From a row: `type`, `subtype`, `timestamp`, `uuid`,
                                                 `isSidechain`, `isApiErrorMessage`, `version`,
                                                 `compactMetadata.trigger`, `compactMetadata.preTokens`,
                                                 `message.id` and `message.model`. Never a row's text.

WHAT LEAVES: counts, rates, statistics, stamps, model and class names, Claude Code version numbers, the lane id and
its mode, the status file's state and last error code, the store's outcome names, and the names the bridge's drift
counters hold (bounded by the bridge when it wrote them, bounded again here). No session id, uuid, path below the
home, prompt, request id, advance reason or account identity is printed (`measure-codex-watch.test.ts` pins it with
sentinels).

EVENTS. Every class advance (advance, revert or hand move) and every measured window (`window`, or `lowering` when
its source is a refusal, D25) stamped in [baseline-since, until) is printed with its stamp, kind, class or model and
from/to, in the report's `events`, because each may change the context window Claude Code runs under. The windows
file keeps only each model's latest entry, so it shows the last set of each window, never every one. An event in
(baseline-since, flip) cuts the baseline: the COMPARABLE baseline is [the last such event, flip). An event in the
watch is printed as a warning and cuts nothing.

THE FIVE CRITERIA:
  empty-tool-calls  `outcomes.emptyArguments` is 0.
  5xx-rate          5xx / (2xx + 5xx) on both sides. Watch: the stats file's `outcomes`, counted from its `since`,
                    which the report prints: the whole time on `direct`, not one week of it. Baseline: the POST lines
                    of litellm.log whose path, its query string stripped, is exactly /v1/messages; count_tokens POSTs
                    are counted apart and printed, never in the rate, because the bridge answers count_tokens itself
                    (`outcomes.countTokens`, outside 2xx). 4xx is printed and kept out of both rates (local refusals
                    and client errors: a refused model name on either tier). `client-gone` and `drain-cut` are
                    printed and are not upstream failures. The log has no stamps, so its share is over the whole
                    file. The test is exact and one-sided: p = P(X >= x_w), X ~ Binomial(x_b + x_w, n_w / (n_w +
                    n_b)), the conditional binomial; both rates carry exact (Clopper-Pearson) 95% intervals, and
                    their ratio is printed. `fail` iff the watch's rate is above the baseline's AND p < 0.05.
                    `unmeasured` when either side has no 2xx or 5xx, or the log holds no message POST.
  compaction-rate   automatic `compact_boundary` rows over assistant calls, for rows a GPT model answered on the MAIN
                    thread (a row with `isSidechain` true is counted apart, as context, on both sides), in
                    transcripts under the lane's config directory, the comparable baseline against the watch. A call
                    is counted once by its `message.id`, a boundary once by its `uuid`, and a main-thread boundary
                    belongs to the model that answered last before it on the main thread of its file. Per model,
                    standardised by the watch's calls: expected = the sum over the models with a baseline of
                    watchCalls[m] * baseAutomatic[m] / baseCalls[m]; observed = those models' watch boundaries; a
                    model with no baseline is printed and left out of both. `fail` iff observed > expected AND the
                    one-sided Poisson p = P(X >= observed | expected) < 0.05; sessions cluster, so p is indicative.
                    `unmeasured` when a window has no call; when the compaction point (the median automatic
                    `preTokens`) moved more than 10% between the comparable baseline and the watch, because then
                    the context window changed; and when the comparable baseline holds fewer than 5 transcript files
                    with a counted call or fewer than 20 automatic boundaries. Context, never the verdict: n, p10,
                    median and p90 of the automatic `preTokens` per window, the same reading for every config
                    directory under the home (`box`), a paired reading (files with at least 20 main-thread calls in
                    both windows, summed per side), and the Claude Code `version` mix as calls per version.
  credential        read through the auth library, in its own vocabulary. `fail` when the library's `bars` says the
                    status bars the credential (needs-signin, or a config-error under this configuration); when the
                    last error code is in the library's NEEDS_SIGNIN_CODES or CONFIG_ERROR_CODES, whatever the state;
                    when the status was measured on no credential file and there is none now; when the token has
                    expired; or when the refresh is late: with life = expiresAt - lastRefreshAt (> 0), now -
                    lastRefreshAt > life / 2 + 900 s. `unmeasured` when lastRefreshAt or expiresAt is missing or not a
                    number, or the library reads no current status, and nothing fails. Any other last error code is
                    printed as "last upstream or refresh code", with the status's own update stamp, and never fails;
                    so is any other state. This is one moment, not the week: whether it stayed so is the doctor's
                    history and the operator's.
  drift             every family's `unexplained` list in the stats file is empty.

Also printed, as context: the stats file's cumulative `store:*` outcome counts and the store entry (its state, reason
and `setAside`), so a store outage during the watch shows even while this process's store reads ok.

UNMEASURED IS NEVER PASS. A file that is absent, unreadable or of another shape, a log with no access line and a
window with no call each read `unmeasured`, with the reason. The lane's verdict is `fail` when any criterion fails,
else `unmeasured` when any is unmeasured, else `pass`.
"""
import argparse
import calendar
import glob
import importlib.util
import json
import math
import os
import re
import sys
import time

LANE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
STAMP_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z$")
NAME_RE = re.compile(r"^[A-Za-z0-9_.:/<>-]{1,64}$")   # a model, a family, a counter's name: printed only when bounded
VERSION_RE = re.compile(r"^[0-9]{1,4}(?:\.[0-9]{1,6}){1,3}(?:[-+][A-Za-z0-9.]{1,32})?$")   # a Claude Code build
REL_RE = re.compile(r"^[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*$")   # a path below the home, as lane.json names one
ACCESS_RE = re.compile(r'"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+) HTTP/[0-9.]+" ([1-5][0-9]{2})\b')
ROW_STAMP_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$")
STATS_VERSION = 1
OTHER = "other"
# The auth library of the tree this instrument ships in. Its file names are the library's own
# (single-definition/late-census.test.ts), so the status is read through it and no name is spelled here; so are its
# incident codes (NEEDS_SIGNIN_CODES, CONFIG_ERROR_CODES) and its barring rule (`bars`).
AUTH_LIBRARY = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "ccd", "ccgpt-auth.py")
# The lane's model files. Their one writer is deploy/models-op.mjs (`advancePath`, `windowsPath`), which a Python
# reader cannot import, so each name is spelled once more here, on its own line, read-only.
ADVANCE_FILE = "%s.advance.json"
WINDOWS_FILE = "%s.windows.json"
ADVANCE_VERSION = 1   # shared/model-advance.mjs ADVANCE_VERSION
REFUSAL_SOURCE = "refusal"   # deploy/models-op.mjs lowerWindowsOp: a window D25 lowered after a refusal
# The LiteLLM log's routes: the message route is the baseline; count_tokens is counted apart.
MESSAGES_PATH = "/v1/messages"
COUNT_TOKENS_PATH = MESSAGES_PATH + "/count_tokens"
STATUS_CLASSES = ("2xx", "4xx", "5xx")
NO_STAMPS = "the whole litellm.log: its lines carry no stamps, so its share is over the whole file"

# The rulings' numbers (Stage 4 plan, Task 0).
ALPHA = 0.05                 # every one-sided test's level, and the intervals' 1 - confidence
CADENCE_MARGIN_S = 900       # a refresh is late past half the token's life plus this
POINT_SHIFT = 0.10           # a compaction point that moved more than this: the window changed
POWER_SESSIONS = 5           # a comparable baseline needs this many transcript files with a counted call ...
POWER_AUTOMATIC = 20         # ... and this many automatic boundaries
PAIRED_MIN_CALLS = 20        # a file joins the paired reading with this many main-thread calls in each window
CODE_INCIDENT = "incident"
CODE_CONTEXT = "last upstream or refresh code (context only)"
CLUSTER_NOTE = "sessions cluster: p is indicative"


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


def num(value):
    """A finite JSON number, never a bool; else None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) else None


def bounded(name):
    return name if isinstance(name, str) and NAME_RE.match(name) else OTHER


def bounded_or_none(name):
    return None if name is None else bounded(name)


def version_name(value):
    return value if isinstance(value, str) and VERSION_RE.match(value) else OTHER


def rate(part, whole):
    return round(part / whole, 6) if whole > 0 else None


def sig(value):
    """A statistic as printed: six significant figures."""
    return None if value is None else float("%.6g" % value)


def bump(counts, key, by=1):
    counts[key] = counts.get(key, 0) + by


# ── exact tests, stdlib only, in log space ─────────────────────────────────────────────────────────────────────────
def _logsumexp(terms):
    if not terms:
        return -math.inf
    top = max(terms)
    if top == -math.inf:
        return top
    return top + math.log(sum(math.exp(t - top) for t in terms))


def _binom_terms(n, p, ks):
    lp, lq = math.log(p), math.log1p(-p)
    whole = math.lgamma(n + 1)
    return [whole - math.lgamma(k + 1) - math.lgamma(n - k + 1) + k * lp + (n - k) * lq for k in ks]


def binom_cdf(x, n, p):
    """P(X <= x), X ~ Binomial(n, p)."""
    if x < 0:
        return 0.0
    if x >= n or p <= 0.0:
        return 1.0
    if p >= 1.0:
        return 0.0
    return min(1.0, math.exp(_logsumexp(_binom_terms(n, p, range(x + 1)))))


def binom_sf(x, n, p):
    """P(X >= x), X ~ Binomial(n, p), summed over its own terms so a small tail keeps its precision."""
    if x <= 0:
        return 1.0
    if x > n or p <= 0.0:
        return 0.0
    if p >= 1.0:
        return 1.0
    return min(1.0, math.exp(_logsumexp(_binom_terms(n, p, range(x, n + 1)))))


def _root(f, target, rising):
    """The p in (0, 1) where the monotone f reaches target, by bisection."""
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if mid in (lo, hi):
            break
        if (f(mid) < target) == rising:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def clopper_pearson(x, n):
    """The exact 95% interval of x events in n: the ends where P(X >= x) and P(X <= x) reach ALPHA / 2."""
    if n <= 0:
        return None
    tail = ALPHA / 2
    lo = 0.0 if x <= 0 else _root(lambda p: 1.0 - binom_cdf(x - 1, n, p), tail, rising=True)
    hi = 1.0 if x >= n else _root(lambda p: binom_cdf(x, n, p), tail, rising=False)
    return [sig(lo), sig(hi)]


def conditional_p(x_w, n_w, x_b, n_b):
    """One-sided: p = P(X >= x_w), X ~ Binomial(x_b + x_w, n_w / (n_w + n_b)), two rates' exact comparison."""
    return binom_sf(x_w, x_b + x_w, n_w / (n_w + n_b))


def poisson_sf(x, lam):
    """P(X >= x), X ~ Poisson(lam)."""
    if x <= 0:
        return 1.0
    if lam <= 0:
        return 0.0
    ll = math.log(lam)

    def term(k):
        return -lam + k * ll - math.lgamma(k + 1)

    if x > lam:   # the upper tail directly: past the mode the terms only fall
        terms, k = [], x
        while True:
            t = term(k)
            terms.append(t)
            if t < terms[0] - 60:
                break
            k += 1
        return min(1.0, math.exp(_logsumexp(terms)))
    return max(0.0, 1.0 - math.exp(_logsumexp([term(k) for k in range(x)])))


def quantile(ordered, q):
    """Linear interpolation between order statistics, h = (n - 1) q: the median is the usual one."""
    if not ordered:
        return None
    h = (len(ordered) - 1) * q
    lo = int(math.floor(h))
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (h - lo) * (ordered[hi] - ordered[lo])


def point_of(values):
    ordered = sorted(values)
    out = {"n": len(ordered)}
    for name, q in (("p10", 0.1), ("median", 0.5), ("p90", 0.9)):
        v = quantile(ordered, q)
        out[name] = None if v is None else round(v, 1)
    return out


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


def stamp_or_none(value):
    return value if row_epoch(value) is not None else None


def store_entry(store):
    """The store entry, bounded: this process's state, the outcome that set it, and the last set-aside."""
    if not isinstance(store, dict):
        return None
    aside = store.get("setAside")
    return {
        "state": bounded(store.get("state")),
        "reason": bounded_or_none(store.get("reason")),
        "at": stamp_or_none(store.get("at")),
        "setAside": {"at": stamp_or_none(aside.get("at")), "found": bounded_or_none(aside.get("found")),
                     "file": bounded_or_none(aside.get("file"))} if isinstance(aside, dict) else None,
    }


def bridge_section(st):
    outcomes = st.get("outcomes") if isinstance(st.get("outcomes"), dict) else {}
    routes = st.get("routes") if isinstance(st.get("routes"), dict) else {}
    unexplained = st.get("unexplained") if isinstance(st.get("unexplained"), dict) else {}
    refusals = st.get("refusals") if isinstance(st.get("refusals"), dict) else {}
    shown = {}
    for key, value in outcomes.items():
        bump(shown, bounded(key), count(value))
    names = {}
    for family, listed in unexplained.items():
        if isinstance(listed, list) and listed:
            names[bounded(family)] = sorted({bounded(n) for n in listed})
    return {
        "since": stamp_or_none(st.get("since")),
        "updatedAt": stamp_or_none(st.get("updatedAt")),
        "requests": sum(count(r.get("requests")) for r in routes.values() if isinstance(r, dict)),
        "answered": sum(count(outcomes.get(c)) for c in STATUS_CLASSES),
        "outcomes": dict(sorted(shown.items())),
        "unexplained": dict(sorted(names.items())),
        "refusals": len(refusals),
        # Cumulative, as every count is: an outage earlier in the watch shows here after a restart cleared the entry.
        "storeOutcomes": {k: v for k, v in sorted(shown.items()) if k.startswith("store:")},
        "store": store_entry(st.get("store")),
    }


# ── the credential's status ────────────────────────────────────────────────────────────────────────────────────────
def read_auth_status(home, auth_dir):
    """(the status, the library, None) or (None, None, why), through the auth library's `read_status`. Nothing is
    written: the library is loaded with bytecode off, and `read_status` neither writes nor locks."""
    if auth_dir is None:
        return None, None, "lane.json names no auth directory"
    was = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location("ccgpt_auth", AUTH_LIBRARY)
        if spec is None or spec.loader is None:
            return None, None, "the auth library beside this instrument did not load"
        lib = importlib.util.module_from_spec(spec)
        sys.modules["ccgpt_auth"] = lib
        spec.loader.exec_module(lib)
        status = lib.read_status(os.path.join(home, auth_dir))
    except Exception as e:   # a library that does not load, whatever the reason, is a reading not taken
        return None, None, "the auth library beside this instrument did not load (%s)" % type(e).__name__
    finally:
        sys.dont_write_bytecode = was
    missing = [n for n in ("NEEDS_SIGNIN_CODES", "CONFIG_ERROR_CODES", "bars") if not hasattr(lib, n)]
    if missing:
        return None, None, "the auth library beside this instrument has no " + ", ".join(missing)
    if not isinstance(status, dict):
        return None, None, "the auth library reads no current status for this lane"
    return status, lib, None


# ── the LiteLLM log ────────────────────────────────────────────────────────────────────────────────────────────────
def log_section(home, lane):
    """Message POSTs and count_tokens POSTs by status class, or None with why. Only the method, the path's route and
    the status are read, and only counts are kept."""
    path = os.path.join(home, ".ccrc", "logs", "codex", lane, "litellm.log")
    lines = posts = 0
    messages = {c: 0 for c in STATUS_CLASSES + (OTHER,)}
    tokens = {c: 0 for c in STATUS_CLASSES + (OTHER,)}
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                m = ACCESS_RE.search(line)
                if not m:
                    continue
                lines += 1
                if m.group(1) != "POST":
                    continue
                posts += 1
                route = m.group(2).split("?", 1)[0]
                into = messages if route == MESSAGES_PATH else tokens if route == COUNT_TOKENS_PATH else None
                if into is not None:
                    cls = m.group(3)[0] + "xx"
                    into[cls if cls in STATUS_CLASSES else OTHER] += 1
    except FileNotFoundError:
        return None, "litellm.log is absent"
    except OSError:
        return None, "litellm.log is unreadable"
    if sum(messages.values()) == 0:
        return None, ("litellm.log holds no POST %s access line this reader recognises (%d access lines, %d POSTs)"
                      % (MESSAGES_PATH, lines, posts))
    return {"accessLines": lines, "posts": posts, "messages": messages, "countTokens": tokens, "span": NO_STAMPS}, None


# ── the window events ──────────────────────────────────────────────────────────────────────────────────────────────
def read_events(home, lane, base, until):
    """(events, sources): every advance-history entry and every windows entry stamped in [base, until), and per file
    `read` or why it was not. An absent or unreadable file is tolerated; an entry with no readable stamp is counted in
    `sources.undated` and cuts nothing."""
    events, sources, undated = [], {}, 0
    models = os.path.join(home, ".ccrc", "models")

    adv, why = read_json(os.path.join(models, ADVANCE_FILE % lane))
    classes = adv.get("classes") if adv is not None else None
    if adv is None:
        sources["advance"] = why
    elif adv.get("v") != ADVANCE_VERSION or not isinstance(classes, dict):
        sources["advance"] = "not an advance file of version %d" % ADVANCE_VERSION
    else:
        sources["advance"] = "read"
        for cls, entry in sorted(classes.items()):
            history = entry.get("history") if isinstance(entry, dict) else None
            for e in history if isinstance(history, list) else []:
                at = row_epoch(e.get("at")) if isinstance(e, dict) else None
                if at is None:
                    undated += 1
                elif base <= at < until:
                    events.append({"at": at, "kind": bounded(e.get("how")), "class": bounded(cls),
                                   "from": bounded_or_none(e.get("from")), "to": bounded_or_none(e.get("to")),
                                   "ok": e.get("ok") if isinstance(e.get("ok"), bool) else None})

    win, why = read_json(os.path.join(models, WINDOWS_FILE % lane))
    entries = win.get("windows") if win is not None else None
    if win is None:
        sources["windows"] = why
    elif not isinstance(entries, dict):
        sources["windows"] = "not a windows file"
    else:
        sources["windows"] = "read"
        for model, entry in sorted(entries.items()):
            at = row_epoch(entry.get("setAt")) if isinstance(entry, dict) else None
            if at is None:
                undated += 1
            elif base <= at < until:
                tokens = entry.get("tokens")
                events.append({"at": at, "kind": "lowering" if entry.get("source") == REFUSAL_SOURCE else "window",
                               "model": bounded(model), "from": None,
                               "to": tokens if isinstance(tokens, int) and not isinstance(tokens, bool) else None})
    if undated:
        sources["undated"] = undated
    events.sort(key=lambda e: (e["at"], e["kind"]))
    return events, sources


def place_events(events, base, flip):
    """Each event's window and whether it cuts the baseline; the comparable baseline's start."""
    start = base
    for e in events:
        e["where"] = "baseline" if e["at"] < flip else "watch"
        e["cuts"] = base < e["at"] < flip
        if e["cuts"]:
            start = max(start, e["at"])
    for e in events:
        e["at"] = iso(e["at"])
    return start


# ── transcripts ────────────────────────────────────────────────────────────────────────────────────────────────────
def is_gpt(model):
    return isinstance(model, str) and bool(model) and not model.startswith("claude") and not model.startswith("<")


def new_window():
    return {"calls": 0, "automatic": 0, "manual": 0, "apiErrors": 0, "models": {}, "automaticByModel": {},
            "versions": {}, "sidechain": {"calls": 0, "automatic": 0, "manual": 0}}


class Tally:
    """One scope's counts, per window (the windows overlap: the comparable baseline is inside the requested one). A
    call is counted once by its message id and a boundary once by its uuid, each per window and per thread; a file is
    known by its index in the scan, never by its path."""

    def __init__(self, windows):
        self.out = {name: new_window() for name in windows}
        self.seen = {name: {key: set() for key in ("call", "row", "side-call", "side-row")} for name in windows}
        self.points = {name: [] for name in windows}
        self.files = {name: {} for name in windows}   # file index -> [main-thread calls, automatic boundaries]

    def call(self, where, key, model, version, side, fi):
        for name in where:
            seen = self.seen[name]["side-call" if side else "call"]
            if key in seen:
                continue
            seen.add(key)
            w = self.out[name]
            if side:
                w["sidechain"]["calls"] += 1
                continue
            w["calls"] += 1
            bump(w["models"], bounded(model))
            bump(w["versions"], version_name(version))
            self.files[name].setdefault(fi, [0, 0])[0] += 1

    def row(self, where, key, what, side, fi, model=None, pre=None):
        for name in where:
            seen = self.seen[name]["side-row" if side else "row"]
            if key in seen:
                continue
            seen.add(key)
            w = self.out[name]
            if side:
                if what in w["sidechain"]:
                    w["sidechain"][what] += 1
                continue
            w[what] += 1
            if what == "automatic":
                bump(w["automaticByModel"], bounded(model))
                if pre is not None:
                    self.points[name].append(pre)
                self.files[name].setdefault(fi, [0, 0])[1] += 1

    def done(self):
        for name, w in self.out.items():
            for key in ("models", "automaticByModel", "versions"):
                w[key] = dict(sorted(w[key].items()))
            w["rate"] = rate(w["automatic"], w["calls"])
            w["sessions"] = sum(1 for calls, _ in self.files[name].values() if calls > 0)
            w["point"] = point_of(self.points[name])
        out = dict(self.out)
        out["paired"] = self.paired("comparable", "watch")
        return out

    def paired(self, a, b):
        """Files with at least PAIRED_MIN_CALLS main-thread calls in both windows, summed per side."""
        both = [fi for fi, (calls, _) in self.files[a].items()
                if calls >= PAIRED_MIN_CALLS and self.files[b].get(fi, [0, 0])[0] >= PAIRED_MIN_CALLS]
        out = {"files": len(both)}
        for name in (a, b):
            c = sum(self.files[name][fi][0] for fi in both)
            n = sum(self.files[name][fi][1] for fi in both)
            out[name] = {"calls": c, "automatic": n, "rate": rate(n, c)}
        return out


def scan(home, dirs, lane_dir, windows):
    """(the lane's counts or None, the box's counts), in one pass over every transcript under the config directories
    `dirs`. The lane's are the files under `lane_dir`; the box's are all of them. A boundary, and an API error row,
    belongs to the model that answered last before it on its own thread of its own file."""
    box = Tally(windows)
    lane = Tally(windows) if lane_dir is not None else None
    fi = 0
    for cfg in dirs:
        tallies = [box, lane] if lane is not None and cfg == lane_dir else [box]
        for path in sorted(glob.glob(os.path.join(home, cfg, "projects", "**", "*.jsonl"), recursive=True)):
            fi += 1
            last = {False: None, True: None}   # the last model per thread: main, sidechain
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
                    at = row_epoch(row.get("timestamp"))
                    where = [n for n, (a, b) in windows.items() if at is not None and a <= at < b]
                    uuid = row.get("uuid") if isinstance(row.get("uuid"), str) else None
                    side = row.get("isSidechain") is True
                    if kind == "assistant":
                        msg = row.get("message") if isinstance(row.get("message"), dict) else {}
                        if row.get("isApiErrorMessage") is True:
                            if where and uuid and is_gpt(last[side]):
                                for t in tallies:
                                    t.row(where, uuid, "apiErrors", side, fi)
                            continue
                        model = msg.get("model")
                        if not isinstance(model, str) or not model or model.startswith("<"):
                            continue
                        last[side] = model
                        key = msg.get("id") if isinstance(msg.get("id"), str) else uuid
                        if where and key and is_gpt(model):
                            for t in tallies:
                                t.call(where, key, model, row.get("version"), side, fi)
                    elif kind == "system" and row.get("subtype") == "compact_boundary":
                        if where and uuid and is_gpt(last[side]):
                            meta = row.get("compactMetadata") if isinstance(row.get("compactMetadata"), dict) else {}
                            what = "manual" if meta.get("trigger") == "manual" else "automatic"
                            pre = num(meta.get("preTokens"))
                            for t in tallies:
                                t.row(where, uuid, what, side, fi, model=last[side], pre=pre)
    return (lane.done() if lane is not None else None), box.done()


def config_dirs(home):
    return sorted(os.path.basename(p) for p in glob.glob(os.path.join(home, ".claude*")) if os.path.isdir(p))


# ── the compaction reading, for one scope ─────────────────────────────────────────────────────────────────────────
def compaction_reading(tx):
    """(verdict, reasons, fields) for one scope's counts: the per-model standardisation, the power, the point."""
    comp, watch = tx["comparable"], tx["watch"]
    cells, nobase, expected, observed = {}, {}, 0.0, 0
    for m in sorted(set(watch["models"]) | set(watch["automaticByModel"])):
        wc, wa = watch["models"].get(m, 0), watch["automaticByModel"].get(m, 0)
        bc, ba = comp["models"].get(m, 0), comp["automaticByModel"].get(m, 0)
        if bc > 0:
            cells[m] = {"baselineCalls": bc, "baselineAutomatic": ba, "watchCalls": wc, "watchAutomatic": wa}
            expected += wc * ba / bc
            observed += wa
        else:
            nobase[m] = {"watchCalls": wc, "watchAutomatic": wa}
    p = poisson_sf(observed, expected) if cells else None
    fields = {
        "standardised": {"expected": sig(expected) if cells else None, "observed": observed if cells else None,
                         "p": sig(p), "note": CLUSTER_NOTE, "cells": cells, "noBaseline": nobase},
        "power": {"sessions": comp["sessions"], "automatic": comp["automatic"],
                  "needs": {"sessions": POWER_SESSIONS, "automatic": POWER_AUTOMATIC}},
    }
    reasons = []
    for name, label in (("comparable", "comparable baseline"), ("watch", "watch")):
        if tx[name]["calls"] == 0:
            reasons.append("no GPT-model call in the %s window" % label)
    mb, mw = comp["point"]["median"], watch["point"]["median"]
    if mb is not None and mw is not None and abs(mw - mb) > POINT_SHIFT * mb:
        reasons.append("the compaction point moved (baseline %.1fk, watch %.1fk): the context window changed"
                       % (mb / 1000, mw / 1000))
    if comp["sessions"] < POWER_SESSIONS or comp["automatic"] < POWER_AUTOMATIC:
        reasons.append("the comparable baseline holds %d sessions and %d boundaries (needs %d and %d)"
                       % (comp["sessions"], comp["automatic"], POWER_SESSIONS, POWER_AUTOMATIC))
    if not reasons and not cells:
        reasons.append("no model the watch called has a call in the comparable baseline")
    if reasons:
        return "unmeasured", reasons, fields
    return ("fail" if observed > expected and p < ALPHA else "pass"), [], fields


# ── the five criteria ──────────────────────────────────────────────────────────────────────────────────────────────
def five_xx(add, bridge, bridge_why, log, log_why):
    if bridge is None:
        add("5xx-rate", "unmeasured", reason=bridge_why)
        return
    o = bridge["outcomes"]
    x_w, ok_w, four_w = o.get("5xx", 0), o.get("2xx", 0), o.get("4xx", 0)
    n_w = ok_w + x_w
    watch = {"fiveXx": x_w, "twoXx": ok_w, "fourXx": four_w, "n": n_w, "rate": rate(x_w, n_w),
             "interval": clopper_pearson(x_w, n_w)}
    extra = {"watch": watch, "clientGone": o.get("client-gone", 0), "drainCut": o.get("drain-cut", 0),
             "countTokens": o.get("countTokens", 0), "since": bridge["since"]}
    if n_w == 0:
        add("5xx-rate", "unmeasured", reason="the stats file counts no 2xx or 5xx answer", **extra)
        return
    if log is None:
        add("5xx-rate", "unmeasured", reason="no baseline: " + log_why, **extra)
        return
    msg = log["messages"]
    x_b, n_b = msg["5xx"], msg["2xx"] + msg["5xx"]
    base = {"fiveXx": x_b, "twoXx": msg["2xx"], "fourXx": msg["4xx"], "n": n_b, "rate": rate(x_b, n_b),
            "interval": clopper_pearson(x_b, n_b), "countTokens": log["countTokens"], "span": log["span"]}
    if n_b == 0:
        add("5xx-rate", "unmeasured", baseline=base, reason="litellm.log holds no POST %s answered 2xx or 5xx"
            % MESSAGES_PATH, **extra)
        return
    p = conditional_p(x_w, n_w, x_b, n_b)
    worse = x_w * n_b > x_b * n_w   # the watch's rate above the baseline's, exactly
    add("5xx-rate", "fail" if worse and p < ALPHA else "pass", baseline=base,
        ratio=sig((x_w / n_w) / (x_b / n_b)) if x_b > 0 else None, p=sig(p),
        test="one-sided exact: P(X >= watch 5xx), X ~ Binomial(both 5xx, n_w / (n_w + n_b))", **extra)


def credential(add, auth, lib, auth_why, mode, now):
    if auth is None:
        add("credential", "unmeasured", reason=auth_why)
        return
    state, code = auth.get("state"), auth.get("lastErrorCode")
    incident = lib.NEEDS_SIGNIN_CODES | lib.CONFIG_ERROR_CODES
    expires, refreshed = num(auth.get("expiresAt")), num(auth.get("lastRefreshAt"))
    updated = num(auth.get("updatedAt"))
    checks, failed, unknown = {}, [], []

    def check(name, verdict, why):
        checks[name] = verdict
        (failed if verdict == "fail" else unknown if verdict == "unmeasured" else []).append(why)

    check("bars", "fail" if lib.bars(auth) else "pass",
          "the library says this status bars the credential (state %s)" % bounded(state))
    is_incident = isinstance(code, str) and code in incident
    check("incidentCode", "fail" if is_incident else "pass",
          "the last error code is in the library's sign-in or configuration-error set")
    # A current status whose identity is null was measured on no credential file, and read_status matched it
    # against the credential's identity now: the library measures no credential there.
    check("credentialPresent", "fail" if auth.get("identity") is None else "pass",
          "the library measures no credential file for this status")
    if expires is None:
        check("expiry", "unmeasured", "the status has no expiresAt")
    else:
        check("expiry", "fail" if expires <= now else "pass", "the token has expired")
    life = expires - refreshed if expires is not None and refreshed is not None else None
    bound = life / 2 + CADENCE_MARGIN_S if life is not None and life > 0 else None
    if refreshed is None:
        check("cadence", "unmeasured", "the status has no lastRefreshAt")
    elif bound is None:
        check("cadence", "unmeasured", "no positive token life (expiresAt - lastRefreshAt)")
    else:
        check("cadence", "fail" if now - refreshed > bound else "pass",
              "the last refresh is older than half the token's life plus %d s" % CADENCE_MARGIN_S)
    fields = {
        "state": bounded(state), "mode": mode,
        "lastErrorCode": bounded(code) if code is not None else None,
        "lastErrorCodeRole": (CODE_INCIDENT if is_incident else CODE_CONTEXT) if code is not None else None,
        "statusUpdatedAt": iso(updated) if updated is not None else None,
        "expiresInSeconds": int(expires - now) if expires is not None else None,
        "sinceRefreshSeconds": int(now - refreshed) if refreshed is not None else None,
        "lifeSeconds": int(life) if life is not None else None,
        "cadenceBoundSeconds": sig(bound), "checks": checks,
    }
    if failed:
        add("credential", "fail", failed=failed, **fields)
    elif unknown:
        add("credential", "unmeasured", reason="; ".join(unknown), **fields)
    else:
        add("credential", "pass", **fields)


def compaction(add, lane_tx, box_tx, events):
    warnings = [e for e in events if e["where"] == "watch"]
    if lane_tx is None:
        add("compaction-rate", "unmeasured", reason="lane.json names no config directory", warnings=warnings)
        return
    verdict, reasons, fields = compaction_reading(lane_tx)
    box_verdict, box_reasons, box_fields = compaction_reading(box_tx)
    rest = {"baseline": lane_tx["baseline"], "comparable": lane_tx["comparable"], "watch": lane_tx["watch"],
            **fields, "warnings": warnings, "paired": lane_tx["paired"],
            "box": {"reads": box_verdict, "reason": "; ".join(box_reasons) or None, **box_fields,
                    "paired": box_tx["paired"]}}
    if reasons:
        add("compaction-rate", verdict, reason="; ".join(reasons), **rest)
    else:
        add("compaction-rate", verdict, **rest)


def criteria(mode, bridge, bridge_why, log, log_why, lane_tx, box_tx, events, auth, lib, auth_why, now):
    out = []

    def add(name, verdict, **fields):
        out.append(dict(name=name, verdict=verdict, **fields))

    # 1. empty tool calls
    if bridge is None:
        add("empty-tool-calls", "unmeasured", reason=bridge_why)
    else:
        n = bridge["outcomes"].get("emptyArguments", 0)
        add("empty-tool-calls", "pass" if n == 0 else "fail", emptyArguments=n)
    five_xx(add, bridge, bridge_why, log, log_why)        # 2. the 5xx rate
    compaction(add, lane_tx, box_tx, events)              # 3. the compaction rate
    credential(add, auth, lib, auth_why, mode, now)       # 4. the credential
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


def event_line(e):
    what = e.get("class", e.get("model"))
    where = "baseline, cuts the baseline" if e["cuts"] else "baseline" if e["where"] == "baseline" else "watch, a warning"
    return "event: %s %s %s %s -> %s (%s)" % (e["at"], e["kind"], what, show(e["from"]), show(e["to"]), where)


def text(rep):
    lines = ["lane: %s (%s)" % (rep["lane"], rep["mode"]),
             "baseline window: %s to %s" % tuple(rep["windows"]["baseline"]),
             "comparable baseline: %s to %s" % tuple(rep["windows"]["comparable"]),
             "watch window: %s to %s" % tuple(rep["windows"]["watch"]),
             "verdict: %s" % rep["verdict"], ""]
    for c in rep["criteria"]:
        rest = ", ".join("%s=%s" % (k, show(v)) for k, v in c.items() if k not in ("name", "verdict"))
        lines.append("%s: %s%s" % (c["name"], c["verdict"], (" (" + rest + ")") if rest else ""))
    lines.append("")
    lines.append("event files: %s" % show(rep["eventSources"]))
    lines.extend(event_line(e) for e in rep["events"])
    if not rep["events"]:
        lines.append("events: none in the windows")
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
        events, sources = read_events(home, args.lane, base, until)
        comparable = place_events(events, base, flip)
        windows = {"baseline": (base, flip), "comparable": (comparable, flip), "watch": (flip, until)}

        st, bridge_why = read_stats(home, args.lane, lane["stats"])
        bridge = bridge_section(st) if st is not None else None
        log, log_why = log_section(home, args.lane)
        auth, lib, auth_why = read_auth_status(home, lane["authDir"])
        lane_tx, box_tx = scan(home, config_dirs(home), lane["configDir"], windows)

        items = criteria(lane["mode"], bridge, bridge_why, log, log_why, lane_tx, box_tx, events, auth, lib,
                         auth_why, now)
        rep = {
            "lane": args.lane, "mode": lane["mode"],
            "windows": {name: [iso(a), iso(b)] for name, (a, b) in windows.items()},
            "verdict": overall(items), "criteria": items,
            "events": events, "eventSources": sources,
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

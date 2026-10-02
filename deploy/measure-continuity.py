#!/usr/bin/env python3
"""The session-continuity programme's instrument (spec 2026-09-23 §9). READ-ONLY.

Run by hand on the fleet box, as the fleet user; it opens every file it reads
read-only, writes nothing anywhere, never runs `ccd`, never touches tmux or a
unit. It grows with the programme: each wave adds the §9 rows it owns as one
function registered in STAGES (`N: stageN`), in the same PR as the mechanism
those rows measure. `stageN(ctx)` returns a dict of named sections.

    python3 deploy/measure-continuity.py                          # every stage, table
    python3 deploy/measure-continuity.py --stage 1 --json         # one stage, JSON
    python3 deploy/measure-continuity.py --since 2026-09-24 --deployed '2026-09-24 10:00'

ctx carries `home` (`--home`, default `$HOME`; the test suite's fixture HOMEs),
`swap_log` (`--swap-log`, default `<home>/.cc-sessions/swap.log`), `since` and
`until` (`--since` inclusive, `--until` exclusive), `deployed` (`--deployed`)
and `all_copies` (`--all-copies`). The three times are EPOCH seconds. On the
command line they are `YYYY-MM-DD[ HH:MM[:SS]]` in LOCAL time, because
swap.log's stamps are `date '+%F %T'`, local time on the box that wrote them,
and are converted with `time.mktime`; run it on the fleet box (or with TZ set
to that box's zone). Transcript stamps are ISO UTC (`…Z`), converted with
`calendar.timegm`.
"""
import argparse
import calendar
import collections
import glob
import json
import mmap
import os
import re
import sys
import time

TS = r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)"


def epoch(stamp):
    """swap.log's local-time stamp -> epoch seconds, or None."""
    try:
        return int(time.mktime(time.strptime(stamp, "%Y-%m-%d %H:%M:%S")))
    except (ValueError, OverflowError):
        return None


def read_lines(path):
    with open(path, "rb") as fh:
        return [raw.decode("utf-8", "replace").rstrip("\n") for raw in fh]


# ── stage 1 (wave 1): the carry, and the journal-missing resume refusals ─────
# carry   every `sidecar <uuid> -> <dst> (<mode>)` line in swap.log, by mode —
#         link, copy, merged, and `kept` by reason: `kept` alone is the
#         pre-merge rule (an existing destination, skipped); `kept: busy`,
#         `kept: budget` and `kept: error` are the merge's three fallbacks —
#         plus the merged walks' summed +N ~R !D, the `diverged` rows, and
#         the budget's cut: `deferred_carries` counts the merges that ended
#         `, deferred K` (the budget ran out part way; what was placed is
#         whole) and `deferred_actions` sums their K — the backlog the next
#         visit prices first. `kept: budget` stays its own count: a walk
#         whose FIRST action alone was over budget and placed nothing.
#         §9's target: `kept` only as busy/budget, under 2% of carries,
#         reported over every carry AND (`--deployed`) over the carries whose
#         pair — the session's uuid and the destination's account root — was
#         NOT stranded before the deploy: a pair is stranded when that root
#         held the session before `--deployed`, i.e. a sidecar line before it
#         names that root, or a `swap` line before it names that root's
#         wrapper as either side (the root the session was BORN on is named by
#         no sidecar line, only as a swap's `from`). A wrapper's root is
#         learned from the log itself — a carry's sidecar lines precede its
#         `swap <id>: <from> -> <to> (uuid <uuid>)` line — so a wrapper that
#         never received a sidecar carry cannot be mapped, and a born-there
#         pair on it reads as not stranded: the named cost of reading swap.log
#         alone. The deferred counts are split the same way, so the stranded
#         backlog draining (deferred on a stranded pair) is told apart from a
#         steady state that still overruns the budget.
# resume  every Workflow tool call carrying `resumeFromRunId`, deduplicated by
#         tool-use id across the account-root copies a swapping session
#         accumulates, classified by its tool result: ok, journal-missing
#         ("… is not on disk …"), script-path ("scriptPath must be a script
#         path"), other-error, or no-result. §9's target: journal-missing 0.
def iso_epoch(stamp):
    """A transcript's ISO UTC stamp ('YYYY-MM-DDTHH:MM:SS…Z') -> epoch seconds, or None."""
    try:
        return calendar.timegm(time.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S"))
    except (TypeError, ValueError, OverflowError):
        return None


def in_window(t, ctx):
    """t: epoch seconds, or None (an unparseable stamp is never in a window)."""
    return t is not None and (ctx["since"] is None or t >= ctx["since"]) \
        and (ctx["until"] is None or t < ctx["until"])


CARRY = re.compile(TS + r" sidecar (\S+) -> (.+) \(([^()]*)\)$")
DIVERGED = re.compile(TS + r" sidecar (\S+) diverged (.+) longer (.+)$")
SWAP = re.compile(TS + r" swap \S+: (\S+) -> (\S+) \(uuid (\S+)\)$")
MERGED = re.compile(r"^merged \+(\d+) ~(\d+) !(\d+)(?:, deferred (\d+))?$")
KEPT_REASONS = ("busy", "budget", "error")


def carry_counts(modes_seen):
    modes = {"link": 0, "copy": 0, "merged": 0, "kept": 0,
             "kept: busy": 0, "kept: budget": 0, "kept: error": 0, "other": 0}
    added = replaced = diverged = deferred_carries = deferred_actions = 0
    for mode in modes_seen:
        mm = MERGED.match(mode)
        if mm:
            modes["merged"] += 1
            added += int(mm.group(1)); replaced += int(mm.group(2)); diverged += int(mm.group(3))
            k = int(mm.group(4) or 0)
            deferred_carries += 1 if k else 0
            deferred_actions += k
        elif mode in modes:
            modes[mode] += 1
        else:
            modes["other"] += 1
    total = sum(modes.values())
    kept_all = modes["kept"] + sum(modes["kept: " + r] for r in KEPT_REASONS)
    return {
        "carries": total,
        "by_mode": modes,
        "kept_total": kept_all,
        "kept_share": round(kept_all / total, 4) if total else None,
        "kept_other_than_busy_budget": modes["kept"] + modes["kept: error"],
        "merged_added": added, "merged_replaced": replaced, "merged_diverged": diverged,
        "deferred_carries": deferred_carries, "deferred_actions": deferred_actions,
    }


def carry_section(ctx):
    try:
        lines = read_lines(ctx["swap_log"])
    except FileNotFoundError:
        return {"swap_log": "absent"}
    deployed = ctx["deployed"]
    early = lambda t: deployed is not None and t is not None and t < deployed
    carries, diverged_rows = [], 0          # carries: (t, uuid, root, mode) inside the window
    pending = collections.defaultdict(list)  # uuid -> roots its sidecar lines named, awaiting its swap line
    root_of = {}                             # wrapper -> account root, learned from the log
    stranded, visits = set(), []             # (uuid, root) pairs; (uuid, from, to) swap lines before --deployed
    for line in lines:
        m = DIVERGED.match(line)
        if m:
            if in_window(epoch(m.group(1)), ctx):
                diverged_rows += 1
            continue
        m = CARRY.match(line)
        if m:
            t, uuid, mode = epoch(m.group(1)), m.group(2), m.group(4)
            root = m.group(3).rsplit("/projects/", 1)[0]
            pending[uuid].append(root)
            if early(t):
                stranded.add((uuid, root))
            if in_window(t, ctx):
                carries.append((t, uuid, root, mode))
            continue
        m = SWAP.match(line)
        if m:
            t, frm, to, uuid = epoch(m.group(1)), m.group(2), m.group(3), m.group(4)
            if pending.get(uuid):
                root_of[to] = pending.pop(uuid)[-1]
            if early(t):
                visits.append((uuid, frm, to))
    for uuid, frm, to in visits:
        for w in (frm, to):
            if w in root_of:
                stranded.add((uuid, root_of[w]))
    out = carry_counts(mode for _, _, _, mode in carries)
    out["diverged_rows"] = diverged_rows
    out["excluding_stranded"] = None if deployed is None else \
        carry_counts(mode for _, u, r, mode in carries if (u, r) not in stranded)
    return out


def transcripts(ctx):
    """Main-session transcripts, `<root>/projects/<pdir>/<uuid>.jsonl` — the
    Workflow tool is the session's, not its workflow agents'. A swapping session
    leaves one copy per account root it visited (and one name per mirrored
    project dir), each a PREFIX of the copy it moved on with, so by default only
    the LARGEST copy of each uuid is read: measured on the fleet box at
    planning, 44.6 GB of names in the window collapse to 6.4 GB. A copy that
    diverged would hide a call only it holds; `--all-copies` reads every one."""
    best = {}
    for root in sorted(glob.glob(os.path.join(ctx["home"], ".claude*"))):
        for path in glob.glob(os.path.join(root, "projects", "*", "*.jsonl")):
            try:
                st = os.stat(path)
            except OSError:
                continue
            if ctx["since"] is not None and st.st_mtime < ctx["since"]:
                continue      # last written before the window opened: no call in it
            key = path if ctx["all_copies"] else os.path.basename(path)
            if key not in best or st.st_size > best[key][1]:
                best[key] = (path, st.st_size)
    return sorted(p for p, _ in best.values())


def classify(text):
    if "is not on disk" in text:
        return "journal-missing"
    if "scriptPath must be a script path" in text:
        return "script-path"
    return "other-error"


def resume_section(ctx):
    calls = {}      # tool_use id -> timestamp
    results = {}    # tool_use id -> class
    for path in transcripts(ctx):
        try:
            with open(path, "rb") as fb:
                with mmap.mmap(fb.fileno(), 0, access=mmap.ACCESS_READ) as mm:
                    if mm.find(b"resumeFromRunId") < 0:
                        continue      # the common case, decided in C without a line loop
            f = open(path, encoding="utf8", errors="replace")
        except (OSError, ValueError):
            continue
        pending = set()
        with f:
            for line in f:
                hit_use = "resumeFromRunId" in line
                hit_res = pending and '"tool_result"' in line and any(i in line for i in pending)
                if not (hit_use or hit_res):
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                content = (row.get("message") or {}).get("content")
                if not isinstance(content, list):
                    continue
                for b in content:
                    if not isinstance(b, dict):
                        continue
                    if b.get("type") == "tool_use" and b.get("name") == "Workflow" \
                            and isinstance(b.get("input"), dict) and b["input"].get("resumeFromRunId"):
                        calls.setdefault(b.get("id"), row.get("timestamp") or "")
                        pending.add(b.get("id"))
                    elif b.get("type") == "tool_result" and b.get("tool_use_id") in pending:
                        c = b.get("content")
                        text = c if isinstance(c, str) else json.dumps(c)
                        err = str(b.get("is_error")).lower() == "true"
                        results[b["tool_use_id"]] = classify(text) if err else "ok"
    out = {"ok": 0, "journal-missing": 0, "script-path": 0, "other-error": 0, "no-result": 0}
    n = 0
    for i, ts in calls.items():
        if not in_window(iso_epoch(ts), ctx):
            continue
        n += 1
        out[results.get(i, "no-result")] += 1
    return {"resume_calls": n, "by_outcome": out}


def stage1(ctx):
    return {"carry": carry_section(ctx), "resume": resume_section(ctx)}


STAGES = {1: stage1}


def when(s):
    """--since/--until/--deployed: 'YYYY-MM-DD[ HH:MM[:SS]]' (a `T` for the space
    is accepted), LOCAL time as swap.log writes it -> epoch seconds."""
    v = s.replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return int(time.mktime(time.strptime(v, fmt)))
        except ValueError:
            pass
    raise argparse.ArgumentTypeError(f"not YYYY-MM-DD[ HH:MM[:SS]]: {s!r}")


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--stage", type=int, choices=sorted(STAGES), action="append")
    ap.add_argument("--home", default=os.path.expanduser("~"))
    ap.add_argument("--swap-log", help="default: <home>/.cc-sessions/swap.log")
    ap.add_argument("--since", type=when, help="YYYY-MM-DD[ HH:MM[:SS]] (local), inclusive")
    ap.add_argument("--until", type=when, help="YYYY-MM-DD[ HH:MM[:SS]] (local), exclusive")
    ap.add_argument("--deployed", type=when, help="the stage's rollout time (local): splits out pairs stranded before it")
    ap.add_argument("--all-copies", action="store_true", help="read every transcript copy, not the largest per uuid")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    ctx = {
        "home": a.home,
        "swap_log": a.swap_log or os.path.join(a.home, ".cc-sessions", "swap.log"),
        "since": a.since, "until": a.until, "deployed": a.deployed,
        "all_copies": a.all_copies,
    }
    out = {f"stage{n}": STAGES[n](ctx) for n in (a.stage or sorted(STAGES))}
    if a.json:
        print(json.dumps(out, indent=1, sort_keys=True))
        return 0
    for stage, sections in out.items():
        print(stage)
        for name, rows in sections.items():
            print(f"  [{name}]")
            for k, v in (rows.items() if isinstance(rows, dict) else [("", rows)]):
                print(f"    {k:40} {json.dumps(v, sort_keys=True) if isinstance(v, dict) else v}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

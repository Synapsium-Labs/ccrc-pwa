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


# ── stage 4 (wave 2): the rescue policy ─────────────────────────────────────
# §9's stage-4 rows but "non-rescue swaps that cut delegated work" (wave 7's),
# read off swap.log; the no-room rows also read a session's `.rescuewait`
# record, read-only, to tell a wait open NOW from one a purge cut short. The
# line shapes are ccd's own, and `server/test/measure-continuity-stage4.test.ts`
# binds each regex below to a line the real ccd function wrote. Self-contained:
# it reads `ctx` as the contract's dict and uses no helper outside this block,
# so it drops in unchanged whichever wave wrote the rest of the file.
S4_TS = r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)"
S4_RESCUE = re.compile(S4_TS + r" auto-rescue (\S+): (\S+) \(blocked\) -> (\S+) \[home=[^\]]*\](.*)$")
S4_LANDING = re.compile(S4_TS + r" swap (\S+): (\S+) -> (\S+) \(uuid ")
S4_CARRIED = re.compile(S4_TS + r" carried-in (\S+): via=(\S+) ")
S4_WAIT_OPEN = re.compile(S4_TS + r" rescuewait (\S+): kind=(\S+) on (\S+) reset=(\S+)$")
S4_WAIT_END = re.compile(S4_TS + r" rescuewait-end (\S+): kind=(\S+) on (\S+) reset=(\S+) after (\d+)s end=(\S+)$")
S4_TOKEN = re.compile(r" (reset|type|row)=(\d+|[a-z_]+)")
# ccd's RESCUE_WAIT_GRACE; the stage-4 test binds the two numbers together.
S4_GRACE = 120


def s4_epoch(stamp):
    """swap.log's LOCAL-time stamp -> epoch seconds (time.mktime), or None."""
    try:
        return int(time.mktime(time.strptime(stamp, "%Y-%m-%d %H:%M:%S")))
    except (ValueError, OverflowError):
        return None


def stage4(ctx):
    since, until = ctx["since"], ctx["until"]
    path = ctx["swap_log"] or os.path.join(ctx["home"], ".cc-sessions", "swap.log")
    try:
        with open(path, "rb") as fh:
            lines = [raw.decode("utf-8", "replace").rstrip("\n") for raw in fh]
    except FileNotFoundError:
        return {"rescue": {"swap_log": "absent"}}
    rescues, landings, carried = [], collections.defaultdict(list), []
    moves, landed_moves, chain_opens = collections.defaultdict(list), collections.defaultdict(list), collections.defaultdict(list)
    opened, ended = collections.Counter(), collections.Counter()
    chain_neither, near_swap = 0, 0
    # §11 item 6, ruled 2026-09-24 "leave it and count it": a STALLED session
    # whose own account is the only one with room idles in the no-room wait
    # after that account resets, because only an ARMED pane ends a wait in place
    # there (`turned`). Counted: a no-room wait with a numeric reset — ccd records
    # one only for a five-hour row written before it, and ends it `stale` when a
    # newer row proves that reset did not turn the account — not ended `turned`
    # or `stale`, whose end (its end line in the window) or, still open, the
    # window's end (`--until`, else now) is more than S4_GRACE past its reset;
    # seconds run from the reset. `pending` pairs
    # each session's entry line with its exit line — the record holds one wait at
    # a time, so they alternate. A purge removes the record and writes no exit
    # line, so a wait measured NOW is open only while
    # `<home>/.cc-sessions/<id>.rescuewait` still says `state=open` (a later
    # session of the same id may have re-used a closed one); a past window
    # (`--until`) has only the log, and a session purged mid-wait there counts to
    # the window's end. Named cost: a no-room wait whose block turned into lost
    # auth mid-strand still counts past its reset — the log does not say the
    # verdict changed while the strand stood.
    now = int(time.time())
    ref = until if until is not None else now
    upto = lambda t: t is not None and (t < until if until is not None else t <= now)   # the window's end, or now
    pending, past = {}, []
    inwin = lambda t: t is not None and (since is None or t >= since) and (until is None or t < until)
    for line in lines:
        m = S4_LANDING.match(line)
        if m:
            t = s4_epoch(m.group(1))
            if t is not None:
                landings[m.group(2)].append(t)
                landed_moves[m.group(2)].append((t, m.group(3), m.group(4)))
            continue
        m = S4_RESCUE.match(line)
        if m:
            t = s4_epoch(m.group(1))
            if inwin(t):
                rescues.append((t, m.group(2), dict(S4_TOKEN.findall(m.group(5)))))
            if t is not None:
                moves[m.group(2)].append((t, m.group(3), m.group(4), dict(S4_TOKEN.findall(m.group(5)))))
            continue
        m = S4_CARRIED.match(line)
        if m:
            t = s4_epoch(m.group(1))
            if inwin(t):
                carried.append((t, m.group(2), m.group(3)))
            continue
        m = S4_WAIT_OPEN.match(line)
        if m:
            t = s4_epoch(m.group(1))
            if inwin(t):
                opened[m.group(3)] += 1
            if t is not None and m.group(3) == "chain":
                chain_opens[m.group(2)].append(t)
            if upto(t):
                pending[m.group(2)] = (m.group(3), m.group(5))
            continue
        m = S4_WAIT_END.match(line)
        if m:
            t = s4_epoch(m.group(1))
            if upto(t):
                pending.pop(m.group(2), None)
            if not inwin(t):
                continue
            kind, reset, end = m.group(3), m.group(5), m.group(7)
            ended[f"{kind}:{end}"] += 1
            if kind == "noroom" and end not in ("turned", "stale") and reset.isdigit() and t > int(reset) + S4_GRACE:
                past.append((end, t - int(reset)))
            # A chain wait reaches its reset when it ends there (`turned`), when
            # Claude Code continued at or after it (`clear`), or when it became the
            # near wait on that same reset (`near`, ended by rule 2 at the reset).
            at_reset = end in ("turned", "near") or (end == "clear" and reset.isdigit() and t >= int(reset))
            if kind == "chain" and end != "swap" and not at_reset:
                chain_neither += 1
            if kind == "near" and end == "swap":
                near_swap += 1

    for sid, (kind, reset) in pending.items():
        if kind != "noroom" or not reset.isdigit() or ref <= int(reset) + S4_GRACE:
            continue
        if until is None:
            try:
                with open(os.path.join(ctx["home"], ".cc-sessions", sid + ".rescuewait")) as fh:
                    rec = fh.read().split()
            except OSError:
                continue
            if "state=open" not in rec:
                continue
        past.append(("open", ref - int(reset)))
    past_by_end = collections.Counter(end for end, _ in past)

    # §9's stage-4 target, restated 2026-10-03 (review 246's F6): no session
    # takes a FOURTH rescue inside an hour that no chain wait preceded. Rule 3
    # counts LANDED rescues (a dispatch whose swap was refused never left), so
    # this row does too: a rescue landed when the session's next `swap <id>:
    # <from> -> <to>` line, before its next rescue, names the same move. Only a
    # fourth rescue the chain wait could have held is asked about — one on a
    # dated block (`reset=` and `type=` on its line) not past its five-hour
    # reset's grace, the chain wait's own gate; "preceded" is a `kind=chain`
    # entry line for that session between the third rescue and the fourth. A
    # `reset=` that is not one to twelve digits is no date: any session can
    # append to swap.log, and `int()` of a forged token raises.
    # Named cost: a Codex-lane session is never chain-waited, by rule, and the
    # log does not say which lane a source account is, so a dated fourth rescue
    # of one counts here; its line names its source account.
    unchained = 0
    for sid, mv in moves.items():
        mv.sort(key=lambda x: x[0])
        lands = sorted(landed_moves.get(sid, []))
        done = []
        for k, (t, src, dst, tok) in enumerate(mv):
            nxt = mv[k + 1][0] if k + 1 < len(mv) else float("inf")
            if any(t <= lt < nxt and (ls, ld) == (src, dst) for lt, ls, ld in lands):
                done.append((t, tok))
        for i in range(3, len(done)):
            t, tok = done[i]
            if not inwin(t) or t - done[i - 3][0] >= 3600 or not re.fullmatch(r"\d{1,12}", tok.get("reset", "")) or "type" not in tok:
                continue
            if tok.get("type") == "five_hour" and t >= int(tok["reset"]) + S4_GRACE:
                continue
            if not any(done[i - 1][0] <= c <= t for c in chain_opens.get(sid, [])):
                unchained += 1
                break

    # Sessions with RESCUE_CHAIN_COUNT + 1 (= 4) or more auto-rescues inside any 60 minutes.
    by_sess = collections.defaultdict(list)
    for t, sid, _ in rescues:
        by_sess[sid].append(t)
    worst, four_plus = 0, 0
    for ts in by_sess.values():
        ts.sort()
        best = max((sum(1 for u in ts if t <= u < t + 3600) for t in ts), default=0)
        worst = max(worst, best)
        four_plus += best >= 4
    # A rescue on a carried-in banner: its `row=` is older than the landing the
    # LOG records for that session (the newest `swap <id>:` line before the
    # rescue) — measured from the log, not from the clock that decided. Since
    # D-3526 the one sanctioned case is a landing whose Claude Code never came up.
    dated, on_carried = 0, 0
    for t, sid, tok in rescues:
        if "row" not in tok:
            continue
        dated += 1
        before = [u for u in landings.get(sid, []) if u <= t]
        if before and int(tok["row"]) < max(before) - 1:
            on_carried += 1
    # §9: pane positives D-3526 suppressed that became a rescue of the same
    # session within 5 minutes (a real block read as carried in while the
    # transcript lagged the pane). The transcript rung's suppressions are
    # counted by `via` beside it.
    pane_became = sum(1 for t, sid, via in carried if via in ("pane", "banner")
                      and any(r[1] == sid and 0 <= r[0] - t <= 300 for r in rescues))

    return {"rescue": {
        "rescues": len(rescues),
        "sessions_with_4plus_rescues_in_an_hour": four_plus,
        "max_rescues_in_an_hour": worst,
        "sessions_with_an_unchained_4th_rescue_in_an_hour": unchained,
        "chain_waits_ending_in_neither_swap_nor_reset": chain_neither,
        "rescues_on_a_carried_in_banner": on_carried,
        "rescues_with_a_dated_row": dated,
        "near_reset_waits_ending_in_a_swap": near_swap,
        "rule1_suppressions_by_via": dict(sorted(collections.Counter(v for _, _, v in carried).items())),
        "rule1_pane_suppressions_rescued_within_5min": pane_became,
        "waits_opened_by_kind": dict(sorted(opened.items())),
        "waits_ended_by_kind_and_end": dict(sorted(ended.items())),
        "noroom_waits_past_their_reset": len(past),
        "noroom_waits_past_their_reset_by_end": dict(sorted(past_by_end.items())),
        "noroom_seconds_past_their_reset_total": sum(s for _, s in past),
        "noroom_seconds_past_their_reset_max": max((s for _, s in past), default=0),
    }}


# ── stage 7 (wave 3): the operator's choice survives a restart ──────────────
# §9's stage-7 row, "restarts that revert an operator's /model", read off
# swap.log. Before a stop that a spawn follows, ccd writes an operator's own
# `/model` or `/effort` to the route record (`route <id>: <field> <old> -> <new>
# [actor=operator-session]`), or says why it could not: a value outside the
# vocabulary, or one the record's own checks refused (`operator-choice <id>: …`).
# Those two are the restarts at which ccd KNOWS it reverted the operator's
# choice, so they are the row. It counts RESTARTS, not distinct choices: a
# `/model` ccd cannot keep is logged again at every later restart until a newer
# command replaces it (it reverts again at each). The writes are reported
# beside the row, and so are the stops where ccd could not read at all
# (`operator-choice <id>: unmeasured (…)`), which MAY have reverted one — never
# folded into the row, never dropped. Named cost: a
# supervisor revival reads the transcript before its spawn and logs like a stop,
# but a session on a non-Anthropic lane is skipped and leaves no line, so its
# `/model` is never counted.
# Self-contained, as stage 4.
S7_WRITE = re.compile(r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) route (\S+): (class|effort) .+? -> (\S+) \[actor=operator-session\]")
S7_SKIP = re.compile(r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) operator-choice (\S+): /(model|effort) .*(outside the \S+ vocabulary|refused by the route record)")
S7_UNMEASURED = re.compile(r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) operator-choice (\S+): unmeasured \(")


def stage7(ctx):
    since, until = ctx["since"], ctx["until"]
    path = ctx["swap_log"] or os.path.join(ctx["home"], ".cc-sessions", "swap.log")
    try:
        with open(path, "rb") as fh:
            lines = [raw.decode("utf-8", "replace").rstrip("\n") for raw in fh]
    except FileNotFoundError:
        return {"operator_choice": {"swap_log": "absent"}}
    def inwin(stamp):
        try:
            t = int(time.mktime(time.strptime(stamp, "%Y-%m-%d %H:%M:%S")))
        except (ValueError, OverflowError):
            return False
        return (since is None or t >= since) and (until is None or t < until)
    written, outside, refused = collections.Counter(), collections.Counter(), collections.Counter()
    unmeasured = 0
    for line in lines:
        m = S7_WRITE.match(line)
        if m and inwin(m.group(1)):
            written[m.group(3)] += 1
            continue
        m = S7_SKIP.match(line)
        if m and inwin(m.group(1)):
            (outside if m.group(4).startswith("outside") else refused)[m.group(3)] += 1
            continue
        m = S7_UNMEASURED.match(line)
        if m and inwin(m.group(1)):
            unmeasured += 1
    return {"operator_choice": {
        "restarts_that_reverted_an_operator_model": outside["model"] + refused["model"],
        "operator_choices_written_by_field": dict(sorted(written.items())),
        "operator_values_outside_the_vocabulary_by_kind": dict(sorted(outside.items())),
        "operator_choices_refused_by_kind": dict(sorted(refused.items())),
        "stops_that_could_not_read_the_transcript": unmeasured,
    }}


STAGES = {1: stage1, 4: stage4, 7: stage7}


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

#!/usr/bin/env python3
"""The working-state programme's instrument (spec 2026-10-16 §8, plan Task M). READ-ONLY.

Run by hand on the fleet box, as the fleet user. It opens every file it reads
read-only and writes nothing, except in `--poll` mode, where it writes exactly
one file: `--out`, which must not exist yet (opened with O_EXCL, never
overwritten). It never runs tmux, `ccd` or a unit command. Its only
subprocesses are one read-only `journalctl --user` run (`deaths`, `spawn`;
`--journal FILE` reads an export instead) and read-only `ccrc-api feed list` /
`ccrc-api mail list` reads (`pushes`, `interrupts`, `stall`; `--feed FILE` and
`--mail FILE` read exports instead).

WHAT IT READS, AND NOTHING ELSE (plan Task M): `<home>/.claude*/sessions/*.json`
(Claude Code's live files), `$REG/<id>.uuid`, `$REG/<id>.hookstate.json`,
`$REG/<id>.turn.json`, `$REG/<id>.hibernated`, `$REG/.lifecycle/journal-*.ndjson`
(ccd's own act journal, for `hibernate` acts), `$REG/swap.log`,
`<home>/.ccrc/server-caps`, the user journal, the server's feed and mail
through `ccrc-api`, and main transcripts (`<home>/.claude*/projects/*/<uuid>.jsonl`)
on the box only, to find turn ends. From a transcript row it reads `type`,
`subtype`, `timestamp`, `isSidechain`, `isCompactSummary`, `isApiErrorMessage`
and `message.stop_reason`, never a row's text.

WHAT LEAVES: counts. No session id, name, path, transcript text or mail
subject is ever printed (`measure-working-state.test.ts` pins it with a
sentinel). The `--poll` output file stays on the box: it carries a salted
digest per session (`sid`), never the id, so samples can be grouped by session
and nothing else.

    python3 deploy/measure-working-state.py                                  # every section with its inputs
    python3 deploy/measure-working-state.py --section snapshot --json
    python3 deploy/measure-working-state.py --poll 210 --interval 2 --out ~/wstate-poll-1.jsonl
    python3 deploy/measure-working-state.py --section samples --samples ~/wstate-poll-1.jsonl
    python3 deploy/measure-working-state.py --since '2026-10-08 22:15' --until '2026-10-15 22:15'

`--since` (inclusive) and `--until` (exclusive) are `YYYY-MM-DD[ HH:MM[:SS]]`
in LOCAL time, because swap.log's stamps are `date '+%F %T'` on the box that
wrote them; run it on the fleet box (or with TZ set to its zone). `--now`
(epoch seconds) pins the snapshot's clock for the test suite. Live-file,
hookstate and turn-marker stamps are epoch MILLISECONDS; feed and mail `at`
are epoch milliseconds; transcript stamps are ISO UTC.

SECTIONS (each one function in SECTIONS; `--section` repeats):
  snapshot    one read of every registry row now (§1.2 S1, S3a, S4; §8's idle
              ages for Task 19, the hibernation markers, server-caps)
  samples     the poll's episodes (`--samples FILE`): S1's done-while-busy
              episodes per hour and share of busy seconds, delegation-caused;
              compaction-minted `done` badges; delegated episodes that end with
              no `done` (spec §9's known limit)
  pushes      every "Finished" (`done`) feed event in the window, classified
              against its session's main transcript (S3)
  deaths      the user journal: session ends per day, OOM-associated, by
              journal signature; re-drives followed by another end (I1, I1b)
  swaps       swap.log's swap acts by kind, and those that cut output (I2)
  interrupts  interrupt feed events by source (D-5237) and swap.log Escapes
  stall       stall-watch notices by kind (the §5.2 regression guard)
  spawn       pane come-up latency after a restart: the claude-session unit's
              start to the turn marker's `restartAt` (D-5276's re-measure)
"""
import argparse
import calendar
import collections
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import time

# ── the second spellings, each bound to its home by measure-working-state.test.ts ──
# shared/api.ts: NON_DELEGATING_TASK_KINDS (D-5231). The turn marker lists kinds,
# never statuses, so a marker-only reading counts a listed kind outside this set
# as delegated (the hookstate's own `bgDelegated`, when present, wins).
NON_DELEGATING = ('shell', 'monitor', 'mcp-task', 'dream', 'auto-mode-scan', 'memory-import')
# server/src/hookstate.ts: HOOKSTATE_FRESH_MS.
HOOKSTATE_FRESH_MS = 30 * 60 * 1000
# server/src/fleet.ts: BACKGROUND_CARRIER_EVENTS (D-5272).
CARRIER_EVENTS = ('Stop', 'SubagentStart', 'SubagentStop')
# server/src/livestate.ts: liveStatusCoversDelegation's floor.
COVERS_DELEGATION_FROM = (2, 1, 277)
# ccd/ccd: `echo "session $id ended; exiting for systemd restart"`.
END_RE = re.compile(r"^session (\S+) ended; exiting for systemd restart$")
# D-5237's interrupt sources (an older or newer word is `unknown`).
INTERRUPT_SOURCES = ('keycap', 'escape-key', 'deny', 'drawer-escape', 'drawer-ctrl-c', 'unknown')
# server/src/coord/stall.ts: STALL_CHECK_PREFIX, STALL_REPORT_PREFIX, STALL_SENDER.
STALL_CHECK_PREFIX = 'stall-check:'
STALL_REPORT_PREFIX = 'stall:'
STALL_SENDER = 'operator'

# ── the instrument's own rules (named, so a reader sees what each count means) ──
OOM_DEATH_S = 15          # §1.3 I1: an end within 15 s after a pane-scope OOM kill is OOM-associated
OOM_FAILED_PAIR_S = 60    # a `Failed with result 'oom-kill'` line within 60 s of its scope's kill
REDRIVE_LOOP_S = 600      # §1.3 I1b: a re-drive followed by another end of the session within 10 min
RESUME_OOM_S = 120        # Task 19: OOM kills within 120 s after a restart
SWAP_DECISION_S = 300     # an auto decision line at most 300 s before its act (SWAP_JITTER is 0-120 s)
SWAP_OUTPUT_S = 30        # a swap "cut output" when a main assistant row landed in the 30 s before its act
PUSH_LOOKBACK_S = 600     # the transcript stretch a push is classified over
PUSH_SLOP_S = 5           # a row up to 5 s after the push still precedes it (write lag)
PUSH_AFTER_S = 120        # a mid-turn push sees the turn continue within 2 min
OVERLOAD_N = 4            # an overload cluster: at least 4 sessions' pushes inside OVERLOAD_S
OVERLOAD_S = 3
CAPS_LEASE_S = 180        # D-5232: the hook believes server-caps for 180 s
IDLE_AGE_HOURS = (2, 4, 6, 12, 24)
JOURNAL_DEFAULT_DAYS = 7  # a live journal read with no --since covers the last week
JOURNAL_GREP = "exiting for systemd restart|killed by the OOM killer|oom-kill|claude-session@"
TS = r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)"


def local_epoch(stamp):
    """swap.log's local-time stamp -> epoch seconds, or None."""
    try:
        return int(time.mktime(time.strptime(stamp, "%Y-%m-%d %H:%M:%S")))
    except (ValueError, OverflowError):
        return None


def iso_epoch(stamp):
    """A transcript's ISO UTC stamp -> epoch seconds (float), or None."""
    if not isinstance(stamp, str) or len(stamp) < 19:
        return None
    try:
        t = calendar.timegm(time.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S"))
    except (ValueError, OverflowError):
        return None
    m = re.match(r"\.(\d+)", stamp[19:])
    return t + (float("0." + m.group(1)) if m else 0.0)


def in_window(t, ctx):
    return t is not None and (ctx["since"] is None or t >= ctx["since"]) \
        and (ctx["until"] is None or t < ctx["until"])


def read_json(path):
    try:
        with open(path, "rb") as fh:
            return json.loads(fh.read().decode("utf-8", "replace"))
    except (OSError, ValueError):
        return None


def read_lines(path):
    with open(path, "rb") as fh:
        return [raw.decode("utf-8", "replace").rstrip("\n") for raw in fh]


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def reg_dir(ctx):
    return os.path.join(ctx["home"], ".cc-sessions")


# ── the row readers ─────────────────────────────────────────────────────────────
def registry(ctx):
    """{id: uuid} over `$REG/*.uuid` (an empty or unreadable uuid is skipped)."""
    out = {}
    for p in sorted(glob.glob(os.path.join(reg_dir(ctx), "*.uuid"))):
        try:
            with open(p, "rb") as fh:
                uuid = fh.read().decode("utf-8", "replace").strip()
        except OSError:
            continue
        if uuid:
            out[os.path.basename(p)[:-len(".uuid")]] = uuid
    return out


def version_tuple(v):
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)", v or "")
    return tuple(int(x) for x in m.groups()) if m else None


def covers_delegation(version):
    t = version_tuple(version)
    return t is not None and t >= COVERS_DELEGATION_FROM


def live_files(ctx):
    """{sessionId: live} over every account root's live files; the newest
    `statusUpdatedAt` wins where two name one session. `unreadable` counts the
    files read as not JSON (a torn read, D-5234)."""
    out, unreadable = {}, 0
    for p in sorted(glob.glob(os.path.join(ctx["home"], ".claude*", "sessions", "*.json"))):
        raw = read_json(p)
        if not isinstance(raw, dict):
            unreadable += 1
            continue
        sid = raw.get("sessionId")
        if not isinstance(sid, str):
            continue
        live = {
            "status": raw.get("status") if isinstance(raw.get("status"), str) else "",
            "since": raw.get("statusUpdatedAt") if is_num(raw.get("statusUpdatedAt")) else None,
            "startedAt": raw.get("startedAt") if is_num(raw.get("startedAt")) else None,
            "version": raw.get("version") if isinstance(raw.get("version"), str) else None,
        }
        prev = out.get(sid)
        if prev is None or (live["since"] or 0) > (prev["since"] or 0):
            out[sid] = live
    return out, unreadable


def hookstate(ctx, rid, uuid):
    """The hookstate's fields this instrument reads, or None (absent, malformed or
    another session's). Freshness is the caller's (`hook_fresh`)."""
    raw = read_json(os.path.join(reg_dir(ctx), rid + ".hookstate.json"))
    if not isinstance(raw, dict) or raw.get("v") != 1 or raw.get("sessionId") != uuid:
        return None
    if raw.get("state") not in ("working", "waiting", "done") or not is_num(raw.get("updatedAt")):
        return None
    subs = raw.get("subagents") if isinstance(raw.get("subagents"), list) else []
    bgd = raw.get("bgDelegated")
    return {
        "state": raw["state"],
        "event": raw.get("event") if isinstance(raw.get("event"), str) else None,
        "updatedAt": raw["updatedAt"],
        "aliveAt": raw.get("aliveAt") if is_num(raw.get("aliveAt")) else None,
        "subagents": [s for s in subs if isinstance(s, dict)],
        "bgDelegated": bgd if is_int(bgd) and bgd >= 0 else None,
    }


def turnmark(ctx, rid, uuid):
    """The turn marker's fields this instrument reads, or None."""
    raw = read_json(os.path.join(reg_dir(ctx), rid + ".turn.json"))
    if not isinstance(raw, dict) or raw.get("v") != 1 or raw.get("sessionId") != uuid:
        return None
    if raw.get("state") not in ("working", "done", "failed") or not is_int(raw.get("at")):
        return None
    kinds = raw.get("bgKinds") if isinstance(raw.get("bgKinds"), str) else ""
    crons = raw.get("crons")
    return {
        "state": raw["state"], "event": raw.get("event"), "at": raw["at"],
        "bg": raw.get("bg") if is_int(raw.get("bg")) else None,
        "kinds": [k for k in kinds.split(",") if k],
        "restartAt": raw.get("restartAt") if is_int(raw.get("restartAt")) else None,
        "crons": crons if is_int(crons) and crons >= 0 else None,
    }


def marker_delegated(mark):
    """The last main Stop listed delegated work, by the marker's kinds (DERIVED:
    the marker keeps no statuses, so a listed kind outside NON_DELEGATING counts)."""
    return mark is not None and mark["state"] == "done" and mark["event"] == "Stop" \
        and (mark["bg"] or 0) > 0 and any(k not in NON_DELEGATING for k in mark["kinds"])


def hook_fresh(hs, now_ms):
    return hs is not None and now_ms - max(hs["updatedAt"], hs["aliveAt"] or hs["updatedAt"]) <= HOOKSTATE_FRESH_MS


def shown_bucket(live, hs, now_ms, rung):
    """`sessionBucket`'s non-attention rungs (shared/api.ts), mirrored: 'working',
    'done' or 'idle'. `rung` False drops D-5231's `!delegated` rung, which is what
    a server before Task 1 showed for the same files."""
    h = hs if hook_fresh(hs, now_ms) else None
    status = "idle" if live is None or live["status"] == "idle" else "busy"
    since = live["since"] if live else None
    hook_newer = h is not None and (since is None or h["updatedAt"] > since)
    delegated = rung and h is not None and h["state"] == "done" and h["event"] in CARRIER_EVENTS \
        and (h["bgDelegated"] or 0) > 0 and live is not None and covers_delegation(live["version"])
    finished_after = hook_newer and h["state"] == "done" and h["event"] != "SessionStart" and not delegated
    if status == "busy" and not finished_after:
        return "working"
    if h is not None and h["state"] == "working" and hook_newer:
        return "working"
    if h is not None and h["state"] == "done" and h["event"] != "SessionStart":
        return "done"
    return "idle"


def rows_now(ctx, now_ms):
    """Every registry row joined to its live file, hookstate and turn marker."""
    lives, unreadable = live_files(ctx)
    out = []
    for rid, uuid in registry(ctx).items():
        out.append({"id": rid, "uuid": uuid, "live": lives.get(uuid),
                    "hs": hookstate(ctx, rid, uuid), "mark": turnmark(ctx, rid, uuid)})
    return out, unreadable


# ── snapshot ───────────────────────────────────────────────────────────────────
def server_caps(ctx, now_s):
    """`<home>/.ccrc/server-caps` (D-5232: `at`, `caps`, `end`). DERIVED from the
    ledger's prose until Task 9b lands its writer: `at <epoch-s>` / `at=<epoch-s>`,
    `caps <word> …` / `caps=<word>,…`, and a closing `end` line."""
    p = os.path.join(ctx["home"], ".ccrc", "server-caps")
    try:
        lines = read_lines(p)
    except OSError:
        return {"server_caps": "absent"}
    at, words, end = None, [], False
    for line in lines:
        m = re.match(r"^\s*(at|caps|end)\b[\s=]*(.*)$", line)
        if not m:
            continue
        if m.group(1) == "at" and m.group(2).strip().isdigit():
            at = int(m.group(2).strip())
        elif m.group(1) == "caps":
            words = [w for w in re.split(r"[\s,]+", m.group(2).strip()) if w]
        elif m.group(1) == "end":
            end = True
    if at is None or not end:
        return {"server_caps": "incomplete"}
    state = "current" if 0 <= now_s - at <= CAPS_LEASE_S else "stale"
    return {"server_caps": state, "server_caps_age_s": now_s - at, "server_caps_words": sorted(words)}


def hibernate_acts(ctx):
    n = 0
    for f in sorted(glob.glob(os.path.join(reg_dir(ctx), ".lifecycle", "journal-*.ndjson"))):
        try:
            lines = read_lines(f)
        except OSError:
            continue
        for line in lines:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if isinstance(e, dict) and e.get("act") == "hibernate" and e.get("outcome") == "done" \
                    and is_int(e.get("at")) and in_window(e["at"] / 1000.0, ctx):
                n += 1
    return n


def s_snapshot(ctx):
    now_ms = ctx["now"] * 1000
    rows, unreadable = rows_now(ctx, now_ms)
    live = [r for r in rows if r["live"] is not None]
    hs_rows = [r for r in rows if r["hs"] is not None]
    roster_total = sum(len(r["hs"]["subagents"]) for r in hs_rows)
    stale_entries, stale_files = 0, 0
    for r in hs_rows:
        started = r["live"]["startedAt"] if r["live"] else None
        n = 0 if started is None else sum(1 for s in r["hs"]["subagents"]
                                           if is_num(s.get("startedAt")) and s["startedAt"] < started)
        stale_entries += n
        stale_files += 1 if n else 0
    idle_pc = [r for r in live if r["live"]["status"] == "idle" and r["hs"] is not None
               and r["hs"]["state"] == "working" and r["hs"]["event"] == "PostCompact"]
    busy = [r for r in live if r["live"]["status"] != "idle"]
    done_busy = [r for r in busy if shown_bucket(r["live"], r["hs"], now_ms, True) == "done"]
    raw_done_busy = [r for r in busy if shown_bucket(r["live"], r["hs"], now_ms, False) == "done"]
    compaction_done = [r for r in rows if hook_fresh(r["hs"], now_ms)
                       and r["hs"]["state"] == "done" and r["hs"]["event"] == "PostCompact"]
    ages = []
    unknown_age = 0
    scheduled = crons_unknown = 0
    for r in live:
        if r["live"]["status"] != "idle":
            continue
        last = r["mark"]["at"] if r["mark"] else (r["hs"]["updatedAt"] if r["hs"] else None)
        if last is None:
            unknown_age += 1
        else:
            ages.append((now_ms - last) / 3600000.0)
        c = r["mark"]["crons"] if r["mark"] else None
        if c is None:
            crons_unknown += 1
        elif c > 0:
            scheduled += 1
    hibernated = len(glob.glob(os.path.join(reg_dir(ctx), "*.hibernated")))
    out = {
        "rows": len(rows), "live_sessions": len(live), "live_unreadable": unreadable,
        "hookstate_files": len(hs_rows),
        "roster_entries": roster_total,
        "roster_files_with_entries": sum(1 for r in hs_rows if r["hs"]["subagents"]),
        "roster_entries_older_than_process": stale_entries,
        "roster_files_with_stale": stale_files,
        "idle_working_postcompact": len(idle_pc),
        "busy_sessions": len(busy),
        "shown_done_while_busy": len(done_busy),
        "shown_done_while_busy_delegated": sum(1 for r in done_busy if marker_delegated(r["mark"])),
        "pre_d5231_done_while_busy": len(raw_done_busy),
        "pre_d5231_done_while_busy_delegated": sum(1 for r in raw_done_busy if marker_delegated(r["mark"])),
        "compaction_done_badges": len(compaction_done),
        "idle_live_sessions": len(ages) + unknown_age,
        "idle_age_unknown": unknown_age,
        "hold_scheduled": scheduled, "hold_scheduled_unknown": crons_unknown,
        "hold_attached": "unmeasured (tmux is never run)",
        "hold_viewer": "unmeasured (the server's presence is not on this box)",
        "hibernated_markers": hibernated,
        "hibernate_acts_in_window": hibernate_acts(ctx),
    }
    for h in IDLE_AGE_HOURS:
        out["idle_age_over_%dh" % h] = sum(1 for a in ages if a > h)
    out.update(server_caps(ctx, ctx["now"]))
    return out


# ── poll and samples ───────────────────────────────────────────────────────────
def digest(salt, rid):
    return hashlib.sha256((salt + "\0" + rid).encode()).hexdigest()[:16]


def sample(ctx, salt, now_ms):
    rows, _ = rows_now(ctx, now_ms)
    out = []
    for r in rows:
        if r["live"] is None:
            continue
        out.append({
            "sid": digest(salt, r["id"]),
            "busy": r["live"]["status"] != "idle",
            "shown": shown_bucket(r["live"], r["hs"], now_ms, True),
            "pre": shown_bucket(r["live"], r["hs"], now_ms, False),
            "delegated": marker_delegated(r["mark"]) or bool(r["hs"] and (r["hs"]["bgDelegated"] or 0) > 0),
            "markdone": bool(r["mark"] and r["mark"]["state"] == "done"),
            "hook": None if r["hs"] is None else [r["hs"]["state"], r["hs"]["event"], r["hs"]["updatedAt"]],
            "hookfresh": hook_fresh(r["hs"], now_ms),
        })
    return {"t": now_ms, "rows": out}


def poll(ctx, n, interval, out_path):
    salt = os.urandom(16).hex()
    fd = os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as fh:
        for i in range(n):
            if i:
                time.sleep(interval)
            fh.write(json.dumps(sample(ctx, salt, int(time.time() * 1000))) + "\n")
            fh.flush()
    return {"samples_written": n}


def s_samples(ctx):
    if not ctx.get("samples"):
        return {"samples": "no --samples file"}
    ticks = []
    try:
        for line in read_lines(ctx["samples"]):
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if isinstance(e, dict) and is_num(e.get("t")) and isinstance(e.get("rows"), list):
                ticks.append(e)
    except OSError:
        return {"samples": "unreadable"}
    ticks.sort(key=lambda e: e["t"])
    if not ticks:
        return {"samples": 0}
    gaps = sorted(b["t"] - a["t"] for a, b in zip(ticks, ticks[1:]))
    step = gaps[len(gaps) // 2] if gaps else 0
    span_s = (ticks[-1]["t"] - ticks[0]["t"] + step) / 1000.0
    per = collections.defaultdict(list)
    for i, e in enumerate(ticks):
        dt = (ticks[i + 1]["t"] - e["t"]) if i + 1 < len(ticks) else step
        for r in e["rows"]:
            if isinstance(r, dict) and isinstance(r.get("sid"), str):
                per[r["sid"]].append((dt / 1000.0, r))
    busy_s = 0.0
    res = {"shown": [0, 0, 0.0], "pre": [0, 0, 0.0]}   # episodes, delegation-caused, seconds
    badges = set()
    ends_no_done = ends_done = 0
    for sid, seq in per.items():
        for key in ("shown", "pre"):
            # An episode: consecutive samples of one session showing `done` over a
            # live busy; delegation-caused when any of its samples had delegated work.
            ep = None
            for dt, r in seq + [(0, None)]:
                if r is not None and r.get("busy") and r.get(key) == "done":
                    res[key][2] += dt
                    ep = bool(r.get("delegated")) or bool(ep)
                elif ep is not None:
                    res[key][0] += 1
                    res[key][1] += 1 if ep else 0
                    ep = None
        prev = None
        for dt, r in seq:
            if r.get("busy"):
                busy_s += dt
            h = r.get("hook")
            if isinstance(h, list) and len(h) == 3 and h[0] == "done" and h[1] == "PostCompact" and r.get("hookfresh"):
                badges.add((sid, h[2]))
            if prev is not None and prev.get("busy") and not r.get("busy") and prev.get("delegated") and r.get("markdone"):
                if r.get("shown") == "done":
                    ends_done += 1
                else:
                    ends_no_done += 1
            prev = r
    hours = span_s / 3600.0 if span_s > 0 else 0
    out = {"samples": len(ticks), "sessions": len(per), "span_s": round(span_s, 1),
           "busy_session_seconds": round(busy_s, 1)}
    for key, label in (("shown", "done_while_busy"), ("pre", "pre_d5231_done_while_busy")):
        ep, dele, secs = res[key]
        out[label + "_episodes"] = ep
        out[label + "_episodes_delegated"] = dele
        out[label + "_episodes_per_hour"] = round(ep / hours, 2) if hours else 0
        out[label + "_seconds"] = round(secs, 1)
        out[label + "_share_of_busy"] = round(secs / busy_s, 4) if busy_s else 0
    out["compaction_done_badges"] = len(badges)
    out["compaction_done_badges_per_hour"] = round(len(badges) / hours, 2) if hours else 0
    out["delegated_ends_with_done"] = ends_done
    out["delegated_ends_with_no_done"] = ends_no_done
    return out


# ── server reads (feed, mail) ──────────────────────────────────────────────────
def ccrc_api(args):
    try:
        p = subprocess.run(["ccrc-api"] + args, capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0:
        return None
    try:
        return json.loads(p.stdout.decode("utf-8", "replace"))
    except ValueError:
        return None


def json_docs(path):
    """A file of one JSON document, or of one per line."""
    try:
        with open(path, "rb") as fh:
            text = fh.read().decode("utf-8", "replace")
    except OSError:
        return None
    try:
        return [json.loads(text)]
    except ValueError:
        out = []
        for line in text.splitlines():
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
        return out


def feed_events(ctx):
    if "feed_cache" in ctx:
        return ctx["feed_cache"]
    docs = json_docs(ctx["feed"]) if ctx.get("feed") else [ccrc_api(["feed", "list", "--limit", "100000"])]
    if docs is None or docs == [None]:
        ctx["feed_cache"] = None
        return None
    out = []
    for d in docs:
        evs = d.get("events") if isinstance(d, dict) else d if isinstance(d, list) else None
        for e in evs or []:
            if isinstance(e, dict) and is_num(e.get("at")) and isinstance(e.get("kind"), str):
                out.append(e)
    ctx["feed_cache"] = out
    return out


def mail_rows(ctx):
    if ctx.get("mail"):
        docs = json_docs(ctx["mail"])
    else:
        docs = [ccrc_api(["mail", "list", "--to", rid, "--all", "1", "--limit", "5000"]) for rid in registry(ctx)]
        docs = [d for d in docs if d is not None] or None
    if docs is None:
        return None
    seen, out = set(), []
    for d in docs:
        ms = d.get("mail") if isinstance(d, dict) else d if isinstance(d, list) else None
        for m in ms or []:
            if not isinstance(m, dict) or not is_num(m.get("at")):
                continue
            key = (m.get("id"), m.get("toId"), m.get("deliveryId"))
            if key in seen:
                continue
            seen.add(key)
            out.append(m)
    return out


# ── transcripts ────────────────────────────────────────────────────────────────
def transcript_path(ctx, uuid):
    best = None
    for p in glob.glob(os.path.join(ctx["home"], ".claude*", "projects", "*", uuid + ".jsonl")):
        try:
            size = os.stat(p).st_size
        except OSError:
            continue
        if best is None or size > best[1]:
            best = (p, size)
    return best[0] if best else None


def transcript_rows(ctx, uuid):
    """The main thread's rows as (t, kind) oldest first, or None with no transcript.
    kind: 'end' (an assistant row that ended a turn: a string stop_reason other
    than tool_use), 'error' (an API error, which also ends a turn but is not
    output), 'tool' (an assistant tool_use row), 'out'
    (an assistant row with no stop_reason), 'compact' (a compaction boundary or
    summary), 'user' (any other user row). Only the named keys are read."""
    cache = ctx.setdefault("tx_cache", {})
    if uuid in cache:
        return cache[uuid]
    p = transcript_path(ctx, uuid)
    if p is None:
        cache[uuid] = None
        return None
    rows = []
    try:
        lines = read_lines(p)
    except OSError:
        cache[uuid] = None
        return None
    for line in lines:
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if not isinstance(r, dict) or r.get("isSidechain") is True:
            continue
        t = iso_epoch(r.get("timestamp"))
        if t is None:
            continue
        typ = r.get("type")
        if typ == "system" and r.get("subtype") == "compact_boundary":
            rows.append((t, "compact"))
        elif typ == "user":
            rows.append((t, "compact" if r.get("isCompactSummary") is True else "user"))
        elif typ == "assistant":
            msg = r.get("message") if isinstance(r.get("message"), dict) else {}
            sr = msg.get("stop_reason")
            if r.get("isApiErrorMessage") is True:
                rows.append((t, "error"))
            elif sr == "tool_use":
                rows.append((t, "tool"))
            elif isinstance(sr, str):
                rows.append((t, "end"))
            else:
                rows.append((t, "out"))
    rows.sort(key=lambda x: x[0])
    cache[uuid] = rows
    return rows


def assistant_output(ctx, uuid, t0, t1, rows=None):
    rows = transcript_rows(ctx, uuid) if rows is None else rows
    return rows is not None and any(t0 <= t <= t1 and k in ("end", "tool", "out") for t, k in rows)


# ── journal ────────────────────────────────────────────────────────────────────
def journal(ctx):
    """The journal records this instrument reads, as dicts with `t` (epoch s), or None."""
    if "journal_cache" in ctx:
        return ctx["journal_cache"]
    try:
        if ctx.get("journal"):
            with open(ctx["journal"], "rb") as fh:
                raw = fh.read()
        else:
            # Bounded: a day of slack around the window (an end's kill, a restart's
            # start), and with no --since the last JOURNAL_DEFAULT_DAYS days, never the
            # whole journal. `-g` keeps only the four record shapes read below; a
            # journalctl built without pcre2 refuses it, and the read is retried
            # without it (the filter below is the one that decides either way).
            args = ["journalctl", "--user", "--no-pager", "-o", "json",
                    "--output-fields=MESSAGE,USER_UNIT,_SYSTEMD_USER_UNIT,UNIT_RESULT,JOB_TYPE,JOB_RESULT",
                    "--since=@%d" % ((ctx["since"] if ctx["since"] is not None
                                      else ctx["now"] - JOURNAL_DEFAULT_DAYS * 86400) - 86400)]
            if ctx["until"] is not None:
                args.append("--until=@%d" % (ctx["until"] + 86400))
            grep = "-g" + JOURNAL_GREP
            p = subprocess.run(args + [grep], capture_output=True, timeout=600)
            if p.returncode != 0:
                p = subprocess.run(args, capture_output=True, timeout=600)
            if p.returncode != 0:
                ctx["journal_cache"] = None
                return None
            raw = p.stdout
    except (OSError, subprocess.SubprocessError):
        ctx["journal_cache"] = None
        return None
    out = []
    for line in raw.decode("utf-8", "replace").splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if not isinstance(e, dict):
            continue
        try:
            e["t"] = int(e.get("__REALTIME_TIMESTAMP")) / 1e6
        except (TypeError, ValueError):
            continue
        out.append(e)
    out.sort(key=lambda e: e["t"])
    ctx["journal_cache"] = out
    return out


def unit_of(e):
    return str(e.get("USER_UNIT") or e.get("_SYSTEMD_USER_UNIT") or "")


def message(e):
    m = e.get("MESSAGE")
    return m if isinstance(m, str) else ""


def journal_facts(recs):
    ends, kills, failed, starts = [], [], [], []
    for e in recs:
        msg, unit = message(e), unit_of(e)
        m = END_RE.match(msg)
        if m:
            ends.append((e["t"], m.group(1)))
        elif unit.startswith("tmux-spawn-") and "killed by the OOM killer" in msg:
            kills.append((e["t"], unit))
        elif unit.startswith("tmux-spawn-") and (e.get("UNIT_RESULT") == "oom-kill" or "Failed with result 'oom-kill'" in msg):
            failed.append((e["t"], unit))
        elif unit.startswith("claude-session@") and e.get("JOB_TYPE") == "start":
            starts.append((e["t"], unit[len("claude-session@"):].rsplit(".service", 1)[0]))
    return ends, kills, failed, starts


def swap_lines(ctx):
    try:
        lines = read_lines(ctx["swap_log"])
    except OSError:
        return None
    out = []
    for line in lines:
        m = re.match(TS + r" (\S+) (.*)$", line)
        if m:
            t = local_epoch(m.group(1))
            if t is not None:
                out.append((t, m.group(2), m.group(3)))
    return out


def s_deaths(ctx):
    recs = journal(ctx)
    if recs is None:
        return {"journal": "unreadable"}
    ends, kills, failed, _ = journal_facts(recs)
    wends = [(t, i) for t, i in ends if in_window(t, ctx)]
    by_day = collections.Counter(time.strftime("%Y-%m-%d", time.localtime(t)) for t, _ in wends)
    oom, with_failed = 0, 0
    for t, _ in wends:
        hit = [(tk, u) for tk, u in kills if t - OOM_DEATH_S <= tk <= t]
        if not hit:
            continue
        oom += 1
        tk, u = hit[-1]
        if any(fu == u and abs(tf - tk) <= OOM_FAILED_PAIR_S for tf, fu in failed):
            with_failed += 1
    wkills = [k for k in kills if in_window(k[0], ctx)]
    after_restart = sum(1 for tk, _ in wkills if any(t < tk <= t + RESUME_OOM_S for t, _ in ends))
    days = max(1, len(by_day)) if (ctx["since"] is None or ctx["until"] is None) \
        else max(1e-9, (ctx["until"] - ctx["since"]) / 86400.0)
    out = {
        "session_ends": len(wends),
        "session_ends_per_day": round(len(wends) / days, 2),
        "session_ends_by_day": dict(sorted(by_day.items())),
        "oom_associated": oom,
        "oom_associated_failed_line": with_failed,
        "oom_associated_no_failed_line": oom - with_failed,
        "victim_mapping": "unmeasured until Task 13 records the signatures",
        "pane_scope_oom_kills": len(wkills),
        "oom_kills_within_120s_after_a_restart": after_restart,
    }
    sl = swap_lines(ctx)
    if sl is None:
        out["redrives"] = "swap.log unreadable"
        return out
    redrives = [(t, rest.split(":", 1)[0]) for t, verb, rest in sl if verb == "redrive" and in_window(t, ctx)]
    loops = sum(1 for t, rid in redrives if any(i == rid and t < te <= t + REDRIVE_LOOP_S for te, i in ends))
    out["redrives"] = len(redrives)
    out["redrives_followed_by_an_end_within_10m"] = loops
    return out


def s_spawn(ctx):
    recs = journal(ctx)
    if recs is None:
        return {"journal": "unreadable"}
    _, _, _, starts = journal_facts(recs)
    lat = []
    for rid, uuid in registry(ctx).items():
        mark = turnmark(ctx, rid, uuid)
        if mark is None or mark["restartAt"] is None:
            continue
        ra = mark["restartAt"] / 1000.0
        if not in_window(ra, ctx):
            continue
        before = [t for t, i in starts if i == rid and t <= ra]
        if before:
            lat.append(ra - before[-1])
    lat.sort()

    def pct(q):
        return round(lat[min(len(lat) - 1, int(q * len(lat)))], 1) if lat else None
    return {"restarts_measured": len(lat), "unit_start_to_restartAt_p50_s": pct(0.5),
            "unit_start_to_restartAt_p95_s": pct(0.95), "unit_start_to_restartAt_max_s": round(lat[-1], 1) if lat else None}


# ── swaps ──────────────────────────────────────────────────────────────────────
SWAP_ACT = re.compile(r"^(\S+): (\S+) -> (\S+) \(uuid (\S+)\)$")
DECISION_VERBS = {"auto-home": "auto-home", "auto-pool": "auto-pool", "auto-rescue": "rescue"}


def s_swaps(ctx):
    sl = swap_lines(ctx)
    if sl is None:
        return {"swap_log": "unreadable"}
    kinds = ("auto-home", "auto-pool", "rescue", "manual")
    acts = {k: 0 for k in kinds}
    cut = {k: 0 for k in kinds}
    untold = {k: 0 for k in kinds}
    refused = collections.Counter()
    decisions = collections.defaultdict(list)
    for t, verb, rest in sl:
        if verb in DECISION_VERBS:
            decisions[rest.split(":", 1)[0]].append((t, DECISION_VERBS[verb]))
        elif verb == "swap-refused" and in_window(t, ctx):
            m = re.search(r"\(([^()]*)\)$", rest)
            refused[(m.group(1) if m else "?").split(" ", 1)[0]] += 1
        elif verb == "swap" and in_window(t, ctx):
            m = SWAP_ACT.match(rest)
            if not m:
                continue
            rid, uuid = m.group(1), m.group(4)
            prior = [(td, k) for td, k in decisions.get(rid, []) if t - SWAP_DECISION_S <= td <= t]
            kind = prior[-1][1] if prior else "manual"
            acts[kind] += 1
            rows = transcript_rows(ctx, uuid)
            if rows is None:
                untold[kind] += 1
            elif assistant_output(ctx, uuid, t - SWAP_OUTPUT_S, t, rows):
                cut[kind] += 1
    out = {}
    for k in kinds:
        out["swaps_" + k] = acts[k]
        out["swaps_" + k + "_cut_output"] = cut[k]
        out["swaps_" + k + "_no_transcript"] = untold[k]
    out["swap_refusals_by_reason"] = dict(sorted(refused.items()))
    return out


# ── pushes ─────────────────────────────────────────────────────────────────────
def classify_push(rows, t):
    """One push at t against the main rows: 'turn-end', 'compaction-only',
    'mid-turn' or 'uncertain'."""
    before = [(tr, k) for tr, k in rows if t - PUSH_LOOKBACK_S <= tr <= t + PUSH_SLOP_S]
    if not before:
        return "uncertain"
    last = before[-1][1]
    if last in ("end", "error"):
        return "turn-end"
    if last == "compact":
        return "compaction-only"
    if last in ("tool", "user", "out") and any(t + PUSH_SLOP_S < tr <= t + PUSH_AFTER_S and k in ("tool", "out", "end", "user")
                                                 for tr, k in rows):
        return "mid-turn"
    return "uncertain"


def s_pushes(ctx):
    evs = feed_events(ctx)
    if evs is None:
        return {"feed": "unreadable"}
    pushes = [(e["at"] / 1000.0, str(e.get("sessionId", ""))) for e in evs
              if e["kind"] == "done" and in_window(e["at"] / 1000.0, ctx)]
    pushes.sort()
    recs = journal(ctx) if ctx.get("journal") or ctx.get("journal_live") else None
    ends = journal_facts(recs)[0] if recs else []
    reg = registry(ctx)
    classes = collections.Counter()
    for t, rid in pushes:
        uuid = reg.get(rid)
        rows = transcript_rows(ctx, uuid) if uuid else None
        if rows is None:
            classes["unclassifiable"] += 1
            continue
        c = classify_push(rows, t)
        if c != "turn-end":
            if any(i == rid and t - PUSH_AFTER_S <= te <= t + PUSH_SLOP_S for te, i in ends):
                c = "restart"
            elif len({r for tp, r in pushes if abs(tp - t) <= OVERLOAD_S}) >= OVERLOAD_N:
                c = "overload"
        classes[c] += 1
    false = sum(classes[c] for c in ("compaction-only", "mid-turn", "restart", "overload"))
    classifiable = false + classes["turn-end"]
    days = None if ctx["since"] is None or ctx["until"] is None else (ctx["until"] - ctx["since"]) / 86400.0
    out = {"finished_pushes": len(pushes)}
    for c in ("turn-end", "compaction-only", "mid-turn", "restart", "overload", "uncertain", "unclassifiable"):
        out["push_" + c.replace("-", "_")] = classes[c]
    out["push_false"] = false
    out["push_classifiable"] = classifiable
    out["push_false_share"] = round(false / classifiable, 4) if classifiable else 0
    out["push_false_per_day"] = round(false / days, 2) if days else "needs --since and --until"
    out["push_restart_rule"] = "journal read" if recs else "no journal (pass --journal or --journal-live)"
    return out


# ── interrupts and stall notices ───────────────────────────────────────────────
def s_interrupts(ctx):
    out = {}
    evs = feed_events(ctx)
    if evs is None:
        out["feed"] = "unreadable"
    else:
        by = collections.Counter()
        for e in evs:
            if e["kind"] == "interrupt" and in_window(e["at"] / 1000.0, ctx):
                words = re.findall(r"[a-z-]+", str(e.get("body", "")) + " " + str(e.get("title", "")))
                by[next((w for w in words if w in INTERRUPT_SOURCES), "unknown")] += 1
        out["interrupt_events"] = sum(by.values())
        out["interrupt_events_by_source"] = {s: by[s] for s in INTERRUPT_SOURCES}
    sl = swap_lines(ctx)
    out["swaplog_escapes"] = "swap.log unreadable" if sl is None else \
        sum(1 for t, verb, _ in sl if verb == "escape" and in_window(t, ctx))
    return out


def s_stall(ctx):
    ms = mail_rows(ctx)
    if ms is None:
        return {"mail": "unreadable"}
    by = collections.Counter()
    for m in ms:
        if m.get("fromId") != STALL_SENDER or not in_window(m["at"] / 1000.0, ctx):
            continue
        subj = str(m.get("subject", ""))
        if subj.startswith(STALL_CHECK_PREFIX):
            by["check"] += 1
        elif subj.startswith(STALL_REPORT_PREFIX):
            k = re.search(r" — (frozen|dead|failed): ", subj)
            by[k.group(1) if k else "stall"] += 1
    return {"stall_notices": sum(by.values()),
            "stall_notices_by_kind": {k: by[k] for k in ("check", "stall", "frozen", "dead", "failed")}}


SECTIONS = {"snapshot": s_snapshot, "samples": s_samples, "pushes": s_pushes, "deaths": s_deaths,
            "swaps": s_swaps, "interrupts": s_interrupts, "stall": s_stall, "spawn": s_spawn}


def parse_local(s):
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return int(time.mktime(time.strptime(s, fmt)))
        except ValueError:
            continue
    raise argparse.ArgumentTypeError("not YYYY-MM-DD[ HH:MM[:SS]]: " + s)


def show(v):
    return json.dumps(v, sort_keys=True) if isinstance(v, (dict, list)) else str(v)


def main(argv=None):
    ap = argparse.ArgumentParser(description="working-state instrument (read-only)")
    ap.add_argument("--home", default=os.path.expanduser("~"))
    ap.add_argument("--swap-log", help="default: <home>/.cc-sessions/swap.log")
    ap.add_argument("--since", type=parse_local)
    ap.add_argument("--until", type=parse_local)
    ap.add_argument("--now", type=int, help="the snapshot's clock, epoch seconds (default: now)")
    ap.add_argument("--section", action="append", choices=sorted(SECTIONS))
    ap.add_argument("--journal", help="a `journalctl --user -o json` export to read instead of journalctl")
    ap.add_argument("--journal-live", action="store_true", help="pushes: also run journalctl for the restart rule")
    ap.add_argument("--feed", help="a `ccrc-api feed list` answer to read instead of ccrc-api")
    ap.add_argument("--mail", help="`ccrc-api mail list` answers (one per line) to read instead of ccrc-api")
    ap.add_argument("--samples", help="samples: a --poll output file")
    ap.add_argument("--poll", type=int, help="take this many samples and write them to --out")
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--out")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    ctx = {"home": a.home, "swap_log": a.swap_log or os.path.join(a.home, ".cc-sessions", "swap.log"),
           "since": a.since, "until": a.until, "now": a.now if a.now is not None else int(time.time()),
           "journal": a.journal, "journal_live": a.journal_live, "feed": a.feed, "mail": a.mail,
           "samples": a.samples}
    if a.poll is not None:
        if not a.out:
            ap.error("--poll needs --out")
        try:
            res = {"poll": poll(ctx, max(1, a.poll), a.interval, a.out)}
        except FileExistsError:
            ap.error("--out exists; the instrument never overwrites a file")
    else:
        names = a.section or [n for n in SECTIONS if n != "samples" or a.samples]
        res = {n: SECTIONS[n](ctx) for n in names}
    if a.json:
        print(json.dumps(res, sort_keys=True, indent=1))
    else:
        for name, sec in res.items():
            print("== " + name)
            for k, v in sec.items():
                print("%s: %s" % (k, show(v)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

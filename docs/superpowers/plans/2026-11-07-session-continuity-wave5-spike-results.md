# Session continuity, wave 5: the reduced stage 2 spike's results

> **What this is.** The results note of run 730, the reduced stage 2 spike planned in
> `docs/superpowers/plans/2026-11-07-session-continuity-wave5-reduced-spike.md`. It records measurements only.
> Any change they imply for stage 3 is the coordinator's, in wave 6's plan. Names are the plan's stand-ins
> (D-8109): `scratch-a`, `scratch-b`, `real-a`, `pool-s`, `project-s`, `<root-a>`, `<root-b>`, `<cwd>`,
> `<run-id>`, and `s1`, `s2`, … for sessions in history.

## In short

- **Task 1 (history, no account).** 184 resume calls are on disk, from 2026-07-20 to 2026-11-08. None of wave 1's five
  `script-path` refusals survives (35 of that window's 72 calls are past retention).
- **A script path returned before a swap, passed after it.** Up to 2026-10-21 it mostly passed the path check:
  28 of 33 calls were accepted or got as far as `journal-missing`. Since 2026-10-22 it has been refused every time
  (13 of 13, on builds 2.1.304 to 2.1.316). The build alone does not explain the change: 2.1.304 accepted one on
  2026-10-20 and refused four on 2026-10-24 and 10-26.
- **The carry's copy under the current root, never returned by the tool.** Accepted 3 times (2026-09-24 to 10-15),
  then refused 4 of 4 (2026-10-22 and 10-25).
- **The whole script passed inline (`script`) with `resumeFromRunId`, after a swap.** Accepted 5 of 5
  (2026-10-19 to 10-26). Each one came within a minute after a `script-path` refusal of the same run. The coordinator
  added it to the live matrix as row R5 (`inline-script-row`).
- **History does not test row R3.** No call passed a working-directory copy that the tool had not returned in the same
  process. Copies under `/tmp` that were never returned were accepted after a swap, 3 of 3.
- **Step 7 is closed:** doctor's `oom-policy` line reads PASS (D-8103).
- **Task 3 (live, build 2.1.314, after one `--interrupt` swap).** Two rows were refused, both with
  `scriptPath must be a script path this tool returned, …`:
  - R2, the old root's returned path;
  - R1, the same relative path under the current root (the carry's hard link of the same file).

  Two rows were accepted, and both runs completed:
  - R3, a copy in the working directory;
  - R5, the whole script inline.

  In both completed runs `quick` returned from cache and `slow` ran again from its start. R4 (`/add-dir`) was not run,
  because the operator declined it.
- **After the swap, nothing redrove the subject for 15.5 minutes.** It had been idle, so ccd sent no resume prompt.
  Seven stopped-task notifications started no turn. The stall watch's orphaned-task mail woke it.
- **Task 4 was not run (item 145).** The lent plan has no five-hour window, and a weekly limit cannot show a paused
  workflow under a blocked parent. Step 6, and the longer bound for delegated work it was to inform, stay open.

## 1. Task 1: the resume calls on disk

### 1.1 Method

A scratch walker, outside the repository, imports the installed `deploy/measure-continuity.py` under `python3 -I`
and uses its own `classify`, `iso_epoch`, `epoch`, `read_lines` and `TS`. It reads every transcript copy under every
`~/.claude*/projects/*/` (2,641 copies), with no time window, and keys calls by their tool-use id. Request-blob
rows (`type: api-request-blob`) are skipped, because they carry no timestamp. For each `Workflow` call carrying
`resumeFromRunId`, it records:
- the time and a session stand-in;
- the outcome, from the instrument's own classifier;
- the class of the `scriptPath` passed:
  - `current-root`: under the session's config root at that time;
  - `other-root`: under another account's root;
  - `cwd`: under the row's working directory;
  - `elsewhere`;
  - `none`, when the call passed `script` inline and no path.

  The root at that time comes from `swap.log`'s `swap <id>: <from> -> <to> (uuid <uuid>)` lines, through a wrapper
  to root map learned from the `sidecar <uuid> -> <dst>` lines that come before each swap (17 wrappers mapped). A
  session with no swap line falls back to the root of its only copy (20 calls).
- whether a non-error `Workflow` result earlier in the same transcript returned that exact path, and whether a restart
  came between that result and the call. A restart is either a `swap` line for the session's uuid or a ccd
  resume-prompt row (`Continue from where you left off. …`). A restart with neither is invisible to this method;
- the last restart before the call: for a swap, its trigger (`auto-rescue`, `auto-home` or a plain `swap` when no
  trigger line names the session in the 300 s before) and the carry's mode from the sidecar line; for a
  resume-prompt row, its time.

The instrument's own resume section, which reads only the largest copy of each uuid, counts 166 calls with no window:
ok 132, script-path 18, journal-missing 8, other-error 7 and no-result 1. The walker reads every copy and finds 18
more calls. Each is held only in a copy other than its uuid's largest, which means that copy diverged.

### 1.2 Counts

**All calls on disk**: 184 calls from 37 sessions, from 2026-07-20 10:24Z to 2026-11-08 00:26Z, on builds 2.1.215 to
2.1.319. The outcomes:
- ok: 134;
- script-path: 22;
- other-error: 19 (16 `Workflow <run-id> is still running … Stop it first with TaskStop`, and 3 script parse errors);
- journal-missing: 8;
- no-result: 1.

**What retention took.** Wave 1 counted 72 calls in 2026-09-08 to 2026-09-23 18:26 (ok 55, journal-missing 8,
script-path 5, other-error 4). The same window, read now by both the instrument and the walker, holds 37: ok 30,
journal-missing 5, other-error 2 and script-path 0. So 35 calls are gone, including **all five `script-path` refusals**.
They cannot be explained from disk.

**By path class and whether a swap came before the call** (at any earlier time):

| Path class | Swap before | ok | script-path | journal-missing | other-error | no-result |
|---|---|---|---|---|---|---|
| current-root | no | 30 | 0 | 0 | 13 | 0 |
| current-root | yes | 38 | 4 | 0 | 4 | 0 |
| other-root | no | 2 | 0 | 0 | 0 | 0 |
| other-root | yes | 24 | 18 | 7 | 1 | 1 |
| cwd | yes | 9 | 0 | 0 | 0 | 0 |
| elsewhere (`/tmp`, `/mnt`) | no | 4 | 0 | 0 | 0 | 0 |
| elsewhere (`/tmp`) | yes | 22 | 0 | 1 | 0 | 0 |
| none (inline `script`) | no | 0 | 0 | 0 | 1 | 0 |
| none (inline `script`) | yes | 5 | 0 | 0 | 0 | 0 |

*Table 1. Every resume call on disk.*

A swap at some earlier time says little alone. Most of the 38 accepted `current-root` calls after a swap passed a
path that the tool had returned in that same process, after the swap. The rows that settle something are those where
the path was returned **before** a swap and passed **after** it, in Table 2.

**A path returned before a swap and passed after it** (a swap line between the returning result and the call):

| Path class | Up to 2026-10-21 | From 2026-10-22 |
|---|---|---|
| other-root (the old root's script, as returned) | ok 20, journal-missing 7, no-result 1, script-path 5 | script-path 13 |
| current-root (returned there, swapped away and back) | ok 2 | none |
| elsewhere (`/tmp`) | ok 3, journal-missing 1 | ok 3 |

*Table 2. Calls with a swap between the result that returned the path and the call that passed it.*

The 46 `other-root` calls, by date, build, swap trigger and carry mode:

| Date (UTC) | Session | Build | Outcome | Trigger | Carry |
|---|---|---|---|---|---|
| 2026-08-28 | s2 | 2.1.248 | ok | swap | kept |
| 2026-09-10 | s5 | 2.1.267 | ok | auto-rescue | copy |
| 2026-09-14 | s4 | 2.1.270 | journal-missing | auto-rescue | kept |
| 2026-09-16 | s1 | 2.1.273 | journal-missing | auto-rescue | kept |
| 2026-09-17 | s5 | 2.1.275 | journal-missing ×2 | auto-rescue | kept |
| 2026-09-20 | s5 | 2.1.278 | journal-missing | auto-rescue | kept |
| 2026-09-22 | s8 | 2.1.280 | ok | auto-rescue | copy |
| 2026-09-23 | s9 | 2.1.280 | ok ×2 | auto-rescue | copy |
| 2026-09-24 | s5 | 2.1.281 | journal-missing | auto-rescue | kept |
| 2026-09-24 | s10 | 2.1.281 | ok | auto-rescue | copy |
| 2026-09-28 | s11 | 2.1.283 | ok | auto-rescue | copy |
| 2026-09-28 | s7 | 2.1.283 | ok ×2 | auto-rescue | copy |
| 2026-10-01 | s4 | 2.1.286 | ok, then journal-missing | auto-rescue | copy, then kept |
| 2026-10-01 | s12 | 2.1.286 | ok | auto-rescue | copy |
| 2026-10-05 | s4 | 2.1.289 | ok ×2 | auto-home | merged |
| 2026-10-06 | s12 | 2.1.291 | ok | auto-rescue | copy |
| 2026-10-06 | s14 | 2.1.292 | ok | auto-rescue | merged |
| 2026-10-09 | s7 | 2.1.294 | ok | auto-home | merged |
| 2026-10-11 | s5 | 2.1.296 | script-path ×2 | auto-rescue | merged |
| 2026-10-12 | s17 | 2.1.296 | script-path ×2 | auto-home | link |
| 2026-10-13 | s5 | 2.1.294, 2.1.296 | no-result, then ok | auto-rescue | link |
| 2026-10-15 | s12 | 2.1.300 | ok | auto-rescue | link |
| 2026-10-19 | s17 | 2.1.303 | script-path | swap | merged |
| 2026-10-20 | s4 | 2.1.304 | ok | auto-rescue | merged |
| 2026-10-21 | s12 | 2.1.305 | ok | auto-rescue | merged |
| 2026-10-22 | s8 | 2.1.308 | script-path | auto-rescue | link |
| 2026-10-23 | s22 | 2.1.309 | script-path | auto-rescue | link |
| 2026-10-24 | s4 | 2.1.304 | script-path ×2 | swap | merged |
| 2026-10-25 | s19 | 2.1.310 | script-path | auto-rescue | link |
| 2026-10-26 | s10 | 2.1.310 | script-path ×2 | auto-rescue | merged |
| 2026-10-26 | s9 | 2.1.304 | script-path ×2 | swap | link |
| 2026-10-27 | s8 | 2.1.310 | script-path | auto-rescue | link |
| 2026-10-29 | s4 | 2.1.312 | script-path ×2 | swap | merged |
| 2026-10-31 | s32 | 2.1.316 | script-path | auto-rescue | merged |

*Table 3. The old root's returned script path, passed after a swap.*

Neither the trigger nor the carry mode separates the accepted from the refused. Accepted calls ran under `copy`,
`merged` and `link`, and refused ones under `merged` and `link`. The build does not either: 2.1.296 refused on
2026-10-11 and 10-12 and accepted on 10-13, and 2.1.304 accepted on 10-20 and refused on 10-24 and 10-26. What the
history shows is a date. Before 2026-10-11, no call still on disk got this refusal; since 2026-10-22, every call has.
Wave 1's five September refusals are gone, so this does not show that none happened earlier. Why the calls changed is
not something the transcripts can show; Task 3 measures it on today's builds.

**The carry's copy under the current root, never returned by the tool.** Each of these passed the current root's copy
of a script whose old-root path the same session had been returned before the swap:

| Date (UTC) | Session | Build | Outcome |
|---|---|---|---|
| 2026-09-24 | s5 | 2.1.281 | ok |
| 2026-10-01 | s4 | 2.1.286 | ok |
| 2026-10-15 | s12 | 2.1.300 | ok |
| 2026-10-22 | s8 | 2.1.308 | script-path ×2 |
| 2026-10-25 | s7 | 2.1.309 | script-path ×2 |

*Table 4. Row R1's history.*

**The whole script inline.** Five calls after a swap passed `script` with `resumeFromRunId` and no `scriptPath`. All
five were accepted, and each came 13 to 35 seconds after a `script-path` refusal for the same run:
- 2026-10-19, s17, 2.1.303;
- 2026-10-22, s8, 2.1.308;
- 2026-10-23, s22, 2.1.309;
- 2026-10-25, s7, 2.1.309;
- 2026-10-26, s9, 2.1.304.

The refusal text itself points there: `Pass the whole script inline through Workflow's script input instead`.

**Working-directory and other readable copies.** The 9 `cwd` calls, all accepted, passed a path the tool had returned
in that same process, so none of them tests row R3. No call with a `cwd` path was refused. Three `/tmp` copies that
no `Workflow` result had returned were accepted after a swap: 2026-10-12 (2.1.296) and 2026-10-24 (2.1.304, ×2).

### 1.3 Two calls, quoted whole (redacted)

Both are an accepted root path after a swap, which the plan's rule predicts refused.

On 2026-10-21, s12 on build 2.1.305 had been returned a script path under its old root. An `auto-rescue` swap with a
`merged` carry followed, and 546 s later it passed:

```
{"scriptPath": "<root-a>/projects/<pdir>/<uuid>/workflows/scripts/<name>.js", "resumeFromRunId": "<run-id>", "args": {…}}
```

The result:

```
Workflow launched in background. Task ID: <task-id>
Summary: <the script's summary>
Transcript dir: <root-b>/projects/<pdir>/<uuid>/subagents/workflows/<run-id>
Script file: <root-a>/projects/<pdir>/<uuid>/workflows/scripts/<name>.js
…
Run ID: <run-id>
```

On 2026-10-20, s4 on build 2.1.304 passed the same shape 416 s after an `auto-rescue` swap with a `merged` carry, with
the same result shape. The Script file line names the old root, and the Transcript dir the current one.

For contrast, on 2026-10-22 one session (s8, build 2.1.308), 64 s after an `auto-rescue` swap with a `link` carry,
made four calls in 37 seconds:
- a `/tmp` path returned before the swap: accepted;
- the old root's returned path: refused;
- the current root's copy of that path, twice: refused both times;
- the whole script inline: accepted.

The refusal read:

```
<tool_use_error>scriptPath must be a script path this tool returned, or a file you can already read (the working directory or a directory you have added): <root-a>/projects/<pdir>/<uuid>/workflows/scripts/<name>.js
A session that cannot call Read cannot load any scriptPath. Pass the whole script inline through Workflow's `script` input instead.</tool_use_error>
```

### 1.4 Step 7: doctor's `oom-policy` line

`ccrc doctor` (no `--fix`) on 2026-11-08:

```
PASS oom-policy: both OOMPolicy=continue drop-ins are in place and ccrc-tmux-server.scope and tmux-spawn-<uuid>.scope read continue
```

The line matches the plan's expectation, so step 7 is closed (D-8103). Doctor exited 1 overall because of other
checks, which this wave does not read.

### 1.5 What the history leaves for Task 3

| Row | The plan's expectation | What history says | Still open |
|---|---|---|---|
| R2: the old root's returned path | refused | refused 13 of 13 since 2026-10-22; mostly accepted before | whether today's build refuses it, for a run interrupted by a `--interrupt` swap |
| R1: the current root's copy | unknown; predicted refused | refused 4 of 4 since 2026-10-22; 3 accepted before | the same |
| R3: a copy in `<cwd>` | accepted | untested: no unreturned `cwd` copy on disk; unreturned `/tmp` copies accepted 3 of 3 | all of it |
| R4: the old path after `/add-dir` | accepted | untested | all of it |

*Table 5. Task 3's rows against the history.*

Task 3 runs R1 to R3 as planned. The history adds one more call shape stage 3 could use: the whole script inline with
`resumeFromRunId`. It was accepted 5 of 5 after a swap, but no journal was read for any of them, so whether those
runs completed is unmeasured. It is reported to the coordinator, not added to the matrix here.

## 2. Task 3: step 5 live, the resume matrix after an ordinary swap

### 2.1 The setup as run, and what differs from the plan

The operator lent one existing account, which was real but idle, instead of two blank scratch accounts (items 95 and 112).
`scratch-a` is that account, alone in `pool-s`. There is no `scratch-b`. The subject was swapped onto one real lane,
`lane-r`, and will be swapped back before Task 4. The coordinator names these departures and numbers them at
acceptance:
- `lent-account-is-real-not-scratch`, `loan-pool-of-one`, `untagged-account-tagged-for-the-loan`;
- `task-3-reads-under-a-real-lane-root`, `swap-back-before-task-4`, `lent-lane-homed-rows`;
- `lent-account-stays-home-able`: `scratch-a` stayed home-able, so a real session homed on it ran there too, as
  recorded below;
- `inline-script-row`: row R5, added after Task 1 (section 1.5);
- `subject-needs-operator-opt-in-for-workflow`: below.

**Expectations before the run, from history (section 1).** Rows R1 and R2 were expected refused, because every such
call since 2026-10-22 had been refused (4 of 4 and 13 of 13). That expectation came from the history, not from this
run.

**Preconditions, measured 2026-11-10 19:48:59Z (Task 2).**
- The subject was on `scratch-a` in `project-s`, and the conductor was on neither lane.
- `project-s` reads `pool-s`. The pool epoch (25) tags `scratch-a` alone with `pool-s` and every other account with
  another pool, so none is untagged, and its lease was current.
- `ccd caps` lists `swap-busy-v1`.
- Builds on disk (`version_to`): `scratch-a` 2.1.322, `lane-r` 2.1.314.
- Of the markers, only `mail-gate-busy-shadow` and `stall-watch-live` exist.
- The subject's one-minute wait is `timeout 55 tail -f /dev/null`. The Bash tool accepted it in the foreground
  (55.0 s, exit 124).

**The opt-in hold.** At 19:52:44Z the subject declined to launch the workflows on mail alone. Its harness calls
`Workflow` only when the operator opts into multi-agent orchestration in their own words, in its own session. The
operator typed a go-ahead into the subject's pane at 22:44:38Z, 2 h 52 min later (item 143). This is part of what a
resume-after-swap test costs on this harness. The go-ahead covered Task 3 step 1's work. Just before it, the
subject's pane was revived at 22:44:32Z (its SessionStart hook fired again, with the same uuid and the same root, and
no resume prompt). That was a restart before Task 3 began, not a confound.

**Builds actually run**, read from the `version` field of the subject's transcript:
- 2.1.319 until 19:52Z, although `claude --version` printed 2.1.322, the build on disk;
- 2.1.322 from the revive until the swap;
- 2.1.314 on `lane-r` from 22:46:31Z.

All four matrix calls ran on 2.1.314.

### 2.2 Step 1 and the swap

At 22:45:04 to 22:45:12Z the subject launched four identical background workflows from one inline script. Each had
two agents, both on haiku at low effort: `quick`, which returns `QUICK-DONE`, and `slow`, which makes the one-minute
wait twenty times and returns `SLOW-DONE`. Each result returned a script file under `<root-a>`. Run 3's script was
copied to `<cwd>/spike-wf-copy.js`, byte-identical to the saved text. The subject also started a background
`watcher.log` shell, a Monitor on it and one background agent. At 22:45:25Z every journal read
`launched, started quick, started slow, result quick`.

**Placement before the swap** (`ccd ls`, 22:46:17Z): the subject was on `scratch-a`, and one real session homed on
`scratch-a` was also running there (`lent-account-stays-home-able`). `lane-r` held two stopped rows. The pools were
unchanged.

**The swap.** `ccd swap --interrupt --cross-pool <subject> <lane-r>` ran from 22:46:23.0Z to 22:46:24.3Z and exited 0,
printing `swapped <subject>: scratch-a -> lane-r`. The subject's `swap.log` lines:
- `ended <subject>: swap-manual`;
- `carry <uuid>: 1 match(es), 1 copy/copies, 1 destination(s)`;
- `sidecar <uuid> -> <root-b>/projects/<pdir>/<uuid> (link: via-mount)`;
- `cross-pool <subject>: scratch-a -> lane-r [project=project-s pool=pool-s target-pool=<another pool>]`;
- `swap <subject>: scratch-a -> lane-r (uuid <uuid>)`.

**What the carry placed.** Under `<root-b>`, each run's script file and `journal.jsonl` is a hard link of the file
under `<root-a>`: the same inode, with 2 links. So the R1 path and the R2 path name one file. The transcript itself
is a separate copy, which grew under `<root-b>` from then on.

**`lane-r`'s limits.** The limits file was last written on 2026-10-31. Its weekly 100% was from before a reset that
had passed, so it was stale. Its first fresh reading, at 23:02:49Z, was weekly 0% with no five-hour figure, so the
subject stayed there.

### 2.3 What the swap ended, and what woke the subject

- The subject's last turn had ended at 22:46:18Z. It was idle when stopped, so ccd sent no resume prompt: that
  prompt is for a session stopped mid-turn.
- `watcher.log`'s last tick is 22:46:17Z.
- The new process (22:46:31Z) received seven task notifications, one per background task: the agent, two shells and
  four workflows. Each said `didn't finish before the previous session ended`, with status `stopped`. Each
  workflow's note read: `To pick up where it left off, relaunch with Workflow({scriptPath, resumeFromRunId}) using the
  run id from the summary — completed agent() calls return cached.`
- **No model turn followed the notifications.** The subject next took a turn at 23:02:01Z, woken by the stall
  watch's mail of 23:01:58Z (`orphaned: 7 background task(s) (shell, subagent, workflow) did not survive the
  2026-11-10T22:46Z restart`), 15.5 minutes after the restart. The subject reported that mail and did not act on it.
- The subject made no `Workflow` call before the matrix mail, so there is no confound.

### 2.4 The matrix

Each row resumed its own run, one call at a time, after the swap:

| Row | Run | `scriptPath` passed | Result (build 2.1.314) |
|---|---|---|---|
| R2 | 1 | the path the tool returned before the swap, under `<root-a>` | **refused**, 23:04:39Z |
| R1 | 2 | the same relative path under `<root-b>` (the carry's hard link of the same file) | **refused**, 23:04:51Z |
| R3 | 3 | `<cwd>/spike-wf-copy.js` | **accepted**, 23:05:01Z |
| R4 | 1 | — | **not run**: the operator declined to type `/add-dir` (item 95) |
| R5 | 4 | none: the same script text passed inline as `script`, with `resumeFromRunId` | **accepted**, 23:05:18Z |

*Table 6. The resume matrix after one `--interrupt` swap.*

R2's and R1's refusals were the same text, differing only in the path:

```
<tool_use_error>scriptPath must be a script path this tool returned, or a file you can already read (the working directory or a directory you have added): <root-a>/projects/<pdir>/<uuid>/workflows/scripts/spike-quick-slow-<run-id>.js
A session that cannot call Read cannot load any scriptPath. Pass the whole script inline through Workflow's `script` input instead.</tool_use_error>
```

R3's result:

```
Workflow launched in background. Task ID: <task-id>
Summary: spike: one quick agent and one slow agent
Transcript dir: <root-b>/projects/<pdir>/<uuid>/subagents/workflows/<run-id>
Script file: <cwd>/spike-wf-copy.js
…
Run ID: <run-id>
```

R5's result had the same shape, except that the tool wrote the script file under `<root-b>`: `Script file:
<root-b>/projects/<pdir>/<uuid>/workflows/scripts/spike-quick-slow-<run-id>.js`. That file is still the carry's hard
link, so the write changed the inode both roots name.

### 2.5 The journals of the accepted rows

Both accepted runs resumed in the same `journal.jsonl`, the carry's hard link. Each resume appended
`started slow` under a new agent id. Neither started `quick` again: its `QUICK-DONE` result came from cache. Then
`slow` ran its twenty waits again from the start and returned `SLOW-DONE`:

| Row | Journal after the resume | Final |
|---|---|---|
| R3 | `started slow` (new agent), `result slow SLOW-DONE` | completed, `{"quick":"QUICK-DONE","slow":"SLOW-DONE"}` (2 of 2 agents, 21 tool uses, 1,122 s) |
| R5 | `started slow` (new agent), `result slow SLOW-DONE` | completed, `{"quick":"QUICK-DONE","slow":"SLOW-DONE"}` (2 of 2 agents, 21 tool uses, 1,121 s) |

*Table 7. What the accepted resumes did.*

So both shapes that were accepted resumed the run as the tool promises: completed agents return from cache, and the
interrupted agent runs again from its start, not from where it stood.

## 3. Task 4: step 6, a paused workflow under a blocked parent, not run

**Neither arm ran, by the operator's ruling (item 145, 2026-11-10 23:38Z).** That ruling also ended the loan. Under
the cut list (D-8107):
- the one-account arm (Step 5) is **not run**. It stood in for arm 1, because there is no `scratch-b`;
- arm 2 (both accounts limited) is **unreachable**, because there is one lent account and no second.

**Why, as measured.**
- **The lent plan has no five-hour window.** Before Task 4, `scratch-a`'s limits file (written 23:07:05Z) read:
  weekly 42%, weekly reset 2026-11-16 07:00Z, and no five-hour figure, with no five-hour window since 2026-10-28.
  Since #2473, ccrc has read such a lane as having no five-hour limit. The arm assumed a five-hour limit and
  its reset.
- **A weekly limit cannot show the case.** The parent's first limit would be the weekly one, 58 points away. Claude
  Code declines to pause its workflow agents for a reset that far off, as `too far out to wait for` (spec §1.1, 7
  runs). The 30-minute bound after the reset would have fallen on about 2026-11-16 07:30Z.
- **The behaviour is about to change.** The operator's session-host ruling Q4 (research doc #2526, its section 6.1)
  turns Claude Code's own auto-continue at the usage limit off in the settings ccd passes to every spawn. That
  change has a deviation number allocated but is not built yet, so a reading made now would describe behaviour that is about to change.
- **The ruling:** item 145.

**Still open.** Spec §5.4 rule 2 and §11 item 3 leave "a longer bound for delegated work in flight" waiting on
step 6. That stays open: nothing here measures what a five-hour pause does to a run under ccd.

## 4. What ran, under the cut list

| Spike step | Ran | Answer |
|---|---|---|
| 5, history (Task 1) | yes | 184 calls on disk; an old-root or carry-copy path after a swap accepted until 2026-10-21, refused 17 of 17 since 2026-10-22 |
| 5, live (Task 3) | R1, R2, R3, R5 yes; R4 no | on 2.1.314 after one `--interrupt` swap: both root paths refused; the working-directory copy and the inline script accepted and completed |
| 6, one-account arm (Task 4) | no | the lent plan has no five-hour window; item 145 |
| 6, arm 2 | no | unreachable with one lent account |
| 7 (Task 1) | yes, read only | doctor's `oom-policy` PASS (D-8103) |

*Table 8. The spike's steps.*

**Also measured on the way:** what woke the subject after the swap. ccd sent no redrive, because the subject was idle
when stopped. The new process received seven stopped-task notifications and took no turn on them. The stall watch's
orphaned-task mail woke it at 23:01:58Z, 15.5 minutes after the restart at 22:46:31Z. This note records the
measurement only; any remedy is the coordinator's to rule.

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
  (2026-10-19 to 10-26). Each one came within a minute after a `script-path` refusal of the same run. This is not one
  of the plan's matrix rows.
- **History does not test row R3.** No call passed a working-directory copy that the tool had not returned in the same
  process. Copies under `/tmp` that were never returned were accepted after a swap, 3 of 3.
- **Step 7 is closed:** doctor's `oom-policy` line reads PASS (D-8103).

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

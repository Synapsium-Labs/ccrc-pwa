# Session continuity, wave 5 — the reduced stage 2 spike: the resume call after a swap, and a paused workflow under a blocked parent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. This wave measures; it changes no code.

> **Execution status:** Drafted 2026-11-07 from the operator's rulings of that day (items 59 and 75; programme ledger, Decisions, 2026-11-07 14:40 and 22:40) at base `ebd95592b`, then revised after a review by three Opus lenses with Sonnet refuters. It waits for the operator's approval, and its live tasks wait for the operator's setup item. It is dispatched as one worker run (run 730) once it lands.

**Goal:** Measure, on a lent scratch account, the two facts that stage 3's design rests on now that ccd's own record (the manifest) is its primary way of keeping delegated work across a restart:
- **Step 5.** After an ordinary ccd swap, which `Workflow({scriptPath, resumeFromRunId})` call resumes an interrupted run: the old root's script path, the current root's copy, a copy in the working directory, the old path after `/add-dir`, or none.
- **Step 6.** Whether a two-agent workflow paused on a five-hour limit survives its parent hitting the limit, what follows (Claude Code's own re-run, ccd's rescue swap, or ccd's wait), and a resume by run id afterwards.

**Why:** The spec's spike (§5.2) was to choose between Claude Code's native exit handoff and ccd's manifest. The operator chose the manifest on the evidence (item 75; spec §11 item 8; D-8102). What stage 3 still cannot be designed without is whether its literal redrive call works after a swap, and what a five-hour pause does to a run under ccd. Stage 3's prompt types `Workflow({scriptPath: "<current-root path>", resumeFromRunId: "<id>"})` (§5.3, Delivery); if that call is refused after a swap, the manifest's items are useless as written. And §11 item 3 leaves "a longer bound for delegated work" waiting on step 6.

**Architecture:** Two sessions and one operator:
- **The conductor** is this run's worker, on a real account. It reads, mails and swaps, and writes the results.
- **The subject** is a plain session on scratch account `scratch-a`, in scratch project `project-s`, created by the operator. It does the delegated work and makes the resume calls, each on the conductor's mail.
- **The operator** sets up the accounts, the pools, the subject and the consent (the setup item, below), and ends the loan.

Task 1 needs no account. Tasks 2 to 4 need the setup. Task 5 writes it up.

**Tech Stack:** The installed `deploy/measure-continuity.py`'s functions, imported read-only under `python3 -I`; `ccrc-api`; `ccd swap --interrupt` (the argv the console's swap builds, `server/src/ccdargv.ts#swapInterrupt`); read-only `ccd ls`, `git`, `grep` and `jq`. No code changes, so no test suite runs.

**Spec:** `docs/superpowers/specs/2026-09-23-session-continuity-design.md`: §5.2 (amended in rev 11 on this plan's PR), §5.3 (Delivery; Deferred, not relaunched into the wall), §5.4 rule 2 (the near-reset and no-room waits) and rule 3 (the chain wait), and §11 items 3, 6, 7 and 8.

**Other sources:**
- the ledger, `docs/superpowers/programs/session-continuity.md`: Decisions 2026-10-20 08:50, 2026-11-07 14:40 and 2026-11-07 22:40;
- wave 1's plan, `docs/superpowers/plans/2026-09-24-session-continuity-wave1-carry-merge.md`, which counted the five `script-path` refusals;
- the working-state spec, `docs/superpowers/specs/2026-10-16-working-state-and-interruptions-design.md` §5.10 and §6.3, which took over step 7 (D-5241).

## What is already known, and what this wave measures

| Spike step (§5.2 as first written) | Today | This wave |
|---|---|---|
| 1. Launch under the bg kind with a job dir | Cannot run on the fleet: no ccd door sets spawn env (`ccd/ccd#_resume_env`, `ccd/ccd#_spawn_start`). A pane recorded as kind `bg` is predicted, from the code and not observed, to trip `ccd/ccd#_ci_chain_end`'s holder scan, so `cmd_swap` would refuse its own swap (D-4944, which `--force` does not override) | not run; decided (D-8102) |
| 2. Graceful stop and its bounded wait | No ccd stop sends `SIGTERM` (`ccd/ccd#cmd_swap`: unit stop, `tmux kill-session`, `sleep 1`); a session may not signal a pane | not run; the bound is left to wave 6 (D-8104) |
| 3. The adopt record across a swap | The carry never copies `<config>/jobs/`, and Claude Code's job-dir guard is per config root: cross-root adoption is predicted to fail (read from the code and the binary, not observed) | not run; decided (D-8102) |
| 4. A second restart authority | Claude Code's daemon hosts forks on the fleet; whether it revives anything is unmeasured | not run; decided (D-8102) |
| 5. Resume by run id after a swap | Five `script-path` refusals in wave 1's count, unexplained. Claude Code 2.1.319's refusal reads `scriptPath must be a script path this tool returned, or a file you can already read (the working directory or a directory you have added)`. By that rule both root paths are predicted refused after a swap, and a working-directory copy accepted | Task 1 reads the history; Task 3 measures the matrix live (D-8105, D-8106) |
| 6. A paused workflow under a blocked parent | Never seen on the fleet (spec §1.1: 0 of 18). The stage-4 waits it would meet have shipped (wave 2) | Task 4, by a cut list (D-8107) |
| 7. `OOMPolicy=continue` on a pane scope | Shipped by the working-state programme as two prefix drop-ins (D-5241), read by `ccd/ccrc-doctor-checks#_check_oom-policy` | Task 1 reads doctor's line; closed with this programme's agreement (D-8103) |

## The operator's setup (raised as its own item; none of it is a session's)

Each line is the operator's act from the console, before Task 2. No line needs anything done by hand to tmux, a `claude-session@` unit or a process.
1. **Accounts.** Roster and sign in two scratch accounts, `scratch-a` and `scratch-b`, carrying no real work, in one pool, `pool-s`. With one account only: Task 4 runs its one-account arm, and Task 3's live rows run only if the operator names one real lane and consents to `--cross-pool` swaps of the subject onto it and back (it carries the subject for about an hour); otherwise step 5 is measured from history alone.
2. **Keep the subject on the scratch accounts.** An untagged account serves a tagged project (`ccd/ccd#_pool_ok`), so tagging `project-s` alone does not stop a rescue from moving the subject onto a real account. To keep it on, every other rostered account carries a pool tag other than `pool-s`. Otherwise arm 1 still measures, spending a little of whichever real account the rescue picks, and arm 2's and the one-account arm's no-room waits cannot happen while a real account has room.
3. **Keep real sessions off the scratch accounts.** Tagging only tightens, so an untagged project's rescue can land on a tagged account. The options are to accept it (the conductor records any such landing), to roster the scratch lanes non-home-able (still a last-resort overflow), or to tag the real projects.
4. **The scratch project.** An empty project, `project-s`, tagged `pool-s`.
5. **The subject.** Create the session on `scratch-a` in `project-s` (`POST /api/sessions`, or the console), with workflows enabled on its route.
6. **Consent to swap.** The conductor may run `ccd swap --interrupt <subject> <lane>` for the subject only (it will be busy with its own workflows), between `scratch-a` and `scratch-b`, and onto the real lane named under line 1 and back if there is one, for the length of the loan. This is the same act as the console's "swap anyway".
7. **`/add-dir`, optional.** Whether the operator will type `/add-dir <directory>` into the subject's pane once, when the conductor mails the directory (Task 3, row R4).
8. **The loan.** It spans at least one five-hour reset of each scratch account: Task 4's first arm needs one, and its second arm a second.
9. **The names.** The real account and lane names reach the conductor only in the item's answer, never in the repository.

## Global Constraints

- **Nothing changes but the results.** This wave commits only its results note and the spec's as-measured lines. No `ccd`, server, hook or skill change.
- **The conductor's acts are three:** mail to the subject (`ccrc-api mail send`, kind `status`); `ccd swap --interrupt <subject> <lane>`, for the subject only, under the operator's consent (setup line 6); and reads. It runs no other `ccd` verb that changes state, never creates or archives a session, never touches an account, a pool, tmux, a unit or a process, never reads a credential file or `/proc/<pid>/environ`, and never types into the subject's pane (D-8108).
- **Reads are named paths only.** Under a scratch account's config root, read only `projects/<project-s dir>/` (the subject's transcript and its workflow run directories, scripts and `journal.jsonl` included), `ls` of `jobs/` and `sessions/`, and `.last-update-result.json`'s `version_to`. From the registry, read only: `swap.log` lines naming the subject's id; the subject's `.rescuewait`; the `pools/project-s` and `pool-epoch` files; whether the `stall-watch-*` and `mail-gate-*` markers exist (`ls`, never their contents); and `ccd ls` and `ccd caps`. Never print a whole file of another account's root.
- **Mail reaches the subject only when it is idle.** A subject busy with its own workflows receives nothing (`server/src/turnidle.ts#mailTurnIdle`). So every instruction that must hold through busy time or a restart is given before it starts, and the subject mails the conductor whenever it reaches a point where it waits.
- **The subject is driven by mail alone.** Each instruction mail says what to run, what to record in `<cwd>/spike-notes.md`, and what to mail back. The subject replies with `status` mail quoting each tool result verbatim, with paths shortened to `<root-a>`, `<root-b>` and `<cwd>`. Any other mail it receives (a stall-watch notice, for example) it reports to the conductor and does not act on, and the conductor records it as a wake source.
- **A refusal is a stop.** A swap that refuses, or exits nonzero, is reported to the coordinator, never retried with other flags.
- **The loan is the operator's.** When the coordinator mails that the loan ends, the conductor stops wherever it is, records what ran under the cut list (D-8107), and goes to Task 5.
- **Record each build.** `claude --version` for every lane the subject runs on, read as the lane's `.last-update-result.json` `version_to` and in the subject's own transcript. The fleet runs several builds (2.1.311 to 2.1.319 on 2026-11-07).
- **Public repository** (D-8109). The results note and every excerpt use `scratch-a`, `scratch-b`, `real-a`, `pool-s`, `project-s`, `<root-a>`, `<root-b>`, `<cwd>`, `<run-id>`, `<agent-id>`, and `s1`, `s2`, … for sessions in history. No account, lane, host or person's name, no absolute home path, no real project name. Run the private-name scan on every changed file before each commit.
- **Deviation numbers are issued, never chosen.** This plan defines D-8102 to D-8109, issued 2026-11-07. A departure found during execution is named by slug in the wave-done, and the coordinator numbers it.
- **Commits** go on the workspace's own branch. Never update-branch, rebase or force-push.

## Review Focus

1. **The subject stays where it was put.** The likeliest way to spoil the measurement is a placement nobody chose: a rescue of the subject onto a real account, or a real session's rescue onto a scratch account. Before every live step the conductor reads `ccd ls` and records every session on a scratch lane. After any restart, the subject waits for the conductor's go, and the conductor reads its placement first.
2. **A resume that is accepted is not a run that completes.** Task 3 records, for each call, the tool result and then that run's `journal.jsonl`: which agent returned from cache, which ran again, and whether the run finished.
3. **Which path was actually passed, and to which run.** Each row resumes its own interrupted run, quotes the exact `scriptPath` it passed, and classifies it as under `<root-a>`, under `<root-b>`, under `<cwd>` or elsewhere. A hypothesis read from strings is not evidence.
4. **Where a wait came from, and what ended it.** A pause can be Claude Code's own (its agents' `usage limit; resets …` pause, which re-runs them after the reset), or ccd's (`.rescuewait`, the no-room wait). A wake can be Claude Code's armed auto-continue (`ccd/ccd#_pane_auto_continue_armed`), ccd pressing Enter for a stale one (`ccd/ccd#_auto_stale_check`), a rescue swap and its redrive, a task notification, or a stall-watch mail. Task 4 records each with its source and its time.
5. **A stall per §11 item 6.** With one account, or both limited and no real account to rescue to, the subject may idle past its reset with nothing to resume it. Task 4 bounds that wait and records what did or did not fire, rather than nudging the subject.

---

### Task 1: The read-only pass (no account needed)

**Files:**
- Create: `docs/superpowers/plans/2026-11-07-session-continuity-wave5-spike-results.md`

- [ ] **Step 1: Walk every resume call on disk.** On the fleet box, read-only, write a scratch walker (outside the repository) that imports the installed instrument's own functions under `python3 -I`, including its post-swap outcome classifier, and walks every transcript on disk with no time window. For each `Workflow` call carrying `resumeFromRunId`, ok or refused, print:
  - its time and a stand-in for its session (`s1`, `s2`, …);
  - its outcome class (`ok`, `journal-missing`, `script-path`, `other-error`, `no-result`);
  - the `scriptPath` passed, as its class only: under the session's config root at that time, under another account's config root, under its working directory, or elsewhere;
  - whether an earlier tool result in the same Claude Code process returned that path;
  - the last restart before the call and its kind, read from the transcript's resume-prompt rows and from `swap.log` (reduced to its verb, mode and time);
  - for a refusal, the result text with the path replaced by its class.
- [ ] **Step 2: Count what the history settles.** Wave 1 counted five `script-path` refusals between 2026-09-08 and 09-23; those transcripts may be past Claude Code's retention, so say how many are gone and count what is on disk. Report, by path class and by whether a swap preceded the call: accepted calls and refused calls. An accepted call with a root path after a swap, or a refused call with a working-directory path, is quoted whole (redacted): either one changes what Task 3 expects.
- [ ] **Step 3: Close step 7.** Run `ccrc doctor` (never `--fix`) and copy its `oom-policy` line. Expected: PASS, with both drop-ins on disk and `OOMPolicy=continue` read from the tmux server's scope and one pane scope. A line that is not PASS is reported to the coordinator as it is.
- [ ] **Step 4: Write the note's first section.** In the results note: the counts, a redacted table of the refused calls, the doctor line, and what the history leaves for Task 3. Task 3 runs R1 to R3 whatever the history says: it is the only measurement of a resume after a swap on today's builds.
- [ ] **Step 5: Commit.**

```bash
git add docs/superpowers/plans/2026-11-07-session-continuity-wave5-spike-results.md
git commit -m "docs(continuity): wave 5 Task 1, the historical resume calls and the oom-policy line"
```

### Task 2: Preconditions, measured before the loan is spent

- [ ] **Step 1: Read the setup item's answer** from the coordinator's mail: the lane names, the pool, the subject's id, the containment choices, the swap consent, whether `/add-dir` is offered, and any real lane named for one-account use. Keep the names out of every committed file.
- [ ] **Step 2: Measure.** Read-only:
  - `ccd ls` shows the subject on `scratch-a` in `project-s`, and the conductor's own row on neither scratch lane;
  - `pools/project-s` reads `pool-s`, and `pool-epoch` tags `scratch-a` and `scratch-b` with `pool-s`; record every other rostered account's resolved pool, and whether any is untagged (setup line 2);
  - `ccd caps` advertises `swap-busy-v1`, without which `--interrupt` is not understood;
  - each scratch lane's `version_to`;
  - which of the `stall-watch-*` and `mail-gate-*` markers exist.

  Expected: the subject's placement, the scratch tags and the capability hold. Any that does not is a stop, reported to the coordinator. An untagged real account is recorded, and Task 4's arm 2 and the one-account arm are marked unreachable unless the operator changes it.
- [ ] **Step 3: Introduce the conductor.** Mail the subject, while it is idle: who the conductor is; that the conductor's mail is the spike's instructions; that it records everything in `<cwd>/spike-notes.md`; that it replies by `status` mail to the conductor's id with `~/.local/bin/ccrc-api mail send`, quoting each tool result verbatim; and the standing rule for every restart: **make no `Workflow` call and launch nothing; mail the conductor what the resume prompt said, the time and the account you are on, then wait for its mail**. Ask it to reply with `claude --version`, its working directory, and the result of one Bash call that waits about 55 seconds without the `sleep` command (the Bash tool refuses a foreground `sleep`; `timeout 55 tail -f /dev/null` is one form). Expected: a reply at its next idle, with the wait accepted. If no wait form is accepted, use real cheap work of known length instead, and say which in the results.

### Task 3: Step 5 live — the resume matrix after an ordinary swap

- [ ] **Step 1: The subject starts its work.** Mail the subject to:
  - launch three workflows in the background, each from an inline script (not a file it wrote), each with two agents: `quick`, which returns a fixed string at once, and `slow`, which makes the accepted one-minute wait twenty times and then returns a fixed string;
  - note for each run its id, the `scriptPath` the tool returned (expected under `<root-a>`), and its run directory;
  - copy run 3's script to `<cwd>/spike-wf-copy.js`;
  - start a background Bash watcher (`while sleep 30; do date -u >> <cwd>/watcher.log; done`, run in the background), a Monitor on `watcher.log`, and one background Agent that makes the same one-minute wait;
  - reply once every `quick` has returned and every `slow` is running, by each run's `journal.jsonl`.
- [ ] **Step 2: Swap mid-run.** Once the reply shows all three `slow` agents running, run `ccd swap --interrupt <subject> <scratch-b lane>`. Record its exit and output, the `swap.log` lines for the subject (the carry's mode line included), and the times. Expected: exit 0. Anything else is a stop.
- [ ] **Step 3: What the swap ended, and what the subject did first.** When the subject mails from `scratch-b`, read: the gap in `watcher.log`; the transcript's last rows before the swap and first rows after; whether each run's script file and `journal.jsonl` exist under `<root-b>` (the carry's copy) as well as under `<root-a>`. Any `Workflow` call the subject made before the matrix mail is recorded as a confound.
- [ ] **Step 4: The matrix.** Mail the subject to make these calls one at a time, in this order, and to reply after each with the call's input and its result verbatim. Each row resumes its own run:

| Row | Run | `scriptPath` passed | Expected (the strings' rule; Task 1 may revise it) |
|---|---|---|---|
| R2 | 1 | the path the tool returned before the swap, under `<root-a>` | refused `scriptPath must be a script path …` |
| R1 | 2 | the same relative path under `<root-b>`, the carry's copy | unknown; the rule predicts refused (not returned by this process, not under the working directory) |
| R3 | 3 | `<cwd>/spike-wf-copy.js` | accepted |
| R4 | 1 | the `<root-a>` path again, after the operator types `/add-dir` for the directory that holds that script | accepted; or not run if not offered, or if R2 was accepted |

  For R4, mail the coordinator the directory as `<root-a>/…/<the script's directory>` with the real path in the mail body only, for the operator to type; then wait for the coordinator's mail that it is done.
- [ ] **Step 5: Read each outcome.** For each accepted call, read that run's `journal.jsonl`: which agent returned from cache, which ran again, and the final state. Expected for an accepted row: `quick` cached, `slow` re-run and finished.
- [ ] **Step 6: Write the note's step 5 section** (redacted): the matrix with each row's verbatim result, the journal reading, what the swap ended, any confound, and the build. Commit.

```bash
git add docs/superpowers/plans/2026-11-07-session-continuity-wave5-spike-results.md
git commit -m "docs(continuity): wave 5 Task 3, the resume matrix after a swap"
```

### Task 4: Step 6 live — a paused workflow under a blocked parent

The subject starts on the scratch lane it is on after Task 3, called `X` here, and the other is `Y`.

- [ ] **Step 1: The burn.** Read `ccd ls` first. Then mail the subject, while it is idle, to:
  - launch a two-agent workflow from an inline script, both agents long-lived and cheap: the accepted one-minute wait, up to 480 times; note the run id and the returned `scriptPath`, and copy the script to `<cwd>/spike-burn-copy.js`;
  - then, in its own turns, read a generated text file of about 2 MB in `<cwd>` page by page, again and again, so that the parent alone spends the account's window;
  - the moment a workflow agent reports a usage limit (`usage limit; resets …`), mail the conductor that text and the time before going on;
  - after any restart, keep the standing rule from Task 2.
- [ ] **Step 2: The resume rule, for the conductor.** When the subject mails after a restart, read `ccd ls`. On a scratch lane, mail it to resume the burn run by run id with the path class Task 3 found accepted (falling back to the other accepted class on a refusal, quoting both results), to mail the call's input and result and both agents' states from `journal.jsonl`, and then to stop its own reading. On a real account, mail it to stop, and record the arm as run uncontained.
- [ ] **Step 3: Arm 1, the first limit (required).** When the subject reports its agents' pause, mail the coordinator the reset time, also read from `ccd ls`, and end the turn. The subject's mail after the next event wakes the conductor; if none has come 30 minutes after the reset, the coordinator mails the conductor. Then read and record, with times and each one's source:
  - Claude Code's pause of the workflow's agents, and whether the pause declined the reset as `too far out to wait for`;
  - the parent's own limit;
  - what followed: a rescue swap `X` → `Y`, a rescue wait near the reset (`.rescuewait`), a no-room wait, Claude Code's own re-run of the agents after the reset, an auto-continue or ccd's stale press (`swap.log`), or a stall-watch mail;
  - the resume call and its result, under Step 2's rule;
  - `journal.jsonl` afterwards: did the paused agents run again from where the run stood, and did the run finish?
- [ ] **Step 4: Arm 2, both accounts limited (only if the loan spans a second window and Task 2 found no untagged real account).** Repeat Step 1 on `Y`, with `X` still limited. Expected: ccd's no-room wait until one account resets, then a swap or a wake in place. Record the same readings as Step 3. Otherwise record arm 2 as not run, with the reason.
- [ ] **Step 5: The one-account arm (only without `scratch-b`).** The first limit has no target in the pool. Record what happens after the reset, as one of: Claude Code's in-process re-run of the agents, a task notification waking the parent, an auto-continue, ccd's stale press, a rescue to a real account, or nothing. If nothing has resumed the subject 30 minutes after its account's reset, record it as a stall under §11 item 6 and stop. Do not nudge the subject: what is measured is what fires today.
- [ ] **Step 6: Write the note's step 6 section** (redacted): each arm run, its timeline, each wait's and each wake's source, the resume calls and the journal readings, and any arm not run with its reason. Commit.

```bash
git add docs/superpowers/plans/2026-11-07-session-continuity-wave5-spike-results.md
git commit -m "docs(continuity): wave 5 Task 4, a paused workflow under a blocked parent"
```

### Task 5: The spec's as-measured lines, the PR and the wave-done

**Files:**
- Modify: `docs/superpowers/specs/2026-09-23-session-continuity-design.md` (§5.2 only: an "As measured (wave 5, <UTC date of the commit>)" paragraph after the amended decision rule)

- [ ] **Step 1: The as-measured paragraph.** In §5.2, after the decision rule, state in a few lines: which resume calls were accepted after a swap and which were refused, with the refusal's text; what a five-hour pause did to the paused run under each arm that ran; the builds; and the results note's path. It records measurements only. Any change it implies for stage 3's design is the coordinator's, in wave 6's plan.
- [ ] **Step 2: Scan and check.** Run the private-name scan over every changed file. Then run the guards a docs change reaches, each in its own foreground `ccrc test` process from `server/`: `topology-clean`, `dtbd`, `anchors`, `citations`, `docs-parity`, and, after `git fetch origin main`, `deviation-refs`.
- [ ] **Step 3: Commit, check mail, push, and open one PR** to `main` with the results note's and the spec's durable links. Never merge, enqueue, rebase or update-branch it.

```bash
git add docs/superpowers/specs/2026-09-23-session-continuity-design.md docs/superpowers/plans/2026-11-07-session-continuity-wave5-spike-results.md
git commit -m "docs(continuity): wave 5's as-measured lines in spec §5.2"
```

- [ ] **Step 4: The wave-done.** After the PR's fast run on the exact tip has finished, send one wave-done at that tip, with the arms run and not run, each measured answer in one line, and the PR number.

## Deviations found

- **D-8102** — `native-handoff-decided-not-measured` (scope): steps 1 to 4 are not run. Stage 3 is manifest-primary by the operator's ruling (item 75; spec §5.2 and §11 item 8, rev 11). The reasons: cross-root adoption is predicted to fail; Claude Code ends workflows and agents before its handoff, so their recovery is a resume by run id either way; the handoff's gates and carrier changed after the spec (`CLAUDE_DISABLE_ADOPT`, `bgTakeover`, a per-job storage key), across a fleet that runs several builds; and the manifest is written at a supervisor revival anyway, where no graceful exit happens. Making native handoff primary later would be a new operator ruling; the coordinator proposes that it be measured off the fleet first.
- **D-8103** — `step-7-closed-by-d5241` (scope): `OOMPolicy=continue` shipped as two prefix drop-ins in the working-state programme (D-5241), because `set-property` refuses the property. This programme's coordinator agrees to that take-over, which the working-state spec's §6.3 proposed. Task 1 Step 3 reads doctor's `oom-policy` line, which closes the step.
- **D-8104** — `graceful-stop-bound-in-stage-3` (scope): step 2 is not run, so the graceful stop's bounded wait is left to wave 6. The coordinator proposes measuring it there behind a shadow arm before the stop is armed; wave 6's plan settles it.
- **D-8105** — `resume-history-first` (method): Task 1 reads every resume call on disk before the loan, with its outcome, path class and the restart before it.
- **D-8106** — `resume-matrix` (method): step 5 is measured as four rows at one mid-run swap, each resuming its own interrupted run, rather than one call with a current-root path.
- **D-8107** — `step-6-cut-list` (method): arm 1 (the first limit and what follows) is required; arm 2 (both accounts limited) runs only if the loan spans a second window and no untagged real account can take a rescue; without a second account, the one-account arm runs, bounded by §11 item 6.
- **D-8108** — `the-conductor-reads-mails-and-swaps` (safety): the conductor's acts are mail to the subject, `ccd swap --interrupt` of the subject alone under the operator's consent, and named reads. Everything else is the operator's.
- **D-8109** — `redacted-results` (public repository): every committed excerpt uses neutral stand-ins, and the private-name scan gates each commit.

## Where things stand

**Agreed:**
- The operator lends a scratch account and the programme resumes (item 59, 2026-11-07).
- The reduced spike: stage 3 is manifest-primary on the evidence, and the account is spent on steps 5 and 6 (item 75, 2026-11-07). The spec's §5.2 and §11 say so in rev 11, on this plan's PR.
- Step 7 is closed by D-5241 with this programme's agreement (D-8103), once Task 1 reads doctor's line.

**Waiting on you:**
- The plan's approval.
- The setup item: two scratch accounts in one pool, a pool tag on every other account (or accepting that the subject may move onto one), how real sessions are kept off the scratch accounts, the scratch project and session, the swap consent, whether you will type one `/add-dir`, and the loan.

**Later:**
- Wave 6 (stage 3) is planned from this wave's results. The coordinator carries three proposals to it: extend the delegation broker's spool and projection rather than add a second record; pin in tests the resume refusal strings it relies on; and measure the graceful stop's bound behind a shadow arm (ledger, Carried constraints).

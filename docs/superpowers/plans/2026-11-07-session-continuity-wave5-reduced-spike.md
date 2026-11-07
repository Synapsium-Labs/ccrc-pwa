# Session continuity, wave 5 — the reduced stage 2 spike: the resume call after a swap, and a paused workflow under a blocked parent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. This wave measures; it changes no code.

> **Execution status:** Drafted 2026-11-07 from the operator's rulings of that day (items 59 and 75; programme ledger, Decisions, 2026-11-07 14:40 and 22:40) at base `ebd95592b`. It waits for the operator's approval, and the live tasks wait for the operator's setup item. It is dispatched as one worker run (run 730) once it lands.

**Goal:** Measure, on a lent scratch account, the two facts that stage 3's design rests on now that ccd's own record (the manifest) is its primary way of keeping delegated work across a restart:
- **Step 5.** After an ordinary ccd swap, which `Workflow({scriptPath, resumeFromRunId})` call resumes the run: the current root's script path, the old root's, a copy in the working directory, or none.
- **Step 6.** Whether a two-agent workflow paused on a five-hour limit survives its parent hitting the limit, ccd's handling of that limit (a rescue swap, or a wait), and a resume by run id afterwards.

**Why:** The spec's spike (§5.2) was to choose between Claude Code's native exit handoff and ccd's manifest. The operator chose the manifest on the evidence (item 75, spec §11 item 8, D-8102). What stage 3 still cannot be designed without is whether its literal redrive call works after a swap, and what a five-hour pause does to a paused run under ccd. Stage 3's prompt types `Workflow({scriptPath: "<current-root path>", resumeFromRunId: "<id>"})` (§5.3, Delivery); if that call is refused after a swap, the manifest's items are useless. And §11 item 3 leaves "a longer bound for delegated work" waiting on step 6.

**Architecture:** Two sessions and one operator:
- **The conductor** is this run's worker, on a real account. It reads, mails and swaps, and writes the results.
- **The subject** is a plain session on scratch account `scratch-a`, in scratch project `project-s`, created by the operator. It does the delegated work and makes the resume calls, each on the conductor's mail.
- **The operator** sets up the accounts, the pool, the subject and the consent (the setup item, below) and ends the loan.

Task 1 needs no account. Tasks 2 to 4 need the setup. Task 5 writes it up.

**Tech Stack:** The installed `deploy/measure-continuity.py` (read-only, `python3 -I`), `ccrc-api`, `POST /api/sessions/:id/swap`, read-only `git`, `grep` and `jq`. No code changes, so no test suite runs.

**Spec:** `docs/superpowers/specs/2026-09-23-session-continuity-design.md`: §5.2 (amended in rev 11 on this plan's PR), §5.3 (Delivery; Deferred, not relaunched into the wall), §5.4 rules 2 and 3 (the rescue wait and the no-room wait), and §11 items 3, 6, 7 and 8.

**Other sources:**
- the ledger, `docs/superpowers/programs/session-continuity.md`: Decisions 2026-10-20 08:50, 2026-11-07 14:40 and 2026-11-07 22:40, and the Carried constraints for wave 6;
- wave 1's plan, `docs/superpowers/plans/2026-09-24-session-continuity-wave1-carry-merge.md`, which counted the five `script-path` refusals;
- the working-state spec, `docs/superpowers/specs/2026-10-16-working-state-and-interruptions-design.md` §5.10 and §6.3, which took over step 7 (D-5241).

## What is already known, and what this wave measures

| Spike step (§5.2 as first written) | Today | This wave |
|---|---|---|
| 1. Launch under the bg kind with a job dir | Cannot run on the fleet: no ccd door sets spawn env (`ccd/ccd#_resume_env`, `ccd/ccd#_spawn_start`), and a pane recorded as kind `bg` would trip `ccd/ccd#_ci_chain_end`'s holder scan, so `cmd_swap` refuses its own swap (D-4944, which `--force` does not override) | not run; decided (D-8102) |
| 2. Graceful stop and its bounded wait | No ccd stop sends `SIGTERM` (`ccd/ccd#cmd_swap`: unit stop, `tmux kill-session`, `sleep 1`); a session may not signal a pane | not run; the bound is measured in wave 6, behind a shadow arm (D-8104) |
| 3. The adopt record across a swap | The carry never copies `<config>/jobs/`, and Claude Code's job-dir guard is per config root: cross-root adoption is predicted to fail (read from the code and the binary, not observed) | not run; decided (D-8102) |
| 4. A second restart authority | Claude Code's daemon hosts forks on the fleet; whether it revives anything is unmeasured | not run; decided (D-8102) |
| 5. Resume by run id after a swap | Five `script-path` refusals in wave 1's count, unexplained. Claude Code 2.1.319's refusal reads `scriptPath must be a script path this tool returned, or a file you can already read (the working directory or a directory you have added)` | Task 1 reads the five; Task 3 measures the matrix live (D-8105, D-8106) |
| 6. A paused workflow under a blocked parent | Never seen on the fleet (spec §1.1: 0 of 18). The stage-4 waits it would meet have shipped (wave 2) | Task 4, by a cut list (D-8107) |
| 7. `OOMPolicy=continue` on a pane scope | Shipped by the working-state programme as two prefix drop-ins (D-5241), read by `ccd/ccrc-doctor-checks#_check_oom-policy` | Task 1 reads doctor's line; closed (D-8103) |

## The operator's setup (raised as its own item; none of it is a session's)

Each line is the operator's act from the console, before Task 2. No line needs anything done by hand to tmux, a `claude-session@` unit or a process.
1. **Accounts.** Roster and sign in two scratch accounts, `scratch-a` and `scratch-b`, carrying no real work, in one pool, `pool-s`. With one account only, Task 4 runs its one-account arm, and Task 3 needs consent to one `crossPool` swap onto a real account and back.
2. **Containment.** Choose how real sessions are kept off the scratch accounts: tagging only tightens, so an untagged project's rescue can land on a tagged account. The options are to accept it (the conductor records any such landing), to roster the scratch lanes non-home-able (still a last-resort overflow), or to tag the real projects.
3. **The scratch project.** An empty project, `project-s`, tagged `pool-s`.
4. **The subject.** Create the session on `scratch-a` in `project-s` (`POST /api/sessions`, or the console), with workflows enabled on its route.
5. **Consent.** The conductor may swap the subject, and only the subject, with `interrupt: true` (it will be busy with its own workflow), between `scratch-a` and `scratch-b`, for the length of the loan.
6. **The loan.** It spans at least one five-hour reset of each scratch account: Task 4's first arm needs one, and its second arm needs a second.
7. **The names.** The real account and lane names reach the conductor only in the item's answer, never in the repository.

## Global Constraints

- **Nothing changes but the results.** This wave commits only its results note and the spec's as-measured lines. No `ccd`, server, hook or skill change.
- **The conductor's acts are three:** mail to the subject (`ccrc-api mail send`, kind `status`); the swap of the subject only, through `POST /api/sessions/:id/swap` with `{"wrapper": "<scratch lane>", "interrupt": true}`, under the operator's consent (setup line 5); and reads. It never runs a `ccd` verb that changes state, never creates or archives a session, never touches an account, a pool, tmux, a unit or a process, never reads a credential file or `/proc/<pid>/environ`, and never types into the subject's pane (D-8108).
- **Reads are named paths only.** Under a scratch account's config root, read only `projects/<project-s dir>/` (the subject's transcript and its workflow run directories, including `journal.jsonl`), `ls` of `jobs/` and `sessions/`, and `.last-update-result.json`'s `version_to`. From the registry, read only `swap.log` lines naming the subject's id, the subject's `.rescuewait`, the `pools/project-s` and `pool-epoch` files, and `ccd ls`. Never print a whole file of another account's root.
- **The subject is driven by mail alone.** Each instruction mail says what to run, what to record in `<cwd>/spike-notes.md`, and what to mail back. The subject replies with `status` mail quoting each tool result verbatim (paths may be shortened to `<root-a>`, `<root-b>` and `<cwd>`).
- **A refusal is a stop.** A swap answered `409 session-busy`, or with any other refusal, is reported to the coordinator, never retried with other flags.
- **The loan is the operator's.** When the coordinator mails that the loan ends, the conductor stops wherever it is, records what ran under the cut list (D-8107), and goes to Task 5.
- **Record each build.** `claude --version` for every lane the subject runs on, read as the lane's `.last-update-result.json` `version_to` and in the subject's own transcript. The fleet runs several builds (2.1.311 to 2.1.319 on 2026-11-07).
- **Public repository** (D-8109). The results note and every excerpt use `scratch-a`, `scratch-b`, `pool-s`, `project-s`, `<root-a>`, `<root-b>`, `<cwd>`, `<run-id>`, `<agent-id>`. No account, lane, host or person's name, no absolute home path, no real project name. Run the private-name scan on every changed file before each commit.
- **Deviation numbers are issued, never chosen.** This plan defines D-8102 to D-8109, issued 2026-11-07. A departure found during execution is named by slug in the wave-done, and the coordinator numbers it.
- **Commits** go on the workspace's own branch. Never update-branch, rebase or force-push.

## Review Focus

1. **The subject stays contained.** The likeliest way to spoil the measurement is a placement nobody chose: a rescue of the subject onto a real account, or a real session's rescue onto a scratch account. Before every live step the conductor reads `ccd ls` and records every session on `scratch-a` or `scratch-b`. A subject on a real account ends Task 4's burn at once (Task 4 Step 3).
2. **A resume that succeeds is not the same as a run that completes.** Task 3 records, for each call, the tool result and then the run's `journal.jsonl`: which agent returned from cache, which ran again, and whether the run finished.
3. **Which path was actually passed.** Every resume call quotes the exact `scriptPath` it passed, classified as under `<root-a>`, under `<root-b>`, under `<cwd>` or elsewhere. A hypothesis read from strings is not evidence.
4. **Where a wait came from.** A pause can be Claude Code's own (a `usage limit; resets …` pause of the workflow's agents) or ccd's (`.rescuewait`, the no-room wait). Task 4 records each with its source and its times.
5. **A stall per ruling 6.** With one account, or both limited, the subject may idle past its reset with nothing to resume it (§11 item 6). Task 4 bounds that wait and records it, rather than nudging the subject.

---

### Task 1: The read-only pass (no account needed)

**Files:**
- Create: `docs/superpowers/plans/2026-11-07-session-continuity-wave5-spike-results.md`

- [ ] **Step 1: List the historical `script-path` refusals.** On the fleet box, read-only, import the installed instrument's own classifier (`deploy/measure-continuity.py`, its `script-path` outcome) under `python3 -I`, and walk every transcript on disk, with no time window. For each resume call whose result classifies as `script-path`, print: its time; the session id; the `scriptPath` passed, classified as under the session's own config root at that time, under another account's config root, under its working directory, or elsewhere; the run id; the result text, first 300 characters; and the session's latest `swap.log` line before the call. Print paths as their class, never in full.
- [ ] **Step 2: Count what the history settles.** Expected: wave 1 counted five. If transcripts from that window are past retention, say which are gone, and count every refusal still on disk instead. Record how many refused calls passed an old-root path after a swap, and how many passed a current-root or working-directory path. Any refusal of a current-root path is the finding that matters most for stage 3: quote it whole.
- [ ] **Step 3: Close step 7.** Run `ccrc doctor` (never `--fix`) and copy its `oom-policy` line. Expected: PASS, with both drop-ins on disk and `OOMPolicy=continue` read from the tmux server's scope and one pane scope. A line that is not PASS is reported to the coordinator as it is.
- [ ] **Step 4: Write the note's first section.** In the results note: the counts and a table of the refusals (redacted), the doctor line, and what the history leaves for Task 3. If every historical refusal passed an old-root path and none passed a current-root path, Task 3 runs rows R1 and R2 only, as a confirmation, and the loan's time goes to Task 4.
- [ ] **Step 5: Commit.**

```bash
git add docs/superpowers/plans/2026-11-07-session-continuity-wave5-spike-results.md
git commit -m "docs(continuity): wave 5 Task 1, the historical scriptPath refusals and the oom-policy line"
```

### Task 2: Preconditions, measured before the loan is spent

- [ ] **Step 1: Read the setup item's answer** from the coordinator's mail: the two lane names, the pool, the subject's id, the containment choice and the consent. Keep the names out of every committed file.
- [ ] **Step 2: Measure.** Read-only: `ccd ls` shows the subject on `scratch-a` in `project-s`; the conductor's own row is on neither scratch lane; the registry's `pools/project-s` and `pool-epoch` files tag `project-s`, `scratch-a` and `scratch-b` with `pool-s`; each scratch lane's `version_to`. Expected: every line holds. Any that does not is a stop, reported to the coordinator.
- [ ] **Step 3: Introduce the conductor.** Mail the subject one `status` mail: who the conductor is, that its mail is the spike's instructions, that it records everything in `<cwd>/spike-notes.md`, and that it replies by `status` mail to the conductor's id with `ccrc-api` (`~/.local/bin/ccrc-api mail send`), quoting each tool result verbatim. Ask it to reply with `claude --version` and its working directory. Expected: a reply within the subject's next idle.

### Task 3: Step 5 live — the resume matrix after an ordinary swap

- [ ] **Step 1: The subject starts its work.** Mail the subject to:
  - write a workflow script with two agents: `quick`, which returns a fixed string at once, and `slow`, which runs about 20 minutes on cheap tool calls (one `sleep 60` per turn, twenty turns) and then returns a fixed string;
  - launch it in the background and note its run id, the `scriptPath` the tool returned, and its run directory;
  - copy the script to `<cwd>/spike-wf-copy.js`;
  - start a background Bash watcher (`while sleep 30; do date -u >> <cwd>/watcher.log; done`), a Monitor on `watcher.log`, and one background Agent that sleeps in the same way as `slow`;
  - reply once `quick` has returned and `slow` is running.
- [ ] **Step 2: Swap mid-run.** Once the reply says `slow` is running, swap the subject from `scratch-a` to `scratch-b` through the route, with `interrupt: true`. Record the answer, the `swap.log` lines for the subject (the carry's `(merged …)` line included), and the times. Expected: `200`. Anything else is a stop.
- [ ] **Step 3: What the swap ended.** After the subject resumes on `scratch-b`, read: the gap in `watcher.log`, the transcript's last rows before the swap and its first rows after, and whether the run's directory and `journal.jsonl` exist under `<root-b>` (the carry's copy) as well as under `<root-a>`.
- [ ] **Step 4: The matrix.** Mail the subject to make these calls one at a time, in this order, each a `Workflow` call with the noted run id as `resumeFromRunId`, and to reply after each with the call's input and its result verbatim:

| Row | `scriptPath` passed | Expected from Task 1 and the strings |
|---|---|---|
| R2 | the path the tool returned before the swap, under `<root-a>` | refused `scriptPath must be a script path …` |
| R1 | the same relative path under `<root-b>`, the carry's copy | accepted: `quick` returns from cache, `slow` runs again |
| R3 | `<cwd>/spike-wf-copy.js` | accepted |
| R4 | the `<root-a>` path again, after the operator types `/add-dir <root-a run directory>` in the subject's pane | accepted, or row not run |

  R1 is left to finish before R3 and R4, which then resume a finished run and only test that the path is accepted. R4 runs only if the operator chooses to type the command; otherwise it is recorded as not run.
- [ ] **Step 5: Read each outcome.** For each accepted call, read the run's `journal.jsonl`: which agent returned from cache, which ran again, and the final state. Expected for R1: `quick` cached, `slow` re-run and finished.
- [ ] **Step 6: Write the note's step 5 section** (redacted): the matrix with each row's verbatim result, the journal reading, what the swap ended, and the build. Commit.

```bash
git add docs/superpowers/plans/2026-11-07-session-continuity-wave5-spike-results.md
git commit -m "docs(continuity): wave 5 Task 3, the resume matrix after a swap"
```

### Task 4: Step 6 live — a paused workflow under a blocked parent

The subject starts on the scratch lane it is on after Task 3, called `X` here, and the other is `Y`.

- [ ] **Step 1: The standing instruction.** Mail the subject first, so it holds across every restart: after any restart, and before anything else, resume the burn workflow by run id with its `scriptPath` under the current root (never start a new one), then mail the conductor the call's input and result, the time, and the state of both agents from `journal.jsonl`; then do nothing else until the conductor's next mail.
- [ ] **Step 2: Start the burn.** Mail the subject to create a text file of about 2 MB in `<cwd>`, and to launch a two-agent workflow whose agents each read that file end to end in pages of 2,000 lines, for at most eight passes. Then it reads the same file page by page in its own turns until it is stopped by a limit. Record the run id and the start time. Before starting, read `ccd ls`.
- [ ] **Step 3: Arm 1, the limit and ccd's answer (required).** Mail the coordinator the account's reset time once the subject reports its first pause, then wait by ending the turn. The subject's mail after its restart wakes the conductor. If none has come 30 minutes after the reset, the coordinator mails the conductor. Then read and record, with times and each one's source:
  - Claude Code's pause of the workflow's agents (`usage limit; resets …`, or `too far out to wait for`);
  - the parent's own limit;
  - ccd's answer: a rescue swap `X` → `Y` (`swap.log`), a rescue wait near the reset (`.rescuewait`), or a no-room wait;
  - the subject's resume call and its result;
  - `journal.jsonl` afterwards: did the paused agents run again from where the run stood, and did the run finish?

  If the rescue placed the subject on a real account, stop the burn (mail the subject to stop), record it, and tell the coordinator: the arm counts as run, uncontained.
- [ ] **Step 4: Arm 2, both accounts limited (only if the loan spans a second window).** Repeat Step 2 on `Y`, with `X` still limited. Expected: ccd's no-room wait until one account resets, then a swap or a wait ending in place. Record the same readings as Step 3. If the coordinator says the loan ends first, record arm 2 as not run.
- [ ] **Step 5: The one-account arm (only without `scratch-b`).** The first limit has no target in the pool, so ccd waits with no room. If the subject has not resumed 30 minutes after its account's reset, record it as a stall under §11 item 6 and stop. Do not nudge the subject: nothing resumes it today, and that is what is measured.
- [ ] **Step 6: Write the note's step 6 section** (redacted): each arm run, its timeline, each wait's source, the resume calls and the journal readings, and any arm not run with its reason. Commit.

```bash
git add docs/superpowers/plans/2026-11-07-session-continuity-wave5-spike-results.md
git commit -m "docs(continuity): wave 5 Task 4, a paused workflow under a blocked parent"
```

### Task 5: The spec's as-measured lines, the PR and the wave-done

**Files:**
- Modify: `docs/superpowers/specs/2026-09-23-session-continuity-design.md` (§5.2 only: an "As measured (wave 5, <UTC date of the commit>)" paragraph after the amended decision rule)

- [ ] **Step 1: The as-measured paragraph.** In §5.2, after the decision rule, state in a few lines: which resume call works after a swap and which is refused, with the refusal's text; what a five-hour pause did to the paused run under each arm that ran; the builds; and the results note's path. It records measurements only. Any change it implies for stage 3's design is the coordinator's, in wave 6's plan.
- [ ] **Step 2: Scan and check.** Run the private-name scan over every changed file. Then run the guards a docs change reaches, each in its own foreground `ccrc test` process from `server/`: `topology-clean`, `dtbd`, `anchors`, `citations`, `docs-parity`, and, after `git fetch origin main`, `deviation-refs`.
- [ ] **Step 3: Commit, check mail, push, and open one PR** to `main` with the results note's and the spec's durable links. Never merge, enqueue, rebase or update-branch it.

```bash
git add docs/superpowers/specs/2026-09-23-session-continuity-design.md docs/superpowers/plans/2026-11-07-session-continuity-wave5-spike-results.md
git commit -m "docs(continuity): wave 5's as-measured lines in spec §5.2"
```

- [ ] **Step 4: The wave-done.** After the PR's fast run on the exact tip has finished, send one wave-done at that tip, with the arms run and not run, each measured answer in one line, and the PR number.

## Deviations found

- **D-8102** — `native-handoff-decided-not-measured` (scope): steps 1 to 4 are not run. Stage 3 is manifest-primary by the operator's ruling (item 75; spec §5.2 and §11 item 8, rev 11). The reasons: cross-root adoption is predicted to fail; Claude Code ends workflows and agents before its handoff, so their recovery is a resume by run id either way; the handoff's gates and carrier changed after the spec (`CLAUDE_DISABLE_ADOPT`, `bgTakeover`, a per-job storage key), across a fleet that runs several builds; and the manifest is written at a supervisor revival anyway, where no graceful exit happens. If native handoff is ever wanted, it is measured off the fleet first.
- **D-8103** — `step-7-closed-by-d5241` (scope): `OOMPolicy=continue` shipped as two prefix drop-ins in the working-state programme (D-5241), because `set-property` refuses the property. This programme agrees to that take-over (its spec §6.3). Task 1 Step 3 reads doctor's `oom-policy` line, which closes the step.
- **D-8104** — `graceful-stop-bound-in-stage-3` (scope): step 2 is not run, so the graceful stop's bounded wait is measured in wave 6, behind a shadow arm, before the stop is armed.
- **D-8105** — `scriptpath-history-first` (method): Task 1 reads the past refusals before the loan. What it settles shortens Task 3.
- **D-8106** — `resume-matrix` (method): step 5 is measured as four rows at one mid-run swap, rather than one call with a current-root path.
- **D-8107** — `step-6-cut-list` (method): arm 1 (one limit and ccd's answer) is required; arm 2 (both accounts limited) runs only if the loan spans a second window; without a second account, the one-account arm runs, bounded by §11 item 6.
- **D-8108** — `the-conductor-reads-mails-and-swaps` (safety): the conductor's acts are mail to the subject, the route swap of the subject alone under the operator's consent, and named reads. Everything else is the operator's.
- **D-8109** — `redacted-results` (public repository): every committed excerpt uses neutral stand-ins, and the private-name scan gates each commit.

## Where things stand

**Agreed:**
- The operator lends a scratch account and the programme resumes (item 59, 2026-11-07).
- The reduced spike: stage 3 is manifest-primary on the evidence, and the account is spent on steps 5 and 6 (item 75, 2026-11-07). The spec's §5.2, §5.3, §10 and §11 say so in rev 11, on this plan's PR.
- Step 7 is closed by D-5241, with doctor's line read in Task 1.

**Waiting on you:**
- The plan's approval.
- The setup item: two scratch accounts in one pool, the containment choice, the scratch project and session, the swap consent, and the loan.

**Later:**
- Wave 6 (stage 3) is planned from this wave's results. It extends the delegation broker's spool and projection rather than adding a second record, pins the resume refusal strings it relies on in tests, and measures the graceful stop's bound behind a shadow arm (Carried constraints).

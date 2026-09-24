# Landing order, wave 1 — the absorb rules, the sync advisory and `ccrc restamp` (spec stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the fleet manufacturing main churn with every part of spec stage 1 that changes no server: worker clause 16 (absorb `origin/main` only on one of three triggers, `git merge` only, never `update-branch`, no repository-settings writes), coordinator clause 15 (no `update-branch`, no repository-settings writes, a sync request only on a measured conflict, programme ledgers on the coordinator's own PR), a PreToolUse advisory in `ccd/session-hook.sh` that reaches the sessions no skill reaches, `ccrc restamp <file>`, `update-branch` pinned ABSENT from executable source (its two licensed, non-calling spellings pinned line for line) and COUNTED in the two skill corpora, and step 6 of the wave lifecycle (a fresh workspace per wave) written GATED on child-reclamation's reclaim-on-close wave. Plus the instrument spec §10 commits with the plan, `deploy/measure-landing.py`, and the three prerequisites it measures before the first stage ships.

**Architecture:** Seven mechanisms, each with a test that reds when it is deleted or mutated. (1) `deploy/measure-landing.py` — a stdlib-only Python instrument whose ONE door to GitHub is `_gh`, a fixed `gh api -X GET <path>` argv behind a path grammar that refuses anything but a plain REST read, and whose ONE door to the ccrc server is `_api`, which refuses every `ccrc-api` verb but `runs list` and `mail list`; an input it could not read (an empty required-context set, a missing `--fleet-login`, a full newest-first mail page) is refused or reported as such, never turned into a number; its pure decisions (`required_state`, `red_intervals`, `merge_of_main`, `repeat_share`, `fleet_logins`, `sync_kind`, `episode_class`) are tested directly. (2) `cmd_restamp` in `ccd/ccrc` — `markGenerated` from the tree's own `shared/mark.mjs`, which RE-STAMPS a `ccrc:generated` file and REFUSES one with no marker (a restamp that adopted a hand-written file would make it overwritable by the next generator) and one under `~/.local/bin` or `~/.ccrc` (a generator's own output, whose `ccrc-edited` state its generator protects). (3) Worker clause 16 in `ccd/worker-skill/SKILL.md`, pinned verbatim with the count moving 15 → 16 in the skill, `README.md` and `CLAUDE.md`. (4) Coordinator clause 15 in `ccd/coordinator-skill/SKILL.md`, 14 → 15 the same way, and §5 step 6 in `references/wave-lifecycle.md`, gated on `ccd caps` listing `reclaim-v1`, with a pointer from SKILL.md's same-project arm. (5) A PreToolUse block in `ccd/session-hook.sh`, below every frozen citation anchor, that emits `additionalContext` — never a decision — on a Bash command whose `git` sits in command position and merges, pulls or rebases `main` into the current branch, or that asks GitHub to (`gh pr update-branch`, the REST route, the GraphQL mutation). (6) `update-branch` — absent from the spec's DERIVED executable-source set (every tracked file under `server/src`, `agent/src`, `shared/`, `deploy/`, plus `ccd/ccd`, `ccd/ccd-*`, `ccd/ccrc`, `ccd/session-hook.sh`), with exactly two licensed spellings pinned line for line as the only ones — the advisory's detector and the instrument's classifier, neither of which calls it — and counted by EQUALITY in each skill corpus (licensed once, in the clause that forbids it). (7) The measurement itself: required-only red-main with its PR-failure overlap, coordinator mail latency to the first nudge-started turn, and the repeat-absorption share over the ruled fleet identities, per PR and per merge.

**Tech Stack:** bash 5.2 (`ccd/session-hook.sh`, `ccd/ccrc`, both `set -uo pipefail`, no `-e`), Markdown skills pinned by vitest 4.1, TypeScript tests, node 22 (`shared/mark.mjs`), python 3.12 (the instrument, stdlib only), gh 2.45 (GET only), git 2.43.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` — §5.1 in full (clause 16, clause 15, step 6, the hook, the regenerator CLI, the pins); §3 (R1–R10; R5 above all: the coordinator merges, workers never do, nothing merges unattended); §4's Worker and Coordinator rows; §9 (step 6 goes live only with CCR-15's reclaim-on-close wave; session-continuity's stage 5 appends its clauses AFTER these); §10 (the stage-1 metric row, the three prerequisites, the committed instrument). Programme ledger: `docs/superpowers/programs/landing-order.md` (wave 1's row).

---

## Global Constraints

Copied from `CLAUDE.md`, the spec and the programme ledger. Every task's requirements implicitly include this section.

- **Deploy class for THIS wave: AGENT-FIRST, and there is no server arm at all.** Everything that ships lands on the fleet box: the two skills and the wave-lifecycle reference reach every rostered home through `ccrc update`'s install spine (`_inst_skills`), the hook through its installer (`~/.cc-sessions/session-hook.sh`), and `ccrc restamp` with the installed tree. `ccrc rollout --to <this merge's tag>` in its DEFAULT order (fleet box first); never `--server-first`, never `deploy.sh`. The instrument is run from a checkout by hand and installs nowhere. Task 7's post-merge steps restate the order.
- **The skill pins move in the same commit as the clauses** (programme ledger, carried constraint 2): `worker-skill.test.ts` and `coordinator-skill.test.ts`, and the clause-count words in `README.md` and `CLAUDE.md` that both pins read, land in ONE commit per skill (Tasks 3 and 4). Session-continuity's stage-5 wave appends its clauses AFTER these (spec §9); nothing here reserves a number for it.
- **Clause text is VERBATIM, and its bytes are load-bearing.** Worker clauses are double-quoted in the test and written with STRAIGHT apostrophes and no `"` (the D-104 note in SKILL.md); worker clause 16 is ONE line — `worker-skill.test.ts` harvests `^\d+\. ` over the whole file as the clause list, so its three triggers are written inline, never as a nested numbered list. Coordinator clause 15 carries no apostrophe at all, so neither the curly nor the straight spelling can drift.
- **`update-branch` is ABSENT from executable source and COUNTED in the skills** (spec §5.1 "Pins", as reconciled 2026-09-24). The executable set is the spec's own, derived from the index: every tracked file under `server/src`, `agent/src`, `shared/` and `deploy/`, plus `ccd/ccd`, every `ccd/ccd-*` sibling, `ccd/ccrc` and `ccd/session-hook.sh`. It carries exactly TWO allowed spellings, pinned line for line as the only ones, and neither calls anything: the advisory's detector in `ccd/session-hook.sh` (its `LANDING_UB_RE` line and its prefilter's branch-update line) and the classifier in `deploy/measure-landing.py` (its `GH_UPDATE` label and its `UPD` regex). Every other line of those two files — comments, the advisory's own text, docstrings — avoids the spelling (Pre-flight finding 8).
- **Step 6 is written GATED, never live.** Child-reclamation's reclaim-on-close wave (CCR-15 wave 3) has NOT merged at `905360dc` (its ledger reads `planned`); step 6 says it applies only once `ccd caps` lists `reclaim-v1`, the token that wave's contract names, and until then §5 step 3's same-project arm governs as written.
- **The hook is a contract, not an access boundary** (programme ledger, carried constraint 3). The advisory NEVER denies: it is `_hook_nudge_json`, the graph arm's advice envelope, never `_hook_deny_json`. One line per event still: a deny or nudge the graph arm already built wins.
- **The hook's hot path** (its header: exit 0 on every path, no network, no waiting). The new block forks nothing unless the raw payload carries `main` or `origin` AND a sync verb, or GitHub's branch-update spelling, and then exactly one `jq`. Its regex costs at most tens of milliseconds on a 30–38 KB adversarial command (measured: 41 ms worst, `git merge ` × 3000), no pathological backtracking.
- **SAFETY — sacred.** NEVER run destructive `ccd` verbs against the live host (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`). NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly — Task 1's measurement READS the registry's `<id>.workdir` files and Claude Code transcripts and writes nothing outside its own `--out` directory. **No `gh` write of any kind**: the instrument's only gh argv is `gh api -X GET <path>`, and no step in this plan runs `gh` for anything but a read — except Task 7's `gh pr create`, the worker's own PR, which the worker skill already licenses. NEVER print secret file CONTENTS.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** No test in this wave runs `ccd` at all (so `makeCcdHarness` is not needed); the hook test runs `ccd/session-hook.sh` inside a `mkTmp` HOME with a stub `tmux`, the way `session-hook.test.ts` does, and the restamp test runs `ccd/ccrc` through `ghContainedEnv(home, …)`, the runner `ccrc-cli.test.ts` uses, so the real `gh` cannot be reached from it.
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in:

      cd server && npm ci && npm run test    # vitest run — hermetic
      cd agent  && npm ci && npm run test
      cd pwa    && npm ci && npm run test

- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`.**
- **Run suites in the FOREGROUND, timeout ≥600000ms.** Never background a suite. The server suite runs as sequential shards (Task 7).
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`. `session-hook.test.ts` is NOT edited by this wave (Pre-flight finding 3); it ran 333/333 green in 111.7 s on the prototype.
- **`ccd/ccd` is NOT edited by this wave**, so no re-stamp and no `_reg_get` census step is owed. If a merge of `origin/main` into this branch ever conflicts on `ccd/ccd`'s stamp line (line 2), take either side of THAT LINE only, resolve every other hunk as the hand-written source it is, and run `ccd/ccrc restamp ccd/ccd` (Task 2's own verb) — that is clause 16's rule, applied to this branch. Never take one side of the whole file: `ccd/ccd` is source that carries a stamp, and a file-level side drops the other side's hunks while the restamp blesses the loss (Pre-flight finding 13).
- **The citation tax is owed by every CITED file, and this wave edits three:** `ccd/session-hook.sh` (Task 5), `ccd/ccrc` (Task 2) and `README.md` (Tasks 3–4, in-place word swaps). Measured on the prototype with all six tasks' edits in: **nothing moved** — `byFile` 147/21/5/… stated = base = tree, total 195, the `|`-row array 53 and the site array 35 with EMPTY `ENTERED`/`LEFT` (see "The citation tax, measured"). Each task that edits a cited file still runs the measurement, because a base that moved since `905360dc` can move it. Re-measured 2026-09-24 at `08701c22` (main `b501698a` merged in), all six tasks' edits applied: unchanged — `python3 cite-remeasure.py <scratch> HEAD --files ccd/session-hook.sh,ccd/ccrc,README.md` printed every `byFile` key stated = base = tree, total 195, arrays 53 and 35, every `ENTERED`/`LEFT` empty.
- **Rings:** nothing here touches `shared/*.ts`, `server/src` or `agent/src`. **No overloaded null at a seam:** the instrument's `required_state` answers THREE words (`green`/`red`/`unmeasured`) and `red_intervals` never lets `unmeasured` open or close an interval; `ccrc restamp` answers three outcomes (re-stamped / already current / refused), each its own exit and line.
- **Wire discipline:** no frame, no field, no `FLEET_PROTO` change.
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted or mutated, measured before/after. Every row below was run on a prototype of exactly these edits and its red is quoted — first at `905360dc`, then, after the review round, every row of every table re-run at `af64d9d2` (the spec reconciliation; no code differs from `905360dc`), one vitest process at a time. A mutation's backup copy lives in the SCRATCHPAD, never beside the file: a `SKILL.md.mutbak` inside `ccd/worker-skill/` reds `worker-skill.test.ts`'s "carries no references of its own" on EVERY row (measured — Pre-flight finding 10), which makes every red ambiguous.
- **Locate code by CONTENT.** Line numbers in this plan are "at `905360dc`" and are hints, never addresses. Two other programmes (child-reclamation waves 3–5, session-continuity) are live against the same skills and hook — child-reclamation wave 2 merged as #178 and is on main at `b501698a`, so its step-3 text in `SKILL.md` and `wave-lifecycle.md` §5 ("One PR per child") is part of the base this plan edits (re-measured 2026-09-24 at `08701c22`).
- **Every forecast number is "at `905360dc`" for code, and "measured 2026-09-23 over the frozen window 2026-09-08..2026-09-22" for Task 1.** A different figure on your run is not a red — the instrument is the authority, and the difference goes in the wave-done report.
- **Shell state does not survive between Bash calls.** Every block that names `$SCRATCH` or `$OUT` sets it itself; `SCRATCH=<…>` means "paste your own session's scratchpad, as an ABSOLUTE path".
- **Branch discipline:** commit on this workspace's own branch only; never a separate feature branch. One commit per task.
- **Commit trailers:** end every commit message with the attribution line your own session is given; the heredocs below end at the body for that reason.
- **No hostnames, IPs, tailnet names, docserver URLs, account names or GitHub logins** in any committed file (`topology-clean.test.ts`). The fleet's login is read at run time (`gh api user`) and never written down; organisation names are derived from each checkout's `origin`, never typed.
- **`## Deviations found` numbers are ISSUED, never chosen** — see that section at the foot of this plan.

---

## Review Focus

Nine inputs or failure modes the spec implies and no pre-existing test covers. Each is given a test in the task that owns it; a reviewer checks the test exists and reds for the stated reason.

1. **`git merge-tree --write-tree` exits 1 for an unresolvable ref, not only for a conflict.** Spec §5.1 names the probe by "exits 1"; measured on git 2.43 in this repository, a real conflicting merge (`79a46a56^1` × `79a46a56^2`) answers rc 1 with a tree id and the conflicted path on stdout, and `HEAD` × `nonexistent-ref` ALSO answers rc 1 — stdout empty, stderr `merge-tree: nonexistent-ref - not something we can merge`. A clause that licensed an absorb on "exits 1" would license one on a typo. → Task 3 pins clause 16's "exits 1 with a tree id on its first line" and "any other answer is unmeasured and licenses nothing"; Task 5 pins the same two halves in the advisory text (`exit 1 with a tree id on the first line`, and the same "any other answer" phrase), mutation H9.
2. **The advisory firing on the probe itself, on any read of main, or on a sync that is only MENTIONED.** `git merge-tree … origin/HEAD` and `git merge-base … origin/main` both begin `git merge`; `echo "git merge origin/main"`, a commit message, a PR comment and an `echo '…'` all contain a sync command without running one. → Task 5's `NOT_SYNCS` table (thirteen commands, each asserted silent); mutation H3 (a loosened verb boundary) reds the first two, and H10 (whitespace re-admitted before `git`, i.e. `git` no longer required in command position) reds the three mentions.
3. **A PreToolUse envelope printed on a PermissionRequest for the same Bash call.** The PermissionRequest arm reads `tool` exactly as the PreToolUse arm does, so a block keyed on the tool alone would print `hookEventName:"PreToolUse"` into a permission prompt. Measured: with the event test deleted (mutation H8) the file stayed GREEN until the PermissionRequest case existed. → Task 5's `it.each(['PostToolUse', 'PermissionRequest'])`.
4. **`ccrc restamp` adopting a file ccrc never wrote, or laundering a generator's protected output.** A marker is how `deploy/gen-wrappers.mjs` decides a wrapper is its own to overwrite; stamping an unmarked file would hand the next generator run a hand-written file. And a STAMPED wrapper a human edited reads `ccrc-edited`, which `ccrc wrappers` refuses to overwrite (its remedy: keep the edit via `exec.kind` `external`); re-stamping it would turn that protected edit into something the next run silently overwrites. → Task 2's "REFUSES a file with no marker and leaves it untouched", the `~/.local/bin` / `~/.ccrc` refusal (R7, R8), and the symlink refusal beside them.
5. **A cancelled required leg, or a failed attempt a re-run superseded, read as red.** The macOS legs are cancelled at a 55-minute cap, and GitHub keeps every attempt's check-run on the commit; a red-main measure that counted either would inflate the very prerequisite spec §10 asks for. → Task 1's `required_state` cases (a cancel is `unmeasured`; the LATEST attempt of each context decides), mutations I4 and I8.
6. **An input the instrument could not read, turned into a number.** An empty required-context set makes every commit green (`set() <= anything`, `all([])` — measured on the prototype: a stub that 404s both endpoints produced `"required": []` and `required_only.hours: 0.0`, and cached the empty set for every later run); a newest-first mail page that came back full silently drops the window's oldest mail; a run with no claimant crashed `mail-latency` (`TypeError: '<' not supported between instances of 'str' and 'NoneType'`, mutation I13). → Task 1's "an input it could not read is never a number" cases, mutations I9–I13 and I15.
7. **A hand-run instrument reaching a write.** `~/.local/bin/ccrc-api`'s table carries POST rows (runs close, mail send, ledger allocate) beside the two list verbs the instrument needs. → Task 1's `_api` pin, static (every call site names `runs list` or `mail list`) and behavioural (the door refuses anything else before the client runs), mutation I14.
8. **A generated stamp resolved at FILE level.** `ccd/ccd` is hand-written source whose line 2 is a digest of its own body; "take either side" of the whole file drops every hunk the other side changed, and `restamp` then blesses the loss. → clause 16 and the advisory say "take either side of that line only, resolve every other hunk of the file as the source it is" (Task 3's probe `it`, mutation W7).
9. **A new mention of `update-branch` in executable source, or a changed detector.** The spec licenses exactly two spellings and pins them "as the only ones". → Task 6's line-for-line licence: a mention in any file of the set reds (A1–A3, A5–A8), and so does a changed licensed line (A9).

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `deploy/measure-landing.py` | Create (Task 1) | The programme's read-only instrument: eight subcommands, one GitHub door, one list-only ccrc-api door; the classifier's one spelling of `update-branch` |
| `server/test/measure-landing.test.ts` | Create (Task 1) | GET-only and list-only (static and through recording stubs); unreadable inputs refused, never counted; the pure decisions every baseline derives from |
| `ccd/ccrc` | Modify (Task 2) — the usage line in place; three usage lines after `expose`'s paragraph (≈1596); `cmd_restamp` directly above the source guard (≈12901, below every frozen `ccd/ccrc` anchor); one dispatcher arm | `ccrc restamp <file>` |
| `server/test/ccrc-restamp.test.ts` | Create (Task 2) | Re-stamps an edited stamp, leaves a current one byte-identical, refuses a foreign file, a generator's own output and a symlink, usage and write failures |
| `server/test/ccrc-cli.test.ts` | Modify (Task 2) — the usage-line regex; one description assertion | `restamp` is discoverable |
| `ccd/worker-skill/SKILL.md` | Modify (Task 3) — clause 16 after clause 15; "fifteen" → "sixteen" twice | The worker's absorb rule |
| `server/test/worker-skill.test.ts` | Modify (Task 3) — CONTRACT entry 16 and `ABSORB`; two `it`s; two count words in a comment and a title | Clause 16 verbatim; `update-branch` counted; the probe's two halves, the settings it never writes, the stamp-line rule |
| `ccd/coordinator-skill/SKILL.md` | Modify (Task 4) — clause 15 after clause 14; "fourteen" → "fifteen"; two lines in step 6's same-project arm | The coordinator's no-churn rule; the pointer to the gated step |
| `ccd/coordinator-skill/references/wave-lifecycle.md` | Modify (Task 4) — §5 step 6 after step 5 | A fresh workspace per wave, GATED on `reclaim-v1` |
| `server/test/coordinator-skill.test.ts` | Modify (Task 4) — CONTRACT entry 15; one census `it`; one appended `describe`; three count words in comments and a title | Clause 15 verbatim; `update-branch` counted across the whole corpus; step 6's gate and order |
| `README.md` | Modify (Tasks 3–4) — four count words, in place, no line added | The clause-count words both pins read |
| `CLAUDE.md` | Modify (Tasks 3–4) — two count words, in place | Same |
| `ccd/session-hook.sh` | Modify (Task 5) — one block after the graph arm's closing `fi` (≈3116, below README's `:2900`, the file's highest cited anchor) | The sync-of-main advisory; the detector's one spelling of `update-branch` |
| `server/test/session-hook-sync-advisory.test.ts` | Create (Task 5) | Advises on nineteen sync spellings, silent on thirteen near-misses and mentions, never denies, independent of the graph gate |
| `server/test/update-branch-absent.test.ts` | Create (Task 6) | `update-branch` absent from the derived executable-source set, but for its two licensed lines |

**Not modified, deliberately:** `server/test/session-hook.test.ts` (a cited file and a load flake — the advisory's cases live in their own file), `ccd/ccd`, every `server/src`/`agent/src`/`shared`/`pwa` file, `ccd/reviewer-skill/SKILL.md` (the spec gives the reviewer no clause), `docs/superpowers/programs/landing-order.md` (the coordinator's ledger, committed on its own PR by clause 15's own rule).

**Task order is load-bearing once:** the absence pin (Task 6) licenses a line the hook block (Task 5) introduces, so it lands after it; written before Task 5, its licence would red on the missing detector line — which is the licence working, not a flake.

---

## Pre-flight findings (measured while planning; not deviations)

Each was measured on a prototype of this plan's exact edits in an isolated worktree at `905360dc`; findings 13–16 and the revised 7, 8 and 11 were measured in the review round at `af64d9d2` (code-identical). They are why the tasks look the way they do.

1. **The probe's exit code is ambiguous on git 2.43** (Review Focus 1). `git merge-tree --write-tree --name-only --no-messages 79a46a56^1 79a46a56^2` → rc 1, stdout `20a4009204db2d05612a9b3d17b4ee31cc99d0b2` then `server/test/worker-skill.test.ts`, stderr empty; `git merge-tree --write-tree HEAD nonexistent-ref` → rc 1, stdout empty, stderr `merge-tree: nonexistent-ref - not something we can merge`. `HEAD` × `origin/HEAD` on this tree → rc 0. So the conflict answer is rc 1 AND a 40-hex tree id on stdout's first line; `--name-only --no-messages` keeps that first line alone and the rest paths. `origin/HEAD` resolves (`git symbolic-ref refs/remotes/origin/HEAD` → `refs/remotes/origin/main`), and a clone without that symref is exactly the case the "any other answer" arm covers.
2. **The citation tax measured ZERO on all three cited files.** With every task's edit in, `cite-remeasure.py … HEAD --files ccd/session-hook.sh,ccd/ccrc,README.md` printed stated = base = tree for every `byFile` key (`ccd/ccd` 147, `ccd/session-hook.sh` 21, `ccd/ccrc` 5, total 195) and empty `ENTERED`/`LEFT` on all three compositions (53-entry `|`-row array, 35-entry site array) — re-measured with the review round's longer hook block and `cmd_restamp`, same answer. The hook block sits below README's `ccd/session-hook.sh:2900`, the file's highest anchor (line 2900 still reads `if _hook_emit_context "$CARD" "$CARD_COMPACT" …` after the edit); `cmd_restamp` sits below the spec's highest `ccd/ccrc` anchor (`:11635`); the three usage lines at ≈1596 ARE above `ccd/ccrc`'s anchors and moved no census entry — measured, not argued.
3. **`session-hook.test.ts` is not the place for the advisory's tests.** It is a cited file (the corpus names it up to `:7043-7056`) and a known load flake; a new file with the same harness costs neither.
4. **The event test is load-bearing only through PermissionRequest** (Review Focus 3). Mutation H8 (delete `"$event" == PreToolUse`) stayed 24/24 green with only a PostToolUse silence case — `tool` is unset there — and reds 1 of 25 once the PermissionRequest case is in (1 of 37 in the revised file).
5. **The tool-name test is the ONE guard, by construction.** The first prototype read the command with the graph arm's `if .tool_name == "Bash" then … else "" end`, which made deleting the bash-level `tool == Bash` test a GREEN mutation (two guards, each covering the other). The shipped block reads `.tool_input.command` for any tool, so the tool name is the only thing between a non-Bash payload carrying a `command` and the regex; mutation H4 reds.
6. **Required-only red-main is a different quantity from the whole-workflow figure** (Task 1). On this repository, 2026-09-08..22: required contexts `build-pwa`, `test (agent)`, `test (pwa)`, `test (server)` → 5 intervals, 9.0 h, and 17 of 39 PR runs with a required-job failure inside them; the whole-check reading of the same pushes → 10 intervals, 120.7 h, 53 of 91 failed PR runs inside (the archived instrument's 111.2 h / 9 / 50-of-92 read the one `ci` workflow's conclusion; this reads every check-run on the push).
7. **"The fleet" committed under more than one identity — and the set is RULED.** Of this repository's 73 local merges of main in the window, 34 carry the fleet login and 38 a placeholder identity (a worktree whose git identity was never set, the defect the 2026-09-23 identity rule closed); across the six repositories the fleet-login-only repeat share is 110/253 = 0.435, with the placeholder identity added 135/290 = 0.466, and all committers 159/357 = 0.445. Ruled (orchestrator decision 2026-09-24, now spec §10): the fleet is the PAIR — the fleet's gh login plus that placeholder identity — both passed to the instrument as arguments. So `--fleet-login` is REQUIRED by `absorptions` and `inversions` (no default to drift from the ruling; a run without it is refused before anything is read), stage 1's baseline is the pair's 0.466, and the login-only 0.435 is reported as a labelled secondary line.
8. **The absence set is the spec's reconciled one, and its two licensed spellings are pinned line for line.** Spec §5.1 (reconciled 2026-09-24) pins `update-branch` absent from `server/src`, `agent/src`, `shared/`, `deploy/`, `ccd/ccd`, `ccd/ccd-*`, `ccd/ccrc` and `ccd/session-hook.sh`, with two allowed spellings "pinned as the only ones": the advisory's detector and the instrument's classifier. As first written, this wave's own files would have red that pin: the hook spelled the word on 6 lines (3 comments, the advisory text, the regex, the prefilter) and the instrument on 9 (docstrings, five code lines, the regex). The revision cuts each to its spelling alone — the hook to `LANDING_UB_RE` and one prefilter line, the instrument to the `GH_UPDATE` label and `UPD` — and rewords every comment and the advisory text around it ("the Update branch of GitHub"). The constant is `GH_UPDATE`, not `UPDATE_BRANCH`: the pattern is `/update[-_]branch/i`, so that identifier would itself have been a third spelling (measured). The set is read with `git ls-files`, not a directory walk: loading the instrument as a module writes `deploy/__pycache__/*.pyc` (gitignored, `.gitignore:71`), whose bytes carry the word — measured GREEN with a planted `.pyc` spelling it, because it is untracked — and `deploy/` also holds the box's gitignored mail token, which a test must never read. `measure-landing.test.ts` also sets `PYTHONDONTWRITEBYTECODE` on every spawn (the ccgpt harness's precedent), so the bytecode is not written at all. At `af64d9d2` plus this wave the set was 180 tracked files; at `08701c22` plus this wave it is 189 (main's #176 and #178 added nine tracked files under `server/src` and `shared/`, none spelling the word — `git ls-files -z -- server/src agent/src shared deploy ccd/ccd ccd/ccrc ccd/session-hook.sh 'ccd/ccd-*' | tr '\0' '\n' | grep -c .` with the instrument intent-added, measured 2026-09-24).
9. **Worker clause 16 is one line** (Global Constraints): `worker-skill.test.ts` reads `^(\d+)\. ` over the whole SKILL.md as the clause numbering, so a nested `1.`/`2.`/`3.` trigger list would read as three extra clauses.
10. **A mutation backup inside a skill directory reds every row.** The first mutation run kept `SKILL.md.mutbak` beside `SKILL.md`; `readdirSync(skillDir)` then answered `['SKILL.md', 'SKILL.md.mutbak']` and "carries no references of its own" failed on rows that had nothing to do with it. The runner below keeps backups in the scratchpad.
11. **The archived instruments cannot be committed verbatim.** Every one hard-codes a scratch path under an operator's home; several hard-code organisation names and the fleet's login (`topology-clean.test.ts` reds each class). `deploy/measure-landing.py` PORTS their logic with those inputs made arguments, and each subcommand's docstring names what it ports (spec gap 2). Reproduced by the port: green-to-merge (median 33.9 min, p90 1092.8 min = 18.2 h, max 14580.9 min = 243 h, against spec §1's 33.4 min / 18.2 h / 243 h), fleet `update-branch` commits (8 across the six repositories = spec §10's baseline of 8), hand-resolved merges (46 of 75 here, against 41 of 64). NOT reproduced: inversions — 19 pairs here (14 fleet-on-fleet) against 5, because the archived g5 took a PR's readiness from its timeline's first force-push OR merge, and the port reads commits only. Ruled (orchestrator decision 2026-09-24, now spec §10): every inversion baseline is re-derived with the committed scan, and the archived timeline-based figure (5) is retired with that reason; stage 2's row now reads 14 fleet-on-fleet (19 for all actors).
12. **`ccrc restamp`'s usage-error case is green before the verb exists** (an unknown verb is also exit 2). Task 2's mutation R3 is what proves the arity check itself.
13. **`ccd/ccd` is not a generated file; only its line 2 is.** `ccd/ccrc`'s header says so ("`ccd` carries one spuriously (it predates the marker meaning something)"), and `shared/mark.mjs`'s digest covers the whole hand-written body. Spec §5.1's "take either side, then run the regenerator", read at file level (`git checkout --ours/--theirs ccd/ccd`), throws away every hunk the other side changed — including hunks git had already merged cleanly — and `ownership.test.ts` goes green on the restamped result. Session-continuity waves 1–4 all edit `ccd/ccd`. So clause 16, the advisory and `cmd_restamp`'s header say "take either side of that line only, resolve every other hunk of the file as the source it is". This narrows the spec's own wording; the coordinator ledgers it at run-open if it rules it a deviation.
14. **`~/.local/bin` is not on the fleet session unit's PATH** (worker SKILL.md's own `ccrc-api` section; `server/src/coord/envelope.ts`: "Invoke by that exact path"). A clause that named the launcher by `ccrc restamp` would answer `command not found` inside a `claude-session@` unit at exactly the moment the worker must not hand-resolve, so clause 16 and the advisory spell `~/.local/bin/ccrc restamp <file>`; from ccrc's own checkout `ccd/ccrc restamp ccd/ccd` works too.
15. **The mail read is a newest-first page.** `mail list --to <id> --all 1` is `mailForRecipient(toId, limit = 100)` — `ORDER BY d.id DESC LIMIT ?`, clamped at 500 (`clampMailLimit`, `server/src/coord/store.ts`). Measured after the window, a coordinator with more than 100 deliveries since it opened loses exactly the window's oldest mail, which the first draft counted neither matched nor unmatched. The instrument now asks for `--limit 500` and reports a coordinator whose page came back full as `truncated`, in neither figure. A page with room to spare is that recipient's whole history, so an oldest row later than the window's start is NOT truncation (a coordinator first mailed mid-window) — the review's proposal to treat it as such was not taken.
16. **The advisory's first regex let a MENTION through.** Its leading class accepted any whitespace before `git`, so `git commit -m "Workers now git merge origin/main only on a conflict"`, `gh pr comment 5 --body "please git merge origin/main and re-run"` and `echo 'run git rebase origin/main first'` all advised (measured by the review's 66-command probe), and it missed `git merge "origin/main"`, `git -c k=v merge origin/main`, `git --no-pager merge origin/main`, `git pull origin HEAD` and the GraphQL `updatePullRequestBranch`. The revised regex requires `git` in command position (start, or after `;` `&` `|` `(` `{` or a newline, past any `VAR=value` prefixes), takes any global options, the quoted slash forms and `origin HEAD`, and `LANDING_UB_RE` takes the GraphQL mutation. Measured over 41 commands: every intended spelling advises, and every mention, read and near-miss stays silent, including `git pull origin feature/x` and `git merge -m "sync with main" feature/x`. Bare `git merge origin` (origin's HEAD) is deliberately NOT advised: a bare `origin` ref would also match `git pull origin`, a pull of the current branch's own upstream.

---

## The citation tax, measured (S6-R11)

`server/test/session-hook.test.ts` audits every `file:line` citation in two FROZEN corpus documents (`docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md`, `docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md`) and in `README.md`. An insertion into ANY file they cite moves every anchor below it. The standing rule S6-R11: **README is REPAIRED, by content, never counted; everything else is RE-MEASURED from the instrument, with the composition stated; no rule is widened and no D-number is spent.** This wave edits three cited files and the forecast for all three is ZERO movement (Pre-flight finding 2) — which is a forecast to MEASURE, not to trust.

The tool is the child-reclamation wave-1 plan's `cite-remeasure.py` with ONE change: the files it swaps back to the base are a `--files` argument (default `ccd/ccd,README.md`, the original tool exactly), and it prints every `byFile` key rather than only `ccd/ccd`'s. Write it once into your scratchpad (a measurement instrument — never committed):

- [ ] **Write the census re-measurer** to `$SCRATCH/cite-remeasure.py`:

```python
#!/usr/bin/env python3
"""Re-measure session-hook.test.ts's citation census FROM THE INSTRUMENT (S6-R11).

The child-reclamation wave-1 plan's tool, with ONE change: the set of files it
swaps back to <base-ref> is `--files` (comma-separated, default
`ccd/ccd,README.md`, which is the original tool exactly), because this wave
edits cited files other than `ccd/ccd` — `ccd/session-hook.sh`, `ccd/ccrc` and
`README.md`. Everything else is the original: it runs ONLY the citation cases
twice — once with the named files as they stand at <base-ref>, once as they
stand in the working tree — each time with four dump probes inserted above the
assertions they feed, restores every file it touched byte-for-byte (asserted),
and prints what the test STATES, what the instrument MEASURES, and the
COMPOSITION (which references entered and which left, base -> tree).
With --write it rewrites exactly four literals in the test — `'ccd/ccd': N` in
the byFile map, `.toBe(N)` on `total`, and the two ref arrays of the `|`-row
case — in the instrument's own order. It never edits a comment.
usage: python3 cite-remeasure.py <scratch-dir> <base-ref> [--files a,b,c] [--write]
"""
import collections, json, os, re, shutil, subprocess, sys
scratch, base = sys.argv[1], sys.argv[2]; write = '--write' in sys.argv
FILES = ('ccd/ccd', 'README.md')
if '--files' in sys.argv:
    FILES = tuple(sys.argv[sys.argv.index('--files') + 1].split(','))
T = 'server/test/session-hook.test.ts'
out = os.path.join(scratch, 'cite'); os.makedirs(out, exist_ok=True)
src = open(T, encoding='utf8').read()
SITE_EXPR = ("      `${f.doc}:${f.line} ${refKey(f)}`;",
             "    const seen = new Set([...audit(realCorpus()).failures, ...filesAudit(realCorpus()).failures].map(site));")
for expr in SITE_EXPR:
    assert src.count(expr) == 1, f'the site-level expression changed in the test; update this probe: {expr}'
ROW_ANCHOR = "    expect(r.failures.map(refKey), 'a `|` row stopped naming what the ROW quotes — re-measure')"
BYFILE_ANCHOR = "    expect(byFile, 'the citation debt moved"

def probed(dump):
    t = src
    for a in (ROW_ANCHOR, BYFILE_ANCHOR):
        assert t.count(a) == 1, f'probe anchor not unique: {a[:50]}'
    t = t.replace(BYFILE_ANCHOR,
        f"    fs.writeFileSync({json.dumps(dump + '/byfile.json')}, JSON.stringify({{ byFile, "
        "sites: r.failures.map((f) => `${f.doc}:${f.line} ${refKey(f)}`) }));\n" + BYFILE_ANCHOR)
    t = t.replace(ROW_ANCHOR,
        f"    fs.writeFileSync({json.dumps(dump + '/rows.json')}, JSON.stringify(r.failures.map(refKey)));\n"
        "    { const site = (f: { doc: string; line: number; file: string; from: number; to: number }): string =>\n"
        f"{SITE_EXPR[0]}\n{SITE_EXPR[1]}\n"
        f"    fs.writeFileSync({json.dumps(dump + '/sites.json')}, "
        "JSON.stringify(r.failures.map(site).filter((k) => seen.has(k)))); }\n" + ROW_ANCHOR)
    return t

def measure(label):
    dump = os.path.join(out, label); os.makedirs(dump, exist_ok=True)
    for f in ('byfile.json', 'rows.json', 'sites.json'):
        if os.path.exists(os.path.join(dump, f)): os.remove(os.path.join(dump, f))
    open(T, 'w', encoding='utf8').write(probed(dump))
    try:
        subprocess.run(['./node_modules/.bin/vitest', 'run', 'test/session-hook.test.ts', '-t',
                        'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND'],
                       cwd='server', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=580)
    finally:
        open(T, 'w', encoding='utf8').write(src)
    b = json.load(open(os.path.join(dump, 'byfile.json')))
    return (b['byFile'], b['sites'], json.load(open(os.path.join(dump, 'rows.json'))),
            json.load(open(os.path.join(dump, 'sites.json'))))

saved = {p: open(p, encoding='utf8').read() for p in FILES}
try:
    for p in saved:
        open(p, 'w', encoding='utf8').write(
            subprocess.run(['git', 'show', f'{base}:{p}'], capture_output=True, text=True, check=True).stdout)
    B = measure('base')
finally:
    for p, body in saved.items(): open(p, 'w', encoding='utf8').write(body)
for p, body in saved.items():
    assert open(p, encoding='utf8').read() == body, f'{p} was not restored byte-for-byte'
N = measure('tree')
assert open(T, encoding='utf8').read() == src, 'the test file was not restored byte-for-byte'

ENTRY = re.compile(r"^        '[^']*',$")
def array_block(text, head):
    i = text.index(head); j = text.index('.toEqual([', i); k = text.index('\n      ]);', j)
    lines = text[j:k].split('\n')
    idx = [n for n, l in enumerate(lines) if ENTRY.match(l)]
    assert idx and idx == list(range(idx[0], idx[-1] + 1)), f'the array under {head[:40]} is not one contiguous run; edit by hand'
    s = j + sum(len(l) + 1 for l in lines[:idx[0]])
    return s, s + sum(len(l) + 1 for l in lines[idx[0]:idx[-1] + 1]) - 1
def stated(head):
    s, e = array_block(src, head)
    return re.findall(r"^\s+'([^']*)',$", src[s:e], re.M)
def moved(a, b):
    ca, cb = collections.Counter(a), collections.Counter(b)
    return sorted((cb - ca).elements()), sorted((ca - cb).elements())

ROW_HEAD = "expect(r.failures.map(refKey), 'a `|` row stopped naming"
SITE_HEAD = "expect(r.failures.map(site).filter((k) => seen.has(k)),"
by, total = N[0], sum(N[0].values())
stated_total = re.search(r"this is it'\)\.toBe\((\d+)\);", src).group(1)
print(f"files swapped to {base}: {', '.join(FILES)}")
for key in sorted(set(B[0]) | set(by)):
    m = re.search(r"^      '" + re.escape(key) + r"': (\d+),$", src, re.M)
    flag = '' if (m and int(m.group(1)) == B[0].get(key) == by.get(key)) else '   <-- MOVED or unstated'
    print(f"byFile[{key!r}]  stated {m.group(1) if m else '-'}  base {B[0].get(key)}  tree {by.get(key)}{flag}")
print(f"total              stated {stated_total}  base {sum(B[0].values())}  tree {total}")
e, l = moved(B[1], N[1]); print(f"byFile composition  ENTERED {e}\n                    LEFT    {l}")
for name, head, bv, nv in (('row array', ROW_HEAD, B[2], N[2]), ('site array', SITE_HEAD, B[3], N[3])):
    e, l = moved(bv, nv)
    print(f"{name}: stated {len(stated(head))}  base {len(bv)}  tree {len(nv)}\n    ENTERED {e}\n    LEFT    {l}")
if write:
    t = src
    t = re.sub(r"^(      'ccd/ccd': )\d+,$", lambda m: f"{m.group(1)}{by['ccd/ccd']},", t, count=1, flags=re.M)
    t = re.sub(r"(this is it'\)\.toBe\()\d+(\);)", lambda m: f"{m.group(1)}{total}{m.group(2)}", t, count=1)
    for head, got in ((ROW_HEAD, N[2]), (SITE_HEAD, N[3])):
        s, e2 = array_block(t, head)
        t = t[:s] + '\n'.join(f"        '{v}'," for v in got) + t[e2:]
    open(T, 'w', encoding='utf8').write(t)
    print('rewrote the four literals from the instrument; now write the S6-R11 composition comment by hand')
```

**The procedure, per task that edits a cited file** (Tasks 2, 3, 4 and 5 restate it):

1. `SCRATCH=<abs path>; python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD --files ccd/session-hook.sh,ccd/ccrc,README.md` — read-only; it runs only the citation cases, twice. **If any `base` value differs from its `stated` value, the tree was red before your edit: stop and report it.**
2. Expected: every `byFile` line `stated N  base N  tree N` with no `<-- MOVED`, `total stated 195 base 195 tree 195`, and `ENTERED []` / `LEFT []` three times. If anything moved, your insertion landed above a frozen anchor: find out why before going on — the fix is to move the insertion, and only if it cannot move is the census re-measured (`--write`) with an S6-R11 composition comment.
3. Run the seven citation cases: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'` → `7 passed | 326 skipped (333)`.
4. **Both corpus documents must be byte-identical to `origin/main`:**

       git fetch origin main && git diff --quiet origin/main -- \
         docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
         docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen

   Expected: `corpus-frozen`.

## The mutation tables, mechanised

Every task's mutation table is also given as JSON rows for this runner. Write it once into your scratchpad (never committed). It copies the file ASIDE into the scratchpad (never `git checkout --`, which restores to HEAD and eats uncommitted work; never beside the file — Pre-flight finding 10), applies one exact replacement (refusing an `old` that is not unique), runs the named test files from `server/`, prints the failing titles and first assertion lines, restores the copy and asserts byte-equality.

- [ ] **Write the runner** to `$SCRATCH/mutate.py`:

```python
#!/usr/bin/env python3
"""Mutation runner for the land-w1 prototype. Run from the worktree root.

usage: mutate.py <spec.json>
spec.json: [{"id": "W1", "file": "rel/path", "old": "...", "new": "...", "tests": ["test/x.test.ts"], "restamp": false}]
Each row: copy the file aside (a COPY, never a checkout), replace exactly one
occurrence of `old` with `new`, run vitest on the named files (from server/),
print the failing test names and the first assertion lines, restore the copy,
and assert byte-equality after restore.
"""
import json, os, re, shutil, subprocess, sys

ROOT = os.getcwd()
spec = json.load(open(sys.argv[1]))
only = set(sys.argv[2:])
for row in spec:
    if only and row['id'] not in only:
        continue
    path = os.path.join(ROOT, row['file'])
    backup = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mutbak-' + row['id'])
    shutil.copy2(path, backup)
    orig = open(path, 'rb').read()
    try:
        text = orig.decode('utf8')
        n = text.count(row['old'])
        if n != 1:
            print(f"== {row['id']}: SKIPPED — `old` occurs {n} times in {row['file']}")
            continue
        open(path, 'w', encoding='utf8').write(text.replace(row['old'], row['new'], 1))
        if row.get('restamp'):
            subprocess.run(['node', '--input-type=module', '-e',
                "import { readFileSync, writeFileSync } from 'node:fs';"
                "const { markGenerated } = await import('./shared/mark.mjs');"
                "writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"], check=True)
        r = subprocess.run(['./node_modules/.bin/vitest', 'run', '--maxWorkers=2', *row['tests']],
                           cwd=os.path.join(ROOT, 'server'), capture_output=True, text=True, timeout=590)
        out = r.stdout + r.stderr
        out = re.sub(r'\x1b\[[0-9;]*m', '', out)
        fails = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL ')]
        errs = [l.strip() for l in out.splitlines() if re.match(r'\s*(AssertionError|Error|TypeError):', l)]
        tot = [l.strip() for l in out.splitlines() if l.strip().startswith('Tests ')]
        print(f"== {row['id']}: {row['file']}  rc={r.returncode}  {tot[-1] if tot else ''}")
        for f in fails[:8]:
            print('   ', f[:260])
        for e in errs[:4]:
            print('   ', e[:300])
    finally:
        shutil.copy2(backup, path)
        os.remove(backup)
        assert open(path, 'rb').read() == orig, f'{path} was not restored byte-for-byte'
print('all restored')
```

Use: write a task's rows to `$SCRATCH/mut-<task>.json`, then from the worktree root `python3 "$SCRATCH/mutate.py" "$SCRATCH/mut-<task>.json"` (optionally followed by row ids). One vitest process at a time, in the foreground. After the run, `git status --short` must list exactly the files the task changed.

---

### Task 1: The instrument, and the three prerequisites it measures

**Model routing:** `sonnet`, effort `high` for Steps 1–5 (code from a spec'd plan); the measurement Steps 6–10 are the same session, read-only.

**Files:**
- Create: `deploy/measure-landing.py`
- Test: `server/test/measure-landing.test.ts` (new)

**Interfaces:**
- Consumes: `gh` (the host's, GET only), `git` object reads in a local checkout, `$HOME/.claude*/projects/**/*.jsonl`, `$HOME/.cc-sessions/<id>.workdir` (read), `~/.local/bin/ccrc-api runs list [--closed 1]` and `mail list --to <id> --all 1 --limit 500` (both GET; `_api` refuses every other verb).
- Produces: `python3 deploy/measure-landing.py <subcommand> …` → one JSON report per run under `--out`, its summary on stdout. Subcommands: `required`, `main-red`, `absorptions`, `remerge`, `episodes`, `mail-latency`, `green-to-merge`, `inversions`; `absorptions` and `inversions` REQUIRE `--fleet-login` (the ruled pair). Later waves re-run it for their own rows of spec §10's table (stage 2: `green-to-merge`, `main-red`, `inversions`; stage 5: `inversions`), every fleet-scoped run with the same `--fleet-login` pair the baseline used; the three prerequisite numbers go to the coordinator for the programme ledger. The `GH_UPDATE` label and the `UPD` regex are one of the two spellings Task 6's absence pin licenses, line for line.

- [ ] **Step 1: Write the failing test**

Create `server/test/measure-landing.test.ts`:

```ts
// `deploy/measure-landing.py` — the landing-order programme's instrument
// (spec 2026-09-23 §10). It runs by hand on the fleet box, where the host `gh`
// carries a repo-WRITE token, so the property that matters most is the one it
// states first: it READS. Two halves pin that, and neither trusts the other:
// the static half reads the file's own argv literals; the behavioural half runs
// a subcommand against a recording `gh` stub and reads what was actually asked.
// The same two halves hold its second door, `~/.local/bin/ccrc-api`, whose
// table also carries POST rows: only `runs list` and `mail list` may pass.
// The rest pins the pure decisions every baseline number is derived from, each
// by a case that goes red when its rule is bent (the plan's mutation table).
//
// Every python3 spawn carries PYTHONDONTWRITEBYTECODE: loading the tool as a
// module would otherwise leave `deploy/__pycache__/` behind (gitignored, but a
// directory walk of `deploy/` would read it — the ccgpt harness's precedent).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.resolve(here, '..', '..', 'deploy', 'measure-landing.py');
const src = readFileSync(TOOL, 'utf8');
const PYENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
const LOAD = [
  'import importlib.util, json, sys',
  `s = importlib.util.spec_from_file_location("ml", ${JSON.stringify(TOOL)})`,
  'm = importlib.util.module_from_spec(s); s.loader.exec_module(m)',
];

/** Evaluate one Python expression against the imported module `m`, with `a`
 *  bound to the JSON argument, and return its JSON value. The module is
 *  loaded by path (its name has a hyphen) and its `main` never runs. */
const py = (expr: string, a: unknown = null): any => {
  const code = [...LOAD, 'a = json.loads(sys.stdin.read())', `print(json.dumps(${expr}))`].join('\n');
  const r = spawnSync('python3', ['-c', code], { input: JSON.stringify(a), encoding: 'utf8', env: PYENV });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
};

/** A fixture HOME whose PATH starts with a recording `gh` (the given case arms)
 *  and whose `~/.local/bin/ccrc-api` records too. Nothing real is reachable. */
const stubHome = (ghCases: string[] = [], apiCases: string[] = []): { home: string; env: NodeJS.ProcessEnv } => {
  const home = mkTmp('ccrc-measure-landing-');
  const bin = join(home, 'bin');
  const local = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(local, { recursive: true });
  writeFileSync(join(bin, 'gh'), ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$HOME/gh-calls"',
    'case "$*" in', ...ghCases, '  *) echo \'{}\' ;;', 'esac'].join('\n') + '\n', { mode: 0o755 });
  writeFileSync(join(local, 'ccrc-api'), ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$HOME/api-calls"',
    'case "$*" in', ...apiCases, '  *) echo \'{}\' ;;', 'esac'].join('\n') + '\n', { mode: 0o755 });
  return { home, env: { ...PYENV, HOME: home, PATH: `${bin}:${process.env['PATH'] ?? ''}` } };
};
const calls = (home: string, file: string): string[] | null =>
  existsSync(join(home, file)) ? readFileSync(join(home, file), 'utf8').trim().split('\n') : null;
const tool = (h: { home: string; env: NodeJS.ProcessEnv }, args: string[]) =>
  spawnSync('python3', [TOOL, ...args, '--out', join(h.home, 'out')], { encoding: 'utf8', cwd: h.home, env: h.env });
const inModule = (h: { home: string; env: NodeJS.ProcessEnv }, stmt: string) =>
  spawnSync('python3', ['-c', [...LOAD, stmt].join('\n')], { encoding: 'utf8', env: h.env });

describe('measure-landing: it reads GitHub and never writes it', () => {
  it('runs gh from exactly one argv, and that argv is a GET', () => {
    const argv = [...src.matchAll(/subprocess\.run\(\[\s*'gh'[^\]]*\]/g)].map((m) => m[0]);
    expect(argv, 'gh is run from more or fewer than one place').toHaveLength(1);
    expect(argv[0]).toBe("subprocess.run(['gh', 'api', '-X', 'GET', path]");
    expect(src, 'a second method is spelled somewhere').not.toMatch(/'(POST|PUT|PATCH|DELETE)'|--method|--field|'-f'|'-F'/);
  });

  it('runs git for object reads only — cat-file and show', () => {
    const verbs = [...src.matchAll(/\['git', '-C', clone, '([a-z-]+)'/g)].map((m) => m[1]);
    expect(new Set(verbs)).toEqual(new Set(['cat-file', 'show']));
    expect(src.match(/subprocess\.run\(\['git'/g) ?? [], 'git is run outside the -C clone form').toHaveLength(verbs.length);
  });

  it('refuses a path that is not a plain REST read, before gh runs', () => {
    const h = stubHome();
    for (const bad of ['-X POST repos/o/r/pulls/1/merge', 'repos/o/r/pulls/1 --method PUT', 'graphql', '/repos/o/r']) {
      const r = inModule(h, `m._gh(${JSON.stringify(bad)})`);
      expect(r.status, `${bad} was not refused`).not.toBe(0);
      expect(r.stderr).toContain('refused a GitHub path');
    }
    expect(calls(h.home, 'gh-calls'), 'gh ran for a refused path').toBeNull();
  });

  it('asks GitHub only GETs, measured through a recording stub', () => {
    const h = stubHome([
      '  *rules/branches/main*) echo \'[{"type":"required_status_checks","parameters":{"required_status_checks":[{"context":"test (server)"}]}}]\' ;;',
      '  *required_status_checks*) echo \'{"contexts":["build-pwa"]}\' ;;',
    ]);
    const r = tool(h, ['required', 'o/r']);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).required).toEqual(['build-pwa', 'test (server)']);
    expect(calls(h.home, 'gh-calls')).toEqual([
      'api -X GET repos/o/r/rules/branches/main',
      'api -X GET repos/o/r/branches/main/protection/required_status_checks',
    ]);
  });

  it('reaches ccrc-api from one door, for its two list verbs only (static and behavioural)', () => {
    // The client's table carries POST rows (runs close, mail send, ledger
    // allocate); a hand-run instrument that reached one would write the
    // coordination store. Every `_api(` call site names a list verb, and the
    // door itself refuses anything else before the client runs.
    const sites = [...src.matchAll(/_api\('([a-z]+)', '([a-z-]+)'/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(new Set(sites)).toEqual(new Set(['runs list', 'mail list']));
    expect(src.match(/_api\(/g)!.length - 1, 'an _api call site names its verb some other way').toBe(sites.length);
    const h = stubHome();
    for (const bad of ["'runs', 'close', '7'", "'mail', 'send', '--json', '-'", "'ledger', 'allocate'"]) {
      const r = inModule(h, `m._api(${bad})`);
      expect(r.status, `_api(${bad}) was not refused`).not.toBe(0);
      expect(r.stderr).toContain('refused a ccrc-api verb that is not a list read');
    }
    expect(calls(h.home, 'api-calls'), 'ccrc-api ran for a refused verb').toBeNull();
  });
});

describe('measure-landing: an input it could not read is never a number', () => {
  it('required: refuses a repository whose required contexts read as nothing, and caches nothing', () => {
    // Both endpoints answer, and neither names a context (or both fail): an
    // empty set would make every later verdict green, and a cached one would
    // make it so on every re-run.
    const h = stubHome(['  *rules/branches/main*) echo \'[]\' ;;']);
    const r = tool(h, ['required', 'o/r']);
    expect(r.status, 'an empty required set was accepted').not.toBe(0);
    expect(r.stderr).toContain('no required status context could be read');
    expect(existsSync(join(h.home, 'out', 'cache', 'required-o_r.json')), 'the empty read was cached').toBe(false);
  });

  it('absorptions: refuses a run with no --fleet-login before it reads anything', () => {
    const h = stubHome();
    const r = tool(h, ['absorptions', 'o/r']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('--fleet-login L1,L2 is required');
    expect(calls(h.home, 'gh-calls'), 'gh ran before the fleet was named').toBeNull();
  });

  it('mail-latency: a full newest-first page is truncation, never data; a run with no claimant is skipped', () => {
    const at = Date.parse('2026-09-10T12:00:00Z');
    const row = (i: number) => ({ at: at + i, state: 'delivered' });
    const full = JSON.stringify({ ok: true, mail: Array.from({ length: 500 }, (_, i) => row(i)) });
    const one = JSON.stringify({ ok: true, mail: [row(0)] });
    const h = stubHome([], [
      '  *"runs list"*) echo \'{"ok":true,"runs":[{"claimedBy":null},{"claimedBy":"coord-full"},{"claimedBy":"coord-one"}]}\' ;;',
      `  *"--to coord-full"*) echo '${full}' ;;`,
      `  *"--to coord-one"*) echo '${one}' ;;`,
    ]);
    const r = tool(h, ['mail-latency']);
    expect(r.status, r.stderr).toBe(0);
    const d = JSON.parse(r.stdout);
    expect(d.coordinators, 'a null claimant was counted as a coordinator').toBe(2);
    expect(d.truncatedCoordinators, 'a full page was read as the whole history').toBe(1);
    expect(d.unmatched, "the truncated coordinator's mail was counted").toBe(1);
    expect(calls(h.home, 'api-calls')!.filter((c) => c.startsWith('mail list'))
      .every((c) => c.endsWith('--limit 500')), 'a mail read asked for the default page').toBe(true);
  });
});

describe('measure-landing: the decisions every baseline is derived from', () => {
  const C = (name: string, conclusion: string | null, completed_at = '2026-09-10T00:00:00Z') =>
    ({ name, conclusion, completed_at });

  it('required_state: green, red, and the unmeasured middle — a cancel is not a red, a re-run supersedes', () => {
    expect(py('m.required_state(a, ["build","test"])', [C('build', 'success'), C('test', 'success')])).toBe('green');
    expect(py('m.required_state(a, ["build","test"])', [C('build', 'success'), C('test', 'failure')])).toBe('red');
    expect(py('m.required_state(a, ["build","test"])', [C('build', 'success'), C('test', 'cancelled')])).toBe('unmeasured');
    expect(py('m.required_state(a, ["build","test"])', [C('build', 'success')])).toBe('unmeasured');
    expect(py('m.required_state(a, ["build","test"])', [C('build', 'success'), C('test', 'failure'),
      C('mac', 'failure'), C('test', 'success', '2026-09-10T01:00:00Z')]), 'the re-run is the verdict').toBe('green');
    expect(py('m.required_state(a, [])', [C('x', 'failure')]), 'no required context is not a verdict').toBe('unmeasured');
  });

  it('red_intervals: opens on red, closes only on green, and an open one ends at the window', () => {
    expect(py('m.red_intervals([tuple(x) for x in a], "END")', [
      ['t1', 'red'], ['t2', 'unmeasured'], ['t3', 'red'], ['t4', 'green'], ['t5', 'green'], ['t6', 'red'],
    ])).toEqual([['t1', 't4'], ['t6', 'END']]);
  });

  it("merge_of_main: a merge of the PR's own branch is not one; update-branch and a local merge are told apart", () => {
    const commit = (msg: string, p2: string, committer = 'dev', login: string | null = 'dev') => ({
      parents: [{ sha: 'p1' }, { sha: p2 }],
      commit: { message: msg, committer: { name: committer }, author: { name: 'dev' } },
      committer: login ? { login } : null, author: { login: 'dev' },
    });
    const own = ['p1', 'own2'];
    expect(py('m.merge_of_main(a[0], set(a[1]))', [commit("Merge remote-tracking branch 'origin/main' into ws/x", 'main9'), own])).toBe('local');
    expect(py('m.merge_of_main(a[0], set(a[1]))', [commit("Merge branch 'main' into ws/x", 'main9', 'GitHub', 'web-flow'), own])).toBe('update-branch');
    expect(py('m.merge_of_main(a[0], set(a[1]))', [commit("Merge remote-tracking branch 'origin/main' into ws/x", 'own2'), own]),
      'the second parent is the PR\'s own commit').toBeNull();
    expect(py('m.merge_of_main(a[0], set(a[1]))', [commit("Merge branch 'feature/y' into ws/x", 'other'), own])).toBeNull();
  });

  it('repeat_share: every merge past a PR\'s first is a repeat', () => {
    expect(py('m.repeat_share(a)', [1, 1, 2, 3, 3, 3])).toEqual([6, 3, 3]);
  });

  it('fleet_logins: the fleet is a set, from the list the operator names', () => {
    expect(py('sorted(m.fleet_logins({"fleet-login": a}))', 'fleet-a,fleet-b')).toEqual(['fleet-a', 'fleet-b']);
  });

  it('sync_kind: the transcript classifier, including the probe and the aborts it must not count', () => {
    const k = (cmd: string): unknown => py('m.sync_kind(a)', cmd);
    expect(k('git merge origin/main')).toBe('merge');
    expect(k('git pull --rebase origin main')).toBe('pull');
    expect(k('git merge --no-commit --no-ff origin/main')).toBe('probe');
    expect(k('gh pr update-branch 12')).toBe('update-branch');
    expect(k('git merge --abort')).toBeNull();
    expect(k('git merge-tree --write-tree HEAD origin/main')).toBeNull();
  });

  it('episode_class: conflict first, then ritual only when nothing was edited and no agent ran', () => {
    expect(py('m.episode_class(a)', { conflict: true, edits: 0, agents: 0 })).toBe('conflict');
    expect(py('m.episode_class(a)', { conflict: false, edits: 0, agents: 0 })).toBe('ritual');
    expect(py('m.episode_class(a)', { conflict: false, edits: 2, agents: 0 })).toBe('mixed');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/measure-landing.test.ts`

Expected: FAIL — `Test Files 1 failed (1)`, `Tests no tests`, on `Error: ENOENT: no such file or directory, open '…/deploy/measure-landing.py'` (the module reads the tool at import).

- [ ] **Step 3: Write the instrument**

Create `deploy/measure-landing.py` (mode 0644 — it is run as `python3 deploy/measure-landing.py`, never installed):

```python
#!/usr/bin/env python3
"""measure-landing.py — the landing-order programme's instrument (spec 2026-09-23 §10).

READ-ONLY, and run by hand on the fleet box. It reads, and never writes, four things:
  * GitHub, through `gh api -X GET` only. `_gh` is the ONE place this file runs gh,
    and it refuses any path that tries to smuggle a method or a flag in
    (`server/test/measure-landing.test.ts` pins both, reading this file's argv
    and running a subcommand against a recording `gh` stub);
  * git objects in a local checkout (`cat-file -e`, `show --remerge-diff`), never a ref;
  * Claude Code transcripts, `$HOME/.claude*/projects/**/*.jsonl`;
  * the ccrc server, through `~/.local/bin/ccrc-api`'s two list verbs (both GET).
    `_api` is the ONE place this file runs that client, and it refuses any verb
    but `runs list` and `mail list` before the client runs (the client also
    carries POST rows — close, send, allocate — and none may be reached from here).
It writes only under --out (default ./landing-measure/): a cache of what it read,
and one JSON report per subcommand, whose summary it also prints.

WHO "THE FLEET" IS. Spec §4: one UNIX user and ONE GitHub login — but a
worktree left on a placeholder git identity committed under that identity's
login instead, so "the fleet" is a SET, and the set is RULED (spec §10): the
fleet's gh login plus the placeholder identity fleet worktrees committed under
before the 2026-09-23 identity rule. `absorptions` and `inversions` REQUIRE it
as --fleet-login L1,L2 — there is no default, so every stage-1 re-measurement
names the same pair the baseline did. No login is ever written into this file
(topology-clean), and every fleet-scoped count below is "actor in that set";
`absorptions` prints the identity census the set is chosen from.

Each subcommand ports an instrument archived beside the spec's brainstorm
transcript (`landing-baseline/`, 2026-09-22). The archive itself is NOT
committed: every one of those scripts hard-codes a scratch directory under an
operator's home, the organisations' names or the fleet's login. The logic is
ported here with those inputs made arguments; each docstring names what it ports.

usage: measure-landing.py <subcommand> [args] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--out DIR]
  required       OWNER/REPO
  main-red       OWNER/REPO [--required a,b,..]
  absorptions    OWNER/REPO --fleet-login L1,L2,..
  remerge        OWNER/REPO --clone DIR
  episodes       [--project NAME ...]
  mail-latency
  green-to-merge OWNER/REPO [--required a,b,..]
  inversions     OWNER/REPO --fleet-login L1,L2,.. [--required a,b,..]
The window defaults to the frozen baseline, 2026-09-08..2026-09-22 inclusive.
"""
import collections, glob, json, os, re, statistics, subprocess, sys, time
from datetime import datetime, timezone, timedelta

BASELINE = ('2026-09-08', '2026-09-22')
RED = ('failure', 'timed_out')


def P(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


# ── the one door to GitHub ──────────────────────────────────────────────────
GH_PATH = re.compile(r'^(user|repos/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(/[A-Za-z0-9._/-]*)?)(\?[A-Za-z0-9._=&%:+-]*)?$')


def _gh(path):
    """GET one GitHub REST path and return its JSON. GET is not a default here, it
    is the only method this file can express: the argv is fixed, and a path that
    carries anything but a REST path and a query string is refused before gh runs."""
    if not GH_PATH.match(path):
        raise SystemExit(f'measure-landing: refused a GitHub path that is not a plain REST read: {path!r}')
    for attempt in range(4):   # a 5xx is GitHub's, and it passes; anything else is an answer
        r = subprocess.run(['gh', 'api', '-X', 'GET', path], capture_output=True, text=True, timeout=60)
        if r.returncode == 0:
            return json.loads(r.stdout)
        if 'HTTP 5' not in r.stderr:
            break
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'gh api {path}: {r.stderr.strip()[:200]}')


def _pages(path, key=None, stop=None):
    """Every page of a list endpoint (`per_page=100`), optionally the list under
    `key`, stopping early once `stop(item)` is true for the last item of a page."""
    out, page = [], 1
    sep = '&' if '?' in path else '?'
    while True:
        d = _gh(f'{path}{sep}per_page=100&page={page}')
        items = d.get(key, []) if key else d
        out.extend(items)
        if len(items) < 100 or (stop and items and stop(items[-1])):
            return out
        page += 1


class Cache:
    """Every read, keyed and kept under --out, so a re-run after a failure costs
    nothing already paid and the report can be re-derived from what was read."""
    def __init__(self, out):
        self.dir = os.path.join(out, 'cache'); os.makedirs(self.dir, exist_ok=True)

    def get(self, key, fn):
        f = os.path.join(self.dir, re.sub(r'[^A-Za-z0-9._-]', '_', key) + '.json')
        if os.path.exists(f):
            return json.load(open(f))
        v = fn()
        json.dump(v, open(f + '.tmp', 'w')); os.replace(f + '.tmp', f)
        return v


# ── pure decisions (tested directly by measure-landing.test.ts) ──────────────
def required_state(checks, required):
    """One commit's REQUIRED verdict from its check-runs, each context judged by
    its LATEST attempt (a re-run that went green supersedes the red it re-ran):
    'green' when every required context's latest attempt succeeded, 'red' when
    any one's failed or timed out, otherwise 'unmeasured' (missing, cancelled,
    still running). A cancelled leg is not a red: a runner cap cancels, it does
    not fail, and nothing about the tree is learned from it. An EMPTY required
    set is not a verdict either: every commit would read green against it
    (`set() <= anything`, `all([])`), so it answers 'unmeasured'."""
    if not required:
        return 'unmeasured'
    latest = {}
    for c in checks:
        n = c.get('name')
        if n in required and (n not in latest or (c.get('completed_at') or '') >= (latest[n].get('completed_at') or '')):
            latest[n] = c
    if any(c.get('conclusion') in RED for c in latest.values()):
        return 'red'
    if set(required) <= set(latest) and all(c.get('conclusion') == 'success' for c in latest.values()):
        return 'green'
    return 'unmeasured'


def red_intervals(pushes, end):
    """`pushes`: [(iso time, 'red'|'green'|'unmeasured'), ...] for main's pushes.
    An interval opens at the first red push and closes at the next GREEN push —
    an unmeasured push neither opens nor closes one (g15_main_red.py's rule,
    with its third state named). One still open at the window's end closes there."""
    out, start = [], None
    for t, st in sorted(pushes):
        if st == 'red' and start is None:
            start = t
        elif st == 'green' and start is not None:
            out.append((start, t)); start = None
    if start is not None:
        out.append((start, end))
    return out


MAINMSG = re.compile(r"Merge (remote-tracking )?branch '(origin/)?main'|Merge (origin/)?main\b|origin/main|"
                     r"Merge branch 'main' of|current main|latest main|merge: origin/main|Merge main", re.I)

# THE CLASSIFIER'S ONE SPELLING of GitHub's branch update (its Update branch
# button, the `gh pr` verb, the REST route): this label and UPD below are the
# only two lines of this file the executable-source absence pin licenses, and
# it pins them byte for byte. Every other line says GH_UPDATE. Neither
# calls anything: they classify commits and commands that already happened.
GH_UPDATE = 'update-branch'


def merge_of_main(commit, own):
    """g2/classify.py's rule: a commit with two parents whose SECOND parent is not
    one of the PR's own commits, and whose message names main or whose committer
    is GitHub (its Update branch writes `Merge branch 'main' into …` as GitHub).
    Returns GH_UPDATE, 'local' or None."""
    if len(commit['parents']) < 2 or commit['parents'][1]['sha'] in own:
        return None
    msg = (commit['commit']['message'] or '').split('\n')[0]
    github = commit['commit']['committer']['name'] == 'GitHub' or (commit.get('committer') or {}).get('login') == 'web-flow'
    if not (MAINMSG.search(msg) or github):
        return None
    return GH_UPDATE if github else 'local'


def merge_actor(commit, kind):
    """Who did it: the AUTHOR of a merge GitHub made (GitHub commits it on their
    behalf), the committer of a local merge."""
    if kind == GH_UPDATE:
        return (commit.get('author') or {}).get('login') or commit['commit']['author']['name']
    return (commit.get('committer') or {}).get('login') or commit['commit']['committer']['name']


def repeat_share(prs_of_merges):
    """[pr, ...] one entry per merge of main -> (merges, distinct PRs, excess):
    every merge past a PR's first is a repeat (the absorb-once tally)."""
    per = collections.Counter(prs_of_merges)
    return len(prs_of_merges), len(per), sum(n - 1 for n in per.values())


SYNC = re.compile(r"git\s+(?:-C\s+\S+\s+)?(merge|rebase|pull)\b((?:\s+-{1,2}[\w=-]+)*)\s+(origin/main|origin\s+main|main)(?![\w/.-])")
UPD = re.compile(r"gh\s+pr\s+update-branch|/update-branch\b")
PUSH = re.compile(r"git\s+(?:-C\s+\S+\s+)?push\b")


def sync_kind(cmd):
    """r2_scan4.py's classifier for one Bash command: GH_UPDATE, 'merge',
    'rebase', 'pull', 'probe' (merge --no-commit), 'ffonly', or None."""
    if UPD.search(cmd):
        return GH_UPDATE
    m = SYNC.search(cmd)
    if not m:
        return None
    flags = m.group(2) or ''
    if '--abort' in cmd[m.start():m.start() + 80] or '--continue' in flags:
        return None
    if m.group(1) == 'merge' and '--no-commit' in flags:
        return 'probe'
    if '--ff-only' in flags:
        return 'ffonly'
    return m.group(1)


def episode_class(e):
    """p_final.py's classes: B conflict, A pure ritual (no edit, no agent), C mixed."""
    if e['conflict']:
        return 'conflict'
    if e['edits'] == 0 and e['agents'] == 0:
        return 'ritual'
    return 'mixed'


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * q))] if xs else None


def summary(xs):
    return {'n': len(xs), 'median': statistics.median(xs) if xs else None, 'p90': pct(xs, 0.9),
            'max': max(xs) if xs else None}


# ── GitHub-side subcommands ─────────────────────────────────────────────────
def required_contexts(repo, cache):
    """The REQUIRED status contexts on main: the rulesets' and the classic branch
    protection's, unioned — a repository can carry either or both. NEVER EMPTY:
    a union that read nothing (both endpoints failed, or neither names a
    context) is refused rather than returned, because an empty set would make
    `required_state` — before its own guard — answer green for every commit,
    and a cached empty set would do it on every later run too."""
    def read():
        ctx = set()
        try:
            for rule in _gh(f'repos/{repo}/rules/branches/main'):
                if rule.get('type') == 'required_status_checks':
                    ctx |= {c['context'] for c in rule['parameters']['required_status_checks']}
        except RuntimeError:
            pass
        try:
            ctx |= set(_gh(f'repos/{repo}/branches/main/protection/required_status_checks').get('contexts', []))
        except RuntimeError:
            pass
        if not ctx:   # raised BEFORE Cache.get stores anything: a failed read is never cached
            raise SystemExit(f'measure-landing: {repo}: no required status context could be read on main; '
                             'pass --required a,b')
        return sorted(ctx)
    return cache.get(f'required-{repo}', read)


def runs(repo, event, win, cache, branch=None):
    q = f'repos/{repo}/actions/runs?event={event}&created={win[0]}..{win[1]}' + (f'&branch={branch}' if branch else '')
    return cache.get(f'runs-{repo}-{event}-{branch}-{win[0]}-{win[1]}', lambda: _pages(q, 'workflow_runs'))


def checks(repo, sha, cache):
    return cache.get(f'checks-{repo}-{sha}', lambda: _pages(f'repos/{repo}/commits/{sha}/check-runs', 'check_runs'))


def jobs(repo, run_id, cache):
    return cache.get(f'jobs-{repo}-{run_id}', lambda: _pages(f'repos/{repo}/actions/runs/{run_id}/jobs', 'jobs'))


def cmd_main_red(repo, required, win, cache):
    """Ports g15_main_red.py, narrowed to what spec §10 asks: red-main from the
    REQUIRED contexts only, with its PR-failure overlap — and the whole-check
    reading beside it, so the archived 111.2 h / 50-of-92 can be reproduced."""
    end = win[1] + 'T23:59:59Z'
    main = [r for r in runs(repo, 'push', win, cache, branch='main') if r.get('head_branch') == 'main']
    first_push = {}
    for r in main:
        first_push[r['head_sha']] = min(first_push.get(r['head_sha'], r['created_at']), r['created_at'])
    req, whole = [], []
    for sha, t in first_push.items():
        cs = checks(repo, sha, cache)
        req.append((t, required_state(cs, required)))
        concl = [c.get('conclusion') for c in cs]
        whole.append((t, 'red' if any(c in RED for c in concl) else
                      'green' if concl and all(c in ('success', 'skipped', 'neutral') for c in concl) else 'unmeasured'))
    req_iv, whole_iv = red_intervals(req, end), red_intervals(whole, end)
    prs = [r for r in runs(repo, 'pull_request', win, cache) if r.get('conclusion') == 'failure']
    inside = lambda t, ivs: any(s <= t <= e for s, e in ivs)
    req_fail = []
    for r in prs:
        failed = {j['name'] for j in jobs(repo, r['id'], cache) if j.get('conclusion') in RED}
        if failed & set(required):
            req_fail.append(r['created_at'])
    hours = lambda ivs: round(sum((P(e) - P(s)).total_seconds() for s, e in ivs) / 3600, 1)
    return {
        'repo': repo, 'window': win, 'required': required, 'mainPushes': len(first_push),
        'requiredUnmeasuredPushes': sum(1 for _, s in req if s == 'unmeasured'),
        'required_only': {'intervals': req_iv, 'hours': hours(req_iv),
                          'prRequiredFailures': len(req_fail),
                          'prRequiredFailuresInside': sum(1 for t in req_fail if inside(t, req_iv))},
        'whole_checks': {'intervals': whole_iv, 'hours': hours(whole_iv), 'prFailedRuns': len(prs),
                         'prFailedRunsInside': sum(1 for r in prs if inside(r['created_at'], whole_iv))},
    }


def pulls(repo, win, cache):
    """Every PR created, merged or closed inside the window (listed newest-updated
    first, stopping once a page's last PR was last updated before the window)."""
    lo = win[0] + 'T00:00:00Z'
    allp = cache.get(f'pulls-{repo}-{win[0]}-{win[1]}', lambda: _pages(
        f'repos/{repo}/pulls?state=all&sort=updated&direction=desc', stop=lambda p: p['updated_at'] < lo))
    hi = win[1] + 'T23:59:59Z'
    touch = lambda p: any(x and lo <= x <= hi for x in (p['created_at'], p.get('merged_at'), p.get('closed_at')))
    return [p for p in allp if touch(p)]


def merges_of_main(repo, win, cache):
    """Every merge of main committed inside the window on any window PR, once per
    sha (a stacked PR carries its base's merges too; the lowest PR number owns it)."""
    lo, hi = win[0] + 'T00:00:00Z', win[1] + 'T23:59:59Z'
    seen = {}
    for p in sorted(pulls(repo, win, cache), key=lambda p: p['number']):
        cs = cache.get(f'commits-{repo}-{p["number"]}', lambda: _pages(f'repos/{repo}/pulls/{p["number"]}/commits'))
        own = {c['sha'] for c in cs}
        for c in cs:
            kind = merge_of_main(c, own)
            when = c['commit']['committer']['date']
            if kind and lo <= when <= hi and c['sha'] not in seen:
                seen[c['sha']] = {'sha': c['sha'], 'pr': p['number'], 'kind': kind, 'at': when,
                                  'actor': merge_actor(c, kind), 'firstParent': c['parents'][0]['sha']}
    return list(seen.values())


def fleet_logins(args):
    """The fleet's identities, from --fleet-login a,b,… and from nowhere else.
    The set is an operator RULING (spec §10: the fleet's gh login plus the
    placeholder identity fleet worktrees committed under before the 2026-09-23
    identity rule), so there is no default to drift from it: a run without the
    argument is refused before anything is read."""
    got = set(filter(None, (args.get('fleet-login') or '').split(',')))
    if not got:
        raise SystemExit('measure-landing: --fleet-login L1,L2 is required: the fleet is the ruled set of '
                         'identities (spec §10), never a default')
    return got


def cmd_absorptions(repo, win, cache, logins):
    """Ports g2/classify.py (merges of main by kind and actor) and the
    absorb-once tally behind spec §1's 185-of-336, adding the prerequisite
    spec §10 names: the repeat share restricted to fleet committer identities.
    `identities` is the census the fleet set is chosen from: every actor, how
    many merges of main it made, and whether this run counted it as fleet."""
    ms = merges_of_main(repo, win, cache)
    local = [m for m in ms if m['kind'] == 'local']
    fleet_local = [m for m in local if m['actor'] in logins]
    t_all, t_fleet = repeat_share([m['pr'] for m in local]), repeat_share([m['pr'] for m in fleet_local])
    return {
        'repo': repo, 'window': win, 'mergesOfMain': len(ms),
        'byKindAndActor': dict(collections.Counter(
            f"{m['kind']}:{'fleet' if m['actor'] in logins else 'other'}" for m in ms)),
        'identities': {a: {'merges': n, 'fleet': a in logins}
                       for a, n in collections.Counter(m['actor'] for m in ms).most_common()},
        'fleetUpdateBranch': sum(1 for m in ms if m['kind'] == GH_UPDATE and m['actor'] in logins),
        'localAllCommitters': dict(zip(('merges', 'prs', 'repeats'), t_all)),
        'localFleet': dict(zip(('merges', 'prs', 'repeats'), t_fleet)),
        'fleetRepeatShare': round(t_fleet[2] / t_fleet[0], 3) if t_fleet[0] else None,
    }


def cmd_remerge(repo, win, cache, clone):
    """Ports g8/run_remerge.sh + classify.py and r2d_shape.py: a merge of main
    whose `--remerge-diff` is empty is one git made with no hand edit; one with a
    diff was hand-resolved, and each resolved file is a stamp, a union or a
    rewrite. A merge whose objects are not in the clone is unmeasured — this
    tool never fetches."""
    res, shapes = collections.Counter(), collections.Counter()
    for m in merges_of_main(repo, win, cache):
        if subprocess.run(['git', '-C', clone, 'cat-file', '-e', m['sha']], capture_output=True).returncode != 0:
            res['unmeasured'] += 1
            continue
        out = subprocess.run(['git', '-C', clone, 'show', '--remerge-diff', '--format=', m['sha']],
                             capture_output=True, text=True, errors='replace', timeout=120).stdout
        files, cur = {}, None
        for line in out.splitlines():
            mm = re.match(r'^diff --git a/(.*) b/', line)
            if mm:
                cur = mm.group(1); files[cur] = []
            elif cur and line[:1] in '+-' and not line.startswith(('+++', '---')):
                files[cur].append(line)
        if not files:
            res['clean'] += 1
            continue
        res['hand-resolved'] += 1
        for f, ls in files.items():
            body = [l for l in ls if not re.match(r'^[-+](<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)', l)]
            shapes['stamp' if body and all('sha256=' in l for l in body) else
                   'union' if not any(l.startswith('-') for l in body) else 'rewrite'] += 1
    return {'repo': repo, 'window': win, 'merges': dict(res), 'resolvedFileShapes': dict(shapes)}


def cmd_green_to_merge(repo, required, win, cache):
    """The wait from a merged PR's final head going green on every REQUIRED
    context to its merge (spec §10, stage 2's metric). A PR merged before its
    head was green is counted apart, never as a negative wait."""
    waits, early, unmeasured = [], 0, 0
    for p in pulls(repo, win, cache):
        if not p.get('merged_at'):
            continue
        cs = [c for c in checks(repo, p['head']['sha'], cache) if c.get('name') in required]
        if required_state(cs, required) != 'green':
            unmeasured += 1
            continue
        green = max(c['completed_at'] for c in cs if c.get('conclusion') == 'success')
        w = (P(p['merged_at']) - P(green)).total_seconds() / 60
        if w < 0:
            early += 1
        else:
            waits.append(round(w, 1))
    return {'repo': repo, 'window': win, 'minutes': summary(waits), 'mergedBeforeGreen': early,
            'headNotGreen': unmeasured}


def cmd_inversions(repo, required, win, cache, logins):
    """Ports g5_inversions.py. A is READY when its FIRST merge of main in the
    window found its head (the merge's first parent) already green on every
    required context — the sync was ritual, and A could have landed then; B is
    an inversion over A when B was open at that moment and merged after it but
    before A. Only the first merge is asked, as g5 asked only the earliest
    event: a later sync's pre-head being green says nothing about when A was
    first ready. (g5 also read force-pushes from the PR timeline; this tool
    reads commits only, so a PR whose first sync was a force-push is not
    counted — never counted wrongly. Spec §10 retires g5's figures on that
    ground: every inversion baseline is this scan's.) Reported for all actors
    and fleet-on-fleet."""
    prs = {p['number']: p for p in pulls(repo, win, cache) if p.get('merged_at')}
    first = {}
    for m in sorted(merges_of_main(repo, win, cache), key=lambda m: m['at']):
        first.setdefault(m['pr'], m)
    ready = {n: m['at'] for n, m in first.items() if n in prs
             and required_state(checks(repo, m['firstParent'], cache), required) == 'green'}
    pairs = []
    for a, t in ready.items():
        for b, pb in prs.items():
            if b != a and pb['created_at'] <= t < pb['merged_at'] <= prs[a]['merged_at']:
                pairs.append({'A': a, 'B': b, 'fleetOnFleet': prs[a]['user']['login'] in logins and pb['user']['login'] in logins})
    return {'repo': repo, 'window': win, 'readyPrs': len(ready), 'inversions': len(pairs),
            'fleetOnFleet': sum(1 for p in pairs if p['fleetOnFleet']), 'pairs': pairs}


# ── transcript-side subcommands ─────────────────────────────────────────────
def transcripts(since):
    cut = datetime.fromisoformat(since).replace(tzinfo=timezone.utc).timestamp()
    for f in glob.glob(os.path.expanduser('~/.claude*/projects/*/**/*.jsonl'), recursive=True):
        try:
            if os.stat(f).st_mtime >= cut:
                yield f
        except OSError:
            continue


def _records(path):
    with open(path, errors='replace') as fh:
        for line in fh:
            try:
                yield json.loads(line)
            except ValueError:
                continue


def scan_episodes(path, lo, hi):
    """r2_scan4.py's episode scan for one transcript: a run of sync commands opens
    an episode, the next `git push` (or the file's end) closes it, and what
    happened in between classifies it. Keyed by the FIRST sync's tool-use id."""
    uses, results, times = [], {}, []
    for d in _records(path):
        ts = d.get('timestamp'); m = d.get('message') if isinstance(d.get('message'), dict) else None
        if not ts or not m:
            continue
        t = P(ts).timestamp(); times.append(t)
        for c in (m.get('content') if isinstance(m.get('content'), list) else []):
            if not isinstance(c, dict):
                continue
            if d.get('type') == 'assistant' and c.get('type') == 'tool_use':
                inp = c.get('input') if isinstance(c.get('input'), dict) else {}
                cmd = inp.get('command') if isinstance(inp.get('command'), str) else ''
                uses.append((t, c.get('id'), c.get('name'), cmd))
            elif d.get('type') == 'user' and c.get('type') == 'tool_result':
                body = c.get('content')
                body = body if isinstance(body, str) else json.dumps(body)
                results.setdefault(c.get('tool_use_id'), (t, 'CONFLICT' in body))
    eps, cur = [], None
    for t, uid, name, cmd in sorted(uses, key=lambda u: u[0]):
        kind = sync_kind(cmd) if name == 'Bash' and cmd else None
        if kind and lo <= t <= hi:
            if cur is None:
                cur = {'key': uid, 'start': t, 'syncs': [], 'conflict': False, 'edits': 0, 'agents': 0}
            cur['syncs'].append(kind)
            cur['conflict'] |= results.get(uid, (0, False))[1]
            continue
        if cur is None:
            continue
        if name in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit'):
            cur['edits'] += 1
        if name in ('Agent', 'Task', 'Workflow'):
            cur['agents'] += 1
        if name == 'Bash' and PUSH.search(cmd) and not cmd.strip().startswith('#'):
            cur['end'] = t; eps.append(cur); cur = None
    if cur is not None:
        cur['end'] = max(times) if times else cur['start']; eps.append(cur)
    for e in eps:
        pts = sorted(x for x in times if e['start'] <= x <= e['end'])
        e['active_s'] = sum(min(b - a, 300.0) for a, b in zip(pts, pts[1:]))
        e['path'] = path
    return eps


def cmd_episodes(projects, win):
    """Ports r2_scan4.py + the dedup step + p_final.py's classes. Stage 1's
    third metric is the ritual episodes per ISO week."""
    lo = datetime.fromisoformat(win[0]).replace(tzinfo=timezone.utc).timestamp()
    hi = (datetime.fromisoformat(win[1]).replace(tzinfo=timezone.utc) + timedelta(days=1)).timestamp()
    seen, by = set(), collections.defaultdict(collections.Counter)
    hours = collections.Counter()
    for f in transcripts(win[0]):
        slug = f.split('/projects/', 1)[1].split('/')[0].lower()
        proj = next((p for p in projects if p.lower() in slug), None) if projects else slug
        if projects and proj is None:
            continue
        for e in scan_episodes(f, lo, hi):
            if e['key'] in seen:
                continue
            seen.add(e['key'])
            wk = datetime.fromtimestamp(e['start'], timezone.utc).strftime('%G-W%V')
            cls = episode_class(e)
            by[wk][cls] += 1
            hours[cls] += e['active_s'] / 3600
    return {'window': win, 'projects': projects or 'all', 'byWeek': {k: dict(v) for k, v in sorted(by.items())},
            'activeHours': {k: round(v, 1) for k, v in hours.items()}}


NUDGE = 'ccrc-mail: you have new mail.'
MAIL_PAGE = 500   # the server's own clamp (`clampMailLimit`): no read can ask for more


API_READS = (('runs', 'list'), ('mail', 'list'))


def _api(*args):
    """The ONE door to the ccrc server: `~/.local/bin/ccrc-api`, whose table also
    carries POST rows (runs close, mail send, ledger allocate). Only the two list
    verbs pass; anything else is refused before the client runs."""
    if tuple(args[:2]) not in API_READS:
        raise SystemExit(f'measure-landing: refused a ccrc-api verb that is not a list read: {" ".join(args[:2])!r}')
    r = subprocess.run([os.path.expanduser('~/.local/bin/ccrc-api'), *args], capture_output=True, text=True, timeout=60)
    return json.loads(r.stdout)


def nudge_turns(session_id):
    """The timestamps of every turn a mail nudge started in this session's
    transcripts, found through the registry's `workdir` (read only), else by the
    `-<id>` suffix Claude Code gives a worktree's project directory."""
    dirs = []
    wd = os.path.expanduser(f'~/.cc-sessions/{session_id}.workdir')
    if os.path.exists(wd):
        dirs += glob.glob(os.path.expanduser('~/.claude*/projects/') + re.sub(r'[^A-Za-z0-9]', '-', open(wd).read().strip()))
    dirs += glob.glob(os.path.expanduser(f'~/.claude*/projects/*-{session_id}'))
    out = []
    for d in set(dirs):
        for f in glob.glob(os.path.join(d, '*.jsonl')):
            for r in _records(f):
                m = r.get('message') if isinstance(r.get('message'), dict) else None
                if r.get('type') == 'user' and m and isinstance(m.get('content'), str) \
                        and m['content'].startswith(NUDGE) and r.get('timestamp'):
                    out.append(P(r['timestamp']).timestamp() * 1000)
    return sorted(out)


def cmd_mail_latency(win):
    """Spec §10's second prerequisite: for mail addressed to a coordinator, the
    time from the mail's creation to the first turn a delivery nudge started in
    that coordinator's session at or after it. Idle-gated delivery is the point:
    the wait includes the coordinator's own busy turn. A mail with no later
    nudge turn is counted as unmatched, never as zero.

    THE MAIL READ IS A PAGE, NEWEST FIRST: `mail list --to <id> --all 1` answers
    the recipient's newest deliveries (`ORDER BY d.id DESC`), 100 by default and
    MAIL_PAGE at most. A page that came back FULL may have dropped exactly the
    window's oldest mail, so that coordinator is reported `truncated` and counted
    in neither `minutes` nor `unmatched` — never as data. A page with room to
    spare is the recipient's whole history. A run with no claimant is skipped."""
    lo = datetime.fromisoformat(win[0]).replace(tzinfo=timezone.utc).timestamp() * 1000
    hi = (datetime.fromisoformat(win[1]).replace(tzinfo=timezone.utc) + timedelta(days=1)).timestamp() * 1000
    coords = sorted({r['claimedBy'] for flag in ([], ['--closed', '1'])
                     for r in _api('runs', 'list', *flag)['runs'] if r.get('claimedBy')})
    lat, unmatched, truncated, per = [], 0, 0, {}
    for c in coords:
        rows = _api('mail', 'list', '--to', c, '--all', '1', '--limit', str(MAIL_PAGE)).get('mail', [])
        if len(rows) >= MAIL_PAGE:
            truncated += 1; per[c] = {'truncated': True, 'rows': len(rows)}
            continue
        turns = nudge_turns(c)
        mine, miss = [], 0
        for m in rows:
            if not (lo <= m['at'] < hi) or m['state'] not in ('delivered', 'acked'):
                continue
            t = next((x for x in turns if x >= m['at']), None)
            if t is None:
                miss += 1
            else:
                mine.append((t - m['at']) / 60000)
        lat += mine; unmatched += miss
        per[c] = dict(summary([round(x, 1) for x in mine]), unmatched=miss, transcriptTurns=len(turns))
    return {'window': win, 'coordinators': len(coords), 'minutes': summary([round(x, 1) for x in lat]),
            'unmatched': unmatched, 'truncatedCoordinators': truncated, 'perCoordinator': per}


# ── the command line ────────────────────────────────────────────────────────
def main(argv):
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__); return 0
    sub, rest = argv[0], argv[1:]
    args, pos, i = {}, [], 0
    while i < len(rest):
        if rest[i].startswith('--'):
            k = rest[i][2:]
            if k == 'project':
                args.setdefault('project', []).append(rest[i + 1])
            else:
                args[k] = rest[i + 1]
            i += 2
        else:
            pos.append(rest[i]); i += 1
    win = (args.get('since', BASELINE[0]), args.get('until', BASELINE[1]))
    out = args.get('out', 'landing-measure')
    os.makedirs(out, exist_ok=True)
    cache = Cache(out)
    need_repo = sub not in ('episodes', 'mail-latency')
    if need_repo and (len(pos) != 1 or not re.match(r'^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$', pos[0])):
        print(f'usage: measure-landing.py {sub} OWNER/REPO …', file=sys.stderr); return 2
    repo = pos[0] if need_repo else None
    req = lambda: args['required'].split(',') if 'required' in args else required_contexts(repo, cache)
    if sub == 'required':
        rep = {'repo': repo, 'required': required_contexts(repo, cache)}
    elif sub == 'main-red':
        rep = cmd_main_red(repo, req(), win, cache)
    elif sub == 'absorptions':
        rep = cmd_absorptions(repo, win, cache, fleet_logins(args))
    elif sub == 'remerge':
        if 'clone' not in args:
            print('usage: measure-landing.py remerge OWNER/REPO --clone DIR', file=sys.stderr); return 2
        rep = cmd_remerge(repo, win, cache, args['clone'])
    elif sub == 'green-to-merge':
        rep = cmd_green_to_merge(repo, req(), win, cache)
    elif sub == 'inversions':
        rep = cmd_inversions(repo, req(), win, cache, fleet_logins(args))
    elif sub == 'episodes':
        rep = cmd_episodes(args.get('project', []), win)
    elif sub == 'mail-latency':
        rep = cmd_mail_latency(win)
    else:
        print(f'measure-landing.py: unknown subcommand {sub!r}', file=sys.stderr); return 2
    name = f"{sub}{'-' + repo.replace('/', '_') if repo else ''}-{win[0]}-{win[1]}.json"
    json.dump(rep, open(os.path.join(out, name), 'w'), indent=1)
    print(json.dumps({k: v for k, v in rep.items() if k not in ('pairs', 'perCoordinator')}, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/measure-landing.test.ts
```

Expected: PASS — `measure-landing` 15/15, and no `deploy/__pycache__/` left behind (`ls deploy/__pycache__` → `No such file or directory`; every python3 spawn carries `PYTHONDONTWRITEBYTECODE`). (`topology-clean` reads `git ls-files`, so it cannot see the new file until Step 5 adds it; it runs there, before the commit.)

- [ ] **Step 5: Mutation check, then commit**

| # | Exact edit in `deploy/measure-landing.py` | Expected red (measured) |
|---|---|---|
| I1 | `['gh', 'api', '-X', 'GET', path]` → `['gh', 'api', path]` | "runs gh from exactly one argv, and that argv is a GET" and "asks GitHub only GETs, measured through a recording stub" (2 failed) |
| I2 | `    if not GH_PATH.match(path):` → `    if False:` | "refuses a path that is not a plain REST read, before gh runs" — `-X POST repos/o/r/pulls/1/merge was not refused` |
| I3 | `elif st == 'green' and start is not None:` → `elif st != 'red' and start is not None:` | "red_intervals: opens on red, closes only on green…" — `expected [ Array(3) ] to deeply equal [ [ 't1', 't4' ], [ 't6', 'END' ] ]` |
| I4 | `RED = ('failure', 'timed_out')` → add `'cancelled'` | "required_state: …" — `expected 'red' to be 'unmeasured'` |
| I5 | drop ` or commit['parents'][1]['sha'] in own` | "merge_of_main: …" — `the second parent is the PR's own commit: expected 'local' to be null` |
| I6 | `sum(n - 1 for n in per.values())` → `sum(n for n in per.values())` | "repeat_share: …" — `expected [ 6, 3, 6 ] to deeply equal [ 6, 3, 3 ]` |
| I7 | `.split(',')` → `.split(';')` in `fleet_logins` | "fleet_logins: …" — `expected [ 'fleet-a,fleet-b' ] to deeply equal [ 'fleet-a', 'fleet-b' ]` |
| I8 | `if n in required and (n not in latest or …):` → `if n in required and n not in latest:` | "required_state: …" — `the re-run is the verdict: expected 'red' to be 'green'` |
| I9 | delete `    if not required:` / `        return 'unmeasured'` | "required_state: …" — `no required context is not a verdict: expected 'green' to be 'unmeasured'` |
| I10 | `        if not ctx:   # raised BEFORE Cache.get …` → `        if False:` | "required: refuses a repository whose required contexts read as nothing, and caches nothing" — `an empty required set was accepted: expected +0 not to be +0` |
| I11 | `    if not got:` (in `fleet_logins`) → `    if False:` | "absorptions: refuses a run with no --fleet-login before it reads anything" — `expected +0 not to be +0` |
| I12 | `        if len(rows) >= MAIL_PAGE:` → `        if False:` | "mail-latency: a full newest-first page is truncation, never data; …" — `a full page was read as the whole history: expected +0 to be 1` |
| I13 | drop ` if r.get('claimedBy')` from the coordinator set | same case — `TypeError: '<' not supported between instances of 'str' and 'NoneType'` |
| I14 | `    if tuple(args[:2]) not in API_READS:` → `    if False:` | "reaches ccrc-api from one door, for its two list verbs only…" — `_api('runs', 'close', '7') was not refused: expected +0 not to be +0` |
| I15 | `'--all', '1', '--limit', str(MAIL_PAGE))` → `'--all', '1')` | "mail-latency: …" — `a mail read asked for the default page: expected false to be true` |

Each row reds its own case alone (`1 failed | 14 passed (15)`), I1 excepted (`2 failed | 13 passed (15)`).

Rows for the runner (`$SCRATCH/mut-task1.json`):

```json
[
 {"id": "I1", "file": "deploy/measure-landing.py", "old": "subprocess.run(['gh', 'api', '-X', 'GET', path]", "new": "subprocess.run(['gh', 'api', path]", "tests": ["test/measure-landing.test.ts"]},
 {"id": "I2", "file": "deploy/measure-landing.py", "old": "    if not GH_PATH.match(path):\n", "new": "    if False:\n", "tests": ["test/measure-landing.test.ts"]},
 {"id": "I3", "file": "deploy/measure-landing.py", "old": "        elif st == 'green' and start is not None:", "new": "        elif st != 'red' and start is not None:", "tests": ["test/measure-landing.test.ts"]},
 {"id": "I4", "file": "deploy/measure-landing.py", "old": "RED = ('failure', 'timed_out')", "new": "RED = ('failure', 'timed_out', 'cancelled')", "tests": ["test/measure-landing.test.ts"]},
 {"id": "I5", "file": "deploy/measure-landing.py", "old": "    if len(commit['parents']) < 2 or commit['parents'][1]['sha'] in own:", "new": "    if len(commit['parents']) < 2:", "tests": ["test/measure-landing.test.ts"]},
 {"id": "I6", "file": "deploy/measure-landing.py", "old": "sum(n - 1 for n in per.values())", "new": "sum(n for n in per.values())", "tests": ["test/measure-landing.test.ts"]},
 {"id": "I7", "file": "deploy/measure-landing.py", "old": "(args.get('fleet-login') or '').split(',')", "new": "(args.get('fleet-login') or '').split(';')", "tests": ["test/measure-landing.test.ts"]},
 {"id": "I8", "file": "deploy/measure-landing.py", "old": "        if n in required and (n not in latest or (c.get('completed_at') or '') >= (latest[n].get('completed_at') or '')):", "new": "        if n in required and n not in latest:", "tests": ["test/measure-landing.test.ts"]},
 {"id": "I9", "file": "deploy/measure-landing.py", "old": "    if not required:\n        return 'unmeasured'\n", "new": "", "tests": ["test/measure-landing.test.ts"]},
 {"id": "I10", "file": "deploy/measure-landing.py", "old": "        if not ctx:   # raised BEFORE Cache.get stores anything: a failed read is never cached\n", "new": "        if False:\n", "tests": ["test/measure-landing.test.ts"]},
 {"id": "I11", "file": "deploy/measure-landing.py", "old": "    if not got:\n", "new": "    if False:\n", "tests": ["test/measure-landing.test.ts"]},
 {"id": "I12", "file": "deploy/measure-landing.py", "old": "        if len(rows) >= MAIL_PAGE:\n", "new": "        if False:\n", "tests": ["test/measure-landing.test.ts"]},
 {"id": "I13", "file": "deploy/measure-landing.py", "old": "for r in _api('runs', 'list', *flag)['runs'] if r.get('claimedBy')}", "new": "for r in _api('runs', 'list', *flag)['runs']}", "tests": ["test/measure-landing.test.ts"]},
 {"id": "I14", "file": "deploy/measure-landing.py", "old": "    if tuple(args[:2]) not in API_READS:\n", "new": "    if False:\n", "tests": ["test/measure-landing.test.ts"]},
 {"id": "I15", "file": "deploy/measure-landing.py", "old": "'--all', '1', '--limit', str(MAIL_PAGE))", "new": "'--all', '1')", "tests": ["test/measure-landing.test.ts"]}
]
```

```bash
git add deploy/measure-landing.py server/test/measure-landing.test.ts
(cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)   # the tool names no host, login or organisation
git commit -m "$(cat <<'MSG'
feat(deploy): measure-landing.py, the landing-order programme's instrument

Spec 2026-09-23 §10 commits the instrument with the plan so every baseline
keeps its tool. Read-only by construction: gh is run from ONE argv,
`gh api -X GET <path>`, behind a path grammar that refuses anything but a
plain REST read before gh runs; ccrc-api is run from ONE door that refuses
every verb but runs list and mail list; git reads objects only (cat-file,
show --remerge-diff); transcripts are read, never written. Eight
subcommands port the archived baseline instruments with their hard-coded
paths, organisations and the fleet's login made arguments — the archive
itself carries all three and cannot be committed (topology-clean).

An input it could not read is never a number: an empty required-context set
is refused and never cached, a full newest-first mail page is reported
truncated, a run with no claimant is skipped. The fleet is the RULED pair of
identities (spec §10), required as --fleet-login, never defaulted. The
classifier's spelling of the branch-update act is one label and one regex,
the two lines the absence pin licenses.
MSG
)"
```

- [ ] **Step 6: Set up the measurement (read-only)**

```bash
SCRATCH=<your scratchpad, absolute>
[[ "$SCRATCH" == /* && -d "$SCRATCH" ]] || echo "STOP: SCRATCH is not an absolute directory"
OUT="$SCRATCH/landing-measure"; mkdir -p "$OUT"
for p in ccrc-pwa expoAI-assistant intake-platform custom-tools data-internal MekWarLive; do
  printf '%s %s\n' "$p" "$(git -C "$HOME/projects/$p" remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"
done > "$OUT/repos.txt"
awk 'NF == 2 && $2 ~ /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/' "$OUT/repos.txt" | wc -l
gh api rate_limit --jq '.resources.core.remaining'
```

Expected: `6`, and at least `2000` remaining (the whole task spent ~1,100 GETs on the prototype; the cache under `$OUT/cache` makes every re-run free). Do not paste `repos.txt` into any report — it names organisations.

- [ ] **Step 7: Prerequisite 1 — red-main from required contexts only, with its PR-failure overlap (this repository)**

```bash
SCRATCH=<your scratchpad, absolute>; OUT="$SCRATCH/landing-measure"
R=$(awk '$1 == "ccrc-pwa" {print $2}' "$OUT/repos.txt")
python3 deploy/measure-landing.py required "$R" --out "$OUT"
python3 deploy/measure-landing.py main-red "$R" --out "$OUT" > /dev/null
python3 -c "
import json, glob
d = json.load(open(glob.glob('$OUT/main-red-*ccrc-pwa-2026-09-08-2026-09-22.json')[0]))
r, w = d['required_only'], d['whole_checks']
print('pushes', d['mainPushes'], 'unmeasured', d['requiredUnmeasuredPushes'])
print('required-only:', len(r['intervals']), 'intervals', r['hours'], 'h;', r['prRequiredFailuresInside'], 'of', r['prRequiredFailures'], 'PR runs with a required-job failure inside')
print('whole-check:  ', len(w['intervals']), 'intervals', w['hours'], 'h;', w['prFailedRunsInside'], 'of', w['prFailedRuns'], 'failed PR runs inside')"
```

Expected (measured 2026-09-23): `required` → `build-pwa`, `test (agent)`, `test (pwa)`, `test (server)`; `pushes 83 unmeasured 0`; `required-only: 5 intervals 9.0 h; 17 of 39 …`; `whole-check: 10 intervals 120.7 h; 53 of 91 …`. If `required` exits 1 with `no required status context could be read on main`, neither endpoint named a context: that is an answer about the repository, not a zero — report it, and pass `--required a,b` only if the operator names the set.

- [ ] **Step 8: Prerequisite 2 — coordinator mail latency (creation to the first nudge-started turn)**

```bash
SCRATCH=<your scratchpad, absolute>; OUT="$SCRATCH/landing-measure"
python3 deploy/measure-landing.py mail-latency --out "$OUT" > /dev/null
python3 -c "
import json
d = json.load(open('$OUT/mail-latency-2026-09-08-2026-09-22.json'))
print('coordinators', d['coordinators'], 'minutes', d['minutes'], 'unmatched', d['unmatched'], 'truncated', d['truncatedCoordinators'])
for i, v in enumerate(d['perCoordinator'].values()):
    print('  coordinator', i, v)"
```

Expected: the planning run (2026-09-23) read each coordinator's mail with the route's DEFAULT page of 100 and measured `coordinators 11`, minutes `n 276, median 0.6, p90 158.9, max 1700.6`, `unmatched 92` — every unmatched mail belonging to a coordinator with `transcriptTurns 0` (three of them: 73, 17 and 2 mails), a transcript directory the tool could not find, never a zero latency. That run could not see mail past each coordinator's newest 100 (Pre-flight finding 15), so its `n` is a floor, not the baseline: YOUR run, with `--limit 500`, is the baseline. Expect `n` at or above 276 and `truncated 0`; a coordinator reported `{'truncated': True, 'rows': 500}` had more than 500 deliveries and is counted in neither figure — report it by index, never as data. The per-coordinator lines are anonymised by index on purpose. What it measures: mail creation (`at`) to the first turn a delivery nudge (`ccrc-mail: you have new mail.`) started in that coordinator's session at or after it — idle-gated delivery included. The server's own `ingestedAt` column is the exact edge but lives in `coord.db` on the server box and is not on the wire; this is the fleet-box measurement of the same interval (spec §10).

- [ ] **Step 9: Prerequisite 3 — repeat absorptions over the RULED fleet identities, per PR and per merge, and stage 1's three baselines**

The fleet is the pair (spec §10, Pre-flight finding 7): the fleet's gh login plus the placeholder identity fleet worktrees committed under before the 2026-09-23 identity rule. The placeholder's login is DATA — read it from a census run, never type it into a file. First the census, with the login alone (`--fleet-login` is required, so the census names it):

```bash
SCRATCH=<your scratchpad, absolute>; OUT="$SCRATCH/landing-measure"
ME="$(gh api user --jq .login)"
while read -r p r; do
  python3 deploy/measure-landing.py absorptions "$r" --out "$OUT" --fleet-login "$ME" > "$OUT/abs-login-$p.json" || echo "FAILED $p"
done < "$OUT/repos.txt"
python3 -c "
import json
d = json.load(open('$OUT/abs-login-ccrc-pwa.json'))
for i, (k, v) in enumerate(d['identities'].items()):
    print(i, 'fleet' if v['fleet'] else 'other', v['merges'])"
```

Expected: the identity census for this repository, by index — on the planning run one non-fleet identity carried 38 merges, the placeholder. Take its login from `abs-login-ccrc-pwa.json` (`identities`, the entry with that count) into a shell variable, never into a file, and run THE baseline with the pair:

```bash
SCRATCH=<your scratchpad, absolute>; OUT="$SCRATCH/landing-measure"
FLEET="$(gh api user --jq .login),<the placeholder identity's login, from the census>"
while read -r p r; do
  python3 deploy/measure-landing.py absorptions "$r" --out "$OUT" --fleet-login "$FLEET" > "$OUT/abs-$p.json" || echo "FAILED $p"
done < "$OUT/repos.txt"
for K in abs abs-login; do python3 -c "
import json
M = R = U = P = 0
for p in ['ccrc-pwa','expoAI-assistant','intake-platform','custom-tools','data-internal','MekWarLive']:
    d = json.load(open('$OUT/$K-' + p + '.json')); f = d['localFleet']
    M += f['merges']; R += f['repeats']; P += f['prs']; U += d['fleetUpdateBranch']
    others = {k: v['merges'] for k, v in d['identities'].items() if not v['fleet']}
    print(p, f, 'fleet update-branch', d['fleetUpdateBranch'], 'non-fleet identities', len(others), 'merges', sum(others.values()))
print('$K: FLEET repeats', R, 'of', M, 'local merges =', round(R / M, 3), 'per merge;', round(R / P, 2), 'per PR; fleet update-branch', U)"; done
```

Expected (measured 2026-09-23): the PAIR — `abs: FLEET repeats 135 of 290 local merges = 0.466 per merge` — is stage 1's repeat-absorption baseline; report it per merge and per PR (spec §10 wants both; the per-PR figure for the pair was not taken on the planning run, so yours is the first). The login-only line is the labelled secondary figure: ccrc-pwa `merges 34, prs 18, repeats 16`; expoAI-assistant `95, 37, 58`; intake-platform `71, 52, 19`; custom-tools `22, 13, 9`; data-internal `31, 23, 8`; MekWarLive `0, 0, 0`; `abs-login: FLEET repeats 110 of 253 local merges = 0.435 per merge; 0.77 per PR; fleet update-branch 8` (spec §10's stage-1 baseline for `update-branch` is 8 — reproduced). Every later re-measurement of this row passes the SAME pair; the wave-done report says so.

Stage 1's third baseline, pure-ritual episodes per ISO week, is one call per project (the whole window across every project does not fit one 600 s call — this repository alone took 4 m 32 s):

```bash
SCRATCH=<your scratchpad, absolute>; OUT="$SCRATCH/landing-measure"
python3 deploy/measure-landing.py episodes --project ccrc-pwa --out "$OUT"
```

Expected for ccrc-pwa (measured 2026-09-23): `2026-W37 {conflict 26, mixed 10, ritual 5}`, `2026-W38 {ritual 18, conflict 27, mixed 13}`, `2026-W39 {ritual 5, conflict 1, mixed 2}` (W39 holds only the window's last two days); active hours `ritual 7.3, conflict 56.1, mixed 22.6`. Repeat for the other five projects, one call each, and report the six.

- [ ] **Step 10: Stage 2's baselines for this repository, while the cache is warm**

```bash
SCRATCH=<your scratchpad, absolute>; OUT="$SCRATCH/landing-measure"
R=$(awk '$1 == "ccrc-pwa" {print $2}' "$OUT/repos.txt")
FLEET="$(gh api user --jq .login),<the placeholder identity's login, from the census>"
python3 deploy/measure-landing.py green-to-merge "$R" --out "$OUT"
python3 deploy/measure-landing.py inversions "$R" --fleet-login "$FLEET" --out "$OUT" | head -9
python3 deploy/measure-landing.py remerge "$R" --clone "$(git rev-parse --show-toplevel)" --out "$OUT"
```

Expected (measured 2026-09-23): green-to-merge `n 82, median 33.9, p90 1092.8, max 14580.9` minutes, `mergedBeforeGreen 1`, `headNotGreen 0`; inversions `readyPrs 10, inversions 19, fleetOnFleet 14` (taken with the login alone; `fleetOnFleet` reads PR AUTHORS, which are GitHub accounts, so the placeholder git identity is expected to add none — a different figure with the pair is reported, not argued); remerge `clean 29, hand-resolved 46` and file shapes `rewrite 172, union 10, stamp 20`. Ruled (spec §10, reconciled 2026-09-24): these inversions, from the committed commit-only scan, ARE stage 2's baseline (14 fleet-on-fleet, 19 all actors); the archived timeline-based figure (5) is retired, and the wave-done report says why — the port does not read force-pushes from the PR timeline. Nothing is committed from Steps 6–10: the numbers and the absolute path of `$OUT` go into the wave-done report (Task 7), and the coordinator writes them into the programme ledger.

---

### Task 2: `ccrc restamp <file>`

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `ccd/ccrc` — the usage line (in place); three usage lines after `expose`'s paragraph; `cmd_restamp` directly above the `# Guard so the script can be` comment; one dispatcher arm after `expose)`
- Test: `server/test/ccrc-restamp.test.ts` (new); `server/test/ccrc-cli.test.ts` (modify)

**Interfaces:**
- Consumes: `markGenerated`, `verifyMarker` from `$CCRC_HERE/../shared/mark.mjs` (the tree's own module, the path `_acct_remove_wrapper` and uninstall already read).
- Produces: `ccrc restamp <file>` → exit 0 and `restamp: <file>: restamped` (a stamped file whose body changed, re-stamped to exactly `markGenerated(text)`), exit 0 and `restamp: <file>: already current` (bytes untouched), exit 1 with a `ccrc: restamp: …` line on stderr (no marker, a symlink, a missing path, a path under `$HOME/.local/bin` or `$HOME/.ccrc` — a generator's own output —, a module that is gone, a read or write that failed), exit 2 on usage. Worker clause 16 (Task 3) names it by its installed path, `~/.local/bin/ccrc restamp <file>`; from a checkout it is `ccd/ccrc restamp ccd/ccd`.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccrc-restamp.test.ts`:

```ts
// `ccrc restamp <file>` — the regenerator for a `# ccrc:generated` stamp
// (landing-order spec 2026-09-23 §5.1, "The regenerator gets a CLI"). Worker
// clause 16 says a generated stamp is never hand-resolved: take either side of
// the stamp LINE only, resolve the rest of the file as source, then run its
// regenerator. For `ccd/ccd` that regenerator was a four-line `node -e` every
// plan re-typed, and 17 of 25 hand resolutions measured on that file were the
// stamp alone.
//
// THE GUARDS THAT MATTER are two refusals. A FOREIGN file: a marker is how ccrc
// tells its own output from a human's (`deploy/gen-wrappers.mjs` overwrites a
// wrapper only when `verifyMarker` says ccrc wrote it), so a restamp that
// stamped an unmarked file would ADOPT it — and make a hand-written file
// overwritable by the next generator run. And a GENERATOR'S OWN OUTPUT (a
// wrapper in `~/.local/bin`, a file under `~/.ccrc`): its generator reads
// `ccrc-edited` as a hand edit to keep, so a restamp there would hand that
// edit to the next `ccrc wrappers` to overwrite. Restamp re-stamps a source
// file's stamp; it never adopts, and it never launders a generator's output.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { markGenerated, verifyMarker } from '../../shared/mark.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CCRC = path.resolve(here, '..', '..', 'ccd', 'ccrc');

const run = (args: string[], home = mkTmp('ccrc-restamp-home-')): { home: string; code: number; stdout: string; stderr: string } => {
  const r = spawnSync('bash', [CCRC, 'restamp', ...args],
    { env: ghContainedEnv(home, { ...process.env, HOME: home }), encoding: 'utf8' });
  return { home, code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

const BODY = '#!/usr/bin/env bash\n# a generated file\necho one\n';
/** A stamped file whose body changed after the stamp — the shape a merge of
 *  main leaves `ccd/ccd` in when either side is taken. */
const staleStamped = (): string =>
  markGenerated(BODY).replace('echo one', 'echo two');

describe('ccrc restamp <file>', () => {
  it('re-stamps a stamped file whose body moved, to exactly what markGenerated writes', () => {
    const dir = mkTmp('ccrc-restamp-');
    const f = join(dir, 'ccd');
    writeFileSync(f, staleStamped(), { mode: 0o755 });
    expect(verifyMarker(readFileSync(f, 'utf8'))).toBe('ccrc-edited');
    const r = run([f]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('restamped');
    const after = readFileSync(f, 'utf8');
    expect(verifyMarker(after)).toBe('ccrc-unmodified');
    expect(after).toBe(markGenerated(staleStamped()));
    expect(after.split('\n')[0], 'the shebang stays physically first').toBe('#!/usr/bin/env bash');
    expect(statSync(f).mode & 0o777, 'the mode survives').toBe(0o755);
  });

  it('leaves a current stamp byte-identical and says so', () => {
    const dir = mkTmp('ccrc-restamp-');
    const f = join(dir, 'ccd');
    writeFileSync(f, markGenerated(BODY));
    const before = readFileSync(f);
    const r = run([f]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('already current');
    expect(readFileSync(f).equals(before)).toBe(true);
  });

  it('REFUSES a file with no marker and leaves it untouched — restamp never adopts', () => {
    const dir = mkTmp('ccrc-restamp-');
    const f = join(dir, 'hand-written');
    writeFileSync(f, BODY);
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('carries no ccrc:generated marker');
    expect(readFileSync(f, 'utf8')).toBe(BODY);
  });

  it("refuses a generator's own output — a wrapper in ~/.local/bin, a file under ~/.ccrc — and leaves it untouched", () => {
    const home = mkTmp('ccrc-restamp-home-');
    for (const rel of ['.local/bin/acct-demo', '.ccrc/accounts.sh']) {
      const f = join(home, rel);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, staleStamped());
      const r = run([f], home);
      expect(r.code, `${rel} was restamped`).toBe(1);
      expect(r.stderr).toContain("is a generator's output");
      expect(readFileSync(f, 'utf8')).toBe(staleStamped());
    }
  });

  it('refuses a symlink rather than stamping what it points at', () => {
    const dir = mkTmp('ccrc-restamp-');
    const target = join(dir, 'target');
    writeFileSync(target, staleStamped());
    const link = join(dir, 'link');
    symlinkSync(target, link);
    const r = run([link]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('is not a regular file');
    expect(readFileSync(target, 'utf8')).toBe(staleStamped());
  });

  it('refuses a path that does not exist, exit 1', () => {
    const r = run([join(mkTmp('ccrc-restamp-'), 'absent')]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('is not a regular file');
  });

  it('is a usage error, exit 2, with no file or with two', () => {
    expect(run([]).code).toBe(2);
    const dir = mkTmp('ccrc-restamp-');
    const f = join(dir, 'ccd');
    writeFileSync(f, staleStamped());
    expect(run([f, f]).code).toBe(2);
    expect(readFileSync(f, 'utf8'), 'a usage error writes nothing').toBe(staleStamped());
  });

  it('reports a file it cannot write, exit 1, and leaves it as it was', () => {
    if (process.getuid?.() === 0) return;   // root writes through 0444
    const dir = mkTmp('ccrc-restamp-');
    const f = join(dir, 'ccd');
    writeFileSync(f, staleStamped());
    chmodSync(f, 0o444);
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(readFileSync(f, 'utf8')).toBe(staleStamped());
  });
});
```

In `server/test/ccrc-cli.test.ts`, in `it('the usage line names every verb this CLI will have'`, replace the usage-line assertion

```ts
    expect(r.stdout).toMatch(/usage: ccrc \{doctor\|status\|adopt\|wrappers\|account\|memory\|models\|install\|update\|rollout\|uninstall\|backup\|logs\|passwd\|expose\|version\}/);
```

with

```ts
    expect(r.stdout).toMatch(/usage: ccrc \{doctor\|status\|adopt\|wrappers\|account\|memory\|models\|install\|update\|rollout\|uninstall\|backup\|logs\|passwd\|expose\|restamp\|version\}/);
```

and directly after `    expect(r.stdout).toMatch(/^ {2}expose {4}give this box a public name/m);` add:

```ts
    // `restamp` joined it in landing-order wave 1 (spec 2026-09-23 §5.1) — the
    // regenerator worker clause 16 names for a `ccrc:generated` stamp.
    // `server/test/ccrc-restamp.test.ts` owns what it does.
    expect(r.stdout).toMatch(/^ {2}restamp {3}re-stamp one file ccrc generated/m);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-restamp.test.ts test/ccrc-cli.test.ts`

Expected: FAIL — `ccrc-restamp` `7 failed | 1 passed (8)`: every case that reaches the verb reds on `ccrc: unknown argument: restamp` (or on its exit 2 where the case expects 1); the usage-error case passes because an unknown verb is also exit 2 (Pre-flight finding 12 — mutation R3 is its real proof). `ccrc-cli` `1 failed | 34 passed (35)`, on "the usage line names every verb this CLI will have".

- [ ] **Step 3: The usage text**

In `ccd/ccrc`'s `usage()` (≈1473), replace the verb line

```
usage: $PROG {doctor|status|adopt|wrappers|account|memory|models|install|update|rollout|uninstall|backup|logs|passwd|expose|version}
```

with

```
usage: $PROG {doctor|status|adopt|wrappers|account|memory|models|install|update|rollout|uninstall|backup|logs|passwd|expose|restamp|version}
```

and directly after the line `            is reported SET/NOT SET, never printed)` (the end of `expose`'s paragraph, ≈1595) insert — the heredoc is UNQUOTED, so the text carries no backtick and no `$`:

```
  restamp   re-stamp one file ccrc generated (a "ccrc:generated" marker, as
            on ccd/ccd's line 2) after its body changed: the regenerator a
            merge needs there. A file with no marker is refused, never adopted
```

- [ ] **Step 4: The verb**

Directly above the line `# Guard so the script can be `source`d (the way server/test/ccd-clip.test.ts:32` (≈12901, after `_uninst_purge`'s closing brace and one blank line) insert, followed by one blank line:

```bash
# ── restamp — the regenerator for a `# ccrc:generated` stamp ───────────────
# Landing-order spec 2026-09-23 §5.1. Worker clause 16 says a generated stamp
# is never hand-resolved: on a conflict in the stamp line, take either side of
# THAT LINE only, resolve every other hunk of the file as the source it is, then
# run this. For a file stamped by `shared/mark.mjs` — `ccd/ccd` foremost, whose
# line 2 is a digest of its own hand-written body — the regenerator was a
# four-line `node -e` every plan re-typed; 17 of 25 hand resolutions measured on
# that file were the stamp alone. This is the one spelling of it. (Taking
# either side of the whole FILE would silently drop the other side's hunks;
# the digest would then bless the loss.)
#
# RE-STAMPS, NEVER ADOPTS. A file with no marker is REFUSED, exit 1, untouched:
# the marker is how ccrc tells its own output from a human's
# (`deploy/gen-wrappers.mjs` overwrites a wrapper only when `verifyMarker` says
# ccrc wrote it), so stamping an unmarked file would make a hand-written one
# overwritable by the next generator run. A symlink is refused for the same
# reason a generator refuses one: the stamp would land on whatever it points at.
#
# NEVER A GENERATOR'S OWN OUTPUT. A stamped file under `$HOME/.local/bin` (the
# account wrappers) or `$HOME/.ccrc` is refused too: its generator
# (`ccrc wrappers`, `ccrc install`) reads `ccrc-edited` as "a hand edit, keep
# it" and refuses to overwrite it, so re-stamping it here would turn that edit
# into something the next generator run silently overwrites. Those files are
# regenerated by their generators, never restamped.
#
# THE MODULE IS THIS TREE'S OWN (`$CCRC_HERE/../shared/mark.mjs`, the path
# `_acct_remove_wrapper` and uninstall already read). From a checkout, run
# `ccd/ccrc restamp ccd/ccd` and the checkout's own module stamps its own file;
# the installed launcher reaches the installed tree's copy of the same format
# (the version is part of the literal marker, so two trees of one format agree
# byte for byte). Exit 0 re-stamped or already current; 1 refused; 2 usage.
cmd_restamp() {
  case "${1:-}" in -h|--help) echo "usage: $PROG restamp <file>"; return 0 ;; esac
  [ $# -eq 1 ] || { echo "usage: $PROG restamp <file>" >&2; exit 2; }
  local f="$1" mark="$CCRC_HERE/../shared/mark.mjs" verdict dir real d
  { [ -f "$f" ] && [ ! -L "$f" ]; } || _ccrc_die "restamp: $f is not a regular file"
  dir="$(cd "$(dirname -- "$f")" && pwd -P)" || _ccrc_die "restamp: $f could not be resolved"
  real="$dir/${f##*/}"
  for d in "$HOME/.local/bin" "$HOME/.ccrc"; do
    [ -d "$d" ] && d="$(cd "$d" && pwd -P)"
    case "$real" in
      "$d"/*) _ccrc_die "restamp: $f is a generator's output; regenerate it with its generator (ccrc wrappers, ccrc install), never restamp it" ;;
    esac
  done
  [ -f "$mark" ] || _ccrc_die "restamp: the marker module is missing ($mark)"
  verdict="$(node --no-warnings --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [markPath, filePath] = process.argv.slice(1);
const { markGenerated, verifyMarker } = await import(pathToFileURL(markPath).href);
const text = readFileSync(filePath, "utf8");
const v = verifyMarker(text);
if (v !== "ccrc-edited") { console.log(v); process.exit(0); }
writeFileSync(filePath, markGenerated(text));
console.log("restamped");
' "$mark" "$f" 2>/dev/null)" || _ccrc_die "restamp: $f could not be read or written"
  case "$verdict" in
    restamped)       echo "restamp: $f: restamped" ;;
    ccrc-unmodified) echo "restamp: $f: already current" ;;
    foreign)         _ccrc_die "restamp: $f carries no ccrc:generated marker — restamp re-stamps a generated file, it never adopts one" ;;
    *)               _ccrc_die "restamp: $f: unexpected verdict '$verdict'" ;;
  esac
}
```

and in the dispatcher's `case "$VERB" in`, directly after `  expose)  cmd_expose "$@" ;;`, add:

```bash
  restamp) cmd_restamp "$@" ;;
```

- [ ] **Step 5: Pay the citation tax (S6-R11)**

```bash
SCRATCH=<your scratchpad, absolute>
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD --files ccd/ccrc
```

Expected (measured with this task's edits alone and with all six tasks'): `byFile['ccd/ccrc'] stated 5 base 5 tree 5`, total `195 / 195 / 195`, empty `ENTERED`/`LEFT` three times. The three usage lines sit above `ccd/ccrc`'s frozen anchors and move no census entry; if yours does, stop (the procedure's step 2).

- [ ] **Step 6: Run the tests to verify they pass**

Each line is its own call, run from the worktree root (shell state does not survive between calls):

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-restamp.test.ts test/ccrc-cli.test.ts test/ownership.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts
./ccd/ccrc restamp ccd/ccd; echo "rc=$?"
```

Expected: first run PASS (`ccrc-restamp` 8/8, `ccrc-cli` 35/35, `ownership` 14/14); second `7 passed | 326 skipped (333)`; `deploy-verify` 45/45 (it reads `ccd/ccrc` function bodies with a `\n\}` terminator, and `cmd_restamp`'s embedded script has no line starting with `}`); the last prints `restamp: ccd/ccd: already current` and `rc=0` (measured).

- [ ] **Step 7: Mutation check, then commit**

| # | Exact edit in `ccd/ccrc` | Expected red (measured) |
|---|---|---|
| R1 | `if (v !== "ccrc-edited") { … }` → `if (v === "ccrc-unmodified") { … }` (a foreign file falls through to the write) | "REFUSES a file with no marker and leaves it untouched — restamp never adopts" — `expected +0 to be 1` |
| R2 | `{ [ -f "$f" ] && [ ! -L "$f" ]; } \|\|` → `[ -f "$f" ] \|\|` | "refuses a symlink rather than stamping what it points at" — `expected +0 to be 1` |
| R3 | `[ $# -eq 1 ]` → `[ $# -ge 1 ]` | "is a usage error, exit 2, with no file or with two" — `expected +0 to be 2` |
| R4 | delete the `  restamp) cmd_restamp "$@" ;;` arm | 7 of 8 `ccrc-restamp` cases (`ccrc: unknown argument: restamp`; `7 failed \| 36 passed (43)` across both files — the usage text still names the verb, so `ccrc-cli` stays green) |
| R5 | usage line `…\|expose\|restamp\|version}` → `…\|expose\|version}` | `ccrc-cli` "the usage line names every verb this CLI will have" |
| R6 | the description's first line `re-stamp one file ccrc generated` → `stamps a generated file` | same `ccrc-cli` case, on `/^ {2}restamp {3}re-stamp one file ccrc generated/m` |
| R7 | `  for d in "$HOME/.local/bin" "$HOME/.ccrc"; do` → `  for d in; do` (the scope check gone) | "refuses a generator's own output…" — `.local/bin/acct-demo was restamped: expected +0 to be 1` |
| R8 | the same line → `  for d in "$HOME/.local/bin"; do` (`~/.ccrc` dropped) | same case — `.ccrc/accounts.sh was restamped: expected +0 to be 1` |

Rows — ONE array, R1–R8, in `$SCRATCH/mut-task2.json`:

```json
[
 {"id": "R1", "file": "ccd/ccrc", "old": "if (v !== \"ccrc-edited\") { console.log(v); process.exit(0); }", "new": "if (v === \"ccrc-unmodified\") { console.log(v); process.exit(0); }", "tests": ["test/ccrc-restamp.test.ts"]},
 {"id": "R2", "file": "ccd/ccrc", "old": "  { [ -f \"$f\" ] && [ ! -L \"$f\" ]; } || _ccrc_die \"restamp: $f is not a regular file\"", "new": "  [ -f \"$f\" ] || _ccrc_die \"restamp: $f is not a regular file\"", "tests": ["test/ccrc-restamp.test.ts"]},
 {"id": "R3", "file": "ccd/ccrc", "old": "  [ $# -eq 1 ] || { echo \"usage: $PROG restamp <file>\" >&2; exit 2; }", "new": "  [ $# -ge 1 ] || { echo \"usage: $PROG restamp <file>\" >&2; exit 2; }", "tests": ["test/ccrc-restamp.test.ts"]},
 {"id": "R4", "file": "ccd/ccrc", "old": "  restamp) cmd_restamp \"$@\" ;;\n", "new": "", "tests": ["test/ccrc-restamp.test.ts", "test/ccrc-cli.test.ts"]},
 {"id": "R5", "file": "ccd/ccrc", "old": "|passwd|expose|restamp|version}", "new": "|passwd|expose|version}", "tests": ["test/ccrc-cli.test.ts"]},
 {"id": "R6", "file": "ccd/ccrc", "old": "  restamp   re-stamp one file ccrc generated (a \"ccrc:generated\" marker, as\n", "new": "  restamp   stamps a generated file (a \"ccrc:generated\" marker, as\n", "tests": ["test/ccrc-cli.test.ts"]},
 {"id": "R7", "file": "ccd/ccrc", "old": "  for d in \"$HOME/.local/bin\" \"$HOME/.ccrc\"; do\n", "new": "  for d in; do\n", "tests": ["test/ccrc-restamp.test.ts"]},
 {"id": "R8", "file": "ccd/ccrc", "old": "  for d in \"$HOME/.local/bin\" \"$HOME/.ccrc\"; do\n", "new": "  for d in \"$HOME/.local/bin\"; do\n", "tests": ["test/ccrc-restamp.test.ts"]}
]
```

```bash
git add ccd/ccrc server/test/ccrc-restamp.test.ts server/test/ccrc-cli.test.ts
git commit -m "$(cat <<'MSG'
feat(ccrc): restamp <file>, the regenerator for a ccrc:generated stamp

Landing-order spec §5.1. Worker clause 16 says a generated stamp is never
hand-resolved: take either side of the stamp LINE only, resolve the rest of
the file as source, then run its regenerator. ccd/ccd's line 2 is a digest of
its own hand-written body, and 17 of 25 hand resolutions measured on that
file were the stamp alone; its regenerator was a four-line node -e every plan
re-typed. `ccrc restamp <file>` is markGenerated from the tree's own
shared/mark.mjs: it re-stamps a stamped file, leaves a current one
byte-identical, and REFUSES a file with no marker — a restamp that adopted a
hand-written file would make it overwritable by the next generator run — and
a file under ~/.local/bin or ~/.ccrc, a generator's own output whose
ccrc-edited state its generator protects.

S6-R11: cmd_restamp sits below every frozen ccd/ccrc anchor; the three usage
lines above them moved no census entry (5 / 195, empty composition, measured).
MSG
)"
```

---

### Task 3: Worker clause 16

**Model routing:** `sonnet`, effort `high` — transcription of pinned bytes; the verbatim pin is the check.

**Files:**
- Modify: `ccd/worker-skill/SKILL.md` — clause 16 directly after clause 15 (≈75); "These fifteen clauses" (≈52) and "these fifteen lines" (≈55) → "sixteen"
- Modify: `README.md` — ≈1598, ≈1948, ≈2283 (count words, in place); `CLAUDE.md` — ≈269 (hints at `08701c22`; main's #176 moved them from ≈1576/1926/2261 and ≈259)
- Test: `server/test/worker-skill.test.ts`

**Interfaces:**
- Consumes: `ccrc restamp <file>` (Task 2), named in the clause by its installed path, `~/.local/bin/ccrc` (Pre-flight finding 14).
- Produces: clause 16, the sixteenth entry of the worker CONTRACT (`CONTRACT[15]`, bound as `ABSORB`); the probe command `git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD` and its two-halves conflict rule, which Task 5's advisory repeats; spec §4 Worker row's settings prohibition (rulesets, branch protection, auto-merge, `allow_update_branch`); the stamp-LINE rule for a generated stamp (Pre-flight finding 13); the word `update-branch` licensed exactly once in this corpus.

- [ ] **Step 1: Write the failing tests**

In `server/test/worker-skill.test.ts`:

(a) change the comment line `// The fifteen clauses, verbatim. Every entry is DOUBLE-quoted on purpose: clause 3` to `// The sixteen clauses, verbatim. Every entry is DOUBLE-quoted on purpose: clause 3`, and the title `it('carries all fifteen clauses verbatim', () => {` to `it('carries all sixteen clauses verbatim', () => {`;

(b) replace the CONTRACT array's closing — the line ending `unclear otherwise. The suite line is never omitted.",` followed by `];` — so the array gains its sixteenth entry and the file gains `ABSORB` directly after it:

```ts
  // Landing-order wave 1 (spec 2026-09-23 §5.1). The probe's exit code alone
  // is NOT the conflict verdict: measured on git 2.43, `git merge-tree
  // --write-tree` exits 1 for a conflict (a tree id on stdout's first line)
  // AND for an unresolvable ref (`not something we can merge`, stdout empty),
  // so the clause names both halves of the conflict answer and says what every
  // other answer licenses: nothing.
  "Absorb `origin/main` into this branch only on one of three triggers, each read after one `git fetch origin`: your own probe `git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD` exits 1 with a tree id on its first line (the branch conflicts; exit 0 is clean, and any other answer is unmeasured and licenses nothing); a required check on your PR is red while main's latest push run of the same required job is green; or a `fix-round` mail from the coordinator names this PR ejected from the landing line with a base sha, or next to land in a strict-protection repository. The first two license at most one absorption per PR — a second occurrence before the first absorption lands is not a second license — and the third arrives on the `merging → working` edge, after which you absorb, re-gate and send a fresh `wave-done`. Absorb with `git merge` only: never a rebase, a force-push or `update-branch` by any route, including `gh api -X PUT`. Never write any repository's rulesets, branch protection, auto-merge setting or `allow_update_branch`. Never hand-resolve a generated stamp: on a conflict in a `# ccrc:generated` line such as `ccd/ccd`'s line 2, take either side of that line only, resolve every other hunk of the file as the source it is, then run `~/.local/bin/ccrc restamp <file>`. A red that main also shows is reported once as `main-red` and left alone. Keep no local `main`: read `origin/HEAD`, fetched once.",
];

/** The absorb clause, by its own index — the one clause licensed to name
 *  `update-branch`, and it names it to forbid it (spec §5.1 "Pins"). */
const ABSORB = CONTRACT[15]!;
```

(the block above begins directly after the fifteenth entry's line and replaces the old `];`);

(c) directly above `  it('carries no references of its own — the census corpus is the whole skill (D-103)', () => {` add:

```ts
  it('names `update-branch` ONLY inside clause 16, which forbids it — counted, not absent (spec §5.1)', () => {
    // The skill corpus is where the word is LICENSED, once, to forbid it; the
    // executable source is where it is absent (`update-branch-absent.test.ts`).
    // EQUALITY, as the destructive-verb census above: an extra mention anywhere
    // else in SKILL.md is a model given a reason to consider the act.
    // (`allow_update_branch` is spelled with underscores and is not a hit.)
    const hits = skill.split('update-branch').length - 1;
    const licensed = ABSORB.split('update-branch').length - 1;
    expect(licensed, 'clause 16 no longer names update-branch to forbid it').toBe(1);
    expect(hits, `update-branch appears ${hits}×; only clause 16 may name it`).toBe(licensed);
  });

  it('clause 16 names the probe with both halves of its conflict answer, the settings it never writes, and the regenerator', () => {
    // A clause that said "exits 1" alone would license an absorb on a
    // mistyped ref: git 2.43 exits 1 for `not something we can merge` too.
    expect(ABSORB).toContain('git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD');
    expect(ABSORB).toContain('exits 1 with a tree id on its first line');
    expect(ABSORB).toContain('any other answer is unmeasured and licenses nothing');
    // Spec §4's Worker row: settings writes are forbidden to the worker too.
    expect(ABSORB).toContain('rulesets, branch protection, auto-merge setting or `allow_update_branch`');
    // The STAMP line is taken, never the whole file: `ccd/ccd` is hand-written
    // source carrying a stamp, and taking one side of the file would drop the
    // other side's hunks. And the launcher by its PATH: `~/.local/bin` is not
    // on the fleet session unit's PATH (this skill's own ccrc-api section).
    expect(ABSORB).toContain('take either side of that line only');
    expect(ABSORB).toContain('`~/.local/bin/ccrc restamp <file>`');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts`

Expected: FAIL — `Tests 5 failed | 40 passed (45)`: "carries all sixteen clauses verbatim" (`missing contract clause: Absorb \`origin/main\` into this branch only on on…`), "numbers exactly as many clauses as the CONTRACT pins, 1..N with no gaps", "spells that same count … everywhere prose states it" (`SKILL.md says fifteen where the CONTRACT pins 16`), "names `update-branch` ONLY inside clause 16…" (`update-branch appears 0×`), and "adds no new clause and no second numbered list" (re-measured at `af64d9d2` with the revised clause: the same five). The probe case passes: it pins the CONTRACT literal itself, so it reds when someone softens the literal (and SKILL.md with it), not before the clause exists.

- [ ] **Step 3: Add clause 16 and move the count words**

In `ccd/worker-skill/SKILL.md`, directly after the line beginning `15. Your wave-done body opens with two signal lines` add this ONE line (straight apostrophes, no `"`):

```
16. Absorb `origin/main` into this branch only on one of three triggers, each read after one `git fetch origin`: your own probe `git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD` exits 1 with a tree id on its first line (the branch conflicts; exit 0 is clean, and any other answer is unmeasured and licenses nothing); a required check on your PR is red while main's latest push run of the same required job is green; or a `fix-round` mail from the coordinator names this PR ejected from the landing line with a base sha, or next to land in a strict-protection repository. The first two license at most one absorption per PR — a second occurrence before the first absorption lands is not a second license — and the third arrives on the `merging → working` edge, after which you absorb, re-gate and send a fresh `wave-done`. Absorb with `git merge` only: never a rebase, a force-push or `update-branch` by any route, including `gh api -X PUT`. Never write any repository's rulesets, branch protection, auto-merge setting or `allow_update_branch`. Never hand-resolve a generated stamp: on a conflict in a `# ccrc:generated` line such as `ccd/ccd`'s line 2, take either side of that line only, resolve every other hunk of the file as the source it is, then run `~/.local/bin/ccrc restamp <file>`. A red that main also shows is reported once as `main-red` and left alone. Keep no local `main`: read `origin/HEAD`, fetched once.
```

and change `These fifteen clauses are the boundary` → `These sixteen clauses are the boundary`, and `these fifteen lines are pinned verbatim` → `these sixteen lines are pinned verbatim`.

In `README.md` (each an in-place word swap; no line is added or removed):

- `` `ccrc-worker` skill (`ccd/worker-skill/SKILL.md`, fifteen clauses pinned by `` → `` …, sixteen clauses pinned by ``
- `` shape:** the `ccrc-worker` skill (`ccd/worker-skill/SKILL.md`), fifteen clauses, `` → `` …, sixteen clauses, ``
- `` `ccd/worker-skill/SKILL.md` now carries fifteen clauses (thirteen at R2; routing slice 2 added 14 and 15), pinned verbatim: a `` → `` `ccd/worker-skill/SKILL.md` now carries sixteen clauses (thirteen at R2; routing slice 2 added 14 and 15, landing-order wave 1 added 16), pinned verbatim: a ``

In `CLAUDE.md`: `` (`ccd/worker-skill/SKILL.md`, `ccrc-worker`, fifteen clauses pinned by `` → `` …, sixteen clauses pinned by ``.

- [ ] **Step 4: Pay the citation tax (README only)**

```bash
SCRATCH=<your scratchpad, absolute>
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD --files README.md
```

Expected: every line `stated = base = tree`, empty compositions — word swaps on lines that carry no citation.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts test/reviewer-skill.test.ts \
  test/install-worker-skill.test.ts test/readme-holds.test.ts
```

Expected: PASS — `worker-skill` 45/45, `reviewer-skill` 12/12, `install-worker-skill` 11/11, `readme-holds` 16/16 (measured at `af64d9d2`, each file alone).

- [ ] **Step 6: Mutation check, then commit**

| # | Exact edit | Expected red (measured) |
|---|---|---|
| W1 | SKILL.md clause 16: `exits 1 with a tree id on its first line (the branch conflicts;` → `exits 1 (the branch conflicts;` | "carries all sixteen clauses verbatim" only (1 failed) |
| W2 | SKILL.md: after `## The plan the brief names may live in another repository` add a line `Never call update-branch from here either.` | "names `update-branch` ONLY inside clause 16…" — `update-branch appears 2×; only clause 16 may name it` |
| W3 | SKILL.md: `16. Absorb` → `17. Absorb` | "numbers exactly as many clauses…" and "adds no new clause and no second numbered list" (2 failed) |
| W4 | README.md: the first `sixteen clauses pinned by` → `fifteen` | "spells that same count…" — `README.md says fifteen clauses where the CONTRACT pins 16` |
| W5 | CLAUDE.md: `sixteen clauses pinned by` → `fifteen` | same case — `CLAUDE.md says fifteen clauses where the CONTRACT pins 16` |
| W6 | SKILL.md clause 16: drop ` Never write any repository's rulesets, branch protection, auto-merge setting or `allow_update_branch`.` | "carries all sixteen clauses verbatim" only (1 failed) — `missing contract clause: Absorb \`origin/main\` into this branch only on on…` |
| W7 | SKILL.md clause 16: `take either side of that line only, resolve every other hunk of the file as the source it is, then run `~/.local/bin/ccrc restamp <file>`.` → `take either side, then run `ccrc restamp <file>`.` (the file-level reading and the bare name back) | same case only (1 failed) |

Each Task 3 row was re-measured at `af64d9d2` with the revised clause: W1, W2, W4–W7 `1 failed | 44 passed (45)`, W3 `2 failed | 43 passed (45)`.

Rows (`$SCRATCH/mut-task3.json`):

```json
[
 {"id": "W1", "file": "ccd/worker-skill/SKILL.md", "old": "exits 1 with a tree id on its first line (the branch conflicts;", "new": "exits 1 (the branch conflicts;", "tests": ["test/worker-skill.test.ts"]},
 {"id": "W2", "file": "ccd/worker-skill/SKILL.md", "old": "## The plan the brief names may live in another repository\n", "new": "## The plan the brief names may live in another repository\n\nNever call update-branch from here either.\n", "tests": ["test/worker-skill.test.ts"]},
 {"id": "W3", "file": "ccd/worker-skill/SKILL.md", "old": "\n16. Absorb `origin/main`", "new": "\n17. Absorb `origin/main`", "tests": ["test/worker-skill.test.ts"]},
 {"id": "W4", "file": "README.md", "old": "`ccrc-worker` skill (`ccd/worker-skill/SKILL.md`, sixteen clauses pinned by", "new": "`ccrc-worker` skill (`ccd/worker-skill/SKILL.md`, fifteen clauses pinned by", "tests": ["test/worker-skill.test.ts"]},
 {"id": "W5", "file": "CLAUDE.md", "old": "`ccrc-worker`, sixteen clauses pinned by", "new": "`ccrc-worker`, fifteen clauses pinned by", "tests": ["test/worker-skill.test.ts"]},
 {"id": "W6", "file": "ccd/worker-skill/SKILL.md", "old": " Never write any repository's rulesets, branch protection, auto-merge setting or `allow_update_branch`.", "new": "", "tests": ["test/worker-skill.test.ts"]},
 {"id": "W7", "file": "ccd/worker-skill/SKILL.md", "old": "take either side of that line only, resolve every other hunk of the file as the source it is, then run `~/.local/bin/ccrc restamp <file>`.", "new": "take either side, then run `ccrc restamp <file>`.", "tests": ["test/worker-skill.test.ts"]}
]
```

```bash
git add ccd/worker-skill/SKILL.md server/test/worker-skill.test.ts README.md CLAUDE.md
git commit -m "$(cat <<'MSG'
feat(skills): worker clause 16 — absorb main only on three triggers

Landing-order spec §5.1. A worker merges origin/main into its branch only when
its own probe says the branch conflicts, when a required check is red while
main's same job is green, or when the coordinator's fix-round names the PR
ejected or next to land; the first two license one absorption per PR. git
merge only — never a rebase, a force-push or update-branch, and no write to
any repository's rulesets, protection, auto-merge or allow_update_branch
(spec §4's Worker row); a generated stamp is never hand-resolved — take
either side of the stamp LINE only, resolve the rest of the file as source,
then ~/.local/bin/ccrc restamp (by path: ~/.local/bin is not on the session
unit's PATH); a red main shares is reported once.

The probe's conflict answer is exit 1 AND a tree id on stdout's first line:
git 2.43 also exits 1 on an unresolvable ref (measured), so any other answer
licenses nothing. update-branch is counted in this corpus — licensed once,
in the clause that forbids it. The pin moves 15 -> 16 with README.md and
CLAUDE.md's count words in the same commit.
MSG
)"
```

---

### Task 4: Coordinator clause 15, and wave-lifecycle step 6 written gated

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md` — clause 15 directly after clause 14 (≈83); `These fourteen sentences` (≈67) → `fifteen`; two lines at the end of step 6's **Same project:** arm (after ≈380 at `08701c22`; #178's "One PR per child" paragraph now sits above the arm)
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` — §5 step 6 directly after step 5 (≈785–786 at `08701c22`, before `## 6 — Final merge`)
- Modify: `README.md` ≈1945, `CLAUDE.md` ≈263 (count words, in place; hints at `08701c22`)
- Test: `server/test/coordinator-skill.test.ts`

**Interfaces:**
- Consumes: the token `reclaim-v1` as `docs/superpowers/programs/child-reclamation-contract.md` names it (CCR-15 wave 3); §5 steps 3 and 5 as they stand.
- Produces: clause 15 (`CONTRACT[14]`); §5 step 6's gate sentence (`` `ccd caps` lists `reclaim-v1` ``) and rule. Wave 2 of this programme appends the native-queue sentence to clause 15 (programme ledger, next-wave brief); session-continuity's stage 5 appends its clauses after it.

- [ ] **Step 1: Write the failing tests**

In `server/test/coordinator-skill.test.ts`:

(a) three count words, in place: the header line `// fourteen contract clauses, the routes it names, the refusal codes it promises,` → `// fifteen contract clauses, …`; `// The fourteen clauses, verbatim. Kept as a literal array rather than a regex per` → `// The fifteen clauses, …`; `it('carries all fourteen clauses verbatim', () => {` → `it('carries all fifteen clauses verbatim', () => {`;

(b) the CONTRACT array gains its fifteenth entry: directly after the line ending `and no wave is accepted on a reading this session made alone.",` (before `];`) add:

```ts
  // Landing-order wave 1 (spec 2026-09-23 §5.1). Written with no apostrophe at
  // all, so neither the straight nor the curly spelling can drift.
  'This session never calls `update-branch` by any route, and never writes the rulesets, branch protection, auto-merge setting or `allow_update_branch` of any repository. It sends a rebase-check or any other conflict-sync request only on a conflict it has measured; beyond that, the only absorb it asks for is a land-sync to the PR it named next to land in a strict-protection repository, or an ejection naming the base sha the landing line recorded, and it never merges main into any workspace but its own. It commits programme-ledger documents on its own ledger PR, never inside a feature PR.',
```

(c) directly above `  it('tells the session how to learn its own id the ONE way that is actually its own', () => {` inside `describe('the coordinator skill: its contract'`, add:

```ts
  it('names `update-branch` ONLY inside clause 15, across SKILL.md and every reference — counted, not absent (spec §5.1)', () => {
    // The whole corpus a coordinator reads (`allSkillText`, derived from the
    // references directory), so a mention slipped into wave-lifecycle.md is
    // caught as surely as one in SKILL.md. `allow_update_branch` is spelled
    // with underscores and is not a hit. EQUALITY, not a ceiling.
    const hits = allSkillText.split('update-branch').length - 1;
    const licensed = CONTRACT[14]!.split('update-branch').length - 1;
    expect(licensed, 'clause 15 no longer names update-branch to forbid it').toBe(1);
    expect(hits, `update-branch appears ${hits}× in the coordinator corpus; only clause 15 may name it`)
      .toBe(licensed);
  });
```

(d) at the end of the file, add:

```ts
// Landing-order wave 1 (spec 2026-09-23 §5.1, "Step 6 of the wave lifecycle").
// The step ships WRITTEN but GATED: a fresh child per wave is only safe to make
// the default once child-reclamation's reclaim-on-close wave (CCR-15 wave 3)
// collects spent children, and that wave advertises `reclaim-v1`. So the pins
// hold the gate BEFORE the rule, the rule's own succession order, and the
// pointer from SKILL.md's same-project arm — each red when its half goes.
describe('wave-lifecycle §5 step 6 — a fresh workspace per wave, gated on reclaim-v1', () => {
  const lifecycle = refs('wave-lifecycle.md');
  const boundary = lifecycle.slice(lifecycle.indexOf('## 5 — The boundary'),
    lifecycle.indexOf('## 6 — Final merge'));
  const at = boundary.indexOf('6. **A fresh workspace per wave');
  const step6 = flat(boundary.slice(at));

  it('is step 6 of §5, after step 5 and before the final-merge section', () => {
    expect(at, '§5 carries no step 6').toBeGreaterThan(boundary.indexOf('5. Dispatch wave N+1'));
  });

  it('states the gate before the rule, by the token CCR-15 wave 3 advertises', () => {
    const gate = step6.indexOf('`ccd caps` lists `reclaim-v1`');
    const rule = step6.indexOf('WITHOUT `sessionId`');
    expect(gate, 'step 6 no longer names its gate').toBeGreaterThanOrEqual(0);
    expect(rule, 'step 6 no longer opens the successor WITHOUT sessionId').toBeGreaterThan(gate);
    expect(step6).toContain("step 3's same-project arm governs exactly as written");
    // The gate's token is the programme contract's own name for it, so a rename
    // there reds here instead of leaving a gate nothing will ever open.
    const contract = readFileSync(path.join(root, 'docs/superpowers/programs/child-reclamation-contract.md'), 'utf8');
    expect(contract).toContain('`reclaim-v1`');
  });

  it('opens fresh only after the predecessor measures merged, then succeeds open-first with a releasing close', () => {
    const merged = step6.indexOf('measures merged');
    const open = step6.indexOf('open wave N+1 first');
    const close = step6.indexOf('close the producer with `final:true` and require `released:true`');
    const proof = step6.indexOf('runs list --closed 1');
    expect(merged, 'step 6 no longer waits for the predecessor to measure merged').toBeGreaterThanOrEqual(0);
    expect(open, 'step 6 no longer opens the successor first').toBeGreaterThan(merged);
    expect(close, 'step 6 no longer closes with a releasing close after the open').toBeGreaterThan(open);
    expect(proof, 'step 6 no longer reads the closed row after its close').toBeGreaterThan(close);
    expect(step6).toContain('stacked child');
  });

  it("SKILL.md's same-project arm points at the gated step", () => {
    const s6 = skill.slice(skill.indexOf('6. **Rule on the report**'), skill.indexOf('\n7. **Final merge:**'));
    const same = flat(s6.slice(s6.indexOf('**Same project:**'), s6.indexOf('**Different project:**')));
    expect(same).toContain('`references/wave-lifecycle.md` §5 step 6');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`

Expected: FAIL — `Tests 8 failed | 144 passed (152)`: "carries all fifteen clauses verbatim", "numbers exactly as many clauses…", "spells that same count…", "names `update-branch` ONLY inside clause 15…" (`update-branch appears 0× in the coordinator corpus`), and all four cases of the new `describe` (step 6 absent; the pointer absent).

- [ ] **Step 3: Add clause 15, the pointer, and the count words**

In `ccd/coordinator-skill/SKILL.md`, directly after the line beginning `14. The review brief names the held-out panel` add this ONE line:

```
15. This session never calls `update-branch` by any route, and never writes the rulesets, branch protection, auto-merge setting or `allow_update_branch` of any repository. It sends a rebase-check or any other conflict-sync request only on a conflict it has measured; beyond that, the only absorb it asks for is a land-sync to the PR it named next to land in a strict-protection repository, or an ejection naming the base sha the landing line recorded, and it never merges main into any workspace but its own. It commits programme-ledger documents on its own ledger PR, never inside a feature PR.
```

change `These fourteen sentences are the boundary` → `These fifteen sentences are the boundary`, and in step 6's **Clean** arm, directly after the **Same project:** sentence's last line `     find the producer by run id, and require its own `state` to be `done`.` (and before `     **Different project:** …`) add:

```
     A fresh workspace per wave replaces this arm only once the gate in
     `references/wave-lifecycle.md` §5 step 6 opens; until then it stands.
```

(The two SKILL.md succession pins — "orders each SKILL.md succession arm independently" and "describes step 6 as step 6 actually reads" — find their phrases by first occurrence inside the arm; the new sentence names none of them, measured green.)

In `README.md`: `` the `ccrc-coordinator` skill (`ccd/coordinator-skill/SKILL.md`), and its fourteen `` → `` …, and its fifteen `` (the line ends there; the count word's `clauses` is on the next line, which the pin's `\s+` spans). In `CLAUDE.md`: `` (`ccd/coordinator-skill/SKILL.md`); its fourteen clauses are pinned VERBATIM by `` → `` …; its fifteen clauses are pinned VERBATIM by ``.

- [ ] **Step 4: Write step 6 of §5, gated**

In `ccd/coordinator-skill/references/wave-lifecycle.md`, directly after step 5's two lines (`5. Dispatch wave N+1 (§2, step 2) only after the applicable close, closed-row` / `   proof, release proof, and exact-SHA merge proof above succeed.`) and before the blank line that precedes `## 6 — Final merge`, add:

```
6. **A fresh workspace per wave — written GATED, and not live yet** (landing
   order, spec 2026-09-23 §5.1). Nothing in this step applies until this box's
   `ccd caps` lists `reclaim-v1`, the token child-reclamation's reclaim-on-close
   wave advertises. Until then step 3's same-project arm governs exactly as
   written, because a wave opened fresh today leaves one more live child that
   the operator archives by hand. Once the token is listed, a same-project
   successor is opened only after the predecessor's PR measures merged
   (`ccd pr-state --session <predecessor id>` answers `phase` = `merged`;
   read the field with `jq -r .phase`, never by matching the line's text), and
   it opens WITHOUT `sessionId`, so dispatch mints a fresh child from current
   `main` instead of resuming a workspace built on the old one. The succession
   is then the cross-project arm's, inside one project: open wave N+1 first,
   close the producer with `final:true` and require `released:true`, then read
   `"$API" runs list --closed 1` and require the producer's own `state` to be
   `done` — open-before-close is unchanged. A wave that must overlap its
   predecessor is a deliberate stacked child: its brief names the
   predecessor's branch it builds on, and it pays one absorption of `main`
   knowingly once that PR lands, under worker clause 16's triggers like any
   other.
```

Three properties the existing §5 pins need, each measured green on the prototype: `dispatchAt` (the first `Dispatch wave N+1`) is still step 5's; the step names no `**Same project:**`/`**Different project:**` marker, so the per-arm slices end where they did; and it names no destructive verb and no route (`allSkillText`'s census and the route harvest read this file).

- [ ] **Step 5: Pay the citation tax (README only)**

```bash
SCRATCH=<your scratchpad, absolute>
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD --files README.md
```

Expected: stated = base = tree everywhere, empty compositions.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/reviewer-skill.test.ts \
  test/install-coordinator-skill.test.ts test/box-token-census.test.ts test/routing-references.test.ts
```

Expected: PASS — `coordinator-skill` 152/152, `reviewer-skill` 12/12, `install-coordinator-skill` 16/16, `box-token-census` 22/22, `routing-references` 11/11 (measured at `af64d9d2`, each file alone; re-measured 2026-09-24 at `08701c22` with every task's edit in — `box-token-census` moved 14 → 22 with main's #176, which added eight update-route census cases to that file; the rest unchanged).

- [ ] **Step 7: Mutation check, then commit**

| # | Exact edit | Expected red (measured) |
|---|---|---|
| C1 | SKILL.md clause 15: `only on a conflict it has measured; beyond that,` → `only on a conflict; beyond that,` | "carries all fifteen clauses verbatim" only — `missing contract clause: This session never calls \`update-branch\` by any …` |
| C2 | wave-lifecycle.md step 6: `…like any\n   other.` → `…like any\n   other, and never by update-branch.` | "names `update-branch` ONLY inside clause 15, across SKILL.md and every reference…" — `update-branch appears 2× in the coordinator corpus` |
| C3 | README.md `and its fifteen` → `and its fourteen` | "spells that same count…" — `README.md says fourteen clauses where the CONTRACT pins 15` |
| C4 | CLAUDE.md `its fifteen clauses are pinned VERBATIM by` → `fourteen` | same case — `CLAUDE.md says fourteen clauses…` |
| C5 | step 6: `` `ccd caps` lists `reclaim-v1`, the token `` → `` `ccd caps` lists anything, the token `` | "states the gate before the rule…" — `step 6 no longer names its gate` |
| C6 | step 6: `it opens WITHOUT `sessionId`` → `it opens with `sessionId`` | same case — `step 6 no longer opens the successor WITHOUT sessionId` |
| C7 | step 6: `close the producer with `final:true` and require `released:true`, then read` → `close the producer with `final:false`, then read` | "opens fresh only after the predecessor measures merged…" — `step 6 no longer closes with a releasing close after the open` |
| C8 | SKILL.md pointer: `` `references/wave-lifecycle.md` §5 step 6 opens `` → `the lifecycle reference opens` | "SKILL.md's same-project arm points at the gated step" |
| C9 | step 6: `PR measures merged` → `PR is reviewed` | "opens fresh only after the predecessor measures merged…" — `step 6 no longer waits for the predecessor to measure merged` |

Every Task 4 row was re-measured at `af64d9d2` with the revised clause 15 and step 6: each `1 failed | 151 passed (152)`.

Rows (`$SCRATCH/mut-task4.json`):

```json
[
 {"id": "C1", "file": "ccd/coordinator-skill/SKILL.md", "old": "only on a conflict it has measured; beyond that,", "new": "only on a conflict; beyond that,", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "C2", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "knowingly once that PR lands, under worker clause 16's triggers like any\n   other.", "new": "knowingly once that PR lands, under worker clause 16's triggers like any\n   other, and never by update-branch.", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "C3", "file": "README.md", "old": "(`ccd/coordinator-skill/SKILL.md`), and its fifteen", "new": "(`ccd/coordinator-skill/SKILL.md`), and its fourteen", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "C4", "file": "CLAUDE.md", "old": "its fifteen clauses are pinned VERBATIM by", "new": "its fourteen clauses are pinned VERBATIM by", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "C5", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "`ccd caps` lists `reclaim-v1`, the token", "new": "`ccd caps` lists anything, the token", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "C6", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "it opens WITHOUT `sessionId`, so dispatch mints", "new": "it opens with `sessionId`, so dispatch mints", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "C7", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "   close the producer with `final:true` and require `released:true`, then read\n   `\"$API\" runs list --closed 1`", "new": "   close the producer with `final:false`, then read\n   `\"$API\" runs list --closed 1`", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "C8", "file": "ccd/coordinator-skill/SKILL.md", "old": "`references/wave-lifecycle.md` §5 step 6 opens; until then it stands.", "new": "the lifecycle reference opens; until then it stands.", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "C9", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "successor is opened only after the predecessor's PR measures merged", "new": "successor is opened only after the predecessor's PR is reviewed", "tests": ["test/coordinator-skill.test.ts"]}
]
```

```bash
git add ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md \
  server/test/coordinator-skill.test.ts README.md CLAUDE.md
git commit -m "$(cat <<'MSG'
feat(skills): coordinator clause 15, and a fresh workspace per wave, gated

Landing-order spec §5.1. The coordinator never calls update-branch and never
writes rulesets, branch protection, auto-merge or allow_update_branch; it
sends a rebase-check or other conflict-sync request only on a conflict it
measured, and beyond that asks for an absorb only as a land-sync to the PR it
named next in a strict repository or as an ejection naming the recorded base
sha — the two fix-round shapes worker clause 16's third trigger reads; it
merges main into no workspace but its own, and commits programme ledgers on
its own ledger PR — the ledger was the hottest overlap file in three
repositories. update-branch is counted across the whole coordinator corpus,
licensed once. The pin moves 14 -> 15 with README.md and CLAUDE.md in the
same commit.

wave-lifecycle §5 step 6 — a same-project successor opens WITHOUT sessionId
once its predecessor's PR measures merged, so dispatch mints a fresh child —
is written GATED on `ccd caps` listing reclaim-v1 (child-reclamation's
reclaim-on-close wave, not yet merged); until then step 3's same-project arm
stands, and SKILL.md's arm points at the gate.
MSG
)"
```

---

### Task 5: The PreToolUse advisory on a sync of main

**Model routing:** `sonnet`, effort `high` — the hot path of every fleet session.

**Files:**
- Modify: `ccd/session-hook.sh` — one block directly after the graph arm's closing `fi` (the arm whose last branch ends `pre_json=$(_hook_nudge_json "$nreason") || pre_json=""`), before `if [[ "$event" == SubagentStart || "$event" == SubagentStop ]]; then` (≈3116)
- Test: `server/test/session-hook-sync-advisory.test.ts` (new)

**Interfaces:**
- Consumes: `$event`, `$tool` (set by the PreToolUse and PermissionRequest arms), `$payload`, `$pre_json` and `_hook_nudge_json` — all already in the file.
- Produces: on a PreToolUse Bash call whose command has `git` in command position and merges, pulls or rebases `main`/`origin/main`/`origin main`/`origin/HEAD`/`origin HEAD` (the slash forms optionally quoted) into the current branch, or runs `gh pr update-branch` / the REST `/update-branch` / the GraphQL `updatePullRequestBranch`, ONE stdout line `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"ccrc landing advisory: …"}}` — never a `permissionDecision`. The `LANDING_UB_RE` line and the prefilter's branch-update line are the detector, one of the two spellings Task 6's absence pin licenses line for line; no other line of the block spells the word. Wave 2 adds its deny on `gh pr merge` beside this block, not inside it (its test command `git merge origin/main && gh pr merge 42` still advises here — measured).

- [ ] **Step 1: Write the failing test**

Create `server/test/session-hook-sync-advisory.test.ts`:

```ts
// The landing-order advisory (spec 2026-09-23 §5.1, "The hook reaches sessions
// the skills do not"): on a Bash call that merges, pulls or rebases `main` into
// the current branch — or asks GitHub to do it with update-branch — the
// PreToolUse arm of `ccd/session-hook.sh` emits `additionalContext` naming the
// three triggers and the probe command. It NEVER denies: 27% of sync episodes
// came from sessions that load no ccrc skill, and this is the only text those
// sessions see; a deny would be a merge gate this spec does not ship.
//
// A FILE OF ITS OWN, not a describe in `session-hook.test.ts`, for two measured
// reasons: that suite is a known load flake (CLAUDE.md), and it is itself a
// CITED file whose lines the frozen compaction-card corpus names up to
// `:7043-7056` — every line added above that moves an anchor. The harness below
// is the same one it uses (fixture HOME, stub tmux on PATH, payload on stdin).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-hook-sync-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.generation'), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho "cc-demo-quiet-basin"\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const hook = (payload: object): { stdout: string; stderr: string } => {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242',
      CCRC_SESSION_GENERATION: GENERATION },
  });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  return { stdout: r.stdout, stderr: r.stderr };
};
const bash = (command: string): object =>
  ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: home });
/** Exactly one line of JSON on stdout, or a failed assertion. */
const oneLine = (stdout: string): any => {
  const lines = stdout.trim().split('\n').filter((l) => l !== '');
  expect(lines, 'the hook printed nothing, or more than one line').toHaveLength(1);
  return JSON.parse(lines[0]!);
};

const SYNCS = [
  'git merge origin/main',
  'git merge --no-edit origin/main',
  'git pull origin main',
  'git pull --rebase origin main',
  'git rebase origin/main',
  'git -C /w/demo merge origin/main',
  'cd /w/demo && git merge origin/main && npm test',
  'git fetch origin && git merge -X theirs origin/HEAD',
  'git merge main',
  'gh pr update-branch 42',
  'gh api -X PUT repos/o/r/pulls/42/update-branch',
  // The review round's additions: a quoted ref, git's global options, an
  // env-var prefix, a newline separator, the remote's HEAD by name, and the
  // GraphQL spelling of GitHub's branch update.
  'git merge "origin/main"',
  "git merge 'origin/main'",
  'git -c merge.conflictstyle=diff3 merge origin/main',
  'git --no-pager merge origin/main',
  'GIT_EDITOR=true git merge origin/main',
  'git status\ngit merge origin/main',
  'git pull origin HEAD',
  `gh api graphql -f query='mutation { updatePullRequestBranch(input: {pullRequestId: "X"}) { clientMutationId } }'`,
];
const NOT_SYNCS = [
  'git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD',
  'git merge-base --is-ancestor HEAD origin/main',
  'git fetch origin main',
  'git log --oneline origin/main..HEAD',
  'git diff origin/main',
  'git merge feature/other',
  'git checkout main-feature',
  'echo "git merge origin/main"',
  'git pull',
  // A sync MENTIONED, not run: `git` is not in command position in any of
  // these, so the separator rule keeps them silent.
  'git commit -m "Workers now git merge origin/main only on a conflict"',
  "echo 'run git rebase origin/main first'",
  'gh pr comment 5 --body "please git merge origin/main and re-run"',
  'git pull origin feature/x',
];

describe('session-hook: the landing-order advisory on a sync of main', () => {
  it.each(SYNCS)('advises on `%s` — additionalContext, never a decision', (command) => {
    const env = oneLine(hook(bash(command)).stdout);
    const out = env.hookSpecificOutput;
    expect(out.hookEventName).toBe('PreToolUse');
    expect(out, 'the advisory never denies, asks or allows').not.toHaveProperty('permissionDecision');
    const text: string = out.additionalContext;
    // The three triggers, each by the phrase that names it, and the probe.
    expect(text).toContain('three triggers');
    expect(text).toContain('(1) the branch conflicts');
    expect(text).toContain('(2) a required check on the PR is red while main');
    expect(text).toContain('(3) the coordinator');
    expect(text).toContain('git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD');
    // Both halves of the conflict answer, in clause 16's words: git 2.43 exits
    // 1 for an unresolvable ref too, so "exit 1" alone would license a typo.
    expect(text).toContain('exit 1 with a tree id on the first line');
    expect(text).toContain('any other answer is unmeasured and licenses nothing');
  });

  it.each(NOT_SYNCS)('stays silent on `%s`', (command) => {
    expect(hook(bash(command)).stdout).toBe('');
  });

  it('stays silent when the tool is not Bash, even when its input carries a sync command', () => {
    // The tool NAME is the one guard: the command is read from `tool_input`
    // whatever the tool, so this payload reaches the regex unless the name
    // stops it first.
    expect(hook({ hook_event_name: 'PreToolUse', tool_name: 'Task',
      tool_input: { prompt: 'sync the branch', command: 'git merge origin/main' }, cwd: home }).stdout).toBe('');
  });

  // PermissionRequest is the one that bites: its arm reads `tool` exactly as
  // PreToolUse's does, so only the EVENT test keeps a PreToolUse envelope off
  // a permission prompt for the same Bash call.
  it.each(['PostToolUse', 'PermissionRequest'])('stays silent on %s — the advisory is for the call about to run', (event) => {
    expect(hook({ hook_event_name: event, tool_name: 'Bash',
      tool_input: { command: 'git merge origin/main' }, cwd: home }).stdout).toBe('');
  });

  it('still writes the session state it always wrote, and says nothing on stderr', () => {
    const r = hook(bash('git merge origin/main'));
    expect(r.stderr).toBe('');
    const state = JSON.parse(fs.readFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.hookstate.json'), 'utf8'));
    expect(state.state).toBe('working');
    expect(state.event).toBe('PreToolUse');
  });

  it('does not depend on the graph gate: it advises with the gate switched off and a hookstate that will not parse', () => {
    // The graph arm is skipped for BOTH conditions (`$GRAPH_GATE_OFF`, and
    // `hs_unreadable`); the advisory reads neither.
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'graph-gate-off'), '');   // `$GRAPH_GATE_OFF`
    fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.hookstate.json'), '{not json');
    const env = oneLine(hook(bash('git pull origin main')).stdout);
    expect(env.hookSpecificOutput.additionalContext).toContain('three triggers');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook-sync-advisory.test.ts`

Expected: FAIL — `Tests 20 failed | 17 passed (37)` (measured at `af64d9d2`): all nineteen `advises on …` cases and "does not depend on the graph gate…" (`the hook printed nothing, or more than one line: expected [] to have a length of 1 but got +0`); the thirteen `stays silent` cases, the non-Bash case, both event cases and the state case pass today and must stay passing.

- [ ] **Step 3: Insert the block**

Locate the graph arm's end by content — the line `    pre_json=$(_hook_nudge_json "$nreason") || pre_json=""` followed by `  fi` and `fi` — and insert directly after that `fi` and its following blank line (so the new block is followed by one blank line and then `if [[ "$event" == SubagentStart || "$event" == SubagentStop ]]; then`):

```bash
# ── THE LANDING-ORDER ADVISORY (landing-order spec 2026-09-23 §5.1) ─────────
# A Bash call that merges, pulls or rebases `main` into the current branch —
# or asks GitHub to do the same from its side (the Update branch button's
# `gh pr` verb, its REST route or its GraphQL mutation) — gets
# `additionalContext` naming the three triggers worker clause 16 licenses an
# absorption on, and the probe that measures the first. ADVICE, NEVER A
# DECISION: 27% of the fleet's sync episodes (spec §1, item 8) came from
# sessions that load no ccrc skill, and this text is the only thing those
# sessions see; the call proceeds either way.
#
# OUTSIDE THE GRAPH ARM ON PURPOSE. That arm runs only when the hookstate
# parsed, the session has not queried the graph, and the gate's kill-switch is
# absent — three conditions that have nothing to do with a sync of main. So
# this block reads none of them, and a test pins that it advises with the gate
# switched off and the hookstate unreadable.
#
# ONE LINE PER EVENT, still (`pre_json`, printed once at the end of the file):
# a deny or a nudge the graph arm already built wins, and this block says
# nothing. They cannot meet on one call in practice — the gate reads a search
# at the HEAD of the line, and a sync is `git`, not a search.
#
# ORDER IS BUDGET, as in the arms above: the tool name is already in hand, the
# glob tests over the raw payload cost no fork, and only a payload carrying
# `main` or `origin` AND a sync verb, or GitHub's branch-update spelling, pays
# the one jq that reads the command. The regexes are matched against the
# COMMAND, never the payload, so a `Write` of a file that merely mentions a
# merge stays silent.
#
# THE SHAPE: `git` IN COMMAND POSITION — at the start of the command or after
# a separator (`;`, `&`, `|`, `(`, `{`, a newline), past any `VAR=value`
# prefixes — then any global options (`-C <dir>`, `-c <k=v>`, `--no-pager`,
# `--x=y`), one of the three verbs, any arguments, then `main`, `origin/main`,
# `origin main`, `origin/HEAD` or `origin HEAD` (the slash forms may be quoted)
# as a whole word. Command position is what keeps a MENTION silent: a commit
# message, an `echo`, or a PR comment that quotes a sync puts a quote or a
# word before `git`, never a separator. The verb needs whitespace after it, so
# `git merge-tree` (the probe itself) and `git merge-base` never match. A
# command that merges main by another spelling (`FETCH_HEAD`, `git merge
# origin`, a local ref of another name) is not advised — this is advice, and a
# miss costs one ritual sync, which is the status quo.
LANDING_SYNC_RE='(^|[;&|({'$'\n''])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git([[:space:]]+(-[Cc][[:space:]]+[^[:space:]]+|--[a-z-]+(=[^[:space:]]+)?))*[[:space:]]+(merge|pull|rebase)([[:space:]]+[^[:space:];&|]+)*[[:space:]]+(origin/main|origin[[:space:]]+main|origin/HEAD|origin[[:space:]]+HEAD|main|"(origin/main|origin/HEAD|main)"|'\''(origin/main|origin/HEAD|main)'\'')([[:space:];&|)]|$)'
LANDING_UB_RE='gh[[:space:]]+pr[[:space:]]+update-branch|/update-branch([^A-Za-z0-9_-]|$)|updatePullRequestBranch'
if [[ "$event" == PreToolUse && -z "$pre_json" && "${tool:-}" == Bash ]] \
   && [[ ( ( "$payload" == *main* || "$payload" == *origin* ) \
           && ( "$payload" == *merge* || "$payload" == *pull* || "$payload" == *rebase* ) ) \
         || "$payload" == *update-branch* || "$payload" == *updatePullRequestBranch* ]]; then
  lcmd=$(jq -r '.tool_input.command // "" | tostring' \
    <<<"$payload" 2>/dev/null) || lcmd=""
  if [[ -n "$lcmd" ]] && { [[ "$lcmd" =~ $LANDING_SYNC_RE ]] || [[ "$lcmd" =~ $LANDING_UB_RE ]]; }; then
    lreason='ccrc landing advisory: this command brings main into the current branch. Absorb main only on one of three triggers:'
    lreason+=' (1) the branch conflicts — probe with `git fetch origin && git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD`: exit 1 with a tree id on the first line is a conflict, exit 0 is clean, and any other answer is unmeasured and licenses nothing;'
    lreason+=" (2) a required check on the PR is red while main's latest push run of the same required job is green;"
    lreason+=" (3) the coordinator's fix-round mail names this PR ejected from the landing line with a base sha, or next to land in a strict-protection repository."
    lreason+=' Otherwise leave main alone: a clean branch lands as it is, and every needless sync restarts CI.'
    lreason+=' When you do absorb: `git merge` only — never a rebase, a force-push or the Update branch of GitHub (its button, `gh pr` verb or API) — and on a conflict in a `# ccrc:generated` stamp line, take either side of that line only, resolve the rest of the file as source, then run `~/.local/bin/ccrc restamp <file>`.'
    pre_json=$(_hook_nudge_json "$lreason") || pre_json=""
  fi
fi
```

The advisory's two quoted phrases — `exit 1 with a tree id on the first line` and `any other answer is unmeasured and licenses nothing` — are clause 16's rule in the words the test reads, BOTH asserted (mutation H9 reds the first); change neither without changing both. Its last sentence carries clause 16's stamp-LINE rule and the launcher's installed path (Pre-flight findings 13–14). No line of the block but `LANDING_UB_RE` and the prefilter's last line spells `update-branch`: the comments and the advisory text say "the Update branch of GitHub", because Task 6's pin licenses those two lines and no others.

- [ ] **Step 4: Pay the citation tax (S6-R11)**

```bash
SCRATCH=<your scratchpad, absolute>
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD --files ccd/session-hook.sh
sed -n 2900p ccd/session-hook.sh
```

Expected: `byFile['ccd/session-hook.sh'] stated 21 base 21 tree 21`, total 195, empty compositions; and line 2900 still reads `      if _hook_emit_context "$CARD" "$CARD_COMPACT" && [ -n "$CARD_COMPACT" ]; then _hook_compact_mark_served || true; fi` — README's one anchor into this file, which the insertion must stay below. If your base moved that line, re-point README's `ccd/session-hook.sh:<n>` to the line those bytes now occupy (README is repaired by content, never counted). (Re-measured at `af64d9d2` with the revised, longer block and every other task's edit in: unmoved.)

- [ ] **Step 5: Run the tests to verify they pass**

Each line is its own call, run from the worktree root:

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook-sync-advisory.test.ts test/macos-platform.test.ts test/claims-advisory.test.ts test/routing-env-census.test.ts test/single-definition.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
```

Expected: first run PASS (`session-hook-sync-advisory` 37/37; `macos-platform` `58 passed | 10 skipped (68)` — it scans the hook for GNU-only spellings, and the block uses bash `[[ =~ ]]`, `$'\n'` and `jq` only; `claims-advisory` 2/2; `routing-env-census` 3/3; `single-definition` 214/214 — 160 at `af64d9d2`, 214 at `08701c22` after main's #176 grew that file (`git log a3a93b41..b501698a -- server/test/single-definition.test.ts`), measured 2026-09-24); second run `333 passed (333)` — it is a known load flake, so a red there is re-run IN ISOLATION before it is called a break (prototype: 111.7 s, green first time; green again at `af64d9d2` with the revised block).

- [ ] **Step 6: Mutation check, then commit**

| # | Exact edit in `ccd/session-hook.sh` | Expected red (measured at `af64d9d2`) |
|---|---|---|
| H1 | `    pre_json=$(_hook_nudge_json "$lreason") \|\| pre_json=""` → `    :` | `20 failed \| 17 passed (37)` — every `advises on …` case and the gate-independence case, `the hook printed nothing, or more than one line` |
| H2 | `_hook_nudge_json "$lreason"` → `_hook_deny_json "$lreason"` | `20 failed \| 17 passed (37)` — `the advisory never denies, asks or allows: expected { hookEventName: 'PreToolUse', …(2) } to not have property "permissionDecision"` |
| H3 | `(merge\|pull\|rebase)([[:space:]]+[^[:space:];&\|]+)*[[:space:]]+(origin/main` → `(merge\|pull\|rebase)([^;&\|]*)[[:space:]]+(origin/main` | "stays silent on `git merge-tree …`" and "stays silent on `git merge-base …`" (2 failed) |
| H4 | drop ` && "${tool:-}" == Bash` from the block's `if` | "stays silent when the tool is not Bash, even when its input carries a sync command" (1 failed) |
| H5 | add ` && "$hs_unreadable" -eq 0` to the block's `if` | "does not depend on the graph gate…" (1 failed) |
| H6 | `LANDING_UB_RE='gh[[:space:]]+pr…'` → `LANDING_UB_RE='^$'` | the three branch-update cases — `gh pr`, REST, GraphQL (3 failed) |
| H7 | drop ` \|\| "$payload" == *origin*` from the prefilter | "advises on `git fetch origin && git merge -X theirs origin/HEAD`" and "advises on `git pull origin HEAD`" (2 failed) |
| H8 | drop `"$event" == PreToolUse && ` from the block's `if` | "stays silent on PermissionRequest…" (1 failed; the PostToolUse case stays green: `tool` is unset there — Pre-flight finding 4) |
| H9 | advisory text `exit 1 with a tree id on the first line is a conflict` → `exit 1 is a conflict` | `19 failed \| 18 passed (37)` — every `advises on …` case, `expected 'ccrc landing advisory: this command b…' to contain 'exit 1 with a tree id on the first li…'` |
| H10 | the leading class `(^\|[;&\|({'$'\n''])[[:space:]]*(` → `(^\|[;&\|({[:space:]'$'\n''])[[:space:]]*(` (whitespace before `git` re-admitted: `git` no longer in command position) | the three MENTION cases — the `git commit -m "…"`, the `echo '…'` and the `gh pr comment … --body "…"` (3 failed) |
| H11 | the global-options group `git([[:space:]]+(-[Cc][[:space:]]+[^[:space:]]+\|--[a-z-]+(=[^[:space:]]+)?))*` → `git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?` | "advises on `git -c merge.conflictstyle=diff3 merge origin/main`" and "advises on `git --no-pager merge origin/main`" (2 failed) |
| H12 | drop `\|updatePullRequestBranch` from `LANDING_UB_RE` | "advises on `gh api graphql -f query='mutation { updatePullRequestBranch(…) … }'`" (1 failed) |

Rows (`$SCRATCH/mut-task5.json`):

```json
[
 {"id": "H1", "file": "ccd/session-hook.sh", "old": "    pre_json=$(_hook_nudge_json \"$lreason\") || pre_json=\"\"\n", "new": "    :\n", "tests": ["test/session-hook-sync-advisory.test.ts"]},
 {"id": "H2", "file": "ccd/session-hook.sh", "old": "    pre_json=$(_hook_nudge_json \"$lreason\") || pre_json=\"\"\n", "new": "    pre_json=$(_hook_deny_json \"$lreason\") || pre_json=\"\"\n", "tests": ["test/session-hook-sync-advisory.test.ts"]},
 {"id": "H3", "file": "ccd/session-hook.sh", "old": "(merge|pull|rebase)([[:space:]]+[^[:space:];&|]+)*[[:space:]]+(origin/main", "new": "(merge|pull|rebase)([^;&|]*)[[:space:]]+(origin/main", "tests": ["test/session-hook-sync-advisory.test.ts"]},
 {"id": "H4", "file": "ccd/session-hook.sh", "old": "if [[ \"$event\" == PreToolUse && -z \"$pre_json\" && \"${tool:-}\" == Bash ]] \\\n   && [[ ( ( \"$payload\" == *main*", "new": "if [[ \"$event\" == PreToolUse && -z \"$pre_json\" ]] \\\n   && [[ ( ( \"$payload\" == *main*", "tests": ["test/session-hook-sync-advisory.test.ts"]},
 {"id": "H5", "file": "ccd/session-hook.sh", "old": "if [[ \"$event\" == PreToolUse && -z \"$pre_json\" && \"${tool:-}\" == Bash ]] \\\n   && [[ ( ( \"$payload\" == *main*", "new": "if [[ \"$event\" == PreToolUse && -z \"$pre_json\" && \"${tool:-}\" == Bash && \"$hs_unreadable\" -eq 0 ]] \\\n   && [[ ( ( \"$payload\" == *main*", "tests": ["test/session-hook-sync-advisory.test.ts"]},
 {"id": "H6", "file": "ccd/session-hook.sh", "old": "LANDING_UB_RE='gh[[:space:]]+pr[[:space:]]+update-branch|/update-branch([^A-Za-z0-9_-]|$)|updatePullRequestBranch'", "new": "LANDING_UB_RE='^$'", "tests": ["test/session-hook-sync-advisory.test.ts"]},
 {"id": "H7", "file": "ccd/session-hook.sh", "old": "   && [[ ( ( \"$payload\" == *main* || \"$payload\" == *origin* ) \\\n", "new": "   && [[ ( ( \"$payload\" == *main* ) \\\n", "tests": ["test/session-hook-sync-advisory.test.ts"]},
 {"id": "H8", "file": "ccd/session-hook.sh", "old": "if [[ \"$event\" == PreToolUse && -z \"$pre_json\" && \"${tool:-}\" == Bash ]] \\\n   && [[ ( ( \"$payload\" == *main*", "new": "if [[ -z \"$pre_json\" && \"${tool:-}\" == Bash ]] \\\n   && [[ ( ( \"$payload\" == *main*", "tests": ["test/session-hook-sync-advisory.test.ts"]},
 {"id": "H9", "file": "ccd/session-hook.sh", "old": "exit 1 with a tree id on the first line is a conflict", "new": "exit 1 is a conflict", "tests": ["test/session-hook-sync-advisory.test.ts"]},
 {"id": "H10", "file": "ccd/session-hook.sh", "old": "LANDING_SYNC_RE='(^|[;&|({'$'\\n''])[[:space:]]*(", "new": "LANDING_SYNC_RE='(^|[;&|({[:space:]'$'\\n''])[[:space:]]*(", "tests": ["test/session-hook-sync-advisory.test.ts"]},
 {"id": "H11", "file": "ccd/session-hook.sh", "old": "git([[:space:]]+(-[Cc][[:space:]]+[^[:space:]]+|--[a-z-]+(=[^[:space:]]+)?))*[[:space:]]+(merge", "new": "git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+(merge", "tests": ["test/session-hook-sync-advisory.test.ts"]},
 {"id": "H12", "file": "ccd/session-hook.sh", "old": "|/update-branch([^A-Za-z0-9_-]|$)|updatePullRequestBranch'", "new": "|/update-branch([^A-Za-z0-9_-]|$)'", "tests": ["test/session-hook-sync-advisory.test.ts"]}
]
```

```bash
git add ccd/session-hook.sh server/test/session-hook-sync-advisory.test.ts
git commit -m "$(cat <<'MSG'
feat(hook): advise, never deny, on a Bash call that syncs main

Landing-order spec §5.1. 27% of the fleet's sync episodes came from sessions
that load no ccrc skill; the hook reaches them. On a PreToolUse Bash command
whose git sits in command position and merges, pulls or rebases main into the
current branch — or that asks GitHub to (gh pr update-branch, the REST route,
the GraphQL mutation) — it emits additionalContext naming the three triggers
worker clause 16 licenses and the probe that measures the first, both halves
of its conflict answer included. A sync only MENTIONED (a commit message, an
echo, a PR comment) stays silent. Never a permissionDecision; one line per
event, and a graph-arm deny or nudge wins. Outside the graph arm, so the
gate's kill-switch and an unreadable hookstate do not silence it; keyed on
the event as well as the tool, because PermissionRequest reads the same tool
name. The regex line and one prefilter line are the block's only spelling of
the branch-update word — the detector the absence pin licenses.

S6-R11: the block sits below README's :2900, this file's highest cited
anchor; the census did not move (21 / 195, empty composition, measured).
MSG
)"
```

---

### Task 6: `update-branch` absent from executable source

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Test: `server/test/update-branch-absent.test.ts` (new)

**Interfaces:**
- Consumes: the index (`git ls-files`), and the two licensed lines Tasks 1 and 5 introduced — which is why this task comes after Task 5.
- Produces: a literal pin over the spec's executable-source set (spec §5.1 as reconciled 2026-09-24: `server/src`, `agent/src`, `shared/`, `deploy/`, `ccd/ccd`, `ccd/ccd-*`, `ccd/ccrc`, `ccd/session-hook.sh`), derived at test time, absent but for exactly two licensed spellings, each pinned line for line: the advisory's detector (`ccd/session-hook.sh`: `LANDING_UB_RE` and the prefilter's branch-update line) and the instrument's classifier (`deploy/measure-landing.py`: `GH_UPDATE` and `UPD`). Wave 2 (the hook's deny on `gh pr merge`) and wave 5 (`land-candidate`, `ccd-land-probe`) inherit it: a `ccd-*` sibling or `deploy/` file they add is scanned the day it is tracked, and a wave that must touch a licensed line changes the licence in the same commit.

- [ ] **Step 1: Write the test**

Create `server/test/update-branch-absent.test.ts`:

```ts
// `update-branch` is ABSENT from executable source (landing-order spec
// 2026-09-23 §5.1, "Pins"). GitHub's update-branch pushes a merge of main onto
// a PR's head from the REMOTE side: it restarts CI, it is not a clean-merge
// proof anyone measured, and it breaks the workspace↔PR binding (`is_ours`
// binds a PR by ancestry from the workspace's LOCAL tip, so a remote-made
// descendant rebinds the sweep to an older PR and the close refuses
// `pr-regressed` — run 47, 2026-09-16). 183 of them landed in one 55.7-hour
// window. No executable path in this tree may ever issue one.
//
// A LITERAL pin, deliberately: it reds on the spelling in any form the fleet
// could run — `gh pr update-branch`, the REST path's `/update-branch`, the
// GraphQL `updatePullRequestBranch`, and `allow_update_branch`, the repository
// setting a script could flip (the pattern takes `-` or `_`, any case). It
// cannot see a spelling assembled at run time from fragments; nothing here
// claims it can. Comments count too: a comment is where the next author copies
// a command from.
//
// TWO SPELLINGS ARE LICENSED, and pinned LINE FOR LINE as the only ones —
// neither calls anything: the advisory's DETECTOR in `ccd/session-hook.sh`
// (the regex that recognises the call, and the prefilter glob in front of it),
// and the CLASSIFIER in the read-only instrument `deploy/measure-landing.py`
// (the label it gives a past GitHub-made merge, and the regex that finds one
// in a transcript). EQUALITY, not a ceiling: a new mention anywhere in the set
// reds, a changed detector or classifier line reds, and a licensed line that
// disappeared reds too — the licence names what the file must still carry.
//
// THE SKILLS ARE THE OTHER HALF, and there the word is COUNTED, not absent:
// worker clause 16 and coordinator clause 15 each name it once, to forbid it
// (`worker-skill.test.ts`, `coordinator-skill.test.ts`).
//
// THE SET IS THE SPEC'S, DERIVED from the index, never a hand-kept list of
// files: every tracked file under `server/src`, `agent/src`, `shared/` and
// `deploy/`, `ccd/ccd`, `ccd/ccrc`, `ccd/session-hook.sh`, and every
// `ccd/ccd-*` sibling tracked today or tomorrow. TRACKED, because `deploy/`
// also holds gitignored files a checkout makes — `__pycache__/` bytecode that
// loading the instrument as a module writes, the box's mail token — which are
// not source and must not be read. The corpus is its own control: a pathspec
// that silently stopped matching would make the absence vacuous, so it carries
// a floor and named members.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FORBIDDEN = /update[-_]branch|updatePullRequestBranch/i;

/** The executable-source set spec §5.1 names, derived from the index. */
const executableSource = (): string[] => {
  const r = spawnSync('git', ['ls-files', '-z', '--', 'server/src', 'agent/src', 'shared', 'deploy',
    'ccd/ccd', 'ccd/ccrc', 'ccd/session-hook.sh', 'ccd/ccd-*'], { cwd: root, encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.split('\0').filter((f) => f !== '').sort();
};

/** The two licensed spellings, line for line. A change to either line is a
 *  change to this licence, made in the same commit, on purpose. */
const LICENSED: Record<string, string[]> = {
  'ccd/session-hook.sh': [
    "LANDING_UB_RE='gh[[:space:]]+pr[[:space:]]+update-branch|/update-branch([^A-Za-z0-9_-]|$)|updatePullRequestBranch'",
    '         || "$payload" == *update-branch* || "$payload" == *updatePullRequestBranch* ]]; then',
  ],
  'deploy/measure-landing.py': [
    "GH_UPDATE = 'update-branch'",
    'UPD = re.compile(r"gh\\s+pr\\s+update-branch|/update-branch\\b")',
  ],
};

describe('update-branch is absent from executable source (landing-order spec §5.1)', () => {
  it('the derived set is its own control — a floor and named members', () => {
    const set = executableSource();
    expect(set.length, 'the pathspec found almost nothing — the absence below would be vacuous')
      .toBeGreaterThanOrEqual(150);
    for (const f of ['ccd/ccd', 'ccd/ccrc', 'ccd/session-hook.sh', 'ccd/ccd-pool-sync', 'ccd/ccd-tmp-sweep',
      'server/src/coord/routes.ts', 'agent/src/whitelist.ts', 'shared/api.ts', 'shared/mark.mjs',
      'deploy/deploy.sh', 'deploy/measure-landing.py']) {
      expect(set, `${f} is executable source and must be scanned`).toContain(f);
    }
  });

  it('spells update-branch only in the two licensed lines — the detector and the classifier', () => {
    const found: Record<string, string[]> = {};
    for (const f of executableSource()) {
      const lines = readFileSync(path.join(root, f), 'utf8').split('\n').filter((l) => FORBIDDEN.test(l));
      if (lines.length > 0) found[f] = lines;
    }
    expect(found, 'executable source names update-branch outside its two licensed spellings; the fleet never issues one')
      .toEqual(LICENSED);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd server && ./node_modules/.bin/vitest run test/update-branch-absent.test.ts`

Expected: PASS, `2 passed (2)` — measured at `af64d9d2` with Tasks 1–5 in, and again 2026-09-24 at `08701c22` (the set is 189 tracked files there, 180 at `af64d9d2`; `deploy/measure-landing.py` counts only once it is tracked, which Task 1's commit did). The property already holds, so this pin is GREEN FROM BIRTH and its red-first proof is the mutation table below, run before the commit. Two properties it does NOT have, by design: an untracked or gitignored file is not read (measured: a planted `deploy/__pycache__/measure-landing.cpython-312.pyc` spelling the word twice stays `2 passed (2)`), and a file added under `deploy/` but not yet `git add`ed is not scanned until it is.

- [ ] **Step 3: Mutation check, then commit**

| # | Exact edit | Expected red (measured at `af64d9d2`) |
|---|---|---|
| A1 | `ccd/ccd-tmp-sweep`: after its shebang add `# gh pr update-branch "$pr"` | "spells update-branch only in the two licensed lines…" — `executable source names update-branch outside its two licensed spellings; the fleet never issues one: expected { …(3) } to deeply equal { …(2) }` |
| A2 | `agent/src/whitelist.ts`: above its first import add `// allow_update_branch` | same case, same message — the `_` spelling is caught |
| A3 | `ccd/ccd`: after its shebang add `# gh api -X PUT repos/o/r/pulls/1/update-branch` | same case, same message |
| A4 | the test itself: pathspec `'ccd/ccd-*'` → `'ccd/cdd-*'` (the set silently stops matching the siblings) | "the derived set is its own control…" — `ccd/ccd-pool-sync is executable source and must be scanned` |
| A5 | `shared/mark.mjs`: above its first line add `// never gh pr update-branch` | the licence case, `{ …(3) }` — `shared/` is in the set |
| A6 | `ccd/session-hook.sh`: above `# ── THE LANDING-ORDER ADVISORY` add `# see also: gh pr update-branch` | the licence case — `expected { …(2) } to deeply equal { …(2) }` (the hook's list gains a third line: a mention beside the detector is still a mention) |
| A7 | `ccd/ccrc`: after its shebang add `# gh pr update-branch` | the licence case, `{ …(3) }` |
| A8 | `deploy/measure-landing.py`: above its `import` line add `# counts update-branch commits` | the licence case, `{ …(2) }` (the classifier's list gains a line) |
| A9 | the prefilter's licensed line: drop ` \|\| "$payload" == *updatePullRequestBranch*` | the licence case, `{ …(2) }` — a CHANGED detector line reds too, so the licence is "pinned as such", not merely counted |

Each row `1 failed | 1 passed (2)`.

Rows (`$SCRATCH/mut-task6.json`; A3 edits `ccd/ccd` and the runner restores it byte-for-byte, so no re-stamp is owed):

```json
[
 {"id": "A1", "file": "ccd/ccd-tmp-sweep", "old": "#!/usr/bin/env bash\n", "new": "#!/usr/bin/env bash\n# gh pr update-branch \"$pr\"\n", "tests": ["test/update-branch-absent.test.ts"]},
 {"id": "A2", "file": "agent/src/whitelist.ts", "old": "import { realpath } from 'node:fs/promises';\n", "new": "// allow_update_branch\nimport { realpath } from 'node:fs/promises';\n", "tests": ["test/update-branch-absent.test.ts"]},
 {"id": "A3", "file": "ccd/ccd", "old": "#!/usr/bin/env bash\n", "new": "#!/usr/bin/env bash\n# gh api -X PUT repos/o/r/pulls/1/update-branch\n", "tests": ["test/update-branch-absent.test.ts"]},
 {"id": "A4", "file": "server/test/update-branch-absent.test.ts", "old": "'ccd/session-hook.sh', 'ccd/ccd-*'], { cwd: root", "new": "'ccd/session-hook.sh', 'ccd/cdd-*'], { cwd: root", "tests": ["test/update-branch-absent.test.ts"]},
 {"id": "A5", "file": "shared/mark.mjs", "old": "// The provenance marker — lets a writer", "new": "// never gh pr update-branch\n// The provenance marker — lets a writer", "tests": ["test/update-branch-absent.test.ts"]},
 {"id": "A6", "file": "ccd/session-hook.sh", "old": "# ── THE LANDING-ORDER ADVISORY", "new": "# see also: gh pr update-branch\n# ── THE LANDING-ORDER ADVISORY", "tests": ["test/update-branch-absent.test.ts"]},
 {"id": "A7", "file": "ccd/ccrc", "old": "#!/usr/bin/env bash\n# ccrc — the lifecycle CLI", "new": "#!/usr/bin/env bash\n# gh pr update-branch\n# ccrc — the lifecycle CLI", "tests": ["test/update-branch-absent.test.ts"]},
 {"id": "A8", "file": "deploy/measure-landing.py", "old": "import collections, glob", "new": "# counts update-branch commits\nimport collections, glob", "tests": ["test/update-branch-absent.test.ts"]},
 {"id": "A9", "file": "ccd/session-hook.sh", "old": "         || \"$payload\" == *update-branch* || \"$payload\" == *updatePullRequestBranch* ]]; then", "new": "         || \"$payload\" == *update-branch* ]]; then", "tests": ["test/update-branch-absent.test.ts"]}
]
```

```bash
git add server/test/update-branch-absent.test.ts
git commit -m "$(cat <<'MSG'
test: update-branch is absent from executable source

Landing-order spec §5.1 "Pins". GitHub's update-branch pushes a merge of main
onto a PR head from the remote side, restarts CI and breaks the workspace-PR
binding; 183 of them landed in one 55.7-hour window. A literal pin over the
spec's reconciled set — every tracked file under server/src, agent/src,
shared/ and deploy/, plus ccd/ccd, every ccd/ccd-* sibling, ccd/ccrc and
ccd/session-hook.sh — read from the index (never __pycache__ or a gitignored
token), with a floor and named members so a pathspec that stopped matching
cannot make the absence vacuous. Two spellings are licensed, line for line,
as the only ones, and neither calls anything: the advisory's detector and the
instrument's classifier. A new mention reds; a changed licensed line reds.
The skills are the other half: there the word is counted, licensed once, to
forbid it.
MSG
)"
```

---

### Task 7: Whole-branch verification, the PR, the wave-done report — and the AGENT-FIRST deploy

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified.

**Interfaces:**
- Consumes: Tasks 1–6 and Task 1's measurements.
- Produces: the wave-1 PR on this workspace's own branch; a wave-done report carrying the three prerequisites and stage 1's baselines for the coordinator's ledger. Wave 2 consumes clause 15 (it appends the native-queue sentence) and this block's neighbourhood in `session-hook.sh` (its `gh pr merge` deny).

- [ ] **Step 1: Run all three package suites, in the foreground**

Every line is its own foreground call, run from the worktree root, timeout 600000 (shell state does not survive between calls):

```bash
cd server && npm ci
cd server && ./node_modules/.bin/vitest run --shard=<k>/12    # k = 1 … 12, one call each
cd agent && npm ci && npm run test
cd pwa && npm ci && npm run test
```

Expected: PASS everywhere. If any shard is killed by the 600 s ceiling, re-run the WHOLE suite as `cd server && ./node_modules/.bin/vitest run --shard=<k>/24`, k = 1…24, one call each. Re-run a known load flake IN ISOLATION before calling it a break. Report the shard summaries and their sum.

- [ ] **Step 2: Cross-tree checks and the corpus premise**

Each line is its own call, from the worktree root:

```bash
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts test/update-branch-absent.test.ts
git diff --quiet origin/main -- docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD; echo "probe rc=$?"
```

Expected: PASS, `corpus-frozen`, and a probe answer. Clause 16's rule applies to this branch too, so absorb main ONLY on one of its triggers: the probe exits 1 with a 40-hex tree id on its first line (a conflict), or a required check on this wave's PR is red while main's latest push run of the same job is green — which is how a count-word, census or licence pin that main moved shows up, since PR CI tests the merge ref. Exit 0 is clean: leave main alone. Any other answer is unmeasured and licenses nothing. When a trigger fires: `git merge origin/HEAD` (never a rebase); on a conflict in `ccd/ccd`'s stamp line take either side of that line only and run `ccd/ccrc restamp ccd/ccd`; then re-run the citation procedure against the merge's first parent, Tasks 3–4's pins and Task 6's licence — an assertion over the merge is only true on the merged tree.

- [ ] **Step 3: The wave's own surface in one run**

Each line is its own call, from the worktree root:

```bash
cd server && ./node_modules/.bin/vitest run test/measure-landing.test.ts test/ccrc-restamp.test.ts test/ccrc-cli.test.ts test/worker-skill.test.ts test/coordinator-skill.test.ts test/update-branch-absent.test.ts test/session-hook-sync-advisory.test.ts test/ownership.test.ts test/single-definition.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: PASS (`measure-landing` 15, `ccrc-restamp` 8, `ccrc-cli` 35, `worker-skill` 45, `coordinator-skill` 152, `update-branch-absent` 2, `session-hook-sync-advisory` 37, `ownership` 14, `single-definition` 214 — each measured alone at `af64d9d2`, and re-measured 2026-09-24 at `08701c22` with `single-definition` alone moved, 160 → 214, by main's #176); the second run `7 passed | 326 skipped (333)`.

- [ ] **Step 4: Confirm the author, push, and open the PR**

```bash
git log --format='%an <%ae>' "$(git merge-base origin/main HEAD)"..HEAD | sort -u
```

Expected: exactly one line, the identity this workspace is configured to commit as — not a placeholder (Pre-flight finding 7 is what a placeholder identity costs the measurement). If the pre-push hook refuses identity residue, fix the author; never bypass the hook.

```bash
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Landing order wave 1: absorb rules, the sync advisory, ccrc restamp (AGENT-FIRST)" --body-file - <<'EOF'
Wave 1 of the landing-order programme (spec `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` §5.1, §10). **AGENT-FIRST; no server change.**

1. **Worker clause 16** — absorb `origin/main` only when the branch conflicts (probe: `git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD` exits 1 WITH a tree id on its first line — git 2.43 also exits 1 on an unresolvable ref, measured), when a required check is red while main's same job is green, or on a coordinator's fix-round naming the PR ejected or next to land. `git merge` only; never a rebase, force-push or `update-branch`; no writes to rulesets, protection, auto-merge or `allow_update_branch` (spec §4's Worker row); a generated stamp resolved by taking either side of the stamp LINE only, the rest of the file as source, then `~/.local/bin/ccrc restamp <file>`. Pin 15 → 16 with README/CLAUDE.md's count words.
2. **Coordinator clause 15** — no `update-branch`, no ruleset/protection/auto-merge/`allow_update_branch` writes, a rebase-check or other conflict-sync request only on a measured conflict, and beyond that an absorb asked only as a land-sync to the PR it named next (strict repositories) or an ejection naming the recorded base sha; programme ledgers on its own PR. Pin 14 → 15.
3. **wave-lifecycle §5 step 6** — a fresh workspace per wave, written GATED on `ccd caps` listing `reclaim-v1` (child-reclamation's reclaim-on-close wave, not yet merged).
4. **The PreToolUse advisory** in `ccd/session-hook.sh` — `additionalContext`, never a decision, on a Bash call whose `git` in command position merges/pulls/rebases main, or that asks GitHub for a branch update (`gh pr`, REST or GraphQL). A sync only mentioned — a commit message, an echo, a PR comment — stays silent.
5. **`ccrc restamp <file>`** — re-stamps a `ccrc:generated` file; refuses one with no marker, and one under `~/.local/bin` or `~/.ccrc` (a generator's own output).
6. **`update-branch`** absent from executable source — the spec's reconciled set, derived from the index: `server/src`, `agent/src`, `shared/`, `deploy/`, `ccd/ccd`, `ccd/ccd-*`, `ccd/ccrc`, `ccd/session-hook.sh` — but for its two licensed, non-calling spellings (the advisory's detector, the instrument's classifier), pinned line for line; counted in both skills.
7. **`deploy/measure-landing.py`** — the programme's read-only instrument (gh GET only, ccrc-api list verbs only, each pinned statically and through a recording stub; an unreadable input is refused or reported, never counted; the fleet is the ruled identity pair, required as `--fleet-login`); the three prerequisites spec §10 names are in the wave-done report.

Citation corpus (S6-R11): three cited files edited, census unmoved (measured).

**Deploy: `ccrc rollout --to <this merge's tag>` in its default order — fleet box first. Never `--server-first`.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 5: Report (the wave-done mail)**

Report to the coordinator, per the worker skill: the branch tip sha; the suites' results (twelve shard summaries and their sum); every mutation row's measured red; Task 1's numbers — prerequisite 1 (both readings), prerequisite 2 (the summary, the unmatched count and the truncated count, coordinators by index only), prerequisite 3 (the ruled pair's share per merge AND per PR as the baseline, the login-only share as a labelled secondary line, and the sentence "every stage-1 re-measurement passes --fleet-login with the same pair"), the fleet `update-branch` count, the six projects' ritual episodes per week, and Step 10's stage-2 figures (with the note that the archived inversion figure, 5, is retired: the committed scan reads commits, not the PR timeline's force-pushes) — with the absolute path of `$OUT` in the mail's `artifacts` (the per-repository JSON carries organisation names and logins, so it travels as a file, never in the body); the citation tax outputs of Tasks 2, 3, 4 and 5; every departure from this plan, named by what it is (the coordinator assigns numbers). Then stop: the deploy below runs after the merge, by whoever merges — the coordinator (R5).

- [ ] **Step 6: Deploy — AGENT LANE (post-merge, the coordinator, from a machine holding `~/.ccrc/deploy.env`)**

```bash
PR=<this wave's PR number>
git fetch origin main --tags
M=$(gh pr view "$PR" --json mergeCommit -q .mergeCommit.oid)
TAG=$(git tag --points-at "$M" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
echo "merge: $M  tag: ${TAG:-<none yet>}"
if [ -n "$M" ] && [ -n "$TAG" ]; then
  ccrc rollout --to "$TAG"
  echo "rollout rc=$?"
  ccrc rollout --check
else
  echo "STOP: no release tag on this PR's merge commit yet — wait for release-main.yml and re-run this block"
fi
```

Expected: both boxes report the tag, converged. A rollout exit 3 means a box moved but its doctor has FAIL lines — read them first.

Then, on the fleet box, read-only:

```bash
ccrc doctor | grep -E '^(PASS|WARN|FAIL|SKIP) skills:'
grep -c 'THE LANDING-ORDER ADVISORY' "$HOME/.cc-sessions/session-hook.sh"
~/.local/bin/ccrc restamp --help
```

Expected: `PASS skills: …` (every rostered home carries the shipped skills — clause 16, clause 15 and step 6); `1`; `usage: ccrc restamp <file>` — by the launcher's installed path, the spelling clause 16 gives a worker, because `~/.local/bin` is not on a session unit's PATH. From here every fleet session's next Bash call that syncs main receives the advisory, and every dispatched worker's next brief invokes a skill carrying clause 16.

---

## Ruled (orchestrator, 2026-09-24) — formerly open for the operator

Both questions this plan once left open were ruled with the spec gaps and are now in spec §10; the tasks above implement the rulings, and nothing is open.

1. **Which identities are "the fleet" for the repeat-absorption prerequisite — RULED: the pair.** The fleet's gh login plus the placeholder identity fleet worktrees committed under before the 2026-09-23 identity rule, both passed to the instrument as arguments (`--fleet-login`, now required). Baseline: 135/290 = 0.466 per merge, and per PR from the worker's run; login only (110/253 = 0.435) and all committers (159/357 = 0.445) are secondary lines.
2. **Whether the inversion baselines move onto the committed instrument — RULED: yes.** Stage 2's and stage 5's inversion baselines are re-derived with the committed commit-only scan (on this repository 19 pairs, 14 fleet-on-fleet); the archived g5 figure (5), which also read force-pushes from each PR's timeline, is retired with that note. No later wave ports the timeline arm.

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's deviation block is allocated by the programme coordinator at this wave's run-open (programme ledger: "Deviation blocks are minted per wave, at that wave's run-open"), and a worker never calls the allocator (worker clause 11). A departure from this plan found while executing it is named in the wave-done mail — what departed, where, and why — and the coordinator assigns its number from the block and defines it here in the same act. A session that cannot reach the coordinator names the departure by a slug in its report and nowhere in a committed file (`dtbd.test.ts` reds the concrete form).

Two deliberate absences: no block is written as a range, and no headroom accounting lives in this plan.

The pre-flight findings above are not deviations: they were measured before this plan existed and shaped it. Most departures from the spec's text that they record are now IN the reconciled spec (the probe's two-halves rule, the archive ported rather than committed verbatim, the advisory covering `update-branch`, "the fleet" as the ruled pair, the widened absence set with its two licensed spellings). Two remain beyond the spec's words, and are the coordinator's to ledger at run-open if it rules them deviations: the stamp-LINE narrowing of "take either side, then run the regenerator" (Pre-flight finding 13), and `ccrc restamp`'s refusal of a generator's own output under `~/.local/bin` or `~/.ccrc` (Review Focus 4). No number is written here for either.

---

## Review lenses

Three lenses, all `opus`, effort `high` — a fifteen-file diff (the File Structure table: seven shipped files — `ccd/ccrc`, `ccd/session-hook.sh`, the two SKILL.md files, `wave-lifecycle.md`, `README.md`, `CLAUDE.md` — the instrument, and seven test files), sized per the fleet policy's 3–5 reviewers band with one `sonnet` refute pass per finding. Nothing here destroys anything, so no `xhigh` safety lens is owed; lens 2 reads the hot path as if it were one.

1. **Skill prose and its pins (opus, high).** Clause 16 and clause 15 are byte-identical between SKILL.md and the CONTRACT literals, straight apostrophes in the worker's, none in the coordinator's; clause 16 is one line; the count words moved in SKILL.md, README.md and CLAUDE.md in the SAME commit as each clause; `update-branch` appears exactly once in each corpus (the coordinator's census reads every reference, derived); clause 16 carries spec §4's settings prohibition, the stamp-LINE rule and the launcher's installed path; clause 15's middle sentence still lets the coordinator send the land-sync and the ejection that clause 16's third trigger reads; clause 16's triggers agree with worker clause 9 (no push after wave-done — trigger 3 arrives on `merging → working`) and with the fix-round bullet in "When something is wrong"; step 6 states its gate BEFORE its rule, names the contract's own token, keeps open-before-close, and its releasing close matches what the server does for a successor that names no session; SKILL.md's pointer does not disturb the two succession-order pins; nothing in the new prose names a destructive verb or a route the server does not register.
2. **The hook, the CLI and the absence pin (opus, high).** The advisory never denies and prints at most one line per event; it forks nothing for a payload without (`main` or `origin`, and a sync verb) or a branch-update spelling; its regex advises on every spelling in `SYNCS` and on none in `NOT_SYNCS` — `git` in command position is what keeps a mention silent — and the reviewer tries three more of each, reporting any miss or false positive with the command; the absence pin's set is the spec's reconciled one, read from the index, and its two licensed spellings are the only lines of the set that spell the word; the event test and the tool test are each the only guard for their case (H8, H4); the block sits below README's `:2900` and the census did not move; `ccrc restamp` re-stamps only a `ccrc-edited` file, never adopts a `foreign` one, refuses a generator's own output under `~/.local/bin` or `~/.ccrc` and a symlink, uses the tree's own `mark.mjs`, and its three exits are distinct.
3. **The instrument and its numbers (opus, high).** `_gh` is the only gh argv and it is a GET; the path grammar refuses a flag or a method smuggled in the path; `_api` reaches only `runs list` and `mail list`; an unreadable input (an empty required set, a missing `--fleet-login`, a full mail page, a null claimant) is refused or reported, never a number; git is run for object reads only; nothing is written outside `--out`; the pure decisions match the archived instruments they port, and where the port measures differently (inversions: 19 vs 5, the archived figure now retired; whole-check red-main 120.7 h vs 111.2 h) the docstring says why; `required_state` treats a cancel as unmeasured and lets the latest attempt decide; `mail-latency` counts a mail it cannot match as unmatched, never as zero; no organisation, login or host is in the file or the plan; and Task 1's reported numbers came from the instrument's own output, on the worker's run, not from this plan.

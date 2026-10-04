# Session continuity, wave 3 — wave 2's residue, then the operator's choice survives a restart (AGENT-FIRST) Implementation Plan

> **Status: PLANNED 2026-10-04 on `main` `22f7931af` — ready for dispatch** (programme session-continuity, CCR-18;
> wave 3 = run 248, planned). The prototype was first built on `59a435f0d`; `main` then took #239 and #242, which
> touch `README.md`, `CLAUDE.md` and files this wave does not edit, so the README hunks were re-anchored and the
> citation census, the repo-wide guards, the merge recipe and this document's replay were re-measured on `22f7931af`.
>
> 1. **Prototype-first.** Every block below marked `<!-- replay: … -->` is the prototype's bytes. The whole plan was
>    applied to a fresh checkout of `22f7931af` by a replay of this document (each `replace` and `insert-above` anchor
>    asserted to match exactly once there and on `origin/main`), and the result is byte-identical to the prototype
>    tree on every file the plan touches. Each task's tests were measured red on the previous task's tree and green
>    on its own, and every mutation row was measured on the full prototype (Tasks 1–4), each mutation applied to a
>    saved copy of the file and restored from that copy (`cmp`-checked).
> 2. **Task 1 is wave 2's residue and is this wave's FIRST commit** — review 246 (run 246 of run 237, at
>    `55137231`): F1, F2, F3, F5, the worker's minors 3–5, and F6's ruled restatement of spec §9's stage-4 target
>    (programme ledger, 2026-10-03 16:38). Tasks 2–4 are spec §5.7, stage 7, exactly as written there, with the
>    readings the spec leaves open fixed and named (`## Deviations found`). Task 5 is the whole branch, the PR and
>    the AGENT-FIRST deploy.
> 3. **Deviation numbers are the coordinator's.** The block issued for this wave's WORKER is **3896 to 3905**,
>    written bare; this plan defines none. Departures are named below as slugs only.
> 4. **Revised 2026-10-04 after three review lenses** (conformance, replay, guard fidelity). Applied: a census of
>    every STOP in `ccd/ccd`, not only of the calls; the newest command NO journal row explains (spec §5.7's
>    reading); the journal's FLOOR, so an older ccd's unjournalled keystrokes are never promoted at the deploy;
>    the acknowledgement shapes the fleet's builds write (backticks since 2.1.250, `(default)`, `Ultracode on`),
>    measured read-only over the fleet box's transcripts; `unmeasured` lines where a stop could not read; the
>    value, by name, of an out-of-vocabulary command; the stage-4 row's filter written into spec §9 and put to
>    the coordinator; a forged `reset=` that can no longer crash `--stage 4`; and five new guard pins (newest of
>    two, the FIFO, the hour bound, the chain wait's position, the `(?!\d)` lookahead). The whole plan was
>    re-prototyped, re-replayed byte-for-byte onto `22f7931af`, and every red, green and mutation row re-measured.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close review 246's residue — a rescue wait ends `swap` only when `cmd_swap` actually lands, rule 3 counts
only rescues that landed, the do-not-bounce strand names its BEST account, a not-blocked tick forks nothing, a forged
`swap.log` line cannot crash or slow the history read, and §9's stage-4 target says what the design can promise — and
then make an operator's own `/model` and `/effort` survive every restart ccd makes: before each stop that a spawn
follows, ccd reads the transcript, tells its own keystrokes (journalled in `$REG/<id>.typed`, above a floor no older
command crosses) from the operator's, maps the operator's value to the route record's vocabulary, and writes it
through `cmd_route` with `actor=operator-session` — and says so whenever it could not.

**Architecture:** Task 1 edits wave 2's RESCUE POLICY section of `ccd/ccd` in place (`_rescue_policy`,
`_rescue_history`, `_rescue_target`'s comment, `_rescue_strand_cause`) and one line of `_auto_swap_check`'s rescue arm,
plus a target row in `deploy/measure-continuity.py --stage 4`. Stage 7 is one new section of `ccd/ccd`,
`# ── THE OPERATOR'S CHOICE SURVIVES A RESTART`, directly above `_route_apply_now() {` — below the frozen citation
corpus's last cited line (`ccd/ccd:19109` at `22f7931af`), so it moves no citation — holding three constants,
`_typed_note` (the journal writer, and the journal's floor), `_model_family_class` (the bash port of
`familyClassOf`), `_model_class_of` (the alias table), `_operator_choice_keep` (the promotion) and
`_operator_choice_say` (its one swap.log line); one-line journal calls in `_inject_spawn_effort` and
`_route_apply_now`; one line in `_spawn_start` that opens the journal's floor; and one call before each of the three
stops a spawn follows (`cmd_swap`, `cmd_stop`, `cmd_ws_archive`, the last one line for one line because it sits
above the corpus). The promotion reads the transcript with `grep -F -A1` piped into an inline python reader and
writes through `cmd_route` in a subshell, so no path through it can fail a stop, and every path that could lose the
operator's choice leaves an `operator-choice <id>: …` line. `deploy/measure-continuity.py` gains `--stage 7`.

**Tech Stack:** bash 5.2 (`ccd/ccd`, `set -uo pipefail`, no `-e`), python 3 (the transcript reader and
`_rescue_history` run inline under `python3 -c '…'` inside a SINGLE-quoted bash string — no `'` may appear in them),
TypeScript + vitest 4.1 (tests), python 3 (`deploy/measure-continuity.py`, read-only). Measured on bash 5.2.21 and
Python 3.12.3.

**Spec:** `docs/superpowers/specs/2026-09-23-session-continuity-design.md` — §5.4 rule 3 and §9's stage-4 row (the
residue; both amended by Task 1, rev 7), §5.7 (stage 7; amended by Task 4 with the readings fixed here), §6's
invariants (no revival; ccd is the authority; additive wire; mutation-table discipline), §9's stage-7 row, §11.
Programme ledger: `docs/superpowers/programs/session-continuity.md` (wave 3). Review 246's report:
`~/.cc-clips/ccrc-pwa-swift-harbor/review-246-55137231.md` on the fleet box (outside the repository).

---

## Global Constraints

Copied from `CLAUDE.md`, the spec and the programme ledger. Every task's requirements implicitly include this section.

- **Deploy class for THIS wave: `ccd` only, AGENT-FIRST, through ccrc's own updater.** Nothing here touches
  `server/src`, `agent/src`, `shared/` or the PWA. Nobody runs `ccrc rollout` or `ccrc update` by hand (operator
  ruling 2026-09-30); Task 5 Step 7 measures the move, read-only.
- **This programme's waves, and other programmes, edit `ccd/ccd` and land one at a time.** Every `ccd/ccd` edit
  rewrites line 2's provenance stamp, so a merge of a moved `main` always conflicts there; a wave that re-measured
  the `_reg_get` census conflicts on its comment lines too. Task 5 Step 1 resolves exactly those two, by script, in
  ONE gated block that commits nothing and aborts the merge on anything else, then re-stamps and re-measures on the
  merged tree.
- **SAFETY — sacred.** NEVER run destructive `ccd` verbs against the live host (`ws-rm`, `ws-reap`, `ws-gc --prune`,
  `ws-archive`/`ws-restore`, `ws-reclaim`). NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or
  `claude-session@*.service` directly. The only live reads this wave makes are the instrument's read-only runs over
  `~/.cc-sessions/swap.log` (Pre-flight 9, Task 5 Step 7), which open nothing for writing. NEVER print secret file
  CONTENTS. The `ws-archive` case in Task 3 runs `cmd_ws_archive` against a FIXTURE workspace only.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** Harness: `makeCcdHarness(prefix)`
  (`server/test/ccdWsHelpers.ts`); its `sh()` routes every bash spawn through `ghContainedEnv(home, env, { systemd:
  true, tmux: true })`, which `ccd-workspaces.test.ts`'s scan requires of every `ccd-*.test.ts` file. The two
  `measure-continuity-stage*.test.ts` files spawn `python3`, never bash, outside `h.sh`.
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in:

      cd server && npm ci && npm run test    # vitest run — hermetic
      cd agent  && npm ci && npm run test
      cd pwa    && npm ci && npm run test

  `typecheck-tests` needs `agent/node_modules` AND `pwa/node_modules` (Pre-flight 12): install all three first.
- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside `server/`. NEVER bare `npx vitest`.**
- **Run suites in the FOREGROUND, timeout ≥600000 ms, ONE vitest process at a time, `--maxWorkers=2` at most.** The
  fleet box is memory-bound. A timing run goes under `( ulimit -v 4000000; timeout 600 … )` and never above a 100 KB
  payload. A run killed by the memory reaper, or anything else, is restored from its snapshot and reported in a
  status mail; never end a turn waiting on a word typed at your own pane (programme ledger, run 237).
- **Known load flakes** (re-run IN ISOLATION, `--maxWorkers=1`, before calling a real break): `ccd-ws-gc`,
  `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads` — and, measured on this
  prototype at load averages of 60–130: `ccd-limit-banner`'s "a swap in the row's own second…", four
  `ccd-route-apply` picker cases, four `ccd-archive` cases, `session-hook`'s two timing budgets and
  `boot`'s "a hung ccd … does not delay listen". Each was green in isolation, `--maxWorkers=1`, on the
  prototype.
- **Rings / no overloaded null.** `_operator_choice_keep` is always rc 0 — a stop is never failed by it — and says
  why it wrote nothing in `swap.log` (`operator-choice <id>: …`) wherever the operator's choice may be lost: a value
  outside the vocabulary, a refusal by the record's own checks, and — as `unmeasured (…)`, a distinct line — a stop
  that could not read at all (no journal floor yet, a transcript that is not a readable regular file, no python3, a
  reader that failed). Silent only where nothing was lost: no registry row, no transcript, no command, a value
  already held, a field newer than the keystroke, a command older than the journal's floor (an older ccd's era,
  said once by the stop that opened the floor). `_model_class_of` answers a class (rc 0) or outside the vocabulary
  (rc 1). `_rescue_history` keeps its two answers (measured, rc 0, possibly empty; unmeasurable, rc 2).
- **Wire discipline.** No frame changes; `FLEET_PROTO` untouched. `swap.log` gains one new line word,
  `operator-choice` (its `unmeasured (…)` form included), and `route … [actor=operator-session]` lines in
  `cmd_route`'s existing shape. No server or agent
  code parses either (measured at `22f7931af`: `grep -rn 'operator-choice\|actor=operator-session' server/src
  agent/src shared pwa/src` → no hits).
- **Mutation-table discipline:** every new guard ships WITH a test that goes RED when the guard is deleted or
  mutated, measured before/after on the full prototype; restore from a saved copy, never `git checkout -- <path>`.
  Where a row reds a case a LATER task adds, re-measure at your own commit and quote what you get.
- **`ccd/ccd` is a provenance-STAMPED file.** Every task that edits it re-stamps before running any suite, or
  `ownership.test.ts` reds: `~/.local/bin/ccrc restamp ccd/ccd` (measured: it agrees byte for byte with
  `shared/mark.mjs`'s `markGenerated`; on a box without that tool, `node --input-type=module -e "import { readFileSync,
  writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd',
  markGenerated(readFileSync('ccd/ccd', 'utf8')))"`).
- **The citation tax (S6-R11).** `session-hook.test.ts` audits every `file:line` citation in the two frozen corpus
  documents and in `README.md`. Measured at `22f7931af`: the corpus cites `ccd/ccd` up to `:19109`; README carries
  **zero** `ccd/ccd:N` anchors (so the exemplar's `repoint-readme.py`, which asserts exactly two, is NOT run — it
  would refuse). Every edit this wave makes above `:19109` is LINE-NEUTRAL: the `_reg_get` census (2 lines),
  `_reg_purge`'s inventory (3 lines), the rescue arm's line in `_auto_swap_check` (2 lines for 2) and
  `cmd_ws_archive`'s call (1 for 1). Measured on the prototype after Task 1 and after Task 4: `147 / 197 / 52 / 35`
  stated = base = tree, composition empty.
- **The `_reg_get` census.** Task 1 adds no `_reg_get` call; Task 2 adds one (`_typed_note`'s read of `typed`);
  Task 3 one more (`_operator_choice_keep`'s). `$SCRATCH/reg-get-census.py <delta>` (Task 2 Step 5) re-derives the
  pair from `origin/main`'s own sentence plus `<delta>` — idempotent, so Task 3 and Task 5 run the same script:
  179/150 at `22f7931af`, 180/151 after Task 2, 181/152 after Task 3.
- **Locate code by CONTENT.** Line numbers are "at `22f7931af`" and are hints, never addresses. Every edit below is an
  "In `<file>`, find:" block whose anchor matches exactly once on `origin/main` at `22f7931af`.
- **Shell state does not survive between Bash calls.** Every block that names `$SCRATCH` sets it itself
  (`SCRATCH=<your scratchpad, absolute>` — a directory of YOUR OWN, e.g. `<scratchpad>/wave3`: a scratchpad another
  agent shares will overwrite a file named `mutate.py` or `cite-remeasure.py`, measured while planning this wave).
- **Branch discipline:** commit on this workspace's own branch only; never a separate feature branch. One commit per
  task. **Commit trailers:** end every commit message with the attribution line your own session is given.
- **No hostnames, IPs, tailnet names, docserver URLs or account names** in a committed file (`topology-clean.test.ts`).
  Fixture accounts are the test roster's (`claude`, `claude-a`, `claude-b`, `claude-d`, `gpt`).
- **`## Deviations found` numbers are ISSUED, never chosen.** Write no `D-<number>` token for a departure; name it by
  its slug in the wave-done mail, and the coordinator defines it from 3896 to 3905.

---

## Review Focus

Inputs and failure modes the spec implies that no task's happy path exercises, most likely to bite first; each is a
named case in its owning task and red when its guard is removed (the mutation tables are the measurement).

1. **A refused auto-rescue.** `_dispatch_swap` only starts a detached unit; `cmd_swap` can still refuse (its
   pre-flight, the carry, the roster re-read), and wave 2's rescue arm had already logged `rescuewait-end … end=swap`
   — so §9 counted a move that never happened and the next strand tick re-opened the wait with a fresh `since`. →
   Task 1, "a REFUSED auto-rescue leaves the wait open…" (row 1.1).
2. **A refused dispatch counted as a rescue.** Rule 3 counted `auto-rescue` lines, so three refused swaps took a chain
   wait and marked an account the session never left. → Task 1, "a dispatched rescue that never landed…" (rows
   1.2, 1.3).
3. **A forged `swap.log` line.** Any session on the box can append to it. A 4300-digit `reset=` raised in python and
   turned rule 3 off for that session; distinct targets made two list scans quadratic; and `--stage 4`'s new row
   would have raised on `reset=abc` or a 5000-digit value. → Task 1, "a forged reset= of 5000 digits…" (rows 1.6,
   1.11 — leading zeros, so the cap alone is not enough) and "a forged reset= is no date…" (row 1.14); the scans'
   cost is Pre-flight 6 (no behavioural pin — a set changes no answer).
4. **ccd's own keystrokes read as the operator's.** The settle types `/effort ultracode` into every session with no
   effort field, and `route --apply` types a DEGRADED class over an operator's `fable`; promoting either would write
   a box default, or a degrade, over the operator's record. → Task 3, the spec's first two mutation rows (rows 2.1,
   2.2), with the control "the same /effort an hour from any journalled keystroke is the operator's" (row 3.11).
   **At the deploy** every live session's transcript holds keystrokes an older ccd typed WITHOUT journalling them
   (the first draft promoted `effort ∅ -> ultracode` and `class fable -> opus` from them, measured by review):
   the journal's floor (`<epoch> since`, opened by `_spawn_start`) keeps every older command out, and a stop that
   finds no floor opens it and promotes nothing. → Task 2, "the spawn opens the journal at a floor…" (rows 2.10,
   2.11); Task 3, "a session with no journal yet…" and "a command older than the journal's floor…" (rows 3.19,
   3.20).
5. **The record changed after the keystroke.** The PWA picker or a coordinator's route writes the field after the
   operator typed; re-promoting the older command at every stop would undo them. → Task 3, "the record wins when it
   is newer…" and "a field whose time cannot be read is not overwritten" (rows 3.6, 3.13).
6. **A promotion inside a swap that fails.** `cmd_route` `die`s on a bad pair (`haiku` with an effort level); run in
   the swap's own shell, that `die` would end the swap after the transcript read and before the stop. → Task 3,
   "…nor does a value the record's own checks refuse" (row 3.2) and "an unmappable value does not abort a swap"
   (row 3.1, the spec's third row).
7. **Transcript rows that look like a command.** A human quoting the envelope, a subagent's row, a command Claude
   Code refused (no `Set model to …` after it), an argument with a space in it (bash would split it into the epoch
   field). → Task 3, four cases (rows 3.8, 3.9, 3.10, 3.12).
8. **The picker and the slider take no argument.** `route --apply` and a human's picker both write `/model` with an
   empty `<command-args>`; only the acknowledgement names the value — in BACKTICKS on the builds the fleet runs
   (2.1.250 and later: ``Set model to `Opus 5` …``), in ANSI bold on 2.1.226, with a `(1M context)` suffix, and with
   `(default)` when the picker chose Default (it names the resolved model, so `default` would otherwise round-trip
   as `sonnet`); `/effort ultracode` acknowledges `Ultracode on …` on 2.1.284 and later (Pre-flight 1). → Task 3,
   "the picker takes no argument… in either shape" (row 3.22), "(default)" (row 3.21), "Ultracode on" (row 3.23),
   and the `route --apply` row in both shapes (row 2.2).
9. **The port drifting from `familyClassOf`.** A token reordered, or matched without its dashes, classifies a hybrid
   or a vendor id differently in bash than on the server. → Task 2, the agreement pin (rows 2.8, 2.9).
10. **A new stop-then-spawn path added later without the call.** → Task 3, the census of STOPS: every function
    holding a `tmux kill-session`, a `claude-session@` stop or bootout, or a `_ws_unsupervise` is either one of the
    three that keep the operator's choice first, or named with the reason no spawn follows; a new one reds until it
    is classified (row 3.26 adds a `_bounce_session` and reds), and a moved call reds too (rows 3.3–3.5).
11. **A FIFO where the transcript should be.** `grep` on a FIFO blocks until a writer opens it (measured: `timeout 3
    grep … -- fifo` → rc 124), which would hold the stop with no deadline. → Task 3, "a FIFO where the transcript
    should be is never opened…" (row 3.16).
12. **A choice lost where ccd could not read.** No floor yet, a transcript that is not a readable regular file, no
    python3, a reader that failed: each is rc 0, and each is an `unmeasured (…)` line `--stage 7` reports, never
    silence. → Task 3, "could not measure is said, never silent…" (rows 3.16–3.18); Task 4, row 4.5.

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `ccd/ccd` | Modify — Task 1: `_rescue_policy`, `_rescue_history`, `_rescue_target`'s comment, `_rescue_strand_cause`, the rescue arm's line in `_auto_swap_check`; Task 2: the new section above `_route_apply_now() {`, journal calls in `_inject_spawn_effort` and `_route_apply_now`, the floor's line in `_spawn_start`, `_reg_purge`'s inventory, the `_reg_get` census; Task 3: `_operator_choice_keep` and `_operator_choice_say`, three call sites, the census | The residue; the journal, the vocabulary, the promotion |
| `deploy/measure-continuity.py` | Modify — Task 1 (a stage-4 row), Task 4 (`--stage 7`) | §9's rows, read-only |
| `server/test/ccd-rescue-policy.test.ts` | Modify (Task 1) — two helpers, one describe appended | The residue's cases |
| `server/test/measure-continuity-stage4.test.ts` | Modify (Task 1) — one binding case re-pointed at the landing, one describe | The restated target row |
| `server/test/ccd-operator-choice.test.ts` | Create (Task 2), extend (Task 3) | The journal, the vocabulary and its agreement pin, the promotion, the call sites |
| `server/test/measure-continuity-stage7.test.ts` | Create (Task 4) | The stage-7 row, bound to the real lines |
| `server/test/ccd-die-containment.test.ts` | Modify (Task 3) — one name in its pinned can-die list, and why | The scanner's exact list (Pre-flight 13) |
| `README.md` | Modify — Task 1 (three sentences, line-neutral but for +2), Task 4 (one subsection) | The canonical description |
| `docs/superpowers/specs/2026-09-23-session-continuity-design.md` | Modify — Task 1 (rev 7: rule 3 counts landed rescues; §9's stage-4 target), Task 4 (§5.7 as planned; §9's stage-7 row) | The spec stays true to what ships |

**Not modified, deliberately:** `server/src/**`, `agent/src/**`, `shared/**`, `pwa/**`; `ccd/session-hook.sh`;
`server/test/session-hook.test.ts` (the citation census does not move); `cmd_route` itself (the promotion calls it,
unchanged); `_session_hard_blocked`'s verdict; every destructive verb.

---

## Pre-flight findings (measured while planning; not deviations)

Measured 2026-10-04 on `59a435f0d`, `22f7931af` and the prototype (`ccd/ccd` and every file but `README.md` are the
same at both); live reads are read-only.

1. **Claude Code's local-command rows** (read-only, from a fleet transcript on build 2.1.226): a typed command is a
   `type:"user"` row whose `message.content` is the envelope `<command-name>/model</command-name>\n
   <command-message>model</command-message>\n            <command-args>opus</command-args>`, and the NEXT row is
   its acknowledgement, `<local-command-stdout>Set model to \u001b[1mOpus 5\u001b[22m and saved as your default for
   new sessions</local-command-stdout>` (or `… for this session only`). The picker writes the same envelope with an
   EMPTY `<command-args></command-args>` and an acknowledgement such as `Set model to \u001b[1mOpus 4.8 (1M
   context)\u001b[22m …`; `/effort ultracode` acknowledges `Set effort level to ultracode (this session only): xhigh +
   dynamic workflow orchestration`. `route --apply` drives the picker (`_route_type_model` types `/model` + Enter) and
   the slider (`_route_type_effort` types `/effort` + Enter, except `ultracode`), so ITS commands carry no argument
   either — the acknowledgement is the only place their value appears.
   **The shapes the fleet's builds write** (re-measured for the revision, read-only, `.superpowers`-local script
   over every `~/.claude*/projects/*/*.jsonl` modified in the last 40 days and under 150 MB — 6,669 files): the
   `/model` acknowledgement wraps the name in BACKTICKS on the newer builds (``Set model to `Opus N` …``, 360
   rows, seen on 2.1.263 through 2.1.280 in the last 8 days; review saw it from 2.1.250) and in ANSI bold on the
   older ones (96 rows); a `(default)` suffix appears exactly when the operator chose Default — `/model default` (9
   rows) or the picker's Default row (7 rows), in both shapes, naming the RESOLVED model (`Sonnet N (default)`,
   `Opus N (1M context) (default)`); and `/effort ultracode` acknowledges `Ultracode on (this session only): …
   Effort stays medium.` on 2.1.284 and 2.1.286 (9 rows) where older builds wrote `Set effort level to ultracode …`.
   The first draft's fixtures carried only the 2.1.226 shape, so its suite was green while the picker's value read
   as `?` on the live fleet (review's finding; row 3.22 restores the first draft's strip and reds four cases).
2. **`routeapplied` cannot tell ccd's keystrokes from the operator's** (spec §5.7, re-read): the spawn writes it from
   the composed argv before the settle types, and `cmd_route --apply` stamps `workflow`/`subagent`/`compact` it never
   types. And `_route_wanted` answers the DEGRADED class when a `degraded` stamp exists (`ccd/ccd` ≈18718), so the
   applier types a class the record's `class` field does not hold — the case the journal exists for.
3. **`cmd_route` is the one writer** (≈9192): it validates, refuses the `haiku`+level pair across calls, writes each
   field with `_reg_set`, journals `_lc_done route` and appends `route <id>: <field> <old> -> <new> [actor=…] (…)` to
   swap.log. It ends a refusal with `die` (`exit 1`), so a caller in a stop path must run it in a subshell.
4. **Every stop in `ccd/ccd`** (each non-comment line holding `tmux kill-session`, `_svc_stop "claude-session@`, a
   `bootout` of a `claude-session@` label or `_ws_unsupervise "`, by enclosing function — the census Task 3 pins):
   followed by a spawn — `cmd_swap` (stop, carry, start — or `_swap_refuse`'s restart), `cmd_stop` (`ccd
   start`/`enable` respawn from the record), `cmd_ws_archive` (`ws-restore` respawns); not followed by one —
   `cmd_ws_rm`, `cmd_forget`, `_ws_reap_tail`, `_ws_reclaim_tail` (the row ends), `cmd_account_pane` (an account's
   login pane, `_tmux_at "$pane"`, not a session) and `cmd_supervise`'s launchd `bootout` after a crash loop (Claude
   Code already exited; the revival path, Open question 1). `_swap_refuse`'s restart follows `cmd_swap`'s own stop.
   A supervisor revival (`cmd_supervise` → `cmd_ensure`) follows no ccd stop at all.
5. **The class vocabulary IS the alias table.** `ROUTE_CLASSES="fable opus sonnet haiku default"` (≈1576) — exactly
   the five aliases the spec lists — so the alias table is derived from it, not hand-kept; `single-definition`'s
   models scan already lists `ccd/ccd` as a holder of the four classes, and adding the port changes no holder list
   (measured: `single-definition` green). `FAMILY_TOKENS` (`shared/models.mjs` ≈447) is the dash-token list the port
   copies, and the agreement pin compares the two.
6. **`_rescue_history`'s set** (minor 4) changes no answer: on a forged 100 KB tail (1,287 lines, 858 distinct
   targets, 429 landed rescues of the session) base and prototype both answer `count=429 left=429 recent=858`, in
   67–74 ms and 69–127 ms (noise at load 20–60). The quadratic cost shows only near 1 MiB, which the 100 KB payload
   rule forbids timing here; review 246 measured it.
7. **`_operator_choice_keep`'s cost** on a 100 KB transcript (`( ulimit -v 4000000; timeout 600 … )`, measured on
   the first draft; the revision adds no pass over the transcript — one more regex alternative and a floor compare
   per command row): 238 ms with a promotion (most of it `cmd_route`), 53 ms with nothing to do. It runs once per
   stop, never on a tick. Its read is `grep -F -A1` over the whole transcript, so on a 200 MB transcript the grep
   dominates (unmeasured: above the payload cap); a swap already copies the whole file.
8. **`swap.log` landing lines** are `<stamp> swap <id>: <from> -> <to> (uuid <uuid>)`, written by `cmd_swap` at its
   tail and nowhere else (pinned by `measure-continuity-stage4.test.ts`'s last case), after `_rescuewait_close "$id"
   swap` — so keying rule 3 on the landing is feasible, and minor 5 is decided "key on the landing".
9. **The live baselines** (read-only, the fleet box, `TZ=UTC`): `--stage 4 --since 2026-09-08 --until 2026-09-24` →
   248 rescues, 4 sessions with 4 or more inside an hour, max 4, and **0** sessions with an unchained fourth rescue —
   0 by construction, because no rescue line before wave 2's deploy carries `reset=`/`type=`; `--since 2026-09-24` →
   44 rescues, 1 session with 4+, 0 dated, 0 unchained (wave 2 is not yet on this box) — re-read for the revision:
   unchanged. `--stage 7` → every row 0, `stops_that_could_not_read_the_transcript` 0.
10. **Red-first, per task** (the task's own tests on the previous task's tree, each tree built by a replay of THIS
    document onto `22f7931af`): Task 1 `7 failed | 107 passed (114)` (`ccd-rescue-policy` 5 of 102 — the five new
    cases — and `measure-continuity-stage4` 2 of 12); Task 2 `7 failed | 2 passed (9)` (the two that pass are a
    control and the purge pin, which `_reg_purge`'s suffix glob already satisfies); Task 3 `21 failed | 16 passed
    (37)` (Task 2's nine, and seven cases that assert nothing is written — the record wins when newer; a value
    already held; a human quoting the envelope; a subagent's row; a command older than the floor; the settle's
    `/effort`; `route --apply`'s `/model` — each measured red by its mutation row instead: 3.6, 3.7, 3.9, 3.10,
    3.19, 2.1, 2.2); Task 4 `2 failed (2)`.
11. **Green, on the full prototype:** `ccd-rescue-policy` 102, `measure-continuity-stage4` 12, `measure-continuity`
    5, `ccd-operator-choice` 37, `measure-continuity-stage7` 2; `single-definition`, `modelenv-single-writer`,
    `box-token-census`, `routing-references`, `pools-prose`, `ownership`, `ccd-reg-get-census` 357 together (first
    draft; re-run for the revision in two calls: `ccd-forget` + `ccd-pr-state` + `ccd-ws-slug-git` +
    `single-definition` + `modelenv-single-writer` 413, `box-token-census` + `routing-references` 34; `pools-prose`
    + `ccd-die-containment` + `ccd-reg-get-census` + `ownership` 56); `ccd-workspaces` 79;
    `deviation-refs`, `dtbd`, `topology-clean` 87 (after `git fetch origin main`, the plan file in place);
    `ccd-route-settle` + `ccd-route-apply` + `ccd-auto-swap-pool` + `single-definition` 372 (at Task 2's tree);
    `ccd-swap` + `ccd-swap-pin` + `ccd-archive` + `ccd-swap-refuse` `124 passed | 1 skipped (125)`; `ccd-swap-carry` +
    `ccd-lifecycle-sites` + `ccd-lifecycle-emit` + `ccd-session-lifecycle` `132 passed | 3 skipped (135)`;
    `ccd-crosspool` + `ccd-swap-carry-merge` + `ccd-workspaces` 247; `typecheck-tests` + `ccd-die-containment` 24;
    the citation cases `7 passed | 328 skipped (335)`.
    **The floor's line in `_spawn_start` runs on every spawn**, so every `ccd-*` suite that reaches `_spawn_start`,
    `cmd_start`, `cmd_ensure` or `cmd_supervise` (`grep -lE` over `server/test/ccd-*.test.ts`: 45 files) was run on
    the revised prototype, five files a call: all green — 79, 180, 207, 97, 89, `148 passed | 4 skipped (152)`,
    `292 passed | 4 skipped (296)`, and `ccd-ws-gc` + `ccd-child-reclaim-ladder` + `ccd-route-settle` +
    `ccd-auto-swap-pool` + `ccd-limit-banner` 403, beside the named runs above.
12. **`typecheck-tests` needs `agent/node_modules` and `pwa/node_modules`.** Without them it reds on
    `agent/src/server.ts`'s `ws` import, identically on the base; with both installed, 12/12.
13. **`ccd-die-containment` pins the exact set of functions that can reach `die`**, derived by call-graph
    reachability over `$( )` substitutions only. `_operator_choice_keep` calls `cmd_route` (which `die`s on a refusal)
    inside a plain `( … )` subshell, which ends only the subshell — but the scanner does not model `( )`, so it lists
    `_operator_choice_keep` as fatal and its "was actually parsed" case reds `1 failed | 11 passed (12)` on Task 3's
    code until the list names it (found by the full sharded run, not by a targeted suite). Task 3 adds the name with
    that reason beside it; the real property — a refusal inside a swap never ends the swap — is pinned by row 3.2,
    and the scanner's demotion check (no fatal call inside `$( )`) still covers the function.
14. **The full server suite on the prototype**, twelve shards at `--maxWorkers=2` and load averages of 15–120, a
    shard killed by the 580 s ceiling re-run in thirds in vitest's own file order (sha1 of the path): every file
    green except — `ccd-die-containment` (finding 13, fixed in Task 3); `tmp-sweep`'s "FAILS CLOSED: claude is
    running…" (red on `main` too — wave 2's report; it tests `ccd/ccd-tmp-sweep`, which this wave does not touch);
    `boot`'s "a hung ccd … does not delay listen" and `session-hook`'s two timing budgets (load flakes, green in
    isolation); and two files that did not finish inside 590 s even alone at load 14–30, `ccrc-install` (changed by
    #239 on `main`) and `ccd-child-reclaim-verb` (444 cases) — neither names a verb or function this wave changes
    (`grep` for `cmd_swap`, `cmd_stop`, `ws-archive`, `_route_apply_now`, `_inject_spawn_effort`, `_rescue_`,
    `_auto_swap_check`: 0 hits in each), and CI on the quiet box is their arbiter. That sharded run was on the first
    draft; the revision's one new reach — the floor's line in `_spawn_start` — was measured by the 45 spawn-path
    files of finding 11 instead (neither unfinished file reaches it: `grep -cE
    "_spawn_start|cmd_start |cmd_ensure|cmd_supervise|_spawn "` → 0 in each, and `WS_ADD` stubs `_spawn_start`).
15. **Older `int()` calls in `--stage 4` on a forged token** (not this wave's to fix, named so nobody assumes them
    guarded): the wait rows' `int(reset)` (each behind `reset.isdigit()`, which a 5000-digit value passes and
    `int()` then refuses above 4300 digits) and the carried-in row's unguarded `int(tok["row"])` predate this wave.
    The new target row guards its own (`re.fullmatch(r"\d{1,12}", …)`, row 1.14); the rest is residue for a later
    wave, listed in Open question 6.

---

## How the replay markers read

A block is applied in document order. `replace <file>`: the fenced text after the marker must occur exactly once in
the file; the next fenced block replaces it. `replace-text <file>`: the same, on a substring (the two fenced blocks
without their final newline). `insert-above <file>`: the fenced anchor must occur exactly once; the next fenced block
goes directly above it. `create` and `append`: one fenced block. `save <name>`: write the block to `$SCRATCH/<name>`.
`bash`: run the block from the repository root.

## The citation tax, mechanised (S6-R11)

The two instruments are the exemplar's, VERBATIM — `docs/superpowers/plans/2026-09-22-child-reclamation-wave1-marker-and-containment.md`,
"The citation tax, mechanised". Extract them by CONTENT into your scratchpad with this script, `$SCRATCH/extract-tools.py`:

```python
import re, sys
text = open(sys.argv[1], encoding='utf8').read()
blocks = re.findall(r"```python\n(#!/usr/bin/env python3\n.*?)```", text, re.S)
want = {'repoint-readme.py': '"""Re-point README.md', 'cite-remeasure.py': '"""Re-measure session-hook.test.ts'}
for name, head in want.items():
    hits = [b for b in blocks if b.split('\n')[1].startswith(head)]
    assert len(hits) == 1, (name, len(hits))
    open(f'{sys.argv[2]}/{name}', 'w', encoding='utf8').write(hits[0])
    print(name, len(hits[0].splitlines()), 'lines')
```

```bash
SCRATCH=<your scratchpad, absolute>
[[ "$SCRATCH" == /* && -d "$SCRATCH" ]] || echo "STOP: SCRATCH is not an absolute directory"
python3 "$SCRATCH/extract-tools.py" docs/superpowers/plans/2026-09-22-child-reclamation-wave1-marker-and-containment.md "$SCRATCH"
grep -c 'ccd/ccd:[0-9]' README.md
```

Expected: `repoint-readme.py 30 lines`, `cite-remeasure.py 113 lines`, then `0` — README carries no `ccd/ccd` anchor,
so `repoint-readme.py` (which asserts exactly two) is never run in this wave. **The procedure, per
`ccd/ccd`-editing task:** re-stamp; then

```bash
SCRATCH=<your scratchpad, absolute>
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD
git fetch origin main && git diff --quiet origin/main -- \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
```

Expected (measured on `59a435f0d`, on `22f7931af` and on the prototype after Tasks 1 and 4): `byFile['ccd/ccd'] stated 147 base 147
tree 147`, `total 197/197/197`, row array `52/52/52`, site array `35/35/35`, every `ENTERED`/`LEFT` empty, the tree
clean afterwards, and `corpus-frozen`. **If any `base` differs from its `stated`, the tree was red before your edit:
stop and report it.** If `tree` moves, an edit above `:19109` was not line-neutral — find it; never `--write` the
census for this wave.

---

### Task 1: Wave 2's residue (review 246) — the FIRST commit

**Model routing:** `opus`, effort `high` — it changes what rule 3 counts and when a wait is recorded as ended.

**Files:**
- Modify: `ccd/ccd` — the rescue arm's line in `_auto_swap_check` (≈17788, line-neutral), `_rescue_policy`'s not-blocked
  close (≈23101), `_rescue_history` (≈23171), `_rescue_target`'s comment (≈23225), `_rescue_strand_cause` (≈23264)
- Modify: `deploy/measure-continuity.py` (stage 4: one row)
- Modify: `README.md` (≈2264–2269), `docs/superpowers/specs/2026-09-23-session-continuity-design.md` (rev 7)
- Test: `server/test/ccd-rescue-policy.test.ts`, `server/test/measure-continuity-stage4.test.ts`

**Interfaces:**
- Consumes: wave 2's `_rescue_policy`, `_rescuewait_close`, `_rescue_history`, `_rescue_target`,
  `_rescue_strand_cause`; `cmd_swap`'s landing (`_rescuewait_close "$id" swap`, then `swap <id>: <from> -> <to> (uuid
  <uuid>)`), unchanged.
- Produces: the rescue arm no longer closes a wait; `_rescue_history` → `RESCUE_COUNT` = this session's rescues in
  `RESCUE_CHAIN_WINDOW` that LANDED, `RESCUE_SKIP_LEFT` = their source accounts (a logged `reset=` of at most twelve
  digits that has passed lifts one), `RESCUE_SKIP_RECENT` = every session's rescue target in `RESCUE_SPREAD_WINDOW`,
  landed or in flight; `_rescue_strand_cause` prints `its best account with room, <acct>, is one it left blocked
  inside RESCUE_CHAIN_WINDOW, and a rescue does not take it back (do not bounce)`; `--stage 4` gains
  `sessions_with_an_unchained_4th_rescue_in_an_hour`.

- [ ] **Step 0: Merge current `main`, prove the citation cases green, and check the spec's claim**

Every `ccd/ccd` edit rewrites line 2 (`# ccrc:generated 1 sha256=…`), so once another wave's `ccd/ccd` edit has landed
a merge ALWAYS conflicts on that line. This block resolves exactly that hunk and stops on anything else
(`-c merge.conflictStyle=merge` pins the two-sided marker shape its line checks read):

```bash
if ! git fetch origin main; then
  echo 'STOP: the fetch failed — nothing merged; report it'
elif ! git -c merge.conflictStyle=merge merge --no-edit origin/main; then
  if [ "$(git diff --name-only --diff-filter=U)" = ccd/ccd ] && [ "$(grep -c '^<<<<<<< ' ccd/ccd)" = 1 ] \
     && sed -n 2p ccd/ccd | grep -q '^<<<<<<< ' && sed -n 4p ccd/ccd | grep -q '^=======$' \
     && sed -n 6p ccd/ccd | grep -q '^>>>>>>> ' \
     && sed -n 3p ccd/ccd | grep -q '^# ccrc:generated 1 sha256=' && sed -n 5p ccd/ccd | grep -q '^# ccrc:generated 1 sha256='; then
    sed -i '2,6d' ccd/ccd && ~/.local/bin/ccrc restamp ccd/ccd
    git add ccd/ccd && git commit --no-edit && echo 'merged: the stamp hunk resolved by re-stamping'
  else
    echo 'STOP: a conflict other than the ccd/ccd stamp line — report it'; git merge --abort
  fi
fi
git log -1 --format='%h %s'
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: `Already up to date.` (or `merged: the stamp hunk resolved by re-stamping`) and `7 passed | 328 skipped
(335)`. On `STOP`, stop and report. Then ask the coordinator (or read `GET /api/claims` if your box token reaches it)
whether `docs/superpowers/specs/2026-09-23-session-continuity-design.md` is claimed by another programme (the
stall-watch programme held claim 891 on it): if it is, write the code and test hunks of this task now and hold Step 6's
spec hunks for the coordinator's word, reported in a status mail.

- [ ] **Step 1: Write the failing tests**

The rescue-policy suite's stubbed `_dispatch_swap` now LANDS, as the detached `cmd_swap` does — it writes that verb's
own `swap <id>:` line and ends an open wait `swap` — because from this task the rescue arm writes no end of its own.
`pastLog` writes a rescue of THIS session as it landed (its `auto-rescue` line and, five seconds later, the landing),
and `dispatchedOnly` writes a dispatch alone, a swap that was refused. With those two helpers every existing case keeps
its meaning, and five cases are appended:

In `server/test/ccd-rescue-policy.test.ts`, find:

<!-- replay: replace server/test/ccd-rescue-policy.test.ts -->
```ts
 *  keystroke LOG. `target` stubs `_swap_target` (null = leave it real). */
const STUBS = (pane: string, target: string | null = 'claude-a'): string => {
  fs.writeFileSync(path.join(h.home, 'pane.txt'), pane + '\n');
  return `
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} case "\${1:-}" in
    capture-pane) cat "$HOME/pane.txt" ;; list-panes) echo 4242 ;;
    display-message) [ -n "\${TMUX_CREATED:-}" ] && echo "$TMUX_CREATED" ;; esac; return 0; };
  _pane_box_draft() { printf ''; };
  ${target === null ? '' : `_swap_target() { [[ -n ${JSON.stringify(target)} ]] && echo ${JSON.stringify(target)}; return 0; };`}
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };`;
```

and replace it with:

```ts
 *  keystroke LOG. `target` stubs `_swap_target` (null = leave it real). The
 *  dispatch also LANDS, as the detached `cmd_swap` does: it writes that verb's
 *  own `swap <id>:` line and ends an open wait `swap` — since wave 3 the rescue
 *  arm writes no end itself, and rule 3 counts a rescue only once it landed. */
const STUBS = (pane: string, target: string | null = 'claude-a'): string => {
  fs.writeFileSync(path.join(h.home, 'pane.txt'), pane + '\n');
  return `
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} case "\${1:-}" in
    capture-pane) cat "$HOME/pane.txt" ;; list-panes) echo 4242 ;;
    display-message) [ -n "\${TMUX_CREATED:-}" ] && echo "$TMUX_CREATED" ;; esac; return 0; };
  _pane_box_draft() { printf ''; };
  ${target === null ? '' : `_swap_target() { [[ -n ${JSON.stringify(target)} ]] && echo ${JSON.stringify(target)}; return 0; };`}
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls";
    echo "$(date '+%F %T') swap $1: $(_reg_get "$1" wrapper) -> $2 (uuid ${UUID})" >> "$REG/swap.log"; _rescuewait_close "$1" swap; };`;
```

In `server/test/ccd-rescue-policy.test.ts`, find:

<!-- replay: replace server/test/ccd-rescue-policy.test.ts -->
```ts
/** A swap.log line at `ago` seconds in the past, in the log's own LOCAL-time format. */
const pastLog = (ago: number, rest: string): void => {
  h.sh(`printf '%(%F %T)T %s\\n' "$(( $(date +%s) - ${ago} ))" ${JSON.stringify(rest)} >> "$REG/swap.log"`);
```

and replace it with:

```ts
/** A swap.log line at `ago` seconds in the past, in the log's own LOCAL-time format.
 *  A rescue of THIS session is written as it LANDED — its `auto-rescue` line and,
 *  five seconds later, `cmd_swap`'s own landing line — because rule 3 counts only
 *  those (wave 3); `dispatchedOnly` writes the dispatch alone, a swap that was refused. */
const pastLog = (ago: number, rest: string, dispatchedOnly = false): void => {
  const at = (a: number, line: string): void => {
    h.sh(`printf '%(%F %T)T %s\\n' "$(( $(date +%s) - ${a} ))" ${JSON.stringify(line)} >> "$REG/swap.log"`);
  };
  at(ago, rest);
  const m = new RegExp(`^auto-rescue ${ID}: (\\S+) \\(blocked\\) -> (\\S+) `).exec(rest);
  if (m && !dispatchedOnly) at(ago - 5, `swap ${ID}: ${m[1]} -> ${m[2]} (uuid ${UUID})`);
```

In `server/test/ccd-rescue-policy.test.ts`, append at the end of the file:

<!-- replay: append server/test/ccd-rescue-policy.test.ts -->
```ts

// ── WAVE 2'S RESIDUE (review 246, carried to wave 3's first commit) ───────────
// F1: the rescue arm writes no `end=swap` — `_dispatch_swap` only starts a
// detached unit, and `cmd_swap` can still refuse; the wait ends `swap` at the
// landing alone. Minor 5, decided with it: rule 3 counts a rescue, and marks the
// account it left, only once that landing line follows it. F2: the do-not-bounce
// cause names the probe's BEST account with room, which may be one of several.
// F5: a not-blocked tick with no record never forks into the close. Minor 3: a
// forged `reset=` cannot crash the history read.
describe('wave 2\'s residue: the wait ends at the landing, and rule 3 counts landed rescues', () => {
  const lanes = (): void => {
    const t = now();
    for (const [w, five] of [['claude', 100], ['claude-a', 10], ['claude-b', 20], ['claude-d', 30]] as const) {
      fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
        JSON.stringify({ five, seven: 5, ts: t, fiveResetAt: t + 10000, sevenResetAt: t + 400000 }));
    }
  };

  it('a REFUSED auto-rescue leaves the wait open: neither the rescue arm nor the refusal writes an end', () => {
    seed(); const t = now(); const R = t - 30;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    openWait('noroom', t - 500, R);
    // The REAL cmd_swap behind the dispatch, refused at its pre-flight (no
    // transcript found for the uuid): nothing moves, and `_swap_refuse` restarts
    // the session where it was.
    const REFUSED = `_dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls";
      systemctl() { :; }; launchctl() { :; }; sleep() { :; }; _transcript_matches() { :; };
      CCD_SWAP_AUTO=1 TMUX= cmd_swap "$1" "$2" >/dev/null 2>&1; };`;
    h.sh(`${STUBS(STALLED, 'claude-a')} ${REFUSED} _auto_swap_check ${ID}`, BORN());
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(h.reg(ID, 'wrapper'), 'nothing moved').toBe('claude');
    expect(fs.existsSync(regFile(`${ID}.swapblocked`)), 'the swap was refused').toBe(true);
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('open');
    expect(logLines('rescuewait-end'), 'stage 4 would count a move that never happened').toEqual([]);
  });

  it('a dispatched rescue that never landed neither counts toward the chain wait nor marks the account it left', () => {
    seed(); lanes(); const t = now();
    writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]);
    for (const ago of [3000, 2500, 2000]) pastLog(ago, `auto-rescue ${ID}: claude-a (blocked) -> claude [home=claude]`, true);
    pastLog(1990, `swap ${ID}: claude-a -> claude-b (uuid ${UUID})`);   // a landing of ANOTHER move binds none of them
    tick(STALLED, null);
    expect(h.reg(ID, 'rescuewait'), 'three refused dispatches took a chain wait').toBeNull();
    expect(dispatches(), 'claude-a was never left, so it is not skipped').toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('after two rescues the do-not-bounce cause names the BEST account with room, never "the only" one', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]);
    for (const [w, five] of [['claude', 100], ['claude-a', 10], ['claude-b', 20], ['claude-d', 100]] as const) {
      fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
        JSON.stringify({ five, seven: 5, ts: t, fiveResetAt: t + 10000, sevenResetAt: t + 400000 }));
    }
    pastLog(1200, `auto-rescue ${ID}: claude-b (blocked) -> claude [home=claude]`);
    pastLog(900, `auto-rescue ${ID}: claude-a (blocked) -> claude [home=claude]`);
    tick(STALLED, null);
    expect(dispatches()).toEqual([]);
    const marker = fs.readFileSync(regFile(`${ID}.stranded`), 'utf8');
    expect(marker).toMatch(/its best account with room, claude-a,/);
    expect(marker).not.toMatch(/only account/);
  });

  it('a not-blocked tick with no record never reaches the close; with an open record it still ends it `clear`', () => {
    seed();
    const TRACED = `eval "$(declare -f _rescuewait_close | sed '1s/^_rescuewait_close/_rwc_real/')";
      _rescuewait_close() { echo "close $2" >> "$HOME/ccd-calls"; _rwc_real "$@"; };`;
    h.sh(`${STUBS(PROMPT)} ${TRACED} _auto_swap_check ${ID}`, BORN());
    expect(h.calls().filter((l) => l.startsWith('close ')), 'a fork on every tick of every session').toEqual([]);
    openWait('near', now() - 100, now() + 200);
    h.sh(`${STUBS(PROMPT)} ${TRACED} _auto_swap_check ${ID}`, BORN());
    expect(h.calls().filter((l) => l.startsWith('close '))).toEqual(['close clear']);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('clear');
  });

  it('a forged reset= of 5000 digits is no reset: the history is measured and the account stays skipped', () => {
    seed();
    // Leading zeros: its first twelve digits alone would read as a reset long
    // past, which would lift the skip — so only a cap that refuses a thirteenth
    // digit keeps the answer, not the cap alone.
    pastLog(900, `auto-rescue ${ID}: claude-a (blocked) -> claude [home=claude] via=transcript reset=${'0'.repeat(12)}${'1'.repeat(4988)} type=five_hour row=1`);
    expect(h.sh(`_rescue_history ${ID}; echo "$?|$RESCUE_COUNT|$RESCUE_SKIP_LEFT"`)).toBe('0|1|claude-a');
  });
});
```


In the stage-4 instrument's test, the binding case now lands its rescue through the REAL `cmd_swap` (the wait's end
line is the landing's, no longer the rescue arm's), and a describe pins the restated target row:

In `server/test/measure-continuity-stage4.test.ts`, find this anchor:

<!-- replay: insert-above server/test/measure-continuity-stage4.test.ts -->
```ts
describe('each regex is bound to the line the real ccd writes', () => {
```

and insert, directly above it:

```ts
// §9's stage-4 target, restated (review 246's F6): no FOURTH rescue inside an
// hour that no chain wait preceded. A nonzero raw 4+ count can be the chain wait
// working as designed — three rescues at t0, t0+10 and t0+20 min, and a fourth
// at t0+55 after a full chain wait still lands inside the hour of the first —
// so the target row counts only a fourth LANDED rescue the chain wait could have
// held (a dated block not past its five-hour reset's grace) with no `kind=chain`
// entry between the third and the fourth. The raw count is still reported.
describe('the restated target: a fourth landed rescue in an hour that no chain wait preceded', () => {
  const R = utc('2026-09-20 14:00:00');
  type Four = { chain?: boolean; chainFirst?: boolean; refuseSecond?: boolean; undated?: boolean; pastReset?: boolean; reset?: string; times?: string[] };
  const four = (sid: string, opts: Four = {}): string[] => {
    const out: string[] = [];
    const chain = `rescuewait ${sid}: kind=chain on claude reset=${R}`;
    if (opts.chainFirst) out.push(`2026-09-20 09:50:00 ${chain}`);
    (opts.times ?? ['10:00', '10:10', '10:20', '10:55']).forEach((m, i) => {
      const reset = opts.reset ?? (opts.pastReset ? utc('2026-09-20 09:00:00') : R);
      const tok = opts.undated ? '' : ` via=transcript reset=${reset} type=five_hour row=${utc(`2026-09-20 ${m}:00`) - 30}`;
      if (i === 3 && opts.chain) out.push(`2026-09-20 10:25:00 ${chain}`);
      out.push(`2026-09-20 ${m}:00 auto-rescue ${sid}: claude (blocked) -> claude-a [home=claude]${tok}`);
      if (!(i === 1 && opts.refuseSecond)) out.push(`2026-09-20 ${m}:30 swap ${sid}: claude -> claude-a (uuid u)`);
    });
    return out;
  };

  it('counts u1 and u7 only: u2 chain-waited, u3\'s second swap was refused, u4\'s blocks were undated, u5\'s reset had passed, u6\'s fourth fell outside the hour, u7\'s only chain wait came before its first rescue — and the raw row counts six', () => {
    const log = path.join(h.home, 'f6-swap.log');
    fs.writeFileSync(log, [...four('u1'), ...four('u2', { chain: true }), ...four('u3', { refuseSecond: true }),
      ...four('u4', { undated: true }), ...four('u5', { pastReset: true }),
      ...four('u6', { times: ['10:00', '10:10', '10:20', '11:05'] }), ...four('u7', { chainFirst: true })].join('\n') + '\n');
    const r = run(h.home, ['--swap-log', log], { TZ: 'UTC' });
    expect(r.sessions_with_an_unchained_4th_rescue_in_an_hour).toBe(2);
    expect(r.sessions_with_4plus_rescues_in_an_hour, 'the raw count, reported').toBe(6);
  });

  it('a forged reset= is no date: neither a word nor 5000 digits stops the read, and neither is counted', () => {
    const log = path.join(h.home, 'forged-swap.log');
    fs.writeFileSync(log, [...four('f1', { reset: 'abc' }), ...four('f2', { reset: '9'.repeat(5000) }), ...four('u1')].join('\n') + '\n');
    const r = run(h.home, ['--swap-log', log], { TZ: 'UTC' });
    expect(r.sessions_with_an_unchained_4th_rescue_in_an_hour).toBe(1);
  });
});

```

In `server/test/measure-continuity-stage4.test.ts`, find:

<!-- replay: replace server/test/measure-continuity-stage4.test.ts -->
```ts
    h.sh(`${stubs('❯ ', 'claude-a')} _auto_swap_check ${ID}`, env(t));   // closes the near wait as a swap, and logs the rescue
```

and replace it with:

```ts
    h.sh(`${stubs('❯ ', 'claude-a')} _auto_swap_check ${ID}`, env(t));   // logs the rescue; the near wait stays open
    const SWAP = 'systemctl() { :; }; launchctl() { :; }; tmux() { :; }; sleep() { :; };';
    h.sh(`${SWAP} CCD_SWAP_AUTO=1 cmd_swap ${ID} claude-a`, { TMUX: '' });   // the landing closes it as a swap
```


- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts test/measure-continuity-stage4.test.ts --maxWorkers=2
```

Expected: `7 failed | 107 passed (114)` — the five new rescue-policy cases (a REFUSED auto-rescue…; a dispatched
rescue that never landed…; …the BEST account…; a not-blocked tick…; a forged reset=…) and the two stage-4 target
cases (counts u1 and u7 only…; a forged reset= is no date…).

- [ ] **Step 3: The `ccd/ccd` edits**

F1 — the rescue arm writes no end; `cmd_swap`'s landing (unchanged, `_rescuewait_close "$id" swap` beside
`_strand_clear`) is the only place a wait ends `swap`. F5 — the not-blocked close behind `_strand_clear`'s `-e` test.
Minor 5 with minors 3 and 4 — `_rescue_history` pairs each of this session's `auto-rescue` lines with the landing that
follows it before its next rescue, caps `reset=` at twelve digits, and keeps a set beside each list. F3 — the two
comments scoped to a genuine no-room strand. F2 — "best", in the cause and its comment:

In `ccd/ccd` (in `_auto_swap_check`), find:

<!-- replay: replace ccd/ccd -->
```bash
    echo "$(date '+%F %T') auto-rescue $id: $wrapper (blocked) -> $target [home=$home]$([[ "${HARD_BLOCK_VIA:-}" == pane ]] || printf ' via=%s' "${HARD_BLOCK_VIA:-unknown}")$(_rescue_line_extra)" >> "$REG/swap.log"; _rescuewait_close "$id" swap
    _dispatch_swap "$id" "$target"
```

and replace it with:

```bash
    echo "$(date '+%F %T') auto-rescue $id: $wrapper (blocked) -> $target [home=$home]$([[ "${HARD_BLOCK_VIA:-}" == pane ]] || printf ' via=%s' "${HARD_BLOCK_VIA:-unknown}")$(_rescue_line_extra)" >> "$REG/swap.log"
    _dispatch_swap "$id" "$target"   # an open rescue wait ends `swap` at cmd_swap's landing, never here: the swap can still be refused
```

In `ccd/ccd` (in `_rescue_policy`), find:

<!-- replay: replace ccd/ccd -->
```bash
    _rescuewait_close "$id" clear
```

and replace it with:

```bash
    # EVERY NOT-BLOCKED TICK OF EVERY SESSION reaches this line, and the close's
    # two command substitutions fork whether or not a record exists (measured
    # ~1.7 ms a tick a session). The `-e` test is `_strand_clear`'s, and it
    # changes no answer: the close is a no-op with no open record.
    [[ -e "$REG/$id.rescuewait" ]] && _rescuewait_close "$id" clear
```

In `ccd/ccd` (in `_rescue_history`), find:

<!-- replay: replace ccd/ccd -->
```bash
  # rescue that has somewhere to go — not the ticks a strand waits through,
  # which need neither.
  # Its times are `date '+%F %T'`, LOCAL time, so python converts with `mktime`.
  #   RESCUE_COUNT       this session's `auto-rescue` lines in RESCUE_CHAIN_WINDOW;
  #   RESCUE_SKIP_LEFT   their SOURCE accounts ("an account the session just
  #                      left blocked"), except one whose logged `reset=` passed;
  #   RESCUE_SKIP_RECENT every session's rescue TARGET in RESCUE_SPREAD_WINDOW.
  # UNMEASURABLE IS TODAY'S BEHAVIOUR: no chain wait, no skip. A log that does
  # not exist yet is a MEASURED empty history (rc 0), not an unreadable one, and
  # so is a tail with no rescue in it (`grep` rc 1).
  local id="$1" out
  RESCUE_COUNT=0; RESCUE_SKIP_LEFT=""; RESCUE_SKIP_RECENT=""
  [[ -e "$REG/swap.log" ]] || return 0
  [[ -f "$REG/swap.log" && -r "$REG/swap.log" ]] || return 2
  command -v python3 >/dev/null 2>&1 || return 2
  out=$(tail -c "$RESCUE_LOG_TAIL_BYTES" "$REG/swap.log" 2>/dev/null | { grep -F ' auto-rescue ' || (( $? == 1 )); } | python3 -c '
import re, sys, time
sid, now, chain, spread = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
pat = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) auto-rescue (\S+): (\S+) \(blocked\) -> (\S+)(.*)$")
count, left, recent = 0, [], []
for raw in sys.stdin.buffer:
    m = pat.match(raw.decode("utf-8", "replace").rstrip("\n"))
    if not m:
        continue
    try:
        at = int(time.mktime(time.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")))
    except (ValueError, OverflowError):
        continue
    age = now - at
    if age < 0:
        continue
    if m.group(2) == sid and age < chain:
        count += 1
        r = re.search(r" reset=(\d+)", m.group(5))
        if not (r and int(r.group(1)) <= now) and m.group(3) not in left:
            left.append(m.group(3))
    if age < spread and m.group(4) not in recent:
        recent.append(m.group(4))
print(str(count) + "|" + " ".join(left) + "|" + " ".join(recent))
' "$id" "$(date +%s)" "$RESCUE_CHAIN_WINDOW" "$RESCUE_SPREAD_WINDOW" 2>/dev/null) || return 2
  IFS='|' read -r RESCUE_COUNT RESCUE_SKIP_LEFT RESCUE_SKIP_RECENT <<<"$out"
  [[ "$RESCUE_COUNT" =~ ^[0-9]+$ ]] || { RESCUE_COUNT=0; RESCUE_SKIP_LEFT=""; RESCUE_SKIP_RECENT=""; return 2; }
  return 0
}

_rescue_target() {   # id cur home hard-blocked hrc -> `_swap_target`'s stdout and rc, rule 3's skip lists applied to a RESCUE
  # NOT A RESCUE, NOWHERE TO GO, OR NOBODY CAN SAY IS `_swap_target` BYTE FOR
  # BYTE: the affinity path's choice is not this spec's; skipping can only
  # remove a candidate, so a strand — asked every 5 s for hours — never pays
  # the swap-log read; and the unskipped probe's undecidable answer (rc 2-5)
```

and replace it with:

```bash
  # rescue that has somewhere to go — not the ticks a GENUINE no-room strand
  # waits through, which need neither. A do-not-bounce strand (its only room
  # is an account it just left) reads it on every tick, twice: once in
  # `_rescue_target` and once to say so (`_rescue_strand_cause`, departure 3849).
  # Its times are `date '+%F %T'`, LOCAL time, so python converts with `mktime`.
  #   RESCUE_COUNT       this session's rescues in RESCUE_CHAIN_WINDOW that LANDED;
  #   RESCUE_SKIP_LEFT   their SOURCE accounts ("an account the session just
  #                      left blocked"), except one whose logged `reset=` passed;
  #   RESCUE_SKIP_RECENT every session's rescue TARGET in RESCUE_SPREAD_WINDOW.
  # A RESCUE LANDED when `cmd_swap`'s own `swap <id>: <from> -> <to> (uuid …)`
  # line follows its `auto-rescue` line before this session's next one: a
  # dispatch the swap refused never left its account, so it neither counts
  # toward the chain wait nor marks that account left. The spread list keeps
  # every dispatch, landed or in flight — a move still carrying is the herd.
  # UNMEASURABLE IS TODAY'S BEHAVIOUR: no chain wait, no skip. A log that does
  # not exist yet is a MEASURED empty history (rc 0), not an unreadable one, and
  # so is a tail with no rescue in it (`grep` rc 1). A forged line cannot crash
  # the read: `reset=` takes at most twelve digits, and each list is checked
  # against a set beside it, so a long tail costs one pass.
  local id="$1" out
  RESCUE_COUNT=0; RESCUE_SKIP_LEFT=""; RESCUE_SKIP_RECENT=""
  [[ -e "$REG/swap.log" ]] || return 0
  [[ -f "$REG/swap.log" && -r "$REG/swap.log" ]] || return 2
  command -v python3 >/dev/null 2>&1 || return 2
  out=$(tail -c "$RESCUE_LOG_TAIL_BYTES" "$REG/swap.log" 2>/dev/null | { grep -F -e ' auto-rescue ' -e ' swap ' || (( $? == 1 )); } | python3 -c '
import re, sys, time
sid, now, chain, spread = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
pat = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) auto-rescue (\S+): (\S+) \(blocked\) -> (\S+)(.*)$")
land = re.compile(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d swap (\S+): (\S+) -> (\S+) \(uuid ")
count, left, recent, in_left, in_recent, pending = 0, [], [], set(), set(), None
for raw in sys.stdin.buffer:
    line = raw.decode("utf-8", "replace").rstrip("\n")
    m = land.match(line)
    if m:
        if pending is not None and m.group(1) == sid and (m.group(2), m.group(3)) == pending[:2]:
            count += 1
            r = re.search(r" reset=(\d{1,12})(?!\d)", pending[2])
            if not (r and int(r.group(1)) <= now) and pending[0] not in in_left:
                in_left.add(pending[0]); left.append(pending[0])
            pending = None
        continue
    m = pat.match(line)
    if not m:
        continue
    try:
        at = int(time.mktime(time.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")))
    except (ValueError, OverflowError):
        continue
    age = now - at
    if age < 0:
        continue
    if m.group(2) == sid:
        pending = (m.group(3), m.group(4), m.group(5)) if age < chain else None
    if age < spread and m.group(4) not in in_recent:
        in_recent.add(m.group(4)); recent.append(m.group(4))
print(str(count) + "|" + " ".join(left) + "|" + " ".join(recent))
' "$id" "$(date +%s)" "$RESCUE_CHAIN_WINDOW" "$RESCUE_SPREAD_WINDOW" 2>/dev/null) || return 2
  IFS='|' read -r RESCUE_COUNT RESCUE_SKIP_LEFT RESCUE_SKIP_RECENT <<<"$out"
  [[ "$RESCUE_COUNT" =~ ^[0-9]+$ ]] || { RESCUE_COUNT=0; RESCUE_SKIP_LEFT=""; RESCUE_SKIP_RECENT=""; return 2; }
  return 0
}

_rescue_target() {   # id cur home hard-blocked hrc -> `_swap_target`'s stdout and rc, rule 3's skip lists applied to a RESCUE
  # NOT A RESCUE, NOWHERE TO GO, OR NOBODY CAN SAY IS `_swap_target` BYTE FOR
  # BYTE: the affinity path's choice is not this spec's; skipping can only
  # remove a candidate, so a GENUINE no-room strand — asked every 5 s for
  # hours — never pays the swap-log read (a do-not-bounce strand does: its
  # unskipped probe names the account it left); and the unskipped probe's undecidable answer (rc 2-5)
```

In `ccd/ccd` (in `_rescue_strand_cause`), find:

<!-- replay: replace ccd/ccd -->
```bash
  # and when the only one with room is an account this session just left
  # blocked; `_strand_mark`'s computed reason (`_strand_why`, which knows no
```

and replace it with:

```bash
  # and when every one with room is an account this session just left
  # blocked — after two or three rescues inside RESCUE_CHAIN_WINDOW that can be
  # several, so the cause names the unskipped probe's BEST one, never "the
  # only" one; `_strand_mark`'s computed reason (`_strand_why`, which knows no
```

In `ccd/ccd` (in `_rescue_strand_cause`), find:

<!-- replay: replace ccd/ccd -->
```bash
  printf '%s\n' "its only account with room, $out, is one it left blocked inside RESCUE_CHAIN_WINDOW, and a rescue does not take it back (do not bounce)"
```

and replace it with:

```bash
  printf '%s\n' "its best account with room, $out, is one it left blocked inside RESCUE_CHAIN_WINDOW, and a rescue does not take it back (do not bounce)"
```


then re-stamp:

<!-- replay: bash -->
```bash
~/.local/bin/ccrc restamp ccd/ccd && bash -n ccd/ccd && echo syntax-ok
```

Expected: `restamp: ccd/ccd: …` and `syntax-ok`.

- [ ] **Step 4: The stage-4 target row (F6)**

§9's stage-4 row is restated (Step 6) to "sessions with a fourth auto-rescue in an hour that no chain wait preceded,
counting rescues that landed and asking it only of a fourth rescue the chain wait could have held", with the raw 4+
count reported beside it. The instrument counts it with rule 3's own landing rule and the chain wait's own gate (a
dated block not past its five-hour reset's grace) — a filter the ruled wording did not carry, so Step 6 writes it
into the spec row itself and the wave-done mail puts it to the coordinator (Open question 5). A `reset=` that is not
one to twelve digits is no date, so a forged line can neither raise nor count:

In `deploy/measure-continuity.py`, find this anchor:

<!-- replay: insert-above deploy/measure-continuity.py -->
```python
    opened, ended = collections.Counter(), collections.Counter()
```

and insert, directly above it:

```python
    moves, landed_moves, chain_opens = collections.defaultdict(list), collections.defaultdict(list), collections.defaultdict(list)
```

In `deploy/measure-continuity.py`, find:

<!-- replay: replace deploy/measure-continuity.py -->
```python
            continue
        m = S4_RESCUE.match(line)
        if m:
            t = s4_epoch(m.group(1))
            if inwin(t):
                rescues.append((t, m.group(2), dict(S4_TOKEN.findall(m.group(5)))))
```

and replace it with:

```python
                landed_moves[m.group(2)].append((t, m.group(3), m.group(4)))
            continue
        m = S4_RESCUE.match(line)
        if m:
            t = s4_epoch(m.group(1))
            if inwin(t):
                rescues.append((t, m.group(2), dict(S4_TOKEN.findall(m.group(5)))))
            if t is not None:
                moves[m.group(2)].append((t, m.group(3), m.group(4), dict(S4_TOKEN.findall(m.group(5)))))
```

In `deploy/measure-continuity.py`, find this anchor:

<!-- replay: insert-above deploy/measure-continuity.py -->
```python
            if upto(t):
                pending[m.group(2)] = (m.group(3), m.group(5))
```

and insert, directly above it:

```python
            if t is not None and m.group(3) == "chain":
                chain_opens[m.group(2)].append(t)
```

In `deploy/measure-continuity.py`, find this anchor:

<!-- replay: insert-above deploy/measure-continuity.py -->
```python
    # Sessions with RESCUE_CHAIN_COUNT + 1 (= 4) or more auto-rescues inside any 60 minutes.
```

and insert, directly above it:

```python
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

```

In `deploy/measure-continuity.py`, find this anchor:

<!-- replay: insert-above deploy/measure-continuity.py -->
```python
        "chain_waits_ending_in_neither_swap_nor_reset": chain_neither,
```

and insert, directly above it:

```python
        "sessions_with_an_unchained_4th_rescue_in_an_hour": unchained,
```


- [ ] **Step 5: README (F3, and the landing rule)**

Line-neutral but for two added lines (`pools-prose` holds CLAUDE.md's `~5600` within 100 of README's length: 5598
after this task, 5621 after Task 4):

In `README.md`, find:

<!-- replay: replace README.md -->
```text
  home (the affinity path would only move it back). A fourth rescue within the hour on an Anthropic lane, on a
  dated block not already past its five-hour reset's grace, first waits up to `RESCUE_CHAIN_WAIT=1800`
  seconds (`kind=chain`), then swaps; with no room it becomes the no-room wait; at its account's reset it ends in
  place if armed and is rescued if stalled. A Codex-lane session is never chain-waited, so the lane's "pool is
  full" signal is written at once. Rule 3 reads the tail of `swap.log` (`RESCUE_LOG_TAIL_BYTES`) only when a
  decision needs it — not on the ticks a strand waits through.
```

and replace it with:

```text
  home (the affinity path would only move it back). A fourth landed rescue within the hour on an Anthropic lane, on a
  dated block not already past its five-hour reset's grace, first waits up to `RESCUE_CHAIN_WAIT=1800`
  seconds (`kind=chain`), then swaps; with no room it becomes the no-room wait; at its account's reset it ends in
  place if armed and is rescued if stalled. A Codex-lane session is never chain-waited, so the lane's "pool is
  full" signal is written at once. Rule 3 reads the tail of `swap.log` (`RESCUE_LOG_TAIL_BYTES`) only when a
  decision needs it — not on the ticks a genuine no-room strand waits through (a do-not-bounce strand reads it).
  A rescue counts, and marks the account it left, only once `cmd_swap`'s landing line follows it: a refused swap
  never left.
```


- [ ] **Step 6: The spec, rev 7 (F6 ruled; the landing rule)**

A spec edit, stated as such: F6 was ruled by the coordinator on 2026-10-03 ("0 sessions with a fourth rescue in an
hour that NO chain wait preceded; the raw 4+ count is reported"), and minor 5 is decided here as "key on the
landing", which narrows rule 3's "auto-rescues" to the ones that landed. Four of the five hunks are substrings of
lines that carry another programme's departure number, so they are `replace-text` blocks:

<!-- replay: insert-above docs/superpowers/specs/2026-09-23-session-continuity-design.md -->
```text
**Date:** 2026-09-23 ·
```

insert, directly above that line,

```text
rev 7 counts rule 3's rescues on their landing and restates §9's stage-4 target (review 246, ruled 2026-10-03),
and records stage 7 as planned by its wave-3 plan, 2026-10-04 ·
```

<!-- replay: replace-text docs/superpowers/specs/2026-09-23-session-continuity-design.md -->
```text
of any of this session's auto-rescues within `RESCUE_CHAIN_WINDOW` (3600 s)
```

with

```text
of any of this session's auto-rescues that landed within `RESCUE_CHAIN_WINDOW` (3600 s)
```

<!-- replay: replace-text docs/superpowers/specs/2026-09-23-session-continuity-design.md -->
```text
only when a decision needs it, never on the ticks a strand waits
```

with

```text
only when a decision needs it, never on the ticks a genuine no-room strand waits
```

<!-- replay: replace-text docs/superpowers/specs/2026-09-23-session-continuity-design.md -->
```text
   in the last hour, on an Anthropic lane and a dated block, is not rescued a fourth time at once
```

with

```text
   in the last hour (rescues whose swap landed: a refused one never left), on an Anthropic lane and a dated block,
   is not rescued a fourth time at once
```

<!-- replay: replace-text docs/superpowers/specs/2026-09-23-session-continuity-design.md -->
```text
| 4 | sessions with 4 or more auto-rescues in an hour;
```

with

```text
| 4 | sessions with a fourth auto-rescue in an hour that no chain wait preceded, counting rescues that landed and asking it only of a fourth rescue the chain wait could have held (a dated block not past its five-hour reset's grace — rule 3's own gate; the raw count of sessions with 4 or more is reported beside it);
```

The target cell stays `0`: it now names what the design promises (a chain wait that runs its full 30 minutes still
ends in a fourth rescue inside the hour, review 246 F6). The row also carries the instrument's filter — only a fourth
rescue the chain wait could have held (a dated block not past its five-hour reset's grace) is asked about — because
rule 3 never chain-waits an undated or past-reset fourth rescue, so the ruled wording alone would set a 0 the design
cannot meet; that narrowing is the worker's reading, not the ruling, and the wave-done mail asks the coordinator to
confirm or drop it (Open question 5).

- [ ] **Step 7: Pay the citation tax, then run the tests to verify they pass**

Run the S6-R11 procedure above (expected unchanged: `147 / 197 / 52 / 35`, `corpus-frozen`; the `_reg_get` census
is untouched by this task — `grep -v '^[[:space:]]*#' ccd/ccd | grep -o '_reg_get "' | wc -l` → `179`, and `grep -c`
→ `150`). Then:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts test/measure-continuity-stage4.test.ts test/measure-continuity.test.ts --maxWorkers=2
./node_modules/.bin/vitest run test/ccd-swap-pin.test.ts test/ccd-auto-swap-pool.test.ts test/ownership.test.ts test/ccd-reg-get-census.test.ts test/ccd-swap.test.ts --maxWorkers=2
./node_modules/.bin/vitest run test/pools-prose.test.ts test/ccd-limit-banner.test.ts --maxWorkers=2
```

Expected: `119 passed (119)` (102 + 12 + 5); then `89 passed (89)` (13 + 43 + 14 + 3 + 16); then `163 passed (163)`
(27 + 136 — `ccd-limit-banner`'s "own second" case is a load flake: re-run it alone).

- [ ] **Step 8: Mutation check, then commit**

Each row applied to a saved copy of the file, `ccd/ccd` re-stamped, the suite run, and the file restored from the
copy (`cmp`). Multi-line edits show their lines joined by ` / `; `(nothing)` is a deletion.

| # | File | Exact edit (old → new) | Suite | Measured red on the full prototype |
|---|---|---|---|---|
| 1.1 | `ccd/ccd` | `$(_rescue_line_extra)" >> "$REG/swap.log" / _dispatch_swap "$id" "$target"   #` → `$(_rescue_line_extra)" >> "$REG/swap.log"; _rescuewait_close "$id" swap / _dispatch_swap "$id" "$target"   #` | ccd-rescue-policy.test.ts | 1 failed \| 101 passed (102): “a REFUSED auto-rescue leaves the wait open: neither the rescue arm nor the refusal writes an end” |
|  | `ccd/ccd` | ″ | measure-continuity-stage4.test.ts | 12 passed (12) |
| 1.2 | `ccd/ccd` | `if pending is not None and m.group(1) == sid and (m.group(2), m.group(3)) == pending[:2]:` → `if pending is not None and m.group(1) == sid:` | ccd-rescue-policy.test.ts | 1 failed \| 101 passed (102): “a dispatched rescue that never landed neither counts toward the chain wait nor marks the account it left” |
| 1.3 | `ccd/ccd` | `pending = (m.group(3), m.group(4), m.group(5)) if age < chain else None` → `pending = None; count += age < chain` | ccd-rescue-policy.test.ts | 9 failed \| 93 passed (102): “a target the session just left blocked is skipped”; “a row written days after its own reset logs no reset=, and the next rescue does not bounce back to that account”; “after RESCUE_CHAIN_WAIT the chain wait swaps — to a target that is not the account it just left blocked”; … and 6 more |
| 1.4 | `ccd/ccd` | `"its best account with room, $out,` → `"its only account with room, $out,` | ccd-rescue-policy.test.ts | 1 failed \| 101 passed (102): “after two rescues the do-not-bounce cause names the BEST account with room, never "the only" one” |
| 1.5 | `ccd/ccd` | `[[ -e "$REG/$id.rescuewait" ]] && _rescuewait_close "$id" clear` → `_rescuewait_close "$id" clear` | ccd-rescue-policy.test.ts | 1 failed \| 101 passed (102): “a not-blocked tick with no record never reaches the close; with an open record it still ends it `clear`” |
| 1.6 | `ccd/ccd` | `r" reset=(\d{1,12})(?!\d)"` → `r" reset=(\d+)"` | ccd-rescue-policy.test.ts | 1 failed \| 101 passed (102): “a forged reset= of 5000 digits is no reset: the history is measured and the account stays skipped” |
| 1.7 | `deploy/measure-continuity.py` | `if not any(done[i - 1][0] <= c <= t for c in chain_opens.get(sid, [])):` → `if True:` | measure-continuity-stage4.test.ts | 1 failed \| 11 passed (12): “counts u1 and u7 only: u2 chain-waited, u3's second swap was refused, u4's blocks were undated, u5's reset had passed, u6's fourth fell outside the hour, u7's only chain wait came before its first rescue — and the raw row counts six” |
| 1.8 | `deploy/measure-continuity.py` | `if any(t <= lt < nxt and (ls, ld) == (src, dst) for lt, ls, ld in lands):` → `if True:` | measure-continuity-stage4.test.ts | 1 failed \| 11 passed (12): “counts u1 and u7 only: u2 chain-waited, u3's second swap was refused, u4's blocks were undated, u5's reset had passed, u6's fourth fell outside the hour, u7's only chain wait came before its first rescue — and the raw row counts six” |
| 1.9 | `deploy/measure-continuity.py` | `or not re.fullmatch(r"\d{1,12}", tok.get("reset", "")) or "type" not in tok:` → `:` | measure-continuity-stage4.test.ts | 2 failed \| 10 passed (12): “counts u1 and u7 only: u2 chain-waited, u3's second swap was refused, u4's blocks were undated, u5's reset had passed, u6's fourth fell outside the hour, u7's only chain wait came before its first rescue — and the raw row counts six”; “a forged reset= is no date: neither a word nor 5000 digits stops the read, and neither is counted” |
| 1.10 | `deploy/measure-continuity.py` | `if tok.get("type") == "five_hour" and t >= int(tok["reset"]) + S4_GRACE: / continue` → (nothing) | measure-continuity-stage4.test.ts | 1 failed \| 11 passed (12): “counts u1 and u7 only: u2 chain-waited, u3's second swap was refused, u4's blocks were undated, u5's reset had passed, u6's fourth fell outside the hour, u7's only chain wait came before its first rescue — and the raw row counts six” |
| 1.11 | `ccd/ccd` | `r" reset=(\d{1,12})(?!\d)"` → `r" reset=(\d{1,12})"` | ccd-rescue-policy.test.ts | 1 failed \| 101 passed (102): “a forged reset= of 5000 digits is no reset: the history is measured and the account stays skipped” |
| 1.12 | `deploy/measure-continuity.py` | `or t - done[i - 3][0] >= 3600 or` → `or` | measure-continuity-stage4.test.ts | 1 failed \| 11 passed (12): “counts u1 and u7 only: u2 chain-waited, u3's second swap was refused, u4's blocks were undated, u5's reset had passed, u6's fourth fell outside the hour, u7's only chain wait came before its first rescue — and the raw row counts six” |
| 1.13 | `deploy/measure-continuity.py` | `done[i - 1][0] <= c <= t for c` → `c <= t for c` | measure-continuity-stage4.test.ts | 1 failed \| 11 passed (12): “counts u1 and u7 only: u2 chain-waited, u3's second swap was refused, u4's blocks were undated, u5's reset had passed, u6's fourth fell outside the hour, u7's only chain wait came before its first rescue — and the raw row counts six” |
| 1.14 | `deploy/measure-continuity.py` | `not re.fullmatch(r"\d{1,12}", tok.get("reset", ""))` → `"reset" not in tok` | measure-continuity-stage4.test.ts | 1 failed \| 11 passed (12): “a forged reset= is no date: neither a word nor 5000 digits stops the read, and neither is counted” |

Row 1.1 reds only the refused case, by design: the stubbed dispatch lands, so every other case sees the landing's own
close. Rows 1.7–1.10 and 1.12–1.13 each make one of the fixture's excluded sessions count (u2 chain-waited, u3's
refused swap, u4's undated blocks, u5's past reset, u6's fourth outside the hour) or the counted u7 drop (its only
chain entry came before its first rescue). Row 1.11 removes only the lookahead: the forged value's leading zeros then
read as a reset long past and lift the skip. Rows 1.9 and 1.14 make a forged `reset=` raise in `--stage 4`. Minor
4's set has no row: it changes no answer (Pre-flight 6).

```bash
git add ccd/ccd deploy/measure-continuity.py README.md docs/superpowers/specs/2026-09-23-session-continuity-design.md \
  server/test/ccd-rescue-policy.test.ts server/test/measure-continuity-stage4.test.ts
git commit -F - <<'EOF'
fix(continuity): a rescue wait ends at the landing, and rule 3 counts landed rescues (wave 2's residue, review 246)

F1: the rescue arm no longer writes `_rescuewait_close swap` before `_dispatch_swap`; cmd_swap's landing is the
only place a wait ends `swap`, so a refused auto-rescue leaves it open. Minor 5, decided with it: rule 3 counts a
rescue, and marks the account it left, only once cmd_swap's landing line follows it. F2: the do-not-bounce cause
names the probe's BEST account with room. F3: README and two comments scope "a strand reads no swap log" to the
genuine no-room strand. F5: an `-e` guard on the not-blocked close. Minors 3-4: `reset=` capped at twelve digits,
a set beside each skip list. F6 (ruled): spec §9's stage-4 target restated; `--stage 4` counts it.
EOF
```

---

### Task 2: The journal and the vocabulary (spec §5.7, first half)

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `ccd/ccd` — the new section directly above `_route_apply_now() {` (≈19299); one line in `_route_apply_now`
  before each `_route_type_*` call; one line in `_inject_spawn_effort` before its `send-keys`; one line in
  `_spawn_start` before its `local routeflags=…` (≈20353, below the corpus); `_reg_purge`'s inventory (≈3889–3900,
  three lines in place); the `_reg_get` census (≈3137–3141, in place)
- Test: `server/test/ccd-operator-choice.test.ts` (new)

**Interfaces:**
- Consumes: `_reg_get`/`_reg_set`; `ROUTE_CLASSES`, `ROUTE_EFFORTS`, `_route_word_in`.
- Produces: `TYPED_MATCH_WINDOW=60`, `TYPED_KEEP_ROWS=16`, `MODEL_FAMILY_TOKENS="-fable-:fable -opus-:opus
  -sonnet-:sonnet -haiku-:haiku"`; `_typed_note <id> <model|effort> <value>` — appends `"<epoch> <kind> <value>"` to
  `$REG/<id>.typed` (a value of one token, `[A-Za-z0-9._-]{1,64}`; the last `TYPED_KEEP_ROWS` keystroke rows kept)
  below the journal's FLOOR, its first row `"<epoch> since"`, written when the file has none and never moved;
  `_typed_note <id> since` opens the floor alone (a no-op on an open journal); always rc 0; `_model_family_class <model-id>` → the class its first family token names (`familyClassOf`), rc 1 none;
  `_model_class_of <value>` → a `ROUTE_CLASSES` word for an alias (case-folded, `[1m]` stripped) or a full model id,
  rc 1 outside the vocabulary.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-operator-choice.test.ts` (Task 3 appends its promotion and call-site describes):

<!-- replay: create server/test/ccd-operator-choice.test.ts -->
```ts
// The operator's choice survives a restart (session-continuity spec §5.7;
// wave 3). A `/model` or `/effort` typed in a session changes the running
// process only, and the next spawn rebuilds its command line from the route
// record — §1.4 measured an operator's switch to Opus come back as Fable at the
// next auto-home. So before every stop that a spawn follows, ccd reads the
// transcript for the newest of each local command that no journal row explains
// and writes that OPERATOR's choice through `cmd_route`'s own writer
// (`actor=operator-session`), while ccd's own keystrokes — the settle's
// `/effort`, `route --apply` — are journalled in `$REG/<id>.typed` and never
// promoted. Each case is red when its guard is removed (the plan's mutation
// table is the measurement).
//
// FIXTURE HOME ONLY (`makeCcdHarness`): systemd, tmux and every keystroke are
// shell functions that LOG, and the transcript is a file this file writes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness, WIDE_PANE, WS_ADD, CCD } from './ccdWsHelpers.js';
import { familyClassOf, FAMILY_TOKENS } from '../../shared/models.mjs';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-operator-choice-'); });
afterEach(() => { h.cleanup(); });

const ID = 'claude-demo';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const now = (): number => Math.floor(Date.now() / 1000);
const iso = (epoch: number): string => new Date(epoch * 1000).toISOString();
const DAY = 86400;

/** The journal's floor (`<epoch> since`), as a spawn by this ccd leaves it —
 *  two days ago unless the case says otherwise, so it is older than every
 *  command a case writes. */
const journal = (id = ID, age = 2 * DAY): void => {
  h.sh(`_reg_set ${id} typed "$(( $(date +%s) - ${age} )) since"`);
};
const seed = (id = ID, opened = true): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} home claude
        _reg_set ${id} project demo
        _reg_set ${id} workdir "$HOME/projects/demo"
        _reg_set ${id} uuid ${UUID}
        _reg_set ${id} started 1`);
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
  if (opened) journal(id);
};
/** Route fields, written a day ago — older than every command a case writes,
 *  unless the case says otherwise (THE RECORD WINS WHEN IT IS NEWER). */
const record = (fields: Record<string, string>, id = ID, age = DAY): void => {
  for (const [f, v] of Object.entries(fields)) {
    const p = path.join(h.home, '.cc-sessions', `${id}.${f}`);
    fs.writeFileSync(p, v);
    fs.utimesSync(p, now() - age, now() - age);
  }
};

/** Claude Code 2.1's own rows, field for field as a live transcript has them:
 *  the command envelope, then its acknowledgement as the next row. */
const cmd = (at: number, name: string, args = '', over: Record<string, unknown> = {}): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'user', uuid: `c${at}${name}`, timestamp: iso(at),
  message: { role: 'user', content: `<command-name>/${name}</command-name>\n            <command-message>${name}</command-message>\n            <command-args>${args}</command-args>` },
  ...over,
});
const ack = (at: number, text: string, over: Record<string, unknown> = {}): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'user', uuid: `k${at}`, timestamp: iso(at),
  message: { role: 'user', content: `<local-command-stdout>${text}</local-command-stdout>` },
  ...over,
});
const turn = (at: number): string => JSON.stringify({
  type: 'assistant', uuid: `a${at}`, timestamp: iso(at),
  message: { model: 'claude-opus-5', role: 'assistant', content: [{ type: 'text', text: 'Working on it.' }] },
});
/** The acknowledgement as the fleet's builds write it (2.1.250 and later:
 *  backticks), and as 2.1.226 wrote it (ANSI bold) — measured read-only over
 *  the fleet box's transcripts while planning. */
const MODEL_ACK = (name: string): string => `Set model to \`${name}\` for this session only`;
const MODEL_ACK_ANSI = (name: string): string => `Set model to \u001b[1m${name}\u001b[22m for this session only`;
const EFFORT_ACK = (level: string): string => `Set effort level to ${level} (this session only)`;
const ULTRACODE_ACK = 'Set effort level to ultracode (this session only): xhigh + dynamic workflow orchestration';

const writeTranscript = (lines: string[], id = ID): string => {
  const p = h.sh(`_transcript_path ${id}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
};
const keep = (id = ID): string => h.sh(`_operator_choice_keep ${id}; echo "rc=$?"`);
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const routeLines = (): string[] => swapLog().split('\n').filter((l) => /^\S+ \S+ route \S+: /.test(l));
/** The journal's KEYSTROKE rows, and its floor row apart. */
const typedRows = (id = ID): string[] => (h.reg(id, 'typed') ?? '').split('\n').filter((l) => / (model|effort) /.test(l));
const floorRow = (id = ID): string | undefined => (h.reg(id, 'typed') ?? '').split('\n')[0] || undefined;

/** The real cmd_swap, with systemd, tmux and the flush wait stubbed (the
 *  `ccd-swap.test.ts` idiom); TMUX is emptied so the detached arm is never taken. */
const SWAP = 'systemctl() { :; }; launchctl() { :; }; tmux() { :; }; sleep() { :; };';

// ── THE JOURNAL ───────────────────────────────────────────────────────────────

describe('ccd journals its own keystrokes in $REG/<id>.typed', () => {
  /** tmux RECORDS and answers `$PANE_TEXT` (the `ccd-route-settle.test.ts` stub). */
  const STUBS = `sleep() { :; };
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE}
      case "\${1:-}" in capture-pane) printf '%s\\n' "\${PANE_TEXT:-}" ;; esac; return 0; };
    _pane_box_draft() { printf ''; };`;
  const READY = '? for shortcuts\n❯ ';

  it('the settle journals its /effort before it types it', () => {
    seed();
    h.sh(`${STUBS} _inject_spawn_effort cc-${ID}`, { PANE_TEXT: READY });
    expect(h.calls()).toContain(`tmux send-keys -t =cc-${ID}: -l /effort ultracode`);
    expect(typedRows()).toHaveLength(1);
    expect(typedRows()[0]).toMatch(/^\d{10} effort ultracode$/);
  });

  it('a session whose record carries an effort types nothing and journals nothing', () => {
    seed(); record({ effort: 'high' });
    h.sh(`${STUBS} _inject_spawn_effort cc-${ID}`, { PANE_TEXT: READY });
    expect(typedRows()).toEqual([]);
  });

  it('route --apply journals the class it types and the effort, and nothing for auto', () => {
    seed(); record({ class: 'sonnet', effort: 'high' });
    const TYPERS = `_route_type_model() { echo "type-model $2" >> "$HOME/ccd-calls"; return 0; };
      _route_type_effort() { echo "type-effort $2" >> "$HOME/ccd-calls"; return 0; };`;
    h.sh(`${TYPERS} _route_apply_now ${ID}`);
    expect(typedRows().map((r) => r.replace(/^\d{10} /, ''))).toEqual(['model sonnet', 'effort high']);
    h.sh(`rm -f "$REG/${ID}.typed" "$REG/${ID}.routeapplied"; _reg_set ${ID} effort auto; ${TYPERS} _route_apply_now ${ID}`);
    expect(typedRows().map((r) => r.replace(/^\d{10} /, ''))).toEqual(['model sonnet']);
  });

  it('the spawn opens the journal at a floor, and a later spawn or keystroke keeps that floor', () => {
    const SPAWN = `tmux() { ${WIDE_PANE} :; }; _spawn_start ${ID} new || :`;
    h.sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} workdir "$HOME"; _reg_set ${ID} uuid u1; ${SPAWN}`);
    expect(floorRow(), 'the first spawn by this ccd opens the journal').toMatch(/^\d{10} since$/);
    h.sh(`_reg_set ${ID} typed "1000000000 since"; ${SPAWN}; _typed_note ${ID} effort high`);
    expect(floorRow()).toBe('1000000000 since');
    expect(typedRows()).toHaveLength(1);
  });

  it('keeps the last TYPED_KEEP_ROWS keystroke rows below its floor, and refuses a value that is not one token', () => {
    seed();
    const floor = floorRow();
    h.sh(`for i in $(seq 1 20); do _typed_note ${ID} effort "l$i"; done; _typed_note ${ID} effort "a b"; _typed_note ${ID} colour red`);
    const keepRows = Number(h.sh('echo "$TYPED_KEEP_ROWS"'));
    expect(typedRows()).toHaveLength(keepRows);
    expect(typedRows()[keepRows - 1]).toMatch(/ effort l20$/);
    expect(floorRow(), 'the floor never rotates out, and never moves').toBe(floor);
  });

  it('.typed purges with the row', () => {
    seed();
    h.sh(`_typed_note ${ID} effort high; _reg_purge ${ID}`);
    expect(h.reg(ID, 'typed')).toBeNull();
  });
});

// ── THE VOCABULARY ────────────────────────────────────────────────────────────

describe('a /model value maps through the alias table, then familyClassOf\'s dash-token rule', () => {
  const classOf = (v: string): string => h.sh(`out=$(_model_class_of ${JSON.stringify(v)}); echo "$?|$out"`);

  it('the aliases — ROUTE_CLASSES, each also with [1m] — and an acknowledgement\'s display word', () => {
    for (const [v, c] of [['opus', 'opus'], ['sonnet', 'sonnet'], ['haiku', 'haiku'], ['fable', 'fable'], ['default', 'default'],
      ['opus[1m]', 'opus'], ['sonnet[1m]', 'sonnet'], ['fable[1m]', 'fable'], ['default[1m]', 'default'], ['Opus', 'opus'], ['Default', 'default']]) {
      expect(classOf(v), v).toBe(`0|${c}`);
    }
  });

  it('a full model id through the port, and everything else outside the vocabulary', () => {
    for (const [v, c] of [['claude-opus-5-5', 'opus'], ['claude-fable-5-1', 'fable'], ['claude-sonnet-5', 'sonnet'],
      ['claude-haiku-4-5-20251001', 'haiku'], ['claude-opus-5-5[1m]', 'opus']]) {
      expect(classOf(v), v).toBe(`0|${c}`);
    }
    for (const v of ['gpt-5.6-sol', 'opusml/x', 'vendor/sonnetish', 'opus-x', '?', '']) expect(classOf(v), v).toBe('1|');
  });

  // THE AGREEMENT PIN: `_model_family_class` is a bash port of `familyClassOf`
  // (shared/models.mjs), so the two are run over one corpus and must agree id
  // for id, and ccd's token list must be FAMILY_TOKENS in its own order.
  it('_model_family_class agrees with familyClassOf on every id, and MODEL_FAMILY_TOKENS is FAMILY_TOKENS', () => {
    const corpus = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001',
      'claude-fable-opus-hybrid-1', 'claude-opus-sonnet-x-1', 'claude-sonnet-haiku-2', 'gpt-5.6-sol', 'opusml/x',
      'vendor/sonnetish', 'CLAUDE-OPUS-5-5', 'claude-opus', 'x-haiku-', '-sonnet-', 'anthropic/claude-opus-5-5',
      'us.anthropic.claude-sonnet-5-v1:0', 'opus', 'opus[1m]', ''];
    const bash = h.sh(corpus.map((id) => `out=$(_model_family_class ${JSON.stringify(id)}); echo "[$out]"`).join('; ')).split('\n').map((l) => l.slice(1, -1));
    expect(bash).toHaveLength(corpus.length);
    corpus.forEach((id, i) => expect(bash[i], id).toBe(familyClassOf(id) ?? ''));
    const declared = /^MODEL_FAMILY_TOKENS="([^"]+)"/m.exec(fs.readFileSync(CCD, 'utf8'));
    expect(declared?.[1]).toBe(FAMILY_TOKENS.map(([t, c]) => `${t}:${c}`).join(' '));
  });
});
```


- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-operator-choice.test.ts --maxWorkers=2
```

Expected: `7 failed | 2 passed (9)`. The two that pass are the control "a session whose record carries an effort
types nothing and journals nothing" and ".typed purges with the row", which `_reg_purge`'s dotless suffix glob
already satisfies — it pins that `.typed` stays inside it.

- [ ] **Step 3: The section, the journal calls and the inventory**

The section's header states the whole stage, so Task 3 only adds its last two functions and the call sites:

In `ccd/ccd` (in `_reg_purge`), find this text:

<!-- replay: replace-text ccd/ccd -->
```bash
`rescuewait` 43 — by addition,
```

and replace it with:

```bash
`rescuewait` 43 and `typed` 44 — by addition,
```

In `ccd/ccd` (in `_reg_purge`), find:

<!-- replay: replace ccd/ccd -->
```bash
  # The 43: `archived`, `archivedreason`, `archivemanifest`, `base`, `branch`,
  # `carriednote`, `child`, `compactnote`, `compactskip`, `crosspool`, `hold`, `home`, `hookstate`, `lastcompact`, `lastswap`,
  # `pool`, `prcheckedat`, `prhistory`, `prnumber`, `prphase`, `project`, `rc`,
  # `reaping`, `rescuewait`, `setup`, `spawn`, `stalenarrownote`, `started`, `stopped`, `stranded`,
  # `strandnotify`, `substrate`, `supervised`, `svcfailed`, `swapblocked`,
  # `swapnarrownote`, `tdate`, `tickstuck`, `turn`, `uuid`, `workdir`, `workspace`, `wrapper`. Note that `pool` here is the per-session
```

and replace it with:

```bash
  # The 44: `archived`, `archivedreason`, `archivemanifest`, `base`, `branch`,
  # `carriednote`, `child`, `compactnote`, `compactskip`, `crosspool`, `hold`, `home`, `hookstate`, `lastcompact`, `lastswap`,
  # `pool`, `prcheckedat`, `prhistory`, `prnumber`, `prphase`, `project`, `rc`,
  # `reaping`, `rescuewait`, `setup`, `spawn`, `stalenarrownote`, `started`, `stopped`, `stranded`,
  # `strandnotify`, `substrate`, `supervised`, `svcfailed`, `swapblocked`,
  # `swapnarrownote`, `tdate`, `tickstuck`, `turn`, `typed`, `uuid`, `workdir`, `workspace`, `wrapper`. Note that `pool` here is the per-session
```

In `ccd/ccd` (in `_route_apply_now`), find this anchor:

<!-- replay: insert-above ccd/ccd -->
```bash
_route_apply_now() {   # id -> 0 everything wanted is applied | 1 something is still pending
```

and insert, directly above it:

```bash
# ── THE OPERATOR'S CHOICE SURVIVES A RESTART (session-continuity spec §5.7) ──
# A `/model` or `/effort` typed in a session changes the running process only;
# the next spawn rebuilds its command line from the route record — spec §1.4
# measured an operator's switch to Opus come back as Fable at the next
# auto-home. So before a stop that a spawn follows, ccd reads the session's
# transcript for the newest `/model` and the newest `/effort` local command
# that no journal row explains — one per kind, because they are two fields —
# and writes that OPERATOR's choice to the record through `cmd_route`'s own
# writer, `actor=operator-session`; that writer's swap.log `route` line
# records it.
#
# CCD'S OWN KEYSTROKES ARE NOT THE OPERATOR'S. `_inject_spawn_effort` (the
# settle's `/effort`) and `_route_apply_now` (`route --apply`, a degraded class
# among them) journal each `/model` and `/effort` they are about to type in
# `$REG/<id>.typed`, one row `<epoch> <model|effort> <value>`, and a command of
# the same kind and value within TYPED_MATCH_WINDOW of a row is ccd's. The
# `routeapplied` stamp cannot serve: the spawn writes it from the composed argv
# before the settle `/effort` is typed, and `route --apply` rewrites it for
# fields it never types.
#
# THE JOURNAL HAS A FLOOR. Its first row, `<epoch> since`, is written when the
# journal opens — at the first spawn this ccd makes (`_spawn_start`), the first
# keystroke it journals, or the first stop that finds none — and is kept when
# older rows rotate out. A command older than the floor is never read: an
# older ccd typed the settle's `/effort` and `route --apply`'s `/model` without
# journalling them, so before the floor ccd's keystrokes and the operator's
# cannot be told apart. A stop that finds no floor opens it and promotes
# nothing, and says so (`unmeasured`).
#
# A COMMAND'S VALUE is its `<command-args>`, or — for the picker and the slider,
# which take none — the value Claude Code's own acknowledgement names, with its
# ANSI bold or backticks removed (`Set model to Opus 5.5 …`, `Set effort level to
# high …`, `Ultracode on …`); a picker row Claude Code marks `(default)` is the
# `default` class. A command with no
# acknowledgement after it changed nothing and is never read, nor is a row a
# subagent wrote, nor a user turn that carries anything besides the envelope (a
# human quoting it). A `/model` value maps to the record's class vocabulary
# through the alias table — `ROUTE_CLASSES` itself (`opus`, `sonnet`, `haiku`,
# `fable`, `default`), each also with its `[1m]` suffix — then, for a full model
# id, `_model_family_class`, the bash port of `familyClassOf`'s dash-token rule
# (`shared/models.mjs`), pinned to it by an agreement test. A `/effort` value
# maps through `ROUTE_EFFORTS`.
#
# NEVER A FAILURE IN THE STOP PATH, AND NEVER A SILENT LOSS. Every path is rc 0
# and the stop goes on exactly as before. Silent only where nothing was lost:
# no registry row, no transcript, no command, a value already held, a field
# newer than the keystroke. Logged as `operator-choice <id>: …` where the
# operator's choice may be lost: a value outside the vocabulary or one the
# record's own checks refuse (`cmd_route` runs in a subshell, so its `die` ends
# only that) — the record unchanged — and `unmeasured (…)` where ccd could not
# read at all (no floor yet, a transcript that is not a readable regular file —
# never `grep` on a FIFO — no python, a reader that failed).
#
# THE RECORD WINS WHEN IT IS NEWER. A field written after the keystroke — the
# PWA's picker, a coordinator's route, this function's own last promotion — is
# the later choice, so a command older than the field's file is not promoted;
# a field whose time cannot be read is not overwritten either; and a value the
# record already holds is not written again.
TYPED_MATCH_WINDOW=60   # seconds between a journalled keystroke and the transcript command it explains: ccd's slowest typing (the effort slider: seven Lefts and up to four Rights, a second each) lands well inside it
TYPED_KEEP_ROWS=16      # `.typed` keystroke rows kept beside its floor: only a row near a command matters, and the settle and the applier type a handful per spawn
MODEL_FAMILY_TOKENS="-fable-:fable -opus-:opus -sonnet-:sonnet -haiku-:haiku"   # `familyClassOf`'s FAMILY_TOKENS (shared/models.mjs), in its match order — the agreement test reds on any drift

_typed_note() {   # id model|effort value — journal one keystroke ccd is about to type; id since — open the journal only (§5.7). Never fails its caller.
  local id="$1" kind="$2" v="${3:-}" rows floor
  [[ "$kind" == since || ( "$kind" =~ ^(model|effort)$ && "$v" =~ ^[A-Za-z0-9._-]{1,64}$ ) ]] || return 0
  rows=$(_reg_get "$id" typed)
  floor="${rows%%$'\n'*}"
  if [[ "$floor" =~ ^[0-9]{1,12}\ since$ ]]; then
    [[ "$kind" == since ]] && return 0   # already open: the floor stays where it was
  else
    floor="$(date +%s) since"
  fi
  rows=$(grep -E '^[0-9]{1,12} (model|effort) ' <<<"$rows" | tail -n "$((TYPED_KEEP_ROWS - 1))")
  [[ "$kind" == since ]] || rows="${rows:+$rows$'\n'}$(date +%s) $kind $v"
  _reg_set "$id" typed "$floor${rows:+$'\n'$rows}" 2>/dev/null || true
  return 0
}

_model_family_class() {   # model-id -> the class its first family token names | rc 1 none (`familyClassOf`, ported)
  local t
  for t in $MODEL_FAMILY_TOKENS; do
    [[ "$1" == *"${t%%:*}"* ]] && { printf '%s\n' "${t##*:}"; return 0; }
  done
  return 1
}

_model_class_of() {   # /model value -> the record's class word | rc 1 outside the vocabulary
  local v="${1%\[1m\]}"
  _route_word_in "${v,,}" "$ROUTE_CLASSES" && { printf '%s\n' "${v,,}"; return 0; }
  _model_family_class "$v"
}

```

In `ccd/ccd` (in `_route_apply_now`), find this anchor:

<!-- replay: insert-above ccd/ccd -->
```bash
    _route_type_model "$id" "$cls" "$w"; rc=$?
```

and insert, directly above it:

```bash
    _typed_note "$id" model "$cls"   # ccd's own keystroke, never the operator's choice (session-continuity §5.7)
```

In `ccd/ccd` (in `_route_apply_now`), find this anchor:

<!-- replay: insert-above ccd/ccd -->
```bash
      _route_type_effort "$id" "$eff"; rc=$?
```

and insert, directly above it:

```bash
      _typed_note "$id" effort "$eff"   # ccd's own keystroke, never the operator's choice (session-continuity §5.7)
```

In `ccd/ccd` (in `_inject_spawn_effort`), find this anchor:

<!-- replay: insert-above ccd/ccd -->
```bash
  tmux send-keys -t "$t" -l "/effort $level"; sleep 1; tmux send-keys -t "$t" Enter
```

and insert, directly above it:

```bash
  _typed_note "$id" effort "$level"   # the settle's keystroke, never the operator's choice (session-continuity §5.7)
```

The journal's floor opens at the spawn (review finding: without a floor, every live session's first stop after the
deploy would promote the settle `/effort ultracode` an older ccd typed unjournalled — review measured it on the first draft:
`effort ∅ -> ultracode [actor=operator-session]`). `_spawn_start` is below the corpus, so the line moves no citation:

In `ccd/ccd` (in `_spawn_start`), find this anchor:

<!-- replay: insert-above ccd/ccd -->
```bash
  local routeflags="" routeenv="" rclass rsub rwf reff inert="" rapplied
```

and insert, directly above it:

```bash
  _typed_note "$id" since   # the operator-choice journal opens at this ccd's first spawn of the row: no older command is read as the operator's (session-continuity §5.7)
```


- [ ] **Step 4: The `_reg_get` census — save the script**

It re-derives the census from `origin/main`'s own sentence (located by CONTENT, the one line saying `invocations
across`) plus a delta, refuses unless the header's two commands measure exactly that, and rewrites the two LAST MOVE
lines from MAIN's two (this wave's move first, main's named after it with its count and parenthetical, main's chain
kept) — so it is idempotent and Task 3 and Task 5 re-run it with their own delta:

<!-- replay: save reg-get-census.py -->
```python
import re, subprocess, sys
# `_reg_get`'s census, re-derived IN PLACE from origin/main's own block — located by CONTENT, the one
# line that says `invocations across` — so it is idempotent: Task 2 runs it with 1 (`_typed_note`'s
# read), Task 3 with 2 (and `_operator_choice_keep`'s), and Task 5 again after a merge took MAIN's
# census lines. The tree must measure exactly main's stated pair + <delta>; the two LAST MOVE lines
# are main's two rewritten two for two: this wave's move first, main's named after it with its own
# parenthetical, main's own chain kept. Writes nothing on STOP.
# usage: python3 reg-get-census.py <delta>
DELTA = int(sys.argv[1])
OURS = f"the operator-choice reads (session-continuity wave 3), the +{DELTA}"
def sh(cmd): return subprocess.run(['bash', '-c', cmd], capture_output=True, text=True, check=True).stdout
def count(text, flag):
    return int(subprocess.run(['bash', '-c', f"grep -v '^[[:space:]]*#' | grep {flag} '_reg_get \"' | {'wc -l' if flag == '-o' else 'cat'}"],
                              input=text, capture_output=True, text=True).stdout.strip() or 0)
def block(src, label):
    hits = [i for i, l in enumerate(src) if 'invocations across' in l]
    if len(hits) != 1: sys.exit(f'STOP: {label}: {len(hits)} lines say "invocations across", want 1')
    i = hits[0]
    a = re.fullmatch(r'(# .*this file makes )(\d+)', src[i - 1])
    b = re.fullmatch(r'(# invocations across )(\d+)( non-comment lines\.)', src[i])
    if not (a and b and src[i + 1] == '#' and src[i + 2].startswith('# THE LAST MOVE WAS ')
            and src[i + 3].startswith('# ') and src[i + 4].startswith("# BEFORE THAT IT WAS ROUTING SLICE 4's")):
        sys.exit(f'STOP: {label}: the census block at line {i + 1} is not in the shape this step edits')
    return i, a, b
base = sh('git show origin/main:ccd/ccd').split('\n')
bi, ba, bb = block(base, 'origin/main')
n0, m0 = int(ba.group(2)), int(bb.group(2))
tree_text = open('ccd/ccd', encoding='utf8').read()
n, m = count(tree_text, '-o'), count(tree_text, '-c')
if (n, m) != (n0 + DELTA, m0 + DELTA):
    sys.exit(f'STOP: origin/main states {n0}/{m0}; + {DELTA} is not the measured {n}/{m}')
move = re.fullmatch(r"THE LAST MOVE WAS (.+?), the \+(\d+)( \(.*?\))?; before it (.+)",
                    base[bi + 2][2:] + ' ' + base[bi + 3][2:])
if not move or 'session-continuity wave 3' in base[bi + 2]:
    sys.exit(f'STOP: origin/main\'s LAST MOVE lines are not "<move>, the +N [(...)]; before it <chain>": {base[bi + 2]!r}')
new = [f'# THE LAST MOVE WAS {OURS}; before it {move.group(1)}, the +{move.group(2)}{move.group(3) or ""};',
       f'# then {move.group(4)}']
near = [t for t in re.findall(r'(?:D-|#|ccd:)?\d{2,4}(?:st|nd|rd|th)?\b', ' '.join(new))
        if not re.match(r'(?:D-|#|ccd:)', t) and min(abs(int(re.sub(r'\D', '', t)) - x) for x in (n, m)) <= 25]
if near: sys.exit(f'STOP: the new LAST MOVE lines carry a cardinal near the census: {near}')
src = tree_text.split('\n')
i, a, b = block(src, 'the tree')
src[i - 1] = a.group(1) + str(n)
src[i] = b.group(1) + str(m) + b.group(3)
src[i + 2], src[i + 3] = new
open('ccd/ccd', 'w', encoding='utf8').write('\n'.join(src))
print(f'census {n0}/{m0} -> {n}/{m} at ccd/ccd:{i}-{i + 1}; LAST MOVE at ccd/ccd:{i + 3}-{i + 4}, before it {move.group(1)}')
```

- [ ] **Step 5: Run it with this task's delta, re-stamp, pay the tax**

<!-- replay: bash -->
```bash
SCRATCH=<your scratchpad, absolute>
[[ "$SCRATCH" == /* && -d "$SCRATCH" ]] || echo "STOP: SCRATCH is not an absolute directory"
git fetch origin main
python3 "$SCRATCH/reg-get-census.py" 1
~/.local/bin/ccrc restamp ccd/ccd && bash -n ccd/ccd && echo syntax-ok
```

Expected: `census 179/150 -> 180/151 at ccd/ccd:3137-3138; LAST MOVE at ccd/ccd:3140-3141, before it the rescue wait's
reads (session-continuity wave 2)`, then `syntax-ok`. A `STOP` means nothing was written: a count other than +1 means a
read other than `_typed_note`'s moved it (find it first); a LAST MOVE not shaped `<move>, the +N [(…)]; before it
<chain>` on `origin/main` means another editor reached the block (report it — never guess its chain). Then the S6-R11
procedure (expected unchanged).

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-operator-choice.test.ts test/ccd-reg-get-census.test.ts test/ownership.test.ts --maxWorkers=2
./node_modules/.bin/vitest run test/ccd-route-settle.test.ts test/ccd-route-apply.test.ts test/ccd-auto-swap-pool.test.ts test/single-definition.test.ts --maxWorkers=2
```

Expected: `26 passed (26)` (9 + 3 + 14); then `372 passed (372)` (`ccd-auto-swap-pool`'s inventory window still finds
`` `strandnotify` `` — the window ends at the list's own last field).

- [ ] **Step 7: Mutation check, then commit**

| # | File | Exact edit (old → new) | Suite | Measured red on the full prototype |
|---|---|---|---|---|
| 2.1 | `ccd/ccd` | `_typed_note "$id" effort "$level"   # the settle's keystroke, never the operator's choice (session-continuity §5.7)` → (nothing) | ccd-operator-choice.test.ts | 2 failed \| 35 passed (37): “the settle journals its /effort before it types it”; “the settle /effort on a session with no effort field is not promoted” |
| 2.2 | `ccd/ccd` | `_typed_note "$id" model "$cls"   # ccd's own keystroke, never the operator's choice (session-continuity §5.7)` → (nothing) | ccd-operator-choice.test.ts | 3 failed \| 34 passed (37): “route --apply journals the class it types and the effort, and nothing for auto”; “the newest command NO JOURNAL ROW EXPLAINS wins: a later route --apply does not hide the operator's own”; “a route --apply /model is not promoted — not even a degraded class typed over the operator's fable, in either acknowledgement shape” |
| 2.3 | `ccd/ccd` | `_typed_note "$id" effort "$eff"   # ccd's own keystroke, never the operator's choice (session-continuity §5.7)` → (nothing) | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “route --apply journals the class it types and the effort, and nothing for auto” |
| 2.4 | `ccd/ccd` | `<<<"$rows" \| tail -n "$((TYPED_KEEP_ROWS - 1))")` → `<<<"$rows")` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “keeps the last TYPED_KEEP_ROWS keystroke rows below its floor, and refuses a value that is not one token” |
| 2.5 | `ccd/ccd` | `[[ "$kind" == since \|\| ( "$kind" =~ ^(model\|effort)$ && "$v" =~ ^[A-Za-z0-9._-]{1,64}$ ) ]] \|\| return 0` → `[[ "$kind" == since \|\| "$kind" =~ ^(model\|effort)$ ]] \|\| return 0` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “keeps the last TYPED_KEEP_ROWS keystroke rows below its floor, and refuses a value that is not one token” |
| 2.6 | `ccd/ccd` | `_route_word_in "${v,,}" "$ROUTE_CLASSES" && { printf '%s\n' "${v,,}"; return 0; }` → (nothing) | ccd-operator-choice.test.ts | 11 failed \| 26 passed (37): “the aliases — ROUTE_CLASSES, each also with [1m] — and an acknowledgement's display word”; “/model opus, acknowledged: the class is written through cmd_route, actor=operator-session”; “the picker takes no argument: its acknowledgement names the value, in either shape Claude Code writes it”; … and 8 more |
| 2.7 | `ccd/ccd` | `local v="${1%\[1m\]}"` → `local v="$1"` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “the aliases — ROUTE_CLASSES, each also with [1m] — and an acknowledgement's display word” |
| 2.8 | `ccd/ccd` | `MODEL_FAMILY_TOKENS="-fable-:fable -opus-:opus -sonnet-:sonnet -haiku-:haiku"` → `MODEL_FAMILY_TOKENS="-opus-:opus -fable-:fable -sonnet-:sonnet -haiku-:haiku"` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “_model_family_class agrees with familyClassOf on every id, and MODEL_FAMILY_TOKENS is FAMILY_TOKENS” |
| 2.9 | `ccd/ccd` | `[[ "$1" == *"${t%%:*}"* ]] && { printf '%s\n' "${t##*:}"; return 0; }` → `[[ "$1" == *"${t##*:}"* ]] && { printf '%s\n' "${t##*:}"; return 0; }` | ccd-operator-choice.test.ts | 2 failed \| 35 passed (37): “a full model id through the port, and everything else outside the vocabulary”; “_model_family_class agrees with familyClassOf on every id, and MODEL_FAMILY_TOKENS is FAMILY_TOKENS” |
| 2.10 | `ccd/ccd` | `_typed_note "$id" since   # the operator-choice journal opens at this ccd's first spawn of the row: no older command is read as the operator's (session-continuity §5.7)` → (nothing) | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “the spawn opens the journal at a floor, and a later spawn or keystroke keeps that floor” |
| 2.11 | `ccd/ccd` | `if [[ "$floor" =~ ^[0-9]{1,12}\ since$ ]]; then` → `if false; then` | ccd-operator-choice.test.ts | 4 failed \| 33 passed (37): “the spawn opens the journal at a floor, and a later spawn or keystroke keeps that floor”; “keeps the last TYPED_KEEP_ROWS keystroke rows below its floor, and refuses a value that is not one token”; “the newest command NO JOURNAL ROW EXPLAINS wins: a later route --apply does not hide the operator's own”; … and 1 more |

Every row is measured on the full prototype (37 cases), so rows 2.1, 2.2 and 2.11 also red Task 3's cases — among
them the spec's first two mutation rows ("the settle /effort on a session with no effort field is not promoted", "a
route --apply /model is not promoted…"). At this task's commit they red the journal cases only. Row 2.10 is the
floor's spawn line, row 2.11 the floor that never moves; `_typed_note since`'s early return on an open journal has
no row — it saves a rewrite and changes no answer.

```bash
git add ccd/ccd server/test/ccd-operator-choice.test.ts
git commit -F - <<'EOF'
feat(continuity): ccd journals its own /model and /effort, and maps a /model value to the route record's class (stage 7, part 1)

`_inject_spawn_effort` and `_route_apply_now` append each keystroke they type to `$REG/<id>.typed`
(`<epoch> <kind> <value>`, the last 16 rows below a floor row the first spawn opens, purged with the row). `_model_class_of` maps an alias
(ROUTE_CLASSES, with `[1m]`) or, through `_model_family_class`, a full model id — the bash port of
`familyClassOf`'s dash-token rule, pinned to it by an agreement test. `_reg_get` census +1.
EOF
```

---

### Task 3: The promotion, its call sites, and the spec's four mutation rows (spec §5.7, second half)

**Model routing:** `opus`, effort `high` — it writes into the record every spawn reads, from a path no stop may fail on.

**Files:**
- Modify: `ccd/ccd` — `_operator_choice_keep` and `_operator_choice_say`, directly above `_route_apply_now() {`; one line in `cmd_swap` before its
  `_svc_stop` (≈24167); one line in `cmd_stop` before its `_ws_unsupervise` (≈24514); one line for one line in
  `cmd_ws_archive` (≈9859); the `_reg_get` census (in place)
- Test: `server/test/ccd-operator-choice.test.ts` (extend), `server/test/ccd-die-containment.test.ts` (one name in its
  pinned list — Pre-flight 13)

**Interfaces:**
- Consumes: Task 2's `_typed_note` journal, `TYPED_MATCH_WINDOW`, `_model_class_of`; `_transcript_path`,
  `_route_peek`, `_plat_mtime`, `cmd_route` (unchanged).
- Produces: `_operator_choice_keep <id>` — always rc 0. With no journal floor it opens one, logs `operator-choice
  <id>: unmeasured (its journal opened only now, …)` (when a transcript exists) and promotes nothing; a transcript
  that is not a readable regular file, no python3, or a failed reader each log `unmeasured (<why>)`. Otherwise, per
  kind, the newest ACKNOWLEDGED command at or after the floor that no `.typed` row of the same kind and value explains
  within `TYPED_MATCH_WINDOW`: a value outside the vocabulary logs `operator-choice <id>: /<kind> <value> is outside
  the <field> vocabulary — the record is unchanged` (`(<n> bytes, not one token)` in the value's place when it is not
  one token); a value the record holds, or a field written after the command (or whose time cannot be read), writes
  nothing; otherwise `( cmd_route --session <id> --set <field>=<value> --actor operator-session --reason "its own
  /<kind>, kept across a restart" )`, and on its refusal `operator-choice <id>: /<kind> <value> refused by the route
  record's own checks — the record is unchanged`. `_operator_choice_say <id> <text>` appends the one
  `operator-choice <id>: <text>` line.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccd-operator-choice.test.ts` — the promotion (including the spec's four mutation rows,
verbatim as case names or their prefixes), the journal's floor, and the three call sites with the census of every
stop:

<!-- replay: append server/test/ccd-operator-choice.test.ts -->
```ts

// ── THE PROMOTION ─────────────────────────────────────────────────────────────

describe('_operator_choice_keep writes the operator\'s own /model and /effort to the record', () => {
  it('/model opus, acknowledged: the class is written through cmd_route, actor=operator-session', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([turn(t - 10), cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5')), turn(t + 5)]);
    expect(keep()).toBe('rc=0');
    expect(h.reg(ID, 'class')).toBe('opus');
    expect(routeLines(), swapLog()).toHaveLength(1);
    expect(routeLines()[0]).toMatch(new RegExp(`route ${ID}: class fable -> opus \\[actor=operator-session\\]`));
  });

  it('the picker takes no argument: its acknowledgement names the value, in either shape Claude Code writes it', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model'), ack(t, MODEL_ACK('Opus 5.5 (1M context)'))]);
    keep();
    expect(h.reg(ID, 'class'), 'backticks (2.1.250 and later)').toBe('opus');
    record({ class: 'fable' });
    writeTranscript([cmd(t, 'model'), ack(t, MODEL_ACK_ANSI('Sonnet 5'))]);
    keep();
    expect(h.reg(ID, 'class'), 'ANSI bold (2.1.226)').toBe('sonnet');
  });

  it('a picker row Claude Code marks (default) is the default class, not the model it resolves to', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model'), ack(t, MODEL_ACK('Sonnet 5 (default)'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('default');
  });

  it('/effort high, and both kinds in one transcript', () => {
    seed(); record({ class: 'fable', effort: 'ultracode' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'sonnet'), ack(t, MODEL_ACK('Sonnet 5')), cmd(t + 30, 'effort'), ack(t + 30, EFFORT_ACK('high'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('sonnet');
    expect(h.reg(ID, 'effort')).toBe('high');
  });

  it('/effort ultracode as 2.1.284 and later acknowledge it ("Ultracode on …") is read', () => {
    seed(); record({ effort: 'high' }); const t = now() - 600;
    writeTranscript([cmd(t, 'effort', 'ultracode'), ack(t, 'Ultracode on (this session only): dynamic workflows on every task. Effort stays medium.')]);
    keep();
    expect(h.reg(ID, 'effort')).toBe('ultracode');
  });

  it('the newest of two acknowledged commands wins', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'sonnet'), ack(t, MODEL_ACK('Sonnet 5')), cmd(t + 60, 'model', 'opus'), ack(t + 60, MODEL_ACK('Opus 5.5'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('opus');
  });

  it('the newest command NO JOURNAL ROW EXPLAINS wins: a later route --apply does not hide the operator\'s own', () => {
    seed(); record({ class: 'fable', degraded: 'opus' }); const t = now() - 600;
    h.sh(`_route_type_model() { return 0; }; _route_apply_now ${ID}`);   // journals `model opus` now: the degraded class
    writeTranscript([cmd(t, 'model', 'sonnet'), ack(t, MODEL_ACK('Sonnet 5')), cmd(now() + 5, 'model'), ack(now() + 5, MODEL_ACK('Opus 5.5'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('sonnet');
  });

  it('an acknowledged command wins over a later one Claude Code refused, which changed nothing', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'sonnet'), ack(t, MODEL_ACK('Sonnet 5')),
      cmd(t + 60, 'model', 'opus'), ack(t + 60, "Model 'opus' is not available on this plan")]);
    keep();
    expect(h.reg(ID, 'class')).toBe('sonnet');
  });

  it('the record wins when it is newer: a field written after the command is not overwritten', () => {
    seed(); record({ class: 'fable' }, ID, 60); const t = now() - 3600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(routeLines()).toEqual([]);
  });

  it('a field whose time cannot be read is not overwritten', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
    h.sh(`_plat_mtime() { return 1; }; _operator_choice_keep ${ID}`);
    expect(h.reg(ID, 'class')).toBe('fable');
  });

  it('an argument that is not one token is logged with its real size as outside the vocabulary, never split into fields', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus 1712345678'), ack(t, MODEL_ACK('Opus 5.5'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog()).toMatch(new RegExp(`operator-choice ${ID}: /model \\(15 bytes, not one token\\) is outside the class vocabulary`));
  });

  it('a value the record already holds is not written again', () => {
    seed(); record({ class: 'opus' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
    keep();
    expect(routeLines()).toEqual([]);
  });

  it('a human QUOTING the envelope is not a command, even above an acknowledgement', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    const quoting = JSON.stringify({ parentUuid: 'p', isSidechain: false, type: 'user', uuid: 'q', timestamp: iso(t),
      message: { role: 'user', content: '<command-name>/model</command-name>\n<command-args>opus</command-args>\nthat is what I typed yesterday' } });
    writeTranscript([quoting, ack(t, MODEL_ACK('Opus 5.5'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('fable');
  });

  it('a subagent\'s row is not the operator\'s', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus', { isSidechain: true }), ack(t, MODEL_ACK('Opus 5.5'), { isSidechain: true })]);
    keep();
    expect(h.reg(ID, 'class')).toBe('fable');
  });

  it('nothing to read is silent: no transcript, or no registry row — rc 0, nothing written, nothing logged', () => {
    seed(); record({ class: 'fable' });
    expect(keep()).toBe('rc=0');
    expect(keep('nobody-here')).toBe('rc=0');
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog()).toBe('');
  });

  it('could not measure is said, never silent: a directory for a transcript, no python3, a reader that failed — rc 0, the record unchanged', () => {
    seed(); record({ class: 'fable' });
    const p = writeTranscript([cmd(now() - 600, 'model', 'opus'), ack(now() - 600, MODEL_ACK('Opus 5.5'))]);
    expect(h.sh(`command() { [[ "$*" == "-v python3" ]] && return 1; builtin command "$@"; }; _operator_choice_keep ${ID}; echo "rc=$?"`)).toBe('rc=0');
    expect(h.sh(`python3() { return 1; }; _operator_choice_keep ${ID}; echo "rc=$?"`)).toBe('rc=0');
    fs.rmSync(p); fs.mkdirSync(p);
    expect(keep()).toBe('rc=0');
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog().split('\n').filter(Boolean).map((l) => l.replace(/^\S+ \S+ /, ''))).toEqual([
      `operator-choice ${ID}: unmeasured (no python3)`,
      `operator-choice ${ID}: unmeasured (the transcript reader failed)`,
      `operator-choice ${ID}: unmeasured (its transcript is not a readable regular file)`,
    ]);
  });

  it('a FIFO where the transcript should be is never opened: the stop is not held, and it is said', () => {
    seed(); record({ class: 'fable' });
    const p = h.sh(`_transcript_path ${ID}`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    h.sh(`mkfifo ${JSON.stringify(p)}`);
    const out = h.sh(`_operator_choice_keep ${ID} & pid=$!
      for _ in $(seq 1 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
      if kill -0 "$pid" 2>/dev/null; then kill "$pid"; : > ${JSON.stringify(p)}; echo held; else wait "$pid"; echo "rc=$?"; fi`);
    expect(out, 'a grep on a FIFO blocks the stop until somebody writes to it').toBe('rc=0');
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog()).toMatch(new RegExp(`operator-choice ${ID}: unmeasured \\(its transcript is not a readable regular file\\)`));
  });

  // ── the journal's floor: what an older ccd typed is never the operator's ──

  it('a session with no journal yet (spawned by an older ccd) promotes nothing at its first stop, opens the journal, and says so', () => {
    seed(ID, false); const t = now() - 7200;
    writeTranscript([cmd(t, 'effort', 'ultracode'), ack(t, ULTRACODE_ACK)]);   // an older ccd's settle, never journalled
    keep();
    expect(h.reg(ID, 'effort'), 'the box default became an operator choice at the deploy').toBeNull();
    expect(floorRow()).toMatch(/^\d{10} since$/);
    expect(swapLog()).toMatch(new RegExp(`operator-choice ${ID}: unmeasured \\(its journal opened only now`));
    keep();
    expect(h.reg(ID, 'effort'), 'and at its second: the command is older than the floor').toBeNull();
  });

  it('a command older than the journal\'s floor is not read', () => {
    seed(ID, false); journal(ID, 1800); record({ class: 'fable' }); const t = now() - 3600;
    writeTranscript([cmd(t, 'model'), ack(t, MODEL_ACK_ANSI('Opus 5.5'))]);   // an older ccd's route --apply
    keep();
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog()).toBe('');
  });

  // ── the spec's four mutation rows ──

  it('the settle /effort on a session with no effort field is not promoted', () => {
    seed();
    h.sh(`sleep() { :; }; tmux() { ${WIDE_PANE} case "\${1:-}" in capture-pane) printf '? for shortcuts\\n❯ \\n' ;; esac; return 0; };
      _pane_box_draft() { printf ''; }; _inject_spawn_effort cc-${ID}`);
    const t = now() + 2;
    writeTranscript([cmd(t, 'effort', 'ultracode'), ack(t, ULTRACODE_ACK)]);
    keep();
    expect(h.reg(ID, 'effort'), 'the box default became an operator choice').toBeNull();
  });

  it('control: the same /effort an hour from any journalled keystroke is the operator\'s', () => {
    seed();
    h.sh(`_typed_note ${ID} effort ultracode; _reg_set ${ID} typed "$(sed "2s/^[0-9]*/$(( $(date +%s) - 3600 ))/" "$REG/${ID}.typed")"`);
    const t = now() - 10;
    writeTranscript([cmd(t, 'effort', 'ultracode'), ack(t, ULTRACODE_ACK)]);
    keep();
    expect(h.reg(ID, 'effort')).toBe('ultracode');
  });

  it('a route --apply /model is not promoted — not even a degraded class typed over the operator\'s fable, in either acknowledgement shape', () => {
    seed(); record({ class: 'fable', degraded: 'opus' });
    h.sh(`_route_type_model() { return 0; }; _route_apply_now ${ID}`);
    const t = now() + 5;
    writeTranscript([cmd(t, 'model'), ack(t, MODEL_ACK('Opus 5.5'))]);
    keep();
    writeTranscript([cmd(t, 'model'), ack(t, MODEL_ACK_ANSI('Opus 5.5'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(routeLines()).toEqual([]);
    expect(swapLog(), 'nor logged as a revert').toBe('');
  });

  it('an unmappable value does not abort a swap: logged, the record unchanged, and the swap lands', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'gpt-5.6-sol'), ack(t, MODEL_ACK('gpt-5.6-sol'))]);
    h.sh(`${SWAP} cmd_swap ${ID} claude-d`, { TMUX: '' });
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog()).toMatch(new RegExp(`operator-choice ${ID}: /model gpt-5\\.6-sol is outside the class vocabulary — the record is unchanged`));
  });

  it('…nor does a value the record\'s own checks refuse (haiku takes no effort level)', () => {
    seed(); record({ class: 'haiku' }); const t = now() - 600;
    writeTranscript([cmd(t, 'effort', 'high'), ack(t, EFFORT_ACK('high'))]);
    h.sh(`${SWAP} cmd_swap ${ID} claude-d`, { TMUX: '' });
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
    expect(h.reg(ID, 'effort')).toBeNull();
    expect(swapLog()).toMatch(new RegExp(`operator-choice ${ID}: /effort high refused by the route record's own checks`));
  });

  it('an operator /model opus survives an auto-home: the home-ward swap writes it before its stop, and the next spawn composes opus', () => {
    seed(); h.sh(`_reg_set ${ID} wrapper claude-d`); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5')), turn(t + 5)]);
    h.sh(`${SWAP} CCD_SWAP_AUTO=1 cmd_swap ${ID} claude`, { TMUX: '' });
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    expect(h.sh(`_route_wanted ${ID}`).split(' ')[0], 'the class the spawn and the applier compose').toBe('opus');
    const log = swapLog().split('\n');
    const route = log.findIndex((l) => l.includes(` route ${ID}: class fable -> opus [actor=operator-session]`));
    const landed = log.findIndex((l) => l.includes(` swap ${ID}: claude-d -> claude `));
    expect(route).toBeGreaterThan(-1);
    expect(landed).toBeGreaterThan(route);
  });
});

// ── EVERY STOP THAT A SPAWN FOLLOWS ───────────────────────────────────────────

describe('every stop that a spawn follows keeps the operator\'s choice first', () => {
  it('ccd stop: `ccd start`/`enable` respawn from the record', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
    h.sh(`_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; }; tmux() { :; }; cmd_stop ${ID}`);
    expect(h.calls()).toContain(`unsupervise ${ID}`);
    expect(h.reg(ID, 'class')).toBe('opus');
  });

  it('ccd ws-archive: ws-restore respawns from the record', () => {
    h.makeRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const WS = 'demo-quiet-basin';
    journal(WS); record({ class: 'fable' }, WS); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))], WS);
    const ARCH = `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; }; tmux() { return 1; }; _session_verdict() { echo gone; };`;
    expect(h.sh(`${ARCH} cmd_ws_archive --session ${WS}`)).toMatch(/^archived /);
    expect(h.reg(WS, 'class')).toBe('opus');
  });

  // THE CENSUS OF STOPS. Every function in ccd that stops a session — a
  // `tmux kill-session`, a `claude-session@` unit stopped or booted out, or a
  // `_ws_unsupervise` — is named here: either a stop a spawn follows, which
  // must call `_operator_choice_keep` as the statement before its stop, or a
  // stop after which no spawn follows, with the reason. A NEW function that
  // stops a session is in neither list, and this reds until it is classified.
  it('every stop in ccd is classified: three keep the operator\'s choice first, the rest end the row', () => {
    const KEEPS = ['cmd_stop', 'cmd_swap', 'cmd_ws_archive'];
    const ENDS: Record<string, string> = {
      cmd_ws_rm: 'the workspace and its row are removed',
      cmd_forget: 'the row is forgotten',
      _ws_reap_tail: 'the reap ends the row',
      _ws_reclaim_tail: 'the reclaim ends the child row',
      cmd_account_pane: 'an account\'s login pane, not a session',
      cmd_supervise: 'a crash loop\'s give-up: Claude Code already exited, and no ccd stop precedes a revival',
    };
    const src = fs.readFileSync(CCD, 'utf8').split('\n');
    const owner = (i: number): string => {
      for (let j = i; j >= 0; j--) { const m = /^([A-Za-z_][A-Za-z0-9_]*)\(\) \{/.exec(src[j]!); if (m) return m[1]!; }
      return '';
    };
    const STOP = /tmux kill-session|_svc_stop "claude-session@|bootout .*claude-session@|_ws_unsupervise "/;
    const live = (l: string): boolean => !/^\s*#/.test(l);
    const stoppers = new Set(src.flatMap((l, i) => (live(l) && STOP.test(l) ? [owner(i)] : [])));
    expect([...stoppers].sort(), 'a function that stops a session is in neither list').toEqual([...KEEPS, ...Object.keys(ENDS)].sort());
    const sites = src.flatMap((l, i) => (live(l) && l.includes('_operator_choice_keep "$id"') ? [i] : []));
    expect(sites.map(owner).sort()).toEqual(KEEPS);
    for (const i of sites) {
      const fn = owner(i);
      if (fn === 'cmd_swap') expect(src[i + 1]).toMatch(/^ {2}_svc_stop "claude-session@\$id"/);
      if (fn === 'cmd_stop') expect(src[i + 1]).toMatch(/^ {2}_ws_unsupervise "\$id" "\$surface" "\$declared"$/);
      if (fn === 'cmd_ws_archive') expect(src[i]).toMatch(/^ {2}_operator_choice_keep "\$id"; _ws_unsupervise "\$id" /);
    }
  });
});
```


- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-operator-choice.test.ts --maxWorkers=2
```

Expected: `21 failed | 16 passed (37)` — Task 2's nine pass, and so do seven cases that assert nothing is written
(the record wins when newer; a value already held; a human quoting the envelope; a subagent's row; a command older
than the journal's floor; the settle's `/effort`; `route --apply`'s `/model`), which no code can fail yet: their
guards are measured by rows 3.6, 3.7, 3.9, 3.10, 3.19, 2.1 and 2.2.

- [ ] **Step 3: The promotion and its three call sites**

In `ccd/ccd` (in `cmd_ws_archive`), find:

<!-- replay: replace ccd/ccd -->
```bash
  _ws_unsupervise "$id"                                   # clears Restart=always
```

and replace it with:

```bash
  _operator_choice_keep "$id"; _ws_unsupervise "$id"      # clears Restart=always; ws-restore respawns from the record (§5.7)
```

In `ccd/ccd` (in `_route_apply_now`), find this anchor:

<!-- replay: insert-above ccd/ccd -->
```bash
_route_apply_now() {   # id -> 0 everything wanted is applied | 1 something is still pending
```

and insert, directly above it:

```bash
_operator_choice_keep() {   # id — before a stop that a spawn follows: the operator's own /model and /effort, written to the route record (§5.7). Always 0.
  local id="$1" f typed why="" out kind val at n field want fm shown
  [[ -f "$REG/$id.uuid" ]] || return 0
  typed=$(_reg_get "$id" typed)
  if ! [[ "${typed%%$'\n'*}" =~ ^[0-9]{1,12}\ since$ ]]; then
    _typed_note "$id" since
    why="its journal opened only now, so an older command may be an older ccd's own keystroke"
  fi
  f=$(_transcript_path "$id") || return 0
  [[ -e "$f" ]] || return 0
  [[ -z "$why" ]] || { _operator_choice_say "$id" "unmeasured ($why)"; return 0; }
  [[ -f "$f" && -r "$f" ]] || { _operator_choice_say "$id" "unmeasured (its transcript is not a readable regular file)"; return 0; }
  command -v python3 >/dev/null 2>&1 || { _operator_choice_say "$id" "unmeasured (no python3)"; return 0; }
  out=$({ grep -F -A1 -e '<command-name>/model</command-name>' -e '<command-name>/effort</command-name>' -- "$f" 2>/dev/null || (( $? == 1 )); } | python3 -c '
import json, re, sys
from datetime import datetime
window = int(sys.argv[2])
journal = sys.argv[1].splitlines()
floor = int(journal[0].split()[0])
rows = []
for l in journal[1:]:
    p = l.split()
    if len(p) == 3 and p[0].isdigit() and p[1] in ("model", "effort"):
        rows.append((int(p[0]), p[1], p[2].lower()))
ENV = re.compile(r"<command-(name|message|args)>([^<]*)</command-\1>")
ACK = {"model": re.compile(r"Set model to (.+?)(?: and saved| for this session|$)"),
       "effort": re.compile(r"Set effort level to ([A-Za-z]+)|(Ultracode) on\b")}
CLEAN = re.compile(r"\x1b\[[0-9;]*m|`")
SAFE = re.compile(r"[A-Za-z0-9._\[\]-]{1,64}")
def user(line):
    try:
        row = json.loads(line)
    except ValueError:
        return None, None
    if not isinstance(row, dict) or row.get("type") != "user" or row.get("isSidechain") is True:
        return None, None
    msg = row.get("message")
    text = msg.get("content") if isinstance(msg, dict) else None
    return (text, row) if isinstance(text, str) else (None, None)
lines = sys.stdin.read().split("\n")
newest = {}
for i, line in enumerate(lines):
    text, row = user(line)
    if text is None or ENV.sub("", text).strip():
        continue
    tags = dict(ENV.findall(text))
    kind = {"/model": "model", "/effort": "effort"}.get(tags.get("name", "").strip())
    if kind is None:
        continue
    try:
        at = int(datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00")).timestamp())
    except (KeyError, AttributeError, TypeError, ValueError):
        continue
    nxt = user(lines[i + 1])[0] if i + 1 < len(lines) else None
    m = re.fullmatch(r"\s*<local-command-stdout>(.*)</local-command-stdout>\s*", nxt or "", re.S)
    ack = ACK[kind].match(CLEAN.sub("", m.group(1)).strip() if m else "")
    if not ack or at < floor:
        continue
    named = (ack.group(1) or ack.group(2) or "").strip()
    if kind == "model" and named.endswith("(default)"):
        named = "default"
    val = tags.get("args", "").strip() or (named.split() or ["?"])[0]
    if any(k == kind and v == val.lower() and abs(t - at) <= window for t, k, v in rows):
        continue
    newest[kind] = (val, at)
for kind, (val, at) in sorted(newest.items()):
    print(kind, val if SAFE.fullmatch(val) else "?", at, len(val.encode()))
' "$typed" "$TYPED_MATCH_WINDOW" 2>/dev/null) || { _operator_choice_say "$id" "unmeasured (the transcript reader failed)"; return 0; }
  while read -r kind val at n; do
    [[ "$at" =~ ^[0-9]+$ ]] || continue
    case "$kind" in
      model)  field=class;  want=$(_model_class_of "$val") || want="" ;;
      effort) field=effort; want="${val,,}"; _route_word_in "$want" "$ROUTE_EFFORTS" || want="" ;;
      *)      continue ;;
    esac
    if [[ -z "$want" ]]; then
      shown="$val"; [[ "$val" == "?" ]] && shown="(${n//[^0-9]/} bytes, not one token)"
      _operator_choice_say "$id" "/$kind $shown is outside the $field vocabulary — the record is unchanged"
      continue
    fi
    [[ "$(_route_peek "$id" "$field")" == "$want" ]] && continue
    if [[ -e "$REG/$id.$field" ]]; then
      fm=$(_plat_mtime "$REG/$id.$field" 2>/dev/null) && [[ "$fm" =~ ^[0-9]+$ ]] || continue
      (( 10#$fm >= 10#$at )) && continue
    fi
    ( cmd_route --session "$id" --set "$field=$want" --actor operator-session --reason "its own /$kind, kept across a restart" ) >/dev/null 2>&1 \
      || _operator_choice_say "$id" "/$kind $want refused by the route record's own checks — the record is unchanged"
  done <<<"$out"
  return 0
}

_operator_choice_say() {   # id text — one `operator-choice <id>: <text>` line in swap.log, where the operator's choice may be lost (§5.7)
  echo "$(date '+%F %T') operator-choice $1: $2" >> "$REG/swap.log"
}

```

In `ccd/ccd` (in `cmd_swap`), find this anchor:

<!-- replay: insert-above ccd/ccd -->
```bash
  _svc_stop "claude-session@$id" 2>/dev/null   # first, or Restart=always resurrects under the old wrapper
```

and insert, directly above it:

```bash
  _operator_choice_keep "$id"   # a stop the spawn below follows: the operator's own /model and /effort reach the record first (§5.7)
```

In `ccd/ccd` (in `cmd_stop`), find this anchor:

<!-- replay: insert-above ccd/ccd -->
```bash
  _ws_unsupervise "$id" "$surface" "$declared"
```

and insert, directly above it:

```bash
  _operator_choice_keep "$id"   # `ccd start`/`enable` respawn from the record: the operator's own /model and /effort reach it first (§5.7)
```


`ccd-die-containment.test.ts` derives which functions can reach `die` over `$( )` substitutions only, so it reads
`( cmd_route … )`'s refusal as reachable and lists `_operator_choice_keep` as fatal (Pre-flight 13). Name it, with the
reason, so the pinned list stays exact:

In `server/test/ccd-die-containment.test.ts`, find:

<!-- replay: replace server/test/ccd-die-containment.test.ts -->
```ts
    expect([...fatal].filter((f) => f.startsWith('_')).sort())
      .toEqual(['_account_still_rostered', '_lc_refuse', '_route_argv_check',
```

and replace it with:

```ts
    // `_operator_choice_keep` (session-continuity stage 7) is here although it
    // CANNOT die: it calls `cmd_route` inside a plain `( … )` subshell, so that
    // verb's refusal ends only the subshell, and this scanner models `$( )` but
    // not `( )`. Its own suite pins the real property — a refusal inside a swap
    // never ends the swap (`ccd-operator-choice.test.ts`, "…nor does a value the
    // record's own checks refuse") — and it is never captured in `$( )`, which
    // the demotion scan below still checks.
    expect([...fatal].filter((f) => f.startsWith('_')).sort())
      .toEqual(['_account_still_rostered', '_lc_refuse', '_operator_choice_keep', '_route_argv_check',
```


- [ ] **Step 4: Census, re-stamp, tax**

<!-- replay: bash -->
```bash
SCRATCH=<your scratchpad, absolute>
git fetch origin main
python3 "$SCRATCH/reg-get-census.py" 2
~/.local/bin/ccrc restamp ccd/ccd && bash -n ccd/ccd && echo syntax-ok
```

Expected: `census 179/150 -> 181/152 …`, `syntax-ok`; then the S6-R11 procedure (expected unchanged:
`cmd_ws_archive`'s call is one line for one line, and everything else sits below `:19109`).

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-operator-choice.test.ts test/ccd-reg-get-census.test.ts test/ownership.test.ts test/ccd-die-containment.test.ts --maxWorkers=2
./node_modules/.bin/vitest run test/ccd-swap.test.ts test/ccd-swap-pin.test.ts test/ccd-archive.test.ts test/ccd-swap-refuse.test.ts --maxWorkers=2
./node_modules/.bin/vitest run test/ccd-swap-carry.test.ts test/ccd-lifecycle-sites.test.ts test/ccd-lifecycle-emit.test.ts test/ccd-session-lifecycle.test.ts --maxWorkers=2
./node_modules/.bin/vitest run test/ccd-crosspool.test.ts test/ccd-swap-carry-merge.test.ts test/ccd-workspaces.test.ts --maxWorkers=2
```

Expected: `66 passed (66)` (37 + 3 + 14 + 12); then `124 passed | 1 skipped (125)` (the second line, which holds
`ccd-swap-refuse`); then `132 passed | 3 skipped (135)` (the third); then `247 passed (247)` (168 + 79, the fourth) —
each measured on the revised prototype. Without Step 3's list edit, `ccd-die-containment`
reds `1 failed | 11 passed (12)` here.

- [ ] **Step 6: Mutation check, then commit**

The spec's four rows are 2.1 (the settle `/effort`), 2.2 (`route --apply`'s `/model`), 3.1 (an unmappable value) and
3.3 (an operator `/model opus` across an auto-home). Rows 3.14–3.26 pin what the review found unpinned or new: the
newest of two (3.14), the newest NO journal row explains (3.15 — the first draft's order, measured red), the FIFO and
the three `unmeasured` lines (3.16–3.18), the floor (3.19, 3.20), the acknowledgement shapes (3.21–3.23), the logged
value and its real size (3.24, 3.25), and the census of stops (3.26 adds a `_bounce_session` that stops and starts a
unit, and reds). Row 3.8 now drops only the acknowledgement half of `if not ack or at < floor:` — a `None` match then
raises in the reader, which logs `unmeasured` and promotes nothing, so the refused-later case reds.

| # | File | Exact edit (old → new) | Suite | Measured red on the full prototype |
|---|---|---|---|---|
| 3.1 | `ccd/ccd` | `is outside the $field vocabulary — the record is unchanged" / continue` → `is outside the $field vocabulary — the record is unchanged" / die "operator-choice: outside the vocabulary"` | ccd-operator-choice.test.ts | 2 failed \| 35 passed (37): “an argument that is not one token is logged with its real size as outside the vocabulary, never split into fields”; “an unmappable value does not abort a swap: logged, the record unchanged, and the swap lands” |
| 3.2 | `ccd/ccd` | `( cmd_route --session "$id" --set "$field=$want" --actor operator-session --reason "its own /$kind, kept across a restart" ) >/dev/null 2>&1` → `{ cmd_route --session "$id" --set "$field=$want" --actor operator-session --reason "its own /$kind, kept across a restart"; } >/dev/null 2>&1` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “…nor does a value the record's own checks refuse (haiku takes no effort level)” |
| 3.3 | `ccd/ccd` | `_operator_choice_keep "$id"   # a stop the spawn below follows: the operator's own /model and /effort reach the record first (§5.7)` → (nothing) | ccd-operator-choice.test.ts | 4 failed \| 33 passed (37): “an unmappable value does not abort a swap: logged, the record unchanged, and the swap lands”; “…nor does a value the record's own checks refuse (haiku takes no effort level)”; “an operator /model opus survives an auto-home: the home-ward swap writes it before its stop, and the next spawn composes opus”; … and 1 more |
| 3.4 | `ccd/ccd` | `_operator_choice_keep "$id"   # `ccd start`/`enable` respawn from the record: the operator's own /model and /effort reach it first (§5.7)` → (nothing) | ccd-operator-choice.test.ts | 2 failed \| 35 passed (37): “ccd stop: `ccd start`/`enable` respawn from the record”; “every stop in ccd is classified: three keep the operator's choice first, the rest end the row” |
| 3.5 | `ccd/ccd` | `_operator_choice_keep "$id"; _ws_unsupervise "$id"      #` → `_ws_unsupervise "$id"      #` | ccd-operator-choice.test.ts | 2 failed \| 35 passed (37): “ccd ws-archive: ws-restore respawns from the record”; “every stop in ccd is classified: three keep the operator's choice first, the rest end the row” |
| 3.6 | `ccd/ccd` | `(( 10#$fm >= 10#$at )) && continue` → (nothing) | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “the record wins when it is newer: a field written after the command is not overwritten” |
| 3.7 | `ccd/ccd` | `[[ "$(_route_peek "$id" "$field")" == "$want" ]] && continue` → (nothing) | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “a value the record already holds is not written again” |
| 3.8 | `ccd/ccd` | `if not ack or at < floor:` → `if at < floor:` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “an acknowledged command wins over a later one Claude Code refused, which changed nothing” |
| 3.9 | `ccd/ccd` | `if text is None or ENV.sub("", text).strip():` → `if text is None:` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “a human QUOTING the envelope is not a command, even above an acknowledgement” |
| 3.10 | `ccd/ccd` | `or row.get("isSidechain") is True:` → `:` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “a subagent's row is not the operator's” |
| 3.11 | `ccd/ccd` | `and abs(t - at) <= window for t, k, v in rows` → `for t, k, v in rows` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “control: the same /effort an hour from any journalled keystroke is the operator's” |
| 3.12 | `ccd/ccd` | `print(kind, val if SAFE.fullmatch(val) else "?", at, len(val.encode()))` → `print(kind, val, at, len(val.encode()))` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “an argument that is not one token is logged with its real size as outside the vocabulary, never split into fields” |
| 3.13 | `ccd/ccd` | `fm=$(_plat_mtime "$REG/$id.$field" 2>/dev/null) && [[ "$fm" =~ ^[0-9]+$ ]] \|\| continue` → `fm=$(_plat_mtime "$REG/$id.$field" 2>/dev/null) && [[ "$fm" =~ ^[0-9]+$ ]] \|\| :` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “a field whose time cannot be read is not overwritten” |
| 3.14 | `ccd/ccd` | `newest[kind] = (val, at)` → `newest.setdefault(kind, (val, at))` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “the newest of two acknowledged commands wins” |
| 3.15 | `ccd/ccd` | `if any(k == kind and v == val.lower() and abs(t - at) <= window for t, k, v in rows): / continue / newest[kind] = (val, at) / for kind, (val, at) in sorted(newest.items()):` → `newest[kind] = (val, at) / for kind, (val, at) in sorted(newest.items()): / if any(k == kind and v == val.lower() and abs(t - at) <= window for t, k, v in rows): / continue` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “the newest command NO JOURNAL ROW EXPLAINS wins: a later route --apply does not hide the operator's own” |
| 3.16 | `ccd/ccd` | `[[ -f "$f" && -r "$f" ]] \|\| { _operator_choice_say "$id" "unmeasured (its transcript is not a readable regular file)"; return 0; }` → (nothing) | ccd-operator-choice.test.ts | 2 failed \| 35 passed (37): “could not measure is said, never silent: a directory for a transcript, no python3, a reader that failed — rc 0, the record unchanged”; “a FIFO where the transcript should be is never opened: the stop is not held, and it is said” |
| 3.17 | `ccd/ccd` | `command -v python3 >/dev/null 2>&1 \|\| { _operator_choice_say "$id" "unmeasured (no python3)"; return 0; }` → `command -v python3 >/dev/null 2>&1 \|\| return 0` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “could not measure is said, never silent: a directory for a transcript, no python3, a reader that failed — rc 0, the record unchanged” |
| 3.18 | `ccd/ccd` | `2>/dev/null) \|\| { _operator_choice_say "$id" "unmeasured (the transcript reader failed)"; return 0; }` → `2>/dev/null) \|\| return 0` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “could not measure is said, never silent: a directory for a transcript, no python3, a reader that failed — rc 0, the record unchanged” |
| 3.19 | `ccd/ccd` | `if not ack or at < floor:` → `if not ack:` | ccd-operator-choice.test.ts | 2 failed \| 35 passed (37): “a session with no journal yet (spawned by an older ccd) promotes nothing at its first stop, opens the journal, and says so”; “a command older than the journal's floor is not read” |
| 3.20 | `ccd/ccd` | `why="its journal opened only now, so an older command may be an older ccd's own keystroke"` → (nothing) | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “a session with no journal yet (spawned by an older ccd) promotes nothing at its first stop, opens the journal, and says so” |
| 3.21 | `ccd/ccd` | `if kind == "model" and named.endswith("(default)"): / named = "default"` → (nothing) | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “a picker row Claude Code marks (default) is the default class, not the model it resolves to” |
| 3.22 | `ccd/ccd` | `CLEAN = re.compile(r"\x1b\[[0-9;]*m\|`")` → `CLEAN = re.compile(r"\x1b\[[0-9;]*m")` | ccd-operator-choice.test.ts | 4 failed \| 33 passed (37): “the picker takes no argument: its acknowledgement names the value, in either shape Claude Code writes it”; “a picker row Claude Code marks (default) is the default class, not the model it resolves to”; “the newest command NO JOURNAL ROW EXPLAINS wins: a later route --apply does not hide the operator's own”; … and 1 more |
| 3.23 | `ccd/ccd` | `\|(Ultracode) on\b")}` → `")}` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “/effort ultracode as 2.1.284 and later acknowledge it ("Ultracode on …") is read” |
| 3.24 | `ccd/ccd` | `shown="$val"; [[ "$val" == "?" ]] && shown=` → `shown="?"; [[ "$val" == "?" ]] && shown=` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “an unmappable value does not abort a swap: logged, the record unchanged, and the swap lands” |
| 3.25 | `ccd/ccd` | `shown="(${n//[^0-9]/} bytes, not one token)"` → `shown="(${#val} bytes, not one token)"` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “an argument that is not one token is logged with its real size as outside the vocabulary, never split into fields” |
| 3.26 | `ccd/ccd` | `_route_apply_now() {   # id -> 0 everything wanted is applied` → `_bounce_session() { local id="$1"; _svc_stop "claude-session@$id" 2>/dev/null; _svc_start "claude-session@$id"; } / _route_apply_now() {   # id -> 0 everything wanted is applied` | ccd-operator-choice.test.ts | 1 failed \| 36 passed (37): “every stop in ccd is classified: three keep the operator's choice first, the rest end the row” |

```bash
git add ccd/ccd server/test/ccd-operator-choice.test.ts server/test/ccd-die-containment.test.ts
git commit -F - <<'EOF'
feat(continuity): the operator's own /model and /effort survive a restart (stage 7, part 2)

Before each stop that a spawn follows (cmd_swap, ccd stop, ws-archive), `_operator_choice_keep` reads the
transcript for the newest acknowledged /model and /effort above the journal's floor that no `.typed` row explains
and writes it through cmd_route with actor=operator-session. A value outside the vocabulary, or one the record's
checks refuse, is logged and leaves the record unchanged, and a stop that cannot read logs `unmeasured`; a field
written after the keystroke wins; nothing in it can fail a stop. A census classifies every stop in ccd.
`_reg_get` census +1 (181/152).
EOF
```

---

### Task 4: The stage-7 row, README and the spec

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Modify: `deploy/measure-continuity.py` (`--stage 7`, registered in `STAGES`)
- Create: `server/test/measure-continuity-stage7.test.ts`
- Modify: `README.md` (one subsection, directly after the stage-4 one), the spec (§5.7 as planned; §9's stage-7 row)

**Interfaces:**
- Consumes: the `route … [actor=operator-session]` and `operator-choice <id>: …` lines Task 3 writes.
- Produces: `--stage 7` → `operator_choice`: `restarts_that_reverted_an_operator_model`,
  `operator_choices_written_by_field`, `operator_values_outside_the_vocabulary_by_kind`,
  `operator_choices_refused_by_kind`, `stops_that_could_not_read_the_transcript`.

- [ ] **Step 1: Write the failing test**

<!-- replay: create server/test/measure-continuity-stage7.test.ts -->
```ts
// `deploy/measure-continuity.py`'s stage-7 row (session-continuity spec §9;
// wave 3): restarts that revert an operator's `/model`. The instrument is
// READ-ONLY and reads swap.log, so two things are pinned, as for stage 4: the
// row counts what its name says on a hand-built log, and each regex is bound to
// a line the REAL `_operator_choice_keep` wrote.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../deploy/measure-continuity.py');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-measure-continuity-s7-'); });
afterEach(() => { h.cleanup(); });

type Row = Record<string, number | string | Record<string, number>>;
const run = (extra: string[] = [], env: Record<string, string> = {}): Row => {
  const out = execFileSync('python3', [TOOL, '--home', h.home, '--stage', '7', ...extra, '--json'],
    { encoding: 'utf8', env: { ...process.env, ...env } });
  return (JSON.parse(out) as { stage7: { operator_choice: Row } }).stage7.operator_choice;
};

describe('stage 7 counts what its row says (TZ=UTC, hand-built log)', () => {
  it('a /model outside the vocabulary or refused is a revert; the writes, the /effort skips and the unmeasured stops are reported beside it', () => {
    const log = path.join(h.home, 'hand-built-swap.log');
    fs.writeFileSync(log, [
      '2026-10-05 10:00:00 route s1: class fable -> opus [actor=operator-session] (its own /model, kept across a restart)',
      '2026-10-05 10:01:00 route s2: effort ∅ -> high [actor=operator-session] (its own /effort, kept across a restart)',
      '2026-10-05 10:02:00 route s3: class <12 bytes, unrecognised> -> sonnet [actor=operator-session] (its own /model, kept across a restart)',
      '2026-10-05 10:03:00 route s4: class opus -> fable [actor=operator] (from the PWA)',                      // not this row's writer
      '2026-10-05 10:04:00 operator-choice s5: /model gpt-5.6-sol is outside the class vocabulary — the record is unchanged',
      '2026-10-05 10:05:00 operator-choice s6: /model sonnet refused by the route record\'s own checks — the record is unchanged',
      '2026-10-05 10:06:00 operator-choice s7: /effort high refused by the route record\'s own checks — the record is unchanged',
      '2026-10-05 10:07:00 operator-choice s9: unmeasured (its transcript is not a readable regular file)',
      '2026-10-04 09:00:00 operator-choice s8: /model (15 bytes, not one token) is outside the class vocabulary — the record is unchanged',   // before --since
      '2026-10-04 09:01:00 operator-choice s8: unmeasured (no python3)',                                        // before --since
    ].join('\n') + '\n');
    const r = run(['--swap-log', log, '--since', '2026-10-05'], { TZ: 'UTC' });
    expect(r.restarts_that_reverted_an_operator_model).toBe(2);
    expect(r.operator_choices_written_by_field).toEqual({ class: 2, effort: 1 });
    expect(r.operator_values_outside_the_vocabulary_by_kind).toEqual({ model: 1 });
    expect(r.operator_choices_refused_by_kind).toEqual({ effort: 1, model: 1 });
    expect(r.stops_that_could_not_read_the_transcript, 'reported, never folded into the revert row').toBe(1);
    expect(run(['--swap-log', path.join(h.home, 'nope.log')])).toEqual({ swap_log: 'absent' });
  });
});

describe('each regex is bound to the line the real _operator_choice_keep writes', () => {
  const ID = 'claude-demo';
  const at = Math.floor(Date.now() / 1000) - 600;
  const transcript = (name: string, args: string, ackText: string): void => {
    const p = h.sh(`_transcript_path ${ID}`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const row = (content: string, u: string): string => JSON.stringify({ parentUuid: 'p', isSidechain: false, type: 'user', uuid: u,
      timestamp: new Date(at * 1000).toISOString(), message: { role: 'user', content } });
    fs.writeFileSync(p, [row(`<command-name>/${name}</command-name>\n            <command-message>${name}</command-message>\n            <command-args>${args}</command-args>`, 'c'),
      row(`<local-command-stdout>${ackText}</local-command-stdout>`, 'k')].join('\n') + '\n');
  };
  const field = (f: string, v: string): void => {
    const p = path.join(h.home, '.cc-sessions', `${ID}.${f}`);
    fs.writeFileSync(p, v); fs.utimesSync(p, at - 86400, at - 86400);
  };

  it('a write, a value outside the vocabulary, a refusal and an unmeasured stop all parse', () => {
    h.sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} workdir "$HOME/projects/demo"; _reg_set ${ID} uuid deadbeef-0000-4000-8000-000000000000
          _reg_set ${ID} typed "$(( $(date +%s) - 172800 )) since"`);
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    field('class', 'fable');
    transcript('model', 'opus', 'Set model to `Opus 5.5` for this session only');
    h.sh(`_operator_choice_keep ${ID}`);
    transcript('model', 'gpt-5.6-sol', 'Set model to `gpt-5.6-sol` for this session only');
    h.sh(`_operator_choice_keep ${ID}`);
    field('class', 'haiku');
    transcript('effort', 'high', 'Set effort level to high (this session only)');
    h.sh(`_operator_choice_keep ${ID}`);
    const p = h.sh(`_transcript_path ${ID}`);
    fs.rmSync(p); fs.mkdirSync(p);
    h.sh(`_operator_choice_keep ${ID}`);
    const r = run();
    expect(r.operator_choices_written_by_field).toEqual({ class: 1 });
    expect(r.operator_values_outside_the_vocabulary_by_kind).toEqual({ model: 1 });
    expect(r.operator_choices_refused_by_kind).toEqual({ effort: 1 });
    expect(r.restarts_that_reverted_an_operator_model).toBe(1);
    expect(r.stops_that_could_not_read_the_transcript).toBe(1);
  });
});
```


- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/measure-continuity-stage7.test.ts --maxWorkers=2
```

Expected: `2 failed (2)` (`--stage 7` is not a choice yet).

- [ ] **Step 3: The stage-7 block**

In `deploy/measure-continuity.py`, find:

<!-- replay: replace deploy/measure-continuity.py -->
```python
STAGES = {1: stage1, 4: stage4}
```

and replace it with:

```python
# ── stage 7 (wave 3): the operator's choice survives a restart ──────────────
# §9's stage-7 row, "restarts that revert an operator's /model", read off
# swap.log. Before a stop that a spawn follows, ccd writes an operator's own
# `/model` or `/effort` to the route record (`route <id>: <field> <old> -> <new>
# [actor=operator-session]`), or says why it could not: a value outside the
# vocabulary, or one the record's own checks refused (`operator-choice <id>: …`).
# Those two are the restarts ccd KNOWS reverted the operator's choice, so they
# are the row; the writes are reported beside them, and so are the stops where
# ccd could not read at all (`operator-choice <id>: unmeasured (…)`), which MAY
# have reverted one — never folded into the row, never dropped. Named cost: a
# restart no stop precedes (a supervisor revival after a crash) reads no
# transcript and leaves no line, so a revert there is not counted.
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
```


- [ ] **Step 4: README and the spec**

In `README.md`, find this anchor:

<!-- replay: insert-above README.md -->
```text

### A return visit merges the session's sidecar (session-continuity stage 1)
```

and insert, directly above it:

```text

### The operator's own `/model` and `/effort` survive a restart (session-continuity stage 7)

`docs/superpowers/specs/2026-09-23-session-continuity-design.md` §5.7. A `/model` or `/effort` typed in a session
changes the running process only, and every spawn rebuilds its command line from the route record, so an
operator's switch was undone by the next swap (§1.4: Opus typed by hand, Fable again after an auto-home).

- **Before a stop that a spawn follows** — `cmd_swap` (every rescue, auto-home, manual, PWA or `swap-self` move),
  `ccd stop` (a later `start`/`enable` respawns from the record) and `ccd ws-archive` (`ws-restore` does) —
  `_operator_choice_keep` reads the transcript for the newest acknowledged `/model` and `/effort` that no journal
  row explains and writes an operator's value through `cmd_route`'s own writer: `route <id>: class fable -> opus
  [actor=operator-session]` in `swap.log`. A supervisor revival after a crash has no ccd stop, so it reads nothing
  (spec §5.7 scopes it out).
- **ccd's own keystrokes are not the operator's.** The settle's `/effort` and `route --apply` journal what they
  type in `$REG/<id>.typed` (`<epoch> <model|effort> <value>`, the last `TYPED_KEEP_ROWS=16`, purged with the
  row); a command with the same value within `TYPED_MATCH_WINDOW=60` seconds of a row is ccd's and is left alone.
  The journal's first row is its floor (`<epoch> since`, written at this ccd's first spawn of the row): no command
  older than it is read, since an older ccd typed without journalling, and a stop that finds no floor opens one and
  promotes nothing that time.
- **The value** is the command's argument, or — for the picker and the slider, which take none — the one Claude
  Code's acknowledgement names (``Set model to `Opus 5.5` …``, ANSI bold on older builds; a `(default)` row is the
  `default` class). A `/model` maps through the class vocabulary itself (`opus`, `sonnet`, `haiku`, `fable`,
  `default`, each also with `[1m]`, which the record cannot hold), then a full model id through
  `_model_family_class`, the bash port of `familyClassOf`'s dash-token rule, pinned to it.
- **It never fails a stop, and never loses a choice silently.** A value outside the vocabulary, or one the record's
  own checks refuse (`haiku` with an effort level), is logged as `operator-choice <id>: …` and leaves the record
  unchanged; a stop that cannot read at all logs `operator-choice <id>: unmeasured (…)`. A field written after the
  keystroke (the PWA picker, a coordinator's route, this step's last write) is the later choice and wins.
  `python3 deploy/measure-continuity.py --stage 7` counts the writes, the restarts that reverted a `/model`, and
  the unmeasured stops.
```


In `docs/superpowers/specs/2026-09-23-session-continuity-design.md`, find this anchor:

<!-- replay: insert-above docs/superpowers/specs/2026-09-23-session-continuity-design.md -->
```text
## 6. Invariants kept
```

and insert, directly above it:

```text
**As planned (wave 3, 2026-10-04).** The stops that a spawn follows are `cmd_swap`'s (every rescue, auto-home,
manual, PWA and `swap-self` move), `ccd stop`'s (a later `start` or `enable` respawns from the record) and
`ccd ws-archive`'s (`ws-restore` does); the stops that end the row (`ws-rm`, `forget`, the reap and reclaim
tails) are not, `_swap_refuse`'s restart follows `cmd_swap`'s own stop, and a supervisor revival has no ccd stop
at all. The short window is `TYPED_MATCH_WINDOW` (60 s), and `.typed` keeps its last 16 rows below a floor row.
The readings the text above leaves open are fixed: "the newest command" is one per kind (`/model` and `/effort`
are two fields), chosen among the commands no row matches; a command's value is its argument or, for the picker and
the slider, which take none, the value Claude Code's acknowledgement names (ANSI bold or backticks removed; a row
marked `(default)` is the `default` class); a command no acknowledgement follows changed nothing and is not read; a
route field written after the keystroke is the later choice and is not overwritten; the journal has a FLOOR — its
first row, written at this ccd's first spawn of the row (or first journalled keystroke, or first stop that finds
none) — and no command older than it is read, because an older ccd typed its keystrokes unjournalled; a value
outside the vocabulary is logged by name when it is one token, by size otherwise; and a stop that cannot read at
all (no floor yet, a transcript that is not a readable regular file, no python, a failed reader) logs
`unmeasured`. §9's stage-7 row counts the restarts whose `/model` ccd logged as outside the vocabulary or refused,
with the unmeasured stops reported beside it.

```

In `docs/superpowers/specs/2026-09-23-session-continuity-design.md`, find:

<!-- replay: replace docs/superpowers/specs/2026-09-23-session-continuity-design.md -->
```text
| 7 | restarts that revert an operator's `/model` | this session's case | 0 |
```

and replace it with:

```text
| 7 | restarts that revert an operator's `/model` (those ccd logs: a value outside the vocabulary, or refused; the stops that could not read the transcript are reported beside it) | this session's case | 0 |
```


- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/measure-continuity-stage7.test.ts test/measure-continuity-stage4.test.ts test/measure-continuity.test.ts test/pools-prose.test.ts --maxWorkers=2
python3 ../deploy/measure-continuity.py --home /nonexistent --stage 7 --json
```

Expected: `46 passed (46)` (2 + 12 + 5 + 27), and a `stage7` → `operator_choice` → `"swap_log": "absent"` section
(the JSON is printed with `indent=1`).

- [ ] **Step 6: Mutation check, then commit**

| # | File | Exact edit (old → new) | Suite | Measured red on the full prototype |
|---|---|---|---|---|
| 4.1 | `deploy/measure-continuity.py` | `-> (\S+) \[actor=operator-session\]")` → `-> (\S+) \[actor=[^\]]*\]")` | measure-continuity-stage7.test.ts | 1 failed \| 1 passed (2): “a /model outside the vocabulary or refused is a revert; the writes, the /effort skips and the unmeasured stops are reported beside it” |
| 4.2 | `deploy/measure-continuity.py` | `outside["model"] + refused["model"]` → `sum(outside.values()) + sum(refused.values())` | measure-continuity-stage7.test.ts | 2 failed (2): “a /model outside the vocabulary or refused is a revert; the writes, the /effort skips and the unmeasured stops are reported beside it”; “a write, a value outside the vocabulary, a refusal and an unmeasured stop all parse” |
| 4.3 | `deploy/measure-continuity.py` | `m = S7_SKIP.match(line) / if m and inwin(m.group(1)):` → `m = S7_SKIP.match(line) / if m:` | measure-continuity-stage7.test.ts | 1 failed \| 1 passed (2): “a /model outside the vocabulary or refused is a revert; the writes, the /effort skips and the unmeasured stops are reported beside it” |
| 4.4 | `deploy/measure-continuity.py` | `route (\S+): (class\|effort) .+? -> (\S+)` → `route (\S+): (class\|effort) \S+ -> (\S+)` | measure-continuity-stage7.test.ts | 1 failed \| 1 passed (2): “a /model outside the vocabulary or refused is a revert; the writes, the /effort skips and the unmeasured stops are reported beside it” |
| 4.5 | `deploy/measure-continuity.py` | `unmeasured += 1` → `pass` | measure-continuity-stage7.test.ts | 2 failed (2): “a /model outside the vocabulary or refused is a revert; the writes, the /effort skips and the unmeasured stops are reported beside it”; “a write, a value outside the vocabulary, a refusal and an unmeasured stop all parse” |

```bash
git add deploy/measure-continuity.py server/test/measure-continuity-stage7.test.ts README.md \
  docs/superpowers/specs/2026-09-23-session-continuity-design.md
git commit -F - <<'EOF'
docs(continuity): --stage 7 counts the restarts that reverted an operator's /model; README and spec §5.7 as built
EOF
```

---

### Task 5: Whole-branch verification, the PR — and the AGENT-FIRST deploy

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified, unless `main` moved — then only the merge's own resolution (the stamp and the census).

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: the wave-3 PR on this workspace's own branch and a wave-done report.

- [ ] **Step 1: Merge current `main`, and re-measure on the merged tree**

ONE gated block. It resolves, by script, exactly the two conflicts another wave can leave in `ccd/ccd` — the line-2
stamp, and the `_reg_get` census's comment lines (MAIN's side, which `reg-get-census.py 2` then re-derives) — and
nothing else; it commits only when both scripts succeeded, `bash -n` passed and no conflict marker is left; on anything
else it commits nothing and aborts the merge. The resolver is wave 2's, verbatim:

<!-- replay: save resolve-census-merge.py -->
```python
import sys
# After `git merge origin/main` stopped with ccd/ccd as its ONLY conflicted file: resolve the line-2 stamp
# hunk (either side — the re-stamp rewrites it) and the `_reg_get` census hunks — comment lines only, within
# eight lines of an `invocations across` line — (MAIN's side, which `reg-get-census.py` then re-derives:
# main's stated pair + this wave's three reads), and STOP, writing nothing, on any other hunk.
# Reads git's default, zdiff3 and diff3 conflict styles alike.
L = open('ccd/ccd', encoding='utf8').read().split('\n')
census = [k for k, l in enumerate(L) if 'invocations across' in l]   # the block's anchor, in either side
out, i, n = [], 0, 0
while i < len(L):
    if not L[i].startswith('<<<<<<< '):
        out.append(L[i]); i += 1; continue
    j, ours, theirs = i + 1, [], []
    cur = ours
    while not L[j].startswith('>>>>>>> '):
        if L[j].startswith('||||||| '): cur = []          # diff3's base section: dropped
        elif L[j] == '=======': cur = theirs
        else: cur.append(L[j])
        j += 1
    if i == 1 and len(ours) == len(theirs) == 1 and all(s.startswith('# ccrc:generated ') for s in ours + theirs):
        out += ours
    elif all(s.startswith('#') for s in ours + theirs) and any(abs(i - z) <= 8 for z in census):
        out += theirs
    else:
        sys.exit(f'STOP: a conflict at ccd/ccd:{i + 1} that is neither the stamp nor the census block')
    n += 1; i = j + 1
open('ccd/ccd', 'w', encoding='utf8').write('\n'.join(out))
print(f'resolved {n} hunk(s): the stamp and the census block, main\'s side')
```

```bash
SCRATCH=<your scratchpad, absolute>
[[ "$SCRATCH" == /* && -f "$SCRATCH/reg-get-census.py" && -f "$SCRATCH/resolve-census-merge.py" ]] || echo "STOP: the two scripts are not in SCRATCH"
if ! git fetch origin main; then
  echo 'STOP: the fetch failed — nothing merged; report it'
elif git -c merge.conflictStyle=merge merge --no-edit origin/main; then
  echo 'merged without a conflict, or already up to date'
elif [ "$(git diff --name-only --diff-filter=U)" = ccd/ccd ] && python3 "$SCRATCH/resolve-census-merge.py" \
     && python3 "$SCRATCH/reg-get-census.py" 2 && ~/.local/bin/ccrc restamp ccd/ccd && bash -n ccd/ccd \
     && ! grep -qE '^(<<<<<<< |=======$|>>>>>>> )' ccd/ccd; then
  git add ccd/ccd && git commit --no-edit && echo 'merged: the stamp and the census resolved'
else
  echo 'STOP: a conflict this block does not resolve — report it'; git merge --abort
fi
git log -1 --format='%h %s'
python3 "$SCRATCH/reg-get-census.py" 2   # on any merged tree: idempotent, and it STOPs if the census is not main's + 2
```

Expected: `Already up to date.` and `merged without a conflict, or already up to date` when `main` has not moved (a
`main` that changed `ccd/ccd` always conflicts on its stamp), or `merged: the stamp and the census resolved`.
Measured on scratch clones (base `22f7931af`; this wave's prototype as one commit; `origin` a real remote, so the
fetch runs): another wave that added a `_reg_get` read and re-measured the census → `resolved 2 hunk(s): the stamp
and the census block, main's side`, `census 180/151 -> 182/153`, committed, `bash -n` clean, a clean tree; a `main`
that edited the README line Task 4 anchors on → `STOP`, the merge aborted, the tip unchanged, a clean tree; an edit
far from this wave's files → `merged without a conflict, or already up to date`. On `STOP` — another file conflicted (a wave that also touched `README.md`, the spec or
`deploy/measure-continuity.py`: the coordinator rules those hunks) — the branch's tip is unchanged, no merge is in
progress and the tree is clean: report it and stop. Never resolve by hand; never `git checkout --theirs` on a file.
Then on the merged tree: the S6-R11 procedure, the census commands (`181`/`152` over main's stated pair), and
`corpus-frozen`.

- [ ] **Step 2: The server suite in twelve sequential shards on the merged tip, then agent and pwa**

```bash
git log -1 --format='%h merged tip under test'
cd server && npm ci
./node_modules/.bin/vitest run --shard=1/12 --maxWorkers=2     # … then 2/12 … 12/12, one call each, foreground
cd ../agent && npm ci && npm run test
cd ../pwa   && npm ci && npm run test
```

Expected: PASS everywhere. A shard killed by the 600 s ceiling is re-run as `--shard=k/24` (two calls). Re-run any
load flake IN ISOLATION before calling it a break. Report the twelve shard summaries, their sum, and the merged sha.
**If `main` moves again before the PR merges, repeat Step 1 and every shard.**

- [ ] **Step 3: The wave's own surface and the repo-wide guards in named runs**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-operator-choice.test.ts test/ccd-rescue-policy.test.ts test/measure-continuity-stage4.test.ts test/measure-continuity-stage7.test.ts test/measure-continuity.test.ts --maxWorkers=2
./node_modules/.bin/vitest run test/single-definition.test.ts test/modelenv-single-writer.test.ts test/box-token-census.test.ts test/routing-references.test.ts test/pools-prose.test.ts test/ownership.test.ts test/ccd-reg-get-census.test.ts --maxWorkers=2
./node_modules/.bin/vitest run test/ccd-workspaces.test.ts test/typecheck-tests.test.ts test/ccd-die-containment.test.ts --maxWorkers=2
git fetch origin main && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts --maxWorkers=2
./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected (measured on the prototype): `158 passed` (37 + 102 + 12 + 2 + 5); `357 passed`; `ccd-workspaces` 79 and
`typecheck-tests` 12 and `ccd-die-containment` 12; `87 passed` (`deviation-refs` compares this branch's entries against `origin/main`'s without
merging); `7 passed | 328 skipped (335)`; and the S6-R11 procedure `147 / 197 / 52 / 35` with the census at main's
stated pair + 2.

- [ ] **Step 4: Confirm the author, push, open the PR**

```bash
git log --format='%an <%ae>' "$(git merge-base origin/main HEAD)"..HEAD | sort -u
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Session continuity wave 3: wave 2's residue, then the operator's choice survives a restart (AGENT-FIRST)" --body-file - <<'EOF'
Wave 3 of the session-continuity programme (spec `docs/superpowers/specs/2026-09-23-session-continuity-design.md`; plan `docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md`). **AGENT-FIRST, ccd only.** No wire change.

1. **Wave 2's residue (review 246), the first commit.** A rescue wait ends `swap` only at `cmd_swap`'s landing (a refused auto-rescue leaves it open); rule 3 counts a rescue, and marks the account it left, only once that landing follows it; the do-not-bounce cause names the BEST account with room; a not-blocked tick forks nothing; a forged `reset=` cannot crash the history read, and its lists are checked against sets. Spec §9's stage-4 target is restated as ruled: 0 sessions with a fourth rescue in an hour that no chain wait preceded (the raw 4+ count reported) — `--stage 4` counts it, asked of a fourth rescue the chain wait could have held (a dated block not past its reset's grace; the coordinator confirms that filter).
2. **Stage 7: the operator's own `/model` and `/effort` survive a restart.** ccd journals its own keystrokes (the settle's `/effort`, `route --apply`) in `$REG/<id>.typed`, above a floor the first spawn opens so an older ccd's unjournalled keystrokes are never promoted at the deploy; before each stop a spawn follows (`cmd_swap`, `ccd stop`, `ws-archive` — a census classifies every stop in ccd) it reads the transcript for the newest acknowledged command no journal row explains (backtick, ANSI, `(default)` and `Ultracode on` acknowledgements alike), maps it (the class vocabulary as the alias table, `[1m]` too; a full id through the bash port of `familyClassOf`, pinned to it) and writes it through `cmd_route` with `actor=operator-session`. Outside the vocabulary or refused: logged, record unchanged, the stop goes on; could not read: logged `unmeasured`. `--stage 7` counts the writes, the reverts and the unmeasured stops.

Citation corpus (S6-R11): unmoved (`147/197/52/35`); every edit above the corpus is line-neutral. `_reg_get` census +2 over the base's stated pair (179/150 -> 181/152 on this plan's base). `_reg_purge` inventory 43 -> 44 (`typed`).

**Deploy: by ccrc's own update mechanism (no hand rollout, operator ruling 2026-09-30); AGENT-FIRST — ccd only.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 5: Report (the wave-done mail)**

Per the worker skill: the branch tip sha; Step 1's outcome; the twelve shard summaries and their sum at that merged
sha, agent and pwa; each task's S6-R11 output and census before/after; every mutation row's measured red at its own
commit; every departure from this plan, named by a slug (the coordinator numbers it from 3896 to 3905). Then stop.

- [ ] **Step 6: Merge (the coordinator's)**

Squash, at the reviewed head, after the review run rules.

- [ ] **Step 7: Deploy — measured, never moved by hand (post-merge)**

Do NOT run `ccrc rollout` or `ccrc update` by hand: ccrc's own update mechanism moves both boxes to the new prerelease.
This measures that it did, read-only:

```bash
PR=<this wave's PR number>
git fetch origin main --tags
M=$(gh pr view "$PR" --json mergeCommit -q .mergeCommit.oid)
TAG=$(git tag --points-at "$M" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
echo "merge: $M  tag: ${TAG:-<none yet>}"
ccrc rollout --check
```

Expected: once `release-main.yml` has tagged the merge, the fleet box reports that tag (AGENT-FIRST is met once it
does; the server arm is inert). A box that does not converge is REPORTED, never moved. Then, read-only on the fleet box,
once a session has been restarted after an operator's `/model`:

```bash
grep -E ' route [^ ]+: (class|effort) .* \[actor=operator-session\]| operator-choice ' "$HOME/.cc-sessions/swap.log" | tail -5
python3 "$HOME/ccrc/deploy/measure-continuity.py" --stage 4 --stage 7 --since "$(date +%F)"
```


**What the deploy itself does to the fleet.** Every session spawned before the new ccd has no journal floor. Its first
stop, swap or archive after the deploy opens the floor, promotes nothing and logs `operator-choice <id>: unmeasured
(its journal opened only now, …)` once — about one line per live session, read in `--stage 7` as
`stops_that_could_not_read_the_transcript`, and expected. Every respawn after that opens the floor at the spawn, so
the line does not recur. An operator `/model` typed in such a session BEFORE its first post-deploy stop is the
one-time cost (Open question 7).

A rollback is the operator's call through the same mechanism. It is safe on the data: `.typed` (its floor row
included) is inert to an older ccd (`_reg_purge` removes it with the row by suffix), and an older `_rescue_history`
reads the same log. A roll-FORWARD after a rollback is the one sequence the floor does not cover: keystrokes the older
ccd typed after a floor was opened are unjournalled and newer than it (Open question 7).

---

## Residue carried (review 246 — not departures from the spec)

Task 1's code and text bring wave 2 into line with the spec it already had, so they take no number: F1 (the rescue
arm writes no end; the landing does — §5.4's own "the wait ends `swap` when the session moves"), F2 ("best account
with room"), F3 (the strand's swap-log read scoped to a genuine no-room strand, in README and two comments), F5 (the
`-e` guard), minor 3 (`reset=` at most twelve digits, with a lookahead) and minor 4 (a set beside each list). Rows
1.1, 1.4, 1.5, 1.6, 1.11.

## Deviations found

Numbers are ISSUED, never chosen: the coordinator defines each departure below from the worker's block, 3896 to 3905,
in the same act as the wave's acceptance; a worker never calls the allocator (worker clause 11). A departure found
while executing is named in the wave-done mail by a new slug. A session that cannot reach the coordinator writes
`D-TBD-<slug>` in its report and nowhere in a committed file.

Departures from the spec (and from wave 2's plan) that this plan makes, each measured above — nine, against a block
of ten (Open question 9):

- **D-3896** `rule-three-counts-landed-rescues` — minor 5, decided with F1: spec §5.4 rule 3's count and its just-left skip
  read only rescues whose `cmd_swap` landing line followed them before the session's next rescue; the spread list
  keeps every dispatch, landed or in flight (a move still carrying is the herd). Spec rev 7 amended (Task 1 Step 6).
  Rows 1.2, 1.3.
- **D-3897** `stage-four-target-restated` — F6, ruled by the coordinator 2026-10-03: §9's stage-4 target is "0 sessions with
  a fourth auto-rescue in an hour that no chain wait preceded" (the raw 4+ count reported). This plan adds two
  readings the ruling did not carry and writes BOTH into the §9 row (Task 1 Step 6): it counts landed rescues, and it
  asks only of a fourth rescue the chain wait could have held (a dated block not past its five-hour reset's grace,
  rule 3's own gate) — the second, a narrowing the ruling did not carry, was confirmed by the coordinator at dispatch (Open question 5). A
  Codex-lane session, never chain-waited by rule, is the named cost; a `reset=` that is not one to twelve digits is
  no date. Rows 1.7–1.10, 1.12–1.14.
- **`operator-choice-which-command`** — §5.7 says "the newest `/model` or `/effort` local command that no `.typed`
  row matches". The plan reads that as one newest command PER KIND (two fields), chosen among the commands no row
  matches (so a later `route --apply` never hides the operator's earlier one — the first draft's order, which did,
  is row 3.15); reads only commands an acknowledgement follows; takes the value from `<command-args>` or, when that
  is empty (the picker, the slider, `route --apply`), from the acknowledgement with its ANSI bold or backticks
  removed, a `(default)` row as the `default` class and `Ultracode on` as `ultracode`; and never reads a human
  quoting the envelope or a subagent's row. Rows 2.2, 3.8–3.10, 3.14, 3.15, 3.21–3.23.
- **`operator-choice-record-newer-wins`** — not in §5.7: a route field written after the keystroke (or whose time
  cannot be read) is not overwritten, and a value the record already holds is not written again — so a PWA or
  coordinator choice made after the operator's `/model` stands, and no stop re-writes the same value. Rows 3.6, 3.7,
  3.13.
- **D-3900** `operator-choice-journal-floor` — §5.7 does not bound `.typed` or say where it starts: it keeps its last
  `TYPED_KEEP_ROWS` (16) keystroke rows below a FLOOR row (`<epoch> since`) that `_spawn_start` opens and nothing
  moves, admits one-token values only, and matches within `TYPED_MATCH_WINDOW` (60 s); no command older than the
  floor is read, and a stop that finds no floor opens it and promotes nothing — because before the floor an older
  ccd's unjournalled keystrokes and the operator's cannot be told apart (review measured on the first draft: `effort ∅ ->
  ultracode` and `class fable -> opus [actor=operator-session]` from pre-deploy keystrokes). Rows 2.4, 2.5, 2.10,
  2.11, 3.11, 3.19, 3.20.
- **`operator-choice-unmeasured-logged`** — §5.7 asks only that an out-of-vocabulary value be logged. The plan logs
  that value by name when it is one token and by its real byte size otherwise, and also logs `unmeasured (…)` where a
  stop could not read at all (no floor yet, a transcript that is not a readable regular file — never `grep` on a
  FIFO — no python3, a failed reader), so no lost choice is silent. Rows 3.16–3.18, 3.24, 3.25.
- **`operator-choice-three-stop-sites`** — §5.7's "a stop that will be followed by a spawn" is read as `cmd_swap`,
  `cmd_stop` and `cmd_ws_archive` (Pre-flight 4), pinned by a census that classifies EVERY stop in `ccd/ccd`, so a
  new one reds until it is named; a supervisor revival, which follows no ccd stop, is out (Open question 1). Rows
  3.3, 3.4, 3.5, 3.26.
- **D-3903** `alias-table-is-route-classes` — the spec's alias table is derived from `ROUTE_CLASSES` (the same five words)
  rather than written again, case-folded so an acknowledgement's display word maps, and a `[1m]` variant maps to its
  base class because the record has no context dimension (Open question 2). Rows 2.6, 2.7.
- **`stage-seven-counts-logged-reverts`** — §9's stage-7 row ("restarts that revert an operator's `/model`") is
  measured as the restarts whose `/model` ccd logged as outside the vocabulary or refused, with the stops that could
  not read the transcript reported beside it, never folded in; a revert on a path with no stop (a supervisor revival)
  leaves no line and is not counted. Spec §9's row amended to say so. Rows 4.1–4.5.

---

## Review lenses

Four lenses, all `opus` — a diff of one shipped script (`ccd/ccd`: +248 / −31), one read-only instrument (+96 / −1),
README (+34 / −2), the spec (+25 / −5), two new test files (488 and 89 lines) and three extended (+100 / −5, +45 / −1,
+8 / −1) — sized to the fleet policy's 3–5 reviewers; one `sonnet` refute pass per finding.

1. **The stop path (opus, xhigh).** Prove `_operator_choice_keep` cannot fail, hang or abort any of its three stops:
   every early return is rc 0; `cmd_route` runs in a subshell; the transcript read is a regular-file read (`-f && -r`,
   pinned by the FIFO case) — never `grep` on a FIFO; the python has no `'` and prints only one-token values;
   `read -r kind val at n` cannot be split by a value. Confirm every return that may lose a choice logs and every
   silent one loses nothing. Confirm it runs before `cmd_swap`'s `_svc_stop`, after the pre-flight refusal (a refused
   swap reads nothing), and in the detached re-exec only once. Confirm nothing in it types, starts or stops anything.
2. **Whose keystroke is it (opus, high).** Read the journal writers against every path that types `/model` or
   `/effort` (`_inject_spawn_effort`, `_route_apply_now` → `_route_type_model`/`_route_type_effort`, and any other
   `send-keys … /model` or `/effort` in `ccd/ccd`): every ccd keystroke is journalled BEFORE it is typed; the floor
   is opened at every spawn before the settle types and never moves; the match compares kind and value case-folded
   within the window; the degraded class, `(default)` and `ultracode`'s `/effort ultracode` are all explained in both
   acknowledgement shapes. Check the record-newer rule against the mtime `_reg_set`'s rename gives.
3. **The residue and rule 3 (opus, high).** `_rescue_history`'s pairing: a landing binds only the session's latest
   pending rescue of the same move; a rescue older than the window is never pending; the spread list is unchanged;
   a forged log can neither raise nor go quadratic. The rescue arm's removed close: every other close site
   (`cmd_swap`'s landing, `_rescuewait_open`'s replacement, the policy's own ends) is unchanged, and no wait can now
   be left open forever by a dispatch that landed (the landing closes it).
4. **Guard fidelity, the instrument and the tax (opus, high).** Every mutation row mutates the guard it names; the
   agreement pin really runs both sides; the census of stops reds on an unclassified stop and on a moved call;
   `--stage 4`'s new row and `--stage 7` open nothing for writing, run no subprocess and cannot raise on a forged
   token; the S6-R11 census and the `_reg_get` census came from the instruments; `_reg_purge`'s inventory names
   `typed`; `ccd-die-containment`'s added name is the scanner's blind spot for `( )`, not a function that can die
   (Pre-flight 13).

---

## Open questions for the operator

1. **A supervisor revival still reverts an operator's `/model`.** Spec §5.7 scopes stage 7 to "a stop that will be
   followed by a spawn", and a revival (Claude Code exited — the commonest cause on this fleet is a pane-scope OOM
   kill, 16 in a week per spec §1.3 — and `cmd_supervise` respawns it from the record) follows no ccd stop. The
   transcript is still readable there; one call to `_operator_choice_keep` before the resume spawn in `cmd_ensure`
   would cover it (and the census would then list `cmd_ensure` among the keepers). Built as the spec says (not
   covered); the operator may widen it.
2. **`/model opus[1m]` survives as `opus`.** The route record's class has no context dimension, so the 1M-context
   choice is kept as its family and the next spawn runs the default context. Accept, or add a context field — a
   routing-spec change outside this programme.
3. **`ccd stop` and `ws-archive` keep the choice too.** The plan reads them as stops a spawn follows (`start`/`enable`
   and `ws-restore` spawn from the record). If the operator wants only the swap covered, drop two lines, two cases,
   rows 3.4–3.5, and move both names to the census's no-spawn list.
4. **The restated stage-4 row reads 0 before wave 2's deploy by construction** (no rescue line carried `reset=`/`type=`
   until then — Pre-flight 9); its first meaningful reading is the week after waves 2 and 3 are on the fleet box, read
   with the owed stage-4 reading (programme ledger), with refused dispatches no longer needing to be subtracted.
5. **For the coordinator: the stage-4 target's filter.** F6's ruled wording counts every fourth rescue no chain wait
   preceded; the instrument asks it only of a fourth rescue the chain wait could have held (dated, not past its
   five-hour reset's grace), because rule 3 never chain-waits the others and the ruled 0 would then measure a choice
   the design does not make. The filter is written into §9's row (Task 1 Step 6) so the spec and the instrument
   agree. Confirm it, or drop it: then delete `or not re.fullmatch(r"\d{1,12}", tok.get("reset", "")) or "type" not
   in tok` and the five-hour grace test from the row, guard `int()` some other way, expect u4 and u5 to count (4
   instead of 2), and drop rows 1.9, 1.10 and 1.14.
6. **Older `int()` calls in `--stage 4` on a forged token** (Pre-flight 15): the wait rows' `int(reset)` behind
   `isdigit()` and the carried-in row's bare `int(tok["row"])` raise on a 5000-digit or non-numeric token. Not this
   wave's; a candidate for the next residue batch.
7. **The journal floor's costs.** (a) An operator `/model` typed in a session that was already running at the deploy,
   before that session's first post-deploy stop or respawn, is not kept at that stop (logged `unmeasured` once). (b)
   After a rollback and a roll-forward, keystrokes the older ccd typed after a floor was opened are unjournalled and
   newer than it, so they could read as the operator's. Both are bounded to the transition; the alternative — no
   floor — promoted the box default into every live session at the deploy.
8. **A gpt-lane session's own `/model`** (`gpt-5.6-astra` and the like: 30 such acknowledgements in the 40-day
   census) is outside the class vocabulary, so it logs `operator-choice … is outside the class vocabulary` at every
   stop of that session and counts in `--stage 7`'s revert row. That is what §5.7 says (logged, record unchanged).
   If the operator would rather skip a non-Anthropic lane (keyed on `_is_anthropic_backend`, as the settle is), it
   is one guard and one case.
9. **Nine slugs against a ten-number block.** The worker's block (3896 to 3905) leaves one number for a departure
   found while executing; a second would need a new block from the allocator.

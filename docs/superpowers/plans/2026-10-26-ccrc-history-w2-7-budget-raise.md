# ccrc history wave W2-7: the budget raise and W2-5b2's carried follow-ups, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship ONE PR on the deploy lane (run 1025), merged and released before act 5 chooses the final W2 release's tag: acts 5 and 6 roll this PR's release, and acts 7 onward (step 0a first) run only on it (the operator's ruling R-B2). It has two parts.
- **Part A, the operator's ruling of 2026-10-26 (R-B1): "Build a budget amendment".** Today, from part 2 on, the spend budget is part 2's signed `spend_budget`, derived by `open --finalize` from the pilot's extrapolation and fixed. No amendment kind carries a budget (W2-D90's chosen set is `version-move`, `freeze-exception`, `forced-act`), so a `budget-exhausted` stop after part 2 has no remedy but a halt. This PR adds a fourth kind, `budget-raise`, written by the existing `open --amend` chain and checked by the existing open-record validator. It only ever raises the spend budget in force, it changes nothing that scores, and every reader of the budget reads the budget in force through one reader that walks the amendment chain.
  - **Task 1 (W2-D90, W2-D25, W2-D55; R-B1; D-7063).** The gate: `budget-raise` in `AMENDMENT_KINDS`, one new validator word `budget-not-raised`, the one reader `spendBudgetInForce(record)`, and the validator's rules for a raise. The driver: `AMEND_DETAILS['budget-raise']` and `--spend-budget` in `AMEND_FLAGS`, so `open --amend --kind budget-raise --spend-budget N` prints the superseding part 2.
  - **Task 2 (W2-D55, Q5; R-B1; D-7063).** The readers: `armNodeOf` (arms, judge, step 0b and the quiz fidelity re-pilot all take their budget from it) computes the node's share of the budget in force, and `armsCommand` prints and records that same figure. A `budget-exhausted` node resumes on its own `--out` under the amended record.
- **Part B, W2-5b2's carried follow-ups (CP-27, from its review round 3, ruled 2026-10-26).**
  - **Task 3 (F1, A10, A13).** `nodeAnswersOf` refuses a record marked correct whose answer state is not `value` (`input-invalid` "is not a settled answer record", where `report` exits INTERNAL today through `decideGate`'s throw); `verifyAbOf` names a wrong arm and a state off `AB_STATES` by their own details; one CONTROL title says what its world does.
  - **Task 4 (F2, A9).** One colon-realpath `--out` row per call site for the five `refuseColonInRealOut` calls W2-5b2 added, each with its measured mutant; the step 0b HOME row's half that no mutant can redden is replaced by a driver-side assertion.
- **Task 5.** The whole-PR checks, the PR body and the PR.

Sessions see no change in behaviour. No hook, unit, timer, store, schema, wire or `ccd/**` file changes. Nothing here runs a real model: every spawn in the tests reaches W2-4's recording stub.

**Architecture:** Two L4 operator scripts and their two test files.
- *`deploy/history-gate.mjs`* stays pure (imports only `node:crypto` and lib.mjs; no clock, no environment; `measure-history.test.ts` "W2-3 Task 2" scans it). Task 1 adds one exported pure function and edits the open-record section only (`// ── W2-3 Task 9:` onward, plus the two word lists near the top). `decideGate`, `assembleReports` and every scoring function are untouched: the gate's computation is unchanged.
- *`deploy/history-replay.mjs`* gains no section and no subcommand. Task 1 edits `AMEND_FLAGS` and `AMEND_DETAILS` (data); Task 2 edits `armNodeOf` and two lines of `armsCommand`, and adds `spendBudgetInForce` inside the braces of the one existing gate import, in code-unit order; Task 3 edits `nodeAnswersOf`'s settled-record guard and `verifyAbOf`'s family guard. No `FLAG_SPECS` entry is added: `spend-budget` (`'int'`, a positive integer by the grammar) exists for `open --finalize`.
- *`server/test/measure-history.test.ts`* is the gate's own test file (W2-3 put its describes there; there is no `history-gate.test.ts`). Task 1 re-pins two constants in place and nests one describe inside "W2-3 Task 9".
- *`server/test/history-replay.test.ts`* gains appended describes titled `W2-7 Task <N>: …` at the end of the file, after W2-5b2's last block (`b2t2Describe('W2-5b2 Task 2 fix round 2: judgeSpentOf throws a RangeError …')`, which ends the file at the export), and the in-place edits Global Constraints lists.

**Tech Stack:** Node `>=22.16.0` ES modules (`.mjs`), vitest, the existing fixtures: W2-3 Task 9's `draft()`, `final()`, `amendment()`, `verdict()` and `FROZEN` (measure-history.test.ts); W2-5b1's `w5b4Quiz`, `w5b4Home`, `w5b4Arms`, `w5b4Runs`, `w5b4Json`, `w5b4Inp`, `w5b4Pilot`; W2-5b2's `b23Open`, `b23Amend`, `b23RepilotNode`, `b23Step0b`, `b23Fidelity`, `b23Result`, `b23Saved`, `b2t1Home`, `b2t1Pilot`, `b2t1PlantAll`, `b2t1Run`, `b2t2Home`, `b2t2PlantPass`, `b2t2Fidelity`, `b2t2PilotOut`, `b2t2Call`, `b2t2Flags`, `b2t2Deps`, `B2T2_ENV`, `b2t5World`, `b2t5Edit`, `b2t5Report`, `f4Refused`, `fr2Rel`, `stubLog`.

**Spec and authority:** decisions `docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md`: W2-D24 (gate_code), W2-D25 (the open record and its validator, with its amendments), W2-D55 (the limits stop and the spend budget, "The budget in force"), W2-D85 (the report lists every amendment), W2-D90 (amendments to part 2), §4's Part 2 table (`spend_budget`, `amendments`) and §5 acts 17 and 21. The spec, `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, §10.2 ("the budget in force", "Pre-registration"), is not edited here (Residuals). W2-5b1's and W2-5b2's plans (`docs/superpowers/plans/2026-10-22-ccrc-history-w2-5b1-arms-and-judge.md`, `docs/superpowers/plans/2026-10-23-ccrc-history-w2-5b2-pilot-and-verdict.md`) for the conventions copied below.

Every anchor below was read at `cfcdb724f` (#1560, W2-5b2's merge, the last change to all four code and test files of this PR except `deploy/history-gate.mjs` and `server/test/measure-history.test.ts`, last changed by `cd622b2f6`, #1105). A `file:line` is a hint at that commit; every Modify step anchors by quoted content.

---

## Global Constraints

- **One PR, deploy lane, merged and released before act 5's tag is chosen; acts 5 and 6 roll it.** Executed in task order: the plan commit, then one commit per task (Tasks 1 to 4), then Task 5's checks and the PR (a commit only for a corrected prediction). Under the operator's ruling R-B2 the final W2 release is rolled at acts 5 and 6, before step 0a (act 7), and no release is installed from act 6 to act 28: an install there is a `tree-moved`/`code-changed` halt that closes W2 with no verdict, never a re-run. So this PR must merge, its release be cut, and that tag be the one act 5 chooses and acts 5 and 6 roll; acts 7 onward (step 0a, pilot-source, part 1 and every later act) run only on its release. Nothing has run yet (no step 0a, no part 1), so there is nothing to re-run. **The final W2 release becomes the tag cut from this PR's merge** (W2-D6: every W2 PR merges before the final release; the coordinator records the tag and the runbook's "Before act 7" line). Pinned by: the PR body (Task 5 Step 7) and the coordinator; no code.
- **Exactly five files, all modified or added:**
  - `deploy/history-gate.mjs` (Task 1);
  - `deploy/history-replay.mjs` (Tasks 1 to 3);
  - `server/test/measure-history.test.ts` (Task 1; the gate's own test file);
  - `server/test/history-replay.test.ts` (Tasks 1 to 4);
  - this plan, at `docs/superpowers/plans/2026-10-26-ccrc-history-w2-7-budget-raise.md` (its first commit; afterwards only for a corrected prediction or a number issued during the build).
  - No other file of any kind is created (W2-D5). A worker who finds another file unavoidable stops and mails the coordinator.
- **Never touched:** `README.md` (another run holds it), `ccd/**`, `shared/**`, `.github/**`, `deploy/measure-history.py`, `deploy/history-counters.mjs`, the spec, the decisions document, the programme ledger, `CLAUDE.md`, and every other test file (the `single-definition/` directory's files and `single-definition-pin.test.ts`, run together as `vitest run test/single-definition`; `citations.test.ts`, `deviation-refs.test.ts`, `growth-check.test.ts`, `typecheck-tests.test.ts`, `history-cli.test.ts`, `history-lib.test.ts` are re-run, never edited).
- **`deploy/history-gate.mjs` is a `gate_code` file (W2-D24), and editing it is allowed now.** No part 1 exists yet (the brief), so no signed `gate_code` names its old bytes. Its new sha, and `deploy/history-replay.mjs`'s, are what step 0a (act 7) records from the release cut from this merge, and part 1 then signs. Step 0 of Task 1 stops if the brief or the coordinator says act 6 (the fleet box's update intent pinned or off) or act 7 (step 0a) has already run on another tag, or a part 1 sha has been posted: installing this release after act 6 is an R-B2 halt, so the worker stops and the coordinator asks the operator.
- **No gate text spells a driver stop word.** No line of `deploy/history-gate.mjs`, code or comment, may spell `budget-exhausted`, `limits-`, `claude-version-moved`, `tree-moved`, `wrapper-moved`, `version-unmeasured`, `tree-unmeasured` or `wrapper-unmeasured` (`code-changed` and `code-unmeasured` are gate words and stay): measure-history's scan `classifyRun: every answer is a RUN_CLASSES member, and the gate never spells the driver's stop words` reads the gate's whole source, comments included. Task 1 is about the remedy for a `budget-exhausted` stop; the gate's new JSDoc and comments say "the budget in force" and "a spent budget", never the stop's word.
- **The coordinator's rulings on the budget raise (G7), each a constraint and each pinned:**
  1. **It only ever raises.** A raise's `spend_budget` must be strictly greater than the budget in force before it (the signed `spend_budget`, or the newest earlier raise); an equal or lower value refuses `budget-not-raised`. The comparand is only ever a valid figure: when the budget in force before a raise is no safe integer (an earlier raise, or the signed field, already refused for its own defect), the comparison is skipped, so one bad entry answers one word. Pinned by Task 1 (gate rows G-EQ, G-LO, G-2ND, G-VALID; driver rows R-EQ, R-LO, R-2ND; mutants `g-gt`, `g-prefix`, `g-last`, `g-valid`).
  2. **It changes nothing that scores.** The detail is exactly `{spend_budget}` and names no node; the superseding record differs from its predecessor only in `supersedes`, `finalized_ms` and `amendments`, before and after window start; after window start the signed `spend_budget` itself still cannot move (`post-start-change`); `decideGate` and `assembleReports` read no budget and no amendment. Pinned by Task 1 (G-DETAIL, G-NODE, G-POST, G-SCAN, and R-ONLY in both R-OK, after window start, and R-PRE, before it; mutants `g-extra`, `g-node`, `d-detail`).
  3. **One reader.** Every reader of the budget in force reads it through the gate's `spendBudgetInForce`, the one walk of the chain: the validator's raise rule, and the driver's `armNodeOf`, from which arms, judge, step 0b and the quiz fidelity re-pilot take their budget and `armsCommand` its printed and recorded figure. No second walk exists. The two `refuseOutOfRangeValues` lines that range the signed field (`loadFinalRecord`, `openAmend`) are range checks of a record field (D-6309's rule, S2's C22), not budget reads, and stay as they are (Decisions below). Pinned on the driver side by Task 2's scan (T2-SCAN) and its mutants `t2-node`, `t2-print`, `t2-summary`, and on the gate side by Task 1's scan (G-ONE: the validator's comparison goes through `spendBudgetInForce`, and no other gate line selects a raise) and its mutant `g-walk` (a correct inline walk, red only by G-ONE), with `g-prefix`.
  4. **It is recorded like every amendment.** `open --amend` prints the superseding part 2's canonical JSON and `sha256 <hex>` on stderr and writes nothing; the operator saves it 0600 off-repo and posts its sha before the next batch (W2-D90, act 21). The runbook's coordinator duties record each use in the programme ledger. Pinned by Task 1's R-OK (the printed bytes and sha) and, for the ledger, the PR body's coordinator item (no code).
  5. **From part 2 on, never before.** A raise is accepted on any part 2, before window start and during the window. Before part 2 there is nothing to amend: `open --amend` refuses a part 1 as `--record` (`record part "draft", wanted final`), and a part 1 carrying `amendments` is `field-unknown`; `pilot_budget` and the derived budget keep the superseding-draft rules. Pinned by Task 1 (G-PRE, G-OK's before-start half, R-PART1, R-PRE).
- **D-numbers.** This run was issued a contiguous block of five numbers. This plan defines one, **D-7063**, in "## Deviations found", in em-dash form, first cited in Task 1. The others of the block stay unwritten: a departure found while building takes the next unused number of the block named in the brief, defined there by the commit that first cites it. Never write a number that was not issued, and never write a range. Earlier numbers are cited bare and never defined here: D-5813, D-5893, D-6280, D-6309, D-6481. Before the PR: `git fetch origin main`, then `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts`.
- **In-place edits of earlier cases, each named in its commit's second `-m` and in the PR body:**
  - Task 1, `measure-history.test.ts`, W2-3 Task 2's case `each constant and word set has its exact value, frozen, with no repeated member` (about :1066): its `AMENDMENT_KINDS` line (about :1087) and its `GATE_REASONS` literal's last line (about :1096).
  - Task 1, `history-replay.test.ts`, W2-5b2 Task 3's row `'an unknown kind'` in `rows3` (about :11259): its detail gains `, budget-raise`.
  - Task 3, `history-replay.test.ts`, W2-5b2 Task 5 fix round 2's case `an assigned family listed with a state off AB_STATES refuses input-invalid naming its id before --out` (about :24030): its expected detail (A10), and the CONTROL title `'CONTROL: the unedited world, and one whose first question is run-failed in both arms, report'` (about :23946, A13).
  - Task 4, `history-replay.test.ts`, W2-5b2 Task 1 fix round 2's case `step0bCommand refuses a HOME that is unset or not absolute before anything is read, …` (about :23527): its one line `for (const suffix of ['.claude', '/etc/claude', '../up', 'a/../../b']) b2t1Expect(path.isAbsolute(join(path.resolve(home), suffix)), suffix).toBe(true);` (about :23535) (A9).
  - No other earlier case is edited. The gate's two `@type` JSDoc literals follow their values (Task 1).
- **Words.** `GATE_REASONS` gains exactly one word, `budget-not-raised`, appended last (after `version-move-unpiloted`), declared only in the gate (W2-D12) and spelled by the validator once. `AMENDMENT_KINDS` gains `budget-raise`, appended last. `DRIVER_REASONS` gains nothing: `open --amend` answers a validator refusal as `record-invalid` naming `<path> <word>`, as today.
- **Single definition (W2-D12).** One walk of the chain for the budget (`spendBudgetInForce`, in the gate, called once there, by the validator: G-ONE); the driver spells `'budget-raise'` once (its `AMEND_DETAILS` key) and selects nothing by it; one call of `spendBudgetInForce` in the driver (`armNodeOf`).
- **No overloaded null.** A raise's missing figure (`field-missing`), a malformed one (`field-malformed`) and one not above the budget in force (`budget-not-raised`) are three words. `ArmNode.spendBudget` is `null` for the pilot section (no part 2 budget exists there) and the budget in force for the quiz section, never `0`. In `verifyAbOf`, an entry off the assignment, under the wrong arm, and in a state off `AB_STATES` are three details (Task 3).
- **Running tests.** From `server/`: `./node_modules/.bin/vitest run test/<file> -t '<regex>'`, in the foreground, with a timeout of at least 600000 ms, one suite per tool call, never bare `npx vitest`. Each `-t` filter selects at least one test; a run reporting only skipped tests selected nothing and is not green. CLAUDE.md's load flakes are re-run alone before a red is called a break.
- **Red-first, and one mutant per tool call.** Every new guard is watched red on the unguarded code (the prediction written before the run), then each mutant in its task's `json mutants` block is measured red, then restored. Each entry is `{id, file, suite, select, anchor, repl, red}`: `anchor` occurs exactly once in `file` at the task's tip, `repl` replaces it, `suite` and `select` are the vitest file and `-t` regex, and `red` is the predicted failed count, which the worker measures. The runner (Task 5 Step 2 checks every anchor once; the per-mutant procedure is below) saves the file outside the tree, applies one entry, runs its one selection, restores with `cp`, and checks `cmp` and `git diff --exit-code`, which print nothing. After a call that timed out or was cut off, restore with `cp` and `cmp` before anything else. A red at a CONTROL is the fixture's to fix, never the guard's to weaken.

  ```bash
  # one mutant: ID=<id>, from the repository root; read `free -m` first
  S=$(mktemp -d)
  ID=<id> node - <<'EOF' > "$S/m.json"
  const fs = require('node:fs');
  const plan = fs.readFileSync('docs/superpowers/plans/2026-10-26-ccrc-history-w2-7-budget-raise.md', 'utf8');
  const all = [...plan.matchAll(/^```json mutants\n([\s\S]*?)\n```$/gm)].flatMap((b) => JSON.parse(b[1]));
  process.stdout.write(JSON.stringify(all.find((x) => x.id === process.env.ID)));
  EOF
  F=$(node -e "process.stdout.write(require('$S/m.json').file)"); SUITE=$(node -e "process.stdout.write(require('$S/m.json').suite)"); SEL=$(node -e "process.stdout.write(require('$S/m.json').select)")
  cp "$F" "$S/orig"
  M="$S/m.json" node - <<'EOF'
  const fs = require('node:fs');
  const m = JSON.parse(fs.readFileSync(process.env.M, 'utf8'));
  const src = fs.readFileSync(m.file, 'utf8');
  if (src.split(m.anchor).length !== 2) throw new Error(`anchor not once: ${m.id}`);
  fs.writeFileSync(m.file, src.replace(m.anchor, () => m.repl));
  EOF
  (cd server && ./node_modules/.bin/vitest run "test/$SUITE" -t "$SEL" 2>&1 | grep -E '^ +Tests |^ +× ' | cut -c1-200)
  cp "$S/orig" "$F"; cmp "$S/orig" "$F" && git diff --exit-code -- "$F" >/dev/null; echo "restored rc $?"
  ```

  (`git diff --exit-code` compares with the last commit; run it only after the task's code is committed, or replace it with `cmp` alone before the commit. Every mutant is measured before its task's commit, so use `cmp` alone there, and re-run the whole list once against the final tip in Task 5.)
- **Every commit green.** Each task leaves every suite green at its commit, both test files whole included.
- **Fixture assumptions are predictions.** Every count, red figure and fixture assumption below is a prediction the worker measures. If one does not hold, fix the fixture, never the guard, and record measured over predicted in a `docs(plan): … (W2-7 Task <N>)` commit touching only this plan. Scratch goes under `.superpowers/sdd/history-w2-7/` (gitignored), never `git stash`.
- **Citations and growth.** No added code or test line cites `file.mjs:N` or `file.ts:N` (`citations.test.ts`, D-5893); cite symbols. None of the four code and test files is a `growth-check` file.
- **Live safety.** Every test builds its HOME with `mkTmp`; no case reads `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or an account home, or runs `cli.mjs`, `ccd`, `ccrc` or `claude`. The describes that spawn the stub (Task 2's resume, Task 4's colon rows) skip on darwin (`skipIf(process.platform === 'darwin')`), as W2-5b2's stub describes do; pure and in-process describes run everywhere.
- **Commits.** Subjects as "The PR" lists; each message ends with the Co-Authored-By line the session's attribution reminder gives, passed as the last `-m` from `CO_AUTHORED_BY`, set in the same command as its `git commit`. A task that edits an earlier case in place passes one more `-m` between the subject and that line, naming each edit.
- **Public repo.** No host, user, account, wrapper, lane, pool, session or person name, private project name, IP address, absolute home path, private ticket id or docserver URL in plan text, fixtures, comments, commits or the PR body. Task 5 Step 6 counts them over every added line, every commit message, the PR title and body, and this plan; it must print 0.
- **Peers.** Before the first edit of each file, read `GET /api/claims?project=ccrc-pwa`; W2-6 and every earlier W2 deploy PR have merged, so the deploy lane's files should be unclaimed. A claim on any of the five files stops the task.

## Decisions

These are this plan's choices where the scope does not fix one. Each is restated in the PR body.

1. **The kind is `budget-raise`; its detail is `{spend_budget}`; its flag is the existing `--spend-budget`.** A noun phrase like the other three kinds, naming what the amendment does. `--spend-budget` already exists (`FLAG_SPECS`, `'int'`) as `open --finalize`'s echo of the approved figure, so the grammar's positive-integer rule refuses `0`, a sign and a non-number before any input is read; no flag is added.
2. **The one reader lives in the gate** (`spendBudgetInForce(record)`), because the validator needs the budget in force before each raise to hold the raise above it, and the gate imports nothing from the driver; the driver imports it inside its one existing gate import. It reads `amendments ?? []` (as `nodeMovesOf` does), so a record with no amendments answers its signed `spend_budget`.
3. **The comparison is held by the validator, not by `open --amend`.** The raise rule is spelled once; `open --amend` already refuses any validator error as `record-invalid` `<path> <word>`, before printing. Every consumer that loads a part 2 runs the validator (`loadRecordInput`), so a hand-written record with a lowering "raise" is refused everywhere, not only at `open --amend`.
4. **A raise names no node** (`node_label_ref` must be `null`; `--node-label` is not a `budget-raise` flag). The budget is the record's; each node's share is `ceil(budget × n_node / n_all)` (Q5), so one raise moves every node's share.
5. **The validator's words:** the closed detail answers W2-D25's own words (`field-unknown` for another key, `field-missing` for an absent or null figure, `field-malformed` for one that is no safe integer, `value-outside-set` for a node), and one new word, `budget-not-raised`, for a figure at or below the budget in force: W2-D25's "one word per remedy" (the remedy is a higher figure), and no existing word says it. One defect answers one word: a raise is compared only with a budget in force that is a safe integer, so an earlier raise already refused `field-missing` or `field-malformed` (or a malformed signed figure) is not also the comparand of a later raise, which would add a second, misleading `budget-not-raised` (G-VALID).
6. **The signed `spend_budget` stays in the record unchanged and stays range-checked.** `loadFinalRecord` and `openAmend` keep ranging the signed field (D-6309's rule, S2's C22: a record field consumers' assertions would throw on). Ranging the budget in force there instead would be unreachable defence: the validator holds every raise to a safe integer above the in-force budget before it, and the signed field is held positive by the range, so the budget in force is positive and safe by construction, and no mutant could redden a second range. These two lines are the only `.spend_budget` reads left in the driver, pinned by name.
7. **`ArmNode` gains `spendBudget`** (the budget in force; `null` for the pilot section), so `armsCommand`'s stderr line and its summary's `budget.spend_budget` print the figure the share was computed from, without a second call of the reader. For an unamended record every printed byte is as today.
8. **A10: split, not keep.** Four defects shared one detail. The off-assignment detail stays for the two defects it describes (an entry that is no object, and an entry naming no assigned family of this store): both mean "this output does not list this store's assignment". A wrong arm and a state off `AB_STATES` get their own details, because each points the operator at a different remedy (a verify output made under another assignment versus one from another build or a damaged file), and the wrong-arm case had no exact pin (W2-5b2 Task 5's "refused before --out" row checks only the prefix `verify-ab <store> lists `).
9. **A9: replace, not drop.** The row's claim ("persistenceMeasured's configDir … is always absolute") is about the driver; `path.isAbsolute(join(path.resolve(home), suffix))` asserts Node's `path`, which no driver mutant reaches. The replacement asserts the configDir the driver itself builds for step 0b's launch: `admitAccount(...).configDir` over the fixture's roster is `join(home, '.claude')` and absolute, which `admitUpstream`'s `join` produces and mutant `a9` reddens.

## Review Focus

These five inputs follow from the ruling and the carried findings. Each would bite the operator or the eval, and each is pinned by the named task. The reviewer probes beyond the pins.

1. **A budget amendment that lowers, keeps, or smuggles.** Inputs: a raise equal to or below the signed budget; a second raise not above the first; a raise read past a version move or a forced act; a detail with another key, no figure, a null, a string, a fraction, `2^53`; an earlier raise already refused for its own defect, followed by a good one (one word, not two); a raise naming a node; a raise on part 1; a hand-written record with any of these passed to any part 2 consumer. Expected: `budget-not-raised`, `field-unknown`, `field-missing`, `field-malformed`, `value-outside-set`, or `record part "draft", wanted final`, each before anything is printed or spawned. Pinned by **Task 1**.
2. **A reader that spends under the signed budget after a raise, or a second walk.** Inputs: a `budget-exhausted` quiz node resumed on its `--out` under a raised record; `armNodeOf` under one and two raises and under part 1; the arms summary's `budget`; any driver line reading `.spend_budget` outside the two range checks. Expected: the share of the budget in force, printed and recorded as that figure, and exactly one `spendBudgetInForce(` call in the driver. Pinned by **Task 2**.
3. **A raise that moves anything that scores.** Inputs: the printed record against its predecessor before and after window start; an amended final whose signed `spend_budget` also moved; the gate's `decideGate` and `assembleReports` source; the version preflight after a raise. Expected: only `supersedes`, `finalized_ms` and `amendments` move; `post-start-change` for the signed field; no budget or amendment read in the scoring functions; `expectedForNode` unchanged. Pinned by **Tasks 1 and 2**.
4. **A report input that reaches the gate as a throw, or a defect named as another (F1, A10).** Inputs: two answer records of one arm and node with `answer_field.state` swapped under an untouched summary; a verify-ab entry under the wrong arm, with no arm, in a state off `AB_STATES`, both at once. Expected: `input-invalid` "is not a settled answer record" naming the record, before `--out`, never INTERNAL; each verify-ab defect by its own detail, the arm before the state. Pinned by **Task 3**.
5. **An `--out` whose realpath holds `:` past `prepareOut` at W2-5b2's five sites (F2).** Inputs: an `--out` under an ancestor symlink to a directory named with `:` for `step0b`, `fidelity --section pilot`, `pilot-result --section pilot`, `fidelity --section quiz`, `pilot-result --section quiz`. Expected: `args-invalid` `out contains ':'`, no spawn, no result written, never `spawnEnv`'s TypeError. Pinned by **Task 4**.

Beyond the five: `git diff <base> -- server/test/history-replay.test.ts server/test/measure-history.test.ts` shows no removed or changed line outside the in-place edits Global Constraints lists (Task 5 Step 3).

## Files

| Path | Action | Responsibility | Task(s) |
|---|---|---|---|
| `deploy/history-gate.mjs` | modify | `AMENDMENT_KINDS` (+`budget-raise`) and its `@type`; `GATE_REASONS` (+`budget-not-raised`) and its `@type`; `spendBudgetInForce` (new, exported, pure) above `REC_AMEND_FREE`; the validator's amendment loop gains the raise branch and its comment one sentence | 1 |
| `deploy/history-replay.mjs` | modify | Task 1: `AMEND_FLAGS` (+`spend-budget`), `AMEND_DETAILS` (+`budget-raise`) and its JSDoc, `openAmend`'s JSDoc. Task 2: the gate import (+`spendBudgetInForce`), `armNodeOf` (the budget in force, `spendBudget`), `armsCommand`'s stderr and `ctx.budget` lines. Task 3: `nodeAnswersOf`'s settled-record guard and JSDoc, `verifyAbOf`'s family guard and JSDoc | 1, 2, 3 |
| `server/test/measure-history.test.ts` | modify | the constants case's two lines in place; one nested describe `W2-7 Task 1: …` at the end of "W2-3 Task 9" | 1 |
| `server/test/history-replay.test.ts` | modify | the in-place edits above; appended at the file's end, in task order: one import group (`w27`), Task 1's describe, Task 2's two describes, Task 3's two describes, Task 4's describe | 1–4 |
| `docs/superpowers/plans/2026-10-26-ccrc-history-w2-7-budget-raise.md` | add | this plan | plan commit, any |

## Not in this plan

- **The runbook** (the coordinator's, outside the repo): the `budget-exhausted` row of its stop table ("From part 2: … no amendment kind carries a budget … an operator ruling") becomes "`open --amend --kind budget-raise --spend-budget <N>` on the operator's ruling, its sha posted, then the batches resume under the new record"; act 21's amendment list gains the kind and one ordering note: **a pending version-move is written before a raise** (a version-move whose re-pilot has already run under the record in force is appended first, then the raise), because a raise appended between a re-pilot and its version-move changes the record's sha, so `open --amend --kind version-move` refuses `input-invalid` `repilot record-mismatch: re-piloted under <A>, amending <B>` and prints nothing, and the re-pilot (step 0b, fidelity, pilot-result), which spends under the node's share, must run again; a raise owed before any re-pilot has run (for instance because the re-pilot itself stopped on a spent budget) is written first, and the re-pilot then runs under the raised record (Residuals); the coordinator duties record each use in the ledger; "Before act 7" names the new final release.
- **The decisions document** (W2-D55's "From part 2", W2-D90's chosen set, §4's Part 2 table) and **the spec** (§10.2's "budget in force" sentence and "Pre-registration"'s list of amendment kinds): amended in place by whoever the coordinator assigns, citing D-7063 (Residuals).
- **README** (another run holds it): its driver paragraph's sentence "`open --amend` after a version move, a freeze exception or a forced act" gains the raise.
- **A raise of `pilot_budget`.** Before part 2, the pilot budget and the derived budget follow the superseding-draft rules (ruling 5).

## The PR

**Commits**, in order, each green:
0. `docs(plan): ccrc history W2-7, the budget raise and W2-5b2's carried follow-ups (W2-7; R-B1, CP-27; D-7063)`
1. `feat(history): budget-raise, the amendment that raises the spend budget in force, and the gate's one reader of it (W2-7 Task 1; R-B1; W2-D90, W2-D55, W2-D25; D-7063)`
2. `feat(history-replay): every reader spends under the budget in force, so a budget-exhausted node resumes under a raise (W2-7 Task 2; R-B1; W2-D55, Q5; D-7063)`
3. `fix(history-replay): report refuses a correct record not answered by value, and names verify-ab's defects apart (W2-7 Task 3; CP-27 F1, A10, A13)`
4. `test(history-replay): the realpath colon check at W2-5b2's five call sites, and step 0b's HOME row pinned on the driver (W2-7 Task 4; CP-27 F2, A9; D-5813)`

**Order.** Task 1 first (the kind and the reader); Task 2 needs Task 1's reader; Tasks 3 and 4 are independent of Part A and of each other, run after it so Part A can be reviewed first if the coordinator splits the review. Task 5 last.

**CI.** No `.github/` file changes, so CI runs its selection. The PR body asks the coordinator to check that the `select tests` summary lists `history-replay` and `measure-history` (the gate's test file), and that `typecheck-tests` ran.

**Opening it.** Task 5 Step 8 opens the PR, ready for review, titled **"ccrc history wave W2-7: the budget raise and W2-5b2's carried follow-ups"**, with the body Step 7 gives.

---

### Task 1: `budget-raise`, the amendment that raises the spend budget in force, the validator's rules for it, and the gate's one reader (W2-D90, W2-D25, W2-D55; R-B1; D-7063)

The operator's ruling R-B1 asks for an amendment that raises the spend budget after part 2. This task adds the kind to the gate's closed set, the reader every later consumer calls, the validator's rules (it only raises; it carries nothing else), and the driver's detail schema, so `open --amend` writes it through the chain the three existing kinds use: `loadFinalRecord` first (W2-D24's re-check before any other input), then the amendment appended by `amendedFinal`, then `validateOpenRecord` against part 1, the frozen list and the record it supersedes, then the part 2 ranges, then the printed record and its sha.

**Decisions:** W2-D90 (amendments to part 2; its chosen set gains `budget-raise`, D-7063), W2-D25 (the validator is closed, chained and one word per remedy; a new word, `budget-not-raised`), W2-D55 ("The budget in force": from part 2, the signed `spend_budget` or the newest raise, D-7063), W2-D12 (one walk). It defines **D-7063**.

**Files:**
- Modify `deploy/history-gate.mjs`:
  - (a) `AMENDMENT_KINDS` (:138-140): the JSDoc's first line ` *  The kinds an amendment to part 2 may carry (W2-D90, chosen set).` gains the sentence `` `budget-raise` added by W2-7 under the operator's ruling R-B1 (D-7063). ``; its `@type` line becomes `@type {readonly ['version-move', 'freeze-exception', 'forced-act', 'budget-raise']}`; the value line becomes `export const AMENDMENT_KINDS = Object.freeze(['version-move', 'freeze-exception', 'forced-act', 'budget-raise']);`.
  - (b) `GATE_REASONS` (:148-166): in the `@type` literal (:153) and in the value's last line `  'amendment-kind', 'amendment-detail-mismatch', 'version-move-unpiloted',` (:165), `'budget-not-raised'` is appended after `'version-move-unpiloted'`.
  - (c) `spendBudgetInForce`, inserted directly above the line `/** What W2-D90 leaves free after window start: everything but these three is frozen. */` (:2312).
  - (d) The validator's amendment loop (:2562-2568): the comment line `  // Amendments (W2-D90): a closed kind set, a version move carries its re-pilot sha, and every detail_sha256 is` is reworded to name the raise, and one `else if` branch is added directly after the line `    else if (a.kind === 'version-move' && !REC_TYPE_OK.hex64(a.detail.repilot_sha256)) refuse(`amendments[${i}].detail.repilot_sha256`, 'version-move-unpiloted');`.
- Modify `deploy/history-replay.mjs`:
  - (e) `AMEND_FLAGS` (:5207): `'spend-budget'` appended last; its JSDoc unchanged.
  - (f) `AMEND_DETAILS` (:8771-8783): its JSDoc gains `budget-raise {spend_budget}, its node refused (W2-7, D-7063)`; one entry added after the `'forced-act'` entry.
  - (g) `openAmend`'s JSDoc (:9160-9168) gains one sentence: a `budget-raise` is held above the budget in force by the validator (`budget-not-raised`), never by a second comparison here.
- Modify `server/test/measure-history.test.ts`:
  - In place: the constants case (about :1087 and :1096).
  - One nested describe, `describe('W2-7 Task 1: the budget-raise amendment and the budget in force (R-B1, D-7063)', …)`, inserted inside `describe('W2-3 Task 9: the counter definitions and the open record', …)`, directly before that describe's closing `});`, which is the line directly above the blank line and the comment `// ── W2-1 Task 2: the gate reads lib's names, and the instrument's prefix is lib's (W2-D17, W2-D23, W2-D11) ─────────` (about :5811). It reuses Task 9's `draft`, `final`, `amendment`, `verdict`, `FROZEN`, `hex`, `T0`, `DAY` and `gate9`.
- Modify `server/test/history-replay.test.ts`:
  - In place: `rows3`'s `'an unknown kind'` row (about :11259).
  - Appended at the end of the file: the import group `import { describe as w27Describe, expect as w27Expect, it as w27It } from 'vitest';` and `import { renameSync as w27Rename } from 'node:fs';` (Task 4 uses the second), then `w27Describe('W2-7 Task 1: open --amend --kind budget-raise appends one raise of the spend budget, and refuses one that does not raise (R-B1, D-7063)', …)`.

**Interfaces:**
- Consumes: the gate's `validateOpenRecord(record, ctx)`, `recordSha256(record)`, `REC_TYPE_OK.integer` (`Number.isSafeInteger`), `recRefusals()`'s `refuse(path, word)` (throws on a word outside `GATE_REASONS`); the driver's `openAmend(flags, driverEnv, deps)` chain (`checkFlags`, `AMEND_FLAGS`, `AMEND_DETAILS[kind].required/optional/detail`, `amendmentOf`, `amendedFinal`, `loadFinalRecord`, `printWithSha`); `parseArgs`' `'int'` grammar (`--<flag> wants a positive integer, got "<text>"`).
- Produces:
  - `export const AMENDMENT_KINDS: readonly ['version-move', 'freeze-exception', 'forced-act', 'budget-raise']` (gate).
  - `GATE_REASONS`' last word `'budget-not-raised'` (gate).
  - `export function spendBudgetInForce(record: { spend_budget: unknown, amendments?: ReadonlyArray<{ kind: unknown, detail: any }> }): unknown` (gate, pure): the `detail.spend_budget` of the last amendment whose `kind` is `'budget-raise'`, in array order, else `record.spend_budget`. It validates nothing.
  - The validator, for each amendment `i` whose `kind` is `'budget-raise'`, in this order: `node_label_ref !== null` refuses `amendments[i].node_label_ref` `value-outside-set`; each detail key other than `spend_budget` refuses `amendments[i].detail.<key>` `field-unknown`; an absent or null `spend_budget` refuses `amendments[i].detail.spend_budget` `field-missing`; one that is no safe integer refuses it `field-malformed`; otherwise, with `before = spendBudgetInForce({ spend_budget: r.spend_budget, amendments: r.amendments.slice(0, i) })`, one not strictly greater than `before` refuses it `budget-not-raised`, and only when `before` is itself a safe integer: a `before` that is not (the newest earlier raise, or the signed field, already refused for its own defect) is no comparand, and the comparison is skipped (one defect, one word, Decision 5).
  - `AMEND_FLAGS` ends `…, 'act', 'act-ms', 'spend-budget']`; `AMEND_DETAILS['budget-raise'] = { required: ['spend-budget'], optional: [], detail: (flags) => ({ spend_budget: flags['spend-budget'] }) }`, every list frozen as the other entries are.

- [ ] **Step 0: Check the base and the peers.** From the repository root: `git fetch origin main && git log -1 --format='%h %s' origin/main`; `git log -1 --format=%h origin/main -- deploy/history-replay.mjs deploy/history-gate.mjs server/test/history-replay.test.ts server/test/measure-history.test.ts` names `cfcdb724f` or a later commit whose diff the worker reads before proceeding; `GET /api/claims?project=ccrc-pwa` shows no claim on the five files; the brief says acts 5 to 7 have not run (no tag chosen at act 5, no update intent pinned or set off at act 6, no step 0a at act 7) and no part 1 exists. Expected: all hold; otherwise stop and mail the coordinator: if act 6 or act 7 has already run on another tag, installing this PR's release would be an R-B2 halt (`tree-moved`), so the coordinator asks the operator, and nothing is re-run. Count the anchors, each expected `1`:

  ```bash
  F=deploy/history-replay.mjs G=deploy/history-gate.mjs
  grep -c "export const AMENDMENT_KINDS = Object.freeze(\['version-move', 'freeze-exception', 'forced-act'\]);" $G
  grep -c "'amendment-kind', 'amendment-detail-mismatch', 'version-move-unpiloted',$" $G
  grep -c "^/\*\* What W2-D90 leaves free after window start" $G
  grep -c "else if (a.kind === 'version-move' && !REC_TYPE_OK.hex64(a.detail.repilot_sha256))" $G
  grep -c "^export const AMEND_FLAGS = Object.freeze(\[" $F
  grep -c "^  'forced-act': Object.freeze({ required: Object.freeze(\['act', 'act-ms'\])" $F
  grep -c "^  'spend-budget': 'int'," $F
  grep -c "spendBudgetInForce\|budget-raise\|budget-not-raised" $F $G   # expected 0 and 0
  ```

- [ ] **Step 1: Write the failing gate tests.** In `server/test/measure-history.test.ts`:
  - (i) In place, in `each constant and word set has its exact value, frozen, with no repeated member`: `AMENDMENT_KINDS: ['version-move', 'freeze-exception', 'forced-act'],` becomes `AMENDMENT_KINDS: ['version-move', 'freeze-exception', 'forced-act', 'budget-raise'],`, and the `GATE_REASONS` literal's line `'amendment-kind', 'amendment-detail-mismatch', 'version-move-unpiloted',` becomes `'amendment-kind', 'amendment-detail-mismatch', 'version-move-unpiloted', 'budget-not-raised',`.
  - (ii) The nested describe. Its local helpers, each built per call (never at collection):
    - `const f1 = (): Rec => final();` (signed `spend_budget` 30,000,000; `finalized_ms` `T0 - DAY`; window from `T0`);
    - `const raise = (n: unknown, node: string | null = null, at = T0 + DAY): Rec => amendment('budget-raise', node, at, { spend_budget: n });`
    - `const raiseWith = (detail: Rec): Rec => amendment('budget-raise', null, T0 + DAY, detail);`
    - `const amendOver = (pred: Rec, added: Rec[], at = T0 + 2 * DAY): Rec => ({ ...structuredClone(pred), supersedes: gate9.recordSha256(pred), finalized_ms: at, amendments: [...pred.amendments, ...added] });`
    - `const ctxOver = (pred: Rec): Ctx => ({ draft: draft(), predecessor: pred, frozen: FROZEN });`
    - `const at = (i: number, tail: string, word: string): Err => ({ path: `amendments[${i}].${tail}`, word });`
  
    Its cases (ids are this plan's; each case title begins with its id):
    - **G-READ** `G-READ: spendBudgetInForce answers the newest budget-raise in array order, read past every other kind, else the signed spend_budget`: `gate9.spendBudgetInForce({ spend_budget: 5, amendments: [] })` is `5`; `({ spend_budget: 5 })` is `5`; with `[raise(7)]` `7`; with `[raise(7), amendment('forced-act', null, T0, { act: 'reparse', at_ms: T0 }), raise(9)]` `9`; with `[raise(9), raise(7)]` `7` (the last, not the largest: the validator, not the reader, refuses the second); with `[amendment('version-move', 'node-a', T0, { claude_code_version: '9.2.0', repilot_sha256: hex('rp'), spend_budget: 99 })]` `5` (another kind's detail is never read).
    - **G-OK** `G-OK: a raise above the budget in force is appended, after window start and before it`: `verdict(amendOver(f1(), [raise(30_000_001)]), ctxOver(f1()))` is `[]`; at `T0 - DAY / 2` (before window start, after `finalized_ms`), `[]`; `gate9.spendBudgetInForce` of the first is `30_000_001` and its `spend_budget` is still `30_000_000`.
    - **G-EQ** `G-EQ: a raise equal to the budget in force is budget-not-raised`: `[raise(30_000_000)]` gives `[at(0, 'detail.spend_budget', 'budget-not-raised')]`.
    - **G-LO** `G-LO: a raise below it is budget-not-raised`: `[raise(29_999_999)]` and `[raise(1)]` each give the same one error.
    - **G-2ND** `G-2ND: a second raise is held above the first, not above the signed budget`: `const p = amendOver(f1(), [raise(40_000_000)]);` then `verdict(amendOver(p, [raise(35_000_000)], T0 + 3 * DAY), ctxOver(p))` is `[at(1, 'detail.spend_budget', 'budget-not-raised')]`, the same for `40_000_000`, and `[]` for `40_000_001`.
    - **G-PAST** `G-PAST: a raise after a forced act is read past it`: `[amendment('forced-act', 'node-a', T0 + DAY, { act: 'reparse' }), raise(30_000_001)]` gives `[]`.
    - **G-DETAIL** `G-DETAIL: the detail carries the figure and nothing else`, rows `[detail, errors]`: `{ spend_budget: 40_000_000, quiz: 1 }` → `[at(0, 'detail.quiz', 'field-unknown')]`; `{}` → `[at(0, 'detail.spend_budget', 'field-missing')]`; `{ spend_budget: null }` → the same; `{ spend_budget: '40000000' }` → `[at(0, 'detail.spend_budget', 'field-malformed')]`; `{ spend_budget: 40_000_000.5 }` → the same; `{ spend_budget: 2 ** 53 }` → the same; `{ spend_budget: -1 }` → `[at(0, 'detail.spend_budget', 'budget-not-raised')]` (a safe integer, not above).
    - **G-VALID** `G-VALID: a raise is compared only with a valid earlier figure: an earlier raise refused for its own defect answers one word, not a second budget-not-raised`: each of `verdict(amendOver(f1(), [raise('40000000'), raise(40_000_001)]), ctxOver(f1()))`, `[raise(2 ** 53), raise(40_000_000)]` and `[raise('abc'), raise(40_000_000)]` (each over `f1()` the same way) is exactly `[at(0, 'detail.spend_budget', 'field-malformed')]`. One case, three assertions. The first chain is the review's own example; it cannot redden `g-valid` (`40_000_001 > '40000000'` is true once coerced), so the other two carry the mutant: `40_000_000 > 2 ** 53` and `40_000_000 > 'abc'` are false, and without the guard each adds `at(1, 'detail.spend_budget', 'budget-not-raised')`.
    - **G-NODE** `G-NODE: a raise names no node: the budget is the record's`: `[raise(40_000_000, 'node-a')]` gives `[at(0, 'node_label_ref', 'value-outside-set')]`.
    - **G-POST** `G-POST: after window start the signed spend_budget cannot move: only an appended raise moves the budget in force`: `{ ...amendOver(f1(), [raise(50_000_000)]), spend_budget: 40_000_000 }` gives `[{ path: 'spend_budget', word: 'post-start-change' }]` (the raise, 50,000,000, is above the edited signed figure, so the one error is the post-start rule's).
    - **G-PRE** `G-PRE: part 1 carries no amendments, so no raise exists before part 2`: `verdict({ ...draft(), amendments: [] })` is `[{ path: 'amendments', word: 'field-unknown' }]`.
    - **G-SCAN** `G-SCAN: decideGate and assembleReports read no budget and no amendment`: from `readFileSync(path.join(ROOT, 'deploy', 'history-gate.mjs'), 'utf8')`, each of `export function decideGate(inputs) {` and `export function assembleReports(reports, record, opts = {}) {` sliced to its first following `'\n}\n'` contains none of `spend_budget`, `amendments`, `budget-raise`; CONTROL: the slice of `function recValidate(record, ctx, checkLink) {` contains all three (at the base it holds `amendments` only, so this case is red until Step 4: Step 3).
    - **G-ONE** `G-ONE: the gate walks the chain for the budget once: the validator compares through spendBudgetInForce, and no other gate line selects a raise`: over `readFileSync(path.join(ROOT, 'deploy', 'history-gate.mjs'), 'utf8').split('\n')` with comment lines dropped (`!/^\s*(\*|\/\/|\/\*)/.test(l)`, T2-SCAN's filter): the lines containing `spendBudgetInForce(` are exactly two, the first containing `export function spendBudgetInForce(record) {` and the second `const before = spendBudgetInForce(`; the lines containing `'budget-raise'` are exactly three, containing in file order `export const AMENDMENT_KINDS = `, `for (const a of record.amendments ?? [])` (the reader) and `else if (a.kind === 'budget-raise') {` (the validator branch). A second walk inlined anywhere in the gate (mutant `g-walk`) changes both counts, though every behaviour row stays green.

- [ ] **Step 2: Write the failing driver tests.** In `server/test/history-replay.test.ts`:
  - (i) In place, `rows3`' row `['an unknown kind', …]`: its want becomes `['args-invalid', 'kind "version-bump" is not one of version-move, freeze-exception, forced-act, budget-raise']`.
  - (ii) Append the import group (Files above), then the describe. Its helpers:
    - `const w27Raise = (fx: W5b4R, rec: W5b4Saved, pred: W5b4Saved | null, figure: string | null, extra: string[] = []): string[] => ['open', '--amend', '--kind', 'budget-raise', ...(figure === null ? [] : ['--spend-budget', figure]), ...extra, ...w5b4Inp('record', rec), ...(pred === null ? [] : w5b4Inp('supersedes', pred)), ...w5b4Inp('part1', fx.d as W5b4Saved), ...w5b4Inp('frozen', fx.fz as W5b4Saved)];`
    - each case builds `const fx = w5b4Quiz(w5b4Home());` (signed `spend_budget` 1,000,000; window from `W5B4_T0 + W5B4_DAY`; `B23_NOW` after it).
  
    Its cases:
    - **R-SPEC** `R-SPEC: AMEND_DETAILS' budget-raise requires --spend-budget alone and builds {spend_budget}`: `D4.AMEND_DETAILS['budget-raise'].required` is `['spend-budget']`, `.optional` is `[]`, `.detail({ 'spend-budget': 7 }, null)` is `{ spend_budget: 7 }`; `D4.AMEND_FLAGS.at(-1)` is `'spend-budget'`; `D4.FLAG_SPECS['spend-budget']` is `'int'`.
    - **R-OK** `R-OK: a raise prints part 2 superseding the record, one budget-raise appended with no node, its sha on stderr; only supersedes, finalized_ms and amendments move, and the version preflight is unchanged`: `const r = await b23Open(w27Raise(fx, fx.f, null, '1500000'));` `r.refusal` null, `r.code` 0; `const rec = JSON.parse(r.stdout)`; `r.stdout` is `` `${w5b4Lib.canonicalJson(rec)}\n` ``; `r.stderr` is `` `sha256 ${w5b4Gate.recordSha256(rec)}\n` ``; `rec.amendments` equals `[{ kind: 'budget-raise', node_label_ref: null, at_ms: B23_NOW, detail_sha256: w5b4Lib.sha256Hex(w5b4Lib.canonicalJson({ spend_budget: 1_500_000 })), detail: { spend_budget: 1_500_000 } }]`; `[rec.supersedes, rec.finalized_ms]` is `[fx.f.sha, B23_NOW]`; `canonicalJson({ ...rec, supersedes: fx.final.supersedes, finalized_ms: fx.final.finalized_ms, amendments: fx.final.amendments })` equals `canonicalJson(fx.final)` (**R-ONLY**); `w5b4Gate.spendBudgetInForce(rec)` is `1_500_000` and `rec.spend_budget` is `1_000_000`; `D4.expectedForNode(rec, W5B4_STORE_A).from` is `'step0a'`.
    - **R-PRE** `R-PRE: before window start a raise is appended the same way (part 2 exists), and only supersedes, finalized_ms and amendments move`: `const r = await b23Open(w27Raise(fx, fx.f, null, '1500000'), W5B4_T0 + W5B4_DAY / 2);` refusal null; `const rec = JSON.parse(r.stdout)`; one amendment, its `at_ms` `W5B4_T0 + W5B4_DAY / 2`; R-OK's canonical equality, `canonicalJson({ ...rec, supersedes: fx.final.supersedes, finalized_ms: fx.final.finalized_ms, amendments: fx.final.amendments })` equals `canonicalJson(fx.final)` (**R-ONLY**, before window start, where the validator's `post-start-change` rule is not in force, so `open --amend`'s output is the only guarantee of ruling 2's pre-window half); `w5b4Gate.spendBudgetInForce(rec)` is `1_500_000` and `rec.spend_budget` is `1_000_000`.
    - **R-2ND** `R-2ND: a second raise is read beside the first: equal to it refuses, above it appends after it byte for byte`: `const a1 = await b23Amend(fx, fx.f, null, ['--kind', 'budget-raise', '--spend-budget', '1500000']);` then `b23Open(w27Raise(fx, a1, fx.f, '1500000'), B23_NOW + 1000)` refuses `{ word: 'record-invalid', detail: 'amendments[1].detail.spend_budget budget-not-raised' }` with stdout `''`; with `'2000000'` it prints a record whose `amendments[0]` is canonically `a1.value.amendments[0]` and whose budget in force is `2_000_000`.
    - **R-ROWS** `w27It.each(rows)('R-ROWS: open --amend --kind budget-raise refuses, printing nothing: %s', …)`, each `[why, argv, word, detail]`, asserting `r.refusal` equals `{ word, detail }` and `r.stdout` is `''` (each row's figure is `'2000000'` unless it names another):
      - R-EQ `a raise equal to the signed budget`: figure `'1000000'` → `record-invalid`, `amendments[0].detail.spend_budget budget-not-raised`;
      - R-LO `a raise below it`: `'999999'` → the same;
      - `no figure`: figure null → `args-invalid`, `spend-budget-required`;
      - `a zero`: `'0'` → `args-invalid`, `--spend-budget wants a positive integer, got "0"`;
      - `a node`: extra `['--node-label', 'node-0']` → `args-invalid`, `--node-label is not a budget-raise flag`;
      - `another kind's flag`: extra `['--act', 'reparse']` → `args-invalid`, `--act is not a budget-raise flag`;
      - `a figure on another kind`: `['open', '--amend', '--kind', 'forced-act', '--act', 'reparse', '--act-ms', String(B23_NOW - 1), '--spend-budget', '2000000', …the four inputs]` → `args-invalid`, `--spend-budget is not a forced-act flag`;
      - R-PART1 `part 1 given as the record`: `['open', '--amend', '--kind', 'budget-raise', '--spend-budget', '2000000', ...w5b4Inp('record', fx.d), ...w5b4Inp('part1', fx.d), ...w5b4Inp('frozen', fx.fz)]` → `record-invalid`, `record part "draft", wanted final`;
      - `--allow-code-change`: extra `['--allow-code-change']` → `args-invalid`, `--allow-code-change is not a open --amend flag`.

- [ ] **Step 3: Run them and see them fail (predicted).** In the foreground, timeout at least 600000 ms, one suite per call:

  ```bash
  (cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-7 Task 1|each constant and word set has its exact value')
  (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-7 Task 1|open --amend refuses, printing nothing: an unknown kind')
  ```

  Predicted: the gate run fails the constants case, G-READ (a TypeError: no `spendBudgetInForce`), G-OK, G-EQ, G-LO, G-2ND, G-PAST, every G-DETAIL row, G-VALID, G-NODE and G-POST (each answers `amendment-kind`, G-POST beside its `post-start-change`), G-ONE (no line calls `spendBudgetInForce(` and none spells `'budget-raise'`), and G-SCAN, by its CONTROL half only (measured at the base: the `recValidate` slice holds `amendments` but neither `spend_budget` nor `budget-raise`; the `decideGate` and `assembleReports` halves pass, and Step 4's branch makes the CONTROL hold, so this red is the prediction, never a fixture to weaken); G-PRE passes, because it pins behaviour the base already has (no new guard: a part 1 has no `amendments` field). The driver run fails R-SPEC, R-OK, R-PRE, R-2ND, the in-place `an unknown kind` row, and every R-ROWS row but `a zero` (the grammar refuses `0` before anything else, as it will after): each row carrying `--spend-budget` answers `--spend-budget is not a open --amend flag` from `checkFlags`, and `no figure` answers `kind "budget-raise" is not one of version-move, freeze-exception, forced-act`. Record the measured counts in the commit's task note.

- [ ] **Step 4: Edit the gate.** In `deploy/history-gate.mjs`:
  - (a) and (b) as Files gives.
  - (c) Insert directly above `/** What W2-D90 leaves free after window start: everything but these three is frozen. */`:

    ```js
    /** W2-D55 as D-7063 amends it (W2-7, the operator's ruling R-B1): the spend budget in force on a part 2, the newest
     *  `budget-raise` amendment's `detail.spend_budget` in array order (amendments only append, W2-D90), else the signed
     *  `spend_budget`. The one walk of the chain for the budget (W2-D12): the validator holds each raise above it, and the
     *  driver's armNodeOf spends under it. It ranges nothing: the validator does, before any consumer reads it. Pure.
     *  @param {{spend_budget: unknown, amendments?: ReadonlyArray<{kind: unknown, detail: any}>}} record  @returns {unknown} */
    export function spendBudgetInForce(record) {
      let inForce = record.spend_budget;
      for (const a of record.amendments ?? []) if (a.kind === 'budget-raise') inForce = a.detail.spend_budget;
      return inForce;
    }
    ```
  - (d) The loop's comment becomes `  // Amendments (W2-D90): a closed kind set, a version move carries its re-pilot sha, a budget raise carries one figure`, `  // above the budget in force before it and names no node (D-7063), and every detail_sha256 is recomputed from its`, `  // detail (W2-D25, amended 2026-10-19).` The branch, directly after the `version-move` line (the mutants anchor on these lines, so write them as given):

    ```js
        else if (a.kind === 'budget-raise') {   // W2-7 (R-B1, D-7063): it only raises, and carries nothing that scores
          if (a.node_label_ref !== null) refuse(`amendments[${i}].node_label_ref`, 'value-outside-set');
          for (const k of Object.keys(a.detail)) if (k !== 'spend_budget') refuse(`amendments[${i}].detail.${k}`, 'field-unknown');
          const raised = a.detail.spend_budget;
          const before = spendBudgetInForce({ spend_budget: r.spend_budget, amendments: r.amendments.slice(0, i) });
          if (raised === undefined || raised === null) refuse(`amendments[${i}].detail.spend_budget`, 'field-missing');
          else if (!REC_TYPE_OK.integer(raised)) refuse(`amendments[${i}].detail.spend_budget`, 'field-malformed');
          // a figure before it that is no safe integer was refused where it stands, so it is no comparand: one defect, one word
          else if (REC_TYPE_OK.integer(before) && !(raised > before)) refuse(`amendments[${i}].detail.spend_budget`, 'budget-not-raised');
        }
    ```

    No line of this step, code or comment, spells a driver stop word (Global Constraints: measure-history's `classifyRun: … the gate never spells the driver's stop words` scan reads comments too). The reader's JSDoc, the loop's comment and the branch above already avoid them, so write them as given.

- [ ] **Step 5: Edit the driver.** In `deploy/history-replay.mjs`: (e) `AMEND_FLAGS`' value ends `'act', 'act-ms', 'spend-budget']);`; (f) after the `'forced-act'` entry of `AMEND_DETAILS` (its closing line `    detail: (flags) => ({ act: flags.act, at_ms: flags['act-ms'] }) }),`), insert

  ```js
    'budget-raise': Object.freeze({ required: Object.freeze(['spend-budget']), optional: Object.freeze([]),
      detail: (flags) => ({ spend_budget: flags['spend-budget'] }) }),
  ```
  and the two JSDoc sentences (f), (g).

- [ ] **Step 6: Run them and see them pass, then the typecheck.** The two commands of Step 3, then `(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)`. Expected: green; a red on a `gate9.*` or `D4.*` call is fixed with a cast at the call site, never by loosening the module's JSDoc.

- [ ] **Step 7: Measure every guard red, then green.** One mutant per call (Global Constraints' procedure, `cmp` alone before the commit). Every gate anchor below exists only after Step 4 (and the `d-*` anchors only after Step 5); each was checked to occur exactly once in the base gate with Step 4's text applied as given. Predicted reds:

```json mutants
[
  {"id":"g-kind","file":"deploy/history-gate.mjs","suite":"measure-history.test.ts","select":"W2-7 Task 1","anchor":"export const AMENDMENT_KINDS = Object.freeze(['version-move', 'freeze-exception', 'forced-act', 'budget-raise']);","repl":"export const AMENDMENT_KINDS = Object.freeze(['version-move', 'freeze-exception', 'forced-act']);","red":"16"},
  {"id":"g-gt","file":"deploy/history-gate.mjs","suite":"measure-history.test.ts","select":"W2-7 Task 1","anchor":"!(raised > before)","repl":"!(raised >= before)","red":"2"},
  {"id":"g-prefix","file":"deploy/history-gate.mjs","suite":"measure-history.test.ts","select":"W2-7 Task 1","anchor":"spendBudgetInForce({ spend_budget: r.spend_budget, amendments: r.amendments.slice(0, i) })","repl":"r.spend_budget","red":"2"},
  {"id":"g-last","file":"deploy/history-gate.mjs","suite":"measure-history.test.ts","select":"W2-7 Task 1","anchor":"if (a.kind === 'budget-raise') inForce = a.detail.spend_budget;","repl":"if (a.kind === 'budget-raise' && inForce === record.spend_budget) inForce = a.detail.spend_budget;","red":"1"},
  {"id":"g-node","file":"deploy/history-gate.mjs","suite":"measure-history.test.ts","select":"W2-7 Task 1","anchor":"if (a.node_label_ref !== null) refuse(`amendments[${i}].node_label_ref`, 'value-outside-set');","repl":"if (false) refuse(`amendments[${i}].node_label_ref`, 'value-outside-set');","red":"1"},
  {"id":"g-extra","file":"deploy/history-gate.mjs","suite":"measure-history.test.ts","select":"W2-7 Task 1","anchor":"if (k !== 'spend_budget') refuse(","repl":"if (false) refuse(","red":"1"},
  {"id":"g-missing","file":"deploy/history-gate.mjs","suite":"measure-history.test.ts","select":"W2-7 Task 1","anchor":"if (raised === undefined || raised === null) refuse(","repl":"if (false) refuse(","red":"2"},
  {"id":"g-int","file":"deploy/history-gate.mjs","suite":"measure-history.test.ts","select":"W2-7 Task 1","anchor":"else if (!REC_TYPE_OK.integer(raised)) refuse(","repl":"else if (false) refuse(","red":"4"},
  {"id":"g-valid","file":"deploy/history-gate.mjs","suite":"measure-history.test.ts","select":"W2-7 Task 1","anchor":"else if (REC_TYPE_OK.integer(before) && !(raised > before)) refuse(","repl":"else if (!(raised > before)) refuse(","red":"1"},
  {"id":"g-walk","file":"deploy/history-gate.mjs","suite":"measure-history.test.ts","select":"W2-7 Task 1","anchor":"const before = spendBudgetInForce({ spend_budget: r.spend_budget, amendments: r.amendments.slice(0, i) });","repl":"const before = r.amendments.slice(0, i).reduce((v, p) => (p.kind === 'budget-raise' ? p.detail.spend_budget : v), r.spend_budget);","red":"1"},
  {"id":"g-word","file":"deploy/history-gate.mjs","suite":"measure-history.test.ts","select":"W2-7 Task 1","anchor":"'amendment-kind', 'amendment-detail-mismatch', 'version-move-unpiloted', 'budget-not-raised',","repl":"'amendment-kind', 'amendment-detail-mismatch', 'version-move-unpiloted',","red":"4"},
  {"id":"d-detail","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 1","anchor":"detail: (flags) => ({ spend_budget: flags['spend-budget'] }) }),","repl":"detail: (flags) => ({ spend_budget: flags['spend-budget'], node: null }) }),","red":"6"},
  {"id":"d-flag","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 1","anchor":"'act', 'act-ms', 'spend-budget']);","repl":"'act', 'act-ms']);","red":"11"}
]
```

  Notes on the predictions: `g-kind` reds every case that answers `[]` or a raise word, since each answers `amendment-kind` and skips the raise branch (G-OK, G-EQ, G-LO, G-2ND, G-PAST, G-DETAIL's seven rows, G-VALID, G-NODE, G-POST: 15), and G-ONE (the `AMENDMENT_KINDS` line no longer spells `'budget-raise'`): 16, while G-READ stays green (the reader selects by the word, not by the set); `g-gt` reds G-EQ and G-2ND (its equal figure); `g-prefix` reds G-2ND (35,000,000 is above the signed 30,000,000) and G-ONE (the validator no longer calls `spendBudgetInForce(`): 2; `g-last` reds G-READ (`[raise(9), raise(7)]` answers 9, and the three-entry chain answers 7); `g-missing` reds G-DETAIL's `{}` and null rows (they fall to `field-malformed`); `g-int` reds G-DETAIL's string, fraction and `2 ** 53` rows (each compares above the signed 30,000,000, the string once coerced, so nothing is refused and each row answers `[]`) and G-VALID (its first chain's string index 0 is no longer refused, and index 1 skips its non-integer comparand, so it answers `[]`): 4; `g-valid` reds G-VALID (its `2 ** 53` and `'abc'` chains each add `at(1, 'detail.spend_budget', 'budget-not-raised')`; its first chain stays one error, since `40_000_001 > '40000000'` once coerced), one case: 1; `g-walk` inlines a correct second walk, so every behaviour row stays green and only G-ONE reds (`spendBudgetInForce(` on one line, `'budget-raise'` on four): 1; `g-word` makes `refuse` throw on a word outside `GATE_REASONS`, so every case that reaches `budget-not-raised` throws (G-EQ, G-LO, G-2ND, G-DETAIL's `-1` row); `d-detail` reds R-SPEC, R-OK, R-PRE, R-2ND (the validator answers `field-unknown`, refused `record-invalid`) and R-EQ and R-LO (their detail gains the `field-unknown` error before theirs); `d-flag` reds R-SPEC, R-OK, R-PRE, R-2ND and the seven R-ROWS rows that carry `--spend-budget` (`checkFlags` refuses `--spend-budget is not a open --amend flag`), leaving `no figure` and `a zero` green. Measure each; record a differing figure (R32 carried).

- [ ] **Step 8: Run the neighbours.** Foreground, at least 600000 ms, one suite per call; a red file is re-run alone before it is called a break:

  ```bash
  (cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
  (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
  (cd server && ./node_modules/.bin/vitest run test/single-definition)   # the single-definition/ directory's files and single-definition-pin.test.ts; there is no single-definition.test.ts
  (cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
  ```

  Expected (predicted): green. In measure-history, W2-3 Task 2's purity scans find no banned spelling in the new function, its declaration reader finds no second `FACT_KINDS`/`LABELS`, W2-3 Task 8's `classifyRun: every answer is a RUN_CLASSES member, and the gate never spells the driver's stop words` finds no `budget-exhausted`, `limits-` or other driver stop word in the gate's source, comments included, and Task 9's `every word the validator spells is a GATE_REASONS word` finds `budget-not-raised` among them. In history-replay, W2-5b2 Task 3's `AMEND_DETAILS holds the gate's AMENDMENT_KINDS as a set, its flags are exactly AMEND_FLAGS, each declared, …` holds (four keys, the union of their flags is `AMEND_FLAGS`), and W2-5a's code re-check cases recompute the new shas from the checkout.

- [ ] **Step 9: Commit.** `git add deploy/history-gate.mjs deploy/history-replay.mjs server/test/measure-history.test.ts server/test/history-replay.test.ts`; the subject of "The PR" item 1; a second `-m` naming the in-place edits: "In place (licensed by this plan's Global Constraints): measure-history's constants case (AMENDMENT_KINDS, GATE_REASONS); W2-5b2 Task 3's open --amend row 'an unknown kind' (its kind list)."; then the Co-Authored-By `-m`.

---

### Task 2: every reader spends under the budget in force (W2-D55, Q5; R-B1; D-7063)

`armNodeOf` is the one place a part 2 consumer turns the record into a spawn budget: `arms --section quiz`, `judge --section quiz` (through its `deps.armNodeOf`), `step0b --section quiz` and `fidelity --section quiz` all take `node.budget` from it, and their `batchGate` compares the `--out` ledger with it (W2-D55's stop). Today it computes `spendShareOf(r.spend_budget, …)` (:7044), and `armsCommand` prints and records `record.spend_budget` (:7407, :7420). This task makes `armNodeOf` read the budget in force through the gate's reader once, carries that figure as `ArmNode.spendBudget`, and has `armsCommand` print and record it, so a node stopped `budget-exhausted` resumes on its own `--out` after a raise, at the raised share, with every byte unchanged for an unamended record.

**Decisions:** W2-D55 as D-7063 amends it; Q5 (each node's share, `ceil(budget × n_node / n_all)` in BigInt, `spendShareOf` unchanged); W2-D53 (a finished run is read back, never respawned); D-6309's rule and S2's C22 (the signed field's range checks stay, Decision 6). It cites D-7063.

**Files:**
- Modify `deploy/history-replay.mjs`:
  - (a) The gate import (:45): `recordSha256, splitAtFirstExit8` becomes `recordSha256, spendBudgetInForce, splitAtFirstExit8` (code-unit order: `spe` < `spl`).
  - (b) `armNodeOf` (:7036-7046): its JSDoc's "the budget in force (part 1's pilot_budget, or this node's share of spend_budget, Q5)" becomes "the budget in force (part 1's pilot_budget, or this node's share of part 2's budget in force, the gate's spendBudgetInForce, Q5, D-7063), and that part 2 figure as spendBudget (null for the pilot)". The line `  const budget = run.section === 'pilot' ? r.pilot_budget : spendShareOf(r.spend_budget, questions.length, nAll);` becomes the two lines below, and its `return` gains `spendBudget` after `budget`.
  - (c) `armsCommand`: the line `    if (section === 'quiz') process.stderr.write(`ccrc history-replay: spend share ${budget} = ceil(${record.spend_budget} x ${questions.length} / ${nAll})\n`);` reads `node.spendBudget` for `record.spend_budget`, and the line `        budget: { in_force: budget, spend_budget: section === 'quiz' ? record.spend_budget : null, n_node: questions.length, n_all: nAll },` becomes `        budget: { in_force: budget, spend_budget: node.spendBudget, n_node: questions.length, n_all: nAll },`.
- Modify `server/test/history-replay.test.ts`: appended after Task 1's describe:
  - `w27Describe('W2-7 Task 2: armNodeOf takes the budget in force through the one reader, and no other driver line reads the signed figure (R-B1, D-7063)', …)`;
  - `w27Describe.skipIf(process.platform === 'darwin')('W2-7 Task 2: a budget-exhausted quiz node resumes on the same --out under a budget raise, at the raised share (R-B1, D-7063)', …)`.

**Interfaces:**
- Consumes: Task 1's `spendBudgetInForce`; W2-5b1's `armNodeOf(run, storeId)` (`ArmRun = { section, record, recordSha256, frozen: { sha256, list: { entries } }, settingsMode, allowCodeChange, codeStamps }`), `spendShareOf(budget, nNode, nAll)`, `armsSummaryOf`'s `budget` object, `w5b4Quiz(home, { spendBudget, over })` (its `argv(rec = f, extra = [])`), `w5b4Arms`, `w5b4Runs`, `w5b4Json`; W2-5b2's `b23Amend`.
- Produces: `ArmNode = { questions, nAll, account, expected, budget: number, spendBudget: number | null, limits, settingsMode }`, where for `'quiz'` `spendBudget === spendBudgetInForce(run.record)` and `budget === spendShareOf(spendBudget, questions.length, nAll)`, and for `'pilot'` `spendBudget === null` and `budget === run.record.pilot_budget`. The armNodeOf lines (the mutants anchor on them):

  ```js
    const spendBudget = run.section === 'pilot' ? null : spendBudgetInForce(r);   // W2-7 (D-7063): the budget in force, the one reader
    const budget = run.section === 'pilot' ? r.pilot_budget : spendShareOf(spendBudget, questions.length, nAll);
  ```

- [ ] **Step 0: Confirm the anchors.** Each count `1`: `grep -c "spendShareOf(r.spend_budget, questions.length, nAll);" deploy/history-replay.mjs`; `grep -c 'ceil(${record.spend_budget} x' deploy/history-replay.mjs`; `grep -c "spend_budget: section === 'quiz' ? record.spend_budget : null, n_node" deploy/history-replay.mjs`; `grep -c "randInt, recordSha256, splitAtFirstExit8," deploy/history-replay.mjs`.

- [ ] **Step 1: Write the failing tests.** The pure describe:
  - **T2-NODE** `T2-NODE: armNodeOf's quiz budget is this node's share of the budget in force, and spendBudget is that figure`: `const fx = w5b4Quiz(w5b4Home());` `const run = (rec: W5b4Saved): W5b4R => ({ section: 'quiz', record: rec.value, recordSha256: rec.sha, frozen: { sha256: fx.fz.sha, list: fx.fz.value }, settingsMode: 'restricted', allowCodeChange: false, codeStamps: [] });` CONTROL: `D4.armNodeOf(run(fx.f), W5B4_STORE_A)` matches `{ budget: 600_000, spendBudget: 1_000_000, nAll: 5 }`; after `const a1 = await b23Amend(fx, fx.f, null, ['--kind', 'budget-raise', '--spend-budget', '1500000'])`, `{ budget: 900_000, spendBudget: 1_500_000 }`; after a second raise to `2000000` over `a1` (pred `fx.f`, clock `B23_NOW + 1000`), `{ budget: 1_200_000, spendBudget: 2_000_000 }`; on node B (`W5B4_STORE_B`, two questions) under `a1`, `{ budget: 600_000, spendBudget: 1_500_000 }`.
  - **T2-PILOT** `T2-PILOT: the pilot's spendBudget is null and its budget part 1's pilot_budget`: `const p = w5b4Pilot(w5b4Home());` `D4.armNodeOf({ section: 'pilot', record: p.draft, recordSha256: p.d.sha, frozen: { sha256: p.fz.sha, list: p.fz.value }, settingsMode: 'restricted', allowCodeChange: false, codeStamps: [] }, W5B4_STORE_A)` matches `{ budget: p.draft.pilot_budget, spendBudget: null }`.
  - **T2-SCAN** `T2-SCAN: the driver reads the signed spend_budget only in the two range checks, calls the one reader once, and spells the kind once`: over `readFileSync(join(REPO, 'deploy', 'history-replay.mjs'), 'utf8')`'s lines with comment lines dropped (`!/^\s*(\*|\/\/|\/\*)/.test(l)`): the lines matching `/\.spend_budget\b/` are exactly two, each trimmed line starting with `refuseOutOfRangeValues({ budget: ` (one `r.spend_budget`, one `amended.spend_budget`); the lines containing `spendBudgetInForce(` are exactly one, and it contains `const spendBudget = `; the lines containing `'budget-raise'` are exactly one, and it starts (trimmed) with `'budget-raise': Object.freeze(`.

  The resume describe (stub runs):
  - **T2-RESUME** `T2-RESUME: budget-exhausted at the signed share, still exhausted on a re-run under the same record, then resumed under a raise at the raised share, every question answered and the first run read back`: `const home = w5b4Home(); const fx = w5b4Quiz(home, { spendBudget: 100, over: { limits: { concurrency: 1 } } });`
    - `const r1 = await w5b4Arms(home, fx.argv());` `r1.refusal` equals `{ word: 'budget-exhausted', detail: 'spent 65 of 60' }`; `w5b4Runs(home)` has length 1 (W2-5b1's own figures, `w5b4It('quiz: the per-node spend share is printed, and the node ledger enforces it; …')`);
    - CONTROL: `const r1b = await w5b4Arms(home, fx.argv());` refuses the same and `w5b4Runs(home)` is still length 1 (a re-run is no remedy);
    - `const a1 = await b23Amend(fx, fx.f, null, ['--kind', 'budget-raise', '--spend-budget', '1000000']);`
    - `const r2 = await w5b4Arms(home, fx.argv(a1, w5b4Inp('supersedes', fx.f)));` `r2.refusal` null and `r2.code` 0; `r2.stderr` starts with `ccrc history-replay: spend share 600000 = ceil(1000000 x 3 / 5)\n`; `w5b4Json(join(fx.out, 'quiz', 'arms', 'summary.json'))` matches `{ record_sha256: a1.sha, stop: null, budget: { in_force: 600_000, spend_budget: 1_000_000, n_node: 3, n_all: 5 }, counts: { questions: 3, answered: 3, not_run: 0 } }`; `w5b4Runs(home)` has length 6 (predicted: three questions, two arms, the first run read back, never respawned, W2-D53).
  
  The two existing W2-5b1 cases that print the share (`quiz: the per-node spend share is printed, …`) are the unamended CONTROL: they run unedited and must stay green byte for byte.

- [ ] **Step 2: Run them and see them fail (predicted).** `(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-7 Task 2')`. Predicted: T2-NODE (no `spendBudget`; the raised shares read 600,000), T2-PILOT (`spendBudget` undefined, not null), T2-SCAN (five `.spend_budget` lines, no reader call) and T2-RESUME (`r2` still `budget-exhausted`, `spent 65 of 60`) fail; on darwin the resume describe is skipped.

- [ ] **Step 3: Edit the driver** as Files (a) to (c) give.

- [ ] **Step 4: Run them and see them pass, then the typecheck.** `(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-7 Task 2|quiz: the per-node spend share is printed|W2-5b1 Task 4|W2-5b1 Task 5|W2-5b2 Task 3')`, then `typecheck-tests`. Expected green: W2-5b1's arms and judge cases and W2-5b2's re-pilot cases are unamended records, so every share, printed line and summary byte is as before; the judge's injected `armNodeOf` stand-ins (`w5b5NodeOf`) carry no `spendBudget`, which the judge never reads.

- [ ] **Step 5: Measure every guard red, then green.**

```json mutants
[
  {"id":"t2-node","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 2","anchor":"  const spendBudget = run.section === 'pilot' ? null : spendBudgetInForce(r);","repl":"  const spendBudget = run.section === 'pilot' ? null : r.spend_budget;","red":"3"},
  {"id":"t2-print","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 2","anchor":"= ceil(${node.spendBudget} x","repl":"= ceil(${record.spend_budget} x","red":"2"},
  {"id":"t2-summary","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 2","anchor":"budget: { in_force: budget, spend_budget: node.spendBudget, n_node:","repl":"budget: { in_force: budget, spend_budget: section === 'quiz' ? record.spend_budget : null, n_node:","red":"2"},
  {"id":"t2-pilot","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 2","anchor":"  const spendBudget = run.section === 'pilot' ? null : spendBudgetInForce(r);","repl":"  const spendBudget = spendBudgetInForce(r);","red":"1"}
]
```

  Predicted: `t2-node` reds T2-NODE, T2-SCAN and T2-RESUME (3); `t2-print` reds T2-SCAN (`${record.spend_budget}` is a third `.spend_budget` read) and T2-RESUME (its stderr reads `ceil(100 x 3 / 5)` beside share 600000) (2); `t2-summary` reds T2-SCAN and T2-RESUME (under the raise the summary's `spend_budget` reads the signed 100) (2); `t2-pilot` reds T2-PILOT (`spendBudgetInForce` of a part 1 answers `undefined`, not `null`) (1). On darwin the resume case is skipped, so measure on linux.

- [ ] **Step 6: Run the neighbours.** The four commands of Task 1 Step 8. Expected green.

- [ ] **Step 7: Commit.** `git add deploy/history-replay.mjs server/test/history-replay.test.ts`; "The PR" item 2's subject; the Co-Authored-By `-m`.

---

### Task 3: `report`'s carried checks: a correct record not answered by value, and verify-ab's defects by their own details (CP-27 F1, A10, A13)

Three of W2-5b2's carried follow-ups, all in `report`'s readers. **F1:** `nodeAnswersOf` holds each answer record to its shape (:9860-9863) and the per-arm sums to the sha-checked summary, but a record marked `correct` whose `answer_field.state` is not `value` passes both when two records of one arm and node swap their states (the sums are unchanged), and reaches `decideGate`, which throws `decideGate: question … is <state> and labelled correct (W2-D64)` (history-gate.mjs:1829) before `--out` (`decideGate` at :10086, `prepareOut` at :10098): `report` exits INTERNAL. **A10:** `verifyAbOf`'s one guard (:9928) answers four defects with one detail; Decision 8 splits it. **A13:** a CONTROL title says "first question … in both arms" where its world (`runFailed: (e) => e.store_id === B2T5_S2`) makes node 2's one question run-failed through its control arm.

**Decisions:** W2-D64 and W2-D63 (correct only on a value: `labelCorrect` reads the ANSWER value alone), W2-D85 (every report input sha-checked and held), D-6309's rule (a data case is a driver word, never INTERNAL), W2-D84 (V1's states). No number.

**Files:**
- Modify `deploy/history-replay.mjs`:
  - (a) `nodeAnswersOf` (:9834): its guard's second line `      || typeof r.correct !== 'boolean' || !plainObject(r.uptake)))) {` becomes `      || typeof r.correct !== 'boolean' || !plainObject(r.uptake) || (r.correct === true && r.answer_field.state !== 'value')))) {` (so the term reads, within the `r.run !== null` group, `r.run !== null && r.correct === true && r.answer_field.state !== 'value'`, after the shape terms that make `r.answer_field.state` safe to read). Its JSDoc gains: "A record marked correct whose answer state is not `value` is not settled either: only a value is ever correct (W2-D63, W2-D64), and decideGate throws on one (CP-27 F1)."
  - (b) `verifyAbOf` (:9920): the line `    if (a === undefined || f.arm !== a.arm || !AB_STATES.includes(f.state)) refuse('input-invalid', `${at} lists ${JSON.stringify(f?.ccrc_id ?? null)} off the record's assignment`);` becomes three lines, in this order:

    ```js
        if (a === undefined) refuse('input-invalid', `${at} lists ${JSON.stringify(f?.ccrc_id ?? null)} off the record's assignment`);
        if (f.arm !== a.arm) refuse('input-invalid', `${at} lists ${JSON.stringify(f.ccrc_id)} under arm ${JSON.stringify(f.arm ?? null)}, not the record's ${JSON.stringify(a.arm)}`);
        if (!AB_STATES.includes(f.state)) refuse('input-invalid', `${at} lists ${JSON.stringify(f.ccrc_id)} in state ${JSON.stringify(f.state ?? null)}, not one of AB_STATES`);
    ```
    Its JSDoc gains: "An entry that is no object or names no assigned family of this store, one under another arm, and one in a state off AB_STATES are refused apart, each by its own detail (CP-27 A10)." The driver still spells no arm word: the arm is interpolated.
- Modify `server/test/history-replay.test.ts`:
  - In place (A10): in `an assigned family listed with a state off AB_STATES refuses input-invalid naming its id before --out`, the expected detail `` `verify-ab ${s1} lists ${JSON.stringify(id)} off the record's assignment` `` becomes `` `verify-ab ${s1} lists ${JSON.stringify(id)} in state "maybe", not one of AB_STATES` ``.
  - In place (A13): the title `'CONTROL: the unedited world, and one whose first question is run-failed in both arms, report'` becomes `'CONTROL: the unedited world, and one whose node 2 question is run-failed (its control arm failed twice), report'`.
  - Appended after Task 2's describes: `w27Describe('W2-7 Task 3: nodeAnswersOf refuses a record marked correct whose answer state is not value, before --out and never INTERNAL (CP-27 F1)', …)` and `w27Describe('W2-7 Task 3: verifyAbOf names each defect of a family entry by its own detail (CP-27 A10)', …)`.

**Interfaces:**
- Consumes: `b2t5World(o)` (`o.answer(e, arm)` called once per question and arm, node by node in `B2T5_STORES` order, each node's questions in `mine` order, which is frozen qid order), `b2t5Edit(w, store, field, edit)`, `f4Refused(w)` (asserts a refusal and no `--out`), `b2t5Report(argv)` (rethrows any non-refusal throw), `fr2Rel(w, arm, store)`, `B2T5_S1`, `B2T5_C`, `B2T5_T`, `B2T5_ARMS`.
- Produces: the two refusal details above; nothing else changes shape.

- [ ] **Step 0: Confirm the anchors.** Each count `1`: `grep -c "|| typeof r.correct !== 'boolean' || !plainObject(r.uptake)))) {" deploy/history-replay.mjs`; `grep -c "if (a === undefined || f.arm !== a.arm || !AB_STATES.includes(f.state)) refuse(" deploy/history-replay.mjs`; `grep -c "one whose first question is run-failed in both arms, report" server/test/history-replay.test.ts`; `grep -c 'lists ${JSON.stringify(id)} off the record' server/test/history-replay.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - F1's describe:
    - **F1-CONTROL** `F1-CONTROL: a world whose node-0 second question the treatment arm answers UNKNOWN reports`: `let n = 0; const w = b2t5World({ answer: (e, arm) => (arm === B2T5_T && e.store_id === B2T5_S1 && ++n === 2 ? { text: 'ANSWER: UNKNOWN' } : { text: arm === B2T5_T ? `ANSWER: ${e.fact as string}` : 'ANSWER: UNKNOWN' }) });` `(await b2t5Report(w.argv())).refusal` is null. Build it through a helper `w27F1World()` that the next case reuses.
    - **F1-SWAP** `F1-SWAP: two answer records of one arm and node with answer_field.state swapped under an untouched summary refuse input-invalid "is not a settled answer record", naming the record marked correct, before --out`: `const w = w27F1World(); const [q1, q2] = w.nodes[B2T5_S1].mine.map((e) => e.qid);` read the treatment records `join(w.nodes[B2T5_S1].root, 'quiz', 'answers', `${q}.${B2T5_T}.json`)` for `q1` (state `value`, `correct` true) and `q2` (state `unknown`, `correct` false), swap only `answer_field.state` between them, write both back as canonical JSON and one newline, leave `quiz/arms/summary.json` and `quiz/judged.json` as they are; `await f4Refused(w)` equals `{ word: 'input-invalid', detail: `arms-summary ${B2T5_S1}: quiz/answers/${q1}.${B2T5_T}.json is not a settled answer record` }`. Predicted red today: a TypeError `decideGate: question <q1> (<treatment arm>) is unknown and labelled correct (W2-D64)` thrown out of `b2t5Report`.
  - A10's describe, each refusing row through `f4Refused` and each world `b2t5World()` with node 0's first listed family edited by `b2t5Edit(w, B2T5_S1, 'verifyAb', …)`; `const fam = (w) => w.nodes[B2T5_S1].verifyAb.value.families[0]; const other = (arm) => (arm === B2T5_T ? B2T5_C : B2T5_T);`
    - **A10-CONTROL** the unedited world reports;
    - **A10-OBJ** a family entry that is `null` → `` `verify-ab ${s1} lists null off the record's assignment` ``;
    - **A10-OFF** a family entry naming `live-not-assigned` → `` `verify-ab ${s1} lists "live-not-assigned" off the record's assignment` ``;
    - **A10-ARM** the first entry's arm flipped → `` `verify-ab ${s1} lists ${JSON.stringify(f.ccrc_id)} under arm ${JSON.stringify(other(f.arm))}, not the record's ${JSON.stringify(f.arm)}` `` (with `f` the entry as the world wrote it);
    - **A10-NOARM** the first entry's `arm` deleted → the same detail with `under arm null`;
    - **A10-STATE** the first entry's state `'maybe'` → `` `verify-ab ${s1} lists ${JSON.stringify(f.ccrc_id)} in state "maybe", not one of AB_STATES` ``;
    - **A10-ORDER** arm flipped and state `'maybe'` together → A10-ARM's detail (the arm is held first).
  - The two in-place edits (Files).

- [ ] **Step 2: Run them and see them fail (predicted).** `(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-7 Task 3|W2-5b2 Task 5 fix round 2')`. Predicted: F1-SWAP (a thrown TypeError), A10-ARM, A10-NOARM, A10-STATE, A10-ORDER, and the re-pinned W2-5b2 state row fail; F1-CONTROL, A10-CONTROL, A10-OBJ, A10-OFF and the retitled CONTROL pass.

- [ ] **Step 3: Edit the driver** as Files (a) and (b) give.

- [ ] **Step 4: Run them and see them pass, then the typecheck.** The command of Step 2, then `(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5b2 Task 5')`, then `typecheck-tests`. Expected green: W2-5b2 Task 5's `refused before --out: a verify --section ab output listing a family off the assignment` row (the wrong-arm world) still matches its prefix `verify-ab <store> lists `, and the `droppedOf's state TypeError` case still sees a detail starting with that prefix.

- [ ] **Step 5: Measure every guard red, then green.**

```json mutants
[
  {"id":"f1","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 3","anchor":" || (r.correct === true && r.answer_field.state !== 'value')))) {","repl":"))) {","red":"1"},
  {"id":"a10-off","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 3","anchor":"    if (a === undefined) refuse('input-invalid', `${at} lists ${JSON.stringify(f?.ccrc_id ?? null)} off the record's assignment`);","repl":"    void 0;","red":"2"},
  {"id":"a10-arm","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 3","anchor":"    if (f.arm !== a.arm) refuse(","repl":"    if (false) refuse(","red":"3"},
  {"id":"a10-state","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 3","anchor":"    if (!AB_STATES.includes(f.state)) refuse(","repl":"    if (false) refuse(","red":"1"}
]
```

  Predicted: `f1` reds F1-SWAP (the TypeError returns); `a10-off` reds A10-OBJ and A10-OFF (a TypeError reading `a.arm` of undefined, rethrown); `a10-arm` reds A10-ARM, A10-NOARM and A10-ORDER (they fall to the report's later steps or to the state detail); `a10-state` reds A10-STATE (`droppedOf` throws its TypeError).

- [ ] **Step 6: Run the neighbours.** `history-replay.test.ts` whole, `typecheck-tests`, `citations`. Expected green.

- [ ] **Step 7: Commit.** `git add deploy/history-replay.mjs server/test/history-replay.test.ts`; "The PR" item 3's subject; a second `-m`: "In place (licensed by this plan's Global Constraints): W2-5b2 Task 5 fix round 2's state-off-AB_STATES row (its detail, A10) and one CONTROL title (A13)."; the Co-Authored-By `-m`.

---

### Task 4: the realpath colon check at W2-5b2's five call sites, and step 0b's HOME row pinned on the driver (CP-27 F2, A9; D-5813)

**F2.** D-5813's `refuseColonInRealOut(out)` (:2371) refuses `args-invalid` `out contains ':'` when the realpath `prepareOut` answers holds `:`, which an ancestor symlink can introduce though the spelling given did not; without it the realpath reaches `spawnEnv`, whose TypeError (`… is not an absolute path without ':'`, :1290) is an exit 1 after `--out` (D-6309's rule). W2-5b2 added five calls, none with a row of its own: `step0bCommand` (:8060), `fidelityCommand` (:8642), `pilotResultCommand` (:8695), `fidelityRepilotCommand` (:9067) and `repilotResultCommand` (:9131). This task adds one row and one mutant per call. The two result commands read an `--out` their earlier acts wrote, so their rows move a real, passing `--out` under the colon directory and pass it through the link. **A9** is Decision 9.

**Decisions:** D-5813 (the realpath colon check), D-6309's rule, Q25 and K1 (the five forms' `--out` rules, unchanged), W2-D57 (step 0b's persistence). No number.

**Files:**
- `deploy/history-replay.mjs`: not edited.
- Modify `server/test/history-replay.test.ts`:
  - In place (A9): in `step0bCommand refuses a HOME that is unset or not absolute before anything is read, …`, the `for (const suffix of …)` line becomes: `const { json, roster } = readRoster(home); const launch = admitAccount(json, roster, fx.draft.account as string, home); b2t1Expect([launch.configDir, path.isAbsolute(launch.configDir)], 'the configDir step 0b hands persistenceMeasured is the driver\'s join of the absolute HOME and the roster suffix').toEqual([join(home, '.claude'), true]);` (`readRoster` and `admitAccount` are the file's top-level imports; the fixture's account is upstream, whose suffix the driver holds to `.claude`).
  - Appended after Task 3's describes: helpers and `w27Describe.skipIf(process.platform === 'darwin')('W2-7 Task 4: an --out whose realpath holds a colon is refused args-invalid at each of W2-5b2\'s five call sites, before any spawn and any result (CP-27 F2, D-5813)', …)`.
    - `function w27Colon(): { base: string; link: string; real: string }` — `const base = mkTmp('ccrc-w27-colon-'); mkdirSync(join(base, 'a:b')); symlinkSync(join(base, 'a:b'), join(base, 'link'));` returning `link: join(base, 'link', 'out')`, `real: join(base, 'a:b', 'out')`.
    - `function w27Plain(): { link: string; real: string }` — the same with a directory named `ab` (no colon): the CONTROL.
    - `const w27Out = (argv: string[], out: string): string[] => argv.map((v, i) => (i > 0 && argv[i - 1] === '--out' ? out : v));`
    - `const COLON = { word: 'args-invalid', detail: "out contains ':'" };`

**Interfaces:**
- Consumes: `b2t1Home`, `b2t1Pilot(home)` (`fx.argv()`), `b2t1PlantAll(home, 'restricted')`, `b2t1Run(home, argv)`; `b2t2Home`, `b2t2PlantPass`, `b2t2Fidelity(home)` (`fx.argv`), `b2t2PilotOut(home)` (`p.out`, `p.argv()`), `b2t2Call`, `b2t2Flags`, `b2t2Deps()`, `B2T2_ENV`, `B2.fidelityCommand`, `B2.pilotResultCommand`; `b23RepilotNode()`, `b23Step0b(fx, rout)`, `b23Fidelity(fx, rout)`, `b23Result(fx, rout, s0, fid)`, `w5b4SaveText(text, name)` (the C-RERES inputs' copies; `b23Saved(p)` is not used there, Step 1), `w5b4Out()`, the file's top-level `readFileSync`; `stubLog(home)`; `w27Rename` (Task 1's import group).
- Produces: tests only.

- [ ] **Step 0: Confirm the anchors.** `grep -c "refuseColonInRealOut(out);" deploy/history-replay.mjs` is `11` (six earlier, five W2-5b2's); each of the five mutant anchors below counts `1`; `grep -c "path.isAbsolute(join(path.resolve(home), suffix))" server/test/history-replay.test.ts` is `1`.

- [ ] **Step 1: Write the tests.** Each row asserts `refusal` equals `COLON`, then its own evidence:
  - **C-STEP0B** `step0b --section pilot`: `const home = b2t1Home(); const fx = b2t1Pilot(home); b2t1PlantAll(home, 'restricted'); const c = w27Colon();` `const r = await b2t1Run(home, w27Out(fx.argv(), c.link));` `stubLog(home)` is null (predicted: nothing spawned before the check; if the admission's own `--version` precedes `--out`, assert instead that no print-mode run exists and record the measurement); `existsSync(join(c.real, 'pilot', 'step0b'))` false.
  - **C-FID** `fidelity --section pilot`: `const home = b2t2Home(); b2t2PlantPass(home); const fx = b2t2Fidelity(home); const c = w27Colon();` `b2t2Call(() => B2.fidelityCommand(b2t2Flags(w27Out(fx.argv, c.link)), B2T2_ENV(home), b2t2Deps()))`; `stubLog(home)` null; `existsSync(join(c.real, 'fidelity.json'))` false.
  - **C-RESULT** `pilot-result --section pilot`: `const home = b2t2Home(); const p = b2t2PilotOut(home); const c = w27Colon(); w27Rename(p.out, c.real);` `b2t2Call(() => B2.pilotResultCommand(b2t2Flags(w27Out(p.argv(), c.link)), B2T2_ENV(home)))`; `existsSync(join(c.real, 'pilot-result.json'))` false; `stderr` is `''`. Its CONTROL (**C-RESULT-PLAIN**): the same with `w27Plain()` answers refusal null and writes `join(real, 'pilot-result.json')`.
  - **C-REFID** `fidelity --section quiz`: `const fx = b23RepilotNode(); const c = w27Colon();` `b23Fidelity(fx, c.link)`; `stubLog(fx.home)` null; `existsSync(join(c.real, 'quiz', 'fidelity.json'))` false.
  - **C-RERES** `pilot-result --section quiz`: `const fx = b23RepilotNode(); const rout = w5b4Out();` `b23Step0b(fx, rout)` and `b23Fidelity(fx, rout)` each refusal null; the two inputs are COPIED out of `rout` before it moves, never saved in place: `const s0 = w5b4SaveText(readFileSync(join(rout, 'quiz', 'step0b', 'restricted.json'), 'utf8'), 'restricted.json'); const fid = w5b4SaveText(readFileSync(join(rout, 'quiz', 'fidelity.json'), 'utf8'), 'fidelity.json');` (the same bytes, so the same shas, each in its own tmp dir; `b23Saved` records the path where the file is and copies nothing, so after the rename its `--step0b` and `--fidelity` would name absent files and the row would answer `input-invalid` `step0b unreadable ENOENT`); `const c = w27Colon(); w27Rename(rout, c.real);` `b23Result(fx, c.link, s0, fid)`; `existsSync(join(c.real, 'quiz', 'repilot-result.json'))` false; `stderr` `''`. Its CONTROL (**C-RERES-PLAIN**): the same, its inputs copied out the same way before `rout` moves under `w27Plain()`'s `real`, answers refusal null and writes the result.
  - Why the copy: `repilotResultCommand` loads `--step0b` and `--fidelity` (`loadInput`) before it reaches `prepareOut` and `refuseColonInRealOut`, so an input must never live under the `--out` a row moves. C-RESULT is unaffected: `b2t2PilotOut`'s inputs are saved in their own tmp dirs.
  - Timeouts as W2-5b2's stub cases (300_000 for the two re-pilot rows, 120_000 otherwise).
  - The A9 in-place edit (Files).

- [ ] **Step 2: Run them; they pass on the shipped code** (the guards exist; their red-first is each mutant, Step 3): `(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-7 Task 4|step0bCommand refuses a HOME that is unset')`. Expected green on linux; on darwin the colon describe is skipped and the A9 row (in a darwin-skipped describe as well) too, so measure on linux.

- [ ] **Step 3: Measure every guard red, then green.**

```json mutants
[
  {"id":"c-step0b","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 4","anchor":"    refuseColonInRealOut(out);\n    refusePilotSourceOut(out, 'step0b runs');","repl":"    refusePilotSourceOut(out, 'step0b runs');","red":"1"},
  {"id":"c-fid","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 4","anchor":"    refuseColonInRealOut(out);\n    refusePilotSourceOut(out, 'fidelity runs');","repl":"    refusePilotSourceOut(out, 'fidelity runs');","red":"1"},
  {"id":"c-result","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 4","anchor":"  refuseColonInRealOut(out);\n  refusePilotSourceOut(out, 'pilot-result reads a pilot');","repl":"  refusePilotSourceOut(out, 'pilot-result reads a pilot');","red":"1"},
  {"id":"c-refid","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 4","anchor":"    refuseColonInRealOut(out);\n    refusePilotSourceOut(out, 'fidelity --section quiz runs');","repl":"    refusePilotSourceOut(out, 'fidelity --section quiz runs');","red":"1"},
  {"id":"c-reres","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"W2-7 Task 4","anchor":"  refuseColonInRealOut(out);\n  refusePilotSourceOut(out, 'pilot-result --section quiz writes');","repl":"  refusePilotSourceOut(out, 'pilot-result --section quiz writes');","red":"1"},
  {"id":"a9","file":"deploy/history-replay.mjs","suite":"history-replay.test.ts","select":"step0bCommand refuses a HOME that is unset","anchor":"    configDir: join(home, acct.configDirSuffix), wrapperPath: null, secretsPath: null,","repl":"    configDir: acct.configDirSuffix, wrapperPath: null, secretsPath: null,","red":"1"}
]
```

  Predicted: each `c-*` reds its own row only. The three spawning rows fail by a thrown TypeError out of `spawnEnv` (the poison bin or the config dir under a `:` path) or by a spawn; the two result rows fail because the command proceeds and answers its ordinary result (refusal null) or another word. `a9` reds the A9 row (`launch.configDir` is the bare `.claude`); its CONTROL half also fails (the step 0b run's `spawnEnv` refuses a relative configDir), still one case. Measure each; the row's evidence assertions above are predictions too.

- [ ] **Step 4: Run the neighbours.** `history-replay.test.ts` whole, `typecheck-tests`. Expected green.

- [ ] **Step 5: Commit.** `git add server/test/history-replay.test.ts`; "The PR" item 4's subject; a second `-m`: "In place (licensed by this plan's Global Constraints): W2-5b2 Task 1 fix round 2's step0b HOME row, its path.isAbsolute half replaced by a driver-side assertion (A9)."; the Co-Authored-By `-m`.

---

### Task 5: the whole-PR checks, the body and the PR

- [ ] **Step 0: The base, again.** `git fetch origin main`; if `main` moved any of the five files since the branch point, merge `main` (never rebase), keep both sides, and re-run Tasks 1 to 4's selections.
- [ ] **Step 1: Every suite the PR touches, whole, in the foreground.** `measure-history.test.ts`, `history-replay.test.ts`, `typecheck-tests.test.ts`, `test/single-definition` (the directory's files and `single-definition-pin.test.ts`, one call), `citations.test.ts`, `deviation-refs.test.ts` (after `git fetch origin main`), `growth-check.test.ts`, one suite per call. Expected green.
- [ ] **Step 2: Every mutant anchored once, then all measured at the tip.** The anchor count script of W2-5b2 (its "To check that every anchor occurs once"), reading this plan and each entry's `file`: expected `mutants 27 anchored once 27`. Then each of the 27 through Global Constraints' procedure, now with `git diff --exit-code` after the restore; record a measured figure that differs from its prediction in a `docs(plan): … (W2-7 Task <N>)` commit.
- [ ] **Step 3: The diff is what this plan says.** `git diff --stat origin/main...HEAD` names exactly the five files. `git diff origin/main...HEAD -- deploy/history-gate.mjs` shows hunks only in `AMENDMENT_KINDS`, `GATE_REASONS` and the `// ── W2-3 Task 9:` section, none in `decideGate` or `assembleReports`. `git diff origin/main...HEAD -- server/test/history-replay.test.ts server/test/measure-history.test.ts` shows no removed or changed line outside Global Constraints' in-place list.
- [ ] **Step 4: The rulings by content.** `grep -c "'budget-raise'" deploy/history-replay.mjs` is `1`; `grep -c "budget-not-raised" deploy/history-gate.mjs` is `3` (`@type`, the list, the validator); `grep -c "export function spendBudgetInForce" deploy/history-gate.mjs` is `1`; `grep -c "spendBudgetInForce" deploy/history-replay.mjs` is `3` (the import, `armNodeOf`'s JSDoc, the call); T2-SCAN, run again, is green.
- [ ] **Step 5: D-numbers.** `git diff origin/main...HEAD | grep -o 'D-[0-9]\{4\}' | sort -u` names only numbers this plan cites (D-5813, D-5893, D-6280, D-6309, D-6481, D-7063, and any number issued during the build, each defined in "## Deviations found"); `deviation-refs` (Step 1) is green.
- [ ] **Step 6: Private names.** Count private project names, hosts, tailnet names, `100.` addresses, absolute home paths and account or lane names over `git diff origin/main...HEAD`'s added lines, `git log origin/main..HEAD --format=%B`, the PR title and body, and this plan, with the scan the coordinator's brief names; it must print 0.
- [ ] **Step 7: The body.** Written to a scratch file, used by `gh pr create --body-file`:

  > Plan: `docs/superpowers/plans/2026-10-26-ccrc-history-w2-7-budget-raise.md`. Decisions: W2-D55, W2-D90, W2-D25, W2-D24, W2-D85. Rulings: the operator's R-B1 (build a budget amendment) and R-B2 (no release install during the window); the coordinator's G7 rulings; CP-27 (W2-5b2's review round 3 carries).
  >
  > **Part A, the budget raise (R-B1, D-7063).** A fourth amendment kind, `budget-raise`, through the existing `open --amend` chain: `open --amend --kind budget-raise --spend-budget N --record <part 2> --record-sha256 H [--supersedes …] --part1 … --frozen …` prints the superseding part 2 and its sha. The gate's validator holds it to one safe-integer figure strictly above the budget in force before it (`budget-not-raised`, a new gate word; compared only with a valid figure, so an earlier raise refused for its own defect answers one word, not two), with no other detail key and no node; after window start the record still changes only by the appended amendment. The budget in force is read by one pure reader in the gate, `spendBudgetInForce`, which the validator and the driver's `armNodeOf` call; arms, judge, step 0b and the quiz fidelity re-pilot take their share from `armNodeOf`, and the arms' printed share line and summary carry the in-force figure. A `budget-exhausted` node resumes on its own `--out` under the amended record. Nothing that scores changes: `decideGate` and `assembleReports` are untouched and pinned to read no budget or amendment. It is allowed on any part 2, before and during the window; before part 2 the superseding-draft rules stand.
  >
  > **Part B, W2-5b2's carries (CP-27).** F1: `report` refuses a record marked correct whose answer state is not `value` (`input-invalid`, before `--out`), where it exited INTERNAL through `decideGate`'s throw. A10: `verify --section ab`'s wrong arm and off-set state get their own details (the off-assignment detail stays for an entry that is no object or names no assigned family). A13: one CONTROL title corrected. F2: one colon-realpath `--out` row per call site for W2-5b2's five `refuseColonInRealOut` calls, each with its mutant. A9: the step 0b HOME row's Node-only half replaced by a driver-side assertion.
  >
  > **In-place edits:** (the four items of Global Constraints, verbatim). **Departure:** D-7063, defined in the plan's "Deviations found". **Not in this PR, for the coordinator:** the spec erratum (§10.2's budget in force and its list of amendment kinds) and the decisions document's W2-D55, W2-D90 and §4 Part 2 rows, citing D-7063; README's driver paragraph (another run holds it); the runbook's `budget-exhausted` row, act 21's amendment list with its ordering note (a pending version-move is written before a raise, since a raise between a re-pilot and its version-move makes that re-pilot `repilot record-mismatch`; a raise owed before a re-pilot runs goes first) and its coordinator duties (each use of a raise recorded in the ledger). **Release:** this PR changes two `gate_code` files, and its release is the final W2 release (R-B2, W2-D6). Under R-B2 that release is rolled at acts 5 and 6, before step 0a (act 7), and no release is installed from act 6 to act 28; so this PR must merge, and its release be cut, before act 5 chooses the tag, and acts 7 onward (step 0a, `pilot-source`, part 1 and every later act) run only on it: part 1's validator ties step 0a's recorded code shas and release stamp to `gate_code`. Nothing has run yet, so nothing is re-run. If act 6 already ran with another tag, installing this release is an R-B2 halt (`tree-moved`): stop and ask the operator; do not re-run. **CI:** please check that the `select tests` summary lists `history-replay` and `measure-history`.
  >
  > 🤖 Generated with [Claude Code](https://claude.com/claude-code)

- [ ] **Step 8: Open it.** Push the branch; `gh pr create --title "ccrc history wave W2-7: the budget raise and W2-5b2's carried follow-ups" --body-file <scratch>`; ready for review, not a draft. Report the PR number and head sha to the coordinator.

---

## Deviations found

One number is defined here, issued by the coordinator to this run at planning. A number issued during the build is appended below by the commit that first cites it.

- **D-7063** — `history-w2-budget-raise-amendment` (Task 1, read by Task 2; W2-D90, W2-D55, W2-D25; the operator's ruling R-B1, 2026-10-26): W2-D90 fixes the amendment kinds to a chosen set of three (`version-move`, `freeze-exception`, `forced-act`), and W2-D55 makes the budget in force from part 2 on part 2's signed `spend_budget`, the pilot's extrapolation × 1.25, fixed at `open --finalize`; the spec's §10.2 says both. So a `budget-exhausted` stop after part 2 had no remedy but a halt. This wave adds a fourth kind, `budget-raise`, whose detail is exactly `{spend_budget}` and which names no node, and makes the budget in force from part 2 on the newest raise's figure, else the signed `spend_budget`, read by one pure reader in the gate (`spendBudgetInForce`). The validator refuses a raise that is not strictly above the budget in force before it with a new gate word, `budget-not-raised`, and refuses any other detail key, a node, or a figure that is absent or no safe integer with W2-D25's own words. The signed `spend_budget` is never edited and stays range-checked; the gate's scoring is unchanged. Why: the operator ruled it (R-B1), and the coordinator's rulings bound it (it only raises; nothing that scores moves; one reader; recorded like every amendment; from part 2 on). The decisions document and the spec are amended in place by whoever the coordinator assigns, citing this number.

## Residuals

- **The spec, the decisions document, README and the runbook** still say three amendment kinds and a fixed budget from part 2 (Not in this plan). Until amended, an operator reading them misses the remedy; the coordinator carries the runbook before act 5 chooses the tag (R-B2: acts 5 and 6 roll this PR's release, and nothing is installed after act 6).
- **A pre-window re-finalize drops raises.** Before window start, `open --finalize --prior-final` supersedes part 2 wholesale (W2-D90's pre-window rule) with `amendments: []` and the budget re-derived from the pilot; a raise made before window start does not survive it, by that existing rule. The operator raises again after it if needed.
- **K25's disclosure moves with the raise.** A node's approximate exposure (twice its signed share, plus in-flight soft-stop overshoot, README) now reads "its share of the budget in force"; the figure is unchanged in kind and the README sentence is the README run's.
- **Earlier plans' recorded mutant anchors move**: W2-5b1's armNodeOf budget mutant (its anchor `spendShareOf(r.spend_budget, …)`), and W2-5b2's verifyAbOf term mutants (`M40`, its census row 140) and its F1-adjacent census row. Plan anchors are snapshots of their tips (CLAUDE.md); this plan's own mutants replace them for the edited lines.
- **A raise after a re-pilot and before its version-move makes the re-pilot stale.** `open --amend --kind version-move` holds the re-pilot to the record it amends (`rp.record_sha256 === rec.sha256`), so a raise appended in between refuses the version-move `input-invalid` `repilot record-mismatch`, and the whole re-pilot, which spends, runs again; a node can owe both in one window (the quiz fidelity re-pilot spends under `armNodeOf`'s share and can itself stop on a spent budget). This is the existing chain rule, the same for every amendment kind; the new kind makes the pair likely, so the runbook carries the ordering (Not in this plan): write a pending version-move before a raise, and a raise owed before the re-pilot runs first. No code or row of this PR changes it.
- **A raise is not range-capped above.** Any safe integer above the budget in force validates, as `q18_settings.sims` and `planned_days` do: the validator refuses what a consumer cannot honour, not what is only costly (W2-D25, section 7). The operator's ruling sets the figure.
- **`judge --section quiz`'s share follows the raise only when re-run under the amended record**, as every consumer does after any amendment (K8); a judge batch already running keeps its gate's budget until it ends.

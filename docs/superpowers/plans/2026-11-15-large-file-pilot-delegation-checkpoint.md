# Large-file programme, the pilot: `delegation-checkpoint.ts` in three pure moves (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **D-8641 (2026-11-15)** — `large-file-pilot-delegation-checkpoint`: the pilot's plan. A pin PR moves every scan of
  `server/src/coord/delegation-checkpoint.ts` onto a program view (`server/test/scan/programView.ts`) and freezes the
  file. Three pure-move PRs follow, in a fixed order: the applier to `delegation-durability.ts` (L3), the SQLite
  projection to `delegation-db-projection.ts` (L3), and recovery to `delegation-recovery.ts` (L1), all in C5. Each move
  PR changes test files only on their import lines. A closing PR then caps the file and its three new modules, each at
  the code lines it measures plus 40.

**Goal:** split `delegation-checkpoint.ts` into the four modules of spec §3, with one ring and one context each, and
change no behaviour. This is the first file the slice tool moves.

**Architecture:** scanners move before the code (§2 item 7). Task 1 makes every test that reads the file's text read
its *program* instead. The program is the file plus the destination modules that exist, or a lookup of the one file
that declares a name. These tests stay green on `main` and after every slice. Each slice is then a run of
`.github/ci/file-split.mjs move`, and nothing else touches its diff. The split tool's REAL row judges the whole PR diff,
test files included, so any statement edit to a test inside a move PR makes the move impure.

**Tech Stack:** TypeScript 6, `server/test/scan/parse.ts` (its `ts` export), the slice tool `.github/ci/file-split.mjs`
with `server/test/fileSplit.ts` (#2819, D-8636), and the growth stages `server/test/growth-frozen/` and
`server/test/growth-caps/` (#2811, D-8635). Tests run in vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-large-file-programme-design.md` (D-8615), approved 2026-11-14 with every
answer as recommended: §2 (the method), §3 "the pilot", §4 (slots and caps), Q1 (2,500 code lines), Q2 (cap = measured
+ 40, may only fall) and Q8 (10 lines per PR, no waivers). Step 0's plans:
`docs/superpowers/plans/2026-11-14-large-file-step0-caps.md` (D-8635) and
`docs/superpowers/plans/2026-11-14-large-file-step0-split-tool.md` (D-8636).

## The file today (measured on `origin/main` `2126f46db`, 2026-11-15)

3,273 lines and 2,335 code lines (`codeLines`, `server/test/growthCheck.ts`). It has 6 import statements and 104
top-level declarations, 58 of them exported. It has had no commit since #2330 (2026-11-05), and no open PR touches it
(one `gh pr list` on 2026-11-15). Its ring by `rings/ring.ts` is L1 ("no outer-ring fact": its I/O is all injected),
and its context is C5 (`coord/**`). Line numbers below are snapshots of that sha.

| Target module | Ring | Declarations | Lines on `main` | Code lines after (measured on a scratch copy) |
|---|---|---|---|---|
| `delegation-checkpoint.ts` (stays): codec, projectability, builder | L1 | 59 | `:140` to `:1452` | 1,039 (of 1,404 lines) |
| `delegation-recovery.ts` | L1 | 11 | `:1458` to `:1737` | 229 |
| `delegation-durability.ts` | L3 (header) | 26 | `:1739` to `:1782`, `:2019` to `:3273` | 966 |
| `delegation-db-projection.ts` | L3 (header) | 8 | `:1802` to `:2014` | 158 |

Every module ends under the 2,500-line ceiling (Q1). The file's own role after the split: the checkpoint codec and the
fold. Spec §1's "done" items 2 to 5 are the test.

**The scratch proof.** On a copy of `origin/main` with #2819's tool, Task 1's test rewrites were applied and the three
slices then run in order. The verdict was pure for each slice (26, 8 and 11 moved; `differing` empty). Server and
test-project typechecks were clean. The pinned suites passed both before and after the slices: 12 files and 2,640
tests, then 37 files and 2,426 tests. Each slice changed test files on import lines alone. Without Task 1, the first
slice redded exactly the six tests #2819's body reports (named in Task 1). The copy was deleted.

## Global Constraints

- **Pure moves only** (§2 item 2). A move PR changes test files only on import lines. It edits no comment, no header
  and no statement outside what the tool writes. The one exception is a new destination's ring header (Tasks 3 and 4),
  written directly above the tool's marker with no blank line between them. The verdict sets a new file's header aside,
  and on the scratch copy it stayed pure with the header in place.
- **One behaviour change per commit** (§2 item 3). A defect found during a move gets its own later PR, with a red test
  first. It never rides in a move.
- **Frozen from the pin PR to the cap PR** (Q8). The file is held to 10 net code lines per PR, no waiver counts, and
  only the operator's named exemption (`growth-exemptions.json`, D-6211) lets a PR past. New delegation code goes to the
  module §3 names for it.
- **Ceiling and cap.** Every module stays under 2,500 code lines. A cap is the code lines measured on the PR that sets
  it, plus 40, and may only fall (Q2, D-8635).
- **The order is fixed: durability, then the SQLite projection, then recovery.** The tool refuses a cut that has value
  references in both directions (`cycle`). Recovery or the projection moved while the applier is still in the file
  would be one, because the applier calls both and both call the source's fold.
- **Preflight before every move** (§4): one open move PR per file, the C5 slot free, and no open PR with a hunk in a
  declaration the slice moves. Build the heads file from one `gh pr list --json number,headRefOid` plus
  `git fetch origin pull/<n>/head`. Never poll; if `gh` reports a rate limit, stop and report.
- **Review:** a pure-move lens, at most two rounds (§2 item 5).
- **Commits** cite D-8641. A commit that adds or edits a file under `docs/superpowers/plans/` carries
  `Ledger-Edit: D-8641` directly above `Co-Authored-By`. This is a public repository: no tracker ids, hosts or
  account names.
- **Gates for every PR:** `(cd server && npx tsc --noEmit -p .)`;
  `(cd server && npx tsc --noEmit -p test/tsconfig.tests.json 2>&1 | grep -v '^../agent')` printing nothing; the pinned
  suites named in each task; and `server/test/rings`, `server/test/census-w7`, `server/test/single-definition`,
  `mail-routes.test.ts` and `growth-check.test.ts`.

## Review Focus

1. **A scan that stays green because the code left it** (rule (e)). For example: the clock and randomness scan, the
   canonical-JSON scan, `store.ts`'s "never imports the checkpoint" pin and the RB18 delete census all passed after the
   first scratch slice while reading less code. Task 1 points each of them at the program, and its rows prove the
   program still holds the moved code.
2. **A test edit hidden in a move PR.** It reds the REAL row of `file-split-pin.test.ts` as `rest:<test file>`. A pin
   that a slice finds red goes back into a pin PR shaped like Task 1, landed first. It is never fixed inside the move.
3. **An outward edge created by a ring header.** `delegation-durability.ts` and `delegation-db-projection.ts` declare
   L3. Their runtime importers are `watch.ts` (L4) and each other; every other importer is type-only. A new L1 runtime
   import of either one reds `rings/outward-edges.test.ts`. Each slice runs it.
4. **A rebase across a feature PR that edited a moved declaration.** If a feature landed during the freeze, the rebased
   move can keep an old copy or lose the edit. Re-run `move` on the new base instead of resolving conflicts by hand, and
   then run `verdict` (`defined-twice`, `text:<name>`).
5. **Module identity under mocks and spies.** `delegation-recovery.test.ts` mocks `delegation-journal.js`, and
   `delegation-pass-timing.test.ts` spies on `delegation-model.js`'s namespace. The moved code must still reach those
   modules through the same ids. Both suites run in every slice and passed on the scratch copy.

---

### Task 1: The characterization pin, with every scan moved onto the program (one PR, before any move)

**Files:**
- Create: `server/test/scan/programView.ts`, `server/test/program-view.test.ts`
- Modify: `server/test/delegation-recovery.test.ts`, `server/test/delegation-wave3.integration.test.ts`,
  `server/test/delegation-ingest.test.ts`, `server/test/delegation-pass-timing.test.ts`,
  `server/test/coord-store.test.ts`, `server/test/single-definition/advance-switches.test.ts`

**Interfaces:**
- Produces, in `server/test/scan/programView.ts` (the TypeScript analogue of `ccdSource()`; it reads with `node:fs` and
  parses with `scan/parse.ts`'s `ts`, so it adds no second parser):
  - `PROGRAM_VIEWS: Readonly<Record<string, readonly string[]>>`, with one row:
    `'server/src/coord/delegation-checkpoint.ts'` → `['server/src/coord/delegation-recovery.ts',
    'server/src/coord/delegation-durability.ts', 'server/src/coord/delegation-db-projection.ts']`. A later file in
    the programme adds its own row.
  - `programMembers(source: string): string[]`: the source and its destinations, whether or not they exist. Throws
    for a source that has no row.
  - `programTexts(source: string): Array<{ file: string; text: string }>`: the members that exist, in row order.
  - `programFiles(source: string): string[]`, and `programSource(source: string): string`, which joins the texts,
    each ending in exactly one `\n`.
  - `declaringFile(source: string, name: string): string`: the one existing member whose top-level statements declare
    `name` (variable, function, class, interface, type, enum). Throws when there are 0 or 2 or more.

- [ ] **Step 1: Write the failing pin** `server/test/program-view.test.ts`:
  - `programFiles(SRC)` is `[SRC]` while no destination exists, and `programSource(SRC)` equals the file's text.
  - `declaringFile(SRC, 'DelegationDurability')` is a member of `programMembers(SRC)`, and `declaringFile(SRC, 'nope')`
    throws.
  - **The characterization:** each of the 104 top-level names declared on `main` (listed as a literal: the 59 of
    Task 6's "stays" list plus the 45 of Tasks 3 to 5) has exactly one `declaringFile`, and each of the 58 exported
    names is still exported by its declaring file. A feature that adds a declaration does not red this pin; one that
    removes a declaration updates the list in its own PR.
- [ ] **Step 2: Run** `cd server && npx vitest run test/program-view.test.ts`. Expected: FAIL, because the module does
  not exist.
- [ ] **Step 3: Implement `programView.ts`.** Run Step 2 again. Expected: PASS.
- [ ] **Step 4: Move the six tests #2819's scratch slice redded onto the program.** Each one must stay green on `main`.
  The six are:
  - `delegation-recovery.test.ts` › "the checkpoint module cuts the journal in ONE place…". `c` becomes
    `stripComments(programSource(CHECKPOINT_SOURCE))`, and `CHECKPOINT_TS` becomes
    `declaringFile(CHECKPOINT_SOURCE, 'DelegationDurability')`.
  - `delegation-recovery.test.ts` › "no other production source names the journal file at all". The expected list
    becomes the set of `declaringFile(…, 'DelegationDurability')`, `declaringFile(…, 'recoverDelegationFromFiles')` and
    `'coord/delegation-journal.ts'`, sorted.
  - `delegation-recovery.test.ts` › "delegation-checkpoint.ts: above the IMPURE SHELL banner…". For the checkpoint, the
    rule becomes this:
    - the banner stands in `declaringFile(…, 'recoverDelegationFromFiles')` and in no other member;
    - the files declaring `encodeDelegationCheckpoint`, `DelegationCheckpointBuilder` and `DelegationRecovery` name no
      filesystem, SQLite or store above it (or anywhere, in a file without it);
    - the program's imports from outside itself equal today's six: `../../../shared/api.js`,
      `./delegation-compaction.js`, `./delegation-journal.js`, `./delegation-lease-state.js`,
      `./delegation-model.js`, `node:path`.
  - `delegation-recovery.test.ts` › "the lease adapter calls the INJECTED randomUUID in one place only…" reads
    `programSource`.
  - `delegation-wave3.integration.test.ts` › "only the torn-tail heal and compactJournal rewrite the retained set…":
    - the two file lists name `declaringFile(…, 'DelegationDurability')` (and `'recoverDelegationFromFiles'`) and are
      sorted;
    - the line scanner walks `programTexts`, resetting `method` to `'(file)'` and `inClass` to false at each file's
      start;
    - the heal checks read `programSource`.

    Read as one joined text, the import lines of a later file inherit the last function of the file before it. The
    scratch copy showed this as `recoverDelegationState: DELEGATION_CARRIED_FILE,`.
  - `delegation-ingest.test.ts` › "there is an IMPURE SHELL banner…". Its import list names
    `./${basename(declaringFile(…, 'DelegationDurableBatch'), '.ts')}.js` in place of `'./delegation-checkpoint.js'`.
- [ ] **Step 5: Move the scans that would narrow without going red** (rule (e)):
  - `delegation-recovery.test.ts`: "no randomness and no clock anywhere in the module", "only the model is imported
    for canonical JSON" and the RB18 delete census read `programSource` for the checkpoint;
  - `coord-store.test.ts` › "the result type has one home…": `store.ts` names no member of `programMembers`.
- [ ] **Step 6: Turn the namespace reads into named imports.** The tool refuses a namespace import that uses a moved
  name, and a hand repoint inside a move PR is not pure:
  - `delegation-recovery.test.ts`: `checkpointNs.isDelegationCheckpointKebab(` and both
    `(checkpointNs as …)['DELEGATION_REPAIR_FULL_MS']` reads become named imports, and `import * as checkpointNs`
    goes;
  - `delegation-pass-timing.test.ts`: `(checkpointMod as …)['DELEGATION_REPAIR_FULL_MS']` becomes a named import.
    `checkpointMod` stays, for `encodeDelegationCheckpoint`, which does not move.
- [ ] **Step 7: Lower the ARCH-06 ratchet.** Every literal source pin over the file now reads through the view, so the
  scan measures 0. Delete the `'server/src/coord/delegation-checkpoint.ts': 33` row of
  `advance-switches.test.ts` (an absent row means 0). The three new modules have no rows, so a later literal pin over
  any program member is red.
- [ ] **Step 8: Gates.** Run `npx vitest run test/program-view.test.ts test/delegation-recovery.test.ts
  test/delegation-wave3.integration.test.ts test/delegation-ingest.test.ts test/delegation-pass-timing.test.ts
  test/coord-store.test.ts test/single-definition/advance-switches.test.ts`, then the Global Constraints gates.
  Expected: all green on unmoved code.
- [ ] **Step 9: Commit** the named files: `test(large-files): the pilot's pin, scans read delegation-checkpoint's
  program (D-8641)`.

### Task 2: The frozen stage (Q8), in the pin PR

**Gate:** #2811 (D-8635) on `main`, which brings the `growth-frozen` directory and its parser. If it has not merged,
Task 1's PR lands alone, and this task follows as its own PR as soon as it does. No slice starts before the freeze is
on `main`.

**Files:** Create `server/test/growth-frozen/server-src-coord-delegation-checkpoint-ts.json`.

- [ ] **Step 1:** Write `{"file": "server/src/coord/delegation-checkpoint.ts", "d": "D-8641", "since": "<the PR's day>"}`.
  The keys are exactly D-8635's `{file, d, since}`, and `d` is defined by this plan.
- [ ] **Step 2: Run** `cd server && npx vitest run test/growth-caps.test.ts test/growth-check.test.ts`. Expected: PASS,
  with the summary listing the file as frozen.
- [ ] **Step 3: Commit:** `test(growth): freeze delegation-checkpoint.ts for the pilot (D-8641)`.

### Tasks 3 to 5: the slices, one PR each

**Gate for each slice:** #2819 (D-8636) on `main`, Tasks 1 and 2 on `main`, the previous slice merged, and preflight
passing. Every slice runs these steps:

- [ ] **Step 1: Preflight.** Write `heads.json` as Global Constraints says, then run
  `node .github/ci/file-split.mjs preflight --source server/src/coord/delegation-checkpoint.ts --dest <dest> --names <names> --heads heads.json --self <n>`.
  Expected: `ok`.
- [ ] **Step 2: Plan.** Run `node .github/ci/file-split.mjs plan …` with the same arguments. Expected: exit 0,
  `destContexts` `["C5"]`, `sourceUsesDest` `[]`, and `problems` `[]`.
- [ ] **Step 3: Move.** Run `node .github/ci/file-split.mjs move …`. Then add the ring header, where the task names
  one.
- [ ] **Step 4: Verdict.** Run `node .github/ci/file-split.mjs verdict --base "$(git merge-base origin/main HEAD)"`.
  Expected: `pure: true`, `differing: []`, and the moved count the task states. In `git diff --stat`, a changed test
  file shows its import lines alone.
- [ ] **Step 5: Gates.** Run every `server/test/delegation-*.test.ts`, plus `mail-routes`, `coord-store`,
  `coordination-snapshot`, `lease-routes`, `coordinator-intent-route`, `orphan-tree-beat-ready`,
  `program-view`, `file-split-pin`, `growth-check` and `growth-caps`, then the Global Constraints gates. Expected: all
  green. A red pin stops the slice (Review Focus 2).
- [ ] **Step 6: Commit** the files `move` wrote, by name (never `git add -A`):
  `refactor(coord): <dest> moves out of delegation-checkpoint.ts, a pure move (D-8641)`.

**How each slice updates the pins in its own PR.** It edits none of them. Task 1 already reads every pin through the
program, so a slice's test changes are the import lines `move` repoints, and the verdict holds them to that. The pins
each slice exercises are listed per task.

### Task 3: Slice 1, the applier and the file side of recovery → `server/src/coord/delegation-durability.ts`

- **Ring and context:** C5 by the `coord/**` row of `ringContextMap.ts`, so no new table row is needed. L3 by a header
  declaration: by its facts the file is L1, because its I/O is injected, and §3 puts the impure shell in L3. The
  header goes above the marker, with no blank line between:
  `// Delegation durability (C5). Ring L3 adapter: the serialized durable applier and the file side of recovery, through the injected`
  `// file port, clock and randomness (large-file pilot, D-8641).`
  On the scratch copy, `serverRing` read it as L3 ("declares L3 in its header"), `outward-edges`, `totality` and
  `host-imports` passed, and the verdict stayed pure.
- **The 26 declarations** (`--names`):
  - `recoverDelegationFromFiles` (`:1747`). It carries the IMPURE SHELL banner (`:1739`), its lead comment.
  - The 17 types and constants of `:2019` to `:2147`: `DELEGATION_DURABILITY_EDGES`, `DELEGATION_COMPACTION_EDGES`,
    `DelegationDurabilityEdge`, `DelegationCompactionOutcome`, `DelegationUpkeepRequest`, `DelegationUpkeepOutcome`,
    `DelegationDurabilityDeps`, `DelegationDurabilityFailure`, `DelegationDurableBatch`, `DelegationApplyOutcome`,
    `DelegationLeaseRefusalReason`, `DelegationLeaseOutcome`, `DelegationLeaseTransitionRequest`,
    `DelegationLeaseReleaseRequest`, `DelegationLeaseActOutcome`, `DelegationMetaOutcome`,
    `DelegationCheckpointChange`.
  - `nowInstant` (`:2149`) and `DelegationDurability` (`:2163`).
  - The words block (`:3232` to `:3273`, the §3 risk): `DELEGATION_CHECKPOINT_ERROR_CODES`,
    `DELEGATION_OWN_FAILURE_CODES`, `DELEGATION_LEASE_REFUSAL_REASONS`, `DELEGATION_META_OPEN_KINDS`,
    `DELEGATION_FAILURE_PHASES`, `isDelegationCheckpointKebab`. It reads the durability edges as values, so it cannot
    stay in the source without a cycle. `mail-routes.test.ts`'s census imports the guard and is repointed.
- **Expected from the tool:**
  - 26 moved.
  - `newlyExported` from the source: `deleteEventsInGaps`, `isMember`, `readCursor`, `readInterval`, `refuse`,
    `sessionKeyOf`.
  - Repointed: six sources (`delegation-ingest.ts`, `delegationAdoptStep.ts`, `delegationCarrierMark.ts`,
    `delegationLeaseDoor.ts`, `routes.ts` with +1 line, and `watch.ts`) and 19 tests. `routes.ts` and `watch.ts` are
    listed files at 40 per PR.
- **Pins it exercises:** all six from Task 1 Step 4, the `checkpointNs` named import, and the kebab census.

### Task 4: Slice 2, the SQLite projection port and its repair → `server/src/coord/delegation-db-projection.ts`

- **Ring and context:** C5, and L3 by a header in the same form as Task 3's:
  `// Delegation projection to coord.db (C5). Ring L3 adapter: the projection port and its repair (large-file pilot, D-8641).`
  The name `delegation-projection.ts` that §3 gives is taken; see Deviations.
- **The 8 declarations** (`:1802` to `:2014`): `DelegationProjectionPort`, `DelegationProjectionRepairReport`,
  `DELEGATION_REPAIR_FULL_MS`, `yieldToEventLoop`, `DELEGATION_EVENTS_DELETE_CHUNK`, `deleteEventsInGaps`,
  `checkpointWithoutSessions`, `repairDelegationProjection`.
- **Expected from the tool:**
  - 8 moved, with `destUsesSource` `sessionKeyOf` and `DelegationEvidenceCounts`.
  - Repointed: `delegation-durability.ts` (+1) and 8 tests: `coordinator-intent-route`, `delegation-compaction`,
    `delegation-delta-applier`, `delegation-health`, `delegation-lease-durability`, `delegation-pass-timing`,
    `delegation-recovery` and `lease-routes`.
- **Pins it exercises:** the `DELEGATION_REPAIR_FULL_MS` named imports from Task 1 Step 6. Without them, `plan` refuses
  with "a namespace import … uses DELEGATION_REPAIR_FULL_MS".

### Task 5: Slice 3, recovery → `server/src/coord/delegation-recovery.ts`

- **Ring and context:** L1 by its facts (no header), C5.
- **The 11 declarations** (`:1458` to `:1737`): `DELEGATION_RECOVERY_PHASES`, `DelegationRecoveryPhaseName`,
  `DelegationRecoveryFailure`, `DelegationOwnFailureCode`, `DelegationEvidenceCounts`, `DelegationEvidenceIndex`,
  `DelegationRecoveryFacts`, `DelegationRecoveryReport`, `DelegationRecovery`, `recoverDelegation`,
  `recoverDelegationState`.
- **Expected from the tool:**
  - 11 moved, with `destUsesSource` `refuse`, `DelegationCheckpointBuilder`, `decodeDelegationCheckpoint`,
    `validateDelegationCheckpoint` and `DelegationCheckpointError`.
  - Repointed: `delegation-durability.ts` and `delegation-db-projection.ts` (+1 each), plus 11 tests and fixtures,
    `delegationCarrierCheckpoints.ts` and `delegationOldRuleFixture.ts` among them.
- **Pins it exercises:** the "pure/impure split" row's pure-homes clause, where `DelegationRecovery`'s file must name no
  filesystem, SQLite or store.

### Task 6: The closing PR: the caps, and the prose the moves could not touch

No move marker, so the verdict answers null.

**What stays in `delegation-checkpoint.ts`** (59 declarations):
- constants and errors: `DELEGATION_CHECKPOINT_FILE`, `COORDINATION_RESTORE_MARKER_FILE`,
  `DELEGATION_RESTORE_IN_PROGRESS`, `DelegationCheckpointErrorCode`, `DelegationCheckpointError`, `refuse`;
- the shape readers: `isRecord`, `isMember`, `Fields`, `INTERVAL_STATES`, `HOLD_REASONS`, and `readSession` through
  `readHold`, `CHECKPOINT_KEYS`, `instantOk`, `readCheckpoint`;
- the codec: `UTF8`, `encodeDelegationCheckpoint`, `decodeDelegationCheckpoint`;
- projectability: `unprojectable`, `LEASE_CLOCKS`, `assertDelegationCheckpointProjectable`;
- lease proof and validation: `DelegationLeaseEntryFact`, `DelegationLeaseRecordFact`, `assertLeaseJournalProof`,
  `validateDelegationCheckpoint`;
- the builder's inputs: `DelegationNamedUpstream`, `workflowLaunchRunId`, `namedAgentsOf`,
  `DelegationActivityCandidate`, `DelegationBashCallFact`;
- the due heap (`maxInstant` through `duePop`);
- naming: `bashListingOf`, `delegationRecordNaming`;
- the keys and sorts (`sessionKeyOf` through `sortedMap`);
- `mergeDelegationObservationInterval`, `leaseRowOfEntry`, `DelegationMetaOpenResult`,
  `DelegationWorkflowLaunchFact`, `sameActivity`, `DelegationCheckpointBuilder`.

**Files:**
- Create: `server/test/growth-caps/server-src-coord-delegation-checkpoint-ts.json`, and the same for
  `delegation-recovery-ts`, `delegation-durability-ts` and `delegation-db-projection-ts`.
- Delete: `server/test/growth-frozen/server-src-coord-delegation-checkpoint-ts.json`.
- Modify: `server/src/coord/delegation-checkpoint.ts` (header comment only) and
  `server/test/delegation-pass-timing.test.ts` (comment only).

- [ ] **Step 1: Measure.** Take each module's `codeLines` at HEAD. Expected near 1,039, 229, 966 and 158; the caps are
  each figure plus 40. §4 says "a new module is … capped by the same rule" when its file closes, so the three new
  modules take caps too.
- [ ] **Step 2: Write the four cap files** `{file, cap, d: "D-8641", since}` and remove the freeze file, per D-8635's
  "Close a file" row. `GROWTH_FILES` keeps its entry: the cap stage takes precedence over the listed one (D-8635 rule
  1), and `growth-check.test.ts` names the file in its list.
- [ ] **Step 3: Rewrite the prose.**
  - The source header's "WHAT IS HERE" now describes the codec and the fold, and names the three sibling modules. It
    no longer says the impure shell sits below a banner here.
  - In `delegation-pass-timing.test.ts`, the comment "the applier (`delegation-checkpoint.ts`)" names
    `delegation-durability.ts`.
  - Check with `grep -rn 'delegation-checkpoint\.ts' server/src server/test deploy`: every remaining mention must be
    about the codec, the fold or the program view.
- [ ] **Step 4: Gates.** Run `npx vitest run test/growth-caps.test.ts test/growth-check.test.ts test/program-view.test.ts`,
  then the Global Constraints gates. Expected: PASS. Spec §1's "done" list then holds: items 1 to 5, with the pins
  staying in the tree.
- [ ] **Step 5: Commit:** `test(growth): cap delegation-checkpoint.ts and its three modules, measured + 40 (D-8641)`.

## Deviations found

- **The target `delegation-projection.ts` is taken.** It is the wave-4 `delegation` frame decider: L1, 194 lines,
  `projectDelegation`. The tool would append the SQLite repair to it, which would mix a ring and a reason to change.
  The SQLite projection goes to `delegation-db-projection.ts` instead.
- **`recoverDelegationFromFiles` and the banner go to durability, not recovery.** They sit below `:1739` (§3's L1
  line), and they read files through the port. The pure recovery (`:1458` to `:1737`) is what goes to
  `delegation-recovery.ts`.
- **By its facts, the whole file is L1.** `ring.ts` sees no outer-ring fact, because every I/O is injected. §3's L3 is
  reached only by a header declaration on the two impure modules, which moves them outward and never inward.
- **The slice order is forced.** The cycle refusal fixes durability first. The spec names no order.
- **Pins move in the pin PR, not in the slice PR.** #2819's body says a real slice "must update those pins in its own
  PR". But the REAL row judges every changed code file, tests included, so a pin edit makes a move impure. Task 1 moves
  the pins first, and they stay green on `main` and after every slice; that is §2 item 7 taken literally. The six are
  named in Task 1 Step 4, and they match #2819's count.
- **The words block moves with the applier.** §3's risk line asks for this, and the cycle rule forces it. One guard
  keeps admitting the program's words; splitting it per module would be new code, not a move.
- **Caps on the three new modules** in the closing PR, by §4's new-module sentence. The brief named the file's cap only.
- **The start had no console control.** D-8635 leaves "Start a file" as an open follow-up (Q10). The operator's
  2026-11-14 answer "start step 0 and the pilot" stands in for the tap, and the pilot adds no operator action of its
  own.

## Known limits

- The code-line figures for the four modules come from a scratch copy; Task 6 measures them again.
- A non-literal scanner that reads a member without the view, such as a line scanner on `readFileSync`, is refused by
  no guard. ARCH-06's ratchet covers only literal pins. The pure-move review lens checks for it.
- Open #2658 also edits `advance-switches.test.ts` (Task 1 Step 7). Whichever PR lands second rebases. Preflight does
  not see test-file overlap.

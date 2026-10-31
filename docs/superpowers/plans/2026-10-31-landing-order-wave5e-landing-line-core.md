# Landing order, wave 5e — the landing line's core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server keeps a landing line: one entry per PR waiting to land in a project. It reads the line's order, and the coordinator reads the line before it enqueues (spec §5.5).
- **Entries and pins.** An entry is created or re-pinned when a run advances to `merging`, pinned to the verdict's measured head. One store method writes it, in the same transaction as the run's advance (D-7614).
- **Ejection records its base.** A `merging → working` advance may carry `{ejection: {base, kind}}`. The entry goes `ejected` with that base, so clause 15's "an ejection naming the base sha the landing line recorded" is literally true (D-7615).
- **The order.** A pure decider folds the operator pause and the main-red hold, honours `after` edges, lets a `fixesMain` entry jump the line, and defaults to first-green order (D-7621, D-7622).
- **The second ejection** of an entry raises one operator notice. The advance is never refused (D-7624).
- **The read.** `GET /api/landing?project=<p>` is a box-token read, reached through the client verb `ccrc-api landing show`.
- **The skills** name the read, record the base on every ejecting advance, and take the four items carried from wave 5b's reviews.

**Why:**
- Spec §5.5's landing line replaces order negotiated in mail. This sub-wave is its core: the data, the entry's life at `merging`, the order, and the coordinator's read. Later sub-waves add the journal and the attributed writes (5f), intents (5g), the landed reader (5h), the line's head (5i) and the doors (5j, 5k).
- Recording the base on the ejection ends the interim reading of clause 15 (D-7590, narrowed by D-7607). Clause 15 needs no amendment.

**Architecture:**
- **Task 1** (`server/src/coord/schema.ts`, `shared/landingLine.ts`, `server/src/coord/landingEntry.ts`, `server/src/coord/store.ts`, `server/src/coord/advance.ts`, `server/src/coord/routes.ts#advanceAct`, `shared/api.ts`, `shared/refusal.ts`):
  - one migration (slot 35) with both tables;
  - the L0 words;
  - the composite writer `CoordStore.advanceLanding` and its pure decision `decideLandingWrite`;
  - the advance body's `ejection`;
  - the one new refusal code;
  - the coord.db line in `CLAUDE.md`.
- **Task 2** (`server/src/coord/landingLine.ts`, `shared/landingLine.ts`, `server/src/coord/routes.ts`):
  - the pure decider `landingOrder`;
  - the second-ejection notice through the existing notice sink.
- **Task 3** (`server/src/coord/routes.ts`, `server/src/server.ts`, `server/src/auth/gate.ts`, `shared/landingLine.ts`, `ccd/ccrc-api`, README, `CLAUDE.md`):
  - the read route, the auth gate and the masking hook;
  - the client row;
  - the box-token line in `CLAUDE.md`.
- **Task 4** (`ccd/coordinator-skill/SKILL.md`, `ccd/coordinator-skill/references/wave-lifecycle.md`, and the two skill tests): the skill text and the carried 5b items.
- **Task 5:** the gate, the PR and the wave-done.

**Tech Stack:** TypeScript (Node ≥ 22.16) and `node:sqlite` in the server; Markdown skills; vitest with a temporary coord.db.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`:
- §5.5: Data, Entries and pins, item 5 (ejection), item 6 (the pause, the hold and `fixesMain`);
- §7, the coord.db invariant amended;
- §9, sequencing.

**Other sources:**
- the ledger, `docs/superpowers/programs/landing-order.md`: rows 5e to 5k, the Decisions entries of 2026-10-30 23:24 and 2026-10-31 07:06, and the Carried constraints "From wave 5b's reviews (1302, 1303)";
- wave 5b's plan (`docs/superpowers/plans/2026-10-30-landing-order-wave5b-landing-skill-text.md`, D-7590) and its departures note (D-7607).

**Prerequisite:** waves 5b (#2015) and 5c (#2017) are on `main`. The fleet box need not run 5c's `ccd`, because 5e reads none of it.

**Plan review.**
- **Drafting.** Each task was drafted against `main` by its own Opus reader, and a Sonnet reader checked it against `main`: every code claim, every red-first step and every mutation row's red. All their fixes are applied. Where the drafts disagreed, the coordinator ruled:
  - an `after` edge names an entry id;
  - an edge to an `unknown` entry holds its follower back;
  - a second ejection is a notice, never a refusal;
  - each `CLAUDE.md` line, the client row and each ring-map row has one owning task.
- **Review.** Three Opus lenses then reviewed the whole plan (cross-task executability, spec fidelity, and fail-closed with the repository rules), and Sonnet refuters checked the serious findings. Two critical findings held and are answered:
  - the new refusal arrives on `reject.code`, where the coordinator reads it;
  - Task 3's fixtures open real runs before seeding entries that name them.

  Each important finding is answered too:
  - Task 2 reads the entry from Task 1's answer;
  - the refused-ejection case posts from `awaiting-review`;
  - Task 3 creates `LandingLineView`;
  - an older server's 404 reads as no entry, and any other failed read stops the landing;
  - the advance answers what the line recorded (D-7627). So an `ejected:` mail is sent only once its base is recorded, and otherwise the round is reported to the operator.
- **Minors.** Each minor finding is answered, including a purity guard for `landingEntry.ts` and a separate word for a retreat with no episode.

## CLAUDE.md (for the operator to read)

This wave changes two bullets of `CLAUDE.md` (three lines). The operator reads them here, word for word, and the PR is held at landing until the operator has.
- The PR must carry exactly these bytes, and the coordinator compares them at landing.
- If they are identical and the operator has read them here, the PR lands with no further hold. Any difference waits for the operator.
- The repository's own tests (`box-token-census`, `collect-switch-prose` and `stall-settings-prose`) read the PR's `CLAUDE.md`, which is why the lines ride in the PR itself.

**The coord.db bullet** (Task 1, D-7620). `the landing line` goes first in the list of what a lost database loses. That keeps the sentences two tests pin whole.

Before:
```
  what it adds on top — mail, claims, asks, central pool edges, update intents, the stall-watch settings choice,
  the collector switch — is gone without the snapshot every `ccrc update` (and `ccrc backup`) takes into
```
After:
```
  what it adds on top — the landing line, mail, claims, asks, central pool edges, update intents, the stall-watch
  settings choice, the collector switch — is gone without the snapshot every `ccrc update` (and `ccrc backup`) takes into
```

**The box-token bullet** (Task 3). `` `GET /api/landing` `` joins the `requireMailToken` list beside `` `GET /api/ledger` ``.

Before:
```
  `POST /api/coordinators/:session/intent`, `POST /api/ledger/deviations`, `GET /api/ledger` and the approvals lane's
```
After:
```
  `POST /api/coordinators/:session/intent`, `POST /api/ledger/deviations`, `GET /api/ledger`, `GET /api/landing` and the approvals lane's
```

The journal sentence of the coord.db invariant (spec §5.5, "the second exception") waits for 5f, which ships the journal (D-7610).

## What this does not claim
- **No journal.** `~/.ccrc/landing.log` and its replay ship in 5f with the first authoritative writer (D-7610). Every column 5e writes is recomputable from the run it came from.
- **No attributed writes:** no `POST /api/landing/entries`, and no `POST /api/landing/order` (5f). `afterIds`, `fixesMain` and a non-run entry's `setBy` hold their defaults in 5e (D-7611).
- **No intents** (5g), **no landed reader** (5h; nothing writes `landed`), **no `mainRedHold` writer and no next-to-land mail** (5i), **no doors** (5j, 5k; nothing writes `operatorPaused` or `withdrawn`), and **no `lander=` key** (5d).
- **The read is advisory.** In 5e the coordinator checks the pause and its own entry's pin. The order is read, not obeyed, until 5i, and a PR with no entry lands as the verdict says (D-7626).
- **The `conflict` ejection kind has no sender.** Step 6 sends `dequeued` and `new-head` only. `conflict` waits for a project without the queue.
- **No ccd change.** The client row in `ccd/ccrc-api` is the API client, not a `ccd` verb (D-7625).

## Global Constraints
- **Modules first.** Run `npm ci` in `server/` before Task 1.
- **A temporary coord.db and `ccrcDir` only.** Never run `ccd`, `ccrc`, `tmux` or `gh` against the live HOME.
- **Tests.**
  - Every test runs as `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 <files>` from `server/`, in the foreground, with a timeout of at least 600000 ms.
  - `typecheck-tests` runs alone.
  - `tsc --noEmit` runs for the server.
- **The architecture rules.**
  - `coord.db` stays synchronous.
  - Decide in L1 (`landingEntry.ts`, `landingLine.ts`), act in L4 (`routes.ts`).
  - L0 `shared/landingLine.ts` imports nothing.
  - No overloaded null at a seam: each nullable field has one meaning, stated in its type's comment.
- **The migration slot.** Re-measure `MIGRATIONS.length` on `origin/main` before the PR. It is 34 today, and this wave takes 35. If `main` has moved past 34, take the next slot, move every literal with it, and report it.
- **Growth.**
  - Run `growth-check` with `GROWTH_CHECK=1` after `git fetch origin main`.
  - `store.ts` and `routes.ts` are growth-listed. Their growth is waived by the wave's new files under `server/src/coord/` and `shared/` (`growthCheck.ts`'s `L1_L2_NEW_FILE_DIRS`), so no waiver is written.
  - Report both net deltas.
- **One state at push.**
  - Commit each task on the workspace's own branch.
  - Between Task 1 and Task 4, `coordinator-skill.test.ts`'s route census and refusal-code census are red BY DESIGN, because they read both the server and the skill. Task 1 adds `ejection-not-merging` and Task 3 registers the route, and Task 4 names both.
  - Push nothing until Task 5's gate is green.
- **The verdict fence is byte-identical.** On `origin/main`, the 254 body lines of `wave-lifecycle.md`'s `### 5b` `bash` block hash to `dec52b5aaf9d6166853a25a18db29d2203a38fd6ace044f7c7068e43c4eef3a7`.
- **`CLAUDE.md` changes exactly the two bullets above (three lines), byte for byte.**
- **Skill text.**
  - No clause is added or removed: `CONTRACT` stays 19 in both skill tests.
  - No new skill sentence holds a double quote.
  - Every paragraph written in `wave-lifecycle.md` wraps at 80 columns.
  - Step 6 keeps its five-space continuation indent.
- **Cite code by symbol or `@anchor`,** never by file and line.
- **Mutations.** Run them sequentially in the worktree, bounded with `timeout -k` and a measured `ulimit -u`. Restore each mutated file from a saved copy with its sha256 checked, never with `git checkout`, and keep each row's log under `.superpowers/sdd/`.
- **Neutral names only.** The repository is public (`project-a`, `demo`, `lane-a`).
- **Deviation numbers are issued, never chosen.**
  - This plan defines D-7610 to D-7627, issued on 2026-10-31.
  - A departure found during execution is named by slug in the wave-done (`D-TBD-<slug>`), and the coordinator numbers it.
- **Commits** go on the workspace's own branch. Never update-branch, rebase or force-push.

## Review Focus
1. **One writer of the pin** (D-7614).
   - Only `CoordStore.advanceLanding` writes `pinnedSha`, from the same head as the run's `merging-at:` detail, in the same transaction as the run's advance.
   - It decides the edge before it writes, so a refused advance writes no entry and no event.
   - A census pins `mergingAtDetail`'s only call inside that method.
2. **An ejection records its base, or is refused** (D-7615, D-7616, D-7619).
   - A `merging → working` advance with `ejection` records `baseSha` and the kind in the same transaction.
   - An `ejection` body on a run not at `merging` is refused `ejection-not-merging` and writes nothing.
   - A bare retreat ejects with a null base, so it licenses no absorb.
3. **The decider fails closed** (D-7621, D-7622, D-7623).
   - A paused line has no head, whether the pause is the operator's or main-red's.
   - An `unknown` entry is never in the line, and an `after` edge to it holds its follower back, because the decider cannot read whether the target landed.
   - An `after` edge outranks the `fixesMain` jump.
   - A green never clears the operator pause in the fold.
4. **The read is gated, masked and advisory** (D-7626).
   - `GET /api/landing` refuses without the box token, passes the masking hook, and answers the decider's order as computed, never a cached one.
   - A 404 on the read, from a server older than the line, is read as no entry: the coordinator lands as the verdict says and names the missing entry in its turn text. Any other failure of the read (a timeout, a 401, a 5xx, a transport error, an unparsable answer) stops the landing and is reported to the operator.
5. **The second ejection raises exactly one notice** (D-7624). The count reaches 2, one notice is recorded, and later ejections raise none. The advance is never refused, and no mail is sent.

**Task order:** 1, 2, 3, 4, 5. A test that needs an earlier task's code says so, and its red-first is measured after that task is on the branch.

---
### Task 1: the tables, the entry and its one writer

The landing line's tables and its entry's life at `merging` (the Goal's first two bullets), and the server half of the ejection's recorded base (D-7615 (the ejection records its base)). One migration (slot 35) adds `landing_entries` and `landing_projects`, both complete (D-7611 (one-migration-two-tables)). The L0 words and the wire type of an entry live in a new `shared/landingLine.ts`. An entry is created or re-pinned on `advance → merging`, and ejected on `merging → working`, only by ONE composite store method, `CoordStore.advanceLanding`. It decides the edge first, then writes the run's advance and the entry in one `tx()`. It builds the `merging-at:` detail itself from the same `head` it writes as `pinnedSha`, so the two cannot disagree (D-7614 (one writer of the pin)). The decision of what to write is pure L1, in a new `server/src/coord/landingEntry.ts`, which keeps `store.ts` under its growth limit. Nothing here reads the line's order (that is the decider task, Task 2), serves a route (the read task, Task 3) or raises the second-ejection notice (D-7624 (the second ejection is a notice, raised once at two, the advance never refused), a later task). This task returns the entry, with its `ejections` count, to the task that raises that notice; the advance is never refused on a count.

**Files:**
- Create: `shared/landingLine.ts` (L0, imports nothing). Contents:
  - `LANDING_ENTRY_STATE`, `LandingEntryState`, `LANDING_ENTRY_STATES`, `isLandingEntryState`;
  - `LANDING_EJECTION_KINDS`, `LandingEjectionKind`, `isLandingEjectionKind`;
  - `LandingEntry`.

  Task 2 (the decider) appends `LandingOrder`, `LandingLineFlags` and the pause words (`LANDING_PAUSE_BY`: `operator`, `main-red`) to this file, and Task 3 (the read) appends `LandingLineView` (see Interfaces).
- Create: `server/src/coord/landingEntry.ts` (L1, pure: value imports from `shared/landingLine.ts`, `shared/landing.ts` and `shared/api.ts` only; no `fs`, no `node:sqlite`, no clock). Contents:
  - the row reader `landingEntryOfRow` and `landingFlagsOfRow`;
  - the composite's decision `decideLandingWrite`;
  - the route's choice `landingAdvanceOf`;
  - the types `LandingAdvance`, `LandingWrite` and `LandingWriteDecision`.
- Modify: `server/src/coord/schema.ts`: one new `MIGRATIONS` entry, slot 35, with the house banner `// ── 35: user_version 34 -> 35 ──…`, after the `roll_settings` entry.
- Modify: `server/src/coord/store.ts`:
  - `CoordStore.advanceLanding`, `CoordStore.landingEntries` and `CoordStore.landingProject`;
  - the exported type `LandingAdvanceResult`, placed beside `AdvanceResult`;
  - imports: `mergingAtDetail` joins the existing `shared/landing.js` import, and one new type-and-value import from `./landingEntry.js`.
- Modify: `server/src/coord/advance.ts`:
  - `AdvanceBody` gains `ejection?: unknown`;
  - `AdvanceRequest` gains `ejection: {base: string; kind: LandingEjectionKind} | null`;
  - `advanceRequest` parses the ejection. It adds no gate and leaves `ADVANCE_GATES` unchanged;
  - `AdvanceReject` gains the arm `{ code: 'ejection-not-merging'; from: RunState }`, the route's 409 shape for the one new refusal.
- Modify: `shared/refusal.ts`: `AdvanceRejectCode`'s `Extract<RunRefuseCode, …>` list and `ADVANCE_REJECT_STATUS` gain `'ejection-not-merging'` (409). `refuseAdvance` indexes that map by every `AdvanceReject` arm's code, so the new arm does not typecheck without it; the route itself sends the refusal directly (below).
- Modify: `server/src/coord/routes.ts`, `registerCoordRoutes.advanceAct` only. It calls `coord.advanceLanding` in place of `coord.advance`, sends the new refusal on `reject.code`, adds `landing` to the 200 body (D-7627), and the `mergingAtDetail` import leaves this file.
- Modify: `shared/api.ts`, `AdvanceOk` (one optional field, `landing?: { kind: string; entry?: LandingEntry }`, with `import type { LandingEntry } from './landingLine.js';`; D-7627), and the `RunRefuseCode` union and `RUN_REFUSE_CODE_MAP`: one new member, `'ejection-not-merging'`, with the comment `// D-7619: an ejection body on a run not at merging`. It is the advance's one new refusal code (D-7619 (the one new refusal code, ejection-not-merging)). The coordinator skill's refusal table names it in Task 4; until Task 4 is on the branch, `coordinator-skill.test.ts`'s "is a real RunRefuseCode but is named nowhere in the skill" case is red, so this task does not run that suite and Task 4 measures it.
- Modify: `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`, the ring-context-map's C4 row: add the file row `` `coord/landingEntry.ts` `` directly after `` `coord/landing.ts` ``. The decider task adds `` `coord/landingLine.ts` `` beside it.
- Modify: `CLAUDE.md`, the coord.db bullet only (the operator's block below; D-7620 (the loss list names the landing line first, with its pin)). Task 3 owns the box-token bullet.
- Create (test): `server/test/landing-line-migration.test.ts`, `server/test/landing-entry-store.test.ts` and `server/test/landing-entry-census.test.ts`.
- Modify (test):
  - `server/test/coord-db.test.ts`: the three `34` literals become `35`, and both migration-list comments gain `MIGRATIONS[34] (landing_entries and landing_projects, landing order wave 5e)`;
  - `server/test/advance-gate.test.ts`: the `advanceRequest` describe;
  - `server/test/merging-episode.test.ts`: one new describe at the end;
  - `server/test/mail-routes.test.ts`: the kebab scan's `NOT_CODES` set only ("every quoted kebab token in server/src/coord that looks like a code is declared"). It gains the three in-process kinds `'no-pr'`, `'no-episode'` and `'no-entry'`, each with a one-line reason. `'ejection-not-merging'` needs no entry, because `isRunRefuseCode` admits it:
    ```ts
      'no-pr',               // coord/landingEntry.ts: a LandingWrite kind (landing order wave 5e), read back in-process by advanceAct, never a wire code
      'no-episode',          // coord/landingEntry.ts: a LandingWrite kind (landing order wave 5e), read back in-process by advanceAct, never a wire code
      'no-entry',            // coord/landingEntry.ts: a LandingWrite kind (landing order wave 5e), read back in-process by advanceAct, never a wire code
    ```
  - `server/test/coord-policy-rings.test.ts`: add `'landingEntry.ts'` to `POLICY` in "the coordination policy files have no runtime path to node:sqlite (D-5896)", so the L1 file is pinned pure.

**Interfaces:**
- Consumes (unchanged, on main):
  - `transitionsFor`, `isRunState`, `isRunKind` and `RunState` (`shared/api.ts`);
  - `mergingAtDetail(head, pr, mode)`, `readMergingAtDetail`, `isHead40` and `ChecksMode` (`shared/landing.ts`);
  - `CoordStore.advanceInner` (private; it opens no `tx`), `CoordStore.currentEpisode(runId)` and `tx` (`./tx.js`);
  - `DoneVerdict`'s `measured.branchTip` and `measured.prNumber` (`coord/fingerprint.ts`);
  - `checksModeAt`, already called in `advanceAct`;
  - `coordMutex`, which the advance route already holds around `advanceAct`.
- Produces, in `shared/landingLine.ts`:
  ```ts
  export const LANDING_ENTRY_STATE = {
    pinned: 'waiting in the line at its pinned head',
    ejected: 'sent back from the line for a fix round',
    landed: 'merged into its base',
    withdrawn: 'taken out of the line by the operator',
    unknown: 'a row this build cannot read',
  } as const;
  export type LandingEntryState = keyof typeof LANDING_ENTRY_STATE;
  export const LANDING_ENTRY_STATES: readonly LandingEntryState[] = Object.keys(LANDING_ENTRY_STATE) as LandingEntryState[];
  export const isLandingEntryState = (v: unknown): v is LandingEntryState =>
    typeof v === 'string' && (LANDING_ENTRY_STATES as readonly string[]).includes(v);
  export const LANDING_EJECTION_KINDS = ['dequeued', 'new-head', 'conflict'] as const;
  export type LandingEjectionKind = (typeof LANDING_EJECTION_KINDS)[number];
  export const isLandingEjectionKind = (v: unknown): v is LandingEjectionKind =>
    typeof v === 'string' && (LANDING_EJECTION_KINDS as readonly string[]).includes(v);
  export interface LandingEntry {
    id: number; project: string; pr: number; pinnedSha: string; handoffCommit: string; runId: number | null;
    state: LandingEntryState; baseSha: string | null; ejectionKind: LandingEjectionKind | null; ejections: number;
    afterIds: number[]; fixesMain: boolean; setBy: string; pinnedAt: number;
  }
  ```
  **Refinements of the shared names** (D-7613 (the entry's shape)):
  - `LandingEntry` gains `id`, because `afterIds` names ids.
  - The state map has a fifth word, `unknown`, schema.ts's "designated we-do-not-know member" rule. The decider treats `unknown` as not in the line.
  - `LandingOrder`, `LandingLineFlags` and the pause words (`LANDING_PAUSE_BY`: `operator`, `main-red`) live in this L0 file, because `LandingLineView` (L0) names `LandingOrder`. Task 2 declares them here and `server/src/coord/landingLine.ts` imports them.
  - `afterIds` name entry ids (`landing_entries.id`, the INTEGER PRIMARY KEY), never PR numbers. An edge to an id with no entry, or to a landed or withdrawn entry, holds nothing back (Task 2's decider reads that).
  - `ejectionKind`, `ejections` and `pinnedAt` are columns beyond the spec's list.

  **Nulls, one meaning each:**
  - `baseSha` and `ejectionKind` are non-null only while `state === 'ejected'` and that ejection named them. `null` with `state 'ejected'` means a bare retreat that named no base (D-7616 (a bare retreat ejects)).
  - `runId` is `null` only for a run-less entry, which 5f adds.
- Produces, in `server/src/coord/landingEntry.ts`:
  ```ts
  export type LandingAdvance =
    | { kind: 'plain' }
    | { kind: 'pin'; head: string; pr: number | null; mode: ChecksMode; handoffCommit: string }
    | { kind: 'retreat'; ejection: { base: string; kind: LandingEjectionKind } | null };
  export type LandingWrite =
    | { kind: 'none' } | { kind: 'no-pr' } | { kind: 'no-episode' } | { kind: 'no-entry' }
    | { kind: 'kept'; state: LandingEntryState }
    | { kind: 'pinned'; entry: LandingEntry; created: boolean }
    | { kind: 'ejected'; entry: LandingEntry };
  export type LandingWriteDecision =
    | { act: 'none'; write: Extract<LandingWrite, { kind: 'none' | 'no-pr' | 'no-episode' | 'no-entry' | 'kept' }> }
    | { act: 'insert' } | { act: 'repin'; id: number }
    | { act: 'eject'; id: number; base: string | null; kind: LandingEjectionKind | null };
  /** advanceAct's choice: to 'merging' with a verdict → pin (head = measured.branchTip, pr = measured.prNumber ?? null);
   *  to 'working' → retreat (the parsed ejection or null); anything else → plain. */
  export function landingAdvanceOf(f: { to: RunState; measured: { branchTip: string; prNumber: number | null } | null;
    mode: ChecksMode | null; handoffCommit: string; ejection: { base: string; kind: LandingEjectionKind } | null }): LandingAdvance;
  /** `episode` is `CoordStore.currentEpisode`'s answer, passed whole (typed structurally, so L1 imports no store):
   *  null means the run has no episode row, which is not an episode whose verdict measured no PR (`pr: null`). */
  export function decideLandingWrite(f: { landing: LandingAdvance; from: RunState; runId: number;
    current: LandingEntry | null; episode: { pr: number | null } | null }): LandingWriteDecision;
  export function landingEntryOfRow(row: Record<string, unknown>): LandingEntry;
  export function landingFlagsOfRow(row: Record<string, unknown> | undefined): { operatorPaused: boolean; mainRedHold: boolean };
  ```
  `decideLandingWrite`'s table. `current` is the row for (project, `pin.pr`) on a pin, or for (project, `episode.pr`) on a retreat; `null` means no such row. The `no-pr`, `no-episode` and `kept` arms are D-7618 (advances the line does not place); the re-pin's new `pinnedAt` is D-7617 (a re-pin moves to the back).

  | landing | condition | decision |
  |---|---|---|
  | plain | | `none` / `none` |
  | pin | `pr === null` | `none` / `no-pr` |
  | pin | `current === null` | `insert` |
  | pin | `current.state` ∈ {pinned, ejected} | `repin(current.id)` |
  | pin | any other state | `none` / `kept(state)` |
  | retreat | `from !== 'merging'` | `none` / `none` |
  | retreat | `episode === null` | `none` / `no-episode` |
  | retreat | `episode.pr === null` | `none` / `no-pr` |
  | retreat | `current === null` | `none` / `no-entry` |
  | retreat | `current.runId !== runId` or `current.state !== 'pinned'` | `none` / `kept(current.state)` |
  | retreat | otherwise | `eject(current.id, ejection?.base ?? null, ejection?.kind ?? null)` |

  `landingEntryOfRow`:
  - a `state` that is not a word, an `ejectionKind` that is not null and not a kind, or an `afterIds` that is not a JSON array of positive safe integers reads `state: 'unknown'` (then `ejectionKind: null` and `afterIds: []` for the unreadable field);
  - `fixesMain` is `!== 0`, and every integer column goes through `Number()`.

  `landingFlagsOfRow(undefined)` is `{operatorPaused: false, mainRedHold: false}`. Otherwise a flag is `false` only when its value is `0` or `0n`; any other value reads as set (fail closed).
- Produces, in `server/src/coord/store.ts`:
  ```ts
  export type LandingAdvanceResult =
    | (Extract<AdvanceResult, { ok: true }> & { landing: LandingWrite })
    | Exclude<AdvanceResult, { ok: true }>
    | { ok: false; error: Extract<RunRefuseCode, 'ejection-not-merging'>; from: RunState };
  advanceLanding(input: { runId: number; to: RunState; causedBy: string; landing: LandingAdvance }): LandingAdvanceResult;
  landingEntries(project: string): LandingEntry[];      // WHERE project = ? ORDER BY pinnedAt, id
  landingProject(project: string): { operatorPaused: boolean; mainRedHold: boolean };
  ```
  `advanceLanding`'s one `tx(this.db, …)` runs these steps in order:
  1. Read `runs.state`, `kind` and `project`. If there is no row, answer `unknown-run`.
  2. Decide the edge with `transitionsFor(kind)[from].includes(to)`. If it is refused, answer `bad-transition` and write nothing.
  3. Check the pairing. `pin` needs `to === 'merging'`, `retreat` needs `to === 'working'`, and `merging` needs a `pin`. `advanceAct` builds the `LandingAdvance` from `to` through `landingAdvanceOf`, so no request reaches an ill-formed pairing; this guard is a programming error and THROWS (`throw new Error(…)`, inside the `tx`, so nothing is written). It answers no code. A `retreat` with a non-null ejection needs `from === 'merging'`; otherwise answer `ejection-not-merging` (D-7619).
  4. Read `episode = this.currentEpisode(runId)` for a retreat, passed whole and never folded to its `pr`, and the `current` row (`SELECT … FROM landing_entries WHERE project = ? AND pr = ?`, keyed by `episode.pr` on a retreat).
  5. Call `decideLandingWrite`.
  6. Call `this.advanceInner(runId, to, causedBy, pin ? mergingAtDetail(head, pr, mode) : undefined)`.
  7. Execute the decision with ONE of three statements, binding every state word as a parameter taken from `LANDING_ENTRY_STATE`'s keys, never as an SQL literal:
     - insert: `INSERT INTO landing_entries (project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, with `setBy = causedBy` and `pinnedAt = Date.now()`;
     - re-pin: `UPDATE landing_entries SET pinnedSha = ?, handoffCommit = ?, runId = ?, state = ?, baseSha = NULL, ejectionKind = NULL, pinnedAt = ? WHERE id = ?`. `ejections`, `afterIds`, `fixesMain` and `setBy` are untouched;
     - eject: `UPDATE landing_entries SET state = ?, baseSha = ?, ejectionKind = ?, ejections = ejections + 1 WHERE id = ?`.
  8. Re-read the row through `landingEntryOfRow` and answer `{...adv, landing}`.

  SQL is written as plain literals, never assembled, so `sqlStatementsIn` sees every statement.
- Produces, in `server/src/coord/advance.ts`: `advanceRequest` reads `b.ejection`:
  - `undefined` gives `ejection: null`;
  - an object `{base, kind}` with `isHead40(base)` and `isLandingEjectionKind(kind)`, on `to === 'working'`, gives `ejection: {base, kind}`;
  - anything else gives `{error: 'bad-request'}` (`null`, a non-object, an ejection on any other target, a bad base or a bad kind). It is checked after the fingerprint shape and before the target scope, so "the shape before the target scope" still holds.
- Produces, in `routes.ts#advanceAct`:
  ```ts
  const landing = landingAdvanceOf({ to, measured: verdict?.measured ?? null, mode: episodeMode, handoffCommit: claim.handoffCommit, ejection });
  const adv = coord.advanceLanding({ runId: id, to, causedBy: 'coordinator', landing });
  ```
  `ejection` arrives as a new last parameter of `advanceAct`, passed from `parsed.req.ejection`. The refusal line becomes:
  ```ts
  if (!adv.ok) return adv.error === 'ejection-not-merging' ? reply.code(409).send({ ok: false, reject: { code: adv.error, from: adv.from } }) : reply.code(409).send({ ok: false, reject: adv });
  ```
  so the one new refusal arrives on `reject.code`, where the coordinator skill reads every advance refusal, as `{ code: 'ejection-not-merging', from: <state> }`. Every other store refusal keeps its shape (`reject: adv`), and the store-level answer keeps `error`.

  The 200 body gains one additive field, `landing: adv.landing`: the store's `LandingWrite` answer as JSON, its `kind`, and for `pinned` and `ejected` its `entry` (D-7627). It is optional on `AdvanceOk` and absence-permits, so an older server's answer, which carries none, still reads.

**The schema entry (slot 35), verbatim DDL:**
```sql
CREATE TABLE landing_entries (
  id            INTEGER PRIMARY KEY,
  project       TEXT    NOT NULL,
  pr            INTEGER NOT NULL,
  pinnedSha     TEXT    NOT NULL,
  handoffCommit TEXT    NOT NULL,
  runId         INTEGER REFERENCES runs(id),
  state         TEXT    NOT NULL,
  baseSha       TEXT,
  ejectionKind  TEXT,
  ejections     INTEGER NOT NULL DEFAULT 0,
  afterIds      TEXT    NOT NULL DEFAULT '[]',
  fixesMain     INTEGER NOT NULL DEFAULT 0,
  setBy         TEXT    NOT NULL,
  detail        TEXT,
  pinnedAt      INTEGER NOT NULL,
  UNIQUE (project, pr)
);
CREATE INDEX landing_entries_run ON landing_entries(runId);
CREATE TABLE landing_projects (
  project        TEXT    NOT NULL PRIMARY KEY,
  operatorPaused INTEGER NOT NULL DEFAULT 0,
  mainRedHold    INTEGER NOT NULL DEFAULT 0
);
```
There is no CHECK on `state` or `ejectionKind` (the `collect_lane_settings.choice` reason) and no `repo` column (D-7612 (no-repo-column)).

The banner comment states:
- the entry's one writer, `CoordStore.advanceLanding`;
- that `afterIds`, `fixesMain`, `setBy` on a run-less entry, `mainRedHold` and `operatorPaused` hold their defaults until 5f, 5i and 5j;
- that no seed row exists: an absent `landing_projects` row reads both flags clear;
- "A NEW TABLE AND NOTHING ELSE";
- the re-measure commands `git fetch origin main` and `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'`, which must print 34 before the PR.

**CLAUDE.md (for the operator to read)** — the coord.db bullet, D-7620 (the loss list names the landing line first, with its pin). `the landing line` goes FIRST in the list, which keeps the pinned runs of both `collect-switch-prose.test.ts` and `stall-settings-prose.test.ts` whole; neither pin is widened. The exact bytes the PR carries:

Before:
```
  what it adds on top — mail, claims, asks, central pool edges, update intents, the stall-watch settings choice,
  the collector switch — is gone without the snapshot every `ccrc update` (and `ccrc backup`) takes into
```
After:
```
  what it adds on top — the landing line, mail, claims, asks, central pool edges, update intents, the stall-watch
  settings choice, the collector switch — is gone without the snapshot every `ccrc update` (and `ccrc backup`) takes into
```

- [ ] **Step 1: the migration test, red.** Create `server/test/landing-line-migration.test.ts`, shaped like `collect-lane-migration.test.ts`:
  - `CREATE = /CREATE TABLE landing_entries(?![A-Za-z0-9_])/` and `SLOT = MIGRATIONS.findIndex((m) => CREATE.test(m)) + 1`;
  - `plantedBefore` at `SLOT - 1` with one programme and one run.

  Cases:
  - `it('the slot is found by DDL, created once, never amended into a frozen entry')`:
    ```ts
    expect(SLOT).toBeGreaterThanOrEqual(35);
    expect(MIGRATIONS.filter((m) => CREATE.test(m)).length).toBe(1);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => /landing_(entries|projects)/.test(m))).toBe(false);
    ```
  - `it('the entry alone adds exactly the two tables and the run index, and seeds nothing')`:
    ```ts
    expect(objectNames(raw).filter((n) => !had.includes(n)).sort()).toEqual(['landing_entries', 'landing_entries_run', 'landing_projects']);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM landing_projects').get()).toEqual({ n: 0 });
    ```
  - `it('openCoordDb reaches a database one version before it and keeps its rows')`: `user_version` equals `COORD_SCHEMA_VERSION`, and `SELECT claimedBy, state FROM runs` is `[{ claimedBy: 'c', state: 'working' }]`.
  - `it('the columns and their nullability')`, over `PRAGMA table_info(landing_entries)` as `[name, type, notnull, dflt_value, pk]`:
    ```ts
    expect(cols).toEqual([
      ['id','INTEGER',0,null,1], ['project','TEXT',1,null,0], ['pr','INTEGER',1,null,0], ['pinnedSha','TEXT',1,null,0],
      ['handoffCommit','TEXT',1,null,0], ['runId','INTEGER',0,null,0], ['state','TEXT',1,null,0], ['baseSha','TEXT',0,null,0],
      ['ejectionKind','TEXT',0,null,0], ['ejections','INTEGER',1,'0',0], ['afterIds','TEXT',1,"'[]'",0],
      ['fixesMain','INTEGER',1,'0',0], ['setBy','TEXT',1,null,0], ['detail','TEXT',0,null,0], ['pinnedAt','INTEGER',1,null,0]]);
    expect(projCols).toEqual([['project','TEXT',1,null,1], ['operatorPaused','INTEGER',1,'0',0], ['mainRedHold','INTEGER',1,'0',0]]);
    ```
  - `it('one row per (project, pr)')`: a second `INSERT` of `('project-a', 7, …)` throws `/UNIQUE constraint failed: landing_entries.project, landing_entries.pr/`.
  - `it('no SQL check on state or ejectionKind')`: `MIGRATIONS[SLOT - 1]` does not match `/CHECK\s*\(\s*(state|ejectionKind)\b/`.
  - `it('an older build opening the new version takes the read-as-is rule and boots')`: the precedent's case, with `programs` read back.
- [ ] **Step 2: run it, red.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/landing-line-migration.test.ts`. Expected: every case red, with `SLOT` 0 ("expected 0 to be greater than or equal to 35").
- [ ] **Step 3: the entry.** Append slot 35 to `MIGRATIONS` exactly as above. In `coord-db.test.ts`:
  - `expect(COORD_SCHEMA_VERSION).toBe(35);` (twice) and `expect(MIGRATIONS.length).toBe(35);`;
  - both comments gain `MIGRATIONS[34] (landing_entries and landing_projects, landing order wave 5e)`.
- [ ] **Step 4: run, green.** `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/landing-line-migration.test.ts test/coord-db.test.ts test/collect-lane-migration.test.ts`.
- [ ] **Step 5: the store tests, red.** Create `server/test/landing-entry-store.test.ts` on a temporary `coord.db` (`openCoordDb(path.join(mkTmp('ccrc-landing-'), '.ccrc', 'coord.db'))`, `afterEach(removeTmpFixtures)`).
  - Constants: `HEAD = 'a'.repeat(40)`, `HEAD2 = 'b'.repeat(40)`, `HC = 'c'.repeat(40)`, `BASE = 'd'.repeat(40)`, `BASE2 = 'e'.repeat(40)`, `P = 'project-a'`.
  - Fixture `atReview()`: `openRun({program:'p', title:'t', project:P, wave:1, waveOf:1, claimedBy:'coord-a'})`, `setSession(id,'project-a-ws1')`, then `advance` through `dispatched`, `working` and `awaiting-review`.
  - Typed helpers (a widened `kind: string` would fail `typecheck-tests`):
    ```ts
    import type { LandingAdvance } from '../src/coord/landingEntry.js';
    import type { LandingEjectionKind } from '../../shared/landingLine.js';
    const pin = (head: string = HEAD, pr: number | null = 7): LandingAdvance =>
      ({ kind: 'pin', head, pr, mode: 'off', handoffCommit: HC });
    const eject = (base: string | null = BASE, kind: LandingEjectionKind = 'conflict'): LandingAdvance =>
      ({ kind: 'retreat', ejection: base === null ? null : { base, kind } });
    const countEvents = (id: number): number =>
      (coord.db.prepare('SELECT COUNT(*) AS n FROM run_events WHERE runId = ?').get(id) as { n: number }).n;
    ```

  Cases:
  - `it('advance → merging creates one pinned entry at the episode head, in the same call')`:
    ```ts
    const r = coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin() });
    expect(r).toMatchObject({ ok: true, from: 'awaiting-review', to: 'merging', landing: { kind: 'pinned', created: true } });
    expect(coord.landingEntries(P)).toEqual([{ id: expect.any(Number), project: P, pr: 7, pinnedSha: HEAD, handoffCommit: HC,
      runId: id, state: 'pinned', baseSha: null, ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false,
      setBy: 'coordinator', pinnedAt: expect.any(Number) }]);
    expect(coord.currentEpisode(id)).toMatchObject({ head: HEAD, pr: 7, mode: 'off' });
    expect(coord.landingEntries(P)[0]!.pinnedSha).toBe(coord.currentEpisode(id)!.head);
    ```
  - `it('a refused edge writes no entry and no run row (no phantom)')`: the run is at `working`.
    ```ts
    const before = countEvents(id);
    expect(coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin() }))
      .toEqual({ ok: false, error: 'bad-transition', from: 'working', to: 'merging' });
    expect(coord.landingEntries(P)).toEqual([]);
    expect(countEvents(id)).toBe(before);
    ```
  - `it('a throw in the entry write rolls the run\'s advance back')`:
    ```ts
    coord.db.exec("CREATE TRIGGER boom BEFORE INSERT ON landing_entries BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    expect(() => coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin() })).toThrow(/boom/);
    expect(coord.run(id)).toMatchObject({ ok: true, run: { state: 'awaiting-review' } });
    expect(coord.currentEpisode(id)).toBeNull();
    ```
  - `it('merging → working with an ejection marks it ejected, records the base and the kind, and counts')`:
    ```ts
    expect(coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject() })).toMatchObject({
      ok: true, from: 'merging', to: 'working', landing: { kind: 'ejected', entry: { state: 'ejected', baseSha: BASE,
      ejectionKind: 'conflict', ejections: 1, pinnedSha: HEAD } } });
    ```
  - `it('the next advance → merging re-pins the same row, keeps the count and clears the ejection')`: after the ejection, `advance(id,'awaiting-review')`, then `pin(HEAD2)`.
    ```ts
    expect(r).toMatchObject({ ok: true, landing: { kind: 'pinned', created: false,
      entry: { id: firstId, pinnedSha: HEAD2, state: 'pinned', baseSha: null, ejectionKind: null, ejections: 1 } } });
    expect(coord.landingEntries(P)).toHaveLength(1);
    ```
  - `it('a second ejection counts two')`: `eject(BASE2, 'new-head')` gives `entry: { ejections: 2, baseSha: BASE2, ejectionKind: 'new-head' }`.
  - `it('a bare retreat from merging ejects with no base')`: `eject(null)` gives `landing: { kind: 'ejected', entry: { state: 'ejected', baseSha: null, ejectionKind: null, ejections: 1 } }`.
  - `it('an ejection on a run not at merging is refused and moves nothing')`: the run is at `awaiting-review`.
    ```ts
    expect(coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject() }))
      .toEqual({ ok: false, error: 'ejection-not-merging', from: 'awaiting-review' });
    expect(coord.run(id)).toMatchObject({ ok: true, run: { state: 'awaiting-review' } });
    ```
  - `it('a retreat from awaiting-review with no ejection is a plain advance')`: `landing: { kind: 'none' }`, `to: 'working'`.
  - `it('an episode with no PR creates no entry')`: `pin(HEAD, null)` gives `landing: { kind: 'no-pr' }`, `landingEntries(P)` is `[]` and `currentEpisode(id)` is `{ pr: null }`.
  - `it('a landed or withdrawn row is kept, and the run still advances')`:
    ```ts
    coord.db.prepare("INSERT INTO landing_entries (project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) VALUES (?, 7, ?, ?, NULL, ?, 'operator', 1)").run(P, HEAD2, HC, 'landed');
    expect(coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin() }))
      .toMatchObject({ ok: true, to: 'merging', landing: { kind: 'kept', state: 'landed' } });
    expect(coord.landingEntries(P)[0]).toMatchObject({ pinnedSha: HEAD2, state: 'landed' });
    ```
    The same holds for `'withdrawn'`.
  - `it('a retreat whose episode predates the line is no-entry, and never ejects another PR\'s row of the same run')`:
    ```ts
    coord.db.prepare("INSERT INTO landing_entries (project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) VALUES (?, 8, ?, ?, ?, 'pinned', 'coordinator', 1)").run(P, HEAD2, HC, id);
    coord.advance(id, 'merging', 'coordinator', mergingAtDetail(HEAD, 7, 'off'));
    expect(coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject() }))
      .toMatchObject({ ok: true, landing: { kind: 'no-entry' } });
    expect(coord.landingEntries(P)).toEqual([expect.objectContaining({ pr: 8, state: 'pinned', ejections: 0 })]);
    ```
  - `it('a retreat from merging with no episode is no-episode, apart from no-pr, and writes nothing')`: `coord.advance(id, 'merging', 'coordinator')` with no detail, so `currentEpisode(id)` is `null`; then
    ```ts
    expect(coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject() }))
      .toMatchObject({ ok: true, to: 'working', landing: { kind: 'no-episode' } });
    expect(coord.landingEntries(P)).toEqual([]);
    ```
  - `it('a pin on an advance not to merging is a programming error: it throws and writes nothing')`: from `working`, `advanceLanding({ to: 'awaiting-review', landing: pin() })` throws; `coord.run(id)` still reads `working`, and `landingEntries(P)` is `[]`.
  - `it('landingProject reads absent as clear and any non-zero as set')`:
    ```ts
    expect(coord.landingProject(P)).toEqual({ operatorPaused: false, mainRedHold: false });
    coord.db.prepare('INSERT INTO landing_projects (project, operatorPaused, mainRedHold) VALUES (?, 1, 0)').run(P);
    expect(coord.landingProject(P)).toEqual({ operatorPaused: true, mainRedHold: false });
    coord.db.prepare('UPDATE landing_projects SET operatorPaused = 0, mainRedHold = 7').run();
    expect(coord.landingProject(P)).toEqual({ operatorPaused: false, mainRedHold: true });
    ```
  - `it('landingEntries reads a word this build cannot name as unknown, and orders by pinnedAt then id')`. Raw rows:
    - `state 'later'` gives `{ state: 'unknown' }`;
    - `ejectionKind 'sideways'` gives `{ state: 'unknown', ejectionKind: null }`;
    - `afterIds 'nope'` gives `{ state: 'unknown', afterIds: [] }`;
    - `afterIds '[3,4]'`, `fixesMain 1` gives `{ afterIds: [3, 4], fixesMain: true }`;
    - two rows at `pinnedAt` 5 and 2 come back as `[2, 5]`;
    - a `project-b` row is absent from `landingEntries(P)`.
- [ ] **Step 6: run, red.** `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/landing-entry-store.test.ts`. Expected red: `coord.advanceLanding is not a function` (and the same for `landingProject` and `landingEntries`).
- [ ] **Step 7: the words, the decision and the store.**
  - Create `shared/landingLine.ts` and `server/src/coord/landingEntry.ts` with the signatures and the table above.
  - Add `advanceLanding`, `landingEntries` and `landingProject` to `CoordStore`, directly after `closeRun`. Their docstring says they are the ONE writer of `pinnedSha` and `ejections`, built in the way `dispatchRun` and `closeRun` are.
  - Add `LandingAdvanceResult` beside `AdvanceResult`.
  - A body is given only where the tests do not fix it: `advanceLanding`'s step order is the one under Interfaces, and nothing else in it is free.
- [ ] **Step 8: run, green.** `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/landing-entry-store.test.ts test/landing-line-migration.test.ts`.
- [ ] **Step 9: the body and the route, red.**
  - In `advance-gate.test.ts`, the first `advanceRequest` case's expected `req` gains `ejection: null`. New cases:
    ```ts
    it('reads an ejection on a retreat to working', () => {
      expect(advanceRequest('1', { to: 'working', fingerprint: FP, ejection: { base: 'd'.repeat(40), kind: 'dequeued' } } as never))
        .toStrictEqual({ ok: true, req: { id: 1, to: 'working', fingerprint: FP, ejection: { base: 'd'.repeat(40), kind: 'dequeued' } } });
    });
    it.each([
      ['an ejection on merging', { to: 'merging', fingerprint: FP, ejection: { base: 'd'.repeat(40), kind: 'conflict' } }],
      ['a 39-hex base', { to: 'working', fingerprint: FP, ejection: { base: 'd'.repeat(39), kind: 'conflict' } }],
      ['an upper-case base', { to: 'working', fingerprint: FP, ejection: { base: 'D'.repeat(40), kind: 'conflict' } }],
      ['an unknown kind', { to: 'working', fingerprint: FP, ejection: { base: 'd'.repeat(40), kind: 'sideways' } }],
      ['a null ejection', { to: 'working', fingerprint: FP, ejection: null }],
      ['a string ejection', { to: 'working', fingerprint: FP, ejection: 'conflict' }],
    ])('refuses %s as bad-request', (_n, body) => { expect(advanceRequest('1', body as never)).toStrictEqual(bad); });
    ```
  - In `merging-episode.test.ts`, a new describe `'the landing entry (landing order wave 5e)'` reusing `scenario`. Its `eject` helper is an `app.inject` posting `{ to: 'working', fingerprint: {…}, ejection: { base: OTHER_TIP, kind: 'dequeued' } }`. Cases:
    - `it('the advance to merging pins one entry at the verified head')`: `(await toMerging()).statusCode` is `200`; `coord.landingEntries(PROJECT)` is `[expect.objectContaining({ pr: 7, pinnedSha: TIP, handoffCommit: TIP, state: 'pinned', runId: id, ejections: 0 })]`; and `readMergingAtDetail(mergingRows(details())[0]!.detail!)!.head` is `TIP`.
    - `it('a refused re-measurement pins nothing')`: `post('merging', OTHER_TIP)` after `awaiting-review` gives `409`, and `landingEntries(PROJECT)` is `[]`.
    - `it('merging → working with an ejection ejects the entry')`: `200`, and the entry is `{ state: 'ejected', baseSha: OTHER_TIP, ejectionKind: 'dequeued', ejections: 1 }`.
    - `it('an ejection from awaiting-review answers 409 and moves nothing')`: the body's `reject` is `{ code: 'ejection-not-merging', from: 'awaiting-review' }` (`reject.code`, where the skill reads it), and `coord.run(id).run.state` is `'awaiting-review'`.
    - `it('the advance answers what the line recorded (D-7627)')`: `(await toMerging()).json().landing` matches `{ kind: 'pinned', created: true, entry: { pr: 7, pinnedSha: TIP, state: 'pinned' } }`, and the ejecting advance's `res.json().landing` matches `{ kind: 'ejected', entry: { state: 'ejected', baseSha: OTHER_TIP, ejectionKind: 'dequeued', ejections: 1 } }`.

    No advance test on `origin/main` pins the 200 body whole (the merging-episode cases read single fields, such as `not.toHaveProperty('checksMail')`). Search again before Step 12 (`git grep -n "json()).toEqual({ ok: true, run" origin/main -- server/test`, and any `toStrictEqual` of an advance answer in `run-routes.test.ts` and `merging-episode.test.ts`), and widen any whole-body pin it finds by `landing`.
- [ ] **Step 10: run, red.** `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/advance-gate.test.ts test/merging-episode.test.ts`. Expected red: the `ejection: null` mismatch, the new refusal rows answering `ok: true`, and the five route cases (no entry is written, and the 200 body has no `landing`).
- [ ] **Step 11: wire it.**
  - `advanceRequest` parses `ejection` as stated.
  - `advanceAct` takes `ejection` and calls `landingAdvanceOf` and then `coord.advanceLanding`, with no `coord.advance` call left in it. It sends the refusal and the 200 body's `landing` as under Interfaces; `AdvanceReject`, `AdvanceRejectCode`, `ADVANCE_REJECT_STATUS` and `AdvanceOk` gain their members.
  - The `mergingAtDetail` import leaves `routes.ts`.
  - `/api/runs/:id/advance` passes `parsed.req.ejection`.
- [ ] **Step 12: run, green.** `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/advance-gate.test.ts test/merging-episode.test.ts test/advance-gate-order-route.test.ts test/advance-registry-id.test.ts`.
- [ ] **Step 13: the census, red first by mutation.** Create `server/test/landing-entry-census.test.ts`, keyed on symbols (`scan/symbols.ts`), never a literal source pin. A `readFileSync` and `toContain` over `store.ts` would raise `advance-switches`' exact ceiling of 56.
  ```ts
  const STORE = 'server/src/coord/store.ts';
  const WRITER = 'CoordStore.advanceLanding';
  const FILES = walkSrc({ roots: ['server/src'], min: 150 });
  const inWriter = (q: { file: string; start: number }) => {
    const s = symbolOf(STORE, WRITER);
    return q.file.endsWith(STORE) && q.start >= s.start && q.start < s.end;
  };
  const writes = (re: RegExp) => FILES.flatMap((f) => sqlStatementsInFile(f))
    .filter((q) => ['INSERT', 'UPDATE', 'REPLACE'].includes(q.verb) && re.test(q.source));
  ```
  Cases:
  - `it('pinnedSha has one writer, advanceLanding')`:
    ```ts
    expect(writes(/\bpinnedSha\b/i).length).toBeGreaterThanOrEqual(2);
    expect(writes(/\bpinnedSha\b/i).filter((q) => !inWriter(q)).map((q) => `${q.file}:${q.text}`)).toEqual([]);
    ```
  - `it('ejections has one writer, advanceLanding')`: the same with `/\bejections\b/i`, at least 1.
  - `it('every write of landing_entries is advanceLanding\'s (5e; a later sub-wave adds its writer here by name)')`: statements with `table === 'landing_entries'` and verb `INSERT`, `UPDATE`, `REPLACE` or `DELETE`, outside the writer, are `[]`.
  - `it('the merging-at detail is built only inside advanceLanding')`: a `CallSite` carries no `file`, so each call is mapped with its file first:
    ```ts
    const calls = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'mergingAtDetail').map((c) => ({ file: f, start: c.start })));
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((q) => !inWriter(q))).toEqual([]);
    ```
  - `it('advanceAct reaches the store through advanceLanding only')`:
    ```ts
    const names = callsIn(symbolOf('server/src/coord/routes.ts', 'registerCoordRoutes.advanceAct')).map((c) => c.name);
    expect(names).toContain('advanceLanding');
    expect(names).not.toContain('advance');
    ```
  - `it('advanceLanding has one caller, advanceAct')`: across `FILES`, the calls named `advanceLanding` are exactly 1, and that one is inside `registerCoordRoutes.advanceAct`.
  - `it('advanceLanding decides the edge before it writes, in one tx')`:
    ```ts
    const src = inlinedSourceOf(symbolOf(STORE, WRITER));
    const at = (n: string) => { const i = src.indexOf(n); expect(i, n).toBeGreaterThan(-1); return i; };
    expect(at('transitionsFor(')).toBeLessThan(at('this.advanceInner('));
    expect(at('this.advanceInner(')).toBeLessThan(at('INSERT INTO landing_entries'));
    expect(src.split('tx(this.db').length - 1).toBe(1);
    ```
  - `it('CLAUDE.md\'s coord.db bullet names the landing line first in what a lost coord.db loses (D-7620)')`. It reads a document, not a `src` file, so the literal-source-pin ratchet is not touched; `flat` and `passage` are local, in `stall-settings-prose.test.ts`'s shape:
    ```ts
    const bullet = passage('the coord.db bullet', read('CLAUDE.md'), 'what it adds on top', 'is gone without the snapshot');
    expect(bullet).toContain('what it adds on top — the landing line, mail, claims');
    ```
- [ ] **Step 14: run, then each mutation row red.** `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/landing-entry-census.test.ts test/mail-routes.test.ts`. Expected: every case green except the CLAUDE.md pin, which is red ("expected … to contain 'what it adds on top — the landing line, mail, claims'") until Step 15; `mail-routes.test.ts`'s kebab scan is red without the three `NOT_CODES` entries (`no-pr`, `no-episode`, `no-entry`), so add them now. Then, after Step 15, work through the mutation table, one row at a time:
  - bound each run with `timeout -k` and a measured `ulimit -u`;
  - restore each file from a saved copy with its sha256 checked, never with `git checkout`;
  - keep each row's log under `.superpowers/sdd/`.
- [ ] **Step 15: ring map, policy ring and CLAUDE.md.** Add `` `coord/landingEntry.ts` `` to the C4 row, add `'landingEntry.ts'` to `coord-policy-rings.test.ts`'s `POLICY`, and apply the coord.db bullet's bytes above. Re-run `test/landing-entry-census.test.ts test/stall-settings-prose.test.ts test/collect-switch-prose.test.ts`: green.
- [ ] **Step 16: the whole set.** From `server/`:
  ```
  ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/landing-line-migration.test.ts test/landing-entry-store.test.ts test/landing-entry-census.test.ts test/coord-db.test.ts test/collect-lane-migration.test.ts test/advance-gate.test.ts test/advance-gate-order-route.test.ts test/advance-registry-id.test.ts test/merging-episode.test.ts test/run-routes.test.ts test/run-states.test.ts test/coord-store.test.ts test/routes.test.ts test/landing-words.test.ts test/landing-verdict.test.ts test/landing-checks-lane.test.ts test/stall-settings-prose.test.ts test/collect-switch-prose.test.ts test/coord-policy-rings.test.ts test/switches.test.ts test/scan-symbols.test.ts test/mail-routes.test.ts test/anchors.test.ts test/citations.test.ts test/census-w8/journal.test.ts test/single-definition/ test/rings/
  ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/typecheck-tests.test.ts
  git fetch origin main && GROWTH_CHECK=1 ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/growth-check.test.ts
  ```
  Report `store.ts`'s and `routes.ts`'s net code-line deltas in the task report. growth-check waives growth here, because this PR adds `shared/landingLine.ts` and `server/src/coord/landingEntry.ts` (`growthCheck.ts`'s `L1_L2_NEW_FILE_DIRS`, `server/src/coord/` and `shared/`). No waiver file and no D-TBD is written for `store.ts` or `routes.ts`; the coordinator reads the deltas against the +40 target anyway. `routes.ts` is expected to shrink or hold, and `store.ts` at about +35.
- [ ] **Step 17: commit.**
  ```
  git add shared/landingLine.ts shared/api.ts server/src/coord/landingEntry.ts server/src/coord/schema.ts server/src/coord/store.ts server/src/coord/advance.ts server/src/coord/routes.ts shared/refusal.ts server/test/landing-line-migration.test.ts server/test/landing-entry-store.test.ts server/test/landing-entry-census.test.ts server/test/coord-db.test.ts server/test/advance-gate.test.ts server/test/merging-episode.test.ts server/test/mail-routes.test.ts server/test/coord-policy-rings.test.ts docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md CLAUDE.md
  git commit -m "feat(coord): the landing line's tables, its entry and the one writer of its pin and ejections (landing order wave 5e)"
  ```

**Mutation table (Task 1):**

| id | mutation | predicted red |
|---|---|---|
| 5E-DATA-1 | Drop `UNIQUE (project, pr)` from slot 35 | migration `one row per (project, pr)`: the second insert succeeds, so `toThrow` fails |
| 5E-DATA-2 | Add `repo TEXT` to `landing_entries` | migration `the columns and their nullability`: the `toEqual` list has a 16th row |
| 5E-DATA-3 | Move both tables' DDL into slot 34's entry (`MIGRATIONS[33]`) and drop slot 35 | migration `the slot is found by DDL…` fails on `expect(SLOT).toBeGreaterThanOrEqual(35)` (SLOT reads 34), and `coord-db`'s `toBe(35)` reads 34. (For the true frozen-entry edit, keeping slot 35 and also copying the DDL into an earlier entry, the red is `filter(CREATE).length` becoming 2 or the `slice(0, SLOT - 1).some(…)` expect becoming `true`.) |
| 5E-DATA-4 | In `advanceLanding`, run `decideLandingWrite` and the INSERT before the edge check, returning on refusal | store `a refused edge writes no entry` sees one row; census `decides the edge before it writes` red on order |
| 5E-DATA-5 | Split the composite: `this.advance(…)` (its own `tx`) committed before a second `tx` for the entry | store `a throw in the entry write rolls the run's advance back`: the run reads `merging` after the throw; census `in one tx` counts 2 |
| 5E-DATA-6 | Insert `pinnedSha = input.landing.handoffCommit` | store `creates one pinned entry`: `pinnedSha` is `HC`, not `HEAD`, and its equality with `currentEpisode().head` fails |
| 5E-DATA-7 | Add `CoordStore.repinLanding` holding `UPDATE landing_entries SET pinnedSha = ?` | census `pinnedSha has one writer` lists that statement |
| 5E-DATA-8 | Leave `mergingAtDetail(…)` in `advanceAct` and pass its detail through | census `the merging-at detail is built only inside advanceLanding` lists `routes.ts` |
| 5E-DATA-9 | Eject with `ejections = ejections` | store `with an ejection … counts`: `ejections` 0, not 1 |
| 5E-DATA-10 | Re-pin sets `ejections = 0` | store `re-pins the same row, keeps the count`: 0, not 1 |
| 5E-DATA-11 | Re-pin omits `baseSha = NULL, ejectionKind = NULL` | store `re-pins`: `baseSha` is `BASE`, not `null` |
| 5E-DATA-12 | Delete the `ejection-not-merging` check | store `an ejection on a run not at merging is refused` answers `ok: true` and the run moves to `working`; route `an ejection from awaiting-review answers 409` gets 200, not 409 with `reject` `{ code: 'ejection-not-merging', from: 'awaiting-review' }` |
| 5E-DATA-13 | `decideLandingWrite` re-pins every state (drop the `kept` arm) | store `a landed or withdrawn row is kept`: `pinnedSha` becomes `HEAD` and `state` becomes `pinned` |
| 5E-DATA-14 | `advanceRequest` accepts an ejection on any target | advance-gate `refuses an ejection on merging as bad-request` answers `ok: true` |
| 5E-DATA-15 | `advanceRequest` skips `isLandingEjectionKind` | advance-gate `refuses an unknown kind` answers `ok: true` |
| 5E-DATA-16 | `landingFlagsOfRow` reads `=== 1` as set | store `landingProject … any non-zero as set`: `mainRedHold` 7 reads `false` |
| 5E-DATA-17 | `landingEntryOfRow` casts `state` (`row.state as LandingEntryState`) | store `reads a word this build cannot name as unknown`: `'later'`, not `'unknown'` |
| 5E-DATA-18 | `advanceAct` keeps `coord.advance` for `to !== 'merging'` | census `advanceAct reaches the store through advanceLanding only` sees `advance`; route `merging → working with an ejection ejects the entry` finds `pinned` |
| 5E-DATA-19 | `advanceLanding` keys the retreat's row by `runId` alone (`WHERE runId = ? AND state = 'pinned'`), ignoring the episode's PR | store `a retreat whose episode predates the line is no-entry, and never ejects another PR's row of the same run`: the seeded PR 8 row is ejected (`state` `ejected`, `ejections` 1) and the answer is `ejected`, not `no-entry`; census unchanged, so this row's red is the store case |
| 5E-DATA-20 | CLAUDE.md: put `the landing line` before `update intents` instead of first | census `CLAUDE.md's coord.db bullet names the landing line first`: the bullet does not contain `what it adds on top — the landing line, mail, claims` (and `stall-settings-prose`'s pinned run breaks too) |
| 5E-DATA-21 | Delete the pairing guard (step 3's throw) in `advanceLanding` | store `a pin on an advance not to merging is a programming error`: no throw, the run moves to `awaiting-review` and an entry is inserted |
| 5E-DATA-22 | Drop `'no-entry'` from `mail-routes.test.ts`'s `NOT_CODES` (or rename the kind to an undeclared kebab word in `landingEntry.ts`) | mail-routes `every quoted kebab token in server/src/coord that looks like a code is declared` names `no-entry` |
| 5E-DATA-23 | Import `node:sqlite` into `landingEntry.ts` (`import { DatabaseSync } from 'node:sqlite';`, and use it) | coord-policy-rings `the coordination policy files have no runtime path to node:sqlite (D-5896)` reds `coord/landingEntry.ts reaches node:sqlite` |

Rows 4 and 5 cannot stay green because the refusal case and the trigger case each observe the database after the call. Neither depends on the method's text.
### Task 2: the decider and the second-ejection notice

The line's order and the second-ejection notice (the Goal's third and fourth bullets). This task runs after Task 1 and
needs Task 1's code on the branch (the L0 words in `shared/landingLine.ts` and the composite advance writer). It adds
two things:
- **The decider.** A pure L1 fold, `landingOrder`, decides the landing line's order and its head from the project's
  entries and the project's two flags (D-7621 (the decider is a pure fold over flags)).
- **The second-ejection notice.** When an entry's ejections count reaches 2, the server raises ONE operator notice
  through the existing notice sink (`notice`, `server/src/notice.ts`), the funnel the review-round cap's ask already
  uses. The advance is never refused, there is no `review_cap` row and no cap code (D-7624 (the second ejection is a
  notice, raised once at two, the advance never refused)). Nothing is sent to the coordinator, and the coordinator
  opens no dialog (clause 19); it names the second ejection in its turn text and sends the round as usual.

The decider has no I/O, no clock and no store. In this wave its only callers are the tests and Task 3's read route,
`GET /api/landing`, which puts its answer in `LandingLineView.order`.

**Files:**
- Create `server/src/coord/landingLine.ts` (L1, context C4). It exports `landingOrder`, `landingEjectionAsk`,
  `LANDING_EJECTION_ASK_AT` and the type `LandingEjectionAsk`.
- Modify `shared/landingLine.ts` (L0, created by Task 1). Add `LandingLineFlags`, `LANDING_PAUSE_BY`,
  `LandingPauseBy`, `LANDING_PAUSE_BYS` and `LandingOrder`. They live in L0 because `LandingLineView` in L0 carries
  `order: LandingOrder` and L0 imports nothing; `server/src/coord/landingLine.ts` imports them (D-7613 (the entry's
  shape)).
- Modify `server/src/coord/routes.ts`. In `advanceAct`, after Task 1's composite writer answers ok, decide the notice
  in L1 and raise it through `notice`. That is one guarded call of about six lines, marked
  `// @anchor landing-ejection-ask`.
- Modify `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`. In the ring-context-map block, add
  `` `coord/landingLine.ts` `` to the C4 Workspace Lifecycle row's `server/src` cell, right after
  `` `coord/landingEntry.ts` `` (which Task 1 placed after `` `coord/landing.ts` ``; Task 3 adds no row). The C5 row's
  `coord/**` directory row would otherwise give the file the context C5, which goes against O12.
- Modify `server/test/coord-policy-rings.test.ts`. Add `'landingLine.ts'` to `POLICY` in "the coordination policy
  files have no runtime path to node:sqlite (D-5896)".
- Test: create `server/test/landing-line-order.test.ts` (the fold's cases as data, the notice decider's cases, and
  the purity scan of `coord/landingLine.ts`).
- Test: create `server/test/landing-ejection-ask.test.ts` (the route: the notice raised once, through the funnel,
  with no mail to the coordinator). Its harness copies `merging-episode.test.ts#scenario`, adds a `NotifyLog` as
  `run-routes.test.ts`'s `capApp` does, and adds a push double. It needs Task 1's composite writer, so its red-first
  is measured after Task 1 is on the branch.

**Interfaces:**

```ts
// shared/landingLine.ts (L0; added by this task beside Task 1's words; imports nothing)
/** The project's two booleans (spec §5.5 Data): the line is paused while either is set. CoordStore.landingProject answers this. */
export interface LandingLineFlags { operatorPaused: boolean; mainRedHold: boolean }
/** Why the line is paused, each word naming the flag that sets it. The order of the keys is the order of `by`. */
export const LANDING_PAUSE_BY = { operator: 'operatorPaused', 'main-red': 'mainRedHold' } as const satisfies Record<string, keyof LandingLineFlags>;
export type LandingPauseBy = keyof typeof LANDING_PAUSE_BY;
export const LANDING_PAUSE_BYS = Object.keys(LANDING_PAUSE_BY) as LandingPauseBy[];
export type LandingOrder =
  | { paused: false; order: LandingEntry[]; head: LandingEntry | null }
  | { paused: true; by: LandingPauseBy[]; order: LandingEntry[] };
```

```ts
// server/src/coord/landingLine.ts (L1, C4). Its imports are `../../../shared/landingLine.js` and nothing else.
export function landingOrder(entries: readonly LandingEntry[], flags: LandingLineFlags): LandingOrder;
export const LANDING_EJECTION_ASK_AT = 2;
export type LandingEjectionAsk = { due: false } | { due: true; title: string; body: string; tag: string };
export function landingEjectionAsk(entry: LandingEntry): LandingEjectionAsk;
```

**What `landingOrder` does.**
- **Its inputs.** It takes the project's entries and the flags as values: the L4 route reads the project row
  (`CoordStore.landingProject`) and the decider reads only values, never a project name (D-7621).
- **The line.** The line is the entries whose `state` is `pinned`. An `unknown` row (one this build cannot read) is
  never in the line.
- **Outstanding entries.** An entry is outstanding when its state is `pinned`, `ejected` or `unknown`. An `unknown`
  target is outstanding because this build cannot read whether it landed, so an edge to it fails closed.
- **After edges.** `afterIds` names ENTRY IDS (`landing_entries.id`, the INTEGER PRIMARY KEY, carried on the wire as
  `LandingEntry.id`), never PR numbers (D-7613). An edge to an id with no entry, or to a `landed` or `withdrawn` entry,
  holds nothing back. An edge to a `pinned`, `ejected` or `unknown` entry holds the entry behind it (the
  coordinator's ruling on the `unknown` word: case C18).
- **Sort key.** `fixesMain` first, then `pinnedAt` ascending, then `pr` ascending.
- **The walk.** Repeatedly take the smallest-keyed remaining line entry whose outstanding targets have all been
  taken. When no entry can be taken, append the rest in key order. That rest is the entries that wait on an
  `ejected` or `unknown` target, or on a cycle that includes a self-edge. An after edge outranks the `fixesMain` jump (D-7622 (an
  after edge outranks the fixesMain jump)).
- **The head.** The head is `order[0]` when at least one entry was taken, and `null` otherwise. An empty line answers
  `order: []`. A blocked line answers a non-empty `order` with `head: null`, so callers can tell the two apart from
  `order`.
- **The pause.** `by = LANDING_PAUSE_BYS.filter((k) => flags[LANDING_PAUSE_BY[k]])`. A non-empty `by` answers
  `{ paused: true, by, order }`, with the same order and no head. A `fixesMain` entry is held by `main-red` too
  (D-7623 (a fixesMain entry is held by main-red): inert in 5e, since `mainRedHold` has no writer until 5i; a question
  for 5i).
- **What it never does.** It does not mutate its input.
- **The kebab scan.** The file has no single-quoted kebab token, so `mail-routes.test.ts`'s scan of
  `server/src/coord` has nothing new to admit. `'main-red'` is spelled only in `shared/landingLine.ts`.

**What `landingEjectionAsk` does.**
- **When the notice is due.** It is due iff `entry.state === 'ejected' && entry.ejections === LANDING_EJECTION_ASK_AT`.
  The count only ever rises, and Task 1's writer is its one writer, so exactly one write per entry ever produces 2.
  That write is the once-only raise. A third ejection raises nothing (D-7624).
- **The words.** The tag is ``landing-ejected-${project}-${pr}``, fixed per entry as the review cap's
  ``review-cap-${work}`` is per run. The title is ``Landing: ${project} #${pr} ejected twice``. The body is
  ``${who}: ejected from the landing line a second time (${ejectionKind ?? 'unrecorded'} against base ${baseSha === null ? 'unrecorded' : baseSha.slice(0, 12)}). The line holds nothing back; you decide whether it lands again, is fixed by hand or is withdrawn.``
  Here `who` is ``run ${runId}, ${project} #${pr}``, or ``${project} #${pr} (no run)`` when `runId` is null.

**Consumes:**
- From L0 (Task 1): `LandingEntry` (with `id: number`) and `LandingEntryState` (five words: `pinned`, `ejected`,
  `landed`, `withdrawn`, `unknown`).
- From Task 1: `advanceAct`'s ok answer, `adv`, carries `landing: LandingWrite`. Its `pinned` (create or re-pin) and
  `ejected` arms carry `entry`, the row as written; every other arm carries none (D-7618 (advances the line does not
  place)). The re-pin answers the row in state `pinned` with its carried `ejections`.
- From Task 1: the refusal `ejection-not-merging` (D-7619 (the one new refusal code)) for an ejection body on a run
  not at `merging`.
- `NoticeSink` (`server/src/notice.ts`), already in scope in `routes.ts` as `notice`.

**Produces:**
- `landingOrder`, which Task 3's read route calls for `LandingLineView.order`.
- The notice, one ring and feed row per entry. Its record is
  `{ kind: 'run', sessionId: run.sessionId, title, body, runId: id }` in mode `'record-always'`, with
  `{ tag, degraded: 'ejection recorded, feed archive degraded' }`. It names the worker's session, not the review
  cap's `sessionId: ''` shape, which `review-cap.test.ts` pins to exactly one writer (D-7624).

**The route edit.** In `advanceAct`, after Task 1's writer answers ok (Task 1 names that answer `adv`):
```ts
// @anchor landing-ejection-ask
const entry = adv.landing.kind === 'pinned' || adv.landing.kind === 'ejected' ? adv.landing.entry : null;
const ask = entry === null ? { due: false as const } : landingEjectionAsk(entry);
if (ask.due) notice({ kind: 'run', sessionId: run.sessionId, title: ask.title, body: ask.body, runId: id }, 'record-always',
  { tag: ask.tag, degraded: 'ejection recorded, feed archive degraded' });
```

- [ ] **Step 1: The failing tests, `server/test/landing-line-order.test.ts`.**

  The fixture builder is
  `const e = (pr: number, over: Partial<LandingEntry> = {}): LandingEntry => Object.freeze({ id: pr + 100, project: 'project-a', pr, pinnedSha: 'a'.repeat(40), handoffCommit: 'a'.repeat(40), runId: pr * 10, state: 'pinned', baseSha: null, ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false, setBy: 'coordinator', pinnedAt: 1000 + pr, ...over }) as LandingEntry;`.
  Every entry's `id` is its `pr` plus 100, so an edge read as a PR number points at nothing and the cases tell the
  two readings apart.
  The flag sets are `const OPEN = { operatorPaused: false, mainRedHold: false }`,
  `OP = { operatorPaused: true, mainRedHold: false }`, `RED = { operatorPaused: false, mainRedHold: true }` and
  `BOTH = { operatorPaused: true, mainRedHold: true }`.
  The helpers are `const prs = (o: LandingOrder) => o.order.map((x) => x.pr)` and
  `const head = (o: LandingOrder) => (o.paused ? 'paused' : o.head?.pr ?? null)`.

  `describe('landingOrder: the cases, as data')` uses `it.each(CASES)('%s', (_n, entries, flags, wantOrder, wantHead, wantBy) => { const o = landingOrder(entries, flags); expect(prs(o)).toEqual(wantOrder); expect(head(o)).toEqual(wantHead); expect(o.paused ? o.by : null).toEqual(wantBy); })`
  with these rows:

  | # | Name | Entries | Flags | Order | Head | By |
  |---|---|---|---|---|---|---|
  | C1 | `an empty line` | `[]` | `OPEN` | `[]` | `null` | `null` |
  | C2 | `first-green by pinnedAt` | `[e(1, {pinnedAt: 200}), e(2, {pinnedAt: 150}), e(3, {pinnedAt: 100})]` | `OPEN` | `[3, 2, 1]` | `3` | `null` |
  | C3 | `a pinnedAt tie breaks by pr` | `[e(9, {pinnedAt: 100}), e(4, {pinnedAt: 100})]` | `OPEN` | `[4, 9]` | `4` | `null` |
  | C4 | `only pinned entries are in the line` | `[e(5, {state: 'landed'}), e(6, {state: 'withdrawn'}), e(7, {state: 'ejected', ejections: 1}), e(8), e(9, {state: 'unknown'})]` | `OPEN` | `[8]` | `8` | `null` |
  | C5 | `a fixesMain entry jumps the line` | `[e(1, {pinnedAt: 100}), e(2, {pinnedAt: 300, fixesMain: true})]` | `OPEN` | `[2, 1]` | `2` | `null` |
  | C6 | `two fixesMain entries keep first-green between them` | `[e(1, {pinnedAt: 100}), e(2, {pinnedAt: 300, fixesMain: true}), e(3, {pinnedAt: 200, fixesMain: true})]` | `OPEN` | `[3, 2, 1]` | `3` | `null` |
  | C7 | `an after edge is honoured` | `[e(1, {pinnedAt: 100, afterIds: [102]}), e(2, {pinnedAt: 200})]` | `OPEN` | `[2, 1]` | `2` | `null` |
  | C8 | `an after edge outranks the fixesMain jump` | `[e(1, {pinnedAt: 100, fixesMain: true, afterIds: [102]}), e(2, {pinnedAt: 200})]` | `OPEN` | `[2, 1]` | `2` | `null` |
  | C9 | `an edge to an ejected entry holds the entry back` | `[e(1, {pinnedAt: 100, afterIds: [107]}), e(7, {state: 'ejected', ejections: 1}), e(3, {pinnedAt: 200})]` | `OPEN` | `[3, 1]` | `3` | `null` |
  | C10 | `an edge to a landed, withdrawn or absent id holds nothing` | `[e(1, {afterIds: [105, 106, 199]}), e(5, {state: 'landed'}), e(6, {state: 'withdrawn'})]` | `OPEN` | `[1]` | `1` | `null` |
  | C11 | `a cycle goes last and never heads` | `[e(1, {pinnedAt: 100, afterIds: [102]}), e(2, {pinnedAt: 200, afterIds: [101]}), e(3, {pinnedAt: 300})]` | `OPEN` | `[3, 1, 2]` | `3` | `null` |
  | C12 | `a line of only a cycle has no head` | `[e(1, {afterIds: [102]}), e(2, {afterIds: [101]})]` | `OPEN` | `[1, 2]` | `null` | `null` |
  | C13 | `a self-edge never heads` | `[e(1, {afterIds: [101]})]` | `OPEN` | `[1]` | `null` | `null` |
  | C14 | `an operator pause keeps the order and names no head` | `[e(1, {pinnedAt: 200}), e(2, {pinnedAt: 100})]` | `OP` | `[2, 1]` | `'paused'` | `['operator']` |
  | C15 | `a main-red hold pauses the line` | `[e(1)]` | `RED` | `[1]` | `'paused'` | `['main-red']` |
  | C16 | `both flags: operator first` | `[e(1)]` | `BOTH` | `[1]` | `'paused'` | `['operator', 'main-red']` |
  | C17 | `a fixesMain entry is held by main-red too (the literal ruling)` | `[e(1, {fixesMain: true})]` | `RED` | `[1]` | `'paused'` | `['main-red']` |
  | C18 | `an edge to an unknown entry holds the entry back` | `[e(1, {pinnedAt: 100, afterIds: [109]}), e(9, {state: 'unknown'}), e(3, {pinnedAt: 200})]` | `OPEN` | `[3, 1]` | `3` | `null` |

  `describe('landingOrder: the spec\'s pause rows, as folds over the flags (spec §5.5 item 6)')` uses this helper
  (D-7621: the spec's two pause rows as flag sequences):
  ```ts
  const fold = (steps: LandingLineFlags[]) => steps.map((f) => { const o = landingOrder([e(1)], f); return o.paused ? o.by : o.head?.pr ?? null; });
  ```
  - `it('an operator pause survives a red-to-green transition')`: `expect(fold([BOTH, OP])).toEqual([['operator', 'main-red'], ['operator']]);`
  - `it('an operator pause set BEFORE main goes red survives the red and the later green')`: `expect(fold([OPEN, OP, BOTH, OP])).toEqual([1, ['operator'], ['operator', 'main-red'], ['operator']]);`
  - `it('CONTROL: a main-red hold alone clears on green')`: `expect(fold([RED, OPEN])).toEqual([['main-red'], 1]);`

  `describe('landingOrder is pure')`:
  - `it('does not mutate its input, and answers the same twice')`:
    ```ts
    const input = Object.freeze([e(2, {pinnedAt: 100}), e(1, {pinnedAt: 50})]);
    expect(landingOrder(input, OPEN)).toEqual(landingOrder(input, OPEN));
    expect(input.map((x) => x.pr)).toEqual([2, 1]);
    ```
  - `it('L0 lists the pause words in the order by names them')`: `expect(LANDING_PAUSE_BYS).toEqual(['operator', 'main-red']); expect(LANDING_PAUSE_BY).toEqual({ operator: 'operatorPaused', 'main-red': 'mainRedHold' });`

  `describe('landingLine.ts is the pure L1 module its header says it is')`, shaped like `landing-verdict.test.ts`'s
  describe "landing.ts is the pure L1 module its docstring says it is". It reads `server/src/coord/landingLine.ts`
  (`readFileSync`, resolved from `import.meta.url`), blanks comments with positions kept, and declares the same
  `NODE_BUILTIN`, `SIDE_EFFECT_IMPORT`, `RE_EXPORT` and `valueImportSpecifiers` as that describe:
  - `it('the scan is over real code, not an empty string')`: the code contains `export function landingOrder` and
    `export function landingEjectionAsk`, and its non-space length is above 400.
  - `it('CONTROL: the scans see either quote, a re-export, and a second import behind a first')`: the same CONTROL
    cases as `landing-verdict.test.ts`'s (both quotes of a `node:fs` import match `NODE_BUILTIN`, a shared import does
    not; a side-effect import and a re-export match; `valueImportSpecifiers` finds two specifiers behind each other and
    none for an `import type`).
  - `it('has no clock, no fs and no other node builtin')`: the code does not match `NODE_BUILTIN`, nor
    `/\bDate\s*\.\s*now\s*\(|performance\s*\.\s*now|\bnew\s+Date\b/`, nor `/\bfs\s*\.|require\s*\(/`.
  - `it('imports values only from shared/landingLine.ts (L0)')`:
    `expect(valueImportSpecifiers(code())).toEqual(['../../../shared/landingLine.js']);`
  - `it('has no side-effect import, dynamic import or re-export')`: the code does not match `SIDE_EFFECT_IMPORT`,
    `/\bimport\s*\(/` or `RE_EXPORT`.
  - `it('reaches no store')`: the code does not match `/CoordStore|\bcoord\s*\.|\bdb\s*\./`.

  `describe('landingEjectionAsk')`:
  - `it('is due at the second ejection only')`:
    ```ts
    expect(landingEjectionAsk(e(42, {state: 'ejected', ejections: 1, baseSha: 'b'.repeat(40), ejectionKind: 'new-head'}))).toEqual({ due: false });
    expect(landingEjectionAsk(e(42, {state: 'ejected', ejections: 3, baseSha: 'b'.repeat(40), ejectionKind: 'new-head'}))).toEqual({ due: false });
    expect(landingEjectionAsk(e(42, {state: 'pinned', ejections: 2}))).toEqual({ due: false });
    expect(LANDING_EJECTION_ASK_AT).toBe(2);
    ```
  - `it('words the notice with the run, the PR, the kind and the base')`:
    ```ts
    expect(landingEjectionAsk(e(42, {state: 'ejected', ejections: 2, baseSha: '0123456789ab' + 'c'.repeat(28), ejectionKind: 'conflict'}))).toEqual({
      due: true, tag: 'landing-ejected-project-a-42', title: 'Landing: project-a #42 ejected twice',
      body: 'run 420, project-a #42: ejected from the landing line a second time (conflict against base 0123456789ab). The line holds nothing back; you decide whether it lands again, is fixed by hand or is withdrawn.' });
    ```
  - `it('says no run, and an unrecorded kind and base, when they are null')`:
    ```ts
    expect((landingEjectionAsk(e(7, {state: 'ejected', ejections: 2, runId: null})) as { body: string }).body)
      .toBe('project-a #7 (no run): ejected from the landing line a second time (unrecorded against base unrecorded). The line holds nothing back; you decide whether it lands again, is fixed by hand or is withdrawn.');
    ```

- [ ] **Step 2: The failing tests, `server/test/landing-ejection-ask.test.ts`.** These need Task 1's composite writer
  and its `ejection` body on the advance.

  The `scenario` follows `merging-episode.test.ts`: project `'demo'`, session `'demo-ep1'`, `TIP = 'a'.repeat(40)`.
  Add `notifyLog: new NotifyLog(path.join(home, '.ccrc', 'notify.json'))` (loaded) and
  `push: { notify: vi.fn() } as never` to the deps. Its `eject` posts
  `{ to: 'working', fingerprint, ejection: { base: 'b'.repeat(40), kind: 'new-head' } }` after `toMerging()`. The
  helper `asks = () => notifyLog.catchUp(notifyLog.epoch, 0).events.filter((x) => x.title.startsWith('Landing: '))`.
  - `it('the first ejection raises nothing, the second raises one notice through the funnel, the third raises nothing more')`:
    ```ts
    expect((await toMerging()).statusCode).toBe(200); expect((await eject()).statusCode).toBe(200);
    expect(asks()).toHaveLength(0);
    expect((await toMerging()).statusCode).toBe(200); expect((await eject()).statusCode).toBe(200);
    expect(asks()).toHaveLength(1);
    expect(asks()[0]).toMatchObject({ kind: 'run', sessionId: 'demo-ep1', runId: id, title: 'Landing: demo #7 ejected twice' });
    expect(push.notify).toHaveBeenCalledTimes(1);
    expect(push.notify.mock.calls[0]![0]).toMatchObject({ tag: 'landing-ejected-demo-7', sessionId: 'demo-ep1' });
    expect((await toMerging()).statusCode).toBe(200); expect((await eject()).statusCode).toBe(200);
    expect(asks()).toHaveLength(1); expect(push.notify).toHaveBeenCalledTimes(1);
    ```
    The third cycle's `toMerging` re-pins the entry in state `pinned` with `ejections: 2`, so this case also holds that
    a re-pin raises nothing.
  - `it('CONTROL: the notice sends no mail: the coordinator opens no dialog (clause 19)')`. A control that must stay
    green before and after the change. The markers are unset, so no `checksMail` is queued, and `advanceAct` queues
    system mail only on a rejected `verifyDone`, so the happy path writes none:
    ```ts
    const n = () => (coord.db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n;
    expect((await toMerging()).statusCode).toBe(200);
    const before = n();
    expect((await eject()).statusCode).toBe(200);
    expect(n()).toBe(before);                       // the first ejecting advance: 0 new rows
    expect((await toMerging()).statusCode).toBe(200);
    const beforeSecond = n();
    expect((await eject()).statusCode).toBe(200);
    expect(n()).toBe(beforeSecond);                 // the second ejecting advance, which raises the notice: 0 new rows
    expect(coord.db.prepare("SELECT COUNT(*) AS n FROM mail WHERE subject LIKE '%ejected twice%' OR body LIKE '%ejected twice%'").get())
      .toEqual({ n: 0 });
    ```
  - `it('a refused ejecting advance raises nothing')`: advance to `awaiting-review` first (`post('awaiting-review')`),
    then post the ejection from there, where Task 1 refuses it with `ejection-not-merging` (D-7619). Then
    `expect(res.statusCode).toBe(409); expect(res.json().reject.code).toBe('ejection-not-merging'); expect(asks()).toHaveLength(0);`.
    It is a control that passes once Tasks 1 and 2 are in.
  - `it('the notice is recorded even while the operator watches the worker\'s session (record-always)')`: give the deps
    `viewers: { isVisible: () => true } as never` (confirm `testDeps` takes a `viewers` override that reaches
    `noticeSink(deps)` before relying on this case). After two ejections,
    `expect(asks()).toHaveLength(1); expect(push.notify).not.toHaveBeenCalled();`.

- [ ] **Step 3: Run the tests and see them fail.** With Task 1 on the branch, from `server/`:
  `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/landing-line-order.test.ts test/landing-ejection-ask.test.ts`
  Expected: `landing-line-order` fails to import `../src/coord/landingLine.js`, which does not exist. In
  `landing-ejection-ask`, the second-ejection case fails on `expect(asks()).toHaveLength(1)` (received 0), and the
  record-always case fails the same way. The no-mail and refused cases already pass; they are controls.

- [ ] **Step 4: Implement.**
  - In `shared/landingLine.ts`, add `LandingLineFlags`, `LANDING_PAUSE_BY`, `LandingPauseBy`, `LANDING_PAUSE_BYS` and
    `LandingOrder` exactly as in Interfaces, beside Task 1's words.
  - Create `server/src/coord/landingLine.ts` as in "What `landingOrder` does" and "What `landingEjectionAsk` does",
    with one value import, from `../../../shared/landingLine.js`. Its header states the following:
    - its ring and context (L1, C4);
    - that it is pure;
    - that `afterIds` names entry ids (D-7613);
    - why the edge outranks the jump (D-7622);
    - why `fixesMain` is held by `main-red` in 5e (D-7623);
    - that the notice is once-only by the count reaching 2, and the advance is never refused (D-7624).
  - Add the C4 row and the `POLICY` entry.
  - Add the route edit at `@anchor landing-ejection-ask`, with one import line:
    `import { landingEjectionAsk } from './landingLine.js';`.

- [ ] **Step 5: Run the tests and see them pass.** Run the same command as Step 3. Both files pass whole.

- [ ] **Step 6: The guards.** From `server/`:
  `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/landing-line-order.test.ts test/landing-ejection-ask.test.ts test/review-cap.test.ts test/coord-policy-rings.test.ts test/rings/totality.test.ts test/rings/outward-edges.test.ts test/rings/shared-imports.test.ts test/rings/wire-totality.test.ts test/rings/host-imports.test.ts test/mail-routes.test.ts test/census-w3/questions.test.ts test/single-definition/update-stall.test.ts test/merging-episode.test.ts test/anchors.test.ts test/landing-verdict.test.ts`
  Then `git fetch origin main` and run the armed growth check:
  `GROWTH_CHECK=1 ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/growth-check.test.ts`. Read the
  output and confirm the rows MEASURED and did not print the skip notice. This task adds about 7 code lines to
  `routes.ts`. The growth of `store.ts` and `routes.ts` is waived by the new files this wave adds under
  `server/src/coord/` and `shared/` (`growthOver` in `server/test/growthCheck.ts`, through `L1_L2_NEW_FILE_DIRS`), so
  no waiver is written.
  Typecheck with `ccrc test -- npx tsc --noEmit -p .` from `server/`, then `typecheck-tests` alone.

- [ ] **Step 7: Mutations.** Run the table's mutants one at a time. Restore each from a saved copy (sha checked) and
  record each red. The context choice (O12) is held by review, not by a test: deleting the C4 row turns nothing red,
  because `coord/**` gives the file C5 and `totality` passes, so the table carries no row for it.

- [ ] **Step 8: Commit.** `feat(coord): the landing line's decider and the second-ejection notice (landing order wave 5e)`

**Mutation table (Task 2).**

| # | Mutation | Predicted red |
|---|---|---|
| 5E-DECIDER-1 | In `landingOrder`, pause only when both flags are set: replace `by.length > 0` with `by.length === 2`. | C14 and C15 (paused expected, head returned). "an operator pause survives a red-to-green transition" step 2 answers `1`, not `['operator']`. It cannot stay green, because `OP` alone must pause. |
| 5E-DECIDER-2 | Make the green clear the operator pause: derive `by` from `flags.mainRedHold` alone (`operator` included only when `mainRedHold`). | Both spec rows: "survives a red-to-green transition" step 2 and "set BEFORE main goes red" steps 2 and 4 answer `1`. Also C14. |
| 5E-DECIDER-3 | Swap the keys of `LANDING_PAUSE_BY` (`'main-red'` first). | C16 (`['main-red', 'operator']`), both spec rows' `BOTH` step, and "L0 lists the pause words". |
| 5E-DECIDER-4 | Drop the `state === 'pinned'` filter from the line. | C4 (order `[5, 6, 7, 8, 9]`). C9 also changes (7 joins the line). |
| 5E-DECIDER-5 | Sort `pinnedAt` descending. | C2 (`[1, 2, 3]`), C6 and C14. |
| 5E-DECIDER-6 | Drop the `pr` tie-break. | C3. The input order `[9, 4]` survives a stable sort, so the answer is `[9, 4]`. |
| 5E-DECIDER-7 | Ignore `fixesMain` in the key. | C5 (`[1, 2]`) and C6. |
| 5E-DECIDER-8 | Ignore `afterIds`: take entries in key order alone. | C7 (`[1, 2]`), C8, C9, C11, C12 (head 1) and C13. |
| 5E-DECIDER-9 | Let the jump outrank the edge: take `fixesMain` entries before the walk. | C8 (`[1, 2]`, head 1). |
| 5E-DECIDER-10 | Count only `pinned` entries as outstanding, so an edge to an ejected entry holds nothing. | C9 (order `[1, 3]`, head 1). |
| 5E-DECIDER-11 | Count `landed` and `withdrawn` entries as outstanding. | C10 (head `null`). |
| 5E-DECIDER-12 | Drop the remainder when nothing can be taken. | C11 (`[3]`), C12 (`[]`) and C13 (`[]`). |
| 5E-DECIDER-13 | Answer `order: []` when paused. | C14, C15, C16 and C17. |
| 5E-DECIDER-14 | Answer `head: order[0] ?? null` regardless of whether anything was taken. | C12 (head 1) and C13 (head 1). |
| 5E-DECIDER-15 | In `landingEjectionAsk`, write `ejections >= LANDING_EJECTION_ASK_AT`. | "is due at the second ejection only" (the `ejections: 3` arm is due). The route case's third ejection makes `asks()` 2. |
| 5E-DECIDER-16 | In `landingEjectionAsk`, drop the `state === 'ejected'` conjunct. | "is due at the second ejection only" (the `state: 'pinned', ejections: 2` arm is due), and the route case: the third cycle's `toMerging` re-pins the entry in state `pinned` with `ejections: 2`, Task 1's writer answers that row (non-null, per Consumes), so the notice is raised a second time, the final `asks()` is 2, not 1, and `push.notify` is called twice. |
| 5E-DECIDER-17 | In the route, write `sessionId: ''`. | `review-cap.test.ts` "finds exactly one such writer under server/src, inside POST /api/runs" finds 2 hits. The route case's `sessionId: 'demo-ep1'` match also fails. |
| 5E-DECIDER-18 | In the route, delete the `notice(...)` call. | The route case (`asks()` is 0) and the record-always case. |
| 5E-DECIDER-19 | In the route, use mode `'push'`. | The record-always case: a visible session suppresses the record, so `asks()` is 0. |
| 5E-DECIDER-20 | Before Task 1's composite writer runs, whenever `body.ejection !== undefined`, call `notice` with the title, body and tag of `landingEjectionAsk(e)` for a fixed entry with state `'ejected'` and `ejections: 2` (the Step 1 builder's shape, inlined), instead of the written row's answer. | "a refused ejecting advance raises nothing" (the ejection posted from `awaiting-review` is refused 409 with `reject.code` `ejection-not-merging`, yet `asks()` is 1), and the second-ejection case (`asks()` is 1 after the first ejection, not 0). |
| 5E-DECIDER-21 | Add `import { readFileSync } from 'node:fs';` to `coord/landingLine.ts` and use it. | `landing-line-order`, the describe "landingLine.ts is the pure L1 module its header says it is": "has no clock, no fs and no other node builtin" (`NODE_BUILTIN`) and "imports values only from shared/landingLine.ts (L0)" (`['node:fs', '../../../shared/landingLine.js']`). The rings suites stay green (ring membership follows imports, so the file is simply read as L3 and no ring suite reds; the purity describe is the guard). Re-run `landing-line-order` for this row. |
| 5E-DECIDER-23 | Resolve `afterIds` against `pr` instead of `id`. | C7 (`[1, 2]`, head 1), C8 (`[1, 2]`), C9 (`[1, 3]`, head 1), C11, C12 (head 1) and C13 (head 1): every edge names an id (`pr + 100`) that no PR carries, so each holds nothing back. |
| 5E-DECIDER-24 | Make `unknown` not outstanding (drop it from the outstanding set). | C18 `an edge to an unknown entry holds the entry back`: the order is `[1, 3]` with head `1`, not `[3, 1]` with head `3`. |

5E-DECIDER-22 was withdrawn at review: deleting the C4 row reds nothing, because `coord/**` gives the file C5; O12's context is held by review.

### Task 3: the read route, the auth gate, the client row and the CLAUDE.md box-token line

`GET /api/landing?project=<p>` is the coordinator's read of one project's landing line: the entries, the flags and the decider's order. It works like `GET /api/ledger`. It is a box-token read through `requireMailToken`, registered in `server/src/coord/routes.ts`, and its answer goes through the one masking hook (`MASKED_GET_ROUTES`) because `setBy` is a session id. The handler decides nothing. It reads the two `CoordStore` reads that Task 1 adds and calls Task 2's pure `landingOrder`. **Decide in L1, act in L4.** The read is advisory in 5e (D-7626 (the line read is advisory in 5e)).

Tasks run in order 1, 2, 3, 4. This task needs Task 1 (slot 35, `shared/landingLine.ts`, the two `CoordStore` reads) and Task 2 (`server/src/coord/landingLine.ts#landingOrder`) committed on the branch; its red-first is measured after both are there.

Adding the route moves four kinds of derived prose and counts:
- the auth gate's EXEMPT row and its numerals in `gate.ts`, `README.md` and `auth-gate.test.ts`;
- the box-token census's number words;
- the secret-mask inventory;
- the CLAUDE.md box-token bullet (this task owns that bullet only).

It also adds the closed client's row `[landing.show]='GET|/api/landing|no|project'` in `ccd/ccrc-api` (D-7625 (the client row landing show in ccd/ccrc-api)): a repository that denies `Bash(curl:*)` leaves that client as the only way in, so without the row the read cannot be reached there. Task 4 consumes the verb (`ccrc-api landing show --project <p>`) and does not edit `ccd/ccrc-api`.

This task does not touch CLAUDE.md's coord.db bullet, and widens neither prose pin (`collect-switch-prose.test.ts`, `stall-settings-prose.test.ts`): Task 1 owns that bullet, puts `the landing line` first in its loss list and adds its own pin (D-7620). This task adds no ring-context-map row: Task 1 adds `coord/landingEntry.ts` and Task 2 adds `coord/landingLine.ts`.

**Files**
- Modify: `shared/landingLine.ts`: append `/** GET /api/landing's answer, flat beside ok. */ export interface LandingLineView { project: string; operatorPaused: boolean; mainRedHold: boolean; entries: LandingEntry[]; order: LandingOrder }`.
- Modify: `server/src/coord/routes.ts`. Add the handler directly after `GET /api/ledger`'s, and add the import lines for `landingOrder` and the `LandingLineView` type.
- Modify: `server/src/server.ts` (`MASKED_GET_ROUTES`: add `'/api/landing'`).
- Modify: `server/src/auth/gate.ts`. Add the EXEMPT row after `['GET /api/ledger', …]`. Move the module docstring's route count and the number words in EXEMPT reason 2 and in the "EXEMPT ROUTES ARE SKIPPED" note.
- Modify: `ccd/ccrc-api`. Add the `[landing.show]` row after `[ledger.allocate]`, and move its two scanned row-count sites from `thirty-three` to `thirty-four`.
- Modify: `README.md`. Move the auth paragraph's two number words, add `landing show` to the `ccrc-api` verb list, and add one paragraph on the read before `**The bypass deny (landing-order wave 2b).**`.
- Modify: `CLAUDE.md`, the box-token bullet only; the exact text is under **CLAUDE.md (for the operator to read)** below.
- Create (test): `server/test/landing-read-route.test.ts`.
- Modify (tests):
  - `server/test/auth-gate.test.ts`;
  - `server/test/box-token-census.test.ts` (`WORDS`);
  - `server/test/secret-mask.test.ts`;
  - `server/test/coord-routes-single-file.test.ts` (`COORD_PREFIXES`);
  - `server/test/ccrc-api-closed.test.ts` (`routeKeys().size` 33 -> 34 and its history comment);
  - `server/test/ccrc-api.test.ts` (the row case, the row count and its word, the byte-identical row list, one query case).

**Interfaces**

Consumes (fixed by the shared names; Tasks 1 and 2 own them; D-7613 (the entry's shape)):
```ts
// shared/landingLine.ts (L0, Task 1)
export interface LandingEntry { id: number; project: string; pr: number; pinnedSha: string; handoffCommit: string;
  runId: number | null; state: LandingEntryState; baseSha: string | null; ejectionKind: LandingEjectionKind | null;
  ejections: number; afterIds: number[]; fixesMain: boolean; setBy: string; pinnedAt: number }
// LANDING_ENTRY_STATE: pinned, ejected, landed, withdrawn, unknown. afterIds name entry ids (landing_entries.id).
export type LandingOrder = { paused: false; order: LandingEntry[]; head: LandingEntry | null }
  | { paused: true; by: LandingPauseBy[]; order: LandingEntry[] };   // LANDING_PAUSE_BY: operator, main-red
export interface LandingLineFlags { operatorPaused: boolean; mainRedHold: boolean }
// server/src/coord/landingLine.ts (L1, Task 2; imports LandingOrder and the flags from L0)
export function landingOrder(entries: readonly LandingEntry[], flags: LandingLineFlags): LandingOrder;
// server/src/coord/store.ts (Task 1)
CoordStore.landingEntries(project: string): LandingEntry[];          // [] for a project with no entries
CoordStore.landingProject(project: string): LandingLineFlags;        // both false with no row (inert defaults)
// slot 35 (Task 1): the tables landing_entries and landing_projects — the test seeds rows with Task 1's column names
```
Produces:
```ts
// shared/landingLine.ts (L0, appended by this task)
/** GET /api/landing's answer, flat beside ok. */ export interface LandingLineView { project: string; operatorPaused: boolean; mainRedHold: boolean; entries: LandingEntry[]; order: LandingOrder }
// GET /api/landing?project=<p>   header x-ccrc-mail-token
// 200 { ok: true } & LandingLineView    (flat, the GET /api/ledger envelope: ok beside the fields, never nested)
// 400 { ok: false, error: 'bad-request', detail: 'the landing line is per-project — ?project= is required' }
// 401 (requireMailToken's answer, unchanged)
// 501 { ok: false, error: 'not-configured', … } when deps.coord is absent (notConfigured, unchanged)
// ccd/ccrc-api: [landing.show]='GET|/api/landing|no|project'   →  ccrc-api landing show --project <p>
```
Note: flat-envelope. The answer is `{ ok: true, ...LandingLineView }`, the `GET /api/ledger` envelope (`ok` beside `floor` and `allocations`), not `{ ok: true, view: LandingLineView }`. The only new exported type is `LandingLineView`; the answer type is written inline in the handler as `{ ok: true } & LandingLineView`.

Note: masked-not-exempt. The route joins `MASKED_GET_ROUTES` (the one masking hook) rather than the EXEMPT inventory, because `setBy` is a session id written by sessions; its sibling `/api/ledger` is in the same set for the same reason. The route test pins that 40-hex shas pass the hook byte for byte, as `GET /api/runs`' `handoffCommit` already does.

- [ ] **Step 1: the failing route test.** Create `server/test/landing-read-route.test.ts`.
  - Harness: the one `ledger-routes.test.ts` uses.
    - `const TOKEN = 'f'.repeat(64)`.
    - `openApp` builds `new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')))` and `buildServer({ ...testDeps(home), mailToken: TOKEN, coord, ...over })`, with `home = mkTmp('ccrc-landing-read-')`.
    - `const read = (app, qs, headers = { 'x-ccrc-mail-token': TOKEN }) => app.inject({ method: 'GET', url: `/api/landing${qs}`, headers })`.
  - Seeding goes through the database handle that `openCoordDb` returned. `seedEntry(db, e: LandingEntry)` INSERTs one `landing_entries` row with Task 1's slot-35 column names, `id` included (the INTEGER PRIMARY KEY, written explicitly so the fixtures' ids are the rows' ids). `seedFlags(db, project, { operatorPaused, mainRedHold })` INSERTs one `landing_projects` row. A test writes rows directly because no route in 5e creates an entry without a run (that is 5f). The helper stays in the test file, never in `server/src`, so Task 1's one-writer census of `pinnedSha` (D-7614) stays at one.
  - Runs first. `landing_entries.runId` REFERENCES `runs(id)` and `openCoordDb` enforces foreign keys, so every entry that names a run names one the store opened. In a `beforeEach`, after `openApp`, open two runs through the store, as `merging-episode.test.ts#scenario` does, and keep their ids:
    ```ts
    const openRunId = (coord: CoordStore, wave: number): number => {
      const opened = coord.openRun({ program: 'landing', title: 't', project: 'project-a', wave, waveOf: 2, claimedBy: 'coord-a' });
      if (!('id' in opened)) throw new Error('fixture openRun refused');
      return opened.id;
    };
    r1 = openRunId(coord, 1); r2 = openRunId(coord, 2);
    ```
  - Fixtures, neutral, built in that `beforeEach` from the returned ids (no literal run id anywhere):
    - `A = { id: 1, project: 'project-a', pr: 11, pinnedSha: 'a'.repeat(40), handoffCommit: 'b'.repeat(40), runId: r1, state: 'pinned', baseSha: null, ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false, setBy: 'lane-a-project-a', pinnedAt: 1_000 }`;
    - `B = { ...A, id: 2, pr: 12, pinnedSha: 'c'.repeat(40), handoffCommit: 'd'.repeat(40), runId: r2, pinnedAt: 2_000 }`;
    - `OTHER = { ...A, id: 3, project: 'project-b', pr: 99 }` (it names `r1`, which exists; the foreign key checks only that).

  Cases (names and assertions exact):
  ```ts
  it('refuses 401 without the box token, and answers nothing of the line', async () => {
    seedEntry(db, A);
    const res = await read(app, '?project=project-a', {});
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('a'.repeat(40));
  });
  it('refuses 400 bad-request without ?project=, and with a blank one', async () => {
    for (const qs of ['', '?project=', '?project=%20%20']) {
      const res = await read(app, qs);
      expect(res.statusCode, qs).toBe(400);
      expect(res.json(), qs).toEqual({ ok: false, error: 'bad-request',
        detail: 'the landing line is per-project — ?project= is required' });
    }
  });
  it('answers 501 not-configured with no coordination database', async () => {
    // openApp({ coord: undefined })
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-configured' });
  });
  it('an empty project answers an empty, unpaused line with the inert flags', async () => {
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, project: 'project-a', operatorPaused: false, mainRedHold: false,
      entries: [], order: { paused: false, order: [], head: null } });
  });
  it('answers every entry of the project as the wire LandingEntry, shas byte for byte through the masking hook', async () => {
    seedEntry(db, B); seedEntry(db, A);
    const body = res.json() as LandingLineView & { ok: true };
    expect(body.entries.map((e) => e.pr).sort()).toEqual([11, 12]);
    expect(body.entries.find((e) => e.pr === 11)).toEqual(A);
    expect(Object.keys(body.entries[0]!).sort()).toEqual(['afterIds', 'baseSha', 'ejectionKind', 'ejections',
      'fixesMain', 'handoffCommit', 'id', 'pinnedAt', 'pinnedSha', 'pr', 'project', 'runId', 'setBy', 'state']);
  });
  it("the order is the decider's, computed on this read: first-pinned is the head", async () => {
    seedEntry(db, B); seedEntry(db, A);
    const body = res.json() as LandingLineView & { ok: true };
    expect(body.order).toEqual(landingOrder(body.entries, { operatorPaused: false, mainRedHold: false }));
    expect(body.order).toMatchObject({ paused: false, head: { id: 1, pr: 11 } });
  });
  it('an operator pause on the project answers a paused line, by the operator, with the entries still listed', async () => {
    seedEntry(db, A); seedFlags(db, 'project-a', { operatorPaused: true, mainRedHold: false });
    const body = res.json() as LandingLineView & { ok: true };
    expect(body.operatorPaused).toBe(true);
    expect(body.mainRedHold).toBe(false);
    expect(body.order).toEqual({ paused: true, by: ['operator'], order: [A] });
  });
  it('a main-red hold answers a paused line by main-red', async () => {
    seedEntry(db, A); seedFlags(db, 'project-a', { operatorPaused: false, mainRedHold: true });
    expect((res.json() as LandingLineView).order).toEqual({ paused: true, by: ['main-red'], order: [A] });
  });
  it("answers one project's line only: another project's entry and flags never leak in", async () => {
    seedEntry(db, A); seedEntry(db, OTHER); seedFlags(db, 'project-b', { operatorPaused: true, mainRedHold: true });
    const body = res.json() as LandingLineView & { ok: true };
    expect(body.entries.map((e) => e.project)).toEqual(['project-a']);
    expect([body.operatorPaused, body.mainRedHold]).toEqual([false, false]);
  });
  it('trims the project as the ledger read does', async () => {
    seedEntry(db, A);
    expect(((await read(app, '?project=%20project-a%20')).json() as LandingLineView).entries).toEqual([A]);
  });
  ```
  The pause cases pin the decider's `by` word for a single flag only; the both-flags order is Task 2's to fix.
- [ ] **Step 2: run it and see it fail.** This step runs after Tasks 1 and 2 are committed on the branch; before then the test fails to compile on its imports, not with `404`. From `server/`: `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/landing-read-route.test.ts`. Expected: every case fails with `404` from the route not being registered. The 400, 401 and 501 cases fail with `expected 404 to be 400`, `expected 404 to be 401` and `expected 404 to be 501`. (The 404 holds while the test build serves no PWA wildcard, `HAS_PWA` false, as `ledger-routes.test.ts` relies on.)
- [ ] **Step 3: the view, then the handler.** First, append `LandingLineView` to `shared/landingLine.ts`, exactly as under Produces: `/** GET /api/landing's answer, flat beside ok. */ export interface LandingLineView { project: string; operatorPaused: boolean; mainRedHold: boolean; entries: LandingEntry[]; order: LandingOrder }`. Then, in `server/src/coord/routes.ts`, directly after the `app.get('/api/ledger', …)` block, add a docstring and the handler:
  - The docstring is `GET /api/landing?project=`: the landing line, read cookieless from the fleet host before the coordinator enqueues. It follows the `GET /api/ledger` convention: box token, a read with no attribution to check, per-project and REQUIRED. The order is computed on this read by `landingLine.ts#landingOrder` and never stored. A project with no `landing_projects` row answers both flags `false`: inert until their writers (5i, 5j). The docstring states no number word.
  - The handler, in full (the tests fix every line but its order):
  ```ts
  app.get('/api/landing', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    if (!requireMailToken(req, reply, 'GET /api/landing')) return;
    const q = req.query as { project?: unknown };
    if (typeof q.project !== 'string' || q.project.trim() === '') {
      return reply.code(400).send({ ok: false, error: 'bad-request',
        detail: 'the landing line is per-project — ?project= is required' });
    }
    const project = q.project.trim();
    const entries = deps.coord.landingEntries(project);
    const flags = deps.coord.landingProject(project);
    const view: LandingLineView = { project, ...flags, entries, order: landingOrder(entries, flags) };
    return reply.code(200).send({ ok: true, ...view });
  });
  ```
  - Imports: `import { landingOrder } from './landingLine.js';` and `import type { LandingLineView } from '../../../shared/landingLine.js';`.
  - The handler uses no new kebab literal. `bad-request` and `not-configured` are already in `mail-routes.test.ts`'s `NOT_CODES`.
- [ ] **Step 4: run the route test and see it pass.** `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/landing-read-route.test.ts`. Expected: all ten cases pass.
- [ ] **Step 5: the guards turn red, then green.**
  1. Run `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/auth-gate.test.ts test/box-token-census.test.ts test/secret-mask.test.ts test/coord-routes-single-file.test.ts`.
  2. Expected reds, each named:
     - `auth-gate`: `expect(ROUTES.length).toBe(131)` gets 132. `GET /api/landing is box-token gated but not EXEMPT`. The `gated.sort()` list does not equal the derived one. The `in one loop over all` and `the assertion that covers all` claims (129 vs 128, 47 vs 46). `gate.ts's own docstring names the HTTP-route count` (129 vs 128). `scanned + the static wildcard` (132 vs 131).
     - `box-token-census`: `the surface outgrew the word list at 41`; README and `gate.ts` numerals; the auth-gate title; the CLAUDE.md bullet `does not name GET /api/landing`.
     - `secret-mask`: `/api/landing is neither masked nor exempt`.
  3. Make them green, as follows.
  - `server/src/auth/gate.ts`:
    - EXEMPT row after `GET /api/ledger`'s: `['GET /api/landing', "a project's landing line — its entries, its flags and the decider's order — read cookieless from the fleet host before the coordinator enqueues (landing order wave 5e) — box-token gated (requireMailToken), the GET /api/ledger convention: no attribution to check"],`. It does NOT carry the `EXEMPT-BUT-AUTHENTICATED` marker: it takes the token only, never a cookie.
    - Docstring line `One `onRequest` hook stands in front of all 128 routes` becomes `… all 129 routes`.
    - Reason 2: `The thirty-seven box-token machine lanes` becomes `The thirty-eight box-token machine lanes`, and `All forty CHECK the box token` becomes `All forty-one CHECK the box token`.
    - The CSRF note: `the thirty-seven box-token machine` becomes `the thirty-eight box-token machine`, and `— forty in all —` becomes `— forty-one in all —`.
  - `README.md`, the auth paragraph: `the forty machine lanes the` becomes `the forty-one machine lanes the`, and `(thirty-seven box-token-consulting coordination routes plus` becomes `(thirty-eight box-token-consulting coordination routes plus`. The order stays total first, breakdown second.
  - `server/test/box-token-census.test.ts#WORDS`: append `// Landing order wave 5e: forty-one with GET /api/landing, a plain requireMailToken lane.` and `'forty-one'` after `'forty'`.
  - `server/test/auth-gate.test.ts`:
    - Under the ROUTES history comment, add the line `// 132 since landing order wave 5e's `GET /api/landing` (a box-token lane IN EXEMPT): 56 + 58 + 7 + 2 + 4 + 5 = 132, the HTTP half 128 -> 129, the gated count stays 82, the exempt-HTTP count 46 -> 47.`, and change `toBe(131)` to `toBe(132)`.
    - `// 131 scanned + the static wildcard` becomes `// 132 scanned + the static wildcard`.
    - `in one loop over all 128 HTTP routes` becomes `… all 129 HTTP routes`.
    - `covers all 128 HTTP routes, not the 46 exempt` becomes `covers all 129 HTTP routes, not the 47 exempt`.
    - The census title becomes `'the thirty-eight box-token lanes in EXEMPT are those coord routes, and forty-one with notify, pools/epoch and updates/intent'`.
    - Add `'GET /api/landing'` to the `[...EXEMPT.keys()].sort()` list between `'GET /api/feed'` and `'GET /api/ledger'`, and to the `gated.sort()` list between `'GET /api/feed'` and `'GET /api/ledger'`.
  - `server/src/server.ts#MASKED_GET_ROUTES`: add `'/api/landing'` after `'/api/ledger'`.
  - `server/test/secret-mask.test.ts`: the case `GET /api/digest and GET /api/ledger are masked like their siblings, as one frame each` becomes `GET /api/digest, GET /api/ledger and GET /api/landing are masked like their siblings, as one frame each`, with `for (const p of ['/api/digest', '/api/ledger', '/api/landing']) expect(answerMasked('GET', p), p).toBe(true);`.
  - `server/test/coord-routes-single-file.test.ts#COORD_PREFIXES`: append `'/api/landing'`. Note: single-file-prefix. The coordinator skill's linkage scans `coord/routes.ts` only, so a landing route registered elsewhere (5f's `POST /api/landing/entries` and `/order`, 5j's doors) would be named nowhere; this scan catches that, and 5j's session-gated doors must then also live in `coord/routes.ts`, which is where `SESSION_ONLY` scans.
  - `CLAUDE.md`: the box-token bullet's one-line change under **CLAUDE.md (for the operator to read)**, byte for byte.
  - `README.md`, a new paragraph inserted before `**The bypass deny (landing-order wave 2b).**`: `**The landing line (landing-order stage 5).** `GET /api/landing?project=<p>` (box token; `ccrc-api landing show --project <p>`) is the coordinator's read of one project's line before it enqueues: every entry — the PR, its `pinnedSha` (the head the advance to `merging` recorded, which `--match-head-commit` reads), its `handoffCommit`, its state and its ejections — the operator pause and the main-red hold, and the order the server's decider computes on that read; the line is paused while either flag is set. A project the line has never seen answers no entries and both flags off.` The paragraph contains no number word. Note: the README paragraph. README has no route list (`GET /api/ledger` appears only in the ledger prose), so this is a paragraph of its own rather than an edit to the ledger paragraph; it is the only landing-line README paragraph in 5e.
- [ ] **Step 6: the client row (D-7625), red then green.**
  1. In `server/test/ccrc-api.test.ts`:
     - `ROWS`, after `[['ledger', 'allocate'], 'POST', '/api/ledger/deviations'],`: add `// The landing line's read (landing order wave 5e, D-7625).` and `[['landing', 'show'], 'GET', '/api/landing'],`.
     - The case `has exactly the rows exercised above`: add `// Thirty-four since the landing line's read (landing order wave 5e, D-7625).` under the `Thirty-three since …` line, and `toHaveLength(33)` becomes `toHaveLength(34)`.
     - The case `states the row count in prose as the number the table actually holds`: `WORDS` gains `34: 'thirty-four'` after `33: 'thirty-three'`.
     - The case `with that same current file, every non-claimant row sends a request byte-identical to its no-file request`: the `rows` list gains `['landing', 'show', '--project', 'project-a']` after `['ledger', 'allocate', '--json', '-']`.
     - In `describe('a query key rides only if its row declared it')`, add: `it('the landing read carries its project', async () => { await run(['landing', 'show', '--project', 'project-a']); expect(seen[0]!.url).toBe('/api/landing?project=project-a'); });`.
  2. In `server/test/ccrc-api-closed.test.ts`, the case `fills a body on exactly two rows …`: add the history line `// The landing line's read (landing order wave 5e, D-7625) took it to thirty-four; it takes no body and fills none.` after the test box's line, and `expect(routeKeys().size).toBe(33)` becomes `toBe(34)`.
  3. Run `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccrc-api.test.ts test/ccrc-api-closed.test.ts`. Expected reds: `landing,show -> GET /api/landing` (the client refuses the unknown verb, `seen` has length 0); `has exactly the rows exercised above` (the declared keys lack `landing.show`, and 33 vs 34); `every non-claimant row, once`; `the landing read carries its project`; `ccrc-api-closed`'s `expected 33 to be 34`. (`states the row count in prose` stays green here: the table and both prose sites still say thirty-three; it is what holds step 4's two prose edits.)
  4. In `ccd/ccrc-api`:
     - `ROUTES`, after `[ledger.allocate]='POST|/api/ledger/deviations|no|-'`: add `  # The landing line's read (landing order wave 5e, D-7625): one project's entries, flags and order.` and `  [landing.show]='GET|/api/landing|no|project'`.
     - The closed-surface bullet `The route comes from ROUTES below, thirty-three rows, and nothing else;` becomes `… thirty-four rows, and nothing else;`.
     - The table header `# Thirty-three rows, and that word is SCANNED:` becomes `# Thirty-four rows, and that word is SCANNED:`.
  5. `README.md`, the `ccrc-api` verb list: `` `claims list|take|release`, `ledger list|allocate`, `asks list|answer|release` `` becomes `` `claims list|take|release`, `ledger list|allocate`, `landing show`, `asks list|answer|release` `` (re-wrap that paragraph's lines only as the length needs).
  6. Re-run the two files. Expected: green.
- [ ] **Step 7: run the touched files whole, then the guards.** From `server/`:
  1. `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/landing-read-route.test.ts test/auth-gate.test.ts test/box-token-census.test.ts test/secret-mask.test.ts test/coord-routes-single-file.test.ts test/ccrc-api.test.ts test/ccrc-api-closed.test.ts`. Expected: green.
  2. Then the guards: `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/mail-routes.test.ts test/coord-pause-route.test.ts test/coordinator-skill.test.ts test/collect-switch-prose.test.ts test/stall-settings-prose.test.ts test/rings/totality.test.ts test/anchors.test.ts test/citations.test.ts test/deviation-refs.test.ts`. Run `deviation-refs` after `git fetch origin main`, which the worker does, not the planner. The two prose pins are run, not edited: Task 1's bullet edit already holds them.
  3. `coordinator-skill.test.ts` stays red in exactly two cases until Task 4: `names every coordinator-domain route the server registers, method included` (`GET /api/landing`, the route census) and `mentions every declared MailRejectCode and RunRefuseCode SOMEWHERE in the skill` (`ejection-not-merging`, the RunRefuseCode census). Task 4 runs after this one, so record both reds and their messages at this task's commit, and do not edit skill text here.
  4. Then `git fetch origin main` and `GROWTH_CHECK=1 ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/growth-check.test.ts`. `routes.ts` gains about 14 code lines here. Its growth is waived by the new files under `server/src/coord/` and `shared/` that Tasks 1 and 2 add (`growthCheck.ts#L1_L2_NEW_FILE_DIRS`), so no waiver is written.
  5. Then the server typecheck: `ccrc test -- npx tsc --noEmit -p .`, from `server/`.
- [ ] **Step 8: commit.** `git add` exactly these files:
  - `shared/landingLine.ts`, `server/src/coord/routes.ts`, `server/src/server.ts`, `server/src/auth/gate.ts`;
  - `ccd/ccrc-api`;
  - `README.md`, `CLAUDE.md`;
  - the seven test files: `server/test/landing-read-route.test.ts`, `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts`, `server/test/secret-mask.test.ts`, `server/test/coord-routes-single-file.test.ts`, `server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts`.

  Message: `feat(coord): GET /api/landing, the landing line read, box-token gated and masked; ccrc-api landing show; the gate, census and CLAUDE.md lines (landing order wave 5e)`.

**CLAUDE.md (for the operator to read)**

The box-token bullet, one line. `` `GET /api/landing` `` is added beside `` `GET /api/ledger` `` in the `requireMailToken` list.

BEFORE:
```
  `POST /api/coordinators/:session/intent`, `POST /api/ledger/deviations`, `GET /api/ledger` and the approvals lane's
```
AFTER:
```
  `POST /api/coordinators/:session/intent`, `POST /api/ledger/deviations`, `GET /api/ledger`, `GET /api/landing` and the approvals lane's
```
Nothing else in CLAUDE.md is this task's. The coord.db bullet is Task 1's. CLAUDE.md states no lane count (no `forty` or `thirty-seven` occurs in it on `origin/main`), and `box-token-census` reads only route names from the bullet.

**Mutation table**

| id | mutation | predicted red |
|---|---|---|
| 5E-READ-1 | delete `if (!requireMailToken(req, reply, 'GET /api/landing')) return;` | `landing-read-route` "refuses 401 without the box token": expected 200 to be 401, and the body carries the seeded `pinnedSha` (`'a'.repeat(40)`). Also `auth-gate`'s `gated.sort()` list (the scan finds no token check), and `box-token-census` "CLAUDE.md's box-token bullet is TRUE": the bullet names `GET /api/landing` as a lane that consults no box token. |
| 5E-READ-2 | delete the `['GET /api/landing', …]` row from `gate.ts`'s EXEMPT | `auth-gate`: `GET /api/landing is box-token gated but not EXEMPT`, and the sorted `EXEMPT.keys()` list lacks it. The route is still box-token gated, so the loop over `gated` reaches it. |
| 5E-READ-3 | remove `'/api/landing'` from `MASKED_GET_ROUTES` | `secret-mask` "every GET route and websocket is masked by the hook, masked inline, or exempt with a reason": `/api/landing is neither masked nor exempt`. Also the widened `answerMasked('GET', '/api/landing')` case gets `false`. |
| 5E-READ-4 | delete the 400 branch (`typeof q.project !== 'string' …`) | `landing-read-route` "refuses 400 bad-request without ?project=": the empty query reaches `.trim()` on `undefined` and answers 500, and the blank query answers 200. Neither is 400. |
| 5E-READ-5 | `order: landingOrder(entries, { operatorPaused: false, mainRedHold: false })` in place of `flags` | `landing-read-route` "an operator pause … answers a paused line": `order.paused` is `false`, not `{ paused: true, by: ['operator'], … }`. The main-red case reds the same way. |
| 5E-READ-6 | `const project = q.project;` (drop `.trim()`) | "trims the project as the ledger read does": `' project-a '` reads no rows and `entries` is `[]`, not `[A]`. |
| 5E-READ-7 | send `{ ok: true, project, ...flags, entries: [], order: landingOrder([], flags) }` | "answers every entry of the project …": `pr`s are `[]`, not `[11, 12]`, and the head case's `head` is `null`. |
| 5E-READ-8 | move the `app.get('/api/landing', …)` registration from `coord/routes.ts` into `server.ts` | `coord-routes-single-file` "no file but coord/routes.ts registers a coordination path": the new `'/api/landing'` prefix lists the stray `server.ts: app.get('/api/landing')`. Without the prefix it stays green, which is why the prefix row is the guard. |
| 5E-READ-10 | remove `` `GET /api/landing` `` from CLAUDE.md's box-token bullet | `box-token-census` "CLAUDE.md's box-token bullet is TRUE": `does not name GET /api/landing — the surface grew and the sentence did not`. This guard is derived from `requireMailToken` sites, so the route alone forces it. |
| 5E-READ-11 | delete the `[landing.show]='GET|/api/landing|no|project'` row from `ccd/ccrc-api` | `ccrc-api` "landing,show -> GET /api/landing": the client refuses the unknown verb and `seen` has length 0; "has exactly the rows exercised above": the declared keys lack `landing.show`, and 33 is not 34; "states the row count in prose": the sites say `thirty-four`, the table holds thirty-three; "every non-claimant row, once"; `ccrc-api-closed` "fills a body on exactly two rows …": expected 33 to be 34. |
| 5E-READ-12 | change the row's query keys from `project` to `-` | `ccrc-api` "the landing read carries its project": `--project` is refused as an undeclared key, so `seen` is empty and `seen[0]!.url` throws, not `/api/landing?project=project-a`. |

(5E-READ-9 is dropped: the coord.db bullet and its pins are Task 1's.)

Run each mutation alone, on a saved copy restored by sha, never with `git checkout`, and measure each red before and after.

### Task 4: the skill text, and the carried 5b items

The skill text and the items carried from wave 5b's reviews (the Goal's last bullet), and the skill half of the ejection's recorded base (D-7615). The skills name the new read, `GET /api/landing?project=<project>`. §5b gains one paragraph: read the line before each landing, and `pinnedSha` is the recorded head. Step 6's report-less round records its base on the ejecting advance, which makes clause 15's "an ejection naming the base sha the landing line recorded" literally true, so the interim reading (D-7590, narrowed by D-7607) is retired: D-7615 (ejection-records-its-base), D-7627. An ejection is sent only for a run whose entry reads `pinned`, and a run with no entry (one that entered `merging` before 5e) gets no ejection: its round is a stop for the operator. D-7607's two report-less forms stay. The four items carried from wave 5b's reviews (1302, 1303) are taken. The address answer's mail form does not follow from the ejection text, so it stays carried. This task changes no server source and no client row. It runs after Tasks 1 to 3 and depends on them: the advance body takes `ejection` and refuses `ejection-not-merging` (Task 1), the second ejection raises one operator notice (Task 2), and the route is registered in `server/src/coord/routes.ts` with its client row `[landing.show]` in `ccd/ccrc-api` (Task 3).

**Clause 15: no amendment is needed.** The governing sentence of clause 15 (`CONTRACT[14]`, verbatim on main):

> It sends a rebase-check or any other conflict-sync request only on a conflict it has measured; beyond that, the only absorb it asks for is a land-sync to the PR it named next to land in a strict-protection repository, or an ejection naming the base sha the landing line recorded, and it never merges main into any workspace but its own.

Once this wave ships, each kind of report-less round is covered by those words:

| Round | How clause 15's words cover it |
|---|---|
| `ejected: new-head:#<pr>` | The base the mail names is written to the entry (`baseSha`) by the advance that sends the run back, in the same transaction as the run's edge (Task 1). The mail goes only once that advance's answer reads `landing.kind` `ejected` with the base sent (D-7627). So it is an ejection naming the base sha the landing line recorded, as written. |
| `ejected: dequeued:#<pr>` | It is covered the same way, and it is also a conflict-sync on a measured conflict. |
| `red: #<pr>` | It asks for no absorb, so the clause does not apply. Its advance carries no `ejection` body (a bare retreat still ejects the entry, with no base: D-7616 (bare-retreat-ejects)). |
| A PR at `merging` with no entry (it entered `merging` before 5e was deployed) | Step 6 now reads the line first and sends no ejection without a `pinned` entry, so nothing falls outside the clause. The round stays a stop for the operator. |
| The second ejection | It is recorded like the first, with its base, so it is an ejection naming the base sha the landing line recorded. The advance is never refused; when the entry's ejections reach two the server raises one notice to the operator (Task 2), and the coordinator names the second ejection in its turn's text and sends the round as usual: D-7624 (second-ejection-is-a-notice). |

No case is left outside the clause's literal words, so the plan proposes no amendment text. Note: the `conflict` ejection kind has no sender in 5e (ejection-kind-conflict-unsent). If a later wave sends it, it rides the same advance and the same words.

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md`. Step 6, **Send back**: the report-less paragraph only. Clause 15 and every other clause stay byte-identical.
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md`. Four edits:
  - §4's `reject.code` table gains one row, `ejection-not-merging`: D-7619 (ejection-not-merging);
  - §5's native-queue paragraph: the `On dequeued:` sentence, the `Then either` sentence and one new sentence;
  - §5b: the `RED <names>` bullet's first sentence, and one new paragraph, **The landing line.**, between the boundary paragraph and **A stop.**;
  - the `bash` verdict fence stays byte-identical.
- Test: `server/test/coordinator-skill.test.ts`. One new describe; four existing pins amended (the queue action pin, the action pins, the list pin, the boundary pin); the 5b report-less describe amended and extended.
- Test: `server/test/worker-skill.test.ts`. One new whole-bullet pin.
- Not modified: `ccd/worker-skill/SKILL.md`. Its fix-round bullet and clause 16 already read the base an ejection names as clause 16's third trigger. Only the pin is new.
- Not modified here: `ccd/ccrc-api`, `server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts` and README's ccrc-api verb list. The client row `[landing.show]='GET|/api/landing|no|project'`, the row counts 33 → 34 and the verb list are Task 3's: D-7625 (client-row-landing-show). This task consumes the verb.
- Run, unmodified: `server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts`, `server/test/coordinator-landing-verdict.test.ts`, `server/test/session-hook-merge-deny.test.ts`, `server/test/dead-coordinator-prose.test.ts`, `server/test/reviewer-skill.test.ts`, `server/test/install-coordinator-skill.test.ts`, `server/test/anchors.test.ts`, `server/test/citations.test.ts`, `server/test/growth-check.test.ts`.

**Interfaces:**
- Consumes:
  - Task 1: the `merging → working` advance body may carry `{ejection: {base: <40-hex>, kind: LandingEjectionKind}}`. Its `ok` answer carries `landing` (D-7627): `landing.kind` `ejected` with `entry.baseSha` equal to the base sent means the entry went `ejected` with that base in the same transaction; any other kind means no base was recorded. A retreat with no `ejection` body carries none and still ejects the entry with `baseSha` and `ejectionKind` null (D-7616). An `ejection` body on a run not at `merging` is refused with the one new `RunRefuseCode`, `ejection-not-merging`, declared in `shared/api.ts` and sent on `reject.code` as `{ code: 'ejection-not-merging', from: <state> }`; `RUN_REFUSE_CODES`' census ("mentions every declared MailRejectCode and RunRefuseCode SOMEWHERE in the skill") then needs it in the skill, and §4's row carries it.
  - Task 2: when an entry's `ejections` reaches 2, the server raises one operator notice through the existing notice sink; the advance is never refused for it, and there is no refusal code for it.
  - Task 3: `GET /api/landing?project=<p>`, registered in `server/src/coord/routes.ts` as `app.get('/api/landing', …)`, so that `registeredCoordRoutes()` harvests `GET /api/landing`. It answers `LandingLineView { project; operatorPaused; mainRedHold; entries: LandingEntry[]; order: LandingOrder }`, each entry carrying its `id`. Task 3 also adds the client row `[landing.show]='GET|/api/landing|no|project'` in `ccd/ccrc-api`, so `ccrc-api landing show --project <p>` exists.
  - L0 `shared/landingLine.ts`: `LANDING_EJECTION_KINDS = ['dequeued','new-head','conflict']` and `LANDING_ENTRY_STATES` (`pinned`, `ejected`, `landed`, `withdrawn`, `unknown`).
  - The test helper `clientRoutes(): ClientRoute[]` (`server/test/ccrcApiTable.ts`, `{key, method, path, needsId, query, family}`).
- Produces:
  - Skill text naming `GET /api/landing?project=<project>` and the client verb `ccrc-api landing show --project <project>`, and naming `ejection-not-merging` in §4's table.
  - Every exported symbol and every wire type is unchanged.

- [ ] **Step 1: The failing tests.**
  - **`server/test/coordinator-skill.test.ts`, the 5b report-less describe** (`describe('landing order wave 5b: the report-less fix round from merging', …)`). In the case "sends a fix round with no report from merging…":
    - replace the `**An ejection** is sent…` expectation's tail `exits 1 and lists the conflicted paths.` with `exits 1 with a tree id on its first line, then the conflicted paths.`;
    - replace the `Until the landing line records a base (stage 5e)…` expectation with the `Every ejection is clause 15's ejection…` sentence (REPORT_LESS[3] below).

    In "no report-less sentence holds a double quote", replace `'Until the landing line records a base'` with `'Every ejection is clause 15'`. Then add these three cases to the same describe:
    ```ts
    const REPORT_LESS = [
      '**A fix round with no report behind it** comes from `merging`, and the cause you measured decides which of two forms it takes.',
      '**An ejection** is sent in two cases only: the new-head route for a red that is `main`\'s own (`references/wave-lifecycle.md` §5b), and a dequeue (§5) whose cause is a conflict you measured: after one `git fetch origin`, `git merge-tree --write-tree --name-only --no-messages origin/main <handoffCommit>` exits 1 with a tree id on its first line, then the conflicted paths.',
      'Its body holds three entries, one to a line, and nothing else: `ejected: new-head:#<pr>` or `ejected: dequeued:#<pr>`, then `base: <sha>`, the `origin/main` sha you read after one `git fetch origin`, then `checks: <required names that are red>` for the new-head route or `paths: <the conflicted paths>` for the dequeue.',
      'Every ejection is clause 15\'s ejection, its base recorded on the landing line by the advance that sends the run back: first read the line, `GET /api/landing?project=<project>` (`ccrc-api landing show --project <project>`), and send an ejection only where this PR\'s entry for this run reads `pinned`; with no such entry the round is no ejection, and it stays a stop for the operator.',
      '**A red the PR owns** is sent when the queue dequeued the PR for a required check and no conflict was measured, or when the verdict\'s `RED` line names a required check red on the head that is the PR\'s own.',
      'Its body holds two entries, one to a line, and nothing else: `red: #<pr>`, then `checks: <required names that are red>`.',
      'It has no `base:` entry and licenses no absorb: the worker absorbs only on its own clause 16\'s first two triggers.',
      'A dequeue with any other cause, a requested change or a cause you could not read among them, is no report-less round: it stays a stop for the operator.',
      'For either form, on route Q disarm first (§5), then make the same advance to `working`, on the `merging → working` edge, and send the same `fix-round` mail with no `artifacts`.',
      'Every `ejected:` round\'s advance carries `ejection`, an object of two fields: `base`, the sha on the mail\'s `base:` line, and `kind`, `new-head` or `dequeued` as the mail\'s first line names it; a `red:` round\'s advance, and any other retreat, carries none.',
      'Send the `ejected:` mail once the advance\'s answer reads `landing.kind` `ejected` with the base you sent.',
      'If it reads anything else, the line recorded no base: send no mail, and report it to the operator with the run at `working`.',
      'The second ejection of one entry is not refused: where the entry you read counts one ejection already, the advance still answers `ok` and the server raises one notice to the operator, so name the second ejection in your turn\'s text and send the round as usual.',
      'The worker\'s answering wave-done gets a NEW review run (step 5), whose brief names that round\'s commits as the change under review, for the new-head round its merge commit; the reviewer still reads the whole diff (reviewer clause 5), and a merge of `main` is reviewed like any other change.',
    ].join(' ');

    it('pins step 6\'s report-less paragraph whole, so no sentence can widen it again (review 1303 F2; the report-less pin)', () => {
      const s = sendBack();
      const from = s.indexOf('**A fix round with no report behind it**');
      expect(from, 'step 6 lost its report-less paragraph').toBeGreaterThanOrEqual(0);
      expect(s.slice(from).replace(/\s*-\s*$/, '').trim()).toBe(REPORT_LESS);
    });

    it('records the base on the ejecting advance, so clause 15\'s ejection is literal and the interim reading is retired (D-7615)', () => {
      expect(CONTRACT[14]).toContain('or an ejection naming the base sha the landing line recorded');
      for (const k of ['new-head', 'dequeued']) {
        expect(LANDING_EJECTION_KINDS, `the skill sends a kind L0 does not define: ${k}`).toContain(k);
        expect(sendBack()).toContain(`\`ejected: ${k}:#<pr>\``);
      }
      expect(flat(allSkillText), 'the interim reading is back (D-7590, D-7607)').not.toContain('Until the landing line records a base');
      expect(flat(allSkillText)).not.toContain('exits 1 and lists the conflicted paths');
    });

    it('names a client verb the closed client really has: `ccrc-api landing show --project <project>`', () => {
      expect(flat(allSkillText)).toContain('`GET /api/landing?project=<project>` (`ccrc-api landing show --project <project>`)');
      const row = clientRoutes().find((r) => r.key === 'landing.show');
      expect(row?.method).toBe('GET');
      expect(row?.path).toBe('/api/landing');
      expect(row?.query).toEqual(['project']);
    });
    ```
    Add these imports: `import { LANDING_EJECTION_KINDS } from '../../shared/landingLine.js';` and `import { clientRoutes } from './ccrcApiTable.js';`. The client-verb case's row half needs Task 3's row on the branch.
  - **`server/test/coordinator-skill.test.ts`, the queue action pin** ("pins the whole native-queue landing paragraph…"). In `whole`, replace the `'On \`dequeued:\`, read why…'` entry and the `'Then either enqueue it again…'` entry with these three entries, in this order:
    ```ts
    'On `dequeued:`, read why from the queue\'s own CI run, not the PR\'s checks, which ran on a different commit and can read green — `gh run list --event merge_group --json databaseId,headBranch,conclusion` finds it by its `headBranch` (`gh-readonly-queue/<base>/pr-<pr>-…`) and `gh run view <id> --log-failed` says why, and a conflict is measured as SKILL.md step 6 measures it: after one `git fetch origin`, `git merge-tree --write-tree --name-only --no-messages origin/main <handoffCommit>` exits 1 with a tree id on its first line, then the conflicted paths.',
    'Then either enqueue it again exactly as above — the landing verdict (§5b) again first, then the checks, then the read-back — or send the owning worker a fix round on the `merging → working` edge in one of the two report-less forms of SKILL.md step 6\'s send-back (its fresh wave-done gets a fresh review run, and a fresh `merging`).',
    'A dequeue that neither a re-enqueue nor one of those two forms answers, a requested change or a cause you could not read among them, is a stop for the operator and no report-less round (SKILL.md step 6).',
    ```
    After `expect(para).toBe(whole);`, add `expect(flat(wl), 'the conflict read is again GitHub\'s merge state (review 1302)').not.toContain('mergeStateStatus');`.
  - **The RED bullet, in two pins:** "pins the action text of every verdict line, whole (the action pins)" and "pins the whole verdict-line list…". In both, the `RED <names>` entry's sentence `If it is the PR\'s own, that is the existing fix-round rule (step 3: on route Q disarm first, then a fix round to the owning worker on the \`merging → working\` edge).` becomes `If it is the PR\'s own, that is the existing fix-round rule (step 3: on route Q disarm first, then a fix round to the owning worker on the \`merging → working\` edge), in SKILL.md step 6\'s \`red: #<pr>\` form.`
  - **The boundary pin** ("pins the whole boundary paragraph…"): `const to = prose.indexOf('**The landing line.**');`, with the message `'the boundary paragraph lost the landing-line paragraph that follows it'`. Its `whole` is unchanged. Note: the boundary pin's end moves (boundary-pin-end-moves): its slice ended at `**A stop.**` and now ends at `**The landing line.**`, and the new line pin covers from there to `**A stop.**`, so the two pins cover the same text with no gap.
  - **A new describe**, after the 5b report-less describe:
    ```ts
    describe('landing order wave 5e: the landing line read before every landing', () => {
      const wl = refs('wave-lifecycle.md');
      const at = wl.indexOf('### 5b — The landing route, from the repository\'s own rules');
      const sec = at >= 0 ? wl.slice(at, wl.indexOf('\n## ', at)) : '';
      const prose = flat(sec.replace(/```bash\n([\s\S]*?)```/, ''));
      const LINE = [
        '**The landing line.** Every run that enters `merging` pins an entry for its PR on its project\'s landing line, and the entry\'s `pinnedSha` is the recorded head (**The recorded head**, §5): the server pins it from the same re-measurement that answers `verifiedHead`.',
        'Before each enqueue, direct merge and re-enqueue, once the verdict, and on route Q the checks gate, have answered, read the line: `GET /api/landing?project=<project>` (`ccrc-api landing show --project <project>`).',
        'Land only when its `order` is not paused and this PR\'s entry for this run reads `pinned` with a `pinnedSha` equal to the head you bind.',
        'A paused line, an entry in another state, a `pinnedSha` that differs from that head or a read that fails in any other way than a 404 (a timeout, a 401, a 5xx, a transport error or an answer you cannot parse) lands nothing: report what it read to the operator and leave the landing stopped, and never bind another head to match it.',
        'A PR with no entry, which a run that entered `merging` before the line existed leaves, lands as the verdict says, and your turn\'s text names the missing entry.',
        'A read answered 404 comes from a server older than the line: read it as no entry, and land the same way.',
        'The order it answers is read and not yet acted on: which entry lands next is the line\'s head, a later stage\'s.',
      ].join(' ');

      it('pins the whole landing-line paragraph, between the boundary paragraph and the stop paragraph (the line pin)', () => {
        const from = prose.indexOf('**The landing line.**');
        const to = prose.indexOf('**A stop.**');
        expect(from, '§5b lost its landing-line paragraph').toBeGreaterThanOrEqual(0);
        expect(to, 'the landing-line paragraph lost the stop paragraph that follows it').toBeGreaterThan(from);
        expect(prose.slice(from, to).trim()).toBe(LINE);
      });

      it('names the line\'s entry state through L0, and the ejection-not-merging refusal in §4\'s table', () => {
        expect(LANDING_ENTRY_STATES).toContain('pinned');
        expect(flat(wl)).toContain('| `ejection-not-merging` | on an ADVANCE to `working` whose body carries `ejection`, from a run not at `merging`: an ejection rides only the `merging → working` edge.');
      });

      it('no 5e sentence holds a double quote', () => {
        const flatAll = flat(allSkillText);
        for (const s of [
          'Every ejection is clause 15', 'Every `ejected:` round', 'Send the `ejected:` mail once',
          'The second ejection of one entry', '**The landing line.** Every run', 'Before each enqueue, direct merge and re-enqueue',
          'Land only when its `order`', 'A paused line, an entry', 'A PR with no entry, which a run that entered', 'The order it answers',
          'A dequeue that neither a re-enqueue', 'On `dequeued:`, read why',
        ]) {
          const from = flatAll.indexOf(s);
          expect(from, s).toBeGreaterThanOrEqual(0);
          const sentence = flatAll.slice(from, flatAll.indexOf('. ', from));
          expect(sentence, `a double quote in the sentence beginning ${s}`).not.toContain('"');
        }
      });
    });
    ```
    Extend the L0 import to `import { LANDING_EJECTION_KINDS, LANDING_ENTRY_STATES } from '../../shared/landingLine.js';`. Every census start occurs once in the flattened skill text: on origin/main none of them occurs except `On \`dequeued:\`, read why`, which occurs once in the §5 text this task keeps (`A PR with no entry` alone occurs twice there, in §5's read-back text, which is why the start carries `, which a run that entered`).
  - **`server/test/worker-skill.test.ts`.** Add one case to the describe that holds "reads a fix-round mail with no report in its two forms…":
    ```ts
    it('pins the whole fix-round bullet, from its heading to the end of the file, so no sentence can widen a report-less round (review 1303 F2; the fix-round pin)', () => {
      const from = skill.indexOf('- **A `fix-round` mail arrives**');
      expect(from, 'the worker skill lost its fix-round bullet').toBeGreaterThanOrEqual(0);
      const whole = [
        '- **A `fix-round` mail arrives** (kind `status`, from the coordinator, naming this run): usually a review run read your wave and the coordinator ruled.',
        'The report at the path in the mail\'s `artifacts` — plus the rulings in its body — is your brief for the fix round.',
        'Ack it (clause 3), fix on this workspace\'s own branch (clause 2), and report a FRESH wave-done fingerprint (clause 9); never re-send the old numbers.',
        'A `fix-round` mail whose first line reads `ejected: dequeued:#<pr>` or `ejected: new-head:#<pr>` has no report and no `artifacts`: it is clause 16\'s ejection, and its three body lines are your whole brief.',
        'Absorb the `base:` sha with `git merge`, then fix only the `paths:` it names; on `ejected: new-head:#<pr>` the merge is the whole round, with nothing else in it.',
        'If the new-head merge does not apply cleanly, run `git merge --abort`, push nothing (clause 9) and ask, as clause 5 says: resolving a conflict is not that round\'s work.',
        'A `fix-round` mail whose first line reads `red: #<pr>` has no report, no `artifacts` and no `base:`: its `checks:` line is your whole brief, so fix the named checks on this branch.',
        'It licenses no absorb: clause 16\'s first two triggers still apply to it, and its third does not.',
        'Report a FRESH wave-done as for any fix round.',
      ].join(' ');
      expect(skill.slice(from).replace(/\s+/g, ' ').trim()).toBe(whole);
    });
    ```
    This case is green on main. It is a new guard, and mutant 5E-SKILLS-8 measures its red.

- [ ] **Step 2: Run and see the failures.** From `server/`, with Tasks 1 to 3 on the branch:
  `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-skill.test.ts test/worker-skill.test.ts`
  Expected reds:
  - coordinator-skill:
    - "names every coordinator-domain route the server registers…", `GET /api/landing` missing: red since Task 3 registered the route;
    - "mentions every declared … RunRefuseCode", `ejection-not-merging` missing: red since Task 1 declared the code;
    - the report-less pin, the clause-15 case and the client-verb case (its prose half; its row half is green from Task 3's row);
    - the line pin;
    - the 5e census, since its sentence starts are absent;
    - the 5e table case, since §4 has no `ejection-not-merging` row;
    - the queue action pin, the action pins and the list pin;
    - the boundary pin, since `**The landing line.**` is absent;
    - the amended 5b fragment cases.
  - worker-skill: green. Its new pin holds today's text.

  The first two reds are left by Tasks 1 and 3 and are this task's to turn green; the PR is one state, so they are never red on a pushed head.

- [ ] **Step 3: The skill text, verbatim.**
  - **`ccd/coordinator-skill/SKILL.md`, step 6, Send back.** Replace everything from `**A fix round with no report behind it**` to the end of the **Send back** bullet, keeping its 5-space indent:
    ```
         **A fix round with no report behind it** comes from `merging`, and the
         cause you measured decides which of two forms it takes. **An ejection** is
         sent in two cases only: the new-head route for a red that is `main`'s own
         (`references/wave-lifecycle.md` §5b), and a dequeue (§5) whose cause is a
         conflict you measured: after one `git fetch origin`, `git merge-tree
         --write-tree --name-only --no-messages origin/main <handoffCommit>` exits 1
         with a tree id on its first line, then the conflicted paths. Its body holds
         three entries, one to a line, and nothing else: `ejected: new-head:#<pr>`
         or `ejected: dequeued:#<pr>`, then `base: <sha>`, the `origin/main` sha you
         read after one `git fetch origin`, then `checks: <required names that are
         red>` for the new-head route or `paths: <the conflicted paths>` for the
         dequeue. Every ejection is clause 15's ejection, its base recorded on the
         landing line by the advance that sends the run back: first read the line,
         `GET /api/landing?project=<project>` (`ccrc-api landing show --project
         <project>`), and send an ejection only where this PR's entry for this run
         reads `pinned`; with no such entry the round is no ejection, and it stays
         a stop for the operator. **A red the PR owns** is sent when the queue
         dequeued the PR for a required check and no conflict was measured, or when
         the verdict's `RED` line names a required check red on the head that is the
         PR's own. Its body holds two entries, one to a line, and nothing else:
         `red: #<pr>`, then `checks: <required names that are red>`. It has no
         `base:` entry and licenses no absorb: the worker absorbs only on its own
         clause 16's first two triggers. A dequeue with any other cause, a
         requested change or a cause you could not read among them, is no
         report-less round: it stays a stop for the operator. For either form, on
         route Q disarm first (§5), then make the same advance to `working`, on the
         `merging → working` edge, and send the same `fix-round` mail with no
         `artifacts`. Every `ejected:` round's advance carries `ejection`, an
         object of two fields: `base`, the sha on the mail's `base:` line, and
         `kind`, `new-head` or `dequeued` as the mail's first line names it; a
         `red:` round's advance, and any other retreat, carries none. Send the
         `ejected:` mail once the advance's answer reads `landing.kind` `ejected`
         with the base you sent. If it reads anything else, the line recorded no
         base: send no mail, and report it to the operator with the run at
         `working`. The second ejection of one entry is not refused: where
         the entry you read counts one ejection already, the advance still answers
         `ok` and the server raises one notice to the operator, so name the second
         ejection in your turn's text and send the round as usual. The worker's
         answering wave-done gets a NEW review run (step 5), whose brief names that
         round's commits as the change under review, for the new-head round its
         merge commit; the reviewer still reads the whole diff (reviewer clause 5),
         and a merge of `main` is reviewed like any other change.
    ```
  - **`wave-lifecycle.md` §4, the `reject.code` table.** Directly after the `cap-review-rounds` row, add:
    ```
    | `ejection-not-merging` | on an ADVANCE to `working` whose body carries `ejection`, from a run not at `merging`: an ejection rides only the `merging → working` edge. The server recorded nothing: the run and its landing entry are unchanged. Do not retry with the body and send no `fix-round` mail; re-read the run, and a run no longer at `merging` gets no ejection: report it to the operator (SKILL.md step 6). |
    ```
  - **`wave-lifecycle.md` §5, the native-queue paragraph.** Replace the text from `On \`dequeued:\`, read why` through `and a fresh \`merging\`).` with this text (3-space indent):
    ```
       On `dequeued:`, read why from the queue's own CI run, not
       the PR's checks, which ran on a different commit and can read green —
       `gh run list --event merge_group --json databaseId,headBranch,conclusion`
       finds it by its `headBranch` (`gh-readonly-queue/<base>/pr-<pr>-…`) and
       `gh run view <id> --log-failed` says why, and a conflict is measured as
       SKILL.md step 6 measures it: after one `git fetch origin`, `git merge-tree
       --write-tree --name-only --no-messages origin/main <handoffCommit>` exits 1
       with a tree id on its first line, then the conflicted paths. Then either
       enqueue it again exactly as above — the landing verdict (§5b) again first,
       then the checks, then the read-back — or send the owning worker a fix round
       on the `merging → working` edge in one of the two report-less forms of
       SKILL.md step 6's send-back (its fresh wave-done gets a fresh review run,
       and a fresh `merging`). A dequeue that neither a re-enqueue nor one of
       those two forms answers, a requested change or a cause you could not read
       among them, is a stop for the operator and no report-less round (SKILL.md
       step 6).
    ```
    `Closing before the landing would hand…` follows unchanged.
  - **`wave-lifecycle.md` §5b, the `RED <names>` bullet.** Its second sentence becomes:
    ```
      kind. If it is the PR's own, that is the existing fix-round rule (step 3:
      on route Q disarm first, then a fix round to the owning worker on the
      `merging → working` edge), in SKILL.md step 6's `red: #<pr>` form. If it
      is not the PR's own and its kind is `[github-actions]`, …
    ```
    The rest of the bullet is unchanged.
  - **`wave-lifecycle.md` §5b, the new paragraph.** Insert it between the boundary paragraph (`… is a server follow-up, not this skill's.`) and `**A stop.**`, with one blank line on each side:
    ```
    **The landing line.** Every run that enters `merging` pins an entry for its PR
    on its project's landing line, and the entry's `pinnedSha` is the recorded head
    (**The recorded head**, §5): the server pins it from the same re-measurement
    that answers `verifiedHead`. Before each enqueue, direct merge and re-enqueue,
    once the verdict, and on route Q the checks gate, have answered, read the line:
    `GET /api/landing?project=<project>` (`ccrc-api landing show --project
    <project>`). Land only when its `order` is not paused and this PR's entry for
    this run reads `pinned` with a `pinnedSha` equal to the head you bind. A paused
    line, an entry in another state, a `pinnedSha` that differs from that head or a
    read that fails in any other way than a 404 (a timeout, a 401, a 5xx, a
    transport error or an answer you cannot parse) lands nothing: report what it
    read to the operator and leave the landing stopped, and never bind another head
    to match it. A PR with no entry, which a run that entered `merging` before the
    line existed leaves, lands as the verdict says, and your turn's text names the
    missing entry. A read answered 404 comes from a server older than the line: read
    it as no entry, and land the same way. The order it answers is read and not yet
    acted on: which entry lands next is the line's head, a later stage's.
    ```
    The read is advisory in 5e: D-7626 (the-line-read-is-advisory-in-5e). A missing entry lands as the verdict says, because in 5e nothing but the advance writes an entry and a stop would wedge every landing in flight at deploy time; and the order is read, not obeyed, until 5i, since both pause flags have no writer before then. An ejection still needs a `pinned` entry, because a base can only be recorded on an entry.
  - Wrap at most 80 columns, so that the wrap rule for "On every route" and the file's width are unchanged.

- [ ] **Step 4: The fence is unchanged.** From the worktree root, run both commands and compare the digests. They must be equal:
  ```
  git show origin/main:ccd/coordinator-skill/references/wave-lifecycle.md | sed -n '/^### 5b — /,/^## 6 — /p' | awk '/^```bash$/{f=1;next} f&&/^```$/{exit} f' | sha256sum
  sed -n '/^### 5b — /,/^## 6 — /p' ccd/coordinator-skill/references/wave-lifecycle.md | awk '/^```bash$/{f=1;next} f&&/^```$/{exit} f' | sha256sum
  ```
  Report the digest in the wave-done.

- [ ] **Step 5: Run and see them pass.** From `server/`:
  `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-skill.test.ts test/worker-skill.test.ts`
  All green. The worker clause count (nineteen) and the coordinator clause count (nineteen) are unchanged.

- [ ] **Step 6: The suites that read these texts.** From `server/`:
  `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccrc-api.test.ts test/ccrc-api-closed.test.ts test/coordinator-landing-verdict.test.ts test/session-hook-merge-deny.test.ts test/dead-coordinator-prose.test.ts test/reviewer-skill.test.ts test/install-coordinator-skill.test.ts test/anchors.test.ts test/citations.test.ts test/box-token-census.test.ts`
  Then, after `git fetch origin main`, run growth-check armed: `GROWTH_CHECK=1 ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/growth-check.test.ts`. No file this task changes is a growth-check file (`GROWTH_FILES` in `server/test/growth-check.test.ts` lists `ccd/ccrc`, not `ccd/ccrc-api`, and neither skill file), so no waiver is needed. SKILL.md and wave-lifecycle.md have no size cap in either skill suite. Run the private-name scan over every changed file.

- [ ] **Step 7: The mutation table.** Run each row through the mutation helper, restoring from a saved copy and checking its sha. Run them one at a time. Every row is measured with Tasks 1 to 3 on the branch: without them, row 7 reds only the client-verb case and row 15 only the 5e table case.

| # | Mutation | Predicted red |
|---|---|---|
| 5E-SKILLS-1 | Delete the `**The landing line.**` paragraph from §5b | The line pin (`from` is -1). The boundary pin (`to` is -1). The 5e census (`'**The landing line.** Every run'` not found). |
| 5E-SKILLS-2 | In the line paragraph, replace `Land only when its \`order\` is not paused and` with `Land when` | The line pin. `toBe(LINE)` cannot hold with a changed sentence. |
| 5E-SKILLS-3 | Append `On a paused line, enqueue once the operator is away.` to the line paragraph | The line pin: the slice to `**A stop.**` gains a sentence. The boundary pin stays green, which shows the new pin is the only guard. |
| 5E-SKILLS-4 | Append `An ejection may also be sent for any red the PR owns.` to step 6's report-less paragraph | The report-less pin. The 5b fragment cases all stay green, which is the review 1303 F2 gap measured closed. |
| 5E-SKILLS-5 | Restore the sentence `Until the landing line records a base (stage 5e), …` in place of `Every ejection is clause 15's ejection…` | The report-less pin. The clause-15 case (`not.toContain('Until the landing line records a base')`). The amended 5b fragment case. |
| 5E-SKILLS-6 | Delete the sentence `Send the \`ejected:\` mail once the advance's answer reads …` | The report-less pin. Its sentence appears nowhere else, so no fragment holds it, and the 5e census also reds (start not found). |
| 5E-SKILLS-7 | Remove both `GET /api/landing?project=<project>` mentions (step 6 and §5b) | "names every coordinator-domain route the server registers…" (`GET /api/landing` is registered by Task 3 and named nowhere). The client-verb case also reds. |
| 5E-SKILLS-8 | In the worker's fix-round bullet, change `then fix only the \`paths:\` it names` to `then fix the \`paths:\` or \`checks:\` it names, and anything else they touch` | Worker: the fix-round pin, and the existing fragment case, whose `toContain` loses its sentence. Append-only variant: add `It may also fix anything the review raised.` at the bullet's end. Only the fix-round pin reds, because the end-of-file slice gains a sentence. |
| 5E-SKILLS-9 | Restore `, while \`gh pr view <pr> --json mergeStateStatus\` answers a conflict` in §5's `On dequeued:` sentence | The queue action pin (`toBe(whole)`), and its new `not.toContain('mergeStateStatus')`. |
| 5E-SKILLS-10 | Delete §5's sentence `A dequeue that neither a re-enqueue nor …` | The queue action pin. The 5e census (start not found). |
| 5E-SKILLS-11 | In the RED bullet, delete `, in SKILL.md step 6's \`red: #<pr>\` form` (the parenthesis then ends the sentence) | The action pins and the list pin. Both compare the bullet's whole sentence list. |
| 5E-SKILLS-12 | Write the ejection field as `"ejection"` (double quotes) in step 6's `Every \`ejected:\` round's advance carries …` sentence | The 5e census (`a double quote in the sentence beginning Every \`ejected:\` round`). The report-less pin also reds. |
| 5E-SKILLS-13 | Rename the prose verb to `ccrc-api landing list` in both places (Task 3's row left as `landing.show`) | The client-verb case: the `toContain` misses `(\`ccrc-api landing show --project <project>\`)`. The report-less pin and the line pin also red. |
| 5E-SKILLS-14 | Restore `exits 1 and lists the conflicted paths` in step 6 | The report-less pin. The clause-15 case (`not.toContain('exits 1 and lists the conflicted paths')`). The amended 5b fragment case. |
| 5E-SKILLS-15 | Delete the `ejection-not-merging` row from §4's table (its only mention) | "mentions every declared MailRejectCode and RunRefuseCode SOMEWHERE", since Task 1 declares the code. The 5e table case. |
| 5E-SKILLS-16 | Change `kind` in step 6 to name `conflict` instead of `dequeued` (`ejected: conflict:#<pr>` in the body list) | The clause-15 case: `sendBack()` no longer holds `` `ejected: dequeued:#<pr>` ``. The report-less pin. The 5b "names the report-less first lines the worker skill reads" case, because the worker still reads `ejected: dequeued:#<pr>` and the coordinator no longer sends it. |

- [ ] **Step 8: Commit.**
  `git add ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md server/test/coordinator-skill.test.ts server/test/worker-skill.test.ts`
  `git commit -m "docs(skills): read the landing line before each landing, record the ejection's base on the advance, and take wave 5b's carried items (landing order wave 5e)"`

### Task 5: The gate, the PR and the wave-done

**Files:** none new. This task measures, opens the PR and reports.

- [ ] **Step 1: The fence.** `git diff origin/main -- ccd/coordinator-skill/references/wave-lifecycle.md` shows no hunk between §5b's `` ```bash `` and its closing fence. The hash, measured with `sed -n '/^### 5b — /,/^## 6 — /p' <file> | awk '/^```bash$/{f=1;next} f&&/^```$/{exit} f' | sha256sum`, reads `dec52b5aaf9d6166853a25a18db29d2203a38fd6ace044f7c7068e43c4eef3a7` (254 lines).

- [ ] **Step 2: The slot.** `git fetch origin main`, then `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'`. It prints 34, and this branch's `MIGRATIONS.length` is 35. If `main` has moved, follow the Global Constraint and report it.

- [ ] **Step 3: The suites.** One file per process, from `server/`, as `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/<file>`. Expected: green.
  - **Every test file Tasks 1 to 4 create or modify,** whole. That includes the new landing-line migration, store, census, order, notice and route tests, and `coord-db`, `advance-gate`, `merging-episode`, `mail-routes`, `ccrc-api`, `ccrc-api-closed`, `coordinator-skill` and `worker-skill`.
  - **The readers of the changed files:**
    - `run-routes`, `review-cap`, `coord-pause-route` and `coord-routes-single-file`;
    - `auth-gate`, `box-token-census` and `secret-mask`;
    - `collect-switch-prose` and `stall-settings-prose`;
    - `coordinator-landing-verdict`, `landing-verdict` and `coord-lineage`;
    - `reviewer-skill`, `dead-coordinator-prose` and `install-coordinator-skill`.
  - **The guards:**
    - every `single-definition/*` file, each in its own process;
    - every `rings/*` file, each in its own process;
    - `coord-policy-rings` and every `census-w8/*` file;
    - `citations`, `anchors`, `docs-parity` and `topology-clean`;
    - `deviation-refs`, after `git fetch origin main`;
    - `growth-check`, with `GROWTH_CHECK=1` after the fetch, reporting `store.ts`'s and `routes.ts`'s net deltas;
    - `typecheck-tests` alone, and `tsc --noEmit` for the server.
  - `session-hook` is a known load flake. If it is red, re-run it alone. Name every re-run in the wave-done.

- [ ] **Step 4: The mutation table.** Re-measure every row of Tasks 1 to 4 on the final files, sequentially, under the Global Constraints. Report each row as measured against predicted, naming the cases that went red, and each recorded survivor with its reason.

- [ ] **Step 5: `CLAUDE.md`.** `git diff origin/main -- CLAUDE.md` shows exactly the two changes (the coord.db bullet and the box-token bullet) in **CLAUDE.md (for the operator to read)**, byte for byte, and nothing else.

- [ ] **Step 6: The PR.**
  - Before every push, scan the diff and the PR body for private names, as the repository's rule asks.
  - Push the branch once, after Steps 1 to 5 are green.
  - In the PR body, name:
    - the two `CLAUDE.md` lines;
    - the fence hash;
    - the slot taken;
    - the mutation rows;
    - `store.ts`'s and `routes.ts`'s growth figures.

- [ ] **Step 7: The wave-done.** Send one wave-done at the exact final tip, with the fingerprint and the PR number. Include:
  - the gate's suite lines, with each re-run of a known load flake named;
  - the fence hash and the slot;
  - every mutation row measured against its prediction;
  - every departure (`D-TBD-<slug>`);
  - the PR's fast run: whether its `plan fast server tests` summary lists the new test files and `coordinator-skill`, or names the ones it left to the merge queue.

## Deviations found

This plan's numbers are D-7610 to D-7627, issued on 2026-10-31 for wave 5e. Each entry is dated 2026-10-31.

- **D-7610** — `journal-ships-with-its-first-writer` (plan): the ledger's Waves row 5e and the stage-5 survey put `~/.ccrc/landing.log` and its replay in 5e. This plan moves them to 5f, by this plan's rule that a mechanism ships with its first writer, in the spirit of D-4329's one-concern-per-PR reason. Every authoritative column spec §5.5 journals arrives later:
  - order edges, `fixesMain` and run-less entries in 5f;
  - intents in 5g;
  - the operator pause and withdrawals in 5j.

  Every column 5e writes (the pin, the ejection count, the base and its kind) is recomputable from the run it comes from. So the coord.db invariant's journal sentence also waits for 5f. 5e's `CLAUDE.md` line names the landing line only among what a lost database loses.
- **D-7611** — `one-migration-two-tables` (Task 1): spec §5.5's one migration adds three tables. This wave's migration (slot 35) adds `landing_entries` and `landing_projects`, each complete. `landing_intents` gets its own slot in 5g with its writer (O2). The columns that later sub-waves write hold their defaults, inert, until then: `afterIds`, `fixesMain` and a non-run entry's `setBy` (5f), `mainRedHold` (5i), and `operatorPaused` (5j). The decider that reads them ships here and is tested on fixture rows.
- **D-7612** — `no-repo-column` (Task 1): spec §5.5 lists `landing_entries.repo`. The column is dropped (O3). The only project-to-slug fact is the server's in-memory `projectRepos`, which may read unmeasured. A stored copy would be a second writer of that fact, and the PR-keyed form (5c) resolves the slug on the fleet box.
- **D-7613** — `the-entry-shape` (Tasks 1 and 2):
  - `LandingEntry` carries `id` (the table's primary key), and `afterIds` name entry ids.
  - The state map has a fifth word, `unknown`, for a row this build cannot read. Schema.ts's rule asks every enum column for a we-do-not-know member on the read side. An `unknown` entry is never in the line.
  - Beyond the spec's columns, an entry carries `ejectionKind`, `ejections` and `pinnedAt`.
  - `LandingOrder`, `LandingLineFlags` and the pause words live in L0 `shared/landingLine.ts`, because `LandingLineView` names them and L0 imports nothing.
- **D-7614** — `one-writer-of-the-pin` (Task 1): `advanceAct` no longer builds the `merging-at:` detail. `CoordStore.advanceLanding` builds it with `mergingAtDetail` from the same head it writes as `pinnedSha`, in one transaction, and a census pins `mergingAtDetail`'s only call to that method. The scope asked for the entry to be written "from the same value as the run's `merging-at:` detail". This makes that structural rather than conventional (survey risk 3).
- **D-7615** — `ejection-records-its-base` (Tasks 1 and 4): a `merging → working` advance may carry `{ejection: {base: <40-hex>, kind}}`. The entry goes `ejected` and records the base and kind in the same transaction. Step 6's report-less round records its base on every `ejected:` advance. So clause 15's "an ejection naming the base sha the landing line recorded" is literally true for every `ejected:` round, and clause 15 needs no amendment. The interim reading of D-7590, narrowed by D-7607, is retired. An ejection is sent only for a run whose entry reads `pinned`; a run with no entry (one that entered `merging` before 5e) gets no ejection, and its round is a stop for the operator, failing closed. D-7607's two report-less forms stay: a `red:` round records no base, so it licenses no absorb.
- **D-7616** — `bare-retreat-ejects` (Task 1): a `merging → working` advance with no `ejection` body also ejects the run's pinned entry. Its state becomes `ejected`, `ejections` is incremented, and `baseSha` and `ejectionKind` are left null.
  - The run has left the line either way.
  - Refusing a bare retreat would break every coordinator still running today's skill text.
  - Keeping the entry `pinned` would leave a stale head in the line.
- **D-7617** — `repin-moves-to-the-back` (Task 1): a re-pin sets `pinnedAt` to the new pin's time. An ejected entry that goes green again takes its first-green place by its new green, not its first one. Its id, ejection count, `afterIds`, `fixesMain` and `setBy` are kept.
- **D-7618** — `advances-the-line-does-not-place` (Tasks 1 and 2): the run's advance still commits in each of these cases, because the line never refuses an advance it cannot place.
  - An advance to `merging` whose verdict measured no PR creates no entry. The entry is keyed by (project, pr).
  - A pin onto a row that reads `landed`, `withdrawn` or `unknown` leaves the row untouched.
  - A retreat whose episode has no entry writes none.
  - A retreat whose run has no episode (no `merging-at:` detail on its entry into `merging`) writes none and answers `no-episode`, kept apart from `no-pr` (an episode whose verdict measured no PR), so no null at the seam means two things.

  Nothing writes `landed` (5h) or `withdrawn` (5j) yet, so those arms are inert in 5e and pinned on fixture rows.
- **D-7619** — `ejection-not-merging` (Tasks 1 and 4): the advance gains exactly one refusal code, `ejection-not-merging`, for an `ejection` body on a run not at `merging`. It is declared in `RunRefuseCode` and named in §4's `reject.code` table. The composite decides from one `LandingAdvance` value, so no ill-formed pairing reaches it. The one pairing guard throws a programming error and answers no code. The in-process words `no-pr`, `no-episode` and `no-entry` join `mail-routes.test.ts`'s `NOT_CODES`.
- **D-7620** — `loss-list-names-the-landing-line-first` (Task 1): the scope placed `the landing line` before "update intents" in `CLAUDE.md`'s coord.db bullet. That position breaks `stall-settings-prose.test.ts`'s pinned run. The words go first in the list instead, which keeps the pinned runs of `collect-switch-prose` and `stall-settings-prose` whole. A new case pins the words, so they are a mechanism, not a request.
- **D-7621** — `the-decider-is-a-pure-fold` (Task 2): the scope wrote the decider as `landingOrder(entries, project)`. It takes `(entries, flags)` instead: the L4 route reads the project's row, and the L1 decider reads only values. The spec's two pause rows are about state over time ("an operator pause survives a red-to-green transition"; "an operator pause set BEFORE main goes red survives the red and the later green"). They are written as folds over sequences of flag values, pinning that the fold reads each flag on its own, so a green never clears the operator pause.
- **D-7622** — `edge-outranks-jump` (Task 2): the spec says `fixesMain` entries jump the queue, and that `after` edges are honoured, but not which wins when they meet. The edge wins: an edge is a recorded constraint, and `fixesMain` is a priority. An entry whose target never enters the line goes after every entry that can land and is never the head. That covers an ejected target, an `unknown` one, and a cycle.
- **D-7623** — `fixes-main-held-by-red` (Task 2): the line is paused while either flag is set, so a `fixesMain` entry is held by `main-red` too. Taken literally, a red `main` can then be fixed only outside the line, since the entry meant to fix it cannot be head while the hold stands. In 5e this is inert, because `mainRedHold` has no writer. It is a question for 5i, which ships that writer.
- **D-7624** — `second-ejection-is-a-notice` (Task 2): spec §5.5 says a second ejection of the same entry "becomes an operator ask". When an entry's count reaches 2, the server raises ONE notice through the existing notice sink: kind `run`, the worker's session id, mode `record-always`, and a fixed per-entry tag. Later ejections raise none, and the advance is never refused. The review-round cap's `review_cap` row and its `askedAt` and `liftedAt` are not reused, for two reasons:
  - that row is keyed by work run;
  - `review-cap.test.ts` allows exactly one writer of the `{kind: 'run', sessionId: ''}` push shape, which opens the PWA's cap-lift sheet.

  The coordinator names the second ejection in its turn text and sends the round as usual. The operator's remedy is the withdraw door (5j).
- **D-7625** — `client-row-landing-show` (Task 3): `ccd/ccrc-api` gains the row `[landing.show]='GET|/api/landing|no|project'`.
  - The scope's "Not in 5e" lists "any ccd change". The client is the closed API client the skills call, not a `ccd` verb.
  - A repository that denies `Bash(curl:*)` leaves the client as the coordinator's only way to the route.
  - The row moves `ccrc-api.test.ts`'s and `ccrc-api-closed.test.ts`'s counts from 33 to 34, and README's verb list.
- **D-7626** — `the-line-read-is-advisory-in-5e` (Tasks 3 and 4): the scope says the coordinator reads the line before it enqueues, but not what the read decides.
  - In 5e the coordinator checks two things: the pause, and that its own entry is `pinned` at the bound head.
  - A PR with no entry lands as the verdict says, and the turn text names the missing entry. Such a PR entered `merging` before 5e was deployed. A 404 on `GET /api/landing`, from a server older than the line, is read as no entry and lands the same way, naming the missing entry; any other failure of the read (a timeout, a 401, a 5xx, a transport error, an unparsable answer) stops the landing and is reported to the operator.
  - The order is read, not obeyed, until 5i ships the next-to-land mail and the main-red hold. Landing only the line's head before then would make one programme's coordinator wait on another's entry in the same project.
- **D-7627** — `advance-answers-what-the-line-recorded` (Tasks 1 and 4): the advance's 200 body gains `landing`, additive, so the coordinator can tell an ejection the line recorded from an advance it could not place (D-7618). The coordinator sends an `ejected:` mail only once the answer reads `landing.kind` `ejected` with the base it sent; any other answer means no base was recorded, and the round is reported to the operator instead of sent.

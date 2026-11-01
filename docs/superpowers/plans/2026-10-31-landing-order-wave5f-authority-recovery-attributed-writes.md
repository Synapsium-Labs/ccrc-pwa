# Landing order, wave 5f — authority recovery and attributed writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution hold:** This is the consolidated publication-review draft, not approval or a dispatch brief. One independent whole-plan review is complete, with partial source corroboration disclosed below; publication checks and the operator's reading of the exact CLAUDE.md amendments remain prerequisites. Tasks 1–4 execute serially only after the plan is published and dispatched. No implementation or operator approval is implied by this document; issued planning deviations are defined below.

**Goal:** Recover the landing line's authoritative decisions after database-only restore, add two attributed token-gated writes, and close the carried pin/reader/wire/instruction gaps without inventing measured state.

**Architecture:** One synchronous injected journal and a subject/authority overlay recover decisions independently of measured projections. A DB-only verified-pin witness resolves contradictory surviving association evidence without converting historical run IDs into current association authority. Existing L1 policy consumes coherent guarded facts; L4 delivery calls the synchronous store once and records eligible notices through NoticeSink.

**Tech Stack:** TypeScript, Node >=22.16.0, node:sqlite DatabaseSync/WAL, Fastify, Vitest and the existing closed shell client; no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` §5.5 and §7, scoped by `docs/superpowers/programs/landing-order.md`'s 5f row and carried constraints; read the 5e plan `docs/superpowers/plans/2026-10-31-landing-order-wave5e-landing-line-core.md` and its departures first. Existing landing-route safeguards from §5.7 remain unchanged.

## Global Constraints

- Public repository: neutral examples only. Use fixture HOME, database and configured ccrcDir, never live state or credentials. The coordinator does not implement this dispatched worker's changes.
- L0 imports nothing; L1 is pure policy; L2 consumer-declared port; L3 IO preserves distinctions; L4 acts. CoordStore stays synchronous, without an async repository or a second ordering/row-reading/notification/framing mechanism.
- Wire additive-only; FLEET_PROTO stays 1. Missing older-peer recovery output means not reported. runId:null means a genuinely measured current no-run projection, never unresolved historical recovery.
- No intents, landed sweep/backfill, GET bounding, mainRedHold writer, next-to-land mail, marker reader, pause/withdraw doors, binding journal or ccd verb. No snapshot-membership change, repair/rekey/delete endpoint, retry timer, journal salvage/truncation or outbox.
- Tasks are serial and declarations have one final owner. Task 1 owns strict reader and mutation decision; Task 2 owns parser/notice and delivery; Task 3 owns bounded quarantine/repin, overflow, bare copy and union move; Task 4 exclusively owns ccrc-api-closed.test.ts.
- Remeasure the next migration slot on origin/main at execution/PR time: baseline ends at 35:34→35, so 36 is provisional. Never alter migration 35, seed recovered authority from legacy projections or infer current run from historical observedRunId.
- Matching identity does not excuse contradictory surviving association evidence. Witness mint/refresh belongs only to a successful verified pin; never live order or replay. A wholly lost unjournalled change is not detectable and is not promised by this wave.
- Every heavy test/typecheck runs foreground through ccrc test with tooling timeout >=600000ms. Local Vitest uses --maxWorkers=2, one whole file per process; typecheck-tests runs alone. No bare npx, background suite or full server suite before handoff.
- Mutations are sequential predictions until measured. Use the original session temp root for saved bytes, hashes, modes, logs and evidence, never the worktree. Record process/time bounds before execution, restore from saved copy rather than git checkout/reset, and return the whole file green.
- Claims precede all edits, including task-local implementers and mutated files. No growth ceiling increase, weakened census, invented cap or blanket waiver. Run GROWTH_CHECK=1 and record measured deltas.
- Read held mail before every push and wave-done. Exact-tip fast PR CI must complete; report what it selected and its conclusion. The server verifies the fingerprint, an independent review run reads the implementation, and the merge queue supplies the full Linux gate. No self-merge or post-wave-done push.
- Preserve nineteen clauses, protected verdict fence bytes and 5d latest-attempt text. No instruction edit outside the exact operator-read blocks below. Keep attribution, uncertainty and authorization claims distinct.

## Review Focus

| Input or failure class | Expected behavior and owning executable pin |
|---|---|
| Snapshot predates source, target and runs | Task 1 `recovered subjects retain authority without fabricated projections`: exact authority visible, no fabricated eligible projection, head null |
| Same identity, contradictory surviving run/no-run observation | Task 1 `exact identity does not resolve contradictory restored binding` and `later journal observation invalidates restored witness`: hold until bounded verified measurement, never join a historical run |
| Complete append or pin/retreat COMMIT throws | Task 1 `complete-append-failure-is-uncertain`, `pin-commit-failure-is-uncertain`, `retreat-commit-failure-is-uncertain`: mayApply and fence survive HTTP; no success/notice |
| Unknown row contains readable edges but unreadable source values | Task 1 `readable-unknown-state-is-traversable` / `unreadable-source-cannot-journal-placeholders`: dependencies stay traversable where readable; no display placeholder becomes authority |
| Stale pin plus oversized retained INTEGER | Task 1 strict BigInt reader controls; Task 3 `stale quarantine can verified-repin` and `unreadable quarantine counter cannot repin`: no unsafe number, false ejection or broad unknown repin |

---

## Shared Contract

These are the shared implementation decisions, not operator approval or implementation evidence. Tasks run serially. Task 1 establishes infrastructure/recovery types, request/command/fact/result declarations and `decideLandingMutation` in its final `landingWrites.ts` owner, because the store writer consumes that decider. Task 2 adds `parseLandingWrite`, `landingMutationNotice`, L4 action and routes in those established types; no temporary type owner or duplicate decider. Task 1 also establishes the strict single row reader because recovery may not bless unreadable projection fields. Task 3 moves the existing `LandingWrite` union and adds the bounded stale-head quarantine/repin and honest bare-retreat notice. Task 4 owns instruction copy. The completed independent whole-plan review and its source-coverage limits are recorded below; publication checks remain required.

### 1. Vocabulary, identity and history

`shared/landingLine.ts` remains import-free. Declare the following shared shapes once:

```ts
export interface LandingIdentity { id: number; project: string; pr: number }
export type LandingHistoricalBinding =
  | { kind: 'no-run' }
  | { kind: 'run'; observedRunId: number };
export interface LandingSubjectRef extends LandingIdentity {
  binding: LandingHistoricalBinding;
}
export interface LandingCreationClaim {
  at: number; setBy: string; pinnedSha: string; handoffCommit: string;
}
export interface LandingAuthority {
  afterIds: number[]; fixesMain: boolean; setBy: string; seq: number;
}
export type LandingJournalRecord = {
  v: 1; seq: number; at: number; setBy: string; subject: LandingSubjectRef;
} & (
  | { kind: 'entry'; claim: { pinnedSha: string; handoffCommit: string } }
  | { kind: 'order'; after: LandingSubjectRef[]; fixesMain: boolean }
);
export type LandingJournalInvalidReason =
  | 'empty' | 'blank' | 'torn' | 'json' | 'version' | 'kind'
  | 'fields' | 'sequence' | 'identity';
export type LandingRecoverySubject = LandingIdentity & {
  creation: { kind: 'recorded'; claim: LandingCreationClaim; seq: number }
    | { kind: 'not-recorded' };
  historical: { binding: LandingHistoricalBinding; observedSeq: number };
  projection: { kind: 'missing'; association: 'unmeasured' }
    | { kind: 'association-unmeasured'; reason: 'historical-binding-mismatch' }
    | { kind: 'identity-conflict'; conflicts: LandingIdentity[] };
  authority: { kind: 'set'; value: LandingAuthority } | { kind: 'not-set' };
};
export interface LandingRecovery {
  subjects: LandingRecoverySubject[];
  hold: null | { reason: 'landing-recovery-unresolved'; subjectIds: number[] };
}
```

All IDs/PRs/sequences are positive safe integers; `at` is a nonnegative safe integer. Strings are nonblank, already trimmed, and project/caller identity uses the existing validation owner rather than a new registry-name grammar. Hashes are exactly lowercase 40-hex. No journal object accepts unknown keys, including nested objects. `after` is ordered, duplicate-free, same-project, and excludes its source. It alone supplies stored `afterIds`. An entry record always has `subject.binding.kind:'no-run'`, introduces an identity not previously mentioned in history, and gives initial authority `afterIds:[], fixesMain:false, setBy, seq`. Order records give the complete resulting authority, including explicit clears.

A subject's first observation has `observedSeq` equal to its enclosing record sequence. Each later source or target reference replaces historical binding with that reference's evidence and sets `observedSeq` to that record sequence. A changed historical run/no-run observation is allowed; it is not an identity change, a binding mutation, or proof of the current association. Original creation claim/sequence never changes. A target reference alone registers a subject but does not set its authority. Within the journal, both ID→project/PR and project/PR→ID must remain one-to-one; violations are `identity`. A valid journal versus a conflicting restored projection is not malformed history.

### 2. Consumer port and exact durability evidence

Create `server/src/coord/landingJournalPort.ts` (C4 L2). It imports shared types only and declares the synchronous port below. The opaque snapshot owns resources; the consumer must release it in `finally`, including parse/confirmation failures. Releasing is idempotent and does not write. Adapter-owned evidence is not an FD, path, Buffer or string a caller can substitute.

```ts
export interface LandingJournalSnapshot { release(): void }
export type LandingJournalIoFailure =
  | 'unreadable' | 'changed' | 'unwritable' | 'durability';
export type LandingJournalRead =
  | { ok: true; kind: 'absent'; snapshot: LandingJournalSnapshot }
  | { ok: true; kind: 'present'; text: string; snapshot: LandingJournalSnapshot }
  | { ok: false; error: 'unreadable' };
export interface LandingJournalPort {
  read(): LandingJournalRead;
  confirmDurable(snapshot: LandingJournalSnapshot):
    { ok: true } | { ok: false; error: 'unreadable' | 'changed' | 'durability' };
  append(snapshot: LandingJournalSnapshot, record: LandingJournalRecord):
    { ok: true }
    | { ok: false; error: LandingJournalIoFailure; mayApply: true };
}
```

`createLandingJournal(ccrcDir: string): LandingJournalPort` lives in `server/src/coord/landingJournal.ts` (C4 L3), not a repository over `CoordStore`. It reads exactly `landing.log` inside the explicit configured directory; no HOME default and no directory creation. Production supplies `cfg.ccrcDir` after that directory exists. `read` proves the containing directory identity and retains it with the file descriptor when present. Only ENOENT of the leaf, with a measured existing parent, means absent. Existing empty, symlink, FIFO, directory, invalid UTF-8, unreadable bytes, unmeasurable identity or other I/O failure is never absence. Use no-follow/nonblocking opens and descriptor regular-file checks; do not accidentally block on FIFO. Newly created leaf mode is 0600, exclusive creation if the snapshot proved absent.

The adapter owns the exact bytes behind `text`. It checks the token belongs to it, is live, and still denotes the same parent, leaf identity and bytes before each operation. `confirmDurable` revalidates those bytes, fsyncs that same file descriptor and the containing directory, then rechecks identity/bytes before acknowledging. For absence it fsyncs the measured parent and re-proves absence without creating an empty journal. A pathname replacement is `changed`, never confirmation of an unrelated file. Append revalidates the snapshot, writes exactly one serialized JSON record plus LF with short-write handling, fsyncs that same file then its parent, and rechecks identities/expected complete bytes before acknowledgement. It never truncates or rolls back a partial/uncertain append. Every adapter failure once `append` is called conservatively carries `mayApply:true`, including a detected replacement; no caller retries it.

Snapshot evidence is process-local, single-operation scoped, and unusable after release or append. A successful confirmation does not consume it; release still occurs. No cross-process compare-and-swap guarantee is claimed: ccrc is the sole supported writer, manual concurrent edits are unsupported, and detected changes refuse rather than merge. Checking exact bytes is not cryptographic protection against an earlier, well-formed same-sequence rewrite.

### 3. Parser and overlay schema

`parseLandingJournal(text: string): LandingJournalParse` is C4 L1 in `landingJournalPolicy.ts`. Its exact result is:

```ts
export type LandingJournalParse =
  | { ok: true; records: LandingJournalRecord[]; lastSeq: number }
  | { ok: false; reason: LandingJournalInvalidReason; record: number | null };
```

It calls `splitJournalRecords` once. Require a final LF, no blank record and contiguous sequences 1..N, validate the entire file including the applied prefix before returning any records. Empty is `{reason:'empty',record:null}`; blank/bad JSON/version/kind/fields/sequence/identity use the first offending 1-based record; torn uses the final incomplete record's 1-based position. Distinguish unrecognized version/kind from malformed other fields. Fail at the first violation in file order; per record check JSON, version, kind, fields, sequence, then historical identity. No parser branch salvages, truncates, skips or rewrites.

Append the next migration (36 only if still free), never change 35. Create these three authority tables, plus the DB-only witness table and quarantine column below; seed only the singleton cursor `(1,0)`:

```sql
landing_subjects(
  id INTEGER PRIMARY KEY, project TEXT NOT NULL, pr INTEGER NOT NULL,
  bindingKind TEXT NOT NULL, observedRunId INTEGER, observedSeq INTEGER NOT NULL,
  creationSeq INTEGER, creationClaim TEXT, UNIQUE(project,pr)
)
landing_authority(
  subjectId INTEGER PRIMARY KEY REFERENCES landing_subjects(id),
  afterIds TEXT NOT NULL, fixesMain INTEGER NOT NULL,
  setBy TEXT NOT NULL, seq INTEGER NOT NULL
)
landing_journal_cursor(
  id INTEGER PRIMARY KEY CHECK(id=1), appliedSeq INTEGER NOT NULL
)
```

These are column/ownership declarations; the implementation adds the exact CHECK constraints specified next. SQL checks enforce:

- IDs, PRs, observedRunId when present and positive sequences are integers in 1..9007199254740991; cursor is integer 0..9007199254740991.
- `project`/`setBy` are nonempty trimmed TEXT; `bindingKind` is `run|no-run`; run iff observedRunId is present. The observed historical ID has no FK to `runs`.
- CreationSeq/creationClaim are both null or both present, and creationSeq ≤ observedSeq. Present claim is JSON object with `at` integer 0..9007199254740991, nonempty trimmed text setBy, and two lowercase 40-hex hashes. Pure parsing remains the exact-key/shape owner; SQL constraints do not become a second general parser.
- `landing_authority.afterIds` is a JSON array, `fixesMain` integer 0 or 1, `seq` positive-safe, and subject FK is enforced. Individual edge identity/uniqueness is policy, not a second SQL graph walker.
- Subject ID and `(project,pr)` are independently unique; cursor singleton CHECK remains. Do not add a projection or runs FK from recovered subjects.

Do not seed historical subjects/authority from legacy ordering columns in migration. Those columns remain fallback only. One private SQL apply family in `CoordStore` owns subject/authority/cursor writes for live and replay. Entry records preserve original claim, order records set complete authority, target references update observation only. Cursor is written in the same transaction, after those rows. Replay never writes `landing_entries`. Live verified pin and genuine no-run creation are the only two projection INSERT cases; all existing projection pin/ejection updates stay owned by `advanceLanding`.

The same new migration adds DB-only measurement evidence, not additional journal authority:

```sql
landing_projection_witness(
  entryId INTEGER PRIMARY KEY REFERENCES landing_entries(id) ON DELETE CASCADE,
  project TEXT NOT NULL,
  pr INTEGER NOT NULL,
  observedSeq INTEGER NOT NULL,
  runId INTEGER NOT NULL,
  pinnedSha TEXT NOT NULL,
  handoffCommit TEXT NOT NULL
)
```

ID/PR/runId are positive-safe INTEGER; observedSeq is INTEGER 0..9007199254740991 (0 means no subject observation yet); project is trimmed nonempty TEXT and both hashes lowercase 40-hex. Do not add a run FK or interpret this row as current association authority. Only an actual successful verified pin inserts/updates this evidence, atomically with projection and merging episode. Live no-run creation, order writes and replay never mint or refresh it. Migration starts it empty; never seed from projection lookup.

Also append `landing_entries.quarantineKind TEXT DEFAULT NULL CHECK(quarantineKind IS NULL OR (quarantineKind='stale-episode-head' AND state='unknown'))`. NULL is ordinary projection, the one named marker identifies a deliberately quarantined stale pin; no other unknown state is licensed for repin. Only `advanceLanding` writes or clears this marker. No legacy row is quarantined by migration. The new migration and later readers, not historical migration 35, own these additions. Extend ownership censuses to the witness and quarantine writes.

### 4. Read, recovery and dependency facts

New server GET preserves `project`, both flags, `entries` and `order`, and always includes `recovery: LandingRecovery`. The shared interface declares `recovery?` for older peers; omitted means not reported. Do not assert completeness from omission.

Extend the existing `LandingOrder` union additively: both existing variants may carry `held?: { reason:'landing-recovery-unresolved'; subjectIds:number[] }`. When recovery holds and flags are clear, return `paused:false, order:<existing ordered display>, head:null, held:<reason>`. With a real pause retain `paused:true, by, order` and add `held`; never invent a pause word or change either flag. `landingOrder(entries, flags, recovery?: LandingRecovery)` is the single L1 owner of this rule; omitted recovery preserves old callers' behavior. Production GET always supplies measured recovery.

Keep one row-reader owner in `landingEntry.ts`. Its exact additional facts are:

```ts
export type LandingProjectionRead =
  | {kind:'readable'; quarantine:'stale-episode-head'|null}
  | {kind:'unreadable'};
export interface LandingEntryFacts {
  entry: LandingEntry;
  dependencies: {kind:'readable'; afterIds:number[]} | {kind:'unreadable'};
  projection: LandingProjectionRead;
}
export function landingEntryFactsOfRow(row:Record<string,unknown>): LandingEntryFacts;
```

Existing `landingEntryOfRow(row)` delegates to `.entry`. Dependency readability is independent of state/numeric readability. `projection.kind:'readable'` requires readable retained identity, association number/null, hashes, pin time, counters, flag, setter, optional base/ejection fields and dependencies. A known ordinary state with NULL marker is readable. Literal unknown plus exactly the stale-episode-head marker is the only readable quarantined state. Unknown due to any unreadable field, unrecognized state, unknown marker or inconsistent marker/state is unreadable. Task 1 establishes strict numeric validity in this one reader: fixesMain exactly numeric/bigint 0/1; pinnedAt/ejections nonnegative-safe integer number/bigint; invalid values get finite display false/0 and unknown state without changing raw rows. Set setReadBigInts(true) on every landing SELECT before oversized INTEGER reads. Project flags retain any-nonzero fail-closed behavior. Task 3 consumes this reader rather than introducing a second retained-data validator. Overlay authoritative `afterIds/fixesMain/setBy` before this single reader. Never use display [] as graph facts. Invalid identity numbers refuse the whole snapshot as `landing-projection-unreadable`, never invent IDs.

Store-only coherent fact types live from Task 1 in their final `landingWrites.ts` L1 owner:

```ts
export interface LandingMutationFacts {
  project: string;
  flags: LandingLineFlags;
  entries: LandingEntry[];
  projections: {id:number; value:LandingProjectionRead}[];
  dependencies: { id:number; value:
    {kind:'readable'; afterIds:number[]} | {kind:'unreadable'} }[];
  recovery: LandingRecovery;
  nextId: number|null;
  foreignIds: number[];
  coordinators: { id:number; value:
    {kind:'no-run'} | {kind:'run'; runId:number; claimedBy:string|null}
    | {kind:'unreadable'} }[];
}
export type LandingReadResult =
  | { ok:true; facts:LandingMutationFacts }
  | ({ ok:false } & LandingInfrastructureFailure);
```

`readLanding(project)` returns one guarded synchronous SQLite read transaction, using an inner reader when already in the owning store transaction. The identity inventory includes all projection states and recovered subjects, not just pinned rows. `foreignIds` is an internal ID-only membership fact, not part of GET; it distinguishes missing from known other-project targets without publishing unrelated project data. Read current run and its claimedBy through the actual projection's current runId only. Missing referenced run or unreadable row is `unreadable`, never no-run. Historical observedRunId never joins current runs. GET publishes only entries/flags/recovery/order, not this internal inventory.

Recovery includes every missing journal subject, ID OR project/PR identity collision, and exact-identity projection whose binding contradicts the latest surviving observation without a matching verified-pin witness. A conflict is visible in every involved project's recovery output, including a different project named by the projection; affected subject IDs are sorted/deduplicated. A matching identity alone resolves only missing-projection recovery, not a contradictory association. Collisions and contradictory associations hold regardless of projection state; marking landed/withdrawn is not a release. No endpoint repairs/deletes/rekeys identity. Missing projections and association mismatches do not refuse startup. No hashes, current runId, counters or eligibility are invented in recovery output.

`landingEntry.ts` owns this pure witness check:

```ts
export interface LandingProjectionWitness extends LandingIdentity {
  observedSeq:number; runId:number; pinnedSha:string; handoffCommit:string;
}
export function landingAssociationReadable(f:{
  subject: LandingSubjectRef & {observedSeq:number};
  entry: LandingEntry;
  witness: LandingProjectionWitness|null;
}): boolean;
```

It requires exact subject/entry identity. Agreement of latest historical binding with the projection means no *known contradictory association*; do not use historical run IDs to look up runs. A disagreement is readable only if a valid witness matches identity, subject's latest observedSeq, exact projection runId, pinnedSha and handoffCommit. Unreadable/absent witness gives no override. New verified pin records that witness at the current subject observedSeq (0 if not yet observed), so it can resolve a known contradiction without rewriting journal authority. This helper only decides observation consistency; the store separately proves actual current-run readability through projection.runId.

An ordinary live order reference uses the already guarded current projection binding. Its new historical observation therefore agrees with that projection and makes an older witness unnecessary; do not carry forward or rewrite witness sequence. Replay likewise never refreshes a witness. Replaying a later contradictory observation invalidates an older witness through sequence inequality. Timestamp comparison, episode/run ID ordering and historical-run joins are not substitutes.

Bounded limitation: if a post-snapshot binding change was wholly unjournalled and no later source/target observation survives, neither restored projection nor witness can reveal it. Equal binding numbers are not independent freshness proof across reuse. This wave detects contradictory *surviving* evidence and never reconstructs missing projections, but does not introduce a binding journal or promise universal measurement freshness.

### 5. Closed results, statuses and failure handling

Declare once in import-free shared vocabulary:

```ts
export type LandingInfrastructureCode =
  | 'landing-journal-unavailable' | 'landing-journal-unreadable'
  | 'landing-journal-invalid' | 'landing-journal-missing'
  | 'landing-journal-cursor' | 'landing-journal-changed'
  | 'landing-journal-durability' | 'landing-journal-append'
  | 'landing-db-unavailable' | 'landing-db-apply' | 'landing-db-commit'
  | 'landing-fenced' | 'landing-projection-unreadable';
export interface LandingInfrastructureFailure {
  error: LandingInfrastructureCode;
  recovery: 'replay' | 'restart';
  mayApply?: true;
  invalid?: {reason:LandingJournalInvalidReason; record:number|null};
}
export type LandingMutationCode =
  | 'landing-entry-exists' | 'landing-entry-missing'
  | 'landing-after-missing' | 'landing-after-cross-project'
  | 'landing-cycle' | 'landing-dependencies-unreadable'
  | 'landing-recovery-unresolved' | 'landing-identity-conflict'
  | 'landing-id-overflow' | 'landing-sequence-overflow';
```

All infrastructure codes are 503. Missing configured port is unavailable/restart, not fenced. Fenced returns its recorded replay/restart remedy, not unavailable. Leaf absent with nonzero cursor OR any subject/authority row is missing; cursor past validated lastSeq is cursor. Invalid history carries only the typed reason/record, never raw text/path or exception contents. A detected snapshot replacement is changed; failed confirmation is durability; append failure is append (with mayApply), SQL apply is db-apply, COMMIT is db-commit. A failed BEGIN/read is db-unavailable; failure to prove a clean connection requires restart. A port read error is unreadable. The write failure retains its precise phase even though subsequent requests see fenced.

Mutation statuses: entry-exists 409; entry-missing 404; after-missing, after-cross-project, cycle, recovery-unresolved, identity-conflict 409; dependencies-unreadable 503; ID/sequence-overflow 409. Parse failures use existing bad-request 400. Current associated run unreadable uses existing run-unreadable 503. Token and measured attribution keep existing unauthenticated 401, unknown-sender/stale-uuid 403 and registry-unmeasurable 502. In `shared/refusal.ts`, declare one `LANDING_REFUSAL_STATUS:Readonly<Record<LandingInfrastructureCode|LandingMutationCode,number>>` submap with these values, spread it into existing `REFUSAL_STATUS` and `ADVANCE_REJECT_STATUS`, and include that closed landing code family in `RouteRefusal`/`AdvanceRejectCode`. Actual `LandingAdvanceResult` stays the narrower producing union below. Derive runtime lists from the existing maps; no separately maintained code list, inline send or new response writer. The landing POST/GET paths use `refuseRoute(reply,error,extras)` and the advance path retains `reject.code` through `refuseAdvance`. Extras preserve `recovery`, `mayApply` and typed invalid metadata.

```ts
export type LandingJournalReplay =
  | {ok:true; applied:number; lastSeq:number}
  | ({ok:false} & LandingInfrastructureFailure);
export type LandingAuthorityWrite =
  | {ok:true; entry:LandingEntry; previous:LandingEntry|null;
      changed:boolean; seq:number|null;
      coordinator:{kind:'no-run'} | {kind:'run'; runId:number; claimedBy:string|null}}
  | ({ok:false} & LandingInfrastructureFailure)
  | {ok:false; error:LandingMutationCode | 'run-unreadable'};
```

Creation changed=true, previous=null. Effective order no-op returns unchanged entry/previous, changed=false, seq=null, preserves setBy, appends nothing, updates no cursor and emits no event. Changed live success uses its record sequence. An order refusing before append is definite, no mayApply. Never claim an uncertain result was rejected with no effect.

Keep `advanceLanding`'s existing input exactly. Add `({ok:false} & LandingInfrastructureFailure)` and `{ok:false; error:'landing-recovery-unresolved'|'landing-identity-conflict'|'landing-id-overflow'}` to `LandingAdvanceResult`. In `server/src/coord/advance.ts`, extend `AdvanceReject` with `({code:LandingInfrastructureCode}&Omit<LandingInfrastructureFailure,'error'>)` and `{code:Extract<LandingMutationCode,'landing-recovery-unresolved'|'landing-identity-conflict'|'landing-id-overflow'>}`; existing `AdvanceRefusal`'s reject branch then carries them. Route discrimination handles these before the old generic 409 branch and maps error→code without dropping the other fields. `refuseAdvance` preserves the whole reject and uses the shared status map; do not collapse it to code alone. Preserve existing bare bad-request/run-unreadable handling. Do not expand `RunRefuseCode` or add another shared/api import for infrastructure errors: they are infrastructure results, not run state-machine words. Task 3 still replaces the twelfth import with LandingWrite and preserves total twelve.

### 6. Transactions, fence and materialization

The exact canonical entrances are:

```ts
readLanding(project:string): LandingReadResult;
writeLandingAuthority(command:LandingAuthorityCommand, at:number): LandingAuthorityWrite;
replayLandingJournal(): LandingJournalReplay;
advanceLanding(input:{runId:number; to:RunState; causedBy:string;
  landing:LandingAdvance}): LandingAdvanceResult;
```

`CoordStore` accepts optional options `{landingJournal?:LandingJournalPort; onUnusableConnection?:()=>never}` after its existing db argument; no route dependency. Without port landing is unavailable. With port landing starts fenced/replay. Production supplies journal and an L5 fail-stop callback; fixtures may omit callback only when they cannot inject a connection-close failure. Replays happen explicitly after migrations before server/watchers/timers. Keep the existing pre-open restore-marker refusal. Boot replay failure logs a fixed `ccrc-server: landing journal recovery refused` plus the typed code, closes DB and refuses startup. No raw journal or secrets.

Do not change `tx`'s existing failure contract. It suppresses ROLLBACK errors, so catching it is not proof of cleanliness. After any caught landing transaction failure, measure `db.isOpen` and `db.isTransaction` (available at the existing Node 22.16.0 floor). Only an open connection with `isTransaction === false` proves a clean transaction boundary. Throwing/unavailable measurements, closed connection or an active transaction require restart. If a transaction remains active or its state cannot be proved, close the shared DB before returning the restart result, preventing unrelated operations from accidentally joining the failed transaction. Verify it is closed; if closure cannot be proved, invoke the production L5 fail-stop callback instead of continuing service. Tests inject the failure only on fixture DBs and assert close/fail-stop. Never close/reopen automatically to retry a request. An already closed connection is restart-only.

The append owner is exactly `CoordStore.writeLandingAuthority`: one `appendThenApply` site inside `tx`. It gathers the guarded facts once inside that transaction and calls the pure mutation decider before appending. The live sequence is validate complete journal/snapshot and cursor → facts/decision → durable append → private SQL apply including live creation projection when applicable → cursor → COMMIT. Track JournalPhase plus whether callback returned before COMMIT, catching around the whole tx. Any failure after append was entered sets the global landing fence and returns mayApply:true with exact append/apply/commit word. A pre-append database failure carries no mayApply for this request; unmeasurable connection still requires restart. Successful append followed by COMMIT failure is never success. No failed request emits a notice.

Measured `advanceLanding` has its own effects phase, independent of JournalPhase: `none` before application, `applying` immediately before `advanceInner` or any episode/projection/witness SQL, and `committing` once the transaction callback completes successfully. A caught exception after effects entered closes the landing fence and conservatively returns mayApply:true; applying maps to landing-db-apply, committing to landing-db-commit, even though the advance appended no journal record. A pre-effect failure maps to landing-db-unavailable without mayApply. Domain refusals with no SQL effect remain definite. Clean rollback/boundary proof determines whether durable replay can reopen the connection, not whether an ambiguous COMMIT applied. Preserve mayApply/recovery through `refuseAdvance`/reject extras, and never emit an ejection notice on failure. Replay may recover authority but must not manufacture the pin/retreat outcome. Test pin and retreat COMMIT uncertainty separately with real fixture transactions.

While fenced, readLanding, private landing reads, authority writes and every pin/retreat fail before any run state, event, episode, pin or counter mutation. Validate the *actual from/to transition* and input pairing at the store boundary before the plain carve-out: to merging requires pin, pin requires to merging, retreat requires to working, and from merging→working requires retreat. A direct `{landing:{kind:'plain'},to:'working'}` while merging throws the existing pairing error before run/event effects, rather than disguising a retreat. Genuinely non-landing plain transitions still need no journal and perform no private landing read. Private `landingEntryOf`, `landingEntries` and `landingProject` must derive from a guarded result or become private inner functions called only under that guard; no surviving unguarded public entrance. A normal unfenced authoritative write validates the whole current journal and refuses/fences changed cursor/history rather than silently replaying an unexpected suffix. GET and ordinary measured pin/retreat do not re-read the disk log per request: the boot/replay-established fence is their guard. This does not promise detection of unsupported external file edits before the next journal validation.

Explicit `replayLandingJournal()` is the only in-process reopen. It requires a provably clean connection, reads/validates the entire history, checks cursor and missing-history consistency, confirms exact snapshot durability, then applies only the suffix and cursor in one transaction. Confirm even an equal cursor before reopening; applied=0 then. An absent journal with cursor0 and no overlay rows is safe bootstrap after parent durability/absence confirmation. Present empty is invalid. Never reset a cursor or project over missing/corrupt authority. On any replay failure keep fence; no retry timer. Restart-only fence cannot be reopened on the same connection. Successful replay never emits notice or inserts projections.

One explicit allocator shared by no-run creation and `advanceLanding` chooses MAX(projection IDs, subject IDs)+1 and refuses overflow without append or run transition. A verified pin may resolve its *own* missing projection or exact-identity historical-binding mismatch, never an identity collision. It uses the recovered reserved ID, newly measured head/handoff/current run and one atomic verified-pin witness. Missing target-only subjects with `authority.kind:'not-set'` are valid: materialize with normal fresh-pin defaults (afterIds [], fixesMain false, setBy causedBy, ejections 0, base/kind null, current pin time), without inventing an authority row or journal order. If authority is set, retain its exact edges/flag/setter; do not reset it while materializing. For an existing association-mismatch projection retain readable counter/dependency/authority data and use normal repin semantics; do not overwrite an unreadable row.

This is a bounded subject-specific exception: other unresolved subjects may keep the project held but cannot prevent fresh verification of this subject's own projection. An ordinary pin to an unrelated materialized subject and every retreat remain refused while recovery holds. An identity collision anywhere in the affected project has no exception. Never treat historical creation as current no-run proof or rewrite historical binding outside a journal record. Recompute recovery after the successful pin; remaining subjects still hold. An unknown projection caused by unreadable fields is not missing and cannot use this exception.

### 6a. Stale episode-head quarantine and bounded repin

Task 1 adds `projection:LandingProjectionRead|null` alongside `decideLandingWrite`'s existing current entry for canonical readability facts. Task 3 extends the episode fact to `{pr:number|null;head:string}|null` and consumes that existing projection fact. Add decision `{act:'quarantine';id:number}`. After existing retreat ownership/pinned-state checks, if current.pinnedSha differs from episode.head, choose quarantine rather than ejection: write only literal state unknown plus quarantineKind stale-episode-head, preserve hashes, run association, base/kind, counter, pin time, authority and setter, return `{kind:'kept',state:'unknown'}`, and permit the run transition. It must no longer head or satisfy a follower. No ejected notice or new base is recorded. An unreadable projection remains unknown and is not rewritten just to mint this marker.

For a later *verified* pin, a row whose exact raw state/marker is the sanctioned quarantine and whose retained projection fields/counters/dependencies are readable can use existing repin semantics. Update head/handoff/current run/pin time/state, clear base/kind and quarantine marker, retain ejections and authoritative edges/flag/setter, and refresh the witness atomically with the episode. An unmarked literal unknown, future unknown state or unreadable projection must remain kept/unknown; never allow all unknown rows to repin. Ordinary pinned/ejected behavior stays unchanged. Amend the shared `unknown` description and the now-false invariant that no writer stores unknown: only this explicit measured quarantine may do so. Pin the narrow writer/marker ownership and both positive repin and corrupted/unmarked controls.

### 7. Requests, one decision and the notice seam

```ts
export interface LandingCaller {byId:string; byUuid:string}
export interface LandingEntryRequest extends LandingCaller {
  project:string; pr:number; pinnedSha:string; handoffCommit:string;
}
export interface LandingOrderRequest extends LandingCaller {
  project:string; pr:number; afterIds?:number[]; fixesMain?:boolean;
}
export type LandingAuthorityCommand =
  | {kind:'entry'; project:string; pr:number; pinnedSha:string;
      handoffCommit:string; setBy:string}
  | {kind:'order'; project:string; pr:number; afterIds?:number[];
      fixesMain?:boolean; setBy:string};
```

These exact public policy signatures live in `landingWrites.ts`; Task 1 establishes the command/facts/decision owner and Task 2 adds body parsing and notice policy:

```ts
export type LandingWriteParse =
  | {ok:true; kind:'entry'; request:LandingEntryRequest}
  | {ok:true; kind:'order'; request:LandingOrderRequest}
  | {ok:false; error:'bad-request'};
export type LandingMutationDecision =
  | {ok:false; error:LandingMutationCode|'run-unreadable'|'landing-projection-unreadable'}
  | {ok:true; mutation:
      | {kind:'noop'; entry:LandingEntry}
      | (Extract<LandingAuthorityCommand,{kind:'entry'}> & {id:number})
      | {kind:'order'; entry:LandingEntry; after:LandingSubjectRef[]; fixesMain:boolean}};
export function parseLandingWrite(kind:'entry'|'order', body:unknown): LandingWriteParse;
export function decideLandingMutation(command:LandingAuthorityCommand,
  facts:LandingMutationFacts): LandingMutationDecision;
```

Parser preserves omission versus []/false and requires at least one order patch key. The one shared allocator supplies proposed `nextId:number|null`; null means overflow, never absent. Entry policy consumes it; order need not allocate. A parse success retains its literal kind so routes narrow the exact request, not cast a union.

For order, source must be a readable materialized entry. The `projections` map carries the single row reader's independent result; an unreadable source returns `landing-projection-unreadable`, which the store wraps as an infrastructure failure with `recovery:'restart'` (no append, no uncertainty, no automatic fence/restart). It must not journal an omitted field's display placeholder. A readable named quarantine can have authority edited without making it eligible. Target traversal still depends on the independent `dependencies` facts, so an unknown-state target with readable edges remains traversable. Duplicate creation checks projections AND recovery subjects. A project identity conflict refuses identity-conflict; other unresolved recovery refuses recovery-unresolved. A supplied target absent from both inventories is after-missing, in foreignIds is after-cross-project. Readable unknown-state target remains traversable. Walk only reachable proposed dependency paths; reject source-reaching cycle, refuse unreadable reachable dependencies, allow source-cycle repair and unrelated old cycles. An existing invalid edge reached transitively is after-missing/cross-project rather than satisfied. Guarded source/reference identities are constructed inside the store's pure decision from these facts, not accepted from HTTP or unguarded caller snapshots. Historical reference evidence comes from each matching current projection's measured association; missing/unreadable runs refuse run-unreadable. No current coordinator lookup uses historical IDs.

`actLandingWrite(command:LandingAuthorityCommand, at:number, ports:{write: (command:LandingAuthorityCommand,at:number)=>LandingAuthorityWrite; notify:NoticeSink}): LandingAuthorityWrite` lives in `landingWritesAct.ts` (C4 L4). It calls the store once; it does not gather a second snapshot or decide graph policy. Inside coordMutex the route parses with L1, reuses measured attribution, constructs setBy from attributed byId, and invokes this synchronous action; no await between store's facts, decision and write. Attribution's asynchronous registry check precedes store entry. Token check precedes attribution/first await. Register literal routes beside GET so existing censuses can see them.

`landingMutationNotice(command:LandingAuthorityCommand, result:Extract<LandingAuthorityWrite,{ok:true}>): {due:false}|{due:true;event:NoticeRecord}` is pure L1 in landingWrites.ts, using type-only NoticeRecord import. Due only for changed order by someone other than the measured current run's claimedBy. No-run/unclaimed orders are due. Exact event uses existing kind `coord`, title `landing-inversion: <project> #<pr>`, `sessionId:command.setBy`, actual current runId or null for genuine no-run, and body `<setBy> set <project> #<pr> afterIds=<JSON array>, fixesMain=<true|false>`. These are all `NoticeRecord` members: kind, sessionId, title, body and runId (`NoticeRecord` omits seq/at from `NotifyEvent`). Update the old NotifyEvent coord-event comment that claims coord always has no programme: this attributed event uses actual current runId when present; no new nullable members or event kind. L4 calls `notify(event,'record-only')`. Creation/no-op/failure/replay never notify. No permission boundary for fixesMain: valid worker attribution is allowed by HTTP, prohibited by skill conduct. A crash after COMMIT before NoticeSink can omit the feed event; no outbox/exactly-once claim.

### 8. Fixture and test ownership

Task 1 explicitly wires a temporary configured adapter and successful boot replay in `landing-entry-store.test.ts`, `landing-read-route.test.ts`, `merging-episode.test.ts`, and `landing-ejection-ask.test.ts`, plus all new landing journal/write integration fixtures. The directory comes from each existing fixture HOME/db parent. `landing-line-order.test.ts` is pure except its census control; do not give pure policy tests a fake journal. Existing non-landing `new CoordStore(db)` fixtures remain valid for plain advances, and landing on them refuses unavailable. Add a narrow fixture helper only if two actual landing fixtures share it, never a default live fallback or blanket all-suite injection. Search actual pin/retreat callers on the execution base and report any newly discovered file before editing/claiming it.

Add fault seams by fixture-controlled port implementations for IO, `vi.spyOn(db,'exec')` with one-shot SQL-phase matching for COMMIT/ROLLBACK, and fixture triggers for SQL application failure. Keep real transaction semantics for controls; do not stub every SQL call. Test each of complete append error, file fsync, directory fsync, SQL apply, COMMIT, clean rollback evidence, active-transaction rollback failure, failed cleanliness probe, DB close failure/fail-stop and successful durable replay separately. Node-floor test confirms `isOpen` and `isTransaction` at the existing floor; never raise or lower the floor as a shortcut.

Both append censuses name the actual existing owners `allocateDeviations`, `setAccountPools`, `setIntent`, `setCollectLane`, then `writeLandingAuthority`. Replay calls the private SQL apply family, not appendThenApply. In `writeLandingAuthority`, bind the injected journal to a method-local `log` and spell the append callback as `log.append(snapshot, record)` inside `appendThenApply` inside `tx`; the existing `storeFacts` query recognises that call spelling. A property call on an arbitrary injected-port name is not automatically recognised. Keep the real-site assertion and planted `no-append`, `outside-tx` and `write-before-append` controls; merely changing the expected owner count does not prove ordering. No append-query widening is needed for this supported spelling. Port/adapter/parser and mutation policy/action get C4 classifications in the existing ring/map owners; purity tests extend existing import/scan queries, never new readFileSync/literal-source purity pins for new src files.

Mutation execution bounds are measured by the worker, not guessed in a plan: before the first row record the session's current same-UID process count and soft/hard RLIMIT_NPROC without argv/environment dumps. Pick a finite cap above measured use with documented headroom below the hard limit; require enough measured headroom for two Vitest workers, otherwise stop/report rather than fork near exhaustion. Record baseline whole-file duration; the outer `timeout -k 15s` gets at least three times that baseline. The foreground tooling timeout is at least 600000 ms and must cover the outer deadline plus its 15-second kill grace and scheduling margin. If the measured bound cannot fit the supported foreground timeout, stop/report rather than backgrounding the suite or selecting an under-sized bound. Each row is serial, one whole file, saved-copy/hash/mode restore, final green. State the actual chosen cap and seconds in evidence before mutations. No invented fleet-wide cap or clock-time claim.

## File ownership and execution order

Tasks are serial. The same worker retains the workspace branch; task-local implementers may edit only the files/hunks named in their brief and already claimed by that worker. Read the spec and the shared contract before the task. No task introduces a second declaration because a later task also touches its file.

| Task | Creates | Modifies |
|---|---|---|
| 1 — recovery and store | `server/src/coord/landingJournalPort.ts`, `landingJournal.ts`, `landingJournalPolicy.ts`, `landingWrites.ts`; `server/test/landing-journal.test.ts`, `landing-journal-store.test.ts`, `landing-journal-migration.test.ts`, `landing-writes.test.ts` | `shared/landingLine.ts`, `shared/refusal.ts`; `server/src/coord/{schema,store,landingEntry,landingLine,advance,routes}.ts`, `server/src/index.ts`, `server/src/refuse.ts` only if its existing whole-reject preservation needs a corresponding comment/type adjustment; `README.md`, `CLAUDE.md` amendment A; architecture C4 map; the named landing fixture/read/advance tests; `coord-db`, `node-floor`, `landing-entry-census`, `coord-policy-rings`, both journal censuses and their existing framing query |
| 2 — attributed delivery | `server/src/coord/landingWritesAct.ts`, `server/test/landing-writes-route.test.ts` | `landingWrites.ts` parser/notice additions and its test; `server/src/coord/routes.ts` two POST hunks; `server/src/auth/gate.ts`; `shared/api.ts` coord-event comment only; `ccd/ccrc-api`; `README.md`, `CLAUDE.md` amendment B, architecture C4 map; `server/test/{auth-gate,box-token-census,secret-mask,ccrc-api,coord-policy-rings,mail-routes}.test.ts` as forced by actual census |
| 3 — stale pin and carried wire | `server/test/landing-advance-wire.test.ts` | `server/src/coord/{landingEntry,landingLine,store}.ts` narrow quarantine/repin/counter/notice hunks; `shared/landingLine.ts` union move and unknown comment; `shared/api.ts` twelfth import/AdvanceOk; `server/test/{landing-entry-store,landing-entry-census,landing-line-order,landing-ejection-ask,peers-claims-l0,collect-lane-l0}.test.ts` |
| 4 — instruction and final pins | None | `ccd/coordinator-skill/SKILL.md`, `ccd/coordinator-skill/references/wave-lifecycle.md`, `server/test/coordinator-skill.test.ts`, and EXCLUSIVELY `server/test/ccrc-api-closed.test.ts` |

Source entries without full directory repeat the directory immediately preceding them in that cell. `AdvanceReject`/`AdvanceRefusal` live in `server/src/coord/advance.ts`, `refuseAdvance` in `server/src/refuse.ts`, and both status-map owners in `shared/refusal.ts`; retain those owners rather than inventing another module. Confirm these anchors on the execution base before claiming. Existing landing fixtures to adapt are `landing-entry-store`, `landing-read-route`, `merging-episode` and `landing-ejection-ask`. Search pin/retreat/read callers again on the execution base and report any additional file before claiming/editing it. Public `landingEntries`/`landingProject` test callers move to asserted `readLanding(...).ok` facts; no fixture-only unguarded production read is retained.

## Task 1: durable authority, recovery and guarded store

**Interfaces:** Consumes the existing synchronous `CoordStore`, `tx`, `appendThenApply`, `splitJournalRecords`, verified-advance input, row vocabulary and `NoticeSink` type. Produces the complete shared contract §§1–6, including `LandingAuthorityCommand`, `LandingMutationFacts`, `LandingAuthorityWrite`, `LandingReadResult`, `LandingJournalReplay`, `decideLandingMutation`, strict `landingEntryFactsOfRow` and `landingAssociationReadable`. `landingWrites.ts` is the final L1 owner from this task; Task 2 consumes it, never moves or duplicates it. Quarantine SQL column exists now; Task 3 adds its only live quarantine behavior.

- [ ] **1. Write failing parser/adapter tests in `landing-journal.test.ts`.** Use the exact names and assertions in journal rows 01–08, 22 and J-SNAPSHOT. Cover all strict known-key/number/string/hash constraints, blank/torn/empty ordering and first offending record. Distinguish leaf ENOENT from missing/unreadable parent, directory, symlink, FIFO, invalid UTF-8 and permissions. Fixture-controlled low-level IO faults separately exercise short writes, file fsync, parent fsync, exact descriptor/bytes and idempotent release. For example:

```ts
expect(parseLandingJournal('')).toEqual({ok:false, reason:'empty', record:null});
expect(parseLandingJournal(validLineWithoutLF)).toMatchObject({ok:false, reason:'torn', record:1});
expect(readPermissionFault).toEqual({ok:false, error:'unreadable'});
expect(appendDirectorySyncFault).toMatchObject({ok:false, error:'durability', mayApply:true});
```

- [ ] **2. Run the whole `landing-journal.test.ts` through the verification command below.** Expect missing implementation/assertion reds, not an unrelated auth/fixture failure; retain output.
- [ ] **3. Implement the exact L2 port, L3 adapter and L1 parser in their named files.** Follow shared contract §§1–3; one framer, exact snapshot evidence, file then parent sync, no directory creation, truncation or retry.
- [ ] **4. Run the whole parser/adapter file green.** Record actual pass and retained fault evidence.
- [ ] **5. Write migration, strict-reader, pure mutation and recovery tests.** `landing-journal-migration` pins unchanged migration 35, next-slot fresh/upgrade/reopen behavior, four added tables, quarantine column, empty witness seed, integer/identity/JSON constraints and singleton cursor. `landing-writes.test.ts` tests the exact `decideLandingMutation` graph/reference/omission rules now, not a temporary store-side policy; Task 2 adds only parser/notice tests. Use `landing-entry-store.test.ts` for strict numeric/BigInt reader reds and independent dependency readability. `landing-journal-store.test.ts` covers every recovery/transaction/witness row of the mutation matrix, including the following decisive counterexamples:

```ts
expect(restoredProjectionCount).toBe(0);
expect(recovered.facts.recovery.hold?.reason).toBe('landing-recovery-unresolved');
expect(recoveredOrder.head).toBeNull();
expect(exactIdentityMismatch.projection).toEqual({kind:'association-unmeasured', reason:'historical-binding-mismatch'});
expect(replayWitnessCount).toBe(0);
expect(freshVerifiedRepair.landing.kind).toBe('pinned');
expect(targetOnlyMaterialization.afterIds).toEqual([]);
expect(targetOnlyAuthorityRow).toBeUndefined();
expect(unreadableSourcePatch).toMatchObject({ok:false, error:'landing-projection-unreadable'});
expect(sourcePlaceholderWasJournalled).toBe(false);
expect(ambiguousPinCommit).toMatchObject({ok:false, error:'landing-db-commit', mayApply:true});
expect(ambiguousRetreatCommit).toMatchObject({ok:false, error:'landing-db-commit', mayApply:true});
```

Names here denote values gathered by the corresponding fixture test, not a new shared test API. Snapshot before source/target and runs; restore SQLite alone. Independently test source missing, target missing, both missing, exact identity plus later contradictory binding, reused ID across projects, target-only authority:not-set, explicit clears, cursor ahead/missing/empty, equal-cursor confirmation, complete append/fsync/apply/COMMIT uncertainty, clean rollback versus active/unprovable transaction, failed DB close/fail-stop and successful durable replay. Test witness identity/sequence/association/head/handoff independently; only a verified pin can refresh it. A later live order agrees with the projection without refreshing witness, while replay of a later contradictory observation holds. Historical run ID reuse cannot select a current coordinator. A wholly lost unjournalled binding is explicitly not detectable; do not claim otherwise.
- [ ] **6. Run each newly affected whole file red, one file per process.** Existing behavior characterizations stay green; new contract assertions must fail for the intended missing behavior. Retain each result. Run `typecheck-tests` alone only after actual test files exist, not to substitute a compiler failure for a behavioral red.
- [ ] **7. Append the migration and implement the canonical policy/reader declarations.** Use exact shared contract signatures, full types and SQL constraints. Task 1 owns strict 0/1 and safe counter/time values, BigInt-safe SELECTs and `projection` readability; Task 3 consumes those facts. Overlay authority before the single reader. Keep project flags any-nonzero/fail-closed. Extend `decideLandingWrite`'s fact signature now with `projection:LandingProjectionRead|null`; Task 3 adds its quarantine action/episode-head test. Extend existing AST purity/import queries and C4 map; no new readFileSync/literal-source pin over a new src file.
- [ ] **8. Implement the four guarded store entrances and production boot wiring.** Use one injected store journal and one private authority apply family. Include subject reservation, the measured-only witness owner, bounded missing/mismatched-subject verified-pin exception, all fence entrances, actual-transition pairing before plain bypass and separate authority-versus-advance COMMIT uncertainty. A direct plain merging→working call throws before effects; a genuinely nonlanding plain transition still works without a journal. Preserve the full `tx` connection-cleanliness/fail-stop contract and pre-open restore-marker refusal. Boot replay precedes every consumer in both modes. Existing public landing reads become guarded or private inner reads. Do not make ordinary GET/pin reread disk on every call or add a retry timer.
- [ ] **9. Integrate additive GET recovery and typed advance/refusal extras.** L1 `landingOrder` owns the recovery hold; GET publishes only its existing view plus recovery, never internal foreign-ID/coordinator inventory. Preserve mayApply/recovery/invalid metadata through existing refusal helpers and `reject`; use the exact code/status table once. No `RunRefuseCode` expansion or shared/api import addition.
- [ ] **10. Apply exact instruction amendment A and its census-forced documentation updates.** Only the operator-read exact block below is licensed at implementation dispatch. Keep loss-list, collector and pool prose byte-identical outside that block. No snapshot/restore membership change. Add the recovery/witness/quarantine ownership, allocator and boot-order pins to existing censuses. Update both append censuses to the five named owners, extend the framing scope and real/planted controls, remeasure/update all three migration totals, and wire only actual landing fixtures. Add Node-floor checks for open/transaction probes at 22.16.0 without changing engines.
- [ ] **11. Run Task 1 whole-file gates green.** Include every Task 1 changed/new test, both journal censuses, read/advance fixtures, refusal-status, node-floor, architecture rings and `single-definition/advance-switches.test.ts`. Do not raise ARCH-06 ceilings; use existing scanner helpers. Record actual outcomes.
- [ ] **12. Measure Task 1 mutations sequentially.** Execute journal/recovery/association rows, Task 1-owned numeric/BigInt rows, dependency/graph-decision rows and the L1 purity rows. A later task does not rerun already measured unchanged rows without a final-file need; after any implementation change affecting a previously killed guard, remeasure that row against final bytes. Save/restore/hash/mode and process/time caps as in contract §8. Do not label predicted rows killed until measured.
- [ ] **13. Commit only claimed Task 1 hunks.** Include required attribution, actual gate summary and deviations; obtain the task-local independent review before Task 2. No push on a known unexplained red.

## Task 2: attributed write delivery, client and notice

**Interfaces:** Consumes Task 1 `LandingAuthorityCommand`, exact parser-request types, mutation decider, guarded writer/result and measured coordinator facts. Produces `parseLandingWrite`, `landingMutationNotice`, `actLandingWrite` with the exact shared-contract signatures; two literal routes and closed-client rows. No per-route journal or second policy snapshot. Task 4 alone edits the closed-client corpus test.

- [ ] **1. Write parser, action and route red tests.** Add parsing and notice assertions to `landing-writes.test.ts`; create `landing-writes-route.test.ts`. Known-key/object/trimmed identity/positive-safe/hash/boolean validation rejects client state/setBy/runId/time. Preserve omission versus []/false, require a patch key. Policy graph tests from Task 1 are characterizations now, not invented new reds. Before using missing-route red, establish valid auth/exemption so 401/403 is not mistaken for unimplemented POST. For each route test missing/wrong token before attribution, token/no-cookie, cookie/no-token, unknown-sender, stale-uuid, unmeasurable registry, not-configured, every typed write failure and uncertainty. Real-journal integration checks exact lines, no duplicate creation, recovered duplicate, same-project targets, queued write versus advance and real feed catch-up.

```ts
expect(noToken.statusCode).toBe(401);
expect(attributionCallsBeforeToken).toBe(0);
expect(clearResult.entry.afterIds).toEqual([]);
expect(clearResult.entry.fixesMain).toBe(false);
expect(uncertainHttp.json()).toMatchObject({ok:false, mayApply:true, recovery:'replay'});
expect(noticesAfterUncertain).toEqual([]);
expect(foreignOrderNotice).toEqual({kind:'coord', sessionId:'lane-b',
  title:'landing-inversion: project-a #11',
  body:'lane-b set project-a #11 afterIds=[2], fixesMain=true', runId:currentRunId});
```

No-run notice has runId null; unclaimed current-run notice retains its actual run ID. Coordinator's own effective edit, entry creation, no-op, failure and replay emit none. A correctly attributed worker is not HTTP-denied for fixesMain: the conduct restriction belongs to the skill.
- [ ] **2. Run the two whole write-test files red.** Preserve each intended assertion failure and verify no preceding fixture/auth defect invalidates it.
- [ ] **3. Implement parser and notice policy in `landingWrites.ts`, and synchronous action in `landingWritesAct.ts`.** Use exact signatures; action calls store once and emits through `NoticeSink` record-only only after an eligible successful result. These event members are complete; update the old `NotifyEvent` coord comment without adding an import or kind. Document COMMIT→notice crash window; no outbox or exactly-once claim.
- [ ] **4. Register both literal POST paths beside GET in `routes.ts`.** Mandatory direct requireMailToken precedes attribution/first await. Reuse measured attribution and coordMutex; store gathers one current synchronous snapshot/decision/write without intervening await. Use existing typed refusal helpers; preserve extras. Add separately justified plain EXEMPT rows for these mandatory-token routes, never SESSION_ONLY/UNGATED/cookie fallback or a worker fixesMain403.
- [ ] **5. Run both whole write-test files green.** Real journal bytes, projection, authority, current-association notice and actual feed catch-up must agree. No placeholder-only fake sink can stand in for all integration tests.
- [ ] **6. Write client/auth/census red assertions.** Exactly two route rows; explicit attribution bodies pass unchanged. Update ordinary client agreement/word map 34→36, both production count sites, README list and token-lane counts in the supplement. The closed-client corpus test is an explicitly declared intermediate dependency until Task 4, not a permission to weaken/remove it. Pin response masking for both routes with assembled synthetic controls, mandatory token and exemption independently.
- [ ] **7. Implement the two closed-client rows and census/documentation changes.** Exact plural spelling `[landing.entries]='POST|/api/landing/entries|no|-'`, `[landing.order]='POST|/api/landing/order|no|-'`; no automatic identity fill. Apply exact instruction amendment B only. Use measured token counts 38→40 coordination and 41→43 whole surface if fresh base is unchanged; no unverified broad route/HTTP counts. Preserve original unrelated lane/exemption classes and body-fill exceptions.
- [ ] **8. Run Task 2 whole-file gates green, recording the declared closed-client intermediate dependency separately.** Include auth, token census, first-await route census, masking, ordinary client, mail-routes where changed, C4 rings, refusal-status and armed growth. Task 4 resolves the corpus/skill dependency; it cannot remain red at final handoff.
- [ ] **9. Measure Task 2 attributed-write, HTTP, notice, client/auth and masking mutations.** Do not duplicate unchanged Task 1 graph/purity measurements; remeasure if final policy bytes changed. Each matrix row is independent and a runtime-behavior row cannot claim a compiler-only kill.
- [ ] **10. Commit only Task 2 hunks with required attribution and obtain task-local review before Task 3.** Record the known intermediate corpus dependency, actual outcomes and any reported departure.

## Task 3: stale-head quarantine, safe retreat and precise advance wire

**Interfaces:** Consumes Task 1 `LandingEntryFacts`, `LandingProjectionRead`, projection witness and guarded advance, plus existing `LandingWrite`. Produces the exact `LandingWrite` moved to import-free shared vocabulary, `AdvanceOk.landing?:LandingWrite`, `decideLandingWrite` quarantine decision and its verified-repin case, with no duplicate reader or new pin writer.

- [ ] **1. Write stale-retreat and bounded-repin reds.** In `landing-entry-store.test.ts`, same owner/current state pinned but stored head differs from episode head, for both explicit and bare retreat, must transition while quarantining only state/marker. Later verified pin clears the marker, retains authority/counter and atomically refreshes projection/episode/witness. Unmarked unknown, future state, unreadable counter or unreadable dependencies cannot use that path. `landing-line-order` pins that quarantined unknown cannot head or release a follower. Task 1 numeric reader/BigInt tests remain green characterizations, not duplicated production work.

```ts
expect(staleRetreat).toMatchObject({ok:true, to:'working', landing:{kind:'kept', state:'unknown'}});
expect(rawAfterRetreat).toEqual({...rawBeforeRetreat, state:'unknown', quarantineKind:'stale-episode-head'});
expect(quarantinedOrder.head).toBeNull();
expect(verifiedRepin.landing.kind).toBe('pinned');
expect(rawRepin.quarantineKind).toBeNull();
expect(unreadableRepin).toMatchObject({ok:true, landing:{kind:'kept', state:'unknown'}});
```

Also pin ejection count MAX_SAFE_INTEGER unchanged with allowed run transition, and MAX_SAFE_INTEGER−1 increments exactly once; normal named/bare second-ejection threshold remains 2.
- [ ] **2. Run the whole store and ordering files red on those new behaviors.** Preserve valid old cases green and isolate wrong-owner/no-episode/no-PR behavior from stale-head cases.
- [ ] **3. Implement bounded quarantine/repin and overflow decision.** Follow contract §6a; extend the episode input with head and decision with act quarantine, and act only inside advanceLanding. No base invention, false ejection or generic unknown repin. Amend shared unknown documentation and census ownership narrowly; do not delete authoritative historical D references.
- [ ] **4. Run the two whole files green.** Prove raw-byte/value preservation except the two quarantine fields and valid new-pin fields on successful repin; no notice for quarantine.
- [ ] **5. Write bare-notice and wire reds.** `landing-line-order` exact bare second-retreat body is `project-a #7 (no run): returned from merging to working a second time; no ejection kind or base was recorded. The line holds nothing back; you decide whether it lands again, is fixed by hand or is withdrawn.` Integration `landing-ejection-ask` pins one ask and absence of old `unrecorded against base unrecorded`. Preserve named-conflict copy/title/tag. In `landing-advance-wire.test.ts` add type equality between NonNullable AdvanceOk.landing and LandingWrite, pinned/kept narrowing, negative invented kind/missing created/missing state, optional undefined and one pinned literal. Update both exact twelfth-import pin tests as part of the type move, not an extra import.
- [ ] **6. Run notice whole files and `typecheck-tests.test.ts` ALONE red for the intended old copy/type.** A Vitest transpile pass is not proof the negative TypeScript assertions worked.
- [ ] **7. Implement honest bare copy and move the exact existing LandingWrite union.** Replace the current twelfth shared/api import, preserve total twelve, set landing?:LandingWrite and leave protocol1. Re-export by type if needed for existing imports, never a second definition. Task 1's typed advance error integration remains intact.
- [ ] **8. Run Task 3 gates green.** Include all changed/new test files, both L0 import suites, node-floor where relevant, typecheck-tests alone, tsc, refusal-status, landing-entry census and armed growth.
- [ ] **9. Measure remaining carried/quarantine/wire mutations.** Remeasure any Task 1 reader/witness guard affected by final changes. Preserve saved-copy/hash/mode evidence.
- [ ] **10. Commit Task 3 hunks with required attribution and obtain task-local review.** No post-review unrecorded implementation change.

## Task 4: coordinator instructions and executable client corpus

**Interfaces:** Consumes the exact Task 2 POST/client/request shapes and Task 3 `LandingWrite`; produces both coordinator texts and final closed-client corpus. No standing clause or protected fence change.

- [ ] **1. Characterize the current nineteen clauses and verdict fence.** Keep existing exact clause equality. Verify 254 body lines, trailing LF and SHA-256 `dec52b5aaf9d6166853a25a18db29d2203a38fd6ace044f7c7068e43c4eef3a7` against the fresh execution base; preserve 5d latest-attempt paragraphs. If this characterization differs, stop/report rather than resetting the expected bytes to a guess.
- [ ] **2. Write skill/client linkage reds.** In coordinator-skill test use bounded raw extractors with asserted opening/closing markers; normalized expectations use flat(raw).trim() identically. Assert exact two copy blocks below, fixesMain restriction independently in each, actual plural POST/client linkage, entry IDs not PR numbers, full resulting values/[]/false, no authorization/gate bypass, uncertainty and recovery hold. New raw lines have no double quotes and ≤80 columns. Pin actual step-6 `landing.entry.baseSha`, following no-base/no-mail fallback and entire REPORT_LESS. In the exclusively owned ccrc-api-closed test update sorted executable corpus/count/comment 34→36 while preserving its two body-fill exceptions and fenced/indented extraction.
- [ ] **3. Run both whole files red on absent copy/corpus linkage.** Characterization/fence controls stay green.
- [ ] **4. Insert the exact blocks and replace only the exact physical span below.** Short block before `## The wave lifecycle`; detailed block before reference `### 5b`, outside protected fence/latest-attempt prose. Keep nineteen clauses, worker skill and following step-6 lines unchanged.

## Exact coordinator instruction copy

Task 4 inserts the next raw block immediately before `## The wave lifecycle` in `ccd/coordinator-skill/SKILL.md`. No contract clause changes.

```text
**Landing writes.** `fixesMain` is the coordinator's or the operator's to set
or clear, never a worker's. For a PR with no run, use
`POST /api/landing/entries`; to replace its order edges or `fixesMain`, use
`POST /api/landing/order` as described in `references/wave-lifecycle.md` §5.
Both writes are box-token gated and attributed, not an authorization boundary.
```

Task 4 inserts the following exact raw `WRITES` block immediately before reference `### 5b`, outside its protected verdict fence and latest-attempt paragraphs. `WRITES` in the test is `flat(the exact raw block).trim()`, including both inner fences and commands. Raw physical-format assertions use the original block, not that normalized string.

````text
**Attributed landing writes.** For a PR with no run, create its entry through
`POST /api/landing/entries`, using the closed client:

```text
ccrc-api landing entries --json -
```

Send `project`, `pr`, `pinnedSha`, `handoffCommit`, `byId` and `byUuid` in its
JSON body. `pinnedSha` claims the PR head and `handoffCommit` claims the
handoff commit. This door records your claims, not independent GitHub,
review or ancestry proof. Do not use it to replace an existing or recovered
entry, replace a run's entry or manufacture an ejection base.

Set or clear an existing entry's order through `POST /api/landing/order`:

```text
ccrc-api landing order --json -
```

Send `project`, `pr`, `afterIds`, `fixesMain`, `byId` and `byUuid` in its JSON
body. Read `GET /api/landing?project=<project>` first. `afterIds` are existing
entry ids from this project's line, never PR numbers. Send the whole new
`afterIds` array and the whole new `fixesMain` value, not deltas:
`afterIds: []` clears the edges and `fixesMain: false` clears the flag. Keep
the value you read for a field you are not changing; never default it away.

`fixesMain` is the coordinator's or the operator's to set or clear, never a
worker's. It records priority, not permission to skip any landing gate. Both
writes require the box token and attribute `setBy` through `byId` and
`byUuid`; this records who wrote, not who was authorized. Read the answer
before acting; a refused or unreadable answer licenses no retry or landing.
An answer with `mayApply: true` is uncertain, not a rejected write with no
effect. Recovery evidence is not a current pin or proof of a no-run entry.
A recovery hold or a fenced landing line licenses no landing.
````

The API accepts omission-preserving patches; the skill deliberately instructs coordinators to read first and send both resulting values. These are compatible, not a different API type. Task 2 exclusively owns actual body validation. These instructions do not create a fixesMain HTTP authorization restriction.

The physical step-6 replacement remains exactly the Before/After in Task 4 step 4; it must be matched once at the execution base. Keep its following fail-closed sentence and the rest of `REPORT_LESS` unchanged. All newly inserted/replaced physical lines have no double quote and are at most 80 characters; do not rewrap existing nineteen clauses or the §5b fence.

Step-6 exact before:

```text
     `red:` round's advance, and any other retreat, carries none. Send the
     `ejected:` mail once the advance's answer reads `landing.kind` `ejected`
     with the base you sent. If it reads anything else, the line recorded no
```

Step-6 exact after:

```text
     `red:` round's advance, and any other retreat, carries none. Send the
     `ejected:` mail once the advance's answer reads `landing.kind` `ejected`
     and `landing.entry.baseSha` equals the base you sent. If it reads
     anything else, the line recorded no
```

- [ ] **5. Run both whole files green, plus ordinary client, worker-skill and coordinator-landing-verdict.** Corpus contains actual executable landing.entries and landing.order fences; no synthetic exception replacing real copy.
- [ ] **6. Measure all skill/client-corpus mutations independently.** Whole-block normalized pins cannot replace physical wrap/hash assertions or the independent main/reference reservation checks.
- [ ] **7. Run the final whole-file gate below and obtain whole-branch independent review.** Every intermediate dependency must now be green. Correct only verified findings within claims; final implementation changes trigger affected gate and mutation remeasurement.
- [ ] **8. Commit final task hunks, read held mail, push and open the PR.** Required attribution and private scan gate apply. Wait for exact-tip fast CI; report actual selection and conclusions. Read held mail again before wave-done. No full server suite, no self-merge, no post-wave-done push; server fingerprint and independent review run own acceptance.

## Whole-file Verification Gate

From server/, run one whole file per foreground process, with tooling timeout >=600000ms. Substitute each real filename; commands below are templates, not recorded results:

```sh
"$HOME/.local/bin/ccrc" test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/<file>.test.ts
"$HOME/.local/bin/ccrc" test -- ./node_modules/.bin/tsc --noEmit -p .
GROWTH_CHECK=1 "$HOME/.local/bin/ccrc" test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/growth-check.test.ts
```

Run all new/changed test files and these existing files, all under server/test/: `landing-line-migration`, `landing-read-route`, `merging-episode`, `advance-gate`, `advance-gate-order-route`, `landing-verdict`, `coord-db`, `node-floor`, `coord-policy-rings`, `census-w8/journal`, `single-definition/kernel-tail-journal`, `single-definition/advance-switches`, `refusal-status`, `peers-claims-l0`, `collect-lane-l0`, `box-token-census`, `auth-gate`, `coord-pause-route`, `coord-routes-single-file`, `secret-mask`, `consolidation-census`, `collect-switch-prose`, `stall-settings-prose`, `anchors`, `citations`, `deviation-refs`, `coordinator-skill`, `worker-skill`, `coordinator-landing-verdict`, `session-hook-merge-deny`, `dead-coordinator-prose`, `reviewer-skill`, `install-coordinator-skill`, `ccrc-api`, `ccrc-api-closed`, and each file in test/rings/ and test/single-definition/. Suffix is .test.ts. Deduplicate the final list; nested files still run individually. Run `typecheck-tests.test.ts` ALONE. Report an unavailable/renamed file instead of silently skipping it. Do not claim a transpiler pass proves type-only reds.

Record source-derived final census totals, actual store/routes net code-line deltas and armed growth result. Final mutation evidence identifies baseline commit/bytes, one changed guard, named whole file/intended assertion, observed red, actual saved-copy/hash/mode restoration and restored green. Do not confuse prediction, characterization, implemented test and measured mutation kill. The Task 2 corpus dependency must be green at this gate.

## Operator text and census supplement

This section is a proposed instruction amendment, not approval to edit `CLAUDE.md`. The operator must read the exact blocks before implementation dispatch. No other instruction text changes. The executor compares these before-blocks with its fresh base; a mismatch is reported, not silently rebased into a different instruction.

### Exact CLAUDE amendment A — authority recovery without fabricated pins

Task 1 replaces this exact contiguous span in the coord.db bullet:

**Before**

```text
  `~/ccrc-backups/<ts>/` (`pool-edges.log` is never replayed). The switch's `collect-lane-generation.log` is never
  copied into a snapshot or restored with one: leave it in place, so a database restored alone never re-arms the
```

**After**

```text
  `~/ccrc-backups/<ts>/` (`pool-edges.log` is never replayed). The landing line has an authority-recovery exception:
  `~/.ccrc/landing.log` restores no-run creation evidence, order edges, `fixesMain` and setter attribution before
  service starts. Leave it in place when restoring coord.db; no backup copies it or restores an older copy over it.
  Replay never fabricates a measured pin, landed state or current run association. Missing projections and
  contradictory surviving binding observations remain visible as unmeasured and hold their project's line;
  identity conflicts hold every affected project without deleting or rekeying either identity. Only a verified
  pin may supply an exact DB-only witness to reconcile contradictory binding evidence; replay never mints it.
  This cannot detect a wholly unjournalled change lost with a snapshot. Invalid or unreadable history refuses
  startup; missing projections or binding mismatches alone do not. An uncertain authoritative append or landing
  database commit, including a pin or retreat with no append, fences every landing read and mutation until
  durable replay succeeds at a clean transaction boundary; an uncertain rollback requires restart. A stale
  episode-head retreat quarantines its pin as unknown, not ejected; only a verified repin with readable retained
  data clears that quarantine. The switch's `collect-lane-generation.log` is never
  copied into a snapshot or restored with one: leave it in place, so a database restored alone never re-arms the
```

The existing loss list, including `what it adds on top — the landing line, mail, claims`, stays byte-identical. The exception narrows that general statement: journalled authority is recoverable, while current measured projection/run association is not invented. The collector-generation sentence and the following legacy-file retirement paragraph remain byte-identical. Neither `pool-edges.log` nor the collector journal changes behavior in this wave.

Task 1 extends the existing `landing-entry-census.test.ts` prose block to pin the recovery exception, leave-in-place rule, unresolved association and absence of fabricated pins. Keep the original loss-list assertion and every collector prose assertion. These are documentation assertions, not new literal-source purity pins.

### Exact CLAUDE amendment B — attributed token-only writes

Task 2 replaces this exact contiguous span in the first, token-gated part of the box-token bullet:

**Before**

```text
  `POST /api/coordinators/:session/intent`, `POST /api/ledger/deviations`, `GET /api/ledger`, `GET /api/landing` and the approvals lane's
  six (`POST /api/approvals`, `GET /api/approvals/:id/ruling`, `GET /api/approvals/key`, `POST /api/approvals/:id/rule`,
```

**After**

```text
  `POST /api/coordinators/:session/intent`, `POST /api/ledger/deviations`, `GET /api/ledger`, `GET /api/landing`,
  `POST /api/landing/entries` and `POST /api/landing/order` (setter attribution, not coordinator authorisation), and the approvals lane's
  six (`POST /api/approvals`, `GET /api/approvals/:id/ruling`, `GET /api/approvals/key`, `POST /api/approvals/:id/rule`,
```

The existing continuation says these routes `all call requireMailToken`; keep it. The new doors do not join `SESSION_ONLY`, `UNGATED`, or the dual-credential `EXEMPT-BUT-AUTHENTICATED` class. No route path is split across physical lines.

### Source-derived baseline and forced edits

Measured by read-only source extraction at `origin/main` commit `3ede3bb86e5087eee6adf94be71c58e22376d035`; these are baseline measurements, not suite passes or implementation results. Relevant checked-out source blobs match that ref. Re-measure if the execution base changes.

| Owner | Current fact | Required final change | Task |
|---|---|---|---|
| `server/src/coord/schema.ts#MIGRATIONS` | 35 migrations; last banner is `35: user_version 34 -> 35`; version derives from length | Append slot 36 only, leave 0–34 untouched; if main has consumed 36, append its actual next slot and report the departure | 1 |
| `server/test/coord-db.test.ts` | Three `.toBe(35)` version/count assertions | Update all three to the actual new total; preserve historical migration-slot assertions and add upgrade/rollback coverage for the new tables | 1 |
| `server/test/census-w8/journal.test.ts` | Four `appendThenApply` sites in the store; count anti-vacuity | Five sites, with exactly one named landing writer and one for each existing family: deviation allocation, account pools, coordinator intent, collect lane; mutation delete/duplicate landing must red | 1 |
| `server/test/single-definition/kernel-tail-journal.test.ts` | Same four-site anti-vacuity | Same five named families; keep the original controls rather than merely relaxing a number | 1 |
| `server/test/census-w8/journal.ts#FRAMER_SCOPES` | Enumerated framing scopes omit the future landing parser | Add `server/src/coord/landingJournalPolicy.ts`; extend existing query, never add a parallel framing census | 1 |
| Both journal census tests | Positive planted framing controls and real `splitJournalRecords` callers cover existing journals | Add a planted duplicate newline-framer in the landing parser and its real single-framer positive control; retain all old controls | 1 |
| `server/test/landing-entry-census.test.ts` | Every `landing_entries` write belongs to `advanceLanding` | Narrow live genuine-no-run insertion exception; advance remains pin/repin/ejection/quarantine/witness owner; recovery cannot fabricate projections or witnesses; one subject/authority/cursor writer and one ID allocator | 1, then 3 |
| `server/src/index.ts` and landing fixtures | Store constructed without landing journal | One store-owned configured journal; replay before HTTP/watchers/timers; fixture journal explicitly supplied; no independent route-dependency journal or HOME fallback | 1 |
| Architecture ring map and `coord-policy-rings.test.ts` | Existing L1 list names `landingEntry.ts`, `landingLine.ts` | Name new C4 L1 parser/write policy, L2 journal port and L3 adapter; Task 2 adds L4 action; classify by imports, no new source-literal purity pin | 1, then 2 |
| `server/src/coord/routes.ts` token scanner | 38 token-consulting coordination lanes | Keep both POST registrations literal beside GET with direct `requireMailToken(req,...)`; final 40, not hidden in another source file | 2 |
| Whole token surface | 41 lanes: coordination plus notify, pool epoch, update intent read | Final 43; no changes to the three extra lanes | 2 |
| README auth paragraph | `forty-one` total precedes `thirty-eight` coordination | `forty-three` then `forty`, same order and anchors; do not add unrelated number words in the counted span | 2 |
| `server/src/auth/gate.ts`, reason 2 and `EXEMPT ROUTES ARE SKIPPED` paragraph | `thirty-eight` then `forty-one` in each | `forty` then `forty-three`, preserve consult-versus-require distinction; add separately justified plain token exemptions | 2 |
| `server/test/auth-gate.test.ts` title containing `box-token lanes in EXEMPT` | `thirty-eight` then `forty-one` | `forty` then `forty-three`; property sweeps exercise both new routes, token/no-cookie allowed and cookie-only refused by route guard | 2 |
| `server/test/box-token-census.test.ts#WORDS` | Indexed through `forty-one` | Append `forty-two`, `forty-three`; preserve longest-first matching and count-order assertions | 2 |
| `ccd/ccrc-api#ROUTES` | 34 rows; no landing writes | Add exactly `landing.entries` and `landing.order`, both `POST|<literal-path>|no|-`; no identity fill | 2 |
| `ccd/ccrc-api` closed-surface bullet and table-header prose | Both say `thirty-four` | Both say `thirty-six`; preserve unique anchored header | 2 |
| `server/test/ccrc-api.test.ts` | 34-key agreement; word map through 34 | Add executable rows with explicit bodies, count 36 and word-map entries for 35/36; preserve token handling/body-fill contracts | 2 |
| README client list | `landing show` | `landing show|entries|order`; document required attribution and explicit patch clears | 2 |
| `server/test/ccrc-api-closed.test.ts` | Corpus contains only `landing.show`; size 34 | Task 4 EXCLUSIVELY updates all this file: corpus keys, count 36 and explanatory comment; body-fill guards unchanged | 4 |
| `shared/api.ts#AdvanceOk` and shared landing vocabulary | Loose landing payload; twelfth API import is `LandingEntry`; unknown comment says no writer stores it | Move exact `LandingWrite` union to import-free vocabulary, replace twelfth import, preserve twelve; amend unknown description only for named stale-head quarantine, never generic unknown repin | 3 |
| `server/test/peers-claims-l0.test.ts` and `server/test/collect-lane-l0.test.ts` | Exact twelfth import pinned | Update both to the same replacement import; keep total twelve and existing L0 purity controls | 3 |
| `server/test/refusal-status.test.ts` and shared refusal owner | New typed route words absent | Extend existing refusal map/type once; keep guards at auth, validation and uncertain-write seams distinct | 1/2, final gate 4 |

### Assertions and non-claims

- The four append-owner controls must name actual containing methods, not only assert total five. `CoordStore.writeLandingAuthority` is the landing append owner; replay shares private SQL application but never appends. Deleting or duplicating that site's call must fail the appropriate census. Preserve existing append-before-apply and inside-transaction queries.
- The new parser calls `splitJournalRecords` once for framing and applies its stricter blank/torn-tail validation separately. Its scanner positive control must prove that a hand-rolled `split('\\n')` or `lastIndexOf('\\n')` in that file is visible.
- All routes remain visible to both token censuses. A correctly attributed worker is not denied HTTP access merely for setting `fixesMain`; the skill reserves the conduct. No auth-gate test may confuse cookie fallback with the independent mandatory token check.
- Task 2's two new client rows predict an intermediate failure of the closed-client corpus/count until Task 4, which exclusively owns that file. State that temporary dependency explicitly; final whole-file gate must pass. Do not move the count into a separate exception or weaken the executable corpus.
- Recovered subjects are visible in additive recovery output; old omission means not reported. Neither replay nor an order write silently converts missing projection evidence into `runId:null` or an eligible pin.
- Preserve `collect-switch-prose.test.ts` byte-sensitive collector prose. It is an additional final gate, not permission to amend the switch's recovery behavior.
- Preserve the nineteen skill clauses, section 5b verdict fence, latest-attempt rule and absence-permits protocol. No worker-skill edit, merge-queue bypass, protocol bump, new ccd verb, snapshot-list change, automatic repair, retry timer or journal truncation.
- `store.ts` and `routes.ts` are growth-listed. Run `growth-check.test.ts` with `GROWTH_CHECK=1` against fresh `origin/main`, report each net delta, and remain within the existing limit. No blanket waiver, silent helper repository or growth-check edit is authorised. A necessary over-limit change is a discovered departure to report before publication, with its exact measured delta and proposed bounded remedy; never invent an unmeasured cap.

## Predicted mutation matrix

These are execution predictions, not measured kills. Each row changes one guard or behavior. Run one whole named file per process, sequentially, with baseline green, mutation red on the intended assertion, saved-copy/hash/mode restore, and final green. A compiler/import error is not the predicted behavioral kill except for the explicit type-contract row. An unintended red requires correcting the mutation or its test and remeasuring, never claiming the row passed. Use the bounded execution protocol in the shared contract.

### Journal and recovery

Files below are under `server/test/`; abbreviated `journal`, `store` and `census` mean `landing-journal.test.ts`, `landing-journal-store.test.ts` and `landing-entry-census.test.ts` respectively.

| ID | Single mutation | Whole-file red and decisive assertion |
|---|---|---|
| 5F-JOURNAL-01 | Accept the framer's incomplete final record. | journal: `rejects-torn-last-line`, reason torn. |
| 5F-JOURNAL-02 | Accept an unknown record kind as a no-op. | journal: `rejects-unknown-kind`, reason kind. |
| 5F-JOURNAL-03 | Accept v2 as v1. | journal: `rejects-future-version`, reason version. |
| 5F-JOURNAL-04a | Permit sequence 1,3. | journal: `rejects-sequence-gap`, reason sequence at record 2. |
| 5F-JOURNAL-04b | Permit sequence 1,1. | journal: `rejects-sequence-repeat`, reason sequence at record 2. |
| 5F-JOURNAL-05 | Classify present empty history as absent at replay. | store: `existing-empty-journal-refuses`, invalid/empty and unchanged rows/cursor. |
| 5F-JOURNAL-06a | Classify EACCES as absence. | journal: `permission-failure-is-unreadable`, not absent. |
| 5F-JOURNAL-06b | Classify EISDIR as absence. | journal: `directory-is-unreadable`, not absent. |
| 5F-JOURNAL-07a | Remove the no-follow leaf-open protection. | journal: `symlink-journal-refuses`, no target read/write. |
| 5F-JOURNAL-07b | Remove regular-file rejection. | journal: `nonregular-journal-refuses`, no success. |
| 5F-JOURNAL-07c | Remove nonblocking open. | journal: `fifo-journal-refuses-without-blocking`, fixture opener observes O_NONBLOCK; bounded real FIFO control does not hang. |
| 5F-JOURNAL-08a | Delete append file fsync. | journal: `append-file-sync-before-ack`, exact descriptor sync precedes success. |
| 5F-JOURNAL-08b | Delete append parent fsync. | journal: `append-directory-sync-before-ack`, parent sync precedes success. |
| 5F-JOURNAL-08c | Delete replay file durability confirmation. | store: `replay-file-confirmation-before-sql`, injected file confirmation failure leaves rows/cursor unchanged. |
| 5F-JOURNAL-08d | Delete replay parent durability confirmation. | store: `replay-parent-confirmation-before-sql`, injected parent confirmation failure leaves rows/cursor unchanged. |
| 5F-JOURNAL-09 | Apply authority SQL before append. | store: `journal-before-db`, append observer sees the old rows and cursor. |
| 5F-JOURNAL-10 | Commit cursor before authority in a separate transaction. | store: `db-failure-replays-on-restart`, durable line is reapplied after fixture reopen. |
| 5F-JOURNAL-11 | Skip suffix after restoring a pre-entry/pre-run snapshot. | store: `recovered subjects retain authority without fabricated projections`, exact recovered edges/flag/setter. |
| 5F-JOURNAL-12 | Apply all records at equal cursor. | store: `replay-is-idempotent`, applied 0 and unchanged rows. |
| 5F-JOURNAL-13a | Drop [] in recorded complete order. | store: `whole-after-can-be-cleared`, replay restores []. |
| 5F-JOURNAL-13b | Drop false in recorded complete order. | store: `whole-fixes-can-be-cleared`, replay restores false. |
| 5F-JOURNAL-14 | Apply a valid prefix before validating the suffix. | store: `bad-suffix-rolls-back-all-replay`, no row/cursor changes. |
| 5F-JOURNAL-15a | Reset positive cursor for absent history. | store: `missing-journal-with-cursor-refuses`, missing and no reset. |
| 5F-JOURNAL-15b | Permit cursor beyond lastSeq. | store: `cursor-ahead-refuses`, cursor error. |
| 5F-JOURNAL-16a | INSERT a projection while replaying a no-run creation claim. | store: `replay-never-creates-a-pin`, projection count stays zero. |
| 5F-JOURNAL-16b | Overwrite an existing measured projection while replaying authority. | store: `replay-preserves-projection`, all measured fields byte/value unchanged. |
| 5F-JOURNAL-17a | Omit a missing recovered subject from GET recovery. | store: `missing-subject-is-visible-and-holds`, subject present and head null. |
| 5F-JOURNAL-17b | Infer current no-run from historical creation. | store: `no-run-creation-then-unjournalled-binding`, association remains unmeasured after pre-entry restore. |
| 5F-JOURNAL-18a | Join projection by ID only. | store: `projection identity conflict quarantines both projects`, both identities retained, both heads null. |
| 5F-JOURNAL-18b | Label a journal/projection identity collision malformed journal. | store: `projection-conflict-is-recovery-not-malformed-history`, boot replay succeeds and conflict remains visible. |
| 5F-JOURNAL-19a | Permit a nonexistent after target. | store: `after-reference-missing-refuses`, no append. |
| 5F-JOURNAL-19b | Permit an existing foreign-project target. | store: `after-reference-cross-project-refuses`, distinct refusal and no append. |
| 5F-JOURNAL-20 | Append before existence/reference policy refusal. | store: `refused-command-appends-nothing`, bytes and cursor unchanged. |
| 5F-JOURNAL-21a | Drop mayApply after complete append failure. | store: `complete-append-failure-is-uncertain`, mayApply true. |
| 5F-JOURNAL-21b | Leave fence open after complete append failure. | store: `append-failure-fences-all-entrances`, GET/private/pin/retreat/write refuse before effects. |
| 5F-JOURNAL-21c | Drop mayApply after authority COMMIT failure. | store: `authority-commit-failure-is-uncertain`, db-commit and mayApply true. |
| 5F-JOURNAL-21d | Leave fence open after authority COMMIT failure. | store: `authority-commit-failure-fences-all-entrances`, no subsequent landing effects. |
| 5F-JOURNAL-22a | Skip nested reference field validation. | journal: `rejects-invalid-reference-shape`, fields error. |
| 5F-JOURNAL-22b | Permit one ID to name two project/PR identities. | journal: `rejects-id-history-contradiction`, identity error. |
| 5F-JOURNAL-22c | Permit one project/PR to acquire two IDs. | journal: `rejects-key-history-contradiction`, identity error. |
| 5F-JOURNAL-23a | Plant a second subject/authority/cursor SQL writer outside the private apply family. | census: named writer census reports the planted owner. |
| 5F-JOURNAL-23b | Plant replay projection INSERT. | census: replay has no projection INSERT exception. |
| 5F-JOURNAL-23c | Plant pinnedSha UPDATE outside advanceLanding/live creation exception. | census: measured pin writer census reports it. |
| 5F-JOURNAL-23d | Delete landing's appendThenApply call from its named owner. | census-w8/journal.test.ts: five named families and landing anti-vacuity red. |
| 5F-JOURNAL-23e | Duplicate landing's appendThenApply call. | single-definition/kernel-tail-journal.test.ts: one landing site, not merely five names. |
| 5F-JOURNAL-24a | Move replay after HTTP/listener start. | census: `boot-replay-before-consumers`, order assertion red. |
| 5F-JOURNAL-24b | Omit local-mode production journal wiring. | census: `local-mode-has-store-journal`, absent named wiring red. |
| 5F-JOURNAL-24c | Omit remote-mode production journal wiring. | census: `remote-mode-has-store-journal`, absent named wiring red. |
| 5F-JOURNAL-25a | Delete the new coord.db recovery exception. | census: `landing-journal-prose`, required recovery statement absent. |
| 5F-JOURNAL-25b | Add landing.log to snapshot-copy membership. | census: `landing-journal-left-in-place`, snapshot inclusion red. |
| 5F-JOURNAL-25c | Add landing.log to restore-copy membership. | census: `landing-journal-left-in-place`, restore inclusion red. |
| J-FENCE-PLAIN-a | Require a landing port for a genuinely non-landing plain advance. | store: `plain-nonlanding-needs-no-port`, normal transition still succeeds. |
| J-FENCE-PLAIN-b | Let a direct plain merging→working call take the ordinary advance path. | store: `plain-cannot-disguise-retreat`, pairing refuses/throws before run/event mutation. |
| J-SNAPSHOT | Confirm a pathname replacement instead of the measured descriptor/bytes. | journal: `exact-snapshot-refuses-replacement`, changed and no SQL. |
| J-RESERVED-a | Allocate above projection max only. | store: `allocator-reserves-recovered-subject-ids`, new ID exceeds both maxima. |
| J-RESERVED-b | Materialize a subject through identity collision. | store: `conflict-has-no-materialization-exception`, no run/event/projection writes. |
| J-RESERVED-c | Require explicit authority to materialize a target-only subject. | store: `target-only-not-set-materializes-with-fresh-pin-defaults`, same reserved ID, no invented authority row. |
| J-FRAMER-a | Remove landing parser from FRAMER_SCOPES. | census-w8/journal.test.ts: planted duplicate-framer in landing parser remains detected. |
| J-FRAMER-b | Delete the landing parser's real splitter call. | single-definition/kernel-tail-journal.test.ts: real single-framer positive control red. |
| J-ADVANCE-COMMIT-a | Report ambiguous pin COMMIT as definite no-effect failure. | store: `pin-commit-failure-is-uncertain`, db-commit/mayApply true without journal append. |
| J-ADVANCE-COMMIT-b | Report ambiguous retreat COMMIT as success. | store: `retreat-commit-failure-is-uncertain`, no success/notice and fence closed. |
| J-ROLLBACK-a | Continue serving on an active failed transaction. | store: `uncertain-rollback-closes-shared-connection`, unrelated operations cannot join it. |
| J-ROLLBACK-b | Return restart despite failed close without invoking fail-stop. | store: `unprovable-close-fails-stop`, fixture callback invoked, no response continuation. |
| J-REOPEN | Reopen an equal-cursor fence without durability confirmation. | store: `equal-cursor-reopen-confirms-durability`, failed confirmation keeps fence. |

### Attributed writes

Abbreviated `policy` means `landing-writes.test.ts`, `routes` means `landing-writes-route.test.ts`.

| ID | Single mutation | Whole-file red and decisive assertion |
|---|---|---|
| 5F-WRITES-01 | Delete entries requireMailToken. | routes: `entries-token-before-attribution`, 401 and zero registry calls. |
| 5F-WRITES-02 | Delete order requireMailToken. | routes: `order-token-before-attribution`, 401 and zero registry calls. |
| 5F-WRITES-03a | Move entries token check after attribution await. | coord-pause-route.test.ts: first-await gate census; routes observes registry call. |
| 5F-WRITES-03b | Move order token check after attribution await. | coord-pause-route.test.ts: first-await gate census; routes observes registry call. |
| 5F-WRITES-04 | Bypass entries attribution. | routes: `entries-reuses-measured-attribution`, stale UUID is 403/no append. |
| 5F-WRITES-05 | Bypass order attribution. | routes: `order-reuses-measured-attribution`, absent sender is 403/no append. |
| 5F-WRITES-06a | Accept caller setBy in entry body. | policy: `entry-rejects-authoritative-fields`, bad-request. |
| 5F-WRITES-06b | Accept caller runId in order body. | policy: `order-rejects-authoritative-fields`, bad-request. |
| 5F-WRITES-06c | Coerce fixesMain with Boolean(value). | policy: `fixesMain-must-be-boolean`, numeric 0 is bad-request. |
| 5F-WRITES-07a | Remove existing projection duplicate check. | routes: `entry-refuses-materialized-duplicate`, 409/unchanged bytes. |
| 5F-WRITES-07b | Remove recovered-subject duplicate check. | routes: `entry-refuses-recovered-duplicate`, existing not missing. |
| 5F-WRITES-08a | Permit order on missing source. | policy: `order-missing-source`, entry-missing. |
| 5F-WRITES-08b | Treat recovered unresolved source as missing. | policy: `order-unresolved-source`, recovery-unresolved not entry-missing. |
| 5F-WRITES-09a | Remove target existence guard. | policy: `requires-existing-after-target`, after-missing. |
| 5F-WRITES-09b | Remove target project guard. | policy: `requires-same-project-after-target`, after-cross-project. |
| 5F-WRITES-10a | Remove self-edge check. | policy: `rejects-self-cycle`, cycle. |
| 5F-WRITES-10b | Remove source-reaching transitive check. | policy: `rejects-transitive-cycle`, 1→2→1 refuses. |
| 5F-WRITES-11a | Refuse every graph containing an unrelated legacy cycle. | policy: `permits-independent-old-cycle`, successful edit. |
| 5F-WRITES-11b | Refuse a repair that removes source's old cycle. | policy: `permits-source-cycle-repair`, successful clear. |
| 5F-WRITES-12a | Default omitted afterIds to []. | policy: `omitted-after-preserves`, prior [2] retained. |
| 5F-WRITES-12b | Default omitted fixesMain to false. | policy: `omitted-fixes-preserves`, prior true retained. |
| 5F-WRITES-13a | Use afterIds?.length to detect supplied []. | routes: `clears-after-array`, [] recorded and replayed. |
| 5F-WRITES-13b | Use truthiness to detect supplied false. | routes: `clears-fixes-flag`, false recorded and replayed. |
| 5F-WRITES-14 | Set setter to coordinator instead of attributed byId. | routes: `foreign-setter-is-recorded`, setBy lane-b. |
| 5F-WRITES-15a | Fold absent associated run to no-run. | routes: `missing-current-run-refuses`, run-unreadable/no append. |
| 5F-WRITES-15b | Fold unreadable associated run to no-run. | routes: `unreadable-current-run-refuses`, run-unreadable/no append. |
| 5F-WRITES-16 | Apply before policy decision. | routes: `policy-refusal-before-append`, bytes/rows/notices unchanged. |
| 5F-WRITES-17 | Gather snapshot before mutex and reuse it after waiting. | routes: `write-serial-with-advance`, queued request sees new current association. |
| 5F-WRITES-18a | Drop HTTP mayApply. | routes: `uncertainty-crosses-http`, true preserved. |
| 5F-WRITES-18b | Emit notice on uncertain result. | routes: `failed-writes-never-notify`, zero notices. |
| 5F-WRITES-19a | Suppress foreign changed-order event. | routes: `foreign-setter-named-in-inversion`, one exact record. |
| 5F-WRITES-19b | Omit setter from event body. | routes: `foreign-setter-named-in-inversion`, exact body equality. |
| 5F-WRITES-20a | Notify on coordinator's own order. | routes: `coordinator-order-does-not-notify`, zero notices. |
| 5F-WRITES-20b | Notify on unchanged effective order. | routes: `unchanged-order-does-not-notify`, zero notices and no append. |
| 5F-WRITES-21a | Suppress clear-value event. | routes: `clear-order-notifies`, one record-only event. |
| 5F-WRITES-21b | Suppress genuine no-run order event. | routes: `no-run-order-notifies`, event runId null. |
| 5F-WRITES-21c | Suppress unclaimed current-run order event. | routes: `unclaimed-run-order-notifies`, event actual runId. |
| 5F-WRITES-22 | Replace NoticeSink with direct recordFeedEvent. | consolidation-census.test.ts: direct-writer ratchet red; routes real catch-up event absent. |
| 5F-WRITES-23a | Delete entries EXEMPT row. | auth-gate.test.ts: token/no-cookie reaches entries handler, not auth refusal. |
| 5F-WRITES-23b | Delete order EXEMPT row. | auth-gate.test.ts: token/no-cookie reaches order handler, not auth refusal. |
| 5F-WRITES-24a | Delete entries from CLAUDE token list. | box-token-census.test.ts: prose/live route equality red. |
| 5F-WRITES-24b | Delete order from CLAUDE token list. | box-token-census.test.ts: prose/live route equality red. |
| 5F-WRITES-25a | Add entries to WRITE_ANSWER_EXEMPT. | secret-mask.test.ts: entries answer remains masked, synthetic credential absent. |
| 5F-WRITES-25b | Add order to WRITE_ANSWER_EXEMPT. | secret-mask.test.ts: order answer remains masked, synthetic credential absent. |
| 5F-WRITES-26a | Delete landing.entries client row. | ccrc-api.test.ts: exact POST route/body agreement red. |
| 5F-WRITES-26b | Delete landing.order client row. | ccrc-api.test.ts: exact POST route/body agreement red. |
| 5F-WRITES-26c | Auto-fill entry attribution. | ccrc-api.test.ts: entry body passes unchanged. |
| 5F-WRITES-26d | Overwrite order attribution. | ccrc-api.test.ts: order body passes unchanged. |
| 5F-WRITES-27a | Add runtime node:fs import to landingWrites.ts. | policy: AST builtin-import assertion red, no new readFileSync source pin. |
| 5F-WRITES-27b | Add Date.now() to landingWrites.ts. | policy: AST identifierReferences assertion sees Date; comments-only control remains green. |
| 5F-WRITES-28 | Write authority SQL in landingWritesAct.ts. | census: single apply-owner assertion reports L4 action; routes expects actual order line. |
| W-DEPENDENCIES-a | Traverse display [] for unreadable afterIds. | policy: `unreadable-reachable-dependencies-refuse`, hidden cycle is not accepted. |
| W-DEPENDENCIES-b | Reject every unknown-state target. | policy: `readable-unknown-state-is-traversable`, independent edit succeeds. |
| W-RECOVERY-a | Treat recovered target as absent. | policy: `recovered-target-is-unmeasured`, recovery-unresolved. |
| W-RECOVERY-b | Treat recovered target as satisfied. | policy: `recovered-target-is-unmeasured`, no accepted write/append. |
| W-PROJECTION | Allow an order source with unreadable projection values to supply display placeholders. | policy: `unreadable-source-cannot-journal-placeholders`, projection-unreadable/no mutation; store integration asserts no append. Task 1 owns this guard. |

### Carried reader, retreat and wire

Task 1 owns FIXES-MAIN, PINNED-AT, EJECTIONS and both C-BIGINT rows. Task 3 owns episode-head quarantine, overflow, bare notice, wire and stale-head eligibility. Remeasure any previously killed row affected by later final-file changes.

| ID | Single mutation | Whole-file red and decisive assertion |
|---|---|---|
| 5F-CARRIED-EPISODE-HEAD | Remove stale-head quarantine decision. | landing-entry-store.test.ts: `stale episode head quarantines older pin`, kept/unknown, unchanged hashes/counter/base, transition succeeds, no eligible head. |
| 5F-CARRIED-FIXES-MAIN | Accept fixesMain 2 as true/readable. | landing-entry-store.test.ts: `unreadable fixesMain makes entry unknown`, false placeholder/unknown/raw unchanged. |
| 5F-CARRIED-PINNED-AT | Remove pinnedAt validity. | landing-entry-store.test.ts: `unreadable pinnedAt makes entry unknown`, finite 0/unknown/raw unchanged. |
| 5F-CARRIED-EJECTIONS | Remove ejections validity. | landing-entry-store.test.ts: `unreadable ejections makes entry unknown`, finite 0/unknown/raw unchanged. |
| 5F-CARRIED-BARE-NOTICE | Remove both-null wording arm. | landing-line-order.test.ts: exact honest body equality; landing-ejection-ask.test.ts independently checks recorded notice. Measure each file separately. |
| 5F-CARRIED-WIRE-UNION | Restore loose landing kind:string payload. | typecheck-tests.test.ts ALONE: landing-advance-wire equality/narrowing and negative assignment checks red. |
| C-BIGINT-fixes | Remove setReadBigInts from public landing SELECT. | landing-entry-store.test.ts: actual oversized fixesMain reads unknown without throw. |
| C-BIGINT-private | Remove setReadBigInts from private landing SELECT. | landing-entry-store.test.ts: actual oversized pinnedAt/ejections through advance do not throw or mutate projection. |
| C-OVERFLOW | Remove safe ejection-count boundary. | landing-entry-store.test.ts: MAX_SAFE_INTEGER unchanged; one-less control increments exactly once. |
| C-STALE-HEAD | Let quarantined stale pin remain eligible. | landing-line-order.test.ts: unknown stale pin cannot head or release follower. |

### Skills and client corpus

Each row runs `coordinator-skill.test.ts` unless another file is named. Keep protected clauses and the §5b fence unchanged except in the explicit saved-copy mutation.

| ID | Single mutation | Decisive red assertion |
|---|---|---|
| 5F-SKILLS-01 | Change only SKILL.md's never-a-worker reservation to also-a-worker. | `5f reserves fixesMain in both texts`, main skill assertion. |
| 5F-SKILLS-02 | Change only reference reservation to also-a-worker. | Same test, bounded reference assertion; whole WRITES pin. |
| 5F-SKILLS-03 | Delete reference entry paragraph and its client fence. | Whole WRITES pin; ccrc-api-closed.test.ts loses landing.entries executable invocation. |
| 5F-SKILLS-04 | Delete reference order paragraph and its client fence. | Whole WRITES pin; ccrc-api-closed.test.ts loses landing.order executable invocation. |
| 5F-SKILLS-05 | Permit PR numbers as afterIds. | Whole WRITES/entry-ID pin. |
| 5F-SKILLS-06 | Replace whole-result instruction with changed-fields-only. | Whole normalized WRITES equality. |
| 5F-SKILLS-07 | Delete [] clearing phrase only. | Explicit clear and whole WRITES pin. |
| 5F-SKILLS-08 | Delete false clearing phrase only. | Explicit clear and whole WRITES pin. |
| 5F-SKILLS-09 | License bypassing a landing gate. | Priority-is-not-permission and whole WRITES pin. |
| 5F-SKILLS-10 | Say attribution proves authorization. | Attribution-is-not-authorization and whole WRITES pin. |
| 5F-SKILLS-11 | Replace step-6 landing.entry.baseSha with landing.baseSha. | Actual answer member and REPORT_LESS pin. |
| 5F-SKILLS-12 | Delete step-6 following fail-closed no-base/no-mail sentence. | Fallback and REPORT_LESS pin. |
| 5F-SKILLS-13 | Add double quote to new short block. | Raw physical-copy assertion. |
| 5F-SKILLS-14 | Join reference lines beyond 80 columns, normalized text unchanged. | Raw wrap assertion while normalized control stays equal. |
| 5F-SKILLS-15 | Add trailing space inside protected verdict fence. | 254-line/trailing-LF/SHA-256 equality. |
| 5F-SKILLS-16 | Remove landing.order from expected executable corpus only. | ccrc-api-closed.test.ts exact sorted invocation-set equality. |
| 5F-SKILLS-17 | Expect GET landing.show for order's linkage. | Registered POST and closed-row exact linkage. |
| 5F-SKILLS-18 | Delete uncertainty paragraph while keeping field names. | Whole WRITES and mayApply/recovery hold pin. |

### Association witness and quarantine recovery

All rows are separate predictions. `store` is `landing-journal-store.test.ts`; `entry` is `landing-entry-store.test.ts`.

| ID | Single mutation | Whole-file red and decisive assertion |
|---|---|---|
| J-ASSOC-IDENTITY | Consider exact identity sufficient despite contradictory latest binding. | store: `exact identity does not resolve contradictory restored binding`, recovery association-unmeasured/head null/order refused. |
| J-ASSOC-SEQ | Ignore witness observedSeq equality. | store: `later journal observation invalidates restored witness`, later contradictory suffix holds. |
| J-ASSOC-BINDING | Ignore witness runId equality. | store: `witness binds exact projection association`, mismatched runId cannot excuse contradiction. |
| J-ASSOC-HEAD | Ignore witness pinnedSha equality. | store: `witness binds exact pin head`, head-only corruption holds. |
| J-ASSOC-HANDOFF | Ignore witness handoffCommit equality. | store: `witness binds exact handoff`, handoff-only corruption holds. |
| J-ASSOC-MINT | Mint witness during replay from restored projection. | store: `replay-never-mints-witness`, table unchanged and contradictory association held. |
| J-ASSOC-ORDER | Refresh witness during live order lookup. | store: `order-observation-is-not-verification`, witness bytes/sequence unchanged; new historical observation agrees without refresh. |
| J-ASSOC-PIN | Omit atomic witness write from verified repair pin. | store: `fresh verified pin resolves own association mismatch`, same subject/authority, no hold for that subject, exact witness/episode/projection committed together. |
| J-ASSOC-ATOMIC | Persist witness outside pin transaction. | store: `failed pin cannot leave verification witness`, SQL-triggered projection failure leaves no new witness. |
| J-ASSOC-JOIN | Resolve association by loading runs at observedRunId. | store: `historical run reuse is not association recovery`, reused historical ID does not select a coordinator or release missing subject. |
| C-QUARANTINE-MARK | Omit stale-episode-head marker while storing unknown. | entry: `stale quarantine can verified-repin`, sanctioned path clears marker and returns pinned. |
| C-QUARANTINE-BROAD | Permit every unknown row to repin. | entry: `unmarked unknown is not a sanctioned quarantine`, remains kept/unknown. |
| C-QUARANTINE-COUNTER | Permit quarantine repin with unreadable retained ejections. | entry: `unreadable quarantine counter cannot repin`, raw row unchanged and unknown kept. |
| C-QUARANTINE-EDGES | Permit quarantine repin with unreadable dependencies. | entry: `unreadable quarantine dependencies cannot repin`, no authority lost or placeholder written. |
| C-QUARANTINE-CLEAR | Do not clear marker during verified repin. | entry: `stale quarantine can verified-repin`, final state pinned/marker null and witness matches. |
| C-QUARANTINE-AUTH | Reset recovered authority while repinning quarantine. | entry: `quarantine repin preserves authoritative order`, edges/flag/setter/counter retained exactly. |

No mutation in this document has run. Preserve the wholly unjournalled-change limitation as a documented non-guarantee; do not create a test claiming it can be detected.

## Deviations Found

The allocator issued D-7652 through D-7663 on 2026-10-31 19:56 UTC; all twelve are defined below in the same publication act. There is no unused execution reservation block. New discoveries remain `D-TBD-<slug>` and are reported for coordinator allocation and definition.

- **D-7652** — recover subjects and authority separately from measured projections; reserve recovered IDs and hold every project affected by identity collisions.
- **D-7653** — consumer-declared descriptor/byte evidence; complete append plus file and parent fsync, unlike the existing pool journal; no uncertain append rollback or salvage.
- **D-7654** — typed mayApply and global landing fence for authoritative append/apply/COMMIT AND measured advance COMMIT; clean-boundary proof, connection closure/fail-stop and explicit durable replay.
- **D-7655** — exact verified-pin witness binds latest observedSeq and current projection; never order/replay minted; does not detect wholly lost unjournalled changes.
- **D-7656** — independently readable dependency graph; source-reaching cycle rejection, repair/independent legacy-cycle acceptance, no placeholder authority.
- **D-7657** — attributed record-only changed-order event, including genuine no-run/unclaimed case; current association only, no replay/outbox/exactly-once promise.
- **D-7658** — genuine live no-run creation records supplied hashes as claims, never independent GitHub/review/ancestry proof.
- **D-7659** — one strict numeric/BigInt reader, preserved fail-closed project flags and safe ejection overflow.
- **D-7660** — measured episode-head mismatch quarantines unknown with a named marker; verified readable repin alone clears it, without false ejection or broad unknown acceptance.
- **D-7661** — verified pin can materialize reserved target-only subject with authority:not-set using fresh defaults, without invented authority or an order record.
- **D-7662** — move the exact result union into import-free vocabulary, replace the twelfth API import and preserve additive wire.
- **D-7663** — two plural closed-client verbs, exact instruction copy and bounded physical step-6 correction, without standing-clause/fence changes.

## Draft Self-review

| Check | Result of coordinator self-review, not independent acceptance |
|---|---|
| Spec §5.5 journal/reconstruction | Task 1 recovers authority only; sweep/landed work remains 5h; no new binding authority |
| Spec §5.5 entries and pins | Task 1 live no-run creation and verified pin ownership; Task 3 stale-head quarantine and wire |
| Spec §5.5 attribution/feed | Task 2 mandatory token plus measured caller, one pure decision, record-only feed event, explicit uncertainty/window |
| Scope's carried edge/numeric/base wording | Task 1 graph/strict reader, Task 3 quarantine/notice/union, Task 4 exact base-member copy |
| Spec §7/global constraints | Additive wire, Node floor, one writer, synchronous DB, no ccd verb or exec expansion; exact CLAUDE blocks are proposals |
| Step scan and type ownership | Task 1 owns facts/decider before writer; Task 2 only parsing/notice/delivery; strict source projection metadata prevents placeholder writes |
| Review Focus | Each class above maps to an owning test and separate mutation prediction |
| Proportion | Signatures, state/failure contracts and exact copy are normative; implementation bodies omitted. The matrix is a measured-guard checklist, not a claim of execution |

## Independent Whole-plan Review

A separate native Opus reviewer at high effort read the entire v1 consolidated plan and found no verified material blocker in the covered areas. This is design/source consistency evidence, not a test pass, implementation acceptance or operator approval. The reviewed v1 SHA-256 is `278f7fbc00e05cebbee8ef96ab888adc86772ff1229924a9b619387b43323e85`.

Coverage included the relevant spec and scope, the shared landing/refusal vocabulary, existing advance/refusal/reader/order paths, targeted store/migration/journal/boot sections and relevant ownership/purity/census queries. Source corroboration was partial: the reviewer did not independently inspect the closed shell client's implementation, auth/exemption and masking scanners, skill/corpus extractors, every final-gate test or the full older 5e plan. No such coverage or executable result is implied.

The reviewer identified two nonblocking execution cautions: the existing append census must recognise the actual injected-port call, not merely count a fifth owner; and the declared Task 2-to-Task 4 corpus dependency must remain an explicit intermediate red rather than an all-green claim. Revision v2 adds the supported method-local `log.append` spelling to contract §8 after a direct source check of the existing query. The remaining changes record review status only; the exact proposed instruction blocks and implementation contracts are otherwise unchanged. This revision is not a second independent review.

## Where Things Stand

### Agreed

- Approved stage-5 scope and retained safeguards; this consolidated draft records proposed implementation decisions inside that scope.
- Missing projections are visible recovery, never fabricated no-run pins. Identity alone does not resolve known association contradictions.
- No test pass, mutation kill, tracked implementation or 5f dispatch is claimed by this planning pass. The twelve issued planning deviations are defined above, not reserved for future execution.

### Waiting on You

- Read the exact proposed CLAUDE.md amendments before implementation dispatch. They are not yet approved.
- Publication gates still precede dispatch. The completed whole-plan review has partial source corroboration, not blanket executable acceptance; this draft is not an implementation licence.

### Later

- Intents, landed measurement/backfill/bounding, live next-to-land control and pause/withdraw remain their later waves.
- Binding journalling, universal post-snapshot freshness, automatic repair and a notification outbox are not added here.

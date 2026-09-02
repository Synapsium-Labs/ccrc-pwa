# program-leverage wave 7 — F7: program health on the board, and the ledger-allocation guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the wedges this program has been discovering forensically — parked mail, replay counts
climbing toward the 20-ceiling, repeated done-claim rejections, a dispatch whose brief was never
queued, a coordinator that was never briefed — onto the `/runs` board as measured facts; and close both
holes in the deviation-allocation guard that has now fired three times.

**Architecture:** Four independent pieces on one branch. (1) `CoordStore` learns ONE batched health
read — four `GROUP BY` queries per `runs()` call, not per row — whose answer rides `RunSummary.health`,
an additive wire object with a single tolerant reader in the PWA. (2) Two new `runs` columns
(migration 7) make `briefQueued`/`clearError` durable, so the one dispatch outcome that leaves no trace
today leaves one. (3) `deviation-refs.test.ts` gains a CROSS-TREE arm: an L1 pure decision in
`ledger.ts` fed by `origin/main`'s plan blobs alongside the working tree's, which fires BEFORE the merge
instead of one merge after it — measured against both real incidents. (4) The fold-ins: D-1169's clock
leaves the store, two of `auth-gate.test.ts`'s five hand-pinned cardinals become derivations, and three
stale prose cardinals that no scanner reads are corrected.

**Tech Stack:** TypeScript (`"type":"module"` in all four packages), Fastify 5, `node:sqlite`
`DatabaseSync`, vitest 4, React 19 + zustand (PWA), jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-28-program-leverage-design.md` §9 — fetch `ws/brisk-meadow`
from origin; the program ledger on that ref carries this wave's brief and wave 6's close record.

## Global Constraints

- **Branch:** commit on `ws/quiet-meadow`, never a feature branch. The done-fingerprint re-measures
  THIS workspace branch's tip; work parked elsewhere wedges every close with `stale-tip`.
- **NOT agent-first:** server + PWA + root docs only. If a finding pushes into `ccd/`,
  `session-hook.sh` or either skill corpus, MAIL THE COORDINATOR BEFORE IMPLEMENTING (runId 28) — it
  changes the deploy lane. Deploy is not the worker's act.
- **Wire discipline:** additive-only; a SINGLE reader per new field; an older peer omitting a field is
  tolerated and renders NOTHING (never a lie); no `FLEET_PROTO` bump (stays 1); no new `ccd` verbs;
  **no overloaded null at any new seam.**
- **Rings** (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`): L0 `shared/*.ts`
  imports nothing but a sibling TYPE; L1 pure decisions, no `fs`/fastify/`reply`/clock; L2 ports
  declared by the consumer; L3 adapters may not narrow a distinction they received; L4 delivery owns
  fastify/sockets/timers and may not DECIDE; L5 is `index.ts` only.
- **Mutation-table discipline:** every guard ships WITH a test measured RED on that guard's deletion.
  TDD red-first. Rows carry **suite / mutation / verbatim first-fail**, written AS YOU GO, and the
  table is counted twice by independent methods. A row that comes back GREEN is a hole, not a pass.
- **Deviations:** allocated from `~/.local/bin/ccrc-api ledger allocate` with `byId`, floor read from
  the allocator and never from a document, **allocated and defined in the same act**. This wave holds
  **D-1293..D-1305**. Never predict or reuse a number.
- **Suites:** `./node_modules/.bin/vitest run` from inside the package, FOREGROUND, timeout ≥600000ms,
  tails READ not grepped. Never bare `npx vitest`. All three packages installed or `typecheck-tests`
  reports spurious failures.
- **Node floor `>=22.13.0`** identical across the three engines. If `node-floor`'s absolute assertion
  is red while the others are green, RAISE engines — never lower them.
- **Baseline measured before any edit (2026-09-02 05:07 UTC):** server `248 files / 6248 passed /
  56 skipped`, 294s. Any red beyond that is this wave's.

## File Structure

| File | Responsibility |
|---|---|
| `shared/api.ts` (modify) | L0: `RunHealth`, `RunSummary.health`, `DONE_AUTHORITY_CODES`, the three render thresholds, `CoordCapsView.updatedAt` |
| `server/src/coord/schema.ts` (modify) | migration 7: `runs.briefQueued`, `runs.clearError` |
| `server/src/coord/store.ts` (modify) | L3: `runHealth(runIds)` — four batched reads; `hydrateRun` takes the health; `setCaps(next, at)` |
| `server/src/coord/dispatch.ts` (modify) | writes the two new columns inside the existing commit |
| `server/src/coord/ledger.ts` (modify) | L1: `definitionsIn`, `crossTreeCollisions`, `unallocatedDefinitions`, `projectEra` — pure, fixture-testable |
| `server/src/coord/routes.ts` (modify) | L4: `capsView` carries `updatedAt`, and `setCaps` takes the caller's clock. **NOT** `GET /api/ledger` — see Task 9 |
| `pwa/src/fleet/runWords.ts` (modify) | the tolerant reader + the warn decision, never in JSX |
| `pwa/src/screens/RunsScreen.tsx` (modify) | the compact warn row |
| `pwa/src/fleet/fleet.css` (modify) | `.run-row .run-warn`, grounded, no glow/animation/box-shadow |
| `server/test/coord-health.test.ts` (create) | the store's health read, wedge-manufacturing fixtures |
| `server/test/ledger-crosstree.test.ts` (create) | the L1 cross-tree decision, fixture collisions |
| `server/test/deviation-refs.test.ts` (modify) | the cross-tree arm over the REAL two trees |
| `pwa/test/runs-health.test.tsx` (create) | the warn row, incl. the older-server absence case |
| `CLAUDE.md`, `CONTRIBUTING.md` (modify) | the pre-merge measurement as a documented step (README needed no change) |

---

### Task 1: `DONE_AUTHORITY_CODES` — one definition, two copies deleted

**Files:**
- Modify: `shared/api.ts` (beside `MAIL_REJECT_CODES`, `:3451-3469`)
- Modify: `server/src/coord/close.ts:55-56`
- Modify: `server/src/coord/fingerprint.ts:32-33`
- Test: `server/test/single-definition.test.ts` (add the guard)

**Interfaces:**
- Produces: `DONE_AUTHORITY_CODES: readonly DoneRejectCode[]`, `type DoneRejectCode`. Task 3's health
  read filters `mail_rejections.code` by this list; Tasks 2 and 5 consume the type.

The done-authority six are spelled THREE times today: once inside `MAIL_REJECT_CODES` and twice as an
identical `Extract<MailRejectCode, …>` in `close.ts` and `fingerprint.ts`. Task 3 needs the list at
runtime (a SQL `IN (…)`), which would be a fourth. Derive it once instead.

- [x] **Step 1: Write the failing guard**

In `server/test/single-definition.test.ts`, beside the `MAIL_REJECT_CODES` guard at `:341`:

```ts
  it('the done-authority family is enumerated once, and the two Extract copies are gone', () => {
    // Three copies today: MAIL_REJECT_CODES's own block, close.ts and
    // fingerprint.ts. Task 3 needs the list at RUNTIME for a SQL IN (...), which
    // would be a fourth. This is the guard that keeps it at one.
    const DEF = /^\s*export const DONE_AUTHORITY_CODES\b/m;
    expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel))
      .toEqual(['shared/api.ts']);
    // The shape both consumers used to spell. Not "no Extract anywhere" — an
    // Extract over a DIFFERENT union is fine; this is the one literal list.
    const COPY = /Extract<\s*MailRejectCode\s*,[^>]*'stale-tip'/;
    expect(ALL.filter((f) => COPY.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'done-authority'`
Expected: FAIL — first assertion reds, `expected [] to deeply equal [ 'shared/api.ts' ]`.

- [x] **Step 3: Add the single definition**

In `shared/api.ts`, immediately after `MAIL_REJECT_CODES`/`MailRejectCode`:

```ts
/**
 * The done-authority subset of `MAIL_REJECT_CODES` — the six a wave-done or a
 * forward advance can be refused with, as opposed to the ingress, peer-bound and
 * delivery families. The as-const idiom (`CLAIM_STATES`, :3268) rather than the
 * union-first one: the ARRAY is the single definition and the type follows it,
 * because wave 7's health read needs the members at runtime for a SQL `IN (...)`
 * and a hand-kept fourth copy is what this replaces (D-1296).
 */
export const DONE_AUTHORITY_CODES = [
  'stale-tip', 'tip-unmeasurable', 'branch-unmeasurable', 'pr-regressed',
  'pr-unmeasurable', 'no-handoff-commit',
] as const satisfies readonly MailRejectCode[];
export type DoneRejectCode = (typeof DONE_AUTHORITY_CODES)[number];

export function isDoneRejectCode(v: unknown): v is DoneRejectCode {
  return typeof v === 'string' && (DONE_AUTHORITY_CODES as readonly string[]).includes(v);
}
```

`satisfies readonly MailRejectCode[]` is the load-bearing clause: a typo here is a compile error
against the parent union, which a bare `as const` would not catch.

- [x] **Step 4: Delete the two copies**

`server/src/coord/close.ts:55-56` and `server/src/coord/fingerprint.ts:32-33` — replace each
`Extract<MailRejectCode, 'stale-tip' | …>` with `DoneRejectCode`, importing it from
`../../../shared/api.js`.

- [x] **Step 5: Run the guard and the two consumers**

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/coord-fingerprint.test.ts test/coord-decide.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add shared/api.ts server/src/coord/close.ts server/src/coord/fingerprint.ts server/test/single-definition.test.ts
git commit -m "refactor(coord): the done-authority six get one definition, and two Extract copies go (D-1296)"
```

---

### Task 2: Migration 7 — `runs.briefQueued` and `runs.clearError`

**Files:**
- Modify: `server/src/coord/schema.ts` (append `MIGRATIONS[6]`)
- Test: `server/test/coord-db.test.ts`

**Interfaces:**
- Produces: two nullable columns on `runs`. `COORD_SCHEMA_VERSION` becomes 7 (derived from
  `MIGRATIONS.length`, never hand-written). Task 3 reads them in `RUN_ROW_COLUMNS`; Task 4 writes them.

Today `briefQueued` is computed at `dispatch.ts:642` and never persisted, and `clearError`'s only
durable trace is a `run_events.detail` string on a route nothing serves. The FALSE branch of
`briefQueued` — a resume whose `/clear` was refused, so no brief was ever queued — leaves **nothing at
all**, indistinguishable from "no dispatch happened" (D-1298).

- [x] **Step 1: Write the failing migration tests**

In `server/test/coord-db.test.ts`, following the `:556-578` pattern exactly:

```ts
  it('migration 7 adds briefQueued/clearError, both nullable with no default', () => {
    const p = path.join(mkTmp('ccrc-coorddb-'), '.ccrc', 'coord.db');
    const db = openCoordDb(p);
    const bq = runsColumn(db, 'briefQueued');
    const ce = runsColumn(db, 'clearError');
    expect(bq, 'runs.briefQueued is absent').toBeDefined();
    expect(ce, 'runs.clearError is absent').toBeDefined();
    // Nullable and defaultless BY CONTRACT: null means "an older build wrote this
    // row", which is a different fact from `briefQueued === false` ("this dispatch
    // queued no brief"). A DEFAULT 0 would collapse the two — the overloaded null
    // this wave exists to avoid.
    expect(bq!.notnull, 'briefQueued is NOT NULL — absence now reads as false').toBe(0);
    expect(bq!.dflt_value, 'briefQueued carries a default').toBeNull();
    expect(ce!.notnull).toBe(0);
    expect(ce!.dflt_value).toBeNull();
    db.close();
  });

  it('migration 7 reaches a database ALREADY at user_version 6', () => {
    const p = path.join(mkTmp('ccrc-coorddb-'), '.ccrc', 'coord.db');
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let i = 0; i <= 5; i++) raw.exec(MIGRATIONS[i]!);
      raw.exec('PRAGMA user_version = 6');
    });
    raw.close();
    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(7);
    expect(runsColumn(db, 'briefQueued')).toBeDefined();
    db.close();
  });
```

and update the five existing `user_version` expectations (`:330`, `:376`, `:444`, `:551`, `:573`) plus
`:614-617`'s `expect(COORD_SCHEMA_VERSION).toBe(7); expect(MIGRATIONS.length).toBe(7);`.

- [x] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts`
Expected: FAIL — `runs.briefQueued is absent: expected undefined not to be undefined`.

- [x] **Step 3: Append the migration**

`server/src/coord/schema.ts`, after `MIGRATIONS[5]`:

```ts
  // ── 7: user_version 6 -> 7 ────────────────────────────────────────────────
  // MIGRATIONS[0..5] ARE FROZEN. Two columns recording what a dispatch DECIDED,
  // as opposed to what it did (D-1298).
  //
  // `briefQueued` is `!resumed || clearedAt !== null` at dispatch.ts:642 — the
  // answer to "was a wave-brief actually queued for this run". Its TRUE branch
  // already leaves a durable artefact, the mail row itself; its FALSE branch left
  // nothing, and absence is indistinguishable from "no dispatch happened". A
  // reader could re-derive the formula from `resumed`/`clearedAt`, but that is a
  // re-derivation of a rule, not a record of a decision, and it silently changes
  // meaning the day anything else writes `clearedAt`.
  //
  // `clearError` is the `sendPrompt` refusal code that made it false. It survives
  // today ONLY as `run_events.detail`'s `clear-refused:<code>`, on a table no HTTP
  // route serves, folded through a MUTUALLY EXCLUSIVE ternary (dispatch.ts:592-593)
  // that already drops it whenever `adopted` wins.
  //
  // NULLABLE, NO DEFAULT, both: NULL means "an older build wrote this row, or no
  // dispatch has committed". `briefQueued = 0` means "this dispatch queued no
  // brief". A `DEFAULT 0` would make those one value — the overloaded null the
  // wire discipline forbids at a new seam.
  `
  ALTER TABLE runs ADD COLUMN briefQueued INTEGER;
  ALTER TABLE runs ADD COLUMN clearError  TEXT;
  `,
```

- [x] **Step 4: Run to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts`
Expected: PASS, 30+ tests.

- [x] **Step 5: Commit**

```bash
git add server/src/coord/schema.ts server/test/coord-db.test.ts
git commit -m "feat(coord): migration 7 — a dispatch records whether it queued a brief, and why not (D-1298)"
```

---

### Task 3: The batched health read

**Files:**
- Modify: `shared/api.ts` — `RunHealth`, `RunSummary.health`, three render thresholds
- Modify: `server/src/coord/store.ts` — `runHealth`, `hydrateRun`, `RUN_ROW_COLUMNS`
- Test: `server/test/coord-health.test.ts` (create)

**Interfaces:**
- Consumes: `DONE_AUTHORITY_CODES` (Task 1), the two columns (Task 2).
- Produces: `RunHealth`; `CoordStore.runHealth(runIds: readonly number[], coordIds: readonly string[]): Map<number, RunHealth>`.
  Task 6 renders it; Task 5's route ships it unchanged.

**The cost constraint that shapes this task.** `hydrateRun` already costs two SQL queries per row
(`itemTally`, `unreadMailCount`) and `GET /api/runs?closed=1` returns every open run plus up to 500
closed ones. Four more per-row queries would be ~3,000 statements per board read. The health read is
therefore **four `GROUP BY` queries per `runs()` call, total, regardless of row count** (D-1299).

**The second constraint, and it is not obvious.** `server/test/fleetws.test.ts:637` pins that the WS
`runs` frame is DROPPED from the broadcast when its JSON is unchanged. A health field carrying a
*clock* — an age in ms — would differ on every tick and defeat that dedupe, turning an idle fleet into
a broadcast storm. Every field below is therefore a COUNT, a CODE or a STORED TIMESTAMP; the
thresholds live in the renderer, exactly as `SPAWN_STALL_MS` does (D-1300).

- [x] **Step 1: Write the failing fixtures**

Create `server/test/coord-health.test.ts`. Each case MANUFACTURES the wedge:

```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, MAIL_RUN_CLOSED_ERROR, MAIL_REPLAY_CEILING_ERROR } from '../src/coord/store.js';
import { PROGRAM_KICKOFF_SUBJECT } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-health-'), '.ccrc', 'coord.db')));

const openRun = (s: CoordStore, over: Partial<Parameters<CoordStore['openRun']>[0]> = {}) =>
  s.openRun({ program: 'leverage', title: 'F7', project: 'ccrc-pwa',
              wave: 7, waveOf: 8, claimedBy: 'ccrc-pwa-brisk-meadow', ...over }) as { id: number };

const mailTo = (s: CoordStore, runId: number | null, toId: string, subject = 'wave-brief') => {
  const m = s.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator', toId, runId,
                           kind: 'status', subject, body: 'x', artifacts: [] });
  return s.queueDelivery(m.id, toId, '<env>');
};

const healthOf = (s: CoordStore, runId: number, coordIds: string[] = []) =>
  s.runHealth([runId], coordIds).get(runId)!;

describe('the run health read (F7)', () => {
  it('splits outstanding from parked, and does NOT count the benign run-closed park', () => {
    const s = store();
    const r = openRun(s);
    s.dispatchRun({ runId: r.id, sessionId: 'w', workspace: 'w', branch: 'ws/w',
                    resumed: false, clearedAt: null, items: [] });
    const outstanding = mailTo(s, r.id, 'w');
    const parked = mailTo(s, r.id, 'w');
    const benign = mailTo(s, r.id, 'w');
    s.rejectDelivery(parked.id, 'undeliverable', 'recipient not in registry');
    s.db.prepare("UPDATE mail_deliveries SET state='rejected', rejectCode='undeliverable', lastError=? WHERE id=?")
      .run(MAIL_RUN_CLOSED_ERROR, benign.id);

    const h = healthOf(s, r.id);
    expect(h.mailOutstanding, 'the queued delivery is not counted outstanding').toBe(1);
    expect(h.mailParked, 'the run-closed park was counted as a wedge').toBe(1);
    expect(outstanding.id).toBeGreaterThan(0);
  });

  it('reports the replay high-water — the 722/911 fact that surfaces nowhere', () => {
    const s = store();
    const r = openRun(s);
    s.dispatchRun({ runId: r.id, sessionId: 'w', workspace: 'w', branch: 'ws/w',
                    resumed: false, clearedAt: null, items: [] });
    const a = mailTo(s, r.id, 'w');
    const b = mailTo(s, r.id, 'w');
    s.markDelivered(a.id, 1); s.markDelivered(b.id, 1);
    for (let i = 0; i < 19; i++) s.bumpReplayCount(a.id);
    s.bumpReplayCount(b.id);
    expect(healthOf(s, r.id).mailReplayMax, 'the high-water is not the MAX').toBe(19);
  });

  it('counts done-claim rejections and names the LAST code, newest wins', () => {
    const s = store();
    const r = openRun(s);
    s.recordRejection({ code: 'stale-tip', runId: r.id, toId: 'w', detail: 'a' });
    s.recordRejection({ code: 'pr-regressed', runId: r.id, toId: 'w', detail: 'b' });
    s.recordRejection({ code: 'unknown-sender', runId: r.id, toId: 'w', detail: 'not done-authority' });
    const h = healthOf(s, r.id);
    expect(h.doneRejects, 'an ingress refusal was counted as a done-claim rejection').toBe(2);
    expect(h.lastRejectCode).toBe('pr-regressed');
  });

  it('carries the dispatch decision, and NULL is not false', () => {
    const s = store();
    const never = openRun(s);
    expect(healthOf(s, never.id).briefQueued, 'an undispatched run claims a decision').toBeNull();
    expect(healthOf(s, never.id).clearError).toBeNull();
  });

  it('names when an unacked kickoff to this run’s coordinator was first sent', () => {
    const s = store();
    const r = openRun(s);
    const k = mailTo(s, null, 'ccrc-pwa-brisk-meadow', PROGRAM_KICKOFF_SUBJECT);
    s.db.prepare("UPDATE mail SET fromId='operator' WHERE id=(SELECT mailId FROM mail_deliveries WHERE id=?)").run(k.id);
    s.db.prepare('UPDATE mail SET at=? WHERE id=(SELECT mailId FROM mail_deliveries WHERE id=?)').run(4_000, k.id);
    const h = healthOf(s, r.id, ['ccrc-pwa-brisk-meadow']);
    expect(h.coordKickoffPendingSince, 'the pending kickoff is invisible').toBe(4_000);
  });

  it('an ACKED kickoff is not pending — absence is silence, never a warning', () => {
    const s = store();
    const r = openRun(s);
    const k = mailTo(s, null, 'ccrc-pwa-brisk-meadow', PROGRAM_KICKOFF_SUBJECT);
    s.db.prepare("UPDATE mail SET fromId='operator' WHERE id=(SELECT mailId FROM mail_deliveries WHERE id=?)").run(k.id);
    s.markDelivered(k.id, 10);
    s.markAcked(k.id, 20);
    expect(healthOf(s, r.id, ['ccrc-pwa-brisk-meadow']).coordKickoffPendingSince).toBeNull();
  });

  it('is ONE query set for MANY runs — the board must not pay per row', () => {
    const s = store();
    const ids = [openRun(s).id, openRun(s).id, openRun(s).id];
    const m = s.runHealth(ids, []);
    expect([...m.keys()].sort((a, b) => a - b), 'a run fell out of the batch').toEqual(ids);
    // Every run gets a row, including one with no mail at all: a MISSING key would
    // make the caller choose a default, which is where an overloaded null is born.
    expect(m.get(ids[0]!)!.mailOutstanding).toBe(0);
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-health.test.ts`
Expected: FAIL — `TypeError: s.runHealth is not a function`.

- [x] **Step 3: Add the wire type**

`shared/api.ts`, beside `RunItemTally`:

```ts
/**
 * Per-run health facts the `/runs` board renders as a compact warn row (F7).
 *
 * ADDITIVE; `FLEET_PROTO` is deliberately not bumped. An older server omits the
 * whole object and the PWA renders NOTHING — never "no wedge", which is a claim
 * this build would be making on that server's behalf. One tolerant reader,
 * `runHealth()` in `pwa/src/fleet/runWords.ts`, and no JSX reads a member
 * directly.
 *
 * EVERY MEMBER IS A COUNT, A CODE OR A STORED TIMESTAMP — never an age. The WS
 * `runs` frame is dropped from the broadcast when its JSON is unchanged
 * (`fleetws.test.ts:637`), and a field carrying a clock differs on every tick,
 * which would turn an idle fleet into a broadcast storm. Thresholds live in the
 * renderer, the `SPAWN_STALL_MS` precedent (D-1300).
 */
export interface RunHealth {
  /** Deliveries for this run's mail still `queued` or `delivered`. */
  readonly mailOutstanding: number;
  /** Deliveries PARKED (`rejected`) for a reason that is NOT a deliberate cancel.
   *  A `run closed` or `coordinator reclaimed` park is the machinery working and
   *  is excluded — reporting it would announce a chair that already changed hands. */
  readonly mailParked: number;
  /** MAX(`replayCount`) over this run's deliveries. Mail 120 reached 722 attempts
   *  and mail 129 reached 911, each arriving after the work it was meant to steer;
   *  this is the number that was climbing while nothing showed it. */
  readonly mailReplayMax: number;
  /** How many done-authority refusals this run has collected (`DONE_AUTHORITY_CODES`). */
  readonly doneRejects: number;
  /** The most recent one's code, or null when there are none. FREE-FORM on the
   *  wire in the `lastError` sense — a client may show it, never key a total
   *  `Record` off it, because `mail_rejections.code` is stored unvalidated. */
  readonly lastRejectCode: string | null;
  /** What the last committed dispatch DECIDED about the brief. `null` is a third
   *  condition, not a flavour of false: no dispatch has committed, or the row was
   *  written by a build before migration 7. */
  readonly briefQueued: boolean | null;
  /** The `sendPrompt` refusal that made `briefQueued` false, or null. */
  readonly clearError: string | null;
  /** When the oldest UNACKED `program-kickoff` addressed to this run's `claimedBy`
   *  was first sent, or null when there is none. A TIMESTAMP, not a verdict: the
   *  renderer owns the threshold. */
  readonly coordKickoffPendingSince: number | null;
}
```

then on `RunSummary`, after `unreadMail`:

```ts
  /** F7's health facts. Required here because `hydrateRun` returns a literal and
   *  must compute it; OPTIONAL at every PWA reader, because an older SERVER omits
   *  it. See `RunHealth`. */
  health: RunHealth;
```

and the three render thresholds, beside `SPAWN_STALL_MS`:

```ts
/** A replay count at or above this is climbing toward `MAIL_REPLAY_MAX_ATTEMPTS`
 *  (20, `watch.ts`) and the board says so. A RENDERING threshold: nothing
 *  server-side reads it, and it is not derived from the ceiling — a warning that
 *  fires only at the ceiling arrives with the message already parked. */
export const MAIL_REPLAY_WARN_COUNT = 10;
/** An unacked `program-kickoff` older than this is a coordinator that was never
 *  briefed. A RENDERING threshold, the `SPAWN_STALL_MS` argument. */
export const KICKOFF_UNACKED_MS = 900_000;
```

- [x] **Step 4: Add the batched store read**

`server/src/coord/store.ts`. Add `briefQueued`, `clearError` to `RUN_ROW_COLUMNS` (`:184-189`), and:

```ts
  /**
   * F7: every health fact for a set of runs, in FOUR statements total — not four
   * per row. `hydrateRun` already costs two queries per row and `?closed=1`
   * returns every open run plus up to 500 closed ones, so a per-row read here
   * would be ~3,000 statements for one board load (D-1299).
   *
   * Every id in `runIds` gets a row, including one with no mail: a caller that had
   * to supply a default for a missing key is where an overloaded null is born.
   */
  runHealth(runIds: readonly number[], coordIds: readonly string[]): Map<number, RunHealth> {
    const out = new Map<number, RunHealth>();
    const base = { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
                   lastRejectCode: null as string | null, briefQueued: null as boolean | null,
                   clearError: null as string | null,
                   coordKickoffPendingSince: null as number | null };
    for (const id of runIds) out.set(id, { ...base });
    if (runIds.length === 0) return out;
    const ph = placeholders(runIds.length);

    // 1) outstanding vs parked, and the replay high-water. The exclusion reuses
    //    DELIBERATE_CANCEL_ERRORS_SQL rather than respelling the two literals —
    //    single-definition.test.ts forbids the second copy.
    for (const row of this.db.prepare(
      'SELECT m.runId AS runId, ' +
      `SUM(CASE WHEN d.state IN ${OUTSTANDING_STATES_SQL} THEN 1 ELSE 0 END) AS outstanding, ` +
      "SUM(CASE WHEN d.state = 'rejected' AND " +
      `COALESCE(d.lastError, '') NOT IN ${DELIBERATE_CANCEL_ERRORS_SQL} THEN 1 ELSE 0 END) AS parked, ` +
      'MAX(d.replayCount) AS replayMax ' +
      `FROM mail_deliveries d JOIN mail m ON m.id = d.mailId WHERE m.runId IN (${ph}) GROUP BY m.runId`,
    ).all(...runIds) as { runId: number; outstanding: number; parked: number; replayMax: number | null }[]) {
      const h = out.get(row.runId); if (!h) continue;
      out.set(row.runId, { ...h, mailOutstanding: row.outstanding, mailParked: row.parked,
                           mailReplayMax: row.replayMax ?? 0 });
    }

    // 2) done-claim rejections: how many, and the newest code.
    const codes = placeholders(DONE_AUTHORITY_CODES.length);
    for (const row of this.db.prepare(
      'SELECT runId, count(*) AS c, ' +
      '(SELECT code FROM mail_rejections x WHERE x.runId = r.runId ' +
      `AND x.code IN (${codes}) ORDER BY x.at DESC, x.id DESC LIMIT 1) AS lastCode ` +
      `FROM mail_rejections r WHERE r.runId IN (${ph}) AND r.code IN (${codes}) GROUP BY r.runId`,
    ).all(...DONE_AUTHORITY_CODES, ...runIds, ...DONE_AUTHORITY_CODES)
      as { runId: number; c: number; lastCode: string | null }[]) {
      const h = out.get(row.runId); if (!h) continue;
      out.set(row.runId, { ...h, doneRejects: row.c, lastRejectCode: row.lastCode });
    }

    // 3) the dispatch decision, straight off the run row.
    for (const row of this.db.prepare(
      `SELECT id, briefQueued, clearError FROM runs WHERE id IN (${ph})`,
    ).all(...runIds) as { id: number; briefQueued: number | null; clearError: string | null }[]) {
      const h = out.get(row.id); if (!h) continue;
      out.set(row.id, { ...h, briefQueued: row.briefQueued === null ? null : row.briefQueued === 1,
                        clearError: row.clearError });
    }

    // 4) the un-briefed coordinator: an OUTSTANDING operator kickoff to a
    //    claimedBy. `MIN(COALESCE(ingestedAt, deliveredAt, at))` is dueDeliveries'
    //    own idiom (store.ts:1856-1871) — a replay rewrites deliveredAt and never
    //    touches ingestedAt, so ingestedAt must win where it exists.
    if (coordIds.length > 0) {
      const cph = placeholders(coordIds.length);
      const since = new Map<string, number>();
      for (const row of this.db.prepare(
        'SELECT d.toId AS toId, MIN(COALESCE(d.ingestedAt, d.deliveredAt, m.at)) AS since ' +
        'FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ' +
        `WHERE m.fromId = 'operator' AND m.runId IS NULL AND m.subject = ? AND d.toId IN (${cph}) ` +
        `AND d.state IN ${OUTSTANDING_STATES_SQL} GROUP BY d.toId`,
      ).all(PROGRAM_KICKOFF_SUBJECT, ...coordIds) as { toId: string; since: number }[]) {
        since.set(row.toId, row.since);
      }
      for (const [id, h] of out) {
        const claimed = this.db.prepare('SELECT claimedBy FROM runs WHERE id = ?')
          .get(id) as { claimedBy: string | null } | undefined;
        const at = claimed?.claimedBy == null ? undefined : since.get(claimed.claimedBy);
        if (at !== undefined) out.set(id, { ...h, coordKickoffPendingSince: at });
      }
    }
    return out;
  }
```

Then thread it: `hydrateRun(row: RunRowDb, health: RunHealth): RunRow` gains the parameter and puts
`health` in its literal; `runs()` calls `this.runHealth(rows.map(r => r.id), [...new Set(rows.map(r => r.claimedBy).filter(...))])` once and maps; `run(id)` calls it for the single id;
`reconstruct` passes a zeroed literal.

- [x] **Step 5: Run to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-health.test.ts test/coord-store.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add shared/api.ts server/src/coord/store.ts server/test/coord-health.test.ts
git commit -m "feat(coord): the board learns four health facts, batched (D-1299, D-1300)"
```

---

### Task 4: The dispatch writes its own decision

**Files:**
- Modify: `server/src/coord/dispatch.ts` (the commit at `:571-594`, `briefQueued` at `:642`)
- Modify: `server/src/coord/store.ts` (`dispatchRun` input)
- Test: `server/test/dispatch-skillstate.test.ts` or a new block in `server/test/run-routes.test.ts`

**Interfaces:**
- Consumes: Task 2's columns. Produces: the run row carries the decision after every dispatch.

The ordering problem is real and must not be papered over: `briefQueued` is computed at `:642`, AFTER
the commit at `:571-594`. Moving the commit later would change the transaction's contents; moving the
computation earlier is safe because both its inputs (`resumed`, `clearedAt`) are final by `:544`.

- [x] **Step 1: Write the failing test**

```ts
  it('a resume whose /clear was refused records that it queued NO brief, and why', async () => {
    // The false branch of briefQueued left nothing durable at all — absence,
    // indistinguishable from "no dispatch happened" (D-1298). This is the fixture
    // that manufactures it: a resume whose sendPrompt refuses.
    …drive dispatch with a tmux double whose send refuses 'draft-present'…
    const row = coord.db.prepare('SELECT briefQueued, clearError FROM runs WHERE id = ?').get(runId);
    expect(row, 'the dispatch decision is not durable').toMatchObject({ briefQueued: 0, clearError: 'draft-present' });
    expect(coord.runHealth([runId], []).get(runId)!.briefQueued).toBe(false);
  });
```

- [x] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts -t 'queued NO brief'`
Expected: FAIL — `expected { briefQueued: null, clearError: null } to match object { briefQueued: 0, … }`.

- [x] **Step 3: Implement**

Hoist `const briefQueued = !resumed || clearedAt !== null;` above the commit (it currently sits at
`:642`), pass `briefQueued` and `clearError` into `coord.dispatchRun({...})`, and have
`CoordStore.dispatchRun` write both columns inside its existing transaction. Leave the
`run_events.detail` ternary exactly as it is — this wave does not widen it; see D-1298's note.

- [x] **Step 4: Run to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts test/dispatch-adopt.test.ts test/dispatch-skillstate.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/coord/dispatch.ts server/src/coord/store.ts server/test/run-routes.test.ts
git commit -m "feat(coord): a dispatch that queued no brief now says so durably (D-1298)"
```

---

### Task 5: The route and frame census catch up

**Files:**
- Modify: `server/test/reconstruction-drill.test.ts:277-291` (the `RUN_SUMMARY_KEYS` census)
- Modify: `server/test/run-routes.test.ts` (`describe('GET /api/runs')`)
- Modify: `server/test/fleetws.test.ts:575-660`

No production change: `GET /api/runs` is `runs.map(toRunSummary)` and `toRunSummary` is a strip, so the
field rides both surfaces the moment `hydrateRun` computes it. What this task does is make the census
and the frame's stability EXPLICIT.

- [x] **Step 1: Update the exhaustive census**

`RUN_SUMMARY_KEYS` gains `health: true` and the count moves `20 → 21`. Decide and record `health` in
`UNRECOVERABLE` (`:252-271`): it IS unrecoverable from ledger + registry + `.prhistory`, so the count
moves `14 → 15` with a stated reason.

- [x] **Step 2: Pin the frame's stability — the constraint D-1300 names**
  *(landed in `server/test/coord-health.test.ts`, not `fleetws.test.ts` as this step first said: the
  pin belongs beside the facts whose shape it constrains, and the mutation table names the right suite.)*

```ts
  it('the runs frame is byte-identical across two ticks when nothing changed', async () => {
    // D-1300: RunHealth carries no clock precisely so this stays true. A field
    // holding an age would differ every tick and defeat the broadcast dedupe at
    // fleetws.test.ts:637, turning an idle fleet into a storm.
    const a = JSON.stringify(coord.runs().map(toRunSummary));
    vi.setSystemTime(Date.now() + 600_000);
    const b = JSON.stringify(coord.runs().map(toRunSummary));
    expect(b, 'a health field moved with the clock').toBe(a);
  });
```

- [x] **Step 3: Run**

Run: `cd server && ./node_modules/.bin/vitest run test/reconstruction-drill.test.ts test/fleetws.test.ts test/run-routes.test.ts`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add server/test/reconstruction-drill.test.ts server/test/fleetws.test.ts server/test/run-routes.test.ts
git commit -m "test(coord): the RunSummary census counts health, and the frame stays byte-stable (D-1300)"
```

---

### Task 6: The compact warn row

**Files:**
- Modify: `pwa/src/fleet/runWords.ts` — the tolerant reader and the warn decision
- Modify: `pwa/src/screens/RunsScreen.tsx` — one element inside `body`
- Modify: `pwa/src/fleet/fleet.css` — `.run-row .run-warn`
- Test: `pwa/test/runs-health.test.tsx` (create); update `pwa/test/fleet-css.test.ts:567-579`

- [x] **Step 1: Write the failing tests**

Create `pwa/test/runs-health.test.tsx`, copying `runs-screen.test.tsx`'s `board`/`atFrozenClock`
helpers. The cases: a parked delivery renders a warn with a word AND a glyph; a replay high-water at
`MAIL_REPLAY_WARN_COUNT` renders; `briefQueued:false` renders and names `clearError`; a stale kickoff
past `KICKOFF_UNACKED_MS` renders; **and the older-server case**:

```ts
  it('renders NOTHING when the server omits health — absence is never a verdict', () => {
    const noHealth = { ...r() } as Partial<RunSummary>;
    delete noHealth.health;
    const store = makeStore();
    act(() => { store.setState({ runs: [noHealth as RunSummary], runsFrameSeen: true }); });
    expect(() => render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />))
      .not.toThrow();
    expect(document.querySelector('.run-warn'), 'an older server rendered a health claim').toBeNull();
  });

  it('a healthy run renders no warn row at all', () => { … expect(document.querySelector('.run-warn')).toBeNull(); });
```

- [x] **Step 2: Run to verify they fail**

Run: `cd pwa && ./node_modules/.bin/vitest run test/runs-health.test.tsx`
Expected: FAIL — `expected null not to be null` on the first positive case.

- [x] **Step 3: The decision, in `runWords.ts`, never in JSX**

```ts
export interface RunWarning { readonly glyph: string; readonly word: string; readonly title: string }

/** The tolerant reader. An older SERVER omits `health` entirely; `undefined` is
 *  not "no wedge", so every caller goes through here and gets an empty list. */
export const runWarnings = (
  run: { health?: RunHealth; state: RunState }, nowMs: number,
): readonly RunWarning[] => {
  const h = run.health;
  if (h === undefined) return [];
  const out: RunWarning[] = [];
  if (h.mailParked > 0) out.push({ glyph: '⛒', word: `${h.mailParked} parked`, title: … });
  if (h.mailReplayMax >= MAIL_REPLAY_WARN_COUNT) out.push({ glyph: '↻', word: `replayed ${h.mailReplayMax}×`, title: … });
  if (h.briefQueued === false) out.push({ glyph: '⌦', word: 'no brief queued', title: h.clearError ?? … });
  if (h.doneRejects > 0) out.push({ glyph: '⊘', word: `${h.doneRejects} rejected`, title: … });
  if (h.coordKickoffPendingSince !== null
      && nowMs - h.coordKickoffPendingSince >= KICKOFF_UNACKED_MS) out.push({ … });
  return out;
};
```

`h.briefQueued === false`, never `!h.briefQueued` — `null` (older row / no dispatch) must render
nothing. `h.coordKickoffPendingSince !== null` before the arithmetic, the `MailStrip.tsx:176`
negated-comparison idiom, so an absent numeric fails the test rather than passing it.

- [x] **Step 4: The markup, and the CSS**

Inside `body` in `RunsScreen.tsx`, after the `degradedFields` block, one wrapped line:

```jsx
      {warnings.length > 0 && (
        <span className="run-warn" data-count={String(warnings.length)}>
          {warnings.map((w) => (
            <span key={w.word} className="run-warn-item" title={w.title}>
              <span className="run-warn-glyph" aria-hidden="true">{w.glyph}</span>{' '}{w.word}
            </span>
          ))}
        </span>
      )}
```

`fleet.css`, scoped under `.run-row` so `design/audit.mjs` sees it grounded, `flex-basis: 100%` so it
owns its own wrapped line inside the existing `flex-wrap: wrap` row, an already-declared ink, and **no
`--glow`, no `animation`, no `box-shadow`** — add `.run-row .run-warn` to `fleet-css.test.ts:572`'s
"runs are not living panes" list.

- [x] **Step 5: Run**

Run: `cd pwa && ./node_modules/.bin/vitest run test/runs-health.test.tsx test/fleet-css.test.ts test/contrast.test.ts test/tap-targets.test.tsx`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add pwa/src/fleet/runWords.ts pwa/src/screens/RunsScreen.tsx pwa/src/fleet/fleet.css pwa/test/
git commit -m "feat(pwa): a compact warn row per run, and an older server renders nothing"
```

---

### Task 7: The cross-tree ledger guard — the L1 decision

**Files:**
- Modify: `server/src/coord/ledger.ts` — `definitionsIn`, `crossTreeCollisions`
- Test: `server/test/ledger-crosstree.test.ts` (create)

**Interfaces:**
- Produces: `definitionsIn(files): Definition[]` and
  `crossTreeCollisions(branch, base, era): Collision[]`. Task 8 feeds them real git blobs.

**Why this shape closes the hole the existing scan cannot.** `deviation-refs.test.ts`'s collision scan
reads ONE checkout (`readdirSync(PLANS)` + `readFileSync`), so two branches each holding one of the two
definitions are BOTH green, and the pair only co-resides after the loser merges — one merge too late.
Three properties fix it, and each was measured (D-1294, D-1295):

1. **Cross-tree.** Compare the working tree's definitions against `origin/main`'s, without merging.
2. **Subject-free, for allocator-era numbers only.** The allocator issues each `n` once for one
   purpose, so two DEFINING files is a defect regardless of wording. Today's scan requires two distinct
   SUBJECTS as well, which is what the pre-allocator grandfathering needs — so the new arm is scoped to
   `n >= 211` and `GRANDFATHERED` is untouched, its "may only shrink" invariant intact.
3. **Prefix-only recognition.** `ENTRY`'s `[^—\n]*—\s*(.+)$` requires the subject on the SAME line, and
   **29 real definitions in today's plans are invisible to it**, including allocator-era D-1026 and
   **D-1158 — one of the five numbers this program lost.** The new arm uses the looser `DEFINED` shape
   the floor assertion already trusts.

- [x] **Step 1: Write the failing unit tests**

Create `server/test/ledger-crosstree.test.ts` with FIXTURES, not the real tree:

```ts
const f = (path: string, text: string) => ({ path, text });

describe('crossTreeCollisions (F7 — one merge earlier)', () => {
  it('fires when the branch and the base define one allocator-era number in different plans', () => {
    const hits = crossTreeCollisions(
      [f('a.md', '- **D-1157** — my subject')], [f('b.md', '- **D-1157** — their subject')], 211);
    expect(hits.map((h) => h.n)).toEqual([1157]);
    expect(hits[0]!.files).toEqual(['a.md', 'b.md']);
  });

  it('does NOT fire on the same file in both trees — that is one definition, not two', () => {
    expect(crossTreeCollisions([f('a.md', '- **D-1157** — s')], [f('a.md', '- **D-1157** — s')], 211)).toEqual([]);
  });

  it('is SUBJECT-FREE: identical wording in two files is still two definitions', () => {
    // The existing scan requires two distinct subjects and would return []. An
    // allocator-era number is issued once, for one purpose — two defining files is
    // the defect whatever they say.
    expect(crossTreeCollisions([f('a.md', '- **D-900** — same')], [f('b.md', '- **D-900** — same')], 211))
      .toHaveLength(1);
  });

  it('leaves the pre-allocator era alone — GRANDFATHERED must not have to grow', () => {
    expect(crossTreeCollisions([f('a.md', '- **D-72** — x')], [f('b.md', '- **D-72** — y')], 211)).toEqual([]);
  });

  it('sees the colon form and the WRAPPED form ENTRY is blind to (D-1294)', () => {
    // Exactly PR #38's spelling of D-1158: an em-dash at end of line, subject on
    // the next. ENTRY's `—\s*(.+)$` cannot match it, which is why that half of the
    // first incident was undetectable even in a merged tree.
    const wrapped = f('a.md', '- **D-1158** (2026-08-31, found by running the suite) —\n  the subject');
    const colon   = f('b.md', '- **D-1158** (Task 3): a different finding');
    expect(crossTreeCollisions([wrapped], [colon], 211).map((h) => h.n)).toEqual([1158]);
  });

  it('ignores a dotted SUB-entry, which cites its parent rather than defining it', () => {
    expect(crossTreeCollisions([f('a.md', '- **D-310.1** — finding')], [f('b.md', '- **D-310** — parent')], 211))
      .toEqual([]);
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ledger-crosstree.test.ts`
Expected: FAIL — `SyntaxError: The requested module '../src/coord/ledger.js' does not provide an export named 'crossTreeCollisions'`.

- [x] **Step 3: Implement, in `ledger.ts` (L1, still pure)**

```ts
/** The first allocator-era number. Below it the pre-allocator era legitimately
 *  reused numbers, and `deviation-refs.test.ts`'s GRANDFATHERED set — which may
 *  only SHRINK — is what carries that history. Scoping the cross-tree arm here
 *  keeps that invariant intact. */
export const LEDGER_ALLOCATOR_ERA = 211;

/** Definition-SHAPED, prefix only — deliberately looser than deviation-refs'
 *  ENTRY, which demands the subject on the same line and is therefore blind to
 *  the colon form (`- **D-211** (Task 3): …`) and to a subject wrapped onto the
 *  next line. 29 real definitions in today's plans sit in that blind spot,
 *  D-1158 among them (D-1294). A dotted sub-entry cites its parent and is
 *  excluded by the lookahead, exactly as ENTRY excludes it. */
const DEFINITION = /^(?:#{2,4} |- \*\*)D-(\d+)\b(?!\.\d)/;

export interface Definition { readonly file: string; readonly n: number }
export interface CrossTreeCollision { readonly n: number; readonly files: readonly string[] }

export function definitionsIn(
  files: readonly { readonly path: string; readonly text: string }[],
): Definition[] { … }

/**
 * Numbers at or above `era` DEFINED in more than one plan file across the two
 * trees. Subject-free by construction: the allocator issues each number once,
 * for one purpose, so a second defining file is the defect however it is worded.
 *
 * Pure, and both trees arrive as data — the git reading belongs to the caller.
 */
export function crossTreeCollisions(
  branch: readonly { readonly path: string; readonly text: string }[],
  base:   readonly { readonly path: string; readonly text: string }[],
  era: number = LEDGER_ALLOCATOR_ERA,
): CrossTreeCollision[] { … }
```

- [x] **Step 4: Run to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ledger-crosstree.test.ts test/ledger.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/coord/ledger.ts server/test/ledger-crosstree.test.ts
git commit -m "feat(ledger): a cross-tree, subject-free collision decision for allocator-era numbers (D-1294, D-1295)"
```

---

### Task 8: The cross-tree arm over the real two trees

**Files:**
- Modify: `server/test/deviation-refs.test.ts`
- Modify: `CONTRIBUTING.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: Task 7's `crossTreeCollisions`, and `topology-clean.test.ts:137-148`'s `resolveBase`
  pattern — the shipped, working way to read another ref's content from inside a vitest file.

**Measured, before writing a line** (`scratchpad/union.py`, re-runnable):

| branch | base | hits |
|---|---|---|
| `eee5fa1a` (wave 6, pre-renumber) | `47ac50da` (main after PR #41) | **3** — D-1159, D-1160, D-1161 |
| `d620abe8` (wave 6, pre-renumber) | `d3de4ec7` (main after PR #38) | **2** — D-1157 **and D-1158** |
| `HEAD` | `origin/main` | **0** |

Both incidents, from the branch alone, without merging, in ~380 ms. The existing scan finds neither
until after the merge, and can never find D-1158 at all.

- [x] **Step 1: Write the failing arm**

```ts
describe('the cross-tree collision scan (F7 — before the merge, not after)', () => {
  const base = resolveBase(ROOT);   // CCRC_LEDGER_BASE, then origin/main, then main

  const plansAt = (ref: string): { path: string; text: string }[] => { … git ls-tree + cat-file --batch … };

  it('resolves a base at all — a missing one is RED, never a quiet pass', () => {
    // topology-clean.test.ts:509's rule. A scan with no base measures nothing and
    // would report green forever; CI's fetch-depth: 0 is what pays for this.
    expect(base, 'no origin/main to compare against — fetch it, do not disarm this').not.toBeNull();
  });

  it('the scan is looking at two real trees', () => {
    expect(plansAt('HEAD').length).toBeGreaterThanOrEqual(50);
    expect(plansAt(base!).length).toBeGreaterThanOrEqual(50);
    expect(definitionsIn(plansAt('HEAD')).length).toBeGreaterThanOrEqual(300);
  });

  it('no allocator-era D-<n> is defined in two plans across this branch and its base', () => {
    expect(crossTreeCollisions(plansAt('HEAD'), plansAt(base!)).map((c) => `D-${c.n}: ${c.files.join(' / ')}`),
      'this branch defines a number origin/main already defines elsewhere — allocate a fresh one ' +
      'and renumber NOW, before the merge decides it for you').toEqual([]);
  });
});
```

- [x] **Step 2: Run to verify the anti-vacuity guards bite**

Run with a deliberately absent base: `cd server && CCRC_LEDGER_BASE=nope git -C .. update-ref -d refs/remotes/origin/main` is
NOT the way — instead assert the arm by pointing it at a known-colliding pair:
`cd server && CCRC_LEDGER_BASE=47ac50da ./node_modules/.bin/vitest run test/deviation-refs.test.ts`
against a checkout at `eee5fa1a`. Expected: FAIL, naming D-1159/1160/1161. **Record the verbatim
first-fail in the mutation table.**

- [x] **Step 3: Document the step it replaces**

`CONTRIBUTING.md:66-69` today says *"check `main` first — two branches allocating in parallel has
caused a renumber before"* with no mechanism. Replace the parenthetical with the command that now
performs it, and add the same one line to `CLAUDE.md`'s deviation-ledger bullet. State plainly what it
does and does not see: it compares against whatever `origin/main` your checkout has fetched, so a stale
remote-tracking ref measures a stale base — `git fetch origin main` first.

- [x] **Step 4: Run the whole file**

Run: `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts`
Expected: PASS, 12 tests.

- [x] **Step 5: Commit**

```bash
git add server/test/deviation-refs.test.ts CONTRIBUTING.md CLAUDE.md
git commit -m "feat(ledger): the collision scan reads origin/main too, so it fires before the merge (D-1295)"
```

---

### Task 9: The allocator's own half — what `landedIn` already knew

> **REWRITTEN AFTER THE FACT (D-1311).** This task originally specified `auditAllocations`,
> `GET /api/ledger` gaining a `mismatches` field, and an arm in `ledger-routes.test.ts`. **None of that
> shipped**, and the steps below describe what actually did. The original text stood ticked for one
> commit, which is how a task nobody performed came to read as done; it is corrected here rather than
> quietly left, because a coordinator re-measures a wave against its own plan.

**Files:**
- Modify: `server/src/coord/ledger.ts` — `unallocatedDefinitions`, `projectEra`
- Modify: `server/src/coord/store.ts` — `ledgerProjects()`, `ledgerIssued(project)`
- Modify: `server/src/watch.ts` — `sweepLedgerReconcile` reports the inverse
- Test: `server/test/ledger-crosstree.test.ts` (unit), `server/test/ledger-sweep.test.ts` (the sweep)

**Why not the route.** The obvious home was `GET /api/ledger`, and it is the wrong one. That route is
a synchronous read over `ledger_alloc` alone; the audit needs the project's PLANS, which means an async
`readLedgerDocs` on every GET — a new failure mode and new latency on a route whose whole job is to
answer instantly. `sweepLedgerReconcile` already reads exactly those files every fifteen minutes, and
already owns the report-once-per-changing-set channel the stale-allocation warning uses. The audit is
the INVERSE of the `markLanded` that sweep performs, so it belongs in the same pass over the same bytes.
The cost is that the finding lands in the server's log rather than on the phone — stated, not hidden.

**The measurement this task exists for.** `ledger_alloc` rows 1157–1161 all read
`allocatedTo: 'ccrc-pwa-quiet-meadow'` with this program's own block title, while `landedIn` names four
other lanes' plan files. `sweepLedgerReconcile` wrote every one of those and surfaced nothing: it marks
a number landed on ANY `\bD-<n>\b` occurrence in any plan and never asks whose file it landed in
(`watch.ts`). **The allocator recorded the theft and said nothing** (D-1297).

**What is reported, and what is deliberately not.** Reported: an allocator-era number a plan DEFINES
with no allocation row — unambiguous, because nobody asked for it. Live instance on `main` while this
was written: D-1066..1069. NOT reported, each rejected by measurement:
- *"allocated to its definer"*, the question as posed — it cannot be built. 101 of 243 allocator-era
  rows carry `allocatedTo: ''`, because `byId` is optional and the coordinator's own documented call
  omits it (D-1301).
- *batch scatter* — across 65 batches exactly two are scattered, and one of them (D-999..D-1046) is a
  program block spent correctly across its own waves. Structurally identical to the theft, so scatter
  is an observation and never a defect.

- [x] **Step 1: `unallocatedDefinitions` + `projectEra` as L1, with fixtures** — including the
  per-project era derivation that replaced a hardcoded `LEDGER_ALLOCATOR_ERA`/`LEDGER_BOOTSTRAP` pair
  (D-1313), and the boundary on both sides of a project's own first issued number.

- [x] **Step 2: two store reads** — `ledgerProjects()` and `ledgerIssued(project)`.

- [x] **Step 3: the sweep reports it**, through `lastOrphanReport`, the same once-per-changing-set
  channel the stale warning uses. The project list widens from OPEN allocations to every project with
  any — stated as a behaviour change, because a project whose numbers have all landed has no open rows
  and was never audited, which is the state a project reaches once it is working.

- [x] **Step 4: tests that manufacture the wedge** — an orphan is named; a healthy ledger is silent; a
  fully-landed project is still audited; an unchanged orphan set is reported once and a changed one
  speaks again (the last added in review, D-1312, after the dedupe measured green).

- [x] **Step 5: commit** — `feat(ledger): the sweep measures the inverse of markLanded, and reports it
  (D-1297, D-1301, D-1306)`, plus the review round's follow-ups.

### Task 10: The fold-ins

**Files:** `server/src/coord/store.ts`, `server/src/coord/routes.ts`, `shared/api.ts`,
`server/src/auth/gate.ts`, `server/test/auth-gate.test.ts`, `server/test/coord-caps-route.test.ts`

- [x] **Step 1: D-1169 — the clock leaves the store, and the dial can show it**

`setCaps(next: CoordCaps, at: number = Date.now())` — the `markDispatched`/`recordRunEvent`/`capsUsage`
convention it is the odd one out against. The clock read must stay INSIDE `coordMutex.run(...)`
(`dispatch-mutex-gate.test.ts:73`'s `TARGETS` includes `coord.setCaps`). Then widen `caps()`'s SELECT
and carry `updatedAt` on **`CoordCapsView`**, not on `CoordCaps` — the view is the read-side shape and
widening it is not a change to the shipped caps type. That answers BOTH halves of D-1169 rather than
half of it. **`caps.ts` is not edited, so no purity assertion moves** — record that measurement.

- [x] **Step 2: Two of the five cardinals become derivations**

`auth-gate.test.ts:207` — `expect(ROUTES.filter((r) => !isWs(r)).length).toBe(ROUTES.length - WS_ROUTES.length);`
keeping the `> 50` floor, because the identity survives `ROUTES` collapsing.
`auth-gate.test.ts:495` — collapse into `:496`'s relation, and upgrade `EXEMPT.size - 1` to the
strictly stronger set assertion:
`expect([...EXEMPT.keys()].filter((k) => !ROUTES.map(key).includes(k))).toEqual(['GET /*']);`
Leave **46 and 25 alone**: nothing in the tree attributes a live route to the file that registered it
(`registerCoordRoutes` is called on the root instance with no prefix), so every in-file "derivation" is
circular. Record that as the reason, not as an omission.

- [x] **Step 3: Three stale cardinals no scanner reads (D-1302)**

`gate.ts:8` says *"all 55 routes"*; the tree derives **68**. `auth-gate.test.ts:365-369`'s breakdown
enumerates 24 while `EXEMPT.size` is 25. `auth-gate.test.ts:472-473` says *"69 − 3 − 24 = 42"* nine
lines above the assertion that says 44. Correct all three, and extend D-1223's digit scan to cover
`gate.ts`'s numeral — the census reads number WORDS and D-1223's digit scan reads `auth-gate.test.ts`
only, which is exactly why all three survived.

- [x] **Step 4: D-1224, recorded not mechanised**

The case to watch is a single-session program — a run whose `claimedBy` is also its `sessionId`. It does
not exist today. Task 3's board makes it OBSERVABLE for the first time: such a run shows
`coordKickoffPendingSince` against itself. Record that, and say plainly that no fixture manufactures it
because no such program exists to measure.

- [x] **Step 5: Run and commit**

Run: `cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts test/box-token-census.test.ts test/coord-caps-route.test.ts test/coord-caps-policy.test.ts test/dispatch-mutex-gate.test.ts`

```bash
git commit -m "fix(fold-ins): D-1169's clock, two derived cardinals, three stale ones (D-1302, D-1303)"
```

---

---

## Execution record

**Branch:** `ws/quiet-meadow` (this workspace's own — never a feature branch, clause 2).
**Base:** `origin/main` at `6ee36ca5` (wave 6's merge), merged in before the first commit.
**Scope, re-measured against `origin/main` after every task:** `ccd/`, `session-hook.sh`, `deploy/` and
`agent/` are EMPTY in the diff. Server + PWA + root docs only, as the brief requires — nothing in this
wave changes the coordinator's deploy lane.

**Suites, foreground, full runs:**

| package | before (2026-09-02 05:07 UTC) | after |
|---|---|---|
| server | 248 files, 6248 passed, 56 skipped | **250 files, 6295 passed, 56 skipped** |
| agent | (unchanged lane) | **18 files, 281 passed** |
| pwa | 2106 passed (78 files, derived: 2119 less this wave's 13 new cases) | **2119 passed** + `npm run build` produces `server/dist-pwa/index.html` |

`tsc --noEmit` clean in all three packages. Two new server suites (`coord-health`, `ledger-crosstree`)
and one new PWA suite (`runs-health`). No test was deleted or skipped.

**Migration:** `COORD_SCHEMA_VERSION` 6 → 7, derived from `MIGRATIONS.length` as always. Additive-only:
two nullable, defaultless columns on `runs`. The five reached-version pins and the frozen-ladder guards
moved with it.

**Wire:** `FLEET_PROTO` unchanged at 1. Three additive fields (`RunSummary.health`,
`CoordCapsView.updatedAt`, and the two new `RunHealth`-adjacent constants), each with a single reader.
No new `ccd` verb; `EXEC_COMMANDS` untouched. No new route — `GET /api/runs` and `GET /api/coord/caps`
carry the new data on their existing shapes, so the box-token census and the ungated-door count are
both unmoved.

**Deviations:** D-1293..D-1307, allocated from `POST /api/ledger/deviations` with `byId` set, in four
acts (12 + 1 + 1 + 1), each immediately before the entry defining it. Verified at close: every allocated
number is defined, and no number is defined that was not allocated to this session.

## Deviations found

This wave's numbers are **D-1293..D-1305**, allocated from `POST /api/ledger/deviations` with `byId`
set, in two acts (12 + 1), each immediately before the entry that defines it. **The floor was read from
the allocator, not from a document, and the two disagreed** — see D-1293. Every number cited anywhere
in this plan or in the diff is defined below.

- **D-1293** (2026-09-02, brief premise corrected by measurement) — **the brief's floor was 1243; the
  allocator's was 1292.** The brief said "floor **1243** — and READ the floor from the allocator, never
  from a document". Read: `GET /api/ledger?project=ccrc-pwa` answered `floor: 1292`, and there were
  **zero** allocation rows at or above 1243. 1243 is `max(defined) + 1`; the allocator's floor is
  `max(defined) + LEDGER_SEED_GAP` (50, `shared/api.ts:5443`), i.e. 1242 + 50. A worker who had trusted
  the brief would have defined D-1243, forty-nine numbers below the floor — which
  `deviation-refs.test.ts`'s floor assertion cannot catch, because it only rejects refs ABOVE the
  high-water. The instruction was right and the number in the same sentence was wrong; the instruction
  is what saved it.

- **D-1294** (2026-09-02, pre-existing defect, measured) — **`ENTRY` cannot see a definition whose
  subject is not on its own line, and one of the five lost numbers sits in that blind spot.**
  `deviation-refs.test.ts:45`'s `ENTRY = /^(?:#{2,4} |- \*\*)D-(\d+)\b(?!\.\d)[^—\n]*—\s*(.+)$/`
  requires a non-empty subject after an em-dash on the SAME line. PR #38 spelled its entry
  `- **D-1158** (2026-08-31, found by running the full suite for D-1157) —` with the subject wrapped to
  the next line, so `collisions()` never saw it. Measured across the scanned plans, and stated as the DELTA
  rather than as two totals, because the totals move every time any plan gains an entry — including
  this one, whose own thirteen entries moved them from 386/350 to 400/364 between the measurement and
  the commit: the looser prefix shape sees **36 definition-shaped lines `ENTRY` cannot**, 7 of them
  deliberate `D-N.M` sub-entries and **29 real definitions**, carrying
  73, 139–144, 149, 172, 189–195, 200–207, **1026** and **1158**. So even in a fully merged tree, half
  of the first incident was undetectable. Fixed for allocator-era numbers only, by Task 7's
  prefix-only `DEFINITION`; the pre-allocator half is left to `GRANDFATHERED`, whose "may only SHRINK"
  rule a widened subject scan would have forced us to break (measured: widening the subject extraction
  surfaces six sub-211 collisions — D-73/142/143/144/149/172 — every one of which would have had to
  join that set).

- **D-1295** (2026-09-02, the mechanism this wave was asked for) — **the collision scan reads one tree,
  and the fix is to read two, not to document a merge.** The brief offered "make the pre-merge
  measurement cheap and make it a documented step, or find something better". Something better exists
  and the repo already ships the pattern: `topology-clean.test.ts:137-148`'s `resolveBase` reads
  another ref's blobs from inside a vitest file and is written to go RED on a missing base. Measured
  before implementing (`scratchpad/union.py`): comparing a branch's plan definitions against
  `origin/main`'s, subject-free, for `n >= 211`, finds **D-1159/1160/1161** on `eee5fa1a` vs
  `47ac50da` and **D-1157 AND D-1158** on `d620abe8` vs `d3de4ec7` — both incidents, from the branch
  alone, no merge, ~380 ms — and **0** on `HEAD` vs `origin/main` today. Reading all 67 plans out of
  `origin/main` costs 94 ms. A documented manual step would have been strictly worse: it runs when
  someone remembers, and this one runs on every suite invocation.

- **D-1296** (2026-09-02, single-definition) — the done-authority six were spelled three times
  (`MAIL_REJECT_CODES`, and an identical `Extract<MailRejectCode, …>` in both `close.ts:55-56` and
  `fingerprint.ts:32-33`). Task 3 needs them at runtime for a SQL `IN (…)`, which would have been a
  fourth. Replaced by one `DONE_AUTHORITY_CODES` with `satisfies readonly MailRejectCode[]`, both
  `Extract` copies deleted, and a scanner that keeps it at one.

- **D-1297** (2026-09-02, live measurement) — **the allocator recorded the theft and said nothing.**
  `ledger_alloc` rows 1157–1161 all carry `allocatedTo: 'ccrc-pwa-quiet-meadow'` and this program's own
  block title, while their `landedIn` names FOUR different plan files — `2026-08-31-d1157-…` (which
  took both 1157 and 1158), `2026-08-31-d1159-…`, `2026-08-31-d1160-…` and `2026-09-01-d1161-…`, all
  four of them OTHER LANES'. (Five files, one of them this program's own wave-6 plan, is true of the
  wider 1157–1172 block; the first draft of this sentence said five and "three of them other lanes'",
  and both cardinals were wrong — corrected as D-1314.)
  The cause is `watch.ts:2102-2104`: reconcile marks a number landed on ANY `\bD-<n>\b` occurrence, in
  any plan, and never compares the file to the holder. So the ledger positively asserts the wrong thing
  rather than staying silent, and the fact that a block landed scattered across five lanes' files was
  sitting in the database the whole time. Surfaced by Task 9, not enforced: an allocation is a record
  that you asked.

- **D-1298** (2026-09-02, spec item made durable) — **`briefQueued: false` left no trace at all.**
  `briefQueued` is computed at `dispatch.ts:642` and never persisted; `clearError`'s only durable trace
  is `run_events.detail`'s `clear-refused:<code>`, on a table no HTTP route serves, written through a
  MUTUALLY EXCLUSIVE ternary (`dispatch.ts:592-593`) that drops it whenever `adopted` wins. The TRUE
  branch leaves the brief mail row as evidence; the FALSE branch leaves absence, indistinguishable
  from "no dispatch happened". Two nullable columns (migration 7) record the decision itself. NULL is a
  third condition and is kept distinct from `false` by a defaultless column — a `DEFAULT 0` would have
  been the overloaded null this wave's own wire rule forbids.

- **D-1299** (2026-09-02, design constraint found by measurement) — **health facts must be batched or
  the board pays ~3,000 queries.** `hydrateRun` already costs two SQL statements per row (`itemTally`,
  `unreadMailCount`) and `runs({includeClosed:true})` returns every open run plus up to 500 closed ones
  with no cap on the open arm (`store.ts:1185-1189`, deliberately). Four naive per-row health reads
  would be six statements per row. `runHealth` is therefore four `GROUP BY` statements per `runs()`
  call regardless of row count, and `hydrateRun` takes the answer as a parameter.

- **D-1300** (2026-09-02, design constraint, and it is not obvious) — **no health field may carry a
  clock.** `fleetws.test.ts:637` pins that the WS `runs` frame is dropped from the broadcast when its
  JSON is unchanged. A field holding an age in milliseconds differs on every tick, so it would defeat
  that dedupe and turn an idle fleet into a broadcast storm — a performance regression shaped exactly
  like a feature. Every `RunHealth` member is a count, a code or a STORED timestamp, and the two
  thresholds (`MAIL_REPLAY_WARN_COUNT`, `KICKOFF_UNACKED_MS`) are rendering constants the PWA applies,
  the `SPAWN_STALL_MS` precedent. Pinned by a two-tick byte-equality test in Task 5.

- **D-1301** (2026-09-02, why hole (a) could not be closed as literally stated) — **`allocatedTo`
  defaults to the empty string, and the documented coordinator call omits it.**
  `routes.ts:2124` binds `allocatedTo: byId ?? ''`; `byId` is optional, unvalidated beyond
  `typeof === 'string'`, and carries no uuid — unlike `POST /api/claims`, which runs the mail-ingress
  attribution gate. The canonical allocation, the program's whole block at run-open, is documented in
  `ccd/coordinator-skill/references/peer-protocol.md:126-129` **without `byId`**, so it lands with
  `allocatedTo = ''` and there is nothing to compare a definer against. `runId` is hardcoded `null` at
  the same call, so a program-level fallback identity does not exist either. Making `byId` required
  would be a breaking change to a route whose documented caller lives in the skill corpus — out of this
  wave's lane, and it would need the coordinator's ruling. This wave therefore reports `allocatedTo:
  ''` as **unattributable** rather than as clean, and every allocation it makes itself passes `byId`.

- **D-1302** (2026-09-02, three stale cardinals no scanner reads) — `server/src/auth/gate.ts:8` claims
  the gate stands in front of *"all 55 routes"*; the tree derives **68** HTTP routes. This is the
  identical sentence D-1223's own docstring names as the defect — the three copies inside
  `auth-gate.test.ts` were fixed and the copy in `gate.ts` was not, because
  `box-token-census.test.ts` reads number WORDS and this is a numeral, while D-1223's digit scan reads
  `auth-gate.test.ts` only. Two more in the test file itself: `:365-369`'s breakdown enumerates 24
  while the `toEqual` three lines below it lists 25 `EXEMPT` keys (the tail omits
  `GET /api/runs/:id/items`), and `:472-473` computes *"69 − 3 − 24 = 42"* nine lines above the
  assertion that says **44**. All three corrected, and the digit scan extended to `gate.ts`.

- **D-1303** (2026-09-02, D-1169 ruled and closed BOTH halves) — the fix is
  `setCaps(next, at = Date.now())`, matching `markDispatched`/`recordRunEvent`/`capsUsage`, which
  `setCaps` was the lone exception to in its own neighbourhood; the clock read stays inside
  `coordMutex.run` because `dispatch-mutex-gate.test.ts:73`'s `TARGETS` names `coord.setCaps`. The read
  half goes on **`CoordCapsView`**, the read-side shape, not on `CoordCaps`, which is what wave 6
  declined to widen. Both halves as D-1169 itself states them — "the column already exists and only the
  read is missing", and `setCaps` reading its own clock — are closed. No client renders it yet;
  D-1169's dial sentence is that deviation's motivation, not a deliverable it claims, and the review
  finding that said otherwise was refuted in verification (see D-1315). **`caps.ts` is not edited and no purity
  assertion moves**; the `coord-caps-policy.test.ts:143-148` red the fix was feared to cause was for a
  DEFAULTED clock parameter inside `decideCaps`, which this does not add. Recorded either way, as the
  brief asked, and closed rather than deferred.

- **D-1304** (2026-09-02, D-1224 recorded, not mechanised) — the case to watch is a single-session
  program, a run whose `claimedBy` equals its `sessionId`. No such program exists today, so no fixture
  can manufacture it honestly. What changed is that it becomes OBSERVABLE for the first time: such a
  run renders `coordKickoffPendingSince` measured against itself, which is visible on the board and was
  visible nowhere before. Reported as an observation the board now supports, not as a guard.

- **D-1305** (2026-09-02, found by following the brief's own instruction) — **`GET /api/ledger`
  advertises a floor `POST` will not issue.** The GET computes `Math.max(floorRow.floor, maxN + 1)`
  over `ledger_alloc` alone (`routes.ts:2221`); `allocateDeviations` computes
  `Math.max(floor, maxIssued + 1)` where `maxIssued` is `MAX(db, ~/.ccrc/ledger-alloc.log)`
  (`store.ts:3025-3035`). Measured this session: GET said **1292**; `POST` issued **1293..1304**; there
  is no `ledger_alloc` row for 1292. So the log holds 1292 with no committed row — the file-first
  design working exactly as specified ("a number is skipped, NEVER reissued") — and the read surface
  cannot see it. The consequence is hole (a)'s own family: a caller who reads the floor from `GET` and
  hand-writes `D-<floor>` into a plan defines a number the allocator will never issue to anyone, and
  `deviation-refs.test.ts`'s floor assertion then reds on it with a message about fixtures. Reported
  with its measurement; the honest fix is for the GET to consult the same three sources the POST does,
  which is a change to the allocator's read path and is named here rather than smuggled into this wave.

- **D-1306** (2026-09-02, a mutation row that came back GREEN, and what it caught) — the brief's own
  warning, fired on this wave's own work. `unallocatedDefinitions`'s bootstrap-grandfather test was
  written passing a LOCAL `new Set([211, 212, 213])`, so emptying the SHIPPED `LEDGER_BOOTSTRAP`
  changed nothing and the mutation measured **green** — a guard whose constant nothing held. It is
  precisely this program's recurring class, *a pin whose premise is never established*, and it was
  invisible until the row was actually run: the test read correctly, named the right constant in its
  own title, and asserted nothing about it. Closed by asserting the shipped set's exact content
  (`211..224`, with its may-only-shrink rule stated) and by feeding that same constant to both arms,
  including the `225` boundary on the other side. Re-measured: emptying it now reds with `the bootstrap
  set is not 211..224 — it may only SHRINK, never move: expected [] to deeply equal [ 211, 212, 213,
  214, 215, 216, …(8) ]`. **Recorded because the row is the mechanism** — had the table been written
  at the end from memory rather than measured as each guard landed, this would have shipped as a
  green row describing a guard that did not exist, which is exactly what wave 6's review round was
  sent back for.

- **D-1307** (2026-09-02, a spec clause dropped between two paragraphs of this plan) — spec §9 states
  the un-briefed-coordinator condition as **three** clauses: *"open run, `dispatchedAt` null, kickoff
  delivery unacked past a threshold"*. This plan's Architecture paragraph copied all three; Task 3's
  field description — the one an implementer actually works from — described only the kickoff, and the
  first implementation of `runWarnings` matched the field description. The result fired "never briefed"
  on a run that had **already dispatched**, i.e. on a coordinator that demonstrably got the wave moving,
  which is odd rather than wedged. That is the false-positive direction, and on a warning surface it is
  the worse one: a row that cries wolf is a row an operator stops reading, which would have undone the
  whole point of the wave. Caught by re-reading §9 against the shipped code rather than against the
  plan, closed by requiring `dispatchedAt === null`, and pinned in both directions (a dispatched run
  draws nothing; the mutation that drops the clause reds). **The lesson is about plans, not about this
  bug**: a condition restated in two places in one document will be implemented from the nearer one, so
  the clause belongs in the field's own docstring — where it now is.

## Deviations found — the wave's own review round

Before claiming the wave done, the whole branch was reviewed adversarially: nine lenses, each told to
prefer fewer and harder findings, then a refute-default verification pass. The lenses ran mutations in
throwaway worktrees, never in this one. **Three of the findings are guards that did not work at all**,
and two of those were measured GREEN — the class this wave had already recorded once, as D-1306, before
the review found two more of it.

- **D-1308** (2026-09-02, MAJOR, found by two lenses independently) — **the "never briefed" fact could
  never fire.** Statement (4) read `MIN(COALESCE(d.ingestedAt, d.deliveredAt, m.at))`, borrowed from
  `dueDeliveries`. `ingestedAt` is stamped only on an observed `UserPromptSubmit` edge, so it stays
  NULL for exactly the population this fact exists to name — a chair nobody ever sat in — and the
  COALESCE then fell through to `deliveredAt`, which `markDelivered` re-stamps on EVERY replay, every
  `MAIL_REPLAY_MS` (600 000 ms). Against `KICKOFF_UNACKED_MS` of 900 000 the reported age topped out at
  **599 999 across 25 replays and the warning fired zero times**; then the row parked at the replay
  ceiling, left `OUTSTANDING_STATES_SQL`, and the fact went `null` — indistinguishable from "acked,
  healthy". The headline wedge of the wave, dead on arrival. Fixed to `MIN(m.at)`, which is what
  `RunHealth.coordKickoffPendingSince`'s own docstring already promised ("was FIRST SENT") and the only
  one of the three instants nothing rewrites. The borrowed precedent was wrong twice over:
  `dueDeliveries` answers "when may this be sent again", and its own docstring records
  `COALESCE(ingestedAt, deliveredAt)` as a review-found defect it was fixed AWAY from. The test that
  existed pinned only the branch where `ingestedAt` IS set — the branch where the COALESCE works.

- **D-1309** (2026-09-02, MAJOR, found by two lenses independently) — **the warn row rendered on CLOSED
  runs, and the comment saying it could not was false.** `RunsScreen` has ONE `rowFor` and applies it to
  `list` AND to `finished`; `runWarnings` declared `state` in its parameter type and never read it. So a
  wave whose first done-claim was refused `stale-tip` and then closed cleanly carried an amber
  "1 rejected" in the archive forever, and an ABANDONED run — `failed`, never dispatched, which is
  exactly what the Abandon control produces on a wedged row — drew *"never briefed … an open run whose
  chair nobody sat in"*, a flatly false sentence about a closed run. D-1307's `dispatchedAt === null`
  clause, landed hours earlier, **widened** this: a never-dispatched run is precisely what an abandoned
  one is. Fixed with the filter itself rather than a claim about a caller. The server keeps measuring
  health for closed runs, deliberately — that is the run's history, and an adapter may not narrow a
  distinction it received; whether history deserves ATTENTION is the renderer's call, and the answer is
  no. No test had ever mounted a closed run.

- **D-1310** (2026-09-02, MAJOR) — **a line-initial bolded CITATION read as a definition, and the prose
  it fires on is the prose that records a ledger collision.** `DEFINITION` recognised an entry by prefix
  alone, so `- **D-172, D-173 and D-174 were re-used** by this branch…` and `- **D-149 sweep:** any task
  that…` — both real lines on `main` — are definitions to it. The unit test asserting otherwise used
  only MID-LINE mentions, which the prefix rule already rejected, so it established nothing. The sharp
  version: the second of those sentences is exactly what a wave writes when it RECORDS the incident this
  guard detects, so wave 8 narrating "D-1231 and D-1232 were re-used" would red the guard, and the only
  remedy the failure message offered was to renumber a deviation the branch merely cited. Fixed with a
  lookahead for the four ways a real entry opens (`**`, ` —`, ` (`, `:`); measured over the scanned
  plans as 394 prefix matches → 388 entry-shaped, and **all six dropped lines are citations**
  (D-149, D-171, D-172, D-291, D-292, D-1026). Both directions now pinned. Knock-on: two of the six
  sub-211 collisions this wave cited as evidence for the era scoping (D-149, D-172) were never
  collisions — they are these citations — so that argument rested on four data points, not six.

- **D-1311** (2026-09-02, MAJOR, and the one that is about honesty rather than code) — **Task 9 was
  ticked complete and shipped a different surface than it describes.** The plan's Task 9 specifies
  `auditAllocations`, `GET /api/ledger` gaining a `mismatches` field, an arm in `ledger-routes.test.ts`
  and a named commit. What shipped is `unallocatedDefinitions` reported by `sweepLedgerReconcile` as a
  `console.warn`. The redesign is defensible and its commit message argues it — but the plan was never
  updated, and the fifty step checkboxes were ticked in one `sed` at the end rather than as each landed,
  which is how a task nobody performed came to read as done. **A coordinator re-measuring this wave
  against its own ticked plan would expect `GET /api/ledger` to carry `mismatches`; it does not.**
  Task 9 and the File Structure table are rewritten below to say what shipped and why the route was not
  the right home. The lesson is the mutation table's own: tick as you land, or the record is a claim
  rather than a measurement.

- **D-1312** (2026-09-02, MAJOR — the D-1306 class, twice more, both measured GREEN) — two guards this
  wave shipped could be deleted with the whole suite staying green.
  (a) **`healthFor`'s coordinator extraction.** Every test exercising `coordKickoffPendingSince` called
  `runHealth([id], [COORD])` directly, passing the coordinator ids by hand; not one reached the fact
  through `runs()` or `run()`, which are the only production paths. Replacing the extraction with
  `const coords: string[] = []` left **6295 tests passing**. The failure it hides is invisible by
  construction: the field is present on the wire and reads as a healthy `null`.
  (b) **`lastOrphanReport`.** The sweep's once-per-changing-set dedupe had no test in any suite;
  deleting the condition left `ledger-sweep` 14/14. Without it, the live D-1066..1069 orphan set logs on
  every 15-minute sweep forever. Its mirror on the *stale* side has been pinned since D13, which is what
  makes this an omission rather than a policy. Both now have tests that red on the deletion.

- **D-1313** (2026-09-02, the fix is better than the thing it replaces) — **the allocator era is derived
  per project, and `LEDGER_BOOTSTRAP` is retired.** The first version hardcoded `LEDGER_ALLOCATOR_ERA`
  (211, THIS repo's first allocator-era number) plus a `LEDGER_BOOTSTRAP` set of 211..224 (build 9b's
  own hand-numbered plan) — and `sweepLedgerReconcile` applies the audit to every project that has ever
  issued a number. The second project to adopt the allocator would have had most of its own hand-numbered
  history named as "never allocated", beside a nonsensical fourteen-number hole grandfathered out of a
  different repo. The allocator already knows each project's answer and it costs one `MIN(n)`. Measured:
  this project's first ISSUED number is **274**, not 211 — so 211..273 were all hand-numbered and the
  bootstrap set was both too narrow and repo-specific — and the two forms report the **same four
  orphans** (D-1066..1069). A project with no allocations reports nothing, because it has no era.
  This also retires the constant D-1306 was written about; that deviation's lesson stands and its
  mechanism is gone with the constant.

- **D-1314** (2026-09-02, a stale cardinal in the wave that corrects three) — **D-1297's evidence count
  was wrong.** It said rows 1157–1161's `landedIn` names "five different plan files" with "three of them
  other lanes'". Re-measured against the live allocator: that range lands in **four** distinct files
  (1157 and 1158 share one), and **four** of them are other lanes' — five files is true only of the
  wider 1157–1172 block, and the wave-6 plan is the one file that is this program's own. The conclusion
  is untouched and everything else in D-1297 reproduces exactly; the cardinal was wrong, in a document
  whose whole currency is measured cardinals, in the wave that corrects three of exactly that kind
  (D-1302). Corrected in place.

- **D-1315** (2026-09-02, minors worth the record because each is a false claim in shipped source) —
  four sentences that were not true. (1) `.run-warn`'s CSS comment claimed it was "scoped under
  `.run-row`" and "already priced by contrast-check.mjs"; the rule shipped unscoped, so the auditor
  could not reach it and it sat in the 249-rule uncovered census while the file said it was measured —
  one token, and it now prices at 10.09 dark / 5.92 light. (2) `RunHealth`'s docstring named the
  tolerant reader as `runHealth()` in `runWords.ts`; that is the SERVER store method, and the reader is
  `runWarnings` — pointing a maintainer at the wrong ring for the tolerance guarantee. (3)
  `CoordCapsView.updatedAt` said absence "reads the same way through the one reader that consumes it",
  and there is no such reader — `CapsControl` takes a `CoordCapsView` and touches only `caps` and
  `usage`. (The review went one step further and called the commit's "both halves closed" an overclaim;
  **that half was REFUTED in verification and the refutation is right**: D-1169 states its own gap as
  "the column already exists and only the read is missing", plus the `setCaps` clock, and this wave
  closes exactly those two. The dial is motivation in that deviation's text, not a deliverable. The
  correction to the correction is recorded rather than silently reverted, because a wave that fixes
  false claims can introduce one while doing it.) (4) `runHealth` said "FOUR statements TOTAL" and issued five
  whenever the kickoff facet was doing its job, two of them re-reading `runs` columns the caller already
  held; `claimedBy` now rides statement (3) and the count is true. Also fixed: `lastRejectCode` and
  `clearError` reached the operator only through `title=`, which a mobile board with no hover cannot
  surface, so both now ride the word; `mailOutstanding` was measured, shipped on every run in every
  frame and read by nothing, and now carries the spec's own "outstanding VS parked" in the title;
  `isDoneRejectCode` shipped with zero callers and zero tests and is deleted.

- **D-1316** (2026-09-02, the class a THIRD time, in the review round's own fix) — **D-1309's fixture
  was vacuous, and only re-measuring the row found it.** The closed-run case pushed its run onto the
  LIVE frame (`store.setState({ runs: [closed] })`), and the board's `active` slice is the live frame
  MINUS closed rows — so the run was filtered out before rendering and the case asserted "no warn row"
  against a board with **no row at all**. The mutation that deletes `isRunClosed` from `runWarnings`
  measured **GREEN** against it: 14 passed. A closed run reaches the board by exactly one path, the
  cold `?closed=1` loader into the `finished` group, and the fixture now goes that way (with real
  timers, because `waitFor` polls and fake ones deadlock it) plus an assertion that a `.run-row`
  rendered at all before the absence is asserted. Re-measured: the deletion now reds with `a done run
  drew a warning: expected <span class="run-warn">…(3)</span> to be null`.

  **This is the third instance in one wave** — D-1306 (a test passing its own Set), D-1312 (two guards
  with no test at all), and now a guard whose test could not see it. All three were found the same way
  and only that way: by actually running the mutation and reading the result, rather than writing the
  row from the code. Two of the three were in fixes written to close the previous one. The table is
  not a record of the guards; it is the only thing that establishes they exist.

## Mutation table

Every row measured by applying the mutation ALONE, running the named suite in the foreground, quoting
the FIRST failing assertion verbatim, reverting, and confirming `git status --porcelain` is clean.
Written as each guard lands, never at the end. A row that comes back GREEN is a hole, not a pass.

| mutation | first-fail assertion | suite |
| --- | --- | --- |
| delete `DONE_AUTHORITY_CODES` from `shared/api.ts` (the guard-deletion direction, measured while writing it) | `AssertionError: expected [] to deeply equal [ 'shared/api.ts' ]` | server `single-definition` |
| restore `fingerprint.ts`'s `Extract<MailRejectCode, 'stale-tip' \| …>` in place of `DoneRejectCode` | `AssertionError: expected [ 'server/src/coord/fingerprint.ts' ] to deeply equal []` | server `single-definition` |
| rename migration 7's `briefQueued` column (the guard-deletion direction) | `AssertionError: runs.briefQueued is absent: expected undefined to be defined` | server `coord-db` |
| give `briefQueued` `NOT NULL DEFAULT 0` — the tempting spelling that collapses null into false | `AssertionError: briefQueued is NOT NULL — absence would read as false: expected 1 to be +0` | server `coord-db` |
| add `health` to `RunSummary` without updating the census (the census's own direction) | `error TS2741: Property 'health' is missing in type '{ id: true; … }' but required in type 'Record<keyof RunSummary, true>'` | server `typecheck-tests` |
| ship `coordKickoffPendingSince` as an AGE (`Date.now() - at`) instead of the stored instant | `AssertionError: a health field moved with the clock — the runs frame can no longer dedupe: expected '[{"id":1,"program":"leverage","progra…' to be '[{"id":1,"program":"leverage","progra…'` | server `coord-health` |
| drop the `DELIBERATE_CANCEL_ERRORS_SQL` exclusion from the parked count | `AssertionError: a deliberate cancel was counted as a wedge: expected 3 to be 1` | server `coord-health` |
| `MAX(d.replayCount)` → `SUM(d.replayCount)` on the replay high-water | `AssertionError: the high-water is not the MAX: expected 20 to be 19` | server `coord-health` |
| delete the `briefQueued`/`clearError` write from `CoordStore.dispatchRun` | `AssertionError: the dispatch decision is not durable: expected { briefQueued: null, clearError: null } to deeply equal { briefQueued: +0, …(1) }` | server `run-routes` |
| write `briefQueued` as a constant `0` — the vacuity direction the false-branch case alone could not see | `AssertionError: expected { briefQueued: +0, clearError: null } to deeply equal { briefQueued: 1, clearError: null }` | server `run-routes` |
| `crossTreeCollisions` filters to `false` — the always-green direction every empty-list assertion above would tolerate | `AssertionError: expected [] to deeply equal [ 1159, 1160, 1161 ]` (and `[ 1157, 1158 ]`) | server `deviation-refs` |
| restore `ENTRY`'s same-line-subject demand on `DEFINITION` — the D-1294 blindness, put back | `AssertionError: expected [ 1157 ] to deeply equal [ 1157, 1158 ]` | server `deviation-refs` |
| `LEDGER_ALLOCATOR_ERA` 211 → 0, so the pre-allocator era joins the scan | `AssertionError: expected [ Array(1) ] to deeply equal []` | server `ledger-crosstree` |
| delete the orphan report from `sweepLedgerReconcile` | `AssertionError: expected "warn" to be called 1 times, but got 0 times` | server `ledger-sweep` |
| revert the sweep's project list to `openByProject.keys()` — OPEN allocations only | `AssertionError: a fully-landed project is never audited: expected "warn" to be called 1 times, but got 0 times` | server `ledger-sweep` |
| empty `LEDGER_BOOTSTRAP` — **came back GREEN first time** (D-1306), reds only after the test was made to read the shipped constant | `AssertionError: the bootstrap set is not 211..224 — it may only SHRINK, never move: expected [] to deeply equal [ 211, 212, 213, 214, 215, 216, …(8) ]` | server `ledger-crosstree` |
| `h.briefQueued === false` → `!h.briefQueued`, so null joins false | `AssertionError: expected [ { glyph: '⌦', …(2) } ] to deeply equal []` | pwa `runs-health` |
| drop the null guard before the kickoff arithmetic (`since ?? 0`) — null coerces to an infinitely old kickoff | `AssertionError: a healthy run drew a warning: expected <span class="run-warn" …(1)>…(1)</span> to be null` | pwa `runs-health` |
| make an absent `health` render a claim instead of silence | `AssertionError: an older server was made to assert a health claim: expected <span class="run-warn" …(1)>…(1)</span> to be null` | pwa `runs-health` |
| `setCaps` reads its own `Date.now()` again — the D-1169 revert | `AssertionError: expected { ok: true, caps: { …(2) }, …(2) } to deeply equal { ok: true, caps: { …(2) }, …(2) }` (the pinned `updatedAt: 1_700_000_000_000`) | server `coord-caps-route` |
| `capsUpdatedAt` returns migration 1's seeded `0` instead of null | `AssertionError: expected +0 to be null` | server `coord-caps-route` |
| `gate.ts`'s docstring goes back to "all 55 routes" | `AssertionError: gate.ts claims a route count this tree does not derive: expected [ 55 ] to deeply equal [ 68 ]` | server `auth-gate` |
| drop `undispatched` from the un-briefed condition — spec §9's middle clause (D-1307) | `AssertionError: a dispatched run was called never-briefed: expected <span class="run-warn" …(1)>…(1)</span> to be null` | pwa `runs-health` |
| _the review round (D-1308..D-1315) — every row below re-measured after the fix_ | | |
| restore `MIN(COALESCE(d.ingestedAt, d.deliveredAt, m.at))` on the kickoff clock (D-1308) | `AssertionError: the clock slid forward with deliveredAt — the age can never reach the threshold: expected 15001000 to be 1000` | server `coord-health` |
| `healthFor` supplies no coordinator ids (`const coords: string[] = []`) — **measured GREEN across 6295 tests before D-1312's test existed** | `AssertionError: runs() never told runHealth who the coordinator is: expected null to be 4000` | server `coord-health` |
| delete `lastOrphanReport`'s dedupe condition — **measured GREEN in every suite before D-1312's test existed** | `AssertionError: an unchanged orphan set was reported twice: expected "warn" to be called 1 times, but got 2 times` | server `ledger-sweep` |
| drop `isRunClosed(run)` from `runWarnings` (D-1309) — **measured GREEN against the first fixture, which pushed a closed run onto the LIVE frame the board already filters (D-1316)** | `AssertionError: a done run drew a warning: expected <span class="run-warn">…(3)</span> to be null` | pwa `runs-health` |
| revert `DEFINITION` to prefix-only, so a bolded citation is a definition again (D-1310) | `AssertionError: expected [ { file: 'a.md', n: 149 } ] to deeply equal []` | server `ledger-crosstree` |
| unscope `.run-row .run-warn` back to `.run-warn` (D-1315) | `Error: no rule for .run-row .run-warn` (thrown by `findRule`, `test/cssRule.ts:94` — the loop refuses a selector it cannot find rather than reading `''` and passing) | pwa `fleet-css` |
| hardcode the era back to 211 + a bootstrap set instead of `projectEra` (D-1313) | `AssertionError: expected [ { n: 211, files: [ 'a.md' ] }, …(1) ] to deeply equal []` | server `ledger-crosstree` |
| drop `input.briefQueued !== undefined` from `dispatchRun`, so an omitting caller binds `0` — **measured GREEN in review** | `AssertionError: an omitted decision was written as false: expected false to be null` | server `coord-health` |
| drop the `x.id DESC` half of the rejection tiebreak | `AssertionError: the newest row did not win the tie: expected 'stale-tip' to be 'pr-regressed'` | server `coord-health` |
| run statement (3) per-row instead of over an `IN (…)` — the batching claim itself | `AssertionError: the read scales with the number of runs: expected 11 to be 4` | server `coord-health` |

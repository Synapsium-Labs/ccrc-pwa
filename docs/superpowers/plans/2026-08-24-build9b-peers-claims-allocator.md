# Build 9b — peers, claims and the deviation allocator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The unshipped half of Build 9 lands: peer discovery, advisory hot-file claims,
and the D-number allocator — on a mail lane hardened first — then the skills learn the
etiquette, the PWA shows the history, and the deviation namespace reconciles to one
sequence.

**Architecture:** Spec `docs/superpowers/specs/2026-08-21-build9-provenance-peers-claims-design.md`
(§1 D1–D17 are settled operator-ruled decisions — argue FROM them, never against them).
Build 9a (spec waves 1–6, the journal half) SHIPPED: `_lc_*` in ccd, the mirror,
`GET /api/lifecycle`, actor flags, `capSupported`. This plan is spec waves 0, 7, 8, 9
and 10 — plus the L0 vocabulary slice wave 1 did not carry. Every new coordination
primitive is a query against the mirror plus one compare-and-swap that only the box
with a database can perform (D11: the synchronous `tx()` IS the CAS; the unique
index is the backstop, in that order).

**Tech Stack:** TypeScript ESM (fastify server, `node:sqlite` `DatabaseSync`), bash
(`ccd/` skills), vitest, React (pwa). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-21-build9-provenance-peers-claims-design.md`

## Global Constraints

- No new npm dependencies. `FLEET_PROTO` stays 1; every wire surface additive-only;
  `StopSurface` and `WsTombstone` unchanged; no new `MailKind` (R2).
- Suites: `./node_modules/.bin/vitest run <file>` from inside the package, FOREGROUND,
  never bare `npx vitest`. Known load-flaky suites re-run in isolation before calling a
  break real.
- ccd tests: FIXTURE HOMEs only (`makeCcdHarness`, cleanup in `tmpHelpers.ts`),
  `ghContainedEnv()` per test. No test touches the live `$HOME`, the live registry, or
  runs a destructive verb outside a fixture.
- Every guard ships with a mutation-measured red (count stated in the commit); the
  spec's §4 table names the required mutants — each is an explicit plan step.
- `ccd/ccd` and skill commits are **AGENT-FIRST** at deploy; `ccd/ccd` edits re-stamp
  provenance (`shared/mark.mjs` `markGenerated`).
- All new routes register in `server/src/coord/routes.ts` ONLY; **no DELETE routes**
  (the corpus parity scanner knows only get/post). `POST /api/claims/:id/break` stays
  unnamed in both skill corpora (the abandon-door shape).
- `sweepMail` is NOT refactored, `coord.db` is NOT wrapped async, the idle gate is
  untouched (R2), the agent gains ZERO grants/frames/code.
- Neutral vocabulary everywhere: `203.0.113.7`, `198.51.100.7`, `mybox.example.com`,
  `<server-host>`, `<fleet-host>`; never spell a `topology-clean` forbidden token —
  the ratchet scans every tracked file's contents and path, case-blind.
- Worker-skill literals are double-quoted in their pin suite: STRAIGHT apostrophes, no
  `"` character. Coordinator-skill literals are single-quoted: CURLY apostrophes.

## Ledger

`origin/main`'s high-water is **D-210** (build 9a's lane); this plan's execution
allocates from **D-211** — verify at execution time by sweeping EVERY remote ref
(`for r in $(git for-each-ref --format='%(refname)' refs/remotes/origin); do git grep
-oh 'D-[0-9]\{1,4\}' "$r" -- . 2>/dev/null; done | sed 's/D-//' | sort -n | tail -1`),
never `origin/main` alone — and FILTER the result: this plan's own test fixtures
(D-261, D-400, D-999, D-1234, D-2611) and its prose mentions match the naive regex,
which is itself a demonstration of why D13's allocator exists. Real allocations are
contiguous from the ledger's history; a lone number far above the run is a fixture.
Once Task 20 lands and the floor seeds, allocation goes through
`POST /api/ledger/deviations` and hand-allocation stops — this plan is the last one
that allocates by sweep.

## Deviations found

(numbering continues from the global ledger; D-210 was build 9a's lane)

- **D-211** (Task 3): the plan's red-first step predicted a `SyntaxError` when the
  test imports a not-yet-exported name; vitest instead yields `undefined` for a
  missing named import, so the red manifested as assertion failures rather than a
  load error. Red-first semantics preserved (the suite was demonstrably red before
  the implementation); recorded because the plan's "Expected: FAIL with" lines for
  ESM-import reds should say failed-assertions, not SyntaxError — later tasks'
  executors should read them that way.
- **D-212** (Tasks 3–4): `MAIL_REJECT_CODES`' census in `coordinator-skill.test.ts`
  went red at Task 3's commit (the census names `duplicate`/`peer-quota` before any
  skill corpus documents them) and was bridged in Task 4 via a `NOT_A_CALL_REFUSAL`
  parking entry that Task 25 deletes when the corpus prose lands. One intermediate
  commit (2839ca29) is bisect-red on that single suite — a consequence of the plan's
  own sweep ordering (Task 3's sweep list omitted coordinator-skill), accepted
  rather than history-rewritten. Also under this number: the reviewer's note that
  store.ts's new terminality docstring slightly overstates ("every mail_deliveries
  writer is guarded" — `setDeliveryEnvelope` writes only the envelope column and
  carries no guard, deliberately outside D10 holes 3/4).

## Cross-task signature governance

This plan was drafted in sections. Where a LATER task's code calls a function an
EARLIER task defines and the spellings disagree (argument order, parameter names —
`claimExpiry` is the known case: Task 7 defines it; Tasks 15/17 call it), **the
defining task's LANDED spelling wins and the consumer adapts at execution time** —
the semantics in the consuming task's text stay binding (hard-cap-first, doubt
renews, lapse-not-delete). An executor who hits a mismatch reads the landed
definition, adapts the call, and notes the drift in the task's commit body — never
forks the signature.

## Wave order (spec §5) — and what forces it

Wave 0 (Tasks 1–4, server, dark) MUST land before any second mail producer exists.
The L0 slice (Task 5) precedes everything typed. Wave 7 (Tasks 6–24, server) is the
bulk. Wave 8 (Tasks 25–27, skills, agent-first) is FORCED last-after-7 by the route
parity suite: naming `POST /api/claims` in a corpus before the route registers is a
red suite. Wave 9 (Tasks 28–29, pwa) any time after 7. Wave 10 (Tasks 30–32, the D14
namespace reconciliation) runs LAST, in an operator-announced quiet window, never
concurrently with a wave — it is itself a conflict-generating change.

---
# Build 9b — Section 1 · Wave 0: mail hardening (Tasks 1–4)

**Spec:** `docs/superpowers/specs/2026-08-21-build9-provenance-peers-claims-design.md`, D10 (the
four-hole table) and §5 wave 0. **This wave ships DARK, server-only:** no ccd change, no agent
change, no PWA change, no new route — every edit lands inside `POST /api/mail`, `CoordStore`, and
one `watch.ts` call site. The wave exists because Wave 7 makes peer sessions a **second mail
producer**, and four holes that are harmless while the coordinator is the only producer become
load-bearing the moment a peer can POST: a dedupe guard that structurally cannot fire for
`runId:null`, no quota anywhere (and nothing in the tree ever DELETEs from `mail`/`mail_deliveries`
— **bound the producer, never the record**), and two terminality guards whose absence is shielded
only by their single callers' query filters.

**Constraints in force for every task below:**
- No new npm dependencies. `FLEET_PROTO` stays 1; nothing here touches the wire at all.
- `DatabaseSync` stays synchronous; no route registered outside `server/src/coord/routes.ts`
  (wave 0 registers none — it edits an existing one).
- Red-first TDD; every guard gets a mutant ceremony (plant, count red, revert) as explicit steps.
- Suites run **in the foreground**, `timeout ≥ 600000ms`, invoked as
  `./node_modules/.bin/vitest run test/<file>` from inside `server/` — never bare `npx vitest`.
- `typecheck-tests` is a known load flake — re-run in isolation before calling a real break.

**What later sections consume from this one (Produces, summarized):**
- `CoordStore.hasOutstandingMail(runId: number | null, toId: string, subject: string): boolean`
- `CoordStore.bumpReplayCount(id: number): { state: 'counted'; replayCount: number } | { state: 'terminal' }`
- `CoordStore.markIngested(id: number, at: number): void` (terminal-guarded)
- `CoordStore.hasOutstandingPeerDuplicate(fromId: string, toId: string, subject: string): boolean`
- `CoordStore.outstandingPeerCount(fromId: string, toId: string): number`
- `CoordStore.peerMailInLastHour(fromId: string, now: number): number`
- `shared/api.ts`: `MAIL_REJECT_CODES` gains `'duplicate'` and `'peer-quota'`;
  `PEER_MAIL_MAX_OUTSTANDING = 3`; `PEER_MAIL_HOURLY = 12`
- `POST /api/mail` behavior for `runId === null`: `409 duplicate`, `429 peer-quota`, both recorded
  in `mail_rejections`; `runId !== null` traffic byte-identical to today, pinned by test.

---

### Task 1: `hasOutstandingMail` learns `IS` — the peer-mail dedupe guard can finally fire

D10 hole 1 (measured): `hasOutstandingMail` is `WHERE m.runId = ?` (`store.ts:1202`). A bound NULL
under `=` equals nothing in SQLite, so for `runId:null` mail the dedupe guard **structurally cannot
fire** — every peer-mail dedupe built on it (Task 3's route checks are built beside it, Wave 7's
peers lean on the same reader) would silently pass everything. SQLite's `IS` is null-safe on both
arms, so the fix is still **one** query, one reader; the signature widens to `number | null`.

**Files:**
- Modify: `server/src/coord/store.ts` — `hasOutstandingMail`, docstring `:1191-1198`, method
  `:1199-1205` (SQL at `:1202`)
- Create: `server/test/mail-hardening.test.ts`

**Interfaces:**
- Consumes: `OUTSTANDING_STATES_SQL` (`store.ts:126`, module-private, already in scope);
  `CoordStore.insertMail` (`store.ts:1030`, `runId: number | null` already);
  `CoordStore.queueDelivery` (`store.ts:1207`); `openCoordDb` (`server/src/coord/db.ts`);
  `mkTmp` (`server/test/tmpHelpers.ts`).
- Produces: `CoordStore.hasOutstandingMail(runId: number | null, toId: string, subject: string): boolean`
  — unchanged truth table for the number arm; the null arm matches **only** `runId IS NULL` rows.
- Existing caller, verified untouched: `server/src/coord/rundefs.ts:139`
  (`coord.hasOutstandingMail(m.runId, m.toId, m.subject)`, `m.runId: number` — still well-typed
  under the widened parameter).

**Steps:**

- [x] Confirm the caller set before touching anything (one caller in `src`, none pass null today):

  ```bash
  cd <repo-root> && grep -rn "hasOutstandingMail" server/src server/test --include="*.ts"
  ```

  Expect exactly: `server/src/coord/store.ts` (docstring + definition) and
  `server/src/coord/rundefs.ts:139`. If any other caller has appeared since this plan was written,
  read it before proceeding — it inherits the widened signature.

- [x] Write the failing test. Create `server/test/mail-hardening.test.ts`:

  ```ts
  // WAVE 0 (Build 9b) — mail hardening before any second producer exists
  // (spec 2026-08-21-build9, D10). The store half: the dedupe guard's null
  // arm (hole 1) and the two terminality guards (holes 3/4). The route half
  // — quotas and the dark-behavior pin — lives in mail-peer-quota.test.ts.
  import { describe, it, expect } from 'vitest';
  import path from 'node:path';
  import { openCoordDb } from '../src/coord/db.js';
  import { CoordStore } from '../src/coord/store.js';
  import { mkTmp } from './tmpHelpers.js';

  const store = (): CoordStore =>
    new CoordStore(openCoordDb(path.join(mkTmp('ccrc-mailhard-'), '.ccrc', 'coord.db')));

  const openRun = (s: CoordStore) =>
    s.openRun({ program: 'build9b', title: 'Wave 0 fixture', project: 'demo',
                wave: 1, waveOf: 1, claimedBy: 'demo-coordinator' }) as { id: number };

  describe('hasOutstandingMail: the runId IS ? arm (D10 hole 1)', () => {
    it('finds an outstanding PEER mail (runId null) — under `=` a bound NULL matches nothing, so the guard structurally could not fire', () => {
      const s = store();
      const m = s.insertMail({ fromId: 'demo-quiet-mesa', fromUuid: 'u1', toId: 'demo-calm-ridge',
                               runId: null, kind: 'question', subject: 'peer q', body: 'x',
                               artifacts: [] });
      s.queueDelivery(m.id, 'demo-calm-ridge', '<mail>x</mail>');
      expect(s.hasOutstandingMail(null, 'demo-calm-ridge', 'peer q')).toBe(true);
    });

    it('still finds a RUN mail by its number, and a run mail is NOT a peer mail — IS is null-safe on both arms', () => {
      const s = store();
      const r = openRun(s);
      const m = s.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator',
                               toId: 'demo-quiet-mesa', runId: r.id, kind: 'status',
                               subject: 'wave-brief', body: 'go', artifacts: [] });
      s.queueDelivery(m.id, 'demo-quiet-mesa', '<mail>go</mail>');
      expect(s.hasOutstandingMail(r.id, 'demo-quiet-mesa', 'wave-brief')).toBe(true);
      // The null arm must select ONLY runId-IS-NULL rows — a run mail found by
      // the peer probe would dedupe a peer send against the coordinator's own
      // traffic, silently.
      expect(s.hasOutstandingMail(null, 'demo-quiet-mesa', 'wave-brief')).toBe(false);
    });
  });
  ```

- [x] Run it, expect FAIL — 1 failed, 1 passed; the failing assertion is
  `expected false to be true` on the peer-mail arm (the second test passes today: the number arm
  already works and the null arm already answers false, for the wrong reason — `NULL = NULL` is
  NULL — which the mutant step below is for):

  ```bash
  cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts
  ```

- [x] Write the implementation. In `server/src/coord/store.ts`, replace the whole
  docstring-plus-method at `:1191-1205`:

  ```ts
  /** Whether an OUTSTANDING (`queued` or `delivered`, unacked) mail already
   *  exists for this (runId, toId, subject) — review finding 33: a retried
   *  close re-entering the SAME done-claim rejection queued a fresh mail +
   *  delivery row, and a fresh non-collapsing push (spec:236-237), on EVERY
   *  retry, with no dedupe and no rate limit. `subject` alone identifies
   *  "the same fact restated" for the two system-mail subjects this build
   *  ever sends on a retry loop (`wave-brief`, `wave-done-rejected`) —
   *  `queueSystemMail`'s own call sites are the only run-mail callers.
   *
   *  `m.runId IS ?`, not `= ?` (Build 9b wave 0, D10 hole 1): `runId` is
   *  nullable — peer mail is `runId:null` by definition — and a bound NULL
   *  under `=` equals nothing, so for exactly the traffic Wave 7 adds a
   *  second producer for, the dedupe guard structurally could not fire.
   *  SQLite's `IS` is null-safe on both arms, so a number still matches its
   *  own rows and ONLY a null matches the null ones: one query, one reader,
   *  no second method. */
  hasOutstandingMail(runId: number | null, toId: string, subject: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 AS x FROM mail m JOIN mail_deliveries d ON d.mailId = m.id ' +
      `WHERE m.runId IS ? AND d.toId = ? AND m.subject = ? AND d.state IN ${OUTSTANDING_STATES_SQL} LIMIT 1`,
    ).get(runId, toId, subject);
    return row !== undefined;
  }
  ```

- [x] Run, expect PASS (2 passed):

  ```bash
  cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts
  ```

- [x] Mutant ceremony — the guard's own red. Plant the mutant: in the SQL just written, change
  `m.runId IS ?` back to `m.runId = ?`. Run `test/mail-hardening.test.ts`: expect **1 failed**
  (the peer-mail arm; the run-mail test stays green — which is precisely why the peer test had to
  exist). Revert the mutant. Run again: 2 passed.

- [x] Regression sweep over the neighbors the widened signature touches:

  ```bash
  cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts test/run-routes.test.ts
  cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
  ```

  All green (`typecheck-tests` is a listed load flake — if red, re-run it alone before reading it
  as real).

- [x] Commit:

  ```bash
  cd <repo-root> && git add server/src/coord/store.ts server/test/mail-hardening.test.ts && git commit -m "server(wave0): hasOutstandingMail speaks IS — the peer-mail dedupe guard can finally fire

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 2: terminality guards on `markIngested` and `bumpReplayCount` — and the union IS the fix

D10 holes 3 and 4. `markIngested` (`store.ts:1371`) and `bumpReplayCount` (`store.ts:1360`) are the
only two `mail_deliveries` writers without `AND state NOT IN ('acked','rejected')` — shielded today
solely by their single callers' query filters (`deliveredUnacked()` selects only `delivered`;
the replay bump runs only on a row the sweep just read as `delivered`), a window of seconds to half
a minute in which an ack or a park lands from a separate code path. The spec's ruling on hole 4 is
the sharp one: **adding the guard while still returning a bare `number` hands the caller an
unchanged count that reads as "not yet at the ceiling" for a row already parked — two conditions,
one value, at a seam. The union is the fix; the guard alone is not.** So the return becomes
`{ state: 'counted'; replayCount: number } | { state: 'terminal' }` and **every** caller is found
and updated in this task.

**Files:**
- Modify: `server/src/coord/store.ts` — `bumpReplayCount` docstring+method `:1345-1364`;
  `markIngested` docstring+method `:1366-1373`
- Modify: `server/src/watch.ts` — the one `bumpReplayCount` caller, `:2154-2159`
  (`MAIL_REPLAY_MAX_ATTEMPTS` is `:225`)
- Modify: `server/test/mail-hardening.test.ts` (append one describe)

**Interfaces:**
- Consumes: `CoordStore.markDelivered` / `markAcked` / `rejectDelivery` (existing, already
  guarded); `MAIL_REPLAY_MAX_ATTEMPTS` (`watch.ts:225`); `MAIL_REPLAY_CEILING_ERROR`
  (`store.ts:134`).
- Produces:
  `CoordStore.bumpReplayCount(id: number): { state: 'counted'; replayCount: number } | { state: 'terminal' }`;
  `CoordStore.markIngested(id: number, at: number): void` — a no-op on `acked`/`rejected` rows.

**Steps:**

- [x] Find EVERY caller before changing the return type (the union makes each one a compile
  error until updated — that is the point):

  ```bash
  cd <repo-root> && grep -rn "bumpReplayCount\|markIngested" server/src server/test --include="*.ts" | grep -v "src/coord/store.ts"
  ```

  Expect: `bumpReplayCount` — exactly one caller, `server/src/watch.ts:2155`;
  `markIngested` — `server/src/watch.ts:1921`, `server/test/coord-store.test.ts:652` and `:678`
  (both test callers exercise live `delivered` rows, so the guard changes nothing for them; the
  void return is unchanged, so no edit there). If the grep shows anything else, update it in the
  same pattern as the `watch.ts` edit below.

- [x] Write the failing tests. Append to `server/test/mail-hardening.test.ts` (inside the file,
  after the Task 1 describe; the imports and helpers at the top are already there):

  ```ts
  describe('terminality guards: markIngested and bumpReplayCount (D10 holes 3/4)', () => {
    const now = 1_000_000_000_000;

    /** One mail, one delivery, driven to `delivered` — the state both
     *  writers under test are only ever legitimately called in. */
    const deliveredRow = (s: CoordStore): { id: number } => {
      const r = openRun(s);
      const m = s.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator',
                               toId: 'demo-quiet-mesa', runId: r.id, kind: 'status',
                               subject: 'wave-brief', body: 'go', artifacts: [] });
      const d = s.queueDelivery(m.id, 'demo-quiet-mesa', '<mail>go</mail>');
      s.markDelivered(d.id, now);
      return d;
    };

    it('markIngested leaves a PARKED row alone — the edge is not for a delivery already decided', () => {
      const s = store();
      const d = deliveredRow(s);
      s.rejectDelivery(d.id, 'undeliverable', 'parked at the ceiling');
      s.markIngested(d.id, now + 100);
      expect(s.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?').get(d.id))
        .toEqual({ ingestedAt: null });
    });

    it('markIngested leaves an ACKED row alone', () => {
      const s = store();
      const d = deliveredRow(s);
      expect(s.markAcked(d.id, now + 1)).toBe(true);
      s.markIngested(d.id, now + 100);
      expect(s.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?').get(d.id))
        .toEqual({ ingestedAt: null });
    });

    it('markIngested still stamps a live delivered row', () => {
      const s = store();
      const d = deliveredRow(s);
      s.markIngested(d.id, now + 100);
      expect(s.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?').get(d.id))
        .toEqual({ ingestedAt: now + 100 });
    });

    it('bumpReplayCount counts a live replay, as a state and a number', () => {
      const s = store();
      const d = deliveredRow(s);
      expect(s.bumpReplayCount(d.id)).toEqual({ state: 'counted', replayCount: 1 });
      expect(s.bumpReplayCount(d.id)).toEqual({ state: 'counted', replayCount: 2 });
    });

    it('bumpReplayCount answers {state:"terminal"} for a parked or acked row and leaves the counter alone', () => {
      // The union is the fix, not the guard (D10): a guard that still
      // returned a bare unchanged number would read as "not yet at the
      // ceiling" for a row already parked — two conditions, one value, at a
      // seam.
      const s = store();
      const parked = deliveredRow(s);
      s.rejectDelivery(parked.id, 'undeliverable', 'parked at the ceiling');
      expect(s.bumpReplayCount(parked.id)).toEqual({ state: 'terminal' });
      expect(s.db.prepare('SELECT replayCount FROM mail_deliveries WHERE id = ?').get(parked.id))
        .toEqual({ replayCount: 0 });

      const acked = deliveredRow(s);
      expect(s.markAcked(acked.id, now + 1)).toBe(true);
      expect(s.bumpReplayCount(acked.id)).toEqual({ state: 'terminal' });
      expect(s.db.prepare('SELECT replayCount FROM mail_deliveries WHERE id = ?').get(acked.id))
        .toEqual({ replayCount: 0 });
    });
  });
  ```

- [x] Run it, expect FAIL — 4 failed, 3 passed (the two Task 1 tests and
  `markIngested still stamps a live delivered row` pass; both markIngested-guard tests fail with
  `expected { ingestedAt: 1000000000100 } to deeply equal { ingestedAt: null }`; both
  bumpReplayCount tests fail because the method returns a bare `1`, and the terminal test
  additionally finds `replayCount: 1` where 0 was demanded — the unguarded UPDATE incremented a
  parked row):

  ```bash
  cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts
  ```

- [x] Write the implementation, both store methods AND the `watch.ts` caller in one edit pass
  (the union does not compile against the old caller — that is by design; do not commit between).
  In `server/src/coord/store.ts` replace `:1345-1364` (the `bumpReplayCount` docstring and
  method) with:

  ```ts
  /**
   * `mail_deliveries.replayCount + 1`, answered as a STATE (review finding
   * 20; union — Build 9b wave 0, D10 hole 4). Called by the sweep AFTER
   * `markDelivered`, and ONLY when the row it read was already `delivered`
   * before this send — i.e. this send was a REPLAY, not the first delivery.
   * Kept independent of `attempts` (`MAIL_MAX_ATTEMPTS`'s own docstring:
   * SEND FAILURES only) on purpose: without a separate counter,
   * spec:174-177's replay-until-ack has no ceiling at all once a delivery
   * succeeds even once — `MAIL_COOLDOWN_MS` only SPACES the injections, it
   * was never a bound on their number, and a delivery that keeps succeeding
   * can never fail its way into `MAIL_MAX_ATTEMPTS`. This is the ceiling
   * that lets a delivery no one ever acks eventually reach
   * `rejected('undeliverable')` — the spec's own terminal state, otherwise
   * structurally unreachable for exactly the deliveries that succeed.
   *
   * `AND state NOT IN ('acked','rejected')` — the same guard every other
   * writer of this table carries (`markDelivered`/`backOff`/`rejectDelivery`
   * above and below), closing the same seconds-to-half-a-minute window in
   * which an ack or a park lands from a separate code path between the
   * sweep's read and this write. And the RETURN is a union, not a bare
   * number, because the guard alone would hand the caller the row's
   * unchanged count — a value that reads as "not yet at the ceiling" for a
   * row already parked: two conditions, one value, at a seam (D10: "the
   * union is the fix; the guard alone is not"). `{state:'terminal'}` also
   * answers for a row that does not exist at all — collapsed deliberately
   * and stated here rather than papered over: nothing in this tree DELETEs
   * from `mail_deliveries` (D10's own measurement — "bound the producer,
   * never the record"), and the single caller's handling of the two is
   * identical (skip the ceiling check), so the collapse is of two conditions
   * no caller distinguishes.
   */
  bumpReplayCount(id: number): { state: 'counted'; replayCount: number } | { state: 'terminal' } {
    const res = this.db.prepare(
      "UPDATE mail_deliveries SET replayCount = replayCount + 1 WHERE id = ? AND state NOT IN ('acked','rejected')",
    ).run(id);
    if (res.changes === 0) return { state: 'terminal' };
    return {
      state: 'counted',
      replayCount: (this.db.prepare('SELECT replayCount FROM mail_deliveries WHERE id = ?')
        .get(id) as { replayCount: number }).replayCount,
    };
  }
  ```

  In the same file replace `:1366-1373` (the `markIngested` docstring and method) with:

  ```ts
  /** The `UserPromptSubmit` edge (`hookstate.ts:23-34`). Deliberately does
   *  NOT touch `deliveredAt` — a REPLAY re-dates the clock through its own
   *  fresh `markDelivered` call, and `dueDeliveries`'s `MAX(...)` above is
   *  what combines the two rather than either writer clobbering the other's
   *  column. `AND state NOT IN ('acked','rejected')` (Build 9b wave 0, D10
   *  hole 3): shielded until now only by its caller's query filter
   *  (`deliveredUnacked()` selects `delivered` rows) — a filter is a
   *  courtesy of one caller, a guard is a property of the row; the same
   *  ack-or-park-lands-mid-window race every sibling writer here already
   *  guards against. */
  markIngested(id: number, at: number): void {
    this.db.prepare(
      "UPDATE mail_deliveries SET ingestedAt = ? WHERE id = ? AND state NOT IN ('acked','rejected')",
    ).run(at, id);
  }
  ```

  In `server/src/watch.ts` replace `:2154-2159`:

  ```ts
          if (d.deliveredAt !== null) {
            // `{state:'terminal'}` — an ack or a park landed on this row from
            // a separate code path while this send was in flight (D10). The
            // row is decided; there is no count to weigh against the ceiling,
            // and re-parking a terminal row is exactly what rejectDelivery's
            // own guard exists to refuse.
            const bumped = store.bumpReplayCount(d.id);
            if (bumped.state === 'counted' && bumped.replayCount >= MAIL_REPLAY_MAX_ATTEMPTS) {
              store.rejectDelivery(d.id, 'undeliverable', MAIL_REPLAY_CEILING_ERROR);
            }
          }
  ```

- [x] Run, expect PASS (7 passed):

  ```bash
  cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts
  ```

- [x] Mutant ceremony, one per guard:
  1. In `markIngested`, delete `AND state NOT IN ('acked','rejected')`. Run
     `test/mail-hardening.test.ts`: expect **2 failed** (the parked and acked markIngested tests).
     Revert; re-run; 7 passed.
  2. In `bumpReplayCount`, delete `AND state NOT IN ('acked','rejected')` (keep the union). Run:
     expect **1 failed** (`answers {state:"terminal"} …` — the UPDATE now touches the parked row,
     so the method answers `{state:'counted',replayCount:1}` and the counter assertion also breaks
     inside the same test). Revert; re-run; 7 passed.

- [x] Regression sweep — the sweep lane's own suites must not notice the union (behavior for live
  rows is unchanged; only the shape moved):

  ```bash
  cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts test/coord-store.test.ts
  cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
  ```

  All green (isolation rule for `typecheck-tests` as in Task 1).

- [x] Commit:

  ```bash
  cd <repo-root> && git add server/src/coord/store.ts server/src/watch.ts server/test/mail-hardening.test.ts && git commit -m "server(wave0): terminal deliveries refuse the late edge; bumpReplayCount answers a state, never a bare count

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 3: peer-mail bounds at the ingress — one of a kind, three a pair, twelve an hour

D10 hole 2. Nothing in the tree ever DELETEs from `mail`/`mail_deliveries` — deliberately (**bound
the producer, never the record**) — so the only sustainable cap on a second producer is at the
door. For **`runId === null` traffic only**: same `(fromId, toId, subject)` outstanding →
`409 duplicate`; 3 outstanding per `(fromId, toId)` pair → `429 peer-quota`; 12 accepted per sender
per hour → `429 peer-quota`. Every refusal is recorded in `mail_rejections` through the route's
existing `refuse()` (which calls `recordRejection`, `store.ts:1475-1483`). Run mail
(`runId !== null`) is untouched — Task 4 pins that darkness.

The three checks land as **check 9**, after check 8 and the `'coordinator'` resolution
(`routes.ts:496-514`), immediately before the insert tx (`:516`). The placement is a decision, not
an accident, and it deliberately bends the route's cheap-before-expensive ordering for two reasons
stated in the code: the pair and the dedupe are keyed on the **resolved** recipient (the id
`mail_deliveries.toId` actually joins on), which does not exist before check 8; and a quota verdict
must only ever be computed for a sender attribution has already proven current (checks 5.5/6) — a
stale-uuid request keeps getting its own `403`, never a `429` charged against the id it presented.
Within check 9, `duplicate` is decided first: it is the most specific refusal — "your message is
already queued" tells the caller not to resend at all, where `peer-quota` invites a retry later.

**Files:**
- Modify: `shared/api.ts` — `MAIL_REJECT_CODES` `:3012-3021` (ingress group); new constants after
  `MAIL_ARTIFACT_PATH_MAX_BYTES` (`:2725`)
- Modify: `server/src/coord/store.ts` — three new methods, inserted directly after
  `hasOutstandingMail` (post-Task-1 position, formerly `:1205`)
- Modify: `server/src/coord/routes.ts` — the shared import block `:17-21`; check 9 inserted
  between `:514` (the `resolvedToId === null` refusal's close) and `:516` (the tx comment)
- Create: `server/test/mail-peer-quota.test.ts`

**Interfaces:**
- Consumes: `refuse()` (`routes.ts:279-286`); `resolvedToId` (`routes.ts:510`);
  `OUTSTANDING_STATES_SQL` (`store.ts:126`); `checkMailToken` / registry checks (existing route
  body, unchanged); `buildServer` + `testDeps` + `mkTmp` (test harness, the
  `mail-routes.test.ts` shape).
- Produces:
  - L0: `MAIL_REJECT_CODES` gains `'duplicate'`, `'peer-quota'` (both ingress-group; both emitted
    in `server/src/coord` in this same commit, which is what keeps
    `mail-routes.test.ts`'s both-directions scanner green — **the shared/api.ts edit and the
    route edit are one commit, never two**);
    `PEER_MAIL_MAX_OUTSTANDING = 3`; `PEER_MAIL_HOURLY = 12`.
  - L3: `CoordStore.hasOutstandingPeerDuplicate(fromId: string, toId: string, subject: string): boolean`;
    `CoordStore.outstandingPeerCount(fromId: string, toId: string): number`;
    `CoordStore.peerMailInLastHour(fromId: string, now: number): number` (window
    3,600,000 ms; counts ACCEPTED `mail` rows — inserts — not outstanding deliveries: a refusal
    inserts no row and charges nothing, an acked mail stays charged for its hour).
  - L4: `POST /api/mail` answers `409 {ok:false, error:'duplicate'}` and
    `429 {ok:false, error:'peer-quota'}` for `runId === null` only, each recorded.

**Steps:**

- [x] Write the failing tests. Create `server/test/mail-peer-quota.test.ts`:

  ```ts
  // WAVE 0 (Build 9b) — the peer-mail door (spec D10 hole 2): for
  // `runId === null` traffic ONLY, three bounds at the ingress — one of a
  // kind per (fromId,toId,subject) outstanding (409 duplicate), three
  // outstanding per (fromId,toId) pair, twelve accepted an hour per sender
  // (both 429 peer-quota) — every refusal recorded in mail_rejections.
  // "Bound the producer, never the record": nothing DELETEs from mail/
  // mail_deliveries, so the cap lives at the door or nowhere. Task 4 appends
  // the dark-behavior pin: the identical traffic WITH a runId is
  // byte-identically accepted.
  import { describe, it, expect, afterEach } from 'vitest';
  import { mkdirSync, writeFileSync } from 'node:fs';
  import path from 'node:path';
  import type { FastifyInstance } from 'fastify';
  import { PEER_MAIL_HOURLY, PEER_MAIL_MAX_OUTSTANDING } from '../../shared/api.js';
  import { buildServer } from '../src/server.js';
  import type { Deps } from '../src/server.js';
  import { openCoordDb } from '../src/coord/db.js';
  import { CoordStore } from '../src/coord/store.js';
  import { testDeps } from './helpers.js';
  import { mkTmp } from './tmpHelpers.js';

  const TOKEN = 'f'.repeat(64);
  const UUID = 'a'.repeat(36);

  const seed = (home: string, id: string, uuid = UUID): void => {
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields = { wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid, started: '1' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  };

  const withMail = async (home: string, over: Partial<Deps> = {}) => {
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord, ...over });
    return { app, coord };
  };

  const send = (app: FastifyInstance, body: unknown) =>
    app.inject({ method: 'POST', url: '/api/mail',
      headers: { 'x-ccrc-mail-token': TOKEN },
      payload: body as Record<string, unknown> });

  // No runId — the peer lane. Concrete toId: role resolution is
  // mail-routes.test.ts's subject, not this file's.
  const PEER = { fromId: 'demo-quiet-mesa', fromUuid: UUID, toId: 'demo-calm-ridge',
                 kind: 'question', subject: 'peer q', body: 'the body', artifacts: [] };

  /** Ack every outstanding delivery — frees pair/duplicate slots WITHOUT
   *  touching the hourly count, which is a count of ACCEPTED mail rows, not
   *  of outstanding deliveries. (All rows here are still 'queued' — no sweep
   *  runs in this file — and dueDeliveries selects every queued row whose
   *  nextAttemptAt has passed, which a fresh row's default 0 always has.) */
  const ackAll = (coord: CoordStore): void => {
    for (const d of coord.dueDeliveries(Date.now(), 0)) coord.markAcked(d.id, Date.now());
  };

  describe('POST /api/mail — peer-mail bounds (runId === null only)', () => {
    let app: FastifyInstance | undefined;
    afterEach(async () => { if (app) await app.close(); app = undefined; });

    it('refuses the same (fromId,toId,subject) while one is outstanding — 409 duplicate, recorded; an ack clears it', async () => {
      const home = mkTmp('ccrc-peerq-');
      seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge');
      const w = await withMail(home); app = w.app;
      expect((await send(app, PEER)).statusCode).toBe(202);
      const dup = await send(app, PEER);
      expect(dup.statusCode).toBe(409);
      expect(dup.json()).toMatchObject({ ok: false, error: 'duplicate' });
      // "a rejected message is a fact about the fleet" — recorded with WHOSE
      // duplicate it was (the mail_rejections shape, store.ts recordRejection).
      expect(w.coord.rejections().map((r) => [r.code, r.fromId, r.toId, r.subject]))
        .toContainEqual(['duplicate', 'demo-quiet-mesa', 'demo-calm-ridge', 'peer q']);
      // …and nothing extra was queued.
      expect(w.coord.dueDeliveries(Date.now(), 0).length).toBe(1);
      // Outstanding, not forever: acked mail may be restated.
      ackAll(w.coord);
      expect((await send(app, PEER)).statusCode).toBe(202);
    });

    it('refuses a 4th outstanding mail to the same pair — 429 peer-quota, recorded; an ack frees the slot', async () => {
      const home = mkTmp('ccrc-peerq-');
      seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge');
      const w = await withMail(home); app = w.app;
      for (let i = 0; i < PEER_MAIL_MAX_OUTSTANDING; i++) {
        expect((await send(app, { ...PEER, subject: `q ${i}` })).statusCode).toBe(202);
      }
      const overflow = await send(app, { ...PEER, subject: 'one more' });
      expect(overflow.statusCode).toBe(429);
      expect(overflow.json()).toMatchObject({ ok: false, error: 'peer-quota' });
      expect(w.coord.rejections().map((r) => r.code)).toContain('peer-quota');
      ackAll(w.coord);
      expect((await send(app, { ...PEER, subject: 'one more' })).statusCode).toBe(202);
    });

    it('refuses the 13th accepted mail from one sender inside an hour — 429 peer-quota — and the window SLIDES', async () => {
      const home = mkTmp('ccrc-peerq-');
      seed(home, 'demo-quiet-mesa');
      for (const to of ['demo-b', 'demo-c', 'demo-d', 'demo-e', 'demo-f']) seed(home, to);
      const w = await withMail(home); app = w.app;
      // 12 accepted = PEER_MAIL_MAX_OUTSTANDING (3, exactly AT the pair cap,
      // which refuses only the pair's 4th) x 4 recipients = PEER_MAIL_HOURLY.
      for (const to of ['demo-b', 'demo-c', 'demo-d', 'demo-e']) {
        for (let i = 0; i < PEER_MAIL_MAX_OUTSTANDING; i++) {
          expect((await send(app, { ...PEER, toId: to, subject: `q ${i}` })).statusCode).toBe(202);
        }
      }
      // 13th: fresh recipient, fresh subject — only the hourly arm can refuse it.
      const res = await send(app, { ...PEER, toId: 'demo-f', subject: 'one more' });
      expect(res.statusCode).toBe(429);
      expect(res.json()).toMatchObject({ ok: false, error: 'peer-quota' });
      // The window slides — it is `at > now - hour`, not a lifetime count:
      // age every accepted row past the hour and the same send passes.
      w.coord.db.prepare('UPDATE mail SET at = at - 3700000').run();
      expect((await send(app, { ...PEER, toId: 'demo-f', subject: 'one more' })).statusCode).toBe(202);
    });

    it('treats an explicit runId: null exactly as an absent one — the peer lane either way', async () => {
      const home = mkTmp('ccrc-peerq-');
      seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge');
      const w = await withMail(home); app = w.app;
      expect((await send(app, PEER)).statusCode).toBe(202);                      // runId absent
      const dup = await send(app, { ...PEER, runId: null });                      // runId explicit null
      expect(dup.statusCode).toBe(409);
      expect(dup.json()).toMatchObject({ ok: false, error: 'duplicate' });
      expect(w.coord.rejections().map((r) => r.code)).toContain('duplicate');
    });
  });
  ```

- [x] Run it, expect FAIL at module load —
  `SyntaxError: The requested module '../../shared/api.js' does not provide an export named 'PEER_MAIL_HOURLY'`
  (the constants do not exist yet):

  ```bash
  cd server && ./node_modules/.bin/vitest run test/mail-peer-quota.test.ts
  ```

- [x] Add the L0 pieces. In `shared/api.ts`, extend `MAIL_REJECT_CODES` (`:3012-3021`) — the
  ingress group, because a quota-refused message never becomes a `mail` row:

  ```ts
  export const MAIL_REJECT_CODES = [
    // ingress
    'unauthenticated', 'unknown-sender', 'stale-uuid', 'registry-unmeasurable',
    'unknown-recipient', 'unknown-run', 'oversize', 'bad-kind',
    // ingress — peer-mail bounds (Build 9b wave 0, D10): `runId === null`
    // traffic only; run mail is deliberately untouched and pinned dark
    // (server/test/mail-peer-quota.test.ts). 'duplicate' is one word and so
    // invisible to mail-routes.test.ts's kebab-token scan BY CONSTRUCTION
    // (it matches only hyphenated tokens — same standing note that union's
    // docstring already makes for 'paused'); the both-directions membership
    // scan still covers it.
    'duplicate', 'peer-quota',
    // delivery
    'undeliverable',
    // done-authority
    'stale-tip', 'tip-unmeasurable', 'branch-unmeasurable', 'pr-regressed', 'pr-unmeasurable',
    'no-handoff-commit',
  ] as const;
  ```

  And directly after `MAIL_ARTIFACT_PATH_MAX_BYTES` (`:2725`):

  ```ts
  /**
   * Peer-mail producer bounds (Build 9b wave 0, spec D10 hole 2) —
   * `runId === null` traffic ONLY; run mail is bounded by its run's own
   * lifecycle and is deliberately untouched (the dark-behavior pin in
   * `server/test/mail-peer-quota.test.ts` holds that door shut). "Bound the
   * producer, never the record": nothing in the tree DELETEs from `mail` or
   * `mail_deliveries`, so the only sustainable cap is at the ingress. Three
   * arms, two codes: same (fromId,toId,subject) outstanding → 409
   * 'duplicate'; PEER_MAIL_MAX_OUTSTANDING outstanding per (fromId,toId)
   * pair, or PEER_MAIL_HOURLY ACCEPTED sends per sender per hour → 429
   * 'peer-quota'. "Outstanding" is `queued`/`delivered` unacked (an ack
   * frees the slot); the hourly arm counts accepted rows regardless of
   * delivery state (an ack does not refund the hour). L0 because both sides
   * name them: the route enforces, and a peer client showing remaining
   * headroom must not carry a second copy of a policy number
   * (`MAIL_MAX_ATTEMPTS`'s own argument).
   */
  export const PEER_MAIL_MAX_OUTSTANDING = 3;
  export const PEER_MAIL_HOURLY = 12;
  ```

- [x] Run again, expect FAIL differently — the file now loads; 4 failed, with the quota
  assertions receiving `202` where `409`/`429` was demanded (the route does not check anything
  yet). This intermediate run is the proof the tests test the ROUTE, not the constants:

  ```bash
  cd server && ./node_modules/.bin/vitest run test/mail-peer-quota.test.ts
  ```

- [x] Write the store methods. In `server/src/coord/store.ts`, directly after the (Task 1)
  `hasOutstandingMail` method's closing brace, insert:

  ```ts
  /** Whether an OUTSTANDING peer mail with this exact (fromId, toId, subject)
   *  triple exists — the 409 'duplicate' probe (Build 9b wave 0, D10 hole 2).
   *  `runId IS NULL` scopes it to the peer lane by construction; run mail has
   *  its own dedupe (`hasOutstandingMail` above, via `queueSystemMail`) keyed
   *  WITHOUT the sender, because the coordinator is its only sender. `toId`
   *  here is the RESOLVED recipient — the id `mail_deliveries.toId` actually
   *  carries — never the pre-resolution role. */
  hasOutstandingPeerDuplicate(fromId: string, toId: string, subject: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 AS x FROM mail m JOIN mail_deliveries d ON d.mailId = m.id ' +
      'WHERE m.runId IS NULL AND m.fromId = ? AND d.toId = ? AND m.subject = ? ' +
      `AND d.state IN ${OUTSTANDING_STATES_SQL} LIMIT 1`,
    ).get(fromId, toId, subject);
    return row !== undefined;
  }

  /** How many peer mails from `fromId` to `toId` are OUTSTANDING (`queued` or
   *  `delivered`, unacked) — the pair arm of the 429 'peer-quota' bound. An
   *  ack or a park frees the slot: the bound is on standing pressure against
   *  one recipient, not on history (the hourly arm below is the one history
   *  bound, and it deliberately uses a different denominator). */
  outstandingPeerCount(fromId: string, toId: string): number {
    return (this.db.prepare(
      'SELECT COUNT(*) AS n FROM mail m JOIN mail_deliveries d ON d.mailId = m.id ' +
      `WHERE m.runId IS NULL AND m.fromId = ? AND d.toId = ? AND d.state IN ${OUTSTANDING_STATES_SQL}`,
    ).get(fromId, toId) as { n: number }).n;
  }

  /** How many peer mails `fromId` has had ACCEPTED in the sliding hour before
   *  `now` — the per-sender arm of the 429 'peer-quota' bound. Counts `mail`
   *  ROWS (inserts), not deliveries and not delivery state: a refusal inserts
   *  no row and charges nothing; an ack does not refund the hour. `now` is
   *  the caller's clock, passed in rather than read here — the same
   *  policy-stays-with-the-caller reason `dueDeliveries`/`capsUsage` already
   *  take theirs. */
  peerMailInLastHour(fromId: string, now: number): number {
    return (this.db.prepare(
      'SELECT COUNT(*) AS n FROM mail WHERE runId IS NULL AND fromId = ? AND at > ?',
    ).get(fromId, now - 3_600_000) as { n: number }).n;
  }
  ```

- [x] Write the route check. In `server/src/coord/routes.ts`, first widen the shared import
  (`:17-21`):

  ```ts
  import {
    isRunState, isSendableMailKind, MAIL_ARTIFACTS_MAX, MAIL_ARTIFACT_PATH_MAX_BYTES, MAIL_BODY_MAX_BYTES,
    MAIL_SUBJECT_MAX_BYTES, PEER_MAIL_HOURLY, PEER_MAIL_MAX_OUTSTANDING, RUN_TRANSITIONS,
    type LifecycleQueryResult, type MailRejectCode, type RunState,
    type RunSummary,
  } from '../../../shared/api.js';
  ```

  Then insert check 9 between the `'coordinator'`-resolution refusal (its closing `}` at `:514`)
  and the `// One tx: insert the mail row…` comment (`:516`):

  ```ts
    // 9: peer-mail bounds — `runId === null` ONLY (Build 9b wave 0, D10 hole
    // 2). Run mail is bounded by its run's own lifecycle and stays
    // byte-identical (the dark pin in mail-peer-quota.test.ts). Nothing ever
    // DELETEs from mail/mail_deliveries — "bound the producer, never the
    // record" — so the cap lives here at the door or nowhere.
    //
    // Placed LAST, deliberately bending this route's cheap-before-expensive
    // rule, for two reasons: the pair and the dedupe are keyed on the
    // RESOLVED recipient — the id mail_deliveries.toId actually joins on,
    // which does not exist before check 8 and the role resolution above —
    // and a quota verdict is only ever computed for a sender attribution has
    // already proven current (checks 5.5/6): a stale-uuid request keeps
    // getting its own 403, never a 429 charged against the id it presented.
    //
    // 'duplicate' first: the most specific refusal — "your message is
    // already queued" tells the caller not to resend at all, where
    // 'peer-quota' invites a retry later.
    if (runId === null) {
      if (coord.hasOutstandingPeerDuplicate(fromId, resolvedToId, subject)) {
        return refuse(reply, 409, 'duplicate', { fromId, fromUuid, toId, kind, subject, runId },
          `an outstanding peer mail from ${fromId} to ${resolvedToId} with this subject is already queued`);
      }
      if (coord.outstandingPeerCount(fromId, resolvedToId) >= PEER_MAIL_MAX_OUTSTANDING) {
        return refuse(reply, 429, 'peer-quota', { fromId, fromUuid, toId, kind, subject, runId },
          `${PEER_MAIL_MAX_OUTSTANDING} peer mails from ${fromId} to ${resolvedToId} are already outstanding`);
      }
      if (coord.peerMailInLastHour(fromId, Date.now()) >= PEER_MAIL_HOURLY) {
        return refuse(reply, 429, 'peer-quota', { fromId, fromUuid, toId, kind, subject, runId },
          `${fromId} has sent ${PEER_MAIL_HOURLY} peer mails in the last hour`);
      }
    }
  ```

- [x] Run, expect PASS (4 passed):

  ```bash
  cd server && ./node_modules/.bin/vitest run test/mail-peer-quota.test.ts
  ```

- [x] Mutant ceremony, one per arm:
  1. In `peerMailInLastHour`, change `AND at > ?` to `AND 1=1` (the parameter still binds — SQLite
     tolerates an unused `?` only if removed, so also drop the `now - 3_600_000` argument to
     `.get(fromId)`). Run `test/mail-peer-quota.test.ts`: expect **1 failed** — the hourly test's
     window-slide assertion (`expected 429 to be 202` after the backdate). Revert; re-run; 4 passed.
  2. In the route's pair arm, change `>=` to `>`. Run: expect **1 failed** — the pair test's 4th
     send lands `202` where `429` was demanded. Revert; re-run; 4 passed.

- [x] Run the both-directions scanner — this is the suite that forces the L0 edit and the route
  emit into ONE commit (a declared code nobody emits is red in the forward direction):

  ```bash
  cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts test/single-definition.test.ts
  ```

  Both green. (`'peer-quota'` passes the kebab scan as a `MAIL_REJECT_CODES` member;
  `'duplicate'` is one word and invisible to that scan by construction — the membership scan
  covers it.)

- [x] Commit (one commit — shared + store + route + tests move together):

  ```bash
  cd <repo-root> && git add shared/api.ts server/src/coord/store.ts server/src/coord/routes.ts server/test/mail-peer-quota.test.ts && git commit -m "server(wave0): peer mail is bounded at the door — one of a kind, three a pair, twelve an hour

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 4: the dark-behavior pin — run mail passes byte-identical, thirteen times over

Wave 0 ships dark: **no existing caller may be able to tell it happened.** The only existing
producer sends `runId`-carrying mail (`queueSystemMail`, and any operator curl naming a run), and
Task 3's whole check is fenced behind `runId === null` — but a fence nobody pins is a fence the
next refactor "simplifies" away. This task writes the tests that go red the day the quotas leak
onto run traffic, plus the reverse-bleed pin (run traffic must not charge the peer budget), and
closes the wave with the full targeted verification sweep.

**Files:**
- Modify: `server/test/mail-peer-quota.test.ts` (append one describe — harness already in the file)

**Interfaces:**
- Consumes: everything Task 3 produced; `CoordStore.openRun` (`store.ts`, the
  `coord-store.test.ts:18-20` shape); `CoordStore.rejections()` (`store.ts:1493`).
- Produces: tests only — the pin later waves (5–8) rely on when they name this route in skills
  and briefs: run-mail semantics are frozen at today's bytes.

**Steps:**

- [x] Write the failing-by-mutant tests (they PASS against Task 3's tree — that is the point of a
  dark pin; the mutant step below is their red). Append to `server/test/mail-peer-quota.test.ts`:

  ```ts
  describe('run mail is DARK — the bounds structurally cannot touch runId-carrying traffic (D10)', () => {
    let app: FastifyInstance | undefined;
    afterEach(async () => { if (app) await app.close(); app = undefined; });

    const openRun = (coord: CoordStore) =>
      coord.openRun({ program: 'build9b', title: 'Wave 0 dark pin', project: 'demo',
                      wave: 1, waveOf: 1, claimedBy: 'demo-coordinator' }) as { id: number };

    it('13 identical run mails — one pair, one subject, one hour — are all accepted, none recorded', async () => {
      const home = mkTmp('ccrc-peerq-');
      seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge');
      const w = await withMail(home); app = w.app;
      const r = openRun(w.coord);
      // ONE loop that violates ALL THREE peer bounds at once — the same
      // triple every time (duplicate), far past 3 outstanding to one pair,
      // past 12 in the hour — and every send is accepted with the same body
      // the route answered before this wave existed. 13 = PEER_MAIL_HOURLY+1
      // so the loop provably crosses the widest bound, not just the pair.
      for (let i = 0; i < PEER_MAIL_HOURLY + 1; i++) {
        const res = await send(app, { ...PEER, runId: r.id, kind: 'status', subject: 'wave-brief' });
        expect(res.statusCode).toBe(202);
        expect(res.json()).toMatchObject({ ok: true, id: expect.any(Number) });
      }
      expect(w.coord.rejections()).toEqual([]);          // no refusal was even RECORDED
      expect(w.coord.dueDeliveries(Date.now(), 0).length).toBe(PEER_MAIL_HOURLY + 1);
    });

    it('a FULL peer ledger does not shadow run mail — same pair, same subject, cap already spent', async () => {
      // THE mutant catcher for `if (runId === null)` itself. The store
      // probes are ALSO scoped `runId IS NULL`, so bare run mails sail
      // through even a leaked fence (their own rows never count) — the test
      // above cannot see that mutant. What a leaked fence DOES break is
      // this: a sender whose peer ledger is already full sending a RUN mail
      // through the same pair with the same subject — every peer bound
      // would refuse it, reading the standing peer rows.
      const home = mkTmp('ccrc-peerq-');
      seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge');
      const w = await withMail(home); app = w.app;
      // Spend the pair cap and leave 'peer q' outstanding.
      expect((await send(app, PEER)).statusCode).toBe(202);
      for (let i = 1; i < PEER_MAIL_MAX_OUTSTANDING; i++) {
        expect((await send(app, { ...PEER, subject: `q ${i}` })).statusCode).toBe(202);
      }
      // A run mail across the same pair, SAME subject as an outstanding peer
      // mail: with the fence honest this is 202; with the fence leaked, the
      // duplicate arm answers 409 off the peer row.
      const r = openRun(w.coord);
      const res = await send(app, { ...PEER, runId: r.id, kind: 'status' });
      expect(res.statusCode).toBe(202);
      expect(w.coord.rejections()).toEqual([]);
    });

    it('run traffic never charges the peer hourly budget — 12 run mails, then a peer mail still passes', async () => {
      const home = mkTmp('ccrc-peerq-');
      seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge');
      const w = await withMail(home); app = w.app;
      const r = openRun(w.coord);
      for (let i = 0; i < PEER_MAIL_HOURLY; i++) {
        expect((await send(app, { ...PEER, runId: r.id, kind: 'status', subject: `run ${i}` }))
          .statusCode).toBe(202);
      }
      // The sender's peer-hour stands at 0 — `peerMailInLastHour` counts
      // `runId IS NULL` rows only. If run rows bled into it, this send would
      // be the "13th" and 429.
      expect((await send(app, PEER)).statusCode).toBe(202);
    });
  });
  ```

- [x] Run, expect PASS (7 passed — Task 3's four plus these three; a dark pin passing on the
  honest tree is the pin working, not the pin missing):

  ```bash
  cd server && ./node_modules/.bin/vitest run test/mail-peer-quota.test.ts
  ```

- [x] Mutant ceremony — the fence's own red, both directions:
  1. In `routes.ts` check 9, change `if (runId === null) {` to `if (true) {` (the bounds now
     police everything). Run `test/mail-peer-quota.test.ts`: expect **1 failed** — the
     full-peer-ledger test's run mail lands `409` where `202` was demanded (the duplicate arm read
     the standing peer row). The 13-run-mails test deliberately stays GREEN under this mutant —
     bare run mails create no `runId IS NULL` rows for the probes to count — which is exactly why
     the full-ledger test exists; if the full-ledger test does NOT go red here, the pin is
     decorative and must be fixed before proceeding. Revert; re-run; 7 passed.
  2. In `store.ts` `peerMailInLastHour`, delete `runId IS NULL AND ` from the WHERE clause. Run:
     expect **1 failed** — the reverse-bleed test's final peer send lands `429` (12 run rows just
     charged the peer hour). Revert; re-run; 7 passed.

- [x] Close the wave with the full targeted sweep — everything wave 0 touched, foreground,
  generous timeout:

  ```bash
  cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts test/mail-peer-quota.test.ts test/mail-routes.test.ts test/mail-sweep.test.ts test/coord-store.test.ts test/run-routes.test.ts test/coordinator-skill.test.ts test/single-definition.test.ts
  cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
  ```

  All green. (`coordinator-skill.test.ts` is in the list as the route-parity witness: wave 0
  registered no route, so it must pass with NO edit — if it is red, this wave leaked a route and
  the diff is wrong, not the test. Known load flakes re-run in isolation before being read as
  real.)

- [x] Full-package confirmation (the wave's exit gate; foreground, `timeout ≥ 600000ms`):

  ```bash
  cd server && npm run test
  ```

- [x] Commit:

  ```bash
  cd <repo-root> && git add server/test/mail-peer-quota.test.ts && git commit -m "test(wave0): the bounds are pinned dark — run mail passes byte-identical, thirteen times over

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

**Wave 0 exit state:** four commits, server-only, dark. The mail table's dedupe reader answers the
null arm; both stragglers among the `mail_deliveries` writers carry the same terminality guard as
their siblings, and the replay counter's caller can no longer mistake a parked row for headroom;
the ingress bounds a producer that does not exist yet; and the pin that proves the existing
producer cannot tell. Wave 1 (L0 types) builds on `MAIL_REJECT_CODES`'s two new members and the two
`PEER_MAIL_*` constants being already present in `shared/api.ts` — its "all `shared/api.ts`
additions in one commit" covers the REMAINING L0 surface (`PeerSummary`, `ClaimSummary`,
`PEER_ETIQUETTE`, `CLAIM_STATES`, the claim/ledger constants, `LC_REFUSAL_WORD`), not these, which
the spec's own wave-0 row ("the two new reject codes + quotas") claims for this wave.
# Section: Wave 1 — the L0 slice (Task 5)

Spec §5 wave 1: *"All `shared/api.ts` additions in one commit. Dark (types only)."* Build 9a
already shipped the journal half of that wave — `LifecycleAct`/`LifecycleOutcome`/`ActorClass`/
`corroboration()`/`LifecycleEvent`/`LC_REFUSAL_WORD` and the `LC_*` ceilings all sit at
`shared/api.ts:3572-4386` on `main`. **This task ships only the unshipped half**: the peers,
claims and deviation-ledger vocabulary (spec §2 `shared/`, decisions D9-D14), one commit,
zero behaviour change, zero routes, zero imports.

Two ownership boundaries, settled here so the executor does not double-land anything:

- **`MAIL_REJECT_CODES` gains `'duplicate'` and `'peer-quota'` in WAVE 0's commit, not this
  one, whenever wave 0 executed first** (it is Tasks 1-4 of this plan and spec §5 orders it
  first). The mechanism that forces this: `server/test/mail-routes.test.ts:355-371` requires
  every declared ingress code to be *emitted* somewhere in `server/src/coord`, and the kebab
  scanner at `:383-447` requires every emitted hyphenated token to be *declared* — so the codes
  and their emitters can only land green in ONE commit, and that commit is the mail-hardening
  one. Step 4 below verifies they landed and carries the exact fallback edit for the one case
  where this plan's wave 0 section somehow shipped without them (its own suite would have been
  red, so treat that arm as an escalation signal, not a normal path).
- Same reasoning, softer force, for `PEER_MAIL_MAX_OUTSTANDING` / `PEER_MAIL_HOURLY`: wave 0's
  quota enforcement consumes them, so its drafter may have declared them. `tsc` refuses a
  duplicate `const` loudly, and step 1's sweep tells you which arm you are in before you paste
  anything.

`LC_REFUSAL_WORD` is in the contract's L0 list but **already shipped in 9a**
(`shared/api.ts:4226`) — verified below, not re-declared.

---

### Task 5: The L0 slice — peers, claims and the ledger get their words

**Files:**
- Modify: `shared/api.ts` — append after `compareGenerations`'s closing brace
  (`shared/api.ts:4383-4386`, the current end of file). Verify-only (gated): the
  `MAIL_REJECT_CODES` table at `shared/api.ts:3012-3021`.
- Create: `server/test/peers-claims-l0.test.ts`

**Interfaces:**

*Consumes:*
- `SessionLifecycle` (`shared/api.ts:1050-1052`) — `PeerSummary.lifecycle`'s type; same file,
  no import.
- The as-const table idiom of `MAIL_REJECT_CODES` (`shared/api.ts:3012-3022`) — the array is
  the single definition, the type derives — copied for `CLAIM_STATES` and
  `DEVIATION_ALLOC_STATES`, per the interface contract's own spelling.
- The `PR_REASON_MAP` narrowing discipline (`shared/api.ts:298-342`): `unknown` parameter,
  constant cast rather than input, exactly one narrowing door per vocabulary.
- (verification only) Wave 0's landed `'duplicate'` / `'peer-quota'` members and — if that
  section declared them — the two peer-mail quota constants.

*Produces* (every later section writes against these exact names):
```ts
// peers (D9, D17)
export type PeerDeliverable = 'yes' | 'unknown' | `no:${string}`;
export function isPeerDeliverable(v: unknown): v is PeerDeliverable;
export interface PeerSummary {
  readonly id: string;                       readonly uuid: string | null;
  readonly project: string | null;           readonly workspace: string | null;
  readonly branch: string | null;            readonly wrapper: string | null;
  readonly lifecycle: SessionLifecycle;      readonly deliverable: PeerDeliverable;
  readonly archivedAt: number | null;        readonly archivedReason: string | null;
  readonly archivedStale: boolean;           readonly held: string | null;
  readonly intent: string | null;
}
export const PEER_ETIQUETTE: readonly [string, string, string, string, string];

// claims (D11, D12)
export const CLAIM_STATES = ['live', 'released', 'lapsed', 'broken'] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];
export function isClaimState(v: unknown): v is ClaimState;
export interface ClaimSummary {
  readonly id: number;                       readonly project: string;
  readonly paths: readonly string[];         readonly heldBy: string;
  readonly heldByUuid: string | null;        readonly intent: string;
  readonly runId: number | null;             readonly state: ClaimState;
  readonly createdAt: number;                readonly renewedAt: number;
  readonly expiresAt: number;                readonly hardExpiresAt: number;
  readonly endedAt: number | null;           readonly endedBy: string | null;
}
export interface ClaimConflict {
  readonly path: string;                     readonly claimedPath: string;
  readonly claimId: number;                  readonly heldBy: string;
  readonly heldByUuid: string | null;        readonly intent: string;
  readonly runId: number | null;             readonly expiresAt: number;
  readonly deliverable: PeerDeliverable;
  readonly mailHint: { readonly toId: string; readonly subject: string } | null;
}

// ledger (D13)
export const DEVIATION_ALLOC_STATES = ['allocated', 'landed'] as const;
export type DeviationAllocState = (typeof DEVIATION_ALLOC_STATES)[number];
export function isDeviationAllocState(v: unknown): v is DeviationAllocState;
export interface DeviationAllocation {
  readonly project: string;                  readonly n: number;
  readonly title: string;                    readonly allocatedTo: string;
  readonly runId: number | null;             readonly allocatedAt: number;
  readonly state: DeviationAllocState;       readonly landedAt: number | null;
  readonly landedIn: string | null;          readonly stale: boolean;   // DERIVED at read, never stored
}

// the numbers (all ms unless the name says BYTES; no bash twins — ccd never sees any of these)
export const CLAIM_LEASE_MS = 45 * 60_000;             // 2_700_000
export const CLAIM_HARD_CAP_MS = 8 * 60 * 60_000;      // 28_800_000
export const CLAIM_INTENT_MAX_BYTES = 512;
export const LEDGER_SEED_GAP = 50;
export const LEDGER_STALE_MS = 7 * 24 * 60 * 60_000;   // 604_800_000
export const PEER_MAIL_MAX_OUTSTANDING = 3;
export const PEER_MAIL_HOURLY = 12;

// mail (D10) — verified present, owned by wave 0's commit:
// MAIL_REJECT_CODES now contains 'duplicate' and 'peer-quota'
```

Design rulings baked into these shapes (each traceable to a spec clause, stated once here so
review does not re-litigate them):

1. **`PeerDeliverable` has THREE arms.** The contract line names the `'yes'`/`'no:<reason>'`
   string forms; D9 rules explicitly that *"`'unknown'` (registry unmeasurable) is **not**
   `'no'`"* — a third condition a caller handles differently, so a third value. The `no:`
   reason suffix is open on the wire (absence-permits: a newer server may name a rung this
   build has not met); the guard, not the type, refuses an EMPTY reason.
2. **`'stale'` is not a stored ledger state.** D13 says *marks* `allocated → landed` but
   *reported* for stale — and D4's doctrine (an orphaned intent is derived by the reader over
   a pair of rows, never stored) settles it: `DEVIATION_ALLOC_STATES` is the two stored
   states, and `DeviationAllocation.stale` is derived at read time from `allocatedAt`,
   `state` and the clock.
3. **`PEER_ETIQUETTE` is five rules, one per primitive** — claims, discovery, history, mail,
   ledger. Spec D17's clause-11 cell lists seven clause fragments; the five-rule partition
   groups them by the mechanism each teaches (claim + 409-is-the-address are one rule about
   claiming; history + read-the-row's-own-lifecycle are one rule about history).
4. **Rule 5 does NOT spell the `D-TBD-` literal.** Spec D13's fallback convention is taught in
   long form in `coordinator-skill/references/peer-protocol.md` (wave 8); a literal here would
   be a standing tree-wide false positive for wave 7's `dtbd.test.ts` detector. (Waves 7/8
   drafters: the detector must scope to the surfaces where a landed placeholder is a defect,
   and the reference doc must reckon with that scope.)
5. **Etiquette strings are quotable in BOTH skill quoting styles** (D17/D-104): no `"`
   character anywhere (worker clauses are double-quoted bash literals) and no straight
   apostrophe (coordinator clauses are single-quoted; apostrophes are curly, exactly as
   `LC_REFUSAL_WORD`'s copy already does at `shared/api.ts:4230`). Guarded by test, not by
   convention.
6. **`ClaimConflict.mailHint` is an inline `{toId, subject}`,** not a new named type: D12's
   *"it hands you the envelope"*, degraded to `null` exactly when `deliverable` answers
   `'no:<reason>'` — null means "do not mail; escalate to the operator", one condition, said
   beside the `deliverable` that explains it. An `'unknown'` peer keeps its envelope (doubt is
   not undeliverability).
7. **Two constants beyond the contract's list,** each because a number needs one home:
   `CLAIM_INTENT_MAX_BYTES` (D12's "≤512 B" — a separate constant from `LC_REASON_MAX_BYTES`
   on purpose: one is ccd's `--reason` contract with a bash twin, the other a server-only
   route contract; tying them would let a ccd cap change silently rewrite a route refusal)
   and `LEDGER_STALE_MS` (D13's 7 days, consumed by both the reconcile sweep and the route).

#### Steps

- [x] **Step 1 — verify the ground (2 min).** From the repo root, confirm what 9a shipped and
  what this task must not duplicate:

  ```bash
  cd /path/to/ccrc-pwa
  # (a) already shipped in 9a — expect ONE hit each, do NOT re-declare:
  grep -n 'export const LC_REFUSAL_WORD' shared/api.ts
  # (b) this task's names — expect ZERO hits each before this task runs:
  grep -cn 'PeerSummary\|PeerDeliverable\|PEER_ETIQUETTE\|ClaimSummary\|ClaimConflict\|CLAIM_STATES\|DeviationAllocation\|CLAIM_LEASE_MS\|CLAIM_HARD_CAP_MS\|LEDGER_SEED_GAP\|LEDGER_STALE_MS' shared/api.ts || true
  # (c) wave 0's possible declarations — record which arm you are in:
  grep -n 'PEER_MAIL_MAX_OUTSTANDING\|PEER_MAIL_HOURLY' shared/api.ts server/src/coord/*.ts
  # (d) wave 0's reject codes — expect hits in BOTH shared/api.ts and server/src/coord:
  grep -rn "'peer-quota'\|'duplicate'" shared/api.ts server/src/coord/
  ```

  Decision table:
  - (a) one hit → good; the `LC_REFUSAL_WORD` item of the contract is DONE, skip it.
  - (b) any hit → an earlier task landed part of this slice; delete the matching declaration
    from Step 5's block before pasting (TypeScript would refuse the duplicate `const`/`interface`
    loudly regardless — the check here just saves a red compile).
  - (c) hits in `shared/api.ts` → wave 0 declared the quota constants; delete those two lines
    from Step 5's block. Hits only in `server/src/coord/*.ts` as bare numerals → leave Step 5's
    block intact (this task declares them; a wave-0 cleanup to import them is that section's
    listed follow-up, not yours).
  - (d) hits in both → good, Step 4 is verify-only. Hits in neither → see Step 4's fallback arm.

- [x] **Step 2 — write the failing test (5 min).** Create `server/test/peers-claims-l0.test.ts`
  with exactly this content:

  ```ts
  // Build 9b, wave 1 — the L0 slice (spec §2 `shared/`, D9-D14). The peers/
  // claims/ledger vocabulary: every name the unshipped half of build 9 speaks
  // over the wire, declared once, derived once, narrowed at exactly one door.
  //
  // WHAT THIS PINS AND WHY:
  //  - CLAIM_STATES is a TABLE the type derives from (MAIL_REJECT_CODES's
  //    as-const idiom, api.ts:3012) — order included, because wave 7's
  //    migration generates the `claims` CHECK constraint from this array and a
  //    silent reorder is a silent schema rewrite.
  //  - isPeerDeliverable's empty-reason arm: 'no:' with no reason is an
  //    unexplained refusal — the overloaded-value defect at the one seam whose
  //    whole job is the reason (D9/D12).
  //  - PEER_ETIQUETTE is five rules, one per primitive, and quotable in BOTH
  //    skill quoting styles (D17, D-104): no double-quote anywhere, no
  //    straight apostrophe anywhere.
  //  - L0 purity: shared/api.ts imports exactly one thing, a TYPE. The PWA
  //    bundles this file, so a `node:*` import is a broken browser bundle —
  //    vitest runs under node and cannot feel that breakage, which is exactly
  //    why the assertion exists here.
  import { describe, it, expect } from 'vitest';
  import { readFileSync } from 'node:fs';
  import path from 'node:path';
  import { fileURLToPath } from 'node:url';
  import {
    CLAIM_STATES, isClaimState,
    isPeerDeliverable,
    PEER_ETIQUETTE,
    DEVIATION_ALLOC_STATES, isDeviationAllocState,
    CLAIM_LEASE_MS, CLAIM_HARD_CAP_MS, CLAIM_INTENT_MAX_BYTES,
    LEDGER_SEED_GAP, LEDGER_STALE_MS,
    PEER_MAIL_MAX_OUTSTANDING, PEER_MAIL_HOURLY,
    MAIL_REJECT_CODES,
  } from '../../shared/api.js';
  import type {
    ClaimState, PeerDeliverable,
    PeerSummary, ClaimSummary, ClaimConflict, DeviationAllocation,
  } from '../../shared/api.js';

  const here = path.dirname(fileURLToPath(import.meta.url));
  const apiPath = path.resolve(here, '../../shared/api.ts');

  describe('claim states are a table the type derives from', () => {
    it('holds exactly the four states, in declaration order', () => {
      expect(CLAIM_STATES).toEqual(['live', 'released', 'lapsed', 'broken']);
    });

    it('is total in both directions at compile time', () => {
      // TS2741 here the day CLAIM_STATES gains a member this map lacks; TS2353
      // the day the map gains one the array does not have. typecheck-tests
      // compiles this file, so the guarantee is a gate, not a comment.
      const total: Record<ClaimState, true> = {
        live: true, released: true, lapsed: true, broken: true,
      };
      expect(Object.keys(total)).toEqual([...CLAIM_STATES]);
    });

    it('isClaimState is the only narrowing door, and it refuses the near-misses', () => {
      for (const s of CLAIM_STATES) expect(isClaimState(s), s).toBe(true);
      // 'expired' is the word a later edit reaches for; the state is 'lapsed'
      // (D12: lapse, do not delete — an ended claim is history, not garbage).
      expect(isClaimState('expired')).toBe(false);
      expect(isClaimState('')).toBe(false);
      expect(isClaimState(null)).toBe(false);
      expect(isClaimState(undefined)).toBe(false);
    });
  });

  describe('peer deliverability is three answers, not two', () => {
    it('accepts the two bare words and a reasoned no', () => {
      expect(isPeerDeliverable('yes')).toBe(true);
      // D9: registry-unmeasurable is 'unknown', and 'unknown' is NOT 'no' —
      // doubt about a peer is not evidence against it.
      expect(isPeerDeliverable('unknown')).toBe(true);
      const reasoned: PeerDeliverable = 'no:stopped';
      expect(isPeerDeliverable(reasoned)).toBe(true);
      expect(isPeerDeliverable('no:never-started')).toBe(true);
    });

    it('refuses no: with an empty reason — an unexplained no is the overloaded value, not a shorter one', () => {
      expect(isPeerDeliverable('no:')).toBe(false);
      expect(isPeerDeliverable('no')).toBe(false);
    });

    it('refuses non-strings and words outside the shape', () => {
      expect(isPeerDeliverable(null)).toBe(false);
      expect(isPeerDeliverable(true)).toBe(false);
      expect(isPeerDeliverable('maybe')).toBe(false);
      // Shape, not policy: the PRODUCER is held to sweepMail's structural
      // ladder by deliverability-parity.test.ts (wave 7), not by this guard.
    });
  });

  describe('the etiquette is five rules, one per primitive, quotable in both skill styles', () => {
    it('is exactly five rules — the tuple type pins it at compile time too', () => {
      const five: readonly [string, string, string, string, string] = PEER_ETIQUETTE;
      expect(five).toHaveLength(5);
    });

    it('each rule names its mechanism', () => {
      expect(PEER_ETIQUETTE[0]).toContain('409');            // claims
      expect(PEER_ETIQUETTE[1]).toContain('/api/peers');     // discovery
      expect(PEER_ETIQUETTE[2]).toContain('/api/lifecycle'); // history
      expect(PEER_ETIQUETTE[2]).toContain('archive stamp');
      expect(PEER_ETIQUETTE[3]).toContain('human-timescale');// mail
      expect(PEER_ETIQUETTE[4]).toContain('deviation');      // ledger
    });

    it('carries no double-quote and no straight apostrophe (D17/D-104: both skill quoting styles must quote a rule verbatim)', () => {
      for (const rule of PEER_ETIQUETTE) {
        expect(rule, rule).not.toContain('"');
        expect(rule, rule).not.toContain("'");
      }
    });

    it('stays a card, not an essay — it rides every /api/peers answer', () => {
      expect(PEER_ETIQUETTE.join('\n').length).toBeLessThanOrEqual(1200);
    });
  });

  describe('the numbers are the spec numbers, and the lease sits under the cap', () => {
    it('claims: a 45-minute lease under an 8-hour hard cap', () => {
      expect(CLAIM_LEASE_MS).toBe(45 * 60_000);
      expect(CLAIM_HARD_CAP_MS).toBe(8 * 60 * 60_000);
      // The ordering is the invariant, not a restatement: renewal extends the
      // lease and NEVER the cap, so doubt cannot hold forever (D12). Swapping
      // the two constants would invert that silently.
      expect(CLAIM_LEASE_MS).toBeLessThan(CLAIM_HARD_CAP_MS);
    });

    it('intent is capped at 512 bytes', () => {
      expect(CLAIM_INTENT_MAX_BYTES).toBe(512);
    });

    it('ledger: a 50-number seed gap, staleness at 7 days', () => {
      expect(LEDGER_SEED_GAP).toBe(50);
      expect(LEDGER_STALE_MS).toBe(7 * 24 * 60 * 60_000);
    });

    it('peer mail: 3 outstanding per pair, 12 per sender-hour', () => {
      expect(PEER_MAIL_MAX_OUTSTANDING).toBe(3);
      expect(PEER_MAIL_HOURLY).toBe(12);
    });
  });

  describe('the mail table carries the two peer-lane codes (landed with wave 0)', () => {
    it('declares duplicate and peer-quota', () => {
      expect(MAIL_REJECT_CODES).toContain('duplicate');
      expect(MAIL_REJECT_CODES).toContain('peer-quota');
    });
  });

  describe('L0 stays import-free: the PWA bundles this file', () => {
    it('shared/api.ts has exactly one import line, and it is a type', () => {
      const lines = readFileSync(apiPath, 'utf8').split('\n');
      const imports = lines.filter((l) => /^import\s/.test(l));
      expect(imports).toEqual(["import type { Hue } from './roster.js';"]);
    });
  });

  describe('the wire shapes compile as declared (typecheck-tests carries the real teeth)', () => {
    it('a PeerSummary literal is total', () => {
      const peer: PeerSummary = {
        id: 'ccrc-pwa-quiet-river', uuid: null, project: 'ccrc-pwa',
        workspace: 'quiet-river', branch: 'feat/mirror-lens', wrapper: null,
        lifecycle: 'running', deliverable: 'yes',
        archivedAt: null, archivedReason: null, archivedStale: false,
        held: null, intent: null,
      };
      expect(peer.deliverable).toBe('yes');
    });

    it('a ClaimSummary literal is total, and a ClaimConflict carries the envelope', () => {
      const claim: ClaimSummary = {
        id: 7, project: 'ccrc-pwa', paths: ['server/src/coord/store.ts'],
        heldBy: 'ccrc-pwa-quiet-river', heldByUuid: null,
        intent: 'wave 2: store methods for the mirror', runId: null,
        state: 'live', createdAt: 1_756_000_000_000, renewedAt: 1_756_000_000_000,
        expiresAt: 1_756_000_000_000 + CLAIM_LEASE_MS,
        hardExpiresAt: 1_756_000_000_000 + CLAIM_HARD_CAP_MS,
        endedAt: null, endedBy: null,
      };
      const conflict: ClaimConflict = {
        path: 'server/src/coord/store.ts', claimedPath: 'server/src/coord',
        claimId: claim.id, heldBy: claim.heldBy, heldByUuid: null,
        intent: claim.intent, runId: null,
        expiresAt: claim.expiresAt, deliverable: 'yes',
        mailHint: { toId: claim.heldBy, subject: 'claim conflict: server/src/coord/store.ts' },
      };
      expect(conflict.claimId).toBe(7);
    });

    it('a DeviationAllocation literal is total, and stale is derived, never stored', () => {
      expect(DEVIATION_ALLOC_STATES).toEqual(['allocated', 'landed']);
      // D13 says landed rows are MARKED and stale rows are REPORTED — the D4
      // doctrine: a fact about a row and a clock is derived by the reader,
      // never stored, so it cannot disagree with its own inputs.
      expect(DEVIATION_ALLOC_STATES as readonly string[]).not.toContain('stale');
      for (const s of DEVIATION_ALLOC_STATES) expect(isDeviationAllocState(s), s).toBe(true);
      expect(isDeviationAllocState('stale')).toBe(false);
      const row: DeviationAllocation = {
        project: 'ccrc-pwa', n: 999, title: 'mirror cursor is an optimisation',
        allocatedTo: 'ccrc-pwa-quiet-river', runId: null,
        allocatedAt: 1_756_000_000_000, state: 'allocated',
        landedAt: null, landedIn: null, stale: false,
      };
      expect(row.n).toBe(999);
    });
  });
  ```

- [x] **Step 3 — run it, expect FAIL (1 min).** From `server/`, foreground, generous timeout
  (project rule: suites in the foreground, timeout ≥ 600000 ms):

  ```bash
  cd server && ./node_modules/.bin/vitest run test/peers-claims-l0.test.ts
  ```

  Expected failure: the suite dies at import with
  `SyntaxError: The requested module '../../shared/api.js' does not provide an export named 'CLAIM_STATES'`
  (the first missing name wins; the exact name may differ if wave 0 declared the quota
  constants). This is the red that proves the test is wired to the real module, not a copy.

- [x] **Step 4 — the reject-code gate (2 min).** Re-run Step 1(d)'s grep. **Expected arm:**
  hits in both `shared/api.ts` (the declarations) and `server/src/coord/` (the emitters) —
  wave 0 landed them; do nothing, the membership test in Step 2 is now their standing pin.
  **Fallback arm** (zero hits — wave 0's section shipped without them, which means its own
  run of `mail-routes.test.ts` was red and something is wrong upstream — flag it to the
  orchestrator, then): apply this exact edit to `shared/api.ts:3012-3021` so the table reads:

  ```ts
  export const MAIL_REJECT_CODES = [
    // ingress
    'unauthenticated', 'unknown-sender', 'stale-uuid', 'registry-unmeasurable',
    'unknown-recipient', 'unknown-run', 'oversize', 'bad-kind',
    // ingress, peer lane only (D10, runId === null): the quota pair. BOUND THE
    // PRODUCER, NEVER THE RECORD — over-quota is 429 'peer-quota', a standing
    // same-(fromId,toId,subject) pair is 409 'duplicate'; both recorded in
    // `mail_rejections`, and run mail (runId != null) can never earn either.
    'duplicate', 'peer-quota',
    // delivery
    'undeliverable',
    // done-authority
    'stale-tip', 'tip-unmeasurable', 'branch-unmeasurable', 'pr-regressed', 'pr-unmeasurable',
    'no-handoff-commit',
  ] as const;
  ```

  and know that `mail-routes.test.ts:355-371` ("every declared INGRESS code is emitted
  somewhere in server/src/coord") stays red until wave 0's emitters exist — the declaration
  and the emitters belong to one commit, and that commit is wave 0's. Do not commit this
  fallback edit from Task 5.

- [x] **Step 5 — write the implementation (5 min).** Append the following to `shared/api.ts`,
  immediately after `compareGenerations`'s closing brace (current end of file, line 4386).
  Delete any declaration Step 1 found already landed (expected: none; possible: the two
  `PEER_MAIL_*` constants).

  ```ts

  /* ---------------------------------------------------------------------------
   * PEERS, CLAIMS AND THE DEVIATION LEDGER — build 9, §1 (D9-D14). The fleet's
   * PRESENT TENSE, beside the journal's past tense above.
   *
   * The journal answers "what happened"; this vocabulary answers "who is here,
   * who holds what, and what number is free" — synchronously, at the moment of
   * asking, not at merge (spec §0). Nothing here decides anything on its own:
   * `peerDeliverable()` (server/src/peers.ts, L1) produces `PeerDeliverable`,
   * `decideClaim()` (claims.ts) produces the conflict set, `decideAllocation()`
   * (ledger.ts) produces the numbers, and the one compare-and-swap lives in
   * coord.db's synchronous `tx()` (D11). L0 owns only the words.
   * ------------------------------------------------------------------------- */

  /**
   * Can mail reach this peer NOW, as decided by `peerDeliverable()` from the
   * STRUCTURAL rungs of `sweepMail`'s own ladder — registry row measured, tmux
   * verdict, pane pid, lifecycle not stopped/orphan/never-started (D9). The
   * TRANSIENT rungs (cooldown, single-flight latch, unanswered ask, quiet
   * window) stay in `sweepMail`: they are lane state, and reporting them here
   * would tell a caller a BUSY peer is unreachable — the exact lie R2 forbids.
   *
   * THREE ANSWERS, NOT TWO. `'unknown'` is a registry this pass could not
   * measure, and it is NOT `'no'` — doubt about a peer is not evidence against
   * it, the same not-knowing-is-not-death ruling `renewClaims` applies to
   * leases (D12). A `'no'` always carries its reason (`no:stopped`,
   * `no:orphan`, ...); the template type cannot refuse an EMPTY reason, so
   * `isPeerDeliverable` does — an unexplained no is the overloaded value this
   * file's own seam rule forbids, not a shorter one.
   *
   * The reason suffix is OPEN on the wire, deliberately: a newer server naming
   * a rung this build has not met still parses here (absence-permits, one
   * reader). The PRODUCER is held to the ladder by
   * `deliverability-parity.test.ts` (D9), never by this type.
   */
  export type PeerDeliverable = 'yes' | 'unknown' | `no:${string}`;

  export function isPeerDeliverable(v: unknown): v is PeerDeliverable {
    if (v === 'yes' || v === 'unknown') return true;
    return typeof v === 'string' && v.startsWith('no:') && v.length > 'no:'.length;
  }

  /**
   * One row of `GET /api/peers` (D9) — a same-project session as the route
   * measured it THIS pass. The route reports; it never filters: `archivedAt`
   * is the registry stamp VERBATIM and decides nothing, because a field that
   * is silently false (four measured rows at design time) must not be
   * laundered into a filter. `archivedStale` NAMES the contradiction —
   * stamped archived, measured live — and the same predicate feeds
   * `divergence.archived-but-live`; an adapter may not narrow a distinction
   * it received.
   *
   * `lifecycle` is the row's OWN present tense (etiquette rule 3: read it,
   * never the stamp) and is never null — `'unmeasurable'` is the honest word
   * when the ladder could not run, and a route that measured nothing reports
   * that word, not an absence. `intent` is the holder's most recently renewed
   * live claim's stated intent — the REPLACEMENT (D12) for the ai-title
   * signal `sweepNames` freezes on held rows: a branch name is written once,
   * an intent can be written every ten minutes. Null = no live claim; one
   * condition, not an overload.
   */
  export interface PeerSummary {
    readonly id: string;
    /** From `$REG/<id>.uuid`; null = unmeasured, never "no uuid". */
    readonly uuid: string | null;
    readonly project: string | null;
    /** The worktree slug; null for a project's main checkout —
     *  `FleetSession.workspace`'s exact contract (:37). */
    readonly workspace: string | null;
    readonly branch: string | null;
    readonly wrapper: string | null;
    readonly lifecycle: SessionLifecycle;
    readonly deliverable: PeerDeliverable;
    /** Epoch SECONDS as the registry wrote it, verbatim, or null. DECIDES
     *  NOTHING (D9). */
    readonly archivedAt: number | null;
    readonly archivedReason: string | null;
    /** Stamped archived AND measured live this pass. */
    readonly archivedStale: boolean;
    /** The `.hold` text verbatim, or null — `FleetSession.held`'s contract. */
    readonly held: string | null;
    readonly intent: string | null;
  }

  /**
   * The five rules, one per primitive — claims, discovery, history, mail, the
   * ledger. THE PRIMARY HOME IS THE ROUTE RESPONSE (D17): a skill reaches a
   * config dir only once its installer has run there (D-107), so a session
   * that can discover peers is handed the rules in the same answer, installer
   * or no installer — and this text cannot go stale relative to the route
   * that serves it. Worker clause 11 and coordinator clause 10 SAY these
   * rules in their own words; they do not define them.
   *
   * QUOTABLE IN BOTH SKILL STYLES, AND THAT IS A GUARD, NOT A PREFERENCE
   * (D17, D-104): worker clauses are double-quoted bash literals — no `"`
   * character may appear in a rule — and coordinator clauses are
   * single-quoted — apostrophes must be curly, as `LC_REFUSAL_WORD`'s copy
   * above already writes them. `peers-claims-l0.test.ts` holds both, so a
   * rule edited into unquotability reds here before a skill wave trips on it.
   */
  export const PEER_ETIQUETTE = [
    'Claim before you edit: POST /api/claims names every path you will touch, all-or-nothing, and a 409 names the holder — the 409 is the address, not a rejection to work around.',
    'Discovery is GET /api/peers?of=<your id> — the peers you cannot see from your own session list are the ones this route exists for.',
    'History is GET /api/lifecycle. Read each row’s own lifecycle, never its archive stamp — the stamp is reported verbatim and decides nothing.',
    'Peer mail is human-timescale: a busy peer reads it when it next idles, and losing a race is learned from the 409 you are already reading, never from mail.',
    'Never invent a deviation number. POST /api/ledger/deviations allocates; a server you cannot reach is a mechanical blocker to report, not a licence to guess.',
  ] as const;

  /**
   * A claim's four states, AS A TABLE THE TYPE DERIVES FROM — the
   * `MAIL_REJECT_CODES` as-const idiom (:3012) rather than the union-first
   * `PR_REASON_MAP` one, because wave 7's migration generates the `claims`
   * table's CHECK constraint from THIS array: the array is the single
   * definition and the type follows it, so a reorder or a rename is a schema
   * edit a reviewer can see.
   *
   * `'live'` is the only non-terminal state. The other three are three
   * different ends a reader handles differently (no overloaded terminal):
   * `'released'` — the holder said done, or its run's close did;
   * `'lapsed'` — the lease ran out, `endedBy` says why (a holder measured
   * gone is `'session-gone'`; the 8 h hard cap is what no measurement can
   * extend); `'broken'` — the operator door, `POST /api/claims/:id/break`,
   * the one claims route the claimant is not the one to walk through (D16).
   * LAPSE, DO NOT DELETE (D12): an ended claim is a row with an end, and
   * `GET /api/claims?all=1` shows "held by X until it died". A destroyed
   * claim is destroyed history.
   */
  export const CLAIM_STATES = ['live', 'released', 'lapsed', 'broken'] as const;
  export type ClaimState = (typeof CLAIM_STATES)[number];

  export function isClaimState(v: unknown): v is ClaimState {
    return typeof v === 'string' && (CLAIM_STATES as readonly string[]).includes(v);
  }

  /**
   * One claim as coord.db holds it and `GET /api/claims` reports it.
   * ADVISORY, NEVER ENFORCING (D12) — nothing in ccd knows this row exists
   * (`claims-advisory.test.ts` holds that at zero references), and its loss
   * is FREE by construction: no flat file backs it, every lease is bounded,
   * and the pre-feature state is "no claims". Sessions lose protection,
   * never work.
   *
   * `paths` is the ALL-OR-NOTHING set as claimed: five paths, one conflict,
   * zero acquired. `expiresAt` is the lease `renewClaims` renews while the
   * holder measures RUNNING (registry unmeasurable reads as HELD — doubt is
   * not death); `hardExpiresAt` is NEVER renewed, so doubt cannot hold
   * forever. `endedBy` is display/forensic — `Divergence.detail`'s contract:
   * written by the closer (`'session-gone'`, the run close, the break door),
   * parsed back by nothing.
   */
  export interface ClaimSummary {
    /** coord.db's own row id — the `:id` of release and break. */
    readonly id: number;
    readonly project: string;
    readonly paths: readonly string[];
    readonly heldBy: string;
    readonly heldByUuid: string | null;
    /** <= `CLAIM_INTENT_MAX_BYTES`; re-POSTing the same paths re-writes it
     *  AND renews the lease. Rendered on `PeerSummary`, the HotFilesStrip
     *  and the session line — the signal that replaces the frozen ai-title
     *  (D12). */
    readonly intent: string;
    readonly runId: number | null;
    readonly state: ClaimState;
    /** Epoch ms, the SERVER's clock — a claim exists only in coord.db, so
     *  for once the server's clock IS the event's clock. */
    readonly createdAt: number;
    readonly renewedAt: number;
    readonly expiresAt: number;
    readonly hardExpiresAt: number;
    readonly endedAt: number | null;
    readonly endedBy: string | null;
  }

  /**
   * One entry of the 409's conflict list — `POST /api/claims` refuses
   * all-or-nothing and names EVERY conflicting path, not the first (D12).
   *
   * THE CONFLICT RESPONSE IS ITSELF AN ADDRESS: the measured conflict record
   * proves awareness alone does not prevent a collision (spec §0, class 8),
   * so the mechanism does not stop at telling you — it hands you the
   * envelope. `mailHint` is pre-addressed to the holder; it is null exactly
   * when `deliverable` answers `'no:<reason>'` — the hint degrades to
   * "escalate to the operator", never to a silent send. An `'unknown'` peer
   * keeps its envelope: doubt is not undeliverability (D9).
   *
   * `path` is what the REQUEST asked for; `claimedPath` is the standing
   * claim's path it collided with. They differ under directory containment —
   * `shared/api.ts` collides with a claim on `shared/` and vice versa, which
   * no index can express and is why the in-transaction read is the CAS
   * (D11).
   */
  export interface ClaimConflict {
    readonly path: string;
    readonly claimedPath: string;
    readonly claimId: number;
    readonly heldBy: string;
    readonly heldByUuid: string | null;
    readonly intent: string;
    readonly runId: number | null;
    readonly expiresAt: number;
    readonly deliverable: PeerDeliverable;
    readonly mailHint: { readonly toId: string; readonly subject: string } | null;
  }

  /**
   * The deviation ledger's two STORED states. `'stale'` is deliberately not
   * here: a number allocated and never landed for `LEDGER_STALE_MS` is
   * REPORTED, never marked — D13 says "marks allocated → landed" but only
   * "reported" for stale, and D4's doctrine settles the difference: a fact
   * about a row and a clock is DERIVED BY THE READER, never stored, so it
   * cannot disagree with its own inputs, and a stale number that finally
   * lands needs no un-marking transition nothing else has.
   */
  export const DEVIATION_ALLOC_STATES = ['allocated', 'landed'] as const;
  export type DeviationAllocState = (typeof DEVIATION_ALLOC_STATES)[number];

  export function isDeviationAllocState(v: unknown): v is DeviationAllocState {
    return typeof v === 'string' && (DEVIATION_ALLOC_STATES as readonly string[]).includes(v);
  }

  /**
   * One allocated deviation number, as `GET /api/ledger` reports it. The row
   * is AUTHORITATIVE with a flat-file ground truth (D8): appended to
   * `~/.ccrc/ledger-alloc.log` FIRST, committed SECOND, recovered as
   * `MAX(file, db)` — a number is skipped, never reissued. Gaps cost
   * nothing (the ledger is prose, parsed by nothing); a reissue cost 394
   * rewritten D-ref lines across 30 files under merge pressure.
   *
   * `'landed'` means the number appears in a plan in the MAIN checkout
   * (`sweepLedgerReconcile`) — genuinely merged, the signal the incident
   * lacked. `stale` is DERIVED at read time from `allocatedAt`, `state` and
   * the clock, never stored (see `DEVIATION_ALLOC_STATES`); it rides the
   * wire so a phone can see it without owning a clock policy.
   */
  export interface DeviationAllocation {
    readonly project: string;
    /** The number itself — `PRIMARY KEY (project, n)` in the mirror, the
     *  loud backstop if a refactor ever loses the transaction (D11). */
    readonly n: number;
    readonly title: string;
    readonly allocatedTo: string;
    readonly runId: number | null;
    /** Epoch ms, the server's clock — like `ClaimSummary.createdAt`, the
     *  allocator lives only on the server, so its clock is the event's. */
    readonly allocatedAt: number;
    readonly state: DeviationAllocState;
    readonly landedAt: number | null;
    /** The plan file reconcile found the number in, repo-relative; null
     *  until landed. */
    readonly landedIn: string | null;
    readonly stale: boolean;
  }

  /* --- The present tense's numbers. ----------------------------------------
   *
   * All milliseconds unless the name says BYTES, and every one lives HERE and
   * nowhere else — `single-definition.test.ts`'s standing rule. Unlike the
   * journal's ceilings above, none of these has a bash twin: ccd never sees a
   * claim, a quota or the ledger (D12's advisory ruling), so there is no twin
   * test to keep in step.
   * ------------------------------------------------------------------------ */

  /** A claim's lease. Renewed by `renewClaims` on FleetWatcher's EXISTING
   *  tick while the holder measures RUNNING; a holder measured gone lapses at
   *  the standing expiry with `endedBy:'session-gone'`; a registry this pass
   *  could not measure reads as HELD — doubt is not death, matching ccd's
   *  four `-e` hold readers and `registry.ts`'s `HOLD_UNREADABLE` (D12).
   *  There is no session-side heartbeat, deliberately: a protocol a model
   *  must remember is a protocol that will be forgotten, and the failure is
   *  a wedged module. */
  export const CLAIM_LEASE_MS = 45 * 60_000;

  /** The horizon no renewal moves (D12). Doubt cannot hold forever: every
   *  claim must be periodically re-declared (re-POSTing the same paths renews
   *  AND re-states intent), and eight hours outlasts any honest wave. */
  export const CLAIM_HARD_CAP_MS = 8 * 60 * 60_000;

  /** `intent`'s cap, BYTES — the same number and the same char-vs-byte care
   *  as the journal's `LC_REASON_MAX_BYTES` above, and a SEPARATE constant on
   *  purpose: that one is ccd's `--reason` contract with a bash twin, this
   *  one is a server-only route contract, and tying them would let a ccd cap
   *  change silently rewrite a route's refusal threshold. Policy is REFUSE,
   *  never truncate, for `LC_REASON_MAX_BYTES`'s own stated reason. */
  export const CLAIM_INTENT_MAX_BYTES = 512;

  /** `floor = max(D-<n> found in the docs scan) + this` (D13). NOT
   *  decoration: numbers allocated but not yet written into any plan are
   *  invisible to the scan, and re-issuing one IS the measured failure.
   *  Burning fifty integers costs nothing. */
  export const LEDGER_SEED_GAP = 50;

  /** An `'allocated'` row older than this and never landed is REPORTED stale
   *  (derived, never stored — see `DEVIATION_ALLOC_STATES`) and NEVER
   *  reclaimed (D13). */
  export const LEDGER_STALE_MS = 7 * 24 * 60 * 60_000;

  /** Peer-mail quotas (D10), for `runId === null` mail ONLY — run mail keeps
   *  its own dedupe guard. BOUND THE PRODUCER, NEVER THE RECORD: nothing in
   *  the tree ever DELETEs from `mail`/`mail_deliveries`, so what these
   *  bound is growth, not history. Over-quota is `429 'peer-quota'`; a
   *  standing same-`(fromId,toId,subject)` pair is `409 'duplicate'` — both
   *  recorded in `mail_rejections`. */
  export const PEER_MAIL_MAX_OUTSTANDING = 3;
  export const PEER_MAIL_HOURLY = 12;
  ```

- [x] **Step 6 — run, expect PASS (2 min).**

  ```bash
  cd server && ./node_modules/.bin/vitest run test/peers-claims-l0.test.ts
  ```

  All tests green. If the reject-code membership test is the one red: you are in Step 4's
  fallback arm — stop and resolve wave 0 first.

- [x] **Step 7 — typecheck all three consumers (3 min).** The compile-time halves of this
  task's guards (the `Record<ClaimState, true>` totality, the five-tuple, the interface
  literals) only bite under tsc, and the PWA is the consumer that makes "L0 imports nothing"
  load-bearing — it compiles `shared/*.ts` straight into the browser bundle, where a `node:*`
  import does not exist:

  ```bash
  cd server && ./node_modules/.bin/tsc --noEmit          # src + ../shared (tsconfig include)
  cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts   # the test dir itself
  cd ../pwa && ./node_modules/.bin/tsc --noEmit          # the bundler's type gate
  ```

  All three exit 0.

- [x] **Step 8 — regression trio (3 min).** The three standing suites that police this file's
  disciplines, foreground:

  ```bash
  cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/mail-routes.test.ts test/lifecycle-refusal-word.test.ts
  ```

  All green — no second copy of any enumerated value, the mail table still total in both
  directions, the journal's refusal words still disjoint from `SENTENCES`.

- [x] **Step 9 — commit (1 min).**

  ```bash
  cd /path/to/ccrc-pwa && git add shared/api.ts server/test/peers-claims-l0.test.ts && git commit -m "shared(9b-wave1): peers, claims and the ledger get their words — the present tense lands dark

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

- [x] **Step 10 — mutation ceremony (8 min).** Spec §4's table names no L0-specific mutant, so
  the ceremony covers the four guards this slice itself ships. Each mutant: plant, run, expect
  the EXACT red, revert with `git checkout -- shared/api.ts` (the commit in Step 9 makes the
  revert a one-liner). Record the before/after in the execution notes — measured, not asserted.

  **Mutant A — the empty-reason arm.** In `isPeerDeliverable`, change
  `v.length > 'no:'.length` to `v.length >= 'no:'.length`. Run the L0 suite → expect exactly
  1 failure: `refuses no: with an empty reason...`. Revert.

  **Mutant B — quotability.** In `PEER_ETIQUETTE` rule 3, change `each row’s own lifecycle`
  to `each row's own lifecycle` (curly apostrophe → straight). Run → expect exactly 1
  failure: `carries no double-quote and no straight apostrophe...`. Revert.

  **Mutant C — L0 purity.** Insert `import { basename } from 'node:path';` on the line after
  `import type { Hue } from './roster.js';` (line 9). Run → expect exactly 1 failure:
  `shared/api.ts has exactly one import line, and it is a type`. (This is the vitest proxy
  for the real breakage — `cd pwa && ./node_modules/.bin/tsc --noEmit` would refuse the same
  mutant with a module-resolution error, which is worth doing once as evidence.) Revert.

  **Mutant D — the table is pinned in both value and type space.** Change the `CLAIM_STATES`
  array to `['live', 'released', 'lapsed', 'broken', 'expired'] as const`. Run the L0 suite →
  expect exactly 2 failures (`holds exactly the four states...` and `is total in both
  directions...`), and note that `test/typecheck-tests.test.ts` would additionally red with
  TS2741 on the test's `Record<ClaimState, true>`. Revert.

- [x] **Step 11 — final green + clean tree (2 min).**

  ```bash
  cd server && ./node_modules/.bin/vitest run test/peers-claims-l0.test.ts && git status --porcelain
  ```

  Suite green, `git status` empty. The wave is dark by construction: nothing imports these
  names yet, `FLEET_PROTO` untouched at 1, no route registered, no ccd byte changed — so no
  deploy is triggered by this task, and the next server deploy carries it for free.
# Section 3 — Wave 7 part A: the migration and the pure logic (Tasks 6–11)

Ships `MIGRATIONS[3]` (claims + deviation-ledger tables) and the three pure L1 modules
(`claims.ts`, `peers.ts`, `ledger.ts`) that wave 7 part B's store methods, routes and sweeps will
compose. Everything in this section is dark: no route registers, no sweep runs, nothing reads the
new tables yet. Part B (store methods, `ledgerlog.ts`, the seven routes, the four sweeps) and part C
(the `claims-advisory` / `claims-no-hold` / `deviation-refs` / `dtbd` detectors) build on the
Produces list below.

**Prerequisites.** Tasks 1–5 (waves 0–1) are merged: `shared/api.ts` already carries the L0 names
this section imports. This section CONSUMES and never redefines:

- `PeerDeliverable` — the D9/D12 string forms: `'yes' | 'unknown' | 'no:<reason>'` (in TS, the
  template-literal type ``'yes' | 'unknown' | `no:${string}` ``). `'unknown'` is a member because
  "'unknown' is not 'no'" is a wire fact, not a rendering choice.
- `ClaimConflict` — the 409's per-path address. The member set this section builds literals against:
  `{ path, heldPath, claimId, heldBy, heldByUuid, intent, runId, expiresAt, deliverable, mailHint }`
  (`path` the requested path refused; `heldPath` the live claim path it collides with; `runId:
  number | null`; `deliverable: PeerDeliverable`; everything else `string`/`number`). Task 7 returns
  ClaimConflict as an object LITERAL, so if the wave-1 section landed a different member set the
  drift is a TS2739/TS2353 in Task 7 — reconcile THERE, in the literal, never by a cast.
- `ClaimState` / `CLAIM_STATES` (`['live','released','lapsed','broken'] as const`, derived via the
  `PR_REASON_MAP` idiom) / `isClaimState`.
- `SessionLifecycle` / `sessionLifecycle` / `isSessionLifecycle` (shipped long before this program).
- Constants: `CLAIM_LEASE_MS` (2 700 000), `CLAIM_HARD_CAP_MS` (28 800 000), `LEDGER_SEED_GAP` (50).

**Ring discipline (this section's own guardrails).** The three new L1 files live in
`server/src/coord/` beside `journalparse.ts`/`mirrorplan.ts` and are policed by the SAME standing
scanners with zero edits: `single-definition.test.ts`'s coord-ring describe (:398–435) forbids them
`./db.js`, `node:sqlite` and any `coord.db`/`store.db` receiver — they are not in `HANDLE_HOLDERS`
and must never be. Pure means: no clock (a `now` is always a parameter), no `fs`, no fastify, no
lookup, no other row. Imports: `../../../shared/api.js` only.

**Execution notes.** Every suite runs foreground from inside `server/`, timeout ≥ 600000 ms:
`./node_modules/.bin/vitest run test/<file>` — NEVER bare `npx vitest`. No fixture here touches a
live `$HOME`; everything is `mkTmp` under `tmpHelpers.ts`. No ccd test in this section (the ccd half
of wave 7 does not exist — claims deliberately never touch ccd, and `claims-advisory.test.ts` in
part C is the scan that says so).

---

### Task 6: `MIGRATIONS[3]` — claims, claim_paths, ledger_alloc, ledger_floor

**Files:**
- Modify: `server/src/coord/schema.ts` — insert the new migration string after line 421 (the
  `` `, `` that closes migration index 2) and before line 422 (`];`). `COORD_SCHEMA_VERSION`
  (:424–427) derives from `MIGRATIONS.length` and needs NO edit — that derivation going 3 → 4 by
  itself is the point of its docstring.
- Modify: `server/test/coord-db.test.ts` — the three stale version pins, all currently `.toBe(3)`
  and all becoming `.toBe(4)` (:330, :331 `expect(COORD_SCHEMA_VERSION).toBe(3)`, :376), the
  :271–277 comment's `MIGRATIONS.length === 3` clause, and a new `describe` appended after :427
  (end of file is :428).

**Interfaces:**
- Consumes: `openCoordDb`, `tx`, `COORD_SCHEMA_VERSION` (`server/src/coord/db.ts`), `MIGRATIONS`
  (`server/src/coord/schema.ts`), `mkTmp` (`server/test/tmpHelpers.ts`).
- Produces (for part B's store methods and part C's detectors):
  - table `claims(id INTEGER PK AUTOINCREMENT, project TEXT NOT NULL, heldBy TEXT NOT NULL,
    heldByUuid TEXT NOT NULL, intent TEXT NOT NULL, runId INTEGER NULL REFERENCES runs(id),
    state TEXT NOT NULL, createdAt INTEGER NOT NULL, renewedAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL, hardExpiresAt INTEGER NOT NULL, endedAt INTEGER, endedBy TEXT)`
  - table `claim_paths(claimId INTEGER NOT NULL REFERENCES claims(id), project TEXT NOT NULL,
    path TEXT NOT NULL, live INTEGER NOT NULL DEFAULT 1)`
  - partial unique index `claim_one_owner ON claim_paths(project, path) WHERE live = 1`
  - table `ledger_alloc(project, n, title, claimedBy, at, state, PRIMARY KEY (project, n))`
  - table `ledger_floor(project TEXT PRIMARY KEY, floor INTEGER NOT NULL, evidence TEXT NOT NULL,
    at INTEGER NOT NULL)`
  - indexes `claims_by_state(state)`, `claims_by_project(project, state)`, `claims_by_run(runId)`,
    `claim_paths_by_claim(claimId)`

**The storage decision, made here and justified here (the task brief delegates it).** A claim's
paths are a SET, acquired all-or-nothing (D12). The clean storage is a `claim_paths` child table —
NOT a `paths` JSON column on `claims` — and the two candidate designs that keep a JSON copy are both
rejected:

1. *JSON column only* cannot carry the D11 backstop: "one live owner per `(project, path)`" is not
   expressible as a constraint over a JSON array, so losing the transaction in a future refactor
   would produce a silent duplicate instead of a loud constraint violation.
2. *JSON column beside the child table* is two homes for one fact — exactly what
   `single-definition.test.ts` exists to forbid at the source level, recreated at the storage level.

So the child table is the ONLY home of a claim's path set, for live and dead claims alike. "Lapse,
do not delete" (D12) therefore applies to paths too: ending a claim flips `claim_paths.live` to 0
and deletes nothing, so `GET /api/claims?all=1` (part B) can still show *which paths* "held by X
until it died" covered. The `live` column mirrors exactly ONE BIT of `claims.state` — the partial
index predicate's input, which SQLite cannot evaluate across a join — and it is written in the same
`tx()` as every parent-state transition (part B's store methods; part B's suite carries the mutant
that desynchronizes them). It is not a second authority: the four-word claim vocabulary keeps its
single home on `claims.state`.

**Steps:**

- [x] 1. Write the failing test. Append to `server/test/coord-db.test.ts` (after line 427, the
  closing `});` of the migration-2 describe — the file currently ends at line 428):

  ```ts
  describe('coord.db: migration 3 — claims and the deviation ledger', () => {
    it('reaches a database ALREADY at user_version 3 — it cannot be an amendment to any earlier index', () => {
      const p = dbPathIn(mkTmp('ccrc-coord-'));
      // Build the file exactly as a Build-9a server leaves it: migrations 0-2,
      // user_version 3. `db.ts`'s loop starts at `current`, so anything amended
      // INTO an earlier index can never run against this file again.
      mkdirSync(path.dirname(p), { recursive: true });
      const raw = new DatabaseSync(p);
      tx(raw, () => {
        raw.exec(MIGRATIONS[0]!); raw.exec(MIGRATIONS[1]!); raw.exec(MIGRATIONS[2]!);
        raw.exec('PRAGMA user_version = 3');
      });
      raw.close();

      const db = openCoordDb(p);
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(4);
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as
        { name: string }[]).map((r) => r.name);
      expect(tables).toEqual(expect.arrayContaining([
        'claims', 'claim_paths', 'ledger_alloc', 'ledger_floor',
      ]));
      db.close();
    });

    // Parent rows for every claim_paths insert below — foreign_keys is ON.
    const seedClaim = (db: DatabaseSync, id: number, project = 'demo'): void => {
      db.prepare(
        'INSERT INTO claims (id, project, heldBy, heldByUuid, intent, runId, state, ' +
        'createdAt, renewedAt, expiresAt, hardExpiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, project, `demo-holder-${id}`, 'u'.repeat(36), 'testing the schema', null, 'live',
        1, 1, 2, 3);
    };

    it('claim_one_owner: one LIVE owner per (project, path) — the D11 backstop is a loud constraint', () => {
      const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
      seedClaim(db, 1); seedClaim(db, 2); seedClaim(db, 3, 'other');
      const ins = db.prepare('INSERT INTO claim_paths (claimId, project, path, live) VALUES (?, ?, ?, ?)');
      ins.run(1, 'demo', 'shared/api.ts', 1);
      expect(() => ins.run(2, 'demo', 'shared/api.ts', 1)).toThrow(/UNIQUE constraint failed/);
      // A DIFFERENT project's identical path is not a collision — the index is per (project, path).
      ins.run(3, 'other', 'shared/api.ts', 1);
      db.close();
    });

    it('a LAPSED claim frees its paths without deleting them — lapse, do not delete (D12)', () => {
      const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
      seedClaim(db, 1); seedClaim(db, 2);
      const ins = db.prepare('INSERT INTO claim_paths (claimId, project, path, live) VALUES (?, ?, ?, ?)');
      ins.run(1, 'demo', 'ccd/ccd', 1);
      tx(db, () => {
        db.prepare("UPDATE claims SET state = 'lapsed', endedAt = 9, endedBy = 'session-gone' WHERE id = 1").run();
        db.prepare('UPDATE claim_paths SET live = 0 WHERE claimId = 1').run();
      });
      ins.run(2, 'demo', 'ccd/ccd', 1);   // the path is claimable again...
      // ...and the dead claim's path row SURVIVED — destroyed claim history is destroyed history.
      expect((db.prepare('SELECT count(*) AS c FROM claim_paths').get() as { c: number }).c).toBe(2);
      db.close();
    });

    it('ledger_alloc: PRIMARY KEY (project, n) — a number exists once per project, ever', () => {
      const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
      const ins = db.prepare(
        'INSERT INTO ledger_alloc (project, n, title, claimedBy, at, state) VALUES (?, ?, ?, ?, ?, ?)');
      ins.run('demo', 211, 'first subject', 'demo-quiet-mesa', 1, 'allocated');
      expect(() => ins.run('demo', 211, 'second subject', 'demo-brisk-ridge', 2, 'allocated'))
        .toThrow(/UNIQUE constraint failed/);
      // Namespaces are per project: another project owns its own 211.
      ins.run('other', 211, 'another project entirely', 'demo-plain-harbor', 3, 'allocated');
      db.close();
    });

    it('ledger_floor: one row per project — the floor is a single value, not a history', () => {
      const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
      const ins = db.prepare('INSERT INTO ledger_floor (project, floor, evidence, at) VALUES (?, ?, ?, ?)');
      ins.run('demo', 260, 'docs/superpowers/plans/example.md names D-210', 1);
      expect(() => ins.run('demo', 261, 'a second seed', 2)).toThrow(/UNIQUE constraint failed/);
      db.close();
    });
  });
  ```

- [x] 2. Run it, expect FAIL:
  `cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts`
  The new describe's first test fails with `expected 3 to be 4` (openCoordDb finds nothing past
  migration index 2), and the four table tests fail with `no such table: claims` /
  `no such table: ledger_alloc` / `no such table: ledger_floor`. Every pre-existing test stays
  green — nothing has changed yet.

- [x] 3. Write the migration. In `server/src/coord/schema.ts`, insert between line 421's closing
  `` `, `` and line 422's `];`:

  ```ts
  // ── 4: user_version 3 -> 4 ────────────────────────────────────────────────
  // Build 9 wave 7 (§1 D8/D11/D12/D13): hot-file claims and the deviation
  // ledger — the two coordination primitives that are "a query against the
  // mirror plus one compare-and-swap that only the box with a database can
  // perform" (the spec's spine, sentence for sentence).
  //
  // A SEPARATE MIGRATION, for the reason migrations 2 and 3 each restate:
  // db.ts runs `for (let v = current; v < COORD_SCHEMA_VERSION; v++)`, and
  // MIGRATIONS[2] is on origin/main — a live server may already sit at
  // user_version 3, so an amendment to any earlier index would silently
  // diverge from what is actually on disk.
  //
  // D8'S RULING ON `claims`, WRITTEN WHERE THE TABLE IS BORN so nobody later
  // files it as a doctrine violation: claims are AUTHORITATIVE in coord.db,
  // AND THEIR LOSS IS FREE BY CONSTRUCTION. There is no flat file to
  // re-measure, and manufacturing one would require widening the agent's
  // write whitelist beyond `.cc-clips` — the one structural guarantee keeping
  // the agent from corrupting the files it reads — and would re-open the
  // naming-sweep trap (D12) the moment anyone reached for ws-hold. Losing
  // coord.db expires every claim at once, which is exactly the pre-feature
  // state: sessions lose PROTECTION, never WORK, and re-claim on their next
  // attempt. The lease (CLAIM_LEASE_MS 45 min, CLAIM_HARD_CAP_MS 8 h) is what
  // earns that reading — it is why claims got a lease before they got a table.
  //
  // D8'S RULING ON `ledger_alloc`: authoritative, WITH a flat-file ground
  // truth so the re-measurement doctrine holds without a special case. Every
  // allocation is appended to ~/.ccrc/ledger-alloc.log FIRST and committed
  // here SECOND (ledgerlog.ts, wave 7 part B); recovery takes MAX(file, db),
  // so a number is SKIPPED, NEVER REISSUED. A gap costs nothing — the ledger
  // is prose, parsed by nothing; a reissue cost 394 rewritten D-ref lines
  // across 30 files under merge pressure (bb47c9e).
  //
  // D11, AND THE ORDER IS THE RULING — stated here so a reviewer does not
  // assume one mechanism makes the other redundant:
  //   1. The in-transaction read IS the compare-and-swap. POST /api/claims
  //      (part B) expires lapsed rows, reads ALL live conflicting paths —
  //      exact match AND directory-prefix containment, which no index can
  //      express — then inserts, inside one tx(). Sound because there is one
  //      server process and DatabaseSync has no async surface: the whole
  //      transaction runs without yielding the event loop.
  //   2. `claim_one_owner` below and ledger_alloc's PRIMARY KEY (project, n)
  //      are the BACKSTOP: if a future refactor ever loses the transaction,
  //      the failure is a loud constraint violation, never a duplicate.
  `
  CREATE TABLE claims (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project       TEXT NOT NULL,
    heldBy        TEXT NOT NULL,        -- the claiming SESSION id. Attribution, not authentication
    heldByUuid    TEXT NOT NULL,        -- the same uuid check POST /api/mail ingress already makes
    intent        TEXT NOT NULL,        -- what the holder says it is doing. <= 512 BYTES, refused
                                        -- over-cap at the route (part B) — the LC_REASON_MAX_BYTES
                                        -- policy: refuse, never shorten. Free text, parsed nowhere;
                                        -- re-POSTing the same paths rewrites it, which is D12
                                        -- ruling 3: the signal sweepNames freezes is REPLACED here
    runId         INTEGER REFERENCES runs(id),  -- null for a claim outside any run; run close
                                        -- releases this run's claims in the close transaction
    state         TEXT NOT NULL,        -- live|released|lapsed|broken (CLAIM_STATES); read back
                                        -- through isClaimState, never a cast — the same
                                        -- we-do-not-know rule as every enum column in this file
    createdAt     INTEGER NOT NULL,
    renewedAt     INTEGER NOT NULL,
    expiresAt     INTEGER NOT NULL,     -- the lease. Renewed by measurement (claimExpiry, D12),
                                        -- never by a session-side heartbeat
    hardExpiresAt INTEGER NOT NULL,     -- createdAt + CLAIM_HARD_CAP_MS. NEVER extended: doubt can
                                        -- hold a claim, but not forever
    endedAt       INTEGER,              -- LAPSE, DO NOT DELETE (D12): an ended claim keeps its row,
    endedBy       TEXT                  -- so "held by X until it died" stays answerable
  );
  CREATE INDEX claims_by_state   ON claims(state);          -- the renew/lapse sweep reads live rows
  CREATE INDEX claims_by_project ON claims(project, state); -- GET /api/claims?project= — the
                                                            -- coordinator asks before splitting work
  CREATE INDEX claims_by_run     ON claims(runId);          -- run close releases by runId — the
                                                            -- runs_by_session precedent, one wave on

  -- PATHS ARE A CHILD TABLE, NOT A JSON COLUMN ON claims, and the choice is
  -- single-definition: the path set must be queryable per (project, path) for
  -- the CAS read and constrainable for the backstop index, and a JSON copy
  -- beside this table would be two homes for one fact. A claim's paths are a
  -- SET, acquired all-or-nothing (D12) — the route inserts every row or none,
  -- inside the same tx() as the conflict read.
  --
  -- `live` mirrors exactly ONE BIT of the parent's state — the partial-index
  -- predicate's input, which SQLite cannot evaluate across a join. Written in
  -- the SAME tx() as every claims.state transition (store.ts, part B, whose
  -- suite carries the desync mutant). Not a second authority: the four-word
  -- vocabulary keeps its single home on claims.state. Ending a claim flips
  -- live to 0 and deletes nothing — path history outlives the claim exactly
  -- as the claim row outlives its lease.
  CREATE TABLE claim_paths (
    claimId INTEGER NOT NULL REFERENCES claims(id),
    project TEXT NOT NULL,
    path    TEXT NOT NULL,              -- normalized by claims.ts (normalizeClaimPath): relative,
                                        -- no trailing slash, no dot segments. '.' and '' are
                                        -- refused upstream — claiming the whole repo IS the wedge
    live    INTEGER NOT NULL DEFAULT 1
  );
  -- THE D11 BACKSTOP. Deliberately UNABLE to express the directory-prefix
  -- containment rule (shared/ vs shared/api.ts) — that is the in-transaction
  -- read's job, and this index exists so losing that read is loud, not silent.
  CREATE UNIQUE INDEX claim_one_owner    ON claim_paths(project, path) WHERE live = 1;
  CREATE INDEX        claim_paths_by_claim ON claim_paths(claimId);

  -- D13: the allocator's record. One row per issued number, forever. state:
  -- allocated|landed|stale — 'landed' means the number appears in a plan in
  -- the MAIN checkout (sweepLedgerReconcile, part B), the signal the bb47c9e
  -- incident lacked; 'stale' (7 days, never landed) is reported and NEVER
  -- reclaimed. Read back through the L0 guard, never a cast.
  CREATE TABLE ledger_alloc (
    project   TEXT NOT NULL,
    n         INTEGER NOT NULL,
    title     TEXT NOT NULL,
    claimedBy TEXT NOT NULL,
    at        INTEGER NOT NULL,
    state     TEXT NOT NULL,
    PRIMARY KEY (project, n)
  );

  -- D13: the self-seeded floor. THE FLOOR ONLY EVER RISES (store method, part
  -- B, enforced there and mutant-tested there); until a row exists here,
  -- allocation answers 409 not-seeded — openCoordDb's own "refuse to start
  -- rather than open empty" rule, one level up. floor = max(D-n seen in
  -- docs/superpowers/{plans,specs}) + LEDGER_SEED_GAP, because numbers
  -- allocated but not yet written into any plan are invisible to the scan,
  -- and re-issuing one IS the bb47c9e failure. evidence names the file and
  -- the number the seed was measured from.
  CREATE TABLE ledger_floor (
    project  TEXT PRIMARY KEY,
    floor    INTEGER NOT NULL,
    evidence TEXT NOT NULL,
    at       INTEGER NOT NULL
  );
  `,
  ```

- [x] 4. Run the suite again: `./node_modules/.bin/vitest run test/coord-db.test.ts`. The NEW
  describe is green; exactly three OLD assertions are now red — :330 (`expected 4 to be 3`), :331
  (`expected 4 to be 3`), :376 (`expected 4 to be 3`). That red is the proof the pins were live.

- [x] 5. Re-derive the pins (never nudge blindly — each one's premise is "the version openCoordDb
  reaches", which is now 4):
  - :330 `.toBe(3)` → `.toBe(4)`
  - :331 `expect(COORD_SCHEMA_VERSION).toBe(3);` → `expect(COORD_SCHEMA_VERSION).toBe(4);`
  - :376 `.toBe(3)` → `.toBe(4)`
  - :271–272's comment `// Isolated from openCoordDb deliberately. MIGRATIONS.length === 3 since`
    → `// Isolated from openCoordDb deliberately. MIGRATIONS.length === 4 since`

- [x] 6. Run, expect PASS: `./node_modules/.bin/vitest run test/coord-db.test.ts` — all green.

- [x] 7. Mutation ceremony 1 — the partial predicate is load-bearing. In the new migration, change
  `WHERE live = 1` on `claim_one_owner` to nothing (a full unique index). Run the suite: expect
  EXACTLY ONE red — "a LAPSED claim frees its paths…" (`UNIQUE constraint failed` where a re-claim
  must succeed). Revert.

- [x] 8. Mutation ceremony 2 — the backstop key is load-bearing. Change
  `PRIMARY KEY (project, n)` on `ledger_alloc` to `PRIMARY KEY (project, n, at)`. Run: expect
  EXACTLY ONE red — "ledger_alloc: PRIMARY KEY (project, n)…" (the duplicate insert no longer
  throws). Revert.

- [x] 9. Run the neighboring standing guards, which must stay green WITH NO EDIT — that is itself an
  assertion of this task: `./node_modules/.bin/vitest run test/single-definition.test.ts
  test/lifecycle-replay.test.ts test/coord-store.test.ts`.

- [x] 10. Commit:

  ```bash
  cd server && git add src/coord/schema.ts test/coord-db.test.ts
  git commit -m "coord(schema): migration 3 — claims lapse, ledgers append, and losing either is priced"
  ```

---

### Task 7: `claims.ts` — `decideClaim`, `claimExpiry`, and the `LivenessProbe` port

**Files:**
- Create: `server/src/coord/claims.ts`
- Create: `server/test/claims.test.ts`

**Interfaces:**
- Consumes (`shared/api.ts`, landed by the wave-1 task): `CLAIM_LEASE_MS`, `type ClaimConflict`,
  `type PeerDeliverable`.
- Produces (part B's `POST /api/claims` route, `renewClaims`/`lapseClaims` sweeps, and Task 11):
  - `interface ClaimRow { id: number; project: string; paths: readonly string[]; heldBy: string;
    heldByUuid: string; intent: string; runId: number | null; expiresAt: number;
    holderDeliverable: PeerDeliverable }` — the row AS DECIDED OVER (the caller assembles it from
    the stored row plus one `peerDeliverable()` measurement; the DB row type is part B's).
  - `interface ClaimRequest { project: string; paths: readonly string[]; sessionId: string }`
  - `type ClaimDecision = { ok: true; paths: readonly string[] }
    | { refused: 'bad-path'; paths: readonly string[] }
    | { conflict: readonly ClaimConflict[] }`
  - `decideClaim(existing: readonly ClaimRow[], req: ClaimRequest): ClaimDecision`
  - `normalizeClaimPath(raw: string): string | null`
  - `pathsOverlap(a: string, b: string): boolean`
  - `type LivenessVerdict = 'running' | 'gone' | 'unmeasurable'`
  - `interface LivenessProbe { liveness(sessionId: string): LivenessVerdict }` — the L2 port,
    declared BY THE CONSUMER; part B's watcher implements it over records the tick already read.
  - `type ClaimExpiryDecision = { act: 'renew'; expiresAt: number }
    | { act: 'lapse'; endedBy: 'session-gone' | 'hard-cap' } | { act: 'hold' }`
  - `claimExpiry(row: { expiresAt: number; hardExpiresAt: number }, now: number,
    verdict: LivenessVerdict): ClaimExpiryDecision`

**Steps:**

- [x] 1. Write the failing test, `server/test/claims.test.ts`:

  ```ts
  // Wave 7's pure half of the claim: the decision, with no database in the
  // room. The CAS itself is part B (store + tx()); what THIS file pins is the
  // decision table both the route and the sweeps will consume — and the D12
  // sentences that must survive every refactor: all-or-nothing, doubt is not
  // death, the hard cap is never extended, and the conflict is an ADDRESS.
  import { describe, it, expect } from 'vitest';
  import { CLAIM_LEASE_MS } from '../../shared/api.js';
  import {
    claimExpiry, decideClaim, normalizeClaimPath, pathsOverlap, type ClaimRow,
  } from '../src/coord/claims.js';

  const NOW = 1_800_000_000_000;

  const row = (over: Partial<ClaimRow> = {}): ClaimRow => ({
    id: 7, project: 'demo', paths: ['server/src/coord/store.ts'],
    heldBy: 'demo-quiet-mesa', heldByUuid: 'a'.repeat(36),
    intent: 'store methods for wave 7', runId: 42,
    expiresAt: NOW + 10 * 60_000, holderDeliverable: 'yes',
    ...over,
  });

  describe('normalizeClaimPath', () => {
    it('strips a leading ./ and a trailing slash — shared/ and shared name one directory', () => {
      expect(normalizeClaimPath('shared/')).toBe('shared');
      expect(normalizeClaimPath('./shared/api.ts')).toBe('shared/api.ts');
    });

    it("refuses '.' and '' — claiming the whole repo IS the module wedge (D12)", () => {
      expect(normalizeClaimPath('.')).toBeNull();
      expect(normalizeClaimPath('')).toBeNull();
      expect(normalizeClaimPath('./')).toBeNull();
    });

    it('refuses what defeats prefix containment: absolute paths and dot segments', () => {
      expect(normalizeClaimPath('/etc/passwd')).toBeNull();
      expect(normalizeClaimPath('shared/../ccd')).toBeNull();
      expect(normalizeClaimPath('shared/./api.ts')).toBeNull();
      expect(normalizeClaimPath('a//b')).toBeNull();
    });
  });

  describe('pathsOverlap: exact match AND directory-prefix containment, both directions', () => {
    it('a directory contains its file, and a file is contained by its directory', () => {
      expect(pathsOverlap('shared', 'shared/api.ts')).toBe(true);
      expect(pathsOverlap('shared/api.ts', 'shared')).toBe(true);
      expect(pathsOverlap('shared/api.ts', 'shared/api.ts')).toBe(true);
    });

    it('a NAME prefix is not a DIRECTORY prefix', () => {
      expect(pathsOverlap('shared', 'shared-utils/api.ts')).toBe(false);
      expect(pathsOverlap('ccd/ccd', 'ccd/ccd-helpers')).toBe(false);
    });
  });

  describe('decideClaim', () => {
    it('grants a disjoint set, returning the NORMALIZED paths for the store to insert', () => {
      const d = decideClaim([row()], {
        project: 'demo', paths: ['pwa/src/App.tsx', 'shared/'], sessionId: 'demo-brisk-ridge',
      });
      expect(d).toEqual({ ok: true, paths: ['pwa/src/App.tsx', 'shared'] });
    });

    it('refuses bad-path and names EVERY refused path — before any conflict is even considered', () => {
      const d = decideClaim([], {
        project: 'demo', paths: ['.', 'ccd/ccd', ''], sessionId: 'demo-brisk-ridge',
      });
      expect(d).toEqual({ refused: 'bad-path', paths: ['.', ''] });
    });

    it('reports a containment conflict — the held DIRECTORY blocks the requested FILE', () => {
      const d = decideClaim([row({ paths: ['shared'] })], {
        project: 'demo', paths: ['shared/api.ts'], sessionId: 'demo-brisk-ridge',
      });
      if (!('conflict' in d)) throw new Error(`expected conflict, got ${JSON.stringify(d)}`);
      expect(d.conflict).toHaveLength(1);
      expect(d.conflict[0]).toMatchObject({
        path: 'shared/api.ts', heldPath: 'shared', claimId: 7,
        heldBy: 'demo-quiet-mesa', intent: 'store methods for wave 7',
        runId: 42, expiresAt: NOW + 10 * 60_000, deliverable: 'yes',
      });
    });

    it('reports the reverse containment too — the held FILE blocks the requested DIRECTORY', () => {
      const d = decideClaim([row({ paths: ['shared/api.ts'] })], {
        project: 'demo', paths: ['shared/'], sessionId: 'demo-brisk-ridge',
      });
      if (!('conflict' in d)) throw new Error('expected conflict');
      expect(d.conflict[0]).toMatchObject({ path: 'shared', heldPath: 'shared/api.ts' });
    });

    it("the holder's OWN live row is never a conflict — re-POSTing the same paths is the renewal door (D12)", () => {
      const d = decideClaim([row({ heldBy: 'demo-quiet-mesa' })], {
        project: 'demo', paths: ['server/src/coord/store.ts'], sessionId: 'demo-quiet-mesa',
      });
      expect(d).toEqual({ ok: true, paths: ['server/src/coord/store.ts'] });
    });

    it('another PROJECT is another namespace — same path, no conflict', () => {
      const d = decideClaim([row({ project: 'other' })], {
        project: 'demo', paths: ['server/src/coord/store.ts'], sessionId: 'demo-brisk-ridge',
      });
      expect(d).toEqual({ ok: true, paths: ['server/src/coord/store.ts'] });
    });

    it("the mailHint is a pre-addressed envelope while the holder is deliverable, and an operator escalation when it is not — never a silent send", () => {
      const yes = decideClaim([row()], {
        project: 'demo', paths: ['server/src/coord/store.ts'], sessionId: 'demo-brisk-ridge',
      });
      if (!('conflict' in yes)) throw new Error('expected conflict');
      expect(yes.conflict[0]!.mailHint).toContain('POST /api/mail');
      expect(yes.conflict[0]!.mailHint).toContain('demo-quiet-mesa');

      const no = decideClaim([row({ holderDeliverable: 'no:session-gone' })], {
        project: 'demo', paths: ['server/src/coord/store.ts'], sessionId: 'demo-brisk-ridge',
      });
      if (!('conflict' in no)) throw new Error('expected conflict');
      expect(no.conflict[0]!.mailHint).not.toContain('POST /api/mail');
      expect(no.conflict[0]!.mailHint).toContain('operator');
      expect(no.conflict[0]!.mailHint).toContain('session-gone');
    });
  });

  describe("claimExpiry: D12's decision table", () => {
    const lease = { expiresAt: NOW + 10 * 60_000, hardExpiresAt: NOW + 4 * 3_600_000 };

    it('a holder measured RUNNING renews to now + CLAIM_LEASE_MS', () => {
      expect(claimExpiry(lease, NOW, 'running'))
        .toEqual({ act: 'renew', expiresAt: NOW + CLAIM_LEASE_MS });
    });

    it('a renewal CLAMPS at hardExpiresAt — the hard cap is never extended', () => {
      const nearCap = NOW + 4 * 3_600_000 - 60_000;
      expect(claimExpiry(lease, nearCap, 'running'))
        .toEqual({ act: 'renew', expiresAt: lease.hardExpiresAt });
    });

    it('a renewal that would not move the lease is a hold, not a zero-length write', () => {
      const atCap = { expiresAt: lease.hardExpiresAt, hardExpiresAt: lease.hardExpiresAt };
      expect(claimExpiry(atCap, NOW + 4 * 3_600_000 - 60_000, 'running')).toEqual({ act: 'hold' });
    });

    it('a holder measured GONE lapses at the STANDING expiresAt — not one tick before', () => {
      expect(claimExpiry(lease, NOW + 9 * 60_000, 'gone')).toEqual({ act: 'hold' });
      expect(claimExpiry(lease, NOW + 10 * 60_000, 'gone'))
        .toEqual({ act: 'lapse', endedBy: 'session-gone' });
    });

    it('an UNMEASURABLE holder is HELD, even past its lease — doubt is not death (D12)', () => {
      expect(claimExpiry(lease, NOW + 3_600_000, 'unmeasurable')).toEqual({ act: 'hold' });
    });

    it('the hard cap fells every verdict alike — doubt cannot hold forever', () => {
      const atCap = NOW + 4 * 3_600_000;
      for (const v of ['running', 'gone', 'unmeasurable'] as const) {
        expect(claimExpiry(lease, atCap, v)).toEqual({ act: 'lapse', endedBy: 'hard-cap' });
      }
    });
  });
  ```

- [x] 2. Run it, expect FAIL with
  `Error: Failed to load ../src/coord/claims.js` (the module does not exist):
  `cd server && ./node_modules/.bin/vitest run test/claims.test.ts`

- [x] 3. Write the implementation, `server/src/coord/claims.ts`:

  ```ts
  import { CLAIM_LEASE_MS, type ClaimConflict, type PeerDeliverable } from '../../../shared/api.js';

  /**
   * L1: pure, clock-free, fs-free, fastify-free — `journalparse.ts`'s exact
   * stance, and the same coord-ring scan (`single-definition.test.ts:398`)
   * polices it: no `./db.js`, no `node:sqlite`, no handle. The CAS itself is
   * NOT here (D11): it is the in-transaction read part B's store method runs
   * inside `tx()`, which is sound only there — one server process,
   * `DatabaseSync` with no async surface. This file is the DECISION that read
   * feeds, so route, sweep and test all consume one table instead of three
   * hand-rolled copies.
   *
   * `existing` is the set of LIVE rows the store read inside the same
   * transaction, expiry already applied (the feed_events prune-on-write
   * idiom, D12) — that precondition is the store's contract, which is why
   * `decideClaim` carries no clock: handing it one would be a second expiry
   * implementation waiting to drift from the first.
   */
  export interface ClaimRow {
    readonly id: number;
    readonly project: string;
    /** The claim's path set, normalized at insert (`normalizeClaimPath`). */
    readonly paths: readonly string[];
    readonly heldBy: string;
    readonly heldByUuid: string;
    readonly intent: string;
    readonly runId: number | null;
    readonly expiresAt: number;
    /** The holder's deliverability, MEASURED BY THE CALLER (`peerDeliverable`
     *  over the same records the route already holds) — an input, so the
     *  decision stays pure. Required, not defaulted: every caller must answer,
     *  and 'unknown' is the honest answer when it did not measure. */
    readonly holderDeliverable: PeerDeliverable;
  }

  export interface ClaimRequest {
    readonly project: string;
    readonly paths: readonly string[];
    readonly sessionId: string;
  }

  /** Three arms, three facts a caller handles differently — never collapsed:
   *  granted (with the normalized set to insert), refused outright (bad
   *  paths, named in full), or lost to a holder (every conflicting path
   *  named, D12 — partial acquisition is how two workers each end up holding
   *  half of what the other needs, so there is no partial arm to have). */
  export type ClaimDecision =
    | { readonly ok: true; readonly paths: readonly string[] }
    | { readonly refused: 'bad-path'; readonly paths: readonly string[] }
    | { readonly conflict: readonly ClaimConflict[] };

  /**
   * Repo-relative, forward-slash, no trailing slash, no dot segments — or
   * null. `'.'` and `''` are refused because claiming the whole repo IS the
   * module wedge (D12); absolute paths and `..`/`.` segments are refused
   * because containment below is string-prefix arithmetic, and a path that
   * can alias another path defeats it. Refuse, never repair beyond the two
   * spelling normalizations (`./x` -> `x`, `x/` -> `x`) that make one
   * directory one string.
   */
  export function normalizeClaimPath(raw: string): string | null {
    let p = raw;
    while (p.startsWith('./')) p = p.slice(2);
    while (p.endsWith('/')) p = p.slice(0, -1);
    if (p === '' || p === '.') return null;
    if (p.startsWith('/')) return null;
    const segs = p.split('/');
    if (segs.some((s) => s === '' || s === '.' || s === '..')) return null;
    return p;
  }

  /** Exact match OR directory-prefix containment, BOTH directions — the rule
   *  no index can express (D11), stated once. Inputs are normalized paths;
   *  the `+ '/'` is what keeps `shared` out of `shared-utils`. */
  export function pathsOverlap(a: string, b: string): boolean {
    return a === b || b.startsWith(a + '/') || a.startsWith(b + '/');
  }

  /** The pre-addressed envelope (D12): the 409 does not stop at telling you
   *  who holds the path — it hands you the address. A holder measured
   *  'no:<reason>' degrades the hint to an operator escalation, NEVER to a
   *  silent send; 'unknown' still gets the envelope, because unknown is not
   *  no (D9). */
  function claimMailHint(heldBy: string, deliverable: PeerDeliverable): string {
    if (deliverable.startsWith('no:')) {
      return `the holder is not deliverable (${deliverable.slice(3)}) — escalate to the operator ` +
        'instead of mailing';
    }
    return `POST /api/mail {"toId":"${heldBy}","kind":"question","subject":"claim: <path>"} — ` +
      'the holder reads it when it next idles';
  }

  export function decideClaim(existing: readonly ClaimRow[], req: ClaimRequest): ClaimDecision {
    // Bad paths first, and ALL of them: a caller fixing its request one 400
    // at a time is a caller that retries four times.
    const bad = req.paths.filter((p) => normalizeClaimPath(p) === null);
    if (bad.length > 0) return { refused: 'bad-path', paths: bad };
    // Dedupe AFTER normalization, preserving first-seen order, so
    // ['shared/', 'shared'] is one path, not a self-collision.
    const paths: string[] = [];
    for (const p of req.paths) {
      const n = normalizeClaimPath(p)!;
      if (!paths.includes(n)) paths.push(n);
    }

    const conflicts: ClaimConflict[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      for (const c of existing) {
        if (c.project !== req.project) continue;      // per-project namespace
        // The holder's own rows never conflict: re-POSTing the same paths is
        // the RENEWAL door (D12 ruling 3), and the 409's whole job is to hand
        // the caller someone ELSE's address.
        if (c.heldBy === req.sessionId) continue;
        for (const heldPath of c.paths) {
          if (!pathsOverlap(path, heldPath)) continue;
          const key = `${path}\x00${c.id}`;         // one address per (path, claim)
          if (seen.has(key)) continue;
          seen.add(key);
          // An object LITERAL against the L0 interface, so a ClaimConflict
          // member this file forgets — or invents — is a compile error, the
          // reviveFleetSession mechanism.
          conflicts.push({
            path, heldPath, claimId: c.id, heldBy: c.heldBy, heldByUuid: c.heldByUuid,
            intent: c.intent, runId: c.runId, expiresAt: c.expiresAt,
            deliverable: c.holderDeliverable,
            mailHint: claimMailHint(c.heldBy, c.holderDeliverable),
          });
        }
      }
    }
    // ALL-OR-NOTHING (D12): five paths, one conflict, zero acquired — and the
    // 409 names EVERY conflicting path, not the first.
    if (conflicts.length > 0) return { conflict: conflicts };
    return { ok: true, paths };
  }

  /** What the renew sweep can answer about a holder, from records the tick
   *  has ALREADY read — never a fresh per-claim exec. Three words because
   *  there are three facts: measured running, measured gone, and could-not-
   *  measure, which is neither. */
  export type LivenessVerdict = 'running' | 'gone' | 'unmeasurable';

  /** The L2 port, declared BY THE CONSUMER (this file is the consumer: the
   *  decision below is what needs a verdict). Part B's watcher implements it
   *  over the registry/tmux facts its tick already holds — D12: no
   *  session-side heartbeat, no protocol a model must remember. */
  export interface LivenessProbe {
    liveness(sessionId: string): LivenessVerdict;
  }

  export type ClaimExpiryDecision =
    | { readonly act: 'renew'; readonly expiresAt: number }
    | { readonly act: 'lapse'; readonly endedBy: 'session-gone' | 'hard-cap' }
    | { readonly act: 'hold' };

  /**
   * D12's table, in order — the order is the specification:
   *
   *   now >= hardExpiresAt            -> lapse 'hard-cap'   (checked FIRST: the
   *                                      one bound no measurement can extend)
   *   running                         -> renew to min(now + CLAIM_LEASE_MS,
   *                                      hardExpiresAt); a no-op renewal is a hold
   *   gone  + now >= expiresAt        -> lapse 'session-gone' (at the STANDING
   *                                      lease, never early — the lease is the grace)
   *   gone  + now <  expiresAt        -> hold
   *   unmeasurable                    -> HOLD. Doubt is not death: a fleet-box
   *                                      hiccup must not mass-expire every claim
   *                                      (registry.ts's HOLD_UNREADABLE stance,
   *                                      one table over)
   */
  export function claimExpiry(
    row: { readonly expiresAt: number; readonly hardExpiresAt: number },
    now: number,
    verdict: LivenessVerdict,
  ): ClaimExpiryDecision {
    if (now >= row.hardExpiresAt) return { act: 'lapse', endedBy: 'hard-cap' };
    switch (verdict) {
      case 'running': {
        const next = Math.min(now + CLAIM_LEASE_MS, row.hardExpiresAt);
        return next > row.expiresAt ? { act: 'renew', expiresAt: next } : { act: 'hold' };
      }
      case 'gone':
        return now >= row.expiresAt
          ? { act: 'lapse', endedBy: 'session-gone' }
          : { act: 'hold' };
      case 'unmeasurable':
        return { act: 'hold' };
    }
  }
  ```

- [x] 4. Run, expect PASS: `./node_modules/.bin/vitest run test/claims.test.ts`.

- [x] 5. Run the ring scan, which must stay green with no edit:
  `./node_modules/.bin/vitest run test/single-definition.test.ts test/typecheck-tests.test.ts`.

- [x] 6. Commit:

  ```bash
  cd server && git add src/coord/claims.ts test/claims.test.ts
  git commit -m "server(claims): the decision table — all-or-nothing, and doubt is held, never dead"
  ```

---

### Task 8: `peers.ts` — the structural deliverability ladder and the archive contradiction

**Files:**
- Create: `server/src/coord/peers.ts`
- Create: `server/test/peers.test.ts`

**Interfaces:**
- Consumes (`shared/api.ts`): `type PeerDeliverable`, `type SessionLifecycle`.
- Produces (part B's `GET /api/peers` route, `divergence.ts`'s `archived-but-live` producer, Task 7's
  `holderDeliverable` input, and Task 10):
  - `interface PeerProbe { registry: 'measured' | 'absent' | 'unmeasurable';
    tmux: 'live' | 'gone' | 'unknown'; panePid: number | null; lifecycle: SessionLifecycle }`
  - `peerDeliverable(p: PeerProbe): PeerDeliverable`
  - `archiveContradicted(archivedAt: number | null, lifecycle: SessionLifecycle): boolean`

**The vocabulary decision, stated so a reviewer does not "fix" it.** `PeerProbe.tmux` spells
`'live' | 'gone' | 'unknown'` — the same three words as `SessionVerdict['verdict']`
(`server/src/exec.ts:81-84`) — as its OWN declaration rather than a type import from `exec.ts`.
That is the ports-declared-by-the-consumer rule (the same one `LivenessProbe` follows in Task 7),
and the two spellings cannot drift silently: Task 10's parity fixture types one field with
`PeerProbe['tmux']` and drives the REAL `Tmux` adapter from it, so a fourth verdict word on either
side reds the fixture's compile.

**Steps:**

- [ ] 1. Write the failing test, `server/test/peers.test.ts`:

  ```ts
  // D9's ladder, pure: the STRUCTURAL rungs of sweepMail's own gate — registry
  // measured -> tmux verdict -> pane pid -> lifecycle — with the transient
  // rungs (cooldown, latch, ask, quiet) deliberately absent, because reporting
  // lane state here would tell a caller a BUSY peer is unreachable, the exact
  // lie R2 forbids. Task 10 drives this ladder and sweepMail's real one over a
  // single fixture table; THIS file pins the rungs one fixture row cannot
  // state coherently (a lifecycle verdict the earlier rungs would pre-empt).
  import { describe, it, expect } from 'vitest';
  import type { SessionLifecycle } from '../../shared/api.js';
  import { archiveContradicted, peerDeliverable, type PeerProbe } from '../src/coord/peers.js';

  const probe = (over: Partial<PeerProbe> = {}): PeerProbe => ({
    registry: 'measured', tmux: 'live', panePid: 4242, lifecycle: 'running', ...over,
  });

  describe('peerDeliverable: the ladder, rung by rung', () => {
    it('a measured, live, running peer is yes', () => {
      expect(peerDeliverable(probe())).toBe('yes');
    });

    it('rung 1 — no registry row is proven absence: no:not-in-registry', () => {
      expect(peerDeliverable(probe({ registry: 'absent' }))).toBe('no:not-in-registry');
    });

    it("rung 1 — an unmeasurable registry row is 'unknown', and 'unknown' is not 'no' (D9)", () => {
      expect(peerDeliverable(probe({ registry: 'unmeasurable' }))).toBe('unknown');
    });

    it('rung 2 — tmux proving the session gone is no:session-gone', () => {
      expect(peerDeliverable(probe({ tmux: 'gone' }))).toBe('no:session-gone');
    });

    it("rung 2 — tmux NOT ANSWERING is 'unknown', never 'no' — the substrate-unreachable stance", () => {
      expect(peerDeliverable(probe({ tmux: 'unknown' }))).toBe('unknown');
    });

    it('rung 3 — a live session with no pane pid is no:no-pane (nothing to inject into)', () => {
      expect(peerDeliverable(probe({ panePid: null }))).toBe('no:no-pane');
    });

    it('rung 4 — the three dead lifecycles answer no, each naming its own word', () => {
      expect(peerDeliverable(probe({ lifecycle: 'stopped' }))).toBe('no:stopped');
      expect(peerDeliverable(probe({ lifecycle: 'orphan' }))).toBe('no:orphan');
      expect(peerDeliverable(probe({ lifecycle: 'never-started' }))).toBe('no:never-started');
    });

    it("rung 4 — an unmeasurable lifecycle is 'unknown'", () => {
      expect(peerDeliverable(probe({ lifecycle: 'unmeasurable' }))).toBe('unknown');
    });

    it('rung 4 — unsupervised, unclaimed and restarting are all still deliverable: a mail lands in the pane, not in the supervisor', () => {
      for (const l of ['unsupervised', 'unclaimed', 'restarting'] as const) {
        expect(peerDeliverable(probe({ lifecycle: l }))).toBe('yes');
      }
    });

    it('the ladder answers IN ORDER — an earlier rung pre-empts a later one, matching sweepMail', () => {
      // registry beats tmux: sweepMail's identity===null branch continues
      // before sessionVerdict ever runs (watch.ts:1991-2054 vs :2069).
      expect(peerDeliverable(probe({ registry: 'absent', tmux: 'gone' }))).toBe('no:not-in-registry');
      // tmux beats pid and lifecycle.
      expect(peerDeliverable(probe({ tmux: 'gone', panePid: null, lifecycle: 'stopped' })))
        .toBe('no:session-gone');
    });
  });

  describe('archiveContradicted: the archived-but-live predicate (D9)', () => {
    it('an archived stamp on a row whose lifecycle says it is alive is the contradiction', () => {
      for (const l of ['running', 'unsupervised', 'unclaimed', 'restarting'] as const) {
        expect(archiveContradicted(1_755_000_000, l)).toBe(true);
      }
    });

    it('an archived stamp on a genuinely dead row is consistent', () => {
      for (const l of ['stopped', 'orphan', 'never-started'] as const) {
        expect(archiveContradicted(1_755_000_000, l)).toBe(false);
      }
    });

    it('an UNMEASURABLE row contradicts nothing — doubt is not evidence', () => {
      expect(archiveContradicted(1_755_000_000, 'unmeasurable')).toBe(false);
    });

    it('no stamp, no contradiction — whatever the lifecycle says', () => {
      const all: readonly SessionLifecycle[] = [
        'running', 'unsupervised', 'unclaimed', 'stopped', 'restarting',
        'orphan', 'never-started', 'unmeasurable',
      ];
      for (const l of all) expect(archiveContradicted(null, l)).toBe(false);
    });
  });
  ```

- [ ] 2. Run it, expect FAIL with `Failed to load ../src/coord/peers.js`:
  `cd server && ./node_modules/.bin/vitest run test/peers.test.ts`

- [ ] 3. Write the implementation, `server/src/coord/peers.ts`:

  ```ts
  import type { PeerDeliverable, SessionLifecycle } from '../../../shared/api.js';

  /**
   * L1: pure — same stance and same coord-ring scan as `journalparse.ts`.
   *
   * D9: `deliverable` is decided from the STRUCTURAL rungs of `sweepMail`'s
   * own ladder — registry row measured, tmux verdict, pane pid, lifecycle —
   * and from nothing else. The TRANSIENT rungs (120 s cooldown, the
   * single-flight latch, an unanswered ask, quiet >= 60 s) stay in
   * `sweepMail`: those are lane state, and reporting them here would tell a
   * caller a BUSY peer is unreachable — the exact lie R2 forbids.
   * `sweepMail` is NOT refactored to call this; instead
   * `deliverability-parity.test.ts` drives both over one fixture table
   * (the `_session_state`/`sessionLifecycle` two-implementations-one-fixture
   * precedent): single definition of the DECISION, zero edits to the most
   * load-bearing loop on the box.
   *
   * The probe is the CONSUMER'S declaration of what it reads (the same rule
   * as `claims.ts`'s `LivenessProbe`): three registry words mirroring
   * `readRegistryMeasured`'s three-way answer per row (absent = never
   * listed, or proven gone; unmeasurable = listed but a field's bytes never
   * came back — `measuredIdentity(rec) === null`), three tmux words mirroring
   * `SessionVerdict['verdict']` (exec.ts:81-84; the parity fixture types one
   * field with both, so the mirrors cannot drift silently).
   */
  export interface PeerProbe {
    readonly registry: 'measured' | 'absent' | 'unmeasurable';
    readonly tmux: 'live' | 'gone' | 'unknown';
    readonly panePid: number | null;
    readonly lifecycle: SessionLifecycle;
  }

  /** Rung 4's total table — `Record<SessionLifecycle, …>` so a ninth
   *  lifecycle member is a TS2739 here, forcing a decision instead of a
   *  silent default. The three dead words answer no; `unmeasurable` answers
   *  unknown, because a session nobody managed to look at is not a session
   *  proven gone. */
  const LIFECYCLE_RUNG: Record<SessionLifecycle, 'pass' | 'no' | 'unknown'> = {
    running: 'pass', unsupervised: 'pass', unclaimed: 'pass', restarting: 'pass',
    stopped: 'no', orphan: 'no', 'never-started': 'no',
    unmeasurable: 'unknown',
  };

  /**
   * The ladder, IN `sweepMail`'s ORDER — the first rung that cannot pass
   * answers, exactly as the sweep's own `continue`s fire (registry before
   * tmux before pid; watch.ts:1991, :2069, :2087). Three answer shapes,
   * never collapsed: 'yes', 'no:<reason>' (a measured refusal, reason
   * attached), 'unknown' (could not measure — NOT 'no', per D9).
   */
  export function peerDeliverable(p: PeerProbe): PeerDeliverable {
    if (p.registry === 'absent') return 'no:not-in-registry';
    if (p.registry === 'unmeasurable') return 'unknown';
    if (p.tmux === 'gone') return 'no:session-gone';
    if (p.tmux === 'unknown') return 'unknown';
    if (p.panePid === null) return 'no:no-pane';
    const rung = LIFECYCLE_RUNG[p.lifecycle];
    if (rung === 'no') return `no:${p.lifecycle}`;
    return rung === 'unknown' ? 'unknown' : 'yes';
  }

  /** Which lifecycles CONTRADICT an archive stamp — total for the same
   *  TS2739 reason as above. The four live-ish words contradict (`.archived`
   *  is cleared only by ws-restore and _reg_purge, never by start/ensure, so
   *  a heartbeating row stamped merged:#N is the measured lie D9 names);
   *  `restarting` is in — a supervisor actively cycling an "archived" row is
   *  the same contradiction one heartbeat early. `unmeasurable` is OUT:
   *  doubt is not evidence, in either direction. */
  const ARCHIVE_CONTRADICTS: Record<SessionLifecycle, boolean> = {
    running: true, unsupervised: true, unclaimed: true, restarting: true,
    stopped: false, orphan: false, 'never-started': false, unmeasurable: false,
  };

  /**
   * D9: the route does NOT filter on `.archived` and there is no boolean
   * called `addressable` — `archivedAt` is reported verbatim and decides
   * nothing. This predicate NAMES the contradiction (`archivedStale` on
   * `PeerSummary`, part B) and the same answer feeds
   * `divergence.archived-but-live` — the four measured rows go from silently
   * false to loudly flagged with zero ccd semantic change.
   */
  export function archiveContradicted(
    archivedAt: number | null,
    lifecycle: SessionLifecycle,
  ): boolean {
    return archivedAt !== null && ARCHIVE_CONTRADICTS[lifecycle];
  }
  ```

- [ ] 4. Run, expect PASS: `./node_modules/.bin/vitest run test/peers.test.ts`.

- [ ] 5. Run the ring scan and typecheck, green with no edit:
  `./node_modules/.bin/vitest run test/single-definition.test.ts test/typecheck-tests.test.ts`.

- [ ] 6. Commit:

  ```bash
  cd server && git add src/coord/peers.ts test/peers.test.ts
  git commit -m "server(peers): the structural ladder answers yes, no, or honestly unknown"
  ```

---

### Task 9: `ledger.ts` — `decideAllocation` and `floorFromScan`

**Files:**
- Create: `server/src/coord/ledger.ts`
- Create: `server/test/ledger.test.ts`

**Interfaces:**
- Consumes (`shared/api.ts`): `LEDGER_SEED_GAP`.
- Produces (part B's `POST /api/ledger/deviations` route, `sweepLedgerFloor`, `ledgerlog.ts`, and
  Task 11):
  - `LEDGER_ALLOC_MAX = 100` (the per-request block ceiling — the decision's own bound, exported
    from here because it is not wire vocabulary)
  - `type AllocationDecision = { ok: true; numbers: readonly number[]; floor: number }
    | { refused: 'not-seeded' } | { refused: 'bad-count' }`
  - `decideAllocation(floorRow: { floor: number } | null, maxLanded: number | null,
    count: number): AllocationDecision`
  - `interface LedgerFloorScan { floor: number; evidence: string; legacy: readonly string[] }`
  - `floorFromScan(files: readonly { path: string; text: string }[]): LedgerFloorScan | null`

**Two resolutions this task encodes (spec-ambiguities, settled here):**

1. *`maxLanded`'s meaning.* The name is the fixed interface contract's; its DEFINITION here is "the
   greatest `n` ever ISSUED for this project — `MAX` over `ledger_alloc` in every state
   (`allocated`, `landed`, `stale`) and over `~/.ccrc/ledger-alloc.log`, or `null` when none". An
   allocated-but-unwritten number MUST count: excluding it and re-issuing it is exactly the
   `bb47c9e` failure the 50-number gap exists to prevent. The caller (part B) measures it; the
   decision only compares.
2. *Legacy forms never feed the floor.* `floorFromScan` RECOGNIZES `D-B<k>-<m>` (so a scan cannot
   misparse one, and so the D14 reconciliation wave can enumerate what remains) but the floor
   derives from the GLOBAL `D-<n>` form alone: a legacy number lives in a different namespace, and
   seeding the global sequence from `D-B4-400`'s 400 would burn 400 numbers on a token that will be
   RENAMED by the reconciliation anyway (D14 allocates each legacy ref a fresh global number through
   the allocator itself). A tree carrying ONLY legacy refs answers `null` — not seeded — because a
   floor invented from the wrong namespace is a collision deferred, and D13's rule is fail shut.

**Steps:**

- [ ] 1. Write the failing test, `server/test/ledger.test.ts`:

  ```ts
  // D13's pure half: the allocator's decision and the floor scan. The CAS
  // (BEGIN IMMEDIATE, PRIMARY KEY backstop, the log-first append) is part B;
  // ledger-race.test.ts lives there with it. What THIS file pins is the
  // arithmetic that makes a number impossible to reissue — and the D14
  // transition rule that a legacy D-B<k>-<m> is recognized but never seeds
  // the global namespace.
  import { describe, it, expect } from 'vitest';
  import { LEDGER_SEED_GAP } from '../../shared/api.js';
  import { decideAllocation, floorFromScan, LEDGER_ALLOC_MAX } from '../src/coord/ledger.js';

  describe('decideAllocation', () => {
    it('answers not-seeded until a floor row exists — refuse to allocate rather than open empty (D13)', () => {
      expect(decideAllocation(null, null, 1)).toEqual({ refused: 'not-seeded' });
    });

    it('issues a contiguous block starting at the floor', () => {
      expect(decideAllocation({ floor: 260 }, null, 3))
        .toEqual({ ok: true, numbers: [260, 261, 262], floor: 260 });
    });

    it('starts past the greatest number ever ISSUED — an allocated-but-unwritten number is never reissued', () => {
      // 265 was allocated but has landed in no plan yet; the scan cannot see
      // it, which is exactly why the issued max — not the floor — wins here.
      expect(decideAllocation({ floor: 260 }, 265, 2))
        .toEqual({ ok: true, numbers: [266, 267], floor: 260 });
    });

    it('the floor wins when history sits below it — the floor only ever rises', () => {
      expect(decideAllocation({ floor: 260 }, 210, 1))
        .toEqual({ ok: true, numbers: [260], floor: 260 });
    });

    it('refuses a non-integer, non-positive or over-cap count', () => {
      expect(decideAllocation({ floor: 260 }, null, 0)).toEqual({ refused: 'bad-count' });
      expect(decideAllocation({ floor: 260 }, null, 1.5)).toEqual({ refused: 'bad-count' });
      expect(decideAllocation({ floor: 260 }, null, LEDGER_ALLOC_MAX + 1))
        .toEqual({ refused: 'bad-count' });
      expect(decideAllocation({ floor: 260 }, null, LEDGER_ALLOC_MAX))
        .toMatchObject({ ok: true });
    });

    it('bad-count is refused even unseeded — the caller learns BOTH defects in the worst case, not one per retry', () => {
      expect(decideAllocation(null, null, 0)).toEqual({ refused: 'bad-count' });
    });
  });

  describe('floorFromScan', () => {
    it('takes max(D-<n>) + LEDGER_SEED_GAP, with evidence naming the file and the number', () => {
      const r = floorFromScan([
        { path: 'docs/superpowers/plans/a.md', text: 'closes D-114 and D-149.' },
        { path: 'docs/superpowers/plans/b.md', text: 'the ledger reaches D-210 here.' },
      ]);
      expect(r).toEqual({
        floor: 210 + LEDGER_SEED_GAP,
        evidence: 'docs/superpowers/plans/b.md names D-210',
        legacy: [],
      });
    });

    it('recognizes the legacy D-B<k>-<m> form and reports it — but it NEVER feeds the floor (D14)', () => {
      const r = floorFromScan([
        { path: 'p.md', text: 'D-210 stands; D-B4-400 is legacy and its 400 is another namespace.' },
      ]);
      expect(r).toEqual({
        floor: 210 + LEDGER_SEED_GAP,
        evidence: 'p.md names D-210',
        legacy: ['D-B4-400'],
      });
    });

    it('a tree with ONLY legacy refs is NOT a seed — fail shut, not guess (D13/D14)', () => {
      expect(floorFromScan([{ path: 'p.md', text: 'only D-B4-9 and D-B8-13 here' }])).toBeNull();
    });

    it('an empty scan is null, and null is not a floor of 50', () => {
      expect(floorFromScan([])).toBeNull();
      expect(floorFromScan([{ path: 'p.md', text: 'no deviations named' }])).toBeNull();
    });

    it('does not misparse: D-TBD-<slug>, a legacy tail, and a 6-digit token all feed nothing', () => {
      const r = floorFromScan([
        { path: 'p.md', text: 'D-42 is real; D-TBD-mirror-gap is a placeholder; D-123456 is garbage.' },
      ]);
      expect(r).toEqual({ floor: 42 + LEDGER_SEED_GAP, evidence: 'p.md names D-42', legacy: [] });
    });
  });
  ```

- [ ] 2. Run it, expect FAIL with `Failed to load ../src/coord/ledger.js`:
  `cd server && ./node_modules/.bin/vitest run test/ledger.test.ts`

- [ ] 3. Write the implementation, `server/src/coord/ledger.ts`:

  ```ts
  import { LEDGER_SEED_GAP } from '../../../shared/api.js';

  /**
   * L1: pure — the allocator's DECISION and the floor SCAN, with no clock, no
   * fs and no handle (`single-definition.test.ts`'s coord-ring scan). The CAS
   * around the decision — BEGIN IMMEDIATE, the log-first append, the PRIMARY
   * KEY (project, n) backstop, the 3x in-request retry — is part B's store
   * method and `ledgerlog.ts`; `ledger-race.test.ts` pins it there.
   */

  /** The per-request block ceiling. A program pre-allocates its whole D-block
   *  at run-open (D13 / coordinator clause 10); 100 numbers is several
   *  programs' worth, and anything larger is likelier a caller bug than a
   *  plan. Not L0: no wire type carries it — the route answers bad-count. */
  export const LEDGER_ALLOC_MAX = 100;

  export type AllocationDecision =
    | { readonly ok: true; readonly numbers: readonly number[]; readonly floor: number }
    | { readonly refused: 'not-seeded' }
    | { readonly refused: 'bad-count' };

  /**
   * D13: until seeded, allocation fails shut (`not-seeded` — openCoordDb's
   * "refuse to start rather than open empty", one level up). `maxLanded` is
   * the greatest n ever ISSUED for this project — MAX over ledger_alloc in
   * EVERY state and over ~/.ccrc/ledger-alloc.log, null when none. Every
   * state, because an allocated-but-unwritten number is invisible to the
   * plan scan, and re-issuing one IS the bb47c9e failure; the caller
   * measures, this function only compares.
   *
   * bad-count is checked before not-seeded so the worst-case caller learns
   * both defects in one round trip, not one per retry.
   */
  export function decideAllocation(
    floorRow: { readonly floor: number } | null,
    maxLanded: number | null,
    count: number,
  ): AllocationDecision {
    if (!Number.isInteger(count) || count < 1 || count > LEDGER_ALLOC_MAX) {
      return { refused: 'bad-count' };
    }
    if (floorRow === null) return { refused: 'not-seeded' };
    const start = Math.max(floorRow.floor, (maxLanded ?? 0) + 1);
    const numbers = Array.from({ length: count }, (_, i) => start + i);
    return { ok: true, numbers, floor: floorRow.floor };
  }

  export interface LedgerFloorScan {
    readonly floor: number;
    /** Names the file and the number the seed was measured from — written
     *  into ledger_floor.evidence verbatim (D13). */
    readonly evidence: string;
    /** Every distinct legacy D-B<k>-<m> token seen, sorted — the D14
     *  reconciliation wave's worklist, and the reader's proof that "no
     *  global refs" and "no refs at all" are two different scans. */
    readonly legacy: readonly string[];
  }

  // The two forms, and they CANNOT cross-match: after 'D-' the global form
  // requires a digit, so 'D-B4-400' contributes nothing to GLOBAL_RE (the
  // 'B' blocks it) and 'D-400' contains no 'B' for LEGACY_RE. Global is
  // bounded at 5 digits WITH a trailing \b, so a 6-digit token matches at NO
  // length (every prefix ends digit-before-digit) rather than truncating.
  const GLOBAL_RE = /\bD-(\d{1,5})\b/g;
  const LEGACY_RE = /\bD-B(\d{1,3})-(\d{1,4})\b/g;

  /**
   * D13's seed, D14's transition. The floor derives from the GLOBAL form
   * alone: a legacy number lives in a different namespace, and D14
   * reconciles it by allocating a FRESH global number through the allocator
   * — so feeding a legacy tail into this max would burn numbers for a token
   * that is about to be renamed anyway. A scan finding only legacy refs (or
   * nothing) answers null: not seeded, fail shut, never guess.
   *
   * Files are scanned in the order given; on a tie the FIRST file naming the
   * max is the evidence — deterministic because the caller (sweepLedgerFloor,
   * part B) sorts its readdir.
   */
  export function floorFromScan(
    files: readonly { readonly path: string; readonly text: string }[],
  ): LedgerFloorScan | null {
    let max = 0;
    let evidence = '';
    const legacy = new Set<string>();
    for (const f of files) {
      for (const m of f.text.matchAll(LEGACY_RE)) legacy.add(m[0]);
      for (const m of f.text.matchAll(GLOBAL_RE)) {
        const n = Number(m[1]);
        if (n > max) { max = n; evidence = `${f.path} names D-${n}`; }
      }
    }
    if (max === 0) return null;
    return { floor: max + LEDGER_SEED_GAP, evidence, legacy: [...legacy].sort() };
  }
  ```

- [ ] 4. Run, expect PASS: `./node_modules/.bin/vitest run test/ledger.test.ts`.

- [ ] 5. Run the ring scan and typecheck, green with no edit:
  `./node_modules/.bin/vitest run test/single-definition.test.ts test/typecheck-tests.test.ts`.

- [ ] 6. Commit:

  ```bash
  cd server && git add src/coord/ledger.ts test/ledger.test.ts
  git commit -m "server(ledger): the floor only rises, and a legacy number seeds nothing"
  ```

---

### Task 10: `deliverability-parity.test.ts` — one fixture table, two real ladders

**Files:**
- Create: `server/test/deliverabilityFixture.ts`
- Create: `server/test/deliverability-parity.test.ts`
- Read-only reference: `server/src/watch.ts:1840-2161` (`sweepMail` — its registry gate at
  :1991-2054, tmux verdict at :2069-2075, pane-pid gate at :2087-2089). **`sweepMail` is NOT
  refactored** (D9): not one line of `watch.ts` changes in this task.

**Interfaces:**
- Consumes: `peerDeliverable`, `type PeerProbe` (Task 8); `sessionLifecycle`,
  `type PeerDeliverable` (`shared/api.ts`); `FleetWatcher` (`server/src/watch.ts`); `CoordStore`,
  `openCoordDb` (`server/src/coord/`); `testDeps` (`server/test/helpers.ts`), `mkTmp`
  (`tmpHelpers.ts`), `unreadableField` (`ioDoubles.ts`).
- Produces: `DELIVERABILITY_FIXTURE` + `probeOf()` (`deliverabilityFixture.ts`) — part B's
  `GET /api/peers` route tests re-drive the SAME table through the route, so the fixture is written
  as a module, not inlined.

**What parity asserts, precisely — because sweepMail has no lifecycle rung of its own.** The two
implementations share three structural rungs (registry, tmux verdict, pane pid); rung 4 (lifecycle)
is `peerDeliverable`'s own extra strictness for the peers surface, and in any COHERENT fixture a
dead lifecycle co-occurs with a tmux `gone` that rung 2 already answers — so rung 4 is pinned by
Task 8's direct probes, and this table stays coherent. The parity relation, per row:

- rows with every transient gate OPEN (`quiet: true`): `sweepMail` sends **iff**
  `peerDeliverable(probeOf(row)) === 'yes'` — the ladders agree on every rung both have;
- the one `quiet: false` row: verdict `'yes'` AND no send — a busy peer is deliverable-but-not-now,
  the R2 boundary between structural and transient, pinned from both sides.

**Steps:**

- [ ] 1. Write the fixture module, `server/test/deliverabilityFixture.ts`:

  ```ts
  /**
   * The deliverability table as DATA — the single source both implementations
   * are driven against (the sessionLifecycleFixture.ts idiom): `sweepMail`'s
   * real ladder consumes each row as seeded files + a scripted tmux, and
   * `peerDeliverable` consumes the same row as a PeerProbe via `probeOf`.
   * Rows are stated in registry-native terms (stamp AGES in whole seconds,
   * a tmux word, a pid boolean) because that is the one vocabulary both
   * sides can be built from.
   */
  import { sessionLifecycle, type PeerDeliverable } from '../../shared/api.js';
  import type { PeerProbe } from '../src/coord/peers.js';

  export const PARITY_NOW = 1_800_000_000_000;
  export const PARITY_PID = 4242;

  export interface DeliverabilityRow {
    /** Doubles as the `it` title in both suites. */
    readonly name: string;
    readonly registry: PeerProbe['registry'];
    /** Typed off the PROBE, and used to drive the real Tmux stub — this one
     *  field is what keeps the probe's consumer-declared verdict words and
     *  exec.ts's SessionVerdict words from drifting silently. */
    readonly tmux: PeerProbe['tmux'];
    readonly panePid: boolean;
    readonly supervisedAgoSec: number | null;
    readonly stoppedAgoSec: number | null;
    readonly started: boolean;
    /** true = every TRANSIENT gate open (idle, quiet, no ask, off cooldown);
     *  false = the live-state is affirmatively NOT quiet — busy, not gone. */
    readonly quiet: boolean;
    readonly expect: PeerDeliverable;
  }

  export const DELIVERABILITY_FIXTURE: readonly DeliverabilityRow[] = [
    { name: 'a live, supervised, quiet peer is yes — and the sweep sends',
      registry: 'measured', tmux: 'live', panePid: true,
      supervisedAgoSec: 5, stoppedAgoSec: null, started: true, quiet: true, expect: 'yes' },

    { name: 'an UNSUPERVISED live pane is still yes — mail lands in the pane, not the supervisor',
      registry: 'measured', tmux: 'live', panePid: true,
      supervisedAgoSec: null, stoppedAgoSec: null, started: true, quiet: true, expect: 'yes' },

    { name: 'no registry row at all is no:not-in-registry — proven absence',
      registry: 'absent', tmux: 'live', panePid: true,
      supervisedAgoSec: null, stoppedAgoSec: null, started: false, quiet: true,
      expect: 'no:not-in-registry' },

    { name: "a registry row listed but unreadable is unknown — one dropped round trip is not a reaping",
      registry: 'unmeasurable', tmux: 'live', panePid: true,
      supervisedAgoSec: 5, stoppedAgoSec: null, started: true, quiet: true, expect: 'unknown' },

    { name: 'a session tmux proves gone is no:session-gone',
      registry: 'measured', tmux: 'gone', panePid: true,
      supervisedAgoSec: null, stoppedAgoSec: 90, started: true, quiet: true,
      expect: 'no:session-gone' },

    { name: 'a session tmux cannot answer for is unknown — substrate silence is not death',
      registry: 'measured', tmux: 'unknown', panePid: true,
      supervisedAgoSec: 5, stoppedAgoSec: null, started: true, quiet: true, expect: 'unknown' },

    { name: 'a live session with no pane pid is no:no-pane',
      registry: 'measured', tmux: 'live', panePid: false,
      supervisedAgoSec: 5, stoppedAgoSec: null, started: true, quiet: true,
      expect: 'no:no-pane' },

    { name: 'a BUSY peer is yes and gets nothing sent — transient lane state is not unreachability (R2)',
      registry: 'measured', tmux: 'live', panePid: true,
      supervisedAgoSec: 5, stoppedAgoSec: null, started: true, quiet: false, expect: 'yes' },
  ];

  /** One fixture row -> the pure ladder's own input shape. `alive` for the
   *  lifecycle input is the row's tmux verdict — the same measurement the
   *  sweep's rung 2 makes — so the two arms read one world. */
  export function probeOf(row: DeliverabilityRow, nowMs: number = PARITY_NOW): PeerProbe {
    return {
      registry: row.registry,
      tmux: row.tmux,
      panePid: row.panePid ? PARITY_PID : null,
      lifecycle: sessionLifecycle({
        alive: row.tmux === 'live',
        supervisedAt: row.supervisedAgoSec === null ? null : nowMs - row.supervisedAgoSec * 1000,
        stoppedAt: row.stoppedAgoSec === null ? null : nowMs - row.stoppedAgoSec * 1000,
        stopSurface: row.stoppedAgoSec === null ? null : 'pwa',
        started: row.started,
        unmeasured: [],
        nowMs,
      }),
    };
  }
  ```

- [ ] 2. Write the failing parity test, `server/test/deliverability-parity.test.ts`:

  ```ts
  // D9's single-definition mechanism: `sweepMail` is NOT refactored to call
  // `peerDeliverable` — instead both are driven over ONE fixture table and
  // held in agreement on every structural rung, the _session_state /
  // sessionLifecycle two-implementations-one-fixture precedent. The harness
  // is mail-sweep.test.ts's own (fake Date only, real timers under
  // sendPrompt), reduced to the knobs this table needs.
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import { mkdirSync, writeFileSync } from 'node:fs';
  import path from 'node:path';
  import { Bus } from '../src/bus.js';
  import type { Runner } from '../src/exec.js';
  import type { Deps } from '../src/server.js';
  import { FleetWatcher } from '../src/watch.js';
  import { openCoordDb } from '../src/coord/db.js';
  import { CoordStore } from '../src/coord/store.js';
  import { peerDeliverable } from '../src/coord/peers.js';
  import { localIO } from '../src/io.js';
  import { testDeps } from './helpers.js';
  import { mkTmp } from './tmpHelpers.js';
  import { unreadableField } from './ioDoubles.js';
  import {
    DELIVERABILITY_FIXTURE, PARITY_NOW, PARITY_PID, probeOf, type DeliverabilityRow,
  } from './deliverabilityFixture.js';

  const ID = 'demo-parity-mesa';
  const UUID = 'a'.repeat(36);
  const FROM_ID = 'demo-parity-ridge';
  const FROM_UUID = 'b'.repeat(36);
  // Local mirrors of watch.ts's private lane constants — mail-sweep.test.ts's
  // own idiom: no import path exists, so a drift is a failing test, not a
  // silently-wrong assertion.
  const MAIL_QUIET_MS = 60_000;

  const emptyBox = '❯ \n';
  const anyEchoBox = (t: string): string => `❯ ${t}\n`;

  interface Harness { home: string; calls: string[][]; run: Runner }

  const harness = (row: DeliverabilityRow): Harness => {
    const home = mkTmp('ccrc-deliv-parity-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });   // empty but LISTABLE
    const calls: string[][] = [];
    let lastLiteral = '';
    const run: Runner = async (_cmd, args) => {
      calls.push([...args]);
      if (args[0] === 'has-session') {
        if (row.tmux === 'gone') return { code: 1, stdout: '', stderr: "can't find session: cc-x\n" };
        if (row.tmux === 'unknown') return { code: 1, stdout: '', stderr: 'server exited unexpectedly\n' };
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'list-panes') {
        return row.panePid
          ? { code: 0, stdout: `${PARITY_PID}\n`, stderr: '' }
          : { code: 1, stdout: '', stderr: '' };
      }
      if (args[0] === 'capture-pane') {
        // Echo whatever sendPrompt last typed: the happy three-capture script
        // without hand-scripting pane order per row.
        return { code: 0, stdout: lastLiteral === '' ? emptyBox : anyEchoBox(lastLiteral), stderr: '' };
      }
      if (args[0] === 'send-keys') {
        if (args[3] === '-l') lastLiteral = args[4] ?? '';
        else if (args[3] === 'Enter') lastLiteral = '';
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 1, stdout: '', stderr: '' };
    };
    return { home, calls, run };
  };

  const seedRow = (home: string, row: DeliverabilityRow): void => {
    const reg = path.join(home, '.cc-sessions');
    if (row.registry !== 'absent') {
      const fields: Record<string, string> = {
        wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid: UUID,
      };
      if (row.started) fields['started'] = '1';
      if (row.supervisedAgoSec !== null) {
        fields['supervised'] = String(Math.floor((PARITY_NOW - row.supervisedAgoSec * 1000) / 1000));
      }
      if (row.stoppedAgoSec !== null) {
        fields['stopped'] = `${Math.floor((PARITY_NOW - row.stoppedAgoSec * 1000) / 1000)} pwa`;
      }
      for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
      // A fresh, ask-free hookstate — the transient ask gate stays open.
      writeFileSync(path.join(reg, `${ID}.hookstate.json`), JSON.stringify({
        v: 1, state: 'done', sessionId: UUID, pid: PARITY_PID, event: null,
        updatedAt: PARITY_NOW - 61_000, ask: null, subagents: [],
      }));
      const live = path.join(home, '.claude', 'sessions');
      mkdirSync(live, { recursive: true });
      writeFileSync(path.join(live, `${PARITY_PID}.json`), JSON.stringify({
        pid: PARITY_PID, sessionId: UUID, cwd: '/w/demo', name: null, nameSource: null,
        status: 'idle', version: '2.1.220',
        // quiet: idle for longer than MAIL_QUIET_MS; busy: fresh activity.
        statusUpdatedAt: row.quiet ? PARITY_NOW - MAIL_QUIET_MS - 1_000 : PARITY_NOW - 1_000,
      }));
    }
  };

  /** Drives the REAL sweep for one row; answers "did it send". */
  const sweepArm = async (row: DeliverabilityRow): Promise<boolean> => {
    const h = harness(row);
    const coord = new CoordStore(openCoordDb(path.join(h.home, '.ccrc', 'coord.db')));
    const io = row.registry === 'unmeasurable' ? unreadableField(ID, 'wrapper') : localIO;
    const deps: Deps = { ...testDeps(h.home, h.run), coord, io };
    const w = new FleetWatcher(deps, new Bus(), 2000);
    await w.tick();                                    // prime against the empty registry
    seedRow(h.home, row);
    const mail = coord.insertMail({ fromId: FROM_ID, fromUuid: FROM_UUID, toId: ID, runId: null,
      kind: 'finding', subject: 'parity', body: 'parity fixture', artifacts: [] });
    coord.queueDelivery(mail.id, ID, 'parity fixture');
    await w.sweepMail();
    return h.calls.some((a) => a[0] === 'send-keys' && a[3] === '-l');
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PARITY_NOW);
  });
  afterEach(() => { vi.useRealTimers(); });

  describe('deliverability parity: sweepMail and peerDeliverable read one world', () => {
    it('the table covers every answer class — a scan over a thin table passes everything', () => {
      // Scanner-coverage floor, the coord-routes-single-file rule applied to a
      // fixture: parity over two rows would "agree" vacuously.
      expect(DELIVERABILITY_FIXTURE.length).toBeGreaterThanOrEqual(8);
      const verdicts = DELIVERABILITY_FIXTURE.map((r) => r.expect);
      expect(verdicts).toContain('yes');
      expect(verdicts).toContain('unknown');
      expect(verdicts.some((v) => v.startsWith('no:'))).toBe(true);
      expect(DELIVERABILITY_FIXTURE.some((r) => !r.quiet)).toBe(true);
    });

    for (const row of DELIVERABILITY_FIXTURE) {
      it(row.name, async () => {
        const verdict = peerDeliverable(probeOf(row));
        expect(verdict).toBe(row.expect);

        const sent = await sweepArm(row);
        if (row.quiet) {
          // Every transient gate open: the ladders must agree exactly.
          expect(sent).toBe(verdict === 'yes');
        } else {
          // The R2 boundary, pinned from both sides: busy is deliverable
          // ('yes' — reporting lane state would call a busy peer unreachable)
          // and busy is not sent to (the transient rung is sweepMail's own).
          expect(verdict).toBe('yes');
          expect(sent).toBe(false);
        }
      });
    }
  });
  ```

- [ ] 3. Run it, expect FAIL: with Task 8 landed the pure arm passes, but if run before Task 8 the
  import fails — this task requires Task 8. The genuinely red case to verify here: temporarily
  reorder two rungs in `peerDeliverable` (swap the registry and tmux `if`s) and confirm the
  "answers IN ORDER" unit test (Task 8) plus the absent-registry parity row go red — then restore.
  With the shipped ladder: `cd server && ./node_modules/.bin/vitest run test/deliverability-parity.test.ts`
  — expect PASS on first complete run (this suite is born green by construction; its red exists in
  the mutation ceremony below, which is the §4 requirement "the two ladders drift").

- [ ] 4. Mutation ceremony — spec §4, "Deliverability single-definition / the two ladders drift".
  Plant: in `server/src/coord/peers.ts`, delete the line
  `if (p.panePid === null) return 'no:no-pane';`. Run BOTH suites:
  `./node_modules/.bin/vitest run test/deliverability-parity.test.ts test/peers.test.ts`.
  Expect EXACTLY TWO red: the parity row "a live session with no pane pid is no:no-pane" (verdict
  drifts to `'yes'` while the real sweep does not send — the equivalence assertion fires) and Task
  8's rung-3 unit test. Revert the mutant; both suites green again.

- [ ] 5. Full-file check, foreground:
  `./node_modules/.bin/vitest run test/deliverability-parity.test.ts test/mail-sweep.test.ts` —
  `mail-sweep.test.ts` green WITH NO EDIT is this task's own assertion that `sweepMail` was not
  touched.

- [ ] 6. Commit:

  ```bash
  cd server && git add test/deliverabilityFixture.ts test/deliverability-parity.test.ts
  git commit -m "test(parity): one fixture table, two ladders, and the busy peer stays reachable"
  ```

---

### Task 11: the D12 property tests and the mutation ceremonies

**Files:**
- Modify: `server/test/claims.test.ts` (append two describes after the Task 7 suites)
- Modify: `server/test/peers.test.ts` (no new tests — this task runs its ceremony against Task 8's
  existing pins)
- Modify: `server/test/ledger.test.ts` (append one describe)
- Mutation targets (planted and REVERTED, never committed): `server/src/coord/claims.ts`,
  `server/src/coord/peers.ts`, `server/src/coord/ledger.ts`

**Interfaces:**
- Consumes: everything Tasks 7–9 produce. Produces no new exports — this task's product is the
  measured before/after evidence that every D12 guard has a mutant that reds it (the mutation-table
  discipline: "a comment is a request; a red suite is a mechanism").

**Steps:**

- [ ] 1. Append the property suites to `server/test/claims.test.ts` (after the last describe):

  ```ts
  describe('D12 properties: all-or-nothing, and the 409 names EVERY conflicting path', () => {
    it('five paths, one conflict — ZERO acquired', () => {
      const d = decideClaim(
        [row({ paths: ['server/src/coord/dispatch.ts'] })],
        { project: 'demo', sessionId: 'demo-brisk-ridge',
          paths: ['pwa/src/App.tsx', 'shared/roster.ts', 'agent/src/tail.ts',
                  'server/src/coord/dispatch.ts', 'docs/README-notes.md'] },
      );
      // The ok arm carries the paths to insert; its absence IS "zero acquired".
      expect('ok' in d).toBe(false);
      if (!('conflict' in d)) throw new Error('expected conflict');
      expect(d.conflict.map((c) => c.path)).toEqual(['server/src/coord/dispatch.ts']);
    });

    it('two conflicting paths against two different holders — BOTH named, each with its own address', () => {
      const d = decideClaim(
        [
          row({ id: 1, heldBy: 'demo-quiet-mesa', paths: ['shared'] }),
          row({ id: 2, heldBy: 'demo-plain-harbor', paths: ['ccd/ccd'] }),
        ],
        { project: 'demo', sessionId: 'demo-brisk-ridge',
          paths: ['shared/api.ts', 'ccd/ccd', 'pwa/src/App.tsx'] },
      );
      if (!('conflict' in d)) throw new Error('expected conflict');
      const byPath = new Map(d.conflict.map((c) => [c.path, c.heldBy]));
      expect([...byPath.keys()].sort()).toEqual(['ccd/ccd', 'shared/api.ts']);
      expect(byPath.get('shared/api.ts')).toBe('demo-quiet-mesa');
      expect(byPath.get('ccd/ccd')).toBe('demo-plain-harbor');
    });

    it('one requested path overlapping TWO of a holder\'s own paths is ONE address, not two', () => {
      const d = decideClaim(
        [row({ paths: ['shared', 'shared/api.ts'] })],
        { project: 'demo', sessionId: 'demo-brisk-ridge', paths: ['shared'] },
      );
      if (!('conflict' in d)) throw new Error('expected conflict');
      expect(d.conflict).toHaveLength(1);
      expect(d.conflict[0]!.claimId).toBe(7);
    });

    it('a duplicated request path is deduped, not double-granted and not double-conflicted', () => {
      expect(decideClaim([], {
        project: 'demo', sessionId: 'demo-brisk-ridge', paths: ['shared/', 'shared'],
      })).toEqual({ ok: true, paths: ['shared'] });
    });
  });
  ```

- [ ] 2. Run, expect PASS (these are properties the Task 7 implementation already satisfies —
  written now, they are the tripwires the ceremonies below prove live):
  `cd server && ./node_modules/.bin/vitest run test/claims.test.ts`

- [ ] 3. Append the reissue-property suite to `server/test/ledger.test.ts`:

  ```ts
  describe('D13 property: a block is contiguous, above the floor, above ALL history', () => {
    it('every issued block is gap-free and strictly increasing', () => {
      const d = decideAllocation({ floor: 260 }, 271, 5);
      if (!('ok' in d)) throw new Error('expected ok');
      expect(d.numbers).toEqual([272, 273, 274, 275, 276]);
      for (let i = 1; i < d.numbers.length; i++) {
        expect(d.numbers[i]! - d.numbers[i - 1]!).toBe(1);
      }
      expect(Math.min(...d.numbers)).toBeGreaterThan(271);
      expect(Math.min(...d.numbers)).toBeGreaterThanOrEqual(260);
    });
  });
  ```

  Run, expect PASS: `./node_modules/.bin/vitest run test/ledger.test.ts`.

- [ ] 4. Mutation ceremony A — *all-or-nothing dies loudly*. Plant in
  `server/src/coord/claims.ts`: change `if (conflicts.length > 0) return { conflict: conflicts };`
  to `if (conflicts.length > 0) return { conflict: [conflicts[0]!] };` (report only the first —
  the "partial 409" mutant). Run `./node_modules/.bin/vitest run test/claims.test.ts`: expect
  EXACTLY ONE red — "two conflicting paths against two different holders — BOTH named". Revert.

- [ ] 5. Mutation ceremony B — *containment is load-bearing*. Plant: change `pathsOverlap`'s body
  to `return a === b;` (exact match only). Run the same suite: expect EXACTLY FOUR red — "a
  directory contains its file…", "reports a containment conflict", "reports the reverse containment
  too", and "two conflicting paths against two different holders" (its `shared/api.ts`-vs-`shared`
  half vanishes). "a NAME prefix is not a DIRECTORY prefix" stays green — it asserts `false`, which
  the mutant still answers — and that asymmetry is why the count is measured, not guessed. Revert.

- [ ] 6. Mutation ceremony C — *doubt is not death* (the D12 mutant that matters most). Plant in
  `claimExpiry`: change `case 'unmeasurable': return { act: 'hold' };` to fall through to the
  `'gone'` arm (`case 'unmeasurable': case 'gone': return now >= row.expiresAt ? … : …;` — treat
  unmeasurable as gone). Run: expect EXACTLY ONE red — "an UNMEASURABLE holder is HELD, even past
  its lease". This mutant is the fleet-box-hiccup mass-expiry; one red test is what stands between
  it and production. Revert.

- [ ] 7. Mutation ceremony D — *the hard cap is never extended*. Plant: change
  `const next = Math.min(now + CLAIM_LEASE_MS, row.hardExpiresAt);` to
  `const next = now + CLAIM_LEASE_MS;`. Run: expect EXACTLY TWO red — "a renewal CLAMPS at
  hardExpiresAt" and "a renewal that would not move the lease is a hold" (the unclamped `next`
  now clears an `expiresAt` already sitting at the cap). Revert.

- [ ] 8. Mutation ceremony E — *unknown is not no*. Plant in `server/src/coord/peers.ts`: change
  `if (p.registry === 'unmeasurable') return 'unknown';` to `return 'no:not-in-registry';`. Run
  `./node_modules/.bin/vitest run test/peers.test.ts test/deliverability-parity.test.ts`: expect
  EXACTLY TWO red — Task 8's rung-1 unknown test and the parity row "a registry row listed but
  unreadable is unknown". Revert.

- [ ] 9. Mutation ceremony F — *a legacy tail never seeds the floor*. Plant in
  `server/src/coord/ledger.ts`: inside the legacy loop, after the `legacy.add(m[0]);` line, add

  ```ts
  const t = Number(m[2]);
  if (t > max) { max = t; evidence = `${f.path} names ${m[0]}`; }
  ```

  Run `./node_modules/.bin/vitest run test/ledger.test.ts`: expect TWO red — "recognizes the
  legacy…never feeds the floor" (floor jumps to 450) and "a tree with ONLY legacy refs is NOT a
  seed". Revert.

- [ ] 10. Run the whole section's suites foreground, one last measured green:

  ```bash
  cd server && ./node_modules/.bin/vitest run \
    test/coord-db.test.ts test/claims.test.ts test/peers.test.ts test/ledger.test.ts \
    test/deliverability-parity.test.ts test/mail-sweep.test.ts \
    test/single-definition.test.ts test/typecheck-tests.test.ts
  ```

  (Timeout ≥ 600000 ms; if `mail-sweep` or `typecheck-tests` flake under load, re-run IN ISOLATION
  before calling anything broken — they are on the known-flake list, and CI on the quiet box is the
  arbiter.)

- [ ] 11. Commit:

  ```bash
  cd server && git add test/claims.test.ts test/ledger.test.ts
  git commit -m "test(wave7a): the D12 mutants die on schedule — six ceremonies, six measured reds"
  ```

---

## Hand-off ledger for parts B and C

Part B (store methods, `ledgerlog.ts`, routes, sweeps) builds against exactly:

- **Schema (Task 6):** `claims`, `claim_paths` (+ `claim_one_owner` partial unique, `live` mirror
  bit flipped in the same `tx()` as `claims.state` — part B owns the desync mutant), `ledger_alloc`
  (`PRIMARY KEY (project, n)`), `ledger_floor`. `COORD_SCHEMA_VERSION === 4`.
- **`claims.ts` (Task 7):** `decideClaim(existing, req)` (feed it live rows read inside the same
  `tx()`, expiry already applied; assemble `ClaimRow.holderDeliverable` via `peerDeliverable`),
  `claimExpiry(row, now, verdict)` for `renewClaims`/`lapseClaims` on the existing FleetWatcher
  tick, `LivenessProbe` to implement over the tick's already-read records, `normalizeClaimPath` for
  insert-time normalization.
- **`peers.ts` (Task 8):** `peerDeliverable(probe)` for `GET /api/peers` and for claim-conflict
  decoration; `archiveContradicted(archivedAt, lifecycle)` for `PeerSummary.archivedStale` AND
  `divergence.archived-but-live` — one predicate, both consumers, by import.
- **`ledger.ts` (Task 9):** `decideAllocation(floorRow, maxLanded, count)` — `maxLanded` is MAX
  over `ledger_alloc` in EVERY state and the flat log; `floorFromScan(files)` for
  `sweepLedgerFloor` (sort the readdir before calling; write `evidence` verbatim; surface `legacy`
  for the D14 wave), `LEDGER_ALLOC_MAX` for the route's bad-count arm.
- **Fixture (Task 10):** part B's `GET /api/peers` route tests re-drive `DELIVERABILITY_FIXTURE`
  through the route; do not fork the table.
# Section 4 — Wave 7 part B: store, ledgerlog, watcher sweeps (Tasks 12–17)

Server-only. Nothing here touches `ccd/`, `session-hook.sh` or any skill, so **no agent-first
ordering applies to this section** — every commit ships in the ordinary server lane. No routes are
registered here (route-parity stays untouched); release/break/allocate are exposed over HTTP by the
Wave 7 part C section, which consumes this section's store methods.

**Execution discipline for every task below:** run suites in the FOREGROUND from inside `server/`
as `./node_modules/.bin/vitest run test/<file> ` with timeout ≥ 600000 ms — never bare `npx vitest`.
Fixture HOMEs only (`mkTmp` from `test/tmpHelpers.ts`); no test touches the live `$HOME`. Any
deviation found during execution takes the next global D-number — **D-211 is believed free, but
re-sweep every remote ref (`git grep 'D-21[0-9]' $(git branch -r --format='%(refname)')` across
`docs/` AND source) before allocating**, per the collision history.

## What this section CONSUMES (produced by Wave 1 / Wave 7 part A — exact shapes)

The tasks below compile against these exact declarations. If a name below differs in the landed
part-A/wave-1 code, the executing engineer reconciles **toward the landed spelling** and records a
deviation — the semantics here are binding, the spelling is part A's to own.

From `shared/api.ts` (Wave 1, L0 — imports nothing):

```ts
export const CLAIM_STATES = ['live', 'released', 'lapsed', 'broken'] as const;
/** `'unknown'` is the read-side we-do-not-know member — the same rule every
 *  enum column in coord/schema.ts already carries (its header names all of
 *  them). It is NOT a member of CLAIM_STATES: nothing may WRITE it. */
export type ClaimState = (typeof CLAIM_STATES)[number] | 'unknown';
export function isClaimState(v: unknown): v is (typeof CLAIM_STATES)[number];

export interface ClaimSummary {
  id: number; project: string; path: string; sessionId: string; uuid: string;
  runId: number | null; intent: string; state: ClaimState;
  acquiredAt: number; renewedAt: number; expiresAt: number; hardExpiresAt: number;
  endedAt: number | null; endedBy: string | null;
}

export const CLAIM_LEASE_MS = 2_700_000;      // 45 min
export const CLAIM_HARD_CAP_MS = 28_800_000;  // 8 h — never renewed (D12)
export const LEDGER_SEED_GAP = 50;            // D13

export interface DeviationAllocation {
  project: string; numbers: readonly number[]; floor: number;
  title: string; allocatedTo: string; runId: number | null; allocatedAt: number;
}
```

From `server/src/claims.ts` (Wave 7 part A, L1 pure — no fs, no fastify, no clock):

```ts
/** L2 port, declared BY THE CONSUMER (this file), implemented by watch.ts. */
export interface LivenessProbe {
  measure(sessionId: string): 'running' | 'gone' | 'unmeasurable';
}

/** The server-side conflict row. The wire's ClaimConflict (L0) is this plus
 *  `deliverable` and `mailHint`, which only the ROUTE can compose (they need
 *  peers.ts); the store never pretends to know them. */
export interface ClaimConflictRow {
  path: string; heldBy: string; heldByUuid: string; intent: string;
  runId: number | null; expiresAt: number;
}

export type ClaimDecision =
  | { ok: true }
  | { ok: false; why: 'bad-path'; path: string }
  | { ok: false; why: 'conflict'; conflicts: readonly ClaimConflictRow[] };

/** Exact match AND directory-prefix containment BOTH WAYS (`shared` vs
 *  `shared/api.ts` — D11: "which no index can express"). A live row held by
 *  `requester.sessionId` itself is NEVER a conflict (a re-POST is a renewal).
 *  `''`, `'.'`, absolute paths and `..` segments answer `bad-path`. One
 *  conflict ⇒ conflicts[] names EVERY conflicting path, not the first. */
export function decideClaim(
  requester: { sessionId: string },
  paths: readonly string[],
  live: readonly { path: string; sessionId: string; uuid: string;
                   runId: number | null; intent: string; expiresAt: number }[],
): ClaimDecision;

export type ExpiryDecision =
  | { act: 'renew'; expiresAt: number }
  | { act: 'lapse'; endedBy: 'session-gone' | 'hard-cap' }
  | { act: 'keep' };

/** D12 verbatim: hard cap FIRST (now >= hardExpiresAt ⇒ lapse 'hard-cap',
 *  whatever the liveness); 'running' ⇒ renew to min(now+CLAIM_LEASE_MS,
 *  hardExpiresAt); 'unmeasurable' ⇒ ALSO renew — doubt reads as HELD, and the
 *  hard cap is what stops doubt holding forever; 'gone' ⇒ keep until the
 *  STANDING expiresAt passes, then lapse 'session-gone'. */
export function claimExpiry(
  c: { expiresAt: number; hardExpiresAt: number },
  liveness: 'running' | 'gone' | 'unmeasurable',
  now: number,
): ExpiryDecision;
```

From `server/src/ledger.ts` (Wave 7 part A, L1 pure):

```ts
export type AllocationDecision =
  | { ok: true; numbers: readonly number[] }
  | { ok: false; why: 'not-seeded' }   // floor === null
  | { ok: false; why: 'bad-count' };   // count not an integer in 1..50

/** next = MAX(floor, maxAllocated + 1, fileMax + 1); numbers are `count`
 *  contiguous integers from next. null maxAllocated/fileMax read as 0. */
export function decideAllocation(input: {
  floor: number | null; maxAllocated: number | null;
  fileMax: number | null; count: number;
}): AllocationDecision;

/** Greatest global `D-<n>` across the given file texts, with the file that
 *  carries it. Legacy `D-B<k>-<m>` forms are RECOGNISED AND IGNORED (D14 —
 *  their digits must not parse as global numbers). null = no global ref
 *  anywhere. */
export function floorFromScan(
  files: readonly { name: string; text: string }[],
): { max: number; file: string } | null;
```

From `server/src/coord/schema.ts` (Wave 7 part A — `MIGRATIONS[3]`, `user_version 3 -> 4`).
This section's store methods and mutation ceremonies read/write these exact tables:

```sql
CREATE TABLE claims (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project       TEXT NOT NULL,
  path          TEXT NOT NULL,
  sessionId     TEXT NOT NULL,           -- the holder (heldBy on the wire)
  uuid          TEXT NOT NULL,
  runId         INTEGER REFERENCES runs(id),
  intent        TEXT NOT NULL,           -- <= 512 B, re-writable by re-POST (D12)
  state         TEXT NOT NULL,           -- live|released|lapsed|broken; 'unknown' on READ only
  acquiredAt    INTEGER NOT NULL,
  renewedAt     INTEGER NOT NULL,
  expiresAt     INTEGER NOT NULL,
  hardExpiresAt INTEGER NOT NULL,        -- acquiredAt + CLAIM_HARD_CAP_MS, NEVER renewed
  endedAt       INTEGER,
  endedBy       TEXT
);
CREATE UNIQUE INDEX claim_one_owner ON claims(project, path) WHERE state = 'live';
CREATE INDEX claims_by_session ON claims(sessionId);
CREATE INDEX claims_by_run     ON claims(runId);

CREATE TABLE ledger_alloc (
  project     TEXT NOT NULL,
  n           INTEGER NOT NULL,
  title       TEXT NOT NULL,
  allocatedTo TEXT NOT NULL,
  runId       INTEGER,
  allocatedAt INTEGER NOT NULL,
  state       TEXT NOT NULL,             -- allocated|landed
  landedAt    INTEGER,
  landedIn    TEXT,
  PRIMARY KEY (project, n)
);

CREATE TABLE ledger_floor (
  project   TEXT PRIMARY KEY,
  floor     INTEGER NOT NULL,
  evidence  TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);
```

## What this section PRODUCES (later sections consume these)

- `CoordStore` (server/src/coord/store.ts): `claimAttempt`, `claimRelease`, `claimBreak`,
  `activeClaims`, `claimsForProject`, `renewClaimRow`, `lapseClaimRow`, `releaseClaimsForRun`
  (called inside `closeRun`'s own transaction), `ledgerFloor`, `raiseLedgerFloor`,
  `allocateDeviations`, `ledgerAllocations`, `openAllocations`, `markLanded`, `staleAllocations`
  — exact signatures in Tasks 12/13/15.
- `server/src/coord/ledgerlog.ts`: `LedgerLog`, `LedgerLogEntry`, `defaultLedgerLogPath`.
- `FleetWatcher` (server/src/watch.ts): `renewClaims`, `lapseClaims`, `sweepLedgerFloor`,
  `sweepLedgerReconcile` — all riding the EXISTING tick on their own clocks; `sweepMail` untouched.
- `shared/api.ts`: `DivergenceKind` gains `'claim-orphan'` (this section's Task 15 owns that one
  L0 edit; the Wave-1 section must NOT also add it).
- `server/src/divergence.ts`: `DivergenceInput` gains `liveClaims` + `openRunIds`; `divergences()`
  gains arm 6 (`claim-orphan`).
- The route section owes each `POST /api/ledger/deviations` request a **3× in-request retry** on a
  thrown constraint violation (spec §3) and holds the process's one `LedgerLog` instance
  (`defaultLedgerLogPath()`), passing it into `allocateDeviations`.
- The `claims-advisory.test.ts` author (part A/C): `server/src/watch.ts` is a SANCTIONED reader of
  `activeClaims` (D12 names `renewClaims()` riding the tick) — the scan must allow routes,
  `peers.ts`, `divergence.ts`'s input feed in `watch.ts`, and the two claim sweeps.

---

### Task 12: Store claim methods — the CAS in one transaction

**Files:**
- Modify: `server/src/coord/store.ts` — import block (lines 1–14: add `decideClaim`/
  `ClaimConflictRow` from `../claims.js`; add `CLAIM_LEASE_MS`, `CLAIM_HARD_CAP_MS`,
  `isClaimState`, `type ClaimState`, `type ClaimSummary` to the `shared/api.js` import); new
  result types after `SettleItemsResult` (after line 92); new methods appended after
  `recentProvenance` (its body ends at line 2012), before the class's closing brace (line 2013).
- Create: `server/test/claims-store.test.ts`

**Interfaces:**
- Consumes: `decideClaim`, `ClaimConflictRow` (`server/src/claims.ts`, part A); `CLAIM_LEASE_MS`,
  `CLAIM_HARD_CAP_MS`, `ClaimSummary`, `isClaimState` (`shared/api.ts`, Wave 1); `claims` table +
  `claim_one_owner` (`MIGRATIONS[3]`, part A); `tx` (`server/src/coord/db.ts:245`).
- Produces:
  ```ts
  export type ClaimAttemptResult =
    | { ok: true; claims: ClaimSummary[] }
    | { ok: false; why: 'bad-path'; path: string }
    | { ok: false; why: 'conflict'; conflicts: readonly ClaimConflictRow[] };
  export type ClaimEndResult =
    | { ok: true; state: 'released' | 'broken' }
    | { ok: false; why: 'unknown-claim' }
    | { ok: false; why: 'not-live'; state: ClaimState };
  // on CoordStore:
  claimAttempt(input: { project: string; paths: readonly string[]; sessionId: string;
    uuid: string; runId: number | null; intent: string; now?: number }): ClaimAttemptResult
  claimRelease(id: number, by: string, now?: number): ClaimEndResult
  claimBreak(id: number, by: string, now?: number): ClaimEndResult
  activeClaims(): ClaimSummary[]
  claimsForProject(project: string, all?: boolean): ClaimSummary[]
  ```

**Steps:**

- [ ] Confirm the part-A dependencies landed before starting:
  `grep -n 'claim_one_owner' server/src/coord/schema.ts && grep -n 'export function decideClaim' server/src/claims.ts && grep -n 'CLAIM_LEASE_MS' shared/api.ts`
  — expect one hit each. If any is missing, STOP: this task builds on Wave 7 part A and Wave 1.

- [ ] Write the failing test file `server/test/claims-store.test.ts`:

```ts
// Build 9 wave 7 (D11/D12): the claim CAS. THE IN-TRANSACTION READ IS THE CAS;
// THE PARTIAL UNIQUE INDEX IS THE BACKSTOP — both directions are pinned here,
// in that order, so neither can be "simplified away" as redundant.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { CLAIM_LEASE_MS, CLAIM_HARD_CAP_MS } from '../../shared/api.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-claims-'), '.ccrc', 'coord.db')));

const NOW = 1_785_300_000_000;

const attempt = (s: CoordStore, over: Partial<Parameters<CoordStore['claimAttempt']>[0]> = {}) =>
  s.claimAttempt({
    project: 'demo', paths: ['server/src/io.ts'], sessionId: 'demo-quiet-basin',
    uuid: 'u-1', runId: null, intent: 'measured-read seam', now: NOW, ...over,
  });

describe('CoordStore.claimAttempt', () => {
  it('acquires: live, leased 45 min, hard-capped 8 h, intent carried', () => {
    const s = store();
    const r = attempt(s);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error('unreachable');
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]).toMatchObject({
      project: 'demo', path: 'server/src/io.ts', sessionId: 'demo-quiet-basin',
      uuid: 'u-1', runId: null, intent: 'measured-read seam', state: 'live',
      acquiredAt: NOW, renewedAt: NOW,
      expiresAt: NOW + CLAIM_LEASE_MS, hardExpiresAt: NOW + CLAIM_HARD_CAP_MS,
      endedAt: null, endedBy: null,
    });
    expect(s.activeClaims()).toHaveLength(1);
  });

  it('claimsForProject: live only by default; all=true is the history read', () => {
    const s = store();
    attempt(s);
    expect(s.claimsForProject('demo')).toHaveLength(1);
    expect(s.claimsForProject('demo', true)).toHaveLength(1);
    expect(s.claimsForProject('other-project')).toEqual([]);
  });
});
```

- [ ] Run it, expect FAIL: `cd server && ./node_modules/.bin/vitest run test/claims-store.test.ts`
  — `TypeError: s.claimAttempt is not a function`.

- [ ] Write the implementation. In `server/src/coord/store.ts`, extend the two import statements
  (lines 1–14):

```ts
import { decideClaim, type ClaimConflictRow } from '../claims.js';
```

  and add to the `shared/api.js` import list: `CLAIM_HARD_CAP_MS, CLAIM_LEASE_MS, isClaimState`
  (values) and `type ClaimState, type ClaimSummary, type DeviationAllocation` (types —
  `DeviationAllocation` is used by Task 13; adding it now avoids re-touching the block). Then add
  after `SettleItemsResult` (line 92):

```ts
/** Build 9 wave 7 (D12). The failure arms are `decideClaim`'s own, verbatim —
 *  the store adds nothing to a refusal and takes nothing from it. */
export type ClaimAttemptResult =
  | { ok: true; claims: ClaimSummary[] }
  | { ok: false; why: 'bad-path'; path: string }
  | { ok: false; why: 'conflict'; conflicts: readonly ClaimConflictRow[] };

/** Release and break share this shape — `setWorkItemState`'s refusal family:
 *  a caller must be able to see that ITS call was not the one that landed. */
export type ClaimEndResult =
  | { ok: true; state: 'released' | 'broken' }
  | { ok: false; why: 'unknown-claim' }
  | { ok: false; why: 'not-live'; state: ClaimState };
```

  and append before the class's closing brace (line 2013):

```ts
  /* ── claims (build 9 wave 7, D11/D12) ──────────────────────────────────── */

  /** The column list, named ONCE — `SELECT *` is banned in this directory. */
  private static readonly CLAIM_COLS =
    'id, project, path, sessionId, uuid, runId, intent, state, acquiredAt, renewedAt, ' +
    'expiresAt, hardExpiresAt, endedAt, endedBy';

  /** One raw row -> the typed shape. `state` goes through `isClaimState`,
   *  never a cast — a token a newer build wrote reads as `'unknown'`, the
   *  same rule `hydrateRun`/`feedEvents`/`lifecycleFor` already hold. */
  private hydrateClaim(r: {
    id: number; project: string; path: string; sessionId: string; uuid: string;
    runId: number | null; intent: string; state: string; acquiredAt: number;
    renewedAt: number; expiresAt: number; hardExpiresAt: number;
    endedAt: number | null; endedBy: string | null;
  }): ClaimSummary {
    return {
      id: r.id, project: r.project, path: r.path, sessionId: r.sessionId, uuid: r.uuid,
      runId: r.runId, intent: r.intent,
      state: isClaimState(r.state) ? r.state : 'unknown',
      acquiredAt: r.acquiredAt, renewedAt: r.renewedAt,
      expiresAt: r.expiresAt, hardExpiresAt: r.hardExpiresAt,
      endedAt: r.endedAt, endedBy: r.endedBy,
    };
  }

  private claimRow(id: number): ClaimSummary {
    const row = this.db.prepare(
      `SELECT ${CoordStore.CLAIM_COLS} FROM claims WHERE id = ?`,
    ).get(id) as Parameters<CoordStore['hydrateClaim']>[0] | undefined;
    if (row === undefined) throw new Error(`claims row ${id} vanished inside its own transaction`);
    return this.hydrateClaim(row);
  }

  /**
   * Acquire (or renew) a set of path claims, as ONE transaction (D11) —
   * the two mechanisms IN THIS ORDER, so a reviewer does not read either
   * as redundant:
   *
   *  1. THE IN-TRANSACTION READ IS THE CAS. `tx()` is `BEGIN IMMEDIATE` and
   *     `DatabaseSync` has no async surface, so nothing can interleave
   *     between the read below and the inserts under it. `decideClaim` (L1)
   *     owns the conflict rule — exact match AND directory-prefix containment
   *     both ways (`shared` vs `shared/api.ts`), which no index can express.
   *  2. THE PARTIAL UNIQUE INDEX `claim_one_owner` IS THE BACKSTOP: if a
   *     future refactor ever loses the transaction, the failure is a LOUD
   *     constraint violation, never a silent duplicate.
   *
   * All-or-nothing (D12): five paths, one conflict ⇒ zero acquired, and the
   * refusal names EVERY conflicting path. A live claim this session already
   * holds on the exact path is RENEWED — intent re-written, lease re-armed,
   * never past the hard cap ("an intent can be written every ten minutes").
   */
  claimAttempt(input: {
    project: string; paths: readonly string[]; sessionId: string; uuid: string;
    runId: number | null; intent: string; now?: number;
  }): ClaimAttemptResult {
    const now = input.now ?? Date.now();
    return tx(this.db, () => {
      const live = this.db.prepare(
        'SELECT id, path, sessionId, uuid, runId, intent, expiresAt FROM claims ' +
        "WHERE project = ? AND state = 'live'",
      ).all(input.project) as { id: number; path: string; sessionId: string; uuid: string;
                                runId: number | null; intent: string; expiresAt: number }[];
      const out: ClaimSummary[] = [];
      for (const p of [...new Set(input.paths)]) {
        const own = live.find((c) => c.sessionId === input.sessionId && c.path === p);
        if (own !== undefined) {
          this.db.prepare(
            'UPDATE claims SET uuid = ?, runId = ?, intent = ?, renewedAt = ?, ' +
            "expiresAt = MIN(?, hardExpiresAt) WHERE id = ? AND state = 'live'",
          ).run(input.uuid, input.runId, input.intent, now, now + CLAIM_LEASE_MS, own.id);
          out.push(this.claimRow(own.id));
        } else {
          const res = this.db.prepare(
            'INSERT INTO claims (project, path, sessionId, uuid, runId, intent, state, ' +
            'acquiredAt, renewedAt, expiresAt, hardExpiresAt) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ).run(input.project, p, input.sessionId, input.uuid, input.runId, input.intent,
            'live', now, now, now + CLAIM_LEASE_MS, now + CLAIM_HARD_CAP_MS);
          out.push(this.claimRow(Number(res.lastInsertRowid)));
        }
      }
      return { ok: true as const, claims: out };
    });
  }

  activeClaims(): ClaimSummary[] {
    const rows = this.db.prepare(
      `SELECT ${CoordStore.CLAIM_COLS} FROM claims WHERE state = 'live' ORDER BY id`,
    ).all() as Parameters<CoordStore['hydrateClaim']>[0][];
    return rows.map((r) => this.hydrateClaim(r));
  }

  /** `all` includes lapsed/released/broken rows — `?all=1`'s "held by X until
   *  it died" (D12: a destroyed claim is destroyed history). */
  claimsForProject(project: string, all = false): ClaimSummary[] {
    const rows = (all
      ? this.db.prepare(
          `SELECT ${CoordStore.CLAIM_COLS} FROM claims WHERE project = ? ORDER BY id`)
      : this.db.prepare(
          `SELECT ${CoordStore.CLAIM_COLS} FROM claims WHERE project = ? AND state = 'live' ORDER BY id`)
    ).all(project) as Parameters<CoordStore['hydrateClaim']>[0][];
    return rows.map((r) => this.hydrateClaim(r));
  }
```

  (Note: `decideClaim` and the expiry pre-pass are NOT called yet — the next two red cycles add
  them, so their tests are genuinely red first.)

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/claims-store.test.ts`.

- [ ] Write the failing conflict tests — append to `server/test/claims-store.test.ts` inside the
  `claimAttempt` describe:

```ts
  it('ALL-OR-NOTHING: one conflict refuses every path, and names EVERY conflicting path', () => {
    const s = store();
    attempt(s, { paths: ['shared/api.ts', 'server/src/io.ts'] });
    const r = attempt(s, {
      sessionId: 'demo-calm-mesa', uuid: 'u-2',
      paths: ['shared/api.ts', 'server/src/io.ts', 'docs/notes.md'],
    });
    expect(r).toMatchObject({ ok: false, why: 'conflict' });
    if (r.ok || r.why !== 'conflict') throw new Error('unreachable');
    expect(r.conflicts.map((c) => c.path).sort()).toEqual(['server/src/io.ts', 'shared/api.ts']);
    expect(r.conflicts[0]).toMatchObject({
      heldBy: 'demo-quiet-basin', heldByUuid: 'u-1',
      intent: 'measured-read seam', runId: null, expiresAt: NOW + CLAIM_LEASE_MS,
    });
    // zero acquired — docs/notes.md was NOT claimed on the side
    expect(s.claimsForProject('demo').map((c) => c.sessionId)).toEqual(
      ['demo-quiet-basin', 'demo-quiet-basin']);
  });

  it('directory-prefix containment conflicts BOTH WAYS — the rule no index can express', () => {
    const s = store();
    attempt(s, { paths: ['shared'] });
    const inner = attempt(s, { sessionId: 'demo-calm-mesa', uuid: 'u-2', paths: ['shared/api.ts'] });
    expect(inner).toMatchObject({ ok: false, why: 'conflict' });
    attempt(s, { sessionId: 'demo-warm-ridge', uuid: 'u-3', paths: ['server/src/io.ts'] });
    const outer = attempt(s, { sessionId: 'demo-calm-mesa', uuid: 'u-2', paths: ['server'] });
    expect(outer).toMatchObject({ ok: false, why: 'conflict' });
  });

  it("a claim on '.' is refused bad-path — claiming the whole repo IS the module wedge", () => {
    const s = store();
    expect(attempt(s, { paths: ['.'] })).toMatchObject({ ok: false, why: 'bad-path', path: '.' });
    expect(s.activeClaims()).toEqual([]);
  });
```

- [ ] Run, expect FAIL: the conflict tests get `{ ok: true }` back (nothing refuses yet) —
  `expected { ok: true, … } to match { ok: false, why: 'conflict' }`.

- [ ] Wire `decideClaim` in: in `claimAttempt`, insert between the `live` read and the
  `const out: ClaimSummary[] = [];` line:

```ts
      const decision = decideClaim({ sessionId: input.sessionId }, input.paths, live);
      if (!decision.ok) return decision;
```

- [ ] Run, expect PASS (all six tests).

- [ ] Write the failing renew-on-re-POST tests — append inside the same describe:

```ts
  it('re-POSTing the same path RENEWS and re-writes intent — one row, not two (D12 ruling 3)', () => {
    const s = store();
    const first = attempt(s);
    if (!first.ok) throw new Error('unreachable');
    const again = attempt(s, { intent: 'now migrating the seam', now: NOW + 600_000 });
    expect(again).toMatchObject({ ok: true });
    if (!again.ok) throw new Error('unreachable');
    expect(again.claims[0]).toMatchObject({
      id: first.claims[0]!.id,                      // the SAME row
      intent: 'now migrating the seam',
      renewedAt: NOW + 600_000,
      expiresAt: NOW + 600_000 + CLAIM_LEASE_MS,
      hardExpiresAt: NOW + CLAIM_HARD_CAP_MS,       // NEVER moved by a renewal
      acquiredAt: NOW,
    });
    expect(s.claimsForProject('demo', true)).toHaveLength(1);
  });

  it('a renewal NEVER extends past the hard cap — the 8 h bound no re-POST can move', () => {
    const s = store();
    attempt(s);
    const late = attempt(s, { now: NOW + CLAIM_HARD_CAP_MS - 60_000 });
    if (!late.ok) throw new Error('unreachable');
    expect(late.claims[0]!.expiresAt).toBe(NOW + CLAIM_HARD_CAP_MS);
  });
```

- [ ] Run — these two SHOULD already PASS (the renew arm shipped with the first cycle). Confirm
  green, then prove they are not vacuous: temporarily change `MIN(?, hardExpiresAt)` to `?` in the
  renew UPDATE, run, expect the hard-cap test RED
  (`expected 1785328740000 + 2700000 to be 1785328800000`), revert, run, expect PASS. (This is the
  first mutant of this section's ceremony; Task 17 runs the full sweep.)

- [ ] Write the failing release/break tests — append a new describe:

```ts
describe('CoordStore.claimRelease / claimBreak', () => {
  it('release ends a live claim; the row SURVIVES with endedAt/endedBy', () => {
    const s = store();
    const r = attempt(s);
    if (!r.ok) throw new Error('unreachable');
    const id = r.claims[0]!.id;
    expect(s.claimRelease(id, 'demo-quiet-basin', NOW + 1000)).toEqual(
      { ok: true, state: 'released' });
    expect(s.activeClaims()).toEqual([]);
    expect(s.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'released', endedAt: NOW + 1000, endedBy: 'demo-quiet-basin' });
  });

  it('a second release answers not-live — the caller learns ITS call was not the one', () => {
    const s = store();
    const r = attempt(s);
    if (!r.ok) throw new Error('unreachable');
    const id = r.claims[0]!.id;
    s.claimRelease(id, 'demo-quiet-basin', NOW + 1000);
    expect(s.claimRelease(id, 'demo-quiet-basin', NOW + 2000)).toEqual(
      { ok: false, why: 'not-live', state: 'released' });
    expect(s.claimRelease(9999, 'demo-quiet-basin')).toEqual(
      { ok: false, why: 'unknown-claim' });
  });

  it("break is the operator's door: state 'broken', endedBy recorded", () => {
    const s = store();
    const r = attempt(s);
    if (!r.ok) throw new Error('unreachable');
    expect(s.claimBreak(r.claims[0]!.id, 'operator', NOW + 1000)).toEqual(
      { ok: true, state: 'broken' });
    expect(s.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'broken', endedBy: 'operator' });
  });

  it('a released path is claimable again — the unique index is PARTIAL on purpose', () => {
    const s = store();
    const r = attempt(s);
    if (!r.ok) throw new Error('unreachable');
    s.claimRelease(r.claims[0]!.id, 'demo-quiet-basin', NOW + 1000);
    const again = attempt(s, { sessionId: 'demo-calm-mesa', uuid: 'u-2', now: NOW + 2000 });
    expect(again).toMatchObject({ ok: true });
    expect(s.claimsForProject('demo', true)).toHaveLength(2);   // history + the new claim
  });

  it('THE BACKSTOP IS REAL: a second LIVE row on one (project, path) throws loudly', () => {
    // D11 mechanism 2, exercised against the actual index — if a refactor
    // loses the transaction, THIS is the failure mode, never a duplicate.
    const s = store();
    attempt(s);
    expect(() => s.db.prepare(
      'INSERT INTO claims (project, path, sessionId, uuid, runId, intent, state, ' +
      'acquiredAt, renewedAt, expiresAt, hardExpiresAt) ' +
      "VALUES ('demo', 'server/src/io.ts', 'demo-calm-mesa', 'u-2', NULL, 'x', 'live', 1, 1, 2, 3)",
    ).run()).toThrow(/UNIQUE|claim_one_owner/i);
  });
});
```

- [ ] Run, expect FAIL: `TypeError: s.claimRelease is not a function`.

- [ ] Write the implementation — append to the claims block in `store.ts`:

```ts
  /** THE GUARD IS IN THE `WHERE`, not in the read above it — `setWorkItemState`'s
   *  exact shape and reason: `changes === 0` past a successful lookup means
   *  exactly one thing, the row was not live. */
  private endClaim(id: number, state: 'released' | 'broken', by: string,
                   now: number): ClaimEndResult {
    const row = this.db.prepare('SELECT state FROM claims WHERE id = ?').get(id) as
      { state: string } | undefined;
    if (!row) return { ok: false, why: 'unknown-claim' };
    const res = this.db.prepare(
      "UPDATE claims SET state = ?, endedAt = ?, endedBy = ? WHERE id = ? AND state = 'live'",
    ).run(state, now, by, id);
    if (Number(res.changes) === 0) {
      return { ok: false, why: 'not-live', state: isClaimState(row.state) ? row.state : 'unknown' };
    }
    return { ok: true, state };
  }

  claimRelease(id: number, by: string, now: number = Date.now()): ClaimEndResult {
    return this.endClaim(id, 'released', by, now);
  }

  /** `POST /api/claims/:id/break` — a door the CLAIMANT is not the one to walk
   *  through (the `abandon` shape). Same mechanics as release; a different
   *  word, because "I am done" and "someone pried this open" are different
   *  facts a `?all=1` reader needs to tell apart. */
  claimBreak(id: number, by: string, now: number = Date.now()): ClaimEndResult {
    return this.endClaim(id, 'broken', by, now);
  }
```

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/claims-store.test.ts`.

- [ ] Write the failing in-transaction expiry test — append inside the `claimAttempt` describe:

```ts
  it('EXPIRY RIDES EVERY ATTEMPT — a claim route never sees a stale row even with the watcher wedged', () => {
    const s = store();
    attempt(s);                                              // lease ends NOW + CLAIM_LEASE_MS
    const later = attempt(s, {
      sessionId: 'demo-calm-mesa', uuid: 'u-2', now: NOW + CLAIM_LEASE_MS + 1,
    });
    expect(later).toMatchObject({ ok: true });               // the stale holder no longer blocks
    // LAPSE, NOT DELETE: the expired row survives as history, in the same tx.
    const rows = s.claimsForProject('demo', true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sessionId: 'demo-quiet-basin', state: 'lapsed',
      endedAt: NOW + CLAIM_LEASE_MS + 1, endedBy: 'expired' });
    expect(rows[1]).toMatchObject({ sessionId: 'demo-calm-mesa', state: 'live' });
  });

  it('the hard cap wins the word when a row is past BOTH bounds', () => {
    const s = store();
    attempt(s);
    attempt(s, { sessionId: 'demo-calm-mesa', uuid: 'u-2', now: NOW + CLAIM_HARD_CAP_MS + 1 });
    expect(s.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'lapsed', endedBy: 'hard-cap' });
  });
```

- [ ] Run, expect FAIL: the second attempt answers `{ ok: false, why: 'conflict' }` — the stale
  row still reads live.

- [ ] Add the expiry pre-pass. In `store.ts`, append the private method to the claims block:

```ts
  /** Expire in the same transaction as every claim attempt — the
   *  `feed_events` prune-on-write idiom (D12): a claim route never sees a
   *  stale row even if the watcher is wedged. Hard cap FIRST, so a row past
   *  both bounds records the harder word. LAPSE, NEVER DELETE. */
  private expireLapsedInner(now: number): void {
    this.db.prepare(
      "UPDATE claims SET state = 'lapsed', endedAt = ?, endedBy = 'hard-cap' " +
      "WHERE state = 'live' AND hardExpiresAt <= ?",
    ).run(now, now);
    this.db.prepare(
      "UPDATE claims SET state = 'lapsed', endedAt = ?, endedBy = 'expired' " +
      "WHERE state = 'live' AND expiresAt <= ?",
    ).run(now, now);
  }
```

  and make it the FIRST statement inside `claimAttempt`'s `tx` callback, above the `live` read,
  with this comment line: `// 1 — expire lapsed rows IN THE SAME TX, then read, then insert (D11).`

- [ ] Run, expect PASS. Then run the neighbours that share this file:
  `./node_modules/.bin/vitest run test/coord-store.test.ts test/lifecycle-store.test.ts` — expect
  PASS (no existing method was touched).

- [ ] Commit:
  `git add server/src/coord/store.ts server/test/claims-store.test.ts && git commit -m "server(w7): claims land as one transaction — the read is the CAS, the index is the backstop"`

---

### Task 13: `ledgerlog.ts` — the file first, the commit second

**Files:**
- Create: `server/src/coord/ledgerlog.ts`
- Create: `server/test/ledgerlog.test.ts`
- Create: `server/test/ledger-store.test.ts`
- Modify: `server/src/coord/store.ts` — import block (add `decideAllocation` from `../ledger.js`,
  `type LedgerLog` from `./ledgerlog.js`); new methods appended after the Task-12 claims block.

**Interfaces:**
- Consumes: `decideAllocation` (`server/src/ledger.ts`, part A); `DeviationAllocation`,
  `LEDGER_SEED_GAP` (`shared/api.ts`, Wave 1 — `LEDGER_SEED_GAP` is used by Task 16, imported by
  the watcher, not here); `ledger_alloc` + `ledger_floor` (`MIGRATIONS[3]`, part A).
- Produces:
  ```ts
  // server/src/coord/ledgerlog.ts
  export function defaultLedgerLogPath(home?: string): string   // ~/.ccrc/ledger-alloc.log
  export interface LedgerLogEntry { project: string; n: number; title: string;
                                    allocatedTo: string; at: number }
  export class LedgerLog {
    constructor(readonly logPath: string)
    append(entries: readonly LedgerLogEntry[]): void
    maxAllocated(project: string): number | null   // MAX over parsed AND torn lines; throws on unreadable
  }
  // on CoordStore:
  export interface LedgerRow { project: string; n: number; title: string; allocatedTo: string;
    runId: number | null; allocatedAt: number; state: 'allocated' | 'landed' | 'unknown';
    landedAt: number | null; landedIn: string | null }
  export type AllocateResult =
    | { ok: true; allocation: DeviationAllocation }
    | { ok: false; why: 'not-seeded' }
    | { ok: false; why: 'bad-count' };
  ledgerFloor(project: string): { floor: number; evidence: string; updatedAt: number } | null
  raiseLedgerFloor(project: string, floor: number, evidence: string, at: number): void
  allocateDeviations(input: { project: string; count: number; title: string; allocatedTo: string;
    runId: number | null; now?: number }, log: LedgerLog): AllocateResult
  ledgerAllocations(project: string): LedgerRow[]
  openAllocations(): LedgerRow[]
  markLanded(project: string, n: number, landedIn: string, at: number): void
  staleAllocations(cutoff: number): LedgerRow[]
  ```

**Steps:**

- [ ] Write the failing test file `server/test/ledgerlog.test.ts`:

```ts
// D8/D13: ledger_alloc is AUTHORITATIVE WITH A FLAT-FILE GROUND TRUTH — every
// allocation is appended to ~/.ccrc/ledger-alloc.log FIRST and committed
// SECOND; recovery takes MAX(file, db), so a number is SKIPPED, NEVER REISSUED.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { LedgerLog, defaultLedgerLogPath } from '../src/coord/ledgerlog.js';
import { mkTmp } from './tmpHelpers.js';

const fresh = (): LedgerLog =>
  new LedgerLog(path.join(mkTmp('ccrc-ledgerlog-'), '.ccrc', 'ledger-alloc.log'));

describe('LedgerLog', () => {
  it('defaultLedgerLogPath is ~/.ccrc/ledger-alloc.log', () => {
    expect(defaultLedgerLogPath('/home/u')).toBe('/home/u/.ccrc/ledger-alloc.log');
  });

  it('a missing file is null — nothing was ever allocated', () => {
    expect(fresh().maxAllocated('demo')).toBeNull();
  });

  it('append creates the parent and maxAllocated reads back the per-project max', () => {
    const log = fresh();
    log.append([
      { project: 'demo', n: 261, title: 'a', allocatedTo: 'demo-quiet-basin', at: 1 },
      { project: 'demo', n: 262, title: 'a', allocatedTo: 'demo-quiet-basin', at: 1 },
      { project: 'other-project', n: 900, title: 'b', allocatedTo: 'x', at: 1 },
    ]);
    expect(log.maxAllocated('demo')).toBe(262);
    expect(log.maxAllocated('other-project')).toBe(900);
    expect(log.maxAllocated('never-seen')).toBeNull();
    expect(readFileSync(log.logPath, 'utf8').trim().split('\n')).toHaveLength(3);
  });

  it('A TORN FINAL LINE STILL COUNTS — a crash mid-append must not resurrect its numbers', () => {
    const log = fresh();
    log.append([{ project: 'demo', n: 261, title: 'a', allocatedTo: 'demo-quiet-basin', at: 1 }]);
    appendFileSync(log.logPath, '{"project":"demo","n":270,"ti');   // no newline, no close
    expect(log.maxAllocated('demo')).toBe(270);
  });

  it("a torn fragment whose project cannot be recovered counts for EVERY project — over-skipping is free, a reissue is bb47c9e", () => {
    const log = fresh();
    log.append([{ project: 'demo', n: 261, title: 'a', allocatedTo: 'demo-quiet-basin', at: 1 }]);
    appendFileSync(log.logPath, '"n":300,"ti');                     // project half lost
    expect(log.maxAllocated('demo')).toBe(300);
  });

  it('an UNREADABLE log throws — it must fail the allocation, never read as empty', () => {
    const dir = mkTmp('ccrc-ledgerlog-');
    mkdirSync(path.join(dir, 'ledger-alloc.log'));                  // a DIRECTORY at the path: EISDIR
    expect(() => new LedgerLog(path.join(dir, 'ledger-alloc.log')).maxAllocated('demo')).toThrow();
  });
});
```

- [ ] Run, expect FAIL: `cd server && ./node_modules/.bin/vitest run test/ledgerlog.test.ts` —
  `Cannot find module '../src/coord/ledgerlog.js'` (esbuild resolve error).

- [ ] Write the implementation, `server/src/coord/ledgerlog.ts`:

```ts
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * The flat-file ground truth under `ledger_alloc` (D8): every allocation is
 * appended HERE first and committed to coord.db second, and recovery takes
 * MAX(file, db) — so a number is SKIPPED, NEVER REISSUED. Gaps cost nothing
 * (the ledger is prose, parsed by nothing); a reissue cost 394 rewritten
 * D-ref lines across 30 files under merge pressure (bb47c9e).
 *
 * `~/.ccrc/ledger-alloc.log` on the SERVER box — beside `coord.db`, and the
 * same stance as `defaultCoordDbPath`: local-box housekeeping, never proxied
 * through FleetIO. NDJSON, one line per allocated NUMBER, `project` spelled
 * before `n` so a torn tail still names both — see `maxAllocated`'s salvage
 * arm. Synchronous on purpose: `allocateDeviations` calls this INSIDE a
 * `tx()`, and `DatabaseSync`'s no-async invariant is the allocator's whole
 * correctness argument (D11).
 */
export function defaultLedgerLogPath(home: string = homedir()): string {
  return path.join(home, '.ccrc', 'ledger-alloc.log');
}

export interface LedgerLogEntry {
  project: string; n: number; title: string; allocatedTo: string; at: number;
}

export class LedgerLog {
  constructor(readonly logPath: string) {}

  /** One O_APPEND write for the whole batch — the `swap.log` serialisation
   *  argument, though this file has exactly one writer (the single server
   *  process) by construction. */
  append(entries: readonly LedgerLogEntry[]): void {
    mkdirSync(path.dirname(this.logPath), { recursive: true });
    const lines = entries.map((e) => JSON.stringify({
      project: e.project, n: e.n, title: e.title, allocatedTo: e.allocatedTo, at: e.at,
    }) + '\n').join('');
    appendFileSync(this.logPath, lines, 'utf8');
  }

  /**
   * The file's half of MAX(file, db). A missing file is `null` (nothing was
   * ever allocated); an UNREADABLE file THROWS — reading it as empty is
   * exactly the reissue this file exists to prevent, so the allocation must
   * fail loudly instead.
   *
   * THE SALVAGE ARM: a line that does not parse (a crash tore the final
   * append) still counts when an `"n":<digits>` can be read out of the
   * fragment. Over-counting is the safe direction — a fragment whose
   * `project` cannot be recovered counts for EVERY project, because a
   * skipped number costs a gap and a reissued one costs the incident.
   */
  maxAllocated(project: string): number | null {
    let text: string;
    try {
      text = readFileSync(this.logPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    let max: number | null = null;
    const take = (n: number): void => { if (max === null || n > max) max = n; };
    for (const line of text.split('\n')) {
      if (line === '') continue;
      let parsed: unknown = null;
      try { parsed = JSON.parse(line); } catch { parsed = null; }
      if (parsed !== null && typeof parsed === 'object') {
        const p = parsed as { project?: unknown; n?: unknown };
        if (p.project === project && typeof p.n === 'number') take(p.n);
        if (typeof p.n === 'number') continue;   // parsed, other project: not ours, not torn
      }
      const n = /"n":(\d+)/.exec(line);
      if (n === null) continue;
      const pm = /"project":"([^"]*)"/.exec(line);
      if (pm === null || pm[1] === project) take(Number(n[1]));
    }
    return max;
  }
}
```

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/ledgerlog.test.ts`.

- [ ] Write the failing store tests, `server/test/ledger-store.test.ts`:

```ts
// D13: the allocator self-seeds, then fails shut — and D8: the FILE FIRST,
// the COMMIT SECOND, recovery MAX(file, db), numbers skipped never reissued.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { LedgerLog } from '../src/coord/ledgerlog.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_785_300_000_000;

const fixture = (): { s: CoordStore; log: LedgerLog } => {
  const home = mkTmp('ccrc-ledger-');
  return {
    s: new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))),
    log: new LedgerLog(path.join(home, '.ccrc', 'ledger-alloc.log')),
  };
};

const alloc = (s: CoordStore, log: LedgerLog, count = 1, now = NOW) =>
  s.allocateDeviations({ project: 'demo', count, title: 'the measured-read seam',
    allocatedTo: 'demo-quiet-basin', runId: null, now }, log);

describe('CoordStore.allocateDeviations', () => {
  it('FAILS SHUT until seeded — 409 not-seeded before a floor exists (D13)', () => {
    const { s, log } = fixture();
    expect(alloc(s, log)).toEqual({ ok: false, why: 'not-seeded' });
    expect(log.maxAllocated('demo')).toBeNull();          // nothing written anywhere
    expect(s.ledgerAllocations('demo')).toEqual([]);
  });

  it('seeded: contiguous numbers from the floor, in the file AND the db', () => {
    const { s, log } = fixture();
    s.raiseLedgerFloor('demo', 261, 'docs/superpowers/specs/x.md names D-211', NOW);
    const r = alloc(s, log, 3);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error('unreachable');
    expect(r.allocation).toEqual({ project: 'demo', numbers: [261, 262, 263], floor: 261,
      title: 'the measured-read seam', allocatedTo: 'demo-quiet-basin',
      runId: null, allocatedAt: NOW });
    expect(log.maxAllocated('demo')).toBe(263);
    expect(s.ledgerAllocations('demo').map((a) => [a.n, a.state])).toEqual(
      [[261, 'allocated'], [262, 'allocated'], [263, 'allocated']]);
  });

  it('bad-count refuses before anything is written', () => {
    const { s, log } = fixture();
    s.raiseLedgerFloor('demo', 261, 'seeded', NOW);
    expect(alloc(s, log, 0)).toEqual({ ok: false, why: 'bad-count' });
    expect(log.maxAllocated('demo')).toBeNull();
  });

  it('RECOVERY IS MAX(file, db): a file the database never heard of still moves the cursor', () => {
    const { s, log } = fixture();
    s.raiseLedgerFloor('demo', 261, 'seeded', NOW);
    // The crash shape: an earlier process appended and died before its commit.
    log.append([{ project: 'demo', n: 300, title: 'lost', allocatedTo: 'demo-calm-mesa', at: 1 }]);
    const r = alloc(s, log);
    if (!r.ok) throw new Error('unreachable');
    expect(r.allocation.numbers).toEqual([301]);          // 261..300 SKIPPED, never reissued
  });

  it('the floor only ever RISES', () => {
    const { s, log } = fixture();
    s.raiseLedgerFloor('demo', 261, 'first evidence', NOW);
    s.raiseLedgerFloor('demo', 200, 'a lower scan later', NOW + 1);
    expect(s.ledgerFloor('demo')).toEqual({ floor: 261, evidence: 'first evidence', updatedAt: NOW });
    s.raiseLedgerFloor('demo', 400, 'a higher scan', NOW + 2);
    expect(s.ledgerFloor('demo')).toMatchObject({ floor: 400, evidence: 'a higher scan' });
  });

  it('markLanded stamps allocated -> landed, once, and staleAllocations reports the never-landed', () => {
    const { s, log } = fixture();
    s.raiseLedgerFloor('demo', 261, 'seeded', NOW);
    alloc(s, log, 2);
    s.markLanded('demo', 261, 'docs/superpowers/plans/2026-08-24-plan.md', NOW + 5);
    const rows = s.ledgerAllocations('demo');
    expect(rows[0]).toMatchObject({ n: 261, state: 'landed', landedAt: NOW + 5,
      landedIn: 'docs/superpowers/plans/2026-08-24-plan.md' });
    expect(rows[1]).toMatchObject({ n: 262, state: 'allocated', landedAt: null });
    // landed is terminal: a re-mark does not re-stamp
    s.markLanded('demo', 261, 'docs/superpowers/plans/other.md', NOW + 99);
    expect(s.ledgerAllocations('demo')[0]!.landedAt).toBe(NOW + 5);
    expect(s.staleAllocations(NOW + 1).map((a) => a.n)).toEqual([262]);
    expect(s.openAllocations().map((a) => a.n)).toEqual([262]);
  });
});
```

- [ ] Run, expect FAIL: `TypeError: s.raiseLedgerFloor is not a function`.

- [ ] Write the implementation. In `store.ts`, add the imports:

```ts
import { decideAllocation } from '../ledger.js';
import type { LedgerLog } from './ledgerlog.js';
```

  add the types beside `ClaimEndResult`:

```ts
/** One `ledger_alloc` row on the way OUT. `state` reads through the same
 *  we-do-not-know rule as every enum column in this file. */
export interface LedgerRow {
  project: string; n: number; title: string; allocatedTo: string;
  runId: number | null; allocatedAt: number;
  state: 'allocated' | 'landed' | 'unknown';
  landedAt: number | null; landedIn: string | null;
}

export type AllocateResult =
  | { ok: true; allocation: DeviationAllocation }
  | { ok: false; why: 'not-seeded' }
  | { ok: false; why: 'bad-count' };
```

  and append the methods after the claims block:

```ts
  /* ── the deviation ledger (build 9 wave 7, D8/D13) ─────────────────────── */

  ledgerFloor(project: string): { floor: number; evidence: string; updatedAt: number } | null {
    const row = this.db.prepare(
      'SELECT floor, evidence, updatedAt FROM ledger_floor WHERE project = ?',
    ).get(project) as { floor: number; evidence: string; updatedAt: number } | undefined;
    return row ?? null;
  }

  /** THE FLOOR ONLY EVER RISES (D13) — the conflict arm's WHERE clause is the
   *  mechanism, not caller discipline: a lower scan later (a plan deleted, a
   *  worktree's partial docs) can never walk allocation backward into numbers
   *  already handed out. */
  raiseLedgerFloor(project: string, floor: number, evidence: string, at: number): void {
    this.db.prepare(
      'INSERT INTO ledger_floor (project, floor, evidence, updatedAt) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(project) DO UPDATE SET floor = excluded.floor, ' +
      'evidence = excluded.evidence, updatedAt = excluded.updatedAt ' +
      'WHERE excluded.floor > ledger_floor.floor',
    ).run(project, floor, evidence, at);
  }

  /**
   * Allocate `count` contiguous deviation numbers, as ONE transaction — and
   * the ORDER inside it is the design (D8):
   *
   *   THE FILE FIRST, THE COMMIT SECOND. `log.append` runs before the
   *   INSERTs, inside the same synchronous flow, so a crash — or the
   *   `PRIMARY KEY (project, n)` backstop firing under a future refactor
   *   that loses this transaction — leaves numbers in the file that the
   *   database never committed. Recovery is MAX(file, db): those numbers
   *   are SKIPPED, NEVER REISSUED. Gaps cost nothing; a reissue is the
   *   bb47c9e incident (394 D-ref lines rewritten under merge pressure).
   *
   * Fails shut until seeded (`409 not-seeded` at the route) — `openCoordDb`'s
   * own "refuse to start rather than open empty", one level up. The route
   * owns the 3× in-request retry on a thrown constraint violation.
   *
   * `log` is a PARAMETER, not a constructor field: the route holds the
   * process's one `LedgerLog` (`defaultLedgerLogPath()`), and tests hand in
   * fixture-homed ones — the same reason `dueDeliveries` takes `replayMs`
   * from its caller instead of owning policy here.
   */
  allocateDeviations(input: {
    project: string; count: number; title: string; allocatedTo: string;
    runId: number | null; now?: number;
  }, log: LedgerLog): AllocateResult {
    const now = input.now ?? Date.now();
    return tx(this.db, () => {
      const floorRow = this.ledgerFloor(input.project);
      if (floorRow === null) return { ok: false as const, why: 'not-seeded' as const };
      const dbMax = (this.db.prepare(
        'SELECT MAX(n) AS m FROM ledger_alloc WHERE project = ?',
      ).get(input.project) as { m: number | null }).m;
      const fileMax = log.maxAllocated(input.project);
      const d = decideAllocation({
        floor: floorRow.floor, maxAllocated: dbMax, fileMax, count: input.count,
      });
      if (!d.ok) return d;
      log.append(d.numbers.map((n) => ({
        project: input.project, n, title: input.title,
        allocatedTo: input.allocatedTo, at: now,
      })));
      for (const n of d.numbers) {
        this.db.prepare(
          'INSERT INTO ledger_alloc (project, n, title, allocatedTo, runId, allocatedAt, state) ' +
          "VALUES (?, ?, ?, ?, ?, ?, 'allocated')",
        ).run(input.project, n, input.title, input.allocatedTo, input.runId, now);
      }
      return {
        ok: true as const,
        allocation: {
          project: input.project, numbers: d.numbers, floor: floorRow.floor,
          title: input.title, allocatedTo: input.allocatedTo,
          runId: input.runId, allocatedAt: now,
        },
      };
    });
  }

  private static readonly LEDGER_COLS =
    'project, n, title, allocatedTo, runId, allocatedAt, state, landedAt, landedIn';

  private hydrateLedger(r: {
    project: string; n: number; title: string; allocatedTo: string; runId: number | null;
    allocatedAt: number; state: string; landedAt: number | null; landedIn: string | null;
  }): LedgerRow {
    return { ...r, state: r.state === 'allocated' || r.state === 'landed' ? r.state : 'unknown' };
  }

  ledgerAllocations(project: string): LedgerRow[] {
    const rows = this.db.prepare(
      `SELECT ${CoordStore.LEDGER_COLS} FROM ledger_alloc WHERE project = ? ORDER BY n`,
    ).all(project) as Parameters<CoordStore['hydrateLedger']>[0][];
    return rows.map((r) => this.hydrateLedger(r));
  }

  /** Every not-yet-landed allocation across every project — what
   *  `sweepLedgerReconcile` walks. */
  openAllocations(): LedgerRow[] {
    const rows = this.db.prepare(
      `SELECT ${CoordStore.LEDGER_COLS} FROM ledger_alloc WHERE state = 'allocated' ` +
      'ORDER BY project, n',
    ).all() as Parameters<CoordStore['hydrateLedger']>[0][];
    return rows.map((r) => this.hydrateLedger(r));
  }

  /** allocated -> landed, once — `landed` genuinely means "in a merged plan"
   *  (D13), so the guard keeps a re-scan from re-stamping the date. */
  markLanded(project: string, n: number, landedIn: string, at: number): void {
    this.db.prepare(
      "UPDATE ledger_alloc SET state = 'landed', landedAt = ?, landedIn = ? " +
      "WHERE project = ? AND n = ? AND state = 'allocated'",
    ).run(at, landedIn, project, n);
  }

  /** Allocated at or before `cutoff`, never landed — REPORTED, never
   *  reclaimed (D13). The cutoff is the CALLER's (the watcher owns the
   *  7-day policy), the `dueDeliveries(replayMs)` pattern. */
  staleAllocations(cutoff: number): LedgerRow[] {
    const rows = this.db.prepare(
      `SELECT ${CoordStore.LEDGER_COLS} FROM ledger_alloc ` +
      "WHERE state = 'allocated' AND allocatedAt <= ? ORDER BY project, n",
    ).all(cutoff) as Parameters<CoordStore['hydrateLedger']>[0][];
    return rows.map((r) => this.hydrateLedger(r));
  }
```

- [ ] Run, expect PASS:
  `./node_modules/.bin/vitest run test/ledger-store.test.ts test/ledgerlog.test.ts`.

- [ ] Commit:
  `git add server/src/coord/ledgerlog.ts server/src/coord/store.ts server/test/ledgerlog.test.ts server/test/ledger-store.test.ts && git commit -m "server(w7): the allocator writes the file first, the database second"`

---

### Task 14: `ledger-race.test.ts` — twenty racers, and the loud backstop

**Files:**
- Create: `server/test/ledger-race.test.ts`
- Modify (mutation ceremony only, both reverted): `server/src/coord/schema.ts` (the
  `MIGRATIONS[3]` entry — locate with `grep -n 'PRIMARY KEY (project, n)' server/src/coord/schema.ts`),
  `server/src/coord/store.ts` (`allocateDeviations`).

**Interfaces:**
- Consumes: `CoordStore.allocateDeviations`, `raiseLedgerFloor` (Task 13); `LedgerLog` (Task 13);
  `ledger_alloc PRIMARY KEY (project, n)` (`MIGRATIONS[3]`, part A).
- Produces: the spec §4 mutant row "Allocator atomicity — lose the transaction —
  `ledger-race.test.ts` — 20 concurrent, 20 distinct contiguous", executed with its ceremony.

**Steps:**

- [ ] Write the test file `server/test/ledger-race.test.ts`:

```ts
// Spec §3/§4: "Two sessions race the allocator — serialised by BEGIN
// IMMEDIATE; DatabaseSync cannot yield inside it. PRIMARY KEY (project, n)
// makes any future loss of the transaction a loud constraint error."
// ledger-race fires 20 concurrent allocations and asserts 20 distinct
// contiguous numbers; the trigger test below is the one that goes RED when
// the transaction is lost, and the raw-INSERT test is the one that goes RED
// when the PRIMARY KEY is lost. Between them, neither mechanism can be
// "simplified away" as redundant (D11's own ordering rule).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { LedgerLog } from '../src/coord/ledgerlog.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_785_300_000_000;

const fixture = (): { s: CoordStore; log: LedgerLog } => {
  const home = mkTmp('ccrc-ledger-race-');
  const s = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  s.raiseLedgerFloor('demo', 100, 'seeded by the race fixture', NOW);
  return { s, log: new LedgerLog(path.join(home, '.ccrc', 'ledger-alloc.log')) };
};

describe('the allocator under fire', () => {
  it('20 concurrent allocations -> 20 DISTINCT CONTIGUOUS numbers', async () => {
    const { s, log } = fixture();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      Promise.resolve().then(() => s.allocateDeviations({
        project: 'demo', count: 1, title: `racer ${i}`,
        allocatedTo: 'demo-quiet-basin', runId: null, now: NOW,
      }, log))));
    const nums = results.flatMap((r) => (r.ok ? [...r.allocation.numbers] : []));
    expect(nums).toHaveLength(20);
    expect(new Set(nums).size).toBe(20);
    expect([...nums].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => 100 + i));
    expect(log.maxAllocated('demo')).toBe(119);
  });

  it('A MID-BATCH FAILURE ROLLS THE WHOLE BATCH BACK — and the file keeps the numbers, skipped forever', () => {
    // THIS is the test that reds when the transaction is lost: without the
    // tx, 100 and 101 would survive the abort on 102 as a half-committed
    // allocation — exactly the partial-acquisition shape D12 forbids for
    // claims, on the ledger side.
    const { s, log } = fixture();
    s.db.exec(
      'CREATE TRIGGER ledger_boom BEFORE INSERT ON ledger_alloc WHEN NEW.n = 102 ' +
      "BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    expect(() => s.allocateDeviations({
      project: 'demo', count: 3, title: 'doomed batch',
      allocatedTo: 'demo-quiet-basin', runId: null, now: NOW,
    }, log)).toThrow(/boom/);
    expect(s.ledgerAllocations('demo')).toEqual([]);       // ALL-or-nothing in the db…
    expect(log.maxAllocated('demo')).toBe(102);            // …and the FILE keeps all three
    s.db.exec('DROP TRIGGER ledger_boom');
    const next = s.allocateDeviations({
      project: 'demo', count: 1, title: 'after the crash',
      allocatedTo: 'demo-quiet-basin', runId: null, now: NOW + 1,
    }, log);
    if (!next.ok) throw new Error('unreachable');
    expect(next.allocation.numbers).toEqual([103]);        // SKIPPED, NEVER REISSUED
  });

  it('THE BACKSTOP IS THE REAL PRIMARY KEY: a duplicate (project, n) throws LOUDLY, never lands silently', () => {
    const { s } = fixture();
    const ins = (project: string, n: number): void => {
      s.db.prepare(
        'INSERT INTO ledger_alloc (project, n, title, allocatedTo, runId, allocatedAt, state) ' +
        "VALUES (?, ?, 'x', 'demo-quiet-basin', NULL, 1, 'allocated')",
      ).run(project, n);
    };
    ins('demo', 200);
    expect(() => ins('demo', 200)).toThrow(/PRIMARY KEY|UNIQUE/i);
    // and the key is (project, n), not n: another project may hold 200
    expect(() => ins('other-project', 200)).not.toThrow();
  });
});
```

- [ ] Run, expect PASS on the first and third tests and FAIL on the second — the trigger test
  fails with `expected [] to deeply equal []`? No: it fails earlier, because `allocateDeviations`
  as shipped in Task 13 already wraps the batch in `tx()`, so ALL three assertions pass. **Expected
  first result: 3/3 PASS.** This task's red evidence is the mutation ceremony below — the tests are
  written against an already-correct implementation, so the ceremony is what proves they can fail.

- [ ] **Mutation ceremony, mutant 1 — lose the transaction.** In `server/src/coord/store.ts`,
  `allocateDeviations`: replace `return tx(this.db, () => {` with
  `return ((): AllocateResult => {` and the closing `});` of that call with `})();`. Run
  `./node_modules/.bin/vitest run test/ledger-race.test.ts` — expect exactly 1 FAIL: "A MID-BATCH
  FAILURE ROLLS THE WHOLE BATCH BACK" (`expected [ { …n: 100… }, { …n: 101… } ] to deeply equal []`).
  Revert the mutant (`git checkout -- server/src/coord/store.ts` is NOT safe here — Task 13's work
  is committed, so it is: re-apply the two lines by hand or `git diff` to confirm only those two
  lines changed, then revert them). Run again, expect 3/3 PASS.

- [ ] **Mutation ceremony, mutant 2 — lose the PRIMARY KEY.** In `server/src/coord/schema.ts`'s
  `MIGRATIONS[3]` entry, replace the line `PRIMARY KEY (project, n)` with `CHECK (n > 0)` (keeps
  the DDL parseable, loses the constraint). Run the suite — expect exactly 1 FAIL: "THE BACKSTOP IS
  THE REAL PRIMARY KEY" (`expected [Function] to throw an error`). Revert, run, expect 3/3 PASS.
  (Migration edits are safe to mutate here because every database this suite opens is a fresh tmp
  file rebuilt from `MIGRATIONS`; the live server DB never sees the mutant.)

- [ ] Run the neighbours: `./node_modules/.bin/vitest run test/ledger-store.test.ts test/coord-db.test.ts`
  — expect PASS.

- [ ] Commit:
  `git add server/test/ledger-race.test.ts && git commit -m "test(w7): twenty racers, twenty contiguous numbers — and the backstop stays loud"`

---

### Task 15: The lease rides the tick — renew, lapse, release-on-close, `claim-orphan`

**Files:**
- Modify: `shared/api.ts` — `DivergenceKind` union (line 1184–1189), `DIVERGENCE_KIND_MAP`
  (lines 1190–1193).
- Modify: `server/src/divergence.ts` — `DivergenceInput` (add two fields after `provenance`,
  lines 90–95), `divergences()` (add arm 6 before `return out;` at line 369).
- Modify: `server/src/coord/store.ts` — claims block (three sweep writers); `closeRun`
  (release call beside `cancelOutstandingDeliveries`, line 507).
- Modify: `server/src/watch.ts` — imports (lines 16–19 and a new `./claims.js` import);
  constants (after `LC_SWEEP_MS`, line 73); fields (after `lastLifecycleSweep`, line 328); tick
  wiring (after `this.activeProjects = projects;`, line 795); `sweepDivergences` coord read
  (lines 1605–1618) and `classifierInput` (lines 1636–1662); new methods after `sweepLifecycle`
  (line 1725).
- Modify: `server/test/divergence.test.ts` — `input()` defaults (lines 28–39), vocabulary count
  (lines 313–317), new classifier tests.
- Create: `server/test/claim-sweep.test.ts`

**Interfaces:**
- Consumes: `claimExpiry`, `LivenessProbe` (`server/src/claims.ts`, part A); `FleetSession`,
  `CLAIM_LEASE_MS`, `CLAIM_HARD_CAP_MS` (`shared/api.ts`); Task 12's store methods.
- Produces:
  ```ts
  // shared/api.ts: DivergenceKind gains 'claim-orphan' (SIX kinds)
  // server/src/divergence.ts:
  //   DivergenceInput.liveClaims: readonly { id: number; sessionId: string; project: string;
  //                                          path: string; runId: number | null }[]
  //   DivergenceInput.openRunIds: ReadonlySet<number>
  // on CoordStore:
  renewClaimRow(id: number, expiresAt: number, at: number): void
  lapseClaimRow(id: number, endedBy: string, at: number): void
  releaseClaimsForRun(runId: number, at: number): void      // called INSIDE closeRun's tx
  // on FleetWatcher (both ride the EXISTING tick, own 60 s clocks, no new timer):
  renewClaims(sessions: readonly Pick<FleetSession, 'id' | 'status' | 'unmeasured'>[]): void
  lapseClaims(sessions: readonly Pick<FleetSession, 'id' | 'status' | 'unmeasured'>[]): void
  ```

**Steps:**

- [ ] Write the failing store-writer tests — create `server/test/claim-sweep.test.ts`:

```ts
// D12: no session-side heartbeat. renewClaims/lapseClaims ride FleetWatcher's
// EXISTING tick off rows it has already read; run close releases the run's
// claims INSIDE the close transaction; a live claim naming a closed run is
// the alarm `divergence.claim-orphan`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { CLAIM_LEASE_MS, CLAIM_HARD_CAP_MS, type Divergence } from '../../shared/api.js';

const NOW = 1_785_300_000_000;

afterEach(() => { vi.restoreAllMocks(); });

/** Move the watcher's clock. First call of each lane runs regardless (the
 *  `!== 0` first-sweep rule); later calls need the jump past CLAIM_SWEEP_MS. */
const at = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };

const fixture = () => {
  const home = mkTmp('ccrc-claim-sweep-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const bus = new Bus();
  const watcher = new FleetWatcher({ ...testDeps(home), cfg, io: localIO, coord } as never, bus, 10_000);
  const claim = (over: Partial<Parameters<CoordStore['claimAttempt']>[0]> = {}) => {
    const r = coord.claimAttempt({
      project: 'demo', paths: ['server/src/io.ts'], sessionId: 'demo-quiet-basin',
      uuid: 'u-1', runId: null, intent: 'measured-read seam', now: NOW, ...over,
    });
    if (!r.ok) throw new Error('fixture claim refused');
    return r.claims[0]!;
  };
  /** A registry row, `hold-gate.test.ts`'s idiom — what makes `demo` a
   *  project the divergence census asks about. */
  const plantRecord = (id: string): void => {
    const reg = path.join(home, '.cc-sessions');
    const fields: Record<string, string> = {
      uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`,
      workspace: id.slice('demo-'.length), branch: `ws/${id}`, base: 'origin/main', started: '1',
    };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
  };
  const running = (id: string) => ({ id, status: 'idle' as const, unmeasured: [] as const });
  return { home, cfg, coord, bus, watcher, claim, plantRecord, running,
           records: () => readRegistry(localIO, cfg) };
};

describe('the store-side sweep writers', () => {
  it('renewClaimRow re-arms a LIVE lease, never past the hard cap, never a lapsed row', () => {
    const h = fixture();
    const c = h.claim();
    h.coord.renewClaimRow(c.id, NOW + 600_000 + CLAIM_LEASE_MS, NOW + 600_000);
    expect(h.coord.activeClaims()[0]).toMatchObject(
      { renewedAt: NOW + 600_000, expiresAt: NOW + 600_000 + CLAIM_LEASE_MS });
    h.coord.renewClaimRow(c.id, NOW + CLAIM_HARD_CAP_MS + 999_999, NOW);
    expect(h.coord.activeClaims()[0]!.expiresAt).toBe(NOW + CLAIM_HARD_CAP_MS);
    h.coord.lapseClaimRow(c.id, 'session-gone', NOW + 1);
    h.coord.renewClaimRow(c.id, NOW + 2 * CLAIM_HARD_CAP_MS, NOW + 2);
    expect(h.coord.claimsForProject('demo', true)[0]!.state).toBe('lapsed');  // not resurrected
  });

  it('lapseClaimRow LAPSES, NEVER DELETES — the row survives with endedAt/endedBy', () => {
    const h = fixture();
    const c = h.claim();
    h.coord.lapseClaimRow(c.id, 'session-gone', NOW + 5);
    expect(h.coord.activeClaims()).toEqual([]);
    expect(h.coord.claimsForProject('demo', true)).toHaveLength(1);
    expect(h.coord.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'lapsed', endedAt: NOW + 5, endedBy: 'session-gone' });
  });
});

describe('run close releases the claims — inside the close transaction', () => {
  it('a successful close releases every live claim naming that run', () => {
    const h = fixture();
    const open = h.coord.openRun({ program: 'build9b', title: 'T', project: 'demo',
      wave: 1, waveOf: 1, claimedBy: 'demo-calm-mesa' });
    if ('refused' in open) throw new Error('unreachable');
    h.claim({ runId: open.id });
    const closed = h.coord.closeRun({ runId: open.id, finalState: 'failed',
      causedBy: 'operator', handoffCommit: null, program: 'build9b', viaClosing: false });
    expect(closed.ok).toBe(true);
    expect(h.coord.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'released', endedBy: 'run-closed' });
  });

  it('a REFUSED close releases NOTHING — the release lives after the transition, in the same tx', () => {
    const h = fixture();
    const open = h.coord.openRun({ program: 'build9b', title: 'T', project: 'demo',
      wave: 1, waveOf: 1, claimedBy: 'demo-calm-mesa' });
    if ('refused' in open) throw new Error('unreachable');
    h.claim({ runId: open.id });
    // planned has no `closing` edge — viaClosing:true refuses at the first hop
    const refused = h.coord.closeRun({ runId: open.id, finalState: 'done',
      causedBy: 'coordinator', handoffCommit: null, program: 'build9b', viaClosing: true });
    expect(refused.ok).toBe(false);
    expect(h.coord.activeClaims()).toHaveLength(1);        // still held
  });
});
```

- [ ] Run, expect FAIL: `cd server && ./node_modules/.bin/vitest run test/claim-sweep.test.ts` —
  `TypeError: h.coord.renewClaimRow is not a function`.

- [ ] Write the store half. Append to the claims block in `server/src/coord/store.ts`:

```ts
  /** The watcher's renew write (D12: no session-side heartbeat — the SERVER
   *  renews off records it already read). `MIN(?, hardExpiresAt)` is the 8 h
   *  bound no renewal can move; the `state = 'live'` guard keeps a racing
   *  lapse from being silently reopened. */
  renewClaimRow(id: number, expiresAt: number, at: number): void {
    this.db.prepare(
      "UPDATE claims SET renewedAt = ?, expiresAt = MIN(?, hardExpiresAt) " +
      "WHERE id = ? AND state = 'live'",
    ).run(at, expiresAt, id);
  }

  /** LAPSE, NEVER DELETE (D12): the row survives with endedAt/endedBy, so
   *  `?all=1` can answer "held by X until it died". A destroyed claim is
   *  destroyed history. */
  lapseClaimRow(id: number, endedBy: string, at: number): void {
    this.db.prepare(
      "UPDATE claims SET state = 'lapsed', endedAt = ?, endedBy = ? " +
      "WHERE id = ? AND state = 'live'",
    ).run(at, endedBy, id);
  }

  /** Run close releases that run's claims IN THE CLOSE TRANSACTION (D12) —
   *  called from `closeRun` only, after the final advance has succeeded,
   *  beside the delivery cancellation it mirrors. */
  releaseClaimsForRun(runId: number, at: number): void {
    this.db.prepare(
      "UPDATE claims SET state = 'released', endedAt = ?, endedBy = 'run-closed' " +
      "WHERE runId = ? AND state = 'live'",
    ).run(at, runId);
  }
```

  and in `closeRun` (line 507), directly under `this.cancelOutstandingDeliveries(input.runId);`:

```ts
      // Build 9 D12: the run's claims are released in the SAME transaction as
      // the close — after the final advance succeeded (a refused close
      // releases nothing), beside the delivery cancellation it mirrors. The
      // watcher's `divergence.claim-orphan` is the alarm for the close that
      // never got here.
      this.releaseClaimsForRun(input.runId, Date.now());
```

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/claim-sweep.test.ts`. Then
  `./node_modules/.bin/vitest run test/coord-abandon.test.ts test/run-routes.test.ts` — expect
  PASS (`closeRun` gained a statement, no behaviour any existing test pins changed).

- [ ] Write the failing watcher tests — append to `server/test/claim-sweep.test.ts`:

```ts
describe('renewClaims / lapseClaims on the FleetWatcher tick', () => {
  it('a MEASURED-RUNNING holder is renewed', () => {
    const h = fixture();
    const c = h.claim();
    at(NOW + 600_000);
    h.watcher.renewClaims([h.running('demo-quiet-basin')]);
    expect(h.coord.activeClaims()[0]!.expiresAt).toBe(NOW + 600_000 + CLAIM_LEASE_MS);
    expect(h.coord.activeClaims()[0]!.id).toBe(c.id);
  });

  it('DOUBT READS AS HELD: an unmeasurable holder is renewed too — a fleet hiccup cannot mass-expire', () => {
    const h = fixture();
    h.claim();
    at(NOW + CLAIM_LEASE_MS + 1);                          // past the lease…
    h.watcher.renewClaims([{ id: 'demo-quiet-basin', status: 'idle', unmeasured: ['uuid'] }]);
    h.watcher.lapseClaims([{ id: 'demo-quiet-basin', status: 'idle', unmeasured: ['uuid'] }]);
    expect(h.coord.activeClaims()).toHaveLength(1);        // …and still held
    expect(h.coord.activeClaims()[0]!.expiresAt).toBe(NOW + CLAIM_LEASE_MS + 1 + CLAIM_LEASE_MS);
  });

  it("a GONE holder lapses at the STANDING expiresAt — 'session-gone', not at once", () => {
    const h = fixture();
    h.claim();
    at(NOW + 60_000);                                      // gone, but the lease still stands
    h.watcher.lapseClaims([]);
    expect(h.coord.activeClaims()).toHaveLength(1);
    at(NOW + CLAIM_LEASE_MS + 1);                          // the standing expiry has passed
    h.watcher.lapseClaims([]);
    expect(h.coord.activeClaims()).toEqual([]);
    expect(h.coord.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'lapsed', endedBy: 'session-gone' });
  });

  it('a DEAD pane reads gone — dead is a measurement, not doubt', () => {
    const h = fixture();
    h.claim();
    at(NOW + CLAIM_LEASE_MS + 1);
    h.watcher.lapseClaims([{ id: 'demo-quiet-basin', status: 'dead', unmeasured: [] }]);
    expect(h.coord.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'lapsed', endedBy: 'session-gone' });
  });

  it("the HARD CAP lapses even a measured-running holder — doubt cannot hold forever", () => {
    const h = fixture();
    h.claim();
    at(NOW + CLAIM_HARD_CAP_MS + 1);
    h.watcher.renewClaims([h.running('demo-quiet-basin')]);   // must NOT resurrect
    h.watcher.lapseClaims([h.running('demo-quiet-basin')]);
    expect(h.coord.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'lapsed', endedBy: 'hard-cap' });
  });

  it('own clock: a second sweep inside CLAIM_SWEEP_MS does not act', () => {
    const h = fixture();
    at(NOW);
    h.watcher.lapseClaims([]);                             // first sweep runs (the !== 0 rule), arms the clock
    // a claim whose lease is ALREADY past due the next time anyone looks:
    const c = h.claim({ now: NOW - CLAIM_LEASE_MS - 1 });
    expect(c.expiresAt).toBeLessThan(NOW);
    at(NOW + 30_000);                                      // 30 s later: inside the interval
    h.watcher.lapseClaims([]);
    expect(h.coord.activeClaims()).toHaveLength(1);        // the gate held — no read, no lapse
    at(NOW + 60_001);                                      // past CLAIM_SWEEP_MS (module-private, 60 s)
    h.watcher.lapseClaims([]);
    expect(h.coord.activeClaims()).toEqual([]);            // now it acted: gone + expired => lapsed
  });

  it('runs with NO coord at all — the testDeps shape every watcher test depends on', () => {
    const home = mkTmp('ccrc-claim-sweep-');
    const w = new FleetWatcher(testDeps(home), new Bus(), 10_000);
    expect(() => { w.renewClaims([]); w.lapseClaims([]); }).not.toThrow();
  });
});
```

- [ ] Run, expect FAIL: `TypeError: h.watcher.renewClaims is not a function`.

- [ ] Write the watcher half. In `server/src/watch.ts`:

  1. Add to the type-import block (lines 16–18): `FleetSession`.
  2. Add a new import after line 28: `import { claimExpiry, type LivenessProbe } from './claims.js';`
  3. After `LC_SWEEP_MS` (line 73), add:

```ts
/** Build 9 wave 7 (D12): the claim lease's lane. 60 s — a 45-minute lease
 *  does not need the 2 s tick, and `sweepDivergences` already argues this
 *  cadence. Renew and lapse each keep their own clock so neither starves the
 *  other's first run. */
const CLAIM_SWEEP_MS = 60_000;
```

  4. After `private lastLifecycleSweep = 0;` (line 328), add:

```ts
  /** The claim lanes' clocks (build 9 wave 7, D12). */
  private lastClaimRenew = 0;
  private lastClaimLapse = 0;
```

  5. After `sweepLifecycle` (line 1725), add:

```ts
  /**
   * Liveness for `claimExpiry`, off the rows THIS tick already assembled —
   * no second registry read (the one-listing rule `sweepDivergences` states).
   * `LivenessProbe` is `claims.ts`'s own port, declared by the consumer (L2).
   *
   * `Pick<…>` in the sweep signatures is deliberate: the sweeps read exactly
   * three fields, and a test should not have to fabricate a whole
   * `FleetSession` to exercise a lease.
   */
  private claimProbe(
    sessions: readonly Pick<FleetSession, 'id' | 'status' | 'unmeasured'>[],
  ): LivenessProbe {
    const byId = new Map(sessions.map((s) => [s.id, s]));
    return {
      measure: (id: string) => {
        const s = byId.get(id);
        if (s === undefined) return 'gone';                 // the fleet no longer lists it
        if (s.unmeasured.length > 0) return 'unmeasurable'; // doubt reads as HELD (D12)
        return s.status === 'dead' ? 'gone' : 'running';
      },
    };
  }

  /**
   * D12: NO SESSION-SIDE HEARTBEAT — "a protocol a model must remember is a
   * protocol that will be forgotten, and the failure is a wedged module."
   * The server renews for a holder it can measure running (and for one it
   * cannot measure at all — doubt reads as held), on the EXISTING tick.
   * `claimExpiry` (L1) owns every decision; this method only applies the
   * `renew` arm. Synchronous: `tick()` wraps the pair in the same try/catch
   * `pushNewMail` earned, because both walk straight into `node:sqlite`.
   */
  renewClaims(sessions: readonly Pick<FleetSession, 'id' | 'status' | 'unmeasured'>[]): void {
    const now = Date.now();
    if (this.lastClaimRenew !== 0 && now - this.lastClaimRenew < CLAIM_SWEEP_MS) return;
    this.lastClaimRenew = now;
    const store = this.deps.coord;
    if (!store) return;
    const probe = this.claimProbe(sessions);
    for (const c of store.activeClaims()) {
      const d = claimExpiry(c, probe.measure(c.sessionId), now);
      if (d.act === 'renew') store.renewClaimRow(c.id, d.expiresAt, now);
    }
  }

  /** The lapse half — `claimExpiry`'s `lapse` arm applied. A holder measured
   *  gone lapses at the STANDING `expiresAt` with `endedBy:'session-gone'`;
   *  the 8 h hard cap lapses whatever the liveness said. Rows survive —
   *  `lapseClaimRow` lapses, never deletes. */
  lapseClaims(sessions: readonly Pick<FleetSession, 'id' | 'status' | 'unmeasured'>[]): void {
    const now = Date.now();
    if (this.lastClaimLapse !== 0 && now - this.lastClaimLapse < CLAIM_SWEEP_MS) return;
    this.lastClaimLapse = now;
    const store = this.deps.coord;
    if (!store) return;
    const probe = this.claimProbe(sessions);
    for (const c of store.activeClaims()) {
      const d = claimExpiry(c, probe.measure(c.sessionId), now);
      if (d.act === 'lapse') store.lapseClaimRow(c.id, d.endedBy, now);
    }
  }
```

  6. Wire the tick: after `this.activeProjects = projects;` (line 795), before `this.primed = true;`:

```ts
      // Build 9 wave 7: the claim lease rides THIS tick, on its own slower
      // clocks — no new timer (D12), and `sweepMail` below this block is
      // untouched by name (D10). Liveness comes off the SAME `sessions` this
      // tick assembled. Wrapped like `pushNewMail`, for its reason: both walk
      // straight into synchronous `node:sqlite`.
      try {
        this.renewClaims(sessions);
        this.lapseClaims(sessions);
      } catch (err) {
        console.warn(`ccrc-server: claim sweep failed (${err instanceof Error ? err.message : String(err)}) — one bad sweep must not kill the poll`);
      }
```

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/claim-sweep.test.ts`.

- [ ] Write the failing `claim-orphan` classifier tests. In `server/test/divergence.test.ts`:
  extend the `input()` helper (lines 28–39) with two new defaults, appended before the spread:

```ts
  liveClaims: [],
  openRunIds: new Set<number>(),
```

  update the vocabulary test (lines 313–317) to:

```ts
  it('is exactly six kinds — dead-row/unsupervised/not-boot-persistent are still DELETED', () => {
    expect([...DIVERGENCE_KINDS].sort()).toEqual(
      ['archived-but-live', 'branch-drift', 'claim-divergence', 'claim-orphan',
       'provenance-mismatch', 'unregistered-worktree']);
```

  and add a new describe at the end of the classifier section:

```ts
describe('claim-orphan — a live claim whose run is no longer open (build 9 D12)', () => {
  const aClaim = (over: Partial<DivergenceInput['liveClaims'][number]> = {}) => ({
    id: 1, sessionId: 'demo-quiet-basin', project: 'demo',
    path: 'server/src/io.ts', runId: 7 as number | null, ...over,
  });

  it('names a live claim naming a run the open set does not hold', () => {
    const out = divergences(input({ liveClaims: [aClaim()], openRunIds: new Set<number>() }));
    expect(out).toContainEqual({ kind: 'claim-orphan', id: 'demo-quiet-basin',
      path: null, detail: expect.stringContaining('run 7') });
  });

  it('a claim whose run IS open raises nothing', () => {
    expect(divergences(input({ liveClaims: [aClaim()], openRunIds: new Set([7]) })))
      .not.toContainEqual(expect.objectContaining({ kind: 'claim-orphan' }));
  });

  it('a run-less claim is a SUPPORTED shape, not a leak', () => {
    expect(divergences(input({ liveClaims: [aClaim({ runId: null })] })))
      .not.toContainEqual(expect.objectContaining({ kind: 'claim-orphan' }));
  });
});
```

- [ ] Run, expect FAIL: `./node_modules/.bin/vitest run test/divergence.test.ts` — TypeScript-side
  the new fields are unknown, so at runtime the first new test fails with
  `expected [] to include an object matching { kind: 'claim-orphan' … }`, and the vocabulary test
  fails on the missing sixth member.

- [ ] Implement the L0 + L1 halves. In `shared/api.ts` (lines 1184–1193):

```ts
export type DivergenceKind =
  | 'unregistered-worktree'   // git records a worktree no registry row claims
  | 'branch-drift'            // registry `.branch` != the worktree's own HEAD
  | 'claim-divergence'        // a hold with no open run, or an open run with no hold
  | 'provenance-mismatch'     // the kernel field contradicts the declared surface
  | 'archived-but-live'       // a row stamped archived that is heartbeating now
  | 'claim-orphan';           // a live path claim naming a run that is no longer open
const DIVERGENCE_KIND_MAP: Record<DivergenceKind, true> = {
  'unregistered-worktree': true, 'branch-drift': true, 'claim-divergence': true,
  'provenance-mismatch': true, 'archived-but-live': true, 'claim-orphan': true,
};
```

  In `server/src/divergence.ts`, add to `DivergenceInput` after `provenance` (line 95):

```ts
  /**
   * Live path claims off the coordination store, carried as ROWS and decided
   * here — the same L1 stance as `provenance` above. EMPTY WHEN THE STORE
   * REFUSES: an absence can only suppress this finding, never manufacture one.
   */
  readonly liveClaims: readonly {
    readonly id: number; readonly sessionId: string; readonly project: string;
    readonly path: string; readonly runId: number | null;
  }[];
  /** Ids of every OPEN run — the same `runs()` read `openRunSessionIds`
   *  already comes from, carried as a set so this module stays pure. */
  readonly openRunIds: ReadonlySet<number>;
```

  and add arm 6 in `divergences()` before `return out;` (line 369):

```ts
  // 6 — a live claim whose run is no longer open (build 9 D12). Run close
  // releases the run's claims inside the close transaction, so a survivor is
  // a close that never finished. Refcounting is a query, not a counter — "a
  // counter you can increment twice is a counter you can leak; a query over
  // rows cannot" — and this is that query's alarm. A claim naming NO run is
  // a supported shape (an ad-hoc claim), never a leak.
  for (const c of input.liveClaims) {
    if (c.runId === null || input.openRunIds.has(c.runId)) continue;
    out.push({
      kind: 'claim-orphan', id: c.sessionId, path: null,
      detail: `a live claim on ${c.project}/${c.path} names run ${c.runId}, which is no longer open — its close should have released it`,
    });
  }
```

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/divergence.test.ts`.

- [ ] Write the failing WIRING test — append to `server/test/claim-sweep.test.ts`:

```ts
describe('sweepDivergences feeds claim-orphan from what it already read', () => {
  it('a live claim naming a closed run reaches the census', async () => {
    const h = fixture();
    h.plantRecord('demo-quiet-basin');
    const open = h.coord.openRun({ program: 'build9b', title: 'T', project: 'demo',
      wave: 1, waveOf: 1, claimedBy: 'demo-calm-mesa' });
    if ('refused' in open) throw new Error('unreachable');
    h.claim({ runId: open.id });
    // The crash shape the alarm exists for: the run reached terminal WITHOUT
    // closeRun's release (simulated by writing the state directly).
    h.coord.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(open.id);
    const seen: Divergence[][] = [];
    h.bus.on('divergence', (d: Divergence[]) => seen.push(d));
    await h.watcher.sweepDivergences(await h.records());
    expect(seen.at(-1) ?? []).toContainEqual(
      expect.objectContaining({ kind: 'claim-orphan', id: 'demo-quiet-basin' }));
  });

  it('a RELEASED claim raises nothing — the ordinary close is quiet', async () => {
    const h = fixture();
    h.plantRecord('demo-quiet-basin');
    const open = h.coord.openRun({ program: 'build9b', title: 'T', project: 'demo',
      wave: 1, waveOf: 1, claimedBy: 'demo-calm-mesa' });
    if ('refused' in open) throw new Error('unreachable');
    h.claim({ runId: open.id });
    h.coord.closeRun({ runId: open.id, finalState: 'failed', causedBy: 'operator',
      handoffCommit: null, program: 'build9b', viaClosing: false });
    const seen: Divergence[][] = [];
    h.bus.on('divergence', (d: Divergence[]) => seen.push(d));
    await h.watcher.sweepDivergences(await h.records());
    expect(seen.at(-1) ?? []).not.toContainEqual(
      expect.objectContaining({ kind: 'claim-orphan' }));
  });
});
```

- [ ] Run, expect FAIL: TypeScript aside, `divergences()` now requires `liveClaims`/`openRunIds`
  and `sweepDivergences` does not supply them — the suite fails at runtime with
  `TypeError: Cannot read properties of undefined (reading …)` from arm 6 (or, if the tsc-side
  `typecheck-tests` suite is run, TS2345 on `classifierInput`).

- [ ] Wire `sweepDivergences`. In `server/src/watch.ts`, replace the `openRunSessionIds` block
  (lines 1605–1618) with:

```ts
    let openRunSessionIds = new Set<string>();
    let openRunIds = new Set<number>();
    try {
      const openRuns = this.deps.coord?.runs() ?? [];
      openRunSessionIds = new Set(
        openRuns.map((r) => r.sessionId).filter((id): id is string => id !== null));
      openRunIds = new Set(openRuns.map((r) => r.id));
    } catch (err) {
      // `coord.runs()` walks straight into synchronous `node:sqlite` — the same
      // fault every neighbouring lane already guards. A failed read skips the
      // census this pass rather than killing the poll.
      console.warn(`ccrc-server: sweepDivergences runs() failed (${err instanceof Error ? err.message : String(err)}) — one bad read must not kill the poll`);
      return;
    }
    // THE CLAIM ROWS, degrade-to-empty like `provenance` below: an absence can
    // only suppress a claim-orphan finding, never manufacture one.
    let liveClaims: DivergenceInput['liveClaims'] = [];
    try {
      liveClaims = (this.deps.coord?.activeClaims() ?? []).map((c) => ({
        id: c.id, sessionId: c.sessionId, project: c.project, path: c.path, runId: c.runId,
      }));
    } catch (err) {
      console.warn(`ccrc-server: sweepDivergences activeClaims failed (${err instanceof Error ? err.message : String(err)}) — no claim findings this pass`);
    }
```

  and add `openRunIds, liveClaims,` to the `classifierInput` object literal (beside
  `worktrees, headBranch, openRunSessionIds,` at line 1646).

- [ ] Run, expect PASS:
  `./node_modules/.bin/vitest run test/claim-sweep.test.ts test/divergence.test.ts test/divergence-sweep.test.ts`.

- [ ] **Verify `sweepMail` is untouched (the D10 no-edit assertion):**
  `git diff $(git merge-base HEAD origin/main) -- server/src/watch.ts | grep -c 'sweepMail'`
  — expect `0`. If any hunk names `sweepMail`, STOP and remove the edit: a second producer lands
  BESIDE the most load-bearing loop on the box, never inside it.

- [ ] Run the load-sensitive neighbours in the foreground:
  `./node_modules/.bin/vitest run test/mail-sweep.test.ts test/hold-gate.test.ts` — expect PASS
  (re-run in isolation before calling a real break, per the known-flakes rule).

- [ ] Commit:
  `git add shared/api.ts server/src/divergence.ts server/src/coord/store.ts server/src/watch.ts server/test/claim-sweep.test.ts server/test/divergence.test.ts && git commit -m "server(w7): the lease rides the tick — renew on measured life, lapse at the standing expiry"`

---

### Task 16: `sweepLedgerFloor` (hourly) and `sweepLedgerReconcile` (15 min)

**Files:**
- Modify: `server/src/watch.ts` — imports (add `LEDGER_SEED_GAP` to the `shared/api.js` value
  import, line 19; add `floorFromScan` from `./ledger.js`); constants (after `CLAIM_SWEEP_MS`
  from Task 15); fields (after `lastClaimLapse`); tick wiring (directly under Task 15's claim
  block); new methods after `lapseClaims`.
- Create: `server/test/ledger-sweep.test.ts`

**Interfaces:**
- Consumes: `floorFromScan` (`server/src/ledger.ts`, part A); `LEDGER_SEED_GAP`
  (`shared/api.ts`); Task 13's store methods (`raiseLedgerFloor`, `openAllocations`,
  `markLanded`, `staleAllocations`, `ledgerFloor`); `FleetIO.readdir`/`readFile`
  (`server/src/io.ts:41-64` — the already-granted reads, D13: zero new grants);
  `SessionRecord` (`server/src/registry.ts`).
- Produces:
  ```ts
  // on FleetWatcher (both ride the EXISTING tick, own clocks, no new timer):
  sweepLedgerFloor(records: SessionRecord[]): Promise<void>       // hourly
  sweepLedgerReconcile(): Promise<void>                           // 15 min
  ```

**Steps:**

- [ ] Write the failing test file `server/test/ledger-sweep.test.ts`:

```ts
// D13: the allocator self-seeds from docs/superpowers/{plans,specs}/*.md of
// the MAIN checkout, hourly, through the already-granted io reads; the floor
// only ever rises; reconcile marks allocated -> landed off the plans dir
// every 15 minutes; stale numbers are REPORTED, never reclaimed.
import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { LedgerLog } from '../src/coord/ledgerlog.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_785_300_000_000;

afterEach(() => { vi.restoreAllMocks(); });

const at = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };

const fixture = () => {
  const home = mkTmp('ccrc-ledger-sweep-');
  const projectsRoot = mkTmp('ccrc-ledger-docs-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const reads: string[] = [];
  const io: FleetIO = {
    ...localIO,
    readdir: async (p: string) => { reads.push(p); return localIO.readdir(p); },
  };
  const watcher = new FleetWatcher({ ...testDeps(home), cfg, io, coord } as never, new Bus(), 10_000);
  const plantDoc = (project: string, dir: 'plans' | 'specs', name: string, text: string): void => {
    const d = path.join(projectsRoot, project, 'docs', 'superpowers', dir);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, name), text);
  };
  const plantRecord = (id: string, project: string): void => {
    const reg = path.join(home, '.cc-sessions');
    const fields: Record<string, string> = {
      uuid: `u-${id}`, wrapper: 'claude', project, workdir: `/w/${id}`,
      workspace: id.split('-').slice(1).join('-'), branch: `ws/${id}`,
      base: 'origin/main', started: '1',
    };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
  };
  const log = new LedgerLog(path.join(home, '.ccrc', 'ledger-alloc.log'));
  return { home, cfg, coord, watcher, log, plantDoc, plantRecord,
           reads: () => [...reads], records: () => readRegistry(io, cfg) };
};

describe('sweepLedgerFloor', () => {
  it('seeds floor = max(D-n) + LEDGER_SEED_GAP off plans AND specs, with evidence naming file and number', async () => {
    const h = fixture();
    h.plantRecord('demo-quiet-basin', 'demo');
    h.plantDoc('demo', 'plans', '2026-08-01-a.md', 'prose that carries D-208 in passing');
    h.plantDoc('demo', 'specs', '2026-08-02-b.md', 'and the high-water D-211 lives here');
    at(NOW);
    await h.watcher.sweepLedgerFloor(await h.records());
    expect(h.coord.ledgerFloor('demo')).toEqual({
      floor: 261,                                        // 211 + LEDGER_SEED_GAP(50)
      evidence: expect.stringContaining('D-211'),
      updatedAt: NOW,
    });
    expect(h.coord.ledgerFloor('demo')!.evidence).toContain('2026-08-02-b.md');
  });

  it('THE FLOOR ONLY RISES — a later, lower scan changes nothing', async () => {
    const h = fixture();
    h.plantRecord('demo-quiet-basin', 'demo');
    h.plantDoc('demo', 'plans', 'a.md', 'D-211');
    at(NOW);
    await h.watcher.sweepLedgerFloor(await h.records());
    h.plantDoc('demo', 'plans', 'a.md', 'D-100 only, the higher ref rewritten away');
    at(NOW + 2 * 3_600_000);
    await h.watcher.sweepLedgerFloor(await h.records());
    expect(h.coord.ledgerFloor('demo')!.floor).toBe(261);
  });

  it('a project with NO docs seeds nothing — allocation stays 409 not-seeded, which is the fail-shut arm', async () => {
    const h = fixture();
    h.plantRecord('demo-quiet-basin', 'demo');
    at(NOW);
    await h.watcher.sweepLedgerFloor(await h.records());
    expect(h.coord.ledgerFloor('demo')).toBeNull();
    expect(h.coord.allocateDeviations({ project: 'demo', count: 1, title: 't',
      allocatedTo: 'demo-quiet-basin', runId: null, now: NOW }, h.log))
      .toEqual({ ok: false, why: 'not-seeded' });
  });

  it('own clock: a second sweep inside the hour reads nothing', async () => {
    const h = fixture();
    h.plantRecord('demo-quiet-basin', 'demo');
    h.plantDoc('demo', 'plans', 'a.md', 'D-211');
    at(NOW);
    await h.watcher.sweepLedgerFloor(await h.records());
    const before = h.reads().length;
    at(NOW + 60_000);
    await h.watcher.sweepLedgerFloor(await h.records());
    expect(h.reads().length).toBe(before);               // the gate held: not one readdir
  });
});

describe('sweepLedgerReconcile', () => {
  const seedAndAllocate = async (h: ReturnType<typeof fixture>, count: number) => {
    h.coord.raiseLedgerFloor('demo', 261, 'seeded by test', NOW);
    const r = h.coord.allocateDeviations({ project: 'demo', count, title: 'the seam',
      allocatedTo: 'demo-quiet-basin', runId: null, now: NOW }, h.log);
    if (!r.ok) throw new Error('fixture allocation refused');
    return r.allocation.numbers;
  };

  it('allocated -> landed when the number appears in a PLAN of the main checkout', async () => {
    const h = fixture();
    await seedAndAllocate(h, 2);                          // 261, 262
    h.plantDoc('demo', 'plans', '2026-08-24-plan.md', '### D-261 — the seam, landed');
    at(NOW + 1000);
    await h.watcher.sweepLedgerReconcile();
    const rows = h.coord.ledgerAllocations('demo');
    expect(rows[0]).toMatchObject({ n: 261, state: 'landed',
      landedIn: 'docs/superpowers/plans/2026-08-24-plan.md' });
    expect(rows[1]).toMatchObject({ n: 262, state: 'allocated' });
  });

  it('D-261 does not land D-2611 — the boundary is a word boundary', async () => {
    const h = fixture();
    await seedAndAllocate(h, 1);                          // 261
    h.plantDoc('demo', 'plans', 'p.md', 'only D-2611 appears here');
    at(NOW + 1000);
    await h.watcher.sweepLedgerReconcile();
    expect(h.coord.ledgerAllocations('demo')[0]!.state).toBe('allocated');
  });

  it('STALE AT 7 DAYS: reported (once per changing set), NEVER reclaimed', async () => {
    const h = fixture();
    await seedAndAllocate(h, 1);                          // 261, never lands
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(NOW + 8 * 24 * 3_600_000);
    await h.watcher.sweepLedgerReconcile();
    expect(warn.mock.calls.flat().join('\n')).toContain('D-261');
    expect(h.coord.ledgerAllocations('demo')[0]!.state).toBe('allocated');   // never reclaimed
    const callsAfterFirst = warn.mock.calls.length;
    at(NOW + 8 * 24 * 3_600_000 + 16 * 60_000);
    await h.watcher.sweepLedgerReconcile();
    expect(warn.mock.calls.length).toBe(callsAfterFirst); // same set: no re-report
  });

  it('own clock: a second sweep inside 15 minutes does not act', async () => {
    const h = fixture();
    await seedAndAllocate(h, 1);
    at(NOW + 1000);
    await h.watcher.sweepLedgerReconcile();
    h.plantDoc('demo', 'plans', 'p.md', 'D-261');
    at(NOW + 5 * 60_000);
    await h.watcher.sweepLedgerReconcile();               // inside the interval
    expect(h.coord.ledgerAllocations('demo')[0]!.state).toBe('allocated');
  });

  it('runs with NO coord at all', async () => {
    const w = new FleetWatcher(testDeps(mkTmp('ccrc-ledger-sweep-')), new Bus(), 10_000);
    await expect(w.sweepLedgerReconcile()).resolves.toBeUndefined();
    await expect(w.sweepLedgerFloor([])).resolves.toBeUndefined();
  });
});
```

- [ ] Run, expect FAIL: `cd server && ./node_modules/.bin/vitest run test/ledger-sweep.test.ts` —
  `TypeError: h.watcher.sweepLedgerFloor is not a function`.

- [ ] Write the implementation. In `server/src/watch.ts`:

  1. Add `LEDGER_SEED_GAP` to the value import from `'../../shared/api.js'` (line 19) and add
     `import { floorFromScan } from './ledger.js';` beside the Task-15 `./claims.js` import.
  2. After `CLAIM_SWEEP_MS`, add:

```ts
/** D13's two ledger lanes. The floor scan reads every plan and spec of every
 *  registry-named project, so it runs HOURLY; reconcile reads only the plans
 *  of projects with open allocations, every 15 MINUTES, because `landed` is
 *  the signal a coordinator watches for. */
const LEDGER_FLOOR_SWEEP_MS = 3_600_000;
const LEDGER_RECONCILE_SWEEP_MS = 900_000;
/** Allocated, never landed, older than this: REPORTED, never reclaimed (D13). */
const LEDGER_STALE_MS = 7 * 24 * 3_600_000;
```

  3. After `lastClaimLapse`, add:

```ts
  /** The ledger lanes' clocks (build 9 wave 7, D13). */
  private lastLedgerFloor = 0;
  private lastLedgerReconcile = 0;
  /** The stale set last reported, as JSON — one warn per CHANGING set, the
   *  `lastDivergenceJson` idiom, so a standing stale number is not a log
   *  line every 15 minutes forever. */
  private lastStaleReport: string | null = null;
```

  4. After `lapseClaims`, add:

```ts
  /**
   * `docs/superpowers/<dirs>/*.md` of one project's MAIN checkout, through
   * the already-granted `io.readdir`/`io.readFile` (D13 — zero new grants,
   * zero new frames). POSIX joins by template, matching every other fleet
   * path this file builds.
   *
   * A dir whose `readdir` answers null contributes NOTHING — `absent` and
   * `unreadable` collapse in that call (D-114), and here BOTH are the safe
   * direction: a floor that fails to seed leaves allocation refusing
   * (`not-seeded`), and a partial scan can only ever UNDER-seed inside the
   * 50-number gap, which the next successful sweep raises. `null` return =
   * NEITHER dir listed — the caller seeds nothing at all.
   */
  private async readLedgerDocs(
    project: string, dirs: readonly string[],
  ): Promise<{ name: string; text: string }[] | null> {
    const out: { name: string; text: string }[] = [];
    let listedAny = false;
    for (const d of dirs) {
      const dir = `${this.deps.cfg.projectsRoot}/${project}/docs/superpowers/${d}`;
      const names = await this.deps.io.readdir(dir);
      if (names === null) continue;
      listedAny = true;
      for (const n of names) {
        if (!n.endsWith('.md')) continue;
        const text = await this.deps.io.readFile(`${dir}/${n}`);
        if (text === null) continue;
        out.push({ name: `docs/superpowers/${d}/${n}`, text });
      }
    }
    return listedAny ? out : null;
  }

  /**
   * D13: the allocator SELF-SEEDS. Hourly, per registry-named project (the
   * same bound `sweepDivergences` states: the fleet's active projects, never
   * every checkout on the box): floor = max(D-<n>) + LEDGER_SEED_GAP, and
   * THE FLOOR ONLY EVER RISES — `raiseLedgerFloor`'s conflict arm is the
   * mechanism. The 50-number gap is not decoration: numbers allocated but
   * not yet written into any plan are invisible to this scan, and re-issuing
   * one IS the bb47c9e failure.
   *
   * PUBLIC for the reason `sweepDivergences` is: `tick()` dispatches it with
   * `void`, so a test that awaits `tick()` has not awaited this.
   */
  async sweepLedgerFloor(records: SessionRecord[]): Promise<void> {
    const now = Date.now();
    if (this.lastLedgerFloor !== 0 && now - this.lastLedgerFloor < LEDGER_FLOOR_SWEEP_MS) return;
    this.lastLedgerFloor = now;
    const store = this.deps.coord;
    if (!store) return;
    for (const project of [...new Set(records.map((r) => r.project))]) {
      const files = await this.readLedgerDocs(project, ['plans', 'specs']);
      if (files === null) continue;
      const scan = floorFromScan(files);
      if (scan === null) continue;      // no global D-ref anywhere: nothing to seed, fail shut
      store.raiseLedgerFloor(project, scan.max + LEDGER_SEED_GAP,
        `${scan.file} names D-${scan.max}`, now);
    }
  }

  /**
   * D13: allocated -> landed when the number appears in a PLAN of the main
   * checkout — so `landed` genuinely means merged, the signal the bb47c9e
   * incident lacked while the authoritative record sat on an unmerged ref
   * for 15 hours. A number 7 days old and never landed is REPORTED (once per
   * changing set) and NEVER reclaimed.
   */
  async sweepLedgerReconcile(): Promise<void> {
    const now = Date.now();
    if (this.lastLedgerReconcile !== 0 &&
        now - this.lastLedgerReconcile < LEDGER_RECONCILE_SWEEP_MS) return;
    this.lastLedgerReconcile = now;
    const store = this.deps.coord;
    if (!store) return;
    const open = store.openAllocations();
    if (open.length > 0) {
      const byProject = new Map<string, typeof open>();
      for (const a of open) {
        const list = byProject.get(a.project);
        if (list === undefined) byProject.set(a.project, [a]); else list.push(a);
      }
      for (const [project, rows] of byProject) {
        const files = await this.readLedgerDocs(project, ['plans']);
        if (files === null) continue;
        for (const a of rows) {
          const re = new RegExp(`\\bD-${a.n}\\b`);
          const hit = files.find((f) => re.test(f.text));
          if (hit !== undefined) store.markLanded(project, a.n, hit.name, now);
        }
      }
    }
    const stale = store.staleAllocations(now - LEDGER_STALE_MS);
    const json = JSON.stringify(stale.map((s) => [s.project, s.n]));
    if (stale.length > 0 && json !== this.lastStaleReport) {
      this.lastStaleReport = json;
      console.warn(
        `ccrc-server: ${stale.length} allocated deviation number(s) never landed in a plan ` +
        'after 7 days: ' + stale.map((s) => `${s.project} D-${s.n}`).join(', ') +
        ' — reported, never reclaimed (D13)');
    }
  }
```

  5. Wire the tick — directly under Task 15's claim try/catch block:

```ts
      // NEVER awaited, same reasoning as `sweepDivergences`: each is a
      // handful of io reads per PROJECT, on an hourly / 15-minute clock.
      void this.sweepLedgerFloor(records).catch(() => { /* one bad sweep must not kill the poll */ });
      void this.sweepLedgerReconcile().catch(() => { /* one bad sweep must not kill the poll */ });
```

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/ledger-sweep.test.ts`.

- [ ] Run the tick's own suites to prove the wiring broke nothing:
  `./node_modules/.bin/vitest run test/hold-gate.test.ts test/divergence-sweep.test.ts test/lifecycle-sweep.test.ts` — expect PASS.

- [ ] Commit:
  `git add server/src/watch.ts server/test/ledger-sweep.test.ts && git commit -m "server(w7): the floor self-seeds hourly and only rises; landed means merged"`

---

### Task 17: The named invariants and the mutation sweep

Every guard this section shipped, measured red — "a comment is a request; a red suite is a
mechanism." The two named invariants (`lapse-not-delete`, `doubt-reads-as-held`) already have
standing tests from Tasks 12/15; this task adds the two that close the remaining seams, then runs
the full ceremony table.

**Files:**
- Modify: `server/test/claims-store.test.ts` — one new describe.
- Modify: `server/test/claim-sweep.test.ts` — one new test.
- Modify (mutation ceremony only, every mutant reverted): `server/src/coord/store.ts`,
  `server/src/coord/schema.ts` (`claim_one_owner` in `MIGRATIONS[3]`), `server/src/watch.ts`.

**Interfaces:**
- Consumes: everything Tasks 12–16 produced.
- Produces: the executed mutation table below, recorded in the commit message; no new runtime
  surface.

**Steps:**

- [ ] Append to `server/test/claims-store.test.ts`:

```ts
describe('LAPSE, NOT DELETE — the invariant, pinned against the raw table', () => {
  it('no path through expiry ever removes a row: count(*) is monotonic', () => {
    const s = store();
    attempt(s);                                             // row 1
    attempt(s, { sessionId: 'demo-calm-mesa', uuid: 'u-2',  // row 1 lapses, row 2 lands
                 now: NOW + CLAIM_HARD_CAP_MS + 1 });
    const count = (): number =>
      (s.db.prepare('SELECT count(*) AS c FROM claims').get() as { c: number }).c;
    expect(count()).toBe(2);
    const all = s.claimsForProject('demo', true);
    expect(all[0]).toMatchObject({ state: 'lapsed', endedBy: 'hard-cap',
      endedAt: NOW + CLAIM_HARD_CAP_MS + 1 });
    // and `?all=1` still answers "held by X until it died": the holder,
    // the intent and the lease bounds all survive the lapse
    expect(all[0]).toMatchObject({ sessionId: 'demo-quiet-basin',
      intent: 'measured-read seam', acquiredAt: NOW });
  });
});
```

- [ ] Run, expect PASS (the invariant shipped in Task 12; this pins it against the raw table so a
  future "tidy the lapsed rows away" edit cannot pass): 
  `cd server && ./node_modules/.bin/vitest run test/claims-store.test.ts`.

- [ ] Append to `server/test/claim-sweep.test.ts`, inside the renew/lapse describe:

```ts
  it('DOUBT, END TO END: an unmeasurable holder rides through lease expiry AND the next attempt', () => {
    // The composed property the two halves guarantee together: the sweep
    // renews on doubt (D12), so a later claim attempt's in-tx expiry finds a
    // fresh lease and the doubted holder still wins the conflict.
    const h = fixture();
    h.claim();
    at(NOW + CLAIM_LEASE_MS + 1);
    h.watcher.renewClaims([{ id: 'demo-quiet-basin', status: 'idle', unmeasured: ['uuid'] }]);
    const rival = h.coord.claimAttempt({
      project: 'demo', paths: ['server/src/io.ts'], sessionId: 'demo-calm-mesa',
      uuid: 'u-2', runId: null, intent: 'rival', now: NOW + CLAIM_LEASE_MS + 2,
    });
    expect(rival).toMatchObject({ ok: false, why: 'conflict' });
  });
```

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/claim-sweep.test.ts`.

- [ ] **The mutation sweep.** For each row: plant the mutant, run the named suite
  (`./node_modules/.bin/vitest run test/<file>` from `server/`, foreground), confirm EXACTLY the
  expected reds, revert, re-run, confirm green. Do them one at a time — two live mutants make the
  red counts unattributable.

  | # | Mutant (plant by hand, then revert) | Suite | Expect red |
  |---|---|---|---|
  | 1 | `store.ts` `claimAttempt`: delete the `this.expireLapsedInner(now);` line | `claims-store.test.ts` | "EXPIRY RIDES EVERY ATTEMPT" and "the hard cap wins the word" (2) |
  | 2 | `store.ts` `claimAttempt`: delete the `if (!decision.ok) return decision;` pair | `claims-store.test.ts` | the three conflict/bad-path tests (3) |
  | 3 | `schema.ts` `MIGRATIONS[3]`: drop `WHERE state = 'live'` from `claim_one_owner` | `claims-store.test.ts` | "a released path is claimable again" (1) — the in-tx expiry test also reds (its re-claim hits the widened index): 2 total |
  | 4 | `schema.ts` `MIGRATIONS[3]`: delete the `claim_one_owner` index line entirely | `claims-store.test.ts` | "THE BACKSTOP IS REAL" (1) |
  | 5 | `store.ts` `lapseClaimRow`: replace the UPDATE with `DELETE FROM claims WHERE id = ? AND state = 'live'` (bind `(id)` only) | `claim-sweep.test.ts` | "LAPSES, NEVER DELETES" (1) |
  | 6 | `store.ts` `closeRun`: move `this.releaseClaimsForRun(...)` above the `if (!finalAdv.ok) return finalAdv;` line | `claim-sweep.test.ts` | "a REFUSED close releases NOTHING" (1) |
  | 7 | `watch.ts` `claimProbe`: make the `unmeasured` arm return `'gone'` | `claim-sweep.test.ts` | "DOUBT READS AS HELD" and "DOUBT, END TO END" (2) |
  | 8 | `watch.ts` `renewClaims`: delete the `if (this.lastClaimRenew !== 0 …) return;` gate — no, the gate deletion widens behaviour no test forbids; instead delete the `this.lastClaimRenew = now;` stamp | `claim-sweep.test.ts` | none red — RECORD THIS: the clocks are pinned in the lapse lane only ("own clock" test); the renew stamp is covered by the same shape, and a stamp-less renew lane costs reads, not correctness. Note it in the commit body rather than adding a test that pins cost |
  | 9 | `watch.ts` `sweepLedgerFloor`: change `scan.max + LEDGER_SEED_GAP` to `scan.max` | `ledger-sweep.test.ts` | the seeding test (floor 211 ≠ 261) (1) |
  | 10 | `store.ts` `raiseLedgerFloor`: drop the `WHERE excluded.floor > ledger_floor.floor` clause | `ledger-store.test.ts` + `ledger-sweep.test.ts` | "the floor only ever RISES" in both (2) |
  | 11 | `watch.ts` `sweepLedgerReconcile`: change `` `\\bD-${a.n}\\b` `` to `` `D-${a.n}` `` | `ledger-sweep.test.ts` | "D-261 does not land D-2611" (1) |
  | 12 | `store.ts` `markLanded`: drop `AND state = 'allocated'` | `ledger-store.test.ts` | "markLanded stamps … once" (re-stamp assertion) (1) |

- [ ] Full-section regression, foreground, timeout ≥ 600000 ms:
  `./node_modules/.bin/vitest run test/claims-store.test.ts test/claim-sweep.test.ts test/ledgerlog.test.ts test/ledger-store.test.ts test/ledger-race.test.ts test/ledger-sweep.test.ts test/divergence.test.ts test/divergence-sweep.test.ts test/coord-store.test.ts test/single-definition.test.ts test/coordinator-skill.test.ts`
  — expect PASS. (`single-definition` proves no constant grew a second copy;
  `coordinator-skill` proves this section registered no route.)

- [ ] Typecheck: `npm run test -- --run test/typecheck-tests.test.ts` — if this suite flakes under
  load, re-run in isolation before calling it broken (known load flake).

- [ ] Full server suite in the foreground: `cd server && npm run test`. Known load flakes
  (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`) re-run in
  isolation before being called breaks; CI on the quiet box is the arbiter.

- [ ] Commit (body records mutant row 8's finding):
  `git add server/test/claims-store.test.ts server/test/claim-sweep.test.ts && git commit -m "test(w7): a lapsed claim is history, not absence — and every guard meets its mutant"`
# Build 9b — Section 5: Wave 7 part C — the seven routes, and the detector suites (Tasks 18–24)

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-08-21-build9-provenance-peers-claims-design.md` — D9, D11,
D12, D13, D16, D17, §4's mutant table, §5 wave 7.
**Base:** `2d4a7ac7` (main after the Build 9a merge). Every line anchor below was read from that
tree; if `main` moves, re-derive by `git grep -n <identifier>`, never by offset.
**Branch:** the program workspace's own branch — no feature branch (worker-skill clause 2).

This section registers the **seven wave-7 routes** — all in `server/src/coord/routes.ts`, because
`coordinator-skill.test.ts:158` scans that file and only that file — and ships the **detector
suites** the spec's §4 table names for this wave. It CONSUMES Wave 7 parts A/B (Tasks 14–17 of
this plan): the L0 types, the L1 deciders, `MIGRATIONS[3]`, the store methods and `ledgerlog.ts`.
Nothing here re-implements a decision those parts own; every route is parse → gate → one store
call → union→status map.

---

## Global constraints (restated; every task inherits them)

- **No new npm dependency. `FLEET_PROTO` stays 1; wire changes additive-only.** Nothing in this
  section touches the agent WS at all.
- **Suites run in the FOREGROUND, timeout ≥600000 ms**, invoked as
  `./node_modules/.bin/vitest run test/<file>` from inside `server/`. **Never bare `npx vitest`.**
  Known load flakes (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`,
  `ccd-session-state`) — re-run in isolation before calling a break.
- **Fixture HOMEs only** (`mkTmp`, `testDeps`); no destructive ccd verb anywhere. The one ccd test
  harness this section touches (`claims-no-hold`) runs the REAL `sweepNames` against a fixture HOME
  through `testDeps`'s `guardRunner`, exactly as `server/test/name-sweep.test.ts` does.
- **Neutral vocabulary** in every fixture and doc line: `demo`, `mybox.example.com`,
  `<server-host>`, `<fleet-host>`. No real account names in shipped source
  (`single-definition.test.ts` enforces).
- **The deviation ledger's next free number is D-211.** Verify at execution by sweeping every
  remote ref across `docs/` AND source before allocating (numbers taken from a plan alone have
  collided twice).
- **Skill-corpus edits are agent-lane files** (`ccd/coordinator-skill/…`): they DEPLOY agent-first
  (wave 8's `bash deploy/deploy.sh agent <host>` before the server lane), but they land in the
  same commits as the routes they name, because `coordinator-skill.test.ts` binds the two in both
  directions (see "The corpus-naming rule" below).
- **Mutation ceremony** is explicit steps: plant the mutant, run, expect the named suite red with
  the named count, revert (`git checkout -- <file>`), run, expect green. Mutants are never
  committed. A mutant planted in `ccd/ccd` would require a provenance re-stamp only if committed —
  it never is.

## The corpus-naming rule (resolves the wave-7/wave-8 ordering tension)

`coordinator-skill.test.ts` pins route↔corpus linkage in BOTH directions: a route named in the
corpus but not registered is red (which is what forces skills to deploy after the server), and a
route registered in `coord/routes.ts` but named nowhere in `SKILL.md`/`references/wave-lifecycle.md`
is ALSO red (minus that test's own `EXEMPT` set, currently 3 members at
`server/test/coordinator-skill.test.ts:184-200`). So each route task below appends a **one-line
naming stub** for its routes to `ccd/coordinator-skill/references/wave-lifecycle.md` in the same
commit that registers them — the tree stays green at every commit, and wave 8 (the skills section)
owns the real protocol prose, clauses 10/11 and `references/peer-protocol.md`, which it may write
over these stubs. `POST /api/claims/:id/break` alone is **never named** (D16: the
`POST /api/runs/:id/abandon` shape — a door the claimant is not the one to walk through) and joins
that test's `EXEMPT` set instead, 3 → 4.

## Baseline counts (measured at `2d4a7ac7`; each route task moves some of them)

| Pin | File:line | Value before this section | After T18 | After T19 | After T20 |
|---|---|---|---|---|---|
| `scanRoutes('coord/routes.ts').length` | `server/test/auth-gate.test.ts:194` | 14 | 15 | 19 | 21 |
| `ROUTES.length` | `auth-gate.test.ts:195` | 59 | 60 | 64 | 66 |
| HTTP (non-WS) routes | `auth-gate.test.ts:198` | 56 | 57 | 61 | 63 |
| `EXEMPT` entries (`gate.ts:163`) | `auth-gate.test.ts:354-373` | 18 | 19 | 22 | 24 |
| box-token-gated lanes in `coord/routes.ts` | `auth-gate.test.ts:405-410` | 11 | 12 | 15 | 17 |
| `gated.length` (armed sweep) | `auth-gate.test.ts:432` | 39 | 39 | 40 | 40 |
| `EXEMPT_BUT_AUTHENTICATED` | `auth-gate.test.ts:63` | 2 | 3 | 4 | 4 |
| parity `EXEMPT` (corpus-unnamed) | `coordinator-skill.test.ts:184` | 3 | 3 | 4 | 4 |
| `UNGATED` (no box token) | `coord-pause-route.test.ts:168` | 2 | 2 | 3 | 3 |

---

## Interfaces consumed from Wave 7 parts A/B (Tasks 14–17)

Written once here; every task's **Interfaces: Consumes** refers back. **These exact names and
shapes are the contract** — if part A/B landed a different spelling, reconcile TOWARD these (they
are the fixed inter-section contract) or record a deviation before proceeding.

From `shared/api.ts` (L0, imports nothing):

```ts
export type PeerDeliverable = 'yes' | 'unknown' | `no:${string}`;   // D9/D12; 'unknown' is NOT 'no'

export interface PeerSummary {
  id: string; project: string; wrapper: string;
  workspace: string | null; branch: string | null;
  archivedAt: number | null;          // epoch SECONDS, verbatim registry stamp — decides nothing (D9)
  archivedStale: boolean;             // archived-but-live, NAMED, never laundered into a filter
  deliverable: PeerDeliverable;
  lifecycle: SessionLifecycle | null; // each row's own lifecycle, the thing the etiquette says to read
  intent: string | null;              // the newest live claim intent (D12 ruling 3)
  claimedPaths: readonly string[];    // live claim paths this peer holds in this project
}

export const PEER_ETIQUETTE: readonly [string, string, string, string, string]; // five rules, verbatim

export const CLAIM_STATES = ['live', 'released', 'lapsed', 'broken'] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

export interface ClaimSummary {
  id: number; project: string; path: string; byId: string; byUuid: string;
  intent: string; runId: number | null;
  claimedAt: number; expiresAt: number; hardExpiresAt: number;
  state: ClaimState; endedAt: number | null; endedBy: string | null;
}

export type ClaimMailHint =
  | { send: { toId: string; kind: 'question'; subject: string } }  // the pre-addressed envelope
  | { escalate: string };                                          // deliverable said 'no:<reason>'

export interface ClaimConflict {
  path: string; heldBy: string; heldByUuid: string; intent: string;
  runId: number | null; expiresAt: number;
  deliverable: PeerDeliverable;
  mailHint: ClaimMailHint;
}

export interface DeviationAllocation {
  project: string; n: number; title: string; byId: string | null;
  allocatedAt: number; state: 'allocated' | 'landed' | 'stale'; landedAt: number | null;
}

export const CLAIM_LEASE_MS = 45 * 60_000;
export const CLAIM_HARD_CAP_MS = 8 * 3_600_000;
export const LEDGER_SEED_GAP = 50;
export const PEER_MAIL_MAX_OUTSTANDING = 3;   // Wave 0, per (fromId,toId) pair, runId===null only
export const PEER_MAIL_HOURLY = 12;           // Wave 0, per sender, runId===null only
// MAIL_REJECT_CODES gained 'duplicate' and 'peer-quota' in Wave 0.
```

From `server/src/coord/peers.ts` (L1 pure — no fs, no fastify, no reply):

```ts
export type PeerPresence = 'measured' | 'absent' | 'unmeasurable';
/** The STRUCTURAL rungs of sweepMail's ladder only (D9): presence 'unmeasurable' -> 'unknown';
 *  'absent' -> 'no:no-registry-row'; measured + stopped/orphan/never-started -> 'no:<lifecycle>';
 *  measured + unmeasurable lifecycle -> 'unknown'; everything else -> 'yes'. The transient rungs
 *  (cooldown, latch, unanswered ask, quiet) STAY in sweepMail. */
export function peerDeliverable(presence: PeerPresence, lifecycle: SessionLifecycle | null): PeerDeliverable;
/** archivedAt !== null while the peer measures deliverable 'yes' — the four measured rows' shape. */
export function archiveContradicted(archivedAt: number | null, deliverable: PeerDeliverable): boolean;
```

From `server/src/coord/store.ts` (L3; every method synchronous, `DatabaseSync` never wrapped async):

```ts
export interface AcquireClaimsInput {
  project: string; paths: readonly string[]; byId: string; byUuid: string;
  intent: string; runId: number | null; now: number;
}
export type AcquireClaimsResult =
  | { ok: true; ids: number[]; expiresAt: number; hardExpiresAt: number; renewed: boolean }
  | { ok: false; kind: 'conflict';
      conflicts: { path: string; claimId: number; heldBy: string; heldByUuid: string;
                   intent: string; runId: number | null; expiresAt: number }[] }
  | { ok: false; kind: 'bad-path'; path: string };
export type ClaimEndOutcome =
  | { ok: true; state: ClaimState }
  | { ok: false; kind: 'unknown-claim' }
  | { ok: false; kind: 'not-owner'; heldBy: string }
  | { ok: false; kind: 'claim-terminal'; state: ClaimState };

// All inside ONE tx() each (D11): expiry of lapsed rows, the conflict read (exact match AND
// directory-prefix containment both directions), then the insert/update. Same-owner same-paths
// re-POST RENEWS (updates intent + expiresAt, never hardExpiresAt) and answers renewed: true.
acquireClaims(input: AcquireClaimsInput): AcquireClaimsResult;
releaseClaim(id: number, byId: string, now: number): ClaimEndOutcome;   // ok.state === 'released'
breakClaim(id: number, now: number): ClaimEndOutcome;                   // ok.state === 'broken'; never 'not-owner'
activeClaims(project: string | null, now: number): ClaimSummary[];      // live, unexpired, oldest-first
allClaims(project: string | null, limit?: number): ClaimSummary[];      // every state — lapse, don't delete

allocateDeviations(input: { project: string; count: number; title: string;
  byId: string | null; now: number }):
  | { ok: true; numbers: number[]; floor: number }      // numbers contiguous; floor = new next-free
  | { ok: false; kind: 'not-seeded' };                  // ledgerlog.ts appends to the FILE first
recordLedgerFloor(project: string, floor: number, evidence: string, at: number): void; // only rises
ledgerFloor(project: string): number | null;            // null = not seeded
ledgerAllocations(project: string, limit?: number): DeviationAllocation[];
```

Already in the tree (Build 7/9a, verified at `2d4a7ac7`): `requireMailToken` / `checkMailToken` /
`MAIL_TOKEN_HEADER` (`coord/routes.ts:260`, `coord/token.ts`), `readRegistry` /
`measuredIdentity` (`server/src/registry.ts`), `assembleFleet` (`server/src/fleet.ts:159`),
`FleetSession.lifecycle` / `.archivedAt` (`shared/api.ts:138/57`), the D-149 dual-arm shape
(`coord/routes.ts:1110-1136` — `GET /api/runs` — and `:1183-1212` — `GET /api/lifecycle`),
`NO_SESSION` / `GateDecision` (`auth/gate.ts`), Wave 0's `duplicate`/`peer-quota` refusals on
`POST /api/mail` for `runId === null`.

---

### Task 18: `GET /api/peers` — discovery reports the contradiction instead of resolving it

**Files:**
- Modify `shared/api.ts` — insert `CLAIM_REFUSE_CODES` / `ClaimRefuseCode` / `isClaimRefuseCode`
  immediately after `isRunRefuseCode` (line 3080, after the `RUN_REFUSE_CODES` block).
- Modify `server/src/coord/routes.ts` — extend the shared-api import (lines 17-21), add
  `assembleFleet` and `peers.js` imports, register `GET /api/peers` after the
  `GET /api/lifecycle` handler (append after line 1212).
- Modify `server/src/auth/gate.ts` — `EXEMPT` map (lines 163-219): one new entry after the
  `GET /api/lifecycle` entry (line 196).
- Modify `server/test/auth-gate.test.ts` — `EXEMPT_BUT_AUTHENTICATED` (line 63), exact counts
  (lines 193-198), the `EXEMPT` snapshot list (lines 354-373), the box-token-lane list
  (lines 400-410).
- Modify `server/test/mail-routes.test.ts` — the kebab scanner (line 432-446) admits
  `isClaimRefuseCode` as the FIFTH vocabulary.
- Modify `ccd/coordinator-skill/references/wave-lifecycle.md` — append the naming-stub section
  (end of file, after line 473).
- Create `server/test/peers-route.test.ts`.

**Interfaces:**
- Consumes: `peerDeliverable`, `archiveContradicted`, `PeerSummary`, `PeerDeliverable`,
  `PEER_ETIQUETTE`, `activeClaims` (see the consumed block above); `assembleFleet`,
  `readRegistry`, `checkMailToken`, `sessionAuth`/`GateDecision`.
- Produces: **`GET /api/peers?project=<slug>` | `?of=<sessionId>`** (exactly one, else 400) —
  dual-arm auth (D-149 verbatim); `200 { ok: true, peers: PeerSummary[], projects: string[],
  etiquette: PEER_ETIQUETTE }`; `404 {error:'unknown-session'}` / `502
  {error:'registry-unmeasurable'}` on the `?of=` arm; `401` with `verdict` when armed and both
  credentials absent; `501 not-configured` (after auth). Also produces
  `CLAIM_REFUSE_CODES`/`isClaimRefuseCode` (L0) for Tasks 19/20/24.

**Steps:**

- [ ] Write the failing test, `server/test/peers-route.test.ts`:

```ts
// GET /api/peers — discovery reports the contradiction instead of resolving it
// (build 9 D9). No `addressable` boolean anywhere: `archivedAt` rides verbatim
// and decides nothing; `archivedStale` NAMES archived-but-live; `projects[]`
// replaces a `projectKnown` boolean because the obvious `io.stat` probe is
// built on the one call the tree already knows lies (D-114).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { PEER_ETIQUETTE } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField } from './ioDoubles.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const UUID_A = 'a'.repeat(36);
const UUID_B = 'b'.repeat(36);
const UUID_C = 'c'.repeat(36);
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';

/** A registry row `readRegistry` will keep: wrapper+workdir+uuid, plus the
 *  workspace/branch pair the peer list reports. */
const seed = (home: string, id: string, uuid: string,
              over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const slug = id.replace(/^[a-z-]+?-/, '');
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/demo/${slug}`, uuid,
    started: '1', workspace: slug, branch: `ws/${slug}`, ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** tmux that answers has-session per id: ids named in `dead` have no pane.
 *  `sessionLifecycle` then classifies each row from the pane verdict plus the
 *  registry stamps — dead + `.stopped` reads `stopped`, alive + started reads
 *  running/unsupervised (`shared/api.ts:1325`). */
const tmuxRunner = (dead: readonly string[] = []): Runner => async (_cmd, args) => {
  if (args[0] === 'has-session') {
    const target = args.join(' ');
    return { code: dead.some((d) => target.includes(d)) ? 1 : 0, stdout: '', stderr: '' };
  }
  if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
  if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
  return { code: 1, stdout: '', stderr: '' };
};

const openApp = async (home: string, run: Runner, over: Partial<Deps> = {}) => {
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home, run), mailToken: TOKEN, coord, ...over });
  return { app, coord };
};

const peers = (app: FastifyInstance, qs: string, headers: Record<string, string> = tok) =>
  app.inject({ method: 'GET', url: `/api/peers${qs}`, headers });

interface PeerRow {
  id: string; deliverable: string; archivedAt: number | null; archivedStale: boolean;
  lifecycle: string | null; intent: string | null; claimedPaths: string[];
}
const rows = (res: { body: string }): PeerRow[] =>
  (JSON.parse(res.body) as { peers: PeerRow[] }).peers;

describe('GET /api/peers', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('refuses zero query params and both — exactly one of ?project= / ?of=', async () => {
    const home = mkTmp('ccrc-peers-');
    const w = await openApp(home, tmuxRunner()); app = w.app;
    for (const qs of ['', '?project=demo&of=demo-quiet-mesa']) {
      const res = await peers(app, qs);
      expect(res.statusCode, qs || '(none)').toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    }
  });

  it('lists a project: a live peer is yes, a stopped one is no:stopped, and etiquette rides along', async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, 'demo-still-pond', UUID_B, { stopped: '1755700000 pwa' });
    const w = await openApp(home, tmuxRunner(['demo-still-pond'])); app = w.app;

    const res = await peers(app, '?project=demo');
    expect(res.statusCode).toBe(200);
    const byId = new Map(rows(res).map((p) => [p.id, p]));
    expect(byId.get('demo-quiet-mesa')?.deliverable).toBe('yes');
    expect(byId.get('demo-still-pond')?.deliverable).toBe('no:stopped');
    expect(byId.get('demo-still-pond')?.lifecycle).toBe('stopped');
    // The five rules, verbatim, in the SAME answer that granted discovery
    // (D17: a skill reaches a home only once its installer has run there;
    // the route reaches every caller).
    expect(res.json().etiquette).toEqual([...PEER_ETIQUETTE]);
  });

  it('reports the archived-but-live row: archivedAt verbatim, archivedStale NAMED, deliverable yes', async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, 'demo-calm-mesa', UUID_B, { archived: '1755300123', archivedreason: 'merged:#42' });
    const w = await openApp(home, tmuxRunner()); app = w.app;   // calm-mesa is ALIVE

    const p = rows(await peers(app, '?project=demo')).find((r) => r.id === 'demo-calm-mesa')!;
    expect(p.archivedAt).toBe(1755300123);        // verbatim — a field that is silently false
    expect(p.deliverable).toBe('yes');            // ...must not be laundered into a filter (D9)
    expect(p.archivedStale).toBe(true);           // the contradiction, named
  });

  it("an unmeasurable row is 'unknown' — which is NOT 'no'", async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, 'demo-vague-hill', UUID_B);
    const w = await openApp(home, tmuxRunner(),
      { io: unreadableField('demo-vague-hill', 'started') }); app = w.app;

    const p = rows(await peers(app, '?project=demo')).find((r) => r.id === 'demo-vague-hill')!;
    expect(p.deliverable).toBe('unknown');
    expect(p.lifecycle).toBe('unmeasurable');
  });

  it('?of= derives the project and excludes the asker; ?project= includes every row', async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, 'demo-still-pond', UUID_B);
    const w = await openApp(home, tmuxRunner()); app = w.app;

    const of = rows(await peers(app, '?of=demo-quiet-mesa')).map((p) => p.id);
    expect(of).toEqual(['demo-still-pond']);
    const proj = rows(await peers(app, '?project=demo')).map((p) => p.id).sort();
    expect(proj).toEqual(['demo-quiet-mesa', 'demo-still-pond']);
  });

  it("a typo'd project answers [] plus projects[] — 'I am alone' is disprovable", async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, 'other-plain-harbor', UUID_C, { project: 'other', workdir: '/w/other/plain-harbor' });
    const w = await openApp(home, tmuxRunner()); app = w.app;

    const res = await peers(app, '?project=demo-typo');
    expect(res.statusCode).toBe(200);
    expect(res.json().peers).toEqual([]);
    // Every project measured THIS pass — the free measurement, not an io.stat
    // probe on the one call the tree knows lies (D-114). No projectKnown boolean.
    expect(res.json().projects).toEqual(['demo', 'other']);
  });

  it('?of= an unknown id is 404; an unlistable registry is 502, never 404', async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const w = await openApp(home, tmuxRunner()); app = w.app;
    const gone = await peers(app, '?of=demo-never-was');
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toMatchObject({ ok: false, error: 'unknown-session' });
    await app.close();

    const unlistable: FleetIO = { ...localIO, readdir: async () => null };
    const w2 = await openApp(home, tmuxRunner(), { io: unlistable }); app = w2.app;
    const res = await peers(app, '?of=demo-quiet-mesa');
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
  });

  it('renders a live claim as intent + claimedPaths on the holding row (D12 ruling 3)', async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, 'demo-still-pond', UUID_B);
    const w = await openApp(home, tmuxRunner()); app = w.app;
    const r = w.coord.acquireClaims({ project: 'demo', paths: ['shared/api.ts', 'shared/roster.ts'],
      byId: 'demo-quiet-mesa', byUuid: UUID_A, intent: 'rewiring the roster', runId: null,
      now: Date.now() });
    expect(r.ok).toBe(true);

    const byId = new Map(rows(await peers(app, '?project=demo')).map((p) => [p.id, p]));
    expect(byId.get('demo-quiet-mesa')?.intent).toBe('rewiring the roster');
    expect(byId.get('demo-quiet-mesa')?.claimedPaths.sort())
      .toEqual(['shared/api.ts', 'shared/roster.ts']);
    expect(byId.get('demo-still-pond')?.intent).toBeNull();
  });

  it('ARMED: anon is 401 with a verdict; the box token passes; auth precedes even the 501', async () => {
    const home = mkTmp('ccrc-peers-');
    const base = testDeps(home, tmuxRunner());
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
    // NO coord store: the 501 must come AFTER the credential check, or an
    // anonymous tailnet caller learns whether this box runs coordination.
    app = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: true }, mailToken: TOKEN });
    const anon = await peers(app, '?project=demo', {});
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ ok: false, error: 'unauthenticated', verdict: 'no-session' });
    const withToken = await peers(app, '?project=demo');
    expect(withToken.statusCode).toBe(501);
    expect(withToken.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it('DARK: a box with CCRC_AUTH off behaves exactly as before the slice', async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const w = await openApp(home, tmuxRunner()); app = w.app;
    const res = await peers(app, '?project=demo', {});   // no credential of any kind
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] Run it, expect FAIL: `cd server && ./node_modules/.bin/vitest run test/peers-route.test.ts`
  — every case answers 404 (route unregistered; on a checkout with a built `dist-pwa` the SPA
  fallback answers 200 text/html instead — either way `res.json()` assertions fail).
- [ ] Add `CLAIM_REFUSE_CODES` to `shared/api.ts`, immediately after `isRunRefuseCode`
  (line 3080):

```ts
/**
 * Build 9's synchronous coordination refusals — the peers/claims/ledger routes'
 * own vocabulary (`coord/routes.ts`), a FIFTH union through
 * `mail-routes.test.ts`'s kebab scanner, checked together with the other four
 * and never merged: a claim refusal is not a mail rejection (nothing is
 * recorded or replayed — the 4xx lands in the live caller's hand,
 * synchronously, which is D10's whole bargain), not a run refusal, and not a
 * gap reason. Admitted through this exported guard rather than the scanner's
 * `NOT_CODES` allowlist, for the reason the `LifecycleGapReason` entry there
 * states: a guard accepts a member added later and still rejects a typo'd one.
 *
 *   unknown-session — GET /api/peers?of= names no registry row. Absence is
 *                     measured against the directory LISTING; an unlistable
 *                     registry is `registry-unmeasurable`, never this (D-37)
 *   claim-conflict  — POST /api/claims lost the race; the 409 names EVERY
 *                     conflicting path and hands each holder's address (D12)
 *   bad-path        — a claim on '.' or '' or a path that escapes the repo;
 *                     claiming the whole repo IS the module wedge
 *   unknown-claim   — release/break: no such claim id
 *   not-owner       — release: the claim is live and not yours; heldBy names who
 *   claim-terminal  — release/break: the row already ended; state rides along.
 *                     Lapse-don't-delete (D12) is why this arm exists at all
 *   not-seeded      — the allocator refuses before sweepLedgerFloor has scanned
 *                     the project (D13: fail shut, never mint from a guess)
 *
 * Producers land across wave 7 (Tasks 18-20); `claims-envelope.test.ts` pins
 * the producer direction once all seven exist.
 */
export const CLAIM_REFUSE_CODES = [
  'unknown-session', 'claim-conflict', 'bad-path', 'unknown-claim', 'not-owner',
  'claim-terminal', 'not-seeded',
] as const;
export type ClaimRefuseCode = (typeof CLAIM_REFUSE_CODES)[number];
export function isClaimRefuseCode(v: unknown): v is ClaimRefuseCode {
  return typeof v === 'string' && (CLAIM_REFUSE_CODES as readonly string[]).includes(v);
}
```

- [ ] Write the route. In `server/src/coord/routes.ts`: extend the imports —

```ts
import { assembleFleet } from '../fleet.js';
import { peerDeliverable, archiveContradicted, type PeerPresence } from './peers.js';
```

  and add to the `shared/api.js` import list (lines 17-21): `PEER_ETIQUETTE`,
  `type PeerSummary`, `type PeerDeliverable`. Then register the route after the
  `GET /api/lifecycle` handler (after line 1212, still inside `registerCoordRoutes`):

```ts
  /**
   * `GET /api/peers?project=<slug>` or `?of=<sessionId>` — exactly one (D9).
   * Same-project discovery, the thing `ListAgents` structurally cannot do
   * (ccrc's load balancer scatters a project across accounts, and an account
   * IS a config dir).
   *
   * EXEMPT-BUT-AUTHENTICATED (D-149's pattern, ruled for this route by build 9
   * D9): a fleet-host session asks "who else is on my project" COOKIELESS, and
   * the PWA asks the same question with a cookie. Either credential, never
   * neither; flag-aware, so a dark box is unchanged; auth precedes even the
   * 501; the refusal carries the session's own `verdict`. All four properties
   * are `GET /api/runs`'s and are pinned the same way.
   *
   * THE ROUTE DOES NOT FILTER ON `.archived` AT ALL, and there is no boolean
   * called `addressable`: `archivedAt` rides verbatim and decides nothing (a
   * field that is silently false must not be laundered into a filter — 4 of 8
   * archived rows were live and heartbeating when measured), `archivedStale`
   * NAMES the contradiction, and `deliverable` is decided by `peerDeliverable`
   * (L1) from the STRUCTURAL rungs only — the transient rungs are sweepMail's
   * lane state, and reporting them here would call a busy peer unreachable,
   * the exact lie R2 forbids. `'unknown'` is not `'no'`.
   *
   * `projects[]` — every project measured this pass — replaces a
   * `projectKnown` boolean: a typo'd project is this feature's central failure
   * mode (a worker reads `[]` as "I am alone" and conflicts), and the obvious
   * fix, one `io.stat` of the project dir, is built on the call the tree
   * already knows lies (D-114: the agent's stat answers EACCES as
   * `{missing:true}`).
   */
  app.get('/api/peers', async (req, reply) => {
    if (deps.cfg.authEnabled) {
      const session = sessionAuth(req);
      if (session.reason !== 'session') {
        const token = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
        if (token !== 'ok') {
          return reply.code(401).send({
            ok: false,
            error: 'unauthenticated',
            verdict: session.verdict,
            detail: 'GET /api/peers takes a session cookie OR the box token ' +
              `(${MAIL_TOKEN_HEADER}); a session reads it cookieless from the fleet host`,
          });
        }
      }
    }
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;

    const q = req.query as { project?: unknown; of?: unknown };
    const hasProject = typeof q.project === 'string' && q.project.trim() !== '';
    const hasOf = typeof q.of === 'string' && q.of.trim() !== '';
    if (hasProject === hasOf) {   // neither, or both
      return reply.code(400).send({ ok: false, error: 'bad-request',
        detail: 'exactly one of ?project= or ?of= — a peer list is scoped or it is nothing' });
    }

    // ONE listing, reused below for the presence ladder — the same
    // fail-shut-on-unlistable idiom the mail ingress uses for this directory.
    const names = await deps.io.readdir(deps.cfg.registryDir);
    if (names === null) {
      return reply.code(502).send({ ok: false, error: 'registry-unmeasurable',
        detail: 'the registry directory could not be listed — transient, not a fact about any peer' });
    }
    const sessions = await assembleFleet(deps.io, deps.cfg, deps.tmux);

    let project: string;
    let selfId: string | null = null;
    if (hasOf) {
      selfId = (q.of as string).trim();
      const own = sessions.find((s) => s.id === selfId);
      if (!own) {
        if (names.includes(`${selfId}.uuid`)) {
          return reply.code(502).send({ ok: false, error: 'registry-unmeasurable',
            detail: `registry row for ${selfId} is listed but unreadable — transient, not absence` });
        }
        return reply.code(404).send({ ok: false, error: 'unknown-session',
          detail: `no registry row for ${selfId}` });
      }
      project = own.project;
    } else {
      project = (q.project as string).trim();
    }

    // The claim table is the intent signal that REPLACES the frozen ai-title
    // (D12 ruling 3): a branch name is written once, an intent can be written
    // every ten minutes.
    const live = coord.activeClaims(project, Date.now());
    const byHolder = new Map<string, { intent: string; paths: string[] }>();
    for (const c of live) {
      const held = byHolder.get(c.byId) ?? { intent: c.intent, paths: [] };
      held.intent = c.intent;   // rows come oldest-first: the newest live intent wins
      held.paths.push(c.path);
      byHolder.set(c.byId, held);
    }

    const peers: PeerSummary[] = sessions
      .filter((s) => s.project === project && s.id !== selfId)
      .map((s) => {
        const deliverable = peerDeliverable('measured', s.lifecycle);
        return {
          id: s.id, project: s.project, wrapper: s.wrapper,
          workspace: s.workspace, branch: s.branch,
          archivedAt: s.archivedAt,
          archivedStale: archiveContradicted(s.archivedAt, deliverable),
          deliverable,
          lifecycle: s.lifecycle,
          intent: byHolder.get(s.id)?.intent ?? null,
          claimedPaths: byHolder.get(s.id)?.paths ?? [],
        };
      });

    const projects = [...new Set(sessions.map((s) => s.project))].sort();
    return reply.code(200).send({ ok: true, peers, projects, etiquette: PEER_ETIQUETTE });
  });
```

- [ ] Add the `EXEMPT` entry in `server/src/auth/gate.ts` after the `GET /api/lifecycle` entry
  (line 196):

```ts
  ['GET /api/peers',
    "EXEMPT-BUT-AUTHENTICATED (D-149's pattern, ruled by build 9 D9): a fleet-host session asks " +
    '"who else is on my project" cookieless — same-project discovery is the feature, and the ' +
    'fleet host has no cookie jar — while the PWA asks with a cookie. The handler requires a ' +
    'live session OR a valid box token (coord/routes.ts), so nothing is published to the ' +
    'tailnet that was not before'],
```

- [ ] Run the new suite, expect the deliverable/etiquette cases green but `mail-routes.test.ts`
  RED: `./node_modules/.bin/vitest run test/mail-routes.test.ts` fails with
  `unknown-session is not a declared MailRejectCode, RunRefuseCode or LifecycleGapReason` — the
  scanner caught the new vocabulary, which is the ceremony working.
- [ ] Amend the scanner in `server/test/mail-routes.test.ts`: add `isClaimRefuseCode` to the
  import from `'../../shared/api.js'` (line 9), and extend the acceptance expression
  (line 435-444) with a fourth arm:

```ts
        || isLifecycleGapReason(tok)
        // BUILD 9 WAVE 7 — the FIFTH union, checked together and never merged
        // (the standing rule stated at `enter-ignored` above). The claims and
        // ledger routes refuse synchronously to a live caller — nothing is
        // recorded, nothing replays — so their codes are neither mail
        // rejections nor run refusals. Admitted through the exported guard,
        // not NOT_CODES, so a member added later is accepted and a typo is not.
        || isClaimRefuseCode(tok),
        `${tok} is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason or ClaimRefuseCode`).toBe(true);
```

- [ ] Update the auth sweep's pins in `server/test/auth-gate.test.ts`:
  - line 63: `const EXEMPT_BUT_AUTHENTICATED = new Set(['GET /api/lifecycle', 'GET /api/runs', 'GET /api/peers']);`
  - line 194: `expect(scanRoutes('coord/routes.ts').length).toBe(15);`
  - line 195: `expect(ROUTES.length).toBe(60);`
  - line 198: `expect(ROUTES.filter((r) => !isWs(r)).length).toBe(57);`
  - the snapshot list (lines 354-373): insert `'GET /api/peers',` between `'GET /api/mail/:id',`
    and `'GET /api/runs',`; bump the comment's `18 =` arithmetic to `19` and extend its
    D-149 clause to name peers.
  - the box-token-lane list (lines 405-410): insert `'GET /api/peers',` after
    `'GET /api/mail/:id',`; retitle the `it` from `the ELEVEN box-token lanes` to
    `the TWELVE box-token lanes` and fix the two `ELEVEN` prose mentions.
- [ ] Append the corpus naming stub to `ccd/coordinator-skill/references/wave-lifecycle.md`
  (end of file):

```md

## Build 9 — peers, claims, deviations (wave 7 surface)

The protocol prose for these routes lands with the build-9 skill wave (coordinator clause 10,
worker clause 11, `references/peer-protocol.md`). The lines here name the surface so the
route-parity suite binds each registration to this corpus from the commit that registers it.

- `GET /api/peers` — who else is on this project; read each row's own `deliverable` and
  `lifecycle`, never its archive stamp.
```

- [ ] Run, expect PASS, all four suites:
  `./node_modules/.bin/vitest run test/peers-route.test.ts test/mail-routes.test.ts test/auth-gate.test.ts test/coordinator-skill.test.ts`
- [ ] **Mutation ceremony (D9's laundering guard).** In the route, change the peers filter to
  `.filter((s) => s.project === project && s.id !== selfId && s.archivedAt === null)` — the
  "obvious" filter D9 forbids. Run `test/peers-route.test.ts`: expect exactly 1 red
  (`reports the archived-but-live row`). Revert (`git checkout -- src/coord/routes.ts` is too
  broad mid-task — revert the one line by hand), re-run, green.
- [ ] **Mutation ceremony (the contradiction is computed, not defaulted).** Change
  `archivedStale: archiveContradicted(s.archivedAt, deliverable)` to `archivedStale: false`.
  Expect the same test red on `archivedStale`. Revert, re-run, green.
- [ ] Run the wider slice in the foreground:
  `./node_modules/.bin/vitest run test/auth-wire.test.ts test/typecheck-tests.test.ts`
  (typecheck proves the L0 additions and route compile everywhere).
- [ ] Commit:

```bash
git add shared/api.ts server/src/coord/routes.ts server/src/auth/gate.ts \
  server/test/peers-route.test.ts server/test/mail-routes.test.ts server/test/auth-gate.test.ts \
  ccd/coordinator-skill/references/wave-lifecycle.md
git commit -m "server(wave7): GET /api/peers — discovery reports the contradiction instead of resolving it" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 19: the claims routes — the CAS behind a door, and the 409 that is an address

**Files:**
- Modify `shared/api.ts` — three wire caps beside `CLAIM_REFUSE_CODES` (added in Task 18).
- Modify `server/src/coord/routes.ts` — `sendClaimEndOutcome` + `conflictMailHint` module
  functions (after `sendSettleItemsOutcome`, line 191), `requireAttribution` helper (after
  `requireMailToken`, line 271), four routes appended after `GET /api/peers`.
- Modify `server/src/auth/gate.ts` — three `EXEMPT` entries; the NOT-EXEMPT prose paragraph
  (lines 155-161) gains the break route.
- Modify `server/test/coord-pause-route.test.ts` — `UNGATED` (line 168) gains
  `'/api/claims/:id/break'`; the file-header comment (lines 1-5) says three, not two.
- Modify `server/test/coordinator-skill.test.ts` — the parity `EXEMPT` set (lines 184-200)
  gains `'POST /api/claims/:id/break'`.
- Modify `server/test/auth-gate.test.ts` — counts and lists per the baseline table.
- Modify `ccd/coordinator-skill/references/wave-lifecycle.md` — three naming-stub lines.
- Create `server/test/claims-routes.test.ts`.

**Interfaces:**
- Consumes: `acquireClaims` / `releaseClaim` / `breakClaim` / `activeClaims` / `allClaims` and
  their unions; `peerDeliverable`; `ClaimConflict` / `ClaimMailHint` / `ClaimSummary` /
  `CLAIM_LEASE_MS`; `readRegistry` / `measuredIdentity`; `assembleFleet`.
- Produces:
  - **`POST /api/claims`** (box token + attribution) — body
    `{ byId, byUuid, project, paths: string[], intent, runId? }`;
    `200 { ok, ids, expiresAt, hardExpiresAt, renewed }`;
    `409 { ok:false, error:'claim-conflict', conflicts: ClaimConflict[] }` (every conflicting
    path; `mailHint` pre-addressed, degraded to `escalate` when `deliverable` is `no:<reason>`);
    `400 bad-path` / `bad-request`; `413 oversize`; `404 unknown-run`; `403 unknown-sender` /
    `stale-uuid`; `502 registry-unmeasurable`.
  - **`POST /api/claims/:id/release`** (box token + attribution) — `200 {ok:true}` |
    `404 unknown-claim` | `403 not-owner {heldBy}` | `409 claim-terminal {state}`.
  - **`POST /api/claims/:id/break`** — UNGATED operator door, body never read;
    `200 {ok:true, state:'broken'}` | `404` | `409 claim-terminal`.
  - **`GET /api/claims?project=&all=1`** (dual-arm D-149) —
    `200 { ok:true, claims: ClaimSummary[] }`; `?project=` optional, `all=1` includes ended rows.
  - L0: `CLAIM_PATHS_MAX = 32`, `CLAIM_PATH_MAX_BYTES = 512`, `CLAIM_INTENT_MAX_BYTES = 512`.

**Steps:**

- [ ] Write the failing test, `server/test/claims-routes.test.ts`:

```ts
// The claims routes (build 9 D11/D12). The CAS is coord.db's own synchronous
// tx() inside `acquireClaims` — this file exercises the DOOR: gates,
// attribution, all-or-nothing, the 409-as-address, lapse-don't-delete, and the
// abandon-shaped break.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { CLAIM_LEASE_MS } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const UUID_A = 'a'.repeat(36);
const UUID_B = 'b'.repeat(36);

const seed = (home: string, id: string, uuid: string, over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: `/w/demo/${id}`, uuid,
    started: '1', ...over };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** tmux alive for every id unless named dead — the deliverable measurement on
 *  the 409 arm reads it through assembleFleet. */
const tmuxRunner = (dead: readonly string[] = []): Runner => async (_cmd, args) => {
  if (args[0] === 'has-session') {
    return { code: dead.some((d) => args.join(' ').includes(d)) ? 1 : 0, stdout: '', stderr: '' };
  }
  if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
  if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
  return { code: 1, stdout: '', stderr: '' };
};

const openApp = async (home: string, run: Runner = tmuxRunner(), over: Partial<Deps> = {}) => {
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home, run), mailToken: TOKEN, coord, ...over });
  return { app, coord };
};

const A = { byId: 'demo-quiet-mesa', byUuid: UUID_A };
const B = { byId: 'demo-still-pond', byUuid: UUID_B };

const claim = (app: FastifyInstance, body: Record<string, unknown>,
               headers: Record<string, string> = tok) =>
  app.inject({ method: 'POST', url: '/api/claims', headers, payload: body });
const release = (app: FastifyInstance, id: number, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/claims/${id}/release`, headers: tok, payload: body });
const brk = (app: FastifyInstance, id: number, payload?: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/claims/${id}/break`,
    ...(payload ? { payload } : { payload: {} }) });
const list = (app: FastifyInstance, qs = '?project=demo') =>
  app.inject({ method: 'GET', url: `/api/claims${qs}`, headers: tok });

describe('POST /api/claims', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('acquires, and a same-owner re-POST renews — new intent, renewed:true', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    const w = await openApp(home); app = w.app;

    const first = await claim(app, { ...A, project: 'demo', paths: ['shared/api.ts'],
      intent: 'rewiring the roster' });
    expect(first.statusCode).toBe(200);
    const body1 = first.json() as { ids: number[]; expiresAt: number; hardExpiresAt: number;
      renewed: boolean };
    expect(body1.renewed).toBe(false);
    expect(body1.ids).toHaveLength(1);
    expect(body1.expiresAt).toBeGreaterThan(Date.now());
    expect(body1.expiresAt).toBeLessThanOrEqual(Date.now() + CLAIM_LEASE_MS + 5_000);
    expect(body1.hardExpiresAt).toBeGreaterThan(body1.expiresAt);

    const again = await claim(app, { ...A, project: 'demo', paths: ['shared/api.ts'],
      intent: 'now proving the roster' });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { renewed: boolean }).renewed).toBe(true);
    const rows = (await list(app)).json() as
      { claims: { intent: string; state: string }[] };
    expect(rows.claims.map((c) => c.intent)).toEqual(['now proving the roster']);
  });

  it('is all-or-nothing: one conflict means ZERO acquired, and the 409 names every conflicting path', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    seed(home, B.byId, UUID_B);
    const w = await openApp(home); app = w.app;
    await claim(app, { ...A, project: 'demo', paths: ['shared/mark.mjs', 'ccd/ccd'],
      intent: 'stamping' });

    const res = await claim(app, { ...B, project: 'demo',
      paths: ['shared/api.ts', 'shared/mark.mjs', 'ccd/ccd'], intent: 'colliding' });
    expect(res.statusCode).toBe(409);
    const conflicts = (res.json() as { conflicts: { path: string; heldBy: string }[] }).conflicts;
    expect(conflicts.map((c) => c.path).sort()).toEqual(['ccd/ccd', 'shared/mark.mjs']);
    expect(conflicts.every((c) => c.heldBy === A.byId)).toBe(true);
    // ZERO acquired — partial acquisition is two workers each holding half of
    // what the other needs (D12).
    const held = (await list(app)).json() as { claims: { byId: string; path: string }[] };
    expect(held.claims.filter((c) => c.byId === B.byId)).toEqual([]);
  });

  it('conflicts on directory-prefix containment, BOTH directions — shared/ vs shared/api.ts', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    seed(home, B.byId, UUID_B);
    const w = await openApp(home); app = w.app;
    await claim(app, { ...A, project: 'demo', paths: ['shared/'], intent: 'the whole module' });
    const leaf = await claim(app, { ...B, project: 'demo', paths: ['shared/api.ts'], intent: 'one file' });
    expect(leaf.statusCode, 'a held directory contains its files').toBe(409);
    await app.close();

    const home2 = mkTmp('ccrc-claims-');
    seed(home2, A.byId, UUID_A);
    seed(home2, B.byId, UUID_B);
    const w2 = await openApp(home2); app = w2.app;
    await claim(app, { ...A, project: 'demo', paths: ['shared/api.ts'], intent: 'one file' });
    const dir = await claim(app, { ...B, project: 'demo', paths: ['shared/'], intent: 'the module' });
    expect(dir.statusCode, 'a held file blocks its directory').toBe(409);
  });

  it("refuses '.' and '' as bad-path — claiming the repo IS the module wedge", async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    const w = await openApp(home); app = w.app;
    for (const p of ['.', '']) {
      const res = await claim(app, { ...A, project: 'demo', paths: [p], intent: 'everything' });
      expect(res.statusCode, JSON.stringify(p)).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: p === '' ? 'bad-request' : 'bad-path' });
    }
  });

  it('the 409 carries the full envelope: heldBy/heldByUuid/intent/runId/expiresAt/deliverable/mailHint', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    seed(home, B.byId, UUID_B);
    const w = await openApp(home); app = w.app;
    await claim(app, { ...A, project: 'demo', paths: ['shared/api.ts'], intent: 'rewiring' });

    const res = await claim(app, { ...B, project: 'demo', paths: ['shared/api.ts'], intent: 'me too' });
    expect(res.statusCode).toBe(409);
    const c = (res.json() as { conflicts: Record<string, unknown>[] }).conflicts[0]!;
    expect(c).toMatchObject({
      path: 'shared/api.ts', heldBy: A.byId, heldByUuid: UUID_A, intent: 'rewiring',
      runId: null, deliverable: 'yes',
      mailHint: { send: { toId: A.byId, kind: 'question', subject: 'claim-conflict demo:shared/api.ts' } },
    });
    expect(c['expiresAt'] as number).toBeGreaterThan(Date.now());
  });

  it("degrades the hint to operator escalation when the holder is 'no:<reason>' — never a silent send", async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A, { stopped: '1755700000 pwa' });
    seed(home, B.byId, UUID_B);
    const w = await openApp(home, tmuxRunner([A.byId])); app = w.app;
    // A claimed while alive; the row outlives the session (lapse is the
    // watcher's job, and the lease has not run out yet).
    w.coord.acquireClaims({ project: 'demo', paths: ['shared/api.ts'], byId: A.byId,
      byUuid: UUID_A, intent: 'was rewiring', runId: null, now: Date.now() });

    const res = await claim(app, { ...B, project: 'demo', paths: ['shared/api.ts'], intent: 'me too' });
    expect(res.statusCode).toBe(409);
    const c = (res.json() as { conflicts: { deliverable: string; mailHint: Record<string, unknown> }[] })
      .conflicts[0]!;
    expect(c.deliverable).toBe('no:stopped');
    expect(c.mailHint).toHaveProperty('escalate');
    expect(c.mailHint).not.toHaveProperty('send');
  });

  it('expires a lapsed row IN THE SAME ATTEMPT — a wedged watcher cannot wedge the claim route', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    seed(home, B.byId, UUID_B);
    const w = await openApp(home); app = w.app;
    // A's lease is already over: acquire with a backdated clock, straight into
    // the store — the route always stamps its own now.
    w.coord.acquireClaims({ project: 'demo', paths: ['shared/api.ts'], byId: A.byId,
      byUuid: UUID_A, intent: 'long gone', runId: null, now: Date.now() - CLAIM_LEASE_MS - 60_000 });

    const res = await claim(app, { ...B, project: 'demo', paths: ['shared/api.ts'], intent: 'fresh' });
    expect(res.statusCode, 'the expiry ran inside the attempt tx (D12)').toBe(200);
    const all = (await list(app, '?project=demo&all=1')).json() as
      { claims: { byId: string; state: string }[] };
    // Lapse, don't delete: A's row SURVIVES as history.
    expect(all.claims.find((c) => c.byId === A.byId)?.state).toBe('lapsed');
    expect(all.claims.find((c) => c.byId === B.byId)?.state).toBe('live');
  });

  it('gates: no token 401; stale uuid 403; unknown claimant 403; unknown runId 404', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    const w = await openApp(home); app = w.app;
    const good = { ...A, project: 'demo', paths: ['shared/api.ts'], intent: 'x' };
    expect((await claim(app, good, {})).statusCode).toBe(401);
    expect((await claim(app, { ...good, byUuid: 'c'.repeat(36) })).statusCode).toBe(403);
    expect((await claim(app, { ...good, byId: 'demo-never-was' })).statusCode).toBe(403);
    expect((await claim(app, { ...good, runId: 999 })).statusCode).toBe(404);
  });
});

describe('release and break', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const acquire = async (app: FastifyInstance): Promise<number> => {
    const res = await claim(app, { ...A, project: 'demo', paths: ['shared/api.ts'], intent: 'x' });
    expect(res.statusCode).toBe(200);
    return (res.json() as { ids: number[] }).ids[0]!;
  };

  it('the owner releases; a second release is claim-terminal, not a delete', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    const w = await openApp(home); app = w.app;
    const id = await acquire(app);
    expect((await release(app, id, { ...A })).statusCode).toBe(200);
    const again = await release(app, id, { ...A });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ ok: false, error: 'claim-terminal', state: 'released' });
  });

  it('a non-owner cannot release — 403 names the holder; an unknown id is 404', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    seed(home, B.byId, UUID_B);
    const w = await openApp(home); app = w.app;
    const id = await acquire(app);
    const res = await release(app, id, { ...B });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-owner', heldBy: A.byId });
    expect((await release(app, 9999, { ...A })).statusCode).toBe(404);
  });

  it('break answers WITHOUT the box token and NEVER reads the body — the abandon-door shape', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    const w = await openApp(home); app = w.app;
    const id = await acquire(app);
    // No token header; a body full of garbage a gate might have parsed.
    const res = await brk(app, id, { byId: 'forged', archive: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: 'broken' });
    const all = (await list(app, '?project=demo&all=1')).json() as
      { claims: { id: number; state: string; endedBy: string | null }[] };
    expect(all.claims.find((c) => c.id === id)).toMatchObject({ state: 'broken', endedBy: 'operator' });
    expect((await brk(app, id)).statusCode).toBe(409);
  });
});
```

  (The `claim`/`release`/`brk`/`list` helpers sit at module scope above the describes, as shown.)
- [ ] Run it, expect FAIL: `./node_modules/.bin/vitest run test/claims-routes.test.ts` — 404s
  (routes unregistered).
- [ ] Add the three caps to `shared/api.ts`, directly below the `isClaimRefuseCode` block from
  Task 18:

```ts
/** POST /api/claims wire caps — BYTES where bytes, the MAIL_BODY_MAX_BYTES
 *  char-vs-byte care. `intent` renders on `PeerSummary` and the session line;
 *  it is a sentence, not a spec, and an over-cap one is REFUSED at the
 *  surface, never shortened to fit (the LC_REASON_MAX_BYTES rule: a trimmed
 *  intent reads as the claimant's own words). */
export const CLAIM_PATHS_MAX = 32;
export const CLAIM_PATH_MAX_BYTES = 512;
export const CLAIM_INTENT_MAX_BYTES = 512;
```

- [ ] Write the implementation in `server/src/coord/routes.ts`. Extend the shared-api import
  with `CLAIM_PATHS_MAX, CLAIM_PATH_MAX_BYTES, CLAIM_INTENT_MAX_BYTES, type ClaimConflict,
  type ClaimMailHint`; import `type ClaimEndOutcome` from `./store.js`. Add two module
  functions after `sendSettleItemsOutcome` (line 191):

```ts
/** `releaseClaim`/`breakClaim`'s typed result union -> HTTP status + body.
 *  Same discipline and the same totality guard as the three maps above (see
 *  `sendDispatchOutcome`'s docstring for the measurement that made `default:
 *  never` the house rule). `claim-terminal` carries the row's own state —
 *  lapse-don't-delete (D12) means "already ended" is a fact with a name, not
 *  a 404. */
function sendClaimEndOutcome(reply: FastifyReply, r: ClaimEndOutcome) {
  if (r.ok) return reply.code(200).send({ ok: true, state: r.state });
  switch (r.kind) {
    case 'unknown-claim': return reply.code(404).send({ ok: false, error: 'unknown-claim' });
    case 'not-owner': return reply.code(403).send({ ok: false, error: 'not-owner', heldBy: r.heldBy });
    case 'claim-terminal':
      return reply.code(409).send({ ok: false, error: 'claim-terminal', state: r.state });
    default: {
      const _exhaustive: never = r;
      return reply.code(500).send({ ok: false, error: 'internal', kind: (_exhaustive as { kind: string }).kind });
    }
  }
}

/** The 409's address (D12): class 8 proved awareness alone does not prevent a
 *  collision, so the mechanism does not stop at telling you — it hands you the
 *  envelope. A holder whose deliverable is 'no:<reason>' degrades the hint to
 *  operator escalation, NEVER to a silent send; 'unknown' still sends — mail
 *  is idle-gated and reference-based, and not-knowing is not death. The
 *  subject is stable per (project, path), so a loser that re-sends the same
 *  hint meets Wave 0's own `duplicate` guard instead of spamming the holder. */
function conflictMailHint(project: string, p: string, holder: string,
                          deliverable: PeerDeliverable): ClaimMailHint {
  if (deliverable.startsWith('no:')) {
    return { escalate: `the holder is not deliverable (${deliverable}) — raise it with the ` +
      'operator through the console; a mail queued at an undeliverable session is a silent send' };
  }
  return { send: { toId: holder, kind: 'question', subject: `claim-conflict ${project}:${p}` } };
}
```

  Then, inside `registerCoordRoutes`, add the attribution helper directly below
  `requireMailToken` (line 271):

```ts
  /**
   * The claim lanes' attribution gate — the mail ingress's checks 5/5.5/6 with
   * the SAME transient-vs-terminal split (D-37), factored because both claim
   * writes are new in this build and share it exactly. NOT `refuse()`: a claim
   * refusal is answered synchronously to a live caller and replayed by
   * nothing, so there is no delivery lane needing a recorded rejection to
   * explain itself — the claims table itself is the record of every
   * acquisition that happened.
   */
  const requireAttribution = async (
    reply: FastifyReply, whoId: string, whoUuid: string,
  ): Promise<boolean> => {
    const names = await deps.io.readdir(deps.cfg.registryDir);
    if (names === null) {
      reply.code(502).send({ ok: false, error: 'registry-unmeasurable',
        detail: 'the registry directory could not be listed — transient, not a fact about the claimant' });
      return false;
    }
    const registry = await readRegistry(deps.io, deps.cfg);
    const row = registry.find((r) => r.id === whoId);
    if (!row) {
      if (names.includes(`${whoId}.uuid`)) {
        reply.code(502).send({ ok: false, error: 'registry-unmeasurable',
          detail: `registry row for ${whoId} is listed but unreadable — transient, not a fact about the claimant` });
        return false;
      }
      reply.code(403).send({ ok: false, error: 'unknown-sender', detail: `no registry row for ${whoId}` });
      return false;
    }
    const identity = measuredIdentity(row);
    if (identity === null) {
      reply.code(502).send({ ok: false, error: 'registry-unmeasurable',
        detail: `registry row for ${whoId} is listed but its identity could not be measured — transient` });
      return false;
    }
    if (identity.uuid !== whoUuid) {
      reply.code(403).send({ ok: false, error: 'stale-uuid',
        detail: 'byUuid does not match the registry — stale claimant; re-read your own .uuid' });
      return false;
    }
    return true;
  };
```

  And the four routes, appended after `GET /api/peers`:

```ts
  /**
   * `POST /api/claims` — advisory, all-or-nothing, and the conflict response
   * is an address (D12).
   *
   * THE CAS IS `acquireClaims`' OWN SYNCHRONOUS `tx()` (D11): expiry of lapsed
   * rows, the conflict read (exact match AND directory-prefix containment,
   * which no index can express) and the insert run in ONE transaction, and
   * `DatabaseSync` has no async surface, so the whole thing runs without
   * yielding the event loop — "do not wrap it async" is not a style preference
   * here, it is the reason this is correct. The partial unique index
   * `claim_one_owner` is the BACKSTOP, in that order: lose the transaction in
   * a refactor and the failure is a loud constraint violation, never a
   * duplicate. No `coordMutex`: the mutex exists for routes whose precondition
   * read and commit are separated by fleet-act awaits, and this route has none
   * between them — the deliverable measurement below happens strictly AFTER
   * the decision, on the losing arm only.
   *
   * A claim writes NOTHING to the registry — no `.hold`, no run, no verb, no
   * grant (D12 ruling 1; `claims-no-hold.test.ts` exercises the real
   * `sweepNames` to hold that). Re-POSTing the same paths RENEWS and re-writes
   * `intent`, which is the naming signal that replaces the frozen ai-title.
   */
  app.post('/api/claims', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    if (!requireMailToken(req, reply, 'POST /api/claims')) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const { byId, byUuid, project, intent } = body;
    const pathsRaw = body['paths'];
    const runIdRaw = body['runId'];
    if (typeof byId !== 'string' || typeof byUuid !== 'string' ||
        typeof project !== 'string' || project.trim() === '' ||
        typeof intent !== 'string' || intent.trim() === '' ||
        !Array.isArray(pathsRaw) || pathsRaw.length === 0 ||
        !pathsRaw.every((p) => typeof p === 'string' && p !== '')) {
      return reply.code(400).send({ ok: false, error: 'bad-request',
        detail: 'byId/byUuid/project/intent strings, paths a non-empty array of non-empty strings' });
    }
    const paths = pathsRaw as string[];
    let runId: number | null;
    if (runIdRaw === undefined || runIdRaw === null) {
      runId = null;
    } else if (typeof runIdRaw === 'number' && Number.isInteger(runIdRaw)) {
      runId = runIdRaw;
    } else {
      return reply.code(400).send({ ok: false, error: 'bad-request',
        detail: 'runId must be an integer when given' });
    }

    if (paths.length > CLAIM_PATHS_MAX) {
      return reply.code(413).send({ ok: false, error: 'oversize', limit: CLAIM_PATHS_MAX,
        detail: `paths exceeds ${CLAIM_PATHS_MAX} entries` });
    }
    if (paths.some((p) => Buffer.byteLength(p, 'utf8') > CLAIM_PATH_MAX_BYTES)) {
      return reply.code(413).send({ ok: false, error: 'oversize', limit: CLAIM_PATH_MAX_BYTES,
        detail: `a path exceeds ${CLAIM_PATH_MAX_BYTES} bytes` });
    }
    if (Buffer.byteLength(intent, 'utf8') > CLAIM_INTENT_MAX_BYTES) {
      return reply.code(413).send({ ok: false, error: 'oversize', limit: CLAIM_INTENT_MAX_BYTES,
        detail: `intent exceeds ${CLAIM_INTENT_MAX_BYTES} bytes — it renders on PeerSummary, it is not a spec` });
    }

    if (!(await requireAttribution(reply, byId, byUuid))) return;

    if (runId !== null && coord.run(runId) === null) {
      return reply.code(404).send({ ok: false, error: 'unknown-run', detail: `no run ${runId}` });
    }

    const r = coord.acquireClaims({ project: project.trim(), paths, byId, byUuid,
      intent, runId, now: Date.now() });
    if (r.ok) {
      return reply.code(200).send({ ok: true, ids: r.ids, expiresAt: r.expiresAt,
        hardExpiresAt: r.hardExpiresAt, renewed: r.renewed });
    }
    switch (r.kind) {
      case 'bad-path':
        return reply.code(400).send({ ok: false, error: 'bad-path', path: r.path,
          detail: "claiming '.' or the whole repo IS the module wedge — name the paths" });
      case 'conflict': {
        // Measurement happens ONLY here, after the sync decision: two reads
        // per losing attempt, none per winning one. The presence ladder is the
        // peers route's exactly.
        const names = await deps.io.readdir(deps.cfg.registryDir);
        const sessions = await assembleFleet(deps.io, deps.cfg, deps.tmux);
        const deliverableOf = (id: string): PeerDeliverable => {
          const row = sessions.find((s) => s.id === id);
          if (row) return peerDeliverable('measured', row.lifecycle);
          if (names === null) return peerDeliverable('unmeasurable', null);
          return peerDeliverable(names.includes(`${id}.uuid`) ? 'unmeasurable' : 'absent', null);
        };
        const conflicts: ClaimConflict[] = r.conflicts.map((c) => {
          const deliverable = deliverableOf(c.heldBy);
          return { path: c.path, heldBy: c.heldBy, heldByUuid: c.heldByUuid, intent: c.intent,
            runId: c.runId, expiresAt: c.expiresAt, deliverable,
            mailHint: conflictMailHint(project.trim(), c.path, c.heldBy, deliverable) };
        });
        return reply.code(409).send({ ok: false, error: 'claim-conflict', conflicts });
      }
      default: {
        const _exhaustive: never = r;
        return reply.code(500).send({ ok: false, error: 'internal',
          kind: (_exhaustive as { kind: string }).kind });
      }
    }
  });

  /**
   * `POST /api/claims/:id/release` — the claimant lets go on the final merge.
   * Box token + the same attribution as the claim; the OWNER check is the
   * store's (`not-owner` names the holder). A second release is
   * `claim-terminal`, never idempotent-200: the row already carries an
   * `endedBy`, and overwriting who ended a claim would be the `ws-restore`
   * forgery in miniature.
   */
  app.post('/api/claims/:id/release', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    if (!requireMailToken(req, reply, 'POST /api/claims/:id/release')) return;

    const body = (req.body ?? {}) as { byId?: unknown; byUuid?: unknown };
    if (typeof body.byId !== 'string' || typeof body.byUuid !== 'string') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });

    if (!(await requireAttribution(reply, body.byId, body.byUuid))) return;
    return sendClaimEndOutcome(reply, coord.releaseClaim(id, body.byId, Date.now()));
  });

  /**
   * `POST /api/claims/:id/break` — the OPERATOR's door, the THIRD route in
   * this file that is UNGATED: deliberately NOT behind `requireMailToken`, the
   * `POST /api/runs/:id/abandon` shape (D-B4-9's argument, applied by build 9
   * D12/D16). The box token authenticates the fleet host, and the sessions
   * that hold claims live there and hold that token — a session wedged behind
   * a dead holder's claim must not find the release valve behind the same key
   * the holder used to take it. So this rides the PWA's session-gated surface:
   * with `CCRC_AUTH` armed it sits behind the session gate like abandon and
   * pause, and the operator with a phone is the one who can walk through it.
   *
   * THE REQUEST BODY IS NEVER READ (the D-B4-7 rule, verbatim): `endedBy:
   * 'operator'` is constructed by the store, so a caller cannot send a field
   * that forges who broke the claim. It is also UNNAMED in both skill corpora
   * — `coordinator-skill.test.ts`'s parity EXEMPT set carries it beside
   * `POST /api/runs/:id/abandon`, because naming it would be an invitation the
   * skills' own contract forbids: a coordinator that breaks a worker's claim
   * has stopped coordinating, and a worker that breaks a peer's has stopped
   * being a peer. Breaking destroys no history — the row survives as
   * `state:'broken'`, which is the lapse-don't-delete rule doing its job.
   */
  app.post('/api/claims/:id/break', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });
    return sendClaimEndOutcome(reply, deps.coord.breakClaim(id, Date.now()));
  });

  /**
   * `GET /api/claims?project=&all=1` — the claim table, EXEMPT-BUT-
   * AUTHENTICATED (D-149's pattern): the coordinator asks it COOKIELESS before
   * splitting work (clause 10 — "a wave that dispatches two workers onto
   * overlapping claims is a defect in the ledger"), and the PWA's
   * HotFilesStrip reads it with a cookie. Default is LIVE claims only;
   * `?all=1` opts into history — `"held by X until it died"` is an answer
   * lapse-don't-delete exists to keep. `project` optional: absent means every
   * project, which is the HotFilesStrip's whole-fleet read.
   */
  app.get('/api/claims', async (req, reply) => {
    if (deps.cfg.authEnabled) {
      const session = sessionAuth(req);
      if (session.reason !== 'session') {
        const token = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
        if (token !== 'ok') {
          return reply.code(401).send({
            ok: false,
            error: 'unauthenticated',
            verdict: session.verdict,
            detail: 'GET /api/claims takes a session cookie OR the box token ' +
              `(${MAIL_TOKEN_HEADER}); the coordinator reads it cookieless from the fleet host`,
          });
        }
      }
    }
    if (!deps.coord) return notConfigured(reply);
    const q = req.query as { project?: unknown; all?: unknown };
    const project = typeof q.project === 'string' && q.project.trim() !== ''
      ? q.project.trim() : null;
    const all = q.all === '1' || q.all === 'true';
    const claims = all ? deps.coord.allClaims(project) : deps.coord.activeClaims(project, Date.now());
    return reply.code(200).send({ ok: true, claims });
  });
```

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/claims-routes.test.ts`.
- [ ] `gate.ts`: add three `EXEMPT` entries, sorted into the map beside their siblings —

```ts
  ['GET /api/claims',
    "EXEMPT-BUT-AUTHENTICATED (D-149's pattern): the coordinator asks it cookieless before " +
    "splitting work (clause 10), and the PWA's HotFilesStrip reads it with a cookie. The " +
    'handler requires a live session OR a valid box token (coord/routes.ts)'],
  ['POST /api/claims',
    'a session claims the paths it is about to edit — box-token gated, attribution checked ' +
    'against the registry exactly as the mail ingress checks its sender'],
  ['POST /api/claims/:id/release',
    'the claimant releases on the final merge — box-token gated, same attribution as the claim; ' +
    'the ownership check is the store\'s'],
```

  and extend the NOT-EXEMPT prose paragraph (lines 155-161) so its route list reads
  `POST /api/coord/pause`, `POST /api/runs/:id/abandon` **and `POST /api/claims/:id/break`** —
  same argument, third door.
- [ ] `server/test/coord-pause-route.test.ts`: line 168 becomes

```ts
  const UNGATED = new Set(['/api/coord/pause', '/api/runs/:id/abandon', '/api/claims/:id/break']);
```

  extend that set's docstring with one entry
  (`/api/claims/:id/break: the sessions that hold claims hold the box token; a wedge's release
  valve must not be behind the wedger's own key — build 9 D12`), and update the file-header
  comment (lines 1-5): "one of the THREE write routes … the `UNGATED` set below is the whole
  list, and the scanner holds it to exactly those three." Update `coord/routes.ts`'s pause
  docstring (lines 1019-1047) the same way: "one of the THREE routes in this file that are
  UNGATED … The others are `POST /api/runs/:id/abandon` above and `POST /api/claims/:id/break`
  (build 9 D12 — the same abandon-door shape) … among them they are the WHOLE unauthenticated
  write surface of this file — a claim `coord-pause-route.test.ts`'s `UNGATED` set holds to
  exactly these three names, in both directions." (Its Honesty-clause sentences stay verbatim —
  `coord-pause-route.test.ts:264-272` pins them.)
- [ ] `server/test/coordinator-skill.test.ts`: the parity `EXEMPT` set (lines 184-200) gains,
  under the BUILD 4 pair and with its own comment:

```ts
      // BUILD 9 (D16) — the abandon-door shape, third instance. Breaking a
      // claim is the operator's release valve for a wedge left by a dead or
      // stuck holder; naming it in the corpus would be an invitation the
      // skills' own contract forbids (a coordinator that breaks a worker's
      // claim has stopped coordinating). The claimant's own door is
      // POST /api/claims/:id/release, which IS named.
      'POST /api/claims/:id/break',
```

- [ ] Append three naming-stub lines to the wave-lifecycle.md section Task 18 created:

```md
- `POST /api/claims` — claim every path the wave will touch, before splitting the work; a 409
  names every holder and hands each address.
- `POST /api/claims/:id/release` — release on the final merge, with the claimant's own attribution.
- `GET /api/claims` — the live claim table for a project (`?all=1` includes ended rows).
```

- [ ] `server/test/auth-gate.test.ts`: line 194 → `toBe(19)`; line 195 → `toBe(64)`; line 198 →
  `toBe(61)`; line 63 gains `'GET /api/claims'`; the snapshot list gains
  `'GET /api/claims',` (after `'GET /api/auth/status',`), `'POST /api/claims',` and
  `'POST /api/claims/:id/release',` (after `'POST /api/auth/passkey/assert/start',`), comment
  arithmetic `19 → 22`; the box-token-lane list gains `'GET /api/claims',`, `'POST /api/claims',`
  and `'POST /api/claims/:id/release',` in sort position (title `TWELVE` → `FIFTEEN`); line 432
  → `expect(gated.length).toBe(40);` with its comment noting the one new gated non-exempt route
  is `POST /api/claims/:id/break` (64 − 3 − 21 = 40).
- [ ] Run, expect PASS:
  `./node_modules/.bin/vitest run test/claims-routes.test.ts test/coord-pause-route.test.ts test/coordinator-skill.test.ts test/auth-gate.test.ts test/mail-routes.test.ts`
- [ ] **Mutation ceremony (the UNGATED docstring is load-bearing).** Delete the break route's
  entire docstring. Run `test/coord-pause-route.test.ts`: expect 1 red
  (`/api/claims/:id/break names its reason at the call site`). Restore, re-run, green.
- [ ] **Mutation ceremony (all-or-nothing).** In `acquireClaims`' caller you cannot reach the
  store's tx, so mutate at the seam this task OWNS: in the conflict arm, before building
  `conflicts`, insert `coord.acquireClaims({ project: project.trim(), paths: paths.filter((p) =>
  !r.conflicts.some((c) => c.path === p)), byId, byUuid, intent, runId, now: Date.now() });`
  (the "acquire what you can" mutant). Run `test/claims-routes.test.ts`: expect 1 red
  (`all-or-nothing … ZERO acquired`). Revert the line, re-run, green.
- [ ] Commit:

```bash
git add shared/api.ts server/src/coord/routes.ts server/src/auth/gate.ts \
  server/test/claims-routes.test.ts server/test/coord-pause-route.test.ts \
  server/test/coordinator-skill.test.ts server/test/auth-gate.test.ts \
  server/test/mail-routes.test.ts ccd/coordinator-skill/references/wave-lifecycle.md
git commit -m "server(wave7): the claims door — all-or-nothing CAS, a 409 that is an address, and the operator's break" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 20: the ledger routes — the allocator answers or fails shut

**Files:**
- Modify `server/src/coord/routes.ts` — two routes appended after `GET /api/claims`.
- Modify `server/src/auth/gate.ts` — two `EXEMPT` entries.
- Modify `server/test/auth-gate.test.ts` — counts and lists per the baseline table.
- Modify `ccd/coordinator-skill/references/wave-lifecycle.md` — two naming-stub lines.
- Create `server/test/ledger-routes.test.ts`.

**Interfaces:**
- Consumes: `allocateDeviations` / `recordLedgerFloor` / `ledgerFloor` / `ledgerAllocations`
  (store; `allocateDeviations` appends to `~/.ccrc/ledger-alloc.log` FIRST and commits SECOND —
  `ledgerlog.ts`, part B); `DeviationAllocation`, `LEDGER_SEED_GAP`.
- Produces:
  - **`POST /api/ledger/deviations`** (box token) — body
    `{ project, count, title, byId? }`; `201 { ok:true, numbers: number[], floor }` |
    `409 { ok:false, error:'not-seeded' }` | `400` | `401` | `501`.
  - **`GET /api/ledger?project=`** (box token) —
    `200 { ok:true, floor: number | null, allocations: DeviationAllocation[] }`; `400` without
    `project`.

**Steps:**

- [ ] Write the failing test, `server/test/ledger-routes.test.ts`:

```ts
// The allocator's door (build 9 D13): self-seeds by sweep, then fails shut —
// `409 not-seeded` is openCoordDb's "refuse to start rather than open empty"
// rule, one level up. The race (20 concurrent, 20 distinct contiguous) is
// ledger-race.test.ts's; this file owns the HTTP contract.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };

const openApp = async (over: Partial<Deps> = {}) => {
  const home = mkTmp('ccrc-ledger-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord, ...over });
  return { app, coord, home };
};

const alloc = (app: FastifyInstance, body: Record<string, unknown>,
               headers: Record<string, string> = tok) =>
  app.inject({ method: 'POST', url: '/api/ledger/deviations', headers, payload: body });
const ledger = (app: FastifyInstance, qs: string, headers: Record<string, string> = tok) =>
  app.inject({ method: 'GET', url: `/api/ledger${qs}`, headers });

describe('the ledger routes', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('refuses 409 not-seeded before the floor sweep has scanned the project — never mints from a guess', async () => {
    const w = await openApp(); app = w.app;
    const res = await alloc(app, { project: 'demo', count: 2, title: 'build9b wave 7 block' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-seeded' });
    // NOTHING was allocated on the refusal path.
    expect(((await ledger(app, '?project=demo')).json() as { allocations: unknown[] })
      .allocations).toEqual([]);
  });

  it('allocates a contiguous block once seeded, 201, and the floor moves past it', async () => {
    const w = await openApp(); app = w.app;
    // What sweepLedgerFloor writes: max(D-<n>) + LEDGER_SEED_GAP, evidence named.
    w.coord.recordLedgerFloor('demo', 261, 'plans/2026-08-23-x.md D-211 + 50', Date.now());

    const res = await alloc(app, { project: 'demo', count: 3,
      title: 'build9b wave 7 block', byId: 'demo-coordinator' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true, numbers: [261, 262, 263], floor: 264 });

    const next = await alloc(app, { project: 'demo', count: 1, title: 'a straggler' });
    expect(next.statusCode).toBe(201);
    expect(next.json()).toEqual({ ok: true, numbers: [264], floor: 265 });
  });

  it('GET /api/ledger answers the floor and the allocations, per project, and 400s without one', async () => {
    const w = await openApp(); app = w.app;
    w.coord.recordLedgerFloor('demo', 261, 'seeded', Date.now());
    await alloc(app, { project: 'demo', count: 2, title: 'block A', byId: 'demo-coordinator' });

    const res = await ledger(app, '?project=demo');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { floor: number; allocations: { n: number; title: string;
      byId: string | null; state: string }[] };
    expect(body.floor).toBe(263);
    expect(body.allocations.map((a) => a.n)).toEqual([261, 262]);
    expect(body.allocations[0]).toMatchObject({ title: 'block A', byId: 'demo-coordinator',
      state: 'allocated' });

    expect((await ledger(app, '')).statusCode).toBe(400);
    // An unseeded project answers null, not 0 — 0 is a floor, not an absence.
    expect(((await ledger(app, '?project=other')).json() as { floor: number | null }).floor)
      .toBeNull();
  });

  it('validates the body, and both routes fail shut without the box token', async () => {
    const w = await openApp(); app = w.app;
    w.coord.recordLedgerFloor('demo', 261, 'seeded', Date.now());
    for (const body of [
      {}, { project: 'demo', count: 0, title: 'x' }, { project: 'demo', count: 1.5, title: 'x' },
      { project: 'demo', count: 501, title: 'x' }, { project: 'demo', count: 1, title: '' },
      { project: '', count: 1, title: 'x' }, { project: 'demo', count: 1, title: 'x', byId: 7 },
    ]) {
      expect((await alloc(app, body as Record<string, unknown>)).statusCode,
        JSON.stringify(body)).toBe(400);
    }
    expect((await alloc(app, { project: 'demo', count: 1, title: 'x' }, {})).statusCode).toBe(401);
    expect((await ledger(app, '?project=demo', {})).statusCode).toBe(401);
  });
});
```

- [ ] Run it, expect FAIL: `./node_modules/.bin/vitest run test/ledger-routes.test.ts` — 404s.
- [ ] Write the two routes in `server/src/coord/routes.ts`, after `GET /api/claims`:

```ts
  /**
   * `POST /api/ledger/deviations` — the allocator (D13). Box-token gated: the
   * coordinator allocates the program's whole block AT RUN-OPEN (clause 10),
   * so a wave in flight never calls this; a worker that cannot reach it MUST
   * NOT invent a number (inventing is the root cause — bb47c9e, 30 files, 394
   * D-ref lines rewritten under merge pressure) and writes `D-TBD-<slug>`,
   * which `dtbd.test.ts` turns into a red suite on any diff that tries to
   * land one.
   *
   * The append-to-file-FIRST, commit-SECOND ordering lives inside
   * `allocateDeviations` (`ledgerlog.ts`): recovery is MAX(file, db), so a
   * number is SKIPPED, never reissued — a gap costs nothing (the ledger is
   * prose, parsed by nothing); a reissue costs the incident. Until
   * `sweepLedgerFloor` has seeded the project, allocation answers
   * `409 not-seeded` — `openCoordDb`'s "refuse to start rather than open
   * empty", one level up. No `coordMutex`: the decision and the commit are one
   * synchronous store call with no await between them.
   */
  app.post('/api/ledger/deviations', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    if (!requireMailToken(req, reply, 'POST /api/ledger/deviations')) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const { project, count, title, byId } = body;
    if (typeof project !== 'string' || project.trim() === '' ||
        typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 500 ||
        typeof title !== 'string' || title.trim() === '' ||
        !(byId === undefined || typeof byId === 'string')) {
      return reply.code(400).send({ ok: false, error: 'bad-request',
        detail: 'project/title strings, count an integer 1..500, byId a string when given' });
    }

    const r = coord.allocateDeviations({ project: project.trim(), count,
      title: title.trim(), byId: byId ?? null, now: Date.now() });
    if (r.ok) return reply.code(201).send({ ok: true, numbers: r.numbers, floor: r.floor });
    switch (r.kind) {
      case 'not-seeded':
        return reply.code(409).send({ ok: false, error: 'not-seeded',
          detail: `no floor for ${project.trim()} — sweepLedgerFloor has not scanned it yet; ` +
            'the allocator fails shut rather than minting from a guess (D13)' });
      default: {
        const _exhaustive: never = r.kind;
        return reply.code(500).send({ ok: false, error: 'internal', kind: _exhaustive });
      }
    }
  });

  /**
   * `GET /api/ledger?project=` — the allocation record and the floor, read
   * cookieless from the fleet host (box token, the `GET /api/mail` convention:
   * a read with no attribution to check). Per-project, REQUIRED: `ledger_alloc`
   * is `PRIMARY KEY (project, n)` and a floor is meaningless across projects.
   * `floor: null` is "not seeded", a different fact from 0 — no overloaded
   * value at the seam.
   */
  app.get('/api/ledger', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    if (!requireMailToken(req, reply, 'GET /api/ledger')) return;
    const q = req.query as { project?: unknown; limit?: unknown };
    if (typeof q.project !== 'string' || q.project.trim() === '') {
      return reply.code(400).send({ ok: false, error: 'bad-request',
        detail: 'the ledger is per-project — ?project= is required' });
    }
    const limit = typeof q.limit === 'string' ? Number(q.limit) : undefined;
    return reply.code(200).send({ ok: true,
      floor: deps.coord.ledgerFloor(q.project.trim()),
      allocations: deps.coord.ledgerAllocations(q.project.trim(), limit) });
  });
```

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/ledger-routes.test.ts`.
- [ ] `gate.ts`: two `EXEMPT` entries —

```ts
  ['POST /api/ledger/deviations',
    'the coordinator allocates a D-number block at run-open — box-token gated; a session that ' +
    'cannot reach the allocator must not invent a number, so the allocator must be reachable ' +
    'from the fleet host (build 9 D13, the bb47c9e failure)'],
  ['GET /api/ledger',
    "the allocation record and a project's floor, read cookieless from the fleet host — " +
    'box-token gated (requireMailToken), the GET /api/mail convention: no attribution to check'],
```

- [ ] Two naming-stub lines in wave-lifecycle.md's Build 9 section:

```md
- `POST /api/ledger/deviations` — allocate the program's D-number block at run-open; never
  invent a number, and never reuse one.
- `GET /api/ledger` — the allocation record and the floor for a project.
```

- [ ] `server/test/auth-gate.test.ts`: line 194 → `toBe(21)`; line 195 → `toBe(66)`; line 198 →
  `toBe(63)`; the snapshot list gains `'GET /api/ledger',` (after `'GET /api/claims',`) and
  `'POST /api/ledger/deviations',` (after `'POST /api/claims/:id/release',`) — final list, all
  24 entries in sorted order:

```ts
    expect([...EXEMPT.keys()].sort()).toEqual([
      'GET /*',
      'GET /api/auth/status',
      'GET /api/claims',
      'GET /api/ledger',
      'GET /api/lifecycle',
      'GET /api/mail',
      'GET /api/mail/:id',
      'GET /api/peers',
      'GET /api/runs',
      'GET /health',
      'POST /api/auth/login',
      'POST /api/auth/passkey/assert/finish',
      'POST /api/auth/passkey/assert/start',
      'POST /api/claims',
      'POST /api/claims/:id/release',
      'POST /api/ledger/deviations',
      'POST /api/mail',
      'POST /api/mail/:id/ack',
      'POST /api/notify',
      'POST /api/runs',
      'POST /api/runs/:id/advance',
      'POST /api/runs/:id/close',
      'POST /api/runs/:id/dispatch',
      'POST /api/runs/:id/items',
    ]);
```

  (comment arithmetic → 24); the box-token-lane list gains `'GET /api/ledger',` and
  `'POST /api/ledger/deviations',` in sort position (title `FIFTEEN` → `SEVENTEEN`); `gated`
  stays 40 (66 − 3 − 23) — update the comment's arithmetic only.
- [ ] Run, expect PASS:
  `./node_modules/.bin/vitest run test/ledger-routes.test.ts test/auth-gate.test.ts test/coordinator-skill.test.ts test/mail-routes.test.ts`
- [ ] **Mutation ceremony (fails shut, not open).** In the route, replace the `not-seeded` arm's
  `409` with `reply.code(201).send({ ok: true, numbers: [], floor: 0 })` (the "helpful" mutant).
  Run `test/ledger-routes.test.ts`: expect 1 red (`refuses 409 not-seeded`). Revert, green.
- [ ] Commit:

```bash
git add server/src/coord/routes.ts server/src/auth/gate.ts server/test/ledger-routes.test.ts \
  server/test/auth-gate.test.ts ccd/coordinator-skill/references/wave-lifecycle.md
git commit -m "server(wave7): the allocator's door — a block at run-open, 409 before a guess" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 21: `claims-advisory.test.ts` + `claims-no-hold.test.ts` — the two D12 detectors

**Files:**
- Create `server/test/claims-advisory.test.ts`.
- Create `server/test/claims-no-hold.test.ts`.

**Interfaces:**
- Consumes: `ccd/ccd` and `ccd/session-hook.sh` as text; `server/src/**` as text;
  `acquireClaims` (via the route); the REAL `FleetWatcher.sweepNames`
  (`server/src/watch.ts:677`, tested today by `server/test/name-sweep.test.ts` — the harness
  below is that file's, reused).
- Produces: the two red suites the spec's §4 table names for "Claims never enforce" and
  "Claims never touch the registry".

**Steps:**

- [ ] Write `server/test/claims-advisory.test.ts`:

```ts
// Claims are ADVISORY, never enforcing — and that is a red suite, not a
// sentence (build 9 D12). An ENFORCING claim on ccd/ccd (15 concurrent
// branches measured) or shared/api.ts (18) is the permanent wedge, so the
// EXECUTABLE substrate must carry zero claim references: the skills teach the
// protocol; the substrate must not enforce it.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

// The claims API's names, not the word "claim": ccd legitimately says `claim`
// (`_reg_claim`, the `claim` lifecycle act). What it may never do is call the
// claims API or read its tables.
const FORBIDDEN = ['/api/claims', '/api/ledger', 'activeClaims', 'claim_one_owner', 'ledger_alloc'];

describe('claims are advisory (D12)', () => {
  it('ccd/ccd and session-hook.sh carry ZERO claims-API references', () => {
    const floors: Record<string, number> = { 'ccd/ccd': 11_000, 'ccd/session-hook.sh': 50 };
    for (const [file, floor] of Object.entries(floors)) {
      const src = readFileSync(path.join(REPO, file), 'utf8');
      // Coverage: an empty or truncated read must not pass by having nothing
      // in it to match.
      expect(src.split('\n').length, `${file} shrank out from under the scan`)
        .toBeGreaterThan(floor);
      for (const tok of FORBIDDEN) {
        expect(src.includes(tok),
          `${file} references ${tok} — an enforcing claim on the substrate is the permanent wedge`)
          .toBe(false);
      }
    }
  });

  it('the only server files that touch activeClaims are the store, the routes, peers.ts and divergence.ts', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
    const srcRoot = path.join(REPO, 'server', 'src');
    const ALLOWED = new Set([
      'coord/store.ts',      // the definition
      'coord/routes.ts',     // GET /api/peers and GET /api/claims read it
      'coord/peers.ts',      // the L1 decision, when it reads rows at all
      'divergence.ts',       // divergence.claim-orphan
    ]);
    const holders = walk(srcRoot)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes('activeClaims'))
      .map((f) => path.relative(srcRoot, f))
      .filter((f) => !ALLOWED.has(f));
    expect(holders, 'a new reader of activeClaims is a new place a claim can become ' +
      'enforcement — add it to ALLOWED only with a D12-shaped argument').toEqual([]);
    // Coverage: the scan really found the two readers that must exist, so an
    // emptied tree (or a renamed method) cannot pass by matching nothing.
    const found = walk(srcRoot).filter((f) => f.endsWith('.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes('activeClaims'))
      .map((f) => path.relative(srcRoot, f));
    expect(found).toContain('coord/store.ts');
    expect(found).toContain('coord/routes.ts');
  });
});
```

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/claims-advisory.test.ts`
  (a detector is born green on a correct tree; the mutants below are its red proof).
- [ ] **Mutation ceremony (the substrate direction).** Append
  `# probe: curl -s http://127.0.0.1:7788/api/claims` as a comment line at the end of `ccd/ccd`
  (uncommitted; a committed edit would need the `markGenerated` re-stamp — this one is reverted).
  Run the suite: expect 1 red naming `ccd/ccd references /api/claims`. Revert:
  `git checkout -- ccd/ccd`. Re-run, green.
- [ ] **Mutation ceremony (the server direction).** In `server/src/watch.ts`, add
  `void this.deps.coord?.activeClaims(null, Date.now());` anywhere inside `tick()`. Run the
  suite: expect 1 red naming `watch.ts`. Revert (`git checkout -- server/src/watch.ts`), green.
- [ ] Write `server/test/claims-no-hold.test.ts`:

```ts
// D12 ruling 1, held by mechanism: a claim writes NOTHING to the registry —
// no `.hold`, no run, no verb, no grant. The third assertion exercises the
// REAL `sweepNames`, because asserting a file's absence alone stays green the
// day someone "simplifies" claims onto ws-hold: `sweepNames` skips a held row,
// so the best "what is this session doing" signal on the fleet would freeze
// the moment a workspace claimed anything (the naming-sweep trap).
import { describe, it, expect } from 'vitest';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Bus } from '../src/bus.js';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const ID = 'demo-quiet-mesa';
const UUID = 'a'.repeat(36);
const WORKDIR = '/w/demo/quiet-mesa';
const MUNGED = '-w-demo-quiet-mesa';      // mungePath: /._ -> - (munge.ts:1)

/** name-sweep.test.ts's fixture row: a workspace still on its born branch. */
const seed = (home: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: WORKDIR, uuid: UUID,
    started: '1', workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
};

const TITLE = (t: string): string => JSON.stringify({ type: 'ai-title', aiTitle: t });
const transcript = (home: string): void => {
  const dir = path.join(home, '.claude', 'projects', MUNGED);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${UUID}.jsonl`), TITLE('Fix the PR sheet') + '\n');
};

/** name-sweep.test.ts's harness runner, with one addition: a ws-hold that
 *  APPLIES the verb's own effect (writes `$REG/<id>.hold`), so a mutant that
 *  reaches for the verb produces the exact on-disk state the real ccd would —
 *  and the sweep assertion below can catch the freeze it causes. */
const harness = (home: string): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push([...args]);
    if (args[0] === 'capture-pane') {
      return { code: 0, stdout: `  👤 claude │ 🤖 Sonnet 5 │ ⎇ ws/quiet-mesa │ 🎯 demo`, stderr: '' };
    }
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
    if (args[0] === 'ws-hold') {
      const at = args.indexOf('--session');
      const reasonAt = args.indexOf('--reason');
      writeFileSync(path.join(home, '.cc-sessions', `${args[at + 1]}.hold`),
        reasonAt >= 0 ? args[reasonAt + 1]! : '');
      return { code: 0, stdout: 'held', stderr: '' };
    }
    if (args[0] === 'ws-rename') {
      return { code: 0, stdout: `{"renamed":"${ID}","old":"ws/quiet-mesa","new":"ws/fix-the-pr-sheet"}`, stderr: '' };
    }
    return { code: 1, stdout: '', stderr: '' };
  };
  return { run, calls };
};

describe('a claim writes nothing to the registry (D12 ruling 1)', () => {
  it('acquire leaves the registry byte-listing identical, runs no verb, and the REAL sweepNames still renames', async () => {
    const home = mkTmp('ccrc-noh-');
    seed(home);
    transcript(home);
    const h = harness(home);
    const deps = { ...testDeps(home, h.run), mailToken: TOKEN,
      coord: new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))) };
    const app: FastifyInstance = await buildServer(deps);
    try {
      const reg = path.join(home, '.cc-sessions');
      const before = readdirSync(reg).sort();
      const callsBefore = h.calls.length;

      const res = await app.inject({ method: 'POST', url: '/api/claims', headers: tok,
        payload: { byId: ID, byUuid: UUID, project: 'demo',
          paths: ['shared/api.ts'], intent: 'rewiring the roster' } });
      expect(res.statusCode).toBe(200);

      // 1: the registry keyspace is untouched — no `.hold`, no new field. A
      //    claim lives in coord.db and nowhere else.
      expect(readdirSync(reg).sort()).toEqual(before);
      expect(before).not.toContain(`${ID}.hold`);

      // 2: no ccd verb ran — no verb, no grant, no exec at all. (The registry
      //    reads the attribution gate performs go through deps.io, never the
      //    runner, so ANY new call here is a verb the claim minted.)
      expect(h.calls.length, 'the claim route must not run ccd').toBe(callsBefore);

      // 3: THE REAL SWEEP. The workspace is claimed and still gets its rename:
      //    the sweep's hold-freeze must not fire for a claim, because the
      //    claim deliberately is not a hold. This is the assertion that reds
      //    the "simplify claims onto ws-hold" mutant, whose harness ws-hold
      //    writes the real file.
      const w = new FleetWatcher(deps, new Bus(), 2000);
      await w.sweepNames();
      expect(h.calls.filter((c) => c[0] === 'ws-rename').map((c) => c[4]))
        .toEqual(['ws/fix-the-pr-sheet']);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/claims-no-hold.test.ts`.
- [ ] **Mutation ceremony (THE one the spec names: "simplify" claims onto `ws-hold`).** In
  `server/src/coord/routes.ts`, in `POST /api/claims` directly after the `r.ok` branch opens,
  insert:

```ts
      await deps.runCcd(CCD_ARGV.wsHold(byId, `claim:${paths.join(',')}`,
        sweepDec(deps.fleetState, 'claim')));
```

  (`CCD_ARGV`/`sweepDec` are already imported at line 6.) Run the suite: expect 1 red — and
  verify the failure output shows BOTH assertion 2 (a `ws-hold` call was recorded) and, if
  assertion 2 is commented out for the measurement, assertion 3 (`ws-rename` calls `[]` — the
  sweep froze, because the harness `ws-hold` wrote the real file). Revert the inserted lines,
  re-run, green. This measured pair is why assertion 3 exists: delete assertions 1 and 2 and the
  suite STILL reds this mutant.
- [ ] Commit:

```bash
git add server/test/claims-advisory.test.ts server/test/claims-no-hold.test.ts
git commit -m "test(wave7): two D12 detectors — the substrate never enforces, the registry never learns" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 22: `deviation-refs.test.ts` + `dtbd.test.ts` — the ledger's scanners

**Files:**
- Create `server/test/deviation-refs.test.ts`.
- Create `server/test/dtbd.test.ts`.

**Interfaces:**
- Consumes: `docs/superpowers/plans/*.md` as text; `git grep` over the tracked tree.
- Produces: the "allocator prevents; a scanner detects" pair (D13): a red suite on the exact
  `bb47c9e` shape (one `D-<n>`, two subjects, two plans), and a red suite on any concrete
  `D-TBD-<slug>` placeholder trying to land.

**Steps:**

- [ ] Write `server/test/deviation-refs.test.ts` — WITH THE GRANDFATHER SETS EMPTY, deliberately,
  so the first run is the measurement:

```ts
// The allocator prevents; this scanner detects (build 9 D13). The bb47c9e
// shape: one D-<n> carrying two different subject lines in two different
// plans — the exact wreck the ledger allocator exists to make impossible. It
// ALSO already exists in history: the pre-allocator era minted collisions
// (parallel branches, one number), and three early plans reset numbering per
// plan. Both are grandfathered by MEASUREMENT — the sets below were copied
// from this suite's own first red run, they may only SHRINK (wave 10's D14
// reconciliation is what shrinks them), and every member must still actually
// collide, so a stale entry cannot quietly mask a new one.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLANS = path.resolve(here, '..', '..', 'docs', 'superpowers', 'plans');

/** Plans that predate the one-global-namespace rule and numbered per plan —
 *  excluded from the scan wholesale. May only shrink. */
const LEGACY_PER_PLAN_LEDGERS: ReadonlySet<string> = new Set([
  // measured on the first red run — see the task's own steps
]);

/** Numbers already collided on main when this suite was written (the
 *  pre-allocator wreckage). May only shrink; nothing >= 211 may ever join —
 *  211 is the first allocator-era number. */
const GRANDFATHERED: ReadonlySet<number> = new Set([
  // measured on the first red run — see the task's own steps
]);

// Both ledger-entry heading forms in use: `### D-12 (bug) — subject` (plan
// ledgers through build 7) and `- **D-108 (2026-08-20)** — subject` (the
// bullet form since). Prose REFS (`see D-108`) match neither — this scans
// entries, the lines that DEFINE a number.
const ENTRY = /^(?:#{2,4} |- \*\*)D-(\d+)\b[^—\n]*—\s*(.+)$/;

interface Entry { file: string; n: number; subject: string }

const entries = (): Entry[] => {
  const out: Entry[] = [];
  for (const f of readdirSync(PLANS).filter((f) => f.endsWith('.md'))) {
    if (LEGACY_PER_PLAN_LEDGERS.has(f)) continue;
    for (const line of readFileSync(path.join(PLANS, f), 'utf8').split('\n')) {
      const m = ENTRY.exec(line);
      if (m) out.push({ file: f, n: Number(m[1]), subject: m[2]!.trim() });
    }
  }
  return out;
};

const collisions = (): [number, Entry[]][] => {
  const byN = new Map<number, Entry[]>();
  for (const e of entries()) byN.set(e.n, [...(byN.get(e.n) ?? []), e]);
  return [...byN.entries()].filter(([, es]) =>
    new Set(es.map((e) => e.subject)).size > 1 && new Set(es.map((e) => e.file)).size > 1);
};

describe('the deviation-refs scanner (D13 — the bb47c9e shape)', () => {
  it('no NEW D-<n> carries two different subjects in two different plans', () => {
    const fresh = collisions().filter(([n]) => !GRANDFATHERED.has(n));
    expect(fresh.map(([n, es]) =>
      `D-${n}:\n${es.map((e) => `  ${e.file} :: ${e.subject}`).join('\n')}`),
      'one number, two deviations — allocate through POST /api/ledger/deviations').toEqual([]);
  });

  it('the scanner is looking at something', () => {
    const es = entries();
    expect(es.length, 'ledger entries scanned').toBeGreaterThanOrEqual(100);
    expect(new Set(es.map((e) => e.file)).size, 'plans scanned').toBeGreaterThanOrEqual(8);
  });

  it('every grandfathered number still collides — the set is re-derived, never nudged, and only shrinks', () => {
    const colliding = new Set(collisions().map(([n]) => n));
    for (const n of GRANDFATHERED) {
      expect(colliding.has(n), `D-${n} no longer collides — delete it from GRANDFATHERED`).toBe(true);
    }
    expect([...GRANDFATHERED].every((n) => n < 211),
      'an allocator-era number (>= 211) may NEVER be grandfathered').toBe(true);
  });

  it('every legacy per-plan ledger still exists — a removed file leaves the list', () => {
    const all = new Set(readdirSync(PLANS));
    for (const f of LEGACY_PER_PLAN_LEDGERS) {
      expect(all.has(f), `${f} is grandfathered but gone — remove its entry`).toBe(true);
    }
  });
});
```

- [ ] Run it, expect FAIL — and READ the failure, it is the measurement:
  `./node_modules/.bin/vitest run test/deviation-refs.test.ts`. Expected red at `2d4a7ac7`:
  the collision list names D-1…D-8 (from `2026-08-07-smart-branch-naming.md`,
  `2026-08-08-build7-core.md`, `2026-08-08-build7-surfaces.md` — the per-plan-numbering era) and
  the sixteen modern collisions
  `72, 128, 129, 130, 131, 132, 133, 134, 135, 137, 138, 139, 140, 141, 145, 171`. If `main`
  has moved and the red run's list differs, **the red run's own output is the measured set —
  copy it, not this paragraph.**
- [ ] Fill the two sets from the red run:

```ts
const LEGACY_PER_PLAN_LEDGERS: ReadonlySet<string> = new Set([
  '2026-08-07-smart-branch-naming.md',
  '2026-08-08-build7-core.md',
  '2026-08-08-build7-surfaces.md',
]);
```

```ts
const GRANDFATHERED: ReadonlySet<number> = new Set([
  72, 128, 129, 130, 131, 132, 133, 134, 135, 137, 138, 139, 140, 141, 145, 171,
]);
```

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/deviation-refs.test.ts`.
- [ ] **Mutation ceremony (the bb47c9e mutant).** Append
  `- **D-209 (mutant)** — subject alpha` to one non-legacy plan file and
  `- **D-209 (mutant)** — subject beta` to a different one. Run: expect 1 red naming `D-209`
  with both files and both subjects. Revert both files (`git checkout -- docs/superpowers/plans`),
  re-run, green.
- [ ] Write `server/test/dtbd.test.ts`:

```ts
// D-TBD placeholders never land (build 9 D13). A session that cannot reach
// the allocator writes `D-TBD-<slug>` and STOPS — this suite is what turns
// the outage into a red diff instead of an invented number, which is the
// root cause (bb47c9e).
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

// Built by concatenation so this file's own source never matches its own
// scan. The documented META-form `D-TBD-<slug>` does not match either — '<'
// is outside the class — so specs and skills may TEACH the convention; only a
// CONCRETE placeholder (D-TBD hyphen a real slug) reds the tree. Docs that
// need an example must therefore use the <slug> meta-form, never a literal.
const PATTERN = 'D-TBD' + '-[a-z0-9]';

describe('no D-TBD placeholder lands (D13)', () => {
  it('git grep over every tracked file finds none', () => {
    let out = '';
    try {
      // -I skips binaries; git grep scans TRACKED files in the working tree,
      // which is exactly the set a commit would land.
      out = execFileSync('git', ['grep', '-I', '-n', '-E', PATTERN],
        { cwd: REPO, encoding: 'utf8' });
    } catch (e) {
      const err = e as { status?: number };
      // exit 1 = no match — the green state. Anything else is git itself failing.
      expect(err.status, 'git grep itself failed').toBe(1);
      return;
    }
    expect.fail('a D-TBD placeholder is trying to land — the allocator was unreachable when ' +
      'this was written; allocate the real number (POST /api/ledger/deviations) and replace ' +
      `it before merging:\n${out}`);
  });
});
```

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/dtbd.test.ts` (measured at
  `2d4a7ac7`: `git grep -I -E 'D-TBD-[a-z0-9]'` exits 1 — the tree is clean).
- [ ] **Mutation ceremony.** Plant a CONCRETE placeholder in a tracked file — built by shell
  concatenation, so neither this plan document nor your terminal history carries the literal
  (the same self-match dodge the test uses):
  `printf '<!-- %s-probe: allocator was down -->\n' 'D-TBD' >> README.md` (no commit). Run:
  expect 1 red whose message carries `README.md` and the probe line. Revert
  (`git checkout -- README.md`), re-run, green.
- [ ] Commit:

```bash
git add server/test/deviation-refs.test.ts server/test/dtbd.test.ts
git commit -m "test(wave7): the ledger's scanners — collisions grandfathered by measurement, placeholders refused at the diff" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 23: `coord-routes-single-file.test.ts` — route parity's ground truth, with a coverage floor

**Files:**
- Create `server/test/coord-routes-single-file.test.ts`.

**Interfaces:**
- Consumes: `server/src/**/*.ts` as text; the same `app\.(get|post)\(` shape
  `coordinator-skill.test.ts:160` scans.
- Produces: the D17 guard — all coordination routes live in `coord/routes.ts`, no DELETE (or any
  non-get/post) exists on the coordination surface anywhere, and the scanner proves it looked at
  something (a scan over an empty list passes everything).

**Steps:**

- [ ] Write the test:

```ts
// Route-parity's ground truth (build 9 D17). `coordinator-skill.test.ts:158`
// scans coord/routes.ts ONLY, matching app.(get|post)( — so a coordination
// route registered in another file, or under another verb, would be
// registered and NAMED NOWHERE: invisible to the corpus linkage in both
// directions. This suite closes both holes, with the coverage floor that
// keeps a scan over nothing from proving nothing. Release is
// POST /api/claims/:id/release; there is NO DELETE on this surface, ever.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', 'src');
const COORD_ROUTES = path.join('coord', 'routes.ts');

/** The coordination surface by path prefix. `/api/fleet` is NOT here — it is
 *  server.ts's own read and always was; `/api/feed` and `/api/lifecycle` are
 *  coord.db reads and are. */
const COORD_PREFIXES = ['/api/mail', '/api/runs', '/api/coord', '/api/feed',
  '/api/lifecycle', '/api/peers', '/api/claims', '/api/ledger'];

/** Every Fastify shorthand, all five verbs — a DELETE added tomorrow must be
 *  swept, not silently skipped (auth-gate.test.ts:72's own rule). */
const REG_RE = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

interface Reg { file: string; verb: string; routePath: string }
const registrations = (): Reg[] => {
  const out: Reg[] = [];
  for (const f of walk(SRC).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(REG_RE)) {
      out.push({ file: path.relative(SRC, f), verb: m[1]!, routePath: m[2]! });
    }
  }
  return out;
};

const isCoord = (p: string): boolean => COORD_PREFIXES.some((pre) => p.startsWith(pre));

describe('all coordination routes live in coord/routes.ts (D17)', () => {
  it('no file but coord/routes.ts registers a coordination path', () => {
    const strays = registrations()
      .filter((r) => isCoord(r.routePath) && r.file !== COORD_ROUTES)
      .map((r) => `${r.file}: app.${r.verb}('${r.routePath}')`);
    expect(strays, 'coordinator-skill.test.ts scans coord/routes.ts ONLY — a route here is ' +
      'named nowhere').toEqual([]);
  });

  it('coord/routes.ts registers with get and post ONLY — release is a POST, not a DELETE', () => {
    const verbs = registrations().filter((r) => r.file === COORD_ROUTES).map((r) => r.verb);
    expect(verbs.every((v) => v === 'get' || v === 'post'),
      `the parity scanner's regex knows only get/post; found: ${verbs.join(',')}`).toBe(true);
    // Belt and braces: neither the longhand app.route nor a DELETE on a
    // coordination path anywhere in server/src.
    const src = readFileSync(path.join(SRC, COORD_ROUTES), 'utf8');
    expect(src.includes('app.route(')).toBe(false);
    expect(src.includes("'DELETE'")).toBe(false);
    const deletes = registrations().filter((r) => r.verb === 'delete' && isCoord(r.routePath));
    expect(deletes).toEqual([]);
  });

  it('the scanner-coverage floor: it found the file, and at least the wave-7 route count', () => {
    const coord = registrations().filter((r) => r.file === COORD_ROUTES);
    // 21 = the 14 pre-build-9b registrations + wave 7's seven. A floor, not an
    // exact pin — auth-gate.test.ts:194 owns the exact number — so this suite
    // does not double-edit on every future route, but a scanner that quietly
    // stopped matching SOME registrations still reds here.
    expect(coord.length).toBeGreaterThanOrEqual(21);
    // ...and the specific seven this build added, so the floor cannot be met
    // by the old routes alone:
    const paths = coord.map((r) => `${r.verb.toUpperCase()} ${r.routePath}`);
    for (const r of ['GET /api/peers', 'POST /api/claims', 'POST /api/claims/:id/release',
      'POST /api/claims/:id/break', 'GET /api/claims', 'POST /api/ledger/deviations',
      'GET /api/ledger']) {
      expect(paths, `${r} was not found by the scanner`).toContain(r);
    }
  });
});
```

- [ ] Run, expect PASS: `./node_modules/.bin/vitest run test/coord-routes-single-file.test.ts`.
- [ ] **Mutation ceremony (the stray registration).** In `server/src/server.ts`, add
  `app.post('/api/claims/echo', async () => ({ ok: true }));` anywhere inside `buildServer`.
  Run: expect 1 red (`no file but coord/routes.ts…`). Revert
  (`git checkout -- server/src/server.ts`), green.
- [ ] **Mutation ceremony (the DELETE).** In `server/src/coord/routes.ts`, add
  `app.delete('/api/claims/:id', async () => ({ ok: true }));` at the end of
  `registerCoordRoutes`. Run: expect at least 1 red (`get and post ONLY`). Revert the line,
  green.
- [ ] **Mutation ceremony (the floor).** Comment out the `GET /api/ledger` registration. Run:
  expect the coverage-floor test red (`GET /api/ledger was not found`), and note
  `test/auth-gate.test.ts` and `test/coordinator-skill.test.ts` red too — three independent
  detectors on one deletion is the intended overlap. Revert, green.
- [ ] Commit:

```bash
git add server/test/coord-routes-single-file.test.ts
git commit -m "test(wave7): one file registers the coordination surface, and only get/post may speak it" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 24: `claims-envelope.test.ts` — the deep 409, Wave 0 interplay, auth arms, totality

**Files:**
- Create `server/test/claims-envelope.test.ts`.
- (Ceremony only, no lasting edit): `server/src/coord/routes.ts`, `server/src/coord/store.ts`.

**Interfaces:**
- Consumes: everything Tasks 18-20 produced; Wave 0's `duplicate` / `peer-quota` refusals on
  `POST /api/mail` (`runId === null` only), `PEER_MAIL_MAX_OUTSTANDING`; `hashLine`
  (`auth/secret.ts`) and the real login route for the cookie arm; `CLAIM_REFUSE_CODES`.
- Produces: the cross-cutting suite — the 409-as-address round trip actually POSTS the hint;
  the auth-arm matrix for all three dual/box surfaces; the producer direction of
  `CLAIM_REFUSE_CODES`; and the tsc totality ceremony for the new union→status maps.

**Steps:**

- [ ] Write the test:

```ts
// Wave 7's cross-cutting suite: the 409 envelope is not decoration — this
// file POSTS it. D12's bargain with D10 ("the idle gate is untouched") only
// holds because a loser learns synchronously and is handed an address; Wave
// 0's quotas are what make that address safe to hand out. Plus the auth-arm
// matrix and the ClaimRefuseCode producer direction.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { CLAIM_REFUSE_CODES, PEER_MAIL_MAX_OUTSTANDING } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const UUID_A = 'a'.repeat(36);
const UUID_B = 'b'.repeat(36);
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const A = { byId: 'demo-quiet-mesa', byUuid: UUID_A };
const B = { byId: 'demo-still-pond', byUuid: UUID_B };

const seed = (home: string, id: string, uuid: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: `/w/demo/${id}`, uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const tmuxRunner = (): Runner => async (_cmd, args) => {
  if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
  if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
  if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
  return { code: 1, stdout: '', stderr: '' };
};

const openApp = async (over: Partial<Deps> = {}) => {
  const home = mkTmp('ccrc-envelope-');
  seed(home, A.byId, UUID_A);
  seed(home, B.byId, UUID_B);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home, tmuxRunner()), mailToken: TOKEN, coord, ...over });
  return { app, coord, home };
};

interface Hint { send?: { toId: string; kind: string; subject: string }; escalate?: string }

describe('the 409 is an address, and Wave 0 makes it safe to use', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const conflictHint = async (app: FastifyInstance): Promise<Hint> => {
    const won = await app.inject({ method: 'POST', url: '/api/claims', headers: tok,
      payload: { ...A, project: 'demo', paths: ['shared/api.ts'], intent: 'rewiring' } });
    expect(won.statusCode).toBe(200);
    const lost = await app.inject({ method: 'POST', url: '/api/claims', headers: tok,
      payload: { ...B, project: 'demo', paths: ['shared/api.ts'], intent: 'me too' } });
    expect(lost.statusCode).toBe(409);
    return (lost.json() as { conflicts: { mailHint: Hint }[] }).conflicts[0]!.mailHint;
  };

  it('the hint POSTS as-is (202), and a re-send of the SAME hint is Wave 0\'s duplicate, not spam', async () => {
    const w = await openApp(); app = w.app;
    const hint = await conflictHint(app);
    expect(hint.send).toEqual({ toId: A.byId, kind: 'question',
      subject: 'claim-conflict demo:shared/api.ts' });

    const mail = { fromId: B.byId, fromUuid: UUID_B, toId: hint.send!.toId,
      kind: hint.send!.kind, subject: hint.send!.subject,
      body: 'I need shared/api.ts for the roster wire — how far are you?', artifacts: [] };
    const first = await app.inject({ method: 'POST', url: '/api/mail', headers: tok, payload: mail });
    expect(first.statusCode).toBe(202);

    // Losing the race twice produces the SAME subject — Wave 0's outstanding
    // (fromId,toId,subject) guard answers 409 duplicate. The hint's stable
    // subject is DESIGNED to hit this guard: that is the interplay.
    const again = await app.inject({ method: 'POST', url: '/api/mail', headers: tok, payload: mail });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ ok: false, error: 'duplicate' });
  });

  it('the per-pair outstanding quota still bounds a chatty loser — 429 peer-quota past the cap', async () => {
    const w = await openApp(); app = w.app;
    await conflictHint(app);
    const mail = (subject: string) => ({ fromId: B.byId, fromUuid: UUID_B, toId: A.byId,
      kind: 'question', subject, body: 'x', artifacts: [] });
    for (let i = 0; i < PEER_MAIL_MAX_OUTSTANDING; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/mail', headers: tok,
        payload: mail(`claim-conflict demo:file-${i}`) });
      expect(res.statusCode, `send ${i}`).toBe(202);
    }
    const over = await app.inject({ method: 'POST', url: '/api/mail', headers: tok,
      payload: mail('claim-conflict demo:one-more') });
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ ok: false, error: 'peer-quota' });
  });
});

describe('the auth arms, all three surfaces', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const armedApp = async () => {
    const home = mkTmp('ccrc-envelope-');
    seed(home, A.byId, UUID_A);
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
    const base = testDeps(home, tmuxRunner());
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    return buildServer({ ...base, cfg: { ...base.cfg, authEnabled: true },
      mailToken: TOKEN, coord });
  };

  const login = async (app: FastifyInstance): Promise<string> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login',
      payload: { passphrase: PASSPHRASE } });
    expect(res.statusCode, res.body).toBe(204);
    const set = res.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0]! : String(set);
    return line.slice(0, line.indexOf(';'));
  };

  it.each([
    ['GET', '/api/peers?project=demo'],
    ['GET', '/api/claims?project=demo'],
  ] as const)('%s %s: armed takes EITHER credential, never neither', async (method, url) => {
    app = await armedApp();
    const anon = await app.inject({ method, url });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ verdict: 'no-session' });
    expect((await app.inject({ method, url, headers: tok })).statusCode).toBe(200);
    const cookie = await login(app);
    expect((await app.inject({ method, url, headers: { cookie } })).statusCode).toBe(200);
  });

  it('the box-token lanes refuse anon with a BARE 401 — no verdict, the /api/mail shape', async () => {
    app = await armedApp();
    const res = await app.inject({ method: 'GET', url: '/api/ledger?project=demo' });
    // The session gate exempts it; requireMailToken refuses it. A verdict here
    // would raise the PWA's login screen for a machine lane.
    expect(res.statusCode).toBe(401);
    expect((res.json() as { verdict?: unknown }).verdict).toBeUndefined();
  });

  it('break sits behind the SESSION gate when armed — the operator door is the phone\'s, not the fleet\'s', async () => {
    app = await armedApp();
    const anon = await app.inject({ method: 'POST', url: '/api/claims/1/break', payload: {} });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ verdict: 'no-session' });   // the GATE's refusal
    const cookie = await login(app);
    const opened = await app.inject({ method: 'POST', url: '/api/claims/1/break',
      headers: { cookie }, payload: {} });
    expect(opened.statusCode).toBe(404);   // through the gate; no such claim
  });
});

describe('ClaimRefuseCode, producer direction', () => {
  it('every declared code has a producer in coord/routes.ts (both directions with the scanner)', () => {
    // The scanner in mail-routes.test.ts holds tokens -> declared; this holds
    // declared -> produced, so the union cannot grow a member no route sends.
    const src = readFileSync(path.resolve(here, '..', 'src', 'coord', 'routes.ts'), 'utf8');
    for (const code of CLAIM_REFUSE_CODES) {
      expect(src, `${code} has no producer in coord/routes.ts`).toContain(`'${code}'`);
    }
  });
});
```

- [ ] Run it, expect PASS on a tree where Tasks 18-20 and Wave 0 landed; if the two Wave 0 cases
  FAIL with 202 where 409/429 is expected, STOP — Wave 0's quotas are missing or regressed, and
  this suite has just done its job early (do not weaken the assertions; fix the Wave 0 seam).
  `./node_modules/.bin/vitest run test/claims-envelope.test.ts`
- [ ] **Totality ceremony (the `default: never` guards are compile-time, prove it).** In
  `server/src/coord/store.ts`, add a fourth failure arm to `ClaimEndOutcome`:
  `| { ok: false; kind: 'probe-arm' }`. Run `./node_modules/.bin/tsc --noEmit` from `server/`:
  expect a compile error in `coord/routes.ts` at `sendClaimEndOutcome`'s
  `const _exhaustive: never = r` (TS2322 — the new member is not handled), which is exactly the
  promise: a union member added tomorrow cannot reach a request unmapped. Revert the arm,
  re-run tsc, clean.
- [ ] Same ceremony for the acquire map: add `| { ok: false; kind: 'probe-arm' }` to
  `AcquireClaimsResult`, expect the same TS2322 in the `POST /api/claims` switch's default arm,
  revert, clean.
- [ ] Run the full server suite in the foreground once, `cd server && npm run test`
  (timeout ≥ 600000 ms) — the wave-7 route surface touches auth-gate, coordinator-skill,
  coord-pause, mail-routes and the four new suites, and this is the checkpoint that all of them
  agree. Re-run any of the five known load flakes in isolation before calling a failure real.
- [ ] Commit:

```bash
git add server/test/claims-envelope.test.ts
git commit -m "test(wave7): the 409 round-trips as mail, the quotas answer, and every union arm has a status" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Section handoff — what later sections may rely on

**Routes (all in `server/src/coord/routes.ts`, all get/post):**

| Route | Auth | Success | Typed refusals |
|---|---|---|---|
| `GET /api/peers?project=`\|`?of=` | dual-arm (D-149) | `200 {ok, peers: PeerSummary[], projects: string[], etiquette}` | `400 bad-request`, `404 unknown-session`, `502 registry-unmeasurable`, `401 (+verdict)`, `501` |
| `POST /api/claims` | box token + attribution | `200 {ok, ids, expiresAt, hardExpiresAt, renewed}` | `409 claim-conflict {conflicts: ClaimConflict[]}`, `400 bad-path/bad-request`, `413 oversize`, `404 unknown-run`, `403 unknown-sender/stale-uuid`, `502` |
| `POST /api/claims/:id/release` | box token + attribution | `200 {ok, state:'released'}` | `404 unknown-claim`, `403 not-owner {heldBy}`, `409 claim-terminal {state}` |
| `POST /api/claims/:id/break` | UNGATED (session gate when armed) | `200 {ok, state:'broken'}` | `404`, `409 claim-terminal`; body never read |
| `GET /api/claims?project=&all=1` | dual-arm (D-149) | `200 {ok, claims: ClaimSummary[]}` | `401 (+verdict)`, `501` |
| `POST /api/ledger/deviations` | box token | `201 {ok, numbers, floor}` | `409 not-seeded`, `400`, `401`, `501` |
| `GET /api/ledger?project=` | box token | `200 {ok, floor: number\|null, allocations}` | `400`, `401`, `501` |

**L0 added here (Tasks 18/19):** `CLAIM_REFUSE_CODES` / `ClaimRefuseCode` / `isClaimRefuseCode`
(`['unknown-session','claim-conflict','bad-path','unknown-claim','not-owner','claim-terminal','not-seeded']`),
`CLAIM_PATHS_MAX = 32`, `CLAIM_PATH_MAX_BYTES = 512`, `CLAIM_INTENT_MAX_BYTES = 512`.

**For the wave-8 skills section:** the corpus already names all six public routes as stubs at the
END of `references/wave-lifecycle.md` (section "Build 9 — peers, claims, deviations"); replace or
extend those stubs freely — the parity suite constrains only presence. `POST /api/claims/:id/break`
is in the parity `EXEMPT` set and must stay unnamed. The route-registered `mailHint.send` shape is
`{toId, kind:'question', subject: 'claim-conflict <project>:<path>'}` — clause 11 and
`peer-protocol.md` should teach reading it, and that a duplicate re-send answers 409 by design.

**For the wave-9 PWA section:** `GET /api/claims` (dual-arm) is HotFilesStrip's read;
`PeerSummary.intent`/`claimedPaths` are the session-line signal; both GETs work with a cookie on
an armed box and openly on a dark one.

**Counts after this section** (for any later section touching the route surface):
`coord/routes.ts` registrations 21; `ROUTES` 66 (63 HTTP + 3 WS); `EXEMPT` 24;
`EXEMPT_BUT_AUTHENTICATED` {runs, lifecycle, peers, claims}; parity `EXEMPT` 4; `UNGATED` 3;
armed-sweep `gated` 40.
# Wave 8 — the skills learn the etiquette (AGENT-FIRST) · Wave 9 — the operator surface (pwa)

Tasks 25–29. Wave 8 is FORCED to run after wave 7 by the route-parity suite
(`server/test/coordinator-skill.test.ts:166-175` — a corpus that names `POST /api/claims`
before the route registers is a red suite), and the parity suite's OTHER direction
(registered → named, `:177-207`) is what this wave settles for good: at the end of Task 25
the `EXEMPT` set is exactly four routes and every other registered coordination route is
named in the corpus. Wave 8's files (`ccd/coordinator-skill/**`, `ccd/worker-skill/**`)
are **AGENT-FIRST at deploy**: `bash deploy/deploy.sh agent <fleet-host>` ships them before
`bash deploy/deploy.sh` redeploys the server. Nothing in Tasks 25–27 touches `ccd/ccd`, so
no `markGenerated` re-stamp is involved. Wave 9 (Tasks 28–29) is pwa-only, L4, and makes
**no decisions** — every word comes from a total map over an L0 union, every fact from the
wire, and the two components render themselves or nothing.

Apostrophe discipline, stated once for both skill tasks (spec D17 / D-104):
**coordinator** clause literals are single-quoted in `coordinator-skill.test.ts`, so the
prose uses CURLY apostrophes (`’` — the file already carries three); **worker** clause
literals are double-quoted in `worker-skill.test.ts`, so the prose uses STRAIGHT
apostrophes and **no `"` character anywhere in a clause**. A curly/straight swap is a
different byte and reds the pin without looking like an edit — both Task 25 and Task 26
measure that mutant explicitly.

---

### Task 25: Coordinator clause 10, `references/peer-protocol.md`, and the parity accounting closed

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md` (contract intro at line 52 — "These nine
  sentences"; clause list ends at line 63 with clause 9)
- Create: `ccd/coordinator-skill/references/peer-protocol.md`
- Modify: `server/test/coordinator-skill.test.ts` (`allSkillText` line 33;
  `routeSkillText` line 44; `CONTRACT` lines 72–82; the `carries all nine clauses` test
  line 85; `EXEMPT` lines 184–200; `NOT_A_CALL_REFUSAL` line 264; the address-literal
  `corpus` list lines 720–726; new describe appended at the foot of the file)

**Interfaces:**
- Consumes (wave 7, `server/src/coord/routes.ts` registrations — exact strings the parity
  scanner harvests): `GET /api/peers`, `POST /api/claims`, `POST /api/claims/:id/release`,
  `POST /api/claims/:id/break`, `GET /api/claims`, `POST /api/ledger/deviations`,
  `GET /api/ledger`. Consumes (wave 1, `shared/api.ts`): `MAIL_REJECT_CODES` now including
  `'duplicate'` and `'peer-quota'`.
- Produces: coordinator clause 10 (verbatim, pinned); `references/peer-protocol.md` (the
  D17 long form — Task 26's worker skill points at it); `coordinator-skill.test.ts` with
  `EXEMPT` = exactly `{GET /api/feed, POST /api/coord/pause, POST /api/runs/:id/abandon,
  POST /api/claims/:id/break}` and both corpora (`allSkillText`, `routeSkillText`)
  including `peer-protocol.md`.

**Steps:**

- [ ] **Write the failing test edits first.** In `server/test/coordinator-skill.test.ts`,
  make five edits. (1) Line 33, `allSkillText` gains the new reference:

  ```ts
  const allSkillText = [skill, refs('wave-lifecycle.md'), refs('mail-envelope.md'), refs('peer-protocol.md')].join('\n');
  ```

  (2) Line 44, `routeSkillText` gains it too, with one sentence added to the docstring
  above it (after "…fails the literal-match check no server route can ever satisfy."):

  ```ts
  /** …fails the literal-match check no server route can ever satisfy.
   *  `peer-protocol.md` (Build 9 wave 8) IS in this corpus: its curl shapes
   *  and headings name real registered routes, so both parity directions
   *  cover it — the reference cannot name a ghost route, and the routes it
   *  is the documented home for cannot silently lose their one mention. */
  const routeSkillText = [skill, refs('wave-lifecycle.md'), refs('peer-protocol.md')].join('\n');
  ```

  (3) `CONTRACT` (line 72) gains a tenth entry after clause 9 — single-quoted, CURLY
  apostrophes (`program’s`, `session’s`), and update the comment above the array from
  "The nine clauses, verbatim" to "The ten clauses, verbatim":

  ```ts
    'This session allocates the program’s deviation block once, at run-open — `POST /api/ledger/deviations` — and names the block in every brief; a worker never calls the allocator mid-wave. Before splitting a wave across workers it reads `GET /api/claims?project=<project>`, and a wave that dispatches two workers onto overlapping claims is a defect in this session’s ledger, not in the workers.',
  ```

  (4) The test title at line 85 becomes `'carries all ten clauses verbatim'`. (5) Append
  a new describe at the foot of the file:

  ```ts
  // ── Build 9 wave 8: the peer protocol (spec D9-D13, D17) ───────────────────
  //
  // The FIRST copy of the etiquette rides the route response itself
  // (`PEER_ETIQUETTE`, L0) — D-107's lesson: a skill reaches a config dir only
  // once its installer has run there. This reference is the long form, and
  // these pins hold the parts a coordinator or worker will actually act on:
  // the capture idiom, the 409-as-address reading, and losing a race.
  describe('the peer protocol reference (Build 9 wave 8, D17)', () => {
    const pp = (): string => refs('peer-protocol.md');

    it('teaches the capture idiom and never curl -f', () => {
      // Same rule SKILL.md's own "How to call the API" states: `-f` throws the
      // response body away, and the body is the whole protocol — the 409 this
      // file exists to teach the reading of arrives as a 4xx JSON body.
      expect(pp()).toContain("-w '\\n%{http_code}'");
      expect(pp()).not.toMatch(/curl -f/);
    });

    it('carries no second copy of the token pipeline or the address derivation', () => {
      // Single definition: both live in SKILL.md's "How to call the API" and
      // are pinned there against notify.sh/extractToken. A third copy here is
      // a third thing to rot; the reference points instead.
      expect(pp()).toContain('How to call the API');
      expect(pp()).not.toContain('CCRC_SERVER_URL');
      expect(pp()).not.toContain("grep -v '^[[:space:]]*#'");
    });

    it('reads the 409 as an address — every conflicting path, the intent, the mailHint', () => {
      expect(pp()).toContain('mailHint');
      expect(pp()).toContain('EVERY conflicting path');
      expect(pp()).toMatch(/ADDRESS, not a rejection slip/);
    });

    it('teaches losing a race as the mechanism working, with the uncontested-paths step', () => {
      expect(pp()).toContain('Losing a race is the mechanism working');
      expect(pp()).toMatch(/uncontested/);
      expect(pp()).toContain('Never edit the contested path anyway');
    });

    it('explains the two peer-lane mail codes the census requires', () => {
      // `mentions every declared MailRejectCode` above iterates the L0 list —
      // once wave 1 added `duplicate`/`peer-quota`, THIS file became their
      // documented home (they are peer-lane codes; the coordinator's own mail
      // always carries a runId and never meets either).
      for (const code of ['duplicate', 'peer-quota'] as const) {
        expect((MAIL_REJECT_CODES as readonly string[]).includes(code),
          `${code} should be a declared MailRejectCode since wave 1`).toBe(true);
        expect(pp()).toContain(code);
      }
    });

    it('never names the break door — a door the claimant is not the one to walk through', () => {
      // D16's accounting: `POST /api/claims/:id/break` is EXEMPT (the
      // `/api/runs/:id/abandon` shape) and stays unnamed in EVERY corpus file.
      // EXEMPT alone only permits the omission; this is what FORBIDS the
      // mention.
      expect(allSkillText).not.toContain('/api/claims/:id/break');
    });
  });
  ```

- [ ] **Reconcile the `EXEMPT` set to its final four members.** Wave 7's route tasks kept
  the parity suite green at their own commits (either by naming the new routes in
  `wave-lifecycle.md`, the 9a Task-38 precedent, or by parking bridge entries in
  `EXEMPT` marked `BRIDGE`). Run `grep -n "BRIDGE\|/api/claims\|/api/peers\|/api/ledger"
  server/test/coordinator-skill.test.ts` and make the set read exactly this — the three
  existing entries with their comments untouched, every `BRIDGE`-marked entry DELETED,
  and the one Build 9 entry present:

  ```ts
      'POST /api/coord/pause',
      'POST /api/runs/:id/abandon',
      // BUILD 9 (D16's accounting) — the ONE new route that stays unnamed:
      // `POST /api/claims/:id/break` is the operator's release valve for a
      // claim whose holder is wedged or gone — the `POST /api/runs/:id/abandon`
      // shape exactly: a door the CLAIMANT is not the one to walk through, so
      // neither skill corpus may name it (the peer-protocol describe at the
      // foot of this file pins the negative direction).
      'POST /api/claims/:id/break',
    ]);
  ```

  Also check `NOT_A_CALL_REFUSAL` (line 264): if a wave-1 bridge parked `'duplicate'` or
  `'peer-quota'` there, delete both entries — the census must now find them in
  `peer-protocol.md`, which is the real fix. If the set still reads
  `new Set(['undeliverable'])`, it is already correct; leave it.

- [ ] **Run, expect FAIL.** `cd server && ./node_modules/.bin/vitest run
  test/coordinator-skill.test.ts` (foreground, timeout ≥600000). Expected reds, all from
  the edits above: `refs('peer-protocol.md')` throws `ENOENT` at module load (the file
  does not exist yet) — the whole suite errors, which is the honest red for a corpus file
  that is not there.

- [ ] **Append clause 10 to `ccd/coordinator-skill/SKILL.md`.** Two edits. At line 52,
  change `These nine sentences are the boundary` to `These ten sentences are the
  boundary`. After the clause-9 line (line 63), append (CURLY apostrophes — `program’s`,
  `session’s`):

  ```markdown
  10. This session allocates the program’s deviation block once, at run-open — `POST /api/ledger/deviations` — and names the block in every brief; a worker never calls the allocator mid-wave. Before splitting a wave across workers it reads `GET /api/claims?project=<project>`, and a wave that dispatches two workers onto overlapping claims is a defect in this session’s ledger, not in the workers.
  ```

- [ ] **Write `ccd/coordinator-skill/references/peer-protocol.md`** — complete content
  (note: every `GET /api/…` / `POST /api/…` token in prose below is a registered route,
  spelled fastify-style with `:id`; the curl URLs use shell variables so the harvest
  regex never sees a half-path; the five destructive verbs appear nowhere in this file,
  or the census at `coordinator-skill.test.ts:91-99` reds):

  ```markdown
  # The peer protocol — discovery, claims, the allocator

  The long form of coordinator clause 10 and worker clause 11 (Build 9, spec
  D9–D13, D17). Both skills point here. The FIRST copy of the etiquette rides
  the route response itself: `GET /api/peers` hands back `etiquette` — the five
  `PEER_ETIQUETTE` rules, verbatim — in the same answer as the peer list, so a
  session that can discover peers has the rules whether or not any installer
  ever ran on its home. This file is the commentary, never the only copy.

  Derive `$CCRC_API` and `$TOKEN` exactly as SKILL.md's "How to call the API"
  section does — this file deliberately carries no second copy of either
  derivation. Never `curl -f`/`curl -fsS` against any route below: every
  refusal is a 4xx JSON body, and `-f` throws the body away. Capture status
  and body separately:

      resp=$(curl -sS -w '\n%{http_code}' "$CCRC_API/api/peers?project=$project" \
        -H "x-ccrc-mail-token: $TOKEN")
      code="${resp##*$'\n'}"
      body="${resp%$'\n'*}"

  ## Discovery — `GET /api/peers`

  `GET /api/peers?project=<slug>` or `?of=<your session id>` — exactly one of
  the two. Authenticated by a live PWA cookie OR the box token (the
  `GET /api/runs` dual arm), so it works cookieless from the fleet host.

  What comes back, per peer: `deliverable` — `yes`, or `no:<reason>`, or
  `unknown` (an unmeasurable registry is NOT `no`); `archivedAt` VERBATIM,
  deciding nothing, with `archivedStale` naming the rows where the stamp
  contradicts a live heartbeat — the stamp is silently false on measured live
  rows, and a silently false field must never be laundered into a filter; the
  peer's current `intent`; and `etiquette`, the five rules, in the answer
  itself. `deliverable` reports only the STRUCTURAL rungs — a busy peer is
  still `yes`; it answers its mail when it next idles.

  Read `projects[]` before concluding you are alone. An empty peer list for a
  typo'd project looks exactly like an empty project, and `projects[]` — every
  project measured this pass — is what tells them apart. Concluding "I am
  alone" off a typo and then conflicting is this feature's central failure
  mode.

  ## Claiming — `POST /api/claims`

      resp=$(curl -sS -w '\n%{http_code}' -X POST "$CCRC_API/api/claims" \
        -H "x-ccrc-mail-token: $TOKEN" -H 'content-type: application/json' \
        -d "{\"fromId\":\"$id\",\"fromUuid\":\"$uuid\",\"project\":\"$project\",
      \"paths\":[\"server/src/coord/store.ts\"],
      \"intent\":\"wave 3: store methods for the mirror reads\",
      \"runId\":$runid}")
      code="${resp##*$'\n'}"
      body="${resp%$'\n'*}"

  All-or-nothing: five paths, one conflict, ZERO acquired. Claims are ADVISORY
  — nothing on the box enforces one; what a claim buys is a synchronous answer
  at the moment of asking instead of a merge conflict at the end of the wave.
  Claiming `.` or an empty path is refused `bad-path` — claiming the whole
  repo IS the module wedge. Re-POST the same paths at any moment to renew the
  lease and rewrite `intent` (the intent is what the fleet screen renders, so
  keep it current — a branch name is written once; an intent can be written
  every ten minutes). The lease (`CLAIM_LEASE_MS`, 45 min) renews itself off
  the watcher while the holding session is measured running; the hard cap
  (`CLAIM_HARD_CAP_MS`, 8 h) is never renewed, so a long program re-declares
  its claim rather than holding it forever.

  Release is `POST /api/claims/:id/release` when a claim is done early:

      resp=$(curl -sS -w '\n%{http_code}' -X POST "$CCRC_API/api/claims/$claim/release" \
        -H "x-ccrc-mail-token: $TOKEN" -H 'content-type: application/json' \
        -d "{\"fromId\":\"$id\",\"fromUuid\":\"$uuid\"}")

  A run's close releases that run's claims itself, and a dead session's claims
  lapse inside the lease — so a forgotten release costs minutes, never a
  wedge.

  ## Reading a 409

  The conflict response is an ADDRESS, not a rejection slip. It names EVERY
  conflicting path (never just the first), and carries the holder's identity
  (`heldBy`, `heldByUuid`), the holder's stated `intent`, its `runId`, the
  standing `expiresAt`, the holder's `deliverable`, and a pre-addressed
  `mailHint` — the envelope to send, already filled in. When `deliverable` is
  `no:<reason>`, the hint degrades to "escalate to the operator": never a
  silent send at a peer measured unreachable.

  ## Losing a race gracefully

  Losing a race is the mechanism working — you found out synchronously, awake,
  mid-request, instead of at merge. In order:

  1. Read the holder's `intent`. It may already answer your question.
  2. Work what is uncontested — claim the paths that did NOT conflict as a
     fresh claim of their own, and get on with those.
  3. Mail the holder through `mailHint` when the overlap is real. A good peer
     question is ONE mail that names the file, what you need from it, and what
     you are doing meanwhile — a question the holder can answer with a
     sentence. Peer mail is human-timescale: the idle gate holds it until the
     peer next idles, so send once and do not sit waiting on the reply.
  4. Never edit the contested path anyway. An advisory claim you ignore is a
     merge conflict you scheduled.

  Peer mail is quota'd so the record stays bounded, and both refusals are
  recorded: a second mail with the same subject to the same peer while the
  first is outstanding refuses 409 `duplicate` (change the subject only if it
  is genuinely a new question); more than 3 outstanding to one peer
  (`PEER_MAIL_MAX_OUTSTANDING`), or more than 12 in an hour
  (`PEER_MAIL_HOURLY`), refuses 429 `peer-quota`. Bound the producer, never
  the record.

  ## History — `GET /api/claims`, `GET /api/lifecycle`, `GET /api/ledger`

  `GET /api/claims?project=<slug>` is the live set — the coordinator reads it
  before splitting a wave (clause 10); `all=1` includes ended rows, because
  "held by X until it died" is an answer, which is why a lapsed claim is kept
  and never deleted. `GET /api/lifecycle?session=<id>` is a workspace's past
  tense, and it answers for a workspace that no longer exists — read each
  row's own lifecycle families (`obs`/`dec`/`meas`), never the registry's
  archive stamp, which is measured false on live rows. `GET /api/ledger`
  lists every deviation allocation with its state (`allocated`, `landed`,
  `stale`).

  ## The allocator — `POST /api/ledger/deviations`

      resp=$(curl -sS -w '\n%{http_code}' -X POST "$CCRC_API/api/ledger/deviations" \
        -H "x-ccrc-mail-token: $TOKEN" -H 'content-type: application/json' \
        -d "{\"project\":\"$project\",\"count\":8,\"title\":\"program $slug D-block\"}")

  `201 {numbers, floor}` — a contiguous block, appended to the flat ledger log
  BEFORE the database commits, so on any doubt a number is SKIPPED, never
  reissued (gaps cost nothing; a reissue once cost 394 rewritten D-ref lines
  across 30 files). `409 not-seeded` means the hourly floor sweep has not yet
  measured this project's plans: report it, do not invent. The coordinator
  allocates the program's whole block at run-open (clause 10) and names it in
  the brief, so a wave in flight never calls the allocator at all. A worker
  that finds an unplanned deviation with no server reachable writes
  `D-TBD-<slug>` and reports — the tree's own red suite refuses to let a
  `D-TBD` land, which turns a server outage into a loud mechanical blocker
  instead of a judgement call. Inventing a number is the root cause this
  allocator exists to delete.
  ```

- [ ] **Run, expect PASS.** `cd server && ./node_modules/.bin/vitest run
  test/coordinator-skill.test.ts` — all green, including the pre-existing parity tests:
  `names no route the server does not register` (every route the new corpus names is
  registered by wave 7) and `names every coordinator-domain route the server registers`
  (the six namable new routes are all named; `EXEMPT` covers the seventh).

- [ ] **Mutation 1 — delete the clause.** Remove the clause-10 line from
  `ccd/coordinator-skill/SKILL.md`. Run the suite: expect exactly 1 red
  (`carries all ten clauses verbatim`, "missing contract clause: This session allocates
  the program’s…"). Restore the line.

- [ ] **Mutation 2 — the apostrophe byte.** In SKILL.md's clause 10 replace `program’s`
  with `program's` (straight). Run: expect the same 1 red — a paraphrase fails exactly as
  a deletion does, D-104's constraint measured. Restore.

- [ ] **Mutation 3 — the curl footgun.** In `peer-protocol.md`, change the first shape's
  `curl -sS` to `curl -fsS`. Run: expect 1 red (`teaches the capture idiom and never
  curl -f`). Restore.

- [ ] **Run the neighbours the corpus edit could touch.** `cd server &&
  ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/worker-skill.test.ts
  test/wsaudit.test.ts` — all green, `wsaudit.test.ts` with no edit (its own standing
  assertion).

- [ ] **Commit.**

  ```bash
  git add ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/peer-protocol.md server/test/coordinator-skill.test.ts
  git commit -m "skills(wave8): clause 10 — the coordinator allocates first and reads the claims board

  The parity ledger closes: EXEMPT is exactly four (the break door joins the
  abandon shape), peer-protocol.md joins both corpora, and the two peer-lane
  mail codes get their documented home. Mutants measured: clause deletion 1
  red, straight-apostrophe swap 1 red, curl -f 1 red."
  ```

---

### Task 26: Worker clause 11 — claim before you edit

**Files:**
- Modify: `ccd/worker-skill/SKILL.md` (editing note lines 52–56 — "these ten lines";
  contract intro line 49 — "These ten clauses"; clause list ends at line 67 with
  clause 10; the "How to call the API" opening paragraph lines 85–88)
- Modify: `server/test/worker-skill.test.ts` (`CONTRACT` lines 47–60; the
  `carries all ten clauses` test line 67; the D-103 references loop lines 99–105)

**Interfaces:**
- Consumes: `ccd/coordinator-skill/references/peer-protocol.md` (Task 25 — the pointer
  target must exist before the pointer, and the D-103 loop verifies existence).
- Produces: worker clause 11 (verbatim, pinned); the worker skill's pointer at
  `../ccrc-coordinator/references/peer-protocol.md`; `skillDir` still exactly
  `['SKILL.md']` (no `references/` — re-proven by mutation below, not assumed).

**Steps:**

- [ ] **Write the failing test edits first.** In `server/test/worker-skill.test.ts`:
  (1) `CONTRACT` gains an eleventh entry after clause 10 — DOUBLE-quoted, straight
  apostrophes, no `"` character inside the clause:

  ```ts
    "Claim before you edit: `POST /api/claims` with every path this wave touches, all-or-nothing. A 409 is an answer, not an obstacle — it names the holder, and the holder IS the address: mail them through the response's own `mailHint` instead of editing anyway. Discovery is `GET /api/peers?of=<your id>`, history is `GET /api/lifecycle`, and each row's own lifecycle is what to read — never its archive stamp, which is silently false on some live rows. Peer mail is human-timescale: a busy peer answers when it next idles, so send once and work what is uncontested. Never invent a deviation number — the coordinator allocated this program's block at run-open, and a number you cannot get is `D-TBD-<slug>` plus a report, never a guess.",
  ```

  (2) The test title at line 67 becomes `'carries all eleven clauses verbatim'`, and the
  comment above `CONTRACT` ("The ten clauses, verbatim") becomes "The eleven clauses,
  verbatim". `FORBIDS = CONTRACT[7]` is index-addressed and appending does not shift it —
  leave it alone (that is WHY the spec says "appended at END"). (3) The D-103 loop's
  array (line 99) gains the third reference:

  ```ts
      for (const ref of ['../ccrc-coordinator/references/wave-lifecycle.md',
        '../ccrc-coordinator/references/mail-envelope.md',
        '../ccrc-coordinator/references/peer-protocol.md']) {
  ```

- [ ] **Run, expect FAIL.** `cd server && ./node_modules/.bin/vitest run
  test/worker-skill.test.ts` — 2 reds: `carries all eleven clauses verbatim` (missing
  clause 11) and `carries no references of its own` (the skill points at no
  `../ccrc-coordinator/references/peer-protocol.md`).

- [ ] **Edit `ccd/worker-skill/SKILL.md`.** Four edits, all additive to pinned content.
  (1) Line 49: `These ten clauses are the boundary` → `These eleven clauses are the
  boundary`. (2) Line 53 (inside the D-104 editing note): `these ten lines are pinned
  verbatim` → `these eleven lines are pinned verbatim`. (3) After the clause-10 line
  (line 67), append — straight apostrophes (`response's`, `row's`, `program's`), no `"`:

  ```markdown
  11. Claim before you edit: `POST /api/claims` with every path this wave touches, all-or-nothing. A 409 is an answer, not an obstacle — it names the holder, and the holder IS the address: mail them through the response's own `mailHint` instead of editing anyway. Discovery is `GET /api/peers?of=<your id>`, history is `GET /api/lifecycle`, and each row's own lifecycle is what to read — never its archive stamp, which is silently false on some live rows. Peer mail is human-timescale: a busy peer answers when it next idles, so send once and work what is uncontested. Never invent a deviation number — the coordinator allocated this program's block at run-open, and a number you cannot get is `D-TBD-<slug>` plus a report, never a guess.
  ```

  (4) Replace the "How to call the API" opening paragraph (lines 85–88). Old text:

  ```markdown
  You use exactly two routes plus their reads: `POST /api/mail` to send, and
  `GET /api/mail` / `GET /api/mail/:id` / `POST /api/mail/:id/ack` to read and
  acknowledge. The run routes belong to the coordinator; a worker never advances
  or closes a run.
  ```

  New text:

  ```markdown
  Your mail surface is `POST /api/mail` to send, and `GET /api/mail` /
  `GET /api/mail/:id` / `POST /api/mail/:id/ack` to read and acknowledge.
  Build 9 adds the peer surface clause 11 names — claims, peers, lifecycle —
  whose long form and curl shapes live in
  `../ccrc-coordinator/references/peer-protocol.md`, installed beside the two
  references below. The run routes belong to the coordinator; a worker never
  advances or closes a run.
  ```

- [ ] **Run, expect PASS.** `cd server && ./node_modules/.bin/vitest run
  test/worker-skill.test.ts` — all green, including the destructive-verb census (clause
  11 names none of the five) and the frontmatter shape test (untouched).

- [ ] **Mutation 1 — delete the clause.** Remove the clause-11 line from SKILL.md. Run:
  expect exactly 1 red (`carries all eleven clauses verbatim`). Restore.

- [ ] **Mutation 2 — the apostrophe byte, the other direction.** In SKILL.md's clause 11
  replace `response's` with `response’s` (curly). Run: expect the same 1 red — the
  worker file's constraint is the mirror image of the coordinator's, measured. Restore.

- [ ] **Mutation 3 — the references trap.** `mkdir ccd/worker-skill/references && touch
  ccd/worker-skill/references/x.md`. Run: expect 1 red (`carries no references of its
  own` — `readdirSync(skillDir).sort()` is no longer `['SKILL.md']`). This wave adds a
  reference FILE to the coordinator's tree, so re-proving the worker's no-references pin
  still bites is the point, not ceremony. `rm -r ccd/worker-skill/references`.

- [ ] **Run the pair plus the coordinator suite** (it reads the worker skill for four of
  its own pins): `cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts
  test/coordinator-skill.test.ts` — green.

- [ ] **Commit.**

  ```bash
  git add ccd/worker-skill/SKILL.md server/test/worker-skill.test.ts
  git commit -m "skills(wave8): clause 11 — the worker claims before it edits

  The 409 is the address, discovery is ?of=<your id>, and a number you cannot
  get is D-TBD plus a report. Mutants measured: clause deletion 1 red,
  curly-apostrophe swap 1 red, a planted references/ dir 1 red."
  ```

---

### Task 27: `WORKER_KICKOFF_PREFIX` spends zero new bytes — verified, not edited

**Files:**
- None modified. Verification only: `server/src/coord/dispatch.ts` line 29
  (`WORKER_KICKOFF_PREFIX`), `server/test/coordinator-skill.test.ts` (the
  `derives the stated ceiling from the two constants` describe, lines 567–599),
  `server/test/worker-skill.test.ts` (the kickoff-prefix name pin, lines 254–285).

**Interfaces:**
- Consumes: `WORKER_KICKOFF_PREFIX` exactly as shipped
  (`"Run the ccrc-worker skill — it is your standing protocol; read it before acting on
  anything below.\n\n"`).
- Produces: nothing — a measured zero. Spec D17's own row: standing protocol is
  precisely what the prefix must not carry; its job is to invoke the skill that carries
  it, and every byte added here shrinks EVERY brief forever (the 8090 effective ceiling
  is arithmetic-pinned against `MAIL_BODY_MAX_BYTES` and the prefix's own byte length).

**Steps:**

- [ ] **Assert the prefix is byte-identical to 9a's.** From the repo root:

  ```bash
  git diff origin/main -- server/src/coord/dispatch.ts
  ```

  Expect EMPTY output for the `WORKER_KICKOFF_PREFIX` declaration (wave 7 may have
  touched other parts of `dispatch.ts`; the prefix literal itself must show no hunk). Then
  measure the byte count the ceiling pin derives from:

  ```bash
  grep -A1 'export const WORKER_KICKOFF_PREFIX' server/src/coord/dispatch.ts
  node -e 'console.log(Buffer.byteLength("Run the ccrc-worker skill — it is your standing protocol; read it before acting on anything below.\n\n","utf8"))'
  ```

  Expect `102` — the number `wave-lifecycle.md`'s stated ceiling subtracts.

- [ ] **Run the two arithmetic pins, expect PASS with no edit.** `cd server &&
  ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/worker-skill.test.ts`
  — in particular `derives the stated ceiling from the two constants` (cap = 8192,
  prefix = 102, ceiling = 8090) and `is the name the dispatch kickoff prefix tells every
  worker to run`. Both green with zero diff is this task's entire deliverable — it is the
  D17 table's "Zero bytes" row executed as a checkpoint, and it guards against wave 8's
  most tempting mistake: teaching the new etiquette by growing the prefix.

- [ ] **No commit.** This task produces no diff by design; note the two green suite runs
  in the execution log and move on.

---

### Task 28: `journalWords.ts` and the two typed read fetchers

**Files:**
- Create: `pwa/src/session/journalWords.ts`
- Create: `pwa/test/journal-words.test.ts`
- Modify: `pwa/src/lib/api.ts` (type-import line 5; new fetchers inserted after the
  `feed:` entry at lines 459–462)
- Modify: `pwa/test/api.test.ts` (new describe appended after the existing `api client`
  describe)

**Interfaces:**
- Consumes (L0, `shared/api.ts` — 9a-shipped): `LifecycleAct`, `LIFECYCLE_ACTS`,
  `LC_ACT_UNKNOWN`, `isLifecycleAct`, `LifecycleOutcome`, `LIFECYCLE_OUTCOMES`,
  `isLifecycleOutcome`, `Corroboration`, `corroboration(obsClass, decSurface)`,
  `isActorClass`, `isDecSurface`, `MirroredLifecycleEvent`, `LifecycleQueryResult`.
  Consumes (L0, wave 1 of THIS plan): `ClaimSummary` with the field set
  `{ id: number; project: string; paths: readonly string[]; heldBy: string;
  heldByUuid: string | null; intent: string | null; runId: number | null;
  state: ClaimState; claimedAt: number; expiresAt: number; hardExpiresAt: number;
  endedAt: number | null; endedBy: string | null }` and `ClaimState =
  (typeof CLAIM_STATES)[number]`. Consumes (wave 7 routes): `GET /api/lifecycle`
  answering `LifecycleQueryResult`; `GET /api/claims` answering
  `{ claims: ClaimSummary[] }` (the `{ runs: RunSummary[] }` envelope idiom), `?all=1`
  including ended rows.
- Produces (Task 29 consumes all of these):
  `ACT_WORD: Record<LifecycleAct, string>`,
  `OUTCOME_WORD: Record<LifecycleOutcome, string>`,
  `OUTCOME_GLYPH: Record<LifecycleOutcome, string>`,
  `CORROBORATION_WORD: Record<Corroboration, string>`,
  `actWord(act: string, badact: string | null): string`,
  `outcomeWord(outcome: string): string`, `outcomeGlyph(outcome: string): string`,
  `eventCorroboration(ev: Pick<MirroredLifecycleEvent, 'obs' | 'dec'>): Corroboration`;
  `api.lifecycle(session: string, limit?: number): Promise<LifecycleQueryResult>`;
  `api.claims(opts?: { all?: boolean }): Promise<{ claims: ClaimSummary[] }>`.

**Steps:**

- [ ] **Write the failing word-map test.** Create `pwa/test/journal-words.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest';
  import type { LifecycleDec, LifecycleObs } from '../../shared/api';
  import { LC_ACT_UNKNOWN, LIFECYCLE_ACTS, LIFECYCLE_OUTCOMES } from '../../shared/api';
  import {
    ACT_WORD, OUTCOME_GLYPH, OUTCOME_WORD, actWord, eventCorroboration, outcomeGlyph, outcomeWord,
  } from '../src/session/journalWords';

  const obsWith = (cg: LifecycleObs['cg']): LifecycleObs => ({
    cg, cgraw: '0::/app.slice/x.scope', pid: 100, ppid: 1, pane: null, paneWhy: null,
    tty: null, ssh: null,
  });
  const decWith = (surface: LifecycleDec['surface']): LifecycleDec => ({
    surface, actor: null, reason: null,
  });

  describe('journalWords: total over the L0 vocabulary', () => {
    it('has a non-empty word for every LifecycleAct — a new act cannot render a blank cell', () => {
      // The compile-time guard is Record<LifecycleAct, string> (TS2739 on a
      // missing key under `npm run build`); this is the RUNTIME twin, because
      // vitest transpiles without typechecking and a suite that only the
      // compiler can red is a suite the test runner cannot see fail.
      for (const act of LIFECYCLE_ACTS) {
        expect(ACT_WORD[act], `no word for act ${act}`).toBeTruthy();
      }
    });

    it('has a word AND a glyph for every LifecycleOutcome — no outcome read out of colour alone', () => {
      for (const o of LIFECYCLE_OUTCOMES) {
        expect(OUTCOME_WORD[o], `no word for outcome ${o}`).toBeTruthy();
        expect(OUTCOME_GLYPH[o], `no glyph for outcome ${o}`).toBeTruthy();
      }
    });

    it('renders the degrade with its preserved token, never a blank', () => {
      // D6: a byte we saw and could not model is a different fact from a byte
      // that was never there — so the token travels into the cell.
      expect(actWord(LC_ACT_UNKNOWN, 'frobnicate')).toContain('frobnicate');
      expect(actWord(LC_ACT_UNKNOWN, null)).toBe(ACT_WORD[LC_ACT_UNKNOWN]);
      // A token a NEWER server sends takes the same path as the reader's own
      // degrade — the raw string IS the preserved token then.
      expect(actWord('quarantine', null)).toContain('quarantine');
      expect(outcomeWord('some-future-outcome')).toBe(OUTCOME_WORD.unknown);
      expect(outcomeGlyph('some-future-outcome')).toBe(OUTCOME_GLYPH.unknown);
    });
  });

  describe('journalWords: the corroboration door', () => {
    it('relates obs and dec through the L0 ladder', () => {
      expect(eventCorroboration({ obs: obsWith('pane'), dec: decWith('cli') })).toBe('agrees');
      // The supervisor passes no flags, so any declaration from it disagrees.
      expect(eventCorroboration({ obs: obsWith('supervisor'), dec: decWith('pwa') })).toBe('disagrees');
    });

    it('degrades absence and unmodelled tokens to unmeasured, never to a disagreement', () => {
      expect(eventCorroboration({ obs: null, dec: decWith('cli') })).toBe('unmeasured');
      expect(eventCorroboration({ obs: obsWith('pane'), dec: null })).toBe('unmeasured');
      // corroboration()'s own contract: args are NARROWED, never cast — a
      // value that passes neither guard is dropped, not reported as a lie.
      expect(eventCorroboration({ obs: obsWith('fifth-shape' as never), dec: decWith('cli') }))
        .toBe('unmeasured');
    });
  });
  ```

- [ ] **Run, expect FAIL.** `cd pwa && ./node_modules/.bin/vitest run
  test/journal-words.test.ts` — module-load error: `../src/session/journalWords` does not
  exist.

- [ ] **Write `pwa/src/session/journalWords.ts`:**

  ```ts
  // The journal's rendering vocabulary — the PWA word for each LifecycleAct
  // and LifecycleOutcome, plus the one sanctioned door into `corroboration()`
  // for a row that arrived over JSON. Same shape as lifecycleWords.ts's
  // QUALIFIER and coordWords.ts's MARKER_WORD: each table is TOTAL over its
  // union (a member added in shared/api.ts is a TS2739 here before it is a
  // blank cell anywhere — `npm run build` runs tsc; journal-words.test.ts
  // carries the runtime twin), and every door tolerates a token this build was
  // never compiled to know.
  //
  // `LIFECYCLE_ACT_MAP` itself is module-private in shared/api.ts on purpose
  // (its docstring: only the derived list and the guard are exported). These
  // tables CONSUME that map through the type it derives — `Record<LifecycleAct,
  // string>` is checked against the same union, so the two cannot drift without
  // a compile error — and narrow raw strings only through `isLifecycleAct` /
  // `isLifecycleOutcome`, never by indexing.
  import type {
    Corroboration, LifecycleAct, LifecycleOutcome, MirroredLifecycleEvent,
  } from '../../../shared/api';
  import {
    LC_ACT_UNKNOWN, corroboration, isActorClass, isDecSurface, isLifecycleAct,
    isLifecycleOutcome,
  } from '../../../shared/api';

  /** The operator's word for each act. `unknown`'s cell is the no-token
   *  fallback only — `actWord` below prefers the preserved `badact` — but the
   *  key must exist or the record stops being total, which is the guard. */
  export const ACT_WORD: Record<LifecycleAct, string> = {
    create: 'created', claim: 'claimed', purge: 'registry row purged',
    supervise: 'supervised', unsupervise: 'unsupervised', destroy: 'destroyed',
    rename: 'branch renamed', hold: 'held', release: 'released',
    archive: 'archived', restore: 'restored', 'attic-drop': 'attic refs dropped',
    reap: 'reaped', gc: 'gc pass', spawn: 'respawned', start: 'started',
    ensure: 'ensured', swap: 'account swapped', enable: 'enabled',
    stop: 'stopped', forget: 'forgotten',
    unknown: 'unmodelled act',
  };

  export const OUTCOME_WORD: Record<LifecycleOutcome, string> = {
    intent: 'intent', done: 'done', refused: 'refused', failed: 'failed',
    unknown: 'unmodelled outcome',
  };

  /** Two cues, word and glyph — RUN_WORD/RUN_GLYPH's discipline (runWords.ts):
   *  no outcome is read out of colour alone. */
  export const OUTCOME_GLYPH: Record<LifecycleOutcome, string> = {
    intent: '→', done: '✓', refused: '⊘', failed: '✗', unknown: '?',
  };

  export const CORROBORATION_WORD: Record<Corroboration, string> = {
    agrees: 'agrees', disagrees: 'disagrees',
    'not-comparable': 'not comparable', unmeasured: 'unmeasured',
  };

  /** The act's word, with the degrade rendered honestly: an `unknown` act
   *  keeps its preserved token (`badact`), and a token a NEWER server sends
   *  that this build's union has never heard of takes the same path — "a byte
   *  we saw and could not model is a different fact from a byte that was never
   *  there" (D6). */
  export function actWord(act: string, badact: string | null): string {
    if (isLifecycleAct(act) && act !== LC_ACT_UNKNOWN) return ACT_WORD[act];
    const token = badact ?? (isLifecycleAct(act) ? null : act);
    return token === null || token === ''
      ? ACT_WORD[LC_ACT_UNKNOWN]
      : `unmodelled act: ${token}`;
  }

  export function outcomeWord(outcome: string): string {
    return isLifecycleOutcome(outcome) ? OUTCOME_WORD[outcome] : OUTCOME_WORD.unknown;
  }

  export function outcomeGlyph(outcome: string): string {
    return isLifecycleOutcome(outcome) ? OUTCOME_GLYPH[outcome] : OUTCOME_GLYPH.unknown;
  }

  /** The one door into `corroboration()` for a row off the wire. The response
   *  is `getJson`-cast, not revived, so both fields reach this as raw strings
   *  wearing their types — `corroboration()`'s own contract is that arguments
   *  are NARROWED through `isActorClass`/`isDecSurface`, never cast, and a
   *  value that passes neither guard is a value this build cannot model, which
   *  degrades to the unmeasured rung rather than being reported as a lie. */
  export function eventCorroboration(
    ev: Pick<MirroredLifecycleEvent, 'obs' | 'dec'>,
  ): Corroboration {
    const cgRaw: unknown = ev.obs?.cg ?? null;
    const surfaceRaw: unknown = ev.dec?.surface ?? 'none';
    return corroboration(
      isActorClass(cgRaw) ? cgRaw : null,
      isDecSurface(surfaceRaw) ? surfaceRaw : 'none',
    );
  }
  ```

- [ ] **Run, expect PASS.** `cd pwa && ./node_modules/.bin/vitest run
  test/journal-words.test.ts`.

- [ ] **Mutation — the totality twin.** Delete the line `reap: 'reaped',` from
  `ACT_WORD`. Run the suite: expect 1 red (`no word for act reap`) — the runtime twin
  fires where the transpiler would not. Then run `cd pwa && npx tsc --noEmit
  2>&1 | head -5`: expect a TS2739 naming `reap` — both guards measured. Restore the
  line.

- [ ] **Write the failing fetcher tests.** Append to `pwa/test/api.test.ts` (after the
  `api client` describe's closing brace; `jsonResponse` and the imports at the top of the
  file are already in scope — extend the import line with nothing, the new tests use
  `createApi` and `vi` which are already imported):

  ```ts
  describe('the Build 9 read fetchers', () => {
    it('lifecycle GETs /api/lifecycle with the session encoded and limit only when given', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { events: [], gaps: [] }));
      const api = createApi(fetchImpl as unknown as typeof fetch);
      await api.lifecycle('claude:a b');
      expect(fetchImpl.mock.calls[0]![0]).toBe('/api/lifecycle?session=claude%3Aa%20b');
      await api.lifecycle('x', 50);
      expect(fetchImpl.mock.calls[1]![0]).toBe('/api/lifecycle?session=x&limit=50');
    });

    it('claims GETs the live set by default and ?all=1 only on request', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { claims: [] }));
      const api = createApi(fetchImpl as unknown as typeof fetch);
      await api.claims();
      expect(fetchImpl.mock.calls[0]![0]).toBe('/api/claims');
      await api.claims({ all: true });
      expect(fetchImpl.mock.calls[1]![0]).toBe('/api/claims?all=1');
      // `all: false` and an absent opts send the byte-identical request — the
      // `archive({force})` rule one screen over.
      await api.claims({ all: false });
      expect(fetchImpl.mock.calls[2]![0]).toBe('/api/claims');
    });
  });
  ```

- [ ] **Run, expect FAIL.** `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts` —
  2 reds: `api.lifecycle is not a function`, `api.claims is not a function`.

- [ ] **Add the fetchers to `pwa/src/lib/api.ts`.** Extend the type-import on line 5 with
  `ClaimSummary` and `LifecycleQueryResult` (alphabetical position in the existing list):

  ```ts
  import type { AccountsResponse, CatchUp, ClaimSummary, FleetHealth, FleetSession, LifecycleQueryResult, LoginRequest, NotifyEvent, PasskeyAssertFinish, PasskeyAssertStart, PasskeyListResponse, PasskeyRegisterFinish, PasskeyRegisterStart, PrView, ReapResult, RunSummary, SlashCommand, StagedClip, WsAudit } from '../../../shared/api';
  ```

  Then insert after the `feed:` entry (line 462), before `interrupt:`:

  ```ts
      /** `GET /api/lifecycle?session=<id>` — one session's past tense from the
       *  provenance mirror, oldest-first, `gaps` riding in the same answer (a
       *  timeline with a hole in it must say so, not hide it in a second call
       *  nobody makes). Cookie-authenticated from here; the same route takes
       *  the box token for a cookieless worker (Build 9 D16) — nothing this
       *  client needs to know about. */
      lifecycle: (session: string, limit?: number): Promise<LifecycleQueryResult> =>
        getJson<LifecycleQueryResult>(
          `/api/lifecycle?session=${encodeURIComponent(session)}` +
            (limit === undefined ? '' : `&limit=${limit}`)),
      /** `GET /api/claims` — the fleet's hot-file claims (Build 9 D12:
       *  ADVISORY, never enforcing — this client renders them and offers no
       *  way to release or break one; release is the holding session's own
       *  door, and the break door is the operator's, deliberately unnamed).
       *  `all` includes ended rows — "held by X until it died" is an answer,
       *  which is why a lapsed claim is a row and not a deletion. */
      claims: (opts?: { all?: boolean }): Promise<{ claims: ClaimSummary[] }> =>
        getJson<{ claims: ClaimSummary[] }>(
          opts?.all === true ? '/api/claims?all=1' : '/api/claims'),
  ```

- [ ] **Run, expect PASS.** `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts
  test/journal-words.test.ts`.

- [ ] **Commit.**

  ```bash
  git add pwa/src/session/journalWords.ts pwa/test/journal-words.test.ts pwa/src/lib/api.ts pwa/test/api.test.ts
  git commit -m "pwa(wave9): journal words and the two read fetchers

  Total tables over the L0 unions with runtime twins (vitest cannot see a
  TS2739), the degrade keeps its preserved token, and the corroboration door
  narrows — never casts. Mutant measured: a deleted ACT_WORD key is 1 red in
  the suite and a TS2739 in the build."
  ```

---

### Task 29: `HistoryTab` and `HotFilesStrip` — the operator surface

**Files:**
- Create: `pwa/src/session/HistoryTab.tsx`
- Create: `pwa/test/history-tab.test.tsx`
- Create: `pwa/src/fleet/HotFilesStrip.tsx`
- Create: `pwa/test/hot-files-strip.test.tsx`
- Modify: `pwa/src/session/SessionHeader.tsx` (props interface lines 39–45; the overflow
  menu list lines 329–343 — insert between "Change effort" and "Move to another account")
- Modify: `pwa/src/screens/SessionScreen.tsx` (imports lines 21–29; sheet state around
  line 84; header props around line 251; mounts near line 428)
- Modify: `pwa/src/screens/FleetScreen.tsx` (imports lines 10–23; mount directly after
  the `fleet-runs-row` button, line 342)
- Modify: `pwa/src/session/chat.css` (append at end of file)
- Modify: `pwa/src/fleet/fleet.css` (append at end of file)

**Interfaces:**
- Consumes: everything Task 28 Produces; `Sheet` (`pwa/src/components/Sheet.tsx`);
  `lcRefusalWord` (L0, 9a-shipped); `useNow` (`pwa/src/lib/useNow.ts`); the tokens
  `--status-attention-text`/`--status-attention-tint`/`--status-dead-text`,
  `--font-mono`, `--text-xs`, `--sp-*`, `--r-sm`, `--edge-subtle` (all present in
  `pwa/src/styles/tokens.css`).
- Produces: `HistoryTab({ id, open, onClose })` mounted off the session header's
  overflow menu; `HotFilesStrip()` (self-polling, `CLAIMS_POLL_MS = 30_000`) mounted on
  the fleet screen; `SessionHeaderProps` gains `onOpenHistory: () => void`.

**Steps:**

- [ ] **Write the failing HistoryTab test.** Create `pwa/test/history-tab.test.tsx`:

  ```tsx
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
  import type { LifecycleGap, LifecycleQueryResult, MirroredLifecycleEvent } from '../../shared/api';
  import { HistoryTab } from '../src/session/HistoryTab';
  import { SessionScreen } from '../src/screens/SessionScreen';
  import { createSessionStore } from '../src/stores/session';
  import { api } from '../src/lib/api';

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  const T0 = 1_755_000_000_000;

  const ev = (over: Partial<MirroredLifecycleEvent> = {}): MirroredLifecycleEvent => ({
    uid: '1755000000000000000.100.1', at: T0, act: 'archive', badact: null,
    outcome: 'done', badoutcome: null, id: 'demo-quiet-basin', tx: null,
    verb: 'ws-archive', refusal: null, detail: null, truncated: false,
    obs: {
      cg: 'pane', cgraw: '0::/app.slice/tmux-spawn-x.scope', pid: 100, ppid: 1,
      pane: 'cc-demo-quiet-basin', paneWhy: null, tty: true, ssh: null,
    },
    dec: { surface: 'cli', actor: 'the operator', reason: 'merged:#42' },
    meas: null, raw: '{}', gen: '1755000000000000000', ingestedAt: T0 + 500,
    ...over,
  });

  const gap = (over: Partial<LifecycleGap> = {}): LifecycleGap => ({
    at: T0 + 60_000, gen: '1755000000000000000', reason: 'shrank',
    detail: 'generation shrank below its cursor; re-read from 0', lostFrom: null, lostTo: null,
    ...over,
  });

  const stub = (r: LifecycleQueryResult) => vi.spyOn(api, 'lifecycle').mockResolvedValue(r);

  describe('HistoryTab', () => {
    it('fetches on open and not while closed', async () => {
      const spy = stub({ events: [ev()], gaps: [] });
      const { rerender } = render(<HistoryTab id="demo-quiet-basin" open={false} onClose={() => {}} />);
      expect(spy).not.toHaveBeenCalled();
      rerender(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
      await waitFor(() => expect(spy).toHaveBeenCalledWith('demo-quiet-basin'));
    });

    it('renders obs and dec side by side in ONE row — two families, never a merged who (R3)', async () => {
      stub({ events: [ev()], gaps: [] });
      const { baseElement } = render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
      await waitFor(() => expect(baseElement.querySelector('.history-row')).not.toBeNull());
      const row = baseElement.querySelector('.history-row')!;
      expect(row.querySelector('.history-obs')!.textContent).toContain('observed: pane');
      expect(row.querySelector('.history-dec')!.textContent)
        .toContain('declared: cli · the operator — merged:#42');
      // The declared reason renders VERBATIM — attribution, not authentication.
    });

    it('gives disagrees its own colour hook', async () => {
      // The supervisor passes no flags, so a `pwa` declaration from it is the
      // real disagreement shape (shared/api.ts's DEC_CORROBORATES).
      stub({
        events: [ev({
          obs: { cg: 'supervisor', cgraw: '0::/app.slice/claude-session@x.service', pid: 1, ppid: 1, pane: null, paneWhy: null, tty: false, ssh: null },
          dec: { surface: 'pwa', actor: null, reason: null },
        })],
        gaps: [],
      });
      const { baseElement } = render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
      await waitFor(() =>
        expect(baseElement.querySelector('.history-corr[data-corr="disagrees"]')).not.toBeNull());
    });

    it('renders a gap as a hole in the timeline, not silence (D6)', async () => {
      stub({ events: [ev()], gaps: [gap()] });
      const { baseElement } = render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
      await waitFor(() => expect(baseElement.querySelector('.history-row--gap')).not.toBeNull());
      expect(baseElement.querySelector('.history-gap')!.textContent).toContain('shrank');
    });

    it('renders an unmodelled act with its preserved token, never a blank cell', async () => {
      stub({ events: [ev({ act: 'unknown', badact: 'quarantine' })], gaps: [] });
      const { baseElement } = render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
      await waitFor(() =>
        expect(baseElement.querySelector('.history-act')!.textContent).toContain('quarantine'));
    });

    it('says the honest thing for an empty answer', async () => {
      stub({ events: [], gaps: [] });
      render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
      await waitFor(() => expect(screen.getByText(/no journal rows/i)).toBeInTheDocument());
      expect(screen.getByText(/predates the lifecycle journal/i)).toBeInTheDocument();
    });

    it('names a failed read instead of rendering a confident empty timeline', async () => {
      vi.spyOn(api, 'lifecycle').mockRejectedValue(new Error('not-configured'));
      render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
      await waitFor(() =>
        expect(screen.getByText(/couldn't read the journal/i)).toBeInTheDocument());
      expect(screen.queryByText(/no journal rows/i)).toBeNull();
    });
  });

  describe('SessionScreen opens the history from the header overflow', () => {
    it('the History menu item mounts the tab and it fetches this session', async () => {
      const spy = stub({ events: [], gaps: [] });
      const store = createSessionStore('claude:demo', {
        makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close() {} }) as unknown as WebSocket,
        api: { prompt: async () => {} },
      });
      act(() => {
        store.getState().apply({ type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t.jsonl', missing: false });
      });
      render(<SessionScreen id="claude:demo" store={store} />);
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      fireEvent.click(await screen.findByText('History'));
      await waitFor(() => expect(spy).toHaveBeenCalledWith('claude:demo'));
    });
  });
  ```

- [ ] **Run, expect FAIL.** `cd pwa && ./node_modules/.bin/vitest run
  test/history-tab.test.tsx` — module-load error: `../src/session/HistoryTab` does not
  exist.

- [ ] **Write `pwa/src/session/HistoryTab.tsx`:**

  ```tsx
  // HistoryTab — one session's past tense (Build 9 spec §2 pwa): the
  // provenance journal's rows for this session, oldest-first, in a sheet off
  // the header's overflow menu. `obs` and `dec` render SIDE BY SIDE and are
  // never merged into a "who" (operator ruling R3 — nothing computes one);
  // journalWords' one door relates them, and a `disagrees` wears its own
  // colour (`data-corr`, chat.css) — a fact the operator sees, never a
  // silently picked winner. Gaps ride in the same answer and render as holes
  // in the timeline, not as silence (D6).
  //
  // NO DECISIONS (the pwa wave is L4): every word comes from journalWords/L0,
  // every fact from the wire, and this component's own logic is fetch-on-open
  // plus an interleave sort. It re-fetches each time it opens — history grows
  // while the sheet is closed, and a stale timeline defeats the point.
  import { useEffect, useState } from 'react';
  import type { ReactNode } from 'react';
  import type { LifecycleGap, LifecycleQueryResult, MirroredLifecycleEvent } from '../../../shared/api';
  import { lcRefusalWord } from '../../../shared/api';
  import { Sheet } from '../components/Sheet';
  import { api, apiErrorText } from '../lib/api';
  import { CORROBORATION_WORD, actWord, eventCorroboration, outcomeGlyph, outcomeWord } from './journalWords';
  import './chat.css';

  /** '14:05 · 12 Aug' — an ABSOLUTE stamp: a timeline is read as a record, and
   *  "3d ago" on row after row defeats ordering at a glance. `null` = the line
   *  carried no readable time (never 0, which is a date, not an absence). */
  function when(at: number | null): string {
    if (at === null) return '—';
    const d = new Date(at);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())} · ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
  }

  function EventRow({ ev }: { ev: MirroredLifecycleEvent }): ReactNode {
    const corr = eventCorroboration(ev);
    return (
      <li className="history-row" data-outcome={ev.outcome}>
        <span className="history-when">{when(ev.at)}</span>
        <span className="history-act">
          {actWord(ev.act, ev.badact)}
          {ev.verb !== null && <span className="history-verb"> · {ev.verb}</span>}
        </span>
        <span className="history-outcome">{outcomeGlyph(ev.outcome)} {outcomeWord(ev.outcome)}</span>
        {/* The two identity families, side by side, never merged (R3). Declared
            values render VERBATIM — attribution, not authentication, the same
            rule lifecycleWords applies to the stop stamp's surface. */}
        <span className="history-obs">
          {ev.obs === null
            ? 'observed: nothing'
            : `observed: ${ev.obs.cg ?? 'unclassified'}${ev.obs.pane !== null ? ` · pane ${ev.obs.pane}` : ''}`}
        </span>
        <span className="history-dec">
          {ev.dec === null
            ? 'declared: nothing'
            : `declared: ${ev.dec.surface}${ev.dec.actor !== null ? ` · ${ev.dec.actor}` : ''}${ev.dec.reason !== null ? ` — ${ev.dec.reason}` : ''}`}
        </span>
        <span className="history-corr" data-corr={corr}>{CORROBORATION_WORD[corr]}</span>
        {ev.refusal !== null && (
          // Journal-only tokens get their sentence from LC_REFUSAL_WORD (L0);
          // a token from wsaudit's family has no L0 word here and renders as
          // itself — a maintainer's grep target, still better than silence.
          <span className="history-refusal">{lcRefusalWord(ev.refusal) ?? ev.refusal}</span>
        )}
      </li>
    );
  }

  function GapRow({ gap }: { gap: LifecycleGap }): ReactNode {
    return (
      <li className="history-row history-row--gap">
        <span className="history-when">{when(gap.at)}</span>
        <span className="history-gap">a hole in the record — {gap.reason}: {gap.detail}</span>
      </li>
    );
  }

  export function HistoryTab({ id, open, onClose }: {
    id: string; open: boolean; onClose: () => void;
  }): ReactNode {
    const [result, setResult] = useState<LifecycleQueryResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      if (!open) return undefined;
      let live = true;
      setError(null);
      api.lifecycle(id)
        .then((r) => { if (live) setResult(r); })
        .catch((err: unknown) => { if (live) setError(apiErrorText(err)); });
      return () => { live = false; };
    }, [open, id]);

    let bodyNode: ReactNode;
    if (error !== null) {
      // An unmeasured absence is not an empty history — SessionScreen's own
      // searchComplete rule, applied to the journal.
      bodyNode = <p className="history-error" role="status">Couldn't read the journal — {error}</p>;
    } else if (result === null) {
      bodyNode = <p className="history-loading" role="status">Reading the journal…</p>;
    } else if (result.events.length === 0 && result.gaps.length === 0) {
      bodyNode = (
        <p className="history-empty">
          No journal rows for this session — nothing recorded yet, or this box's ccd
          predates the lifecycle journal.
        </p>
      );
    } else {
      // Events and gaps interleave on their own timestamps; a row with no
      // readable time sinks to the end rather than pretending to be first.
      const items: Array<{ at: number; node: ReactNode }> = [
        ...result.events.map((e, i) => ({
          at: e.at ?? Number.MAX_SAFE_INTEGER,
          node: <EventRow key={`e-${e.uid ?? i}`} ev={e} />,
        })),
        ...result.gaps.map((g, i) => ({
          at: g.at, node: <GapRow key={`g-${i}`} gap={g} />,
        })),
      ];
      items.sort((a, b) => a.at - b.at);
      bodyNode = <ol className="history-rows">{items.map((x) => x.node)}</ol>;
    }

    return (
      <Sheet open={open} onClose={onClose} eyebrow="history" title="What happened here">
        {bodyNode}
      </Sheet>
    );
  }
  ```

- [ ] **Wire the header and the screen.** In `pwa/src/session/SessionHeader.tsx`:
  (1) `SessionHeaderProps` gains, after `onStopSession` (line 42):

  ```ts
    /** Overflow menu: "History" — opens the lifecycle journal tab. */
    onOpenHistory: () => void;
  ```

  (2) Destructure `onOpenHistory,` in the component parameters (after `onStopSession,`,
  line 87). (3) In the overflow menu, insert after the "Change effort" button (line 341)
  and before "Move to another account":

  ```tsx
            <button type="button" className="menu-item" onClick={() => menuAct(onOpenHistory)}>
              <span className="menu-label">History</span>
              <span className="menu-hint" aria-hidden="true">
                journal
              </span>
            </button>
  ```

  In `pwa/src/screens/SessionScreen.tsx`: (1) import after the `SessionHeader` import
  (line 27): `import { HistoryTab } from '../session/HistoryTab';` (2) state beside
  `reapOpen` (line 87): `const [historyOpen, setHistoryOpen] = useState(false);`
  (3) `SessionHeader` gains the prop (after `onStopSession=...`, line 262):
  `onOpenHistory={() => setHistoryOpen(true)}` (4) mount beside `TerminalDrawer`
  (line 428):

  ```tsx
        <HistoryTab id={id} open={historyOpen} onClose={() => setHistoryOpen(false)} />
  ```

- [ ] **Add the history CSS.** Append to `pwa/src/session/chat.css`:

  ```css
  /* ── HistoryTab (Build 9 wave 9) ─────────────────────────────────────────
     The journal timeline. The two identity families sit SIDE BY SIDE (R3) —
     two spans in one row, never merged into a "who". */
  .history-rows { list-style: none; margin: 0; padding: 0; }
  .history-row {
    display: flex; flex-wrap: wrap; gap: var(--sp-2);
    padding: var(--sp-2) 0; border-top: 1px solid var(--edge-subtle);
  }
  .history-when { color: var(--ink-tertiary); font-variant-numeric: tabular-nums; font-size: var(--text-xs); }
  .history-act { color: var(--ink-primary); }
  .history-verb { color: var(--ink-tertiary); }
  .history-outcome { color: var(--ink-secondary); font-size: var(--text-xs); }
  .history-obs, .history-dec { flex-basis: 47%; color: var(--ink-secondary); font-family: var(--font-mono); font-size: var(--text-xs); }
  .history-corr { color: var(--ink-tertiary); font-size: var(--text-xs); border-radius: var(--r-sm); padding: 0 var(--sp-1); }
  /* `disagrees` in its own colour (spec §2) — the attention pair, because a
     provenance mismatch is a fact for a human to read, not an error state. */
  .history-corr[data-corr='disagrees'] { color: var(--status-attention-text); background: var(--status-attention-tint); }
  .history-refusal { flex-basis: 100%; color: var(--status-dead-text); font-size: var(--text-xs); }
  .history-row--gap, .history-gap { color: var(--status-dead-text); font-size: var(--text-xs); }
  .history-loading, .history-empty, .history-error { color: var(--ink-secondary); padding: var(--sp-3) 0; }
  ```

- [ ] **Run, expect PASS.** `cd pwa && ./node_modules/.bin/vitest run
  test/history-tab.test.tsx`.

- [ ] **Mutation — the colour hook.** In `HistoryTab.tsx`, remove `data-corr={corr}` from
  the `.history-corr` span. Run: expect 1 red (`gives disagrees its own colour hook`).
  Restore.

- [ ] **Commit the history half.**

  ```bash
  git add pwa/src/session/HistoryTab.tsx pwa/test/history-tab.test.tsx pwa/src/session/SessionHeader.tsx pwa/src/screens/SessionScreen.tsx pwa/src/session/chat.css
  git commit -m "pwa(wave9): HistoryTab — obs and dec side by side, disagrees in its own colour

  One session's past tense off the header overflow: absolute stamps, gaps as
  holes not silence, the degrade keeps its token, and a failed read never
  renders a confident empty timeline. Mutant measured: dropping data-corr is
  1 red."
  ```

- [ ] **Write the failing HotFilesStrip test.** Create `pwa/test/hot-files-strip.test.tsx`:

  ```tsx
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
  import type { ClaimSummary } from '../../shared/api';
  import { HotFilesStrip } from '../src/fleet/HotFilesStrip';
  import { api } from '../src/lib/api';

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  const T0 = Date.now();

  const claim = (over: Partial<ClaimSummary> = {}): ClaimSummary => ({
    id: 1, project: 'ccrc-pwa', paths: ['shared/api.ts'], heldBy: 'ccrc-pwa-clear-cove',
    heldByUuid: null, intent: 'wave 2: the L0 vocabulary slice', runId: 3, state: 'live',
    claimedAt: T0 - 5 * 60_000, expiresAt: T0 + 40 * 60_000, hardExpiresAt: T0 + 8 * 3_600_000,
    endedAt: null, endedBy: null, ...over,
  });

  const stub = (claims: ClaimSummary[]) =>
    vi.spyOn(api, 'claims').mockResolvedValue({ claims });

  describe('HotFilesStrip', () => {
    it('renders NOTHING when no claim is live — a fleet not running a program pays no row', async () => {
      const spy = stub([]);
      const { container } = render(<HotFilesStrip />);
      await waitFor(() => expect(spy).toHaveBeenCalled());
      expect(container).toBeEmptyDOMElement();
    });

    it('collapses to a count and expands to holder, intent and paths', async () => {
      stub([claim(), claim({ id: 2, paths: ['ccd/ccd'], intent: null, heldBy: 'ccrc-pwa-still-water' })]);
      render(<HotFilesStrip />);
      await waitFor(() => expect(screen.getByText('2 hot-file claims')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      expect(screen.getByText('ccrc-pwa-clear-cove')).toBeInTheDocument();
      // Intent is free text off the wire — rendered VERBATIM, parsed nowhere.
      expect(screen.getByText('wave 2: the L0 vocabulary slice')).toBeInTheDocument();
      expect(screen.getByText('ccrc-pwa/shared/api.ts')).toBeInTheDocument();
      expect(screen.getByText(/expires in/)).toBeInTheDocument();
    });

    it('shows only LIVE claims — a lapsed row and a future state token both stay off the fleet screen', async () => {
      stub([
        claim(),
        claim({ id: 2, state: 'lapsed', endedAt: T0 - 60_000, endedBy: 'session-gone' }),
        // A state a newer server mints: not live, therefore not rendered —
        // and, load-bearing: not a crash either.
        claim({ id: 3, state: 'quarantined' as ClaimSummary['state'] }),
      ]);
      render(<HotFilesStrip />);
      await waitFor(() => expect(screen.getByText('1 hot-file claim')).toBeInTheDocument());
    });

    it('offers no way to release or break a claim — claims are advisory and this strip is read-only (D12)', async () => {
      stub([claim()]);
      render(<HotFilesStrip />);
      await waitFor(() => expect(screen.getByText('1 hot-file claim')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      for (const b of screen.getAllByRole('button')) {
        expect(b.getAttribute('aria-label') ?? b.textContent ?? '').not.toMatch(/release|break/i);
      }
    });
  });
  ```

- [ ] **Run, expect FAIL.** `cd pwa && ./node_modules/.bin/vitest run
  test/hot-files-strip.test.tsx` — module-load error: `../src/fleet/HotFilesStrip` does
  not exist.

- [ ] **Write `pwa/src/fleet/HotFilesStrip.tsx`:**

  ```tsx
  // Hot files — the fleet's ACTIVE claims, each with its holder's stated
  // intent (Build 9 D12 ruling 3: the naming sweep freezes a held workspace's
  // ai-title, so `intent` is the REPLACEMENT signal — a branch name is written
  // once; an intent can be written every ten minutes). MailStrip's shape:
  // collapsed to one headline, expanding to rows, rendering NOTHING when no
  // claim is live — a fleet not running a program must not pay a row for it.
  // AccountsStrip's poll idiom: this strip owns its own GET /api/claims
  // cadence rather than coupling to a store no frame feeds — claims ship no
  // WS frame (the wire is additive-only and a 30 s poll is plenty for a
  // 45-minute lease).
  //
  // READ-ONLY BY DESIGN: no release, no break. Release is the holding
  // SESSION's own door, and the break door is the operator's, deliberately
  // unnamed everywhere — a strip that could break a claim from a phone tap
  // would be an enforcement surface for a mechanism D12 rules advisory.
  import { useEffect, useState } from 'react';
  import type { ReactNode } from 'react';
  import type { ClaimSummary } from '../../../shared/api';
  import { api } from '../lib/api';
  import { useNow } from '../lib/useNow';
  import './fleet.css';

  export const CLAIMS_POLL_MS = 30_000;

  /** 'expires in 12m' | 'expires in <1m' | 'expires in 2h' — local, like
   *  lifecycleWords' elapsed: there is still no shared time-formatting module
   *  to import from. */
  function expiresIn(at: number, now: number): string {
    const m = Math.floor((at - now) / 60_000);
    if (m < 1) return 'expires in <1m';
    return m < 60 ? `expires in ${m}m` : `expires in ${Math.floor(m / 60)}h`;
  }

  export function HotFilesStrip(): ReactNode {
    const [claims, setClaims] = useState<readonly ClaimSummary[]>([]);
    const [open, setOpen] = useState(false);
    const now = useNow(30_000);

    useEffect(() => {
      let live = true;
      const load = (): void => {
        void api.claims().then((r) => {
          if (!live) return;
          // `Array.isArray`, not bare trust — AccountsStrip's own rule for a
          // stub or an older server answering with a shape this build never
          // asked for; keep the last good list rather than clobbering it.
          if (Array.isArray(r.claims)) setClaims(r.claims);
        }).catch(() => {});
      };
      load();
      const t = setInterval(load, CLAIMS_POLL_MS);
      return () => { live = false; clearInterval(t); };
    }, []);

    // `=== 'live'` — never a guard-map over `state`: a token a newer server
    // mints is simply not live, which is the safe direction for a strip whose
    // one question is "what is contested RIGHT NOW".
    const liveClaims = claims.filter((c) => c.state === 'live');
    if (liveClaims.length === 0) return null;

    return (
      <section className={open ? 'hotfiles hotfiles--open' : 'hotfiles'} aria-label="Hot files">
        <button type="button" className="hotfiles-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="hotfiles-mark" aria-hidden="true">✋</span>
          <span className="hotfiles-headline">
            {liveClaims.length === 1 ? '1 hot-file claim' : `${liveClaims.length} hot-file claims`}
          </span>
          <span className="hotfiles-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
        </button>
        {open && (
          <ol className="hotfiles-rows">
            {liveClaims.map((c) => (
              <li key={c.id} className="hotfiles-row">
                <span className="hotfiles-holder">{c.heldBy}</span>
                <span className="hotfiles-expiry">{expiresIn(c.expiresAt, now)}</span>
                {/* Intent is free text off the wire — rendered VERBATIM,
                    parsed nowhere: `.sess-held`'s rule for the hold reason. */}
                {c.intent !== null && c.intent !== '' && (
                  <span className="hotfiles-intent">{c.intent}</span>
                )}
                {/* Paths render project-qualified — the claim's own key is
                    (project, path), and a bare `shared/api.ts` on a mixed
                    fleet names half a fact. */}
                <ul className="hotfiles-paths">
                  {c.paths.map((p) => (
                    <li key={p} className="hotfiles-path">{c.project}/{p}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>
    );
  }
  ```

- [ ] **Mount it and add the CSS.** In `pwa/src/screens/FleetScreen.tsx`: import beside
  the other fleet imports (after line 16, `import { PasskeyNotice } …`):
  `import { HotFilesStrip } from '../fleet/HotFilesStrip';` — and mount directly after
  the `fleet-runs-row` button's closing tag (line 342):

  ```tsx
        {/* Build 9's contested-files signal (D12 ruling 3) — renders itself or
            nothing, so it mounts unconditionally, the AccountsStrip rule. */}
        <HotFilesStrip />
  ```

  Append to `pwa/src/fleet/fleet.css`:

  ```css
  /* ── Hot files (Build 9 wave 9) ──────────────────────────────────────────
     The live claims, intent first. MailStrip's chrome, fleet-side. */
  .hotfiles {
    margin: 0 var(--sp-4) var(--sp-2);
    border: 1px solid var(--edge-subtle);
    border-radius: var(--r-md);
    background: var(--bg-surface);
    color: var(--ink-primary);
    overflow: hidden;
  }
  .hotfiles-head {
    display: flex; align-items: center; gap: var(--sp-2); width: 100%;
    padding: var(--sp-2) var(--sp-3); background: none; border: 0;
    color: inherit; font: inherit; text-align: left; cursor: pointer;
  }
  .hotfiles-headline { flex: 1; }
  .hotfiles-chevron { color: var(--ink-tertiary); }
  .hotfiles-rows { list-style: none; margin: 0; padding: 0 var(--sp-3) var(--sp-2); }
  .hotfiles-row {
    display: flex; flex-wrap: wrap; gap: var(--sp-2);
    padding: var(--sp-1) 0; border-top: 1px solid var(--edge-subtle);
  }
  .hotfiles-holder { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--ink-secondary); }
  .hotfiles-expiry { margin-left: auto; color: var(--ink-tertiary); font-size: var(--text-xs); }
  .hotfiles-intent { flex-basis: 100%; color: var(--ink-primary); }
  .hotfiles-paths { list-style: none; margin: 0; padding: 0; flex-basis: 100%; }
  .hotfiles-path { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--ink-secondary); word-break: break-word; }
  ```

- [ ] **Run, expect PASS.** `cd pwa && ./node_modules/.bin/vitest run
  test/hot-files-strip.test.tsx`.

- [ ] **Mutation — the live filter.** In `HotFilesStrip.tsx`, change
  `c.state === 'live'` to `c.state !== 'released'`. Run: expect 1 red (`shows only LIVE
  claims` — the lapsed row and the future token both leak back in). Restore.

- [ ] **Whole-package check.** `cd pwa && ./node_modules/.bin/vitest run` (foreground,
  timeout ≥600000) and `cd pwa && npx tsc --noEmit` — both green. The full run covers
  the screens this task edited (`fleet-screen.test.tsx`, `lifecycle-ui.test.tsx`,
  `mail-strip.test.tsx`'s SessionScreen integration); `lifecycle-ui.test.tsx` drives
  the overflow menu, so the new item must not have broken its "Change model" flow. If
  a suite reds, fix the regression before committing — a header prop added without a
  caller is the likely shape (every `SessionHeader` render site must now pass
  `onOpenHistory`).

- [ ] **Commit the fleet half.**

  ```bash
  git add pwa/src/fleet/HotFilesStrip.tsx pwa/test/hot-files-strip.test.tsx pwa/src/screens/FleetScreen.tsx pwa/src/fleet/fleet.css
  git commit -m "pwa(wave9): HotFilesStrip — the live claims, intent first

  Self-polling like AccountsStrip, silent like MailStrip when there is
  nothing, read-only by design: no release, no break — a phone that could
  break a claim would be enforcement wearing a strip's clothes. Mutant
  measured: widening the live filter is 1 red."
  ```
## Wave 10 — D14: one deviation namespace (docs + sources, the quiet-window wave)

The legacy build-scoped deviation families (`D-B<k>-<m>`) are reconciled into the single global
sequence — a **rename with a preserved alias, never a rewrite that loses the original** (spec D14;
`CLAUDE.md` is explicit that D-refs in source comments are authoritative history). Every legacy ref
becomes `D-<n> (was D-B<k>-<m>)` on its first occurrence per file and bare `D-<n>` after, the mapping
is recorded in `ledger_alloc` and `~/.ccrc/ledger-alloc.log` *through the allocator itself* (title
`was <legacy>`), and a committed table plus a standing scanner make the old namespace unable to grow
back.

**This wave is itself a conflict-generating change** — it touches D-ref lines across the whole tree
and will conflict with any in-flight branch, and it cannot protect itself with a claim (claiming `.`
is refused, D12). It therefore runs **last**, inside an **operator-announced quiet window**, and
**never concurrently with a wave**. Task 30's first step is a hard stop-and-ask; do not soften it.

**The one predicate, stated once.** The enumerator (Task 30), the rewriter (Tasks 31–32) and the
standing scanner (Task 32) share a single definition of "bare": a legacy ref **immediately preceded
by `was ` is an alias** — already-reconciled prose, licensed forever — and any other spelling is
bare. In JS, both directions:

```ts
const BARE  = /(?<!was )\bD-B\d+-\d+\b/g;   // enumerated, rewritten, and — after this wave — a red suite
const ALIAS = /\bwas (D-B\d+-\d+)\b/g;      // licensed; the mapping table alone sustains all of these
```

Greedy `\d+` plus `\b` means a shorter id can never half-match a longer one (the `-1` of a `-19`
member is not a boundary), and the guard means the reconciliation record, the allocator titles, and
the design spec's own sentence about those titles all pass through the sweep untouched.

**Spelling discipline inside this plan document.** This plan lives under `docs/superpowers/plans/`
and is therefore *inside the sweep's corpus*. This section never spells a legacy ref bare: prose uses
the metavariable form `D-B<k>-<m>`, concrete examples are always `was `-guarded, and the one mutant
that must plant a bare ref assembles it at run time with `printf` format specifiers so the plan's own
bytes carry nothing the scanner or the rewriter would touch. Earlier sections of this plan were
drafted under the same rule; Task 30's dry run is where any slip surfaces, and the remedy is given
there.

**Measured baseline (2026-08-24 — the enumeration re-measures at execution; these figures are the
drafting-day expectations, not inputs):** 37 unique legacy ids — 23 in build 4's family
(`D-B4-<m>`, m = 1..23) and 14 in build 8's (`D-B8-<m>`, m = 1..14) — across **407 bare occurrences
in 71 tracked files**: 209 occurrences in 8 files under `docs/superpowers/`, 198 occurrences in 63
files elsewhere (62 package sources plus `CLAUDE.md:140`). Three occurrences in the tree are already
`was `-guarded today (two of `was D-B4-9`, one of `was D-B8-12`) and are correctly invisible to the
whole pipeline. `git ls-files` counts 707 tracked files.

**Preconditions this wave takes from earlier waves:** the allocator (`POST /api/ledger/deviations`,
`GET /api/ledger`) shipped and **deployed** in Wave 7; `floorFromScan` recognises both the global and
the legacy forms (Task 9), so the floor was seeded correctly over the mixed-namespace tree and
nothing in this wave can move it backwards (**the floor only ever rises**, D13);
`server/test/deviation-refs.test.ts` exists (created in Wave 7 alongside `floorFromScan`) and gains
its final describe here. The task split honours the wave brief: the no-bare-legacy assertion is red
until the sweep completes, **so the assertion and the final sweep land in the same commit** — Task 31
sweeps the docs half; Task 32 writes the scanner red, completes the sources half, and commits both
together.

---

### Task 30: The enumeration is the work-list, the allocation is the mapping

Enumerate every bare legacy ref across the tracked tree in stable order; allocate one global number
per unique ref through the allocator — so the mapping is durable in `ledger_alloc` **and**
`~/.ccrc/ledger-alloc.log` *before a single file is rewritten* — and commit the record:
`docs/superpowers/specs/2026-08-21-deviation-namespace-reconciliation.md` (the exact path the spec
names). The script's output **is** the work-list, committed as evidence.

**Files:**
- Create: `docs/superpowers/specs/2026-08-21-deviation-namespace-reconciliation.md` — written by the
  enumeration script (mapping table + verbatim work-list), appendices added by Step 10.
- Create (transient, untracked — deleted in Task 32 before the final commit): `reconcile-enum.mjs`
  and `reconcile-rewrite.mjs` at the worktree root, plus the crash-resume file
  `reconcile-alloc.partial` the enum script maintains. `git ls-files` never sees them, so they cannot
  pollute the enumeration they perform.

**Interfaces:**
- Consumes: `POST /api/ledger/deviations` (Wave 7; box token in `x-ccrc-mail-token`, read from the
  server box's `~/.ccrc/mail.token` — `server/src/config.ts:341`; body
  `{project: 'ccrc-pwa', count: 1, title: 'was <legacy>'}`; answers `201 {numbers, floor}` per spec
  D13); `GET /api/ledger` (dual-arm read, D-149 pattern) for the seeded-floor check; `GET /api/runs`
  (`server/src/coord/routes.ts:1110`, box-token-readable) for the no-open-runs check.
- Produces: the committed mapping row grammar `| D-<n> | was <legacy> | <occurrences> | <files> |`,
  which `reconcile-rewrite.mjs` (Tasks 31–32) parses as its only input; the `BARE`/`ALIAS` predicate
  pair reused verbatim by Tasks 31 and 32.

- [ ] **Step 1: STOP — confirm the quiet window with the operator, and wait for the answer.**
  Ask, in so many words: *"Wave 10 rewrites D-ref lines across ~71 tracked files and will conflict
  with ANY in-flight branch. It needs the operator-announced quiet window the spec requires: no wave
  dispatched, no worker mid-flight, no unmerged branch that touches docs or sources, and none started
  until I announce the wave closed. Confirm the window is open now?"* Do **not** proceed on silence,
  on a stale earlier yes, or on your own reading of the fleet — this confirmation is the operator's
  to give, and the spec's *"Do not schedule it concurrently with a wave"* is a ruling, not advice.
- [ ] **Step 2: Verify the tree and the coordinator agree the fleet is quiet.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && git fetch --all --quiet \
    && git log --oneline -1 origin/main \
    && git branch -r --no-merged origin/main
  ```
  Expect the wave branch to sit on current `origin/main` and the `--no-merged` list to name **only**
  this wave's own branch (mirror refs of it included). Then:
  ```bash
  curl -sS -H "x-ccrc-mail-token: $(cat ~/.ccrc/mail.token)" http://127.0.0.1:7788/api/runs
  ```
  Every run in the answer must read a terminal state. An open run, or an unexplained unmerged branch,
  means the window is not real — go back to Step 1. (The token is used, never printed — existence
  checks by `ls` only.)
- [ ] **Step 3: Verify Wave 7 is deployed and the allocator is seeded.**
  ```bash
  curl -sS -H "x-ccrc-mail-token: $(cat ~/.ccrc/mail.token)" http://127.0.0.1:7788/api/ledger
  ```
  Expect `200` with a **non-null floor**. A `404` means Wave 7's server never shipped — stop; deploy
  Wave 7 first. A seeded-floor absence (`409 not-seeded` semantics surfaced on the read, or a null
  floor) means `sweepLedgerFloor`'s hourly tick has not run since deploy — wait for it (it rides
  `FleetWatcher`'s existing tick, gated hourly) and re-check; if it stays unseeded past the hour,
  stop and investigate Wave 7 rather than proceeding. **Until seeded, allocation answers 409 by
  design** — "refuse to start rather than open empty", one level up.
- [ ] **Step 4: Sweep EVERY remote ref for global D-numbers and confirm the floor clears them.**
  The 50-number seed gap exists because numbers on unmerged refs are invisible to the scan; the quiet
  window should mean there are none, and this measures it instead of assuming it:
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && for r in $(git for-each-ref --format='%(refname)' refs/remotes); do \
         git grep -hoE '\bD-[0-9]{1,4}\b' "$r" -- 2>/dev/null; done \
       | sort -u | sed 's/^D-//' | sort -n | tail -5
  ```
  The largest number printed must be **below** the floor Step 3 reported. If it is not, the
  `LEDGER_SEED_GAP` assumption is broken on some ref — stop and ask the operator; do not allocate
  over it. (Drafting-day note: the plan-wide ledger baseline was D-211 free; the floor will sit well
  above whatever this prints, or something is wrong.)
- [ ] **Step 5: Confirm the allocator's request grammar against the landed handler.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && grep -n "api/ledger/deviations" server/src/coord/routes.ts
  ```
  Read the handler (it is registered in `coord/routes.ts` — route-parity puts it nowhere else) and
  confirm the body keys are `project` / `count` / `title` and the `201` body carries
  `numbers: number[]`, exactly the interface contract Wave 7 wrote against. If the landed names
  differ, that is a Wave 7 defect against the contract — stop and reconcile it there; do **not**
  fork the grammar inside this wave's script.
- [ ] **Step 6: Write the enumeration/allocation script.** Create
  `/home/you/worktrees/ccrc-pwa/still-river/reconcile-enum.mjs`:
  ````js
  #!/usr/bin/env node
  // reconcile-enum.mjs — Build 9b Wave 10, Task 30. Transient tool: its source
  // is preserved verbatim as Appendix A of the reconciliation record, and the
  // file itself is deleted before the wave's final commit (Task 32).
  //
  //   node reconcile-enum.mjs --dry   # enumerate and print the work-list; no POSTs, no doc
  //   node reconcile-enum.mjs         # enumerate, allocate, write the record
  //
  // THE ONE PREDICATE, shared verbatim with reconcile-rewrite.mjs and the
  // standing scanner in server/test/deviation-refs.test.ts: a legacy ref
  // immediately preceded by `was ` is an alias (already-reconciled prose) and
  // is neither enumerated nor rewritten; any other spelling is bare.
  import { execFileSync } from 'node:child_process';
  import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
  import path from 'node:path';

  const root = process.cwd(); // run from the worktree root
  const DOC = 'docs/superpowers/specs/2026-08-21-deviation-namespace-reconciliation.md';
  // Crash-resume file: a death between a POST and the doc write must not
  // re-allocate on the next run. A burnt number is harmless (skipped, never
  // reissued — D13); a duplicate `was <legacy>` title would muddy the record.
  const PARTIAL = 'reconcile-alloc.partial';
  const BARE = /(?<!was )\bD-B\d+-\d+\b/g;
  const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.avif',
    '.woff', '.woff2', '.ttf', '.otf', '.db', '.sqlite', '.pdf', '.zip', '.gz', '.tgz', '.wasm']);

  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8').split('\0').filter(Boolean)
    .filter((f) => !BINARY_EXT.has(path.extname(f)));

  // ── enumerate ────────────────────────────────────────────────────────────
  const occ = new Map(); // legacy id -> Map<file, count>; git ls-files order is stable
  for (const f of tracked) {
    let text;
    try { text = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    for (const m of text.matchAll(BARE)) {
      if (!occ.has(m[0])) occ.set(m[0], new Map());
      const files = occ.get(m[0]);
      files.set(f, (files.get(f) ?? 0) + 1);
    }
  }
  // Stable order: numeric by build, then by member — D-B<k>-<m> sorts on (k, m).
  const ids = [...occ.keys()].sort((a, b) => {
    const A = a.match(/^D-B(\d+)-(\d+)$/).slice(1).map(Number);
    const B = b.match(/^D-B(\d+)-(\d+)$/).slice(1).map(Number);
    return A[0] - B[0] || A[1] - B[1];
  });
  const workLine = (id, tail) => {
    const files = [...occ.get(id)].map(([f, n]) => `${f}:${n}`).join(', ');
    return `was ${id} -> ${tail} :: ${files}`;
  };
  const totalOcc = [...occ.values()]
    .reduce((s, m) => s + [...m.values()].reduce((a, b) => a + b, 0), 0);
  const totalFiles = new Set([...occ.values()].flatMap((m) => [...m.keys()])).size;
  console.log(`work-list: ${ids.length} unique legacy refs, ${totalOcc} bare occurrences, ${totalFiles} files`);
  for (const id of ids) console.log(workLine(id, '?'));
  if (process.argv.includes('--dry')) process.exit(0);

  // ── allocate (resumable) ─────────────────────────────────────────────────
  const token = readFileSync(path.join(process.env.HOME, '.ccrc', 'mail.token'), 'utf8').trim();
  const BASE = process.env.CCRC_BASE ?? 'http://127.0.0.1:7788';
  const mapping = new Map();
  if (existsSync(path.join(root, PARTIAL))) {
    for (const line of readFileSync(path.join(root, PARTIAL), 'utf8').split('\n').filter(Boolean)) {
      const m = line.match(/^was (D-B\d+-\d+) -> D-(\d+)$/);
      if (m) mapping.set(m[1], Number(m[2]));
    }
    console.log(`resuming: ${mapping.size} allocations already recorded in ${PARTIAL}`);
  }
  for (const id of ids) {
    if (mapping.has(id)) continue;
    const res = await fetch(`${BASE}/api/ledger/deviations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ccrc-mail-token': token },
      body: JSON.stringify({ project: 'ccrc-pwa', count: 1, title: `was ${id}` }),
    });
    if (res.status !== 201) throw new Error(`allocating for ${id}: ${res.status} ${await res.text()}`);
    const body = await res.json();
    const n = Array.isArray(body.numbers) ? body.numbers[0] : undefined;
    if (!Number.isInteger(n)) throw new Error(`201 without numbers[0] for ${id}: ${JSON.stringify(body)}`);
    mapping.set(id, n);
    appendFileSync(path.join(root, PARTIAL), `was ${id} -> D-${n}\n`);
    console.log(`allocated D-${n}  (title: was ${id})`);
  }

  // ── write the record ─────────────────────────────────────────────────────
  const F3 = '```'; // the fence marker, held out of literal position so the
                    // appendix embedding (four-backtick fences) nests cleanly
  const rows = ids.map((id) => {
    const files = occ.get(id);
    const total = [...files.values()].reduce((a, b) => a + b, 0);
    return `| D-${mapping.get(id)} | was ${id} | ${total} | ${files.size} |`;
  });
  const doc = [
    '# One deviation namespace — the reconciliation record',
    '',
    '**Status:** enumerated and allocated (Task 30); the rewrite is pending.',
    '',
    'Spec: `docs/superpowers/specs/2026-08-21-build9-provenance-peers-claims-design.md`, §1 D14.',
    `Executed ${new Date().toISOString().slice(0, 10)}, in an operator-announced quiet window,`,
    'as Wave 10 of the Build 9b plan — deliberately last, never concurrent with a wave.',
    '',
    'The legacy build-scoped deviation families are renamed into the single global',
    'sequence. Nothing is deleted: every rewrite preserves its original as an alias',
    '— `D-<n> (was D-B<k>-<m>)` on the first occurrence per file, bare `D-<n>`',
    'after — and this table, whose middle column is byte-for-byte the `title` each',
    'allocation carries in `ledger_alloc` and `~/.ccrc/ledger-alloc.log`, is the',
    'permanent mapping. One predicate is shared by the enumerator, the rewriter and',
    'the standing scanner in `server/test/deviation-refs.test.ts`: a legacy ref',
    'immediately preceded by `was ` is an alias and is licensed; any other spelling',
    'is bare, and since this wave a bare spelling is a red suite.',
    '',
    '## The mapping',
    '',
    '| global | legacy (the allocator title) | occurrences | files |',
    '|---|---|---|---|',
    ...rows,
    '',
    '## The work-list (the enumeration output, verbatim)',
    '',
    F3,
    ...ids.map((id) => workLine(id, `D-${mapping.get(id)}`)),
    F3,
    '',
  ].join('\n');
  writeFileSync(path.join(root, DOC), doc);
  console.log(`wrote ${DOC}: ${ids.length} mapping rows`);
  ````
- [ ] **Step 7: Write the rewrite script** (authored now so Appendix B ships with the record; first
  run is Task 31). Create `/home/you/worktrees/ccrc-pwa/still-river/reconcile-rewrite.mjs`:
  ````js
  #!/usr/bin/env node
  // reconcile-rewrite.mjs — Build 9b Wave 10, Tasks 31 and 32. Transient tool:
  // preserved verbatim as Appendix B of the reconciliation record, deleted
  // before the wave's final commit (Task 32).
  //
  //   node reconcile-rewrite.mjs docs/superpowers   # Task 31: the docs half
  //   node reconcile-rewrite.mjs                    # Task 32: everything left
  //
  // Reads the committed mapping (the record's own table — the doc is the single
  // source of truth, not a side file) and rewrites every BARE legacy ref: the
  // first occurrence of a given legacy id in a file becomes `D-<n> (was <legacy>)`;
  // every later occurrence in the same file, bare `D-<n>`. An unmapped legacy
  // ref is a THROW, not a skip — it means the enumeration and the tree have
  // diverged, and the answer is Task 30's dry run again, never a guess.
  import { execFileSync } from 'node:child_process';
  import { readFileSync, writeFileSync } from 'node:fs';
  import path from 'node:path';

  const root = process.cwd(); // run from the worktree root
  const DOC = 'docs/superpowers/specs/2026-08-21-deviation-namespace-reconciliation.md';
  // THE predicate — identical in reconcile-enum.mjs and the standing scanner.
  // The record's own spellings are all `was `-guarded, so the doc (and the
  // design spec's sentence about the allocator titles) pass through untouched.
  const BARE = /(?<!was )\bD-B\d+-\d+\b/g;
  const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.avif',
    '.woff', '.woff2', '.ttf', '.otf', '.db', '.sqlite', '.pdf', '.zip', '.gz', '.tgz', '.wasm']);

  const mapping = new Map();
  for (const m of readFileSync(path.join(root, DOC), 'utf8')
    .matchAll(/^\| D-(\d+) \| was (D-B\d+-\d+) \| /gm)) {
    mapping.set(m[2], Number(m[1]));
  }
  if (mapping.size === 0) throw new Error(`no mapping rows parsed from ${DOC}`);

  const prefixes = process.argv.slice(2);
  const inScope = (f) => prefixes.length === 0
    || prefixes.some((p) => f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`));

  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8').split('\0').filter(Boolean)
    .filter((f) => !BINARY_EXT.has(path.extname(f)) && inScope(f));

  let filesChanged = 0;
  let refs = 0;
  for (const f of tracked) {
    let text;
    try { text = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    const seen = new Set();
    const next = text.replace(BARE, (legacy) => {
      const n = mapping.get(legacy);
      if (n === undefined) throw new Error(`${f}: unmapped legacy ref ${legacy}`);
      refs += 1;
      if (seen.has(legacy)) return `D-${n}`;
      seen.add(legacy);
      return `D-${n} (was ${legacy})`;
    });
    if (next !== text) { writeFileSync(path.join(root, f), next); filesChanged += 1; }
  }
  console.log(`${filesChanged} files changed, ${refs} refs rewritten`);
  ````
- [ ] **Step 8: Dry-run the enumeration and read the work-list against the expectation.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river && node reconcile-enum.mjs --dry
  ```
  Expect (drafting-day baseline, 2026-08-24): `work-list: 37 unique legacy refs, 407 bare
  occurrences, 71 files` — 23 ids in the build-4 family, 14 in the build-8 family, contiguous
  members in each. **A surplus id is a stop, not a datum:** it means a document (most likely an
  earlier section of this very plan) coined a legacy-shaped ref after drafting. Inspect it: if it
  cites a real historical deviation, it belongs on the list and gets a number like the rest; if it
  is a hypothetical coined in prose, respell that prose (`was `-guard it or use the `D-B<k>-<m>`
  metavariable form), commit that correction on this wave's branch, and re-run the dry run until the
  list is exactly the two families. A *missing* id relative to this baseline just means a ref was
  deleted with its file since drafting — fine, the list is the measurement.
- [ ] **Step 9: Run the allocation and write the record.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river && node reconcile-enum.mjs
  ```
  Expect one `allocated D-<n>  (title: was <legacy>)` line per work-list entry, `n` strictly
  ascending (the quiet window means nothing else is allocating; `BEGIN IMMEDIATE` in `tx()` means a
  gap would be another client, which Step 2 said cannot exist — a gap here is a stop-and-ask), then
  `wrote docs/superpowers/specs/2026-08-21-deviation-namespace-reconciliation.md: 37 mapping rows`.
  If the process dies mid-run, just re-run: `reconcile-alloc.partial` resumes it without
  re-allocating.
- [ ] **Step 10: Embed both scripts as appendices of the record** (four-backtick fences, because the
  scripts themselves contain triple-backtick strings):
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && { printf '\n## Appendix A — reconcile-enum.mjs, verbatim\n\n````js\n'; \
         cat reconcile-enum.mjs; \
         printf '````\n\n## Appendix B — reconcile-rewrite.mjs, verbatim\n\n````js\n'; \
         cat reconcile-rewrite.mjs; \
         printf '````\n'; } \
       >> docs/superpowers/specs/2026-08-21-deviation-namespace-reconciliation.md
  ```
- [ ] **Step 11: Prove the record itself is invisible to the predicate.** Re-run the dry run:
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river && node reconcile-enum.mjs --dry
  ```
  The freshly written record is not yet committed, but the enumeration reads the working tree —
  and the summary line must be **unchanged from Step 8** (same ref count, same occurrence count,
  same file count). Every legacy spelling in the record is `was `-guarded and every regex in the
  appendices spells digits as `\d`, so the doc adds nothing. If the counts moved, the record leaked
  a bare form — fix the record generation, not the predicate.
- [ ] **Step 12: Commit the record** (the transient scripts and the resume file stay untracked and
  uncommitted — Appendices A/B carry their bytes):
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && rm -f reconcile-alloc.partial \
    && git add docs/superpowers/specs/2026-08-21-deviation-namespace-reconciliation.md \
    && git commit -m "docs(ledger): the reconciliation work-list — every legacy ref enumerated, allocated, recorded (9b W10)

  One global number per legacy build-scoped ref, taken through the allocator
  BEFORE any file is rewritten, so the mapping is durable in ledger_alloc and
  ~/.ccrc/ledger-alloc.log whatever happens to the sweep. The committed table
  is work-list, mapping and evidence in one: its middle column is
  byte-for-byte each allocation's title, and the enumerator, the rewriter and
  the standing scanner share a single predicate — a ref preceded by 'was ' is
  an alias; anything else is bare.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 31: The docs sweep — aliases preserved, nothing deleted

Rewrite the `docs/superpowers/**` half of the work-list from the committed mapping. First occurrence
per file gets `D-<n> (was <legacy>)` so a reader following an old citation lands; later occurrences
go bare `D-<n>`. The already-`was `-guarded spellings — including the design spec's own sentence
about the allocator titles — pass through untouched, because the rewriter's predicate is the
enumerator's.

**Files:**
- Modify: the 8 docs files the work-list names (drafting-day bare-ref line counts:
  `docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md` 93,
  `docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md` 43,
  `docs/superpowers/plans/2026-08-20-substrate-unreachable.md` 23,
  `docs/superpowers/programs/build4.md` 8,
  `docs/superpowers/specs/2026-08-19-substrate-unreachable-design.md` 6,
  `docs/superpowers/specs/2026-08-11-build4-conversation-and-controls-design.md` 5,
  `docs/superpowers/specs/2026-08-21-build9-provenance-peers-claims-design.md` 3,
  `docs/superpowers/plans/2026-08-20-regset-atomic-write.md` 1 — plus this 9b plan itself if any
  earlier section carries a bare form the executor kept per Task 30 Step 8).
- Modify: `docs/superpowers/specs/2026-08-21-deviation-namespace-reconciliation.md` — the status
  line only.

**Interfaces:**
- Consumes: the mapping row grammar from Task 30's record (`reconcile-rewrite.mjs` parses
  `^\| D-(\d+) \| was (D-B\d+-\d+) \| ` — the doc is the single source of truth, no side file).
- Produces: a `docs/superpowers/` tree in which every legacy spelling is alias-form — the state Task
  32's scanner will pin tree-wide.

- [ ] **Step 1: Re-confirm the window is still open.** One line to the operator: *"Starting the
  docs half of the sweep — still quiet?"* Proceed only on yes. (The enumeration and allocation in
  Task 30 may have taken real time; the window is the operator's clock, not this branch's.)
- [ ] **Step 2: Run the docs-scoped rewrite.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river && node reconcile-rewrite.mjs docs/superpowers
  ```
  Expect `8 files changed, 209 refs rewritten` (drafting-day baseline; the script's printed count is
  the truth, and it must reconcile with the work-list's docs rows). A throw naming an unmapped ref
  means the tree moved after Task 30 — re-run Task 30 Step 8 and extend the record before retrying.
- [ ] **Step 3: Hand-review the diff for composite shorthands the mechanical rewrite cannot know
  about.** A line citing two members as one token — the shape `…-3/6`, meaning members 3 and 6 —
  rewrites its first member and strands the `/6`:
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && grep -rnE 'was D-B[0-9]+-[0-9]+\)/[0-9]' docs/superpowers/ || echo "no composites"
  ```
  For each hit, rewrite by hand so **both** refs are named: `D-<n_a> (was <legacy-a>) and D-<n_b>
  (was <legacy-b>)`, numbers from the mapping table, the `was `-guarded spelling for each. Then skim
  `git diff --stat docs/` — 8 files (plus this plan if applicable), nothing else.
- [ ] **Step 4: Confirm the docs half is clean under the predicate.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && grep -rP '(?<!was )\bD-B\d+-\d+\b' docs/superpowers/ || echo CLEAN
  ```
  Expect `CLEAN`.
- [ ] **Step 5: Update the record's status line.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && sed -i 's/^\*\*Status:\*\*.*$/**Status:** docs rewritten (Task 31); the source sweep is pending (Task 32)./' \
         docs/superpowers/specs/2026-08-21-deviation-namespace-reconciliation.md
  ```
- [ ] **Step 6: Run every suite that reads these documents or ratchets the whole tracked tree.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/coord-pause-route.test.ts \
         test/topology-clean.test.ts test/source-bytes.test.ts test/single-definition.test.ts
  ```
  Expect all green. The reasoning, so a red is diagnosable: `deviation-refs` (Wave 7) checks a
  `D-<n>` never carries two subject lines — an alias is an inline mention with **no** subject line,
  so a correct entry grammar cannot see it as a duplicate entry; if this suite reds on an alias, its
  entry grammar is looser than its own spec — stop and fix *that* (with its own task's mutants), not
  the alias form. `coord-pause-route:251` pins the ungated-route docstring's citation by substring,
  and the alias contains the original byte-for-byte, so it stays green with no edit (it reads
  `routes.ts`, untouched until Task 32, anyway). `topology-clean` and `source-bytes` walk every
  tracked file — the alias introduces no forbidden token and no control byte.
- [ ] **Step 7: Commit.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && git add docs/superpowers/ \
    && git commit -m "docs(ledger): the docs half of the namespace sweep — aliases preserved, nothing deleted (9b W10)

  Every legacy ref under docs/superpowers/ now reads its global number, with
  the original preserved as an alias on first occurrence per file. History
  survives twice over: the alias lands a reader following an old citation,
  and the mapping table pins in prose what the allocator already pinned in
  rows. Composite two-member shorthands were expanded by hand so each member
  names itself.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

### Task 32: The source sweep, the standing scanner, and the full-suite gate

The no-bare-legacy assertion is **red until the sweep completes, so it lands in the same commit as
the final sweep** — written first (red names the 63 remaining files), satisfied by the source half of
the rewrite, committed together. Then the mutation ceremony, then the full three-package gate, then
the wave close. `floorFromScan` already recognises both forms (Task 9), so nothing in this task
touches the allocator's own reading of the tree.

**Files:**
- Modify: `server/test/deviation-refs.test.ts` — created in Wave 7 alongside `floorFromScan`
  (Task 9); **append** one describe at end of file. The block is self-contained (dynamic imports
  inside the memoised loader), so it collides with none of the file's existing imports whatever
  Wave 7 landed.
- Modify: the 63 source-side work-list files (measured 2026-08-24; the committed work-list is
  authoritative at execution). Notable anchors in today's tree: `CLAUDE.md:140` (the tree's one
  root-level bare ref); `ccd/ccd` — 8 comment sites (`:334`, `:366`, `:1567`, `:10244`, `:10255`,
  `:10283`, `:11019`, `:11028`) plus the **provenance marker at `ccd/ccd:2`**, re-stamped in Step 5;
  `shared/api.ts:2302`, `:2906`; `server/src/coord/routes.ts` ungated-route docstrings (`:868`,
  `:876`, `:1022` today — Wave 7 will have grown this file; the script finds them regardless);
  `deploy/deploy.sh:814`; the rest are comment/string sites across `server/`, `agent/`, `pwa/`
  sources and tests.
- Delete (untracked transients): `reconcile-enum.mjs`, `reconcile-rewrite.mjs` — after their final
  use, before the commit, so `git add -A` cannot sweep them in.

**Interfaces:**
- Consumes: the mapping table (via `reconcile-rewrite.mjs`); the `BARE`/`ALIAS` predicates; the
  ccd re-stamp command exactly as `server/test/ownership.test.ts:131-134` documents it
  (`markGenerated` from `shared/mark.mjs` — idempotent, shebang-safe).
- Produces: the standing scanner describe `'one deviation namespace — no bare legacy ref survives
  (9b W10, D14)'` in `server/test/deviation-refs.test.ts`. No source symbol — a guard only.

- [ ] **Step 1: Write the failing scanner.** Append to `server/test/deviation-refs.test.ts` (at end
  of file; the block imports everything it needs dynamically, so no top-of-file edit):
  ```ts

  describe('one deviation namespace — no bare legacy ref survives (9b W10, D14)', () => {
    // The reconciliation record (docs/superpowers/specs/
    // 2026-08-21-deviation-namespace-reconciliation.md) renamed every legacy
    // build-scoped ref into the global sequence, preserving each original as
    // an alias: `D-<n> (was <legacy>)` on first occurrence per file, bare
    // `D-<n>` after. This scanner is the ratchet that keeps the old namespace
    // from growing back: a ref immediately preceded by `was ` is an alias and
    // is licensed; any other spelling is a defect, named file-by-file below.
    //
    // The corpus is `git ls-files` from the repo root — the topology-clean
    // idiom: every tracked file, nothing registered by hand, so a new file
    // needs no wiring to be scanned. The liveness fixtures are assembled by
    // concatenation so this suite's own bytes carry no bare legacy form and
    // need no self-exclusion.
    const BARE = /(?<!was )\bD-B\d+-\d+\b/g;
    const ALIAS = /\bwas (D-B\d+-\d+)\b/g;

    interface LegacyCorpus { files: number; bare: Map<string, string[]>; aliasIds: Set<string> }
    let corpus: LegacyCorpus | null = null;
    const load = async (): Promise<LegacyCorpus> => {
      if (corpus) return corpus;
      const { execFileSync } = await import('node:child_process');
      const { readFileSync } = await import('node:fs');
      const path = (await import('node:path')).default;
      const { fileURLToPath } = await import('node:url');
      const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
      const binary = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.avif',
        '.woff', '.woff2', '.ttf', '.otf', '.db', '.sqlite', '.pdf', '.zip', '.gz', '.tgz', '.wasm']);
      const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
        .toString('utf8').split('\0').filter(Boolean)
        .filter((f) => !binary.has(path.extname(f)));
      const bare = new Map<string, string[]>();
      const aliasIds = new Set<string>();
      let files = 0;
      for (const f of tracked) {
        let text: string;
        try { text = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
        if (text.includes('\0')) continue;
        files += 1;
        const hits = [...text.matchAll(BARE)].map((m) => m[0]);
        if (hits.length > 0) bare.set(f, hits);
        for (const m of text.matchAll(ALIAS)) aliasIds.add(m[1]);
      }
      corpus = { files, bare, aliasIds };
      return corpus;
    };

    it('finds zero bare legacy refs anywhere git ls-files reaches', async () => {
      const c = await load();
      expect(Object.fromEntries(c.bare)).toEqual({});
    });

    it('is looking at the real tree — guards the guard', async () => {
      // 707 tracked files measured at reconciliation; the floor has margin so
      // ordinary growth or pruning never touches it, while a broken walk (a
      // wrong cwd, a filter eating everything) reds loudly and specifically
      // instead of letting the tree scan above pass over nothing.
      const c = await load();
      expect(c.files).toBeGreaterThan(600);
    });

    it('sees the alias corpus the reconciliation left behind', async () => {
      // 37 distinct legacy ids were reconciled (23 in the build-4 family, 14
      // in the build-8 family); the mapping table alone pins every one in
      // `was `-guarded form, so this set can only grow — and only if a further
      // legacy family is ever reconciled. If this reds at a small number while
      // the tree scan stays green, ALIAS has drifted from BARE: the scan has
      // gone vacuous, the tree is not clean.
      const c = await load();
      expect(c.aliasIds.size).toBeGreaterThanOrEqual(37);
    });

    it('the predicates themselves are live — fixtures assembled to not self-trip', async () => {
      const legacy = ['D-B4', '9'].join('-'); // a real reconciled id, in two pieces
      expect([...`see ${legacy} for the ruling`.matchAll(BARE)].length).toBe(1);
      expect([...`see D-999 (was ${legacy})`.matchAll(BARE)].length).toBe(0);
      expect([...`(was ${legacy})`.matchAll(ALIAS)][0]?.[1]).toBe(legacy);
    });
  });
  ```
- [ ] **Step 2: Run it, expect exactly one red.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
  ```
  Expect `finds zero bare legacy refs` to FAIL, its diff naming **63 files / 198 refs** (drafting-day
  baseline — every source-side work-list row, `CLAUDE.md` included, and none of the docs Task 31
  cleaned). The other three must already PASS: the corpus floor is real today, and Task 31's docs
  sweep plus the mapping table put the alias corpus at ≥37 before this task began. Wave 7's existing
  describes in this file must be untouched and green.
- [ ] **Step 3: Run the unscoped rewrite — the final sweep.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river && node reconcile-rewrite.mjs
  ```
  Expect `63 files changed, 198 refs rewritten` (drafting-day baseline; docs are idempotently in
  scope and already clean, so they contribute zero). The count must reconcile with Step 2's red.
- [ ] **Step 4: Hand-review the source diff for composite shorthands**, exactly as in Task 31 Step 3
  (the known drafting-day instance is a two-member `…-3/6` citation in
  `server/test/coord-decide.test.ts:224`):
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && grep -rnE 'was D-B[0-9]+-[0-9]+\)/[0-9]' --include='*.ts' --include='*.tsx' \
         --include='*.mjs' --include='*.sh' server agent pwa shared ccd deploy CLAUDE.md || echo "no composites"
  ```
  Expand each by hand: `D-<n_a> (was <legacy-a>) and D-<n_b> (was <legacy-b>)`, numbers from the
  mapping table. Then skim `git diff --stat` — the work-list's source files plus
  `server/test/deviation-refs.test.ts`, nothing else.
- [ ] **Step 5: Re-stamp ccd/ccd's provenance marker** — its comment sites changed, so the line-2
  hash is now stale, and a stale marker makes every freshly deployed ccd read `ccrc-edited` forever
  (`ownership.test.ts`'s own words: the re-stamp is a gate, not a convention):
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
         const { markGenerated } = await import('./shared/mark.mjs'); \
         writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" \
    && cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
  ```
  Expect `ownership.test.ts` green — `verifies as ccrc-unmodified` in particular.
- [ ] **Step 6: Run the scanner, expect PASS — all four its.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server \
    && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
  ```
  Cross-check at the shell, with the same predicate:
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && git ls-files -z | xargs -0 grep -lP '(?<!was )\bD-B\d+-\d+\b' 2>/dev/null || echo CLEAN
  ```
  Expect `CLEAN`.
- [ ] **Step 7: Finalize the record's status line, delete the transients, and commit the assertion
  WITH the final sweep** (the wave brief's ruling: neither stands without the other):
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && sed -i 's/^\*\*Status:\*\*.*$/**Status:** complete — the standing scanner in server\/test\/deviation-refs.test.ts holds the ratchet./' \
         docs/superpowers/specs/2026-08-21-deviation-namespace-reconciliation.md \
    && rm -f reconcile-enum.mjs reconcile-rewrite.mjs reconcile-alloc.partial \
    && git add -A \
    && git commit -m "test(ledger): the sources join the single namespace, and a scanner holds the door (9b W10)

  The remaining tracked sources sweep to their global numbers with the
  original preserved as an alias on first occurrence per file — CLAUDE.md,
  shared/api.ts, the routes.ts ungated-route docstrings, eight ccd/ccd
  comment sites (provenance marker re-stamped) — and deviation-refs.test.ts
  gains the ratchet: zero bare legacy refs anywhere git ls-files reaches,
  with the corpus size and the alias corpus both floored so a vacuous walk
  reds before a dirty tree greens. Red before the sweep (63 files), green
  after; the assertion and the final sweep share this commit because neither
  stands without the other.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```
  (Mutants follow the commit, deliberately: they plant into and revert tracked files, which is only
  safe against a clean tree — before this commit, a `git restore` would have eaten sweep edits.)
- [ ] **Step 8: Measure mutant 1 of 3 — plant a bare legacy ref.** The planted string is assembled
  by `printf` so this plan's own bytes stay clean:
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river \
    && printf '// reconciliation mutant, remove me: bare legacy ref D-B%d-%d\n' 4 9 \
         >> server/src/coord/store.ts \
    && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts; \
  cd /home/you/worktrees/ccrc-pwa/still-river && sed -i '$d' server/src/coord/store.ts \
    && git diff --stat
  ```
  Mutant: one bare legacy ref anywhere in the tree -> `finds zero bare legacy refs` fails, naming
  `server/src/coord/store.ts` and the planted id. The `sed -i '$d'` removes exactly the appended
  line; `git diff --stat` must end empty.
- [ ] **Step 9: Measure mutant 2 of 3 — starve the corpus.** In the appended describe, change
  `{ cwd: root, maxBuffer: 64 * 1024 * 1024 }` to
  `{ cwd: path.join(root, 'server', 'test'), maxBuffer: 64 * 1024 * 1024 }`, run the Step 6 vitest
  command, revert the edit.
  Mutant: the walk sees a subtree instead of the tree -> `is looking at the real tree` fails
  (a few hundred files at most against the 600 floor), and `sees the alias corpus` fails with it —
  the vacuous-walk failure is loud and specific, never a quiet green.
- [ ] **Step 10: Measure mutant 3 of 3 — drift the alias regex.** In the appended describe, change
  `ALIAS`'s `\bwas ` to `\bwass `, run the Step 6 vitest command, revert the edit.
  Mutant: ALIAS no longer matches what BARE excuses -> `sees the alias corpus` fails at 0 **while
  the tree scan stays green** — exactly the drift this third assertion exists to catch. After the
  revert, `git status` must show a clean tree.
- [ ] **Step 11: The full-suite gate — all three packages, foreground, timeout ≥600000ms each.**
  ```bash
  cd /home/you/worktrees/ccrc-pwa/still-river/server && npm run test
  cd /home/you/worktrees/ccrc-pwa/still-river/agent  && npm run test
  cd /home/you/worktrees/ccrc-pwa/still-river/pwa    && npm run test
  ```
  Expect all green. The sweep touched comments and string labels across all three packages
  (`describe` titles in `pwa/test/*`, the type-bypass fixture under `agent/test/types/bypasses/`,
  `shared/api.ts` docstrings), so this gate is the wave's proof, not a formality. Known load flakes
  (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`): re-run IN
  ISOLATION before calling a real break; CI on the quiet box is the arbiter.
- [ ] **Step 12: Wave close — merge inside the window, deploy agent-first, verify `landed`, release
  the window.** In order, each a stop point:
  1. Push the branch, open the PR, and merge it **within the quiet window** (`main` is protected —
     PRs only). The window is not over until the merge is in, because any branch cut before it
     conflicts with all of this.
  2. Deploy **agent-first** — `ccd/ccd` changed (comments and marker, but the rule is categorical):
     `bash deploy/deploy.sh agent <fleet-host>` then `bash deploy/deploy.sh` (coordinates from
     `~/.ccrc/deploy.env`; the server lane's final gate is `/health` reporting the shipped sha).
  3. After at least one `sweepLedgerReconcile` interval (15 min), read the ledger:
     `curl -sS -H "x-ccrc-mail-token: $(cat ~/.ccrc/mail.token)" http://127.0.0.1:7788/api/ledger`
     — every reconciliation allocation (the `was `-titled block) must read **`landed`**: the merged
     docs now carry each number in `docs/superpowers/` on the main checkout. If any still reads
     `allocated` after two intervals, report it to the operator with the number and its title —
     never hand-edit `coord.db`, and never re-allocate.
  4. Tell the operator the wave is closed and the quiet window can end. Wave 10 was the program's
     last wave; the namespace is one.

---

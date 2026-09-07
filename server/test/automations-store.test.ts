// Task 4 — the store leases a schedule, bounds its history, and reports its
// growth (`.superpowers/sdd/2026-08-31-automations/task-4-decisions.md`,
// `docs/superpowers/specs/2026-08-31-automations-design.md` §5, §8, §9,
// BINDING). Four things carry the load, each with its own section below:
// the lease CAS is ONE transaction (`claimAndOpenRun`); the per-parent ring
// is pruned in the SAME transaction as the run's own insert; the failure
// ceiling auto-pauses and `skipped`/`missed` never count toward it; the arm
// gate (`provedAt`) is a STORE invariant, not only a route arm.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import {
  CoordStore, type FiringOccurrence, type ScheduleStamp, type SettledRun,
} from '../src/coord/store.js';
import {
  AUTOMATION_DETAIL_MAX_BYTES, AUTOMATION_FAILURE_CEILING, AUTOMATION_REFUSALS,
  type AutomationRefusal,
} from '../../shared/api.js';
import type { Cadence } from '../../shared/schedule.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));

const wallClock = (over: Partial<{ days: number; minuteOfDay: number; tz: string }> = {}): Cadence =>
  ({ kind: 'wall-clock', days: 0b1111111, minuteOfDay: 540, tz: 'UTC', ...over });

const scheduleOccurrence = (
  scheduledFor: number, next: ScheduleStamp, dstShifted = false,
): FiringOccurrence => ({ trigger: 'schedule', scheduledFor, dstShifted, next });

const manualOccurrence = (): FiringOccurrence => ({ trigger: 'manual' });

/** Insert a fresh automation, prove it with a settled manual run that binds
 *  a session (the ONLY door the §7 arm gate opens), then arm it — the
 *  "stamp `provedAt` on every other fixture in this suite" instruction. */
const makeArmed = (s: CoordStore, now: number, nextRunAt: number): number => {
  const { id } = s.insertAutomation(
    { name: 'nightly build', project: 'demo', prompt: 'do the thing', cadence: wallClock(), graceMs: 60_000 },
    now,
  );
  const claim = s.claimAndOpenRun({ automationId: id, now, occurrence: manualOccurrence() });
  if (!('runId' in claim)) throw new Error('setup: manual proving claim was refused');
  s.markAutomationSpawn({
    runId: claim.runId, spawnRc: 0,
    identity: { bound: true, sessionId: 'proof-session', workspace: 'ws', branch: 'main', wrapper: 'w1', adopted: false },
  });
  s.settleAutomationRun({ runId: claim.runId, settlement: { outcome: 'ok' }, now: now + 1 });
  const armed = s.armAutomation(id, nextRunAt, now + 2);
  if (!armed.ok) throw new Error('setup: arm was refused');
  return id;
};

describe('CoordStore: automations — the lease CAS', () => {
  it('a second claim inside the soft bound refuses overlap, naming the current holder; a claim past the hard bound lapses the old run and succeeds', () => {
    const s = store();
    const t0 = 1_700_000_000_000;
    const id = makeArmed(s, t0, t0);

    const a = s.claimAndOpenRun({
      automationId: id, now: t0, occurrence: scheduleOccurrence(t0, { at: t0 + 3_600_000 }),
    });
    if (!('runId' in a)) throw new Error('unreachable');

    const overlap = s.claimAndOpenRun({
      automationId: id, now: t0 + 1_000,
      occurrence: scheduleOccurrence(t0, { at: t0 + 3_600_000 }),
    });
    expect(overlap).toEqual({ refused: 'overlap', leaseUntil: t0 + 120_000, leaseRunId: a.runId });

    // Past AUTOMATION_LEASE_HARD_MS (600_000ms) after the first claim: the
    // CAS lapses run A to 'lost' as its own step 1, then admits a fresh claim.
    const b = s.claimAndOpenRun({
      automationId: id, now: t0 + 600_001,
      occurrence: scheduleOccurrence(t0 + 3_600_000, { at: t0 + 7_200_000 }),
    });
    if (!('runId' in b)) throw new Error('unreachable');
    expect(b.runId).not.toBe(a.runId);

    const runA = s.automationRun(a.runId)!;
    expect(runA.outcome).toBe('lost');
    expect(runA.endedAt).not.toBeNull();
  });

  it('an interrupted claimAndOpenRun leaves EITHER both the lease and the advanced nextRunAt, or neither', () => {
    const s = store();
    const t0 = 1_700_000_000_000;
    const id = makeArmed(s, t0, t0);
    const before = s.automation(id)!;
    const priorRunCount = s.automationRuns(id).length;

    const original = s.db.prepare.bind(s.db);
    let armed = true;
    s.db.prepare = ((sql: string) => {
      if (armed && sql.includes('SET leaseUntil')) {
        armed = false;
        throw new Error('injected failure between the run insert and the lease UPDATE');
      }
      return original(sql);
    }) as typeof s.db.prepare;

    try {
      expect(() => s.claimAndOpenRun({
        automationId: id, now: t0 + 1_000,
        occurrence: scheduleOccurrence(t0, { at: t0 + 3_600_000 }),
      })).toThrow('injected failure');
    } finally {
      s.db.prepare = original;
    }

    const after = s.automation(id)!;
    expect(after.leaseUntil).toBeNull();
    expect(after.leaseHardUntil).toBeNull();
    expect(after.leaseRunId).toBeNull();
    expect(after.nextRunAt).toBe(before.nextRunAt);
    expect(s.automationRuns(id).length).toBe(priorRunCount);
  });

  it("a superseded run's late settle does not clear its successor's lease (the reason automations.leaseRunId exists)", () => {
    const s = store();
    const t0 = 1_000;
    const id = makeArmed(s, t0, t0);
    const a = s.claimAndOpenRun({ automationId: id, now: t0, occurrence: manualOccurrence() });
    if (!('runId' in a)) throw new Error('unreachable');

    // The SOFT bound (120_000ms) passes with no renewal, but the HARD bound
    // has not — run A is still genuinely 'running'. Renewal, not liveness,
    // gates the CAS (C1.6), so a fresh claim is legitimately admitted.
    const b = s.claimAndOpenRun({ automationId: id, now: t0 + 120_001, occurrence: manualOccurrence() });
    if (!('runId' in b)) throw new Error('unreachable');
    expect(b.runId).not.toBe(a.runId);
    expect(s.automation(id)!.leaseRunId).toBe(b.runId);

    // A finally finishes and settles — its OWN row updates fine (nothing ever
    // marked it lost), but it must not clear B's lease.
    s.settleAutomationRun({ runId: a.runId, settlement: { outcome: 'ok' }, now: t0 + 120_500 });
    const row = s.automation(id)!;
    expect(row.leaseRunId).toBe(b.runId);
    expect(row.leaseUntil).not.toBeNull();
    expect(row.leaseHardUntil).not.toBeNull();
  });

  it('renewAutomationLeaseForRun refuses to renew a lease that no longer names that run', () => {
    // The whole reason the sweep's renewal is keyed on the RUN and not on the
    // automation. The sweep renews every act it still has in flight, and an
    // entry can go stale — the run settled, the lease was released, and a new
    // claim took it. Keyed on the automation, that renewal would silently
    // extend a DIFFERENT run's lease by another full soft period; keyed on the
    // run, it correctly does nothing and says so.
    const s = store();
    const t0 = 1_000;
    const id = makeArmed(s, t0, t0);
    const first = s.claimAndOpenRun({ automationId: id, now: t0 + 10, occurrence: manualOccurrence() });
    if (!('runId' in first)) throw new Error('unreachable');
    expect(s.renewAutomationLeaseForRun(first.runId, t0 + 20), 'its own lease renews').toBe(true);

    s.settleAutomationRun({ runId: first.runId, settlement: { outcome: 'ok' }, now: t0 + 30 });
    const second = s.claimAndOpenRun({ automationId: id, now: t0 + 40, occurrence: manualOccurrence() });
    if (!('runId' in second)) throw new Error('unreachable');
    const heldBySecond = s.automation(id)!.leaseUntil;

    expect(s.renewAutomationLeaseForRun(first.runId, t0 + 50),
      "the settled run must not be able to extend the lease that replaced it").toBe(false);
    expect(s.automation(id)!.leaseUntil, "and the second run's lease is untouched").toBe(heldBySecond);
  });

  it('renewAutomationLeaseForRun moves leaseUntil only, leaves leaseHardUntil byte-identical, and returns false once the lease is gone', () => {
    const s = store();
    const t0 = 1_700_000_000_000;
    const id = makeArmed(s, t0, t0);
    const claim = s.claimAndOpenRun({ automationId: id, now: t0 + 1, occurrence: manualOccurrence() });
    if (!('runId' in claim)) throw new Error('unreachable');

    const before = s.automation(id)!;
    expect(s.renewAutomationLeaseForRun(claim.runId, t0 + 2)).toBe(true);
    const after = s.automation(id)!;
    expect(after.leaseHardUntil).toBe(before.leaseHardUntil);
    expect(after.leaseUntil).toBe(t0 + 2 + 120_000);
    expect(after.leaseUntil).not.toBe(before.leaseUntil);

    s.settleAutomationRun({ runId: claim.runId, settlement: { outcome: 'ok' }, now: t0 + 3 });
    expect(s.renewAutomationLeaseForRun(claim.runId, t0 + 4)).toBe(false);
  });

  it('a renewal never moves the soft bound BACKWARDS, whatever clock its caller holds', () => {
    // `SET leaseUntil = MIN(?, leaseHardUntil)` assigns unconditionally, and
    // a renewal is the one call whose entire purpose is to HOLD the bound up.
    // A caller whose clock is older than the bound on the row therefore
    // LOWERS it — and once the act has been in flight for longer than
    // `AUTOMATION_LEASE_MS` that lowers it into the PAST, which is not a
    // renewal but a release: both overlap guards read the soft bound, so a
    // second claim lands on an automation whose act is still running and pass
    // 3 spawns it a second time. A stale caller is not hypothetical — L1
    // samples no clock of its own, so an act holds the clock it started with,
    // and the sweep renews with a fresh one; the two disagree by however long
    // the spawn took (ccd allows 240 s).
    const s = store();
    const t0 = 1_700_000_000_000;
    const id = makeArmed(s, t0, t0);
    const claim = s.claimAndOpenRun({ automationId: id, now: t0 + 1, occurrence: manualOccurrence() });
    if (!('runId' in claim)) throw new Error('unreachable');

    expect(s.renewAutomationLeaseForRun(claim.runId, t0 + 200_000), 'a fresh clock renews forward').toBe(true);
    const held = s.automation(id)!;
    expect(held.leaseUntil).toBe(t0 + 200_000 + 120_000);

    // 199 s behind, and still well inside the hard bound — so the WHERE
    // clause matches and only the assignment decides the outcome.
    expect(s.renewAutomationLeaseForRun(claim.runId, t0 + 1_000),
      'the lease is live and named by this run, so the call still reports true').toBe(true);
    expect(s.automation(id)!.leaseUntil,
      'a stale renewal must hold the bound, never lower it').toBe(held.leaseUntil);
    expect(s.automation(id)!.leaseHardUntil,
      'and the hard bound is never renewal\'s business').toBe(held.leaseHardUntil);
  });

  it('inFlightAutomationRunCount ignores a running row whose lease has lapsed past the hard bound (mutation: drop the join and two crashed runs disable the whole feature)', () => {
    const s = store();
    const t0 = 1_700_000_000_000;
    const id = makeArmed(s, t0, t0);
    const claim = s.claimAndOpenRun({ automationId: id, now: t0 + 1, occurrence: manualOccurrence() });
    if (!('runId' in claim)) throw new Error('unreachable');
    expect(s.inFlightAutomationRunCount(t0 + 2)).toBe(1);
    expect(s.inFlightAutomationRunCount(t0 + 1 + 600_001)).toBe(0);
  });
});

describe('CoordStore: automations — dueAutomations, the arm gate as a store invariant', () => {
  it('returns only armed rows with provedAt set, no scheduleError, nextRunAt <= now, ordered by id', () => {
    const s = store();
    const t0 = 1_700_000_000_000;
    const early = makeArmed(s, t0, t0 - 1_000);
    const late = makeArmed(s, t0, t0 + 50_000);
    const due = s.dueAutomations(t0).map((r) => r.id);
    expect(due).toEqual([early]);
    expect(due).not.toContain(late);
  });

  it('excludes an armed row whose provedAt is NULL, even one the public API cannot construct — the arm gate enforced in dueAutomations itself, not only by armAutomation refusing it', () => {
    const s = store();
    const t0 = 1_700_000_000_000;
    s.db.prepare(
      'INSERT INTO automations (name, state, project, prompt, cadenceKind, cadenceDays, ' +
      'cadenceMinute, cadenceEvery, tz, graceMs, createdAt, updatedAt, provedAt, nextRunAt, ' +
      "scheduleError) VALUES ('rogue', 'armed', 'demo', 'p', 'wall-clock', 127, 60, NULL, " +
      "'UTC', 60000, ?, ?, NULL, ?, NULL)",
    ).run(t0, t0, t0 - 1_000);
    expect(s.dueAutomations(t0)).toEqual([]);
  });

  it('armAutomation refuses never-run-by-hand until a manual run has settled with a session bound; the settle stamps provedAt in its own transaction', () => {
    const s = store();
    const t0 = 1_000;
    const { id } = s.insertAutomation(
      { name: 'x', project: 'demo', prompt: 'p', cadence: wallClock(), graceMs: 1_000 }, t0,
    );
    expect(s.armAutomation(id, t0 + 10_000, t0 + 1)).toEqual({ ok: false, why: 'never-run-by-hand' });

    const claim = s.claimAndOpenRun({ automationId: id, now: t0 + 2, occurrence: manualOccurrence() });
    if (!('runId' in claim)) throw new Error('unreachable');
    s.markAutomationSpawn({
      runId: claim.runId, spawnRc: 0,
      identity: { bound: true, sessionId: 'sess-x', workspace: 'ws', branch: 'main', wrapper: 'w1', adopted: false },
    });
    const settled = s.settleAutomationRun({ runId: claim.runId, settlement: { outcome: 'ok' }, now: t0 + 3 });
    expect((settled as SettledRun).proved).toBe(true);

    expect(s.armAutomation(id, t0 + 10_000, t0 + 4)).toEqual({ ok: true, nextRunAt: t0 + 10_000 });
  });

  it('a MANUAL run that bound NO session does not stamp provedAt — the other half of the same gate', () => {
    // The gate is two conjuncts (`trigger === 'manual' && sessionId !== null`)
    // and only the trigger half was measured, twice, while the session half
    // was measured nowhere: deleting it left every suite green. It is the
    // ONLY mechanism enforcing spec §7's "at least one MANUAL run has settled
    // WITH A SESSION CREATED" — `armAutomation` and `dueAutomations` both read
    // `provedAt` alone, so nothing downstream re-measures that a session ever
    // existed. And the state it excludes is ordinary: every post-claim
    // refusal settles a manual run with `sessionId` NULL, so a transient one
    // (`coordinator-paused`, `account-pressed`, `registry-unmeasurable` — the
    // refusals that deliberately do NOT count toward the ceiling) would have
    // armed the row, and it would then really fire on the clock, unattended,
    // having never been proved by hand.
    const s = store();
    const t0 = 1_000;
    const { id } = s.insertAutomation(
      { name: 'z', project: 'demo', prompt: 'p', cadence: wallClock(), graceMs: 1_000 }, t0,
    );
    const claim = s.claimAndOpenRun({ automationId: id, now: t0 + 2, occurrence: manualOccurrence() });
    if (!('runId' in claim)) throw new Error('unreachable');
    // No `markAutomationSpawn` at all: this is the precheck-refusal shape,
    // where the act refuses before it ever reaches a spawn.
    const settled = s.settleAutomationRun({
      runId: claim.runId, settlement: { outcome: 'refused', refusal: 'coordinator-paused' }, now: t0 + 3,
    });
    expect((settled as SettledRun).proved).toBe(false);
    expect(s.automation(id)!.provedAt).toBeNull();
    expect(s.armAutomation(id, t0 + 10_000, t0 + 4),
      'and the gate still holds after it').toEqual({ ok: false, why: 'never-run-by-hand' });
  });

  it('a SCHEDULE-triggered run that binds a session does NOT stamp provedAt — only a MANUAL run does', () => {
    // A schedule-triggered `automation_runs` row, opened directly by SQL
    // rather than through `claimAndOpenRun`: in production `dueAutomations`
    // never selects an unproved (hence unarmed) row for a schedule firing,
    // so this isolates `settleRunInner`'s own `trigger==='manual'` gate from
    // the claim's separate armed-state gate (a schedule-trigger
    // `claimAndOpenRun` on a non-armed row hits the CHECK constraint, its
    // own, correct, guard).
    const s = store();
    const t0 = 1_000;
    const { id } = s.insertAutomation(
      { name: 'y', project: 'demo', prompt: 'p', cadence: wallClock(), graceMs: 1_000 }, t0,
    );
    const ins = s.db.prepare(
      'INSERT INTO automation_runs (automationId, scheduledFor, startedAt, lateMs, outcome, ' +
      "trigger, dstShifted) VALUES (?, ?, ?, 0, 'running', 'schedule', 0)",
    ).run(id, t0, t0);
    const runId = Number(ins.lastInsertRowid);
    s.markAutomationSpawn({
      runId, spawnRc: 0,
      identity: { bound: true, sessionId: 'sess-y', workspace: 'ws', branch: 'main', wrapper: 'w1', adopted: false },
    });
    const settled = s.settleAutomationRun({ runId, settlement: { outcome: 'ok' }, now: t0 + 2 });
    expect((settled as SettledRun).proved).toBe(false);
    expect(s.automation(id)!.provedAt).toBeNull();
  });
});

describe('the failure ledger, over its WHOLE vocabulary rather than two examples', () => {
  /** WHICH REFUSALS ARE THE AUTOMATION'S OWN FAILURE, spelled here as the
   *  test's own expectation — the store's table is the decision, this is the
   *  measurement of it. Keyed off the DERIVED `AUTOMATION_REFUSALS`, so a
   *  refusal added to the union and not decided here fails this fixture
   *  instead of quietly inheriting whichever answer the store's `Record`
   *  happened to give it. */
  const COUNTS: Readonly<Record<AutomationRefusal, boolean>> = {
    // The automation's own configuration, and its own act.
    'unknown-project': true,
    'spawn-refused': true, 'spawn-cut-short': true, 'spawn-unmeasured': true,
    'spawn-ambiguous': true, 'prompt-refused': true,
    // The operator's own switches, the fleet's capacity, an unreachable box,
    // and the ceiling itself — none of them spawned a session or sent a
    // prompt, so there is no failure of THIS automation to count. An
    // operator who pauses the fleet across three occurrences must not come
    // back to a schedule that disarmed itself.
    'coordinator-paused': false, 'automations-paused': false,
    'registry-unmeasurable': false, 'no-placeable-account': false,
    'account-pressed': false, 'cap-concurrency': false, overlap: false,
    'failure-ceiling': false, unknown: false,
  };

  it('decides every refusal in the union, and the union has no member this fixture forgot', () => {
    expect([...AUTOMATION_REFUSALS].sort()).toEqual(Object.keys(COUNTS).sort());
  });

  for (const refusal of AUTOMATION_REFUSALS) {
    it(`a refused settle carrying ${refusal} ${COUNTS[refusal] ? 'counts' : 'does not count'} toward the ceiling`, () => {
      const s = store();
      const t0 = 1_000;
      const id = makeArmed(s, t0, t0);
      const claim = s.claimAndOpenRun({ automationId: id, now: t0 + 10, occurrence: manualOccurrence() });
      if (!('runId' in claim)) throw new Error('unreachable');
      const settled = s.settleAutomationRun({
        runId: claim.runId, settlement: { outcome: 'refused', refusal }, now: t0 + 11,
      });
      expect((settled as SettledRun).consecutiveFailures).toBe(COUNTS[refusal] ? 1 : 0);
      expect(s.automation(id)!.consecutiveFailures).toBe(COUNTS[refusal] ? 1 : 0);
    });
  }

  /** The OUTCOME half of the same ledger, for the outcomes a settle can
   *  carry directly. `refused` is covered by the table above; `running` is
   *  not a settlement; `skipped`/`missed` are written by `openUnleasedRun`
   *  and pinned in this file's grace fixtures. */
  const OUTCOME_COUNTS: Readonly<Record<'ok' | 'lost' | 'failed', number>> = { ok: 0, lost: 1, failed: 1 };
  for (const outcome of ['ok', 'lost', 'failed'] as const) {
    it(`a ${outcome} settle leaves consecutiveFailures at ${OUTCOME_COUNTS[outcome]}`, () => {
      const s = store();
      const t0 = 1_000;
      const id = makeArmed(s, t0, t0);
      const claim = s.claimAndOpenRun({ automationId: id, now: t0 + 10, occurrence: manualOccurrence() });
      if (!('runId' in claim)) throw new Error('unreachable');
      const settlement = outcome === 'failed'
        ? ({ outcome: 'failed', refusal: 'prompt-refused' } as const)
        : ({ outcome } as const);
      const settled = s.settleAutomationRun({ runId: claim.runId, settlement, now: t0 + 11 });
      expect((settled as SettledRun).consecutiveFailures).toBe(OUTCOME_COUNTS[outcome]);
    });
  }
});

describe('CoordStore: automations — the per-parent ring', () => {
  it('rings automation_runs to AUTOMATION_RUN_RETENTION, deletes the evicted run\'s events, accumulates runsEvicted, and leaves a sibling automation untouched', () => {
    const s = store();
    const t0 = 1_000;
    const id = makeArmed(s, t0, t0);
    const provingRunId = s.automationRuns(id)[0]!.id;
    s.appendRunEvent(provingRunId, 'spawn', true, 'proof', t0 + 1);

    const sibling = makeArmed(s, t0, t0);
    for (let i = 0; i < 3; i++) {
      const claim = s.claimAndOpenRun({ automationId: sibling, now: t0 + 10_000 + i, occurrence: manualOccurrence() });
      if (!('runId' in claim)) throw new Error('unreachable');
      s.settleAutomationRun({ runId: claim.runId, settlement: { outcome: 'ok' }, now: t0 + 10_001 + i });
    }
    const siblingRunsBefore = s.automationRuns(sibling, 500).length;
    expect(siblingRunsBefore).toBe(4); // the proving run + 3

    for (let i = 0; i < 200; i++) {
      const claim = s.claimAndOpenRun({ automationId: id, now: t0 + 20_000 + i, occurrence: manualOccurrence() });
      if (!('runId' in claim)) throw new Error('unreachable');
      s.settleAutomationRun({ runId: claim.runId, settlement: { outcome: 'ok' }, now: t0 + 20_001 + i });
    }

    expect(s.automationRuns(id, 500).length).toBe(200);
    expect(s.automation(id)!.runsEvicted).toBe(1);
    const survivorIds = s.automationRuns(id, 500).map((r) => r.id);
    expect(survivorIds).not.toContain(provingRunId);
    expect(s.automationRunEvents(provingRunId)).toEqual([]);

    expect(s.automationRuns(sibling, 500).length).toBe(siblingRunsBefore);
  });
});

describe('CoordStore: automations — appendRunEvent caps detail at AUTOMATION_DETAIL_MAX_BYTES', () => {
  it('truncates an over-cap detail and reports the exact dropped byte count', () => {
    const s = store();
    const id = makeArmed(s, 1_000, 1_000);
    const claim = s.claimAndOpenRun({ automationId: id, now: 2_000, occurrence: manualOccurrence() });
    if (!('runId' in claim)) throw new Error('unreachable');
    const detail = 'x'.repeat(AUTOMATION_DETAIL_MAX_BYTES + 10);
    s.appendRunEvent(claim.runId, 'spawn', true, detail, 3_000);
    const events = s.automationRunEvents(claim.runId);
    expect(events).toHaveLength(1);
    expect(events[0]!.truncatedBytes).toBe(10);
    expect(Buffer.byteLength(events[0]!.detail, 'utf8')).toBe(AUTOMATION_DETAIL_MAX_BYTES);
  });

  it('never cuts a detail mid-codepoint, and says how many bytes went', () => {
    // The continuation-byte walk was exercised only with `'x'.repeat(...)`,
    // where every byte is a codepoint and the walk is a no-op — so deleting
    // it left the suite green while a real detail (ccd's stderr on a failed
    // spawn is the largest text stored, and a project name or a branch can
    // carry any UTF-8) came back with a replacement character at the cut and
    // a `truncatedBytes` that did not match what was actually dropped.
    const s = store();
    const id = makeArmed(s, 1_000, 1_000);
    const claim = s.claimAndOpenRun({ automationId: id, now: 2_000, occurrence: manualOccurrence() });
    if (!('runId' in claim)) throw new Error('unreachable');
    // A 3-byte codepoint straddling the cap: the cap lands one byte into the
    // last '…', so the walk must drop that whole codepoint.
    const filler = 'a'.repeat(AUTOMATION_DETAIL_MAX_BYTES - 1);
    const detail = `${filler}…tail`;
    expect(Buffer.byteLength(detail, 'utf8')).toBe(AUTOMATION_DETAIL_MAX_BYTES - 1 + 3 + 4);
    s.appendRunEvent(claim.runId, 'spawn', false, detail, 3_000);
    const ev = s.automationRunEvents(claim.runId)[0]!;
    expect(ev.detail, 'the straddling codepoint is dropped whole, never half-written')
      .toBe(filler);
    expect(ev.detail.includes('\ufffd'), 'and no replacement character is stored').toBe(false);
    expect(Buffer.byteLength(ev.detail, 'utf8'),
      'so the stored text can be SHORTER than the cap — dropping a codepoint costs its whole width')
      .toBe(AUTOMATION_DETAIL_MAX_BYTES - 1);
    expect(ev.truncatedBytes, 'and the count is what actually went, measured against what was kept')
      .toBe(Buffer.byteLength(detail, 'utf8') - (AUTOMATION_DETAIL_MAX_BYTES - 1));
  });

  it('reports truncatedBytes: 0, not absent, for an in-cap detail', () => {
    const s = store();
    const id = makeArmed(s, 1_000, 1_000);
    const claim = s.claimAndOpenRun({ automationId: id, now: 2_000, occurrence: manualOccurrence() });
    if (!('runId' in claim)) throw new Error('unreachable');
    s.appendRunEvent(claim.runId, 'spawn', true, 'ok', 3_000);
    const events = s.automationRunEvents(claim.runId);
    expect(events[0]!.truncatedBytes).toBe(0);
    expect(events[0]!.detail).toBe('ok');
  });
});

describe('CoordStore: automations — reader degrades never throw', () => {
  it('a state written directly as "martian" hydrates as unknown, never throws', () => {
    const s = store();
    const t0 = 1_000;
    const { id } = s.insertAutomation(
      { name: 'x', project: 'demo', prompt: 'p', cadence: wallClock(), graceMs: 1_000 }, t0,
    );
    s.db.prepare("UPDATE automations SET state = 'martian' WHERE id = ?").run(id);
    const row = s.automation(id);
    expect(row).not.toBeNull();
    expect(row!.state).toBe('unknown');
  });

  it('an unreadable cadenceKind hydrates to the unknown arm carrying the token, is excluded from dueAutomations, and still appears in automations()', () => {
    const s = store();
    const t0 = 1_000;
    const { id } = s.insertAutomation(
      { name: 'x', project: 'demo', prompt: 'p', cadence: wallClock(), graceMs: 1_000 }, t0,
    );
    s.db.prepare(
      "UPDATE automations SET cadenceKind = 'cron', state = 'armed', provedAt = ?, nextRunAt = ? WHERE id = ?",
    ).run(t0, t0 - 1, id);
    const row = s.automation(id)!;
    expect(row.cadence).toEqual({ kind: 'unknown', token: 'cron' });
    expect(s.dueAutomations(t0)).toEqual([]);
    expect(s.automations().map((r) => r.id)).toContain(id);
  });
});

describe('CoordStore: automations — retire, never delete', () => {
  it('setAutomationState("retired") leaves every run row present', () => {
    const s = store();
    const t0 = 1_000;
    const id = makeArmed(s, t0, t0);
    const before = s.automationRuns(id).length;
    expect(s.setAutomationState(id, 'retired', t0 + 1_000)).toEqual({ ok: true, state: 'retired' });
    expect(s.automationRuns(id).length).toBe(before);
    expect(s.automation(id)!.state).toBe('retired');
    expect(s.automation(id)!.nextRunAt).toBeNull();
  });

  it('setAutomationState refuses a bad transition out of retired', () => {
    const s = store();
    const t0 = 1_000;
    const id = makeArmed(s, t0, t0);
    s.setAutomationState(id, 'retired', t0 + 1);
    expect(s.setAutomationState(id, 'paused', t0 + 2)).toEqual({ ok: false, why: 'bad-transition', from: 'retired' });
    expect(s.armAutomation(id, t0 + 3, t0 + 3)).toEqual({ ok: false, why: 'bad-transition', from: 'retired' });
  });
});

describe('CoordStore: automations — automationStats()', () => {
  it('reports the row counts', () => {
    const s = store();
    const t0 = 1_000;
    const a = makeArmed(s, t0, t0);
    const b = makeArmed(s, t0, t0);
    s.setAutomationState(b, 'retired', t0 + 10);

    const stats = s.automationStats();
    expect(stats.total).toBe(2);
    expect(stats.armed).toBe(1);
    expect(stats.retired).toBe(1);
    expect(stats.paused).toBe(0);
    expect(stats.runsTotal).toBe(2);
    expect(stats.runsEvictedTotal).toBe(0);
    expect(stats.oldestRunAt).not.toBeNull();
    expect(stats.newestRunAt).not.toBeNull();
    void a;
  });
});

describe('CoordStore: automations — openUnleasedRun (spec §7 rungs 1-2 and the past-grace occurrence)', () => {
  it('an overlap loser writes a skipped row AND still advances nextRunAt (a skip that does not consume its occurrence re-skips every tick)', () => {
    const s = store();
    const t0 = 1_000;
    const id = makeArmed(s, t0, t0);
    const before = s.automation(id)!.nextRunAt;
    const res = s.openUnleasedRun({
      automationId: id, now: t0 + 500,
      occurrence: scheduleOccurrence(t0, { at: t0 + 3_600_000 }),
      settlement: { outcome: 'skipped', refusal: 'overlap' },
    });
    if ('refused' in res) throw new Error('unreachable');
    expect(res.outcome).toBe('skipped');
    const run = s.automationRun(res.runId)!;
    expect(run.outcome).toBe('skipped');
    expect(run.refusal).toBe('overlap');
    expect(s.automation(id)!.nextRunAt).toBe(t0 + 3_600_000);
    expect(s.automation(id)!.nextRunAt).not.toBe(before);
  });

  it('a cap-concurrency loser writes a refused row', () => {
    const s = store();
    const t0 = 1_000;
    const id = makeArmed(s, t0, t0);
    const res = s.openUnleasedRun({
      automationId: id, now: t0 + 500,
      occurrence: scheduleOccurrence(t0, { at: t0 + 3_600_000 }),
      settlement: { outcome: 'refused', refusal: 'cap-concurrency' },
    });
    if ('refused' in res) throw new Error('unreachable');
    const run = s.automationRun(res.runId)!;
    expect(run.outcome).toBe('refused');
    expect(run.refusal).toBe('cap-concurrency');
  });

  it('a past-grace occurrence writes a missed row with no refusal', () => {
    const s = store();
    const t0 = 1_000;
    const id = makeArmed(s, t0, t0);
    const res = s.openUnleasedRun({
      automationId: id, now: t0 + 500,
      occurrence: scheduleOccurrence(t0, { at: t0 + 3_600_000 }),
      settlement: { outcome: 'missed' },
    });
    if ('refused' in res) throw new Error('unreachable');
    const run = s.automationRun(res.runId)!;
    expect(run.outcome).toBe('missed');
    expect(run.refusal).toBeNull();
  });
});

describe('CoordStore: automations — the failure ceiling (spec §8)', () => {
  it(`${AUTOMATION_FAILURE_CEILING - 1} consecutive refusals leave the automation armed; the ${AUTOMATION_FAILURE_CEILING}th pauses it with scheduleError='failure-ceiling' and nextRunAt NULL`, () => {
    const s = store();
    const t0 = 1_000;
    const id = makeArmed(s, t0, t0);
    let now = t0 + 1_000;
    for (let i = 0; i < AUTOMATION_FAILURE_CEILING - 1; i++) {
      const claim = s.claimAndOpenRun({ automationId: id, now, occurrence: manualOccurrence() });
      if (!('runId' in claim)) throw new Error('unreachable');
      s.settleAutomationRun({ runId: claim.runId, settlement: { outcome: 'failed', refusal: 'prompt-refused' }, now: now + 1 });
      now += 100;
    }
    expect(s.automation(id)!.state).toBe('armed');
    expect(s.automation(id)!.consecutiveFailures).toBe(AUTOMATION_FAILURE_CEILING - 1);

    const claim = s.claimAndOpenRun({ automationId: id, now, occurrence: manualOccurrence() });
    if (!('runId' in claim)) throw new Error('unreachable');
    const settled = s.settleAutomationRun({ runId: claim.runId, settlement: { outcome: 'failed', refusal: 'prompt-refused' }, now: now + 1 }) as SettledRun;
    expect(settled.autoPaused).toBe(true);

    const row = s.automation(id)!;
    expect(row.state).toBe('paused');
    expect(row.scheduleError).toBe('failure-ceiling');
    expect(row.nextRunAt).toBeNull();
    expect(row.consecutiveFailures).toBe(AUTOMATION_FAILURE_CEILING);
  });

  it("the operator's own pause does not disarm their schedules — a refusal is not a failure of the automation", () => {
    // Spec §8 states a PRINCIPLE, not a list: "`skipped` does not count — it
    // is not a failure of the automation, it is the lease working." The map
    // already extends it past the spec's literal example to `missed` and
    // `unknown` on that same reasoning. `refused` collapses SEVEN post-claim
    // conditions into one increment, and most of them are not the automation:
    // `coordinator-paused` and `automations-paused` are the OPERATOR'S OWN
    // switches, `registry-unmeasurable` is an unreachable fleet box,
    // `no-placeable-account`/`account-pressed`/`cap-concurrency` are fleet
    // capacity, and `failure-ceiling` is circular — counting it drives the
    // counter past its own ceiling for ever.
    //
    // Counting them means an operator who pauses the fleet for three of an
    // automation's occurrences comes back to a schedule that has DISARMED
    // itself, with `scheduleError='failure-ceiling'` blaming the automation for
    // the operator's own switch. Nothing was spawned, nothing was prompted;
    // there is no failure to count. `unknown-project` is the one refusal that
    // IS the automation's own configuration, so it is the one that still
    // counts, and the fixture below asserts that half too — a map that ignored
    // everything would pass the first half while asserting nothing.
    const s = store();
    const t0 = 1_000;
    const id = makeArmed(s, t0, t0);
    let now = t0 + 1_000;
    for (let i = 0; i < AUTOMATION_FAILURE_CEILING + 1; i++) {
      const claim = s.claimAndOpenRun({ automationId: id, now, occurrence: manualOccurrence() });
      if (!('runId' in claim)) throw new Error('unreachable');
      s.settleAutomationRun({
        runId: claim.runId, settlement: { outcome: 'refused', refusal: 'coordinator-paused' }, now: now + 1,
      });
      now += 100;
    }
    const row = s.automation(id)!;
    expect(row.consecutiveFailures, "the operator's pause is not the automation's failure").toBe(0);
    expect(row.state, 'an operator pause must not disarm the schedule').toBe('armed');
    expect(row.scheduleError).toBeNull();

    // The other direction: a refusal that IS the automation's own configuration.
    const bad = s.claimAndOpenRun({ automationId: id, now, occurrence: manualOccurrence() });
    if (!('runId' in bad)) throw new Error('unreachable');
    s.settleAutomationRun({
      runId: bad.runId, settlement: { outcome: 'refused', refusal: 'unknown-project' }, now: now + 1,
    });
    expect(s.automation(id)!.consecutiveFailures,
      "a project the box does not know IS the automation's own defect").toBe(1);
  });

  it('skipped and missed do not move the counter; an ok resets it; armAutomation clears it', () => {
    const s = store();
    const t0 = 1_000;
    const id = makeArmed(s, t0, t0);

    s.openUnleasedRun({
      automationId: id, now: t0 + 100, occurrence: scheduleOccurrence(t0, { at: t0 + 200 }),
      settlement: { outcome: 'skipped', refusal: 'overlap' },
    });
    s.openUnleasedRun({
      automationId: id, now: t0 + 300, occurrence: scheduleOccurrence(t0 + 200, { at: t0 + 400 }),
      settlement: { outcome: 'missed' },
    });
    expect(s.automation(id)!.consecutiveFailures).toBe(0);

    const failClaim = s.claimAndOpenRun({ automationId: id, now: t0 + 500, occurrence: manualOccurrence() });
    if (!('runId' in failClaim)) throw new Error('unreachable');
    s.settleAutomationRun({ runId: failClaim.runId, settlement: { outcome: 'failed', refusal: 'prompt-refused' }, now: t0 + 501 });
    expect(s.automation(id)!.consecutiveFailures).toBe(1);

    const armed = s.armAutomation(id, t0 + 10_000, t0 + 502);
    expect(armed).toEqual({ ok: true, nextRunAt: t0 + 10_000 });
    expect(s.automation(id)!.consecutiveFailures).toBe(0);

    // An `ok` also resets a nonzero counter (reached without re-arming).
    const failClaim2 = s.claimAndOpenRun({ automationId: id, now: t0 + 600, occurrence: manualOccurrence() });
    if (!('runId' in failClaim2)) throw new Error('unreachable');
    s.settleAutomationRun({ runId: failClaim2.runId, settlement: { outcome: 'failed', refusal: 'prompt-refused' }, now: t0 + 601 });
    expect(s.automation(id)!.consecutiveFailures).toBe(1);
    const okClaim = s.claimAndOpenRun({ automationId: id, now: t0 + 700, occurrence: manualOccurrence() });
    if (!('runId' in okClaim)) throw new Error('unreachable');
    s.settleAutomationRun({ runId: okClaim.runId, settlement: { outcome: 'ok' }, now: t0 + 701 });
    expect(s.automation(id)!.consecutiveFailures).toBe(0);
  });
});

describe('CoordStore: automations — the two-way null pairs (global constraint 9)', () => {
  it('spawnRc and homeScore distinguish UNMEASURED (null) from a measured zero, each written and read back apart', () => {
    const s = store();
    const t0 = 1_000;
    const id = makeArmed(s, t0, t0);
    const claim = s.claimAndOpenRun({ automationId: id, now: t0 + 1, occurrence: manualOccurrence() });
    if (!('runId' in claim)) throw new Error('unreachable');

    expect(s.automationRun(claim.runId)!.spawnRc).toBeNull();
    expect(s.automationRun(claim.runId)!.homeScore).toBeNull();

    s.markRunHomeScore(claim.runId, 0);
    expect(s.automationRun(claim.runId)!.homeScore).toBe(0);
    expect(s.automationRun(claim.runId)!.spawnRc).toBeNull();

    s.markAutomationSpawn({ runId: claim.runId, spawnRc: 0, identity: { bound: false } });
    expect(s.automationRun(claim.runId)!.spawnRc).toBe(0);
  });
});

describe('CoordStore: automations — the four cadence columns have exactly one reader', () => {
  // The same shape `single-definition.test.ts` uses for the rest of this
  // codebase's enumerated values — kept in THIS file rather than that one,
  // Task 4's own file scope.
  const ROOTS = [
    path.join(ccrcRoot, 'shared'),
    path.join(ccrcRoot, 'server', 'src'),
    path.join(ccrcRoot, 'pwa', 'src'),
    path.join(ccrcRoot, 'agent', 'src'),
  ];
  const ALLOW = new Set([
    'shared/schedule.ts', 'shared/api.ts',
    'server/src/coord/schema.ts', 'server/src/coord/store.ts',
  ]);

  function sources(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      if (e.startsWith('__')) continue;
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { out.push(...sources(p)); continue; }
      if (/\.tsx?$/.test(p)) out.push(p);
    }
    return out;
  }

  it('cadenceDays / cadenceMinute / cadenceEvery appear, under the four source roots, only in the four allowed files', () => {
    // `server/test` is deliberately NOT one of the scanned roots (this file's
    // own raw-SQL fixtures above name these columns to hit them directly).
    const names = ['cadenceDays', 'cadenceMinute', 'cadenceEvery'];
    const offenders: string[] = [];
    for (const p of ROOTS.flatMap(sources)) {
      const rel = path.relative(ccrcRoot, p).split(path.sep).join('/');
      if (ALLOW.has(rel)) continue;
      const text = readFileSync(p, 'utf8');
      if (names.some((n) => text.includes(n))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

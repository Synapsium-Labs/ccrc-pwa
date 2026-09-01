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
import { AUTOMATION_DETAIL_MAX_BYTES, AUTOMATION_FAILURE_CEILING } from '../../shared/api.js';
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

  it('renewAutomationLease moves leaseUntil only, leaves leaseHardUntil byte-identical, and returns false once the lease is gone', () => {
    const s = store();
    const t0 = 1_700_000_000_000;
    const id = makeArmed(s, t0, t0);
    const claim = s.claimAndOpenRun({ automationId: id, now: t0 + 1, occurrence: manualOccurrence() });
    if (!('runId' in claim)) throw new Error('unreachable');

    const before = s.automation(id)!;
    expect(s.renewAutomationLease(id, t0 + 2)).toBe(true);
    const after = s.automation(id)!;
    expect(after.leaseHardUntil).toBe(before.leaseHardUntil);
    expect(after.leaseUntil).toBe(t0 + 2 + 120_000);
    expect(after.leaseUntil).not.toBe(before.leaseUntil);

    s.settleAutomationRun({ runId: claim.runId, settlement: { outcome: 'ok' }, now: t0 + 3 });
    expect(s.renewAutomationLease(id, t0 + 4)).toBe(false);
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

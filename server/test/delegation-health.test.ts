// Delegation broker wave 3, Task 13: the seven-day observation health (spec §7 stage 2: "7 days; < 1% of session-hours with an
// `unmeasured` interval"; plan Task 13 steps 2, 3 and 7; W3-M57, W3-M58, W3-M68).
//
// The health is computed from ONE source: the interval rows the CHECKPOINT owns (`DelegationCheckpointV1.observationIntervals`). Never
// from SQLite, which is repairable output and carries no interval at all. These rows hold the arithmetic (pure), the rolling window,
// the interval upkeep (retention and the hour that was never closed), and the durability of an interval across a restart and a lost
// `coord.db`. Every file is in a FIXTURE directory: nothing here reads or writes the live `~/.ccrc`.
//
//   W3-M57  render old fleet, unavailable registry, missing capability, recovery failure, zero denominator or an incomplete window
//           as zero/healthy                                              -> 'unavailable' table
//   W3-M58  make 1.00% eligible or 0.99% ineligible                      -> 'strict threshold' table
//   W3-M68  derive health only from SQLite, or lose an unmeasured session-hour on restart -> 'checkpoint-interval restart' table
import { afterEach, describe, it, expect } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  DELEGATION_EVENTS_CAP,
  DELEGATION_HEALTH_WINDOW_HOURS,
  DELEGATION_HOUR_MS,
  DELEGATION_INTERVAL_RETENTION_HOURS,
  delegationCapabilityState,
  delegationHealthInputOf,
  delegationHealthWindowOf,
  delegationObservationHealthOf,
  emptyDelegationCheckpoint,
  formatDelegationInstant,
  upkeepDelegationIntervals,
  type DelegationCheckpointV1,
  type DelegationObservationInterval,
} from '../src/coord/delegation-model.js';
import { DelegationDurability, type DelegationProjectionPort } from '../src/coord/delegation-checkpoint.js';
import type { DelegationHealthInput } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = Date.UTC(2026, 9, 15, 10, 30, 0);                    // 2026-10-15T10:30Z: the hour 10:00 is still open
const NOW_HOUR = Date.UTC(2026, 9, 15, 10, 0, 0);
const WINDOW_START = NOW_HOUR - DELEGATION_HEALTH_WINDOW_HOURS * DELEGATION_HOUR_MS;
const iso = (ms: number): string => formatDelegationInstant(ms);
const hourAt = (back: number): string => iso(NOW_HOUR - back * DELEGATION_HOUR_MS);     // back=1 is the last COMPLETE hour

const iv = (back: number, state: 'measured' | 'unmeasured', session = 's1', inc = 'g1', over: Partial<DelegationObservationInterval> = {}): DelegationObservationInterval => ({
  sessionId: session, parentIncarnation: inc, utcHour: hourAt(back), state, detail: state === 'measured' ? null : 'range-unreadable: x',
  recordedAt: iso(NOW_HOUR - (back - 1) * DELEGATION_HOUR_MS + 5 * 60_000), ...over,
});
/** A complete window of `sessions` sessions, every hour recorded, the first `unmeasured` of them unmeasured. */
function grid(sessions: number, unmeasured: number): DelegationObservationInterval[] {
  const out: DelegationObservationInterval[] = [];
  let left = unmeasured;
  for (let s = 0; s < sessions; s++) {
    for (let back = 1; back <= DELEGATION_HEALTH_WINDOW_HOURS; back++) {
      out.push(iv(back, left > 0 ? 'unmeasured' : 'measured', `s${s}`));
      if (left > 0) left--;
    }
  }
  return out;
}
const cpWith = (intervals: readonly DelegationObservationInterval[], over: Partial<DelegationCheckpointV1> = {}): DelegationCheckpointV1 =>
  ({ ...emptyDelegationCheckpoint(), revision: 7, observationIntervals: intervals, ...over });
const okInput = (over: Partial<DelegationHealthInput> = {}): DelegationHealthInput => ({
  windowStartedAt: iso(WINDOW_START), windowEndedAt: iso(NOW_HOUR), windowComplete: true, measuredSessionHours: 9901, unmeasuredSessionHours: 99,
  capabilityState: 'present', registryReadable: true, recoveryPhase: 'ready', circuitBreaker: 'clear', unresolved: 0, conflicting: 0, unmeasured: 0,
  lastJournalSequence: 3, lastCheckpointRevision: 7, lastIngestedAt: iso(NOW), ...over,
});
const COUNTS = { unresolved: 0, conflicting: 0, unmeasured: 0 };
const inputFrom = (cp: DelegationCheckpointV1 | null, over: Partial<Parameters<typeof delegationHealthInputOf>[0]> = {}): DelegationHealthInput =>
  delegationHealthInputOf({
    nowMs: NOW, state: cp === null ? null : { checkpoint: cp, phase: 'ready' }, capabilityState: 'present', registryReadable: true,
    circuitBreaker: 'clear', verdictCounts: COUNTS, ...over,
  });

// ── the capability word ───────────────────────────────────────────────────────────────────────────────────────────────

describe('the capability state: present, absent, or unmeasured, never a guess', () => {
  it('spells the one wave-3 capability', () => {
    expect(DELEGATION_EVENTS_CAP).toBe('delegation-events-v1');
  });
  it('a list from `ccd caps` is present or absent; no list, or a list that is not a `ccd caps` answer, is unmeasured', () => {
    expect(delegationCapabilityState(['caps', 'ws-rm', DELEGATION_EVENTS_CAP])).toBe('present');
    expect(delegationCapabilityState(['caps', 'ws-rm'])).toBe('absent');                     // an old fleet: the list is measured and lacks the token
    expect(delegationCapabilityState(null)).toBe('unmeasured');                              // never read
    expect(delegationCapabilityState(undefined)).toBe('unmeasured');
    expect(delegationCapabilityState([])).toBe('unmeasured');                                // an agent whose boot read of `ccd caps` failed seeds []
    expect(delegationCapabilityState(['ws-rm'])).toBe('unmeasured');                         // no `caps` token: not an answer from `ccd caps`
    expect(delegationCapabilityState([DELEGATION_EVENTS_CAP])).toBe('present');              // the token alone is evidence it is offered
  });
});

// ── the rolling seven-day UTC session-hour window ─────────────────────────────────────────────────────────────────────

describe('the rolling window: 168 complete UTC hours ending at the start of the current hour', () => {
  it('spans exactly seven days of whole hours and excludes the open hour', () => {
    const w = delegationHealthWindowOf(grid(1, 0), NOW);
    expect(w.windowStartedAt).toBe(iso(WINDOW_START));
    expect(w.windowEndedAt).toBe(iso(NOW_HOUR));
    expect(Date.parse(w.windowEndedAt) - Date.parse(w.windowStartedAt)).toBe(7 * 24 * DELEGATION_HOUR_MS);
    expect(w.complete).toBe(true);
    expect(w).toMatchObject({ measuredSessionHours: 168, unmeasuredSessionHours: 0 });
    // the open hour (10:00) is not a session-hour of the window, measured or not
    const withOpen = [...grid(1, 0), iv(0, 'unmeasured')];
    expect(delegationHealthWindowOf(withOpen, NOW)).toMatchObject({ measuredSessionHours: 168, unmeasuredSessionHours: 0, complete: true });
  });

  it('counts one session-hour per (session, incarnation, hour), measured or unmeasured', () => {
    const rows = [...grid(2, 5), iv(3, 'measured', 's0', 'g2')];                // a second incarnation of s0 in one hour
    const w = delegationHealthWindowOf(rows, NOW);
    expect(w.measuredSessionHours + w.unmeasuredSessionHours).toBe(2 * 168 + 1);
    expect(w.unmeasuredSessionHours).toBe(5);
  });

  it('is incomplete when ANY hour of the window has no row at all (the lane did not run), however many hours do', () => {
    const rows = grid(3, 0).filter((r) => r.utcHour !== hourAt(40));
    expect(delegationHealthWindowOf(rows, NOW).complete).toBe(false);
    expect(delegationHealthWindowOf([], NOW).complete).toBe(false);
    // one session's rows cover each hour, so the others' gaps do not matter
    const sparse = [...grid(1, 0), ...grid(3, 0).filter((r) => r.sessionId !== 's0' && r.utcHour > hourAt(100))];
    expect(delegationHealthWindowOf(sparse, NOW).complete).toBe(true);
  });

  it('is incomplete when the history does not reach the window start (a young basis), and rows older than the window do not count', () => {
    const young = grid(1, 0).filter((r) => r.utcHour >= hourAt(100));
    expect(delegationHealthWindowOf(young, NOW).complete).toBe(false);
    const old = [...grid(1, 0), iv(DELEGATION_HEALTH_WINDOW_HOURS + 1, 'unmeasured'), iv(DELEGATION_HEALTH_WINDOW_HOURS + 5, 'unmeasured')];
    expect(delegationHealthWindowOf(old, NOW)).toMatchObject({ measuredSessionHours: 168, unmeasuredSessionHours: 0, complete: true });
  });

  it('a row whose hour is not a canonical hour boundary cannot be placed, so it makes the window incomplete rather than vanishing', () => {
    for (const utcHour of ['2026-10-14T05:30:00.000Z', 'yesterday', '2026-10-14T05:00:00Z']) {
      const rows = [...grid(1, 0), iv(5, 'measured', 'odd', 'g1', { utcHour })];
      expect(delegationHealthWindowOf(rows, NOW).complete, utcHour).toBe(false);
    }
  });

  it('rolls: an hour later the oldest hour leaves and the newest enters', () => {
    const rows = grid(1, 0);
    const later = delegationHealthWindowOf(rows, NOW + DELEGATION_HOUR_MS);
    expect(later.windowEndedAt).toBe(iso(NOW_HOUR + DELEGATION_HOUR_MS));
    expect(later.complete).toBe(false);                                       // the hour 10:00 has no row yet
    expect(later.measuredSessionHours).toBe(167);
  });
});

// ── W3-M58: the strict threshold ──────────────────────────────────────────────────────────────────────────────────────

describe('W3-M58 strict threshold: 0.99% is eligible, exactly 1.00% is not', () => {
  it('99 of 10000 session-hours (0.99%) is eligible; 100 of 10000 (exactly 1.00%) is ineligible; 101 is ineligible', () => {
    const at = (unmeasured: number) => delegationObservationHealthOf(okInput({ measuredSessionHours: 10000 - unmeasured, unmeasuredSessionHours: unmeasured }));
    expect(at(99)).toMatchObject({ stageGate: 'eligible', unmeasuredRate: 0.0099 });
    expect(at(100)).toMatchObject({ stageGate: 'ineligible', unmeasuredRate: 0.01 });
    expect(at(101)).toMatchObject({ stageGate: 'ineligible' });
    expect(at(0)).toMatchObject({ stageGate: 'eligible', unmeasuredRate: 0 });
  });

  it('the comparison is exact in integers for every denominator (no float rounding can move the edge)', () => {
    for (const total of [100, 101, 168, 1000, 4200, 9999, 10000, 10001, 33333, 100000]) {
      for (const k of [Math.floor(total / 100) - 1, Math.floor(total / 100), Math.floor(total / 100) + 1, Math.ceil(total / 100)]) {
        if (k < 0 || k > total) continue;
        const h = delegationObservationHealthOf(okInput({ measuredSessionHours: total - k, unmeasuredSessionHours: k }));
        expect(h.stageGate, `${k} of ${total}`).toBe(k * 100 < total ? 'eligible' : 'ineligible');
      }
    }
  });

  it('the same edge through the window: 41 of 4200 is eligible, exactly 42 of 4200 (1.00%) is not', () => {
    const gate = (unmeasured: number) => delegationObservationHealthOf(inputFrom(cpWith(grid(25, unmeasured)))).stageGate;
    expect(gate(41)).toBe('eligible');
    expect(gate(42)).toBe('ineligible');
    expect(gate(43)).toBe('ineligible');
  });

  it('the rate is reported as measured, not rounded to look better', () => {
    expect(delegationObservationHealthOf(okInput({ measuredSessionHours: 3, unmeasuredSessionHours: 1 })).unmeasuredRate).toBe(0.25);
  });
});

// ── W3-M57: unavailable is unmeasured, never zero or healthy ──────────────────────────────────────────────────────────

describe('W3-M57 unavailable: every unavailable basis is unmeasured, never zero and never healthy', () => {
  const cases: Array<[string, Partial<DelegationHealthInput>]> = [
    ['an incomplete window', { windowComplete: false }],
    ['a zero denominator', { measuredSessionHours: 0, unmeasuredSessionHours: 0 }],
    ['an old fleet (the capability is absent)', { capabilityState: 'absent' }],
    ['a missing capability (never measured)', { capabilityState: 'unmeasured' }],
    ['an unavailable registry', { registryReadable: false }],
    ['a recovery failure (the applier is reconstructing)', { recoveryPhase: 'reconstructing' }],
  ];
  for (const [name, over] of cases) {
    it(`${name} is unmeasured: the gate is unmeasured and the rate is null, not 0`, () => {
      const h = delegationObservationHealthOf(okInput(over));
      expect(h.stageGate).toBe('unmeasured');
      expect(h.unmeasuredRate).toBeNull();
      expect(h.mode).toBe('report-only');
    });
    it(`${name} stays unmeasured even when every counted hour is measured (a perfect-looking basis is not a measured one)`, () => {
      const h = delegationObservationHealthOf(okInput({ measuredSessionHours: 10000, unmeasuredSessionHours: 0, ...over }));
      expect(h.stageGate, 'never eligible').toBe('unmeasured');
      expect(h.unmeasuredRate).toBeNull();
    });
  }

  it('the same inputs with every basis measured ARE eligible (the table above is not vacuous)', () => {
    expect(delegationObservationHealthOf(okInput({ measuredSessionHours: 10000, unmeasuredSessionHours: 0 })).stageGate).toBe('eligible');
  });

  it('an unavailable basis from the ASSEMBLY is unmeasured too: no state at all, a reconstructing applier, a young checkpoint', () => {
    expect(delegationObservationHealthOf(inputFrom(null))).toMatchObject({ stageGate: 'unmeasured', unmeasuredRate: null, circuitBreaker: 'unmeasured' });
    const reconstructing = delegationHealthInputOf({
      nowMs: NOW, state: { checkpoint: cpWith(grid(2, 0)), phase: 'reconstructing' }, capabilityState: 'present', registryReadable: true,
      circuitBreaker: 'clear', verdictCounts: COUNTS,
    });
    expect(reconstructing).toMatchObject({ recoveryPhase: 'reconstructing', windowComplete: false, measuredSessionHours: 0, unmeasuredSessionHours: 0 });
    expect(delegationObservationHealthOf(reconstructing)).toMatchObject({ stageGate: 'unmeasured', unmeasuredRate: null, circuitBreaker: 'unmeasured' });
    expect(delegationObservationHealthOf(inputFrom(cpWith([])))).toMatchObject({ stageGate: 'unmeasured' });
    expect(delegationObservationHealthOf(inputFrom(cpWith(grid(3, 0)), { capabilityState: 'absent' }))).toMatchObject({ stageGate: 'unmeasured' });
    expect(delegationObservationHealthOf(inputFrom(cpWith(grid(3, 0)), { registryReadable: false }))).toMatchObject({ stageGate: 'unmeasured' });
  });

  it('a recovery that is not ready never reports a circuit breaker it could not measure', () => {
    expect(delegationObservationHealthOf(okInput({ recoveryPhase: 'reconstructing', circuitBreaker: 'clear' })).circuitBreaker).toBe('unmeasured');
    expect(delegationObservationHealthOf(okInput({ circuitBreaker: 'suspended' })).circuitBreaker).toBe('suspended');
  });
});

describe('the assembled health carries the checkpoint\'s own anchors and the pass\'s verdict counts', () => {
  it('takes lastJournalSequence and lastCheckpointRevision from the checkpoint, and null for a checkpoint nothing was ever applied to', () => {
    const cp = cpWith(grid(1, 0), { appliedJournalSequence: 12, appliedJournalId: 'a'.repeat(64), appliedJournalDigest: 'b'.repeat(64), revision: 9 });
    expect(inputFrom(cp)).toMatchObject({ lastJournalSequence: 12, lastCheckpointRevision: 9 });
    expect(inputFrom(cpWith([], { revision: 0 }))).toMatchObject({ lastJournalSequence: null, lastCheckpointRevision: null });
  });

  it('lastIngestedAt is the latest time an interval was recorded', () => {
    const rows = [iv(5, 'measured', 's1', 'g1', { recordedAt: '2026-10-10T00:00:00.000Z' }), iv(4, 'measured', 's1', 'g1', { recordedAt: '2026-10-11T00:00:00.000Z' })];
    expect(inputFrom(cpWith(rows)).lastIngestedAt).toBe('2026-10-11T00:00:00.000Z');
    expect(inputFrom(cpWith([])).lastIngestedAt).toBeNull();
  });

  it('passes the verdict counts and the breaker through, and answers in the wire shape', () => {
    const h = delegationObservationHealthOf(inputFrom(cpWith(grid(2, 0)), { verdictCounts: { unresolved: 3, conflicting: 1, unmeasured: 2 }, circuitBreaker: 'suspended' }));
    expect(h).toMatchObject({ mode: 'report-only', unresolved: 3, conflicting: 1, unmeasured: 2, circuitBreaker: 'suspended', stageGate: 'eligible' });
    expect(Object.keys(h).sort()).toEqual([
      'circuitBreaker', 'conflicting', 'lastCheckpointRevision', 'lastIngestedAt', 'lastJournalSequence', 'measuredSessionHours', 'mode',
      'stageGate', 'unmeasured', 'unmeasuredRate', 'unmeasuredSessionHours', 'unresolved', 'windowEndedAt', 'windowStartedAt',
    ]);
  });
});

// ── interval upkeep: retention and the hour that was never closed ─────────────────────────────────────────────────────

describe('interval upkeep: at least seven complete days are kept, and an hour the lane never closed becomes a gap', () => {
  it('keeps every interval of the window and one more day, and drops what is older', () => {
    expect(DELEGATION_INTERVAL_RETENTION_HOURS).toBeGreaterThanOrEqual(DELEGATION_HEALTH_WINDOW_HOURS + 24);
    const rows = [iv(1, 'measured'), iv(DELEGATION_HEALTH_WINDOW_HOURS, 'measured'), iv(DELEGATION_INTERVAL_RETENTION_HOURS, 'measured'), iv(DELEGATION_INTERVAL_RETENTION_HOURS + 1, 'unmeasured'), iv(DELEGATION_INTERVAL_RETENTION_HOURS + 40, 'measured')];
    const out = upkeepDelegationIntervals(rows, NOW);
    expect(out.changed).toBe(true);
    expect(out.intervals.map((r) => r.utcHour)).toEqual([hourAt(1), hourAt(DELEGATION_HEALTH_WINDOW_HOURS), hourAt(DELEGATION_INTERVAL_RETENTION_HOURS)]);
  });

  it('a window of rows survives upkeep unchanged and the SAME array comes back (no needless checkpoint rewrite)', () => {
    const rows = grid(2, 3);
    const out = upkeepDelegationIntervals(rows, NOW);
    expect(out.changed).toBe(false);
    expect(out.intervals).toBe(rows);
  });

  it('a measured hour whose recording predates its close, and whose bucket is gone, is an unmeasured hour: it can never be proved whole', () => {
    // Recorded mid-hour (the lane saw the session at 25 minutes past), the hour closed, and the lane never read it again.
    const open = iv(30, 'measured', 'gone', 'g1', { recordedAt: iso(NOW_HOUR - 30 * DELEGATION_HOUR_MS + 25 * 60_000) });
    const closed = iv(30, 'measured', 'whole', 'g1', { recordedAt: iso(NOW_HOUR - 29 * DELEGATION_HOUR_MS + 5 * 60_000) });
    const out = upkeepDelegationIntervals([open, closed], NOW);
    expect(out.changed).toBe(true);
    const gone = out.intervals.find((r) => r.sessionId === 'gone')!;
    expect(gone).toMatchObject({ state: 'unmeasured', utcHour: open.utcHour, recordedAt: iso(NOW) });
    expect(gone.detail).toMatch(/^hour-never-closed/);
    expect(out.intervals.find((r) => r.sessionId === 'whole')).toEqual(closed);
  });

  it('a recent unclosed hour is left alone (the lane still has the bucket and will close it)', () => {
    const recent = iv(3, 'measured', 'live', 'g1', { recordedAt: iso(NOW_HOUR - 3 * DELEGATION_HOUR_MS + 25 * 60_000) });
    expect(upkeepDelegationIntervals([recent], NOW).changed).toBe(false);
  });

  it('an unmeasured hour is final: upkeep never touches it, and it is never turned back into a measured one', () => {
    const gap = iv(40, 'unmeasured', 'x', 'g1', { recordedAt: iso(NOW_HOUR - 40 * DELEGATION_HOUR_MS + 25 * 60_000) });
    const out = upkeepDelegationIntervals([gap], NOW);
    expect(out.changed).toBe(false);
    expect(out.intervals[0]).toEqual(gap);
  });

  it('is deterministic and order-independent', () => {
    const rows = [iv(30, 'measured', 'a', 'g1', { recordedAt: iso(NOW_HOUR - 30 * DELEGATION_HOUR_MS + 25 * 60_000) }), iv(DELEGATION_INTERVAL_RETENTION_HOURS + 3, 'measured', 'b'), iv(5, 'measured', 'c')];
    const forward = upkeepDelegationIntervals(rows, NOW).intervals;
    const backward = upkeepDelegationIntervals([...rows].reverse(), NOW).intervals;
    expect(JSON.stringify([...forward].sort((x, y) => (x.sessionId < y.sessionId ? -1 : 1)))).toBe(JSON.stringify([...backward].sort((x, y) => (x.sessionId < y.sessionId ? -1 : 1))));
  });
});

// ── W3-M68: the health basis is the checkpoint's, and survives a restart and a lost SQLite ────────────────────────────

describe('W3-M68 checkpoint-interval restart table: an unmeasured session-hour is durable, and SQLite cannot erase it', () => {
  const live: DelegationDurability[] = [];
  afterEach(async () => { await Promise.all(live.splice(0).map((d) => d.close().catch(() => undefined))); });

  const portOf = (store: CoordStore): DelegationProjectionPort =>
    ({ project: (cp) => store.projectDelegationCheckpoint(cp), insertEvents: (rows) => store.insertDelegationEvents(rows), eventStats: () => store.delegationEventStats() });
  async function open(dir: string, store: CoordStore | null, edge?: (edge: string, when: 'before' | 'after') => void): Promise<DelegationDurability> {
    const d = await DelegationDurability.open({
      dir, projection: store === null ? null : portOf(store), now: () => NOW, randomUUID: () => '5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5f',
      ...(edge === undefined ? {} : { onEdge: edge as never }),
    });
    live.push(d);
    return d;
  }
  const intervalOnly = (interval: DelegationObservationInterval) => ({ accepted: [], cursor: null, interval });
  /** Bulk rows in ONE checkpoint replacement (what the lane's upkeep uses); the rows that matter for durability go through `applyAccepted`. */
  const seedBulk = (d: DelegationDurability, rows: readonly DelegationObservationInterval[]) =>
    d.applyCheckpointChange((cp) => ({ ...cp, observationIntervals: rows }));
  const healthOf = (d: DelegationDurability) => delegationObservationHealthOf(delegationHealthInputOf({
    nowMs: NOW, state: d.state(), capabilityState: 'present', registryReadable: true, circuitBreaker: 'clear', verdictCounts: COUNTS,
  }));

  it('an interval is checkpoint-owned: it survives a restart byte for byte, and so does the health computed from it', async () => {
    const dir = mkTmp('ccrc-dh-');
    const store = new CoordStore(openCoordDb(path.join(dir, 'coord.db')));
    const d = await open(dir, store);
    const rows = grid(2, 3);
    await seedBulk(d, rows.slice(3));
    for (const row of rows.slice(0, 3)) await d.applyAccepted(intervalOnly(row));      // the three unmeasured rows, through the ingestion door
    const before = healthOf(d);
    expect(before).toMatchObject({ stageGate: 'eligible', measuredSessionHours: 2 * 168 - 3, unmeasuredSessionHours: 3 });
    await d.close();
    const again = await open(dir, store);
    expect(again.state().checkpoint.observationIntervals).toHaveLength(2 * 168);
    expect(healthOf(again)).toEqual(before);
  });

  it('a lost coord.db does not erase the health basis: the rows come back from the checkpoint alone, and SQLite never held them', async () => {
    const dir = mkTmp('ccrc-dh-');
    const first = new CoordStore(openCoordDb(path.join(dir, 'coord.db')));
    const d = await open(dir, first);
    const rows = grid(1, 2);
    await seedBulk(d, rows.slice(2));
    for (const row of rows.slice(0, 2)) await d.applyAccepted(intervalOnly(row));
    const before = healthOf(d);
    await d.close();
    // The projection carries no interval at all: this is why a SQLite-only reader cannot supply the health.
    expect(first.readDelegationProjection().observationIntervals).toEqual([]);
    rmSync(path.join(dir, 'coord.db'));
    rmSync(path.join(dir, 'coord.db-wal'), { force: true });
    rmSync(path.join(dir, 'coord.db-shm'), { force: true });
    const fresh = new CoordStore(openCoordDb(path.join(dir, 'coord.db')));
    const again = await open(dir, fresh);
    expect(healthOf(again)).toEqual(before);
    expect(again.state().checkpoint.observationIntervals.filter((r) => r.state === 'unmeasured')).toHaveLength(2);
    // And with no projection port at all.
    const bare = await open(dir, null);
    expect(healthOf(bare)).toEqual(before);
  });

  it('an unmeasured hour persists across a restart, and a later measured read of the same hour cannot erase it (the gap is sticky)', async () => {
    const dir = mkTmp('ccrc-dh-');
    const d = await open(dir, null);
    const gap = iv(5, 'unmeasured', 's1', 'g1', { detail: 'directory-unreadable: the owner spool directory could not be listed', recordedAt: iso(NOW - 60_000) });
    await d.applyAccepted(intervalOnly(gap));
    await d.close();
    const again = await open(dir, null);
    await again.applyAccepted(intervalOnly(iv(5, 'measured', 's1', 'g1', { recordedAt: iso(NOW) })));
    expect(again.state().checkpoint.observationIntervals).toEqual([gap]);
  });

  it('an interval is durable exactly when the checkpoint replacement is: a crash before the rename loses it, after the rename keeps it', async () => {
    const dir = mkTmp('ccrc-dh-');
    const crash = (at: 'checkpoint-rename', when: 'before' | 'after') => (edge: string, w: 'before' | 'after'): void => {
      if (edge === at && w === when) throw new Error(`crash ${when} ${at}`);
    };
    const row = iv(5, 'unmeasured', 's1', 'g1', { detail: 'capability-absent: x' });
    const before = await open(dir, null, crash('checkpoint-rename', 'before'));
    await expect(before.applyAccepted(intervalOnly(row))).rejects.toThrow('crash before checkpoint-rename');
    const survivor = await open(dir, null);
    expect(survivor.state().checkpoint.observationIntervals).toEqual([]);
    const after = await open(dir, null, crash('checkpoint-rename', 'after'));
    await expect(after.applyAccepted(intervalOnly(row))).rejects.toThrow('crash after checkpoint-rename');
    const kept = await open(dir, null);
    expect(kept.state().checkpoint.observationIntervals).toEqual([row]);
  });

  it('retention goes through the checkpoint too: pruned hours stay pruned after a restart, and the window is untouched', async () => {
    const dir = mkTmp('ccrc-dh-');
    const d = await open(dir, null);
    const rows = [...grid(1, 1), iv(DELEGATION_INTERVAL_RETENTION_HOURS + 10, 'unmeasured', 'old')];
    await seedBulk(d, rows.slice(1));
    await d.applyAccepted(intervalOnly(rows[0]!));
    expect(d.state().checkpoint.observationIntervals).toHaveLength(169);
    const up = upkeepDelegationIntervals(d.state().checkpoint.observationIntervals, NOW);
    await d.applyCheckpointChange((cp) => ({ ...cp, observationIntervals: up.intervals }));
    await d.close();
    const again = await open(dir, null);
    expect(again.state().checkpoint.observationIntervals).toHaveLength(168);
    expect(healthOf(again)).toMatchObject({ measuredSessionHours: 167, unmeasuredSessionHours: 1, stageGate: 'eligible' });
  });
});

// ── scope: the health reads the checkpoint, and only the checkpoint ───────────────────────────────────────────────────

describe('scope: the health assembly reads no SQLite reader and no clock of its own', () => {
  const src = readFileSync(path.resolve(__dirname, '../src/coord/delegation-model.ts'), 'utf8');
  const health = src.slice(src.indexOf('THE OBSERVATION HEALTH'));
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('the health section exists and names no SQLite reader, store or Date', () => {
    expect(health.length).toBeGreaterThan(500);
    const code = strip(health);
    expect(code).not.toMatch(/readDelegationProjection|delegationEventStats|CoordStore|node:sqlite|DatabaseSync|Date\.now|new Date\(/);
  });
});

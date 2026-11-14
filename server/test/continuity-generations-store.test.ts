// Overlord W1a, the generations (Task 1): `continuity_generations` and `continuity_cursor`, their compare-and-set writes,
// the two state columns and the walk that chooses between them (reviews 1896 R1, 1902 F1), the one accessor for the
// effective state (review 1902 F6), the hold-off's frame (review 1902 F4), and the `continuity` row on the Shadow lanes card.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { laneArmViewOf } from '../src/coord/laneArm.js';
import {
  effectiveGeneration, genExpectOf, genViewOf, type GenRow, type MintInput,
} from '../src/continuity/continuityStore.js';
import { GEN_ACTIVE, GEN_MINTED, type GenView } from '../src/continuity/generationMachine.js';
import { HOLD_OFF_MS, STATE_DEADLINE_S } from '../../shared/continuity.js';
import { CONTINUITY_LANE, LANE_ARM_LANES, LANE_ARM_TEXT } from '../../shared/lane-arm.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const ID = 'lane-a-project-a';
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-gens-'), '.ccrc', 'coord.db')));

let reports = 0;
/** A recorded start, so a generation's `startId` names a real row. */
const startOf = (s: CoordStore, source = 'clear', reportedAt = NOW): number => {
  reports += 1;
  const r = s.insertStart({ sessionId: ID, reportId: `r-${reports}`, uuid: '11111111-2222-3333-4444-555555555555', source,
    model: 'claude-opus-5-5', rowIncarnation: null, reportedAt, receivedAt: reportedAt });
  if (!r.ok) throw new Error('start not recorded');
  return r.id;
};
const mintIn = (startId: number, over: Partial<MintInput> = {}): MintInput => ({
  identity: ID, sessionId: ID, role: 'coordinator', term: 1, rowIncarnation: null, startId, startReportedAt: NOW,
  resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000, proc: 'p1', now: NOW, ...over,
});
const live = (s: CoordStore): GenRow[] => { const r = s.liveGenerations(); if (!r.ok) throw new Error(r.detail); return r.rows; };
const only = (s: CoordStore): GenRow => { const rows = live(s); expect(rows).toHaveLength(1); return rows[0]!; };
const all = (s: CoordStore): Record<string, unknown>[] =>
  s.db.prepare('SELECT id, n, state, shadowState, walk, outcome, deadlineAt, shadowDeadlineAt FROM continuity_generations ORDER BY id').all() as Record<string, unknown>[];
const view = (over: Partial<GenView>): GenView => ({ ...GEN_ACTIVE, ...over });

describe('continuity_generations: the migration and its seed', () => {
  it('the slot is the one that creates both tables, and the seed row is `continuity` = shadow', () => {
    const slot = MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE continuity_generations'));
    expect(slot).toBeGreaterThan(MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE continuity_starts')));
    expect(MIGRATIONS[slot]).toContain('CREATE TABLE continuity_cursor');
    const s = store();
    expect(s.laneArmSetting(CONTINUITY_LANE)).toMatchObject({ kind: 'row', choice: 'shadow', updatedAt: 0 });
  });

  it('the Shadow lanes card lists the new lane, after the roster card, with its words', () => {
    expect(LANE_ARM_LANES).toEqual(['roster-card', 'continuity']);
    const s = store();
    const v = laneArmViewOf((lane) => s.laneArmSetting(lane));
    expect(v.lanes.map((l) => [l.lane, l.stored, l.live])).toEqual([['roster-card', 'shadow', false], ['continuity', 'shadow', false]]);
    expect(LANE_ARM_TEXT.rows[CONTINUITY_LANE].legend).toBe('Renew long-lived sessions');
  });
});

describe('mintGeneration', () => {
  it('live: the first mint is n=1 at `carded`, its deadline set from STATE_DEADLINE_S, the shadow column empty', () => {
    const s = store();
    expect(s.mintGeneration(mintIn(startOf(s)), null, true)).toEqual({ ok: true, id: 1, n: 1 });
    const r = only(s);
    expect(r).toMatchObject({ n: 1, state: 'carded', shadowState: null, walk: 'live', proven: false, enteredAt: NOW,
      deadlineAt: NOW + STATE_DEADLINE_S.carded * 1_000, shadowDeadlineAt: null, mintedObservedMs: 0 });
    expect(r.observed).toEqual({ ms: 0, mono: 1_000, proc: 'p1' });
  });

  it('shadow: a mint writes `state` active and `shadowState` carded, and its deadline never stands on `state`', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, false);
    expect(only(s)).toMatchObject({ state: 'active', shadowState: 'carded', walk: 'shadow', deadlineAt: null,
      shadowDeadlineAt: NOW + STATE_DEADLINE_S.carded * 1_000 });
  });

  it('ends the live row with its outcome and inserts the next, and the accumulator carries across the mint', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, true);
    const one = only(s);
    s.advanceObserved(one.id, genExpectOf(one), { ms: 42_000, mono: 43_000, proc: 'p1' });
    const after = only(s);
    expect(s.mintGeneration(mintIn(startOf(s), { outcome: 'woken', mono: 99_000, proc: 'p2' }), genExpectOf(after), true))
      .toEqual({ ok: true, id: 2, n: 2 });
    expect(all(s)).toEqual([
      { id: 1, n: 1, state: 'ended', shadowState: null, walk: null, outcome: 'woken', deadlineAt: null, shadowDeadlineAt: null },
      { id: 2, n: 2, state: 'carded', shadowState: null, walk: 'live', outcome: null, deadlineAt: NOW + 45_000, shadowDeadlineAt: null },
    ]);
    expect(only(s)).toMatchObject({ mintedObservedMs: 42_000, observed: { ms: 42_000, mono: 99_000, proc: 'p2' }, prevModel: 'claude-opus-5-5' });
  });

  it('is one transaction: a failed insert leaves the old row live and unchanged, and nothing new', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, true);
    const before = all(s);
    const one = only(s);
    s.db.exec("CREATE TRIGGER fail_mint BEFORE INSERT ON continuity_generations BEGIN SELECT RAISE(ABORT, 'forced'); END");
    expect(s.mintGeneration(mintIn(startOf(s)), genExpectOf(one), true)).toEqual({ ok: false, kind: 'write-failed' });
    expect(all(s)).toEqual(before);
  });

  it('a second live row for one identity is refused by the partial unique index', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, true);
    const second = startOf(s);
    expect(() => s.db.prepare("INSERT INTO continuity_generations (identity, sessionId, role, term, n, state, enteredAt, resumed, startId, "
      + "startReportedAt, observed, mintedObservedMs) VALUES (?, ?, 'coordinator', 1, 2, 'active', 0, 0, ?, 0, '{}', 0)").run(ID, ID, second))
      .toThrow(/UNIQUE/);
  });

  it('a stale expectation, a live row the caller did not read, and a start minted twice all answer superseded', () => {
    const s = store();
    const first = startOf(s);
    s.mintGeneration(mintIn(first), null, true);
    const one = only(s);
    expect(s.mintGeneration(mintIn(startOf(s)), null, true)).toEqual({ ok: false, kind: 'superseded' });
    expect(s.mintGeneration(mintIn(startOf(s)), { ...genExpectOf(one), n: 7 }, true)).toEqual({ ok: false, kind: 'superseded' });
    expect(s.mintGeneration(mintIn(startOf(s)), { ...genExpectOf(one), state: 'active' }, true)).toEqual({ ok: false, kind: 'superseded' });
    expect(s.mintGeneration(mintIn(first), genExpectOf(one), true)).toEqual({ ok: false, kind: 'superseded' });
    expect(only(s).id).toBe(one.id);
  });

  it('advances the cursor in the same transaction, and a cursor that moved meanwhile undoes the mint', () => {
    const s = store();
    const a = startOf(s);
    expect(s.mintGeneration(mintIn(a), null, true, { lane: 'generations', from: 0, to: a })).toMatchObject({ ok: true });
    expect(s.generationsCursor('generations')).toEqual({ ok: true, lastStartId: a });
    const one = only(s);
    const b = startOf(s);
    expect(s.mintGeneration(mintIn(b), genExpectOf(one), true, { lane: 'generations', from: 0, to: b })).toEqual({ ok: false, kind: 'superseded' });
    expect(only(s).id).toBe(one.id);
    expect(s.generationsCursor('generations')).toEqual({ ok: true, lastStartId: a });
  });
});

describe('the walk (ruling F1): a column is decided per walk, not per pass', () => {
  it('a live walk finishes on `state` after the row drops to shadow, and leaves no deadline on an active row', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, true);
    let r = only(s);
    expect(s.stepGeneration(r.id, genExpectOf(r), view({ state: 'probing', proven: false }), false, NOW + 1_000)).toEqual({ changed: true });
    r = only(s);
    expect(r).toMatchObject({ state: 'probing', shadowState: null, walk: 'live', deadlineAt: NOW + 1_000 + STATE_DEADLINE_S.probing * 1_000 });
    expect(s.stepGeneration(r.id, genExpectOf(r), GEN_ACTIVE, false, NOW + 2_000)).toEqual({ changed: true });
    expect(only(s)).toMatchObject({ state: 'active', shadowState: null, walk: null, deadlineAt: null, shadowDeadlineAt: null });
  });

  it('a mint in shadow over a row on a live walk mints live, so the walk goes on in `state`', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, true);
    let r = only(s);
    s.stepGeneration(r.id, genExpectOf(r), view({ state: 'probing' }), true, NOW);
    r = only(s);
    s.db.prepare('UPDATE continuity_generations SET state = ?, walk = ? WHERE id = ?').run('clearing', 'live', r.id);
    r = only(s);
    s.mintGeneration(mintIn(startOf(s), { outcome: 'renewed' }), genExpectOf(r), false);
    expect(only(s)).toMatchObject({ n: 2, state: 'carded', shadowState: null, walk: 'live' });
  });

  it('in shadow a step moves `shadowState` only; a shadow walk keeps its column after the row goes live', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, false);
    let r = only(s);
    expect(s.stepGeneration(r.id, genExpectOf(r), view({ state: 'probing', proven: false }), false, NOW + 1_000)).toEqual({ changed: true });
    r = only(s);
    expect(r).toMatchObject({ state: 'active', shadowState: 'probing', walk: 'shadow', deadlineAt: null,
      shadowDeadlineAt: NOW + 1_000 + STATE_DEADLINE_S.probing * 1_000 });
    s.stepGeneration(r.id, genExpectOf(r), view({ state: 'degraded', proven: false }), true, NOW + 2_000);
    expect(only(s)).toMatchObject({ state: 'active', shadowState: 'degraded', walk: null, deadlineAt: null, shadowDeadlineAt: null });
  });

  it('live, a shadow walk\'s residue is cleared and nothing of it reaches `state`', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, false);
    const r = only(s);
    expect(effectiveGeneration(r, true)).toMatchObject({ state: 'carded', column: 'shadowState', shadowResidue: true });
    expect(s.clearShadowWalk(r.id, genExpectOf(r), NOW + 5)).toEqual({ changed: true });
    const c = only(s);
    expect(c).toMatchObject({ state: 'active', shadowState: null, walk: null, shadowDeadlineAt: null, proven: true });
    expect(effectiveGeneration(c, true)).toEqual({ state: 'active', deadlineAt: null, column: 'state', shadowResidue: false });
    expect(genViewOf(c, true)).toEqual(GEN_ACTIVE);
  });

  it('a live walk is never cleared as residue', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, true);
    const r = only(s);
    expect(effectiveGeneration(r, false)).toMatchObject({ state: 'carded', column: 'state', shadowResidue: false });
    expect(s.clearShadowWalk(r.id, genExpectOf(r), NOW)).toEqual({ changed: false });
  });
});

describe('stepGeneration: deadlines are set once, on entry (ruling I2)', () => {
  it('a step that stays in `carded` (the re-nudge) or in `probing` (the second round) leaves the deadline as it was', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, true);
    let r = only(s);
    s.stepGeneration(r.id, genExpectOf(r), { ...GEN_MINTED, renudged: true }, true, NOW + 20_000);
    r = only(s);
    expect(r).toMatchObject({ state: 'carded', renudged: true, deadlineAt: NOW + 45_000, enteredAt: NOW });
    s.stepGeneration(r.id, genExpectOf(r), view({ state: 'probing', proven: false }), true, NOW + 30_000);
    r = only(s);
    const probingDeadline = NOW + 30_000 + STATE_DEADLINE_S.probing * 1_000;
    expect(r.deadlineAt).toBe(probingDeadline);
    s.stepGeneration(r.id, genExpectOf(r), view({ state: 'probing', proven: false, probeRounds: 1 }), true, NOW + 90_000);
    expect(only(s)).toMatchObject({ state: 'probing', probeRounds: 1, deadlineAt: probingDeadline });
  });

  it('writes the machine\'s counters, hostEnded and proven included, so a restart resumes them from the row', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, true);
    const r = only(s);
    s.db.prepare("UPDATE continuity_generations SET state = 'clearing' WHERE id = ?").run(r.id);
    const c = only(s);
    s.stepGeneration(c.id, genExpectOf(c), view({ state: 'clearing', tries: 2, cls: 'hard', hostEnded: true, proven: false }), true, NOW);
    expect(genViewOf(only(s), true)).toEqual({ state: 'clearing', tries: 2, cls: 'hard', renudged: false, probeRounds: 0, hostEnded: true, proven: false });
  });

  it('refuses `ended` (only a mint ends a generation) and a stale expectation', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, true);
    const r = only(s);
    expect(s.stepGeneration(r.id, genExpectOf(r), view({ state: 'ended' }), true, NOW)).toEqual({ changed: false });
    expect(s.stepGeneration(r.id, { ...genExpectOf(r), state: 'active' }, GEN_ACTIVE, true, NOW)).toEqual({ changed: false });
    expect(only(s).state).toBe('carded');
  });
});

describe('the due columns, the accumulator and the hold-off', () => {
  it('a due generation keeps the time it became due; not due clears it; `blind` is always written', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, false);
    let r = only(s);
    expect(s.setGenerationDue(r.id, genExpectOf(r), { due: true, why: 'hard-cap', cls: 'hard', at: NOW + 10, observedMs: 500 }, ['not-local']))
      .toEqual({ changed: true });
    r = only(s);
    s.setGenerationDue(r.id, genExpectOf(r), { due: true, why: 'two-compactions', cls: 'soft', at: NOW + 99, observedMs: 900 }, []);
    r = only(s);
    expect(r).toMatchObject({ dueSince: NOW + 10, dueWhy: 'two-compactions', dueClass: 'soft', dueSinceObservedMs: 500, blind: [] });
    s.setGenerationDue(r.id, genExpectOf(r), { due: false }, ['hard-cap']);
    expect(only(s)).toMatchObject({ dueSince: null, dueWhy: null, dueClass: null, dueSinceObservedMs: null, blind: ['hard-cap'] });
  });

  it('the hold-off is stored absolute on the accumulator (review 1902 F4)', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, true);
    const r = only(s);
    s.advanceObserved(r.id, genExpectOf(r), { ms: 70_000, mono: 5, proc: 'p1' });
    const a = only(s);
    expect(s.setHoldOff(a.id, genExpectOf(a))).toEqual({ changed: true });
    expect(only(s).holdOffUntilObservedMs).toBe(70_000 + HOLD_OFF_MS);
  });

  it('every write is a compare-and-set: a stale expectation changes nothing', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, true);
    const r = only(s);
    const stale = { ...genExpectOf(r), n: 2 };
    expect(s.advanceObserved(r.id, stale, { ms: 1, mono: 1, proc: 'p1' })).toEqual({ changed: false });
    expect(s.setGenerationDue(r.id, stale, { due: false }, ['hard-cap'])).toEqual({ changed: false });
    expect(s.setHoldOff(r.id, stale)).toEqual({ changed: false });
    expect(only(s)).toMatchObject({ observed: { ms: 0 }, blind: null, holdOffUntilObservedMs: null });
  });

  it('the cursor starts at 0 and moves only from what the caller read', () => {
    const s = store();
    expect(s.generationsCursor('generations')).toEqual({ ok: true, lastStartId: 0 });
    expect(s.advanceCursor({ lane: 'generations', from: 0, to: 5 })).toEqual({ changed: true });
    expect(s.advanceCursor({ lane: 'generations', from: 0, to: 9 })).toEqual({ changed: false });
    expect(s.advanceCursor({ lane: 'generations', from: 5, to: 9 })).toEqual({ changed: true });
    expect(s.generationsCursor('generations')).toEqual({ ok: true, lastStartId: 9 });
  });

  it('a row this build cannot read fails the whole read', () => {
    const s = store();
    s.mintGeneration(mintIn(startOf(s)), null, true);
    s.db.prepare("UPDATE continuity_generations SET state = 'resting'").run();
    expect(s.liveGenerations()).toMatchObject({ ok: false });
  });
});

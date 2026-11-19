// Characterization of the continuity doors' live-generation reader (Overlord W1 ladder, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-ladder.md` Task 3 Step 1, question 18, ruled F11). It pins the reader's
// answers as designation A left them, before the reader moves out of the routes file, so the move is behaviour-neutral:
// the move commit changes only this file's import. `continuity-notes-route.test.ts` pins the note doors' unmeasured arms
// beside it.
import { describe, expect, it } from 'vitest';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import type { CONTINUITY_LANE } from '../../shared/lane-arm.js';
import type { GenRow, GenerationsRead } from '../src/continuity/continuityStore.js';
import type { LaneArmRead } from '../src/coord/laneArm.js';
import { designationReadOf, liveGenerationOf } from '../src/continuity/liveGeneration.js';

const row = (over: Partial<GenRow>): GenRow => ({
  id: 7, identity: 'lane-a-demo', sessionId: 'lane-a-demo', role: 'session', term: 0, rowIncarnation: null, n: 1,
  state: 'active', shadowState: null, walk: null, walkClass: null, enteredAt: 1, deadlineAt: null, shadowDeadlineAt: null,
  dueSince: null, dueWhy: null, dueClass: null, dueSinceObservedMs: null, proven: false, renudged: false, probeRounds: 0,
  hostEnded: false, blind: null, model: null, prevModel: null, lane: null, host: null, prevLane: null, cardHash: null,
  snapshotId: null, attempts: 0, outcome: null, resumed: false, startId: 1, startReportedAt: 1,
  observed: {} as GenRow['observed'], mintedObservedMs: 1, softRenewalObservedMs: null, holdOffUntilObservedMs: null,
  ...over,
} as GenRow);

const designated = (sessionId: string): DesignationRead =>
  ({ kind: 'designated', sessionId, term: 3, row: { pending: null } } as unknown as DesignationRead);

interface World {
  gens?: GenerationsRead;
  designation?: DesignationRead | 'throws';
  arm?: LaneArmRead;
}
const coordOf = (w: World) => ({
  liveGenerations: (): GenerationsRead => w.gens ?? { ok: true, rows: [] },
  designationRead: (): DesignationRead => {
    if (w.designation === 'throws') throw new Error('locked');
    return w.designation ?? { kind: 'not-designated', row: null };
  },
  laneArmSetting: (): LaneArmRead => w.arm ?? { kind: 'absent' },
});
const open = (_lane: typeof CONTINUITY_LANE): string | null => null;
const live: LaneArmRead = { kind: 'row', choice: 'live', updatedAt: 1, importedAt: null, imported: null };

describe('liveGenerationOf: the identity\'s live generation, as the continuity doors read it', () => {
  it('no live row for the identity: no-generation', () => {
    expect(liveGenerationOf(coordOf({}), 'lane-a-demo')).toBe('no-generation');
    expect(liveGenerationOf(coordOf({ gens: { ok: true, rows: [row({ identity: 'lane-b-demo' })] } }), 'lane-a-demo')).toBe('no-generation');
  });

  it('an unreadable generations read: unmeasured', () => {
    expect(liveGenerationOf(coordOf({ gens: { ok: false, detail: 'locked' } }), 'lane-a-demo')).toBe('unmeasured');
  });

  it('an unmeasured or throwing designation read: unmeasured, even with a matching row', () => {
    const gens: GenerationsRead = { ok: true, rows: [row({})] };
    expect(liveGenerationOf(coordOf({ gens, designation: { kind: 'unmeasured', why: 'bad row' } }), 'lane-a-demo')).toBe('unmeasured');
    expect(liveGenerationOf(coordOf({ gens, designation: 'throws' }), 'lane-a-demo')).toBe('unmeasured');
    expect(designationReadOf(coordOf({ designation: 'throws' }))).toBe('unmeasured');
  });

  it('the bound Overlord is found under the identity `overlord`, and another session under its own id', () => {
    const gens: GenerationsRead = { ok: true, rows: [row({ id: 1, identity: 'overlord', sessionId: 'overlord-abc' }), row({ id: 2 })] };
    const bound = liveGenerationOf(coordOf({ gens, designation: designated('overlord-abc') }), 'overlord-abc');
    expect(bound).toMatchObject({ row: { id: 1 }, state: 'active' });
    const other = liveGenerationOf(coordOf({ gens, designation: designated('overlord-abc') }), 'lane-a-demo');
    expect(other).toMatchObject({ row: { id: 2 } });
    // Not designated: the Overlord's session id is its own identity, so the `overlord` row is not it.
    expect(liveGenerationOf(coordOf({ gens }), 'overlord-abc')).toBe('no-generation');
  });

  it('a degraded live row reads degraded', () => {
    const gens: GenerationsRead = { ok: true, rows: [row({ state: 'degraded', walk: 'live' })] };
    expect(liveGenerationOf(coordOf({ gens }), 'lane-a-demo')).toMatchObject({ state: 'degraded' });
  });

  it('the continuity lane decides which column is read: shadow while disarmed, the state while armed', () => {
    const gens: GenerationsRead = { ok: true, rows: [row({ state: 'active', shadowState: 'degraded', walk: null })] };
    // Disarmed (no row, or the gate closed): the shadow column.
    expect(liveGenerationOf(coordOf({ gens }), 'lane-a-demo', open)).toMatchObject({ state: 'degraded' });
    expect(liveGenerationOf(coordOf({ gens, arm: live }), 'lane-a-demo', () => 'not yet')).toMatchObject({ state: 'degraded' });
    // Armed with its gate open: the state column.
    expect(liveGenerationOf(coordOf({ gens, arm: live }), 'lane-a-demo', open)).toMatchObject({ state: 'active' });
  });
});

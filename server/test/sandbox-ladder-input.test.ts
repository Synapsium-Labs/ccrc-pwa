// The ladder's `launch-profile-unengaged` row (W1 sandbox PR B, Task 8; spec Table 7.5a, §11.2 step 6): its input reads the
// designated body's newest `startup` or `resume` start by its own report through `profileEngagedOf`. Not engaged stands; no
// designation lifts; an unreadable read, or a store without the read, is unmeasured, and both apply the effect: the gate
// order's step 6 (`launch-profile-unmet`) reads it from `readBy`.
import { describe, expect, it } from 'vitest';
import { LADDER_CAUSE_MAP } from '../../shared/overlord-ladder.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import { effectiveRung } from '../src/coord/overlordLadder.js';
import { ladderConditionInputs } from '../src/coord/overlordLadderRead.js';
import type { NewestStartLoadsRead } from '../src/continuity/continuityStore.js';
import { expectedSurfaceOf } from '../src/continuity/sandboxCheck.js';
import { heldReport, startRow } from './sim/sandboxSets.js';

const OV = 'lane-a-overlord';
const VIEW = { bound: { sessionId: OV, generation: 'g1' }, pending: null, term: 2, designatedTerm: 2, model: 'opus', accountPools: { pools: [], untagged: true },
  pastIds: [], actor: 'op', lastAttempt: null, stopsOwed: [] } as DesignationView;
const bound: DesignationRead = { kind: 'designated', sessionId: OV, term: 2, row: VIEW };
const e = expectedSurfaceOf('overlord')!;

function reading(designation: DesignationRead | 'throws', loads?: NewestStartLoadsRead | 'absent') {
  const asked: string[] = [];
  const coord = {
    designationRead: () => { if (designation === 'throws') throw new Error('locked'); return designation; },
    liveGenerations: () => ({ ok: false, detail: 'none' }), laneArmSetting: () => ({ kind: 'absent' }), ladderRungRead: () => ({ kind: 'absent' }),
    ...(loads === 'absent' ? {} : { startLoadsOfNewestStart: (id: string) => { asked.push(id); return loads ?? { ok: true, newest: null }; } }),
  } as unknown as Parameters<typeof ladderConditionInputs>[0]['coord'];
  return { value: ladderConditionInputs({ coord, serverCaps: [] })['launch-profile-unengaged'](), asked };
}
const newest = (report: ReturnType<typeof heldReport> | null): NewestStartLoadsRead =>
  ({ ok: true, newest: { start: startRow({ sessionId: OV }), report, carry: { kind: 'none' } } });

describe('the launch-profile-unengaged input (W1 sandbox B)', () => {
  it('the row is a condition read by launch-profile-unmet, with no cap', () => {
    expect(LADDER_CAUSE_MAP['launch-profile-unengaged']).toMatchObject({ kind: 'condition', effect: { kind: 'read-by', reader: 'launch-profile-unmet' }, notice: 'none' });
  });
  it('a designated body with a held newest report lifts; it asks the bound session', () => {
    const r = reading(bound, newest(heldReport(e)));
    expect(r.value).toBe('lifted');
    expect(r.asked).toEqual([OV]);
  });
  it('no start, a start with no report, and an unheld report stand', () => {
    expect(reading(bound, { ok: true, newest: null }).value).toBe('standing');
    expect(reading(bound, newest(null)).value).toBe('standing');
    expect(reading(bound, newest(heldReport(e, { launchRc: 'on' }))).value).toBe('standing');
  });
  it('no designation, or a pending one only, lifts', () => {
    expect(reading({ kind: 'not-designated', row: null }).value).toBe('lifted');
    expect(reading({ kind: 'not-designated', row: { ...VIEW, bound: null } }).value).toBe('lifted');
  });
  it('an unreadable designation, a failed read, a throw and a store without the read are unmeasured', () => {
    expect(reading({ kind: 'unmeasured', why: 'x' }).value).toBe('unmeasured');
    expect(reading(bound, { ok: false, detail: 'locked' }).value).toBe('unmeasured');
    expect(reading('throws').value).toBe('unmeasured');
    expect(reading(bound, 'absent').value).toBe('unmeasured');
  });
  it('standing or unmeasured, the gate order reads it from readBy; lifted, it is not there', () => {
    const eff = (r: 'standing' | 'lifted' | 'unmeasured') => effectiveRung({ operatorRung: { kind: 'default' }, latches: [],
      conditions: [{ cause: 'launch-profile-unengaged', reading: r }], causeTable: LADDER_CAUSE_MAP, serverCaps: [] });
    expect(eff('standing').readBy).toEqual([{ cause: 'launch-profile-unengaged', reader: 'launch-profile-unmet', reading: 'standing' }]);
    expect(eff('unmeasured').readBy).toEqual([{ cause: 'launch-profile-unengaged', reader: 'launch-profile-unmet', reading: 'unmeasured' }]);
    expect(eff('lifted').readBy).toEqual([]);
  });
});

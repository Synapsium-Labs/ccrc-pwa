// The other write lanes' decider: its oracle and mutant set (Overlord W1, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-other-lanes.md` Task 2 Step 4). The cases are written ONCE here, as
// suite cases over a module: `overlord-other-lanes.test.ts` runs them against the real module, and
// `mutation-floors.test.ts` runs them against each textual mutant.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { DesignationRead, DesignationView } from '../../../shared/overlord-designation.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export type OtherLanesModule = typeof import('../../src/coord/otherLanes.js');
const MODULE = path.join(ROOT, 'server/src/coord/otherLanes.ts');

const BODY = 'lane-a-overlord-quiet-oak';
const OLD = 'lane-a-overlord-old-elm';
const OWED = 'lane-a-overlord-owed';
const OTHER = 'lane-a-project-a-coord';

const view = (over: Partial<DesignationView> = {}): DesignationView => ({
  bound: null, pending: null, term: 7, designatedTerm: 1, model: 'opus', accountPools: { pools: [], untagged: true },
  pastIds: [], actor: 'op', lastAttempt: null, stopsOwed: [], ...over,
});
const pending = (sessionId: string, kind: 'designate' | 'rebind') =>
  ({ sessionId, kind, deadlineAt: 9, since: 1, actor: 'op', generation: null });
const bound = (sessionId: string, over: Partial<DesignationView> = {}): DesignationRead =>
  ({ kind: 'designated', sessionId, term: 7, row: view({ bound: { sessionId, generation: 'g1' }, ...over }) });
const UNMEASURED: DesignationRead = { kind: 'unmeasured', why: 'bad class word' };

export function otherLaneVerdictCases(m: OtherLanesModule): Record<string, SuiteCase> {
  const v = (lane: Parameters<OtherLanesModule['otherLaneVerdict']>[0], id: string, designation: DesignationRead,
    profile: Parameters<OtherLanesModule['otherLaneVerdict']>[2]['profile'] = 'not-read') =>
    m.otherLaneVerdict(lane, id, { designation, profile });
  return {
    'the bound body is refused, with the claimant word at run open and reclaim, the doors word elsewhere': () => {
      expect(v('claimTake', BODY, bound(BODY))).toMatchObject({ kind: 'refuse', word: 'overlord-uses-its-doors' });
      expect(v('runOpen', BODY, bound(BODY))).toMatchObject({ kind: 'refuse', word: 'overlord-not-a-coordinator' });
      expect(v('runReclaim', BODY, bound(BODY))).toMatchObject({ kind: 'refuse', word: 'overlord-not-a-coordinator' });
      expect(v('peerMail', BODY, bound(BODY))).toMatchObject({ kind: 'refuse', word: 'overlord-uses-its-doors' });
    },
    'a designate and a rebind attempt\'s pending body are refused': () => {
      expect(v('claimTake', BODY, { kind: 'not-designated', row: view({ pending: pending(BODY, 'designate') }) }))
        .toMatchObject({ kind: 'refuse' });
      expect(v('runOpen', BODY, bound(OLD, { pending: pending(BODY, 'rebind') })))
        .toMatchObject({ kind: 'refuse', word: 'overlord-not-a-coordinator' });
    },
    'a rebind\'s old bound body stays refused while the attempt is pending': () => {
      expect(v('itemRaise', OLD, bound(OLD, { pending: pending(BODY, 'rebind') }))).toMatchObject({ kind: 'refuse' });
    },
    'an id still owed its stop is refused under either measured arm; a drained past id passes': () => {
      expect(v('claimTake', OWED, bound(BODY, { stopsOwed: [OWED] }))).toMatchObject({ kind: 'refuse' });
      expect(v('claimTake', OWED, { kind: 'not-designated', row: view({ stopsOwed: [OWED] }) })).toMatchObject({ kind: 'refuse' });
      expect(v('claimTake', OWED, bound(BODY, { pastIds: [OWED] }))).toEqual({ kind: 'pass' });
    },
    'another session passes under every measured state, the term spelled as its id included': () => {
      expect(v('claimTake', OTHER, bound(BODY, { stopsOwed: [OWED], pending: pending(OLD, 'rebind') }))).toEqual({ kind: 'pass' });
      expect(v('claimTake', OTHER, { kind: 'not-designated', row: null })).toEqual({ kind: 'pass' });
      expect(v('claimTake', '7', bound(BODY))).toEqual({ kind: 'pass' });
    },
    'unmeasured refuses a caller whose profile reads overlord, cannot be read, or was not read': () => {
      for (const p of [{ kind: 'measured', word: 'overlord' }, { kind: 'unreadable', why: 'x' }, 'not-read'] as const) {
        expect(v('claimTake', OTHER, UNMEASURED, p)).toMatchObject({ kind: 'refuse', word: 'unmeasured' });
      }
    },
    'unmeasured passes a caller whose profile reads another role or is absent': () => {
      for (const p of [{ kind: 'measured', word: 'coordinator' }, { kind: 'absent' }] as const) {
        expect(v('claimTake', BODY, UNMEASURED, p)).toEqual({ kind: 'pass-unmeasured', why: 'bad class word' });
      }
    },
  };
}

const VERDICT_SET: MutantSet<OtherLanesModule> = { modulePath: MODULE, mutants: [
  { id: 'O1 unmeasured passes an overlord profile', old: "(p.kind === 'measured' && p.word === OVERLORD_PROFILE)",
    new: 'false' },
  { id: 'O2 unmeasured passes an unreadable profile', old: " || p.kind === 'unreadable'", new: '' },
  { id: 'O3 unmeasured refuses every profile', old: 'if (couldBeOverlord) {', new: 'if (true) {' },
  { id: 'O4 only the bound id matches', old: "designationFactOf(callerId, fact) !== 'none'",
    new: "designationFactOf(callerId, fact) === 'live'" },
  { id: 'O5 only the pending id matches', old: "designationFactOf(callerId, fact) !== 'none'",
    new: "designationFactOf(callerId, fact) === 'pending'" },
  { id: 'O6 the stopsOwed arm dropped', old: 'if (d.row !== null && d.row.stopsOwed.includes(callerId)) return refuse;',
    new: '' },
  { id: 'O7 run open answers the doors word', old: "runOpen: { route: 'POST /api/runs', word: CLAIMANT",
    new: "runOpen: { route: 'POST /api/runs', word: DOORS" },
  { id: 'O8 reclaim answers the doors word', old: "runReclaim: { route: 'POST /api/runs/:id/reclaim', word: CLAIMANT",
    new: "runReclaim: { route: 'POST /api/runs/:id/reclaim', word: DOORS" },
  { id: 'O9 the caller compared with the term', old: 'designationFactOf(callerId, fact)',
    new: "designationFactOf(fact.kind === 'row' ? String(fact.term) : callerId, fact)" },
  { id: 'O10 the pass arm refuses', old: "  return { kind: 'pass' };\n}", new: '  return refuse;\n}' },
  { id: 'O11 unmeasured passes without the why', old: "return { kind: 'pass-unmeasured', why: d.why };",
    new: "return { kind: 'pass' };" },
], suite: otherLaneVerdictCases };

export const OTHER_LANES_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/otherLanes.ts#otherLaneVerdict': VERDICT_SET as MutantSet<never>,
};

// ARCH-42 (#777): `CoordStore.bindingsOf` answers through the readers it replaces, and reads only what it is asked
// (D-7070). Each answer is the reader's own, so a site moved onto it reads what it read before.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { bindingsOver, childParentRead, claimantsOfSession, openRunsClaimedBy, sessionRunRead, type BindingReadPort } from '../src/coord/bindingReads.js';
import { bornIncarnation, unbornIncarnation } from '../src/coord/runBinding.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-bindings-of-'), '.ccrc', 'coord.db')));

describe('CoordStore.bindingsOf (ARCH-42)', () => {
  it('answers what each reader answers, worker and claimant alike', () => {
    const s = store();
    const a = (s.openRun({ program: 'p1', title: 'a', project: 'p', wave: 1, waveOf: null, claimedBy: 'coord' }) as { id: number }).id;
    const b = (s.openRun({ program: 'p2', title: 'b', project: 'p', wave: 1, waveOf: null, claimedBy: 'w' }) as { id: number }).id;
    s.setSession(a, 'w', 1_000);
    const inc = unbornIncarnation('w', 'not-a-child');
    const born = bornIncarnation('w', 1_000);
    const v = s.bindingsOf('w');
    expect(v.sessionId).toBe('w');
    expect(v.worker()).toEqual(s.openRunsForSession('w'));
    expect(v.worker({ excludeRunId: a })).toEqual(s.openRunsForSession('w', a));
    expect(v.worker({ incarnation: born })).toEqual(s.openRunsForSession('w', undefined, born));
    expect(v.claimant()).toEqual(openRunsClaimedBy(s, 'w'));
    expect(v.claimant()).toMatchObject({ ok: true, siblings: [{ id: b }] });
    expect(v.parent('coord', inc)).toEqual(childParentRead(s, 'w', 'coord', inc));
    expect(v.card(inc)).toEqual(sessionRunRead(s, 'w', inc));
    expect(v.claimants()).toEqual(claimantsOfSession(s, 'w'));
    expect(v.claimants(born)).toEqual(claimantsOfSession(s, 'w', born));
  });

  it('reads nothing until asked, and forwards only the arguments given', () => {
    const calls: unknown[][] = [];
    const port: Pick<BindingReadPort, 'openRunsForSession' | 'bindingRunsOf'> = {
      openRunsForSession: (...args: unknown[]) => { calls.push(['open', ...args]); return { ok: true, siblings: [] }; },
      bindingRunsOf: (...args: unknown[]) => { calls.push(['series', ...args]); return { ok: true, runs: [] }; },
    };
    const v = bindingsOver(port, 'x');
    expect(calls).toEqual([]);
    v.worker();
    v.worker({ excludeRunId: 7 });
    v.claimant();
    expect(calls).toEqual([['open', 'x'], ['open', 'x', 7], ['open', 'x', undefined, undefined, 'claimant']]);
  });
});

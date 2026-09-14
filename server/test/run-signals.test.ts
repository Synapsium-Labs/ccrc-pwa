import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { DONE_AUTHORITY_CODES } from '../../shared/api.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const open = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-run-signals-'), 'coord.db')));

/** A run driven planned → dispatched through the store's own writers
 *  (`openRun` at `store.ts:598` — `{program, title, project, wave, waveOf,
 *  claimedBy}` → `{id, …} | {refused} | HoldReasonRefusal`; `markDispatched`
 *  at `store.ts:1738`, `(runId, sessionId, workspace, branch, resumed, at?)`;
 *  `advance(runId, to, causedBy)` at `store.ts:1318`). `sessionId` is the
 *  WORKER, `claimedBy` the coordinator — `runSignals` reads the former. */
function seedRun(coord: CoordStore): number {
  const opened = coord.openRun({ program: 'demo', title: 'demo', project: 'demo', wave: 1, waveOf: null, claimedBy: 'ccrc-pwa-coord' });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  coord.markDispatched(opened.id, 'demo-worker', 'worker', 'ws/worker', false);
  const adv = coord.advance(opened.id, 'dispatched', 'coordinator');
  if (!adv.ok) throw new Error(`advance refused: ${JSON.stringify(adv)}`);
  return opened.id;
}

const setEventAt = (coord: CoordStore, runId: number, toState: string, at: number): void => {
  coord.db.prepare('UPDATE run_events SET at = ? WHERE runId = ? AND toState = ? AND fromState != toState').run(at, runId, toState);
};

/** Rows in the shape ccd's `_lc_emit` really writes (measured): a swap is ONE
 *  `done` row with no tx; a hold is `hold done`, its release `release done`. */
const lifecycle = (coord: CoordStore, row: { sessionId: string; act: 'swap' | 'hold' | 'release'; at: number }): void => {
  coord.db.prepare(
    'INSERT INTO lifecycle_events (gen, ingestedAt, act, outcome, sessionId, tx, at, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('0000000000000000001', 1, row.act, 'done', row.sessionId, null, row.at, JSON.stringify(row));
};

const REFUSAL = DONE_AUTHORITY_CODES[0]!;   // the vocabulary's own first member, never a hand-spelled code

describe('CoordStore.runSignals', () => {
  it('unknown run → null', () => { expect(open().runSignals(999)).toBeNull(); });

  it('an open run has no wall time yet and firstSubmission is null', () => {
    const coord = open(); const id = seedRun(coord);
    const s = coord.runSignals(id)!;
    expect(s.dispatchedAt).toEqual(expect.any(Number));
    expect(s).toMatchObject({ closedAt: null, finalState: null, wallMs: null, activeMs: null, closeRefusals: 0, firstSubmission: null, holdMs: 0, swaps: 0, excludedUnmeasured: false });
  });

  it('a done run: wall time from dispatch to done; the WORKER\'s paired holds subtracted; swaps counted, not timed', () => {
    const coord = open(); const id = seedRun(coord);
    coord.advance(id, 'working', 'demo-worker'); coord.advance(id, 'closing', 'coordinator'); coord.advance(id, 'done', 'coordinator');
    setEventAt(coord, id, 'dispatched', 1_000_000); setEventAt(coord, id, 'done', 1_600_000);
    lifecycle(coord, { sessionId: 'demo-worker', act: 'hold', at: 1_200_000 });
    lifecycle(coord, { sessionId: 'demo-worker', act: 'release', at: 1_230_000 });
    lifecycle(coord, { sessionId: 'demo-worker', act: 'swap', at: 1_300_000 });
    lifecycle(coord, { sessionId: 'ccrc-pwa-coord', act: 'swap', at: 1_350_000 });     // the COORDINATOR's swap is not the worker's
    lifecycle(coord, { sessionId: 'demo-worker', act: 'swap', at: 1_700_000 });        // outside the window
    expect(coord.runSignals(id)).toEqual({
      runId: id, dispatchedAt: 1_000_000, closedAt: 1_600_000, finalState: 'done',
      wallMs: 600_000, holdMs: 30_000, swaps: 1, excludedUnmeasured: true, activeMs: 570_000,
      closeRefusals: 0, firstSubmission: true,
    });
  });

  it('no swap and paired holds only: excludedUnmeasured is false', () => {
    const coord = open(); const id = seedRun(coord);
    coord.advance(id, 'closing', 'coordinator'); coord.advance(id, 'done', 'coordinator');
    setEventAt(coord, id, 'dispatched', 1_000_000); setEventAt(coord, id, 'done', 1_600_000);
    lifecycle(coord, { sessionId: 'demo-worker', act: 'hold', at: 1_100_000 });
    lifecycle(coord, { sessionId: 'demo-worker', act: 'release', at: 1_150_000 });
    expect(coord.runSignals(id)).toMatchObject({ holdMs: 50_000, swaps: 0, excludedUnmeasured: false, activeMs: 550_000 });
  });

  it('an unpaired hold (no release inside the window) makes the subtraction a floor: excludedUnmeasured=true', () => {
    const coord = open(); const id = seedRun(coord);
    coord.advance(id, 'closing', 'coordinator'); coord.advance(id, 'done', 'coordinator');
    setEventAt(coord, id, 'dispatched', 1_000_000); setEventAt(coord, id, 'done', 1_600_000);
    lifecycle(coord, { sessionId: 'demo-worker', act: 'hold', at: 1_100_000 });
    lifecycle(coord, { sessionId: 'demo-worker', act: 'release', at: 1_150_000 });
    lifecycle(coord, { sessionId: 'demo-worker', act: 'hold', at: 1_500_000 });      // never released in-window
    expect(coord.runSignals(id)).toMatchObject({ holdMs: 50_000, excludedUnmeasured: true });
  });

  it('a refused wave-done — the row closeRun writes through recordRejection — is counted; firstSubmission false once done', () => {
    const coord = open(); const id = seedRun(coord);
    coord.recordRejection({ code: REFUSAL, runId: id, toId: 'demo-worker', detail: 'the tip moved' });
    expect(coord.runSignals(id)).toMatchObject({ closeRefusals: 1, firstSubmission: null });
    coord.advance(id, 'closing', 'coordinator'); coord.advance(id, 'done', 'coordinator');
    expect(coord.runSignals(id)).toMatchObject({ closeRefusals: 1, firstSubmission: false, finalState: 'done' });
  });

  it('a failed run has finalState failed and firstSubmission null', () => {
    const coord = open(); const id = seedRun(coord);
    coord.advance(id, 'failed', 'operator');
    expect(coord.runSignals(id)).toMatchObject({ finalState: 'failed', firstSubmission: null, wallMs: expect.any(Number) });
  });
});

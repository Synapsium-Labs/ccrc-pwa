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

  // R7-1's open question, answered in the fix wave and pinned here: an OPEN run
  // counts as UNSCANNED. Its window has no end to scan to, so nothing reads a
  // lifecycle row for it and `holdMs: 0, swaps: 0` are initialisers. This
  // expectation was `excludedUnmeasured: false` as the plan's Step 2 wrote it —
  // an affirmative "measured, held nothing" about a window never opened.
  it('an open run has no wall time yet, firstSubmission is null, and its UNSCANNED window says so', () => {
    const coord = open(); const id = seedRun(coord);
    const s = coord.runSignals(id)!;
    expect(s.dispatchedAt).toEqual(expect.any(Number));
    expect(s).toMatchObject({ closedAt: null, finalState: null, wallMs: null, activeMs: null, closeRefusals: 0, firstSubmission: null, holdMs: 0, swaps: 0, excludedUnmeasured: true });
  });

  // The other two windows nobody scans (R7-1). Both used to answer
  // `excludedUnmeasured: false` — the overloaded null CLAUDE.md names, because
  // "measured, no holds" and "never examined" are what §6's arm attribution
  // must tell apart.
  it('a RECONSTRUCTED run — no run_events, so no dispatched transition — is unmeasured, never a measured zero', () => {
    const coord = open(); const id = seedRun(coord);
    coord.advance(id, 'closing', 'coordinator'); coord.advance(id, 'done', 'coordinator');
    lifecycle(coord, { sessionId: 'demo-worker', act: 'hold', at: 1_100_000 });
    coord.db.prepare('DELETE FROM run_events WHERE runId = ?').run(id);   // what `reconstruct` leaves behind
    expect(coord.runSignals(id)).toMatchObject({ dispatchedAt: null, closedAt: null, wallMs: null, activeMs: null, holdMs: 0, swaps: 0, excludedUnmeasured: true });
  });

  it('a closed run whose worker is unknown (sessionId null) is unmeasured', () => {
    const coord = open(); const id = seedRun(coord);
    coord.advance(id, 'closing', 'coordinator'); coord.advance(id, 'done', 'coordinator');
    setEventAt(coord, id, 'dispatched', 1_000_000); setEventAt(coord, id, 'done', 1_600_000);
    coord.db.prepare('UPDATE runs SET sessionId = NULL WHERE id = ?').run(id);
    expect(coord.runSignals(id)).toMatchObject({ wallMs: 600_000, holdMs: 0, swaps: 0, excludedUnmeasured: true });
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

  // R7-2, the swallowed direction: ccd pairs `hold done` with the next
  // `release done`, so a SECOND hold while one is open is a fact this pairing
  // cannot model. The row used to be dropped in silence, leaving a hold total
  // that omits whatever it meant and an `excludedUnmeasured` still false.
  it('a SECOND hold while one is open flags the window; holdMs stays the first pairing, a floor', () => {
    const coord = open(); const id = seedRun(coord);
    coord.advance(id, 'closing', 'coordinator'); coord.advance(id, 'done', 'coordinator');
    setEventAt(coord, id, 'dispatched', 1_000_000); setEventAt(coord, id, 'done', 1_600_000);
    lifecycle(coord, { sessionId: 'demo-worker', act: 'hold', at: 1_100_000 });
    lifecycle(coord, { sessionId: 'demo-worker', act: 'hold', at: 1_120_000 });      // a second, while the first is open
    lifecycle(coord, { sessionId: 'demo-worker', act: 'release', at: 1_150_000 });
    expect(coord.runSignals(id)).toMatchObject({ holdMs: 50_000, swaps: 0, excludedUnmeasured: true, activeMs: 550_000 });
  });

  // R7-2, the other direction: `at IS NULL` is "ccd could not stamp the line"
  // (schema.ts), and the window query filters those rows out — so an
  // unstampable swap reported `swaps: 0` and read as measured. It is COUNTED,
  // never inferred from the filtered result set, and unbounded by the window
  // because a row with no `at` cannot be placed in time at all.
  it('a hold/release/swap row ccd could not timestamp makes the window unmeasurable', () => {
    const coord = open(); const id = seedRun(coord);
    coord.advance(id, 'closing', 'coordinator'); coord.advance(id, 'done', 'coordinator');
    setEventAt(coord, id, 'dispatched', 1_000_000); setEventAt(coord, id, 'done', 1_600_000);
    lifecycle(coord, { sessionId: 'demo-worker', act: 'hold', at: 1_100_000 });
    lifecycle(coord, { sessionId: 'demo-worker', act: 'release', at: 1_150_000 });
    expect(coord.runSignals(id)).toMatchObject({ swaps: 0, excludedUnmeasured: false });   // the control
    coord.db.prepare(
      'INSERT INTO lifecycle_events (gen, ingestedAt, act, outcome, sessionId, tx, at, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('0000000000000000002', 1, 'swap', 'done', 'demo-worker', null, null, '{}');
    expect(coord.runSignals(id)).toMatchObject({ holdMs: 50_000, swaps: 0, excludedUnmeasured: true });
  });

  // R7-3: ONE statement behind two surfaces. `GET /api/runs` ships
  // `RunHealth.doneRejects`; `GET /api/runs/:id/signals` ships
  // `closeRefusals`; both were hand-written counts of the same rows, and
  // nothing compared them. `single-definition.test.ts` cannot see this — it
  // scans for known fragments, not for a second COUNT of one table.
  it('closeRefusals and RunHealth.doneRejects are the same measurement, for the same run', () => {
    const coord = open(); const id = seedRun(coord);
    coord.recordRejection({ code: REFUSAL, runId: id, toId: 'demo-worker', detail: 'the tip moved' });
    coord.recordRejection({ code: REFUSAL, runId: id, toId: 'demo-worker', detail: 'and again' });
    const signals = coord.runSignals(id)!;
    const health = coord.runHealth([id], []).get(id)!;
    expect(signals.closeRefusals).toBe(2);
    expect(health.doneRejects).toBe(signals.closeRefusals);
    expect(health.lastRejectCode).toBe(REFUSAL);
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

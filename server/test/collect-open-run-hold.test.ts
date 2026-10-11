// Child reclamation wave 9 (spec §5.10): the open-run hold, `collectOpenRunHold`, judged on observation 2's document.
// The collector composes nothing for an id while any run could still need its temp root. The hold stands when:
//   - the witness's run is not finished;
//   - the witness's run is absent;
//   - the witness's run opened after the witness was written (run ids restart after a database loss);
//   - an open run names the id as its session or as its coordinator;
//   - a fresh collection carries no witness run;
//   - a read fails.
// A real CoordStore under a fixture HOME, and fakes for the failing reads.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type OpenSiblingsResult, type RunReadResult } from '../src/coord/store.js';
import { CHILD_BIRTH_SKEW_MS } from '../src/coord/childSpent.js';
import { collectOpenRunHold } from '../src/coord/collectTempRoot.js';
import { parseCollectAudit } from '../src/collectLane.js';
import { ID, auditDoc } from './collectTempRootFixture.js';
import { mkTmp } from './tmpHelpers.js';

const AT = 1_789_000_000_000;
type Doc = Parameters<typeof collectOpenRunHold>[2];
type HoldCoord = Parameters<typeof collectOpenRunHold>[0];
const fresh = (witnessRun: number | null, witnessAt: number | null): Doc => ({ resume: null, witnessRun, witnessAt });
const resumed = (witnessRun: number | null, witnessAt: number | null): Doc => ({ resume: 'moved', witnessRun, witnessAt });

const store = () => {
  const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-collect-hold-'), '.ccrc', 'coord.db')));
  const programs = new Map<number, string>();
  const open = (o: { readonly sessionId?: string; readonly claimedBy?: string } = {}): number => {
    const program = `w9-hold-${programs.size + 1}`;
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: o.claimedBy ?? 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    programs.set(r.id, program);
    if (o.sessionId !== undefined) coord.bindSession(r.id, o.sessionId);
    return r.id;
  };
  const close = (id: number): void => {
    const res = coord.closeRun({ runId: id, finalState: 'failed', causedBy: 'test', handoffCommit: null,
      program: programs.get(id)!, viaClosing: false });
    if (!res.ok) throw new Error(`closeRun refused: ${JSON.stringify(res)}`);
  };
  const setState = (id: number, state: string): void => { coord.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(state, id); };
  const setOpenedAt = (id: number, ms: number): void => { coord.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(ms, id); };
  /** A finished minting run, opened at `openedAt`. */
  const minting = (openedAt = AT - 1_000): number => { const id = open(); close(id); setOpenedAt(id, openedAt); return id; };
  return { coord, open, close, setState, setOpenedAt, minting };
};

describe('what the hold keys on, as the collect audit reader hands it over', () => {
  it('no resume key reads null, a resume key reads its phase, a null witness reads no run and no instant, a witness reads both as numbers, and a witness whose run is no integer is unreadable', () => {
    const w = { run: '7', at: '1789000000000' };
    expect(parseCollectAudit(ID, true, auditDoc({ witness: w }), ''))
      .toMatchObject({ kind: 'collectable', resume: null, witnessRun: 7, witnessAt: 1_789_000_000_000 });
    expect(parseCollectAudit(ID, true, auditDoc({ witness: w, resume: 'moved' }), '')).toMatchObject({ kind: 'collectable', resume: 'moved' });
    expect(parseCollectAudit(ID, true, auditDoc({ witness: null }), '')).toMatchObject({ kind: 'collectable', witnessRun: null, witnessAt: null });
    expect(parseCollectAudit(ID, true, auditDoc({ witness: { run: 'x7', at: '1789000000000' } }), '').kind,
      'a witness run that is no canonical integer').toBe('unreadable');
  });
});

describe('collectOpenRunHold — clear only when no run could still need the temp root', () => {
  it('CONTROL: the witness’s run is finished, opened before its witness, and no open run names the id', () => {
    const s = store();
    const run = s.minting();
    expect(collectOpenRunHold(s.coord, ID, fresh(run, AT))).toEqual({ kind: 'clear' });
    expect(collectOpenRunHold(s.coord, ID, resumed(run, AT)), 'a resume whose witness still stands').toEqual({ kind: 'clear' });
  });

  it.each(['done', 'failed'])('a witness run in %s is finished', (state) => {
    const s = store();
    const run = s.minting();
    s.setState(run, state);
    expect(collectOpenRunHold(s.coord, ID, fresh(run, AT))).toEqual({ kind: 'clear' });
  });

  it.each(['planned', 'dispatched', 'working', 'awaiting-review', 'merging', 'closing', 'unknown', 'x-from-a-newer-build'])(
    '(a) a witness run in %s is not finished, and holds', (state) => {
      const s = store();
      const run = s.open();
      s.setOpenedAt(run, AT - 1_000);
      if (state !== 'planned') s.setState(run, state);
      expect(collectOpenRunHold(s.coord, ID, fresh(run, AT))).toMatchObject({ kind: 'held', why: 'run-open' });
    });

  it('(b) a witness run the database does not hold holds: a lost or rebuilt database makes every run absent at once', () => {
    const s = store();
    expect(collectOpenRunHold(s.coord, ID, fresh(4242, AT))).toMatchObject({ kind: 'held', why: 'run-absent' });
    expect(collectOpenRunHold(s.coord, ID, resumed(4242, AT))).toMatchObject({ kind: 'held', why: 'run-absent' });
  });

  it('(c) a witness run opened past the witness plus the skew is not its minting run, and holds; at exactly the skew it is', () => {
    const s = store();
    const run = s.minting();
    s.setOpenedAt(run, AT + CHILD_BIRTH_SKEW_MS + 1);
    expect(collectOpenRunHold(s.coord, ID, fresh(run, AT))).toMatchObject({ kind: 'held', why: 'run-after-witness' });
    s.setOpenedAt(run, AT + CHILD_BIRTH_SKEW_MS);
    expect(collectOpenRunHold(s.coord, ID, fresh(run, AT)), 'the boundary').toEqual({ kind: 'clear' });
  });

  it('(c) a witness that names a run but carries no instant holds: whether that run handed the temp root out cannot be said', () => {
    const s = store();
    expect(collectOpenRunHold(s.coord, ID, fresh(s.minting(), null))).toMatchObject({ kind: 'held', why: 'run-after-witness' });
  });

  it('(d) an open run naming the id as its session holds, whichever run the witness names, and names that run', () => {
    const s = store();
    const run = s.minting();
    const other = s.open({ sessionId: ID });
    const h = collectOpenRunHold(s.coord, ID, fresh(run, AT));
    expect(h).toMatchObject({ kind: 'held', why: 'id-in-open-run' });
    expect(h.kind === 'held' ? h.detail : '').toContain(`#${other}`);
  });

  it('(d) an open run naming the id as its coordinator holds', () => {
    const s = store();
    const run = s.minting();
    s.open({ claimedBy: ID });
    expect(collectOpenRunHold(s.coord, ID, fresh(run, AT))).toMatchObject({ kind: 'held', why: 'id-in-open-run' });
  });

  it('(d) a finished run naming the id does not hold', () => {
    const s = store();
    const run = s.minting();
    s.close(s.open({ sessionId: ID }));
    expect(collectOpenRunHold(s.coord, ID, fresh(run, AT))).toEqual({ kind: 'clear' });
  });

  it('(d) holds a resume with no witness while an open run names the id', () => {
    const s = store();
    s.open({ sessionId: ID });
    expect(collectOpenRunHold(s.coord, ID, resumed(null, null))).toMatchObject({ kind: 'held', why: 'id-in-open-run' });
  });

  it('(e) a FRESH collectable document with no witness run holds; a resume with no witness and nothing open does not', () => {
    const s = store();
    expect(collectOpenRunHold(s.coord, ID, fresh(null, null))).toMatchObject({ kind: 'held', why: 'no-witness-run' });
    expect(collectOpenRunHold(s.coord, ID, resumed(null, null))).toEqual({ kind: 'clear' });
  });

  describe('(f) a read that fails holds, at the job as at the pass', () => {
    const failing = (over: Partial<HoldCoord>) => {
      const s = store();
      const run = s.minting();
      const coord: HoldCoord = {
        run: (id: number) => s.coord.run(id),
        openRunsForSession: (id: string) => s.coord.openRunsForSession(id),
        openRunsClaimedBy: (id: string) => s.coord.openRunsClaimedBy(id),
        ...over,
      };
      return collectOpenRunHold(coord, ID, fresh(run, AT));
    };
    it.each<[string, Partial<HoldCoord>]>([
      ['the witness run’s read', { run: (): RunReadResult => ({ ok: false, kind: 'run-unreadable', detail: 'id out of range' }) }],
      ['the session read', { openRunsForSession: (): OpenSiblingsResult => ({ ok: false, kind: 'run-unreadable', detail: 'x' }) }],
      ['the coordinator read', { openRunsClaimedBy: (): OpenSiblingsResult => ({ ok: false, kind: 'run-unreadable', detail: 'x' }) }],
      ['a read that throws', { openRunsClaimedBy: () => { throw new Error('database is locked'); } }],
    ])('%s failing holds', (_what, over) => {
      expect(failing(over)).toMatchObject({ kind: 'held', why: 'store-unreadable' });
    });
  });
});

// ARCH-60 follow-up (#1407, part of #795): which birth a later wave records for a session id. The write
// (`CoordStore.stampOccupantBirth`, through `occupantBirthOf`) stamps the newest birth on record unless another run of the
// series has the adopted shape since. The read takes no birth from it for an `unplaceable` worker: that worker keeps the
// id-string rule (round 5 of #1573: no recorded birth is provably the live occupant's own once its minting run's dispatch
// moved, so anchoring to one made the readers worse than the merge base after a cross-build rollback), and bindingOf,
// claimantsOf, boundRunsOf, openRunsForSession, sessionRunRead and withChildIds answer about the same runs.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  bindingOf, boundRunsOf, claimantsOf, incarnationOf, occupantBirthOf, parentOf, type BindingRun, type Incarnation,
} from '../src/coord/runBinding.js';
import { childBirthOf } from '../src/coord/childSpent.js';
import { incarnationsOfSessions, sessionRunRead, withChildIds } from '../src/coord/runWire.js';
import { mkTmp } from './tmpHelpers.js';

const OLD = 1_700_000_000_000;
const BORN = OLD + 5_000_000;
const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-occupant-birth-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, program: string, claimedBy: string, openedAt: number): number => {
  const id = (s.openRun({ program, title: program, project: 'p', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;
  s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(openedAt, id);
  return id;
};
const series = (s: CoordStore, session: string) => {
  const r = s.bindingRunsOf(session);
  if (!r.ok) throw new Error(r.detail);
  return r.runs;
};
const done = (s: CoordStore, id: number): void => { s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(id); };
const stampOf = (s: CoordStore, id: number) => s.db.prepare('SELECT sessionBornAt FROM runs WHERE id = ?').get(id) as { sessionBornAt: number | null };
/** The worker's incarnation as every reader builds it: from its minting run, through `childBirthOf`. */
const markedBy = (s: CoordStore, minting: number): Incarnation => incarnationOf('demo-w', childBirthOf(s.run(minting), 'demo-w'));

/** A reused name: an earlier occupant with a PLACEABLE birth (OLD = its dispatchStartedAt), then the live occupant whose
 *  minting run recorded BORN but cannot be placed (its dispatchStartedAt is null, so it never agreed with the birth:
 *  `childBirthOf`'s re-stamped arm; the adopted arm records NO birth). */
function reusedName(s: CoordStore): { earlier: number; minting: number } {
  const earlier = open(s, 'prog-old', 'coord-gone', OLD);
  s.setSession(earlier, 'demo-w', OLD);
  s.db.prepare('UPDATE runs SET dispatchStartedAt = ? WHERE id = ?').run(OLD, earlier);
  done(s, earlier);
  const minting = open(s, 'prog-new', 'coord-1', BORN - 1000);
  s.setSession(minting, 'demo-w', BORN);
  return { earlier, minting };
}

describe('the occupant\'s birth: the stamp, and an unplaceable reader that takes none of it', () => {
  it('the stamp writes the newest birth on record, over a placeable older birth and a newer unplaceable one', () => {
    const s = store();
    const { minting } = reusedName(s);
    const wave = open(s, 'prog-c', 'coord-1', BORN + 10);
    expect(occupantBirthOf(series(s, 'demo-w'), 'demo-w', wave)).toBe(BORN);
    s.setSession(wave, 'demo-w');
    expect(stampOf(s, wave).sessionBornAt).toBe(BORN);
    // The worker reads by the id-string rule (its minting run cannot be placed): the wave is its open run either way.
    const live = markedBy(s, minting);
    expect(live).toEqual({ kind: 'unborn', sessionId: 'demo-w', why: 'unplaceable' });
    expect(parentOf(bindingOf(series(s, 'demo-w'), live))).toBe('coord-1');
  });

  it('the stamp reads the same run set as the readers: a run an older build rebound away keeps a birth for the id, and the stamp does not read it', () => {
    const s = store();
    reusedName(s);
    // The rollback shape: a NEWER birth recorded for demo-w on a run whose sessionId an older build moved elsewhere
    // without touching either birth column. It is outside demo-w's series (`bindingRunsOf`: sessionId OR claimedBy).
    const rebound = open(s, 'prog-r', 'coord-x', BORN + 100);
    s.setSession(rebound, 'demo-w', BORN + 500);
    s.db.prepare("UPDATE runs SET sessionId = 'demo-other' WHERE id = ?").run(rebound);
    const before = series(s, 'demo-w');
    expect(before.map((r) => r.id)).not.toContain(rebound);
    const wave = open(s, 'prog-c', 'coord-1', BORN + 10);
    s.setSession(wave, 'demo-w');
    expect(stampOf(s, wave).sessionBornAt).toBe(BORN);
  });

  it('a wave bound to the live worker is bound and keeps its parent, with the earlier occupant\'s run no part of it', () => {
    const s = store();
    const { minting } = reusedName(s);
    done(s, minting);
    const c = open(s, 'prog-c', 'coord-1', BORN + 10);
    s.setSession(c, 'demo-w');
    const live = markedBy(s, minting);
    const binding = bindingOf(series(s, 'demo-w'), live);
    expect(binding.open?.id).toBe(c);
    expect(binding.newest?.id).toBe(c);
    expect(parentOf(binding)).toBe('coord-1');
    expect(s.openRunsForSession('demo-w', undefined, live)).toMatchObject({ ok: true, siblings: [{ id: c }] });
  });
});

describe('the adoption veto needs a run OTHER than the one being stamped (#1573 round 5, R3)', () => {
  const run = (over: Partial<BindingRun>): BindingRun => ({ id: 0, sessionId: 'demo-w', claimedBy: 'coord-1', state: 'planned',
    openedAt: OLD, sessionBornAt: null, sessionBornFor: null, dispatchStartedAt: null, ...over });
  const minted = run({ id: 2, state: 'done', sessionBornAt: BORN, sessionBornFor: 'demo-w', dispatchStartedAt: BORN });
  const attempted = run({ id: 1, dispatchStartedAt: BORN + 1000 });

  it('the run being stamped, with a failed spawn attempt after the birth, does not veto its own stamp', () => {
    expect(occupantBirthOf([attempted, minted], 'demo-w', attempted.id)).toBe(BORN);
  });

  it('another run of that shape still does (the adopted arm, D-6993)', () => {
    expect(occupantBirthOf([attempted, minted], 'demo-w', 99)).toBeNull();
  });

  it('through the store: a run planned before the birth, its spawn attempt failed after it, then rebound to the worker, is stamped and bound', () => {
    const s = store();
    const x = open(s, 'prog-x', 'coord-b', OLD);
    const m = open(s, 'prog-m', 'coord-a', BORN - 100);
    s.markDispatchStarted(m, BORN);
    s.setSession(m, 'demo-w', BORN);
    done(s, m);
    s.markDispatchStarted(x, BORN + 1000);
    s.setSession(x, 'demo-w');
    expect(stampOf(s, x).sessionBornAt).toBe(BORN);
    const live = markedBy(s, m);
    expect(live).toMatchObject({ kind: 'born', bornAt: BORN });
    expect(parentOf(bindingOf(series(s, 'demo-w'), live))).toBe('coord-b');
  });
});

// GAP 1 (unplaceable), an INHERITED residual (the plan note's "Residuals, inherited from main"): the readers agree, and
// they agree on the merge base's answer, the earlier occupant's open run (the id-string rule). The follow-up for D6 gap 1
// owns the fix. Pinned so that a change to it is a decision, and so that the readers keep answering about the same runs.
describe('every reader of the binding answers about the same runs (GAP 1 fixture: a ghost open run, the live run done; residual)', () => {
  const ghostFixture = (s: CoordStore): { ghost: number; live: number } => {
    const ghost = open(s, 'prog-old', 'coord-gone', OLD);
    s.setSession(ghost, 'demo-w', OLD);
    const live = open(s, 'prog-new', 'coord-live', BORN + 1000);
    s.setSession(live, 'demo-w', BORN);
    done(s, live);
    return { ghost, live };
  };

  it('bindingOf, claimantsOf, boundRunsOf and openRunsForSession agree: the ghost run, as on the merge base', () => {
    const s = store();
    const { ghost, live } = ghostFixture(s);
    const runs = series(s, 'demo-w');
    const inc = markedBy(s, live);
    expect(bindingOf(runs, inc).open?.id).toBe(ghost);
    expect(claimantsOf(runs, inc)).toEqual(['coord-gone']);
    expect(boundRunsOf(runs, inc, 'open').map((r) => r.id)).toEqual([ghost]);
    expect(boundRunsOf(runs, inc, 'any').map((r) => r.id)).toEqual([ghost, live]);
    expect(s.openRunsForSession('demo-w', undefined, inc)).toMatchObject({ ok: true, siblings: [{ id: ghost }] });
  });

  it('the card (sessionRunRead) and the ghost coordinator (withChildIds) agree, and the fleet reads no series per session to build the incarnation', () => {
    const s = store();
    const { ghost, live } = ghostFixture(s);
    const sessions = [{ id: 'demo-w', child: { kind: 'child', runId: live } as const }];
    // #1573 round 5 (R4): the incarnations are built from the marks alone, with no series read per session per frame.
    const incarnations = incarnationsOfSessions({ run: (id: number) => s.run(id) }, sessions);
    expect(sessionRunRead(s, 'demo-w', incarnations.get('demo-w')!)).toMatchObject({ ok: true, openRun: { id: ghost }, run: { id: live } });
    const summaries = [{ id: ghost, claimedBy: 'coord-gone' }] as never;
    const [withIds] = withChildIds(s, summaries, incarnations, () => undefined);
    expect(withIds.childIds).toEqual([ghost]);
  });
});

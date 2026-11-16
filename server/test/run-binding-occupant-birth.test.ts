// ARCH-60 follow-up (#1407, part of #795): which birth a later wave records for a session id. The write
// (`CoordStore.stampOccupantBirth`) is the merge base's, unchanged: it reads every run recording a birth for the id and
// stamps the newest PLACEABLE one, else nothing (gap 2 stays open: #1573 round 8 withdrew the fallback to an unplaceable
// birth, see the plan note); no row vetoes it. The read takes no birth from it for an `unplaceable` worker: that worker keeps the
// id-string rule (round 5 of #1573: no recorded birth is provably the live occupant's own once its minting run's dispatch
// moved, so anchoring to one made the readers worse than the merge base after a cross-build rollback), and bindingOf,
// claimantsOf, boundRunsOf, openRunsForSession, sessionRunRead and withChildIds answer about the same runs.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  bindingOf, boundRunsOf, claimantsOf, incarnationOf, parentOf, type Incarnation,
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
  it('the stamp writes the newest PLACEABLE birth, over a newer unplaceable one (the merge base\'s stamp)', () => {
    const s = store();
    const { minting } = reusedName(s);
    const wave = open(s, 'prog-c', 'coord-1', BORN + 10);
    s.setSession(wave, 'demo-w');
    expect(stampOf(s, wave).sessionBornAt).toBe(OLD);
    // The worker reads by the id-string rule (its minting run cannot be placed): the wave is its open run either way.
    const live = markedBy(s, minting);
    expect(live).toEqual({ kind: 'unborn', sessionId: 'demo-w', why: 'unplaceable' });
    expect(parentOf(bindingOf(series(s, 'demo-w'), live))).toBe('coord-1');
  });

  it('the stamp reads every run recording a birth for the id (the merge base\'s rows): a placeable birth on a run an older build rebound away still dates a later wave, and the worker born there again keeps it', () => {
    const s = store();
    reusedName(s);
    // The away-and-back shape (#1573 round 6, F2): a NEWER placeable birth recorded for demo-w on a run whose sessionId an
    // older build moved elsewhere without touching either birth column. It is outside demo-w's series (`bindingRunsOf`:
    // sessionId OR claimedBy), but the stamp reads it, as the merge base did.
    const rebound = open(s, 'prog-r', 'coord-x', BORN + 100);
    s.markDispatchStarted(rebound, BORN + 500);
    s.setSession(rebound, 'demo-w', BORN + 500);
    s.db.prepare("UPDATE runs SET sessionId = 'demo-other' WHERE id = ?").run(rebound);
    expect(series(s, 'demo-w').map((r) => r.id)).not.toContain(rebound);
    const wave = open(s, 'prog-c', 'coord-1', BORN + 10);
    s.setSession(wave, 'demo-w');
    expect(stampOf(s, wave).sessionBornAt).toBe(BORN + 500);
    // The older build moves the run back: the worker is born at that birth again, and the wave bound in between is its.
    s.db.prepare("UPDATE runs SET sessionId = 'demo-w' WHERE id = ?").run(rebound);
    const live = markedBy(s, rebound);
    expect(live).toMatchObject({ kind: 'born', bornAt: BORN + 500 });
    expect(boundRunsOf(series(s, 'demo-w'), live, 'open').map((r) => r.id)).toContain(wave);
  });

  it('with no placeable birth on record and one birth recorded for the id, no stamp: the merge base\'s answer (gap 2, a residual since #1573 round 8)', () => {
    const s = store();
    const minting = open(s, 'prog-new', 'coord-1', BORN - 1000);
    s.setSession(minting, 'demo-w', BORN);
    const wave = open(s, 'prog-c', 'coord-1', BORN + 10);
    s.setSession(wave, 'demo-w');
    // A stamp here (the withdrawn fallback) was carried onto another incarnation by an older build's rebind, or read
    // against a later same-id redraw, and made round-8 shapes worse than the merge base.
    expect(stampOf(s, wave).sessionBornAt).toBeNull();
  });

  it('with no placeable birth on record and two different births recorded for the id, no stamp: the columns cannot say which is the occupant\'s (#1573 round 6, F3)', () => {
    const s = store();
    const minting = open(s, 'prog-new', 'coord-1', BORN - 1000);
    s.setSession(minting, 'demo-w', BORN);
    const q = open(s, 'prog-q', 'coord-q', BORN + 900);
    s.setSession(q, 'demo-w', BORN + 1000);
    done(s, q);
    const wave = open(s, 'prog-c', 'coord-1', BORN + 10);
    s.setSession(wave, 'demo-w');
    expect(stampOf(s, wave).sessionBornAt).toBeNull();
    // The minting run's dispatch later moves onto its birth (a same-id redraw): the worker is born at BORN, and the
    // unstamped wave, opened after it, is its; a wave stamped with Q's birth would have read unbound.
    s.db.prepare('UPDATE runs SET dispatchStartedAt = ? WHERE id = ?').run(BORN, minting);
    const live = markedBy(s, minting);
    expect(live).toMatchObject({ kind: 'born', bornAt: BORN });
    expect(boundRunsOf(series(s, 'demo-w'), live, 'open').map((r) => r.id)).toContain(wave);
  });

  it('the dup arm rebinding the minting run back, with only a later wave\'s copy of its birth on record, writes nothing (#1573 round 6, F1)', () => {
    const s = store();
    const k = open(s, 'prog-k', 'coord-c', OLD);
    const m = open(s, 'prog-m', 'coord-a', BORN - 100);
    s.markDispatchStarted(m, BORN);
    s.setSession(m, 'demo-w', BORN);
    const l2 = open(s, 'prog-l2', 'coord-a', BORN + 50);
    s.setSession(l2, 'demo-w');
    expect(stampOf(s, l2).sessionBornAt).toBe(BORN);
    s.setSession(m, 'demo-x');                 // a retried open rebinds M away: its births are cleared
    s.setSession(k, 'demo-w');                 // the only birth on record is l2's copy, which cannot be placed
    s.setSession(m, 'demo-w');                 // the dup arm rebinds M back
    expect(stampOf(s, m).sessionBornAt).toBeNull();
    // The worker stays unplaceable, as on the merge base, so the pre-planned wave K keeps its id-string answer.
    const live = markedBy(s, m);
    expect(live).toEqual({ kind: 'unborn', sessionId: 'demo-w', why: 'unplaceable' });
    expect(claimantsOf(series(s, 'demo-w'), live)).toContain('coord-c');
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

describe('no row vetoes the stamp (#1573 round 6: an older build\'s rebind of a failed spawn)', () => {
  it('through the store: an older build rebound a failed spawn to the worker, then this build binds a pre-planned wave; it is stamped and bound', () => {
    const s = store();
    const w = open(s, 'prog-w', 'coord-c', OLD);
    const r = open(s, 'prog-r', 'coord-b', OLD + 50);
    const m = open(s, 'prog-m', 'coord-a', BORN - 100);
    s.markDispatchStarted(m, BORN);
    s.setSession(m, 'demo-w', BORN);
    done(s, m);
    s.markDispatchStarted(r, BORN + 1000);
    // The older build's rebind: it names the worker and records no birth (it cleared the births and stamped nothing).
    s.setSession(r, 'demo-w');
    s.db.prepare('UPDATE runs SET sessionBornAt = NULL, sessionBornFor = NULL WHERE id = ?').run(r);
    done(s, r);
    s.setSession(w, 'demo-w');
    expect(stampOf(s, w).sessionBornAt).toBe(BORN);
    const live = markedBy(s, m);
    expect(live).toMatchObject({ kind: 'born', bornAt: BORN });
    expect(parentOf(bindingOf(series(s, 'demo-w'), live))).toBe('coord-c');
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

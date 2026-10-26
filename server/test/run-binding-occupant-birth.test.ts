// ARCH-60 follow-up (#1407, part of #795): which birth is the occupant's of a session id. The read (`anchoredIncarnation`)
// takes only the birth the worker's OWN minting run recorded; the write (`CoordStore.stampOccupantBirth`) stamps the newest
// birth on record unless the name was adopted since. They agree on a live worker, and bindingOf, claimantsOf, boundRunsOf,
// openRunsForSession, sessionRunRead and withChildIds answer about the same occupant.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  anchoredIncarnation, bindingOf, boundRunsOf, claimantsOf, incarnationOf, occupantBirthOf, parentOf, unbornIncarnation,
  type Incarnation,
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
/** The worker's incarnation as every reader builds it: from its minting run, through `childBirthOf`. */
const markedBy = (s: CoordStore, minting: number): Incarnation => incarnationOf('demo-w', childBirthOf(s.run(minting), 'demo-w'));

/** A reused name: an earlier occupant with a PLACEABLE birth (OLD = its dispatchStartedAt), then the live occupant whose
 *  minting run recorded BORN but cannot be placed (dispatchStartedAt null: the adopted shape). */
function reusedName(s: CoordStore): { earlier: number; minting: number } {
  const earlier = open(s, 'prog-old', 'coord-gone', OLD);
  s.setSession(earlier, 'demo-w', OLD);
  s.db.prepare('UPDATE runs SET dispatchStartedAt = ? WHERE id = ?').run(OLD, earlier);
  done(s, earlier);
  const minting = open(s, 'prog-new', 'coord-1', BORN - 1000);
  s.setSession(minting, 'demo-w', BORN);
  return { earlier, minting };
}

describe('the occupant\'s birth: one rule for the stamp and the anchor', () => {
  it('the stamp writes what the anchor reads, over a placeable older birth and a newer unplaceable one', () => {
    const s = store();
    const { minting } = reusedName(s);
    const before = series(s, 'demo-w');
    const expected = occupantBirthOf(before, 'demo-w');
    expect(expected).toBe(BORN);
    const wave = open(s, 'prog-c', 'coord-1', BORN + 10);
    s.setSession(wave, 'demo-w');
    const stamped = s.db.prepare('SELECT sessionBornAt FROM runs WHERE id = ?').get(wave) as { sessionBornAt: number };
    expect(stamped.sessionBornAt).toBe(expected);
    const raw = markedBy(s, minting);
    expect(raw).toMatchObject({ kind: 'unborn', why: 'unplaceable', recordedAt: BORN });
    expect(anchoredIncarnation(raw)).toMatchObject({ kind: 'born', bornAt: expected });
  });

  it('an unplaceable incarnation whose minting run recorded no birth of its own is never anchored to a birth another run recorded', () => {
    const s = store();
    reusedName(s);
    const bare = unbornIncarnation('demo-w', 'unplaceable');
    expect(occupantBirthOf(series(s, 'demo-w'), 'demo-w')).toBe(BORN);
    expect(anchoredIncarnation(bare)).toBe(bare);
  });

  it('the stamp reads the same run set as the anchor: a run an older build rebound away keeps a birth for the id, and neither half reads it', () => {
    const s = store();
    reusedName(s);
    // The rollback shape: a NEWER birth recorded for demo-w on a run whose sessionId an older build moved elsewhere
    // without touching either birth column. It is outside demo-w's series (`bindingRunsOf`: sessionId OR claimedBy).
    const rebound = open(s, 'prog-r', 'coord-x', BORN + 100);
    s.setSession(rebound, 'demo-w', BORN + 500);
    s.db.prepare("UPDATE runs SET sessionId = 'demo-other' WHERE id = ?").run(rebound);
    const before = series(s, 'demo-w');
    expect(before.map((r) => r.id)).not.toContain(rebound);
    expect(occupantBirthOf(before, 'demo-w')).toBe(BORN);
    const wave = open(s, 'prog-c', 'coord-1', BORN + 10);
    s.setSession(wave, 'demo-w');
    const stamped = s.db.prepare('SELECT sessionBornAt FROM runs WHERE id = ?').get(wave) as { sessionBornAt: number };
    expect(stamped.sessionBornAt).toBe(BORN);
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

describe('every reader of the binding answers about the same occupant (GAP 1 fixture: a ghost open run, the live run done)', () => {
  const ghostFixture = (s: CoordStore): { ghost: number; live: number } => {
    const ghost = open(s, 'prog-old', 'coord-gone', OLD);
    s.setSession(ghost, 'demo-w', OLD);
    const live = open(s, 'prog-new', 'coord-live', BORN + 1000);
    s.setSession(live, 'demo-w', BORN);
    done(s, live);
    return { ghost, live };
  };

  it('bindingOf, claimantsOf, boundRunsOf and openRunsForSession agree there is no open run', () => {
    const s = store();
    const { live } = ghostFixture(s);
    const runs = series(s, 'demo-w');
    const inc = markedBy(s, live);
    expect(bindingOf(runs, inc).open).toBeNull();
    expect(claimantsOf(runs, inc)).toEqual([]);
    expect(boundRunsOf(runs, inc, 'open')).toEqual([]);
    expect(boundRunsOf(runs, inc, 'any').map((r) => r.id)).toEqual([live]);
    expect(s.openRunsForSession('demo-w', undefined, inc)).toMatchObject({ ok: true, siblings: [] });
  });

  it('the card (sessionRunRead) and the ghost coordinator (withChildIds) agree', () => {
    const s = store();
    const { ghost, live } = ghostFixture(s);
    const sessions = [{ id: 'demo-w', child: { kind: 'child', runId: live } as const }];
    const incarnations = incarnationsOfSessions(s, sessions);
    expect(sessionRunRead(s, 'demo-w', incarnations.get('demo-w')!)).toMatchObject({ ok: true, openRun: null, run: { id: live } });
    const summaries = [{ id: ghost, claimedBy: 'coord-gone' }] as never;
    const [withIds] = withChildIds(s, summaries, incarnations, () => undefined);
    expect(withIds.childIds).toEqual([]);
  });
});

// ARCH-60 follow-up (#1407, part of #795): ONE rule says which birth is the occupant's of a session id, and every reader of
// the binding follows it. The write (`CoordStore.stampOccupantBirth`) and the read (`anchoredIncarnation`) agree, and
// bindingOf, claimantsOf, boundRunsOf, openRunsForSession, sessionRunRead and withChildIds answer about the same occupant.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  anchoredIncarnation, bindingOf, boundRunsOf, claimantsOf, occupantBirthOf, parentOf, unbornIncarnation,
} from '../src/coord/runBinding.js';
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
const UNPLACEABLE = unbornIncarnation('demo-w', 'unplaceable');

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
    reusedName(s);
    const before = series(s, 'demo-w');
    const expected = occupantBirthOf(before, 'demo-w');
    expect(expected).toBe(BORN);
    const wave = open(s, 'prog-c', 'coord-1', BORN + 10);
    s.setSession(wave, 'demo-w');
    const stamped = s.db.prepare('SELECT sessionBornAt FROM runs WHERE id = ?').get(wave) as { sessionBornAt: number };
    expect(stamped.sessionBornAt).toBe(expected);
    expect(anchoredIncarnation(before, UNPLACEABLE)).toMatchObject({ kind: 'born', bornAt: expected });
  });

  it('a wave bound to the live worker is bound and keeps its parent, with the earlier occupant\'s run no part of it', () => {
    const s = store();
    const { minting } = reusedName(s);
    done(s, minting);
    const c = open(s, 'prog-c', 'coord-1', BORN + 10);
    s.setSession(c, 'demo-w');
    const binding = bindingOf(series(s, 'demo-w'), UNPLACEABLE);
    expect(binding.open?.id).toBe(c);
    expect(binding.newest?.id).toBe(c);
    expect(parentOf(binding)).toBe('coord-1');
    expect(s.openRunsForSession('demo-w', undefined, UNPLACEABLE)).toMatchObject({ ok: true, siblings: [{ id: c }] });
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
    expect(bindingOf(runs, UNPLACEABLE).open).toBeNull();
    expect(claimantsOf(runs, UNPLACEABLE)).toEqual([]);
    expect(boundRunsOf(runs, UNPLACEABLE, 'open')).toEqual([]);
    expect(boundRunsOf(runs, UNPLACEABLE, 'any').map((r) => r.id)).toEqual([live]);
    expect(s.openRunsForSession('demo-w', undefined, UNPLACEABLE)).toMatchObject({ ok: true, siblings: [] });
  });

  it('the card (sessionRunRead) and the ghost coordinator (withChildIds) agree', () => {
    const s = store();
    const { ghost, live } = ghostFixture(s);
    const sessions = [{ id: 'demo-w', child: { kind: 'unreadable' } as const }];
    const incarnations = incarnationsOfSessions(s, sessions);
    expect(sessionRunRead(s, 'demo-w', incarnations.get('demo-w')!)).toMatchObject({ ok: true, openRun: null, run: { id: live } });
    const summaries = [{ id: ghost, claimedBy: 'coord-gone' }] as never;
    const [withIds] = withChildIds(s, summaries, incarnations, () => undefined);
    expect(withIds.childIds).toEqual([]);
  });
});

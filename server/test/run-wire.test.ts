// ARCH-61 server half (#796): the server computes `session.run` / `session.openRun` and `run.childIds` through
// `bindingOf` / `childrenOf` and sends them on the wire. Red first: before this change a fleet row carried no run, so the
// PWA matched runs to sessions by id string and a recycled workspace name inherited the run of the occupant before it
// (#746, D6 of D-5920). The fixture is the wave exit's: two runs naming one worker, a recycled id, the open-vs-newest pair.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { childIdsOf, reviveFleetSession, sessionRunOf, type FleetSession, type RunSummary } from '../../shared/api.js';
import { loadConfig } from '../src/config.js';
import { Tmux } from '../src/exec.js';
import { assembleFleet } from '../src/fleet.js';
import { localIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, toRunSummary } from '../src/coord/store.js';
import { bornIncarnation, unbornIncarnation } from '../src/coord/runBinding.js';
import { incarnationOfMark, incarnationsOfSessions, sessionRunRead, withChildIds } from '../src/coord/runWire.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const BORN = 1_700_000_000_000;
const NOW_S = 1784600000;
const mkCoord = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-run-wire-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, program: string, claimedBy: string): number =>
  (s.openRun({ program, title: program, project: 'p', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;
const finish = (s: CoordStore, id: number): void => {
  for (const to of ['dispatched', 'closing', 'done'] as const) s.advance(id, to, 'coordinator');
};
const inc = bornIncarnation('demo-w', BORN);

/** A reused name: a run of an earlier occupant is still open, unstamped and opened before the new occupant was born, then
 *  the new occupant's own minting run (its birth recorded, so `childBirthOf` places it). */
function recycled(s: CoordStore): { stale: number; fresh: number } {
  const stale = open(s, 'prog-old', 'coord-gone');
  s.setSession(stale, 'demo-w');
  s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(BORN - 1000, stale);
  const fresh = open(s, 'prog-new', 'coord-live');
  s.setSession(fresh, 'demo-w', BORN);
  s.db.prepare('UPDATE runs SET dispatchStartedAt = ? WHERE id = ?').run(BORN, fresh);
  return { stale, fresh };
}

describe('sessionRunRead: the two named queries over one incarnation', () => {
  it('a recycled id: the run of the earlier occupant is neither the newest nor the open run', () => {
    const s = mkCoord();
    const { fresh } = recycled(s);
    expect(sessionRunRead(s, 'demo-w', inc)).toEqual({
      ok: true, run: { id: fresh, state: 'planned', claimedBy: 'coord-live' }, openRun: { id: fresh, state: 'planned', claimedBy: 'coord-live' },
    });
    // The id-string rule (a coordinator, a manual workspace) still sees both, newest first.
    const every = sessionRunRead(s, 'demo-w', unbornIncarnation('demo-w', 'not-a-child'));
    expect(every.ok && every.run?.id).toBe(fresh);
  });

  it('the open-vs-newest pair: the newest run is closed while an older one is still open', () => {
    const s = mkCoord();
    const { fresh } = recycled(s);
    const later = open(s, 'prog-later', 'coord-live');
    s.setSession(later, 'demo-w');
    finish(s, later);
    expect(sessionRunRead(s, 'demo-w', inc)).toEqual({
      ok: true, run: { id: later, state: 'done', claimedBy: 'coord-live' }, openRun: { id: fresh, state: 'planned', claimedBy: 'coord-live' },
    });
  });

  it('nothing binds the incarnation: both queries answer null (a run of another occupant is no run)', () => {
    const s = mkCoord();
    const stale = open(s, 'prog-old', 'coord-gone');
    s.setSession(stale, 'demo-w');
    s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(BORN - 1000, stale);
    expect(sessionRunRead(s, 'demo-w', inc)).toEqual({ ok: true, run: null, openRun: null });
  });

  it('an ownerless run is sent with claimedBy null, and a series that cannot be read is not a guess', () => {
    const s = mkCoord();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w', BORN);
    s.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(a);
    expect(sessionRunRead(s, 'demo-w', inc)).toMatchObject({ ok: true, run: { id: a, claimedBy: null } });
    s.db.prepare('UPDATE runs SET id = ? WHERE id = ?').run(2 ** 60, a);
    const unreadable = sessionRunRead(s, 'demo-w', inc);
    expect(unreadable.ok).toBe(false);
  });
});

describe('incarnationOfMark: the registry mark names the incarnation as heldFor and the drift lane read it', () => {
  it('a child mark places the birth of its minting run; none and unreadable keep the id-string rule', () => {
    const s = mkCoord();
    const { fresh } = recycled(s);
    expect(incarnationOfMark(s, 'demo-w', { kind: 'child', runId: fresh })).toMatchObject({ kind: 'born', bornAt: BORN });
    expect(incarnationOfMark(s, 'demo-w', { kind: 'none' })).toMatchObject({ kind: 'unborn', why: 'not-a-child' });
    expect(incarnationOfMark(s, 'demo-w', { kind: 'unreadable' })).toMatchObject({ kind: 'unborn', why: 'unplaceable' });
    // A mark naming a run that does not exist places no birth.
    expect(incarnationOfMark(s, 'demo-w', { kind: 'child', runId: 9999 })).toMatchObject({ kind: 'unborn', why: 'unplaceable' });
  });
});

describe('withChildIds: RunSummary.childIds is childrenOf the run\'s coordinator', () => {
  const summaries = (s: CoordStore): RunSummary[] => {
    const read = s.runs();
    if (!read.ok) throw new Error(read.detail);
    return read.runs.map(toRunSummary);
  };
  const noWarn = vi.fn();

  it('lists the open runs a coordinator has working for it, on every one of its runs, and none for a ghost', () => {
    const s = mkCoord();
    const { stale, fresh } = recycled(s);
    const own = open(s, 'prog-own', 'coord-live');
    s.setSession(own, 'demo-x', BORN + 1);
    const done = open(s, 'prog-done', 'coord-live');
    s.setSession(done, 'demo-y');
    finish(s, done);
    const sessions = [{ id: 'demo-w', child: { kind: 'child', runId: fresh } as const }, { id: 'demo-x', child: { kind: 'none' } as const }];
    const out = withChildIds(s, summaries(s), incarnationsOfSessions(s, sessions), noWarn);
    const idsOf = (id: number): readonly number[] | undefined => out.find((r) => r.id === id)?.childIds;
    // coord-live's children: the fresh run (bound to the live occupant) and `own`; the closed run is no child.
    expect(idsOf(fresh)).toEqual([fresh, own]);
    expect(idsOf(own)).toEqual([fresh, own]);
    // coord-gone's run names demo-w but was opened for the occupant before it: no child (D6 of D-5920).
    expect(idsOf(stale)).toEqual([]);
    expect(noWarn).not.toHaveBeenCalled();
  });

  it('a run that names no coordinator has no children; a worker the fleet does not list keeps the id-string rule', () => {
    const s = mkCoord();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-gone');
    const orphan = open(s, 'prog-o', 'coord-2');
    s.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(orphan);
    const out = withChildIds(s, summaries(s), incarnationsOfSessions(s, []), noWarn);
    expect(out.find((r) => r.id === a)?.childIds).toEqual([a]);
    expect(out.find((r) => r.id === orphan)?.childIds).toEqual([]);
  });

  it('a claimant whose series cannot be read leaves its runs without the field and says so; others are unaffected', () => {
    const s = mkCoord();
    const a = open(s, 'prog-a', 'coord-1');
    const b = open(s, 'prog-b', 'coord-2');
    s.setSession(b, 'demo-b');
    const rows = summaries(s);
    const warn = vi.fn();
    const failing = { bindingRunsOf: (id: string) => id === 'coord-1' ? { ok: false as const, kind: 'run-unreadable' as const, detail: 'boom' } : s.bindingRunsOf(id) };
    const out = withChildIds(failing, rows, incarnationsOfSessions(s, []), warn);
    expect('childIds' in out.find((r) => r.id === a)!).toBe(false);
    expect(out.find((r) => r.id === b)?.childIds).toEqual([b]);
    expect(warn).toHaveBeenCalledWith('coord-1', 'boom');
  });
});

describe('the wire readers', () => {
  it('sessionRunOf and childIdsOf read an absent key as null and []', () => {
    expect(sessionRunOf({})).toBeNull();
    expect(sessionRunOf({}, 'open')).toBeNull();
    expect(sessionRunOf({ run: { id: 3, state: 'done', claimedBy: null }, openRun: null }, 'open')).toBeNull();
    expect(sessionRunOf({ run: { id: 3, state: 'done', claimedBy: null }, openRun: null })).toEqual({ id: 3, state: 'done', claimedBy: null });
    expect(childIdsOf({})).toEqual([]);
    expect(childIdsOf({ childIds: [4, 5] })).toEqual([4, 5]);
  });
});

// assembleFleet: the row literal carries the two fields, decided once per assembly.
const seedSession = (home: string, id: string, extra: Record<string, string> = {}) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1', ...extra };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};
const dead = new Tmux(async () => ({ ran: true, code: 1, stdout: '', stderr: '' }));
const assemble = (home: string, coord?: CoordStore): Promise<FleetSession[]> => assembleFleet(
  localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
  undefined, undefined, undefined, undefined, undefined, undefined, coord,
);

describe('assembleFleet carries run and openRun', () => {
  it('a recycled name: the row reads the new occupant\'s run, never the stale one (#746)', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const coord = mkCoord();
    // The registry id and the fixture's session id are one string.
    const stale = open(coord, 'prog-old', 'coord-gone');
    coord.setSession(stale, 'demo-w');
    coord.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(BORN - 1000, stale);
    const fresh = open(coord, 'prog-new', 'coord-live');
    coord.setSession(fresh, 'demo-w', BORN);
    coord.db.prepare('UPDATE runs SET dispatchStartedAt = ? WHERE id = ?').run(BORN, fresh);
    seedSession(home, 'demo-w', { workspace: 'w', child: String(fresh) });
    seedSession(home, 'demo-main');
    const fleet = await assemble(home, coord);
    const row = fleet.find((s) => s.id === 'demo-w')!;
    expect(row.run).toEqual({ id: fresh, state: 'planned', claimedBy: 'coord-live' });
    expect(row.openRun).toEqual({ id: fresh, state: 'planned', claimedBy: 'coord-live' });
    // A session no run names answers null, and the key is present: the server always sends it.
    const main = fleet.find((s) => s.id === 'demo-main')!;
    expect(main).toHaveProperty('run', null);
    expect(main).toHaveProperty('openRun', null);
  });

  it('a mark-less session keeps the id-string rule; no coord store (a dark box) reads null on every row', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const coord = mkCoord();
    const a = open(coord, 'prog-a', 'coord-1');
    coord.setSession(a, 'demo-main');
    seedSession(home, 'demo-main');
    expect((await assemble(home, coord)).find((s) => s.id === 'demo-main')!.run).toEqual({ id: a, state: 'planned', claimedBy: 'coord-1' });
    expect((await assemble(home)).find((s) => s.id === 'demo-main')).toMatchObject({ run: null, openRun: null });
  });

  it('a series this process cannot read reads null on that row and warns; it never throws out of the assembly', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const coord = mkCoord();
    const a = open(coord, 'prog-a', 'coord-1');
    coord.setSession(a, 'demo-main');
    coord.db.prepare('UPDATE runs SET id = ? WHERE id = ?').run(2 ** 60, a);
    seedSession(home, 'demo-main');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const row = (await assemble(home, coord)).find((s) => s.id === 'demo-main')!;
      expect(row).toMatchObject({ run: null, openRun: null });
      expect(warn.mock.calls.some((c) => String(c[0]).includes('session run refused for demo-main'))).toBe(true);
    } finally { warn.mockRestore(); }
  });
});

describe('reviveFleetSession carries run and openRun', () => {
  const base = async (): Promise<Record<string, unknown>> => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-main');
    const coord = mkCoord();
    const a = open(coord, 'prog-a', 'coord-1');
    coord.setSession(a, 'demo-main');
    const row = (await assemble(home, coord)).find((s) => s.id === 'demo-main')!;
    return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
  };

  it('round-trips both, leaves an absent key absent (read as null), and reads a malformed value as null rather than rejecting the row', async () => {
    const o = await base();
    const run = { id: 7, state: 'working', claimedBy: 'coord-1' };
    expect(reviveFleetSession({ ...o, run, openRun: run })).toMatchObject({ run, openRun: run });
    const { run: _r, openRun: _o, ...old } = o;
    const revivedOld = reviveFleetSession(old)!;
    expect(revivedOld).not.toHaveProperty('run');
    expect(sessionRunOf(revivedOld)).toBeNull();
    expect(sessionRunOf(revivedOld, 'open')).toBeNull();
    for (const bad of [{ ...run, id: '7' }, { ...run, id: 0 }, { ...run, state: 'nonsense' }, { ...run, claimedBy: 3 }, 'x', []]) {
      const revived = reviveFleetSession({ ...o, run: bad });
      expect(revived, JSON.stringify(bad)).not.toBeNull();
      expect(revived!.run).toBeNull();
    }
  });
});

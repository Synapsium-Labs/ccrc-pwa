// D-8071 (spec §7, A63): ages come from STORED times, so a restart that empties the in-memory reader moves none. Every case
// here runs on a file-backed store: pass, close the database, reopen it, rebuild `RunVerdicts`, and pass again.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { localIO } from '../src/io.js';
import type { SessionVerdict } from '../src/exec.js';
import { DEAD_COORDINATOR_JOURNAL_TRUSTED } from '../src/deadCoordinator.js';
import { createRunVerdicts, type RunVerdicts } from '../src/coord/runVerdicts.js';
import { runStuckPass } from '../src/coord/runStuckPass.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const T = 1_800_000_000_000;
const MIN = 60_000;
const H = 60 * MIN;
const COORD = 'demo-quiet-mesa';
const WORKER = 'demo-brisk-fen';
const GONE: SessionVerdict = { verdict: 'gone' };
const LIVE: SessionVerdict = { verdict: 'live' };

const seedRow = (home: string, id: string, extra: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`, started: '1', workspace: id,
    branch: `ws/${id}`, base: 'origin/main', ...extra,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** A process: a store over the file, a fresh reader, and a pass at a chosen instant. */
const process_ = (home: string, panes: Map<string, SessionVerdict>) => {
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const verdicts: RunVerdicts = createRunVerdicts();
  const pass = (at: number) => runStuckPass({
    coord, io: localIO, cfg: testDeps(home).cfg, tmux: { sessionVerdict: async (id) => panes.get(id) ?? GONE },
    verdicts, journalTrust: async () => ({ hold: null, trust: DEAD_COORDINATOR_JOURNAL_TRUSTED }), now: () => at,
  });
  return { coord, verdicts, pass, stop: () => coord.db.close() };
};

const openRun = (coord: CoordStore): number => {
  const r = coord.openRun({ program: 'programme-a', title: 'Lane A', project: 'demo', wave: 1, waveOf: 1, claimedBy: COORD });
  if (!('id' in r)) throw new Error('fixture openRun refused');
  coord.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(T, r.id);
  return r.id;
};

const fixture = () => {
  const home = mkTmp('ccrc-stuck-restart-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  return { home, panes: new Map<string, SessionVerdict>() };
};

describe('the stuck verdict across a restart (A63)', () => {
  it('a crash first read at T reads owner-gone at T plus 1 h after a sealed shutdown, with since T', async () => {
    const { home, panes } = fixture(); seedRow(home, COORD);
    let p = process_(home, panes); const id = openRun(p.coord);
    for (let m = 0; m <= 30; m += 5) await p.pass(T + m * MIN);
    p.stop();
    p = process_(home, panes);              // reopened, reader rebuilt, back inside the gap
    for (let m = 35; m <= 60; m += 5) await p.pass(T + m * MIN);
    expect(p.verdicts.of(id)!.stuck).toEqual({ reason: 'owner-gone', cause: 'coordinator-gone', since: T, closes: null });
  });

  it('it does not read owner-gone at T plus 59 min after the same restart', async () => {
    const { home, panes } = fixture(); seedRow(home, COORD);
    let p = process_(home, panes); const id = openRun(p.coord);
    for (let m = 0; m <= 30; m += 5) await p.pass(T + m * MIN);
    p.stop();
    p = process_(home, panes);
    for (let m = 35; m <= 55; m += 5) await p.pass(T + m * MIN);
    await p.pass(T + 59 * MIN);
    expect(p.verdicts.of(id)!.stuck).toBeNull();
  });

  it('after an unsealed restart a crash\'s since moves with the lane\'s seed pass, and the row and the verdict agree', async () => {
    const { home, panes } = fixture(); seedRow(home, COORD);
    let p = process_(home, panes); const id = openRun(p.coord);
    for (let m = 0; m <= 30; m += 5) await p.pass(T + m * MIN);
    p.stop();
    p = process_(home, panes);
    // The lane's conservative seed pass starts the hour again at T + 35 min: it writes a fresh row, and the verdict follows it.
    p.coord.setDeadAnchor(COORD, { firstDeadAt: T + 35 * MIN, lastDeadAt: T + 35 * MIN });
    for (let m = 35; m <= 95; m += 5) await p.pass(T + m * MIN);
    const row = p.coord.deadAnchors();
    expect(row.ok && row.anchors.get(COORD)!.firstDeadAt).toBe(T + 35 * MIN);
    expect(p.verdicts.of(id)!.stuck).toMatchObject({ reason: 'owner-gone', since: T + 35 * MIN });
    // …and 59 minutes after that row there is no verdict, whatever the first read said.
    const earlier = process_(home, panes);
    await earlier.pass(T + 94 * MIN);
    expect(earlier.verdicts.of(id)!.stuck).toBeNull();
  });

  it('a worker gone at T reads owner-gone at T plus 24 h across a restart', async () => {
    const { home, panes } = fixture(); seedRow(home, COORD); seedRow(home, WORKER);
    panes.set(COORD, LIVE);
    let p = process_(home, panes); const id = openRun(p.coord);
    p.coord.markDispatched(id, WORKER, WORKER, `ws/${WORKER}`, false); p.coord.advance(id, 'dispatched', 'coordinator');
    for (let m = 0; m <= 12 * 60; m += 5) await p.pass(T + m * MIN);
    p.stop();
    p = process_(home, panes);
    for (let m = 12 * 60 + 5; m <= 24 * 60; m += 5) await p.pass(T + m * MIN);
    expect(p.verdicts.of(id)!.stuck).toMatchObject({ reason: 'owner-gone', cause: 'worker-gone', since: T });
  });

  it('a stopped coordinator keeps since across a restart', async () => {
    const { home, panes } = fixture(); const stoppedS = T / 1000 - 3 * 3600;
    seedRow(home, COORD, { stopped: `${stoppedS} ccd` });
    let p = process_(home, panes); const id = openRun(p.coord);
    await p.pass(T);
    const before = p.verdicts.of(id)!.stuck;
    p.stop();
    p = process_(home, panes);
    await p.pass(T + 20 * MIN);
    expect(before).toMatchObject({ cause: 'coordinator-stopped', since: stoppedS * 1000 });
    expect(p.verdicts.of(id)!.stuck).toMatchObject({ cause: 'coordinator-stopped', since: stoppedS * 1000 });
  });

  it('the first pass after a restart gives every open run the since it had before', async () => {
    const { home, panes } = fixture(); seedRow(home, COORD);
    let p = process_(home, panes);
    const a = openRun(p.coord);
    const b = p.coord.openRun({ program: 'programme-b', title: 'Lane B', project: 'demo', wave: 1, waveOf: 1, claimedBy: COORD });
    if (!('id' in b)) throw new Error('fixture openRun refused');
    p.coord.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(T, b.id);
    for (let m = 0; m <= 90; m += 5) await p.pass(T + m * MIN);
    const before = [a, b.id].map((i) => p.verdicts.of(i)!.stuck!.since);
    p.stop();
    p = process_(home, panes);
    await p.pass(T + 95 * MIN);
    expect([a, b.id].map((i) => p.verdicts.of(i)!.stuck!.since)).toEqual(before);
    expect(before).toEqual([T, T]);
  });
});

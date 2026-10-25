// ARCH-47 — the liveness truth table. One row per input the fleet's "is it alive" ladders
// have to place, each with the answer every surface must give. Written green against the old
// ladder (`measureClaimant`, the destructive callers' fail-shut reading) BEFORE `readSession`
// exists; the pure function then answers the same rows (see the second describe, added with it).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { measureClaimant, type ReclaimDeps } from '../src/coord/reclaim.js';
import { localIO, type FleetIO } from '../src/io.js';
import type { SessionVerdict } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_000_000_000_000;
const SEC = Math.floor(NOW / 1000);
const ID = 'demo-quiet-mesa';
const OTHER = 'demo-brisk-fen';

const GONE: SessionVerdict = { verdict: 'gone' };
const LIVE: SessionVerdict = { verdict: 'live' };

const seedRow = (home: string, id: string, extra: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`,
    started: '1', workspace: id, branch: `ws/${id}`, base: 'origin/main', ...extra,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** One row of the table: how to seed the registry, what tmux says, and the reading it must get. */
interface Row {
  name: string;
  seed: (home: string) => void;
  tmux: SessionVerdict;
  id?: string;
  io?: FleetIO;
  /** The destructive callers' state word. */
  state: 'dead' | 'alive' | 'unmeasurable';
  cause?: string;
}

const ROWS: Row[] = [
  { name: 'the registry directory will not list', seed: (h) => seedRow(h, ID), tmux: GONE,
    io: { ...localIO, readdir: async () => null }, state: 'unmeasurable' },
  { name: 'an id that is not a registry id', seed: (h) => seedRow(h, ID), tmux: GONE, id: '--flag', state: 'unmeasurable' },
  { name: 'no row in a directory that listed cleanly', seed: (h) => seedRow(h, OTHER), tmux: GONE, state: 'dead', cause: 'absent' },
  { name: 'listed but unassembled (a coordinator mid-write, D-1144)', tmux: GONE, state: 'unmeasurable',
    seed: (h) => {
      const reg = path.join(h, '.cc-sessions');
      mkdirSync(reg, { recursive: true });
      writeFileSync(path.join(reg, `${ID}.uuid`), `u-${ID}`);
      writeFileSync(path.join(reg, `${ID}.started`), '1');
    } },
  { name: 'a live pane outranks a stop stamp', seed: (h) => seedRow(h, ID, { stopped: `${SEC} ccd` }), tmux: LIVE, state: 'alive' },
  { name: 'tmux did not answer', seed: (h) => seedRow(h, ID), tmux: { verdict: 'unknown', detail: 'no server running' }, state: 'unmeasurable' },
  { name: 'gone + a stop stamp', seed: (h) => seedRow(h, ID, { stopped: `${SEC} ccd` }), tmux: GONE, state: 'dead', cause: 'stopped' },
  { name: 'gone + a stop stamp + hibernated (asleep, not dead)', tmux: GONE, state: 'alive',
    seed: (h) => seedRow(h, ID, { stopped: `${SEC} ccd`, hibernated: `${SEC} 7` }) },
  { name: 'gone + a long-gone heartbeat, stale hibernated stamp', tmux: GONE, state: 'dead', cause: 'orphan',
    seed: (h) => seedRow(h, ID, { supervised: String(SEC - 3600), hibernated: `${SEC - 7200} 7` }) },
  { name: 'gone + a row that never started', tmux: GONE, state: 'dead', cause: 'never-started',
    seed: (h) => { seedRow(h, ID); rmSync(path.join(h, '.cc-sessions', `${ID}.started`)); } },
  { name: 'gone + a fresh supervisor heartbeat (restarting)', seed: (h) => seedRow(h, ID, { supervised: String(SEC) }), tmux: GONE, state: 'alive' },
];

describe('the liveness truth table, through measureClaimant (today\'s fail-shut ladder)', () => {
  for (const row of ROWS) {
    it(row.name, async () => {
      const home = mkTmp('ccrc-truth-');
      row.seed(home);
      const deps: ReclaimDeps = {
        coord: new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))),
        io: row.io ?? localIO, cfg: testDeps(home).cfg,
        tmux: { sessionVerdict: async () => row.tmux },
      };
      const v = await measureClaimant(deps, row.id ?? ID, NOW);
      expect(v.state).toBe(row.state);
      if (row.cause !== undefined) expect(v).toMatchObject({ cause: row.cause });
    });
  }
});

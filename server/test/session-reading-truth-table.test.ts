// ARCH-47 — the liveness truth table. One row per input the fleet's "is it alive" ladders
// have to place, each with the answer every surface must give. Written green against the old
// ladder (`measureClaimant`, the destructive callers' fail-shut reading) BEFORE `readSession`
// existed; the pure function now answers the same rows, `measureClaimant` is its fail-shut
// policy, and `ccd-tmp-sweep`'s box-side predicate (it runs without the server, so it stays) is
// held to the same rows: it protects exactly `alive` and `asleep`.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { measureClaimant, type ReclaimDeps } from '../src/coord/reclaim.js';
import { readSession, type Presence, type SessionFacts } from '../src/sessionReading.js';
import { readFileSync } from 'node:fs';
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
  /** The same row as `readSession`'s facts, and the reading it must give. */
  facts: SessionFacts;
  presence: Presence;
}

const ROWS: Row[] = [
  { name: 'the registry directory will not list', seed: (h) => seedRow(h, ID), tmux: GONE,
    io: { ...localIO, readdir: async () => null }, state: 'unmeasurable' , facts: { row: 'unlistable', pane: null, lifecycle: null, hibernated: false, turn: null }, presence: 'unknown' },
  { name: 'an id that is not a registry id', seed: (h) => seedRow(h, ID), tmux: GONE, id: '--flag', state: 'unmeasurable' , facts: { row: 'bad-id', pane: null, lifecycle: null, hibernated: false, turn: null }, presence: 'unknown' },
  { name: 'no row in a directory that listed cleanly', seed: (h) => seedRow(h, OTHER), tmux: GONE, state: 'dead', cause: 'absent' , facts: { row: 'absent', pane: null, lifecycle: null, hibernated: false, turn: null }, presence: 'dead' },
  { name: 'listed but unassembled (a coordinator mid-write, D-1144)', tmux: GONE, state: 'unmeasurable',
    seed: (h) => {
      const reg = path.join(h, '.cc-sessions');
      mkdirSync(reg, { recursive: true });
      writeFileSync(path.join(reg, `${ID}.uuid`), `u-${ID}`);
      writeFileSync(path.join(reg, `${ID}.started`), '1');
    } , facts: { row: 'unmeasurable', pane: null, lifecycle: null, hibernated: false, turn: null }, presence: 'unknown' },
  { name: 'a live pane outranks a stop stamp', seed: (h) => seedRow(h, ID, { stopped: `${SEC} ccd` }), tmux: LIVE, state: 'alive' , facts: { row: 'present', pane: 'live', lifecycle: 'stopped', hibernated: false, turn: null }, presence: 'alive' },
  { name: 'tmux did not answer', seed: (h) => seedRow(h, ID), tmux: { verdict: 'unknown', detail: 'no server running' }, state: 'unmeasurable' , facts: { row: 'present', pane: 'unknown', lifecycle: 'unmeasurable', hibernated: false, turn: null }, presence: 'unknown' },
  { name: 'gone + a stop stamp', seed: (h) => seedRow(h, ID, { stopped: `${SEC} ccd` }), tmux: GONE, state: 'dead', cause: 'stopped' , facts: { row: 'present', pane: 'gone', lifecycle: 'stopped', hibernated: false, turn: null }, presence: 'dead' },
  { name: 'gone + a stop stamp + hibernated (asleep, not dead)', tmux: GONE, state: 'alive',
    seed: (h) => seedRow(h, ID, { stopped: `${SEC} ccd`, hibernated: `${SEC} 7` }) , facts: { row: 'present', pane: 'gone', lifecycle: 'stopped', hibernated: true, turn: null }, presence: 'asleep' },
  { name: 'gone + a long-gone heartbeat, stale hibernated stamp', tmux: GONE, state: 'dead', cause: 'orphan',
    seed: (h) => seedRow(h, ID, { supervised: String(SEC - 3600), hibernated: `${SEC - 7200} 7` }) , facts: { row: 'present', pane: 'gone', lifecycle: 'orphan', hibernated: true, turn: null }, presence: 'dead' },
  { name: 'gone + a row that never started', tmux: GONE, state: 'dead', cause: 'never-started',
    seed: (h) => { seedRow(h, ID); rmSync(path.join(h, '.cc-sessions', `${ID}.started`)); } , facts: { row: 'present', pane: 'gone', lifecycle: 'never-started', hibernated: false, turn: null }, presence: 'dead' },
  { name: 'gone + a fresh supervisor heartbeat (restarting)', seed: (h) => seedRow(h, ID, { supervised: String(SEC) }), tmux: GONE, state: 'alive' , facts: { row: 'present', pane: 'gone', lifecycle: 'restarting', hibernated: false, turn: null }, presence: 'alive' },
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

describe('the same rows through readSession (the pure function over facts)', () => {
  for (const row of ROWS) {
    it(row.name, () => {
      const r = readSession(row.facts);
      expect(r.presence).toBe(row.presence);
      // The destructive callers' fail-shut policy over the reading: doubt is never dead, asleep is alive.
      const state = r.presence === 'dead' ? 'dead' : r.presence === 'unknown' ? 'unmeasurable' : 'alive';
      expect(state).toBe(row.state);
      if (row.cause !== undefined) expect(r.deadCause).toBe(row.cause);
      else expect(r.deadCause).toBeNull();
    });
  }

  it('a listed-but-unassembled row never reads dead, whatever tmux says (D-1144)', () => {
    for (const pane of ['live', 'gone', 'unknown', null] as const) {
      const r = readSession({ row: 'unmeasurable', pane, lifecycle: 'orphan', hibernated: false, turn: null });
      expect(r.presence).toBe('unknown');
    }
  });

  it('a gone pane over a lifecycle that could not be measured is alive, never dead (D-1140)', () => {
    for (const lifecycle of ['unmeasurable', null] as const) {
      const r = readSession({ row: 'present', pane: 'gone', lifecycle, hibernated: false, turn: null });
      expect(r).toMatchObject({ presence: 'alive', why: 'lifecycleDoubt', deadCause: null });
    }
  });

  it('the turn rides along only for a live pane, and an unmeasured status reads unknown', () => {
    const base = { row: 'present', pane: 'live', lifecycle: null, hibernated: false } as const;
    expect(readSession({ ...base, turn: 'busy' }).turn).toBe('busy');
    expect(readSession({ ...base, turn: 'shell' }).turn).toBe('shell');
    expect(readSession({ ...base, turn: null }).turn).toBe('unknown');
    expect(readSession({ ...base, pane: 'gone', lifecycle: 'running', turn: 'idle' }).turn).toBe('unknown');
  });
});

describe('ccd-tmp-sweep keeps its box-side twin of the table', () => {
  // The sweep runs without the server and cannot import `readSession`, so a drift is made visible here: it protects a
  // session's paths while the session is alive, and while it is asleep (a hibernated session is live to it though no
  // process runs it), and nothing else.
  const sweep = readFileSync(path.join(__dirname, '../../ccd/ccd-tmp-sweep'), 'utf8');
  it('names hibernated sessions as live, as the table\'s asleep rows do', () => {
    expect(sweep).toContain('A HIBERNATED session is live too, though no process runs it');
  });
  it('the table has the asleep row and the doubt rows the sweep must not read as dead', () => {
    expect(ROWS.some((r) => r.presence === 'asleep')).toBe(true);
    expect(ROWS.filter((r) => r.presence === 'unknown').length).toBeGreaterThan(0);
  });
});

// A request-counting, in-memory `FleetIO` for the registry reader (desktop polish C1, D-6388), and the two fixtures
// its suite reads: an 80-row fleet and a small edge scenario. Nothing here touches a disk: the registry is a Map of
// `<dir>/<id>.<field>` -> content, `readdir` lists the Map's basenames, and every request the reader makes is
// logged in issue order, so a suite can count them, see which row a request belongs to, and hold them at a gate.
//
// The fake models the three things the reader has to tell apart (D-114): a field that reads, a field that is
// `absent` (a proven ENOENT), and a field that is `unreadable` (a dropped agent round trip). `hidden` models a file
// that is SERVED but not LISTED (a file created after the listing), `unreadable` and `racedAbsent` model a read
// that fails whatever the listing says.
import path from 'node:path';
import { localIO, type FleetIO, type MeasuredRead } from '../src/io.js';
import { loadConfig, type CcrcConfig } from '../src/config.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

export interface FakeRegistry {
  /** `<dir>/<id>.<field>` -> bytes. Every key is LISTED unless it is in `hidden`. */
  files: Map<string, string>;
  /** Served by a read, absent from the listing. */
  hidden?: Set<string>;
  /** A read of this path answers `unreadable`, listed or not. */
  unreadable?: Set<string>;
  /** A read of this path answers `absent` (a proven ENOENT), listed or not. */
  racedAbsent?: Set<string>;
}

export interface Request { op: 'readdir' | 'readFileMeasured' | 'readFile'; path: string }

/** A gate holds every request until the driver releases it, one batch (one agent round) at a time. */
export interface Gate { pending: (() => void)[] }

export interface FakeOptions {
  /** Every request waits this long (a setTimeout), the agent link's round trip; a function sets it per path, so
   *  requests can finish in an order other than the one they were issued in. */
  delayMs?: number | ((path: string) => number);
  gate?: Gate;
}

export interface CountingIO {
  io: FleetIO;
  /** Every request, in the order it was ISSUED. */
  requests: Request[];
  /** The highest number of DISTINCT rows with a request outstanding at once. */
  maxRowsInFlight: () => number;
  /** The distinct row ids with a request outstanding right now. */
  rowsInFlightNow: () => number;
}

const rowOf = (p: string): string => {
  const base = path.basename(p);
  return base.slice(0, base.lastIndexOf('.'));
};

export function countingIO(reg: FakeRegistry, opts: FakeOptions = {}): CountingIO {
  const requests: Request[] = [];
  const outstanding = new Map<string, number>();
  let maxRows = 0;
  const settle = async (p: string): Promise<void> => {
    if (opts.gate !== undefined) await new Promise<void>((go) => { opts.gate!.pending.push(go); });
    else if (opts.delayMs !== undefined) {
      const ms = typeof opts.delayMs === 'number' ? opts.delayMs : opts.delayMs(p);
      await new Promise<void>((go) => { setTimeout(go, ms); });
    }
  };
  const track = async <T>(p: string, work: () => Promise<T>): Promise<T> => {
    const id = rowOf(p);
    outstanding.set(id, (outstanding.get(id) ?? 0) + 1);
    maxRows = Math.max(maxRows, outstanding.size);
    try { return await work(); } finally {
      const n = outstanding.get(id)! - 1;
      if (n === 0) outstanding.delete(id); else outstanding.set(id, n);
    }
  };
  const measured = (p: string): MeasuredRead => {
    if (reg.unreadable?.has(p)) return { ok: false, reason: 'unreadable' };
    if (reg.racedAbsent?.has(p)) return { ok: false, reason: 'absent' };
    const content = reg.files.get(p);
    return content === undefined ? { ok: false, reason: 'absent' } : { ok: true, content };
  };
  const io: FleetIO = {
    ...localIO,
    async readdir(dir) {
      requests.push({ op: 'readdir', path: dir });
      await settle(dir);
      return [...reg.files.keys()].filter((k) => !reg.hidden?.has(k) && path.dirname(k) === dir).map((k) => path.basename(k));
    },
    async readFileMeasured(p) {
      requests.push({ op: 'readFileMeasured', path: p });
      return track(p, async () => { await settle(p); return measured(p); });
    },
    async readFile(p) {
      requests.push({ op: 'readFile', path: p });
      return track(p, async () => { await settle(p); const r = measured(p); return r.ok ? r.content : null; });
    },
  };
  return { io, requests, maxRowsInFlight: () => maxRows, rowsInFlightNow: () => outstanding.size };
}

/** Runs `run` while releasing the gate one batch at a time: every request issued so far is let go together (one
 *  round), then the loop waits a macrotask for the answers' consequences to issue the next batch. */
export async function countRounds<T>(gate: Gate, run: () => Promise<T>): Promise<{ value: T; rounds: number }> {
  let done = false;
  const p = run().then((v) => { done = true; return v; });
  let rounds = 0;
  for (let spin = 0; !done; spin += 1) {
    if (spin > 200_000) throw new Error('countRounds: the read never resolved');
    await new Promise<void>((go) => { setTimeout(go, 0); });
    if (done) break;
    const batch = gate.pending.splice(0);
    if (batch.length === 0) continue;
    rounds += 1;
    for (const go of batch) go();
  }
  return { value: await p, rounds };
}

/** A real config over a fixture HOME (the roster is the one file `loadConfig` needs); the registry in it is never
 *  read from disk, the fake answers for it. One per process: the HOME is made once. */
let fixtureCfg: CcrcConfig | null = null;
export const fixtureConfig = (): CcrcConfig => {
  if (fixtureCfg === null) {
    const home = mkTmp('ccrc-registry-bounded-');
    seedRoster(home);
    fixtureCfg = loadConfig({ CCRC_HOME: home });
  }
  return fixtureCfg;
};

const seedRow = (files: Map<string, string>, dir: string, id: string, fields: Record<string, string>): void => {
  for (const [k, v] of Object.entries(fields)) files.set(path.join(dir, `${id}.${k}`), v);
};

/** The 80-row fleet. Every row has the identity triple, `started`, `project`, `workspace` and `branch`; then by row
 *  number (i): every 3rd has `pool`, `lastswap` and `home`; every 4th routing `class` and `effort`; every 5th `base`; every 7th
 *  a `hold`; every 6th a `child` marker; every 10th `prphase` and `prnumber`; every 9th `lastend`; every 11th
 *  `hibernated`; every 13th `named` and `title`; every 17th `stopped` and `supervised`. Every other field
 *  `buildRecord` knows is absent from every row. */
export function fleetFixture(rows = 80): FakeRegistry {
  const cfg = fixtureConfig();
  const dir = cfg.registryDir;
  const files = new Map<string, string>();
  for (let i = 0; i < rows; i += 1) {
    const id = `lane-a-project-${String(i).padStart(3, '0')}`;
    seedRow(files, dir, id, {
      uuid: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, wrapper: 'lane-a', workdir: `/work/project-${i}`,
      started: '1', project: `project-${i}`, workspace: `ws-${i}`, branch: `ws/branch-${i}`,
    });
    if (i % 3 === 0) seedRow(files, dir, id, { pool: 'pool-a lane-a', lastswap: '1784500000', home: '/home/lane-a' });
    if (i % 4 === 0) seedRow(files, dir, id, { class: 'sonnet', effort: 'high' });
    if (i % 5 === 0) seedRow(files, dir, id, { base: 'main' });
    if (i % 7 === 0) seedRow(files, dir, id, { hold: 'held for review' });
    if (i % 6 === 0) seedRow(files, dir, id, { child: '12' });
    if (i % 10 === 0) seedRow(files, dir, id, { prphase: 'open', prnumber: '1000' });
    if (i % 9 === 0) seedRow(files, dir, id, { lastend: '1784500000 clean' });
    if (i % 11 === 0) seedRow(files, dir, id, { hibernated: '1784500000' });
    if (i % 13 === 0) seedRow(files, dir, id, { named: '1', title: 'A title' });
    if (i % 17 === 0) seedRow(files, dir, id, { stopped: '1784500000 pwa', supervised: '1784500000' });
  }
  files.set(path.join(dir, 'swap.log'), 'noise');   // not a session file
  return { files };
}

/** The registry's field names `buildRecord` reads: its census of what a listing can show. */
export const identityAndHold = ['uuid', 'wrapper', 'workdir', 'hold'] as const;

/** The small edge scenario: one row per condition the reader tells apart. Its listing is TRUTHFUL (it lists every
 *  file it serves) except for reads that fail whatever the listing says, so its answers are the same whether a
 *  field is read or settled from the listing. */
export function edgeFixture(): FakeRegistry {
  const dir = fixtureConfig().registryDir;
  const files = new Map<string, string>();
  const unreadable = new Set<string>();
  const racedAbsent = new Set<string>();
  const at = (id: string, f: string): string => path.join(dir, `${id}.${f}`);
  const triple = (id: string, i: number): void => seedRow(files, dir, id, {
    uuid: `00000000-0000-0000-0001-${String(i).padStart(12, '0')}`, wrapper: 'lane-a', workdir: `/work/${id}`,
  });
  let n = 0;
  const row = (id: string, fields: Record<string, string> = {}): string => {
    n += 1; triple(id, n); seedRow(files, dir, id, fields); return id;
  };
  row('edge-plain', { started: '1', project: 'project-a', branch: 'ws/a', workspace: 'ws-a', home: '/home/lane-a', pool: 'pool-a lane-a' });
  row('edge-hold-ok', { hold: 'waiting on review' });
  unreadable.add(at(row('edge-hold-unreadable', { hold: 'x' }), 'hold'));
  racedAbsent.add(at(row('edge-hold-raced', { hold: 'x' }), 'hold'));
  row('edge-hold-empty', { hold: '' });
  unreadable.add(at(row('edge-branch-unreadable', { branch: 'x' }), 'branch'));
  racedAbsent.add(at(row('edge-branch-raced', { branch: 'x' }), 'branch'));
  row('edge-branch-empty', { branch: '  ' });
  unreadable.add(at(row('edge-route-unreadable', { class: 'x', effort: 'high', degraded: 'class', inert: 'effort,compact' }), 'class'));
  racedAbsent.add(at(row('edge-route-raced', { effort: 'low', subagent: 'x' }), 'subagent'));
  row('edge-route-all', { class: 'opus', effort: 'low', subagent: 'a', workflow: 'b', compact: 'c', degraded: 'class', inert: 'effort' });
  unreadable.add(at(row('edge-started-unreadable', { started: '1', supervised: '1784500000', stopped: '1784500000 cli' }), 'started'));
  unreadable.add(at(row('edge-stopped-unreadable', { stopped: '1784500000 cli' }), 'stopped'));
  row('edge-stopped-garbage', { stopped: 'not-a-stamp' });
  unreadable.add(at(row('edge-child-unreadable', { child: '12' }), 'child'));
  row('edge-child-ok', { child: '12' });
  row('edge-child-bad', { child: 'twelve' });
  unreadable.add(at(row('edge-substrate-unreadable', { substrate: 'x' }), 'substrate'));
  row('edge-substrate-ok', { substrate: '1784500000 probe failed', stranded: '1784500000 stalled' });
  unreadable.add(at(row('edge-stranded-unreadable', { stranded: 'x' }), 'stranded'));
  row('edge-listed-only', {
    lastend: '1784500000 clean', hibernated: '1784500000 1', named: '1', title: 'Named',
    'deny-settings': 'a'.repeat(64), childshell: '/bin/bash',
  });
  unreadable.add(at(row('edge-listed-only-unreadable', { 'deny-settings': 'x', childshell: 'x', named: '1' }), 'deny-settings'));
  racedAbsent.add(at(row('edge-named-raced', { named: '1' }), 'named'));
  // Reads that fail whatever the listing says, of files the listing does NOT show: the answer is "absent" either way.
  unreadable.add(at(row('edge-unlisted-unreadable'), 'class'));
  unreadable.add(at(row('edge-unlisted-unreadable-2'), 'branch'));
  unreadable.add(at(row('edge-unlisted-unreadable-3'), 'substrate'));
  unreadable.add(at(row('edge-unlisted-unreadable-4'), 'child'));
  unreadable.add(at(row('edge-unlisted-unreadable-5'), 'started'));
  // The identity triple's own conditions.
  racedAbsent.add(at(row('edge-uuid-raced'), 'uuid'));
  unreadable.add(at(row('edge-wrapper-unreadable'), 'wrapper'));
  unreadable.add(at(row('edge-workdir-unreadable'), 'workdir'));
  seedRow(files, dir, 'edge-workdir-empty', { uuid: 'u'.repeat(36), wrapper: 'lane-a', workdir: '' });
  seedRow(files, dir, 'edge-wrapper-missing', { uuid: 'v'.repeat(36), workdir: '/w' });
  files.set(path.join(dir, '-flag.uuid'), 'refused');   // a listed `.uuid` that is not a registry id
  files.set(path.join(dir, 'swap.log'), 'noise');
  return { files, unreadable, racedAbsent };
}

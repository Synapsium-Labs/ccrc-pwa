// Shared fixture for the tick's pane-listing and cold-row suites (console speed S1, Step 4): the six-row fleet of
// `tick-characterization.test.ts` behind a fake runner that counts every tmux call and can answer, fail or omit the
// one `list-panes -a` listing, and a localIO wrapper that logs every read by path.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { Tmux, PANE_LISTING_FORMAT, type Runner } from '../src/exec.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import type { FleetSession } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

export const LIVE = ['lane-a-project-a', 'lane-a-project-b'];
export const STOPPED = ['lane-a-stopped-a', 'lane-a-stopped-b'];
export const ARCHIVED = 'lane-a-archived-a';
export const CRASHED = 'lane-a-crashed-a';
export const STAMP = 1_700_000_000;
export const pidOf = (id: string): number => 4000 + LIVE.indexOf(id);

const plant = (reg: string, id: string, extra: Record<string, string> = {}): void => {
  const fields: Record<string, string> = {
    wrapper: 'claude', project: id, workdir: `/data/projects/${id}`, uuid: `uuid-${id}`, started: '1', ...extra,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

export type ListingMode = 'ok' | 'fail' | 'absent';

export function makeHarness(opts: { listing?: ListingMode } = {}) {
  const home = mkTmp('ccrc-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const id of LIVE) plant(reg, id);
  STOPPED.forEach((id, i) => plant(reg, id, { stopped: `${STAMP + i} cli`, child: String(100 + i) }));
  plant(reg, ARCHIVED, { archived: String(STAMP) });
  plant(reg, CRASHED);

  const state = { listing: (opts.listing ?? 'ok') as ListingMode, live: new Set(LIVE) };
  const calls = { hasSession: 0, listPanesAll: 0, listPanesRow: 0, capture: [] as string[] };
  const reads: string[] = [];
  const idOf = (target: string): string => target.replace(/^=?cc-/, '').replace(/:?$/, '');

  const run: Runner = async (cmd, args) => {
    const t = args.indexOf('-t');
    const target = t === -1 ? '' : args[t + 1]!;
    const isLive = [...state.live].some((id) => target.includes(`cc-${id}`));
    const gone = { ran: true as const, code: 1, stdout: '', stderr: `can't find session: ${target}` };
    if (cmd === 'tmux' && args[0] === 'has-session') { calls.hasSession += 1; return isLive ? { ran: true, code: 0, stdout: '', stderr: '' } : gone; }
    if (cmd === 'tmux' && args[0] === 'list-panes' && args.includes('-a')) {
      calls.listPanesAll += 1;
      if (args[args.length - 1] !== PANE_LISTING_FORMAT) throw new Error('unexpected listing format');
      if (state.listing === 'fail') return { ran: true, code: 1, stdout: '', stderr: 'error connecting to tmux' };
      if (state.listing === 'absent') return gone;
      return { ran: true, code: 0, stdout: [...state.live].map((id) => `cc-${id} 1 0 ${pidOf(id)}\n`).join(''), stderr: '' };
    }
    if (cmd === 'tmux' && args[0] === 'list-panes') {
      calls.listPanesRow += 1;
      return isLive ? { ran: true, code: 0, stdout: `${pidOf([...state.live].find((id) => target.includes(id))!)}\n`, stderr: '' } : gone;
    }
    if (cmd === 'tmux' && args[0] === 'capture-pane') {
      calls.capture.push(LIVE.concat(STOPPED, [ARCHIVED, CRASHED]).find((id) => target.includes(id)) ?? target);
      return isLive ? { ran: true, code: 0, stdout: 'done\n❯ \n', stderr: '' } : gone;
    }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  void idOf;

  const log = (p: string): void => { reads.push(p); };
  const io: FleetIO = {
    ...localIO,
    async readFile(p, ...r) { log(p); return localIO.readFile(p, ...r); },
    async readFileMeasured(p, ...r) { log(p); return localIO.readFileMeasured(p, ...r); },
  };
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
  const cachePath = path.join(home, '.ccrc', 'state-cache.json');
  const deps = {
    cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io, queue: new KeyedQueue(),
    fleetState: { connected: true, downSince: null, ccdVerbs: [], rosterFp: null, build: null },
  };
  const bus = new Bus();
  const frames: FleetSession[][] = [];
  bus.on('fleet', (s: FleetSession[]) => frames.push(s));
  const watcher = new FleetWatcher(deps as never, bus, 2000, cachePath);
  const reset = (): void => { calls.hasSession = 0; calls.listPanesAll = 0; calls.listPanesRow = 0; calls.capture = []; reads.length = 0; };
  /** Reads of a row's own registry files, hook-state and usage sidecar (any path naming the id). */
  const readsOf = (id: string): string[] => reads.filter((p) => p.includes(id));
  return { home, reg, state, calls, reads, readsOf, watcher, bus, frames, reset };
}

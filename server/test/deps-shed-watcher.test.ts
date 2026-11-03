// D-7278: the deps-shed arm as the WATCHER wires it — the run-done row's body (`FleetWatcher.sleepRunDone`) runs it after
// the stop-done pass, with the real record re-read at the act, the real registry listing, the real stamp read and the
// server's own config. A temp registry, a real coordination store, and one runner that answers tmux and ccd, so an ask
// is one `ws-shed-deps` argv in its log. The pass's own suite (`deps-shed-pass.test.ts`) stubs all of these.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { Viewers } from '../src/viewer.js';
import { readSessionRecord } from '../src/registry.js';
import { liveRowFor, turnReadDeps } from '../src/turnverdict.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, SHED_DEPS_CAP } from '../src/ccdargv.js';
import { DEPS_SHED_LIVE_MARKER } from '../../shared/switches.js';

const WID = 'project-a-quiet-basin';
const HOUR = 3_600_000;

const harness = async (env: Record<string, string> = {}) => {
  const home = mkTmp('ccrc-deps-shed-real-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-'), ...env } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'p', title: 't', project: 'project-a', wave: 1, waveOf: 1, claimedBy: 'c' });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
  coord.markDispatched(opened.id, WID, WID, `ws/${WID}`, false);
  for (const to of ['dispatched', 'working'] as const) {
    const a = coord.advance(opened.id, to, 'test');
    if (!a.ok) throw new Error(`fixture advance to ${to} refused: ${JSON.stringify(a)}`);
  }
  const closed = coord.closeRun({ runId: opened.id, finalState: 'done', causedBy: 'test', handoffCommit: null, program: 'p', viaClosing: true });
  if (!closed.ok) throw new Error(`fixture closeRun refused: ${JSON.stringify(closed)}`);
  coord.db.prepare('UPDATE runs SET closedAt = ? WHERE id = ?').run(Date.now() - 30 * HOUR, opened.id);
  const fields: Record<string, string> = {
    wrapper: 'claude-a', project: 'project-a', workdir: `/w/${WID}`, uuid: `u-${WID}`, started: '1',
    workspace: WID, branch: `ws/${WID}`, base: 'origin/main', child: String(opened.id),
    stopped: `${Math.floor((Date.now() - 29 * HOUR) / 1000)} agent`,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${WID}.${k}`), v);
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'has-session') return { ran: true, code: 1, stdout: '', stderr: `can't find session: cc-${WID}` };
    if (args[0] === 'ws-shed-deps') {
      const dry = args.includes('--dry-run');
      return { ran: true, code: 0, stdout: `${JSON.stringify({ [dry ? 'wouldShed' : 'shed']: true, session: WID, class: 'child', dirs: 1, bytes: 1 })}\n`, stderr: '' };
    }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const deps = { ...testDeps(home, run), cfg, coord, fleetState: { ccdVerbs: ['hibernate', SHED_DEPS_CAP, ACTOR_FLAGS_CAP] }, viewers: new Viewers(() => Date.now()) };
  const w = new FleetWatcher(deps as never, new Bus(), 10_000);
  (w as unknown as { sleepStartedAt: number }).sleepStartedAt = Date.now() - 24 * HOUR;
  w.useStopDoneSerialiser({ serial: async (fn: () => Promise<unknown>) => fn() } as never);
  const tick = async () => {
    const r = await readSessionRecord(deps.io, cfg, WID);
    if (r.kind !== 'found') throw new Error('fixture record not found');
    const row = await liveRowFor(turnReadDeps(deps as never, w), r.record, `u-${WID}`);
    if (row === null) throw new Error('fixture row not assembled');
    return { rows: [row], records: [r.record] };
  };
  const asks = () => calls.filter((c) => c[1] === 'ws-shed-deps').map((c) => c.slice(1));
  return { home, reg, coord, w, tick, asks };
};

describe('the watcher runs the deps-shed arm in the run-done row (D-7278)', () => {
  it('shadow: a sleeping worker whose run closed 30 hours ago is asked the dry run', async () => {
    const h = await harness();
    try {
      const t = await h.tick();
      expect(t.rows[0]).toMatchObject({ stoppedBy: { surface: 'agent' }, child: { kind: 'child' } });
      await h.w.sweepSleep(t.rows, t.records, [], 'run-done');
      expect(h.asks()).toEqual([['ws-shed-deps', '--session', WID, '--class', 'child', '--dry-run', '--surface', 'agent', '--actor', 'sweep:deps-shed']]);
    } finally {
      h.coord.db.close();
    }
  });
  it('armed by the marker on the registry: the act itself, read again over the act\'s own listing', async () => {
    const h = await harness();
    try {
      writeFileSync(path.join(h.reg, DEPS_SHED_LIVE_MARKER), '');
      const t = await h.tick();
      await h.w.sweepSleep(t.rows, t.records, [DEPS_SHED_LIVE_MARKER], 'run-done');
      expect(h.asks()).toEqual([['ws-shed-deps', '--session', WID, '--class', 'child', '--surface', 'agent', '--actor', 'sweep:deps-shed']]);
    } finally {
      h.coord.db.close();
    }
  });
  it('the age is the server\'s config: at CCRC_DEPS_SHED_AFTER_HOURS=48 a run closed 30 hours ago is not asked', async () => {
    const h = await harness({ CCRC_DEPS_SHED_AFTER_HOURS: '48' });
    try {
      const t = await h.tick();
      await h.w.sweepSleep(t.rows, t.records, [], 'run-done');
      expect(h.asks()).toEqual([]);
    } finally {
      h.coord.db.close();
    }
  });
  it('a stamp from this sleep, on the registry, holds: the watcher reads it', async () => {
    const h = await harness();
    try {
      writeFileSync(path.join(h.reg, `${WID}.depsshed`), `${Math.floor((Date.now() - HOUR) / 1000)} 10`);
      const t = await h.tick();
      await h.w.sweepSleep(t.rows, t.records, [`${WID}.depsshed`], 'run-done');
      expect(h.asks()).toEqual([]);
    } finally {
      h.coord.db.close();
    }
  });
});

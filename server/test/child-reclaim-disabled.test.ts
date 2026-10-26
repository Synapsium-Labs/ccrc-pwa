// ARCH-77 (#812): `child-reclaim-disabled` has a reader, landed ahead of ARCH-44 by operator need. Set, child reclaim
// stops on its own: the close hand-off queues none, the executor refuses to act, and the sweep (its own describe, in
// child-reclaim-sweep.test.ts) queues none. Expiry, collect and the dead-coordinator lane never read it.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { childReclaimUnlessDisabled } from '../src/coord/childReclaimDisabled.js';
import { CHILD_RECLAIM_FEED_QUIET_NONE, reclaimChild, type ChildReclaimDeps } from '../src/coord/childReclaim.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { NotifyLog } from '../src/notifylog.js';
import { ACTOR_FLAGS_CAP, RECLAIM_CAP } from '../src/ccdargv.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOK = 'a'.repeat(64);
const MARKER = 'child-reclaim-disabled';

/** A marked child of a FINISHED run, and a scripted ccd that audits it reclaimable and reclaims it. */
const rig = async (onCall?: (verb: string) => void) => {
  const home = mkTmp('ccrc-child-reclaim-disabled-');
  const calls: string[] = [];
  const base = testDeps(home, async (_cmd, args) => {
    calls.push(args[0]!);
    onCall?.(args[0]!);
    if (args[0] === 'ws-audit') {
      return { ran: true as const, code: 0, stderr: '',
        stdout: JSON.stringify({ id: 'demo-a', mode: 'reclaim', childOf: runId, verdict: 'reclaimable', detail: '', token: TOK }) };
    }
    if (args[0] === 'ws-reclaim') {
      return { ran: true as const, code: 0, stderr: '',
        stdout: JSON.stringify({ reclaimed: 'demo-a', childOf: runId, wip: null, attic: 2, residueBytes: null, secretsDropped: 0 }) };
    }
    return { ran: true as const, code: 1, stdout: '', stderr: '' };
  });
  const reg = base.cfg.registryDir;
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'w-dis', title: 'w-dis', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  const runId = opened.id;
  const closed = coord.closeRun({ runId, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: 'w-dis', viaClosing: false });
  if (!closed.ok) throw new Error(`abandon refused: ${JSON.stringify(closed)}`);
  const fields: Record<string, string> = {
    uuid: 'u-demo-a', wrapper: 'claude', project: 'demo', workdir: '/w/demo-a', workspace: 'a',
    branch: 'ws/demo-a', base: 'origin/main', started: '1', child: String(runId),
  };
  for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `demo-a.${f}`), v);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: ChildReclaimDeps = {
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['ws-audit', 'ws-reclaim', RECLAIM_CAP, ACTOR_FLAGS_CAP] },
    viewers: { isVisible: () => false }, notifyLog,
  };
  const req = (trigger: 'close' | 'sweep' = 'close') => ({
    sessionId: 'demo-a', runId, trigger, deferExpired: false, deferredSinceMs: null,
    feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: { kind: 'none' as const } });
  const set = (): void => writeFileSync(path.join(reg, MARKER), '');
  const clear = (): void => rmSync(path.join(reg, MARKER), { force: true });
  return { reg, coord, deps, calls, req, set, clear, runId };
};

describe('the executor with child-reclaim-disabled absent (characterization)', () => {
  it('audits, reclaims, and says reclaimed — beside every other switch that is not its own', async () => {
    const r = await rig();
    for (const m of ['coordinator-paused', 'mail-disabled', 'stop-done-disabled']) writeFileSync(path.join(r.reg, m), '');
    const out = await reclaimChild(r.deps, r.req());
    expect(out).toMatchObject({ kind: 'reclaimed', sessionId: 'demo-a' });
    expect(r.calls).toEqual(['ws-audit', 'ws-reclaim']);
  });
});

describe('the executor with child-reclaim-disabled set', () => {
  it('defers paused-at-server before any argv, and writes its one feed row', async () => {
    const r = await rig();
    r.set();
    const out = await reclaimChild(r.deps, r.req());
    expect(out).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
    expect(r.calls).toEqual([]);
    expect(r.coord.feedEvents(20).filter((e) => e.sessionId === 'demo-a')).toHaveLength(1);
  });

  it('a switch set between decide and act still stops the act: the audit ran, ws-reclaim never does', async () => {
    let r!: Awaited<ReturnType<typeof rig>>;
    r = await rig((verb) => { if (verb === 'ws-audit') r.set(); });
    const out = await reclaimChild(r.deps, r.req());
    expect(out).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
    expect(r.calls).toEqual(['ws-audit']);
  });

  it.each<['null' | 'reject']>([['null'], ['reject']])(
    'a registry that does not list at the act (%s) defers: a set switch cannot be ruled out', async (how) => {
      let audited = false;
      const r = await rig((verb) => { if (verb === 'ws-audit') audited = true; });
      const real = r.deps.io;
      const deps: ChildReclaimDeps = { ...r.deps, io: { ...real, readdir: async (p, t, s) => {
        if (!audited || p !== r.reg) return real.readdir(p, t, s);
        if (how === 'reject') throw new Error('EIO');
        return null;
      } } };
      const out = await reclaimChild(deps, r.req());
      expect(out).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
      expect(out.kind === 'deferred' ? out.detail : '')
        .toContain(`the registry did not list, so a set ${MARKER} cannot be ruled out`);
      expect(r.calls).toEqual(['ws-audit']);
    });

  it('lowered again, the next attempt reclaims', async () => {
    const r = await rig();
    r.set();
    await reclaimChild(r.deps, r.req());
    r.clear();
    expect(await reclaimChild(r.deps, r.req())).toMatchObject({ kind: 'reclaimed' });
  });
});

describe('the close hand-off with child-reclaim-disabled', () => {
  const gate = async (r: Awaited<ReturnType<typeof rig>>) => {
    let queued = 0;
    await childReclaimUnlessDisabled({ io: r.deps.io, registryDir: r.deps.cfg.registryDir, coord: r.coord, notifyLog: r.deps.notifyLog },
      async () => { queued += 1; });
    return queued;
  };
  it('queues nothing while set, and says so on the feed once however often it is asked', async () => {
    const r = await rig();
    r.set();
    expect([await gate(r), await gate(r), await gate(r)]).toEqual([0, 0, 0]);
    const rows = r.coord.feedEvents(20).filter((e) => e.title === 'child reclaim switched off');
    expect(rows).toHaveLength(1);
  });
  it('says so again after the switch was lowered and raised', async () => {
    const r = await rig();
    r.set(); await gate(r); r.clear(); await gate(r); r.set(); await gate(r);
    expect(r.coord.feedEvents(20).filter((e) => e.title === 'child reclaim switched off')).toHaveLength(2);
  });
  it('queues when absent, and when the listing fails', async () => {
    const r = await rig();
    expect(await gate(r)).toBe(1);
    let queued = 0;
    await childReclaimUnlessDisabled({ io: { readdir: async () => { throw new Error('EIO'); } }, registryDir: '/x' }, async () => { queued += 1; });
    expect(queued).toBe(1);
  });
});

describe('the other cleanup lanes ignore child-reclaim-disabled', () => {
  it('the temp-root collector\'s switches read it as nothing: not paused, and its own markers still count', async () => {
    const { orphanSwitches } = await import('../src/coord/collectOrphanTree.js');
    const io = (names: string[]) => ({ readdirMeasured: async () => ({ ok: true as const, entries: names }) });
    expect(await orphanSwitches(io([MARKER]) as never, '/reg')).toMatchObject({ paused: false });
    expect(await orphanSwitches(io([MARKER, 'reclaim-paused']) as never, '/reg')).toMatchObject({ paused: true });
  });
});

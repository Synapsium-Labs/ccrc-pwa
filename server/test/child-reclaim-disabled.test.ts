// ARCH-77 (#812): `child-reclaim-disabled` has a reader, landed ahead of ARCH-44 by operator need. Set, child reclaim
// stops on its own: the close hand-off queues none, the executor refuses to act, and the sweep (its own describe, in
// child-reclaim-sweep.test.ts) queues none. Expiry, collect and the dead-coordinator lane never read it.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
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

// The daily dispatch brake is retired (operator ruling 2026-10-26, D-TBD-retire-daily-brake; it supersedes the
// fleet-capacity spec's F3, which would have kept the brake counting fresh workspaces with a ceiling of 256).
//
// What the brake did: every dispatch inside a rolling 24 h — a fresh workspace, a warm resume and a review alike —
// counted against `maxSessionsPerDay`, and at the ceiling a coordinator was refused `cap-daily` with nothing that
// would ever wake it. It never measured memory or processes. The concurrency cap (`maxConcurrentWorkers`) stays,
// unchanged, and its own tests are untouched.
//
// WRITTEN RED FIRST, against the code that still refused: each case below failed before the brake was removed.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { CAP_MAX } from '../src/coord/caps.js';
import { decideDispatch, type AdmitFacts, type CapsReading } from '../src/coord/dispatchDecide.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { clearSender } from '../src/inject/send.js';
import type { Runner } from '../src/exec.js';
import { configDirFor } from '../src/config.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/** `n` runs dispatched inside the last hour and closed since: they hold no concurrency slot, and before the
 *  retirement every one of them counted against the rolling daily brake. */
function seedClosedDispatches(coord: CoordStore, n: number, now: number): void {
  for (let i = 0; i < n; i++) {
    const o = coord.openRun({ program: `old-${i}`, title: 't', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'c' });
    if (!('id' in o)) throw new Error(`fixture openRun refused: ${JSON.stringify(o)}`);
    coord.markDispatched(o.id, `demo-old-${i}`, `old-${i}`, `ws/old-${i}`, false, now - 3600_000);
    coord.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(o.id);
  }
}

describe('the admit step no longer refuses on a daily count', () => {
  it('a dispatch over what used to be the daily count goes', () => {
    // The reading carries a count far over any ceiling the brake could ever hold; only concurrency may refuse.
    const reading = {
      caps: { maxConcurrentWorkers: 3, maxSessionsPerDay: 12 },
      usage: { running: 0, dispatchedIn24h: CAP_MAX * 4 },
      overConcurrency: null,
    } as unknown as CapsReading;
    const facts: AdmitFacts = { step: 'admit', names: [], caps: () => reading };
    expect(decideDispatch(facts).kind).toBe('go');
  });
});

describe('dispatchRun admits a dispatch past the old daily ceiling', () => {
  it('with CAP_MAX closed dispatches in the last 24 h, a fresh dispatch reaches the fleet', async () => {
    const home = mkTmp('ccrc-retire-daily-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const calls: string[][] = [];
    const run: Runner = async (_cmd, args) => { calls.push(args); return { ran: true, code: 0, stdout: '', stderr: '' }; };
    const base = testDeps(home, run);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps: DispatchRunDeps = {
      coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd, sendClear: clearSender(base),
      configDir: (w: string) => configDirFor(base.cfg, w), turnVerdict: async () => 'idle' as const,
    };
    // CAP_MAX is the highest value the old dial could ever be set to, so this many dispatches is over every daily
    // ceiling that ever existed, the seeded 12 included.
    seedClosedDispatches(coord, CAP_MAX, Date.now());
    const o = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'c' });
    if (!('id' in o)) throw new Error(`fixture openRun refused: ${JSON.stringify(o)}`);
    const out = await dispatchRun(deps, o.id, 'go', undefined);
    expect(out, 'the retired daily brake still refused the dispatch')
      .not.toMatchObject({ kind: 'refused', code: 'cap-daily' });
    expect(calls.length, 'the dispatch never got past admission to the fleet').toBeGreaterThan(0);
  });
});

describe('POST /api/coord/caps ignores the retired field (wire rule: an unknown legacy field must not 400)', () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => { while (apps.length) await apps.pop()!.close(); });
  const withCoord = async () => {
    const home = mkTmp('ccrc-retire-caps-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const app = await buildServer({ ...testDeps(home), coord, notifyLog });
    apps.push(app);
    return { app, coord };
  };
  const post = (app: FastifyInstance, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/coord/caps', payload });

  it('an older PWA moving the workers dial with the retired field beside it is written, the legacy value unread', async () => {
    const { app, coord } = await withCoord();
    // An out-of-bounds legacy value proves it is not even validated: it is not a cap any more.
    const res = await post(app, { maxConcurrentWorkers: 5, maxSessionsPerDay: 0 });
    expect(res.statusCode).toBe(200);
    expect(coord.caps().maxConcurrentWorkers).toBe(5);
  });

  it('a body carrying ONLY the retired field answers 200 and changes nothing', async () => {
    const { app, coord } = await withCoord();
    const res = await post(app, { maxSessionsPerDay: 20 });
    expect(res.statusCode).toBe(200);
    expect(coord.caps().maxConcurrentWorkers).toBe(3);
    expect(coord.capsUpdatedAt(), 'a retired-only body still wrote the caps row').toBeNull();
  });

  it('the view no longer reports the retired cap or its count', async () => {
    const { app } = await withCoord();
    const body = (await app.inject({ method: 'GET', url: '/api/coord/caps' })).json();
    expect(body.caps).toEqual({ maxConcurrentWorkers: 3 });
    expect(body.usage).toEqual({ running: 0 });
  });
});

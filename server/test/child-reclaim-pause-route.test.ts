// `POST /api/coord/reclaim-pause` — the operator's door onto `$REG/reclaim-paused`
// (child-reclamation spec §5.8): the fleet-wide switch on the AUTOMATIC
// reclamation of child workspaces, toggled from the phone.
//
// `POST /api/coord/pause`'s shape in every respect but two, and both are
// deliberate. (1) It is SESSION_ONLY, not UNGATED: raising it releases no wedge,
// so it has no release-valve argument — it is an ordinary same-origin PWA
// write that no machine lane calls, and the fleet's shared secret is the wrong
// key for it. (2) Its skew gate is a CAPABILITY token read with `capSupported`
// (no evidence REFUSES), not `verbSupported`.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { CCD_ARGV, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { isExecAllowed } from '../../agent/src/whitelist.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);

/** A fleet host that advertises the verb AND its token. */
const WITH_CAP = {
  connected: true, downSince: null, ccdVerbs: ['reclaim-pause', RECLAIM_PAUSE_CAP],
  rosterFp: null, build: null,
} satisfies NonNullable<Deps['fleetState']>;

const makeRunner = (fail = false): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    if (fail && args[0] === 'reclaim-pause') return { code: 1, stdout: '', stderr: 'ccd: reclaim-pause refused on the box' };
    return { code: 0, stdout: args[0] === 'reclaim-pause' ? 'paused' : '', stderr: '' };
  };
  return { run, calls };
};

const openApp = async (run: Runner, over: Partial<Omit<Deps, 'cfg'>> = {}, withCoord = true) => {
  const home = mkTmp('ccrc-child-reclaim-pause-');
  const base = testDeps(home, run);
  const coord = withCoord ? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))) : undefined;
  return buildServer({
    ...base, mailToken: TOKEN, fleetState: WITH_CAP, ...(coord ? { coord } : {}), ...over,
  });
};

const post = (app: FastifyInstance, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/coord/reclaim-pause', headers, payload: body as Record<string, unknown> });

const pauses = (calls: string[][]): string[][] => calls.filter((c) => c[0] === 'reclaim-pause');

describe('POST /api/coord/reclaim-pause', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it("runs reclaim-pause --state on for {state:'on'}, and off for 'off'", async () => {
    const { run, calls } = makeRunner();
    app = await openApp(run);
    const on = await post(app, { state: 'on' });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toEqual({ ok: true, requested: 'on' });
    const off = await post(app, { state: 'off' });
    expect(off.statusCode).toBe(200);
    // `requested`, never `paused`: the route RAN a verb, it did not read the
    // marker. The authoritative answer is the next coord frame's `reclaim`.
    expect(off.json()).toEqual({ ok: true, requested: 'off' });
    expect(pauses(calls)).toEqual([['reclaim-pause', '--state', 'on'], ['reclaim-pause', '--state', 'off']]);
  });

  it('mints the argv AT THE CALL SITE, and the grant admits it', async () => {
    const { run, calls } = makeRunner();
    app = await openApp(run);
    await post(app, { state: 'on' });
    expect(pauses(calls)).toEqual([[...CCD_ARGV.reclaimPause('on')]]);
    expect(isExecAllowed('ccd', [...CCD_ARGV.reclaimPause('on')])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.reclaimPause('off')])).toBe(true);
  });

  it('answers 501 when the fleet ccd advertises the VERB but not the TOKEN — capSupported, never verbSupported', async () => {
    const { run, calls } = makeRunner();
    app = await openApp(run, {
      fleetState: { connected: true, downSince: null, ccdVerbs: ['reclaim-pause'], rosterFp: null, build: null },
    });
    const res = await post(app, { state: 'on' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
    expect(pauses(calls), 'a 501 is a refusal: the verb never ran').toEqual([]);
  });

  it('answers 501 on NO evidence at all — the refusing default', async () => {
    // `verbSupported` would PERMIT here ("an absent list must never grey out
    // the fleet"); for a verb that never existed that is the wrong default.
    const { run, calls } = makeRunner();
    app = await openApp(run, { fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null } });
    expect((await post(app, { state: 'on' })).statusCode).toBe(501);
    expect(pauses(calls)).toEqual([]);
  });

  it("answers 502 with ccd's stderr when the verb fails on the box", async () => {
    const { run } = makeRunner(true);
    app = await openApp(run);
    const res = await post(app, { state: 'on' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'ccd: reclaim-pause refused on the box' });
  });

  it("answers 400 on a body that is not {state:'on'|'off'} — and runs nothing", async () => {
    const { run, calls } = makeRunner();
    app = await openApp(run);
    for (const body of [{}, { state: 'maybe' }, { state: true }, { state: null }, { paused: true }, { state: 'ON' }]) {
      const res = await post(app, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    }
    expect(pauses(calls)).toEqual([]);
  });

  it('answers WITHOUT the box token, and ignores a wrong one', async () => {
    const { run } = makeRunner();
    app = await openApp(run);
    expect((await post(app, { state: 'on' })).statusCode).toBe(200);
    expect((await post(app, { state: 'off' }, { 'x-ccrc-mail-token': 'a'.repeat(64) })).statusCode).toBe(200);
  });

  it('answers with NO coordination database: the switch is a fleet-host file, not a run', async () => {
    const { run, calls } = makeRunner();
    app = await openApp(run, {}, false);
    const res = await post(app, { state: 'on' });
    expect(res.statusCode).toBe(200);
    expect(pauses(calls)).toEqual([['reclaim-pause', '--state', 'on']]);
  });
});

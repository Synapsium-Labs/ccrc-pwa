// `GET /api/testbox` carries the frames standing (Desktop polish wave 198; plan docs/superpowers/plans/2026-11-28-box-frames-alarm.md
// section 5.2; the capture owner's yes to packet 3, call 1963). Through the real route over a fixture coord.db, as the delivery
// standing's cases do: with a session and with the box token, with no store, and with a store read that throws. Fixture homes only.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { Bus } from '../src/bus.js';
import type { Deps } from '../src/server.js';
import type { GateDecision } from '../src/auth/gate.js';
import { newestTrustedBuild } from '../../shared/deliveryLane.js';
import { FRAMES_RECIPE_VERSION } from '../../shared/framesCapture.js';
import { FRAMES_PARTS, frameSize, type FramesCaptureResult } from '../../shared/framesResult.js';
import { frameShape } from '../../shared/framesShape.js';
import { framesShapeToStore, readFramesStandingAnswer } from '../../shared/framesStanding.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

// The recipe's hold (packet 4): read through this toggle, true but in the held case.
const hold = vi.hoisted(() => ({ complete: true }));
vi.mock('../../shared/framesCapture.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/framesCapture.js')>();
  return { ...actual, get FRAMES_RECIPE_COMPLETE() { return hold.complete; } };
});

let template = '';
const opened: CoordStore[] = [];
const apps: FastifyInstance[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-frames-route-template-'), 'coord.db');
  openCoordDb(template).close();
});
removeTmpFixturesEachTest();
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const o of opened.splice(0)) { try { o.db.close(); } catch { /* already closed */ } }
  vi.restoreAllMocks();
});

const TOKEN = 'b'.repeat(64);
const HEADER = 'x-ccrc-mail-token';
const RULE = '─'.repeat(60);
const MARK = 'QMARKQ';
const TEXT = [RULE, '❯ frames row 001 of 003 abcdefghij', RULE, '  ccrc capture'].join('\n') + '\n';
const MARKED = [`${RULE} ${MARK} 12 more`, '  ccrc frames: ok', RULE, '  ccrc capture'].join('\n') + '\n';

function resultFor(build: string, part: number, text: string = TEXT): FramesCaptureResult {
  const p = FRAMES_PARTS[part]!;
  return {
    recipe: 'frames', version: FRAMES_RECIPE_VERSION, build, part, case: p.case, pane: p.pane, release: null, unmeasured: [], word: 'framed',
    sends: [], turns: 0, sideRequests: 0,
    frame: { outcome: 'drawn', refusal: null, ...frameSize(text), cursor: [2, 1], replaced: { cwd: 0, path: 0, model: 0, account: 0 }, text },
  };
}

/** The route over a fresh store (`wrap` replaces a read), armed or not, with a session or without. */
async function route(o: { wrap?: (c: CoordStore) => CoordStore | undefined; armed?: boolean; session?: boolean } = {}) {
  const home = mkTmp('ccrc-frames-route-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  copyFileSync(template, path.join(home, '.ccrc', 'coord.db'));
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  opened.push(coord);
  const base = testDeps(home);
  const wrapped = o.wrap === undefined ? coord : o.wrap(coord);
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled: o.armed ?? false }, mailToken: TOKEN, coord: wrapped };
  const sessionAuth = (): GateDecision => (o.session ?? true
    ? { allow: true, verdict: 'ok', reason: 'session', device: null }
    : { allow: false, verdict: 'no-session', reason: 'no-session', device: null } as unknown as GateDecision);
  const app = Fastify();
  registerCoordRoutes(app, deps, new Bus(), sessionAuth, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null }, undefined);
  apps.push(app);
  const get = (headers: Record<string, string> = {}) => app.inject({ method: 'GET', url: '/api/testbox', headers });
  return { coord, get };
}
const over = (c: CoordStore, o: Partial<CoordStore>): CoordStore => Object.assign(Object.create(c) as CoordStore, o);

describe('the status read carries frames beside delivery', () => {
  it('with a session: the standing for the build the lanes name, read back by its one reader', async () => {
    const { coord, get } = await route();
    const build = newestTrustedBuild(coord.claudeBuilds())!;
    const r = resultFor(build, 0);
    coord.recordFrames(r, 'clear', 7, [], framesShapeToStore(r, 'clear'));
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { frames: unknown; delivery: unknown };
    expect(body.delivery).toMatchObject({ kind: 'standing' });
    expect(readFramesStandingAnswer(body.frames)).toEqual({
      kind: 'standing', standing: { build, against: null, word: 'incomplete', differing: [], refusals: 'none', refused: [], overCap: [] },
    });
  });

  it('with the box token and no session, armed: the same answer; with neither, 401 and no frames', async () => {
    const { get } = await route({ armed: true, session: false });
    const ok = await get({ [HEADER]: TOKEN });
    expect(ok.statusCode).toBe(200);
    expect(readFramesStandingAnswer((ok.json() as { frames: unknown }).frames)).toMatchObject({ kind: 'standing' });
    const no = await get();
    expect(no.statusCode).toBe(401);
    expect(no.json()).not.toHaveProperty('frames');
  });

  it('a frame holding a marker in a rule label and a row of our text: the marker, the tokens and the hash reach no answer', async () => {
    const { coord, get } = await route();
    const build = newestTrustedBuild(coord.claudeBuilds())!;
    const r = resultFor(build, 0, MARKED);
    const shape = framesShapeToStore(r, 'clear')!;
    coord.recordFrames(r, 'clear', 7, [], shape);
    const res = await get();
    expect(res.body).not.toContain(MARK);
    expect(res.body).not.toContain(shape.hash);
    for (const t of frameShape(MARKED, [2, 1], ['ccrc frames: ok']).tokens) if (t.length > 3) expect(res.body).not.toContain(t);
  });

  it('no coordination store: the key is absent, which the one reader takes as unknown', async () => {
    const { get } = await route({ wrap: () => undefined });
    const body = (await get()).json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('frames');
    expect(readFramesStandingAnswer(body['frames'])).toEqual({ kind: 'unknown' });
  });

  it('no build passed its trust capture: no-trusted-build, beside delivery\'s own', async () => {
    const { get } = await route({ wrap: (c) => over(c, { claudeBuilds: () => [] }) });
    expect((await get()).json()).toMatchObject({ frames: { kind: 'no-trusted-build' }, delivery: { kind: 'no-trusted-build' } });
  });

  it('the recipe held: held, and neither store read is made, so a throwing store answers held, not unreadable', async () => {
    hold.complete = false;
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const boom = (): never => { throw new Error('disk I/O error'); };
      const { get } = await route({ wrap: (c) => over(c, { claudeBuildFrameShapes: boom }) });
      const body = (await get()).json() as Record<string, unknown>;
      expect(body['frames']).toEqual({ kind: 'held' });
      expect(readFramesStandingAnswer(body['frames'])).toEqual({ kind: 'held' });
      expect(body['delivery']).toMatchObject({ kind: 'standing' });
      expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('frames standing'))).toEqual([]);
    } finally { hold.complete = true; }
  });

  it('a shapes read that throws: unreadable, one log line the wire does not carry, the block and delivery still answered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { get } = await route({ wrap: (c) => over(c, { claudeBuildFrameShapes: () => { throw new Error('disk I/O error'); } }) });
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, testbox: null, delivery: expect.objectContaining({ kind: 'standing' }), frames: { kind: 'unreadable' } });
    expect(res.body).not.toContain('disk I/O');
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('ccrc-server:'))).toEqual(['ccrc-server: GET /api/testbox: the frames standing could not be read (disk I/O error)']);
  });
});

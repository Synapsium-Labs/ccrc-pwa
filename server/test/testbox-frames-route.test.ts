// The box frames recipe's one read (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md
// section 5.4; `server/src/testboxFramesRoutes.ts`), on a bare Fastify app with fake deps: the two credentials and the 401,
// the closed query, the refusal words, the list with no text, one frame's text, and the check run again before it is served.
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRAMES_RECIPE_VERSION } from '../../shared/framesCapture.js';
import type { FramesRow } from '../../shared/framesLane.js';
import { FRAMES_PARTS, framesPartOfId, type FramesCaptureResult } from '../../shared/framesResult.js';
import { readFramesQuery, registerTestboxFramesRoute, type TestboxFramesDeps } from '../src/testboxFramesRoutes.js';

const BUILD = '2.1.332';
const RULE = '─'.repeat(60);
const TEXT = [RULE, '❯ frames row 001 of 003 abcdefghij', RULE, '  ? for shortcuts'].join('\n') + '\n';
const part = framesPartOfId('rows-3@220x50')!;
const record = (p: number): FramesCaptureResult => ({
  recipe: 'frames', version: FRAMES_RECIPE_VERSION, build: BUILD, part: p, case: FRAMES_PARTS[p]!.case, pane: FRAMES_PARTS[p]!.pane, release: null,
  unmeasured: [], word: 'framed', sends: [], turns: 0, sideRequests: 0,
  frame: { outcome: 'drawn', refusal: null, rows: 4, width: 60, bytes: 300, cursor: [2, 1], replaced: { cwd: 0, path: 0, model: 0, account: 0 }, text: null },
});
const row = (p: number, text: string | null): FramesRow => ({
  build: BUILD, part: p, version: FRAMES_RECIPE_VERSION, word: 'framed', record: record(p), text, checked: 'clear', at: 1, attempts: 1, lastAttemptAt: 1, notSent: null,
});

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); vi.restoreAllMocks(); });

function app(over: Partial<TestboxFramesDeps> = {}, rows: readonly FramesRow[] = [row(part, TEXT), row(0, null)]) {
  const a = Fastify({ logger: false });
  apps.push(a);
  registerTestboxFramesRoute(a, {
    frames: () => rows, session: () => false, boxToken: (req) => req.headers['x-ccrc-mail-token'] === 'tok',
    masker: { maskText: (t: string) => t }, ...over,
  });
  return a;
}
const get = (a: ReturnType<typeof app>, url: string, token = true) =>
  a.inject({ method: 'GET', url, headers: token ? { 'x-ccrc-mail-token': 'tok' } : {} });

describe('credentials', () => {
  it('neither a session nor the box token: 401, before anything is read', async () => {
    const frames = vi.fn(() => []);
    const r = await get(app({ frames }), `/api/testbox/frames?build=${BUILD}`, false);
    expect(r.statusCode).toBe(401);
    expect(frames).not.toHaveBeenCalled();
  });
  it('the box token alone answers; a session alone answers', async () => {
    expect((await get(app(), `/api/testbox/frames?build=${BUILD}`)).statusCode).toBe(200);
    expect((await get(app({ session: () => true }), `/api/testbox/frames?build=${BUILD}`, false)).statusCode).toBe(200);
  });
});

describe('the closed query', () => {
  it.each([
    ['no key', ''], ['another key', `?build=${BUILD}&x=1`], ['a repeated build', `?build=${BUILD}&build=${BUILD}`],
    ['an empty build', '?build='], ['an empty frame', `?build=${BUILD}&frame=`], ['frame alone', '?frame=rows-3@220x50'],
  ])('%s is a bad request before the store is read', async (_why, qs) => {
    const frames = vi.fn(() => []);
    const r = await get(app({ frames }), `/api/testbox/frames${qs}`);
    expect([r.statusCode, r.json().error]).toEqual([400, 'bad-request']);
    expect(frames).not.toHaveBeenCalled();
  });
  it('a build off the grammar and a frame not on the list have their own words', async () => {
    expect((await get(app(), '/api/testbox/frames?build=latest')).json().error).toBe('bad-build');
    expect((await get(app(), `/api/testbox/frames?build=${BUILD}&frame=rows-3@220x30`)).json().error).toBe('bad-frame');
  });
  it('the rule, pure', () => {
    expect(readFramesQuery({ build: 'b' })).toEqual({ build: 'b', frame: null });
    expect(readFramesQuery({ build: ['a', 'b'] })).toBeNull();
  });
});

describe('the store', () => {
  it('no store: not-configured; a store read that throws: unreadable, the error in one log line and never on the wire', async () => {
    expect((await get(app({ frames: undefined }), `/api/testbox/frames?build=${BUILD}`)).json().error).toBe('not-configured');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await get(app({ frames: () => { throw new Error('disk SECRETWORD'); } }), `/api/testbox/frames?build=${BUILD}`);
    expect([r.statusCode, r.json().error]).toEqual([503, 'unreadable']);
    expect(r.body).not.toContain('SECRETWORD');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('the two answers', () => {
  it('the list carries no text', async () => {
    const r = await get(app(), `/api/testbox/frames?build=${BUILD}`);
    expect(r.json().frames.map((f: { frame: string; hasText: boolean }) => [f.frame, f.hasText])).toEqual([['empty@220x50', false], ['rows-3@220x50', true]]);
    expect(r.body).not.toContain('frames row 001');
  });
  it('one frame answers its row and its text', async () => {
    const r = await get(app(), `/api/testbox/frames?build=${BUILD}&frame=rows-3@220x50`);
    expect(r.json()).toMatchObject({ ok: true, build: BUILD, text: TEXT });
  });
  it('a frame whose text was set aside, or never stored, is no-text', async () => {
    expect((await get(app(), `/api/testbox/frames?build=${BUILD}&frame=empty@220x50`)).json().error).toBe('no-text');
    expect((await get(app(), `/api/testbox/frames?build=${BUILD}&frame=cap@220x50`)).json().error).toBe('no-text');
  });
  it('a text the reducer\'s own check refuses is served as its row and its word, never the text', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bad = [RULE, '  Haiku 9.9 · Claude Max', RULE].join('\n') + '\n';
    const r = await get(app({}, [row(part, bad)]), `/api/testbox/frames?build=${BUILD}&frame=rows-3@220x50`);
    expect(r.json()).toMatchObject({ ok: true, text: null, refused: 'private-shape' });
    expect(r.body).not.toContain('Haiku');
  });
  it('a text the live masker would change is refused masked, never served changed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await get(app({ masker: { maskText: (t: string) => t.replace('abcdefghij', '‹secret masked›') } }), `/api/testbox/frames?build=${BUILD}&frame=rows-3@220x50`);
    expect(r.json()).toMatchObject({ text: null, refused: 'masked' });
  });
});

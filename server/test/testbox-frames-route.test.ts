// The box frames recipe's one read (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md
// section 5.4; `server/src/testboxFramesRoutes.ts`), on a bare Fastify app with fake deps: the two credentials and the 401,
// the closed query, the refusal words, the list with no text, one frame's text, and the check run again before it is served.
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRAMES_RECIPE_VERSION } from '../../shared/framesCapture.js';
import { FRAMES_STATUS_TEXT } from '../../shared/framesReduce.js';
import type { FramesRow } from '../../shared/framesLane.js';
import { FRAMES_PARTS, framesPartOfId, type FramesCaptureResult } from '../../shared/framesResult.js';
import { FRAMES_READ_REFUSALS, REFUSAL_STATUS } from '../../shared/refusal.js';
import { readFramesQuery, registerTestboxFramesRoute, type TestboxFramesDeps } from '../src/testboxFramesRoutes.js';

const BUILD = '2.1.332';
const RULE = '─'.repeat(60);
// The capture's status row sits directly under the box's lower rule (rule 8, review 4069's F3).
const STATUS = `  ${FRAMES_STATUS_TEXT}`;
const TEXT = [RULE, '❯ frames row 001 of 003 abcdefghij', RULE, STATUS, '  ? for shortcuts'].join('\n') + '\n';
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
    const b = await get(app(), '/api/testbox/frames?build=latest');
    expect([b.statusCode, b.json().error]).toEqual([400, 'bad-build']);
    const f = await get(app(), `/api/testbox/frames?build=${BUILD}&frame=rows-3@220x30`);
    expect([f.statusCode, f.json().error]).toEqual([400, 'bad-frame']);
  });
  it('the rule, pure', () => {
    expect(readFramesQuery({ build: 'b' })).toEqual({ build: 'b', frame: null });
    expect(readFramesQuery({ build: ['a', 'b'] })).toBeNull();
  });
});

describe('the store', () => {
  it('no store: not-configured; a store read that throws: unreadable, the error in one log line and never on the wire', async () => {
    const none = await get(app({ frames: undefined }), `/api/testbox/frames?build=${BUILD}`);
    expect([none.statusCode, none.json().error]).toEqual([501, 'not-configured']); // the table's status for the word (D-5381)
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
    for (const frame of ['empty@220x50', 'cap@220x50']) {
      const r = await get(app(), `/api/testbox/frames?build=${BUILD}&frame=${frame}`);
      expect([r.statusCode, r.json().error], frame).toEqual([404, 'no-text']);
    }
  });
  it('a text the reducer\'s own check refuses is served as its row and its word, never the text', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bad = [RULE, '  Haiku 9.9 · Claude Max', RULE, STATUS].join('\n') + '\n';
    const r = await get(app({}, [row(part, bad)]), `/api/testbox/frames?build=${BUILD}&frame=rows-3@220x50`);
    expect(r.json()).toMatchObject({ ok: true, text: null, refused: 'private-shape' });
    expect(r.body).not.toContain('Haiku');
  });
  it('a text the live masker would change is refused masked, never served changed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await get(app({ masker: { maskText: (t: string) => t.replace('abcdefghij', '‹secret masked›') } }), `/api/testbox/frames?build=${BUILD}&frame=rows-3@220x50`);
    expect(r.json()).toMatchObject({ text: null, refused: 'masked' });
  });
  // Review 4086's F-G: the two mutants of the read's re-check that no case killed (O4, O5).
  it('a stored row whose record says over-cap but holds a text is refused not-a-frame: the whole result is read again, not the text alone', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const over: FramesRow = { ...row(part, TEXT), record: { ...record(part), frame: { ...record(part).frame, outcome: 'over-cap' } } };
    const r = await get(app({}, [over]), `/api/testbox/frames?build=${BUILD}&frame=rows-3@220x50`);
    expect(r.json()).toMatchObject({ ok: true, text: null, refused: 'not-a-frame' });
    expect(r.body).not.toContain('frames row 001');
  });
  it('the live masker is asked in rows mode, on the text the read would serve', async () => {
    const maskText = vi.fn((t: string, _opts?: { rows?: boolean }) => t);
    const r = await get(app({ masker: { maskText } }), `/api/testbox/frames?build=${BUILD}&frame=rows-3@220x50`);
    expect(r.json()).toMatchObject({ text: TEXT });
    expect(maskText).toHaveBeenCalledWith(TEXT, { rows: true });
    expect(maskText.mock.calls.map((c) => c[1])).toEqual(maskText.mock.calls.map(() => ({ rows: true })));
  });
});

// Review 4069's L1: the read's own four words, each at its status by value, in the one table and on the wire (each answer's
// status is held above too). A status moved in the table reds here.
describe('the read\'s refusal words and their statuses', () => {
  it('FRAMES_READ_REFUSALS is bad-build 400, bad-frame 400, no-text 404 and unreadable 503, each spread into the table as it is', () => {
    expect(FRAMES_READ_REFUSALS).toEqual({ 'bad-build': 400, 'bad-frame': 400, 'no-text': 404, unreadable: 503 });
    for (const [w, s] of Object.entries(FRAMES_READ_REFUSALS)) expect(REFUSAL_STATUS[w as keyof typeof REFUSAL_STATUS], w).toBe(s);
    expect([REFUSAL_STATUS['not-configured'], REFUSAL_STATUS['unauthenticated'], REFUSAL_STATUS['bad-request']]).toEqual([501, 401, 400]);
  });
});

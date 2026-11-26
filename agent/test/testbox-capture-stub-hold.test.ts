// The stand-in's hold (Desktop polish wave 187): a `{kind:'text', holdMs}` reply is held until `release()` or `holdMs`;
// `close()` leaves no timer; build trust's rule never holds; the frames rule holds only the marked turn.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRAMES_HOLD_MARK, FRAMES_HOLD_TEXT, FRAMES_REPLY_TEXT } from '../../shared/framesCapture.js';
import { CAPTURE_MARK, standInReply, type StandInReply } from '../src/testbox/capture.js';
import { framesStandInReply, framesStandInReplyOf } from '../src/testbox/captureFrames.js';
import { startStandIn, type StandIn } from '../src/testbox/captureStub.js';

let live: StandIn | null = null;
afterEach(async () => { await live?.close(); live = null; });

const hold = (holdMs: number) => (): StandInReply => ({ kind: 'text', text: 'held ok', holdMs });
const post = (s: StandIn, stream = false): Promise<Response> =>
  fetch(`http://127.0.0.1:${s.port}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'm', stream, messages: [{ role: 'user', content: 'hi' }] }) });
const settles = (p: Promise<unknown>): Promise<boolean> => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 150))]);
const start = async (reply: (b: unknown) => StandInReply): Promise<StandIn> => (live = await startStandIn({ reply }));

describe('a held reply', () => {
  it.each([false, true])('is not answered before release, and release() answers it (stream=%s); the request is recorded at arrival', async (stream) => {
    const s = await start(hold(60_000));
    const p = post(s, stream);
    expect(await settles(p)).toBe(false);
    expect(s.requests).toHaveLength(1);
    expect(s.routes).toEqual(['messages']);
    s.release!();
    const r = await p;
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('held ok');
  });

  it('is answered by itself when holdMs passes', async () => {
    const s = await start(hold(120));
    const t0 = Date.now();
    const r = await post(s);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    expect(r.status).toBe(200);
  });

  it('release() answers every held response at once', async () => {
    const s = await start(hold(60_000));
    const ps = [post(s), post(s, true)];
    expect(await settles(Promise.all(ps))).toBe(false);
    s.release!();
    expect((await Promise.all(ps)).map((r) => r.status)).toEqual([200, 200]);
  });

  it('close() leaves no timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const s = await start(hold(60_000));
      void post(s).catch(() => {});
      for (let i = 0; i < 50 && s.requests.length === 0; i += 1) { vi.useRealTimers(); await new Promise((r) => setTimeout(r, 10)); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); }
      expect(s.requests).toHaveLength(1);
      await s.close();
      live = null;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

describe('an unheld reply', () => {
  it('answers at once, with or without a zero holdMs', async () => {
    const s = await start(() => ({ kind: 'text', text: 'now' }));
    expect((await post(s)).status).toBe(200);
    live = await (async () => { await s.close(); return startStandIn({ reply: hold(0) }); })();
    expect((await post(live)).status).toBe(200);
  });
});

describe('the reply rules', () => {
  it('build trust never returns holdMs over its probe bodies', () => {
    const bodies = [
      { model: 'm', tools: [{ name: 'Bash' }, { name: 'Agent' }], messages: [{ role: 'user', content: CAPTURE_MARK.one }] },
      { model: 'm', tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: CAPTURE_MARK.two }] },
      { model: 'm', tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: CAPTURE_MARK.three }] },
      { messages: [{ role: 'user', content: FRAMES_HOLD_MARK }] }, null, 'x', {},
    ];
    for (const b of bodies) expect(standInReply(b)).not.toHaveProperty('holdMs');
  });

  it('framesStandInReplyOf(5000) holds only on the mark in the last user message', () => {
    const rule = framesStandInReplyOf(5000);
    const msg = (text: unknown, role = 'user') => ({ messages: [{ role, content: text }] });
    expect(rule(msg(FRAMES_HOLD_TEXT))).toEqual({ kind: 'text', text: FRAMES_REPLY_TEXT, holdMs: 5000 });
    expect(rule(msg([{ type: 'text', text: FRAMES_HOLD_TEXT }]))).toEqual({ kind: 'text', text: FRAMES_REPLY_TEXT, holdMs: 5000 });
    expect(rule(msg('an ordinary turn'))).toEqual({ kind: 'text', text: FRAMES_REPLY_TEXT });
    expect(rule({ messages: [{ role: 'user', content: FRAMES_HOLD_MARK }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'later' }] })).toEqual({ kind: 'text', text: FRAMES_REPLY_TEXT });
    expect(rule(msg(FRAMES_HOLD_MARK, 'assistant'))).toEqual({ kind: 'text', text: FRAMES_REPLY_TEXT });
    expect(rule(null)).toEqual({ kind: 'text', text: FRAMES_REPLY_TEXT });
    expect(framesStandInReply(msg(FRAMES_HOLD_TEXT))).toEqual({ kind: 'text', text: FRAMES_REPLY_TEXT });
  });
});

// Overlord W1, the push outbox (Task 3: plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md):
// `PushService.notify` answers one verdict per subscription (slug verdict-ships-with-the-outbox). web-push is mocked;
// each subscription's endpoint picks its behaviour, so one send can mix them.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';

const calls = vi.hoisted(() => [] as { endpoint: string; options: unknown }[]);
const behaviour = vi.hoisted(() => new Map<string, () => Promise<unknown>>());
vi.mock('web-push', () => {
  class WebPushError extends Error {
    constructor(message: string, readonly statusCode: number) { super(message); }
  }
  return {
    default: {
      setVapidDetails: () => {},
      sendNotification: async (s: { endpoint: string }, _body: string, options: unknown) => {
        calls.push({ endpoint: s.endpoint, options });
        const b = behaviour.get(s.endpoint);
        return b === undefined ? { statusCode: 201 } : b();
      },
    },
    WebPushError,
  };
});

import webpush, { WebPushError } from 'web-push';
import { PushService } from '../src/push.js';
import { SHAPE_ONLY_MASKER } from '../src/accounts/mask.js';
import { mkTmp } from './tmpHelpers.js';

const CFG = { publicKey: 'p', privateKey: 'k', subject: 'mailto:ops@example.invalid' };
const ep = (n: number): string => `https://push.example.invalid/${n}`;
const hash = (s: string): string => createHash('sha256').update(s).digest('hex');
const PAYLOAD = { title: 'Question', body: 'Proceed?', sessionId: 'lane-a-project-a', tag: 'ask-lane-a-project-a' };
const errWith = (code: string): Error => Object.assign(new Error(code), { code });
const statusErr = (status: number): Error => new (WebPushError as unknown as new (m: string, s: number) => Error)('Received unexpected response code', status);

const service = async (n: number): Promise<PushService> => {
  const push = new PushService(CFG, path.join(mkTmp('ccrc-push-verdict-'), '.ccrc', 'push-subs.json'), SHAPE_ONLY_MASKER);
  for (let i = 1; i <= n; i++) await push.subscribe({ endpoint: ep(i), keys: { p256dh: 'x', auth: 'y' } });
  return push;
};

beforeEach(() => { calls.length = 0; behaviour.clear(); });
void webpush;

describe('PushService.notify answers a PushSendVerdict (Overlord §4.3, C67)', () => {
  it('no subscription answers no-subscription and sends nothing', async () => {
    const push = await service(0);
    expect(await push.notify(PAYLOAD)).toEqual({ kind: 'no-subscription' });
    expect(calls).toEqual([]);
  });

  it('one accepted send answers accepted with its status and the endpoint\'s hash, never the endpoint', async () => {
    const push = await service(1);
    const v = await push.notify(PAYLOAD);
    expect(v).toEqual({ kind: 'sent', subs: [{ endpointHash: hash(ep(1)), verdict: 'accepted', status: 201 }] });
    expect(JSON.stringify(v)).not.toContain('push.example.invalid');
  });

  it('every send carries TTL 600 and the per-request timeout', async () => {
    const push = await service(1);
    await push.notify(PAYLOAD);
    expect(calls[0]!.options).toEqual({ TTL: 600, timeout: 20_000 });
  });

  it('a 404 is gone and pruned: the next send has no subscription', async () => {
    const push = await service(1);
    behaviour.set(ep(1), () => Promise.reject(statusErr(404)));
    expect(await push.notify(PAYLOAD)).toEqual({ kind: 'sent', subs: [{ endpointHash: hash(ep(1)), verdict: 'gone', status: 404 }] });
    expect(await push.notify(PAYLOAD)).toEqual({ kind: 'no-subscription' });
  });

  it('a 410 is gone too', async () => {
    const push = await service(1);
    behaviour.set(ep(1), () => Promise.reject(statusErr(410)));
    expect(await push.notify(PAYLOAD)).toMatchObject({ subs: [{ verdict: 'gone', status: 410 }] });
  });

  it('a 429 and a 5xx are refused, kept, and can pass', async () => {
    const push = await service(2);
    behaviour.set(ep(1), () => Promise.reject(statusErr(429)));
    behaviour.set(ep(2), () => Promise.reject(statusErr(503)));
    expect(await push.notify(PAYLOAD)).toMatchObject({ subs: [{ verdict: 'refused', status: 429 }, { verdict: 'refused', status: 503 }] });
    behaviour.clear();
    expect(await push.notify(PAYLOAD)).toMatchObject({ subs: [{ verdict: 'accepted' }, { verdict: 'accepted' }] });
  });

  it('a 400, a 403 and a 413 are refused for good', async () => {
    const push = await service(3);
    behaviour.set(ep(1), () => Promise.reject(statusErr(400)));
    behaviour.set(ep(2), () => Promise.reject(statusErr(403)));
    behaviour.set(ep(3), () => Promise.reject(statusErr(413)));
    expect(await push.notify(PAYLOAD)).toMatchObject({ subs: [
      { verdict: 'refused-for-good', status: 400 }, { verdict: 'refused-for-good', status: 403 }, { verdict: 'refused-for-good', status: 413 },
    ] });
  });

  it('an error raised before the request left the box is refused: ECONNREFUSED, ENOTFOUND, EAI_AGAIN, ENETUNREACH', async () => {
    const codes = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH'];
    const push = await service(codes.length);
    codes.forEach((c, i) => behaviour.set(ep(i + 1), () => Promise.reject(errWith(c))));
    const v = await push.notify(PAYLOAD);
    expect(v.kind === 'sent' && v.subs.map((s) => [s.verdict, s.status])).toEqual(codes.map(() => ['refused', null]));
  });

  it('a reset after the write, a socket timeout and any other error are no-answer', async () => {
    const push = await service(4);
    behaviour.set(ep(1), () => Promise.reject(errWith('ECONNRESET')));
    behaviour.set(ep(2), () => Promise.reject(new Error('Socket timeout')));
    behaviour.set(ep(3), () => Promise.reject(errWith('ETIMEDOUT')));
    behaviour.set(ep(4), () => Promise.reject(new Error('unable to verify the first certificate')));
    const v = await push.notify(PAYLOAD);
    expect(v.kind === 'sent' && v.subs.map((s) => s.verdict)).toEqual(['no-answer', 'no-answer', 'no-answer', 'no-answer']);
  });

  it('a subscription that hangs past its timeout beside one that accepts: the verdict is sent, with both answers', async () => {
    const push = await service(2);
    // web-push destroys a timed-out request with `Socket timeout`; the mock answers that after a short wait.
    behaviour.set(ep(1), () => new Promise((_r, reject) => setTimeout(() => reject(new Error('Socket timeout')), 20)));
    const v = await push.notify(PAYLOAD);
    expect(v).toEqual({ kind: 'sent', subs: [
      { endpointHash: hash(ep(1)), verdict: 'no-answer', status: null },
      { endpointHash: hash(ep(2)), verdict: 'accepted', status: 201 },
    ] });
  });

  it('three subscriptions mixed: accepted, gone (pruned) and refused, in subscription order', async () => {
    const push = await service(3);
    behaviour.set(ep(2), () => Promise.reject(statusErr(410)));
    behaviour.set(ep(3), () => Promise.reject(statusErr(500)));
    expect(await push.notify(PAYLOAD)).toEqual({ kind: 'sent', subs: [
      { endpointHash: hash(ep(1)), verdict: 'accepted', status: 201 },
      { endpointHash: hash(ep(2)), verdict: 'gone', status: 410 },
      { endpointHash: hash(ep(3)), verdict: 'refused', status: 500 },
    ] });
    behaviour.clear();
    const after = await push.notify(PAYLOAD);
    expect(after.kind === 'sent' && after.subs.map((s) => s.endpointHash)).toEqual([hash(ep(1)), hash(ep(3))]);
  });
});

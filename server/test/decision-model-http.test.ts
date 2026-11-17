// Overlord W2, the decision-model port's one adapter (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md,
// Task 3), against a fake `fetch` and a fake resolver driven by `fakeTime`. No test reaches a network or a real model, and
// every key and name is a fixture.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeDecisionRequest, isPrivateAddress, readDecisionAnswers } from '../src/coord/decisionModel.js';
import { createHttpDecisionModel, type DecisionKeyRead } from '../src/coord/decisionModelHttp.js';
import type { DecisionCall, DecisionFetch, DecisionWireRequest } from '../src/coord/decisionModelPort.js';
import type { DecisionFields } from '../src/coord/decisionModel.js';
import type { DecisionRowId } from '../../shared/decisionModel.js';
import { fakeTime, type FakeTime } from './fakeTime.js';

const KEY = 'fixture-key-0123456789abcdef-not-real';
const LOCAL = 'http://127.0.0.1:9000/v1/ask';
const HOSTED = 'https://model-host-a.example/v1/ask';
/** A public address, built here so none is written in the tree (TEST-NET-3, which is neither loopback nor private). */
const PUBLIC = [203, 0, 113, 7].join('.');
const REQ: DecisionWireRequest = { model: 'model-a', state: { part: { quoted: 'use a map' } },
  questions: { k1: { type: 'noul', instructions: 'Q?', criteria: { true: 'y', false: 'n' } } } };
const GOOD = JSON.stringify({ model: 'model-a', answers: { k1: { type: 'noul', noul: 0.9 } } });

type Step = { status: number; body?: string; latencyMs?: number } | { error: true; latencyMs?: number } | { hang: true }
  | { status: number; stream: AsyncIterable<Uint8Array> };

/** A body as the adapter reads it: chunks of at most 16 KiB. */
async function* chunks(text: string): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  for (let at = 0; at < bytes.length; at += 16384) yield bytes.subarray(at, at + 16384);
}

interface Harness { ft: FakeTime; calls: { url: string; init: Parameters<DecisionFetch>[1] }[]; resolved: string[] }

const harness = (steps: Step[], opts: { addresses?: readonly string[] | 'throw'; key?: DecisionKeyRead | 'throw' } = {}) => {
  const ft = fakeTime();
  const h: Harness = { ft, calls: [], resolved: [] };
  const fetch: DecisionFetch = async (url, init) => {
    h.calls.push({ url, init });
    const step = steps.shift();
    if (step === undefined) throw new Error('unscripted fetch');
    if ('hang' in step) {
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    if ('stream' in step) return { status: step.status, body: step.stream };
    if (step.latencyMs !== undefined) ft.advance(step.latencyMs);
    if ('error' in step) throw new Error('network down');
    return { status: step.status, body: chunks(step.body ?? '') };
  };
  const resolve = async (name: string): Promise<readonly string[]> => {
    h.resolved.push(name);
    if (opts.addresses === 'throw') throw new Error('no such name');
    return opts.addresses ?? ['127.0.0.1'];
  };
  const make = (endpoint: string, kind: 'hosted' | 'local' | 'zero-retention' = 'local') => createHttpDecisionModel(
    { kind, endpoint }, () => {
      if (opts.key === 'throw') throw new Error('the key store broke');
      return opts.key ?? { kind: 'value', value: KEY };
    }, { fetch, resolve, time: ft.ports, isPrivateAddress });
  return { h, make };
};

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => { consoleSpies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m)); });
afterEach(() => {
  // The adapter logs nothing, on any path.
  for (const s of consoleSpies) expect(s).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const noKey = (c: DecisionCall): void => expect(JSON.stringify(c)).not.toContain(KEY);

describe('createHttpDecisionModel: what it receives, and what it answers', () => {
  it('200 with a JSON body: ok, one attempt, the parsed body', async () => {
    const { h, make } = harness([{ status: 200, body: GOOD, latencyMs: 40 }]);
    const c = await make(LOCAL).ask(REQ);
    expect(c).toEqual({ ok: true, answer: JSON.parse(GOOD), ms: 40, attempts: 1 });
    expect(h.ft.pending()).toBe(0);
    noKey(c);
  });

  it.each([[401, 'auth-failed'], [403, 'auth-failed'], [413, 'over-size'], [400, 'refused'], [404, 'refused'], [422, 'refused']] as const)(
    '%i: %s, never retried', async (status, outcome) => {
      const { h, make } = harness([{ status, body: `secret detail ${KEY}` }]);
      const c = await make(LOCAL).ask(REQ);
      expect(c).toEqual({ ok: false, outcome, status, ms: 0, attempts: 1 });
      expect(h.calls).toHaveLength(1);
      expect(h.ft.pending()).toBe(0);
      expect(JSON.stringify(c)).not.toContain('secret detail');
      noKey(c);
    });

  it.each([429, 500, 503])('%i then 200: retried once, two attempts', async (status) => {
    const { h, make } = harness([{ status }, { status: 200, body: GOOD }]);
    const c = await make(LOCAL).ask(REQ);
    expect(c).toMatchObject({ ok: true, attempts: 2 });
    expect(h.calls).toHaveLength(2);
    expect(h.ft.pending()).toBe(0);
  });

  it('5xx twice: server-error with the last status, two attempts, never a third', async () => {
    const { h, make } = harness([{ status: 502 }, { status: 503 }]);
    const c = await make(LOCAL).ask(REQ);
    expect(c).toEqual({ ok: false, outcome: 'unavailable', why: 'server-error', status: 503, ms: 0, attempts: 2 });
    expect(h.calls).toHaveLength(2);
  });

  it('a 5xx at 1,600 ms is not retried: 400 ms left is under the 500 ms a retry needs', async () => {
    const { h, make } = harness([{ status: 500, latencyMs: 1600 }]);
    const c = await make(LOCAL).ask(REQ);
    expect(c).toEqual({ ok: false, outcome: 'unavailable', why: 'server-error', status: 500, ms: 1600, attempts: 1 });
    expect(h.calls).toHaveLength(1);
  });

  it('a 5xx at 1,499 ms is retried: 501 ms left', async () => {
    const { h, make } = harness([{ status: 500, latencyMs: 1499 }, { status: 200, body: GOOD }]);
    expect(await make(LOCAL).ask(REQ)).toMatchObject({ ok: true, attempts: 2 });
    expect(h.calls).toHaveLength(2);
  });

  it('a network error: retried once; twice: unreachable, two attempts', async () => {
    const once = harness([{ error: true }, { status: 200, body: GOOD }]);
    expect(await once.make(LOCAL).ask(REQ)).toMatchObject({ ok: true, attempts: 2 });
    const twice = harness([{ error: true }, { error: true }]);
    const c = await twice.make(LOCAL).ask(REQ);
    expect(c).toEqual({ ok: false, outcome: 'unavailable', why: 'unreachable', status: null, ms: 0, attempts: 2 });
    expect(twice.h.ft.pending()).toBe(0);
  });

  it('the deadline passes: timeout, never retried, and the handle is closed', async () => {
    const { h, make } = harness([{ hang: true }, { status: 200, body: GOOD }]);
    const p = make(LOCAL).ask(REQ);
    await settle();
    expect(h.ft.pending()).toBe(1);
    h.ft.advance(2000);
    const c = await p;
    expect(c).toEqual({ ok: false, outcome: 'unavailable', why: 'timeout', status: null, ms: 2000, attempts: 1 });
    expect(h.calls).toHaveLength(1);
    expect(h.ft.pending()).toBe(0);
  });

  it('a body that is not JSON, or over 64 KiB: malformed, never retried', async () => {
    const bad = harness([{ status: 200, body: 'not json' }]);
    expect(await bad.make(LOCAL).ask(REQ)).toEqual({ ok: false, outcome: 'malformed', why: 'not-json', ms: 0, attempts: 1 });
    const big = harness([{ status: 200, body: JSON.stringify({ pad: 'x'.repeat(65536) }) }]);
    expect(await big.make(LOCAL).ask(REQ)).toEqual({ ok: false, outcome: 'malformed', why: 'too-large', ms: 0, attempts: 1 });
    const edge = harness([{ status: 200, body: `"${'x'.repeat(65534)}"` }]);
    expect(await edge.make(LOCAL).ask(REQ)).toMatchObject({ ok: true });
  });

  it('an endless body: reading stops at the first chunk past 64 KiB, and the stream is closed (review 2324 F6)', async () => {
    let read = 0;
    let closed = false;
    const endless: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({
      next: async () => { read += 1; return { done: false, value: new Uint8Array(16384) }; },
      return: async () => { closed = true; return { done: true, value: undefined }; },
    }) };
    const { make } = harness([{ status: 200, stream: endless }]);
    expect(await make(LOCAL).ask(REQ)).toEqual({ ok: false, outcome: 'malformed', why: 'too-large', ms: 0, attempts: 1 });
    expect(read).toBe(5);
    expect(closed).toBe(true);
  });

  it('a key reader that throws: no request, unavailable no-key, 0 attempts (review 2324 F3)', async () => {
    const { h, make } = harness([], { key: 'throw' });
    const c = await make(LOCAL).ask(REQ);
    expect(c).toEqual({ ok: false, outcome: 'unavailable', why: 'no-key', status: null, ms: 0, attempts: 0 });
    expect(h.calls).toHaveLength(0);
    expect(h.ft.pending()).toBe(0);
  });

  it('a key that reads absent or unreadable: no request, unavailable no-key, 0 attempts', async () => {
    for (const kind of ['absent', 'unreadable'] as const) {
      const { h, make } = harness([], { key: { kind } });
      expect(await make(LOCAL).ask(REQ)).toEqual({ ok: false, outcome: 'unavailable', why: 'no-key', status: null, ms: 0, attempts: 0 });
      expect(h.calls).toHaveLength(0);
      expect(h.ft.pending()).toBe(0);
    }
  });
});

describe('createHttpDecisionModel: the endpoint is checked at each call (question 6, ruling F8)', () => {
  it('a local host named by a host name is refused before any resolve or fetch: endpoint-not-literal (review 2324 F2)', async () => {
    const { h, make } = harness([{ status: 200, body: GOOD }], { addresses: ['10.0.0.7'] });
    const c = await make('https://model.lan-a:8443/ask').ask(REQ);
    expect(c).toEqual({ ok: false, outcome: 'unavailable', why: 'endpoint-not-literal', status: null, ms: 0, attempts: 0 });
    expect(h.resolved).toEqual([]);
    expect(h.calls).toHaveLength(0);
    expect(h.ft.pending()).toBe(0);
  });

  it('a local host on localhost is resolved and checked: loopback is asked, a public answer refused', async () => {
    const ok = harness([{ status: 200, body: GOOD }], { addresses: ['127.0.0.1'] });
    expect(await ok.make('http://localhost:9000/ask').ask(REQ)).toMatchObject({ ok: true });
    expect(ok.h.resolved).toEqual(['localhost']);
    const bad = harness([], { addresses: ['127.0.0.1', PUBLIC] });
    expect(await bad.make('https://localhost:8443/ask').ask(REQ)).toMatchObject({ outcome: 'unavailable', why: 'endpoint-not-private' });
    expect(bad.h.calls).toHaveLength(0);
  });

  it('a local host on a public literal is refused before any fetch', async () => {
    const { h, make } = harness([], { addresses: [PUBLIC] });
    const c = await make(`https://${PUBLIC}:8443/ask`).ask(REQ);
    expect(c).toEqual({ ok: false, outcome: 'unavailable', why: 'endpoint-not-private', status: null, ms: 0, attempts: 0 });
    expect(h.calls).toHaveLength(0);
    expect(h.resolved).toEqual([PUBLIC]);
  });

  it('a local host on a private literal over https: asked', async () => {
    const { h, make } = harness([{ status: 200, body: GOOD }], { addresses: ['10.0.0.7'] });
    expect(await make('https://10.0.0.7:8443/ask').ask(REQ)).toMatchObject({ ok: true });
    expect(h.calls).toHaveLength(1);
  });

  it('an http endpoint on a private but not loopback address is refused: a key goes over http to loopback only', async () => {
    const { h, make } = harness([], { addresses: ['10.0.0.7'] });
    expect(await make('http://model.lan-a:8000/ask', 'zero-retention').ask(REQ)).toMatchObject({ outcome: 'unavailable', why: 'endpoint-not-private' });
    expect(await harness([], { addresses: ['10.0.0.7'] }).make('http://10.0.0.7:8000/ask').ask(REQ))
      .toMatchObject({ outcome: 'unavailable', why: 'endpoint-not-private' });
    expect(h.calls).toHaveLength(0);
  });

  it('an http endpoint on an IPv6 loopback literal: resolved without its brackets, and asked', async () => {
    const { h, make } = harness([{ status: 200, body: GOOD }], { addresses: ['::1'] });
    expect(await make('http://[::1]:9000/ask').ask(REQ)).toMatchObject({ ok: true });
    expect(h.resolved).toEqual(['::1']);
  });

  it('a name that does not resolve, or resolves to nothing: unreachable, 0 attempts', async () => {
    for (const addresses of ['throw', []] as const) {
      const { h, make } = harness([], { addresses });
      expect(await make('http://model.lan-a/ask', 'zero-retention').ask(REQ)).toMatchObject({ outcome: 'unavailable', why: 'unreachable', attempts: 0 });
      expect(h.calls).toHaveLength(0);
    }
  });

  it('a hosted https endpoint is not resolved: the check is the local and http rules only', async () => {
    const { h, make } = harness([{ status: 200, body: GOOD }], { addresses: [PUBLIC] });
    expect(await make(HOSTED, 'hosted').ask(REQ)).toMatchObject({ ok: true });
    expect(h.resolved).toEqual([]);
  });

  it('an endpoint that does not parse: its own word, 0 attempts, origin null (review 2324 F4)', async () => {
    const { h, make } = harness([]);
    const m = make('not a url');
    expect(m.origin).toBeNull();
    expect(await m.ask(REQ)).toEqual({ ok: false, outcome: 'unavailable', why: 'endpoint-unparseable', status: null, ms: 0, attempts: 0 });
    expect(h.calls).toHaveLength(0);
  });
});

describe('createHttpDecisionModel: the request it sends (review 2262 F19)', () => {
  it('POSTs the request to the endpoint as stored, redirect error, the key only as a bearer value', async () => {
    const { h, make } = harness([{ status: 200, body: GOOD }]);
    const m = make(LOCAL);
    expect([m.kind, m.origin]).toEqual(['local', 'http://127.0.0.1:9000']);
    await m.ask(REQ);
    const [{ url, init }] = h.calls as [Harness['calls'][number]];
    expect(url).toBe(LOCAL);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toEqual({ 'content-type': 'application/json', authorization: `Bearer ${KEY}` });
    expect(init.body).toBe(JSON.stringify(REQ));
    expect(init.body).not.toContain(KEY);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('the key appears in no answer on any path', async () => {
    const paths: Step[][] = [[{ status: 200, body: GOOD }], [{ status: 401, body: KEY }], [{ status: 500 }, { status: 500 }],
      [{ error: true }, { error: true }], [{ status: 200, body: KEY }], [{ status: 400, body: KEY }]];
    for (const steps of paths) noKey(await harness(steps).make(LOCAL).ask(REQ));
  });
});

describe('the recorded fixture (question 2): the wire as read from the published reference', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/decision-model');
  const recorded = JSON.parse(readFileSync(path.join(dir, 'request.json'), 'utf8')) as {
    rows: DecisionRowId[]; fields: Record<string, DecisionFields>; opaque: string[]; modelId: string; body: unknown };
  const answer = JSON.parse(readFileSync(path.join(dir, 'answer.json'), 'utf8')) as unknown;

  it('its request round-trips through encodeDecisionRequest byte for byte', () => {
    const e = encodeDecisionRequest(recorded.rows, new Map(Object.entries(recorded.fields) as [DecisionRowId, DecisionFields][]),
      recorded.modelId, recorded.opaque);
    if ('refused' in e) throw new Error(e.refused);
    expect(JSON.stringify(e.body)).toBe(JSON.stringify(recorded.body));
  });

  it('its answer reads through readDecisionAnswers', () => {
    const e = encodeDecisionRequest(recorded.rows, new Map(Object.entries(recorded.fields) as [DecisionRowId, DecisionFields][]),
      recorded.modelId, recorded.opaque);
    if ('refused' in e) throw new Error(e.refused);
    expect(readDecisionAnswers(e.keys, recorded.modelId, answer)).toEqual(new Map<DecisionRowId, unknown>([
      ['programme.pick', { verdict: { option: 'programme-b' }, p: 0.71, band: 'likely' }],
      ['programme.any', { verdict: 'yes', p: 0.88, band: 'very-likely' }],
    ]));
  });
});

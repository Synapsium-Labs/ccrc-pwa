// Native Docs HTML artifacts X5, plan Task A3.3: the content door, `/clear` and the route hosts (spec sections 3.4, 4.3 and 5).
// The real artifact instance is built over a real capability store (a clock that reads `Date.now`, a fake liveness) and a FAKE
// `ArtifactBytes` this file controls: scripted frames, held reads released by hand, and counters of prepares and frame reads. The
// header sets, the sandbox, the cache rule and the fixed words are written HERE from the spec and never imported where a changed
// constant would then pass. Requests go over a REAL loopback socket (`node:http`) unless a case says `app.inject`: a real client
// can send a path exactly as written, read slowly, and see a reset. Cases that move time run `vi.useFakeTimers` over `setTimeout`,
// `clearTimeout` and `Date` only (the sockets are real, so no I/O timer is faked); each such case says so.
import http from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ARTIFACT_FRAME_STALL_MS, ARTIFACT_HOURLY_BYTES, ARTIFACT_QUEUE_WAIT_MS, ARTIFACT_RESPONSE_MAX_MS } from '../../shared/artifacts.js';
import { DOCS_RANGE_MAX_BYTES, type DocPin } from '../../shared/docs.js';
import { artifactConfig, budgetSpent, contentCsp, contentHeaders, contentKey, contentRequestPath, contentStatus, prepareSlot,
  prepareTimeoutAction, prepareWaitUntil, readEndVerdict, readFailureAction, routeHostOk, statusAnswerKind, withPrepareStart,
  type ArtifactConfig } from '../src/artifacts/policy.js';
import type { ArtifactBytes, ArtifactPrepareAnswer, ArtifactReadAnswer, ArtifactReadAt, ArtifactSinkAnswer, SessionLiveness }
  from '../src/artifacts/ports.js';
import { ARTIFACT_NOT_FOUND_BODY, buildArtifactServer } from '../src/artifacts/routes.js';
import { createArtifactStore, type ArtifactManifestEntry, type CapabilityInput } from '../src/artifacts/store.js';
import { artifactMime } from '../../shared/artifacts.js';

const ART = 'art.artifacts.invalid';
const CONTENT = 'content.artifacts.invalid';
const ART_ORIGIN = `https://${ART}`;
const CONTENT_ORIGIN = `https://${CONTENT}`;
const CONSOLE_ORIGIN = 'https://console.example.test';
const T0 = 1_800_000_000_000;
const COMMIT = 'abcdef0123456789abcdef0123456789abcdef01';
const SHA = 'b'.repeat(64);
const SESSION = 'c0ffee'.repeat(10) + 'abcd';
const SPEC_VARY = 'Sec-Fetch-Dest, Service-Worker';
const MIB = 1024 * 1024;
const FRAME = 512 * 1024;

/** Spec 4.3, written out: the other headers on every content response. */
const SPEC_CONTENT_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-dns-prefetch-control': 'off',
  'x-robots-tag': 'noindex, nofollow',
  'accept-ranges': 'bytes',
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), payment=(), display-capture=(), fullscreen=(self), clipboard-write=(self)',
};

type On = Extract<ArtifactConfig, { state: 'on' }>;
function onConfig(): On {
  const c = artifactConfig({ origin: ART_ORIGIN, content: CONTENT_ORIGIN, port: '7790' }, CONSOLE_ORIGIN, 7788);
  if (c.state !== 'on') throw new Error(`the fixture config is not on: ${JSON.stringify(c)}`);
  return c;
}

let counter = 0;
/** A well-formed, distinct token per draw: 43 base64url characters. */
const nextToken = (): string => `t${String(++counter).padStart(42, '0')}`;

const tick = (): Promise<void> => new Promise((r) => { setImmediate(r); });

interface Deferred<T> { promise: Promise<T>; resolve(v: T): void }
function deferred<T = void>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const hashOf = (key: string): number => { let h = 7; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) & 0xff; return h; };
/** The bytes of `key` from `start`, `len` of them: position-dependent, so a wrong offset or a swapped file is seen. */
function bytesOf(key: string, start: number, len: number): Buffer {
  const h = hashOf(key);
  const b = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) b[i] = (h + start + i) & 0xff;
  return b;
}

/** Byte equality for large bodies, which `toEqual` would compare element by element. */
const same = (a: Buffer, b: Buffer): boolean => a.equals(b);

interface ReadCall { key: string; range: { start: number; end: number }; snapshot: string | null; size: number }
interface HeldRead { call: ReadCall; release(): void; sinkAnswers: ArtifactSinkAnswer[]; done: Promise<void> }

/** The fake bytes port: it reads like the real adapter (a whole show cut to the range, or frames of 512 KiB after a snapshot), and a
 *  case swaps in a script for the read or the prepare. */
class FakeBytes implements ArtifactBytes {
  reads: ReadCall[] = [];
  prepares: { key: string; at: number }[] = [];
  frameReads = 0;
  framesSunk = 0;
  activity = 0;
  prepareRunning = 0;
  maxPrepareRunning = 0;
  held: HeldRead[] = [];
  readScript: ((c: ReadCall, sink: (f: Uint8Array) => Promise<ArtifactSinkAnswer>, signal: AbortSignal) => Promise<ArtifactReadAnswer>) | null = null;
  prepareScript: ((key: string, n: number, signal: AbortSignal) => Promise<ArtifactPrepareAnswer>) | null = null;
  /** Called before frame `n` (1-based) of a default read is produced. */
  onFrame: ((n: number, c: ReadCall) => void) | null = null;
  onRead: ((c: ReadCall) => void) | null = null;

  async prepare(at: ArtifactReadAt, _entry: ArtifactManifestEntry, signal: AbortSignal): Promise<ArtifactPrepareAnswer> {
    this.activity++;
    this.prepares.push({ key: at.path, at: Date.now() });
    this.prepareRunning++;
    this.maxPrepareRunning = Math.max(this.maxPrepareRunning, this.prepareRunning);
    try {
      if (this.prepareScript !== null) return await this.prepareScript(at.path, this.prepares.length, signal);
      return { ok: true, snapshot: `snap${this.prepares.length}` };
    } finally {
      this.prepareRunning--;
    }
  }

  async read(
    at: ArtifactReadAt, entry: ArtifactManifestEntry, range: { start: number; end: number }, snapshot: string | null,
    sink: (f: Uint8Array) => Promise<ArtifactSinkAnswer>, signal: AbortSignal,
  ): Promise<ArtifactReadAnswer> {
    this.activity++;
    const call: ReadCall = { key: at.path, range, snapshot, size: entry.size };
    this.reads.push(call);
    this.onRead?.(call);
    if (this.readScript !== null) return this.readScript(call, sink, signal);
    if (snapshot === null) {
      this.frameReads++;
      this.onFrame?.(1, call);
      await sink(bytesOf(at.path, range.start, range.end - range.start + 1));
      this.framesSunk++;
      this.activity++;
      return { ok: true };
    }
    let n = 0;
    for (let offset = range.start; offset <= range.end;) {
      const len = Math.min(FRAME, range.end - offset + 1);
      this.frameReads++;
      this.onFrame?.(++n, call);
      const answer = await sink(bytesOf(at.path, offset, len));
      this.framesSunk++;
      this.activity++;
      if (answer === 'stop') return { ok: true };
      offset += len;
    }
    return { ok: true };
  }

  /** Hold every read: each writes its first half, waits for `release()`, then writes the rest. */
  holdAll(): void {
    this.readScript = async (c, sink) => {
      const gate = deferred();
      const sinkAnswers: ArtifactSinkAnswer[] = [];
      const done = deferred();
      const held: HeldRead = { call: c, release: () => gate.resolve(), sinkAnswers, done: done.promise };
      this.held.push(held);
      this.activity++;
      const len = c.range.end - c.range.start + 1;
      const half = Math.max(1, Math.floor(len / 2));
      sinkAnswers.push(await sink(bytesOf(c.key, c.range.start, half)));
      await gate.promise;
      if (sinkAnswers[0] === 'next' && len > half) sinkAnswers.push(await sink(bytesOf(c.key, c.range.start + half, len - half)));
      done.resolve();
      return { ok: true };
    };
  }
}

interface Rig {
  app: FastifyInstance;
  store: ReturnType<typeof createArtifactStore>;
  bytes: FakeBytes;
  ended: Set<string>;
  port: number;
  sockets: net.Socket[];
}

let toClose: FastifyInstance[] = [];
let allSockets: net.Socket[] = [];
let clients: http.ClientRequest[] = [];
let spies: ReturnType<typeof vi.spyOn>[] = [];
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

beforeEach(() => {
  spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});

afterEach(async () => {
  // The whole file's logging rule: nothing on any console method, in any case, holds a path or a token.
  const calls = spies.flatMap((s) => s.mock.calls);
  vi.useRealTimers();
  vi.restoreAllMocks();
  expect(calls, 'a console method was called during a case').toEqual([]);
  for (const c of clients) c.destroy();
  clients = [];
  for (const s of allSockets) s.destroy();
  allSockets = [];
  for (const a of toClose) await a.close().catch(() => {});
  toClose = [];
});

async function rig(setup?: (app: FastifyInstance) => void): Promise<Rig> {
  const ended = new Set<string>();
  const liveness: SessionLiveness = { of: (h) => (ended.has(h) ? 'ended' : 'live') };
  const store = createArtifactStore(() => Date.now(), liveness, nextToken, () => `id${++counter}`);
  const bytes = new FakeBytes();
  const app = buildArtifactServer({ cfg: onConfig(), store, bytes, now: () => Date.now() });
  setup?.(app);
  toClose.push(app);
  const sockets: net.Socket[] = [];
  app.server.on('connection', (s) => { sockets.push(s); allSockets.push(s); });
  await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, store, bytes, ended, port: (app.server.address() as AddressInfo).port, sockets };
}

/** Fake `setTimeout`, `clearTimeout` and `Date` only, at T0: the sockets stay real. */
function fakeTime(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(T0);
}
const advance = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); };

/** Let real I/O and the port's counters go quiet for `ms` of real time. */
async function settle(r: Rig, ms = 60): Promise<void> {
  let last = r.bytes.activity;
  let since = performance.now();
  while (performance.now() - since < ms) {
    await tick();
    if (r.bytes.activity !== last) { last = r.bytes.activity; since = performance.now(); }
  }
}

/** Poll `cond` over real time until it holds or `ms` pass. */
async function until(cond: () => boolean, ms = 2000): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < ms) {
    if (cond()) return true;
    await tick();
  }
  return cond();
}

interface FileSpec { size: number; committed?: boolean; mime?: string }
function mint(
  r: Rig, files: Record<string, number | FileSpec>,
  over: { dir?: string; page?: string; windows?: boolean; origins?: string[]; session?: string; drafts?: boolean } = {},
): { token: string; id: string } {
  const dir = over.dir ?? 'x';
  const manifest = new Map<string, ArtifactManifestEntry>();
  for (const [rel, spec] of Object.entries(files)) {
    const f: FileSpec = typeof spec === 'number' ? { size: spec } : spec;
    const key = dir === '' ? rel : `${dir}/${rel}`;
    manifest.set(key, { rel: key, pin: { kind: 'blob', sha: SHA }, size: f.size, mime: f.mime ?? artifactMime(key).mime, committed: f.committed ?? true });
  }
  const pin: DocPin = { kind: 'committed', commit: COMMIT, servedRef: 'main', section: 'specs', path: over.page ?? (dir === '' ? 'page.html' : `${dir}/page.html`) };
  const input: CapabilityInput = {
    sessionIdHash: over.session ?? SESSION, project: 'project-a', pin, ref: { commit: COMMIT, served: 'main' }, section: 'specs', dir,
    page: pin.path, manifest, origins: over.origins ?? [], windows: over.windows ?? false,
  };
  const m = r.store.mint(input);
  if (!m.ok) throw new Error(`mint refused: ${m.error}`);
  return { token: m.token, id: m.id };
}

interface Got { status: number; headers: IncomingHttpHeaders; body: Buffer; outcome: 'complete' | 'reset' }
interface Pending {
  promise: Promise<Got>;
  settled(): boolean;
  destroy(): void;
  pause(): void;
  resume(): void;
  received(): number;
  result(): Got | null;
}
/** The headers of a same-origin subresource fetch from the page (a script), the common case. */
const SUBRESOURCE: Record<string, string> = { 'sec-fetch-dest': 'script', 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'same-origin' };
const NAVIGATION: Record<string, string> = { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin' };

/** One GET over a real socket, the path exactly as written. A header set to `null` is not sent. */
function fetchPath(
  r: Rig, path: string, headers: Record<string, string | null> = {}, opts: { paused?: boolean; method?: 'GET' | 'HEAD' } = {},
): Pending {
  const merged: Record<string, string | null> = { host: CONTENT, ...SUBRESOURCE, ...headers };
  const sent: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) if (v !== null) sent[k] = v;
  const req = http.request({ host: '127.0.0.1', port: r.port, path, method: opts.method ?? 'GET', headers: sent, agent: false });
  clients.push(req);
  let res: http.IncomingMessage | null = null;
  let received = 0;
  let result: Got | null = null;
  const promise = new Promise<Got>((resolve) => {
    const chunks: Buffer[] = [];
    const finish = (g: Got): void => { if (result === null) { result = g; resolve(g); } };
    req.on('response', (m) => {
      res = m;
      m.on('data', (c: Buffer) => { chunks.push(c); received += c.length; });
      m.on('error', () => {});
      if (opts.paused === true) m.pause();
      m.on('close', () => finish({ status: m.statusCode ?? 0, headers: m.headers, body: Buffer.concat(chunks), outcome: m.complete ? 'complete' : 'reset' }));
    });
    req.on('error', () => { if (res === null) finish({ status: 0, headers: {}, body: Buffer.alloc(0), outcome: 'reset' }); });
    req.end();
  });
  return {
    promise, settled: () => result !== null, destroy: () => req.destroy(), pause: () => res?.pause(), resume: () => res?.resume(),
    received: () => received, result: () => result,
  };
}

const getFile = (r: Rig, token: string, rel: string, headers: Record<string, string | null> = {}, opts: { paused?: boolean } = {}): Pending =>
  fetchPath(r, `/c/${token}/${rel}`, headers, opts);

const BODY_404 = ARTIFACT_NOT_FOUND_BODY;

// ---- L1: the pure decisions this door applies -----------------------------------------------------------------------------

describe('content policy: the raw path, the hosts and the prepare slot (L1)', () => {
  it('contentRequestPath cuts the query, decodes once, and refuses every traversal spelling', () => {
    const T = 'A'.repeat(43);
    expect(contentRequestPath(`/c/${T}/a%20b.js?v=2#f`)).toEqual({ token: T, rel: 'a b.js' });
    expect(contentRequestPath(`/c/${T}/%2520`)).toEqual({ token: T, rel: '%20' });
    expect(contentRequestPath(`/c/${T}/d/e.js`)).toEqual({ token: T, rel: 'd/e.js' });
    for (const bad of ['..', '%2e%2e', '%2E%2E%2F', 'a/../b', 'a/./b', 'a//b', '/a', 'a/', 'a\\b', 'a%5Cb', 'a%00b', 'a%zz', '', '.']) {
      expect(contentRequestPath(`/c/${T}/${bad}`), bad).toBeNull();
    }
    expect(contentRequestPath(`/c/${T}`)).toBeNull();
    expect(contentRequestPath(`/c//x`)).toBeNull();
    expect(contentRequestPath(`/a/${T}/x`)).toBeNull();
    expect(contentKey('', 'a.js')).toBe('a.js');
    expect(contentKey('x/y', 'a.js')).toBe('x/y/a.js');
  });

  it('routeHostOk: the wrapper on the artifact host, the content door and clear on the content host, the root on either', () => {
    const cfg = { artifactHost: ART, contentHost: CONTENT };
    expect([ART, CONTENT, undefined, 'other.test'].map((h) => routeHostOk('wrapper', h, cfg))).toEqual([true, false, false, false]);
    expect([ART, CONTENT, undefined, 'other.test'].map((h) => routeHostOk('content', h, cfg))).toEqual([false, true, false, false]);
    expect([ART, CONTENT, undefined, 'other.test'].map((h) => routeHostOk('clear', h, cfg))).toEqual([false, true, false, false]);
    expect([ART, CONTENT, undefined, 'other.test'].map((h) => routeHostOk('root', h, cfg))).toEqual([true, true, false, false]);
  });

  it('prepareSlot: one at a time, three a minute', () => {
    expect(prepareSlot({ running: false, starts: [] }, 1000)).toEqual({ kind: 'start' });
    expect(prepareSlot({ running: true, starts: [] }, 1000)).toEqual({ kind: 'wait', until: null });
    expect(prepareSlot({ running: false, starts: [1000, 1000, 1000] }, 59999)).toEqual({ kind: 'wait', until: 61000 });
    expect(prepareSlot({ running: false, starts: [1000, 2000, 3000] }, 61000)).toEqual({ kind: 'start' });
    expect(prepareSlot({ running: false, starts: [1000, 2000, 3000] }, 60999)).toEqual({ kind: 'wait', until: 61000 });
    expect(prepareSlot({ running: false, starts: [1000, 2000] }, 3000)).toEqual({ kind: 'start' });
  });

  it('readFailureAction: before a byte 409, 503 or 404; after one the socket is cut; snapshot-gone prepares once', () => {
    expect(readFailureAction('draft-changed', false, false)).toEqual({ kind: 'status', status: 409 });
    expect(readFailureAction('busy', false, false)).toEqual({ kind: 'status', status: 503 });
    for (const e of ['unreadable', 'too-large', 'frame-digest']) expect(readFailureAction(e, false, false), e).toEqual({ kind: 'status', status: 404 });
    for (const e of ['draft-changed', 'busy', 'unreadable', 'frame-digest']) expect(readFailureAction(e, true, false), e).toEqual({ kind: 'destroy' });
    expect(readFailureAction('snapshot-gone', false, false)).toEqual({ kind: 'reprepare' });
    expect(readFailureAction('snapshot-gone', true, false)).toEqual({ kind: 'reprepare' });
    expect(readFailureAction('snapshot-gone', true, true)).toEqual({ kind: 'destroy' });
    expect(readFailureAction('snapshot-gone', false, true)).toEqual({ kind: 'status', status: 404 });
  });

  it('contentHeaders: the type, length, CSP, every content header, the cache rule, the attachment and the range', () => {
    const base = { contentOrigin: CONTENT_ORIGIN, artifactOrigin: ART_ORIGIN, token: 'T'.repeat(43), origins: ['https://cdn.example.test'], windows: true, secondsLeft: 90 };
    const js = contentHeaders({ ...base, key: 'x/a.js', entry: { mime: 'text/javascript', size: 10 }, range: null });
    expect(js['content-type']).toBe('text/javascript; charset=utf-8');
    expect(js['content-length']).toBe('10');
    expect(js['cache-control']).toBe('no-store');
    expect(js['content-security-policy']).toBe(contentCsp(CONTENT_ORIGIN, ART_ORIGIN, 'T'.repeat(43), ['https://cdn.example.test'], true));
    for (const [k, v] of Object.entries(SPEC_CONTENT_HEADERS)) expect(js[k], k).toBe(v);
    expect(js['vary']).toBe(SPEC_VARY);
    expect(js['content-disposition']).toBeUndefined();
    const wasm = contentHeaders({ ...base, key: 'x/m.wasm', entry: { mime: 'application/wasm', size: 100 }, range: { start: 10, end: 19 } });
    expect(wasm['content-type']).toBe('application/wasm');
    expect(wasm['content-length']).toBe('10');
    expect(wasm['content-range']).toBe('bytes 10-19/100');
    expect(wasm['cache-control']).toBe('private, max-age=90, immutable');
    const exe = contentHeaders({ ...base, key: 'x/a.exe', entry: { mime: 'application/octet-stream', size: 5 }, range: null });
    expect(exe['content-disposition']).toBe('attachment');
    for (const h of [js, wasm, exe]) {
      expect(Object.keys(h).filter((k) => k === 'set-cookie' || k.startsWith('access-control-'))).toEqual([]);
    }
  });
});

// ---- the door -----------------------------------------------------------------------------------------------------------

describe('content: the path', () => {
  it('content: names decode once', async () => {
    const r = await rig();
    const { token } = mint(r, { 'a b.js': 10, 'é.js': 11, '%20': 12, 'a%20b.js': 13 });
    const space = await getFile(r, token, 'a%20b.js').promise;
    expect(space.status).toBe(200);
    expect(space.body).toEqual(bytesOf('x/a b.js', 0, 10));
    const accent = await getFile(r, token, '%C3%A9.js').promise;
    expect(accent.status).toBe(200);
    expect(accent.body).toEqual(bytesOf('x/é.js', 0, 11));
    // `%2520` is decoded once, to the literal `%20`: it finds the file named `%20`, never `a b`, never a second decode to a space.
    const percent = await getFile(r, token, '%2520').promise;
    expect(percent.status).toBe(200);
    expect(percent.body).toEqual(bytesOf('x/%20', 0, 12));
    // The file literally named `a%20b.js` is reached by encoding its percent sign.
    const literal = await getFile(r, token, 'a%2520b.js').promise;
    expect(literal.status).toBe(200);
    expect(literal.body).toEqual(bytesOf('x/a%20b.js', 0, 13));
  });

  it('content: traversal spellings are the identical 404', async () => {
    const seen: string[] = [];
    const r = await rig((app) => { app.addHook('onRequest', async (req) => { seen.push(req.raw.url ?? ''); }); });
    // A capability built by hand whose manifest also holds the crafted keys `manifestScope` never makes.
    const { token } = mint(r, { 'page.html': 5, 'y.js': 7, 'x/../y.js': 8, 'x/./y.js': 9, 'x//y.js': 10, 'x\\y.js': 11, 'x/z.js': 3 }, { dir: '' });
    const control = await getFile(r, token, 'y.js').promise;
    expect(control.status, 'the lookup works for a plain name').toBe(200);
    expect((await getFile(r, token, 'x/z.js').promise).status, 'and for a nested one').toBe(200);
    const spellings = ['..', '%2e%2e', '%2E%2E%2F', 'x/../y.js', 'x/%2e%2e/y.js', 'x%2F..%2Fy.js', 'x/./y.js', 'x/%2e/y.js', 'x//y.js',
      'x%2F%2Fy.js', 'x\\y.js', 'x%5Cy.js', 'page%00.html', '/y.js'];
    seen.length = 0;
    const unknown = await getFile(r, 'u'.repeat(43), 'y.js').promise;
    expect(unknown.status).toBe(404);
    for (const s of spellings) {
      const got = await getFile(r, token, s).promise;
      expect(got.status, s).toBe(404);
      expect(got.body.toString(), s).toBe(BODY_404);
      expect(got.headers['content-type'], s).toBe(unknown.headers['content-type']);
      expect(got.headers['content-security-policy'], s).toBe(unknown.headers['content-security-policy']);
    }
    // The route saw each spelling exactly as sent, so the refusal, not the client or the router, is what answered.
    expect(seen.slice(1)).toEqual(spellings.map((s) => `/c/${token}/${s}`));
    expect(r.bytes.reads.map((c) => c.key)).toEqual(['y.js', 'x/z.js']);
  });

  it('content: a query string is ignored for the lookup', async () => {
    const r = await rig();
    const { token } = mint(r, { 'a.js': 10 });
    for (const q of ['?v=2', '?', '?v=2&r=../../x', '?%zz']) {
      const got = await getFile(r, token, `a.js${q}`).promise;
      expect(got.status, q).toBe(200);
      expect(got.body, q).toEqual(bytesOf('x/a.js', 0, 10));
    }
    expect((await getFile(r, token, 'a.js%3Fv=2').promise).status, 'an encoded question mark is part of the name').toBe(404);
  });
});

describe('content: the fences and the failures before a byte', () => {
  it('content: a changed draft answers 409, others load', async () => {
    const r = await rig();
    const { token } = mint(r, { 'draft.js': { size: 20, committed: false }, 'ok.js': 20, 'big.js': { size: 3 * MIB, committed: false } });
    r.bytes.readScript = async (c, sink) => {
      if (c.key === 'x/draft.js') return { ok: false, error: 'draft-changed' };
      await sink(bytesOf(c.key, c.range.start, c.range.end - c.range.start + 1));
      return { ok: true };
    };
    r.bytes.prepareScript = async (key) => (key === 'x/big.js' ? { ok: false, error: 'draft-changed' } : { ok: true, snapshot: 's' });
    const draft = await getFile(r, token, 'draft.js').promise;
    expect(draft.status).toBe(409);
    expect(draft.body.toString()).toBe('This draft file changed since the page was opened.');
    expect(draft.headers.vary).toBe(SPEC_VARY);
    const big = await getFile(r, token, 'big.js').promise;
    expect(big.status, 'a draft that changed before its prepare is the same 409').toBe(409);
    const ok = await getFile(r, token, 'ok.js').promise;
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(bytesOf('x/ok.js', 0, 20));
  });

  it('content: the fences hold at the route', async () => {
    const r = await rig();
    const { token } = mint(r, { 'a.js': 10, 'i.svg': 12, 'p.html': 14, 'data.csv': 16 });
    const inj = (rel: string, headers: Record<string, string>) =>
      r.app.inject({ method: 'GET', url: `/c/${token}/${rel}`, headers: { host: CONTENT, ...headers } });
    const sw = await inj('a.js', { ...SUBRESOURCE, 'sec-fetch-dest': 'serviceworker' });
    expect(sw.statusCode).toBe(403);
    expect(sw.body).toBe('Forbidden.');
    expect(sw.headers.vary).toBe(SPEC_VARY);
    expect((await inj('a.js', { ...SUBRESOURCE, 'service-worker': 'script' })).statusCode).toBe(403);
    expect((await inj('a.js', { ...SUBRESOURCE, 'service-worker': '' })).statusCode, 'an empty Service-Worker header is present').toBe(403);
    expect((await inj('a.js', { ...SUBRESOURCE, 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
    expect((await inj('a.js', { ...SUBRESOURCE, 'sec-fetch-site': 'same-site' })).statusCode).toBe(403);
    const noDest: Record<string, string> = { ...SUBRESOURCE };
    delete noDest['sec-fetch-dest'];
    expect((await inj('a.js', noDest)).statusCode, 'a missing Sec-Fetch-Dest fails closed').toBe(403);
    expect((await inj('a.js', { ...NAVIGATION, 'sec-fetch-dest': 'document' })).statusCode, 'a top-level navigation without windows').toBe(403);
    const svg = await inj('i.svg', { 'sec-fetch-dest': 'image', 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'same-origin' });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
    const html = await inj('p.html', { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin' });
    expect(html.statusCode, 'an HTML fetch from the page').toBe(200);
    const dl = await inj('data.csv', { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin' });
    expect(dl.statusCode, 'a download the page starts').toBe(200);
    // Header values are read lower-cased.
    expect((await inj('a.js', { 'sec-fetch-dest': 'IFRAME', 'sec-fetch-mode': 'Navigate', 'sec-fetch-site': 'Same-Origin' })).statusCode).toBe(200);
    expect(r.bytes.reads.length, 'a refused request reads nothing').toBe(4);
  });

  it('content: an empty file is served empty', async () => {
    const r = await rig();
    const { token } = mint(r, { 'empty.txt': 0, 'a.js': 10 });
    const got = await getFile(r, token, 'empty.txt').promise;
    expect(got.status).toBe(200);
    expect(got.headers['content-length']).toBe('0');
    expect(got.body.length).toBe(0);
    expect(got.outcome).toBe('complete');
    expect(got.headers['content-security-policy']).toBeDefined();
    expect(got.headers.vary).toBe(SPEC_VARY);
    expect(r.bytes.reads.length, 'an empty file is answered with no read').toBe(0);
    const ranged = await getFile(r, token, 'empty.txt', { range: 'bytes=0-0' }).promise;
    expect(ranged.status).toBe(416);
    expect(ranged.headers['content-range']).toBe('bytes */0');
    expect(r.store.boxInflight()).toBe(0);
  });

  it('content: a HEAD answers the head only, with no admission and no read', async () => {
    const r = await rig();
    const { token } = mint(r, { 'a.js': 10, 'w.wasm': 100 });
    const head = await fetchPath(r, `/c/${token}/w.wasm`, { range: 'bytes=10-19' }, { method: 'HEAD' }).promise;
    expect(head.status).toBe(206);
    expect(head.headers['content-range']).toBe('bytes 10-19/100');
    expect(head.headers['content-length']).toBe('10');
    expect(head.body.length).toBe(0);
    const plain = await fetchPath(r, `/c/${token}/a.js`, {}, { method: 'HEAD' }).promise;
    expect(plain.status).toBe(200);
    expect(plain.headers['content-length']).toBe('10');
    expect(r.bytes.reads.length).toBe(0);
    expect(r.bytes.prepares.length).toBe(0);
  });
});

describe('content: bytes, ranges and frames', () => {
  it('content: Content-Length equals the size', async () => {
    const r = await rig();
    const { token } = mint(r, { 'big.bin': DOCS_RANGE_MAX_BYTES });
    const got = await getFile(r, token, 'big.bin').promise;
    expect(got.status).toBe(200);
    expect(got.headers['content-length']).toBe(String(DOCS_RANGE_MAX_BYTES));
    expect(got.outcome).toBe('complete');
    expect(got.body.length).toBe(DOCS_RANGE_MAX_BYTES);
    expect(got.body.subarray(0, 4096)).toEqual(bytesOf('x/big.bin', 0, 4096));
    expect(got.body.subarray(DOCS_RANGE_MAX_BYTES - 4096)).toEqual(bytesOf('x/big.bin', DOCS_RANGE_MAX_BYTES - 4096, 4096));
    expect(r.bytes.frameReads, 'a 64 MiB file is 128 frames of 512 KiB').toBe(DOCS_RANGE_MAX_BYTES / FRAME);
    expect(r.bytes.prepares.length).toBe(1);
  });

  it('content: a bad frame aborts the response', async () => {
    const r = await rig();
    const { token } = mint(r, { 'three.bin': 3 * FRAME });
    const marker = Buffer.alloc(FRAME, 0xee);
    r.bytes.readScript = async (c, sink) => {
      await sink(bytesOf(c.key, 0, FRAME));
      // The second frame fails its digest: the port answers the failure and never hands the bad bytes (the marker) to the sink.
      void marker;
      return { ok: false, error: 'frame-digest' };
    };
    const got = await getFile(r, token, 'three.bin').promise;
    expect(got.status).toBe(200);
    expect(got.headers['content-length']).toBe(String(3 * FRAME));
    expect(got.outcome, 'a reset, never a short 200').toBe('reset');
    expect(same(got.body, bytesOf('x/three.bin', 0, FRAME))).toBe(true);
    expect(got.body.includes(marker.subarray(0, 64))).toBe(false);
    expect(await until(() => r.store.boxInflight() === 0)).toBe(true);
  });

  it('content: one range answers 206', async () => {
    const r = await rig();
    const { token } = mint(r, { 'three.bin': 3 * FRAME, 'small.bin': 1000 });
    const big = await getFile(r, token, 'three.bin', { range: 'bytes=100-199' }).promise;
    expect(big.status).toBe(206);
    expect(big.headers['content-range']).toBe(`bytes 100-199/${3 * FRAME}`);
    expect(big.headers['content-length']).toBe('100');
    expect(big.body).toEqual(bytesOf('x/three.bin', 100, 100));
    expect(r.bytes.reads[0]!.range).toEqual({ start: 100, end: 199 });
    expect(r.bytes.reads[0]!.snapshot).toBe('snap1');
    const tail = await getFile(r, token, 'small.bin', { range: 'bytes=-4' }).promise;
    expect(tail.status).toBe(206);
    expect(tail.headers['content-range']).toBe('bytes 996-999/1000');
    expect(tail.body).toEqual(bytesOf('x/small.bin', 996, 4));
    expect(big.headers.vary).toBe(SPEC_VARY);
  });

  it('content: two ranges answer 416', async () => {
    const r = await rig();
    const { token } = mint(r, { 'small.bin': 1000 });
    for (const range of ['bytes=0-1,4-5', 'bytes=1000-', 'bytes=2000-3000']) {
      const got = await getFile(r, token, 'small.bin', { range }).promise;
      expect(got.status, range).toBe(416);
      expect(got.headers['content-range'], range).toBe('bytes */1000');
      expect(got.headers.vary, range).toBe(SPEC_VARY);
      expect(got.body.length < 100, range).toBe(true);
    }
    expect(r.bytes.reads.length).toBe(0);
  });

  it('content: a busy lane is not unreadable', async () => {
    const r = await rig();
    const { token } = mint(r, { 'a.js': 1000, 'three.bin': 3 * FRAME, 'gone.js': 1000 });
    r.bytes.readScript = async (c, sink) => {
      if (c.key === 'x/a.js') return { ok: false, error: 'busy' };
      if (c.key === 'x/gone.js') return { ok: false, error: 'unreadable' };
      await sink(bytesOf(c.key, 0, FRAME));
      return { ok: false, error: 'busy' };
    };
    const first = await getFile(r, token, 'a.js').promise;
    expect(first.status).toBe(503);
    expect(first.headers['retry-after']).toBe('5');
    expect(first.headers.vary).toBe(SPEC_VARY);
    const later = await getFile(r, token, 'three.bin').promise;
    expect(later.outcome, 'busy on a later frame is a reset short of Content-Length').toBe('reset');
    expect(later.body.length).toBe(FRAME);
    const unreadable = await getFile(r, token, 'gone.js').promise;
    expect(unreadable.status, 'unreadable stays the identical 404').toBe(404);
    expect(unreadable.body.toString()).toBe(BODY_404);
  });
});

describe('content: waiting, budgets and the prepare slot', () => {
  it('content: a page with many parallel loads loads whole', async () => {
    const r = await rig();
    fakeTime();
    const files: Record<string, number> = {};
    for (let i = 0; i < 12; i++) files[`s${i}.js`] = 2000;
    for (let i = 0; i < 6; i++) files[`L${i}.bin`] = 3 * FRAME;
    const { token } = mint(r, files);
    const inflight: number[] = [];
    r.bytes.onRead = () => { inflight.push(r.store.lookup(token)!.inflight); };
    // Each read lingers a few turns of the event loop, so reads that the limit lets overlap do overlap.
    r.bytes.readScript = async (c, sink) => {
      for (let i = 0; i < 20; i++) await tick();
      for (let offset = c.range.start; offset <= c.range.end; offset += FRAME) {
        await sink(bytesOf(c.key, offset, Math.min(FRAME, c.range.end - offset + 1)));
      }
      return { ok: true };
    };
    // Each large file is asked for twice, at the same time: one prepare serves both, and a later read reuses its snapshot.
    const large = Object.keys(files).filter((k) => k.startsWith('L'));
    const names = [...large, ...large, ...Object.keys(files).filter((k) => k.startsWith('s'))];
    const all = names.map((n) => getFile(r, token, n));
    await settle(r);
    await advance(61000);
    await settle(r);
    await advance(1000);
    await settle(r);
    const got = await Promise.all(all.map((p) => p.promise));
    expect(got.map((g) => g.status), 'none answers 429 or 503').toEqual(names.map(() => 200));
    got.forEach((g, i) => {
      expect(g.outcome, names[i]).toBe('complete');
      expect(same(g.body, bytesOf(`x/${names[i]}`, 0, files[names[i]!]!)), `${names[i]}'s bytes`).toBe(true);
    });
    expect(Math.max(...inflight), 'at most 4 run for the capability at any moment').toBe(4);
    for (let i = 0; i < 6; i++) expect(r.bytes.prepares.filter((p) => p.key === `x/L${i}.bin`).length, `L${i} is prepared once`).toBe(1);
    expect(r.bytes.maxPrepareRunning, 'at most one prepare runs at a time').toBe(1);
    const starts = r.bytes.prepares.map((p) => p.at);
    for (const s of starts) expect(starts.filter((t) => t >= s && t < s + 60000).length, 'at most 3 start in any minute').toBeLessThanOrEqual(3);
  });

  it('content: a seventh large file waits out', async () => {
    const r = await rig();
    fakeTime();
    const files: Record<string, number> = {};
    for (let i = 0; i < 7; i++) files[`L${i}.bin`] = 3 * FRAME;
    const { token } = mint(r, files);
    const names = Object.keys(files);
    const all = names.map((n) => getFile(r, token, n));
    await settle(r);
    await advance(60000);
    await settle(r);
    expect(all.filter((p) => p.settled()).length, 'six are served by the second minute').toBe(6);
    await advance(29000);
    await settle(r);
    await advance(1000);
    await settle(r);
    const got = await Promise.all(all.map((p) => p.promise));
    const lost = got.findIndex((g) => g.status === 503);
    expect(lost, 'exactly one file waited out').toBeGreaterThanOrEqual(0);
    expect(got.filter((g) => g.status === 503).length).toBe(1);
    expect(got[lost]!.headers['retry-after']).toBe('5');
    expect(got.filter((g) => g.status === 200).length).toBe(6);
    // The same request after the prepare window reopens is served, the others' snapshots being recorded.
    await advance(31000);
    const again = getFile(r, token, names[lost]!);
    await settle(r);
    const served = await again.promise;
    expect(served.status).toBe(200);
    expect(same(served.body, bytesOf(`x/${names[lost]}`, 0, 3 * FRAME))).toBe(true);
    expect(r.bytes.prepares.filter((p) => p.key === `x/${names[lost]}`).length).toBe(1);
  });

  it('content: a wait past 90 s answers 503', async () => {
    const r = await rig();
    fakeTime();
    const { token } = mint(r, { 'a.js': 100, 'big.bin': 3 * FRAME });
    r.bytes.holdAll();
    const running = [0, 1, 2, 3].map(() => getFile(r, token, 'a.js'));
    await settle(r);
    const queued = getFile(r, token, 'a.js');
    await settle(r);
    expect(r.store.lookup(token)!.queued).toBe(1);
    await advance(ARTIFACT_QUEUE_WAIT_MS - 1);
    await settle(r);
    expect(queued.settled(), 'one millisecond early it still waits').toBe(false);
    await advance(1);
    const out = await queued.promise;
    expect(out.status).toBe(503);
    expect(out.headers['retry-after']).toBe('5');
    expect(out.body.toString()).toBe('Busy. Try again shortly.');
    expect(r.store.lookup(token)!.queued, 'a request that waited out leaves the queue').toBe(0);
    for (const h of r.bytes.held) h.release();
    await Promise.all(running.map((p) => p.promise));

    // A prepare that keeps meeting ccd's `prepare-busy` runs out the same wait.
    r.bytes.readScript = null;
    r.bytes.prepareScript = async () => ({ ok: false, error: 'prepare-busy' });
    const big = getFile(r, token, 'big.bin');
    await settle(r);
    await advance(ARTIFACT_QUEUE_WAIT_MS - 1);
    await settle(r);
    expect(big.settled()).toBe(false);
    await advance(1);
    const busy = await big.promise;
    expect(busy.status).toBe(503);
    expect(busy.headers['retry-after']).toBe('5');
    expect(r.bytes.prepares.length, 'ccd was asked again after each prepare-busy').toBeGreaterThan(1);
    expect(r.store.boxInflight()).toBe(0);
  });

  it('content: the 17th request box-wide waits', async () => {
    const r = await rig();
    r.bytes.holdAll();
    const tokens = [0, 1, 2, 3, 4].map(() => mint(r, { 'a.js': 100 }).token);
    const first16 = [0, 1, 2, 3].flatMap((i) => [0, 1, 2, 3].map(() => getFile(r, tokens[i]!, 'a.js')));
    await settle(r);
    expect(r.store.boxInflight()).toBe(16);
    const seventeenth = getFile(r, tokens[4]!, 'a.js');
    await settle(r);
    expect(r.store.boxInflight(), 'the 17th does not run').toBe(16);
    expect(r.store.lookup(tokens[4]!)!.queued).toBe(1);
    expect(seventeenth.settled()).toBe(false);
    expect(r.bytes.held.length).toBe(16);
    r.bytes.held[0]!.release();
    await first16[0]!.promise;
    expect(await until(() => r.bytes.held.length === 17), 'the 17th takes the slot the first one freed').toBe(true);
    expect(r.store.boxInflight()).toBe(16);
    for (const h of r.bytes.held) h.release();
    await Promise.all([...first16, seventeenth].map((p) => p.promise));
  });

  it('content: the 65th queued request is 429', async () => {
    const r = await rig();
    r.bytes.holdAll();
    const { token } = mint(r, { 'a.js': 100 });
    const running = [0, 1, 2, 3].map(() => getFile(r, token, 'a.js'));
    await settle(r);
    const queued: Pending[] = [];
    for (let i = 0; i < 64; i++) queued.push(getFile(r, token, 'a.js'));
    expect(await until(() => r.store.lookup(token)!.queued === 64)).toBe(true);
    const sixtyFifth = getFile(r, token, 'a.js');
    const got = await sixtyFifth.promise;
    expect(got.status).toBe(429);
    expect(got.body.toString()).toBe('Too many requests.');
    expect(got.headers.vary).toBe(SPEC_VARY);
    expect(r.store.lookup(token)!.queued).toBe(64);
    for (const c of queued) c.destroy();
    for (const h of r.bytes.held) h.release();
    await Promise.all(running.map((p) => p.promise));
  });

  it('content: a client gone while queued leaves the queue', async () => {
    const r = await rig();
    r.bytes.holdAll();
    const { token } = mint(r, { 'a.js': 100 });
    const running = [0, 1, 2, 3].map(() => getFile(r, token, 'a.js'));
    await settle(r);
    const queued: Pending[] = [];
    for (let i = 0; i < 64; i++) queued.push(getFile(r, token, 'a.js'));
    expect(await until(() => r.store.lookup(token)!.queued === 64)).toBe(true);
    queued[63]!.destroy();
    expect(await until(() => r.store.lookup(token)!.queued === 63, 1000), 'its place is freed at once').toBe(true);
    const next = getFile(r, token, 'a.js');
    await until(() => r.store.lookup(token)!.queued === 64, 1000);
    expect(next.settled(), 'the next request is queued, not refused 429').toBe(false);
    expect(r.store.lookup(token)!.queued).toBe(64);
    for (const c of queued) c.destroy();
    next.destroy();
    for (const h of r.bytes.held) h.release();
    await Promise.all(running.map((p) => p.promise));
  });

  it('content: the hour\'s budget resets', async () => {
    const r = await rig();
    fakeTime();
    const { token, id } = mint(r, { 'a.js': 10 });
    // The capability has been served its whole hour's bytes (charged as they are written, see the next case).
    expect(r.store.charge(id, ARTIFACT_HOURLY_BYTES)).toBe('ok');
    const over = await getFile(r, token, 'a.js').promise;
    expect(over.status, 'a spent budget is refused at admission').toBe(429);
    expect(over.body.toString()).toBe('Too many requests.');
    expect(r.bytes.reads.length, 'and nothing is read for it').toBe(0);
    await advance(3600000 - 1);
    expect((await getFile(r, token, 'a.js').promise).status, 'one millisecond early').toBe(429);
    await advance(1);
    // The same capability (the refused request a moment ago kept its idle clock running): the hour has turned, so it is served.
    const after = await getFile(r, token, 'a.js').promise;
    expect(after.status, 'the first request after the hour turns').toBe(200);
    expect(after.body).toEqual(bytesOf('x/a.js', 0, 10));
    expect(r.store.lookup(token)!.servedThisHour, 'and the spent bytes are forgotten').toBe(10);
  });

  it('content: the budget counts what was served', async () => {
    const r = await rig();
    const { token, id } = mint(r, { 'big.bin': DOCS_RANGE_MAX_BYTES, 'three.bin': 3 * FRAME });
    // Ranged reads of a large file that each stop early (the client goes while the socket is full): each is charged only the
    // frames it was written, never the rest of the file it asked for.
    let handed = 0;
    r.bytes.readScript = async (c, sink) => {
      for (let offset = c.range.start; offset <= c.range.end;) {
        const len = Math.min(FRAME, c.range.end - offset + 1);
        handed += len;
        r.bytes.activity++;
        if (await sink(bytesOf(c.key, offset, len)) === 'stop') return { ok: true };
        offset += len;
      }
      return { ok: true };
    };
    for (let i = 0; i < 3; i++) {
      const p = getFile(r, token, 'big.bin', { range: `bytes=${1000 * (i + 1)}-` }, { paused: true });
      await settle(r, 150);
      p.destroy();
      expect(await until(() => r.store.boxInflight() === 0), `read ${i} ended with its client`).toBe(true);
    }
    const served = r.store.lookup(token)!.servedThisHour;
    expect(served, 'what the port handed over is what was charged').toBe(handed);
    expect(served, 'and it is far less than the three asks').toBeGreaterThan(0);
    expect(served).toBeLessThan(DOCS_RANGE_MAX_BYTES / 2);

    // A response that would cross the budget mid-stream is cut: two frames fit in what is left, the third fails shut.
    r.bytes.readScript = null;
    expect(r.store.charge(id, ARTIFACT_HOURLY_BYTES - served - MIB)).toBe('ok');
    const cut = await getFile(r, token, 'three.bin').promise;
    expect(cut.headers['content-length']).toBe(String(3 * FRAME));
    expect(cut.outcome, 'a reset, never a short 200').toBe('reset');
    expect(cut.body.length, 'the two frames that fit').toBe(2 * FRAME);
    expect(r.store.lookup(token)!.servedThisHour).toBe(ARTIFACT_HOURLY_BYTES);
    expect(budgetSpent(r.store.lookup(token)!, Date.now())).toBe(true);
    expect((await getFile(r, token, 'three.bin').promise).status, 'and the next request meets the spent budget').toBe(429);
  });

  it('content: a second capability prepares its own snapshot', async () => {
    const r = await rig();
    const one = mint(r, { 'big.bin': 3 * FRAME });
    const two = mint(r, { 'big.bin': 3 * FRAME });
    expect((await getFile(r, one.token, 'big.bin').promise).status).toBe(200);
    expect((await getFile(r, one.token, 'big.bin').promise).status).toBe(200);
    expect(r.bytes.prepares.length, 'the second request of one capability reuses its snapshot').toBe(1);
    expect((await getFile(r, two.token, 'big.bin').promise).status).toBe(200);
    expect(r.bytes.prepares.length, 'a second capability prepares its own').toBe(2);
    expect(r.bytes.reads.map((c) => c.snapshot)).toEqual(['snap1', 'snap1', 'snap2']);
    expect(r.store.lookup(one.token)!.snapshots.get('x/big.bin')).toBe('snap1');
    expect(r.store.lookup(two.token)!.snapshots.get('x/big.bin')).toBe('snap2');
  });

  it('content: snapshot-gone prepares once more', async () => {
    const r = await rig();
    const { token } = mint(r, { 'big.bin': 3 * FRAME });
    // Before any byte: the first snapshot is gone, the door prepares again, records it and reads again.
    r.bytes.readScript = async (c, sink) => {
      if (c.snapshot === 'snap1') return { ok: false, error: 'snapshot-gone' };
      for (let offset = c.range.start; offset <= c.range.end; offset += FRAME) {
        await sink(bytesOf(c.key, offset, Math.min(FRAME, c.range.end - offset + 1)));
      }
      return { ok: true };
    };
    const got = await getFile(r, token, 'big.bin').promise;
    expect(got.status).toBe(200);
    expect(same(got.body, bytesOf('x/big.bin', 0, 3 * FRAME))).toBe(true);
    expect(r.bytes.prepares.length).toBe(2);
    expect(r.store.lookup(token)!.snapshots.get('x/big.bin')).toBe('snap2');
    expect(r.bytes.reads.map((c) => c.snapshot)).toEqual(['snap1', 'snap2']);

    // After a byte: it prepares once more and reads on from the next unsent byte. (A fresh door: its prepare slot allows three
    // starts a minute, and this one has used two.)
    const r2 = await rig();
    const other = mint(r2, { 'big.bin': 3 * FRAME });
    let first = true;
    r2.bytes.readScript = async (c, sink) => {
      if (first) {
        first = false;
        await sink(bytesOf(c.key, 0, FRAME));
        return { ok: false, error: 'snapshot-gone' };
      }
      for (let offset = c.range.start; offset <= c.range.end; offset += FRAME) {
        await sink(bytesOf(c.key, offset, Math.min(FRAME, c.range.end - offset + 1)));
      }
      return { ok: true };
    };
    const mid = await getFile(r2, other.token, 'big.bin').promise;
    expect(mid.status).toBe(200);
    expect(mid.outcome).toBe('complete');
    expect(same(mid.body, bytesOf('x/big.bin', 0, 3 * FRAME))).toBe(true);
    expect(r2.bytes.reads[r2.bytes.reads.length - 1]!.range.start, 'read on from the next unsent byte').toBe(FRAME);
    expect(r2.bytes.prepares.length).toBe(2);

    // A second snapshot-gone in one response destroys the socket.
    const r3 = await rig();
    const third = mint(r3, { 'big.bin': 3 * FRAME });
    r3.bytes.readScript = async (c, sink) => {
      await sink(bytesOf(c.key, c.range.start, FRAME));
      return { ok: false, error: 'snapshot-gone' };
    };
    const twice = await getFile(r3, third.token, 'big.bin').promise;
    expect(twice.outcome).toBe('reset');
    expect(twice.body.length, 'one frame before the first gone snapshot, one after the second prepare').toBe(2 * FRAME);
    expect(r3.bytes.prepares.length, 'one prepare more, and no third').toBe(2);
  });
});

describe('content: the end of a capability reaches work in flight', () => {
  it('content: a revoke ends work in flight', async () => {
    const r = await rig();
    r.bytes.holdAll();
    const caps = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ n, ...mint(r, { [`${n}.js`]: 1000 }) }));
    const [A, B, C, D, E] = caps as [typeof caps[0], typeof caps[0], typeof caps[0], typeof caps[0], typeof caps[0]];
    const runningA = [0, 1, 2, 3].map(() => getFile(r, A.token, 'a.js'));
    const others = [B, C, D].flatMap((c) => [0, 1, 2, 3].map(() => getFile(r, c.token, `${c.n}.js`)));
    await settle(r);
    expect(r.store.boxInflight()).toBe(16);
    const queuedA = [0, 1, 2].map(() => getFile(r, A.token, 'a.js'));
    const pendingE = getFile(r, E.token, 'e.js');
    await settle(r);
    expect(r.store.lookup(A.token)!.queued).toBe(3);
    expect(r.store.lookup(E.token)!.queued, 'the box is full, so another capability waits').toBe(1);
    const readsBefore = r.bytes.reads.length;

    expect(r.store.revoke(A.id)).toBe(true);

    for (const q of queuedA) {
      const got = await q.promise;
      expect(got.status, 'a queued request answers the identical 404 at once').toBe(404);
      expect(got.body.toString()).toBe(BODY_404);
    }
    for (const p of runningA) {
      const got = await p.promise;
      expect(got.outcome, 'a running one is cut short of Content-Length').toBe('reset');
      expect(got.body.length).toBe(500);
      expect(got.headers['content-length']).toBe('1000');
    }
    expect(await until(() => r.bytes.held.some((h) => h.call.key === 'x/e.js')), 'a request for another capability takes a freed slot').toBe(true);
    expect(r.bytes.reads.length - readsBefore, 'only that one read began').toBe(1);
    // The port's pending reads were never resolved into a write: when they are, their sink answers stop.
    for (const h of r.bytes.held) h.release();
    await Promise.all(runningA.map((p) => p.promise));
    for (const h of r.bytes.held.filter((x) => x.call.key === 'x/a.js')) {
      await h.done;
      expect(h.sinkAnswers, 'the first half was accepted, and the late one is told to stop').toEqual(['next', 'stop']);
    }
    await Promise.all([...others, pendingE].map((p) => p.promise));
    void E;
  });

  // X5 A3 fix round 1 (item 3): the case above revokes a capability that also has running requests, whose ends pump the queue and
  // answer the waiting tickets anyway, so it cannot tell whether a waiter hears the end itself. Here the revoked capability has
  // nothing running, and no slot of the box frees before its answers are due.
  it('content: a revoke reaches a link whose requests only wait', async () => {
    const r = await rig();
    r.bytes.holdAll();
    const mk = (n: string) => ({ n, ...mint(r, { [`${n}.js`]: 1000 }) });
    const others = ['a', 'b', 'c', 'd'].map(mk);
    const B = mk('e');
    const running = others.flatMap((c) => [0, 1, 2, 3].map(() => getFile(r, c.token, `${c.n}.js`)));
    await settle(r);
    expect(r.store.boxInflight(), 'the box is full').toBe(16);
    expect(r.bytes.held.length, 'sixteen reads are held open').toBe(16);
    const waiting = [0, 1, 2].map(() => getFile(r, B.token, 'e.js'));
    expect(await until(() => r.store.lookup(B.token)!.queued === 3), 'B\'s requests only wait').toBe(true);
    expect(r.store.lookup(B.token)!.inflight).toBe(0);

    expect(r.store.revoke(B.id)).toBe(true);

    expect(await until(() => waiting.every((p) => p.settled()), 1500), 'each answers before any slot frees').toBe(true);
    for (const p of waiting) {
      const got = await p.promise;
      expect(got.status, 'the identical 404').toBe(404);
      expect(got.body.toString()).toBe(BODY_404);
    }
    expect(r.store.boxInflight(), 'every one of the sixteen slots is still held').toBe(16);
    expect(r.bytes.held.length, 'and no read began for B').toBe(16);
    expect(running.every((p) => !p.settled()), 'no held read was released or cut').toBe(true);
    // The others finish, and nothing leaks.
    for (const h of r.bytes.held) h.release();
    const done = await Promise.all(running.map((p) => p.promise));
    expect(done.every((g) => g.status === 200 && g.outcome === 'complete')).toBe(true);
    expect(await until(() => r.store.boxInflight() === 0)).toBe(true);
  });

  // X5 A3 fix round 1 (item 2): the sink reads the word `charge` answers. The door's own end subscription normally answers an end
  // first (the store announces it during the charge), so the store here loses its announcements: only the word is left to say that
  // the capability ended, and an ended capability is the identical 404, never the 429 of a spent hour.
  it('content: a charge that finds the capability ended is the identical 404, not a spent budget', async () => {
    const r = await rig();
    r.store.onEnd = () => () => {};
    const { token } = mint(r, { 'three.bin': 3 * FRAME });
    r.bytes.onFrame = (n) => { if (n === 1) r.ended.add(SESSION); };
    const got = await getFile(r, token, 'three.bin').promise;
    expect(got.status).toBe(404);
    expect(got.body.toString()).toBe(BODY_404);
    expect(r.bytes.frameReads, 'nothing was written, and no second frame was read').toBe(1);
    expect(await until(() => r.store.boxInflight() === 0), 'its slot is released').toBe(true);
  });

  it('content: a slot is freed once', async () => {
    const r = await rig();
    fakeTime();
    r.bytes.holdAll();
    const A = mint(r, { 'a.js': 1000 });
    const mk = (n: string) => mint(r, { [`${n}.js`]: 1000 });
    const [B, C, D, E, F] = ['b', 'c', 'd', 'e', 'f'].map(mk) as [ReturnType<typeof mk>, ReturnType<typeof mk>, ReturnType<typeof mk>, ReturnType<typeof mk>, ReturnType<typeof mk>];
    const pa = getFile(r, A.token, 'a.js');
    const rest = [
      ...[0, 1, 2, 3].map(() => getFile(r, B.token, 'b.js')), ...[0, 1, 2, 3].map(() => getFile(r, C.token, 'c.js')),
      ...[0, 1, 2, 3].map(() => getFile(r, D.token, 'd.js')), ...[0, 1, 2].map(() => getFile(r, E.token, 'e.js')),
    ];
    await settle(r);
    expect(r.store.boxInflight()).toBe(16);
    let releases = 0;
    const release = r.store.release;
    r.store.release = (t) => { releases++; release(t); };
    r.store.revoke(A.id);
    const cut = await pa.promise;
    expect(cut.outcome).toBe('reset');
    expect(r.store.boxInflight()).toBe(15);
    // The port's pending read for it then comes back (its sink answers stop): that is another exit of the same request.
    const heldA = r.bytes.held.find((h) => h.call.key === 'x/a.js')!;
    heldA.release();
    await heldA.done;
    // Its socket's close, then the time its stall and response timers would have fired: nothing frees a second slot.
    await advance(ARTIFACT_FRAME_STALL_MS + 1);
    await settle(r);
    expect(r.store.boxInflight(), 'the box-wide count dropped by exactly one').toBe(15);
    expect(releases, 'the door released that ticket once, whatever else ended it').toBe(1);
    const admitted = getFile(r, E.token, 'e.js');
    const waiting = getFile(r, F.token, 'f.js');
    await settle(r);
    expect(r.store.boxInflight(), 'exactly one new request is admitted').toBe(16);
    expect(r.store.lookup(F.token)!.queued, 'and the one after it waits').toBe(1);
    expect(waiting.settled()).toBe(false);
    admitted.destroy();
    waiting.destroy();
    for (const p of rest) p.destroy();
    for (const h of r.bytes.held) h.release();
  });

  it('content: an end is seen at admission', async () => {
    const r = await rig();
    r.bytes.holdAll();
    const { token } = mint(r, { 'a.js': 1000, 'late.js': 1000 });
    const running = [0, 1, 2, 3].map(() => getFile(r, token, 'a.js'));
    await settle(r);
    const queued = getFile(r, token, 'late.js');
    await settle(r);
    expect(r.store.lookup(token)!.queued).toBe(1);
    r.ended.add(SESSION);
    // A slot frees: the queued request is admitted at last, and its capability has ended with its session.
    r.bytes.held[0]!.release();
    const got = await queued.promise;
    expect(got.status).toBe(404);
    expect(got.body.toString()).toBe(BODY_404);
    expect(r.bytes.reads.some((c) => c.key === 'x/late.js'), 'it read nothing').toBe(false);
    for (const h of r.bytes.held) h.release();
    await Promise.all(running.map((p) => p.promise));

    // The same end, a moment later: the store hands the waiting request its slot, and the session ends in the instant between that
    // and the request's own look-up. Only that second look-up, made after the wait and before anything is read, can see it.
    const r2 = await rig();
    r2.bytes.holdAll();
    const cap = mint(r2, { 'a.js': 1000, 'late.js': 1000 });
    const four = [0, 1, 2, 3].map(() => getFile(r2, cap.token, 'a.js'));
    await settle(r2);
    const late = getFile(r2, cap.token, 'late.js');
    await settle(r2);
    expect(r2.store.lookup(cap.token)!.queued).toBe(1);
    const promote = r2.store.promote;
    r2.store.promote = (t) => {
      const answer = promote(t);
      if (answer.kind === 'run') r2.ended.add(SESSION);
      return answer;
    };
    r2.bytes.held[0]!.release();
    const gone = await late.promise;
    expect(gone.status, 'the identical 404, not a budget refusal').toBe(404);
    expect(gone.body.toString()).toBe(BODY_404);
    expect(r2.bytes.reads.some((c) => c.key === 'x/late.js')).toBe(false);
    for (const h of r2.bytes.held) h.release();
    await Promise.all(four.map((p) => p.promise));
  });

  it('content: an end is seen before the next frame', async () => {
    const r = await rig();
    const { token } = mint(r, { 'three.bin': 3 * FRAME });
    // The passphrase changes while the first frame is being handled (right after its charge): nothing announces it, so only the
    // look-up between frames sees it.
    const charge = r.store.charge;
    let charges = 0;
    r.store.charge = (id, n) => { const answer = charge(id, n); if (++charges === 1) r.ended.add(SESSION); return answer; };
    const got = await getFile(r, token, 'three.bin').promise;
    expect(got.outcome).toBe('reset');
    expect(same(got.body, bytesOf('x/three.bin', 0, FRAME))).toBe(true);
    expect(r.bytes.frameReads, 'no second frame is read').toBe(1);
    expect(await until(() => r.store.boxInflight() === 0)).toBe(true);

    // An end that is already there when the first frame arrives is the identical 404, not a spent budget, and nothing is written.
    const r2 = await rig();
    const again = mint(r2, { 'three.bin': 3 * FRAME });
    r2.bytes.onFrame = (n) => { if (n === 1) r2.ended.add(SESSION); };
    const early = await getFile(r2, again.token, 'three.bin').promise;
    expect(early.status).toBe(404);
    expect(early.body.toString()).toBe(BODY_404);
  });

  it('content: a stalled reader is cut', async () => {
    const r = await rig();
    fakeTime();
    const { token } = mint(r, { 'big.bin': DOCS_RANGE_MAX_BYTES, 'a.js': 10 });
    const stalled = getFile(r, token, 'big.bin', {}, { paused: true });
    await settle(r, 150);
    expect(r.store.boxInflight()).toBe(1);
    expect(r.sockets[0]!.destroyed).toBe(false);
    const asked = r.bytes.frameReads;
    await advance(ARTIFACT_FRAME_STALL_MS - 1);
    await settle(r);
    expect(r.sockets[0]!.destroyed, 'one millisecond earlier it is still open').toBe(false);
    expect(r.store.boxInflight()).toBe(1);
    await advance(1);
    expect(await until(() => r.sockets[0]!.destroyed), 'the socket is destroyed at the stall deadline').toBe(true);
    expect(await until(() => r.store.boxInflight() === 0), 'and the slot is free').toBe(true);
    expect(r.bytes.frameReads, 'no frame was read after the stall').toBe(asked);
    stalled.destroy();
    expect((await getFile(r, token, 'a.js').promise).status, 'a request after it runs').toBe(200);
  });

  it('content: the whole-response deadline', async () => {
    const r = await rig();
    fakeTime();
    const { token } = mint(r, { 'big.bin': DOCS_RANGE_MAX_BYTES });
    // The port hands out exactly ONE frame per step, and the client reads steadily, so the socket's buffers play no part: no write
    // ever blocks (no stall timer is set), the file cannot finish early, and only the whole-response deadline can end the response.
    const waiting: (() => void)[] = [];
    let sunk = 0;
    r.bytes.readScript = async (c, sink) => {
      for (let offset = c.range.start; offset <= c.range.end; offset += FRAME) {
        await new Promise<void>((go) => { waiting.push(go); });
        const answer = await sink(bytesOf(c.key, offset, Math.min(FRAME, c.range.end - offset + 1)));
        sunk++;
        if (answer === 'stop') return { ok: true };
      }
      return { ok: true };
    };
    const slow = getFile(r, token, 'big.bin');
    const oneFrame = async (what: string): Promise<void> => {
      expect(await until(() => waiting.length === 1), `${what}: the port waits for its turn`).toBe(true);
      const before = sunk;
      waiting.shift()!();
      expect(await until(() => sunk === before + 1), `${what}: one frame went out`).toBe(true);
    };
    await oneFrame('the first');
    const step = 25000;
    let elapsed = 0;
    while (elapsed + step < ARTIFACT_RESPONSE_MAX_MS) {
      await advance(step);
      elapsed += step;
      await oneFrame(`at ${elapsed} ms`);
      expect(r.sockets[0]!.destroyed, `still open at ${elapsed} ms`).toBe(false);
    }
    expect(sunk, 'the file is far from finished').toBeLessThan(DOCS_RANGE_MAX_BYTES / FRAME / 2);
    expect(r.store.boxInflight()).toBe(1);
    await advance(ARTIFACT_RESPONSE_MAX_MS - elapsed - 1);
    expect(r.sockets[0]!.destroyed, 'one millisecond before the deadline').toBe(false);
    await advance(1);
    expect(await until(() => r.sockets[0]!.destroyed), 'the socket is destroyed at the deadline').toBe(true);
    expect(await until(() => r.store.boxInflight() === 0), 'and the slot is free').toBe(true);
    waiting.shift()?.();
    slow.destroy();
  });
});

describe('content: a capability that ends while its request waits or prepares', () => {
  it('content: a wait that runs out on an ended capability is the identical 404', async () => {
    const r = await rig();
    fakeTime();
    r.bytes.holdAll();
    const { token } = mint(r, { 'a.js': 100 });
    const running = [0, 1, 2, 3].map(() => getFile(r, token, 'a.js'));
    await settle(r);
    const queued = getFile(r, token, 'a.js');
    await settle(r);
    expect(r.store.lookup(token)!.queued).toBe(1);
    // The session ends while it waits: nothing announces a passphrase change, and nothing frees a slot to promote it.
    r.ended.add(SESSION);
    await advance(ARTIFACT_QUEUE_WAIT_MS);
    const got = await queued.promise;
    expect(got.status, 'the identical 404, not the busy 503').toBe(404);
    expect(got.body.toString()).toBe(BODY_404);
    for (const h of r.bytes.held) h.release();
    for (const p of running) p.destroy();
  });

  it('content: a prepare that keeps meeting prepare-busy stops when its capability ends', async () => {
    const r = await rig();
    fakeTime();
    const { token } = mint(r, { 'big.bin': 3 * FRAME });
    r.bytes.prepareScript = async () => ({ ok: false, error: 'prepare-busy' });
    const p = getFile(r, token, 'big.bin');
    await settle(r);
    await advance(2000);
    await settle(r);
    expect(r.bytes.prepares.length, 'ccd was asked again').toBe(2);
    r.ended.add(SESSION);
    const asked = r.bytes.prepares.length;
    await advance(2000);
    const got = await p.promise;
    expect(got.status, 'the joiner answers as for an end, well inside its 90 s').toBe(404);
    expect(got.body.toString()).toBe(BODY_404);
    await advance(ARTIFACT_QUEUE_WAIT_MS);
    expect(r.bytes.prepares.length, 'no further ask for a capability that has ended').toBe(asked);
    expect(r.store.boxInflight()).toBe(0);
  });

  it('content: a prepare that waited for the window does not start for a capability that ended', async () => {
    const r = await rig();
    fakeTime();
    const other = 'e1f0'.repeat(16);
    const spent = mint(r, { 'L0.bin': 3 * FRAME, 'L1.bin': 3 * FRAME, 'L2.bin': 3 * FRAME });
    const waiter = mint(r, { 'big.bin': 3 * FRAME }, { session: other });
    const first = ['L0.bin', 'L1.bin', 'L2.bin'].map((n) => getFile(r, spent.token, n));
    await settle(r);
    expect(r.bytes.prepares.length, 'the minute\'s three starts are spent').toBe(3);
    const p = getFile(r, waiter.token, 'big.bin');
    await settle(r);
    r.ended.add(other);
    await advance(60000);
    const got = await p.promise;
    expect(got.status).toBe(404);
    expect(r.bytes.prepares.length, 'the window reopened, and no start was spent on a capability that ended').toBe(3);
    await Promise.all(first.map((q) => q.promise));
  });

  it('content: no read starts for a capability that ended once its prepare answered', async () => {
    const r = await rig();
    const { token } = mint(r, { 'big.bin': 3 * FRAME });
    // The session ends in the instant between the prepare's answer being recorded and the read it was for.
    const record = r.store.recordSnapshot;
    r.store.recordSnapshot = (...args) => { record(...args); r.ended.add(SESSION); };
    const got = await getFile(r, token, 'big.bin').promise;
    expect(got.status).toBe(404);
    expect(got.body.toString()).toBe(BODY_404);
    expect(r.bytes.prepares.length).toBe(1);
    expect(r.bytes.reads.length, 'no read was started').toBe(0);
    expect(r.store.boxInflight()).toBe(0);
  });

  it('content: a request does not join a prepare that is stopping', async () => {
    const r = await rig();
    const { token } = mint(r, { 'big.bin': 3 * FRAME });
    const hold = deferred();
    // The first prepare is held in the port; when it answers after its flight was stopped, the port reports that as busy.
    r.bytes.prepareScript = async (_key, n, signal) => {
      if (n > 1) return { ok: true, snapshot: `snap${n}` };
      await hold.promise;
      return signal.aborted ? { ok: false, error: 'busy' } : { ok: true, snapshot: 'snap1' };
    };
    const a = getFile(r, token, 'big.bin');
    expect(await until(() => r.bytes.prepares.length === 1), 'the first prepare is in the port').toBe(true);
    a.destroy();
    expect(await until(() => r.store.boxInflight() === 0), 'its only joiner left, so the flight is stopping').toBe(true);
    const b = getFile(r, token, 'big.bin');
    await settle(r);
    hold.resolve();
    const got = await b.promise;
    expect(got.status, 'the second request started a prepare of its own').toBe(200);
    expect(same(got.body, bytesOf('x/big.bin', 0, 3 * FRAME))).toBe(true);
    expect(r.bytes.prepares.length).toBe(2);
  });

  it('content: a snapshot-gone after more than 90 s prepares with a wait of its own', async () => {
    const r = await rig();
    fakeTime();
    const { token } = mint(r, { 'three.bin': 3 * FRAME });
    const gate = deferred();
    let calls = 0;
    r.bytes.readScript = async (c, sink) => {
      calls++;
      r.bytes.activity++;
      if (calls === 1) {
        await sink(bytesOf(c.key, c.range.start, FRAME));
        await gate.promise;
        return { ok: false, error: 'snapshot-gone' };
      }
      for (let offset = c.range.start; offset <= c.range.end; offset += FRAME) {
        await sink(bytesOf(c.key, offset, Math.min(FRAME, c.range.end - offset + 1)));
      }
      return { ok: true };
    };
    const p = getFile(r, token, 'three.bin');
    expect(await until(() => p.received() >= FRAME), 'the first frame went out').toBe(true);
    await advance(ARTIFACT_QUEUE_WAIT_MS + 10000);
    gate.resolve();
    const got = await p.promise;
    expect(got.status).toBe(200);
    expect(got.outcome, 'the response was not cut').toBe('complete');
    expect(same(got.body, bytesOf('x/three.bin', 0, 3 * FRAME))).toBe(true);
    expect(r.bytes.prepares.length).toBe(2);
    expect(r.bytes.prepares[1]!.at - T0, 'the second prepare came after 100 s').toBeGreaterThanOrEqual(ARTIFACT_QUEUE_WAIT_MS + 10000);
  });
});

describe('content: the socket, whatever the head does', () => {
  it('content: a head that cannot be written cuts the socket', async () => {
    const r = await rig();
    // A MIME type holding a line break: Node refuses to write the head, which the door has already taken over.
    const { token } = mint(r, { 'bad.txt': { size: 10, mime: 'text/plain\nx-injected: 1' }, 'ok.txt': 10 });
    const hung = (p: Pending): Promise<'answered' | 'hung'> => Promise.race([
      p.promise.then((): 'answered' => 'answered'),
      new Promise<'hung'>((resolve) => { setTimeout(() => resolve('hung'), 1500); }),
    ]);
    const get = getFile(r, token, 'bad.txt');
    expect(await hung(get), 'a GET does not hang').toBe('answered');
    expect(get.result()!.outcome).toBe('reset');
    const head = fetchPath(r, `/c/${token}/bad.txt`, {}, { method: 'HEAD' });
    expect(await hung(head), 'a HEAD does not hang').toBe('answered');
    expect(head.result()!.outcome).toBe('reset');
    expect(await until(() => r.store.boxInflight() === 0), 'the slot is free').toBe(true);
    expect((await getFile(r, token, 'ok.txt').promise).status, 'and the door still serves').toBe(200);
  });
});

describe('content: the door\'s small decisions (L1)', () => {
  it('budgetSpent: spent only inside the window, once the served bytes reach the budget', () => {
    const base = { servedThisHour: ARTIFACT_HOURLY_BYTES, hourStart: 1000 };
    expect(budgetSpent(base, 1000)).toBe(true);
    expect(budgetSpent(base, 1000 + 3600000 - 1)).toBe(true);
    expect(budgetSpent(base, 1000 + 3600000), 'the window restarts').toBe(false);
    expect(budgetSpent({ ...base, servedThisHour: ARTIFACT_HOURLY_BYTES - 1 }, 1000)).toBe(false);
    expect(budgetSpent({ ...base, servedThisHour: 0 }, 1000)).toBe(false);
  });

  it('contentStatus, readEndVerdict, prepareTimeoutAction and statusAnswerKind', () => {
    expect(contentStatus(null)).toBe(200);
    expect(contentStatus({ start: 0, end: 9 })).toBe(206);
    expect(readEndVerdict(10, 10)).toBe('complete');
    expect(readEndVerdict(9, 10), 'short').toBe('destroy');
    expect(readEndVerdict(0, 10)).toBe('destroy');
    expect(prepareTimeoutAction(false)).toBe('wait-out');
    expect(prepareTimeoutAction(true)).toBe('destroy');
    expect([404, 409, 503].map((s) => statusAnswerKind(s as 404 | 409 | 503))).toEqual(['not-found', 'draft-changed', 'wait-out']);
  });

  it('withPrepareStart keeps the starts of the last minute and adds this one', () => {
    expect(withPrepareStart([], 100)).toEqual([100]);
    expect(withPrepareStart([10, 50000, 60010], 70000)).toEqual([50000, 60010, 70000]);
    expect(withPrepareStart([10], 60010)).toEqual([60010]);
  });

  it('prepareWaitUntil: the first prepare waits from arrival; a re-prepare gets a fresh wait, never past the response deadline', () => {
    expect(prepareWaitUntil('first', 1000, 1000, 500000)).toBe(1000 + ARTIFACT_QUEUE_WAIT_MS);
    expect(prepareWaitUntil('again', 1000, 1000, 200000)).toBe(200000 + ARTIFACT_QUEUE_WAIT_MS);
    expect(prepareWaitUntil('again', 1000, 1000, ARTIFACT_RESPONSE_MAX_MS), 'capped at the response deadline').toBe(1000 + ARTIFACT_RESPONSE_MAX_MS);
  });
});

describe('content: what a response carries', () => {
  it('content: every response carries the policy', async () => {
    const r = await rig();
    const origins = ['https://cdn.example.test'];
    const { token } = mint(r, { 'a.js': 100, 'm.mjs': 100, 'w.wasm': 100, 'page.html': 100, 'style.css': 100 }, { origins, windows: true });
    const csp = contentCsp(CONTENT_ORIGIN, ART_ORIGIN, token, origins, true);
    const check = (g: Got, what: string): void => {
      expect(g.headers['content-security-policy'], what).toBe(csp);
      for (const [k, v] of Object.entries(SPEC_CONTENT_HEADERS)) expect(g.headers[k], `${what} ${k}`).toBe(v);
      expect(g.headers.vary, `${what} vary`).toBe('Sec-Fetch-Dest, Service-Worker');
      expect(g.headers['set-cookie'], what).toBeUndefined();
      expect(Object.keys(g.headers).filter((k) => k.startsWith('access-control-')), what).toEqual([]);
    };
    const js = await getFile(r, token, 'a.js').promise;
    check(js, 'a.js 200');
    expect(js.status).toBe(200);
    expect(js.headers['content-type'], 'a charset on served text').toBe('text/javascript; charset=utf-8');
    expect(js.headers['cache-control'], 'a script is never stored').toBe('no-store');
    const mjs = await getFile(r, token, 'm.mjs').promise;
    check(mjs, 'm.mjs 200');
    expect(mjs.headers['cache-control']).toBe('no-store');
    const css = await getFile(r, token, 'style.css').promise;
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(css.headers['cache-control']).toMatch(/^private, max-age=(3599|3600), immutable$/);
    const html = await getFile(r, token, 'page.html', NAVIGATION).promise;
    check(html, 'page.html 200');
    expect(html.headers['cache-control'], 'HTML is never cached').toBe('no-store');
    expect(html.headers['content-type']).toBe('text/html; charset=utf-8');
    const wasm = await getFile(r, token, 'w.wasm').promise;
    check(wasm, 'w.wasm 200');
    expect(wasm.headers['content-type'], 'no charset on wasm').toBe('application/wasm');
    expect(wasm.headers['content-disposition']).toBeUndefined();
    const part = await getFile(r, token, 'w.wasm', { range: 'bytes=0-9' }).promise;
    check(part, 'w.wasm 206');
    expect(part.status).toBe(206);
    expect(part.headers['content-type']).toBe('application/wasm');
    const none = await getFile(r, token, 'w.wasm', { range: 'bytes=500-' }).promise;
    expect(none.status).toBe(416);
    expect(none.headers.vary).toBe('Sec-Fetch-Dest, Service-Worker');
  });

  it('content: .exe is an attachment', async () => {
    const r = await rig();
    const { token } = mint(r, { 'a.exe': 10, 'noext': 10, 'a.js': 10 });
    const exe = await getFile(r, token, 'a.exe').promise;
    expect(exe.status).toBe(200);
    expect(exe.headers['content-disposition']).toBe('attachment');
    expect(exe.headers['content-type']).toBe('application/octet-stream');
    const bare = await getFile(r, token, 'noext').promise;
    expect(bare.headers['content-disposition'], 'an unknown extension is never inline').toBe('attachment');
    const js = await getFile(r, token, 'a.js').promise;
    expect(js.headers['content-disposition']).toBeUndefined();
  });

  it('clear: its headers', async () => {
    const r = await rig();
    const res = await r.app.inject({ method: 'GET', url: '/clear', headers: { host: CONTENT, 'sec-fetch-dest': 'iframe' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['clear-site-data']).toBe('"cache", "storage"');
    expect(res.headers['clear-site-data']).not.toContain('cookies');
    expect(res.headers['content-security-policy']).toBe(`default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${ART_ORIGIN}`);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body.toLowerCase()).not.toMatch(/<script|<link|<img|src=|href=/);
    const head = await r.app.inject({ method: 'HEAD', url: '/clear', headers: { host: CONTENT, 'sec-fetch-dest': 'iframe' } });
    expect(head.statusCode).toBe(200);
  });

  it('clear: the Dest fence', async () => {
    const r = await rig();
    for (const dest of ['document', 'empty', 'script', 'IFRAME ', null]) {
      const headers: Record<string, string> = { host: CONTENT };
      if (dest !== null) headers['sec-fetch-dest'] = dest;
      const res = await r.app.inject({ method: 'GET', url: '/clear', headers });
      expect(res.statusCode, String(dest)).toBe(403);
      expect(res.headers['clear-site-data'], String(dest)).toBeUndefined();
      expect(res.body, String(dest)).toBe('Forbidden.');
    }
    const ok = await r.app.inject({ method: 'GET', url: '/clear', headers: { host: CONTENT, 'sec-fetch-dest': 'iframe' } });
    expect(ok.statusCode).toBe(200);
  });
});

describe('content: hosts, logging and the socket', () => {
  it('content: routes answer only on their host', async () => {
    const r = await rig();
    const { token } = mint(r, { 'page.html': 10, 'a.js': 10 });
    const unknown = await r.app.inject({ method: 'GET', url: `/c/${'u'.repeat(43)}/a.js`, headers: { host: CONTENT, ...SUBRESOURCE } });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.body).toBe(BODY_404);
    // The content door on the artifact host is that same 404 for a live capability and a perfect request.
    const wrongHost = await r.app.inject({ method: 'GET', url: `/c/${token}/a.js`, headers: { host: ART, ...SUBRESOURCE } });
    expect(wrongHost.statusCode).toBe(404);
    expect(wrongHost.body).toBe(BODY_404);
    expect(wrongHost.headers).toEqual({ ...unknown.headers, date: wrongHost.headers.date, 'content-length': wrongHost.headers['content-length'] });
    expect(r.bytes.reads.length).toBe(0);
    const clear = await r.app.inject({ method: 'GET', url: '/clear', headers: { host: ART, 'sec-fetch-dest': 'iframe' } });
    expect(clear.statusCode).toBe(404);
    expect(clear.body).toBe(BODY_404);
    expect(clear.headers['clear-site-data']).toBeUndefined();
    const wrapperOnContent = await r.app.inject({ method: 'GET', url: `/a/${token}`, headers: { host: CONTENT, 'sec-fetch-dest': 'document' } });
    expect(wrapperOnContent.statusCode).toBe(404);
    expect(wrapperOnContent.body, 'the not-found page, not the ended sentence').toBe(BODY_404);
    const wrapper = await r.app.inject({ method: 'GET', url: `/a/${token}`, headers: { host: ART, 'sec-fetch-dest': 'document' } });
    expect(wrapper.statusCode).toBe(200);
    for (const host of [ART, CONTENT]) {
      const root = await r.app.inject({ method: 'GET', url: '/', headers: { host } });
      expect(root.statusCode, host).toBe(404);
      expect(root.body, host).toBe(BODY_404);
    }
    // A host that is neither stays the fence's 421.
    const other = await r.app.inject({ method: 'GET', url: `/c/${token}/a.js`, headers: { host: 'other.example.test', ...SUBRESOURCE } });
    expect(other.statusCode).toBe(421);
  });

  it('content: logs no path', async () => {
    const r = await rig();
    const { token } = mint(r, { 'a.js': 10, 'boom.js': 10, 'big.bin': 3 * FRAME });
    r.bytes.readScript = async (c, sink) => {
      if (c.key === 'x/boom.js') throw new Error(`SECRET-THROWN /c/${token}/boom.js`);
      await sink(bytesOf(c.key, c.range.start, c.range.end - c.range.start + 1));
      return { ok: true };
    };
    const ok = await getFile(r, token, 'a.js').promise;
    expect(ok.status).toBe(200);
    // A port that throws before any byte reaches the instance's own error handler: its fixed 500 body, nothing of the throw.
    const boom = await getFile(r, token, 'boom.js').promise;
    expect(boom.status).toBe(500);
    expect(boom.body.toString()).toBe('Something went wrong.');
    expect(boom.body.toString()).not.toContain('SECRET');
    expect(boom.body.toString()).not.toContain(token);
    expect(boom.headers['cache-control']).toBe('no-store');
    expect(await until(() => r.store.boxInflight() === 0), 'the throw frees its slot').toBe(true);
    // A prepare that throws too.
    r.bytes.prepareScript = async () => { throw new Error('SECRET-PREPARE'); };
    const pre = await getFile(r, token, 'big.bin').promise;
    expect(pre.status).toBe(500);
    // A throw after a byte cuts the socket.
    r.bytes.readScript = async (c, sink) => {
      await sink(bytesOf(c.key, 0, 5));
      throw new Error('SECRET-LATE');
    };
    const late = await getFile(r, token, 'a.js').promise;
    expect(late.outcome).toBe('reset');
    for (const s of spies) expect(s.mock.calls.flat().map(String).join(' ')).not.toContain(token);
  });

  it('content: no response writes into a body under way', async () => {
    const r = await rig();
    const { token } = mint(r, { 'big.bin': 3 * FRAME });
    r.bytes.holdAll();
    const received: string[] = [];
    const client = net.connect(r.port, '127.0.0.1');
    allSockets.push(client);
    client.on('data', (d) => received.push(d.toString('latin1')));
    const closed = new Promise<void>((resolve) => { client.on('close', () => resolve()); client.on('error', () => {}); });
    client.write(`GET /c/${token}/big.bin HTTP/1.1\r\nHost: ${CONTENT}\r\nSec-Fetch-Dest: script\r\nSec-Fetch-Mode: no-cors\r\nSec-Fetch-Site: same-origin\r\n\r\n`);
    // The response is under way: its head and its first half are out, the port holds the rest.
    expect(await until(() => r.bytes.held.length === 1 && received.join('').length > 1000)).toBe(true);
    // Bytes on the same keep-alive socket that Node cannot parse: a chunk extension past its limit.
    client.write(`POST /x HTTP/1.1\r\nHost: ${CONTENT}\r\nTransfer-Encoding: chunked\r\n\r\n5;${'x'.repeat(100000)}`);
    await closed;
    const all = received.join('');
    expect(all.match(/HTTP\/1\.1 \d{3}/g), 'one status line only, never a second answer inside the body').toEqual(['HTTP/1.1 200']);
    expect(all).not.toContain('Bad request');
    for (const h of r.bytes.held) h.release();
  });

  // X5 A3 fix round 1 (item 2): `charge` throws a RangeError for a count that is not a whole number. The one caller passes a frame's
  // length, so that is a defect, and it must end its own response only: the door's throw path, as for any throw of the sink.
  it('content: a bad count thrown from the charge ends only its own response', async () => {
    /** A three-frame read that records each frame it asks the sink for and the signal the port was given. */
    const scripted = (r: Rig): { asked: number; signals: AbortSignal[] } => {
      const seen = { asked: 0, signals: [] as AbortSignal[] };
      r.bytes.readScript = async (c, sink, signal) => {
        seen.signals.push(signal);
        for (let offset = c.range.start; offset <= c.range.end; offset += FRAME) {
          seen.asked++;
          r.bytes.activity++;
          if (await sink(bytesOf(c.key, offset, Math.min(FRAME, c.range.end - offset + 1))) === 'stop') return { ok: true };
        }
        return { ok: true };
      };
      return seen;
    };
    /** The store's own refusal of a bad count, thrown on the `n`th charge; the other charges are the real store's. */
    const throwOn = (r: Rig, n: number): void => {
      const charge = r.store.charge;
      let calls = 0;
      r.store.charge = (id, bytes) => charge(id, ++calls === n ? -1 : bytes);
    };
    /** Nothing else is taken down: the same capability and another one are served whole. */
    const othersServed = async (r: Rig, same: string, other: string): Promise<void> => {
      const again = await getFile(r, same, 'a.js').promise;
      expect(again.status, 'the same capability').toBe(200);
      expect(again.body).toEqual(bytesOf('x/a.js', 0, 10));
      const elsewhere = await getFile(r, other, 'a.js').promise;
      expect(elsewhere.status, 'another capability').toBe(200);
      expect(elsewhere.body).toEqual(bytesOf('x/a.js', 0, 10));
    };

    // On the first frame: nothing is out, so the door's throw path answers the instance's fixed 500 and nothing of the path.
    const r = await rig();
    const one = mint(r, { 'three.bin': 3 * FRAME, 'a.js': 10 });
    const two = mint(r, { 'a.js': 10 });
    const seen = scripted(r);
    throwOn(r, 1);
    const first = await getFile(r, one.token, 'three.bin').promise;
    expect(first.status, 'the throw path before a byte').toBe(500);
    expect(first.body.toString()).toBe('Something went wrong.');
    expect(first.body.toString()).not.toContain(one.token);
    expect(first.body.toString()).not.toContain('three.bin');
    expect(await until(() => r.store.boxInflight() === 0), 'its slot is released').toBe(true);
    expect(r.store.lookup(one.token)).toMatchObject({ inflight: 0, queued: 0, servedThisHour: 0 });
    expect(seen.asked, 'no further frame is asked for').toBe(1);
    expect(seen.signals.every((s) => s.aborted), 'the port\'s work for it is aborted').toBe(true);
    await othersServed(r, one.token, two.token);

    // On the second frame: the first is out, so the response is cut short of Content-Length and nothing is written into it.
    const r2 = await rig();
    const one2 = mint(r2, { 'three.bin': 3 * FRAME, 'a.js': 10 });
    const two2 = mint(r2, { 'a.js': 10 });
    const seen2 = scripted(r2);
    throwOn(r2, 2);
    const second = await getFile(r2, one2.token, 'three.bin').promise;
    expect(second.headers['content-length']).toBe(String(3 * FRAME));
    expect(second.outcome, 'a reset, never a short 200').toBe('reset');
    expect(same(second.body, bytesOf('x/three.bin', 0, FRAME)), 'exactly the first frame and nothing after it').toBe(true);
    expect(await until(() => r2.store.boxInflight() === 0), 'its slot is released').toBe(true);
    expect(r2.store.lookup(one2.token)).toMatchObject({ inflight: 0, queued: 0, servedThisHour: FRAME });
    expect(seen2.asked, 'the throwing frame was the last asked for').toBe(2);
    expect(seen2.signals.every((s) => s.aborted), 'the port\'s work for it is aborted').toBe(true);
    await othersServed(r2, one2.token, two2.token);
  });
});

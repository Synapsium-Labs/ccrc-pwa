// Native Docs HTML artifacts X5, plan Task A1.3: the second listener and the host fences (spec sections 2.2 and 3.4). The artifact
// instance has four routes, answers the fixed 404 on all of them in A1, refuses every method but GET and HEAD, refuses a Host that is
// not one of its two, sets no cookie and logs nothing; the console instance refuses either artifact host before its gate runs; a
// listen that fails turns the tier off and leaves the console up. Every host is under a reserved name or on loopback.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { artifactConfig, artifactMethodAllowed, hostFence, hostMatches, type ArtifactConfig } from '../src/artifacts/policy.js';
import {
  ARTIFACT_NOT_FOUND_BODY, buildArtifactServer, createArtifactListenerState, listenArtifactServer,
} from '../src/artifacts/routes.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { PtyLike } from '../src/pty.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

type On = Extract<ArtifactConfig, { state: 'on' }>;

const ART = 'art.artifacts.invalid';
const CONTENT = 'content.artifacts.invalid';
const CONSOLE_HOST = 'console.example.test';
const TOKEN = 'A'.repeat(43);

function onConfig(): On {
  const c = artifactConfig({ origin: `https://${ART}`, content: `https://${CONTENT}`, port: '7790' }, `https://${CONSOLE_HOST}`, 7788);
  if (c.state !== 'on') throw new Error(`the fixture config is not on: ${JSON.stringify(c)}`);
  return c;
}

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });

/** A console instance with the tier set as asked and, when `armed`, the auth gate on with a passphrase file. */
async function openConsole(artifact: ArtifactConfig, armed: boolean): Promise<FastifyInstance> {
  const home = mkTmp('ccrc-artifacts-listener-');
  const base = testDeps(home);
  if (armed) {
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  }
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled: armed, cookieSecure: false, artifact }, spawnPty: stubPty };
  const app = await buildServer(deps);
  await app.ready();
  return app;
}

/** The artifact instance's route table, `VERB path` per registration, HEAD included. The walk of `auth-gate.test.ts`'s
 *  `realRouteTable` (depth by indent, the path joined down the tree), over the default `printRoutes()` tree rather than its
 *  `commonPrefix: false` listing: that listing prints a parametric wildcard route as a bare `*` and loses its prefix (measured on
 *  `/c/:token/*`), while the tree keeps every node, a node with no handler having no method list. A line it cannot read is a
 *  pseudo-route so the assertion names it. */
function routeTable(app: FastifyInstance): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  let matched = 0;
  for (const line of app.printRoutes().split('\n')) {
    if (line.trim() === '') continue;
    const m = /^([│\s]*)[├└]──\s(\S*)(?:\s\(([^)]+)\))?\s*$/.exec(line);
    if (!m) { out.push(`UNPARSED ${line}`); continue; }
    matched++;
    const depth = m[1]!.length / 4;
    stack.length = depth;
    stack[depth] = m[2]!;
    const full = stack.slice(0, depth + 1).join('') || '/';
    for (const method of (m[3] ?? '').split(',')) if (method.trim() !== '') out.push(`${method.trim()} ${full}`);
  }
  if (matched === 0) out.push('UNPARSED the whole tree');
  return out.sort();
}

const SECURITY_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function expectHardened(headers: Record<string, unknown>, what: string): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(headers[k], `${what}: ${k}`).toBe(v);
  expect(headers['set-cookie'], `${what}: set-cookie`).toBeUndefined();
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

let toClose: FastifyInstance[] = [];
let netServers: net.Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const a of toClose) await a.close().catch(() => {});
  toClose = [];
  for (const s of netServers) await new Promise<void>((r) => s.close(() => r()));
  netServers = [];
});

const artifactApp = (): FastifyInstance => {
  const a = buildArtifactServer({ cfg: onConfig() });
  toClose.push(a);
  return a;
};

describe('policy: the host and method decisions (L1)', () => {
  it('hostMatches normalizes both sides the same way', () => {
    const allowed = [ART, '127.0.0.1:7790'];
    expect(hostMatches(ART, allowed)).toBe(true);
    expect(hostMatches(ART.toUpperCase(), allowed)).toBe(true);
    expect(hostMatches(`${ART}.`, allowed)).toBe(true);
    expect(hostMatches('127.0.0.1:7790', allowed)).toBe(true);
    expect(hostMatches('127.0.0.1.:7790', allowed)).toBe(true);
    expect(hostMatches('127.0.0.1:7791', allowed)).toBe(false);
    expect(hostMatches('127.0.0.1', allowed)).toBe(false);
    expect(hostMatches(`${ART}..`, allowed), 'only ONE trailing dot is dropped').toBe(false);
    expect(hostMatches(`${ART}:443`, allowed), 'a port is kept, never defaulted').toBe(false);
    expect(hostMatches(`x.${ART}`, allowed)).toBe(false);
    expect(hostMatches(CONSOLE_HOST, allowed)).toBe(false);
    expect(hostMatches(undefined, allowed)).toBe(false);
    expect(hostMatches('', allowed)).toBe(false);
    expect(hostMatches('', [''])).toBe(false);
    expect(hostMatches(ART, [])).toBe(false);
    // The allowed side is normalized too.
    expect(hostMatches(ART, [`${ART.toUpperCase()}.`])).toBe(true);
  });

  it('hostFence is ok or misdirected, and artifactMethodAllowed is GET and HEAD only', () => {
    expect(hostFence(ART, [ART])).toBe('ok');
    expect(hostFence(CONSOLE_HOST, [ART])).toBe('misdirected');
    expect(hostFence(undefined, [ART])).toBe('misdirected');
    expect(artifactMethodAllowed('GET')).toBe(true);
    expect(artifactMethodAllowed('HEAD')).toBe(true);
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE', 'CONNECT', 'get', '']) {
      expect(artifactMethodAllowed(m), m).toBe(false);
    }
  });
});

describe('listener: the decoration', () => {
  it('tier on: the instance serves exactly GET and HEAD on the four paths; off: null; closing the console closes it', async () => {
    const on = await openConsole(onConfig(), false);
    const inst = on.artifactServer;
    expect(inst, 'the tier is on, so the decoration is an instance').not.toBeNull();
    expect(inst).not.toBe(on);
    expect(routeTable(inst!)).toEqual(
      ['/', '/a/:token', '/c/:token/*', '/clear'].flatMap((p) => [`GET ${p}`, `HEAD ${p}`]).sort());
    expect(on.artifactListener, 'the listen state is decorated beside it').not.toBeNull();
    expect(on.artifactListener!.read()).toBe('pending');

    await inst!.listen({ host: '127.0.0.1', port: 0 });
    expect(inst!.server.listening).toBe(true);
    await on.close();
    expect(inst!.server.listening, 'closing the console closed the artifact instance').toBe(false);

    const off = await openConsole({ state: 'off', why: 'unset', detail: '' }, false);
    toClose.push(off);
    expect(off.artifactServer).toBeNull();
    expect(off.artifactListener).toBeNull();
  });
});

describe('listener: no shell', () => {
  it('every path answers the fixed 404 page, never the app shell', async () => {
    const app = artifactApp();
    const paths = ['/index.html', '/api/auth/status', '/assets/x.js', '/ws/fleet', '/', `/a/${TOKEN}`, `/c/${TOKEN}/x.js`, '/clear',
      '/favicon.ico', '/health'];
    for (const url of paths) {
      for (const method of ['GET', 'HEAD'] as const) {
        const res = await app.inject({ method, url, headers: { host: ART } });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        if (method === 'GET') expect(res.body, url).toBe(ARTIFACT_NOT_FOUND_BODY);
        expect(res.headers['content-type'], url).toBe('text/html; charset=utf-8');
        expectHardened(res.headers, `${method} ${url}`);
      }
    }
    const onContent = await app.inject({ method: 'GET', url: `/c/${TOKEN}/x.js`, headers: { host: CONTENT } });
    expect(onContent.statusCode).toBe(404);
    expect(onContent.body).toBe(ARTIFACT_NOT_FOUND_BODY);
  });

  it('the fixed page says one sentence, with no script and no reference', () => {
    expect(ARTIFACT_NOT_FOUND_BODY).toContain('This host serves ccrc artifacts by private link only.');
    expect(ARTIFACT_NOT_FOUND_BODY.toLowerCase()).not.toMatch(/<script|<link|<img|<iframe|src=|href=|http/);
    expect(ARTIFACT_NOT_FOUND_BODY.length).toBeLessThan(600);
  });
});

describe('listener: methods', () => {
  it('POST, PUT, DELETE, PATCH and OPTIONS are 405 with Allow, and a body is never read', async () => {
    const app = artifactApp();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const) {
      for (const url of ['/', `/a/${TOKEN}`, '/nowhere']) {
        const res = await app.inject({
          method, url, headers: { host: ART, 'content-type': 'application/json' }, payload: method === 'OPTIONS' ? undefined : '{"a":1}',
        });
        expect(res.statusCode, `${method} ${url}`).toBe(405);
        expect(res.headers.allow, `${method} ${url}`).toBe('GET, HEAD');
        expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
        expectHardened(res.headers, `${method} ${url}`);
      }
    }
  });

  it('a GET with a body and a content type never reaches a parser', async () => {
    const app = artifactApp();
    const res = await app.inject({ method: 'GET', url: '/', headers: { host: ART, 'content-type': 'application/json' }, payload: '{"a":1}' });
    expect([404, 400, 415, 500]).toContain(res.statusCode);
    expect(res.body).not.toContain('"a"');
    expectHardened(res.headers, 'GET with a body');
  });
});

describe('listener: console host on the artifact instance is 421', () => {
  it('the console host, a missing Host, an unrelated host and a port variant are all misdirected', async () => {
    const app = artifactApp();
    for (const host of [CONSOLE_HOST, 'other.example.test', `${ART}:443`, `x.${ART}`, `${ART}..`]) {
      const res = await app.inject({ method: 'GET', url: '/', headers: { host } });
      expect(res.statusCode, host).toBe(421);
      expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(res.body, host).not.toContain(host);
      expectHardened(res.headers, host);
    }
    // A missing Host: light-my-request fills one in unless it is blanked.
    const blank = await app.inject({ method: 'GET', url: '/', headers: { host: '' } });
    expect(blank.statusCode).toBe(421);
    // The fence runs before the method check: a POST to the wrong host is 421, not 405.
    const post = await app.inject({ method: 'POST', url: '/', headers: { host: CONSOLE_HOST } });
    expect(post.statusCode).toBe(421);
  });

  it('either artifact host, in any case and with one trailing dot, is served (404), never 421', async () => {
    const app = artifactApp();
    for (const host of [ART, CONTENT, ART.toUpperCase(), `${CONTENT}.`, `${ART.toUpperCase()}.`]) {
      const res = await app.inject({ method: 'GET', url: '/', headers: { host } });
      expect(res.statusCode, host).toBe(404);
    }
  });
});

describe('listener: an artifact host on the console instance is 421', () => {
  it('with the tier on and the gate ARMED, either artifact host is 421 before the gate, and the console host is the gate\'s', async () => {
    const app = await openConsole(onConfig(), true);
    toClose.push(app);
    const own = await app.inject({ method: 'GET', url: '/api/fleet/health', headers: { host: CONSOLE_HOST } });
    expect(own.statusCode, 'the armed gate answers the console\'s own host').toBe(401);
    for (const host of [ART, CONTENT, ART.toUpperCase(), `${CONTENT}.`]) {
      for (const url of ['/api/fleet/health', '/api/auth/status', '/', '/api/sessions/x/prompt']) {
        const res = await app.inject({ method: url.includes('prompt') ? 'POST' : 'GET', url, headers: { host } });
        expect(res.statusCode, `${host} ${url}`).toBe(421);
        expect(res.json(), `${host} ${url}`).toEqual({ ok: false, error: 'misdirected' });
      }
    }
    // A host that merely contains an artifact host's name is not one.
    const lookalike = await app.inject({ method: 'GET', url: '/api/fleet/health', headers: { host: `x.${ART}` } });
    expect(lookalike.statusCode).toBe(401);
  });

  it('an artifact host in any port spelling is 421 too, because a proxy\'s host matcher ignores the port', async () => {
    const app = await openConsole(onConfig(), true);
    toClose.push(app);
    for (const host of [`${CONTENT}:443`, `${ART}:`, `${CONTENT.toUpperCase()}.:8443`, `${ART}:7788`]) {
      const res = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { host } });
      expect(res.statusCode, host).toBe(421);
    }
    const ws = await app.inject({ method: 'GET', url: '/ws/fleet', headers: { host: `${ART}:443`, connection: 'upgrade', upgrade: 'websocket' } });
    expect(ws.statusCode, 'a websocket upgrade naming an artifact host').toBe(421);
  });

  it('a loopback artifact host is matched with its port, so the console\'s own 127.0.0.1 port still answers', async () => {
    const lo = artifactConfig({ origin: 'http://127.0.0.1:7790', content: 'http://127.0.0.1:7791', port: '7792' }, 'http://localhost:7788', 7788);
    const app = await openConsole(lo, false);
    toClose.push(app);
    expect((await app.inject({ method: 'GET', url: '/api/auth/status', headers: { host: '127.0.0.1:7790' } })).statusCode).toBe(421);
    expect((await app.inject({ method: 'GET', url: '/api/auth/status', headers: { host: '127.0.0.1:7788' } })).statusCode).not.toBe(421);
  });

  it('with the tier off, the same Host is not 421', async () => {
    const app = await openConsole({ state: 'off', why: 'unset', detail: '' }, true);
    toClose.push(app);
    const res = await app.inject({ method: 'GET', url: '/api/fleet/health', headers: { host: ART } });
    expect(res.statusCode).not.toBe(421);
    expect(res.statusCode).toBe(401);
  });
});

describe('listener: no cookie', () => {
  it('no artifact answer sets a cookie', async () => {
    const app = artifactApp();
    app.get('/boom', async () => { throw new Error('boom'); });
    const answers = [
      await app.inject({ method: 'GET', url: '/', headers: { host: ART } }),
      await app.inject({ method: 'GET', url: `/c/${TOKEN}/x`, headers: { host: CONTENT } }),
      await app.inject({ method: 'POST', url: '/', headers: { host: ART } }),
      await app.inject({ method: 'GET', url: '/', headers: { host: CONSOLE_HOST } }),
      await app.inject({ method: 'GET', url: '/boom', headers: { host: ART } }),
      await app.inject({ method: 'GET', url: '/', headers: { host: ART, cookie: 'ccrc_session=x' } }),
    ];
    expect(answers.map((a) => a.statusCode)).toEqual([404, 404, 405, 421, 500, 404]);
    for (const a of answers) {
      expect(a.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify(a.headers).toLowerCase()).not.toContain('set-cookie');
    }
  });
});

describe('listener: the error handler', () => {
  it('answers a fixed 500 with no thrown text and no console output', async () => {
    const spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const app = buildArtifactServer({ cfg: onConfig() });
    toClose.push(app);
    app.get('/boom', async () => { throw new Error('SECRET-THROWN-TEXT /a/' + TOKEN); });
    app.get('/boom-sync', () => { throw Object.assign(new Error('SECRET-SYNC'), { statusCode: 418 }); });
    for (const url of ['/boom', '/boom-sync']) {
      const res = await app.inject({ method: 'GET', url, headers: { host: ART } });
      expect(res.statusCode, url).toBe(500);
      expect(res.body, url).not.toContain('SECRET');
      expect(res.body, url).not.toContain(TOKEN);
      expect(res.body, url).not.toContain('boom');
      expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
      expectHardened(res.headers, url);
    }
    expect(spies.flatMap((s) => s.mock.calls)).toEqual([]);
  });
});

describe('listener: logs no path', () => {
  it('404s, a 405 and 421s on paths carrying a token call no console method', async () => {
    const app = artifactApp();
    const spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const out = [
      await app.inject({ method: 'GET', url: `/a/${TOKEN}`, headers: { host: ART } }),
      await app.inject({ method: 'GET', url: `/c/${TOKEN}/dir/file.js?v=2`, headers: { host: CONTENT } }),
      await app.inject({ method: 'GET', url: `/c/${TOKEN}/../x`, headers: { host: CONTENT } }),
      await app.inject({ method: 'GET', url: `/a/${TOKEN}`, headers: { host: CONSOLE_HOST } }),
      await app.inject({ method: 'POST', url: `/a/${TOKEN}`, headers: { host: ART } }),
      await app.inject({ method: 'GET', url: `/c/${TOKEN}/%zz`, headers: { host: CONTENT } }),
      await app.inject({ method: 'GET', url: `/${'x'.repeat(2000)}/${TOKEN}`, headers: { host: ART } }),
      await app.inject({ method: 'GET', url: `/a/${'B'.repeat(200)}`, headers: { host: ART } }),
    ];
    // Fastify answers a malformed escape and an over-long parameter itself, before any hook; the instance words both.
    expect(out.map((r) => r.statusCode)).toEqual([404, 404, 404, 421, 405, 400, 404, 414]);
    for (const r of out) {
      expect(r.body).not.toContain(TOKEN);
      expect(r.body).not.toContain('%zz');
      expect(r.body).not.toContain('BBBBBBBB');
      expectHardened(r.headers, `${r.statusCode}`);
    }
    expect(spies.flatMap((s) => s.mock.calls)).toEqual([]);
  });
});

describe('listener: a taken port leaves the console up', () => {
  it('listenArtifactServer resolves down with one warning, and the console then listens and answers /health', async () => {
    const holder = net.createServer();
    netServers.push(holder);
    await new Promise<void>((r) => holder.listen({ host: '127.0.0.1', port: 0 }, () => r()));
    const port = (holder.address() as net.AddressInfo).port;

    const app = await openConsole(onConfig(), false);
    toClose.push(app);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const verdict = await listenArtifactServer(app, port);
    expect(verdict).toBe('down');
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line.startsWith('ccrc-server: artifact tier off')).toBe(true);
    expect(line).toContain(`127.0.0.1:${port}`);
    expect(line).toContain('EADDRINUSE');
    expect(app.artifactListener!.read()).toBe('down');

    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address() as net.AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
    expect(res.status).toBe(200);
  });

  it('a request Node cannot parse is answered with fixed words and the hardening headers, echoing nothing', async () => {
    const app = await openConsole(onConfig(), false);
    toClose.push(app);
    expect(await listenArtifactServer(app, 0)).toBe('listening');
    const { port } = app.artifactServer!.server.address() as net.AddressInfo;
    const spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const raw = async (text: string): Promise<string> => new Promise((resolve, reject) => {
      const s = net.connect(port, '127.0.0.1', () => s.end(text));
      let got = '';
      s.setEncoding('utf8');
      s.on('data', (d: string) => { got += d; });
      s.on('close', () => resolve(got));
      s.on('error', reject);
    });
    const cases: [string, string][] = [
      [`GARBAGE /c/${TOKEN}/x HTTP/1.1\r\nHost: ${ART}\r\n\r\n`, '400'],
      [`GET /c/${TOKEN}/x HTTP/1.1\r\nHost: ${ART}\r\nX-Big: ${'a'.repeat(20000)}\r\n\r\n`, '431'],
    ];
    for (const [req, status] of cases) {
      const got = await raw(req);
      expect(got.startsWith(`HTTP/1.1 ${status} `), got.slice(0, 40)).toBe(true);
      const head = got.slice(0, got.indexOf('\r\n\r\n')).toLowerCase();
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(head, `${status}: ${k}`).toContain(`${k}: ${v}`.toLowerCase());
      expect(head).not.toContain('set-cookie');
      expect(got).not.toContain(TOKEN);
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('a free port is listening, marked so, and answers over real HTTP', async () => {
    const app = await openConsole(onConfig(), false);
    toClose.push(app);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await listenArtifactServer(app, 0)).toBe('listening');
    expect(warn).not.toHaveBeenCalled();
    expect(app.artifactListener!.read()).toBe('listening');
    const addr = app.artifactServer!.server.address() as net.AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
    // `fetch` may not set `Host`, so this goes through `node:http`.
    const res = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: addr.port, path: '/', headers: { host: ART } }, (r) => {
        let body = '';
        r.setEncoding('utf8');
        r.on('data', (d: string) => { body += d; });
        r.on('end', () => resolve({ status: r.statusCode, body }));
      });
      req.on('error', reject);
      req.end();
    });
    expect(res.status).toBe(404);
    expect(res.body).toBe(ARTIFACT_NOT_FOUND_BODY);
  });

  it('with the tier off there is nothing to listen on: down, no log', async () => {
    const app = await openConsole({ state: 'off', why: 'unset', detail: '' }, false);
    toClose.push(app);
    const spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    expect(await listenArtifactServer(app, 0)).toBe('down');
    expect(spies.flatMap((s) => s.mock.calls)).toEqual([]);
  });

  it('the listen state starts pending and records what it is told', () => {
    const s = createArtifactListenerState();
    expect(s.read()).toBe('pending');
    s.mark('listening');
    expect(s.read()).toBe('listening');
    s.mark('down');
    expect(s.read()).toBe('down');
  });
});

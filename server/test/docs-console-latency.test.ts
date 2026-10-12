// "Docs never starves the console" (design 2026-10-01, section 6.8, M6.12; W3 Task 10, refinement (s)). A real
// in-process agent on a fixture HOME, a python fixture ccd at `<home>/.local/bin/ccd`, a 100 Mbit userland link
// (`throttledProxy`) between the agent and a real `connectFleet` client, and the docs plugin mounted on a bare Fastify
// over W2's real adapter. While a tree GET and thirteen 2 MiB file GETs run, the console's two probes share the one
// agent socket: a pty echo every 25 ms and a `caps` round trip every 100 ms. Through the real read lane each stays
// within one lane budget of link time (`HOL_LIMIT_MS`); through a pass-through lane (the CONTROL) the same load must
// push the echo PAST it, or the probe could not have seen starvation and the real run proves nothing.
//
// CPU-sensitive: it measures wall time on a shared event loop. A red is re-run in isolation, in the foreground,
// before it is called a break (CLAUDE.md's known load flakes; W7 adds this file to that list).
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunningAgent } from '../../agent/src/server.js';
import { DOCS_CAP } from '../src/ccdargv.js';
import { loadConfig } from '../src/config.js';
import { installDocsRequestPolicy, installDocsResponsePolicy } from '../src/docs/hooks.js';
import { DOCS_LANE_BYTES } from '../src/docs/policy.js';
import { composeDocs, registerDocsReadRoutes, registerDocsRefreshRoute } from '../src/docs/routes.js';
import { ccdRunner } from '../src/lifecycle.js';
import type { PtyLike } from '../src/pty.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import { DOCS_CLASS_CAP, DOCS_RASTER_TYPES, contentClass, type DocsTreeResponse } from '../../shared/docs.js';
import {
  PWA_HEADERS, committedEntry, echoPty, line, passThroughLane, sha256Hex, treeOk,
} from './docsRouteHelpers.js';
import { seedRoster } from './helpers.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';
import { throttledProxy, type ThrottledProxy } from './throttledLink.js';
import { mkTmp } from './tmpHelpers.js';

/** The link rate (section 6.8): 12 500 000 bytes a second is 100 Mbit. */
const LINK_BYTES_PER_SECOND = 12_500_000;
/** One lane budget of link time, with 1.5x and 150 ms of slack (section 6.8), DERIVED from L1's budget. */
const HOL_LIMIT_MS = Math.ceil(DOCS_LANE_BYTES / 12.5e6 * 1000 * 1.5) + 150;
/** The probes' cadence (section 6.8). */
const ECHO_EVERY_MS = 25;
const CAPS_EVERY_MS = 100;
/** How long the probes run before the load starts (an idle baseline inside the sample). */
const LEAD_MS = 1000;
/** The client's default request wait, raised above the docs-show budget (15 000) plus the runner's 5 000 slack, so
 *  a `caps` probe or the pty open never times out under the control's backlog (connectToAgent's default is 2 000). */
const REQUEST_TIMEOUT_MS = 30_000;
/** Each heavy case's own vitest timeout. */
const CASE_TIMEOUT_MS = 120_000;

/** The load (section 6.8): one 2 MiB markdown file and twelve 2 MiB PNGs, each at its class cap, in `specs`. */
const LOAD_PATHS: readonly string[] = ['doc.md', ...Array.from({ length: 12 }, (_, i) => `img-${i + 1}.png`)];

/** The least time the thirteen answers can take on the link: their base64 content bytes at the link rate, before
 *  any envelope (`showWire` without its reserve). A load faster than 90% of it never crossed the throttle. */
const LINK_FLOOR_MS = LOAD_PATHS.reduce((n, p) => n + 4 * Math.ceil(DOCS_CLASS_CAP[contentClass(p)] / 3), 0)
  / LINK_BYTES_PER_SECOND * 1000;

/** The canned tree the fixture ccd answers: every load path committed at its class cap, each with a distinct
 *  40-hex blob derived from its path. A complete `DocsTreeOk`, so it passes `docsAnswerShape`. */
function cannedTree(): string {
  return line(treeOk({
    entries: LOAD_PATHS.map((p) =>
      committedEntry(p, sha256Hex(Buffer.from(p)).slice(0, 40), DOCS_CLASS_CAP[contentClass(p)])),
  }));
}

/**
 * The fixture ccd (section 6.8): a python3 script that reads `docs-latency.json` beside itself. `caps` prints the
 * verb list; `docs-tree` prints the canned line; `docs-show` answers fresh random bytes of the listed size (behind
 * the PNG magic for a `.png`, so the raster check matches), base64-encoded, with `size`, `sha256`, the listing's
 * `blob` and every pin echo, and `onRef` 'contains', so W2's check 8 passes and the answer is within check 9's bound.
 * Any other verb exits 2 with nothing on stdout.
 */
const FIXTURE_CCD = String.raw`#!/usr/bin/env python3
import base64, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'docs-latency.json')) as f:
    FIX = json.load(f)

def flags(argv):
    return {argv[i]: argv[i + 1] for i in range(0, len(argv) - 1, 2)}

def show(o):
    tree = json.loads(FIX['treeLine'])
    entry = next(e for e in tree['entries'] if e['section'] == o['--section'] and e['path'] == o['--path'])
    size = entry['committed']['size']
    head = bytes.fromhex(FIX['pngMagicHex']) if o['--path'].endswith('.png') else b''
    body = head + os.urandom(size - len(head))
    return {
        'v': 1, 'verb': 'docs-show', 'ok': True, 'elapsedMs': 1, 'source': 'committed',
        'section': o['--section'], 'path': o['--path'], 'commit': o['--commit'], 'blob': entry['committed']['blob'],
        'mode': '100644', 'onRef': 'contains', 'size': len(body), 'sha256': hashlib.sha256(body).hexdigest(),
        'encoding': 'base64', 'b64': base64.b64encode(body).decode('ascii'),
    }

def main(argv):
    verb = argv[0] if argv else ''
    if verb == 'caps':
        sys.stdout.write(''.join(v + '\n' for v in FIX['verbs']))
        return 0
    if verb == 'docs-tree':
        sys.stdout.write(FIX['treeLine'])
        return 0
    if verb == 'docs-show':
        sys.stdout.write(json.dumps(show(flags(argv[1:])), separators=(',', ':')) + '\n')
        return 0
    sys.stderr.write('fixture ccd: no such verb\n')
    return 2

sys.exit(main(sys.argv[1:]))
`;

/** Write the fixture ccd, its config and the libexec placeholder the agent's caps cache keys on, before boot (the
 *  agent reads `ccd caps` once at boot for the handshake). */
function plantFixtureCcd(home: string): void {
  const bin = path.join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  const png = DOCS_RASTER_TYPES.png.magic[0][0];
  writeFileSync(path.join(bin, 'docs-latency.json'), JSON.stringify({
    verbs: ['caps', 'docs-index', 'docs-tree', 'docs-show', 'docs-fetch', DOCS_CAP],
    treeLine: cannedTree(),
    pngMagicHex: Buffer.from(png.bytes).toString('hex'),
  }));
  writeFileSync(path.join(bin, 'ccd'), FIXTURE_CCD);
  chmodSync(path.join(bin, 'ccd'), 0o755);
  const libexec = path.join(home, '.local', 'libexec', 'ccrc');
  mkdirSync(libexec, { recursive: true });
  writeFileSync(path.join(libexec, 'ccd'), '# placeholder: the agent stats this file to key its caps cache\n');
}

interface Rig {
  fixture: RemoteFixture;
  agent: RunningAgent;
  proxy: ThrottledProxy;
  fleet: ConnectedFleet;
  app: FastifyInstance;
  pty: PtyLike | undefined;
}

let rig: Rig | undefined;

afterEach(async () => {
  const r = rig;
  rig = undefined;
  if (r === undefined) return;
  r.pty?.kill();
  await r.app.close();
  await r.fleet.close();
  await r.proxy.close();
  await r.agent.close();
  rmSync(r.fixture.home, { recursive: true, force: true });
  rmSync(r.fixture.projectsRoot, { recursive: true, force: true });
});

/**
 * Boot one case: the fixture, the agent with an echo pty, the throttled link, the client through it, and the docs
 * plugin on a bare Fastify, registered exactly as `server.ts` registers it (refinement (s): `buildServer` would add
 * the gate and nothing the probes measure). `lane` picks the read lane: the real `docsReadLane`, or the control.
 */
async function boot(lane: 'real' | 'control'): Promise<Rig> {
  const fixture = makeFixture();
  plantFixtureCcd(fixture.home);
  const serverHome = mkTmp('ccrc-docs-latency-server-');
  seedRoster(serverHome);
  const cfg = loadConfig({ CCRC_HOME: serverHome });
  const agent = await bootAgent(fixture, { spawnPty: echoPty() });
  const proxy = await throttledProxy(agent.port, LINK_BYTES_PER_SECOND);
  const fleet = connectToAgent(proxy.port, { requestTimeoutMs: REQUEST_TIMEOUT_MS });
  const app = Fastify({ logger: false });
  rig = { fixture, agent, proxy, fleet, app, pty: undefined };
  await vi.waitFor(() => expect(fleet.state.ccdVerbs).toContain(DOCS_CAP), { timeout: 10_000 });
  const docs = composeDocs({ runCcd: ccdRunner(fleet.runner, cfg), fleetState: fleet.state },
    lane === 'control' ? { readLane: passThroughLane } : {});
  await app.register(async (app) => {
    installDocsRequestPolicy(app);
    installDocsResponsePolicy(app);
    registerDocsReadRoutes(app, docs.readers, docs.lanes);
    registerDocsRefreshRoute(app, docs.readers, docs.fetchers, docs.lanes);
  });
  await app.ready();
  return rig;
}

/** What one loaded run measured: each file GET's status and content type, how long the thirteen took together,
 *  every pty echo's and every caps round trip's milliseconds, and how many caps probes answered nothing to trust. */
interface Measured {
  files: { path: string; status: number; type: string }[];
  loadMs: number;
  echoMs: number[];
  capsMs: number[];
  capsNull: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run the probes from `LEAD_MS` before the load until it ends (section 6.8), then wait for every probe in flight to
 * come back. The load: one tree GET (its commit and served ref are the pins), then the thirteen file GETs at once,
 * each with the PWA's headers (the marker and `sec-fetch-site: same-origin`).
 */
async function loadAndProbe(r: Rig): Promise<Measured> {
  const pty = r.fleet.spawnPty('docs-latency', 80, 24);
  r.pty = pty;
  const sent = new Map<string, number>();
  const echoMs: number[] = [];
  let buffered = '';
  pty.onData((d) => {
    const now = performance.now();
    buffered += d;
    for (let i = buffered.indexOf(';'); i >= 0; i = buffered.indexOf(';')) {
      const token = buffered.slice(0, i);
      buffered = buffered.slice(i + 1);
      const t0 = sent.get(token);
      if (t0 !== undefined) {
        sent.delete(token);
        echoMs.push(now - t0);
      }
    }
  });
  sent.set('warm', performance.now());
  pty.write('warm;');
  await vi.waitFor(() => expect(sent.size).toBe(0), { timeout: 10_000 });
  echoMs.length = 0;

  const capsMs: number[] = [];
  let capsNull = 0;
  let capsOut = 0;
  let n = 0;
  const echoTimer = setInterval(() => {
    const token = `e${n++}`;
    sent.set(token, performance.now());
    pty.write(`${token};`);
  }, ECHO_EVERY_MS);
  const capsTimer = setInterval(() => {
    const t0 = performance.now();
    capsOut += 1;
    void r.fleet.client.caps().then((verbs) => {
      capsOut -= 1;
      capsMs.push(performance.now() - t0);
      if (verbs === null) capsNull += 1;
    });
  }, CAPS_EVERY_MS);
  try {
    await sleep(LEAD_MS);
    const tree = await r.app.inject({ method: 'GET', url: '/api/docs/demo/tree', headers: PWA_HEADERS });
    expect(tree.statusCode, tree.body.slice(0, 300)).toBe(200);
    const { commit, served } = (tree.json() as DocsTreeResponse).tree.ref;
    const started = performance.now();
    const files = await Promise.all(LOAD_PATHS.map(async (p) => {
      const res = await r.app.inject({
        method: 'GET', url: '/api/docs/demo/file', headers: PWA_HEADERS,
        query: { commit, servedRef: served, section: 'specs', path: p },
      });
      return { path: p, status: res.statusCode, type: String(res.headers['content-type']) };
    }));
    const loadMs = performance.now() - started;
    clearInterval(echoTimer);
    clearInterval(capsTimer);
    await vi.waitFor(() => {
      expect(sent.size).toBe(0);
      expect(capsOut).toBe(0);
    }, { timeout: REQUEST_TIMEOUT_MS, interval: 20 });
    return { files, loadMs, echoMs, capsMs, capsNull };
  } finally {
    clearInterval(echoTimer);
    clearInterval(capsTimer);
  }
}

/** The `p` quantile by nearest rank (`p95`: the smallest sample with at least 95% of samples at or below it). */
function quantile(xs: readonly number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] as number;
}

const maxOf = (xs: readonly number[]): number => Math.max(...xs);

/** One line naming what was measured, for every assertion message. */
function summary(m: Measured): string {
  const ms = (x: number): string => `${Math.round(x)} ms`;
  return `load ${ms(m.loadMs)} (link floor ${ms(LINK_FLOOR_MS)}); `
    + `echo n=${m.echoMs.length} p95=${ms(quantile(m.echoMs, 0.95))} max=${ms(maxOf(m.echoMs))}; `
    + `caps n=${m.capsMs.length} max=${ms(maxOf(m.capsMs))} null=${m.capsNull}; limit ${HOL_LIMIT_MS} ms`;
}

/** The control's verdict (section 6.8): the pass-through lane's echo max must EXCEED the limit, else the probe could
 *  not have seen starvation and the real run's green proves nothing. */
function seesStarvation(m: Measured): 'starved' {
  if (!(maxOf(m.echoMs) > HOL_LIMIT_MS)) throw new Error(`the probe cannot see starvation (${summary(m)})`);
  return 'starved';
}

/** Set only by the control case's verdict, read by the meta-check that follows it. */
let controlVerdict: 'starved' | undefined;

describe('Docs never starves the console (section 6.8, M6.12)', () => {
  it('HOL_LIMIT_MS is derived from the read lane budget, 528 ms at 100 Mbit', () => {
    expect(HOL_LIMIT_MS).toBe(528);
  });

  it('through the real read lane, all 13 files answer 200 while pty echo p95 and max and the caps max stay within HOL_LIMIT_MS', async () => {
    const m = await loadAndProbe(await boot('real'));
    expect(m.files.map((f) => f.status), summary(m)).toEqual(LOAD_PATHS.map(() => 200));
    expect(m.files.filter((f) => f.path.endsWith('.png')).map((f) => f.type)).toEqual(Array(12).fill('image/png'));
    expect(m.loadMs, `the load crossed the throttled link: ${summary(m)}`).toBeGreaterThanOrEqual(LINK_FLOOR_MS * 0.9);
    expect(m.echoMs.length, summary(m)).toBeGreaterThan(LEAD_MS / ECHO_EVERY_MS);
    expect(m.capsNull, summary(m)).toBe(0);
    expect(quantile(m.echoMs, 0.95), `pty echo p95: ${summary(m)}`).toBeLessThanOrEqual(HOL_LIMIT_MS);
    expect(maxOf(m.echoMs), `pty echo max: ${summary(m)}`).toBeLessThanOrEqual(HOL_LIMIT_MS);
    expect(maxOf(m.capsMs), `caps round-trip max: ${summary(m)}`).toBeLessThanOrEqual(HOL_LIMIT_MS);
  }, CASE_TIMEOUT_MS);

  it('the control: the same load through a pass-through lane pushes pty echo past HOL_LIMIT_MS', async () => {
    const m = await loadAndProbe(await boot('control'));
    expect(m.files.map((f) => f.status), summary(m)).toEqual(LOAD_PATHS.map(() => 200));
    expect(m.loadMs, `the load crossed the throttled link: ${summary(m)}`).toBeGreaterThanOrEqual(LINK_FLOOR_MS * 0.9);
    expect(m.echoMs.length, summary(m)).toBeGreaterThan(LEAD_MS / ECHO_EVERY_MS);
    controlVerdict = seesStarvation(m);
  }, CASE_TIMEOUT_MS);

  it('the control ran its starvation check (the meta-check)', () => {
    expect(controlVerdict, 'the control did not run its starvation check').toBe('starved');
  });
});

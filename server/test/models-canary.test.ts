// `deploy/models-canary.mjs` — ONE request through a Codex lane's own proxy,
// for one candidate model (auto-advance spec §2.3 step 3, D22; plan W2 Task
// 10). Against the fake lane proxy (`spawnFakeLaneProxy`): a python child on
// 127.0.0.1 and a kernel-chosen port, never a live lane's. Every case runs in a
// `mkTmp` HOME with a key minted for the case. Neutral ids only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import {
  freePort, killLaneProcesses, laneProxyAnswersAs, laneProxyGets, laneProxyMode, laneProxyProbeMode, laneProxyRequests,
  shimRefusedPrefix, spawnFakeLaneProxy, type FakeLaneProxy, type LaneProxyMode,
} from './codexLaneFixture.js';
import { pythonOrSkip } from './ccgptHarness.js';
import { REASON_MAX } from '../../shared/model-advance.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANARY = path.join(REPO, 'deploy', 'models-canary.mjs');
const SHIM_PY = path.join(REPO, 'ccd', 'ccgpt-proxy.py');
const PY = pythonOrSkip();

let home = '';
let proxy: FakeLaneProxy;
let key = '';
const laneDir = (): string => path.join(home, '.ccrc', 'codex', 'lane-a');
const envPath = (): string => path.join(laneDir(), 'runtime.env');
const lanePath = (): string => path.join(laneDir(), 'lane.json');
const plantLane = (port: number): void => {
  fs.mkdirSync(laneDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(lanePath(), `${JSON.stringify({ id: 'lane-a', proxyPort: port }, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(envPath(), `LITELLM_MASTER_KEY=${key}\n`, { mode: 0o600 });
};

interface Canary { code: number | null; body: Record<string, unknown>; out: string; ms: number }
/** The canary for `model-6.1-gamma` at effort `low`, 2 s deadline; `args`
 *  override (the last value of a key wins). Exactly one line on stdout, always. */
function canary(args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): Canary {
  return runCanary(args, extraEnv);
}

function runCanary(args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}, nodeArgs: string[] = []): Canary {
  const t0 = Date.now();
  const r = spawnSync(process.execPath,
    [...nodeArgs, CANARY, '--id', 'lane-a', '--model', 'model-6.1-gamma', '--effort', 'low', '--timeout-s', '2', ...args],
    { env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home, ...extraEnv }, encoding: 'utf8', timeout: 20_000 });
  const stdout = r.stdout ?? '';
  expect(r.signal, `the canary was killed at the test's own bound: ${stdout}${r.stderr ?? ''}`).toBeNull();
  const lines = stdout.split('\n');
  expect(lines.length, `stdout carried ${lines.length - 1} lines, not one: ${stdout}`).toBe(2);
  expect(r.stderr ?? '', 'the canary writes nothing on stderr').toBe('');
  return { code: r.status, body: JSON.parse(lines[0]!) as Record<string, unknown>, out: stdout, ms: Date.now() - t0 };
}

function allHeaderValues(gets: ReturnType<typeof laneProxyGets>): string[] {
  return gets.flatMap((get) => Object.values(get.headers).flat());
}

function expectCleanProbe(gets: ReturnType<typeof laneProxyGets>): void {
  expect(gets).toHaveLength(1);
  expect(allHeaderValues(gets).every((value) => !value.includes(key) && !value.includes(key.slice(3)))).toBe(true);
  const accept = gets[0]!.headers['accept'] ?? [];
  expect(accept.length === 1 && accept[0] === 'application/json').toBe(true);
}

type ReadStage = 'ok' | 'open' | 'fstat' | 'read' | 'type' | 'initial-size' | 'growth';

function readStage(stage: ReadStage): { canary: Canary; evidence: { opens: number; closes: number; stage: ReadStage } } {
  const hook = path.join(home, 'canary-read-hook.cjs');
  const evidencePath = path.join(home, 'canary-read-evidence.json');
  const max = 64 * 1024;
  const base = JSON.stringify({ id: 'lane-a', proxyPort: proxy.port, pad: '' });
  const growthText = JSON.stringify({ id: 'lane-a', proxyPort: proxy.port, pad: 'x'.repeat(max + 1 - Buffer.byteLength(base)) });
  expect(Buffer.byteLength(growthText)).toBe(max + 1);
  fs.writeFileSync(hook, `
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const target = process.env.CANARY_READ_TARGET;
const stage = process.env.CANARY_READ_STAGE;
const evidence = process.env.CANARY_READ_EVIDENCE;
const growthText = ${JSON.stringify(growthText)};
const original = {
  openSync: fs.openSync, fstatSync: fs.fstatSync, readSync: fs.readSync, closeSync: fs.closeSync,
  writeFileSync: fs.writeFileSync,
};
const tracked = new Set();
let opens = 0;
let closes = 0;
let grew = false;
const failure = (code) => Object.assign(new Error(code), { code });
fs.openSync = function(p, ...args) {
  if (p === target && stage === 'open') throw failure('EACCES');
  const fd = original.openSync.call(this, p, ...args);
  if (p === target) { tracked.add(fd); opens += 1; }
  return fd;
};
fs.fstatSync = function(fd, ...args) {
  if (!tracked.has(fd)) return original.fstatSync.call(this, fd, ...args);
  if (stage === 'fstat') throw failure('EIO');
  const stat = original.fstatSync.call(this, fd, ...args);
  if (stage === 'type') return { isFile: () => false, size: stat.size };
  if (stage === 'initial-size') return { isFile: () => true, size: 65537 };
  if (stage === 'growth' && !grew) {
    grew = true;
    original.writeFileSync(target, growthText);
  }
  return stat;
};
fs.readSync = function(fd, ...args) {
  if (tracked.has(fd) && stage === 'read') throw failure('EIO');
  return original.readSync.call(this, fd, ...args);
};
fs.closeSync = function(fd, ...args) {
  if (tracked.delete(fd)) closes += 1;
  return original.closeSync.call(this, fd, ...args);
};
syncBuiltinESMExports();
process.on('exit', () => fs.writeFileSync(evidence, JSON.stringify({ opens, closes, stage }) + '\\n'));
`);
  const c = runCanary([], {
    CANARY_READ_STAGE: stage,
    CANARY_READ_TARGET: lanePath(),
    CANARY_READ_EVIDENCE: evidencePath,
  }, ['--require', hook]);
  return { canary: c, evidence: JSON.parse(fs.readFileSync(evidencePath, 'utf8')) as { opens: number; closes: number; stage: ReadStage } };
}

function globalAgentPoison(method: 'GET' | 'POST'): string {
  const hook = path.join(home, `global-agent-${method.toLowerCase()}.cjs`);
  fs.writeFileSync(hook, `
const http = require('node:http');
const original = http.globalAgent.addRequest;
http.globalAgent.addRequest = function(req, options) {
  if (options.method === ${JSON.stringify(method)}) throw new Error('fixture global agent used');
  return original.call(this, req, options);
};
`);
  return hook;
}

describe.skipIf(PY === null)('deploy/models-canary.mjs (auto-advance spec §2.3 step 3; plan W2 Task 10)', () => {
  beforeEach(async () => {
    home = mkTmp('ccrc-models-canary-');
    key = `sk-${randomBytes(24).toString('hex')}`;
    proxy = await spawnFakeLaneProxy(home);
    plantLane(proxy.port);
  });
  afterEach(async () => {
    await killLaneProcesses(home);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('a 200 with text passes; the request is streamed, names the candidate and the lowest effort, and carries the lane key', () => {
    const c = canary();
    expect(c.code).toBe(0);
    expect(c.body).toEqual({ ok: true, op: 'canary', result: 'passed', status: 200, reason: null });
    // Check values first so a credential-bearing mutant never reaches a value-printing assertion.
    const gets = laneProxyGets(proxy);
    expectCleanProbe(gets);
    expect(gets).toEqual([{
      n: 1, path: '/ccgpt/lane', authorization: null, headerNames: ['accept', 'connection', 'host'],
      headers: { accept: ['application/json'], connection: ['keep-alive'], host: [`127.0.0.1:${proxy.port}`] },
    }]);
    const [q] = laneProxyRequests(proxy);
    expect(q!.path).toBe('/v1/messages');
    // The vacuity control for every "the key never leaves" case below: it was read, and it went out here.
    expect(q!.authorization).toBe(`Bearer ${key}`);
    expect(q!.headerNames).toEqual([
      'accept', 'anthropic-version', 'authorization', 'connection', 'content-length', 'content-type', 'host',
    ]);
    expect(q!.body).toEqual({ model: 'model-6.1-gamma', max_tokens: 512, stream: true,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }], output_config: { effort: 'low' } });
  });

  it("a listener that answers the lane probe as another lane is unavailable, and nothing carrying the key is sent", () => {
    // Review Focus: a port is only a number. Another lane's leftover shim, or a
    // stray listener, on lane-a's proxy port gets no key.
    laneProxyAnswersAs(proxy, 'lane-b');
    const c = canary();
    expect(c.body).toEqual({ ok: true, op: 'canary', result: 'unavailable', status: null,
      reason: `127.0.0.1:${proxy.port} does not answer as lane-a's shim, so the key was not sent` });
    expect(laneProxyRequests(proxy)).toEqual([]);
    const gets = laneProxyGets(proxy);
    expectCleanProbe(gets);
    expect(gets.map((g) => g.authorization)).toEqual([null]);
  });

  it.each(['GET', 'POST'] as const)('uses no global agent for the %s request', (method) => {
    const c = runCanary([], {}, ['--require', globalAgentPoison(method)]);
    expect(c.body['result']).toBe('passed');
    expect(laneProxyGets(proxy)).toHaveLength(1);
    expect(laneProxyRequests(proxy)).toHaveLength(1);
  });

  it('a listener that does not answer the lane probe (404) is unavailable, and nothing is sent', () => {
    laneProxyAnswersAs(proxy, null);
    expect(canary().body).toMatchObject({ result: 'unavailable', status: null });
    expect(laneProxyRequests(proxy)).toEqual([]);
  });

  it('a lane-probe answer over 4 KiB is unavailable, and nothing keyed is sent', () => {
    laneProxyProbeMode(proxy, 'pad');
    const c = canary(['--timeout-s', '10']);
    expect(c.body).toMatchObject({ result: 'unavailable', status: null });
    expect(c.ms).toBeLessThan(2_000);
    expect(laneProxyRequests(proxy)).toEqual([]);
  });

  it('an endless lane-probe body is unavailable at its cap, before the deadline and without a POST', () => {
    laneProxyProbeMode(proxy, 'flood');
    const c = canary(['--timeout-s', '10']);
    expect(c.body).toMatchObject({ result: 'unavailable', status: null });
    expect(c.ms).toBeLessThan(2_000);
    expect(laneProxyRequests(proxy)).toEqual([]);
  });

  it('--effort none sends no output_config', () => {
    expect(canary(['--effort', 'none']).body['result']).toBe('passed');
    expect(laneProxyRequests(proxy)[0]!.body).not.toHaveProperty('output_config');
  });

  it('an effort level a catalogue may carry, with an underscore or a capital, is sent as it is', () => {
    expect(canary(['--effort', 'Extra_High']).body['result']).toBe('passed');
    expect(laneProxyRequests(proxy)[0]!.body).toMatchObject({ output_config: { effort: 'Extra_High' } });
  });

  it('a 500 is failed, naming the status and the upstream error', () => {
    laneProxyMode(proxy, '500');
    expect(canary().body).toEqual({ ok: true, op: 'canary', result: 'failed', status: 500, reason: 'http 500: upstream error' });
  });

  it('an ordinary word that contains sk- is not redacted from a reason', () => {
    laneProxyMode(proxy, '500-risk');
    expect(canary().body['reason']).toBe('http 500: risk-averse upstream refused the task-queue');
  });

  it('an error body is read only up to its cap, so a huge one cannot flood the canary', () => {
    laneProxyMode(proxy, '500-huge');
    const reason = String(canary().body['reason']);
    // Cut at 64 KiB, the body is no longer JSON, so the reason is its first characters, not the upstream message.
    expect(reason.startsWith('http 500: {"pad": "xxxx')).toBe(true);
    expect(reason).toHaveLength(REASON_MAX);
    expect(reason).not.toContain('upstream error');
  });

  it("the shim's D-4933 502 (a refused gateway connection, waited out) is not-ready", () => {
    laneProxyMode(proxy, '502-refused');
    const c = canary();
    expect(c.body).toMatchObject({ result: 'not-ready', status: 502 });
    expect(String(c.body['reason']).startsWith(shimRefusedPrefix())).toBe(true);
  });

  it('a 502 that is not the D-4933 text, a reset during a LiteLLM restart, is failed: never not-ready and never passed', () => {
    // Review Focus (false canary failures): classified by the table, never a silent pass.
    laneProxyMode(proxy, '502-reset');
    expect(canary().body).toEqual({ ok: true, op: 'canary', result: 'failed', status: 502,
      reason: 'http 502: ccgpt-proxy: upstream unreachable: [Errno 104] Connection reset by peer' });
  });

  it("a refused connect on the shim's own port is not-ready", async () => {
    const dead = await freePort();
    plantLane(dead);
    expect(canary().body).toEqual({ ok: true, op: 'canary', result: 'not-ready', status: null,
      reason: `the lane's proxy on 127.0.0.1:${dead} refused the connection` });
  });

  it('a lane that never answers is not-ready at --timeout-s', () => {
    laneProxyMode(proxy, 'hang');
    const c = canary(['--timeout-s', '2']);
    expect(c.body).toEqual({ ok: true, op: 'canary', result: 'not-ready', status: null,
      reason: 'no text from the lane within 2s' });
    expect(c.ms).toBeGreaterThanOrEqual(1900);
    expect(c.ms).toBeLessThan(15_000);
  });

  it('a stalled lane probe is not-ready and says that the key was not sent', () => {
    laneProxyProbeMode(proxy, 'hang');
    const c = canary(['--timeout-s', '2']);
    expect(c.body).toEqual({ ok: true, op: 'canary', result: 'not-ready', status: null,
      reason: `the lane probe on 127.0.0.1:${proxy.port} did not answer within 2s, so the key was not sent` });
    expect(c.ms).toBeGreaterThanOrEqual(1900);
    expect(c.ms).toBeLessThan(15_000);
    expect(laneProxyRequests(proxy)).toEqual([]);
  });

  it('a 200 that streams only thinking past the deadline is not-ready (D22), and says the lane answered', () => {
    // Pinned as the spec decides it (§2.3 step 3: a canary that ends in its own
    // timeout means not ready); the reason keeps it apart from a silent lane.
    laneProxyMode(proxy, 'trickle');
    const c = canary(['--timeout-s', '2']);
    expect(c.body).toEqual({ ok: true, op: 'canary', result: 'not-ready', status: 200,
      reason: 'the lane answered 200 but sent no text within 2s' });
    expect(c.ms).toBeLessThan(15_000);
  });

  it('a 200 stream of more than 256 KiB with no text is failed at the read cap, well before the deadline', () => {
    laneProxyMode(proxy, 'flood');
    const c = canary(['--timeout-s', '10']);
    expect(c.body).toEqual({ ok: true, op: 'canary', result: 'failed', status: 200,
      reason: 'no-text: no text in the first 262144 bytes' });
    expect(c.ms).toBeLessThan(9_000);
  });

  it('counts a multibyte stream against the read cap by bytes, not UTF-16 units', () => {
    laneProxyMode(proxy, 'flood-utf8');
    const c = canary(['--timeout-s', '10']);
    expect(c.body).toEqual({ ok: true, op: 'canary', result: 'failed', status: 200,
      reason: 'no-text: no text in the first 262144 bytes' });
    expect(c.ms).toBeLessThan(9_000);
  });

  it('reasoning that exhausts max_tokens before any text is failed (no-text), never passed', () => {
    // Review Focus (false canary failures).
    laneProxyMode(proxy, 'thinking-only');
    expect(canary().body).toEqual({ ok: true, op: 'canary', result: 'failed', status: 200,
      reason: 'no-text: the stream ended (stop_reason max_tokens) before any text' });
  });

  it('a text delta that is only whitespace is not text', () => {
    laneProxyMode(proxy, 'blank-text');
    expect(canary().body).toMatchObject({ result: 'failed', reason: 'no-text: the stream ended (stop_reason end_turn) before any text' });
  });

  it('an error event in the stream is failed (stream-error)', () => {
    laneProxyMode(proxy, 'stream-error');
    expect(canary().body).toEqual({ ok: true, op: 'canary', result: 'failed', status: 200, reason: 'stream-error: overloaded_error' });
  });

  it('a 200 that is not a stream is failed (no-text)', () => {
    laneProxyMode(proxy, 'json-200');
    expect(canary().body).toMatchObject({ result: 'failed', reason: 'no-text: the answer was not a stream (application/json)' });
  });

  it('a 401 after the key was re-minted is failed, and the key it echoes back never leaves the process', () => {
    // Review Focus (false canary failures): a LiteLLM 401 names the key it received.
    laneProxyMode(proxy, '401-echo');
    const c = canary();
    expect(c.body).toMatchObject({ result: 'failed', status: 401 });
    expect(c.body['reason']).toBe(
      'http 401: Authentication Error, Invalid proxy server token passed. Received API Key = Bearer sk-<redacted>');
    expect(c.out).not.toContain(key.slice(3));
  });

  it('a proxy variable in the environment is ignored', async () => {
    // Review Focus (false canary failures): an environment proxy must not route the canary anywhere.
    const via = `http://127.0.0.1:${await freePort()}`;
    // NODE_NO_WARNINGS: a Node that knows NODE_USE_ENV_PROXY may print a notice about it on stderr, which is the
    // runtime's line, not the canary's.
    const c = canary([], { HTTP_PROXY: via, http_proxy: via, HTTPS_PROXY: via, https_proxy: via, ALL_PROXY: via,
      all_proxy: via, NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: '1' });
    expect(c.body['result']).toBe('passed');
    expect(laneProxyRequests(proxy)).toHaveLength(1);
  });

  it.each([
    ['an absent runtime.env', (): void => fs.rmSync(envPath()), 'runtime.env could not be read (ENOENT)'],
    ['a runtime.env with a second line', (): void => fs.writeFileSync(envPath(), `LITELLM_MASTER_KEY=${key}\nOTHER=1\n`),
      'runtime.env is not one LITELLM_MASTER_KEY line'],
    ['a runtime.env whose key is not 48 hex digits', (): void => fs.writeFileSync(envPath(), 'LITELLM_MASTER_KEY=sk-short\n'),
      'runtime.env is not one LITELLM_MASTER_KEY line'],
    ['a runtime.env over 256 bytes', (): void => fs.writeFileSync(envPath(), `LITELLM_MASTER_KEY=${key}${' '.repeat(300)}\n`),
      'runtime.env could not be read (ETOOBIG)'],
    ['an absent lane.json', (): void => fs.rmSync(lanePath()), 'lane.json could not be read (ENOENT)'],
    ['a lane.json that is not JSON', (): void => fs.writeFileSync(lanePath(), '{ not json'), 'lane.json could not be read (not JSON)'],
    ['a lane.json whose proxyPort is not a port', (): void => fs.writeFileSync(lanePath(),
      JSON.stringify({ id: 'lane-a', proxyPort: 70000 })), 'lane.json names no proxyPort from 1 to 65535'],
    ['a lane.json over 64 KiB', (): void => fs.writeFileSync(lanePath(),
      JSON.stringify({ id: 'lane-a', proxyPort: proxy.port, pad: 'x'.repeat(70_000) })), 'lane.json could not be read (ETOOBIG)'],
  ] as [string, () => void, string][])('%s is unavailable, and nothing is sent', (_w, spoil, reason) => {
    spoil();
    const c = canary();
    expect(c.code).toBe(0);
    expect(c.body).toEqual({ ok: true, op: 'canary', result: 'unavailable', status: null, reason });
    expect(laneProxyGets(proxy)).toEqual([]);
    expect(laneProxyRequests(proxy)).toEqual([]);
    expect(c.out).not.toContain(key.slice(3));
  });

  it('a FIFO at runtime.env is unavailable at once, never a block', () => {
    fs.rmSync(envPath());
    expect(spawnSync('mkfifo', [envPath()]).status, 'mkfifo is needed for this case').toBe(0);
    const c = canary();
    expect(c.body).toMatchObject({ result: 'unavailable', reason: 'runtime.env could not be read (ENOTREG)' });
    expect(c.ms).toBeLessThan(10_000);
    expect(laneProxyRequests(proxy)).toEqual([]);
  });

  it('a relative HOME is unavailable before a lane path is read', () => {
    const c = canary([], { HOME: 'relative-home' });
    expect(c.body).toEqual({ ok: true, op: 'canary', result: 'unavailable', status: null,
      reason: 'HOME is not an absolute path' });
    expect(laneProxyGets(proxy)).toEqual([]);
    expect(laneProxyRequests(proxy)).toEqual([]);
  });

  it.each([
    ['ok', null],
    ['open', 'EACCES'],
    ['fstat', 'EIO'],
    ['read', 'EIO'],
    ['type', 'ENOTREG'],
    ['initial-size', 'ETOOBIG'],
    ['growth', 'ETOOBIG'],
  ] as [ReadStage, string | null][])('closes the bounded descriptor on %s', (stage, code) => {
    const { canary: c, evidence } = readStage(stage);
    expect(evidence).toEqual({ opens: stage === 'open' ? 0 : 1, closes: stage === 'open' ? 0 : 1, stage });
    if (code === null) {
      expect(c.body['result']).toBe('passed');
      expect(laneProxyRequests(proxy)).toHaveLength(1);
      return;
    }
    expect(c.body).toEqual({ ok: true, op: 'canary', result: 'unavailable', status: null,
      reason: `lane.json could not be read (${code})` });
    expect(laneProxyGets(proxy)).toEqual([]);
    expect(laneProxyRequests(proxy)).toEqual([]);
  });

  it.each([
    ['an id that is not a lane id', ['--id', '../x']],
    ['a model that is not a model id', ['--model', 'not an id']],
    ['an effort longer than 64 characters', ['--effort', 'x'.repeat(65)]],
    ['an effort with a control character', ['--effort', 'lo\tw']],
    ['a deadline of 0', ['--timeout-s', '0']],
    ['an unknown key', ['--key', 'x']],
  ] as [string, string[]][])('%s is a usage error at exit 2, and nothing is sent', (_w, args) => {
    const c = canary(args);
    expect(c.code).toBe(2);
    expect(c.body).toMatchObject({ ok: false, error: 'bad-argv' });
    expect(laneProxyGets(proxy)).toEqual([]);
    expect(laneProxyRequests(proxy)).toEqual([]);
  });

  it('the key never leaves the process: no answer carries it, whatever the lane says', () => {
    const modes: LaneProxyMode[] = ['ok', '500', '401-echo', '502-reset', 'stream-error', 'thinking-only', 'json-200'];
    for (const mode of modes) {
      laneProxyMode(proxy, mode);
      expect(canary().out, mode).not.toContain(key.slice(3));
    }
    expect(laneProxyRequests(proxy).map((q) => q.authorization)).toEqual(modes.map(() => `Bearer ${key}`));
  });
});

describe('deploy/models-canary.mjs in source (plan W2 Task 10)', () => {
  // Read inside each case, so a missing file is that case's own red, not an
  // error while the describe is collected.
  const src = (): string => fs.readFileSync(CANARY, 'utf8');

  it('imports no child_process, writes no environment variable and logs nothing', () => {
    const s = src();
    // The IMPORT forms only: the file's own comments may say what it does not do.
    expect(s).not.toMatch(/\bfrom\s+['"](?:node:)?child_process['"]|\bimport\(\s*['"](?:node:)?child_process['"]|\brequire\(\s*['"](?:node:)?child_process['"]/);
    expect(s).not.toMatch(/process\.env(?:\.[A-Za-z_]\w*|\[[^\]]+\])\s*=(?!=)/);
    expect(s).not.toMatch(/\bconsole\./);
    expect(s).not.toMatch(/process\.stderr/);
    expect(s).toMatch(/new Agent\(/);
  });

  it('pins every request to the loopback host', () => {
    const calls = [...src().matchAll(/request\(\{([\s\S]*?)\n\s*\}\);/g)].map((m) => m[1]!);
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call).toContain("host: '127.0.0.1'");
  });

  it('reads each lane file through one bounded descriptor', () => {
    const reader = /function readSmall\(p, max\) \{([\s\S]*?)\n\}/.exec(src());
    expect(reader, 'the bounded lane-file reader is missing').not.toBeNull();
    expect(reader![1]).toContain('fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);');
    expect(reader![1]).toContain('const stat = fstatSync(fd);');
    expect(reader![1]).toContain('const bytes = Buffer.allocUnsafe(max + 1);');
    expect(reader![1]).toContain('readSync(fd, bytes, 0, bytes.length, 0);');
    expect(reader![1]).toContain('if (fd !== null) closeSync(fd);');
  });

  it("the D-4933 prefix is ccd/ccgpt-proxy.py's own text", () => {
    const m = /^const D4933_PREFIX = '([^']+)';$/m.exec(src());
    expect(m, 'the canary has no D4933_PREFIX constant').not.toBeNull();
    expect(m![1]).toBe(shimRefusedPrefix());
  });

  it("the default deadline is longer than the shim's 60 s refused-connect wait", () => {
    const m = /^const CANARY_TIMEOUT_S = (\d+);$/m.exec(src());
    expect(m, 'the canary has no CANARY_TIMEOUT_S constant').not.toBeNull();
    const shimS = Number(/^UPSTREAM_WAIT_DEFAULT_S = (\d+)$/m.exec(fs.readFileSync(SHIM_PY, 'utf8'))![1]);
    expect(shimS).toBe(60);
    expect(Number(m![1])).toBeGreaterThan(shimS);
  });
});

// codex-bridge-live-tools.test.ts — the first live step's tools: the bridge's recordings, the scrubber and the live
// probe, `ccd/codexbridge/record.py` and `liveprobe.py` (codex-bridge Stage 2 plan 2026-10-22, Task 18, and the
// operator runbook's step 2; spec 2026-10-15 §5 "the first live step", D27 "Send `originator: ccrc`").
//
// NO CASE REACHES A LIVE ENDPOINT. The upstream is `fakeResponses` and the token endpoint Stage 1's `fakeAuthServer`,
// both in-process on 127.0.0.1, reached through the two loopback overrides (CCGPT_BRIDGE_UPSTREAM_BASE,
// CCRC_CODEX_AUTH_BASE), and a case that needs neither leaves both at CLOSED_AUTH_BASE. Every process is spawned with
// an environment built from scratch and a mkTmp HOME; every token is a synthetic JWT built at runtime. The two CLIs
// run as files under `-I`, as the runbook runs them.
import { afterEach, describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pythonOrSkip } from './ccgptHarness.js';
import { mkTmp } from './tmpHelpers.js';
import {
  ACCOUNT_CLAIM, CLOSED_AUTH_BASE, FIXTURE_ACCOUNT_ID, fakeAuthServer, syntheticJwt,
} from './codexAuthFixture.js';
import {
  BRIDGE_AUTH_LIB, BRIDGE_DIR, BRIDGE_FILES, BRIDGE_MODELS, CCD_DIR, driverLines, fakeResponses, killBridges, plantBridgeLane,
  runBridgeDriver, spawnBridge, type BridgeLane, type SpawnedBridge,
} from './codexBridgeFixture.js';

const PY = pythonOrSkip();

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

afterEach(async () => { await killBridges(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const LANE = 'lane-a';
const MODEL = BRIDGE_MODELS[0];
const RECORD_PY = path.join(BRIDGE_DIR, 'record.py');
const LIVEPROBE_PY = path.join(BRIDGE_DIR, 'liveprobe.py');
/** A bridge recording's name (`<utc>-<n>.sse`), as the plan's Interfaces block gives it. */
const RECORDING_NAME = /^[0-9]{8}T[0-9]{6}Z-[0-9]+\.sse$/;

// ── the upstream's events ─────────────────────────────────────────────────────────────────────────────────────────
const ev = (type: string, o: Json = {}): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`;
const msgItem = (id: string, text: string): Json => ({
  type: 'message', id, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }],
});
const usage = (input = 100, output = 5, cached = 0): Json => ({
  input_tokens: input, output_tokens: output, input_tokens_details: { cached_tokens: cached },
});
const textReply = (text: string, n = 1): string => ev('response.created', { response: { id: `resp_fx${n}` } })
  + ev('response.output_item.done', { output_index: 0, item: msgItem(`msg_fx${n}`, text) })
  + ev('response.completed', { response: { id: `resp_fx${n}`, status: 'completed', usage: usage() } });
/** Step 2's answer: one reasoning item, then two parallel calls of the probe's tool. */
const twoCalls = (): string => ev('response.created', { response: { id: 'resp_fx2' } })
  + ev('response.output_item.done', { output_index: 0, item: { type: 'reasoning', id: 'rs_fx1', summary: [], encrypted_content: 'ENC-1' } })
  + ev('response.output_item.done', { output_index: 1, item: { type: 'function_call', id: 'fc_fx1', call_id: 'call_fx1', name: 'probe_echo', arguments: '{"word":"one"}', status: 'completed' } })
  + ev('response.output_item.done', { output_index: 2, item: { type: 'function_call', id: 'fc_fx2', call_id: 'call_fx2', name: 'probe_echo', arguments: '{"word":"two"}', status: 'completed' } })
  + ev('response.completed', { response: { id: 'resp_fx2', status: 'completed', usage: usage() } });

// ── processes ────────────────────────────────────────────────────────────────────────────────────────────────────
type Run = { status: number | null; stdout: string; stderr: string };

/** `python3 -I <script> <args>` in the fixture `home` (its cwd and HOME), asynchronously (a fake server runs on this
 *  event loop). The env is built from scratch: PATH, TMPDIR, the library's path, the caller's `env`, then the two
 *  endpoint variables (each CLOSED_AUTH_BASE unless `env` names a non-empty one), then HOME. */
function runCli(home: string, script: string, args: string[], env: Record<string, string> = {}): Promise<Run> {
  const named = (k: string): string => (env[k] ? env[k] : CLOSED_AUTH_BASE);
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: tmpdir(), CCRC_CODEX_AUTH_LIB: BRIDGE_AUTH_LIB, ...env,
    CCGPT_BRIDGE_UPSTREAM_BASE: named('CCGPT_BRIDGE_UPSTREAM_BASE'), CCRC_CODEX_AUTH_BASE: named('CCRC_CODEX_AUTH_BASE'),
    HOME: home,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(PY!, ['-I', script, ...args], { cwd: home, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
    child.once('close', (code) => { clearTimeout(timer); resolve({ status: code, stdout, stderr }); });
  });
}

const probe = (home: string, step: number, env: Record<string, string> = {}, extra: string[] = []): Promise<Run> =>
  runCli(home, LIVEPROBE_PY, ['--lane', LANE, '--step', String(step), ...extra], env);

/** One `/v1/messages` request to a running bridge; resolves with the status once the bridge closes the answer. */
function callBridge(b: SpawnedBridge, text: string): Promise<{ status: number; text: string }> {
  const body = Buffer.from(JSON.stringify({
    model: MODEL, max_tokens: 32000, stream: true,
    system: [{ type: 'text', text: 'You are a helper.' }],
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
  }));
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', port: b.port, path: '/v1/messages', method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': String(body.length), 'x-api-key': b.key },
    }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { out += c; });
      res.once('end', () => resolve({ status: res.statusCode ?? 0, text: out }));
      res.once('error', reject);
    });
    req.once('error', reject);
    req.end(body);
  });
}

const mode = (p: string): number => statSync(p).mode & 0o777;
const recordingsDir = (lane: BridgeLane): string => path.join(lane.laneDir, BRIDGE_FILES.recordings);
const touch = (p: string): void => writeFileSync(p, '');
/** Rewrite the lane's planted `lane.json` through `edit`. */
function editLaneJson(lane: BridgeLane, edit: (m: Json) => void): void {
  const file = path.join(lane.laneDir, 'lane.json');
  const m = JSON.parse(readFileSync(file, 'utf8')) as Json;
  edit(m);
  writeFileSync(file, JSON.stringify(m));
}
/** The text a bridge answer streamed: its text deltas joined, and whether it ended with message_stop. */
function streamedText(sse: string): { text: string; stopped: boolean; errored: boolean } {
  let text = '';
  let stopped = false;
  let errored = false;
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const d = JSON.parse(line.slice(6)) as Json;
    if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta') text += d.delta.text;
    if (d.type === 'message_stop') stopped = true;
    if (d.type === 'error') errored = true;
  }
  return { text, stopped, errored };
}
/** prlimit(1), which lowers a running process's file-size limit (util-linux; absent on macOS). */
const HAS_PRLIMIT = process.platform === 'linux' && spawnSync('prlimit', ['--version'], { stdio: 'ignore' }).status === 0;

/** A token endpoint's answer, which a refresh would take: only a case where the probe must NOT refresh scripts it. */
function issuedAnswer(): Json {
  const now = Math.floor(Date.now() / 1000);
  const claim = { [ACCOUNT_CLAIM]: { chatgpt_account_id: FIXTURE_ACCOUNT_ID } };
  return {
    access_token: syntheticJwt({ exp: now + 3600, iat: now, jti: randomBytes(8).toString('hex'), ...claim }),
    refresh_token: `rtok-fixture-issued-${randomBytes(16).toString('hex')}`,
    id_token: syntheticJwt({ exp: now + 3600, iat: now, ...claim }),
    token_type: 'Bearer', expires_in: 3600,
  };
}

// ── the bridge's recordings ──────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!PY)('recordings: the raw upstream bytes, only while record-streams exists (codex-bridge Task 18)', () => {
  it('recording stops after RECORD_MAX', async () => {
    const home = mkTmp('cb-live-rec-');
    const lane = plantBridgeLane(home, LANE);
    touch(path.join(lane.laneDir, 'record-streams'));
    const streams = [textReply('first', 1), textReply('second', 2), textReply('third', 3)];
    const up = await fakeResponses(streams.map((sse) => ({ status: 200, sse, headers: { 'x-request-id': 'req-fx1' } })));
    try {
      const b = await spawnBridge(home, LANE, {
        consts: { 'stats.FLUSH_S': 0, 'record.RECORD_MAX': 2 }, env: { CCGPT_BRIDGE_UPSTREAM_BASE: up.base },
      });
      for (const text of ['one', 'two', 'three']) {
        const a = await callBridge(b, text);
        expect(a.status, a.text).toBe(200);
      }
      await b.stop('SIGKILL');
      expect(up.requests).toHaveLength(3);
      const dir = recordingsDir(lane);
      expect(mode(dir)).toBe(0o700);
      const files = readdirSync(dir).sort();
      expect(files).toHaveLength(2);
      files.forEach((f, i) => {
        expect(f).toMatch(RECORDING_NAME);
        const p = path.join(dir, f);
        expect(mode(p)).toBe(0o600);
        const raw = readFileSync(p, 'utf8');
        expect(raw.startsWith('HTTP/1.1 200\n')).toBe(true);
        expect(raw).toContain('\nx-request-id: req-fx1\n');
        // the head, a blank line, then the body exactly as the upstream sent it
        expect(raw.slice(raw.indexOf('\n\n') + 2)).toBe(streams[i]);
      });
    } finally {
      await up.close();
    }
  });

  it('no recording without the record-streams marker', async () => {
    const home = mkTmp('cb-live-norec-');
    const lane = plantBridgeLane(home, LANE);
    const up = await fakeResponses([{ status: 200, sse: textReply('only') }]);
    try {
      const b = await spawnBridge(home, LANE, { consts: { 'stats.FLUSH_S': 0 }, env: { CCGPT_BRIDGE_UPSTREAM_BASE: up.base } });
      const a = await callBridge(b, 'one');
      expect(a.status, a.text).toBe(200);
      await b.stop('SIGKILL');
      expect(up.requests).toHaveLength(1);
      expect(existsSync(recordingsDir(lane))).toBe(false);
    } finally {
      await up.close();
    }
  });

  it('a recordings path that is a regular file is never recorded into, and the stream is whole', async () => {
    const home = mkTmp('cb-live-rec-file-');
    const lane = plantBridgeLane(home, LANE);
    touch(path.join(lane.laneDir, 'record-streams'));
    const planted = recordingsDir(lane);
    writeFileSync(planted, 'planted\n', { mode: 0o600 });
    chmodSync(planted, 0o600);
    const up = await fakeResponses([{ status: 200, sse: textReply('whole reply') }]);
    try {
      const b = await spawnBridge(home, LANE, { consts: { 'stats.FLUSH_S': 0 }, env: { CCGPT_BRIDGE_UPSTREAM_BASE: up.base } });
      const a = await callBridge(b, 'one');
      expect(a.status, a.text).toBe(200);
      expect(streamedText(a.text)).toEqual({ text: 'whole reply', stopped: true, errored: false });
      await b.stop('SIGKILL');
      expect(readFileSync(planted, 'utf8')).toBe('planted\n');
      expect(mode(planted), 'the planted file keeps its mode').toBe(0o600);
    } finally {
      await up.close();
    }
  });

  it('a recordings path that is a symlink is never followed, and the stream is whole', async () => {
    const home = mkTmp('cb-live-rec-link-');
    const lane = plantBridgeLane(home, LANE);
    touch(path.join(lane.laneDir, 'record-streams'));
    const outside = path.join(home, 'outside');
    mkdirSync(outside, { mode: 0o755 });
    chmodSync(outside, 0o755);
    symlinkSync(outside, recordingsDir(lane));
    const up = await fakeResponses([{ status: 200, sse: textReply('whole reply') }]);
    try {
      const b = await spawnBridge(home, LANE, { consts: { 'stats.FLUSH_S': 0 }, env: { CCGPT_BRIDGE_UPSTREAM_BASE: up.base } });
      const a = await callBridge(b, 'one');
      expect(a.status, a.text).toBe(200);
      expect(streamedText(a.text)).toEqual({ text: 'whole reply', stopped: true, errored: false });
      await b.stop('SIGKILL');
      expect(readdirSync(outside), 'nothing is written through the link').toEqual([]);
      expect(mode(outside), 'the link target keeps its mode').toBe(0o755);
    } finally {
      await up.close();
    }
  });

  it.skipIf(!HAS_PRLIMIT)('a recording whose writes fail mid-stream is dropped, and the stream is whole', async () => {
    const home = mkTmp('cb-live-rec-full-');
    const lane = plantBridgeLane(home, LANE);
    touch(path.join(lane.laneDir, 'record-streams'));
    const big = 'w'.repeat(200_000);
    const up = await fakeResponses([{ status: 200, sse: textReply(big) }]);
    try {
      const b = await spawnBridge(home, LANE, { consts: { 'stats.FLUSH_S': 0 }, env: { CCGPT_BRIDGE_UPSTREAM_BASE: up.base } });
      // every file this process grows past 64 KiB now fails with EFBIG (Python ignores SIGXFSZ): the recording does
      const limit = 65536;
      const pl = spawnSync('prlimit', ['--pid', String(b.proc.pid), `--fsize=${limit}`], { encoding: 'utf8' });
      expect(pl.status, pl.stderr).toBe(0);
      const a = await callBridge(b, 'one');
      expect(a.status, a.text).toBe(200);
      const got = streamedText(a.text);
      expect(got.errored, 'the stream carries no error event').toBe(false);
      expect(got.stopped, 'the stream ends with message_stop').toBe(true);
      expect(got.text.length).toBe(big.length);
      await b.stop('SIGKILL');
      const files = readdirSync(recordingsDir(lane));
      expect(files).toHaveLength(1);
      const p = path.join(recordingsDir(lane), files[0]);
      expect(statSync(p).size, 'the recording stopped at the limit').toBe(limit);
      expect(readFileSync(p, 'utf8').startsWith('HTTP/1.1 200\n')).toBe(true);
    } finally {
      await up.close();
    }
  });

  it('a recording that raises when it starts is dropped, logged by its class, and the stream is whole', async () => {
    const home = mkTmp('cb-live-rec-raise-');
    const lane = plantBridgeLane(home, LANE);
    touch(path.join(lane.laneDir, 'record-streams'));
    const up = await fakeResponses([{ status: 200, sse: textReply('whole reply') }]);
    try {
      // a RECORD_MAX that is not a number: `start`'s cap comparison raises TypeError, inside the bridge's hook
      const b = await spawnBridge(home, LANE, {
        consts: { 'stats.FLUSH_S': 0, 'record.RECORD_MAX': 'not-a-number' }, env: { CCGPT_BRIDGE_UPSTREAM_BASE: up.base },
      });
      const a = await callBridge(b, 'one');
      expect(a.status, a.text).toBe(200);
      expect(streamedText(a.text)).toEqual({ text: 'whole reply', stopped: true, errored: false });
      await b.stop('SIGKILL');
      expect(b.stderr()).toContain('TypeError');
      expect(b.stderr()).not.toContain('Traceback');
      expect(b.stderr()).not.toContain('not-a-number');
      expect(readdirSync(recordingsDir(lane))).toEqual([]);
    } finally {
      await up.close();
    }
  });

  it("the bridge's start refuses a lane.json whose bridgeFiles names no recordings directory", async () => {
    const home = mkTmp('cb-live-rec-nokey-');
    const lane = plantBridgeLane(home, LANE);
    editLaneJson(lane, (m) => { delete m.bridgeFiles.recordings; });
    const err = await spawnBridge(home, LANE, { consts: { 'stats.FLUSH_S': 0 } }).then(() => null, (e: Error) => e);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/: ccgpt-proxy: direct: lane\.json's bridgeFiles\.recordings is not a file name\n?$/);
    expect(err!.message).not.toContain('Traceback');
  });
});

// ── the scrubber ─────────────────────────────────────────────────────────────────────────────────────────────────
/** A recording as the bridge writes one (head, blank line, body), holding every kind of thing the scrubber removes:
 *  long ids, encrypted reasoning, texts, a path in a call's arguments, a model id, a header value. Each original
 *  string is returned so a case can look for it. */
function rawRecording(): { bytes: string; originals: string[] } {
  const hex = (n: number): string => randomBytes(n).toString('hex');
  const ids = {
    resp: `resp_${hex(12)}`, msg: `msg_${hex(12)}`, rs: `rs_${hex(12)}`, fc: `fc_${hex(12)}`, call: `call_${hex(12)}`,
  };
  const enc = `gAAAAAB${hex(24)}`;
  const texts = { live: 'Sentinel reply', tail: ' with words 42', summary: 'Sentinel summary text', model: 'secretmodel-9.9-sentinel' };
  const path0 = '/srv/sentinelpath/notes.txt';
  const args = JSON.stringify({ file_path: path0, limit: 20 });
  const full = texts.live + texts.tail;
  const body = ev('response.created', { response: { id: ids.resp, status: 'in_progress', model: texts.model, output: [] }, sequence_number: 0 })
    + ev('response.output_item.done', { output_index: 0, item: { type: 'reasoning', id: ids.rs, summary: [{ type: 'summary_text', text: texts.summary }], encrypted_content: enc } })
    + ev('response.output_item.added', { output_index: 1, item: { type: 'message', id: ids.msg, role: 'assistant', status: 'in_progress', content: [] } })
    + ev('response.output_text.delta', { item_id: ids.msg, output_index: 1, content_index: 0, delta: texts.live })
    + ': a keepalive comment holding sentinelcomment\n\n'
    + ev('response.output_text.delta', { item_id: ids.msg, output_index: 1, content_index: 0, delta: texts.tail })
    + ev('response.output_item.done', { output_index: 1, item: msgItem(ids.msg, full) })
    + ev('response.output_item.done', { output_index: 2, item: { type: 'function_call', id: ids.fc, call_id: ids.call, name: 'Read', arguments: args, status: 'completed' } })
    + ev('response.completed', { response: { id: ids.resp, status: 'completed', model: texts.model, usage: usage(120, 9, 20) } });
  const head = 'HTTP/1.1 200\ncontent-type: text/event-stream\nx-request-id: req-sentinelheader\nset-cookie: sentinelcookie=1\n\n';
  return {
    bytes: head + body,
    originals: [...Object.values(ids), enc, texts.live, texts.tail.trim(), texts.summary, texts.model, path0,
      'sentinelpath', 'Sentinel', 'sentinelheader', 'sentinelcookie', 'sentinelcomment'],
  };
}

describe.skipIf(!PY)('the scrubber: a recording becomes a corpus stream (codex-bridge Task 18)', () => {
  it('the scrubber leaves no id, encrypted content or text of the original', async () => {
    const home = mkTmp('cb-live-scrub-');
    const rec = rawRecording();
    const inFile = path.join(home, 'in.sse');
    const outFile = path.join(home, 'out.sse');
    writeFileSync(inFile, rec.bytes);
    const r = await runCli(home, RECORD_PY, ['scrub', inFile, outFile]);
    expect(r.status, r.stderr).toBe(0);
    const out = readFileSync(outFile, 'utf8');
    for (const s of rec.originals) expect(out, `the output still holds ${s}`).not.toContain(s);
    // every line is an event or a data line, or the blank line between two events: the head is gone
    for (const line of out.split('\n')) expect(line === '' || line.startsWith('event: ') || line.startsWith('data: '), line).toBe(true);
    // the replacements, one per distinct original, so an item's id and its deltas' item_id still agree
    expect(out).toContain('"id":"resp_fx1"');
    expect(out).toContain('"id":"rs_fx1"');
    expect(out).toContain('"encrypted_content":"ENC-1"');
    expect(out).toContain('"call_id":"call_fx1"');
    expect(out.match(/"item_id":"msg_fx1"/g)).toHaveLength(2);
    // a text keeps its structure: each letter or digit is x, the rest is kept
    expect(out).toContain('"delta":"xxxxxxxx xxxxx"');
    expect(out).toContain('"delta":" xxxx xxxxx xx"');
    // a call's arguments keep their keys and numbers
    expect(out).toContain(JSON.stringify(JSON.stringify({ file_path: '/xxx/xxxxxxxxxxxx/xxxxx.xxx', limit: 20 })));
    expect(existsSync(path.join(BRIDGE_DIR, '__pycache__')), 'a __pycache__ in ccd/codexbridge').toBe(false);
  });

  // A field the scrubber does not know keeps its value, so each value below survives the rewrite, and the residue
  // check refuses it by the one pattern it matches. Each value is fixed (never random), so no other pattern can match
  // it by chance: the JWT is built from fixed segments.
  const b64 = (o: object | string): string => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const FIXED_JWT = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'fixture', exp: 1 })}.${b64('fixture-signature')}`;
  for (const [pattern, value] of [
    ['jwt', FIXED_JWT],
    ['id', 'see rs_ab12cd34ef for the item'],
    ['key', `sk-${'A1'.repeat(12)}`],
  ] as const) {
    it(`the scrubber refuses an output that still matches ${pattern}`, async () => {
      const home = mkTmp('cb-live-scrub-refuse-');
      const inFile = path.join(home, 'in.sse');
      const outFile = path.join(home, 'out.sse');
      writeFileSync(inFile, textReply('fine') + ev('response.note', { trace_blob: value }));
      const r = await runCli(home, RECORD_PY, ['scrub', inFile, outFile]);
      expect(r.status).toBe(1);
      expect(r.stderr).toBe(`record: refused: the output still matches ${pattern}; nothing written\n`);
      expect(r.stderr).not.toContain(value);
      expect(existsSync(outFile), 'a refused scrub writes nothing').toBe(false);
    });
  }

  it('the residue check names each pattern it matches, the two defence-in-depth patterns included', () => {
    // encrypted-content and header-line are defence in depth (record.py's SCRUB_PATTERNS comment): asked directly
    const inputs: Array<[string, string]> = [
      ['id', 'data: {"note":"see rs_ab12cd34ef"}\n'],
      ['jwt', `data: {"note":"${FIXED_JWT}"}\n`],
      ['encrypted-content', 'data: {"encrypted_content":"gAAAAB-not-replaced"}\n'],
      ['key', `data: {"note":"sk-${'A1'.repeat(12)}"}\n`],
      ['header-line', 'event: response.created\nset-cookie: fixture=1\n'],
      ['none', 'event: response.created\ndata: {"id":"rs_fx1","encrypted_content":"ENC-1"}\n'],
    ];
    const script = [
      'import json, sys',
      'sys.dont_write_bytecode = True',
      'sys.path.insert(0, sys.argv[1])',
      'from codexbridge import record',
      'print(json.dumps([record.residue(s.encode("utf-8")) for s in json.loads(sys.argv[2])]))',
    ].join('\n');
    const r = spawnSync(PY!, ['-I', '-c', script, CCD_DIR, JSON.stringify(inputs.map(([, s]) => s))], {
      encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(inputs.map(([name]) => (name === 'none' ? [] : [name])));
  });

  it('a text that has the shape of an id is rewritten as a text, so its deltas still join to its done text', async () => {
    const home = mkTmp('cb-live-scrub-idtext-');
    const inFile = path.join(home, 'in.sse');
    const outFile = path.join(home, 'out.sse');
    writeFileSync(inFile, ev('response.output_text.delta', { item_id: 'msg_fx1', output_index: 0, content_index: 0, delta: 'ab_12345678' })
      + ev('response.output_text.delta', { item_id: 'msg_fx1', output_index: 0, content_index: 0, delta: ' ok' })
      + ev('response.output_item.done', { output_index: 0, item: msgItem('msg_fx1', 'ab_12345678 ok') }));
    const r = await runCli(home, RECORD_PY, ['scrub', inFile, outFile]);
    expect(r.status, r.stderr).toBe(0);
    const out = readFileSync(outFile, 'utf8');
    expect(out).toContain('"delta":"xx_xxxxxxxx"');
    expect(out).toContain('"text":"xx_xxxxxxxx xx"');
  });

  it("the scrubber's output is a corpus stream: the replay suite's reader parses it", async () => {
    const home = mkTmp('cb-live-scrub-corpus-');
    const inFile = path.join(home, 'in.sse');
    const outFile = path.join(home, 'out.sse');
    writeFileSync(inFile, rawRecording().bytes);
    const r = await runCli(home, RECORD_PY, ['scrub', inFile, outFile]);
    expect(r.status, r.stderr).toBe(0);
    // the reader codex-bridge-replay.test.ts uses: the driver's reduce op, one SseParser and one Reducer
    const d = await runBridgeDriver(home, { ops: [{ op: 'reduce', stream: outFile, chunk: 13 }] });
    const [line] = driverLines(d.stdout);
    expect(line.raised, d.stderr).toBeUndefined();
    expect(line.warnings).toEqual([]);
    expect(line.terminal.kind).toBe('completed');
    expect(line.terminal.stop).toBe('tool_use');
    expect(line.terminal.usage).toEqual({ input: 120, cached: 20, cacheWrite: 0, output: 9 });
    expect(line.counted.counts).toEqual({});
    const starts = (line.events as Array<[string, Json]>).filter(([n]) => n === 'content_block_start').map(([, d0]) => d0.content_block);
    expect(starts.map((b: Json) => b.type)).toEqual(['text', 'tool_use']);
    expect(starts[1].id).toBe('call_fx1');
    expect(line.emittedText).toEqual({ 1: 'xxxxxxxx xxxxx xxxx xxxxx xx' });
    expect(line.reasoning).toEqual([{ id: 'rs_fx1', key: ['text', 'xxxxxxxx xxxxx xxxx xxxxx xx'] }]);
    // every event in make_streams.py's own frame: `event: <name>\ndata: <compact json>\n\n`
    const text = readFileSync(outFile, 'utf8');
    for (const block of text.split('\n\n').filter(Boolean)) expect(block).toMatch(/^event: [a-z_.]+\ndata: \{.*\}$/);
  });
});

/** A fixed base64url segment of `s`, for a token-shaped fixture value. */
const b64token = (s: string): string => Buffer.from(`{"fixture":"${s}"}`).toString('base64url');

// ── the live probe ───────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!PY)('the live probe: the first live step, bounded (codex-bridge Task 18, runbook step 2)', () => {
  it('the live probe refuses without the marker, past six requests, and on an expired token', async () => {
    // without the marker: nothing is read or sent
    const home = mkTmp('cb-live-probe-refuse-');
    const lane = plantBridgeLane(home, LANE);
    const up = await fakeResponses([{ status: 200, sse: textReply('ok') }, { status: 200, sse: textReply('ok') }]);
    try {
      const env = { CCGPT_BRIDGE_UPSTREAM_BASE: up.base };
      const none = await probe(home, 1, env);
      expect(none.status).toBe(1);
      expect(none.stderr).toMatch(/^liveprobe: refused no-marker: /);
      expect(up.requests).toHaveLength(0);
      // the sixth request is sent and counted; the seventh is refused before anything is sent
      touch(path.join(lane.laneDir, 'liveprobe-allowed'));
      writeFileSync(path.join(lane.laneDir, 'liveprobe.count'), '5\n');
      const sixth = await probe(home, 1, env);
      expect(sixth.status, sixth.stderr).toBe(0);
      expect(up.requests).toHaveLength(1);
      expect(readFileSync(path.join(lane.laneDir, 'liveprobe.count'), 'utf8')).toBe('6\n');
      const seventh = await probe(home, 1, env);
      expect(seventh.status).toBe(1);
      expect(seventh.stderr).toMatch(/^liveprobe: refused count-exhausted: /);
      expect(up.requests).toHaveLength(1);
    } finally {
      await up.close();
    }
    // an expired token: refused, never refreshed, though the token endpoint would answer
    const home2 = mkTmp('cb-live-probe-expired-');
    const lane2 = plantBridgeLane(home2, LANE, { credential: { expiresIn: -3600 } });
    touch(path.join(lane2.laneDir, 'liveprobe-allowed'));
    const up2 = await fakeResponses([{ status: 200, sse: textReply('ok') }]);
    const auth = await fakeAuthServer({ token: [{ status: 200, body: issuedAnswer() }] });
    try {
      const r = await probe(home2, 1, { CCGPT_BRIDGE_UPSTREAM_BASE: up2.base, CCRC_CODEX_AUTH_BASE: auth.base });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/^liveprobe: refused token-expired: /);
      expect(up2.requests).toHaveLength(0);
      expect(auth.requests).toHaveLength(0);
      expect(readFileSync(path.join(lane2.authDir, 'auth.json'), 'utf8')).toContain(lane2.cred!.access);
      expect(existsSync(path.join(lane2.laneDir, 'liveprobe.count')), 'a refused probe counts nothing').toBe(false);
    } finally {
      await up2.close();
      await auth.close();
    }
  });

  it('the live probe never sends instructions and sends originator ccrc', async () => {
    const home = mkTmp('cb-live-probe-wire-');
    const lane = plantBridgeLane(home, LANE);
    touch(path.join(lane.laneDir, 'liveprobe-allowed'));
    // the lane's instructions marker is set, and still no request carries `instructions`
    touch(path.join(lane.laneDir, 'bridge-instructions'));
    const up = await fakeResponses([
      { status: 200, sse: textReply('ok', 1) }, { status: 200, sse: twoCalls() }, { status: 200, sse: textReply('done', 3) },
      { status: 200, sse: textReply('ok', 4) }, { status: 200, sse: textReply('ok', 5) }, { status: 200, sse: textReply('done', 6) },
    ]);
    try {
      const env = { CCGPT_BRIDGE_UPSTREAM_BASE: up.base };
      for (const step of [1, 2, 3, 4, 5, 6]) {
        const r = await probe(home, step, env);
        expect(r.status, `step ${step}: ${r.stderr}`).toBe(0);
      }
      expect(up.requests).toHaveLength(6);
      for (const req of up.requests) {
        expect(req.body, 'a JSON body').not.toBeNull();
        expect(Object.keys(req.body!)).not.toContain('instructions');
        expect(req.values.originator).toBe('ccrc');
        expect(req.values['user-agent']).toMatch(/^ccrc\//);
        expect(req.body!.model).toBe(MODEL);
        expect(req.body!.store).toBe(false);
        expect(req.body!.input[0]).toEqual({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: expect.any(String) }] });
      }
      const [s1, s2, s3, s4, s5, s6] = up.requests.map((q) => q.body!);
      // step 2: two parallel calls, tools at the top level
      expect(s2.parallel_tool_calls).toBe(true);
      expect(s2.tools.map((t: Json) => t.name)).toEqual(['probe_echo']);
      // step 3: step 2's round trip, its calls under toolu_-shaped ids, its reasoning item replayed with its id
      const types3 = s3.input.map((i: Json) => i.type);
      expect(types3).toEqual(['message', 'message', 'reasoning', 'function_call', 'function_call', 'function_call_output', 'function_call_output']);
      expect(s3.input[2]).toEqual({ type: 'reasoning', id: 'rs_fx1', summary: [], encrypted_content: 'ENC-1' });
      const calls = s3.input.filter((i: Json) => i.type === 'function_call');
      for (const c of calls) expect(c.call_id).toMatch(/^toolu_01[0-9a-f]{22}$/);
      expect(calls.map((c: Json) => c.arguments)).toEqual(['{"word":"one"}', '{"word":"two"}']);
      expect(s3.input.filter((i: Json) => i.type === 'function_call_output').map((o: Json) => o.call_id)).toEqual(calls.map((c: Json) => c.call_id));
      // step 6: the same round trip, the reasoning item without its rs_ id
      expect(s6.input.map((i: Json) => i.type)).toEqual(types3);
      expect(s6.input[2]).toEqual({ type: 'reasoning', summary: [], encrypted_content: 'ENC-1' });
      // step 4: the last item is a developer message after the user message
      expect(s4.input.map((i: Json) => [i.type, i.role])).toEqual([['message', 'developer'], ['message', 'user'], ['message', 'developer']]);
      // step 5: step 1 again, with the same session-id and prompt_cache_key
      expect(s5).toEqual(s1);
      expect(up.requests[4].values['session-id']).toBe(up.requests[0].values['session-id']);
      expect(s5.prompt_cache_key).toBe(`ccrc:${up.requests[0].values['session-id']}`);
      expect(readFileSync(path.join(lane.laneDir, 'liveprobe.count'), 'utf8')).toBe('6\n');
    } finally {
      await up.close();
    }
  });

  it('the live probe prints no body text', async () => {
    const home = mkTmp('cb-live-probe-print-');
    const lane = plantBridgeLane(home, LANE);
    touch(path.join(lane.laneDir, 'liveprobe-allowed'));
    const secret = `Sentinelreply${randomBytes(6).toString('hex')}`;
    const enc = `ENCSENTINEL${randomBytes(6).toString('hex')}`;
    const sse = ev('response.created', { response: { id: 'resp_fx1' } })
      + ev('response.output_item.done', { output_index: 0, item: { type: 'reasoning', id: 'rs_fx1', summary: [], encrypted_content: enc } })
      + ev('response.output_text.delta', { item_id: 'msg_fx1', output_index: 1, content_index: 0, delta: secret })
      + ev('response.output_item.done', { output_index: 1, item: msgItem('msg_fx1', secret) })
      + ev('response.completed', { response: { id: 'resp_fx1', status: 'completed', end_turn: true, usage: { ...usage(120, 7, 20), output_tokens_details: { reasoning_tokens: 3 } } } });
    const up = await fakeResponses([{ status: 200, sse, headers: { 'x-request-id': 'req-fx9', 'x-codex-primary-used-percent': 'SENTINELHEADER' } }]);
    try {
      const r = await probe(home, 1, { CCGPT_BRIDGE_UPSTREAM_BASE: up.base });
      expect(r.status, r.stderr).toBe(0);
      const all = r.stdout + r.stderr;
      for (const s of [secret, enc, 'SENTINELHEADER', 'resp_fx1', 'msg_fx1', 'rs_fx1']) expect(all, s).not.toContain(s);
      // only the grammar the plan names: status, request id, header names, event and item types, end_turn, usage
      for (const line of r.stdout.split('\n').filter(Boolean)) {
        expect(line).toMatch(/^liveprobe: (status [0-9]{3}|request-id \S+|header [a-z0-9-]+|event [a-z_.]+|item [a-z_]+|end_turn (true|false|absent)|usage [a-z_.]+ [0-9]+)$/);
      }
      expect(r.stdout).toContain('liveprobe: status 200\n');
      expect(r.stdout).toContain('liveprobe: request-id req-fx9\n');
      expect(r.stdout).toContain('liveprobe: header x-codex-primary-used-percent\n');
      expect(r.stdout).toContain('liveprobe: item reasoning\n');
      expect(r.stdout).toContain('liveprobe: end_turn true\n');
      expect(r.stdout).toContain('liveprobe: usage input_tokens_details.cached_tokens 20\n');
      expect(r.stdout).toContain('liveprobe: usage output_tokens_details.reasoning_tokens 3\n');
      // the raw stream is in the recordings directory, 0600, for the operator to scrub
      const dir = recordingsDir(lane);
      const files = readdirSync(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^liveprobe-1-[0-9]{8}T[0-9]{6}Z-1\.sse$/);
      expect(mode(path.join(dir, files[0]))).toBe(0o600);
      expect(readFileSync(path.join(dir, files[0]), 'utf8').endsWith(sse)).toBe(true);
    } finally {
      await up.close();
    }
  });

  for (const [what, edit] of [
    ['names no recordings directory', (m: Json) => { delete m.bridgeFiles.recordings; }],
    ['names a recordings directory outside the lane', (m: Json) => { m.bridgeFiles.recordings = '../x'; }],
  ] as const) {
    it(`the live probe refuses a lane.json that ${what}`, async () => {
      const home = mkTmp('cb-live-probe-manifest-');
      const lane = plantBridgeLane(home, LANE);
      touch(path.join(lane.laneDir, 'liveprobe-allowed'));
      editLaneJson(lane, edit);
      const up = await fakeResponses([{ status: 200, sse: textReply('ok') }]);
      try {
        const r = await probe(home, 1, { CCGPT_BRIDGE_UPSTREAM_BASE: up.base });
        expect(r.status).toBe(1);
        expect(r.stderr).toBe("liveprobe: refused lane-malformed: the lane's lane.json is out of shape at "
          + "bridgeFiles.recordings; run 'ccrc update'\n");
        expect(up.requests).toHaveLength(0);
        expect(existsSync(path.join(lane.laneDir, 'liveprobe.count')), 'a refused probe counts nothing').toBe(false);
        expect(existsSync(path.join(lane.laneDir, '..', 'x')), 'nothing is made outside the lane').toBe(false);
      } finally {
        await up.close();
      }
    });
  }

  it('a request that is never answered still counts', async () => {
    const home = mkTmp('cb-live-probe-unanswered-');
    const lane = plantBridgeLane(home, LANE);
    touch(path.join(lane.laneDir, 'liveprobe-allowed'));
    // no upstream: CCGPT_BRIDGE_UPSTREAM_BASE is CLOSED_AUTH_BASE, a loopback port nothing listens on
    const r = await probe(home, 1);
    expect(r.status, r.stderr).toBe(3);
    expect(r.stdout).toBe('liveprobe: transport ConnectionRefusedError\n');
    expect(readFileSync(path.join(lane.laneDir, 'liveprobe.count'), 'utf8')).toBe('1\n');
  });

  it('a count that cannot be raised sends nothing, and the failure is named by its class', async () => {
    const home = mkTmp('cb-live-probe-nocount-');
    const lane = plantBridgeLane(home, LANE);
    touch(path.join(lane.laneDir, 'liveprobe-allowed'));
    // the count's temporary file is a directory, so write_count's open raises IsADirectoryError
    mkdirSync(path.join(lane.laneDir, 'liveprobe.count.tmp'));
    const up = await fakeResponses([{ status: 200, sse: textReply('ok') }]);
    try {
      const r = await probe(home, 1, { CCGPT_BRIDGE_UPSTREAM_BASE: up.base });
      expect(r.status).toBe(1);
      expect(r.stderr).toBe('liveprobe: failed IsADirectoryError; nothing was sent\n');
      expect(r.stdout).toBe('');
      expect(up.requests).toHaveLength(0);
      expect(existsSync(path.join(lane.laneDir, 'liveprobe.count'))).toBe(false);
    } finally {
      await up.close();
    }
  });

  it('a credential http.client refuses as a header is never printed', async () => {
    const home = mkTmp('cb-live-probe-header-');
    // a token with a line break: Stage 1's read takes any non-empty string, and the stored expires_at is in the future
    const head = `${b64token('head')}.${b64token('fixture')}`;
    const tail = `${b64token('tail')}SENTINELTAIL`;
    const token = `${head}\n${tail}`;
    const lane = plantBridgeLane(home, LANE, { credential: { extra: { access_token: token } } });
    touch(path.join(lane.laneDir, 'liveprobe-allowed'));
    const up = await fakeResponses([{ status: 200, sse: textReply('ok') }]);
    try {
      const r = await probe(home, 1, { CCGPT_BRIDGE_UPSTREAM_BASE: up.base });
      expect(r.status, r.stderr).toBe(3);
      expect(r.stdout).toBe('liveprobe: transport ValueError\n');
      const all = r.stdout + r.stderr;
      for (const s of [head, tail, 'SENTINELTAIL', 'Bearer']) expect(all, s).not.toContain(s);
      expect(up.requests).toHaveLength(0);
    } finally {
      await up.close();
    }
  });

  /** `liveprobe.main` for step 1 in the fixture `home`, imported directly with `backend.post` replaced by one that
   *  sends nothing and answers 200 with `x-request-id: req-fx1` and the body `mode` names: `raise-mid-stream` yields a
   *  completed event and then raises, `raise-head` streams a completed event but has `record.head` raise. Both
   *  raise a ValueError carrying SENTINEL. The script's last stderr line is `driver rc=<n> closed=<0|1>`, written
   *  only when main returns. */
  const SENTINEL = 'SENTINELRAISED';
  function probeFaked(home: string, mode: 'raise-mid-stream' | 'raise-head'): Run {
    const completed = ev('response.completed', { response: { status: 'completed', end_turn: true, usage: { input_tokens: 1 } } });
    const script = [
      'import json, sys',
      'sys.dont_write_bytecode = True',
      'sys.path.insert(0, sys.argv[1])',
      'from codexbridge import backend, liveprobe, record',
      'mode, completed, sentinel, lane = sys.argv[2], sys.argv[3].encode("utf-8"), sys.argv[4], sys.argv[5]',
      'closed = []',
      'def chunks():',
      '    yield completed',
      '    if mode == "raise-mid-stream":',
      '        raise ValueError(sentinel)',
      'def fake_post(base, body, headers, **kw):',
      '    return backend.Upstream(200, {"x-request-id": "req-fx1"}, chunks(), lambda: closed.append(1))',
      'backend.post = fake_post',
      'if mode == "raise-head":',
      '    def bad_head(status, headers):',
      '        raise ValueError(sentinel)',
      '    record.head = bad_head',
      'rc = liveprobe.main(["--lane", lane, "--step", "1"])',
      'sys.stdout.flush()',
      'sys.stderr.write("driver rc=%d closed=%d\\n" % (rc, 1 if closed else 0))',
    ].join('\n');
    const r = spawnSync(PY!, ['-I', '-c', script, CCD_DIR, mode, completed, SENTINEL, LANE], {
      cwd: home, encoding: 'utf8', timeout: 15_000,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: tmpdir(), CCRC_CODEX_AUTH_LIB: BRIDGE_AUTH_LIB,
        CCGPT_BRIDGE_UPSTREAM_BASE: CLOSED_AUTH_BASE, CCRC_CODEX_AUTH_BASE: CLOSED_AUTH_BASE, HOME: home,
      },
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  it("a failure inside the answer's stream is named by its class, and what came before it is still reported", () => {
    const home = mkTmp('cb-live-probe-midstream-');
    const lane = plantBridgeLane(home, LANE);
    touch(path.join(lane.laneDir, 'liveprobe-allowed'));
    const r = probeFaked(home, 'raise-mid-stream');
    expect(r.status, r.stderr).toBe(0);
    // report()'s own catch: the terminal seen before the failure is still reported after the transport line
    expect(r.stdout).toBe(['status 200', 'request-id req-fx1', 'header x-request-id', 'event response.completed',
      'transport ValueError', 'end_turn true', 'usage input_tokens 1'].map((l) => `liveprobe: ${l}\n`).join(''));
    expect(r.stderr).toBe('driver rc=3 closed=1\n');
    expect(r.stdout + r.stderr).not.toContain(SENTINEL);
    expect(readFileSync(path.join(lane.laneDir, 'liveprobe.count'), 'utf8')).toBe('1\n');
  });

  it('a failure while the answer is being recorded is named by its class, and the answer is closed', () => {
    const home = mkTmp('cb-live-probe-recfail-');
    const lane = plantBridgeLane(home, LANE);
    touch(path.join(lane.laneDir, 'liveprobe-allowed'));
    const r = probeFaked(home, 'raise-head');
    expect(r.status, r.stderr).toBe(0);
    // main's catch around the recording and report block
    expect(r.stdout).toBe('liveprobe: transport ValueError\n');
    expect(r.stderr).toBe('driver rc=3 closed=1\n');
    expect(r.stdout + r.stderr).not.toContain(SENTINEL);
  });

  it('--dry-run prints the body it would send, and sends and counts nothing', async () => {
    const home = mkTmp('cb-live-probe-dry-');
    const lane = plantBridgeLane(home, LANE, { credential: false });
    touch(path.join(lane.laneDir, 'liveprobe-allowed'));
    const up = await fakeResponses([]);
    try {
      const r = await probe(home, 4, { CCGPT_BRIDGE_UPSTREAM_BASE: up.base }, ['--dry-run']);
      expect(r.status, r.stderr).toBe(0);
      const body = JSON.parse(r.stdout) as Json;
      expect(Object.keys(body)).not.toContain('instructions');
      expect(body.input.at(-1).role).toBe('developer');
      expect(up.requests).toHaveLength(0);
      expect(existsSync(path.join(lane.laneDir, 'liveprobe.count'))).toBe(false);
    } finally {
      await up.close();
    }
  });

  it('importing record and liveprobe through load_all runs neither CLI', async () => {
    const home = mkTmp('cb-live-import-');
    const r = await runBridgeDriver(home, { ops: [{ op: 'modules' }] });
    expect(r.status, r.stderr).toBe(0);
    const lines = driverLines(r.stdout);
    expect(lines.map((l) => l.op)).toEqual(['modules']);
    expect(lines[0].loaded).toEqual(expect.arrayContaining(['codexbridge.record', 'codexbridge.liveprobe']));
    expect(r.stderr).toBe('');
    expect(readdirSync(home), 'importing the package wrote into its HOME').toEqual([]);
  });
});

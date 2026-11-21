// Build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.5, Tables 5 and 6). The
// fleet agent's `testbox-capture` op, in the `testbox-op.test.ts` idiom: the op body (`captureTestbox`) against a fixture
// settings printer and an in-process WebSocket server standing in for the test box, and the wire (a REAL agent over
// loopback against a fixture HOME): the op is listed in `ready.ops`, its one field is validated before any case body,
// and a second capture while one is in flight answers `busy`. Nothing reaches a real box or a real tool.
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { RunningAgent } from '../src/server.js';
import { captureTestbox } from '../src/testboxOp.js';
import {
  TESTBOX_CAPTURE_OP, readTestboxCaptureReply, type AgentReady, type TestboxCaptureReply,
} from '../../shared/agent-protocol.js';
import { CAP_WORD } from '../../shared/api.js';
import { TESTBOX_PROTO, type StatusAnswer } from '../../shared/testbox.js';
import { boot, makeFixture, TestClient } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const US = '\x1f';
const BUILD = '2.1.150';
const ID = 'ab'.repeat(16);
const OTHER_ID = 'cd'.repeat(16);

interface World { home: string; agentPath: string; calls(): string[] }

/** A fixture HOME whose launcher prints the settings (`knobs.out`) and logs its argv; a token file beside it. */
function world(o: { url?: string } = {}): World {
  const home = makeFixture().home;
  mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  const launcher = path.join(home, '.local', 'bin', 'ccrc');
  writeFileSync(launcher, [
    '#!/bin/sh',
    `printf 'ccrc' >> "$HOME/calls.log"`,
    `for a in "$@"; do printf ' %s' "$a" >> "$HOME/calls.log"; done`,
    `printf '\\n' >> "$HOME/calls.log"`,
    `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < "$HOME/knobs.out"`,
    '',
  ].join('\n'));
  chmodSync(launcher, 0o755);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'testbox.token'), 'fixture-token\n');
  writeFileSync(path.join(home, 'knobs.out'), [
    ['CCRC_TESTBOX_URL', '', o.url ?? '', 'the fixture'],
    ['CCRC_TESTBOX_TOKEN_FILE', '~/.ccrc/testbox.token', '~/.ccrc/testbox.token', 'default'],
    ['CCRC_TESTBOX_STATUS_DEADLINE', '3s', '1s', 'the fixture'],
    ['CCRC_TESTBOX_POLL', '30s', '45s', 'the fixture'],
  ].map((f) => f.join(US)).join('\n') + '\n');
  return {
    home, agentPath: '/usr/bin:/bin',
    calls: () => (existsSync(path.join(home, 'calls.log')) ? readFileSync(path.join(home, 'calls.log'), 'utf8').split('\n').filter((l) => l !== '') : []),
  };
}

const STATUS: StatusAnswer = {
  t: 'status', state: 'ok', reason: null, serviceVersion: '1.0.0', proto: TESTBOX_PROTO, release: 'v0.0.900',
  tools: { node: '22.99.1', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' },
  sync: { state: 'idle', detail: null, at: null }, runs: { inProgress: 0, limit: 2 }, queueDepth: 0,
  pristine: [], failedKeys: [], heldRunUsers: [], repositories: [{ name: 'project-a', mirrorPath: '/srv/mirror/project-a.git' }],
};

const state = (o: Record<string, unknown>): Record<string, unknown> => ({
  t: 'capture.state', captureId: ID, build: BUILD, state: 'queued', refusal: null, detail: null, position: 1, result: null, ...o,
});
const PASS = { build: BUILD, pass: true, cwd: true, output: 'ok' };

interface Box { url: string; frames: Record<string, unknown>[]; sockets: WsSocket[]; close(): Promise<void> }
const boxes: Box[] = [];
/** The stand-in box: it answers the hello with `answer` and, on a `capture.submit`, runs `onSubmit` (the frames to send,
 *  or a function given the socket). */
async function box(
  onSubmit: (ws: WsSocket, submit: Record<string, unknown>) => void = () => {}, answer: unknown = STATUS,
): Promise<Box> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  const frames: Record<string, unknown>[] = [];
  const sockets: WsSocket[] = [];
  wss.on('connection', (ws: WsSocket) => {
    sockets.push(ws);
    let first = true;
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw)) as Record<string, unknown>;
      if (first) { first = false; ws.send(JSON.stringify(answer)); return; }
      frames.push(m);
      onSubmit(ws, m);
    });
  });
  const port = (wss.address() as { port: number }).port;
  const b: Box = {
    url: `ws://127.0.0.1:${port}`, frames, sockets,
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }),
  };
  boxes.push(b);
  return b;
}
const send = (ws: WsSocket, ...fs: unknown[]): void => { for (const f of fs) ws.send(JSON.stringify(f)); };

let agent: RunningAgent | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.close();
  await agent?.close();
  agent = undefined;
  for (const b of boxes.splice(0)) await b.close();
});

const run = async (w: World, extra: { deadlineMs?: number; build?: string } = {}): Promise<TestboxCaptureReply> => {
  const build = extra.build ?? BUILD;
  const reply = await captureTestbox(build, {
    exec: (await import('../src/testbox/exec.js')).boundedExec, agentPath: w.agentPath, userBus: {}, now: () => 0,
    randomId: () => ID, deadlineMs: extra.deadlineMs ?? 5000,
  }, w.home);
  // Every reply the op gives is one the server's reader accepts.
  expect(readTestboxCaptureReply(reply, build), JSON.stringify(reply)).toEqual(reply);
  return reply;
};

describe('captureTestbox (build capture runner §2.5)', () => {
  it('unconfigured: no CCRC_TESTBOX_URL, and nothing was sent', async () => {
    const w = world();
    expect(await run(w)).toMatchObject({ outcome: 'unconfigured', refusal: null, result: null });
    expect(w.calls()).toEqual(['ccrc test --testbox-knobs host']);
  });

  it('unreachable: nothing listens', async () => {
    const b = await box();
    const w = world({ url: b.url });
    await b.close();
    expect(await run(w)).toMatchObject({ outcome: 'unreachable', refusal: null, result: null });
  });

  it('unreachable: the box never answers the hello within the status deadline', async () => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((r) => wss.once('listening', () => r()));
    boxes.push({ url: '', frames: [], sockets: [], close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }) });
    const w = world({ url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}` });
    expect(await run(w)).toMatchObject({ outcome: 'unreachable' });
  });

  it('bad-answer: the status answer is off its shape; nothing is submitted', async () => {
    const b = await box(() => {}, { t: 'status', state: 'ok' });
    const w = world({ url: b.url });
    expect(await run(w)).toMatchObject({ outcome: 'bad-answer' });
    expect(b.frames).toEqual([]);
  });

  it('sends one capture.submit with a 32-hex id and the build, and answers a pass result', async () => {
    const b = await box((ws) => send(ws, state({ state: 'queued' }), state({ state: 'running', position: null }), state({ state: 'ended', position: null, result: PASS })));
    const w = world({ url: b.url });
    const r = await run(w);
    expect(r).toEqual({ outcome: 'answered', refusal: null, result: PASS, detail: null });
    expect(b.frames).toEqual([{ t: 'capture.submit', captureId: ID, build: BUILD }]);
    expect(ID).toMatch(/^[0-9a-f]{32}$/);
  });

  it('the default id is 32 lowercase hex characters, fresh on each call', async () => {
    const seen: string[] = [];
    const b = await box((ws, s) => { seen.push(String(s.captureId)); send(ws, state({ captureId: s.captureId, state: 'ended', position: null, result: null, detail: 'no verdict' })); });
    const w = world({ url: b.url });
    const s = { exec: (await import('../src/testbox/exec.js')).boundedExec, agentPath: w.agentPath, userBus: {}, now: () => 0 };
    await captureTestbox(BUILD, s, w.home);
    await captureTestbox(BUILD, s, w.home);
    expect(seen).toHaveLength(2);
    for (const id of seen) expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('answered with a null result carries the frame detail', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null, result: null, detail: 'the build did not finish' })));
    expect(await run(world({ url: b.url }))).toEqual({ outcome: 'answered', refusal: null, result: null, detail: 'the build did not finish' });
  });

  it('refused: the refusal word and the detail', async () => {
    const b = await box((ws) => send(ws, state({ state: 'refused', refusal: 'build-absent', detail: 'the box holds no copy', position: null })));
    expect(await run(world({ url: b.url }))).toEqual({ outcome: 'refused', refusal: 'build-absent', result: null, detail: 'the box holds no copy' });
  });

  it('frames of other types and for another capture id are ignored', async () => {
    const b = await box((ws) => send(ws,
      { ...STATUS },
      state({ captureId: OTHER_ID, state: 'refused', refusal: 'no-runner', detail: 'x', position: null }),
      state({ captureId: OTHER_ID, state: 'ended', position: null, result: null, detail: 'x' }),
      { t: 'capture.state', captureId: OTHER_ID, garbage: true },
      state({ state: 'ended', position: null, result: PASS })));
    expect(await run(world({ url: b.url }))).toMatchObject({ outcome: 'answered', result: PASS });
  });

  it('not-taken: the box closes with the policy code after the submit', async () => {
    const b = await box((ws) => ws.close(1008, 'unknown frame'));
    expect(await run(world({ url: b.url }))).toMatchObject({ outcome: 'not-taken', refusal: null, result: null });
  });

  it('unanswered: any other close after the submit', async () => {
    const b = await box((ws) => ws.close(1001, 'going away'));
    expect(await run(world({ url: b.url }))).toMatchObject({ outcome: 'unanswered' });
  });

  it('unanswered: the connection is dropped after the submit', async () => {
    const b = await box((ws) => ws.terminate());
    expect(await run(world({ url: b.url }))).toMatchObject({ outcome: 'unanswered' });
  });

  it('unanswered: still running at the deadline', async () => {
    const b = await box((ws) => send(ws, state({ state: 'running', position: null })));
    const t0 = Date.now();
    expect(await run(world({ url: b.url }), { deadlineMs: 300 })).toMatchObject({ outcome: 'unanswered', result: null });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
  });

  it('unanswered: a malformed frame for this capture id, with the reader\'s reason', async () => {
    const b = await box((ws) => send(ws, { t: 'capture.state', captureId: ID, build: BUILD, state: 'bogus' }));
    const r = await run(world({ url: b.url }));
    expect(r.outcome).toBe('unanswered');
    expect(r.detail).toMatch(/\S/);
  });

  it('unanswered: an ended frame whose result is for another build is refused by the reader, never trusted', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null, result: { ...PASS, build: '2.1.151' } })));
    expect(await run(world({ url: b.url }))).toMatchObject({ outcome: 'unanswered', result: null });
  });

  it('always closes the socket', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null, result: PASS })));
    await run(world({ url: b.url }));
    for (let i = 0; i < 100 && b.sockets.some((s) => s.readyState !== s.CLOSED); i++) await new Promise((r) => setTimeout(r, 10));
    expect(b.sockets.map((s) => s.readyState)).toEqual([3]);
  });
});

describe('the testbox-capture op on the wire', () => {
  async function connect(w: World, seams: Record<string, unknown> = {}): Promise<TestClient> {
    agent = await boot({ home: w.home, projectsRoot: mkTmp('tbc-projects-'), outside: mkTmp('tbc-outside-') }, {
      testboxSeams: { agentPath: w.agentPath, now: () => 0, randomId: () => ID, ...seams },
    });
    const c = new TestClient(agent.port);
    clients.push(c);
    return c;
  }
  const res = (c: TestClient, id: number) =>
    c.waitFor((m) => (m as { t?: string; id?: number }).t === 'res' && (m as { id?: number }).id === id) as Promise<Record<string, unknown>>;

  it('is listed in ready.ops, on CAP_WORD', async () => {
    const c = await connect(world());
    const ops = (await c.hello() as AgentReady).ops!;
    expect(TESTBOX_CAPTURE_OP).toBe('testbox-capture');
    expect(ops).toContain(TESTBOX_CAPTURE_OP);
    expect(ops.filter((x) => !CAP_WORD.test(x))).toEqual([]);
  });

  it('answers the reply as the res body', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null, result: PASS })));
    const w = world({ url: b.url });
    const c = await connect(w);
    await c.hello();
    c.send({ t: 'req', id: 4, op: 'testbox-capture', build: BUILD });
    const r = await res(c, 4);
    expect(r.ok).toBe(true);
    // The reader reads the reply BODY: the `res` envelope's `t`, `id` and `ok` are the caller's to strip.
    const { t: _t, id: _id, ok: _ok, ...body } = r;
    expect(readTestboxCaptureReply(body, BUILD)).toMatchObject({ outcome: 'answered', result: PASS });
  });

  it('refuses a build that is not a Claude Code version with bad-build, and an extra field as a bad request; nothing runs', async () => {
    const b = await box();
    const w = world({ url: b.url });
    const c = await connect(w);
    await c.hello();
    for (const [id, build] of [[5, '../etc'], [6, 'v2.1.150'], [7, ''], [8, 5]] as const) {
      c.send({ t: 'req', id, op: 'testbox-capture', build });
      expect(await res(c, id), String(build)).toMatchObject({ ok: false, err: 'bad-build' });
    }
    c.send({ t: 'req', id: 9, op: 'testbox-capture' });
    expect(await res(c, 9)).toMatchObject({ ok: false, err: 'bad-build' });
    c.send({ t: 'req', id: 10, op: 'testbox-capture', build: BUILD, url: 'ws://elsewhere.invalid' });
    expect(await res(c, 10)).toMatchObject({ ok: false, err: 'bad-request' });
    expect(w.calls()).toEqual([]);
    expect(b.frames).toEqual([]);
  });

  it('one gate per agent process: a second capture while one is in flight answers busy, and the gate frees', async () => {
    let first: WsSocket | undefined;
    const b = await box((ws) => { first ??= ws; });
    const w = world({ url: b.url });
    const c = await connect(w);
    await c.hello();
    c.send({ t: 'req', id: 11, op: 'testbox-capture', build: BUILD });
    for (let i = 0; i < 200 && b.frames.length < 1; i++) await new Promise((r) => setTimeout(r, 10));
    expect(b.frames).toHaveLength(1);
    c.send({ t: 'req', id: 12, op: 'testbox-capture', build: BUILD });
    expect(await res(c, 12)).toMatchObject({ ok: false, err: 'busy' });
    expect(b.frames, 'the second never reached the box').toHaveLength(1);
    send(first!, state({ state: 'ended', position: null, result: PASS }));
    expect(await res(c, 11)).toMatchObject({ ok: true, outcome: 'answered' });
    c.send({ t: 'req', id: 13, op: 'testbox-capture', build: BUILD });
    for (let i = 0; i < 200 && b.frames.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    expect(b.frames).toHaveLength(2);
    send(b.sockets[1]!, state({ state: 'ended', position: null, result: PASS }));
    expect(await res(c, 13)).toMatchObject({ ok: true });
  });
});

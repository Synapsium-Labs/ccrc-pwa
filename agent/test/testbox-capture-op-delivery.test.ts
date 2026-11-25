// The `testbox-capture` op's delivery recipe (Desktop polish wave 178; the capture owner's call 1135), in
// `testbox-capture-op.test.ts`'s idiom: the op body against a fixture settings printer and an in-process stand-in box, and
// the wire through a REAL agent over loopback. The recipe rides the submission only when asked; build trust's frame is
// unchanged; a state frame off its submission's shape is no answer, in both directions; and the agent takes the recipe
// field only as `delivery`.
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { RunningAgent } from '../src/server.js';
import { captureTestbox } from '../src/testboxOp.js';
import { readTestboxCaptureReply, type TestboxCaptureReply } from '../../shared/agent-protocol.js';
import type { CaptureRecipe } from '../../shared/claudeBuildCapture.js';
import { deliveryCaptureResult, deliveryCaseResult, deliveryExpected } from '../../shared/deliveryCapture.js';
import { deliveryParts } from '../../shared/deliveryResult.js';
import { TESTBOX_PROTO, type StatusAnswer } from '../../shared/testbox.js';
import { boot, makeFixture, TestClient } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const US = '\x1f';
const BUILD = '2.1.150';
const ID = 'ab'.repeat(16);
const PART = 1;
const RESULT = JSON.parse(JSON.stringify(deliveryCaptureResult(BUILD, PART, deliveryParts()[PART]!.map((id) =>
  deliveryCaseResult(id, { send: 'ok', turns: [deliveryExpected(id)], sideRequests: 0, hookPrompts: [] })))));
const PASS = { build: BUILD, pass: true, cwd: true, output: 'ok' };

interface World { home: string; agentPath: string; calls(): string[] }

/** A fixture HOME whose launcher prints the settings and logs its argv; a token file beside it. */
function world(url = ''): World {
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
    ['CCRC_TESTBOX_URL', '', url, 'the fixture'],
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

interface Box { url: string; frames: Record<string, unknown>[]; close(): Promise<void> }
const boxes: Box[] = [];
async function box(onSubmit: (ws: WsSocket, submit: Record<string, unknown>) => void = () => {}): Promise<Box> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  const frames: Record<string, unknown>[] = [];
  wss.on('connection', (ws: WsSocket) => {
    let first = true;
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw)) as Record<string, unknown>;
      if (first) { first = false; ws.send(JSON.stringify(STATUS)); return; }
      frames.push(m);
      onSubmit(ws, m);
    });
  });
  const b: Box = {
    url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`, frames,
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

const run = async (w: World, recipe: CaptureRecipe): Promise<TestboxCaptureReply> => {
  const part = recipe === 'delivery' ? PART : undefined;
  const reply = await captureTestbox(BUILD, {
    exec: (await import('../src/testbox/exec.js')).boundedExec, agentPath: w.agentPath, userBus: {}, now: () => 0,
    randomId: () => ID, deadlineMs: 5000,
  }, w.home, recipe, part);
  // Every reply the op gives is one the server's reader accepts, for the recipe and part asked.
  expect(readTestboxCaptureReply(reply, BUILD, recipe, part), JSON.stringify(reply)).toEqual(reply);
  return reply;
};

describe('captureTestbox with the delivery recipe', () => {
  it('sends the recipe and the part in the submission and answers the delivery result, with no trust verdict', async () => {
    const b = await box((ws) => send(ws, state({ delivery: null }), state({ state: 'running', position: null, delivery: null }), state({ state: 'ended', position: null, delivery: RESULT })));
    const r = await run(world(b.url), 'delivery');
    expect(b.frames).toEqual([{ t: 'capture.submit', captureId: ID, build: BUILD, recipe: 'delivery', part: PART }]);
    expect(r).toMatchObject({ outcome: 'answered', result: null, delivery: { word: 'intact', build: BUILD, part: PART } });
  });

  it('a result for another part than the one submitted is no answer (call 1159: this check alone binds them)', async () => {
    const other = JSON.parse(JSON.stringify(deliveryCaptureResult(BUILD, 0, deliveryParts()[0]!.map((id) =>
      deliveryCaseResult(id, { send: 'ok', turns: [deliveryExpected(id)], sideRequests: 0, hookPrompts: [] })))));
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null, delivery: other })));
    expect(await run(world(b.url), 'delivery')).toMatchObject({ outcome: 'unanswered', delivery: null, detail: expect.stringMatching(/a result for part 0, not the part 1 submitted/) });
  });

  it('a box that refuses the delivery submission at the frame is not-taken: nothing was sent on, no verdict', async () => {
    const b = await box((ws) => ws.close(1008, 'delivery is not a recipe this box runs'));
    expect(await run(world(b.url), 'delivery')).toMatchObject({ outcome: 'not-taken', delivery: null, detail: expect.stringMatching(/delivery is not a recipe this box runs/) });
  });

  it('a build-trust submission is unchanged: no recipe field, and no delivery field in its reply', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null, result: PASS })));
    const r = await run(world(b.url), 'build-trust');
    expect(b.frames).toEqual([{ t: 'capture.submit', captureId: ID, build: BUILD }]);
    expect(r).toEqual({ outcome: 'answered', refusal: null, result: PASS, detail: null });
  });

  it('a delivery reply that never reached the box still carries delivery: null', async () => {
    expect(await run(world(), 'delivery')).toMatchObject({ outcome: 'unconfigured', delivery: null });
  });

  it('a delivery submission\'s state frame without delivery is no answer', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null })));
    expect(await run(world(b.url), 'delivery')).toMatchObject({ outcome: 'unanswered', delivery: null, detail: expect.stringMatching(/off its delivery submission's shape/) });
  });

  it('a build-trust submission\'s state frame naming delivery is no answer', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null, delivery: null })));
    expect(await run(world(b.url), 'build-trust')).toMatchObject({ outcome: 'unanswered', detail: expect.stringMatching(/off its build-trust submission's shape/) });
  });
});

describe('the recipe field on the wire', () => {
  async function connect(w: World): Promise<TestClient> {
    agent = await boot({ home: w.home, projectsRoot: mkTmp('tbcd-projects-'), outside: mkTmp('tbcd-outside-') }, {
      testboxSeams: { agentPath: w.agentPath, now: () => 0, randomId: () => ID },
    });
    const c = new TestClient(agent.port);
    clients.push(c);
    return c;
  }
  const res = (c: TestClient, id: number) =>
    c.waitFor((m) => (m as { t?: string; id?: number }).t === 'res' && (m as { id?: number }).id === id) as Promise<Record<string, unknown>>;

  it('takes recipe: delivery, and hands the box the delivery submission', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null, delivery: RESULT })));
    const c = await connect(world(b.url));
    await c.hello();
    c.send({ t: 'req', id: 4, op: 'testbox-capture', build: BUILD, recipe: 'delivery', part: PART });
    const { t: _t, id: _id, ok, ...body } = await res(c, 4);
    expect(ok).toBe(true);
    expect(readTestboxCaptureReply(body, BUILD, 'delivery', PART)?.delivery).toEqual(RESULT);
    expect(b.frames).toEqual([{ t: 'capture.submit', captureId: ID, build: BUILD, recipe: 'delivery', part: PART }]);
  });

  it('refuses any other recipe, and the recipe and part apart, as a bad request; nothing runs', async () => {
    const b = await box();
    const w = world(b.url);
    const c = await connect(w);
    await c.hello();
    const bad: readonly (readonly [number, Record<string, unknown>])[] = [
      [5, { recipe: 'build-trust', part: 0 }], [6, { recipe: 'trust', part: 0 }], [7, { recipe: null, part: 0 }], [8, { recipe: 1, part: 0 }],
      [9, { recipe: 'delivery' }], [10, { part: 0 }], [11, { recipe: 'delivery', part: 3 }], [12, { recipe: 'delivery', part: -1 }],
      [13, { recipe: 'delivery', part: '0' }], [14, { recipe: 'delivery', part: 0.5 }],
    ];
    for (const [id, over] of bad) {
      c.send({ t: 'req', id, op: 'testbox-capture', build: BUILD, ...over });
      expect(await res(c, id), JSON.stringify(over)).toMatchObject({ ok: false, err: 'bad-request' });
    }
    expect(w.calls()).toEqual([]);
    expect(b.frames).toEqual([]);
  });
});

// The `testbox-capture` op's frames recipe (Desktop polish wave 187), the delivery file's twin, in
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
import { FRAMES_PART_COUNT, FRAMES_PARTS } from '../../shared/framesResult.js';
import { TESTBOX_PROTO, type StatusAnswer } from '../../shared/testbox.js';
import { boot, makeFixture, TestClient } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const US = '\x1f';
const BUILD = '2.1.150';
const ID = 'ab'.repeat(16);
const PART = 1;
const PANE = FRAMES_PARTS[PART]!.pane;
const frameOf = (part: number): Record<string, unknown> => ({
  recipe: 'frames', version: 'abcdef0123456789', build: BUILD, part, case: FRAMES_PARTS[part]!.case, pane: FRAMES_PARTS[part]!.pane,
  release: null, unmeasured: [], word: 'framed', sends: [], turns: 0, sideRequests: 0,
  frame: { outcome: 'drawn', refusal: null, rows: 1, width: 5, bytes: 5, cursor: [0, 0], replaced: { cwd: 0, path: 0, model: 0, account: 0 }, text: 'hello' },
});
const RESULT = frameOf(PART);
void PANE;
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
  const part = recipe === 'build-trust' ? undefined : PART;
  const reply = await captureTestbox(BUILD, {
    exec: (await import('../src/testbox/exec.js')).boundedExec, agentPath: w.agentPath, userBus: {}, now: () => 0,
    randomId: () => ID, deadlineMs: 5000,
  }, w.home, recipe, part);
  expect(readTestboxCaptureReply(reply, BUILD, recipe, part), JSON.stringify(reply)).toEqual(reply);
  return reply;
};

describe('captureTestbox with the frames recipe', () => {
  it('sends the recipe and the part and answers the frames result, with no trust verdict and no delivery', async () => {
    const b = await box((ws) => send(ws, state({ frames: null }), state({ state: 'ended', position: null, frames: RESULT })));
    const r = await run(world(b.url), 'frames');
    expect(b.frames).toEqual([{ t: 'capture.submit', captureId: ID, build: BUILD, recipe: 'frames', part: PART }]);
    expect(r).toMatchObject({ outcome: 'answered', result: null, frames: { word: 'framed', build: BUILD, part: PART } });
    expect(r).not.toHaveProperty('delivery');
  });

  it('a result for another part than the one submitted is no answer', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null, frames: frameOf(0) })));
    expect(await run(world(b.url), 'frames')).toMatchObject({ outcome: 'unanswered', frames: null, detail: expect.stringMatching(/a result for part 0, not the part 1 submitted/) });
  });

  it('a frames submission\'s state frame carrying delivery is off its shape', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null, frames: null, delivery: null })));
    // The frame reader refuses a frame naming both recipes' fields before the op's own shape check (shared/testbox.ts).
    expect(await run(world(b.url), 'frames')).toMatchObject({ outcome: 'unanswered', frames: null, detail: expect.stringMatching(/beside delivery: a capture runs one recipe/) });
  });

  it('a frames submission\'s state frame without frames is off its shape', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null })));
    expect(await run(world(b.url), 'frames')).toMatchObject({ outcome: 'unanswered', frames: null, detail: expect.stringMatching(/off its frames submission's shape/) });
  });

  it('a delivery submission\'s state frame carrying frames is off its shape', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null, delivery: null, frames: null })));
    expect(await run(world(b.url), 'delivery')).toMatchObject({ outcome: 'unanswered', detail: expect.stringMatching(/beside delivery: a capture runs one recipe/) });
  });

  it('a delivery submission\'s state frame carrying frames alone is off its shape', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null, frames: null })));
    expect(await run(world(b.url), 'delivery')).toMatchObject({ outcome: 'unanswered', detail: expect.stringMatching(/off its delivery submission's shape/) });
  });

  it('a box that refuses the frames submission at the frame is not-taken, with frames: null', async () => {
    const b = await box((ws) => ws.close(1008, 'frames is not a recipe this box runs'));
    expect(await run(world(b.url), 'frames')).toMatchObject({ outcome: 'not-taken', frames: null, detail: expect.stringMatching(/frames is not a recipe this box runs/) });
  });

  it('a frames reply that never reached the box still carries frames: null, and never delivery', async () => {
    const r = await run(world(), 'frames');
    expect(r).toMatchObject({ outcome: 'unconfigured', frames: null });
    expect(r).not.toHaveProperty('delivery');
  });

  it('a build-trust reply carries neither', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null, result: PASS })));
    expect(await run(world(b.url), 'build-trust')).toEqual({ outcome: 'answered', refusal: null, result: PASS, detail: null });
  });
});

describe('the recipe field on the wire, frames', () => {
  async function connect(w: World): Promise<TestClient> {
    agent = await boot({ home: w.home, projectsRoot: mkTmp('tbcf-projects-'), outside: mkTmp('tbcf-outside-') }, {
      testboxSeams: { agentPath: w.agentPath, now: () => 0, randomId: () => ID },
    });
    const c = new TestClient(agent.port);
    clients.push(c);
    return c;
  }
  const res = (c: TestClient, id: number) =>
    c.waitFor((m) => (m as { t?: string; id?: number }).t === 'res' && (m as { id?: number }).id === id) as Promise<Record<string, unknown>>;

  it('takes recipe: frames with a part, and hands the box the frames submission', async () => {
    const b = await box((ws) => send(ws, state({ state: 'ended', position: null, frames: RESULT })));
    const c = await connect(world(b.url));
    await c.hello();
    c.send({ t: 'req', id: 4, op: 'testbox-capture', build: BUILD, recipe: 'frames', part: PART });
    const { t: _t, id: _id, ok, ...body } = await res(c, 4);
    expect(ok).toBe(true);
    expect(readTestboxCaptureReply(body, BUILD, 'frames', PART)?.frames).toEqual(RESULT);
    expect(b.frames).toEqual([{ t: 'capture.submit', captureId: ID, build: BUILD, recipe: 'frames', part: PART }]);
  });

  it('refuses a part past the count, a part alone, a recipe alone and another recipe, as a bad request; nothing runs', async () => {
    const b = await box();
    const w = world(b.url);
    const c = await connect(w);
    await c.hello();
    const bad: readonly (readonly [number, Record<string, unknown>])[] = [
      [5, { recipe: 'frames', part: FRAMES_PART_COUNT }], [6, { recipe: 'frames', part: -1 }], [7, { recipe: 'frames', part: '0' }],
      [8, { recipe: 'frames', part: 0.5 }], [9, { part: 0 }], [10, { recipe: 'frames' }], [11, { recipe: 'other', part: 0 }],
    ];
    for (const [id, over] of bad) {
      c.send({ t: 'req', id, op: 'testbox-capture', build: BUILD, ...over });
      expect(await res(c, id), JSON.stringify(over)).toMatchObject({ ok: false, err: 'bad-request' });
    }
    expect(w.calls()).toEqual([]);
    expect(b.frames).toEqual([]);
  });
});

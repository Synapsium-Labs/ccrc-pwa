// The box frames recipe's transport (Desktop polish wave 187): `server/src/testboxCapture.ts#testboxCaptureTransport` maps a
// FRAMES job's every row as a delivery job's, and the two io arms (`remote/io.ts`, `io.ts#localTestboxCapture`) carry the
// recipe and the part. Twins of `testbox-capture-transport.test.ts`; nothing reaches a box: the io is a fake.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testboxCaptureTransport } from '../src/testboxCapture.js';
import { localIOFor, localTestboxCapture, type CaptureAsked } from '../src/io.js';
import type { BuildCaptureUnavailable } from '../src/buildCaptureLane.js';
import { createIo, DELIVERY_BAD_REQUEST_DETAIL, FRAMES_BAD_REQUEST_DETAIL } from '../src/remote/io.js';
import { AgentOpError } from '../src/remote/errors.js';
import { TESTBOX_CAPTURE_OP, type TestboxCaptureOutcome, type TestboxCaptureReply } from '../../shared/agent-protocol.js';
import type { CaptureRefusal } from '../../shared/claudeBuildCapture.js';
import type { BuildCaptureResult } from '../../shared/claudeBuildTrust.js';
import { FRAMES_PARTS, frameSize, framesFrameId, type FramesCaptureResult } from '../../shared/framesResult.js';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import { WebSocketServer } from 'ws';
import { BUILD_CAPTURE_SWEEP_MS, BuildCaptureLane } from '../src/buildCaptureLane.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { registerTestboxFramesRoute } from '../src/testboxFramesRoutes.js';
import { DELIVERY_PART_COUNT } from '../../shared/deliveryResult.js';
import { FRAMES_RECIPE_VERSION } from '../../shared/framesCapture.js';
import { FRAMES_STATUS_TEXT } from '../../shared/framesReduce.js';
import { TESTBOX_PROTO } from '../../shared/testbox.js';
import { deliveryResultFor } from './deliveryLaneHelpers.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const BUILD = '2.1.332';
const PART = 3;
const TRUST: BuildCaptureResult = { build: BUILD, pass: true, cwd: true, output: 'verdict: pass (40 records)' };

function framesResult(part = PART): FramesCaptureResult {
  const p = FRAMES_PARTS[part]!;
  const text = '0'.repeat(20) + '\n';
  return {
    recipe: 'frames', version: '0123456789abcdef', build: BUILD, part, case: p.case, pane: { cols: p.pane.cols, rows: p.pane.rows },
    release: 'v0.0.1500', unmeasured: [], word: 'framed', sends: [], turns: 0, sideRequests: 0,
    frame: { outcome: 'drawn', refusal: null, ...frameSize(text), cursor: [2, 1], replaced: { cwd: 0, path: 0, model: 0, account: 0 }, text },
  };
}
const RESULT = framesResult();

const reply = (outcome: TestboxCaptureOutcome, over: Partial<TestboxCaptureReply> = {}): CaptureAsked => ({
  ok: true, reply: { outcome, refusal: null, result: null, detail: null, frames: null, ...over },
});
const refused = (refusal: CaptureRefusal): CaptureAsked => reply('refused', { refusal, detail: `refused: ${refusal}` });
const via = (asked: CaptureAsked | Error) => testboxCaptureTransport(() => ({
  testboxCapture: async () => { if (asked instanceof Error) throw asked; return asked; },
}));
const run = (asked: CaptureAsked | Error) => via(asked).capture({ build: BUILD, recipe: 'frames', part: PART });
const un = (why: BuildCaptureUnavailable) => ({ kind: 'unavailable', why });

afterEach(() => { vi.restoreAllMocks(); });

describe('testboxCaptureTransport, a frames job: every row maps as a delivery job\'s', () => {
  it('asks for the job build, the recipe and the part, once', async () => {
    const testboxCapture = vi.fn(async (): Promise<CaptureAsked> => ({ ok: false, reason: 'no-op' }));
    await testboxCaptureTransport(() => ({ testboxCapture })).capture({ build: BUILD, recipe: 'frames', part: PART });
    expect(testboxCapture).toHaveBeenCalledExactlyOnceWith(BUILD, 'frames', PART);
  });
  it('answered with a frames result: answered, the result handed on unread', async () => {
    expect(await run(reply('answered', { frames: RESULT }))).toEqual({ kind: 'answered', result: RESULT });
  });
  it('answered with frames null (even beside a trust result): unanswered', async () => {
    expect(await run(reply('answered', { frames: null }))).toEqual(un('unanswered'));
    expect(await run(reply('answered', { result: TRUST, frames: null }))).toEqual(un('unanswered'));
  });
  it('answered with a reply that omits frames altogether: unanswered', async () => {
    const asked: CaptureAsked = { ok: true, reply: { outcome: 'answered', refusal: null, result: null, detail: null } };
    expect(await run(asked)).toEqual(un('unanswered'));
  });
  it('not-taken: recipe-not-run, with the detail; a trust job\'s stays no-runner', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await run(reply('not-taken', { detail: 'older box' }))).toEqual({ kind: 'unavailable', why: 'recipe-not-run', detail: 'older box' });
    expect(await run(reply('not-taken'))).toEqual({ kind: 'unavailable', why: 'recipe-not-run' });
    expect(await via(reply('not-taken', { detail: 'x' })).capture({ build: BUILD })).toEqual(un('no-runner'));
  });
  it('not-taken logs nothing here (the lane writes its one line)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await run(reply('not-taken', { detail: 'older box' }));
    expect(warn).not.toHaveBeenCalled();
  });
  it.each(['unconfigured', 'unreachable', 'bad-answer'] as const)('%s: no-test-box', async (o) => {
    expect(await run(reply(o, { detail: 'why' }))).toEqual(un('no-test-box'));
  });
  it('refusals map as for any job', async () => {
    expect(await run(refused('not-test-box'))).toEqual(un('no-test-box'));
    expect(await run(refused('no-runner'))).toEqual(un('no-runner'));
    expect(await run(refused('build-absent'))).toEqual(un('build-absent'));
    expect(await run(refused('path-refused'))).toEqual(un('path-refused'));
    expect(await run(refused('capture-id-used'))).toEqual(un('unanswered'));
  });
  it('unanswered, a thrown call and every seam word map as for any job', async () => {
    expect(await run(reply('unanswered'))).toEqual(un('unanswered'));
    expect(await run(new Error('boom'))).toEqual(un('unanswered'));
    expect(await run({ ok: false, reason: 'no-op' })).toEqual(un('no-runner'));
    expect(await run({ ok: false, reason: 'unanswered' })).toEqual(un('unanswered'));
    expect(await run({ ok: false, reason: 'not-started' })).toEqual(un('not-started'));
    expect(await run({ ok: false, reason: 'busy' })).toEqual(un('busy'));
  });
  it('answered with no frames result logs its detail; one with a result logs nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await run(reply('answered', { detail: 'timed out' }));
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([`ccrc-server: build capture ${BUILD}: answered, no verdict: timed out`]);
    warn.mockClear();
    await run(reply('answered', { frames: RESULT, detail: 'kept' }));
    expect(warn).not.toHaveBeenCalled();
  });
  it('a frames job with no part is not-started and is never asked', async () => {
    const testboxCapture = vi.fn(async (): Promise<CaptureAsked> => reply('answered', { frames: RESULT }));
    expect(await testboxCaptureTransport(() => ({ testboxCapture })).capture({ build: BUILD, recipe: 'frames' })).toEqual(un('not-started'));
    expect(testboxCapture).not.toHaveBeenCalled();
  });
});

describe('a delivery and a trust job still map as before', () => {
  it('a delivery job reads its delivery field, never frames', async () => {
    const delivery = { recipe: 'delivery' } as never;
    const asked: CaptureAsked = { ok: true, reply: { outcome: 'answered', refusal: null, result: null, detail: null, delivery } };
    expect(await testboxCaptureTransport(() => ({ testboxCapture: async () => asked })).capture({ build: BUILD, recipe: 'delivery', part: 0 }))
      .toEqual({ kind: 'answered', result: delivery });
    const framesOnly: CaptureAsked = { ok: true, reply: { outcome: 'answered', refusal: null, result: null, detail: null, frames: RESULT } };
    expect(await testboxCaptureTransport(() => ({ testboxCapture: async () => framesOnly })).capture({ build: BUILD, recipe: 'delivery', part: 0 }))
      .toEqual(un('unanswered'));
  });
  it('a delivery job asks with its recipe and part; a delivery job with no part is not-started', async () => {
    const testboxCapture = vi.fn(async (): Promise<CaptureAsked> => ({ ok: false, reason: 'no-op' }));
    await testboxCaptureTransport(() => ({ testboxCapture })).capture({ build: BUILD, recipe: 'delivery', part: 2 });
    expect(testboxCapture).toHaveBeenCalledExactlyOnceWith(BUILD, 'delivery', 2);
    expect(await testboxCaptureTransport(() => ({ testboxCapture })).capture({ build: BUILD, recipe: 'delivery' })).toEqual(un('not-started'));
  });
  it('a trust job reads result, asks with the build alone, and a trust job ignores frames', async () => {
    const testboxCapture = vi.fn(async (): Promise<CaptureAsked> => reply('answered', { result: TRUST, frames: RESULT }));
    expect(await testboxCaptureTransport(() => ({ testboxCapture })).capture({ build: BUILD })).toEqual({ kind: 'answered', result: TRUST });
    expect(testboxCapture).toHaveBeenCalledExactlyOnceWith(BUILD);
  });
});

describe('the remote arm of FleetIO.testboxCapture, a frames ask', () => {
  const GOOD = { outcome: 'answered', refusal: null, result: null, detail: null, frames: RESULT };
  const ioOf = (request: unknown) => createIo({ state: { agentOps: [TESTBOX_CAPTURE_OP] }, request } as never);
  it('sends the frames request frame with recipe and part and reads the reply as a frames reply', async () => {
    const request = vi.fn(async () => GOOD);
    expect(await ioOf(request).testboxCapture(BUILD, 'frames', PART)).toEqual({ ok: true, reply: GOOD });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      { t: 'req', op: TESTBOX_CAPTURE_OP, build: BUILD, recipe: 'frames', part: PART }, expect.any(Number));
  });
  it('a result for another part, or a reply with no frames field, is unanswered', async () => {
    expect(await ioOf(async () => ({ ...GOOD, frames: framesResult(PART + 1) })).testboxCapture(BUILD, 'frames', PART)).toEqual({ ok: false, reason: 'unanswered' });
    const { frames: _f, ...bare } = GOOD;
    expect(await ioOf(async () => bare).testboxCapture(BUILD, 'frames', PART)).toEqual({ ok: false, reason: 'unanswered' });
  });
  it('a frames ask with no part is never sent: not-started', async () => {
    const request = vi.fn();
    const asked = await (ioOf(request).testboxCapture as (...a: unknown[]) => Promise<CaptureAsked>)(BUILD, 'frames');
    expect(asked).toEqual({ ok: false, reason: 'not-started' });
    expect(request).not.toHaveBeenCalled();
  });
  it('an agent that answers bad-request is not-taken, frames null, with the frames detail', async () => {
    const io = ioOf(async () => { throw new AgentOpError('bad-request', null); });
    expect(await io.testboxCapture(BUILD, 'frames', PART)).toEqual({
      ok: true, reply: { outcome: 'not-taken', refusal: null, result: null, detail: FRAMES_BAD_REQUEST_DETAIL, frames: null },
    });
    expect(FRAMES_BAD_REQUEST_DETAIL).toContain('frames');
    expect(FRAMES_BAD_REQUEST_DETAIL).not.toEqual(DELIVERY_BAD_REQUEST_DETAIL);
  });
  it('through the transport that bad-request is recipe-not-run with the detail', async () => {
    const io = ioOf(async () => { throw new AgentOpError('bad-request', null); });
    expect(await testboxCaptureTransport(() => io).capture({ build: BUILD, recipe: 'frames', part: PART }))
      .toEqual({ kind: 'unavailable', why: 'recipe-not-run', detail: FRAMES_BAD_REQUEST_DETAIL });
  });
  it('a trust job\'s bad-request stays unanswered; a delivery job\'s stays not-taken with its own detail', async () => {
    const io = ioOf(async () => { throw new AgentOpError('bad-request', null); });
    expect(await io.testboxCapture(BUILD)).toEqual({ ok: false, reason: 'unanswered' });
    expect(await io.testboxCapture(BUILD, 'delivery', 0)).toMatchObject({ ok: true, reply: { outcome: 'not-taken', detail: DELIVERY_BAD_REQUEST_DETAIL } });
  });
  it('a frames ask to an agent without the op: no-op, nothing sent', async () => {
    const request = vi.fn();
    const io = createIo({ state: { agentOps: ['testbox'] }, request } as never);
    expect(await io.testboxCapture(BUILD, 'frames', PART)).toEqual({ ok: false, reason: 'no-op' });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('the local arm of FleetIO.testboxCapture, a frames ask', () => {
  it('a frames ask with no part is never run: not-started, at the function and through localIOFor', async () => {
    expect(await localTestboxCapture(BUILD, '/nonexistent-fixture-home', 'frames')).toEqual({ ok: false, reason: 'not-started' });
    const asked = await (localIOFor('/nonexistent-fixture-home').testboxCapture as (...a: unknown[]) => Promise<CaptureAsked>)(BUILD, 'frames');
    expect(asked).toEqual({ ok: false, reason: 'not-started' });
  });
});

// Review 4069's F5, the coordinator's condition 1 (plan 5.3): the single-box install's arm carries the same result to the same
// lane, store, check and read. The local arm runs the agent's own capture body (`localIOFor(home).testboxCapture`), against a
// fixture HOME whose launcher prints the box settings and an in-process stand-in box on loopback: nothing reaches a test box.
describe('the local arm end to end: the lane, the store, the check and the read', () => {
  const US = '\x1f';
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => { for (const c of closers.splice(0)) await c(); });

  /** A stand-in box: the status answer to the first frame, then the frames result for the part each submission names. */
  async function standInBox(text: string): Promise<{ url: string; submits: Record<string, unknown>[] }> {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((r) => wss.once('listening', () => r()));
    closers.push(() => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }));
    const submits: Record<string, unknown>[] = [];
    wss.on('connection', (ws) => {
      let first = true;
      ws.on('message', (raw) => {
        const m = JSON.parse(String(raw)) as Record<string, unknown>;
        if (first) {
          first = false;
          ws.send(JSON.stringify({
            t: 'status', state: 'ok', reason: null, serviceVersion: '1.0.0', proto: TESTBOX_PROTO, release: 'v0.0.900',
            tools: { node: '22.99.1', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' },
            sync: { state: 'idle', detail: null, at: null }, runs: { inProgress: 0, limit: 2 }, queueDepth: 0,
            pristine: [], failedKeys: [], heldRunUsers: [], repositories: [],
          }));
          return;
        }
        submits.push(m);
        const part = m['part'] as number;
        const p = FRAMES_PARTS[part]!;
        const result: FramesCaptureResult = {
          recipe: 'frames', version: FRAMES_RECIPE_VERSION, build: m['build'] as string, part, case: p.case, pane: p.pane, release: 'v0.0.900',
          unmeasured: [], word: 'framed', sends: [], turns: 0, sideRequests: 0,
          frame: { outcome: 'drawn', refusal: null, ...frameSize(text), cursor: [2, 1], replaced: { cwd: 0, path: 0, model: 0, account: 0 }, text },
        };
        ws.send(JSON.stringify({ t: 'capture.state', captureId: m['captureId'], build: m['build'], state: 'ended', refusal: null, detail: null, position: null, result: null, frames: result }));
      });
    });
    return { url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`, submits };
  }

  /** A fixture HOME whose launcher prints the box settings (the box at `url`) and a token file beside it. */
  function fixtureHome(url: string): string {
    const home = mkTmp('ccrc-frames-local-arm-');
    mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
    const launcher = path.join(home, '.local', 'bin', 'ccrc');
    writeFileSync(launcher, ['#!/bin/sh', 'while IFS= read -r l || [ -n "$l" ]; do printf \'%s\\n\' "$l"; done < "$HOME/knobs.out"', ''].join('\n'));
    chmodSync(launcher, 0o755);
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'testbox.token'), 'fixture-token\n');
    writeFileSync(path.join(home, 'knobs.out'), [
      ['CCRC_TESTBOX_URL', '', url, 'the fixture'],
      ['CCRC_TESTBOX_TOKEN_FILE', '~/.ccrc/testbox.token', '~/.ccrc/testbox.token', 'default'],
      ['CCRC_TESTBOX_STATUS_DEADLINE', '3s', '1s', 'the fixture'],
      ['CCRC_TESTBOX_POLL', '30s', '45s', 'the fixture'],
    ].map((f) => f.join(US)).join('\n') + '\n');
    return home;
  }

  it('a frames part sent through localIOFor reaches the lane, is checked, is stored clear with its text, and the read serves it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const text = ['─'.repeat(60), '❯ frames row 001 of 003 abcdefghij', '─'.repeat(60), `  ${FRAMES_STATUS_TEXT}`, '  ? for shortcuts'].join('\n') + '\n';
    const box = await standInBox(text);
    const home = fixtureHome(box.url);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    closers.push(async () => { coord.db.close(); });
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    // A fresh store trusts its newest passed build; with every delivery part measured, the pass goes on to frames.
    const build = '2.1.302';
    for (let p = 0; p < DELIVERY_PART_COUNT; p++) coord.recordDelivery(deliveryResultFor(build, p), 1);
    let clock = 1_000_000_000_000;
    const lane = new BuildCaptureLane(() => ({ coord, notifyLog, buildCapture: testboxCaptureTransport(() => localIOFor(home)), masker: undefined }), () => clock);
    clock += BUILD_CAPTURE_SWEEP_MS;
    await lane.sweep([]);
    expect(box.submits).toEqual([{ t: 'capture.submit', captureId: expect.stringMatching(/^[0-9a-f]{32}$/), build, recipe: 'frames', part: 0 }]);
    expect(coord.claudeBuildFrames()).toMatchObject([{ build, part: 0, word: 'framed', checked: 'clear', text }]);
    const app = Fastify({ logger: false });
    closers.push(() => app.close());
    registerTestboxFramesRoute(app, { frames: () => coord.claudeBuildFrames(), session: () => true, boxToken: () => false, masker: { maskText: (t: string) => t } });
    const r = await app.inject({ method: 'GET', url: `/api/testbox/frames?build=${build}&frame=${framesFrameId(FRAMES_PARTS[0]!)}` });
    expect([r.statusCode, r.json().text]).toEqual([200, text]);
  });
});


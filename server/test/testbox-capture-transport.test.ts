// The build capture runner's transport adapter (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.5,
// Table 6): `server/src/testboxCapture.ts#testboxCaptureTransport` maps every answer of `FleetIO.testboxCapture` onto the
// port the lane reads, one case per row; and the remote arm of that member (`remote/io.ts`) gates on `ready.ops`, sends the
// one request frame and refuses a reply off the op's reader. Nothing reaches a box: the io is a fake.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testboxCaptureTransport } from '../src/testboxCapture.js';
import type { CaptureAsked } from '../src/io.js';
import { createIo } from '../src/remote/io.js';
import {
  TESTBOX_CAPTURE_OP, TESTBOX_CAPTURE_REQUEST_MS, type TestboxCaptureOutcome, type TestboxCaptureReply,
} from '../../shared/agent-protocol.js';
import type { CaptureRefusal } from '../../shared/claudeBuildCapture.js';
import type { BuildCaptureResult } from '../../shared/claudeBuildTrust.js';

const BUILD = '2.1.320';
const RESULT: BuildCaptureResult = { build: BUILD, pass: true, cwd: true, output: 'verdict: pass (40 records)' };
const reply = (outcome: TestboxCaptureOutcome, over: Partial<TestboxCaptureReply> = {}): CaptureAsked => ({
  ok: true, reply: { outcome, refusal: null, result: null, detail: null, ...over },
});
const refused = (refusal: CaptureRefusal): CaptureAsked => reply('refused', { refusal, detail: `refused: ${refusal}` });
const via = (asked: CaptureAsked | Error) => testboxCaptureTransport(() => ({
  testboxCapture: async () => { if (asked instanceof Error) throw asked; return asked; },
}));
const run = (asked: CaptureAsked | Error) => via(asked).capture({ build: BUILD });
const un = (why: 'no-test-box' | 'no-runner' | 'unanswered') => ({ kind: 'unavailable', why });

afterEach(() => { vi.restoreAllMocks(); });

describe('testboxCaptureTransport: spec Table 6, one case per row', () => {
  it('the seam says the agent has no op: no-runner', async () => { expect(await run({ ok: false, reason: 'no-op' })).toEqual(un('no-runner')); });
  it('the seam says the job went unanswered: unanswered', async () => { expect(await run({ ok: false, reason: 'unanswered' })).toEqual(un('unanswered')); });
  it.each(['unconfigured', 'unreachable', 'bad-answer'] as const)('%s: no-test-box', async (o) => {
    expect(await run(reply(o, { detail: 'why' }))).toEqual(un('no-test-box'));
  });
  it('not-taken: no-runner', async () => { expect(await run(reply('not-taken'))).toEqual(un('no-runner')); });
  it('refused not-test-box: no-test-box', async () => { expect(await run(refused('not-test-box'))).toEqual(un('no-test-box')); });
  it('refused no-runner: no-runner, and no warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await run(refused('no-runner'))).toEqual(un('no-runner'));
    expect(warn).not.toHaveBeenCalled();
  });
  it.each(['build-absent', 'path-refused'] as const)('refused %s: no-runner plus one warning naming the refusal', async (r) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await run(refused(r))).toEqual(un('no-runner'));
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain('ccrc-server: build capture:');
    expect(line).toContain(r);
    expect(line).toContain(BUILD);
  });
  it('refused capture-id-used: unanswered (a job went out)', async () => { expect(await run(refused('capture-id-used'))).toEqual(un('unanswered')); });
  it('answered with a result: answered, the result handed on unread', async () => {
    expect(await run(reply('answered', { result: RESULT }))).toEqual({ kind: 'answered', result: RESULT });
  });
  it('answered with no verdict: unanswered', async () => { expect(await run(reply('answered', { detail: 'the run timed out' }))).toEqual(un('unanswered')); });
  it('unanswered: unanswered', async () => { expect(await run(reply('unanswered'))).toEqual(un('unanswered')); });
  it('a refusal the table does not know (a reply forged past the reader): unanswered, never trusted', async () => {
    expect(await run(reply('refused', { refusal: null }))).toEqual(un('unanswered'));
  });
  it('a thrown io call: unanswered', async () => { expect(await run(new Error('boom'))).toEqual(un('unanswered')); });
  it('asks for the job build, once', async () => {
    const testboxCapture = vi.fn(async (): Promise<CaptureAsked> => ({ ok: false, reason: 'no-op' }));
    await testboxCaptureTransport(() => ({ testboxCapture })).capture({ build: BUILD });
    expect(testboxCapture).toHaveBeenCalledExactlyOnceWith(BUILD);
  });
});

describe('the remote arm of FleetIO.testboxCapture', () => {
  const GOOD = { outcome: 'answered', refusal: null, result: RESULT, detail: null };
  it('sends nothing to an agent whose ready list lacks the op: no-op', async () => {
    const request = vi.fn();
    const io = createIo({ state: { agentOps: ['testbox'] }, request } as never);
    expect(await io.testboxCapture(BUILD)).toEqual({ ok: false, reason: 'no-op' });
    expect(request).not.toHaveBeenCalled();
  });
  it('sends the one request frame, with the long deadline, and returns the reader\'s reply', async () => {
    const request = vi.fn(async () => GOOD);
    const io = createIo({ state: { agentOps: [TESTBOX_CAPTURE_OP] }, request } as never);
    expect(await io.testboxCapture(BUILD)).toEqual({ ok: true, reply: GOOD });
    expect(request).toHaveBeenCalledExactlyOnceWith({ t: 'req', op: TESTBOX_CAPTURE_OP, build: BUILD }, TESTBOX_CAPTURE_REQUEST_MS);
  });
  it('a malformed reply is unanswered, never a made-up one', async () => {
    for (const bad of [{ outcome: 'answered' }, { ...GOOD, outcome: 'nope' }, { ...GOOD, result: { ...RESULT, build: '2.1.999' } }, null, 'x']) {
      const io = createIo({ state: { agentOps: [TESTBOX_CAPTURE_OP] }, request: async () => bad } as never);
      expect(await io.testboxCapture(BUILD)).toEqual({ ok: false, reason: 'unanswered' });
    }
  });
  it('a wire fault is unanswered', async () => {
    const io = createIo({ state: { agentOps: [TESTBOX_CAPTURE_OP] }, request: async () => { throw new Error('disconnected'); } } as never);
    expect(await io.testboxCapture(BUILD)).toEqual({ ok: false, reason: 'unanswered' });
  });
});

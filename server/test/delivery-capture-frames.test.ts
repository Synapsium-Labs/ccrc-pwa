// The capture contract's delivery recipe (Desktop polish wave 178; the capture owner's yes, call 1135): the submission's
// optional recipe, the state frame's `delivery`, the op reply's reader in both directions, and the capture's own terminal
// names, now defined once in the shared contract. Absence is build trust everywhere, and build trust reads as before.
import { describe, expect, it } from 'vitest';
import { readTestboxCaptureReply } from '../../shared/agent-protocol.js';
import { CAPTURE_SOCKET, CAPTURE_TMUX_SESSION, captureRecipeOf, captureTmuxDirName } from '../../shared/claudeBuildCapture.js';
import { deliveryCaptureResult, deliveryCaseResult, deliveryExpected } from '../../shared/deliveryCapture.js';
import { DELIVERY_CASE_IDS } from '../../shared/deliveryResult.js';
import { RUN_ID, readTestboxFrame } from '../../shared/testbox.js';

const BUILD = '2.1.320';
const ID = '0123456789abcdef0123456789abcdef';
const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const RESULT = wire(deliveryCaptureResult(BUILD, DELIVERY_CASE_IDS.map((id) => deliveryCaseResult(id, { send: 'ok', turns: [deliveryExpected(id)], sideRequests: 0, hookPrompts: [] }))));
const TRUST = { build: BUILD, pass: true, cwd: true, output: 'verdict: pass' };
const read = (frame: Record<string, unknown>) => readTestboxFrame(JSON.stringify(frame));
const state = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ t: 'capture.state', captureId: ID, build: BUILD, state: 'ended', refusal: null, detail: null, position: null, result: null, ...over });

describe('the submission: absence is build trust, its one spelling', () => {
  it('a submission with no recipe reads as before, with no recipe field', () => {
    const r = read({ t: 'capture.submit', captureId: ID, build: BUILD });
    expect(r).toEqual({ ok: true, value: { t: 'capture.submit', captureId: ID, build: BUILD } });
    expect(captureRecipeOf(r.ok ? (r.value as { recipe?: 'delivery' }) : {})).toBe('build-trust');
  });
  it('a delivery submission carries its recipe', () => {
    const r = read({ t: 'capture.submit', captureId: ID, build: BUILD, recipe: 'delivery' });
    expect(r).toEqual({ ok: true, value: { t: 'capture.submit', captureId: ID, build: BUILD, recipe: 'delivery' } });
    expect(captureRecipeOf({ recipe: 'delivery' })).toBe('delivery');
  });
  it.each(['build-trust', 'trust', '', null, 1])('refuses the recipe %j: only delivery is ever spelled', (recipe) => {
    expect(read({ t: 'capture.submit', captureId: ID, build: BUILD, recipe }).ok).toBe(false);
  });
});

describe('the state frame: delivery on a delivery capture\'s frames only', () => {
  it('a build-trust frame with no delivery field reads as before', () => {
    const r = read(state({ result: TRUST }));
    expect(r.ok && r.value).toEqual(state({ result: TRUST }));
    expect(r.ok && 'delivery' in r.value).toBe(false);
  });
  it('a delivery capture\'s queued, running and refused frames carry delivery: null', () => {
    expect(read(state({ state: 'queued', position: 1, delivery: null })).ok).toBe(true);
    expect(read(state({ state: 'running', delivery: null })).ok).toBe(true);
    expect(read(state({ state: 'refused', refusal: 'no-runner', detail: 'x', delivery: null })).ok).toBe(true);
  });
  it('an ended delivery capture carries its result, read by the result\'s one reader', () => {
    const r = read(state({ delivery: RESULT }));
    expect(r.ok && (r.value as { delivery?: unknown }).delivery).toEqual(RESULT);
  });
  it('an ended delivery capture with no verdict carries delivery: null and its detail', () => {
    expect(read(state({ delivery: null, detail: 'the driver could not start' })).ok).toBe(true);
  });
  it.each<[string, Record<string, unknown>]>([
    ['a result on a running capture', state({ state: 'running', delivery: RESULT })],
    ['a build-trust verdict on a delivery capture', state({ result: TRUST, delivery: null })],
    ['a detail beside a delivery result', state({ delivery: RESULT, detail: 'x' })],
    ['a delivery result for another build', state({ build: '2.1.321', delivery: RESULT })],
    ['a delivery result off its shape', state({ delivery: { ...(RESULT as object), word: 'fault' } })],
  ])('refuses %s', (_why, frame) => {
    expect(read(frame).ok).toBe(false);
  });
});

describe('the op\'s reply reader, in both directions (call 1135, condition 1)', () => {
  const reply = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ outcome: 'answered', refusal: null, result: null, detail: null, ...over });
  it('a build-trust reply reads as before', () => {
    expect(readTestboxCaptureReply(reply({ result: TRUST }), BUILD)).toMatchObject({ outcome: 'answered', result: { pass: true } });
  });
  it('a build-trust request whose reply names delivery is no answer to trust, whatever delivery holds', () => {
    expect(readTestboxCaptureReply(reply({ delivery: null }), BUILD)).toBeNull();
    expect(readTestboxCaptureReply(reply({ delivery: RESULT }), BUILD)).toBeNull();
    expect(readTestboxCaptureReply(reply({ result: TRUST, delivery: null }), BUILD, 'build-trust')).toBeNull();
  });
  it('a delivery request reads its result, echoing the recipe', () => {
    const r = readTestboxCaptureReply(reply({ delivery: RESULT }), BUILD, 'delivery');
    expect(r?.delivery).toEqual(RESULT);
    expect(r?.result).toBeNull();
  });
  it('a delivery request\'s no-verdict and not-sent replies carry delivery: null', () => {
    expect(readTestboxCaptureReply(reply({ delivery: null, detail: 'x' }), BUILD, 'delivery')).toMatchObject({ delivery: null });
    expect(readTestboxCaptureReply({ outcome: 'unreachable', refusal: null, result: null, detail: 'x', delivery: null }, BUILD, 'delivery')).toMatchObject({ outcome: 'unreachable' });
  });
  it.each<[string, Record<string, unknown>]>([
    ['no delivery field (an answer that does not echo the recipe)', reply()],
    ['a build-trust verdict', reply({ result: TRUST, delivery: null })],
    ['a result on an outcome that is not answered', { outcome: 'refused', refusal: 'no-runner', result: null, detail: 'x', delivery: RESULT }],
    ['a result off its shape', reply({ delivery: { ...(RESULT as object), recipe: 'build-trust' } })],
    ['a result for another build', reply({ delivery: wire(deliveryCaptureResult('2.1.321', [])) })],
  ])('a delivery request refuses %s', (_why, raw) => {
    expect(readTestboxCaptureReply(raw, BUILD, 'delivery')).toBeNull();
  });
});

describe('the capture\'s own terminal names: one definition, in the contract', () => {
  it('the private server, its session and the tmux directory\'s base name', () => {
    expect(CAPTURE_SOCKET).toBe('ccrc-capture');
    expect(CAPTURE_TMUX_SESSION).toBe('capture');
    expect(captureTmuxDirName(ID)).toBe(`ccrc-capture-${ID}`);
  });
  it('a capture id is 32 lowercase hex characters, the run id\'s shape', () => {
    expect(RUN_ID.test(ID)).toBe(true);
    expect(RUN_ID.test(ID.toUpperCase())).toBe(false);
    expect(RUN_ID.test(`${ID}0`)).toBe(false);
  });
});

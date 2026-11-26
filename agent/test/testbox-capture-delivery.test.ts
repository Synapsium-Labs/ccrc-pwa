// The paste delivery recipe's pure part on the capture runner (`agent/src/testbox/captureDelivery.ts`, Desktop polish wave
// 178): the drive's shared steps, the stand-in's reply, one case's window, and the worst case under the fleet agent's
// fixed wait.
import { describe, expect, it } from 'vitest';
import { TESTBOX_CAPTURE_DEADLINE_MS } from '../../shared/agent-protocol.js';
import { deliveryCaseResult, deliveryExpected } from '../../shared/deliveryCapture.js';
import type { CaptureRecord } from '../../shared/claudeBuildCapture.js';
import { DELIVERY_CASE_IDS, DELIVERY_PART_COUNT, deliveryParts } from '../../shared/deliveryResult.js';
import { CAPTURE_DEADLINE_MARGIN_MS, CAPTURE_STEPS, CAPTURE_TIMINGS, captureWorstCaseMs, standInReply } from '../src/testbox/capture.js';
import {
  DELIVERY_PANE, DELIVERY_REPLY_TEXT, DELIVERY_STEPS_BEFORE, DELIVERY_STEP_AFTER, deliveryStandInReply,
  DELIVERY_PART_LARGEST, deliveryPartCount, deliveryStartsLate, deliveryWorstCaseMs, observeWindow, turnEnded,
} from '../src/testbox/captureDelivery.js';

const turn = (prompt: string): Record<string, unknown> => ({ tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: prompt }] });
const side = (prompt: string): Record<string, unknown> => ({ messages: [{ role: 'user', content: prompt }] });
const hook = (event: string, payload: Record<string, unknown> = {}): CaptureRecord => ({ kind: 'hook', event, payload, status: null });

describe('the drive shares the build-trust drive\'s steps, unchanged', () => {
  it('the start and the model switch before, /exit after: the same objects', () => {
    expect(DELIVERY_STEPS_BEFORE).toEqual([CAPTURE_STEPS[0], CAPTURE_STEPS[1]]);
    expect(DELIVERY_STEPS_BEFORE[0]).toBe(CAPTURE_STEPS[0]);
    expect(DELIVERY_STEP_AFTER).toBe(CAPTURE_STEPS.at(-1));
    expect(DELIVERY_STEP_AFTER.type).toBe('/exit');
  });
  it('the pane is the fleet\'s size', () => {
    expect(DELIVERY_PANE).toEqual({ cols: 220, rows: 50 });
  });
});

describe('the stand-in\'s delivery reply', () => {
  it('is a short text whatever the request, where build trust would ask for a tool', () => {
    const body = { tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'ccrc capture step one' }] };
    expect(standInReply(body).kind).toBe('tool');
    expect(deliveryStandInReply(body)).toEqual({ kind: 'text', text: DELIVERY_REPLY_TEXT });
    expect(deliveryStandInReply(null)).toEqual({ kind: 'text', text: DELIVERY_REPLY_TEXT });
  });
});

describe('observeWindow: one case\'s window', () => {
  it('counts each turn and each side request by its route, and reads the hooks\' prompts', () => {
    const o = observeWindow('ok', [side('a title'), turn('the prompt'), side('x')], ['messages', 'messages', 'count_tokens'], [hook('UserPromptSubmit', { prompt: 'the prompt' }), hook('Stop')]);
    expect(o).toEqual({ send: 'ok', turns: ['the prompt'], sideRequests: { messages: 1, count_tokens: 1 }, hookPrompts: ['the prompt'] });
  });
  it('two turns in one window are both kept, in arrival order', () => {
    expect(observeWindow('ok', [turn('a'), turn('b')], ['messages', 'messages'], [])?.turns).toEqual(['a', 'b']);
  });
  it('a count_tokens request shaped exactly like a turn is a side request, never a turn (review 3882 F4)', () => {
    const o = observeWindow('ok', [turn('the prompt'), turn('the prompt')], ['messages', 'count_tokens'], []);
    expect(o).toMatchObject({ turns: ['the prompt'], sideRequests: { messages: 0, count_tokens: 1 } });
    const c0 = deliveryCaseResult('c0', { ...o!, turns: [deliveryExpected('c0')] });
    expect(c0.verdict).toBe('intact');
    expect(c0.sideRequests).toEqual({ messages: 0, count_tokens: 1 });
  });
  it('a request with no route is a fault of the box: no window to judge', () => {
    expect(observeWindow('ok', [turn('a'), turn('a')], ['messages'], [])).toBeNull();
  });
  it('a hook with no string prompt, a statusline and another event add no prompt', () => {
    const records: CaptureRecord[] = [hook('UserPromptSubmit', {}), { kind: 'statusline', payload: {}, status: null }, hook('Stop', { prompt: 'x' })];
    expect(observeWindow('ok', [], [], records)?.hookPrompts).toEqual([]);
  });
  it('a turn ends at a Stop or a StopFailure', () => {
    expect(turnEnded([hook('UserPromptSubmit')])).toBe(false);
    expect(turnEnded([hook('Stop')])).toBe(true);
    expect(turnEnded([hook('StopFailure')])).toBe(true);
  });
});

describe('the worst case, under the fleet agent\'s fixed wait', () => {
  it('one delivery capture of its largest part fits the wait with the margin, as the deadline stands', () => {
    const worst = deliveryWorstCaseMs(CAPTURE_TIMINGS);
    expect(worst + CAPTURE_DEADLINE_MARGIN_MS).toBeLessThanOrEqual(TESTBOX_CAPTURE_DEADLINE_MS);
    expect(deliveryStartsLate(0, CAPTURE_TIMINGS)).toBe(false);
  });
  it('the worst case is its formula: the start, the two steps before, each case, the last case\'s trailing window, /exit, the exit wait and the teardown', () => {
    const t = CAPTURE_TIMINGS;
    const call = t.tmuxCallMs + 2_000;
    const expected = t.setupMs + call
      + (t.stepMs + t.pollMs) + (2 * call + t.stepMs + t.pollMs)
      + DELIVERY_PART_LARGEST * (t.deliveryDriveMs + t.deliveryKillGraceMs + 2_000 + t.deliverySettleMs + t.pollMs + t.deliveryQuietMs + t.pollMs)
      + t.deliverySettleMs + t.pollMs
      + (2 * call + t.stepMs + t.pollMs)
      + t.exitMs + t.pollMs
      + call + t.stopWaitMs + t.pollMs + t.standInCloseMs + t.removeMs;
    expect(deliveryWorstCaseMs(t)).toBe(expected);
  });
  it('grows with each case and each bound, so a longer case list or bound is seen', () => {
    const base = deliveryWorstCaseMs(CAPTURE_TIMINGS);
    expect(deliveryWorstCaseMs(CAPTURE_TIMINGS, DELIVERY_PART_LARGEST + 1)).toBeGreaterThan(base);
    for (const k of ['deliveryDriveMs', 'deliveryKillGraceMs', 'deliverySettleMs', 'deliveryQuietMs'] as const) {
      expect(deliveryWorstCaseMs({ ...CAPTURE_TIMINGS, [k]: CAPTURE_TIMINGS[k] + 1 }), k).toBe(base + DELIVERY_PART_LARGEST + (k === 'deliverySettleMs' ? 1 : 0));
    }
  });
  it('a capture that waited long enough to end past the wait does not start', () => {
    const worst = deliveryWorstCaseMs(CAPTURE_TIMINGS);
    const room = TESTBOX_CAPTURE_DEADLINE_MS - CAPTURE_DEADLINE_MARGIN_MS - worst;
    expect(deliveryStartsLate(room, CAPTURE_TIMINGS)).toBe(false);
    expect(deliveryStartsLate(room + 1, CAPTURE_TIMINGS)).toBe(true);
  });
  it('a delivery part\'s worst case is not build trust\'s (401 s against 399.5 s today), so it has its own late check', () => {
    expect(deliveryWorstCaseMs(CAPTURE_TIMINGS)).toBe(401_000);
    expect(captureWorstCaseMs(CAPTURE_TIMINGS)).toBe(399_500);
  });
});

// The shared count held equal to this derivation, and every pairing at that count, are gate G1's, in
// `testbox-capture-deadline.test.ts` beside the build-trust pair (the capture owner's call 1159).
describe('the parts: their count derived from the pair bound (call 1148)', () => {
  const fits = (a: number, b: number): boolean => a + b + CAPTURE_DEADLINE_MARGIN_MS <= TESTBOX_CAPTURE_DEADLINE_MS;
  const trust = captureWorstCaseMs(CAPTURE_TIMINGS);
  const partMs = (k: number): number => deliveryWorstCaseMs(CAPTURE_TIMINGS, Math.ceil(DELIVERY_CASE_IDS.length / k));
  it('the largest part is the first, and the worst case counts it', () => {
    expect(DELIVERY_PART_LARGEST).toBe(Math.max(...deliveryParts().map((p) => p.length)));
    expect(partMs(DELIVERY_PART_COUNT)).toBe(deliveryWorstCaseMs(CAPTURE_TIMINGS));
  });
  it('one part fewer does not fit: the count is the smallest', () => {
    const fewer = partMs(DELIVERY_PART_COUNT - 1);
    expect(fits(trust, fewer) && fits(fewer, fewer)).toBe(false);
  });
  it('a longer case or a longer bound re-derives the count: more parts, never a pair past the wait', () => {
    expect(deliveryPartCount({ ...CAPTURE_TIMINGS, deliverySettleMs: CAPTURE_TIMINGS.deliverySettleMs + 20_000 })).toBeGreaterThan(DELIVERY_PART_COUNT);
    expect(deliveryPartCount(CAPTURE_TIMINGS, 30)).toBeGreaterThan(DELIVERY_PART_COUNT);
  });
  it('no count at all when even a one-case part cannot fit beside trust', () => {
    expect(deliveryPartCount({ ...CAPTURE_TIMINGS, stepMs: 200_000 })).toBeNull();
  });
});

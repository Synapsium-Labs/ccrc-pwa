// The paste delivery recipe's pure part on the capture runner (`agent/src/testbox/captureDelivery.ts`, Desktop polish wave
// 178): the drive's shared steps, the stand-in's reply, one case's window, and the worst case under the fleet agent's
// fixed wait.
import { describe, expect, it } from 'vitest';
import { TESTBOX_CAPTURE_DEADLINE_MS } from '../../shared/agent-protocol.js';
import type { CaptureRecord } from '../../shared/claudeBuildCapture.js';
import { DELIVERY_CASE_IDS } from '../../shared/deliveryResult.js';
import { CAPTURE_DEADLINE_MARGIN_MS, CAPTURE_STEPS, CAPTURE_TIMINGS, captureWorstCaseMs, standInReply } from '../src/testbox/capture.js';
import {
  DELIVERY_PANE, DELIVERY_REPLY_TEXT, DELIVERY_STEPS_BEFORE, DELIVERY_STEP_AFTER, DELIVERY_TIMINGS, deliveryStandInReply,
  deliveryStartsLate, deliveryWorstCaseMs, observeWindow, turnEnded,
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
  it('counts each turn and each side request, and reads the hooks\' prompts', () => {
    const o = observeWindow('ok', [side('a title'), turn('the prompt'), side('x')], [hook('UserPromptSubmit', { prompt: 'the prompt' }), hook('Stop')]);
    expect(o).toEqual({ send: 'ok', turns: ['the prompt'], sideRequests: 2, hookPrompts: ['the prompt'] });
  });
  it('two turns in one window are both kept, in arrival order', () => {
    expect(observeWindow('ok', [turn('a'), turn('b')], []).turns).toEqual(['a', 'b']);
  });
  it('a hook with no string prompt, a statusline and another event add no prompt', () => {
    const records: CaptureRecord[] = [hook('UserPromptSubmit', {}), { kind: 'statusline', payload: {}, status: null }, hook('Stop', { prompt: 'x' })];
    expect(observeWindow('ok', [], records).hookPrompts).toEqual([]);
  });
  it('a turn ends at a Stop or a StopFailure', () => {
    expect(turnEnded([hook('UserPromptSubmit')])).toBe(false);
    expect(turnEnded([hook('Stop')])).toBe(true);
    expect(turnEnded([hook('StopFailure')])).toBe(true);
  });
});

describe('the worst case, under the fleet agent\'s fixed wait', () => {
  it('one delivery capture of every case fits the wait with the margin, as the deadline stands', () => {
    const worst = deliveryWorstCaseMs(CAPTURE_TIMINGS);
    expect(worst + CAPTURE_DEADLINE_MARGIN_MS).toBeLessThanOrEqual(TESTBOX_CAPTURE_DEADLINE_MS);
    expect(deliveryStartsLate(0, CAPTURE_TIMINGS)).toBe(false);
  });
  it('the worst case is its formula: the start, the two steps before, each case, /exit, the exit wait and the teardown', () => {
    const t = CAPTURE_TIMINGS;
    const d = DELIVERY_TIMINGS;
    const call = t.tmuxCallMs + 2_000;
    const expected = t.setupMs + call
      + (t.stepMs + t.pollMs) + (2 * call + t.stepMs + t.pollMs)
      + DELIVERY_CASE_IDS.length * (d.driveMs + 2_000 + d.settleMs + t.pollMs + d.quietMs + t.pollMs)
      + (2 * call + t.stepMs + t.pollMs)
      + t.exitMs + t.pollMs
      + call + t.stopWaitMs + t.pollMs + t.standInCloseMs + t.removeMs;
    expect(deliveryWorstCaseMs(t, d)).toBe(expected);
  });
  it('grows with each case and each bound, so a longer case list or bound is seen', () => {
    const base = deliveryWorstCaseMs(CAPTURE_TIMINGS);
    expect(deliveryWorstCaseMs(CAPTURE_TIMINGS, DELIVERY_TIMINGS, DELIVERY_CASE_IDS.length + 1)).toBeGreaterThan(base);
    expect(deliveryWorstCaseMs(CAPTURE_TIMINGS, { ...DELIVERY_TIMINGS, settleMs: DELIVERY_TIMINGS.settleMs + 1 })).toBe(base + DELIVERY_CASE_IDS.length);
  });
  it('a capture that waited long enough to end past the wait does not start', () => {
    const worst = deliveryWorstCaseMs(CAPTURE_TIMINGS);
    const room = TESTBOX_CAPTURE_DEADLINE_MS - CAPTURE_DEADLINE_MARGIN_MS - worst;
    expect(deliveryStartsLate(room, CAPTURE_TIMINGS)).toBe(false);
    expect(deliveryStartsLate(room + 1, CAPTURE_TIMINGS)).toBe(true);
  });
  it('the delivery recipe takes longer than build trust, so it has its own late check', () => {
    expect(deliveryWorstCaseMs(CAPTURE_TIMINGS)).toBeGreaterThan(captureWorstCaseMs(CAPTURE_TIMINGS));
  });
});

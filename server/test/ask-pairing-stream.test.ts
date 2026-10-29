// Task Q3g's characterization pin (D-7031; ARCH-58 (#793), server half; plan 2026-10-26-consolidation-w3-questions.md,
// Task Q3g Step 1). The session stream's `dialog`/`dialog_cleared`/`ask`/`ask_cleared` frames for Step 1's event orders,
// recorded as bytes on `main` before the pairing exists: each frame's step, type and the sha256 of its JSON. The pairing
// rides those frames as an optional top-level field, so the bytes are taken with a top-level `pairing` key off
// (`withoutPairing`) and nothing else: a frame that gains, loses or reorders, a byte that changes anywhere else, or a
// `pairing` placed inside `dialog`, reds a row here. Where a frame does carry `pairing`, it is Q3a's table's answer for
// the pane and the envelope on screen (`ask-pairing-table.test.ts`), and an approval's frame never carries one.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { SessionStreamMsg } from '../../shared/api.js';
import { SCENARIOS, TRANSCRIPT_SEQUENCES, runScenario, runSequence, tablePairing, withoutPairing, type Scenario, type Sent } from './askPairingStream.js';

const sha = (f: SessionStreamMsg): string => createHash('sha256').update(JSON.stringify(withoutPairing(f))).digest('hex').slice(0, 16);

/** Recorded on `main` (46f59a9bd), before Task Q3g: `[step, type, sha256(JSON without pairing)[0..16]]`. Step 0 is the
 *  connect's opening reading of step 1's state. */
const RECORDED: Record<string, [number, string, string][]> = {
  'dialog first': [[0, 'dialog', '978f27d4301fa785'], [0, 'ask_cleared', '3b6f72dc2e5480e6'], [2, 'ask', '21a166acc84e4230']],
  'envelope first': [[0, 'ask', '21a166acc84e4230'], [2, 'dialog', '978f27d4301fa785']],
  'envelope changed under the same dialog': [[0, 'dialog', '978f27d4301fa785'], [0, 'ask', '21a166acc84e4230'], [2, 'ask', 'fefdab089d53ef7d']],
  'dialog repainted unparsed': [[0, 'dialog', '8ca2a8578d3a8abd'], [0, 'ask', 'cade7aac9f228622'], [2, 'dialog', '645d641203df7977'],
    [3, 'dialog', '7878e9836e2c5f8f']],
  'both cleared': [[0, 'dialog', '978f27d4301fa785'], [0, 'ask', '21a166acc84e4230'], [2, 'dialog_cleared', '0be2181633992e7b'],
    [2, 'ask_cleared', '3b6f72dc2e5480e6']],
  'an approval envelope under a menu': [[0, 'dialog', '978f27d4301fa785'], [0, 'ask', '479ddaf5cf7333fe'], [2, 'ask', '21a166acc84e4230'],
    [3, 'ask', '479ddaf5cf7333fe']],
};

const stateAt = (sc: Scenario, step: number) => sc.steps[Math.max(step, 1) - 1]!;

/** Task C7q (D-7206, D-7211): the per-frame pairing check, over the frames as the stream sends them. The envelope a
 *  frame pairs is the one it carries (`ask`), none (`ask_cleared`), or the last one its connection sent (`dialog`). A pairing with a
 *  usable question envelope is the hook's: Q3a's table row for the pane and that envelope, no `from`. RE-POINTED by
 *  C7q's wire row (listed in its PR): "a pairing with no question envelope" became "a pairing with no usable question
 *  envelope is `from: 'transcript'` and equals `tablePairing` over the pane's copy". */
function checkPairings(sc: Scenario, frames: readonly Sent[]): void {
  let sent: Scenario['steps'][number]['envelope'] = null;
  let on = 0;
  for (const { step, frame, conn } of frames) {
    // A new connection is a new stream: it has sent no envelope yet.
    if ((conn ?? 0) !== on) { on = conn ?? 0; sent = null; }
    if (frame.type === 'ask') sent = stateAt(sc, step).envelope;
    else if (frame.type === 'ask_cleared') sent = null;
    const pairing = (frame as { pairing?: unknown }).pairing;
    if (pairing === undefined) continue;
    const { pane, copy } = stateAt(sc, step);
    expect(pane, `${sc.name}: a pairing with no pane`).not.toBeNull();
    expect(sent === 'APPROVAL', `${sc.name}: a pairing under an approval`).toBe(false);
    if (sent !== null && sent !== 'BLANK') {
      expect(pairing, `${sc.name} step ${step} ${frame.type}`).toEqual(tablePairing(pane!, sent));
    } else {
      expect(copy, `${sc.name}: a pairing with no usable question envelope pairs the pane's copy`).toEqual(expect.any(String));
      expect(pairing, `${sc.name} step ${step} ${frame.type}: from the transcript's copy`).toEqual({ ...(tablePairing(pane!, copy!) as object), from: 'transcript' });
    }
  }
}

describe('the session stream\'s pane and envelope frames, per event order (Task Q3g characterization)', () => {
  it.each(SCENARIOS.map((sc) => [sc.name, sc] as const))('%s: the frames, their order and their bytes', async (_n, sc) => {
    const frames = await runScenario(sc);
    expect(frames.map(({ step, frame }) => [step, frame.type, sha(frame)])).toEqual(RECORDED[sc.name]);
    checkPairings(sc, frames);
  }, 30_000);
});

// Task C7q's frame-sequence rows (D-7211, D-7220; plan 2026-10-27-consolidation-w7-pwa.md, Task C7q): the transcript
// copy's sequences on the same real `SessionStream`. Their bytes, taken with `pairing` off, were recorded on the base
// (`67ebe5015`) before the copy's pairing existed, so the pairing is the only thing C7q changes on them; and each frame's
// `pairing` is named: the hook's (Q3a's table row for the pane and the envelope sent), the transcript copy's
// (`from: 'transcript'`, the table row for the pane and the copy's envelope), or none. An answer's reply body (sequence
// (e)) carries no pairing: the stream's `dialog` frame for `next` does.
const RECORDED_SEQUENCES: Record<string, (string | number)[][]> = {
  '(a) connect with a copy and no envelope': [[0, 'dialog', 'd0ee45933a7ce6bb'], [0, 'ask_cleared', '3b6f72dc2e5480e6']],
  '(b) an envelope ageing out under a standing menu': [[0, 'dialog', 'd0ee45933a7ce6bb'], [0, 'ask', '21a166acc84e4230'], [2, 'ask_cleared', '3b6f72dc2e5480e6']],
  '(c) a reconnect mid-ask, with an envelope': [[0, 'dialog', 'd0ee45933a7ce6bb'], [0, 'ask', '21a166acc84e4230'], [2, 'dialog', 'd0ee45933a7ce6bb', 1],
    [2, 'ask', '21a166acc84e4230', 1]],
  '(c) a reconnect mid-ask, without an envelope': [[0, 'dialog', 'd0ee45933a7ce6bb'], [0, 'ask', '21a166acc84e4230'], [2, 'ask_cleared', '3b6f72dc2e5480e6'],
    [3, 'dialog', 'd0ee45933a7ce6bb', 1], [3, 'ask_cleared', '3b6f72dc2e5480e6', 1]],
  '(a) connect with a blank envelope and a copy': [[0, 'dialog', 'd0ee45933a7ce6bb'], [0, 'ask', '5069f03fafd757a3']],
  '(d) a menu with no readable copy, then the envelope clearing': [[0, 'dialog', '978f27d4301fa785'], [0, 'ask', '21a166acc84e4230'], [2, 'ask_cleared', '3b6f72dc2e5480e6']],
  '(e) an answer that moves the pane to the next question': [[0, 'dialog', '5b34ea2d380b265d'], [0, 'ask', 'fefdab089d53ef7d'], [2, 'dialog', '0356e8e23e5826fc']],
  '(e) an answer whose next is no menu': [[0, 'dialog', '5b34ea2d380b265d'], [0, 'ask', 'fefdab089d53ef7d'], [2, 'dialog_cleared', '0be2181633992e7b']],
  '(e) a dialog_cleared before the answer settles': [[0, 'dialog', '5b34ea2d380b265d'], [0, 'ask', 'fefdab089d53ef7d'], [2, 'dialog_cleared', '0be2181633992e7b'],
    [3, 'dialog', '0356e8e23e5826fc']],
};

type Named = null | ['hook' | 'transcript', string, string];
const H = (pane: string, env: string): Named => ['hook', pane, env];
const T = (pane: string, copy: string): Named => ['transcript', pane, copy];
const Q1 = 'cc300-ask-1q-open';
const HELD = 'cc300-ask-freetext-held';
const Q2 = 'cc300-ask-q2-of-2-single';
/** Per sequence, per frame sent: the pairing it carries. */
const SEQUENCE_PAIRINGS: Record<string, Named[]> = {
  '(a) connect with a copy and no envelope': [T(Q1, 'COLOUR_ONE'), T(Q1, 'COLOUR_ONE')],
  '(b) an envelope ageing out under a standing menu': [T(Q1, 'COLOUR_ONE'), H(Q1, 'COLOUR_ONE'), T(Q1, 'COLOUR_ONE')],
  '(c) a reconnect mid-ask, with an envelope': [T(Q1, 'COLOUR_ONE'), H(Q1, 'COLOUR_ONE'), T(Q1, 'COLOUR_ONE'), H(Q1, 'COLOUR_ONE')],
  '(c) a reconnect mid-ask, without an envelope': [T(Q1, 'COLOUR_ONE'), H(Q1, 'COLOUR_ONE'), T(Q1, 'COLOUR_ONE'), T(Q1, 'COLOUR_ONE'), T(Q1, 'COLOUR_ONE')],
  '(a) connect with a blank envelope and a copy': [T(Q1, 'COLOUR_ONE'), T(Q1, 'COLOUR_ONE')],
  '(d) a menu with no readable copy, then the envelope clearing': [null, H(Q1, 'COLOUR_ONE'), null],
  '(e) an answer that moves the pane to the next question': [null, H(HELD, 'FRUIT_DRINK'), H(Q2, 'FRUIT_DRINK')],
  '(e) an answer whose next is no menu': [null, H(HELD, 'FRUIT_DRINK'), null],
  '(e) a dialog_cleared before the answer settles': [null, H(HELD, 'FRUIT_DRINK'), null, H(Q2, 'FRUIT_DRINK')],
};
const named = (n: Named): unknown =>
  n === null ? undefined : n[0] === 'hook' ? tablePairing(n[1], n[2]) : { ...(tablePairing(n[1], n[2]) as object), from: 'transcript' };

describe('the transcript copy\'s frame sequences (Task C7q, D-7211, D-7220)', () => {
  it.each(TRANSCRIPT_SEQUENCES.map((sc) => [sc.name, sc] as const))('%s: the frames, their bytes, and the pairing each carries', async (_n, sc) => {
    const { frames, replies } = await runSequence(sc);
    expect(frames.map(({ step, frame, conn }) => (conn === undefined ? [step, frame.type, sha(frame)] : [step, frame.type, sha(frame), conn])))
      .toEqual(RECORDED_SEQUENCES[sc.name]);
    checkPairings(sc, frames);
    const want = SEQUENCE_PAIRINGS[sc.name]!;
    frames.forEach(({ frame }, i) => {
      const at = `${sc.name}: frame ${i} (${frame.type})`;
      expect((frame as { pairing?: unknown }).pairing, at).toEqual(named(want[i]!));
      if (want[i] === null) expect('pairing' in frame, at).toBe(false);
      if (frame.type === 'dialog') expect('pairing' in frame.dialog, `${at}: never inside dialog`).toBe(false);
    });
    expect(replies.length).toBe(sc.steps.filter((s) => s.answered === true).length);
    for (const r of replies) {
      expect('pairing' in r.body, `${sc.name}: the reply body carries no pairing`).toBe(false);
      const sent = frames.filter((f) => f.step === r.step).at(-1)?.frame;
      if (r.body.next === null) expect(sent?.type, `${sc.name}: next null clears the menu`).toBe('dialog_cleared');
      else expect(sent?.type === 'dialog' ? sent.dialog : null, `${sc.name}: the frame for next carries the reply's next`).toEqual(r.body.next);
    }
  }, 30_000);
});

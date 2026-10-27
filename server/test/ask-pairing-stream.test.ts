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
import { SCENARIOS, runScenario, tablePairing, withoutPairing, type Scenario } from './askPairingStream.js';

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

describe('the session stream\'s pane and envelope frames, per event order (Task Q3g characterization)', () => {
  it.each(SCENARIOS.map((sc) => [sc.name, sc] as const))('%s: the frames, their order and their bytes', async (_n, sc) => {
    const frames = await runScenario(sc);
    expect(frames.map(({ step, frame }) => [step, frame.type, sha(frame)])).toEqual(RECORDED[sc.name]);
    for (const { step, frame } of frames) {
      const pairing = (frame as { pairing?: unknown }).pairing;
      if (pairing === undefined) continue;
      const { pane, envelope } = stateAt(sc, step);
      expect(pane, `${sc.name}: a pairing with no pane`).not.toBeNull();
      expect(envelope === null || envelope === 'APPROVAL', `${sc.name}: a pairing with no question envelope`).toBe(false);
      expect(pairing, `${sc.name} step ${step} ${frame.type}`).toEqual(tablePairing(pane!, envelope!));
    }
  }, 30_000);
});

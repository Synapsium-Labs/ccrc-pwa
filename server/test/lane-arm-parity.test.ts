// Review 3232 F7: the Shadow lanes card's Live (`decideLaneArmPost`) and the coordinator's Live on a W1a row
// (`decideLaneArmCoordLive`) share their row and baseline rules through one helper in `coord/laneArm.ts`. This runs both deciders
// over one input table, so a rule added to one and not the other turns this red. What legitimately differs is left out of the
// table: the card's sign-in and confirm key (given here as signed in, with the key the row binds), and the coordinator door's
// refusal of every row the baseline does not gate.
import { describe, expect, it } from 'vitest';
import { decideLaneArmCoordLive, decideLaneArmPost, laneArmConfirmKey, laneArmRowViewOf, type LaneArmBaseline, type LaneArmRead } from '../src/coord/laneArm.js';
import { W1A_ARM_ROWS } from '../src/continuity/quiz.js';

const rows: readonly [string, LaneArmRead][] = [
  ['shadow', { kind: 'row', choice: 'shadow', updatedAt: 3, importedAt: null, imported: null }],
  ['live', { kind: 'row', choice: 'live', updatedAt: 4, importedAt: null, imported: null }],
  ['unreadable', { kind: 'unreadable', detail: 'the row could not be read: io' }],
];
const baselines: readonly [string, LaneArmBaseline][] = [
  ['exists', { ok: true, exists: true }], ['missing', { ok: true, exists: false }], ['unreadable', { ok: false, detail: 'locked' }],
];
const gates: readonly (string | null)[] = [null, 'the lane is not built yet'];

describe('the two Live deciders agree on every W1a row (review 3232 F7)', () => {
  for (const lane of W1A_ARM_ROWS) {
    for (const [rowName, read] of rows) {
      for (const [baseName, baseline] of baselines) {
        for (const gate of gates) {
          it(`${lane}, row ${rowName}, baseline ${baseName}, gate ${gate === null ? 'none' : 'stands'}`, () => {
            const row = laneArmRowViewOf(lane, read, null);
            const card = decideLaneArmPost({ request: { lane, choice: 'live', confirm: laneArmConfirmKey(row) }, row, signedIn: true, baseline, gate });
            const coord = decideLaneArmCoordLive({ lane, row, baseline, gate });
            const cardWrites = card.kind === 'write';
            expect(coord.kind === 'write', JSON.stringify({ card, coord })).toBe(cardWrites);
            if (!cardWrites) expect(coord).toEqual(card);
          });
        }
      }
    }
  }
});

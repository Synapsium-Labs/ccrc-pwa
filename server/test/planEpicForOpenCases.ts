// The programme work map WM6's decider (D-8780; spec 2026-11-16 Q5, R133): `epicForOpen` in `server/src/coord/planPolicy.ts`,
// the epic a run opens into. Each case is written ONCE here over a module, so `plan-policy.test.ts` runs them against the real
// file and `sim/planEpicWavesSets.ts` against each named mutant (`mutation-floors.test.ts`). Pure data: no database.
import { expect } from 'vitest';
import type { EpicState } from '../../shared/plan.js';

export type PlanPolicyModule = typeof import('../src/coord/planPolicy.js');
export interface EpicForOpenCase { name: string; run(m: PlanPolicyModule): void }

const E = (id: number, waves: number[], state: EpicState = 'active') => ({ id, waves, state });
const MISMATCH = { refused: 'wave-epic-mismatch' };
const REQUIRED = { refused: 'ticket-required' };

export const EPIC_FOR_OPEN_CASES: EpicForOpenCase[] = [
  { name: 'a named ticket of a live epic that lists no waves takes that epic at a wave no epic lists',
    run: (m) => { expect(m.epicForOpen([E(1, [1, 2]), E(2, [])], 9, 2, true)).toEqual({ epicId: 2 }); } },
  // Review 2791 F2: the collision. The ticket's own waveless epic wins over the epic that lists the wave.
  { name: 'a named ticket of a live epic that lists no waves takes that epic, even at a wave another epic lists',
    run: (m) => { expect(m.epicForOpen([E(1, [1, 2]), E(2, [])], 1, 2, true)).toEqual({ epicId: 2 }); } },
  { name: 'the ticket\'s epic is the one that takes the run, not the first epic that lists no waves',
    run: (m) => { expect(m.epicForOpen([E(1, []), E(2, []), E(3, [4])], 9, 2, true)).toEqual({ epicId: 2 }); } },
  { name: 'a settled (done) epic that lists no waves counts as live, for a named ticket and for none (inferred, review 2791 F12)',
    run: (m) => {
      expect(m.epicForOpen([E(1, [1]), E(2, [], 'done')], 9, 2, true)).toEqual({ epicId: 2 });
      expect(m.epicForOpen([E(1, [1]), E(2, [], 'done')], 9, null, false)).toEqual(REQUIRED);
    } },
  { name: 'a ticket of an epic that lists waves, at a wave it does not list, is wave-epic-mismatch beside an epic that lists none',
    run: (m) => { expect(m.epicForOpen([E(1, [1, 2]), E(2, [])], 9, 1, true)).toEqual(MISMATCH); } },
  { name: 'a ticket of an epic that lists the wave takes that epic',
    run: (m) => { expect(m.epicForOpen([E(1, [1, 2]), E(2, [])], 2, 1, true)).toEqual({ epicId: 1 }); } },
  { name: 'a named ticket that is missing names no epic: wave-epic-mismatch at an unlisted wave, never ticket-required',
    run: (m) => { expect(m.epicForOpen([E(1, [1]), E(2, [])], 9, null, true)).toEqual(MISMATCH); } },
  // Review 2791 F5: a dropped epic cannot take a run, whoever holds the ticket.
  { name: 'a named ticket of a dropped epic that lists no waves does not take that epic',
    run: (m) => {
      expect(m.epicForOpen([E(1, [1]), E(2, [], 'dropped')], 9, 2, true)).toEqual(MISMATCH);
      expect(m.epicForOpen([E(1, [1]), E(2, [], 'dropped')], 1, 2, true)).toEqual({ epicId: 1 });
    } },
  { name: 'no ticket and no epic lists the wave: ticket-required where a live epic lists none',
    run: (m) => { expect(m.epicForOpen([E(1, [1]), E(2, [], 'planned')], 9, null, false)).toEqual(REQUIRED); } },
  { name: 'no ticket and no epic lists the wave: wave-epic-mismatch where every epic lists waves',
    run: (m) => { expect(m.epicForOpen([E(1, [1]), E(2, [2, 3])], 9, null, false)).toEqual(MISMATCH); } },
  { name: 'a dropped epic that lists no waves cannot be named, so it does not make the refusal ticket-required',
    run: (m) => { expect(m.epicForOpen([E(1, [1]), E(2, [], 'dropped')], 9, null, false)).toEqual(MISMATCH); } },
  { name: 'a plan with no epic at all is wave-epic-mismatch',
    run: (m) => { expect(m.epicForOpen([], 1, null, false)).toEqual(MISMATCH); } },
  { name: 'no ticket at a wave an epic lists takes that epic, as before, beside an epic that lists none',
    run: (m) => { expect(m.epicForOpen([E(1, [1]), E(2, [])], 1, null, false)).toEqual({ epicId: 1 }); } },
  { name: 'a dropped epic that lists the wave does not take it',
    run: (m) => { expect(m.epicForOpen([E(1, [1], 'dropped'), E(2, [1, 2])], 1, null, false)).toEqual({ epicId: 2 }); } },
];

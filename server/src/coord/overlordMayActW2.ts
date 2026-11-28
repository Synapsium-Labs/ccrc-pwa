// `mayActW2`, W2's one door into `overlordMayAct` (Overlord W2, the act catalogue B; plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md` §6 "What W2 feeds it", F9, the index's question 27). Ring
// L1, context C5: pure. It is the only `server/src` file that imports the decider's function (`overlordPolicy.ts` imports the
// allow's type alone; both held by `server/test/single-definition/overlord-may-act.test.ts`), it re-exports nothing of it, and
// nothing imports it yet: the doors that call it come with later pieces (act rows B's own-record doors, request record B, the
// relay). W3 replaces it and lifts that census.
//
// DORMANT BRANCHES STAY DORMANT. Whatever the gathered object holds, the decider is given no grant, no command, no stated entry,
// no answer verdicts, no grant facts, an arming that is unmeasured and no row lookup (six arguments, so the catalogue's rows
// answer): every field is named here, never spread from the input, so a caller cannot pass a grant through. On the catalogue's
// real rows W2 can then answer `allow` (class none, and a relay carrying a widening an operator request names), `staged` with
// mode `proposal` (the same, under a `proposal` cell), `operator-only`, `unmeasured` (an answer kind, a request whose naming is
// unread, and any act under an `armed` cell, because the arming it passes is unread), and the ceiling's words: a refusing
// verdict's own (`act-ceiling` or `unavailable`), or `unavailable` when the door did not ask a counted effect's ceiling
// (`not-asked`). Never `identity-too-weak`, because every row a door performs needs `attributed`, the weakest strength. "It
// re-exports nothing" covers every form, a re-export from the decider's file and a local export of a binding imported from it,
// both held by the census.
import { overlordMayAct, type ActTarget, type MayActAnswer, type MayActFacts } from './overlordMayAct.js';
import type { OverlordActKind } from '../../../shared/overlord.js';

/** What a W2 door gathers before its transaction. */
export interface W2Gathered {
  readonly caller: MayActFacts['caller']; readonly isolation: MayActFacts['isolation']; readonly request: MayActFacts['request'];
  readonly effectCeiling: MayActFacts['effectCeiling']; readonly cell: MayActFacts['cell'];
  readonly naturalKey: string; readonly generation: number;
}

const NO_ENTRY = { kind: 'none' } as const;
const NOT_AN_ANSWER = { kind: 'not-an-answer' } as const;

export function mayActW2(act: OverlordActKind, effect: string | null, target: ActTarget, g: W2Gathered, now: number): MayActAnswer {
  return overlordMayAct(act, effect, target, [], {
    caller: g.caller, isolation: g.isolation, command: null, request: g.request, statedEntry: NO_ENTRY, answer: NOT_AN_ANSWER,
    grantFacts: null, effectCeiling: g.effectCeiling, cell: g.cell, armedLive: 'unmeasured',
    naturalKey: g.naturalKey, generation: g.generation,
  }, now);
}

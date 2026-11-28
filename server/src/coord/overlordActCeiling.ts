// The act ceilings' decider (Overlord W2, the act catalogue A; spec §7.5 "Ceilings", Table 11.5b; plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md` §5 and Task A4). Ring L1, context C5: pure, no I/O and no
// clock; it imports L0 only. The counts are its input (review 2253 F16): the gate runner reads them through its
// `ActCountReader` port, and act rows A's writer re-runs this step inside its own write (question 10).
//
// THREE READINGS STAY THREE (the coordinator's item 8). A count that was read (`counted`), a count that could not be read
// (`unmeasured`) and a group with no ceiling for the scope (`perProgramme: null`) are different values, and none is a default:
// `unmeasured` refuses `unavailable`, never reads as zero; a count the step needs that was `not-asked` refuses too; a `null`
// programme count is an act with no programme target, which counts in all only.
import { ACT_CEILINGS, OVERLORD_ACT_KINDS, actRow, type CeilingGroup, type OverlordActKind } from '../../../shared/overlord.js';
import type { LadderLatchCause } from '../../../shared/overlord-ladder.js';

/** One group's count over the window: in all, and for the target's programme (`null`: the act has no programme target). */
export type GroupCount =
  | { readonly kind: 'counted'; readonly programme: number | null; readonly all: number }
  | { readonly kind: 'unmeasured'; readonly why: string };

/** The latch an `act-ceiling` refusal names, so the runner acts on a cause this step chose and decides nothing (F15). */
export const ACT_CEILING_LATCH = 'act-ceiling-hit' as const satisfies LadderLatchCause;

export type CeilingVerdict =
  | { readonly pass: true }
  | { readonly pass: false; readonly word: 'act-ceiling'; readonly group: CeilingGroup; readonly scope: 'programme' | 'all';
      readonly limit: number; readonly latch: typeof ACT_CEILING_LATCH }
  | { readonly pass: false; readonly word: 'unavailable'; readonly group: CeilingGroup; readonly why: string; readonly latch: null };

type Refusal = Exclude<CeilingVerdict, { readonly pass: true }>;

/** One group's two checks, in all first, then for the programme (§5 rules 3 and 4). */
function overGroup(group: CeilingGroup, count: Extract<GroupCount, { kind: 'counted' }>): Refusal | null {
  const ceiling = ACT_CEILINGS[group];
  if (count.all >= ceiling.all) return { pass: false, word: 'act-ceiling', group, scope: 'all', limit: ceiling.all, latch: ACT_CEILING_LATCH };
  if (ceiling.perProgramme !== null && count.programme !== null && count.programme >= ceiling.perProgramme) {
    return { pass: false, word: 'act-ceiling', group, scope: 'programme', limit: ceiling.perProgramme, latch: ACT_CEILING_LATCH };
  }
  return null;
}

/** §5's rule, first match. The counts the step needs: the act's group, unless its cell is `held-by` or `never` (rule 1),
 *  and the effect's group when its count was asked and the effect is a counted kind (question 10: a carrier counts against
 *  its effect too; an effect this build lacks, or whose ceiling is not counted, adds none: what an act may carry is the act's
 *  decider's). A needed count `not-asked` or `unmeasured` refuses `unavailable` (rule 2) before any ceiling is read; then the
 *  act's group in all and for the programme (rules 3 and 4), then the effect's (rule 5); otherwise `pass` (rule 6).
 *
 *  Who asks which count (call 1874): gate step 10 passes the act's count and the effect's as `not-asked`; the door that
 *  gathers the effect's verdict (PR B) passes BOTH counts read. Only the act's count can be needed and `not-asked`, so it
 *  is refused where it is read (the coordinator's item 8: not asked is never a pass for a group the step needs); a
 *  `not-asked` effect count is dropped before it is needed, so `needed` holds read counts only, by its type. */
export function actCeilingStep(
  act: OverlordActKind, effect: string | null,
  counts: { readonly act: GroupCount | 'not-asked'; readonly effect: GroupCount | 'not-asked' },
): CeilingVerdict {
  const needed: { readonly group: CeilingGroup; readonly count: GroupCount }[] = [];
  const own = OVERLORD_ACT_KINDS[act].ceiling;
  if (own.kind === 'counted') {
    if (counts.act === 'not-asked') return { pass: false, word: 'unavailable', group: own.group, why: "the act's count was not asked", latch: null };
    needed.push({ group: own.group, count: counts.act });
  }
  if (effect !== null && counts.effect !== 'not-asked') {
    const theirs = actRow(effect)?.ceiling;
    if (theirs !== undefined && theirs.kind === 'counted') needed.push({ group: theirs.group, count: counts.effect });
  }
  const counted: { readonly group: CeilingGroup; readonly count: Extract<GroupCount, { kind: 'counted' }> }[] = [];
  for (const n of needed) {
    if (n.count.kind === 'unmeasured') return { pass: false, word: 'unavailable', group: n.group, why: n.count.why, latch: null };
    counted.push({ group: n.group, count: n.count });
  }
  for (const n of counted) {
    const refused = overGroup(n.group, n.count);
    if (refused !== null) return refused;
  }
  return { pass: true };
}

/** Whether a refusal's latch is to be raised (F15): the refusal names one (only step 10's `act-ceiling` does), and no latch
 *  for that cause is measured standing ("unless one stands"). A standing read that could not be measured raises, because a
 *  raise only narrows and the one writer answers a second raise of a standing cause `changed: false`
 *  (`overlordLadderStore.ts#raiseLatchInTx`). */
export function ceilingLatchDue(latch: typeof ACT_CEILING_LATCH | null | undefined, standing: boolean | 'unmeasured'): boolean {
  return latch === ACT_CEILING_LATCH && standing !== true;
}

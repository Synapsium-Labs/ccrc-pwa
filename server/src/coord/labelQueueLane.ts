// Overlord W2, the weekly label lane (spec 2026-11-09 §3.7 H6, "The label queue"; Table 11.1c; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-label-queue.md, Task 4, LQ1, Q16). Ring: L4, context Coordination (C5).
//
// ONE PASS, daily, keyed on the UTC ISO week (LQ1): read the week once, read every card row's facts through `LabelLaneReads`,
// ask whether each waiting state's refs still exist through `LabelRefFacts` (the coordinator's ruling on the gap, point a), ask
// the deciders (`labelQueue.ts`), and insert the picks through the store, which re-reads the budget inside its transaction. It
// sends no mail, pushes nothing, closes no card and writes nothing but the picks.
//
// QUIET WHILE NOTHING IS ASKED. Every row ships `off`, so no row has a record and no card can exist until the operator switches
// one to shadow: such a pass reads, picks nothing and logs nothing. A pass logs one line when it skipped a row whose read failed
// or that it could not read, or when a row in shadow or armed has a waiting state, a card it picked, or a state or card it
// could not draw, with the three counts apart (absent, unmeasured, no-reader).
import { DECISION_QUESTIONS, type DecisionRowId } from '../../../shared/decisionModel.js';
import type { LabelSkipWord } from '../../../shared/labelQueue.js';
import { utcIsoWeek } from '../time/rules.js';
import {
  cardRefNeeds, cardRowsOf, labelBudget, openSlotsHeld, pickLabelCards, pickRowFactsOf, refKey, stateDrawability,
  type PickRowFacts, type RefFound,
} from './labelQueue.js';
import type { LabelLaneReads, LabelRefFacts } from './labelQueuePorts.js';

export interface LabelLaneDeps {
  readonly reads: LabelLaneReads;
  readonly refs: LabelRefFacts;
  readonly wall: () => number;
  readonly warn: (line: string) => void;
}

/** What one pass did, for its caller and its tests. */
export interface LabelLanePass {
  readonly week: string;
  readonly picked: number;
  readonly undrawn: Readonly<Record<LabelSkipWord, number>>;
  readonly failed: readonly DecisionRowId[];
}

/** One word for a state's refs, asking each ref's existence once (`LabelRefFacts`), then `stateDrawability`. A record this
 *  build cannot read (`null`) is `unmeasured`, as the open-card arm and the read count it, never `absent` (review 4185, C3). */
function drawabilityOf(refs: LabelRefFacts, row: DecisionRowId, stateRefs: Readonly<Record<string, string | readonly string[]>> | null):
  'drawable' | LabelSkipWord {
  if (stateRefs === null) return 'unmeasured';
  const needs = cardRefNeeds(DECISION_QUESTIONS[row], stateRefs);
  const found = new Map<string, RefFound>();
  if (needs.kind === 'reads') for (const r of needs.reads) for (const id of r.ids) found.set(refKey(r.refKind, id), refs.found(r.refKind, id));
  return stateDrawability(needs, found);
}

/** The open cards that hold a slot, read fresh (the pass, and again inside the pick's transaction). */
function openHeld(d: LabelLaneDeps): number {
  return openSlotsHeld(d.reads.openCards().map((card) => {
    const r = d.reads.recordRefs(card.recordId);
    return {
      card, mode: d.reads.mode(card.row), revision: DECISION_QUESTIONS[card.row].revision,
      drawability: r === 'absent' ? 'absent' as const : r === 'unreadable' ? 'unmeasured' as const : drawabilityOf(d.refs, card.row, r),
    };
  }));
}

export function runLabelQueueLane(d: LabelLaneDeps): LabelLanePass {
  const now = d.wall();
  const week = utcIsoWeek(now);
  const counts = d.reads.counts(week.key);
  const undrawn: Record<LabelSkipWord, number> = { absent: 0, unmeasured: 0, 'no-reader': 0 };
  const failed: DecisionRowId[] = [];
  const rows: PickRowFacts[] = [];
  let asked = false;
  for (const row of cardRowsOf(DECISION_QUESTIONS)) {
    const q = DECISION_QUESTIONS[row];
    try {
      const mode = d.reads.mode(row);
      if (mode === 'unreadable') { failed.push(row); continue; }
      if (mode === 'off') continue;
      const waiting = d.reads.waiting(row, q.revision).map((w) => ({ ...w, drawability: drawabilityOf(d.refs, row, w.refs) }));
      for (const w of waiting) if (w.drawability !== 'drawable') undrawn[w.drawability]++;
      if (waiting.length > 0) asked = true;
      rows.push(pickRowFactsOf({ row: q, mode, answers: d.reads.labelledAnswers(row, q.revision),
        lastCardWeekStart: counts.lastCardWeekStart.get(row) ?? 'never', waiting }));
    } catch {
      failed.push(row);
    }
  }
  const picks = pickLabelCards({ week, pickedThisWeek: counts.pickedThisWeek, open: openHeld(d), rows });
  const picked = picks.length === 0 ? 0 : d.reads.pick(week.key,
    picks.map((p) => ({ ...p, revision: DECISION_QUESTIONS[p.row].revision })), now,
    () => labelBudget(d.reads.counts(week.key).pickedThisWeek, openHeld(d))).picked;
  if (asked || picked > 0 || failed.length > 0) {
    d.warn(`ccrc-server: label lane ${week.key}: picked ${picked}; not drawable: absent ${undrawn.absent}, unmeasured ${undrawn.unmeasured}, `
      + `no-reader ${undrawn['no-reader']}${failed.length > 0 ? `; rows skipped (read failed): ${failed.join(', ')}` : ''}`);
  }
  return { week: week.key, picked, undrawn, failed };
}

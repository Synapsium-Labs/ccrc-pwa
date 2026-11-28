// Overlord W2, the label queue's deciders (spec 2026-11-09 §3.7 H6, "The label queue"; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-label-queue.md, Task 2, LQ2 to LQ8 and LQ13). Ring: L1, context Coordination
// (C5): pure, no store, no clock, no I/O; the week, the counts and each row's facts are arguments. The weekly lane (L4) and the
// store (L3) ask these and decide nothing themselves; the card doors (C6, `labelCards.ts`) import `LabelCardRow` as a type.
import { upperBound95 } from '../../../shared/binomialBound.js';
import {
  DECISION_LABEL_SOURCES, DECISION_LINE_CANDIDATES, DECISION_QUESTIONS, DECISION_ROW_IDS,
  type DecisionQuestionRow, type DecisionRowId, type DecisionRowMode,
} from '../../../shared/decisionModel.js';
import {
  LABEL_ANSWER_WORDS, LABEL_CARD_OUTCOMES, LABEL_CARDS_PER_WEEK, LABEL_DOOR_REFUSALS, LABEL_ROW_MAX_GAP_WEEKS, LABELS_NEEDED_CAP,
  type LabelCardOutcome,
} from '../../../shared/labelQueue.js';
import { lineCounts, type LabelledAnswer } from './decisionLines.js';

/** One `label_cards` row as the store answers it. The store (L3) and `labelCards.ts` (L1) both read this shape. */
export interface LabelCardRow {
  readonly id: number;
  readonly week: string;
  readonly row: DecisionRowId;
  readonly revision: string;
  readonly stateHash: string;
  readonly recordId: number;
  readonly pickedAt: number;
  readonly closedAt: number | null;
  readonly closedBy: string | null;
  readonly outcome: LabelCardOutcome | null;
}

export type LabelSource = (typeof DECISION_LABEL_SOURCES)[number];
const DAY_MS = 86_400_000;

/** Whether a quoted kebab token is one of this piece's words (the answer words, a card's outcomes, the door's refusals and the
 *  label sources), derived from L0's lists so the mail-routes census admits them without a hand-kept list of its own. */
export const isLabelQueueKebab = (token: string): boolean =>
  (LABEL_ANSWER_WORDS as readonly string[]).includes(token)
  || (LABEL_CARD_OUTCOMES as readonly string[]).includes(token)
  || (LABEL_DOOR_REFUSALS as readonly string[]).includes(token)
  || (DECISION_LABEL_SOURCES as readonly string[]).includes(token);

/** LQ3: the rows a card may serve, in catalogue order: those whose `labelSources` name `label-queue`. */
export function cardRowsOf(q: typeof DECISION_QUESTIONS): readonly DecisionRowId[] {
  return DECISION_ROW_IDS.filter((id) => q[id].labelSources.includes('label-queue'));
}

/**
 * LQ5: how many more clean labels bring the next candidate to the row's target. Admission is fixed-sequence, so the next
 * candidate is the first of the lines, strictest first, whose bound is still over the target; the counts come from
 * `lineCounts`, so the rule is written once. `none` when every candidate passes; `far` when no `k` up to
 * `LABELS_NEEDED_CAP` does it.
 */
export function labelsNeeded(row: DecisionQuestionRow, cases: readonly LabelledAnswer[]): number | 'none' | 'far' {
  for (const t of DECISION_LINE_CANDIDATES) {
    const { n, errors } = lineCounts(row, cases, t);
    if (upperBound95(errors, n) <= row.target) continue;
    for (let k = 0; k <= LABELS_NEEDED_CAP; k++) {
      if (upperBound95(errors, n + k) <= row.target) return k;
    }
    return 'far';
  }
  return 'none';
}

/** One card row's facts at the pass: its mode, how near its line is, the week its last card was picked in, and the cases that
 *  wait (a record, no label from any source and never a card). */
export interface PickRowFacts {
  readonly row: DecisionQuestionRow;
  readonly mode: DecisionRowMode;
  readonly needed: number | 'none' | 'far';
  readonly lastCardWeekStart: number | 'never';
  readonly waiting: readonly { stateHash: string; recordId: number; at: number; markedAtNext: boolean }[];
}

type Waiting = PickRowFacts['waiting'][number];

/** How many cards a row may take in the pass's second share, from its `needed`. */
const shareOf = (needed: PickRowFacts['needed']): number => (needed === 'none' ? 0 : needed === 'far' ? LABELS_NEEDED_CAP : needed);
/** A number before `far` before `none`. */
const neededRank = (needed: PickRowFacts['needed']): number => (needed === 'none' ? 2 : needed === 'far' ? 1 : 0);

/** Within a row: the case the newest record marks at the next candidate first (LQ6), then the newest, then the higher record. */
const caseOrder = (a: Waiting, b: Waiting): number =>
  Number(b.markedAtNext) - Number(a.markedAtNext) || b.at - a.at || b.recordId - a.recordId;

/**
 * Table 3 (LQ2, LQ4): which states are carded this pass.
 *
 * | Step | What it does |
 * |---|---|
 * | 1 | budget = min(ten less picked this week, ten less open), never below 0; 0 picks nothing |
 * | 2 | a row that is `off`, or has no waiting case, contributes nothing |
 * | 3 | a row is due when it has a waiting case and never had a card, or its last card's week is a full gap back |
 * | 4 | order: due first, a gate before advice, `needed` ascending (a number, then `far`, then `none`), then the row id |
 * | 5 | one card to each due row, in that order, while the budget lasts |
 * | 6 | the rest of the budget in that order, a row at a time, up to its `needed` (`far`: the cap; `none`: 0) |
 *
 * No state is carded twice in one pass.
 */
export function pickLabelCards(f: {
  week: { key: string; start: number }; pickedThisWeek: number; open: number; rows: readonly PickRowFacts[];
}): readonly { row: DecisionRowId; stateHash: string; recordId: number }[] {
  const budget = Math.max(0, Math.min(LABEL_CARDS_PER_WEEK - f.pickedThisWeek, LABEL_CARDS_PER_WEEK - f.open));
  if (budget === 0) return [];
  const gapMs = LABEL_ROW_MAX_GAP_WEEKS * 7 * DAY_MS;
  const entries = f.rows
    .filter((r) => r.mode !== 'off' && r.waiting.length > 0)
    .map((r) => ({
      r,
      due: r.lastCardWeekStart === 'never' || f.week.start - r.lastCardWeekStart >= gapMs,
      cases: [...r.waiting].sort(caseOrder),
    }))
    .sort((a, b) =>
      Number(b.due) - Number(a.due)
      || Number(b.r.row.direction === 'gate') - Number(a.r.row.direction === 'gate')
      || neededRank(a.r.needed) - neededRank(b.r.needed)
      || (typeof a.r.needed === 'number' && typeof b.r.needed === 'number' ? a.r.needed - b.r.needed : 0)
      || (a.r.row.id < b.r.row.id ? -1 : a.r.row.id > b.r.row.id ? 1 : 0));

  const out: { row: DecisionRowId; stateHash: string; recordId: number }[] = [];
  const seen = new Set<string>();
  const next = new Map<(typeof entries)[number], number>();
  const taken = new Map<(typeof entries)[number], number>();
  /** Takes the entry's next case that is not already carded; false when it has none left. */
  const take = (e: (typeof entries)[number]): boolean => {
    let i = next.get(e) ?? 0;
    while (i < e.cases.length) {
      const c = e.cases[i++]!;
      const key = `${e.r.row.id}\u0000${c.stateHash}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ row: e.r.row.id, stateHash: c.stateHash, recordId: c.recordId });
      next.set(e, i);
      taken.set(e, (taken.get(e) ?? 0) + 1);
      return true;
    }
    next.set(e, i);
    return false;
  };

  for (const e of entries) {
    if (out.length >= budget) break;
    if (e.due) take(e);
  }
  for (const e of entries) {
    const share = shareOf(e.r.needed);
    while (out.length < budget && (taken.get(e) ?? 0) < share && take(e));
  }
  return out;
}

/**
 * LQ8: one state's label from all its sources. An `outcome` outranks and retires every `operator-answer` and `overturn` label
 * (each source listed once in `retired`, in catalogue order, and ignored); among what remains the newest `at` stands, a tie
 * going to the later in the input.
 */
export function labelFor(labels: readonly { source: LabelSource; label: LabelledAnswer['label']; at: number }[]):
  { label: LabelledAnswer['label']; source: LabelSource; retired: readonly LabelSource[] } | 'none' {
  if (labels.length === 0) return 'none';
  const hasOutcome = labels.some((l) => l.source === 'outcome');
  const retires = (s: LabelSource): boolean => s === 'operator-answer' || s === 'overturn';
  const retired = hasOutcome ? DECISION_LABEL_SOURCES.filter((s) => retires(s) && labels.some((l) => l.source === s)) : [];
  const standing = hasOutcome ? labels.filter((l) => !retires(l.source)) : labels;
  let best = standing[0]!;
  for (const l of standing) if (l.at >= best.at) best = l;
  return { label: best.label, source: best.source, retired };
}

/** LQ13 (F12): the one filter of open cards. Hidden while the row is `off` or its revision is not the card's. */
export function cardShown(card: { row: DecisionRowId; revision: string }, rowNow: { mode: DecisionRowMode; revision: string }): 'shown' | 'hidden' {
  return rowNow.mode === 'off' || card.revision !== rowNow.revision ? 'hidden' : 'shown';
}

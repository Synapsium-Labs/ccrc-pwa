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
  LABEL_ANSWER_WORDS, LABEL_CARD_OUTCOMES, LABEL_CARDS_PER_WEEK, LABEL_DOOR_REFUSALS, LABEL_ROW_MAX_GAP_WEEKS, LABEL_SKIP_WORDS,
  LABELS_NEEDED_CAP, type LabelCardOutcome, type LabelSkipWord,
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
  || (LABEL_SKIP_WORDS as readonly string[]).includes(token)
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
  const t = nextCandidate(row, cases);
  if (t === null) return 'none';
  const { n, errors } = lineCounts(row, cases, t);
  for (let k = 0; k <= LABELS_NEEDED_CAP; k++) {
    if (upperBound95(errors, n + k) <= row.target) return k;
  }
  return 'far';
}

/** The next fixed-sequence candidate (ruling F10): the first line, strictest first, whose bound is over the row's target, or
 *  null when every candidate passes. `labelsNeeded` counts at it, and the lane marks the cases the model marked at it. */
export function nextCandidate(row: DecisionQuestionRow, cases: readonly LabelledAnswer[]): number | null {
  for (const t of DECISION_LINE_CANDIDATES) {
    const { n, errors } = lineCounts(row, cases, t);
    if (upperBound95(errors, n) <= row.target) continue;
    return t;
  }
  return null;
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

/** Table 3 step 1 (LQ2): ten less the cards picked this week, and ten less the open cards that hold a slot, never below 0.
 *  The pick and the lane's re-read inside the pick's transaction both ask this, so the rule is written once. */
export function labelBudget(pickedThisWeek: number, open: number): number {
  return Math.max(0, Math.min(LABEL_CARDS_PER_WEEK - pickedThisWeek, LABEL_CARDS_PER_WEEK - open));
}

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
  const budget = labelBudget(f.pickedThisWeek, f.open);
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

// ── a state's refs (the coordinator's ruling on the gap, call 1913) ─────────────────────────────────────────────────────

/** The ref kinds a card can read: an operator message by id, and a mail body by its row id. A `programme` ref is its own
 *  text; a `goals-version` ref has no reader in this build (its spelling is the first producer's to set). */
export type CardRefKind = 'message' | 'mail';
export type CardRefNeeds =
  | { kind: 'reads'; reads: readonly { name: string; refKind: CardRefKind; ids: readonly number[] }[] }
  | { kind: 'no-reader' } | { kind: 'malformed' };
/** A recorded id: a decimal positive safe integer, written without a leading zero. */
const refId = (v: string): number | null => (/^[1-9][0-9]{0,15}$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : null);

/** The reads a state's refs need, from the row's catalogue fields. A name the row does not cite by a ref kind, or an id that
 *  is not one, is `malformed`; any `goals-version` ref makes the state `no-reader`. */
export function cardRefNeeds(row: DecisionQuestionRow, refs: Readonly<Record<string, string | readonly string[]>>): CardRefNeeds {
  const reads: { name: string; refKind: CardRefKind; ids: number[] }[] = [];
  let noReader = false;
  for (const [name, value] of Object.entries(refs)) {
    const refKind = row.fields.find((f) => f.name === name)?.refKind;
    if (refKind === undefined) return { kind: 'malformed' };
    if (refKind === 'goals-version') { noReader = true; continue; }
    if (refKind === 'programme') continue;
    const ids = (typeof value === 'string' ? [value] : value).map(refId);
    if (ids.length === 0 || ids.some((i) => i === null)) return { kind: 'malformed' };
    reads.push({ name, refKind, ids: ids as number[] });
  }
  return noReader ? { kind: 'no-reader' } : { kind: 'reads', reads };
}

/** What an owner's facts read answered for one ref: it exists, it does not, or the read could not answer. */
export type RefFound = 'present' | 'absent' | 'unmeasured';
/** The key a ref's answer is filed under: `<kind>:<id>`. */
export const refKey = (refKind: CardRefKind, id: number): string => `${refKind}:${id}`;

/** Whether a state can be drawn, one word, never folded: `no-reader` first, then `absent` (a malformed ref, or one ref proven
 *  absent), then `unmeasured` (a ref unread or unanswerable), else `drawable`. */
export function stateDrawability(needs: CardRefNeeds, found: ReadonlyMap<string, RefFound>): 'drawable' | LabelSkipWord {
  if (needs.kind === 'no-reader') return 'no-reader';
  if (needs.kind === 'malformed') return 'absent';
  let unmeasured = false;
  for (const r of needs.reads) {
    for (const id of r.ids) {
      const f = found.get(refKey(r.refKind, id));
      if (f === 'absent') return 'absent';
      if (f !== 'present') unmeasured = true;
    }
  }
  return unmeasured ? 'unmeasured' : 'drawable';
}

/** Whether an open card holds one of the ten slots (point a of the ruling): a shown card does, unless its state is proven
 *  absent or has no reader, which can never be drawn. An unmeasured one still holds its slot until a read measures it. */
export function cardHoldsSlot(shown: 'shown' | 'hidden', drawability: 'drawable' | LabelSkipWord): boolean {
  return shown === 'shown' && drawability !== 'absent' && drawability !== 'no-reader';
}

/** The open cards that hold a slot, for the budget: each through `cardShown` and `cardHoldsSlot`. A card whose row this build
 *  cannot read holds its slot (doubt keeps the cap, never widens it). */
export function openSlotsHeld(cards: readonly { card: { row: DecisionRowId; revision: string }; mode: DecisionRowMode | 'unreadable';
  revision: string; drawability: 'drawable' | LabelSkipWord }[]): number {
  let n = 0;
  for (const c of cards) {
    if (c.mode === 'unreadable' || cardHoldsSlot(cardShown(c.card, { mode: c.mode, revision: c.revision }), c.drawability)) n++;
  }
  return n;
}

/** One card row's facts for `pickLabelCards`: its need at the next candidate, and the waiting states that can be drawn, each
 *  marked when its newest record marks at that candidate (by `lineCounts`' own rule, so the rule is written once). */
export function pickRowFactsOf(f: {
  row: DecisionQuestionRow; mode: DecisionRowMode; answers: readonly LabelledAnswer[]; lastCardWeekStart: number | 'never';
  waiting: readonly { stateHash: string; recordId: number; at: number; verdict: LabelledAnswer['verdict'] | null; p: number;
    drawability: 'drawable' | LabelSkipWord }[];
}): PickRowFacts {
  const t = nextCandidate(f.row, f.answers);
  const marked = (verdict: LabelledAnswer['verdict'] | null, p: number): boolean =>
    t !== null && verdict !== null && lineCounts(f.row, [{ p, verdict, label: 'none' }], t).n === 1;
  return {
    row: f.row, mode: f.mode, needed: labelsNeeded(f.row, f.answers), lastCardWeekStart: f.lastCardWeekStart,
    waiting: f.waiting.filter((w) => w.drawability === 'drawable')
      .map((w) => ({ stateHash: w.stateHash, recordId: w.recordId, at: w.at, markedAtNext: marked(w.verdict, w.p) })),
  };
}

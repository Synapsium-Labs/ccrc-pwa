// Overlord W2, the label queue's ports (spec 2026-11-09 §3.7 H6; plan docs/superpowers/plans/2026-11-16-overlord-w2/
// w2-label-queue.md, Task 3). Ring: L2, context Coordination (C5). Declared by their consumers: `MeasuredLabels` by the
// `LabelledCases` adapter (`labelQueueStore.ts#labelledCasesOf`), `LabelLaneReads` by the weekly lane (`labelQueueLane.ts`).
// The doors' own port, `LabelCardStore`, is declared in their file (`labelCardRoutes.ts`, C6), never here.
import type { ReadFailure } from '../../../shared/agent-protocol.js';
import type { DecisionRowId, DecisionRowMode } from '../../../shared/decisionModel.js';
import type { LabelledAnswer } from './decisionLines.js';
import type { CardRefKind, LabelCardRow, LabelSource, RefFound } from './labelQueue.js';

/** The labels measured rows already hold (LQ8), read at each call and never copied: the overlaps ruling, the owner that
 *  accepted a request, an outcome. PR A wires an empty source; PR B adds `operator-answer` and `routed-to`. A read that fails
 *  throws, and the caller treats the row as unmeasured. */
export interface MeasuredLabels {
  labelsFor(row: DecisionRowId, revision: string): readonly {
    stateHash: string; source: Exclude<LabelSource, 'label-queue'>; label: LabelledAnswer['label']; at: number;
  }[];
}

/** One recorded state of a row at its revision: its newest record by the store's own order, whatever host or model (LQ7). */
export interface LabelStateRecord {
  readonly stateHash: string;
  readonly recordId: number;
  readonly at: number;
  /** The record's verdict, or null for a word this build cannot read (such a record is never marked). */
  readonly verdict: LabelledAnswer['verdict'] | null;
  readonly p: number;
  /** The record's refs, or null when this build cannot read its refs or its inline part (the state is then unmeasured, never
   *  absent, and never picked: review 4185, C3). */
  readonly refs: Readonly<Record<string, string | readonly string[]>> | null;
}

/** Whether a ref an open card or a waiting state names still exists, answered as a fact and never as text: the private store's
 *  message facts read returns none; the coordination store's mail row read (`mailOrigin`) returns the mail's subject and body,
 *  which the adapter discards inside itself, keeping only whether the row exists. The lane never picks a state proven absent or
 *  unmeasured; a card proven absent holds no slot, and an unmeasured card keeps its slot until a read measures it (the
 *  coordinator's ruling on the gap, point a). Never throws. */
export interface LabelRefFacts {
  found(refKind: CardRefKind, id: number): RefFound;
}

/** What the weekly lane reads. Each read either answers or throws; a row whose read throws is left out of that pass. */
export interface LabelLaneReads {
  /** The row's mode through the decision model's row read, or `unreadable` (never folded into `off`). */
  mode(row: DecisionRowId): DecisionRowMode | 'unreadable';
  /** The states with a record, no label from any source and never a card, at the row's revision (LQ6). */
  waiting(row: DecisionRowId, revision: string): readonly LabelStateRecord[];
  /** The labelled states at the row's revision, each with its newest record's verdict and `p`, for `labelsNeeded`. */
  labelledAnswers(row: DecisionRowId, revision: string): readonly LabelledAnswer[];
  /** Every open card, unfiltered (`cardShown` is the one filter, F12). */
  openCards(): readonly LabelCardRow[];
  /** A card's record's refs: `absent` when no record holds the id, `unreadable` when its refs cannot be read. */
  recordRefs(recordId: number): Readonly<Record<string, string | readonly string[]>> | ReadFailure;
  /** Cards picked in `week`, and each row's newest card's week start. */
  counts(week: string): { pickedThisWeek: number; lastCardWeekStart: ReadonlyMap<DecisionRowId, number> };
  /** `pickLabelCardsInTx`, with the budget re-read inside its transaction through `budget`. */
  pick(week: string, picks: readonly { row: DecisionRowId; revision: string; stateHash: string; recordId: number }[], at: number,
    budget: () => number): { picked: number };
}

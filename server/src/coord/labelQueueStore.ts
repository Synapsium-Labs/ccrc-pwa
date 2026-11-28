// Overlord W2, the label cards and the labels (spec 2026-11-09 §3.7 H6, "Labels come only from the operator or from measured
// rows", "The label queue"; plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-label-queue.md, Task 3). Ring: L3, context
// Coordination (C5). SQL only: every function is synchronous over the handle it is given, in `decisionModelStore.ts`' idiom.
//
// ONE WRITER PER FACT (`single-definition/writers-map.test.ts` pins each): `pickLabelCardsInTx` is `label_cards`' only
// inserter, and `closeLabelCardInTx` its only closer and `decision_labels`' only writer. A measured label (an overlaps ruling,
// the owner that accepted a request, an outcome) is read through `MeasuredLabels` at each call and never copied here (LQ8).
//
// NO TEXT. A card holds ids, a week and a state hash; a label is a word of a closed set. A card's fields are rebuilt from its
// record at each read (`DecisionStateReads`) and never stored, so the operator's words never reach `coord.db` (LQ11).
//
// KEYED BY STATE (LQ7). A label is keyed by row, revision and state hash, never by host or model, so a host or model change
// keeps it and a revision change drops it by the key alone. "The newest record" of a state is the newest by this table's own
// order (`id`) among the records of that revision, whatever its host, model or line generation.
import type { DatabaseSync } from 'node:sqlite';
import type { ReadFailure } from '../../../shared/agent-protocol.js';
import {
  DECISION_LABEL_SOURCES, DECISION_QUESTIONS, isDecisionRowId, type DecisionRowId, type DecisionRowMode,
} from '../../../shared/decisionModel.js';
import { LABEL_CARD_OUTCOMES, type LabelCardOutcome } from '../../../shared/labelQueue.js';
import { utcIsoWeek } from '../time/rules.js';
import type { LabelledAnswer } from './decisionLines.js';
import type { LabelledCases } from './decisionModelPort.js';
import { decisionRowRead, verdictOf } from './decisionModelStore.js';
import { labelFor, type LabelCardRow, type LabelSource } from './labelQueue.js';
import type { LabelLaneReads, LabelRefFacts, LabelStateRecord, MeasuredLabels } from './labelQueuePorts.js';
import { tx } from './tx.js';

type Label = LabelledAnswer['label'];

/** A label as `decision_labels.label` spells it: `yes`, `no`, `none` or `option:<slug>`. */
export const labelWord = (l: Label): string => (typeof l === 'string' ? l : `option:${l.option}`);
/** The column read back, or null for a word out of this build's vocabulary. */
const labelOf = (w: string): Label | null => {
  if (w === 'yes' || w === 'no' || w === 'none') return w;
  return w.startsWith('option:') && w.length > 'option:'.length ? { option: w.slice('option:'.length) } : null;
};
const isSource = (v: unknown): v is LabelSource => typeof v === 'string' && (DECISION_LABEL_SOURCES as readonly string[]).includes(v);
const isOutcome = (v: unknown): v is LabelCardOutcome => typeof v === 'string' && (LABEL_CARD_OUTCOMES as readonly string[]).includes(v);

const CARD_COLS = 'id, week, row, revision, stateHash, recordId, pickedAt, closedAt, closedBy, outcome';
type RawCard = { id: number; week: string; row: string; revision: string; stateHash: string; recordId: number; pickedAt: number;
  closedAt: number | null; closedBy: string | null; outcome: string | null };
/** A stored card, or null for one this build cannot read (a row it does not know, an outcome out of its words). */
const cardOf = (r: RawCard): LabelCardRow | null => {
  if (!isDecisionRowId(r.row)) return null;
  if (r.outcome !== null && !isOutcome(r.outcome)) return null;
  return { id: r.id, week: r.week, row: r.row, revision: r.revision, stateHash: r.stateHash, recordId: r.recordId, pickedAt: r.pickedAt,
    closedAt: r.closedAt, closedBy: r.closedBy, outcome: r.outcome };
};

// ── the cards ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Insert the picks in one transaction, re-reading the budget inside it through `budget`, so two passes can never pick more
 *  than the budget. `INSERT OR IGNORE` keeps a state to one card at a revision (LQ6). */
export function pickLabelCardsInTx(db: DatabaseSync, week: string, picks: readonly { row: DecisionRowId; revision: string;
  stateHash: string; recordId: number }[], at: number, budget: () => number): { picked: number } {
  return tx(db, () => {
    let left = budget();
    let picked = 0;
    const ins = db.prepare('INSERT OR IGNORE INTO label_cards (week, row, revision, stateHash, recordId, pickedAt) VALUES (?, ?, ?, ?, ?, ?)');
    for (const p of picks) {
      if (left <= 0) break;
      if (Number(ins.run(week, p.row, p.revision, p.stateHash, p.recordId, at).changes) === 1) { picked++; left--; }
    }
    return { picked };
  });
}

/** Close a card, told what to write by the doors' verdict (F13): it decides nothing but the compare. In one transaction it
 *  re-checks that the card is open and that its row still reads the mode and revision the caller read (the TOCTOU re-check),
 *  then closes the card and, for `labelled`, writes the one `label-queue` label with the gate's actor. A failed compare answers
 *  `moved` and writes nothing. */
export function closeLabelCardInTx(db: DatabaseSync, id: number, close: { outcome: LabelCardOutcome; label: Label | null;
  actor: string; at: number; expect: { mode: 'shadow' | 'armed'; revision: string } }): 'closed' | 'already' | 'moved' | 'absent' {
  if ((close.outcome === 'labelled') !== (close.label !== null)) {
    throw new Error('closeLabelCardInTx: a labelled close carries a label, and a not-sure close none');
  }
  return tx(db, () => {
    const c = db.prepare('SELECT row, revision, stateHash, closedAt FROM label_cards WHERE id = ?').get(id) as
      { row: string; revision: string; stateHash: string; closedAt: number | null } | undefined;
    if (c === undefined) return 'absent';
    if (c.closedAt !== null) return 'already';
    if (!isDecisionRowId(c.row)) return 'moved';
    const r = decisionRowRead(db, c.row);
    if (r.kind !== 'row' || r.state.mode !== close.expect.mode || c.revision !== close.expect.revision
      || DECISION_QUESTIONS[c.row].revision !== close.expect.revision) return 'moved';
    db.prepare('UPDATE label_cards SET closedAt = ?, closedBy = ?, outcome = ? WHERE id = ? AND closedAt IS NULL')
      .run(close.at, close.actor, close.outcome, id);
    if (close.label !== null) {
      db.prepare(`INSERT INTO decision_labels (row, revision, stateHash, label, source, cardId, actor, at)
        VALUES (?, ?, ?, ?, 'label-queue', ?, ?, ?)`).run(c.row, c.revision, c.stateHash, labelWord(close.label), id, close.actor, close.at);
    }
    return 'closed';
  });
}

/** Every open card with its row and revision, unfiltered: `cardShown` is the one filter (F12). A card this build cannot read
 *  is left out. */
export function openLabelCards(db: DatabaseSync): readonly LabelCardRow[] {
  const rows = db.prepare(`SELECT ${CARD_COLS} FROM label_cards WHERE closedAt IS NULL ORDER BY id`).all() as unknown as RawCard[];
  return rows.map(cardOf).filter((c): c is LabelCardRow => c !== null);
}

/** One card, open or closed, or `absent` (also for a card this build cannot read). */
export function labelCardById(db: DatabaseSync, id: number): LabelCardRow | 'absent' {
  const r = db.prepare(`SELECT ${CARD_COLS} FROM label_cards WHERE id = ?`).get(id) as RawCard | undefined;
  return (r === undefined ? null : cardOf(r)) ?? 'absent';
}

/** The cards picked in `week`, and each row's newest card's week start. `open` is not answered: the caller counts it through
 *  `cardShown` (F12). */
export function labelCardCounts(db: DatabaseSync, week: string): { pickedThisWeek: number;
  lastCardWeekStart: ReadonlyMap<DecisionRowId, number> } {
  const n = db.prepare('SELECT COUNT(*) AS n FROM label_cards WHERE week = ?').get(week) as { n: number };
  const last = new Map<DecisionRowId, number>();
  for (const r of db.prepare('SELECT row, MAX(pickedAt) AS at FROM label_cards GROUP BY row').all() as unknown as { row: string; at: number }[]) {
    if (isDecisionRowId(r.row)) last.set(r.row, utcIsoWeek(r.at).start);
  }
  return { pickedThisWeek: Number(n.n), lastCardWeekStart: last };
}

// ── the records and the labels ────────────────────────────────────────────────────────────────────────────────────────

type RawRecord = { id: number; stateHash: string; at: number; verdict: string; p: number; refs: string; inline: string | null };
/** The newest record of each state at a revision, by the table's own order. */
const NEWEST_SQL = `SELECT r.id, r.stateHash, r.at, r.verdict, r.p, r.refs, r.inline FROM decision_records r
  WHERE r.row = ? AND r.revision = ? AND r.id = (SELECT MAX(r2.id) FROM decision_records r2
    WHERE r2.row = r.row AND r2.revision = r.revision AND r2.stateHash = r.stateHash)`;
const newestRecords = (db: DatabaseSync, row: DecisionRowId, revision: string): RawRecord[] =>
  db.prepare(`${NEWEST_SQL} ORDER BY r.id`).all(row, revision) as unknown as RawRecord[];

/** The stored labels at a revision, words this build cannot read left out. */
function storedLabels(db: DatabaseSync, row: DecisionRowId, revision: string): { stateHash: string; source: LabelSource; label: Label; at: number }[] {
  const rows = db.prepare('SELECT stateHash, label, source, at FROM decision_labels WHERE row = ? AND revision = ? ORDER BY id')
    .all(row, revision) as unknown as { stateHash: string; label: string; source: string; at: number }[];
  const out: { stateHash: string; source: LabelSource; label: Label; at: number }[] = [];
  for (const r of rows) {
    const label = labelOf(r.label);
    if (label !== null && isSource(r.source)) out.push({ stateHash: r.stateHash, source: r.source, label, at: r.at });
  }
  return out;
}

/** Each labelled state's label, from the stored labels and the measured ones through `labelFor` (an outcome retires an
 *  answer or an overturn; otherwise the newest stands). */
function labelsByState(db: DatabaseSync, measured: MeasuredLabels, row: DecisionRowId, revision: string): Map<string, Label> {
  const all = new Map<string, { source: LabelSource; label: Label; at: number }[]>();
  for (const l of [...storedLabels(db, row, revision), ...measured.labelsFor(row, revision)]) {
    const list = all.get(l.stateHash) ?? [];
    list.push({ source: l.source, label: l.label, at: l.at });
    all.set(l.stateHash, list);
  }
  const out = new Map<string, Label>();
  for (const [hash, list] of all) {
    const l = labelFor(list);
    if (l !== 'none') out.set(hash, l.label);
  }
  return out;
}

const parseRefs = (text: string): Record<string, string | readonly string[]> | null => {
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    for (const x of Object.values(v)) {
      if (typeof x !== 'string' && !(Array.isArray(x) && x.every((y) => typeof y === 'string'))) return null;
    }
    return v as Record<string, string | readonly string[]>;
  } catch {
    return null;
  }
};
const parseInline = (text: string | null): Record<string, string> | null | 'bad' => {
  if (text === null) return null;
  const v = parseRefs(text);
  if (v === null || Object.values(v).some((x) => typeof x !== 'string')) return 'bad';
  return v as Record<string, string>;
};

/** The states with a record, no label from any source and never a card, at the row's revision (LQ6), each its newest
 *  record. */
export function waitingStates(db: DatabaseSync, measured: MeasuredLabels, row: DecisionRowId, revision: string): readonly LabelStateRecord[] {
  const labelled = labelsByState(db, measured, row, revision);
  const carded = new Set((db.prepare('SELECT stateHash FROM label_cards WHERE row = ? AND revision = ?').all(row, revision) as unknown as
    { stateHash: string }[]).map((c) => c.stateHash));
  return newestRecords(db, row, revision)
    .filter((r) => !labelled.has(r.stateHash) && !carded.has(r.stateHash))
    .map((r) => ({ stateHash: r.stateHash, recordId: r.id, at: r.at, verdict: verdictOf(r.verdict), p: r.p, refs: parseRefs(r.refs) }));
}

/** One record's refs and inline fields, for a card's rebuild: `absent` when no record holds the id, `unreadable` when this
 *  build cannot read them. */
export function labelRecordOf(db: DatabaseSync, recordId: number):
  { refs: Record<string, string | readonly string[]>; inline: Record<string, string> | null } | ReadFailure {
  const r = db.prepare('SELECT refs, inline FROM decision_records WHERE id = ?').get(recordId) as { refs: string; inline: string | null } | undefined;
  if (r === undefined) return 'absent';
  const refs = parseRefs(r.refs);
  const inline = parseInline(r.inline);
  return refs === null || inline === 'bad' ? 'unreadable' : { refs, inline };
}

/** The labelled states at a revision with their newest record's answer: what `labelsNeeded` counts. A labelled state with no
 *  record, or whose record's verdict this build cannot read, is left out. */
export function labelledAnswersOf(db: DatabaseSync, measured: MeasuredLabels, row: DecisionRowId, revision: string): readonly LabelledAnswer[] {
  const labelled = labelsByState(db, measured, row, revision);
  const out: LabelledAnswer[] = [];
  for (const r of newestRecords(db, row, revision)) {
    const label = labelled.get(r.stateHash);
    const verdict = verdictOf(r.verdict);
    if (label !== undefined && verdict !== null) out.push({ p: r.p, verdict, label });
  }
  return out;
}

/** The decision model's `LabelledCases` (its question 8): each labelled state at the revision, with its newest record's refs
 *  and inline fields and the label. A state whose record's refs this build cannot read is left out. */
export function labelledCasesOf(db: DatabaseSync, measured: MeasuredLabels): LabelledCases {
  return {
    casesFor(row, revision) {
      const labelled = labelsByState(db, measured, row, revision);
      const out: { refs: Record<string, string | readonly string[]>; inline: Record<string, string> | null; label: Label }[] = [];
      for (const r of newestRecords(db, row, revision)) {
        const label = labelled.get(r.stateHash);
        if (label === undefined) continue;
        const refs = parseRefs(r.refs);
        const inline = parseInline(r.inline);
        if (refs === null || inline === 'bad') continue;
        out.push({ refs, inline, label });
      }
      return out;
    },
  };
}

/** The ref facts adapter (`LabelRefFacts`): a message through the private store's facts read (`messageFactsById`, ids and stamps,
 *  never text), a mail through the coordination store's one-row read. An absent private store, an unmeasured read and a read that
 *  throws are each `unmeasured`, never `absent`. Typed by what it calls, so this file imports nothing from the private store. */
export function labelRefFactsOf(
  messages: { messageFactsById(id: number): { kind: 'measured'; value: unknown } | { kind: 'unmeasured' } } | undefined,
  mail: { mailOrigin(id: number): unknown },
): LabelRefFacts {
  return {
    found(refKind, id) {
      try {
        if (refKind === 'mail') return mail.mailOrigin(id) === null ? 'absent' : 'present';
        if (messages === undefined) return 'unmeasured';
        const r = messages.messageFactsById(id);
        return r.kind === 'unmeasured' ? 'unmeasured' : r.value === 'absent' ? 'absent' : 'present';
      } catch {
        return 'unmeasured';
      }
    },
  };
}

/** The doors' store over one handle: it meets `labelCardRoutes.ts#LabelCardStore` (C6) by shape, so this C5 file imports nothing
 *  from the doors and asks none of their deciders (F13). */
export function labelCardStoreOf(db: DatabaseSync): {
  openCards(): readonly LabelCardRow[];
  card(id: number): LabelCardRow | 'absent';
  rowMode(row: DecisionRowId): DecisionRowMode | 'unreadable';
  record(recordId: number): ReturnType<typeof labelRecordOf>;
  pickedThisWeek(week: string): number;
  close(id: number, close: Parameters<typeof closeLabelCardInTx>[2]): ReturnType<typeof closeLabelCardInTx>;
} {
  return {
    openCards: () => openLabelCards(db),
    card: (id) => labelCardById(db, id),
    rowMode: (row) => { const r = decisionRowRead(db, row); return r.kind === 'row' ? r.state.mode : 'unreadable'; },
    record: (recordId) => labelRecordOf(db, recordId),
    pickedThisWeek: (week) => labelCardCounts(db, week).pickedThisWeek,
    close: (id, close) => closeLabelCardInTx(db, id, close),
  };
}

/** The lane's reads over one handle (`LabelLaneReads`, declared by `labelQueueLane.ts`'s port file). */
export function labelLaneReadsOf(db: DatabaseSync, measured: MeasuredLabels): LabelLaneReads {
  return {
    mode: (row) => { const r = decisionRowRead(db, row); return r.kind === 'row' ? r.state.mode : 'unreadable'; },
    waiting: (row, revision) => waitingStates(db, measured, row, revision),
    labelledAnswers: (row, revision) => labelledAnswersOf(db, measured, row, revision),
    openCards: () => openLabelCards(db),
    recordRefs: (recordId) => { const r = labelRecordOf(db, recordId); return typeof r === 'string' ? r : r.refs; },
    counts: (week) => labelCardCounts(db, week),
    pick: (week, picks, at, budget) => pickLabelCardsInTx(db, week, picks, at, budget),
  };
}

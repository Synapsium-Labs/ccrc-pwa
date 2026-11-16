import {
  PUSH_WINDOW_MS, RECEIPTS_PER_PUSH_MAX, SEAL_DEFER_MS,
  type ActedHow, type BootStamp, type ReceiptDrop, type ReceiptIn, type ReceiptKind, type ReceiptSource, type ResponseDelivery,
  type ResponseKind, type ResponseOutcome, type ResponseRowState, type ResponseStamp, type RestoreStamp, type UnmeasuredWhy,
} from '../../shared/responses.js';
import type { AskState } from '../../shared/api.js';
import type { ItemActor, ItemEventAct } from '../../shared/ledgers.js';

/**
 * THE RESPONSE RECORD'S RECEIPT RULE (Overlord spec §4.3, C67; plan
 * `docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md`, Task 1).
 *
 * L1, pure, C6: decides over facts and does no I/O; its only imports are L0 values and types from `shared/`. PR B added
 * the window, outcome, seal, read and retention deciders (Tasks 5 and 8). The time is always a fact handed in.
 */

export interface ReceiptFacts {
  readonly row: { readonly kind: ResponseKind; readonly state: ResponseRowState;
    readonly acceptedSubs: readonly string[] } | null;    // null: no row names the ref
  readonly workerReceipts: number;                       // this row's stored worker receipts of the same kind
}
export type ReceiptVerdict =
  | { readonly keep: true }
  | { readonly keep: false; readonly why: Exclude<ReceiptDrop, 'repeat'> };

const refuse = (why: Extract<ReceiptVerdict, { keep: false }>['why']): ReceiptVerdict => ({ keep: false, why });

/** Whether the door stores a receipt, first match: no row, a sealed row, a source the row's kind never has, a worker's
 *  subscription the push service did not accept (once its verdict landed: a `pending` push's receipt is kept, question
 *  7), and a row already holding `RECEIPTS_PER_PUSH_MAX` worker receipts of that kind (question 19). */
export function receiptVerdict(r: ReceiptIn, f: ReceiptFacts): ReceiptVerdict {
  const row = f.row;
  if (row === null) return refuse('no-row');
  if (row.state === 'sealed') return refuse('sealed');
  const fromWorker = r.from.source === 'worker';
  if (fromWorker !== (row.kind === 'push')) return refuse('wrong-source');
  if (!fromWorker && r.receipt === 'shown') return refuse('wrong-source');
  if (r.from.source === 'worker') {
    if (row.state === 'delivered' && !row.acceptedSubs.includes(r.from.endpointHash)) return refuse('not-accepted');
    if (f.workerReceipts >= RECEIPTS_PER_PUSH_MAX) return refuse('full');
  }
  return { keep: true };
}

// ── THE SEAL (PR B, Task 5: §4.3 Table 4.3b, I18, C66 to C69) ────────────────────────────────────────────────────────────

/** A response row's own columns, as the lane reads them for the seal. */
export interface SealRow {
  readonly id: number;
  readonly kind: ResponseKind;
  readonly label: string;
  readonly state: ResponseRowState;
  /** The row a push carries (its bound ask or item, question 3), or null. */
  readonly carries: { readonly kind: 'ask' | 'item'; readonly id: number } | null;
  readonly hasActions: boolean;
  readonly acceptedSubs: readonly string[];
  readonly boot: BootStamp;
  readonly restore: RestoreStamp;
  readonly insertedAt: number;
  readonly deliveredAt: number | null;
  readonly windowCapAt: number | null;
}

/** The owners' facts about what a row is about, read by the lane at the seal (`responsesStore.ts#ownerFactsOf`). */
export type OwnerFacts =
  | { readonly kind: 'none' }                                           // an unbound push: it carries no row
  | { readonly kind: 'item'; readonly acts: readonly { readonly act: ItemEventAct; readonly actor: ItemActor; readonly at: number }[] }
  | { readonly kind: 'ask'; readonly state: AskState; readonly answeredBy: string | null; readonly answeredAt: number | null;
      readonly endedAt: number | null }
  | { readonly kind: 'digest'; readonly corrected: boolean; readonly overturnedAt: number | null }
  | { readonly kind: 'gone' };                                          // the row it is about no longer exists

export interface SealReceipt {
  readonly receipt: ReceiptKind; readonly source: ReceiptSource; readonly endpointHash: string; readonly at: number;
}
export interface SealFacts {
  readonly row: SealRow;
  readonly owner: OwnerFacts;
  readonly receipts: readonly SealReceipt[];
  /** Accepted subscriptions where a later push under the row's tag, another push id, was accepted inside the window. */
  readonly replacedOn: readonly string[];
  /** `response_boots` rows booted after the row's insert, at or before its window's end (question 17). */
  readonly bootsInWindow: number;
  readonly stampNow: ResponseStamp;
}

export type SealDecision =
  | { readonly seal: false }
  | { readonly seal: true; readonly outcome: ResponseOutcome; readonly how: ActedHow | null; readonly why: UnmeasuredWhy | null;
      readonly actedAt: number | null; readonly shownAt: number | null; readonly openedAt: number | null };
export type SealOutcome = Extract<SealDecision, { seal: true }>;

/** The operator's acts on an item that answer a message (Table 4.3b's `acted`); every other move settles it elsewhere. */
const OPERATOR_ITEM_ACTS: Readonly<Partial<Record<ItemEventAct, ActedHow>>> = { tick: 'tick', dismiss: 'dismiss', act: 'act', decline: 'decline' };
/** An item's moves that settle it: every move but a return, which reopens it; a raise or a blocking change is no move. */
const ITEM_SETTLING: readonly ItemEventAct[] = ['tick', 'confirm', 'withdraw', 'dismiss', 'act', 'decline', 'settle'];

/** When the message was in front of the operator from: a push from its delivery (its insert while pending), any other
 *  row from its insert. */
const windowStart = (row: SealRow): number => (row.kind === 'push' ? (row.deliveredAt ?? row.insertedAt) : row.insertedAt);

/** When the owner's row settled, at or after `from`, or null while it waits. */
function settledAt(owner: OwnerFacts, from: number): number | null {
  if (owner.kind === 'item') {
    const at = owner.acts.filter((a) => ITEM_SETTLING.includes(a.act) && a.at >= from).map((a) => a.at);
    return at.length === 0 ? null : Math.min(...at);
  }
  if (owner.kind === 'ask') return owner.state === 'answered' && owner.answeredAt !== null && owner.answeredAt >= from ? owner.answeredAt : null;
  return null;
}

/** When a row's window ends: a push 24 hours after delivery (`windowCapAt`) or when its carried row settles; a Waiting
 *  on you row when it settles or seven days after its reach (`windowCapAt`); a digest line at the next digest
 *  (`windowCapAt`); a pending push 24 hours after its insert. Null while it is open with no end known. */
export function responseWindowEnd(row: SealRow, owner: OwnerFacts): number | null {
  if (row.kind === 'push' && row.state === 'pending') return row.insertedAt + PUSH_WINDOW_MS;
  const cap = row.windowCapAt;
  if (cap === null) return null;
  const settled = settledAt(owner, windowStart(row));
  return settled === null ? cap : Math.min(cap, settled);
}

const sealOf = (outcome: ResponseOutcome, more: Partial<Omit<SealOutcome, 'seal' | 'outcome'>> = {}): SealOutcome =>
  ({ seal: true, outcome, how: null, why: null, actedAt: null, shownAt: null, openedAt: null, ...more });

/** The operator's act on the owner's row inside `[start, end]`, earliest first, or null. A digest line's correction has
 *  no time on an ask or an approval (a flag, question 9), so it counts whenever it is set at the seal: a correction made
 *  between the window's end and the seal is counted as inside, an overcount of at most one lane period or the reader's
 *  deferral (slug a-digest-correction-is-read-at-the-seal). A big call's `overturnedAt` is read against the window. */
function operatorAct(owner: OwnerFacts, start: number, end: number): { how: ActedHow; at: number | null } | null {
  const inside = (at: number): boolean => at >= start && at <= end;
  if (owner.kind === 'item') {
    const acts = owner.acts.filter((a) => a.actor === 'operator' && OPERATOR_ITEM_ACTS[a.act] !== undefined && inside(a.at));
    if (acts.length === 0) return null;
    const first = acts.reduce((a, b) => (b.at < a.at ? b : a));
    return { how: OPERATOR_ITEM_ACTS[first.act]!, at: first.at };
  }
  if (owner.kind === 'ask') {
    return owner.state === 'answered' && owner.answeredBy === 'operator' && owner.answeredAt !== null && inside(owner.answeredAt)
      ? { how: 'answer', at: owner.answeredAt } : null;
  }
  if (owner.kind === 'digest') {
    if (owner.overturnedAt !== null) return owner.overturnedAt >= start ? { how: 'correct', at: owner.overturnedAt } : null;
    return owner.corrected ? { how: 'correct', at: null } : null;
  }
  return null;
}

/** Whether someone settled the owner's row by the window's end without an operator act inside it: an item withdrawn,
 *  confirmed, settled by `ccrc` or moved before the window; an ask answered by a session, or before the window. */
function settledElsewhere(owner: OwnerFacts, end: number): boolean {
  if (owner.kind === 'item') return owner.acts.some((a) => ITEM_SETTLING.includes(a.act) && a.at <= end);
  if (owner.kind === 'ask') return owner.state === 'answered' && owner.answeredAt !== null && owner.answeredAt <= end;
  return false;
}

/** Table 4.3b, first match, over measured facts only. Acts come from the owners' rows and need no receipts; a receipt
 *  only ever moves a row among `opened`, `not-opened` and `unmeasured` (Review Focus 5). `not-opened` is read as a window
 *  property: no boot of this server inside the window (`bootsInWindow`, question 17), never the build compared at the two
 *  ends, and the restore generation measured and equal at both (question 5). */
export function responseOutcome(f: SealFacts, windowEnd: number): SealOutcome {
  const { row, owner } = f;
  const start = windowStart(row);
  const isPush = row.kind === 'push';
  const accepted = new Set(row.acceptedSubs);
  const counted = (r: SealReceipt): boolean => r.at >= row.insertedAt && r.at <= windowEnd
    && (isPush ? r.source === 'worker' && accepted.has(r.endpointHash) : r.source === 'console');
  const earliest = (k: ReceiptKind): number | null => {
    const at = f.receipts.filter((r) => r.receipt === k && counted(r)).map((r) => r.at);
    return at.length === 0 ? null : Math.min(...at);
  };
  const shownAt = earliest('shown');
  const openedAt = earliest('opened');
  const seen = { shownAt, openedAt };
  // 1. acted
  const act = operatorAct(owner, start, windowEnd);
  if (act !== null) return sealOf('acted', { how: act.how, actedAt: act.at, ...seen });
  // 2. settled-elsewhere
  if (settledElsewhere(owner, windowEnd)) return sealOf('settled-elsewhere', seen);
  if (owner.kind === 'gone') return sealOf('unmeasured', { why: 'reader', ...seen });
  // 3. not-actionable
  if (isPush && row.carries === null && !row.hasActions) return sealOf('not-actionable', seen);
  // 4. unmeasured, with its reason
  if (isPush && row.state === 'pending') return sealOf('unmeasured', { why: 'no-verdict', ...seen });
  if (owner.kind === 'ask' && (owner.state === 'stale' || owner.state === 'unknown')) return sealOf('unmeasured', { why: 'ask-ended', ...seen });
  if (isPush && openedAt === null) {
    const shownBy = new Set(f.receipts.filter((r) => r.receipt === 'shown' && counted(r)).map((r) => r.endpointHash));
    const stampsHold = f.bootsInWindow === 0
      && row.boot.kind === 'measured' && f.stampNow.boot.kind === 'measured'
      && row.restore.kind === 'measured' && f.stampNow.restore.kind === 'measured' && row.restore.n === f.stampNow.restore.n;
    if (row.acceptedSubs.some((s) => !shownBy.has(s)) || f.replacedOn.some((s) => accepted.has(s)) || !stampsHold) {
      return sealOf('unmeasured', { why: 'receipts', ...seen });
    }
  }
  // 5. opened
  if (openedAt !== null) return sealOf('opened', seen);
  // 6. not-opened: only a push, only with a non-empty accepted set, every guard of rule 4 passed
  if (isPush && row.acceptedSubs.length > 0) return sealOf('not-opened', seen);
  // 7. no receipt shows it was on a screen
  return sealOf('unmeasured', { why: 'receipts', ...seen });
}

/** Whether to seal now. A sealed row is never sealed again. A failed read seals nothing until a day past the window's
 *  end (the row's `windowCapAt`, or a pending push's 24 hours, when the owner could not be read), then seals
 *  `unmeasured`, `reader`, with no act. A read whose window has not ended seals nothing. Otherwise `responseOutcome`. */
export function responseSealDue(row: SealRow, read: { readonly ok: true; readonly facts: SealFacts } | { readonly ok: false }, now: number): SealDecision {
  if (row.state === 'sealed') return { seal: false };
  if (!read.ok) {
    const end = row.kind === 'push' && row.state === 'pending' ? row.insertedAt + PUSH_WINDOW_MS : row.windowCapAt;
    if (end === null || now < end + SEAL_DEFER_MS) return { seal: false };
    return sealOf('unmeasured', { why: 'reader' });
  }
  const end = responseWindowEnd(row, read.facts.owner);
  if (end === null || now < end) return { seal: false };
  return responseOutcome(read.facts, end);
}

// ── THE FIGURES (PR B, Task 5: question 13; W3's Week page is the first reader) ─────────────────────────────────────────

/** A row as `responsesFor` reads it: its scope, delivery, seal and correction. */
export interface SealedRowView {
  readonly kind: ResponseKind;
  readonly label: string;
  readonly delivery: ResponseDelivery;
  readonly outcome: ResponseOutcome | null;     // null: not sealed yet
  readonly why: UnmeasuredWhy | null;
  readonly admittedAt: number | null;
  readonly deliveredAt: number | null;
  readonly openedAt: number | null;
  readonly actedAt: number | null;
  readonly handledAt: number | null;
}
export type ResponseScope = { readonly by: 'label'; readonly kind: ResponseKind; readonly label: string };  // W3 adds { by: 'class' }
export interface ResponseFigureCounts {
  /** Delivered rows with a verdict, less `settled-elsewhere`, `not-actionable`, and `unmeasured` whose why is `reader`,
   *  `ask-ended` or `no-verdict`; `unmeasured`, `receipts` rows count (C68). A handled row always counts. */
  readonly measured: number;
  readonly acted: number;
  /** Acted rows that also hold a counted open. */
  readonly actedAfterOpen: number;
  /** Rows the operator marked "I handled this elsewhere" (C69), each also counted `acted`. */
  readonly elsewhere: number;
  readonly opened: number;
  readonly notOpened: number;
  readonly unmeasured: number;
  readonly medianActMs: number | null;
}
export interface ResponseFigures extends ResponseFigureCounts {
  readonly byDelivery: Readonly<Record<ResponseDelivery, ResponseFigureCounts>>;
}
/** C68's figures look back at most 28 days. */
export const RESPONSE_FIGURES_LOOKBACK_MS = 28 * 86_400_000;

function figuresOf(rows: readonly SealedRowView[]): ResponseFigureCounts {
  let measured = 0, acted = 0, actedAfterOpen = 0, elsewhere = 0, opened = 0, notOpened = 0, unmeasured = 0;
  const actMs: number[] = [];
  for (const r of rows) {
    // The correction first (C69): a handled row is acted, elsewhere, whatever its seal said, and always measured.
    const outcome = r.handledAt !== null ? 'acted' : r.outcome;
    if (outcome === null) continue;
    if (r.handledAt !== null) elsewhere += 1;
    if (outcome === 'acted') {
      acted += 1; measured += 1;
      if (r.openedAt !== null) actedAfterOpen += 1;
      if (r.actedAt !== null && r.deliveredAt !== null) actMs.push(r.actedAt - r.deliveredAt);
    } else if (outcome === 'opened') { opened += 1; measured += 1; }
    else if (outcome === 'not-opened') { notOpened += 1; measured += 1; }
    else if (outcome === 'unmeasured') { unmeasured += 1; if (r.why === 'receipts') measured += 1; }
  }
  actMs.sort((a, b) => a - b);
  const mid = actMs.length >> 1;
  const medianActMs = actMs.length === 0 ? null : actMs.length % 2 === 1 ? actMs[mid]! : (actMs[mid - 1]! + actMs[mid]!) / 2;
  return { measured, acted, actedAfterOpen, elsewhere, opened, notOpened, unmeasured, medianActMs };
}

/** The figures of one scope over the rows admitted inside `[max(since, now - 28 days), now]`, total and split by
 *  delivery. Pure: the rows are read by the caller. */
export function responsesFor(rows: readonly SealedRowView[], scope: ResponseScope, since: number, now: number): ResponseFigures {
  const from = Math.max(since, now - RESPONSE_FIGURES_LOOKBACK_MS);
  const inScope = rows.filter((r) => r.kind === scope.kind && r.label === scope.label
    && r.admittedAt !== null && r.admittedAt >= from && r.admittedAt <= now);
  return {
    ...figuresOf(inScope),
    byDelivery: {
      'at-once': figuresOf(inScope.filter((r) => r.delivery === 'at-once')),
      'in-batch': figuresOf(inScope.filter((r) => r.delivery === 'in-batch')),
    },
  };
}

// ── RETENTION (PR B, Task 8: question 16) ───────────────────────────────────────────────────────────────────────────────

/** Which gate a change of retention needs: lowering it deletes rows irreversibly on the next pass, as a wipe does, so it
 *  asks the step-up; a stored value the door cannot read is treated as a lowering. Raising it, or setting the stored
 *  value again, needs the session alone. */
export function retentionChangeGate(stored: number | 'unreadable', next: number): 'step-up' | 'session' {
  if (stored === 'unreadable') return 'step-up';
  return next < stored ? 'step-up' : 'session';
}

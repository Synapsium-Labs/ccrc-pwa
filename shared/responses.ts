/** The response record's vocabulary (Overlord design spec §4.3, C66 and C67; plan
 *  `docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md`, Task 1). Ring L0, context C6: pure vocabulary and
 *  one parser, no value import (the PWA bundles this file). PR B added the outcomes, the windows and the retention bounds.
 *
 *  A message ccrc puts in front of the operator gets one row. A receipt says what the operator's device or console did
 *  with it: ids, kinds and times only, never text (Global Constraints). */
import type { DigestRowKind } from './api.js';

const RESPONSE_KIND_MAP = {
  push: 'a push the push service accepted for at least one subscription',
  waiting: 'a Waiting on you row: an item or an ask, from its reach',
  digest: 'a decision line of a digest, from its claim',
  reply: 'a chat reply of the Overlord (its writer waits on index question 10)',
} as const;
export type ResponseKind = keyof typeof RESPONSE_KIND_MAP;
export const RESPONSE_KINDS = Object.keys(RESPONSE_KIND_MAP) as ResponseKind[];

const RECEIPT_KIND_MAP: Record<ReceiptKind, true> = { shown: true, opened: true };
export type ReceiptKind = 'shown' | 'opened';
export const RECEIPT_KINDS = Object.keys(RECEIPT_KIND_MAP) as ReceiptKind[];

const RECEIPT_SOURCE_MAP: Record<ReceiptSource, true> = { worker: true, console: true };
export type ReceiptSource = 'worker' | 'console';
export const RECEIPT_SOURCES = Object.keys(RECEIPT_SOURCE_MAP) as ReceiptSource[];

/** W1 writes 'at-once' only; W3's batches write 'in-batch'. */
const RESPONSE_DELIVERY_MAP: Record<ResponseDelivery, true> = { 'at-once': true, 'in-batch': true };
export type ResponseDelivery = 'at-once' | 'in-batch';
export const RESPONSE_DELIVERIES = Object.keys(RESPONSE_DELIVERY_MAP) as ResponseDelivery[];
/** The delivery every W1 push row is written with (`insertPushResponseInTx`): one typed word, bound as a parameter. */
export const PUSH_RESPONSE_DELIVERY: ResponseDelivery = 'at-once';

/** Why the receipts door drops a receipt, the keys of its answer's `dropped` counts: `receiptVerdict`'s five words, and
 *  `repeat` for a kept one the unique index already holds (slug a-repeat-receipt-is-dropped-as-repeat). */
const RECEIPT_DROP_MAP: Record<ReceiptDrop, true> = {
  'no-row': true, sealed: true, 'wrong-source': true, 'not-accepted': true, full: true, repeat: true,
};
export type ReceiptDrop = 'no-row' | 'sealed' | 'wrong-source' | 'not-accepted' | 'full' | 'repeat';
export const RECEIPT_DROPS = Object.keys(RECEIPT_DROP_MAP) as ReceiptDrop[];
export const isReceiptDrop = (w: string): w is ReceiptDrop => (RECEIPT_DROPS as readonly string[]).includes(w);

const RESPONSE_ROW_STATE_MAP: Record<ResponseRowState, true> = { pending: true, delivered: true, sealed: true };
export type ResponseRowState = 'pending' | 'delivered' | 'sealed';
export const RESPONSE_ROW_STATES = Object.keys(RESPONSE_ROW_STATE_MAP) as ResponseRowState[];

/** A stamp is measured or not, never a placeholder value (questions 5 and 17). `boot` is this process's epoch in
 *  `response_boots`; `restore` is the restore generation authority journal C counts. */
export type BootStamp = { readonly kind: 'measured'; readonly epoch: number } | { readonly kind: 'unmeasured' };
export type RestoreStamp = { readonly kind: 'measured'; readonly n: number } | { readonly kind: 'unmeasured' };
export interface ResponseStamp { readonly boot: BootStamp; readonly restore: RestoreStamp }

/** What a receipt names. A push by its id; a Waiting on you row by its source; a digest line by its key; a reply by its
 *  message id (the chat's, later). */
export type ResponseRef =
  | { readonly kind: 'push'; readonly pushId: string }
  | { readonly kind: 'item'; readonly id: number }
  | { readonly kind: 'ask'; readonly id: number }
  | { readonly kind: 'digest'; readonly key: string }        // `<day>:<rowKind>:<id>` (question 8)
  | { readonly kind: 'reply'; readonly id: number };

export type ReceiptFrom =
  | { readonly source: 'worker'; readonly version: number; readonly endpointHash: string }
  | { readonly source: 'console' };
export interface ReceiptIn { readonly ref: ResponseRef; readonly receipt: ReceiptKind; readonly from: ReceiptFrom }

export const RECEIPTS_MAX_PER_BODY = 50;                    // the digest page names one per decision line
export const RECEIPT_WORKER_VERSION = 1;                    // the receipt protocol's version, posted by push-sw.js
export const RECEIPTS_PER_PUSH_MAX = 8;                     // worker receipts of each kind kept per push row (question 19)
/** A push's window: 24 hours from its first acceptance (§4.3 Table 4.3a). Set on the row as `windowCapAt` when the
 *  verdict lands (PR A); the seal reads it (PR B). */
export const PUSH_WINDOW_MS = 24 * 3_600_000;

/** What the operator did with a message, sealed once its window closes (§4.3 Table 4.3b). The order is the table's,
 *  which is `responseOutcome`'s first match (PR B). */
const RESPONSE_OUTCOME_MAP: Record<ResponseOutcome, true> = {
  acted: true, 'settled-elsewhere': true, 'not-actionable': true, unmeasured: true, opened: true, 'not-opened': true,
};
export type ResponseOutcome = 'acted' | 'settled-elsewhere' | 'not-actionable' | 'unmeasured' | 'opened' | 'not-opened';
export const RESPONSE_OUTCOMES = Object.keys(RESPONSE_OUTCOME_MAP) as ResponseOutcome[];

/** How an act was recorded. `reply` and `push-action` have no writer in W1 (questions 4 and 10). */
const ACTED_HOW_MAP: Record<ActedHow, true> = {
  tick: true, answer: true, dismiss: true, act: true, decline: true, correct: true, reply: true, 'push-action': true,
};
export type ActedHow = 'tick' | 'answer' | 'dismiss' | 'act' | 'decline' | 'correct' | 'reply' | 'push-action';
export const ACTED_HOWS = Object.keys(ACTED_HOW_MAP) as ActedHow[];

/** Why a row sealed `unmeasured`: a push never delivered, a fact the lane could not read, an ask that ended `stale` or
 *  `unknown`, or receipts that cannot prove an open or its absence. */
const UNMEASURED_WHY_MAP: Record<UnmeasuredWhy, true> = { 'no-verdict': true, reader: true, 'ask-ended': true, receipts: true };
export type UnmeasuredWhy = 'no-verdict' | 'reader' | 'ask-ended' | 'receipts';
export const UNMEASURED_WHYS = Object.keys(UNMEASURED_WHY_MAP) as UnmeasuredWhy[];

/** A Waiting on you row's longest window: seven days from its reach (§4.3 Table 4.3a), unrelated to token rotation. */
export const WAITING_WINDOW_MS = 7 * 86_400_000;
/** A failed reader defers a seal at most a day past the window's end, then the row seals `unmeasured`, `reader`. */
export const SEAL_DEFER_MS = 86_400_000;
/** The operator's retention of response rows, in whole days (§9.4 rule 10; question 16). The minimum covers the longest
 *  seal path, a Waiting on you row's seven days plus the seal's one-day deferral, with room. Starting values. */
export const RESPONSE_RETENTION_DEFAULT_DAYS = 180;
export const RESPONSE_RETENTION_MIN_DAYS = 14;
export const RESPONSE_RETENTION_MAX_DAYS = 3_650;

/** One row of `GET /api/responses?ref=` (the console's "I handled this elsewhere", C69): ids, kinds, labels, states,
 *  outcomes and handled times only. `handledAt` is null while the operator has not marked it. */
export interface ResponseRowBrief {
  readonly id: number; readonly kind: ResponseKind; readonly label: string; readonly state: ResponseRowState;
  readonly outcome: ResponseOutcome | null; readonly handledAt: number | null;
}
/** `GET`/`POST /api/responses/retention`'s answer: the days, or `days: null` with `unreadable` when the setting cannot be
 *  read, beside the default and the bounds. */
export type ResponseRetentionView =
  | { readonly ok: true; readonly days: number; readonly default: number; readonly min: number; readonly max: number }
  | { readonly ok: true; readonly days: null; readonly unreadable: true; readonly default: number; readonly min: number; readonly max: number };

/** The digest row kinds, spelled as a map typed by `DigestRowKind`, so a new kind is a compile error here; a test pins
 *  the list equal to `DIGEST_ROW_KINDS` (a value import of `api.ts` would make this file carry its weight). */
const DIGEST_KEY_ROW_KIND_MAP: Record<DigestRowKind, true> = { ask: true, approval: true, call: true };
export const DIGEST_KEY_ROW_KINDS = Object.keys(DIGEST_KEY_ROW_KIND_MAP) as DigestRowKind[];

/** A digest decision line's key: `<day>:<rowKind>:<id>` (question 8). */
export function digestLineKey(day: string, rowKind: DigestRowKind, id: number): string {
  return `${day}:${rowKind}:${id}`;
}

type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };
const bad = (detail: string): { readonly ok: false; readonly detail: string } => ({ ok: false, detail });
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** The keys of `o` outside `allowed`, first one's name; never a value. */
const strayKey = (o: Record<string, unknown>, allowed: readonly string[]): string | null =>
  Object.keys(o).find((k) => !allowed.includes(k)) ?? null;
const isId = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 1;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PUSH_ID = /^[0-9a-f]{32}$/;
const ENDPOINT_HASH = /^[0-9a-f]{64}$/;

/** Whether `key` is a key `digestLineKey` could have produced. */
export function isDigestLineKey(key: string): boolean {
  const parts = key.split(':');
  if (parts.length !== 3) return false;
  const [day, rowKind, id] = parts as [string, string, string];
  if (!DAY.test(day) || !(DIGEST_KEY_ROW_KINDS as readonly string[]).includes(rowKind) || !/^[1-9][0-9]*$/.test(id)) return false;
  return key === digestLineKey(day, rowKind as DigestRowKind, Number(id));
}

function parseRef(x: unknown, at: string): Parsed<ResponseRef> {
  if (!isObj(x)) return bad(`${at} is not an object`);
  const kind = x['kind'];
  if (kind === 'push') {
    const s = strayKey(x, ['kind', 'pushId']);
    if (s !== null) return bad(`${at} holds a field a push ref has not`);
    const id = x['pushId'];
    return typeof id === 'string' && PUSH_ID.test(id) ? { ok: true, value: { kind, pushId: id } } : bad(`${at}.pushId is not 32 lowercase hex characters`);
  }
  if (kind === 'item' || kind === 'ask' || kind === 'reply') {
    const s = strayKey(x, ['kind', 'id']);
    if (s !== null) return bad(`${at} holds a field a ${kind} ref has not`);
    const id = x['id'];
    return isId(id) ? { ok: true, value: { kind, id } } : bad(`${at}.id is not a positive integer`);
  }
  if (kind === 'digest') {
    const s = strayKey(x, ['kind', 'key']);
    if (s !== null) return bad(`${at} holds a field a digest ref has not`);
    const key = x['key'];
    return typeof key === 'string' && isDigestLineKey(key) ? { ok: true, value: { kind, key } } : bad(`${at}.key is not a digest line key`);
  }
  return bad(`${at}.kind is not a ref kind`);
}

function parseFrom(x: unknown, at: string): Parsed<ReceiptFrom> {
  if (!isObj(x)) return bad(`${at} is not an object`);
  const source = x['source'];
  if (source === 'console') {
    const s = strayKey(x, ['source']);
    return s === null ? { ok: true, value: { source } } : bad(`${at} holds a field a console source has not`);
  }
  if (source === 'worker') {
    const s = strayKey(x, ['source', 'version', 'endpointHash']);
    if (s !== null) return bad(`${at} holds a field a worker source has not`);
    const version = x['version'];
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < RECEIPT_WORKER_VERSION) {
      return bad(`${at}.version is not an integer of at least ${RECEIPT_WORKER_VERSION}`);
    }
    const hash = x['endpointHash'];
    if (typeof hash !== 'string' || !ENDPOINT_HASH.test(hash)) return bad(`${at}.endpointHash is not 64 lowercase hex characters`);
    return { ok: true, value: { source, version, endpointHash: hash } };
  }
  return bad(`${at}.source is not a receipt source`);
}

/** Reads the receipts door's body `{ v: 1, receipts: [...] }`. A refusal's `detail` names the field and never echoes a
 *  value. */
export function parseReceiptBody(body: unknown):
  | { readonly ok: true; readonly receipts: readonly ReceiptIn[] }
  | { readonly ok: false; readonly detail: string } {
  if (!isObj(body)) return bad('the body is not an object');
  const s = strayKey(body, ['v', 'receipts']);
  if (s !== null) return bad('the body holds a field it may not');
  if (body['v'] !== 1) return bad('v is not a known version');
  const list = body['receipts'];
  if (!Array.isArray(list)) return bad('receipts is not a list');
  if (list.length > RECEIPTS_MAX_PER_BODY) return bad(`receipts holds more than ${RECEIPTS_MAX_PER_BODY} receipts`);
  const out: ReceiptIn[] = [];
  for (const [i, raw] of list.entries()) {
    const at = `receipts[${i}]`;
    if (!isObj(raw)) return bad(`${at} is not an object`);
    const stray = strayKey(raw, ['ref', 'receipt', 'from']);
    if (stray !== null) return bad(`${at} holds a field a receipt has not`);
    const ref = parseRef(raw['ref'], `${at}.ref`);
    if (!ref.ok) return bad(ref.detail);
    const receipt = raw['receipt'];
    if (!(RECEIPT_KINDS as readonly unknown[]).includes(receipt)) return bad(`${at}.receipt is not a receipt kind`);
    const from = parseFrom(raw['from'], `${at}.from`);
    if (!from.ok) return bad(from.detail);
    out.push({ ref: ref.value, receipt: receipt as ReceiptKind, from: from.value });
  }
  return { ok: true, receipts: out };
}

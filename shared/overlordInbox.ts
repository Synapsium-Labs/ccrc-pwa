// The Overlord inbox's vocabulary and codecs (Overlord W1, inbox piece, Task 1; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-inbox.md`; spec §6.8 and §3.8). Ring L0, context C5: it imports only its
// `./` siblings, the two type-only ones from `operatorMessages.ts` and `continuity.ts`, and the injected-prompt list (the
// PWA bundles every `shared/*.ts` file, so nothing else may enter). Pure: the bands and their rank, the row kinds with the
// door that serves each one's content, the nudge each kind has besides the wake, the rows and the answer, the read
// ceilings, the path id's parser, and the coalesced wake's subject, body codec and fixed lines. Each runtime list is derived
// from its map, so a word is spelled once.
//
// The inbox carries ids, never words (the plan's question 5): no row, fact or answer field holds a message's text or a
// probe's question, and the wake's body holds row keys and counts only (the "no words in `coord.db`" constraint).
import type { MessageState, ReadDoor } from './operatorMessages.js';
import type { ProbeRoundKind } from './continuity.js';
import { INJECTED_PROMPTS } from './injected-prompts.mjs';

/** The inbox's bands, by their rank (§6.8): a probe round ahead of band 1, then the four bands. */
const INBOX_BAND_MAP = { probe: 0, operator: 1, deadline: 2, moves: 3, background: 4 } as const;
export type InboxBand = keyof typeof INBOX_BAND_MAP;
export const INBOX_BANDS = Object.keys(INBOX_BAND_MAP) as InboxBand[];
export const isInboxBand = (v: unknown): v is InboxBand =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(INBOX_BAND_MAP, v);
export function bandRank(b: InboxBand): number { return INBOX_BAND_MAP[b]; }
/** The bands this build serves. W2 adds `moves`; W3 adds `deadline`, then `background`. */
export const INBOX_SERVED_BANDS: readonly InboxBand[] = ['probe', 'operator'];

/** Each row kind: its band and the door that serves its content. W2 and W3 add rows; none changes. */
export const INBOX_KIND_MAP = {
  'probe-round': { band: 'probe', door: 'probe' },
  'operator-message': { band: 'operator', door: 'messages' },
} as const;
export type InboxKind = keyof typeof INBOX_KIND_MAP;
export const INBOX_KINDS = Object.keys(INBOX_KIND_MAP) as InboxKind[];
export const isInboxKind = (v: unknown): v is InboxKind =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(INBOX_KIND_MAP, v);

/** What nudges a row of each kind besides the wake (question 7). `none` is what the wake covers. */
const ROW_NUDGE_MAP = {
  'message-nudge': "the private store's own nudge, naming the message's id",
  'renewal-feed': "the renewal act's ordered feed, while the generation is probing",
  'spot-probe-notice': "the renewal act's system mail for a spot round opened while live",
  none: 'no nudge of its own: the wake covers the row',
} as const;
export type RowNudge = keyof typeof ROW_NUDGE_MAP;
export const ROW_NUDGES = Object.keys(ROW_NUDGE_MAP) as RowNudge[];
export const isRowNudge = (v: unknown): v is RowNudge =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(ROW_NUDGE_MAP, v);
export const MESSAGE_NUDGE: RowNudge = 'message-nudge';
/** A probe round's nudge depends on the round's kind: a compaction round opened while `active` has no notice. */
export const PROBE_ROUND_NUDGE: Readonly<Record<ProbeRoundKind, RowNudge>> = {
  start: 'renewal-feed', spot: 'spot-probe-notice', compaction: 'none',
};

export type InboxDue = { readonly kind: 'none' } | { readonly kind: 'by'; readonly at: number };
interface InboxRowBase {
  readonly key: string;       // `<kind>:<id>`, stable across reads: `probe-round:<roundId>`, `operator-message:<id>`
  readonly band: InboxBand; readonly at: number; readonly due: InboxDue; readonly door: string;
}
export interface ProbeRoundRow extends InboxRowBase {
  readonly kind: 'probe-round'; readonly roundId: string; readonly roundKind: ProbeRoundKind; readonly questions: number;
}
export interface MessageInboxRow extends InboxRowBase {
  readonly kind: 'operator-message'; readonly messageId: number; readonly term: number;
  readonly state: MessageState | 'unknown'; readonly cut: boolean;
}
export type InboxRow = ProbeRoundRow | MessageInboxRow;

const INBOX_BEHIND_KIND_MAP = {
  'probe-first': 'a probe round is served alone; the count waits behind it',
  page: 'the page is full; the count is the rows past it',
} as const;
export type InboxBehindKind = keyof typeof INBOX_BEHIND_KIND_MAP;
export const INBOX_BEHIND_KINDS = Object.keys(INBOX_BEHIND_KIND_MAP) as InboxBehindKind[];
export const isInboxBehindKind = (v: unknown): v is InboxBehindKind =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(INBOX_BEHIND_KIND_MAP, v);
export type InboxBehind = { readonly kind: 'none' } | { readonly kind: InboxBehindKind; readonly count: number };
export interface InboxAnswer {
  readonly ok: true; readonly at: number; readonly servedBands: readonly InboxBand[];
  readonly rows: readonly InboxRow[]; readonly behind: InboxBehind;
}
export const INBOX_PAGE_ROWS = 100;

/** The read ledger's served outcome: the one outcome a ceiling counts (board and history's ruling R8). */
export const READ_SERVED_OUTCOME = 'rows';
/** The outcome of the line a ceiling refusal writes (one for each door and window), which the counter reads the newest of. */
export const READ_CEILING_OUTCOME = 'read-ceiling';
export const READ_CEILING_WINDOW_MS = 3_600_000;
/** Every read door's ceiling over a rolling hour (question 1), total over the ledger's doors. */
export const READ_CEILINGS: Readonly<Record<ReadDoor, { readonly perHour: number }>> = {
  inbox: { perHour: 240 }, messages: { perHour: 120 }, board: { perHour: 120 }, history: { perHour: 60 }, sequence: { perHour: 120 },
};

/** A path id: a positive safe integer, no sign, no leading zero. A refusal's detail never echoes the input. */
export function parseMessageId(raw: unknown): { ok: true; id: number } | { ok: false; detail: string } {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) {
    return { ok: false, detail: 'the id is not a positive whole number in plain digits' };
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) return { ok: false, detail: 'the id is past the largest whole number the server reads' };
  return { ok: true, id };
}

/** The coalesced wake. Its subject is fixed, so `queueSystemMail`'s dedupe keeps one undelivered. */
export const INBOX_WAKE_SUBJECT = 'inbox-wake';
/** The wake's sender: the private store's own (`OPERATOR_MESSAGE_SENDER`, which this file may not import by value; a test
 *  holds the two equal). */
export const INBOX_WAKE_SENDER = 'operator';
export function isInboxWakeMail(m: { readonly fromId: string; readonly subject: string }): boolean {
  return m.fromId === INBOX_WAKE_SENDER && m.subject === INBOX_WAKE_SUBJECT;
}
export interface InboxWakeBody {
  readonly keys: readonly string[]; readonly waiting: number; readonly firstDue: InboxDue;
}
const WAKE_BODY_HEAD = 'inbox-wake v1';
/** `inbox-wake v1`, then `waiting`, `first-due` and one `key` line for each key. */
export function renderInboxWakeBody(b: InboxWakeBody): string {
  const due = b.firstDue.kind === 'by' ? `by ${b.firstDue.at}` : 'none';
  return [WAKE_BODY_HEAD, `waiting: ${b.waiting}`, `first-due: ${due}`, ...b.keys.map((k) => `key: ${k}`)].join('\n');
}
const COUNT_SHAPE = /^(?:0|[1-9][0-9]*)$/;
const KEY_SHAPE = /^[^\s\u0000-\u001f\u007f]+$/;
const readCount = (s: string): number | null => {
  if (!COUNT_SHAPE.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
};
export function readInboxWakeBody(s: string): { ok: true; body: InboxWakeBody } | { ok: false } {
  const refused = { ok: false } as const;
  const lines = s.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines[0] !== WAKE_BODY_HEAD) return refused;
  let waiting: number | null = null;
  let firstDue: InboxDue | null = null;
  const keys: string[] = [];
  for (const line of lines.slice(1)) {
    const at = line.indexOf(': ');
    if (at < 0) return refused;
    const name = line.slice(0, at);
    const value = line.slice(at + 2);
    if (name === 'waiting') {
      if (waiting !== null) return refused;
      waiting = readCount(value);
      if (waiting === null) return refused;
    } else if (name === 'first-due') {
      if (firstDue !== null) return refused;
      if (value === 'none') firstDue = { kind: 'none' };
      else if (value.startsWith('by ')) {
        const when = readCount(value.slice(3));
        if (when === null) return refused;
        firstDue = { kind: 'by', at: when };
      } else return refused;
    } else if (name === 'key') {
      if (!KEY_SHAPE.test(value) || keys.includes(value)) return refused;
      keys.push(value);
    } else return refused;
  }
  if (waiting === null || firstDue === null || waiting < keys.length) return refused;
  return { ok: true, body: { keys, waiting, firstDue } };
}

const MAIL_NUDGE_HEAD = INJECTED_PROMPTS['mail-nudge'].text;
const INBOX_DOOR_TAIL = 'read it with your inbox door.';
/** The line the mail lane types: the mail nudge's head, the count, the first deadline's time left when one exists, and the
 *  door. Given the codec's refusal, it still names the door, without a count. */
export function renderInboxWakeLine(b: { ok: true; body: InboxWakeBody } | { ok: false }, now: number): string {
  if (!b.ok) return `${MAIL_NUDGE_HEAD} Something waits in your inbox: ${INBOX_DOOR_TAIL}`;
  const due = b.body.firstDue;
  let clause = '';
  if (due.kind === 'by') {
    clause = due.at <= now ? ', the first has lapsed' : `, the first lapses in ${Math.ceil((due.at - now) / 1000)} s`;
  }
  return `${MAIL_NUDGE_HEAD} ${b.body.waiting} waiting in your inbox${clause}: ${INBOX_DOOR_TAIL}`;
}
/** The spot-probe notice's line for the designated session: the head, then the probe door. */
export function renderSpotProbeLine(): string {
  return `${MAIL_NUDGE_HEAD} A probe round is open: answer it with your probe door.`;
}

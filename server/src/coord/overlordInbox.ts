// The Overlord inbox's deciders (Overlord W1, inbox piece, Task 1; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-inbox.md`;
// spec §6.8, §3.8 and §11.2). Ring L1, context C5: pure decisions over facts the runner, the handlers and the wake lane
// (L4) read. Runtime imports: L0 (`shared/overlordInbox.ts`, `shared/operatorMessages.ts`) and the fixed-line table of `envelope.ts` (L1, for the kebab census alone), and gates B's
// `GateWord` and `GateVerdict` by type. No `fs`, no Fastify, no clock: time arrives as an argument, and every source
// arrives with its unmeasured arm, so a source that could not be read never reads as an empty one (the plan's question 14).
//
// THE DECIDERS:
//   - `composeInbox`: the open round and the unsettled messages, ordered by `inboxOrder`; a probe round is served alone
//     (question 6); a source unmeasured fails the whole.
//   - `inboxProbeSource`: the probe source from the live generation's effective state and the open round's rows, text-free
//     (the handler's two facts; only an `active` generation reads the round, question 6).
//   - `inboxOrder`, `rowNudgeOf`: the one order, and the nudge a row has besides the wake (question 7).
//   - `readCeilingVerdict`: a door's ceiling over a rolling hour (question 1), and whether the refusal's line is written.
//   - `acknowledgeVerdict`: settle, already, unknown, or absent (questions 11 and 12).
//   - `inboxWakeVerdict`: the wake's holds in their order, then whether a row with no nudge of its own is new (question 16).
import {
  INBOX_BEHIND_KINDS, INBOX_KIND_MAP, INBOX_KINDS, INBOX_PAGE_ROWS, INBOX_WAKE_SUBJECT, MESSAGE_NUDGE, PROBE_ROUND_NUDGE, READ_CEILINGS,
  READ_CEILING_WINDOW_MS, ROW_NUDGES, bandRank,
} from '../../../shared/overlordInbox.js';
import type {
  InboxBehind, InboxRow, InboxWakeBody, MessageInboxRow, ProbeRoundRow, RowNudge,
} from '../../../shared/overlordInbox.js';
import type { MessageState, ReadDoor } from '../../../shared/operatorMessages.js';
import type { GenerationState, ProbeRoundKind } from '../../../shared/continuity.js';
import type { GateVerdict, GateWord } from './overlordGate.js';
import { FIXED_LINE_MAIL, FIXED_LINE_REPLAYS } from './envelope.js';

export type Source<T> = { readonly kind: 'measured'; readonly value: T } | { readonly kind: 'unmeasured'; readonly why: string };
export interface OpenRound { readonly roundId: string; readonly kind: ProbeRoundKind; readonly questions: number; readonly askedAt: number }
/** The private store's `unsettledFacts()` row: no text. */
export interface MessageFacts {
  readonly id: number; readonly at: number; readonly term: number; readonly state: MessageState | 'unknown'; readonly cut: boolean;
}
export interface InboxSources {
  /** The live generation's open round, or 'none'. Read only while the generation is `active`; else 'none'. */
  readonly probe: Source<OpenRound | 'none'>;
  readonly messages: Source<readonly MessageFacts[]>;
}
export type InboxComposed =
  | { readonly kind: 'served'; readonly rows: readonly InboxRow[]; readonly behind: InboxBehind }
  | { readonly kind: 'unmeasured'; readonly source: 'probe' | 'messages'; readonly why: string };

const NONE = { kind: 'none' } as const;

/** The one order: band rank; in `probe`, the one round; in `operator`, commands (none in W1) then messages by `at`, then
 *  id; in `deadline`, `due.at` then `at`; in `moves` and `background`, `at` then key. */
export function inboxOrder(a: InboxRow, b: InboxRow): number {
  const byBand = bandRank(a.band) - bandRank(b.band);
  if (byBand !== 0) return byBand;
  const byTime = a.at - b.at;
  const byKey = a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  if (a.band === 'operator') {
    const aMessage = a.kind === 'operator-message';
    const bMessage = b.kind === 'operator-message';
    if (aMessage !== bMessage) return aMessage ? 1 : -1;
    if (a.kind === 'operator-message' && b.kind === 'operator-message') return byTime !== 0 ? byTime : a.messageId - b.messageId;
    return byTime !== 0 ? byTime : byKey;
  }
  if (a.band === 'deadline') {
    if (a.due.kind !== b.due.kind) return a.due.kind === 'by' ? -1 : 1;
    if (a.due.kind === 'by' && b.due.kind === 'by' && a.due.at !== b.due.at) return a.due.at - b.due.at;
    return byTime !== 0 ? byTime : byKey;
  }
  return byTime !== 0 ? byTime : byKey;
}

const probeRowOf = (r: OpenRound): ProbeRoundRow => ({
  kind: 'probe-round', key: `probe-round:${r.roundId}`, band: INBOX_KIND_MAP['probe-round'].band, at: r.askedAt, due: NONE,
  door: INBOX_KIND_MAP['probe-round'].door, roundId: r.roundId, roundKind: r.kind, questions: r.questions,
});
const messageRowOf = (f: MessageFacts): MessageInboxRow => ({
  kind: 'operator-message', key: `operator-message:${f.id}`, band: INBOX_KIND_MAP['operator-message'].band, at: f.at, due: NONE,
  door: INBOX_KIND_MAP['operator-message'].door, messageId: f.id, term: f.term, state: f.state, cut: f.cut,
});

/** A probe round is served alone, with the count behind it; else the messages in order, cut at the page. A source
 *  unmeasured answers `unmeasured` naming it (the probe first), never a partial list. */
export function composeInbox(s: InboxSources): InboxComposed {
  if (s.probe.kind === 'unmeasured') return { kind: 'unmeasured', source: 'probe', why: s.probe.why };
  if (s.messages.kind === 'unmeasured') return { kind: 'unmeasured', source: 'messages', why: s.messages.why };
  const messages = s.messages.value.map(messageRowOf).sort(inboxOrder);
  if (s.probe.value !== 'none') {
    const behind: InboxBehind = messages.length > 0 ? { kind: 'probe-first', count: messages.length } : NONE;
    return { kind: 'served', rows: [probeRowOf(s.probe.value)], behind };
  }
  const past = messages.length - INBOX_PAGE_ROWS;
  return { kind: 'served', rows: messages.slice(0, INBOX_PAGE_ROWS), behind: past > 0 ? { kind: 'page', count: past } : NONE };
}

/** The live generation's effective state as the handler read it (the gate runner's own reading): a state, no live generation, or
 *  unmeasured with its reason. */
export type GenerationFact = { readonly kind: 'state'; readonly state: GenerationState } | { readonly kind: 'none' } | { readonly kind: 'unmeasured'; readonly why: string };
/** The open round's rows as `CoordStore.openProbeRound` answers them, cut to the fields the inbox may carry: never a question, its
 *  choices or what it expects. An empty list is no open round; a failed read carries its detail. */
export type ProbeRowsFact =
  | { readonly ok: true; readonly rows: readonly { readonly roundId: string; readonly kind: ProbeRoundKind; readonly askedAt: number }[] }
  | { readonly ok: false; readonly detail: string };

/** The inbox's probe source (question 6). Only an `active` generation has an open round to serve: the handler asks first with
 *  `'not-read'`, and the answer `read-rows` is the decider asking for the round's rows; it asks again with them. Any other state
 *  reads `none`, never the round; an unreadable state or round is unmeasured, never `none`. The answer maps ids, kind, count and
 *  the first row's time only. */
export function inboxProbeSource(gen: GenerationFact, rows: 'not-read'): Source<OpenRound | 'none'> | { readonly kind: 'read-rows' };
export function inboxProbeSource(gen: GenerationFact, rows: ProbeRowsFact): Source<OpenRound | 'none'>;
export function inboxProbeSource(gen: GenerationFact, rows: ProbeRowsFact | 'not-read'): Source<OpenRound | 'none'> | { readonly kind: 'read-rows' } {
  if (gen.kind === 'unmeasured') return { kind: 'unmeasured', why: gen.why };
  if (gen.kind !== 'state' || gen.state !== 'active') return { kind: 'measured', value: 'none' };
  if (rows === 'not-read') return { kind: 'read-rows' };
  if (!rows.ok) return { kind: 'unmeasured', why: rows.detail };
  const first = rows.rows[0];
  if (first === undefined) return { kind: 'measured', value: 'none' };
  return { kind: 'measured', value: { roundId: first.roundId, kind: first.kind, questions: rows.rows.length, askedAt: first.askedAt } };
}

/** The inbox's probe source for one caller, through the two steps `inboxProbeSource` asks: the generation first, then the open
 *  round's rows only when the decider asks for them. `readRows` is the reader the caller binds (the inbox door and the wake read
 *  the round through the same one, `overlordInboxWake.ts#openRoundFact`). */
export function inboxProbeSourceOf(gen: GenerationFact, readRows: () => ProbeRowsFact): Source<OpenRound | 'none'> {
  const asked = inboxProbeSource(gen, 'not-read');
  return asked.kind === 'read-rows' ? inboxProbeSource(gen, readRows()) : asked;
}

/** The nudge a row has besides the wake. A row of a kind this build does not know declares none: the wake covers it. */
export function rowNudgeOf(r: InboxRow): RowNudge {
  if (r.kind === 'operator-message') return MESSAGE_NUDGE;
  if (r.kind === 'probe-round') return PROBE_ROUND_NUDGE[r.roundKind];
  return 'none';
}

export interface CeilingCount { readonly count: number; readonly oldestAt: number | 'none'; readonly lastRefusalAt: number | 'none' }
export type CeilingVerdict =
  | { readonly kind: 'allow' } | { readonly kind: 'refuse'; readonly retryAfterS: number; readonly writeLine: boolean };
/** `count` is the door's `rows` lines in the window by any caller but the console; `writeLine` is false when a
 *  `read-ceiling` line of the door already stands in the window. Refuses at `count >= perHour`, with the seconds until the
 *  oldest counted line leaves the window (at least one). An oldest time of none beside a count is a reader fault: it
 *  refuses for the whole window, never allows. */
export function readCeilingVerdict(door: ReadDoor, c: CeilingCount, now: number): CeilingVerdict {
  const windowStart = now - READ_CEILING_WINDOW_MS;
  const writeLine = c.lastRefusalAt === 'none' || c.lastRefusalAt < windowStart;
  if (c.oldestAt === 'none') {
    return c.count > 0 ? { kind: 'refuse', retryAfterS: READ_CEILING_WINDOW_MS / 1000, writeLine } : { kind: 'allow' };
  }
  if (c.count < READ_CEILINGS[door].perHour) return { kind: 'allow' };
  const retryAfterS = Math.max(1, Math.ceil((c.oldestAt + READ_CEILING_WINDOW_MS - now) / 1000));
  return { kind: 'refuse', retryAfterS, writeLine };
}

export type AckVerdict =
  | { readonly kind: 'settle' } | { readonly kind: 'already'; readonly state: MessageState } | { readonly kind: 'unknown' }
  | { readonly kind: 'absent' };
/** An id that is no message is absent; one already settled or spent is `already` (a retried call is harmless); a state this build
 *  does not know is `unknown`: the private store's move refuses it (`messageMove`), so it is never reported settled and never
 *  retried (review 3389 F4). Any other state is unsettled and may be settled. */
export function acknowledgeVerdict(row: { state: MessageState | 'unknown' } | 'absent'): AckVerdict {
  if (row === 'absent') return { kind: 'absent' };
  if (row.state === 'unknown') return { kind: 'unknown' };
  if (row.state === 'settled' || row.state === 'spent') return { kind: 'already', state: row.state };
  return { kind: 'settle' };
}

/** The wake's own holds, each map checked against the union it spells; the gate's words are `GateWord`s. */
const WAKE_OWN_HOLD_MAP = {
  'not-designated': 'no session is designated, or the caller is another session',
  'mail-disabled': 'the mail kill switch stands',
  'mail-disabled-unmeasured': 'the mail kill switch could not be read',
  outstanding: 'a wake is queued and not yet delivered',
  'rows-unmeasured': 'a source of the rows could not be read',
  'nothing-new': 'every row with no nudge of its own was already woken',
} as const;
type WakeOwnHold = keyof typeof WAKE_OWN_HOLD_MAP;
export type WakeHold = GateWord | WakeOwnHold;
export interface WakeInput {
  readonly designated: boolean;                         // designationRead() answered `designated`
  readonly gate: GateVerdict | 'not-asked';             // overlordGate for the `inbox` row as a read; 'not-asked' when not designated
  readonly mailDisabled: 'standing' | 'absent' | 'unmeasured';
  readonly outstanding: boolean;                        // an `inbox-wake` mail to the session not yet delivered
  readonly composed: InboxComposed;
  readonly woken: ReadonlySet<string>;                  // the keys the last wake covered (the lane's memory)
}
export type WakeVerdict = { readonly kind: 'send'; readonly body: InboxWakeBody } | { readonly kind: 'hold'; readonly why: WakeHold };
const hold = (why: WakeHold): WakeVerdict => ({ kind: 'hold', why });

/** First match: not designated; the gate's refusal word; mail-disabled; outstanding; rows unmeasured; then send when some
 *  row whose nudge is `none` is not in `woken` (the body counts every waiting row), else nothing-new. A `hook` verdict
 *  cannot occur for the `inbox` row (its others are refused), so it holds as a caller who is not designated; a designated
 *  session whose gate was not asked holds `unmeasured`, never a pass. */
export function inboxWakeVerdict(i: WakeInput): WakeVerdict {
  if (!i.designated) return hold('not-designated');
  if (i.gate === 'not-asked') return hold('unmeasured');
  if (i.gate.kind === 'refuse') return hold(i.gate.word);
  if (i.gate.kind === 'hook') return hold('not-designated');
  if (i.mailDisabled === 'standing') return hold('mail-disabled');
  if (i.mailDisabled === 'unmeasured') return hold('mail-disabled-unmeasured');
  if (i.outstanding) return hold('outstanding');
  if (i.composed.kind === 'unmeasured') return hold('rows-unmeasured');
  const rows = i.composed.rows;
  if (!rows.some((r) => rowNudgeOf(r) === 'none' && !i.woken.has(r.key))) return hold('nothing-new');
  const behind = i.composed.behind.kind === 'none' ? 0 : i.composed.behind.count;
  const dues = rows.flatMap((r) => (r.due.kind === 'by' ? [r.due.at] : []));
  return {
    kind: 'send',
    body: {
      keys: rows.map((r) => r.key), waiting: rows.length + behind,
      firstDue: dues.length > 0 ? { kind: 'by', at: Math.min(...dues) } : NONE,
    },
  };
}

/** The words this file and the inbox's other coordination files spell as kebab literals that no other union admits: the
 *  wake's own holds, the row kinds, the nudges, the behind kinds, the wake's subject and the fixed-line table's row names and first-delivery words. The coordination kebab census
 *  (`mail-routes.test.ts`) takes them through this guard, never an allowlist pin. */
export const isOverlordInboxKebab = (word: string): boolean =>
  Object.prototype.hasOwnProperty.call(WAKE_OWN_HOLD_MAP, word)
  || (INBOX_KINDS as readonly string[]).includes(word)
  || (ROW_NUDGES as readonly string[]).includes(word)
  || (INBOX_BEHIND_KINDS as readonly string[]).includes(word)
  || word === INBOX_WAKE_SUBJECT
  || FIXED_LINE_MAIL.some((r) => r.name === word || r.firstDelivery === word)
  || (FIXED_LINE_REPLAYS as readonly string[]).includes(word)
  || word === 'read-rows';

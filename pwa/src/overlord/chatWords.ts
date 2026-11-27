// The Overlord chat's decisions and words in the console (Overlord W1, the chat, Task 1; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`, questions 5, 6 and 13; spec §3.8 H7, §4).
//
// L1: pure, no I/O, no React; it loads no `.tsx` file, no store and not `lib/api.ts` at runtime (its type imports are erased).
//
// THE RECORD IS THE ONLY SOURCE OF THE OPERATOR'S WORDS (H7, ruled F9). Any process of the fleet user, the terminal and Remote
// Control can type into the Overlord's pane, so a transcript user turn, live or from an earlier page, is never drawn as the
// operator's words. `turnOrigin` sorts each one: the mail lane's nudge line for a recorded message is replaced by that record;
// a prompt ccrc typed is a quiet system line naming it; anything else is "Typed in the Overlord's pane, not from the console",
// with the text as data. `mergeLive` places the record's messages in the live transcript; `historyItemsToChat` draws an earlier
// page; `draftAfterSend` keeps the composer's text on every answer but a recorded one. The refresh's three deciders
// (`chatReadTrigger`, `nextReadAt`, `pickUpReadEvery`), what an earlier page answer becomes (`earlierPageOf`) and every sentence
// the part says are here too. The hook decides two things of its own, named in its header (review 4120 F3): the send key's
// lifetime and the read after a send. Beyond those, the hook and the part keep only the timer's bookkeeping, the view's own state
// and a few guards.
//
// The one harness surface this leans on is Claude Code's transcript (the live generation's stream, and what a pane turn is).
// It is read only through the readers that already exist (`buildChatItems`, the history door's items), so another harness
// changes those readers, not this file.
import type { SessionStatus, SessionStreamMsg } from '../../../shared/api';
import type { ChatEarlierAnswer, ChatEntry, ChatSendAnswer, ChatThread, ChatTicks, TickStage } from '../../../shared/overlordChat';
import { CHAT_PAGE_ROWS, TICK_STAGES, tickStageWords } from '../../../shared/overlordChat';
import { carriesOperatorMessageMarker, operatorMessageNudgeIdOf } from '../../../shared/operatorMessages';
import { injectedPromptOf } from '../../../shared/injected-prompts.mjs';
import type { ChatItem } from '../session/chatItems';

// ── the kept draft (question 5) ───────────────────────────────────────────────────────────────────────────────────────

/** Whether the composer clears its text after a send: only a recorded answer (a replay of the same key included) clears it.
 *  Every refusal word (`renewing` included), an answer in no shape the chat knows, and no answer at all keep it. */
export function draftAfterSend(a: ChatSendAnswer): 'clear' | 'keep' {
  return a.kind === 'recorded' ? 'clear' : 'keep';
}

// ── when the thread is read again (question 10) ───────────────────────────────────────────────────────────────────────

/** The coalescer's spacing: at most one thread read every 10 seconds, whatever asks for it (360 an hour, half the ceiling). */
export const CHAT_READ_EVERY_MS = 10_000;

/** Whether a frame of the Overlord's session stream asks for the thread again, by an allow-list: a transcript `events` frame
 *  holding a user turn (the nudge's typing is the delivery), or a turn's end (`idle` after `busy`, when a pick-up or a
 *  settlement may have landed). Never a `beat`, never an assistant's text, never any other frame. `was` is the status the
 *  stream last said, or null before it said one. */
export function chatReadTrigger(msg: SessionStreamMsg, was: SessionStatus | null): boolean {
  if (msg.type === 'events') return msg.events.some((e) => e.kind === 'user');
  if (msg.type === 'status') return msg.status === 'idle' && was === 'busy';
  return false;
}

/** When the next thread read may run: not before the spacing (`every`, the coalescer's by default; the pick-up timer's when it
 *  asks) after the last read, and not before a ceiling's `retryAfterS` has passed (`notBefore`). Null `lastReadAt`: no read yet. */
export function nextReadAt(lastReadAt: number | null, now: number, notBefore: number, every: number = CHAT_READ_EVERY_MS): number {
  return Math.max(now, lastReadAt === null ? now : lastReadAt + every, notBefore);
}

/** How long a message is awaited for its pick-up, from its record: ten minutes (review F1). The mail lane types the nudge when
 *  the Overlord's turn ends, and a long turn runs some minutes, so the timer covers that quiet gap; past it, a message that never
 *  reaches its pick-up (a retire, a rebind, a nudge that never landed) stops costing reads. The stream's triggers still read: a
 *  pick-up typed later shows at that turn's end, since its typing and the turn's end each ask. */
export const PICK_UP_WAIT_MS = 10 * 60_000;
/** The timer's spacing once a message is a minute old: a pick-up within the first minute is the common case, so the timer reads
 *  at the coalescer's spacing then, and three times slower after: about 24 timer reads for a message that is never picked up. */
export const PICK_UP_READ_LATER_MS = 30_000;

/** The pick-up timer's spacing, or null when the timer reads nothing: only a message still waiting for its pick-up (not picked up,
 *  not settled, in a state this console can read) and younger than `PICK_UP_WAIT_MS` is awaited, and the youngest decides:
 *  every 10 s in its first minute, then every 30 s. Total over `now`: a message stamped later than `now` (clocks apart) is young. */
export function pickUpReadEvery(thread: ChatThread, now: number): number | null {
  let youngest: number | null = null;
  for (const e of thread.entries) {
    if (e.kind !== 'message' || e.ticks.unknown || e.ticks.lit['picked-up'] || e.ticks.lit.settled) continue;
    const age = now - e.row.at;
    if (age >= PICK_UP_WAIT_MS) continue;
    if (youngest === null || age < youngest) youngest = age;
  }
  if (youngest === null) return null;
  return youngest < 60_000 ? CHAT_READ_EVERY_MS : PICK_UP_READ_LATER_MS;
}

// ── what a transcript user turn is (question 6) ───────────────────────────────────────────────────────────────────────

export type TurnOrigin =
  | { readonly kind: 'nudge'; readonly id: number }
  | { readonly kind: 'ccrc'; readonly name: string }
  | { readonly kind: 'pane' };

/** What a user turn's text is: the nudge line of a recorded message (its id), a prompt ccrc typed (its row's name), or text
 *  typed in the pane. Total: a near miss of a nudge line is never a nudge, and never ccrc's either: a text that carries an
 *  operator message's marker but is not exactly its line is no line ccrc types, though it opens with the mail nudge's head. */
export function turnOrigin(text: string): TurnOrigin {
  const id = operatorMessageNudgeIdOf(text);
  if (id !== null) return { kind: 'nudge', id };
  if (carriesOperatorMessageMarker(text)) return { kind: 'pane' };
  const name = injectedPromptOf(text);
  return name === null ? { kind: 'pane' } : { kind: 'ccrc', name };
}

// ── the rows the chat draws ───────────────────────────────────────────────────────────────────────────────────────────

/** One row of the chat part. `entry` is the record's (a message, its server line, a divider); `live` is a transcript row that is
 *  not a user turn; the next three are what a user turn becomes; the last two are an earlier page's. No row but `entry` holding a
 *  `message` is ever drawn as the operator's words. */
export type ChatRow =
  | { readonly kind: 'entry'; readonly key: string; readonly entry: ChatEntry }
  | { readonly kind: 'live'; readonly key: string; readonly item: ChatItem }
  | { readonly kind: 'pane-turn'; readonly key: string; readonly text: string }
  | { readonly kind: 'ccrc-line'; readonly key: string; readonly name: string }
  | { readonly kind: 'message-link'; readonly key: string; readonly id: number }
  | { readonly kind: 'history-text'; readonly key: string; readonly text: string }
  | { readonly kind: 'untrusted-block'; readonly key: string; readonly text: string };

const entryKey = (e: ChatEntry): string =>
  e.kind === 'message' ? `msg-${e.row.id}` : e.kind === 'server-line' ? `line-${e.messageId}` : `gen-${e.gen.term}-${e.gen.n}`;

/** A record unit: a message with its server line, or a divider, with the time it sits at. */
interface Unit { readonly at: number; readonly id: number | null; readonly rows: ChatRow[] }

function unitsOf(thread: readonly ChatEntry[]): Unit[] {
  const units: Unit[] = [];
  for (const e of thread) {
    const row: ChatRow = { kind: 'entry', key: entryKey(e), entry: e };
    if (e.kind === 'server-line') {
      const owner = units.at(-1);
      if (owner !== undefined && owner.id === e.messageId) { owner.rows.push(row); continue; }
      units.push({ at: Number.NaN, id: null, rows: [row] });
      continue;
    }
    units.push({ at: e.kind === 'message' ? e.row.at : e.at, id: e.kind === 'message' ? e.row.id : null, rows: [row] });
  }
  return units;
}

/** A live item's time, or null for one that has none (a pending send, the working row). */
function liveAt(item: ChatItem): number | null {
  const ev: unknown = 'event' in item ? item.event : 'use' in item ? item.use : null;
  const ts = typeof ev === 'object' && ev !== null ? (ev as { readonly ts?: unknown }).ts : undefined;
  if (typeof ts !== 'string') return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

/** The user turns of a live item (a folded run of mail prompts holds several), or null when it is not one. */
function userTurnsOf(item: ChatItem): { readonly key: string; readonly text: string }[] | null {
  if (item.kind === 'mail-prompt') return [{ key: item.key, text: item.event.text }];
  if (item.kind === 'message' && item.event.kind === 'user') return [{ key: item.key, text: item.event.text }];
  if (item.kind === 'mail-prompts') {
    return item.members.flatMap((m) => (m.kind === 'mail-prompt' ? [{ key: m.key, text: m.event.text }] : []));
  }
  return null;
}

/** The record's thread placed in the live transcript (question 13), total:
 *  - a message whose nudge line is a live user turn is drawn at that turn's place, once;
 *  - every other record unit (a message not yet typed, a divider) sits after the newest live row whose time is at or before its
 *    own, or before every live row when none is, in the thread's order;
 *  - a message id is drawn once, whatever both sources say; a nudge naming an id the page does not hold is a link row;
 *  - every other user turn is a ccrc line or a pane turn, never the operator's words. */
export function mergeLive(thread: readonly ChatEntry[], live: readonly ChatItem[]): readonly ChatRow[] {
  const units = unitsOf(thread);
  const byId = new Map<number, Unit>();
  for (const u of units) if (u.id !== null) byId.set(u.id, u);
  const placed = new Set<Unit>();
  const seen = new Set<number>();
  const out: { at: number | null; rows: ChatRow[] }[] = [];
  for (const item of live) {
    const turns = userTurnsOf(item);
    if (turns === null) { out.push({ at: liveAt(item), rows: [{ kind: 'live', key: item.key, item }] }); continue; }
    const rows: ChatRow[] = [];
    for (const t of turns) {
      const o = turnOrigin(t.text);
      if (o.kind === 'ccrc') { rows.push({ kind: 'ccrc-line', key: `ccrc-${t.key}`, name: o.name }); continue; }
      if (o.kind === 'pane') { rows.push({ kind: 'pane-turn', key: `pane-${t.key}`, text: t.text }); continue; }
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      const unit = byId.get(o.id);
      if (unit === undefined) { rows.push({ kind: 'message-link', key: `link-${o.id}`, id: o.id }); continue; }
      placed.add(unit);
      rows.push(...unit.rows);
    }
    out.push({ at: liveAt(item), rows });
  }
  // Each unplaced unit, in the thread's order, after the newest live row at or before its time (before every live row when none).
  const before: ChatRow[] = [];
  const after = new Map<number, ChatRow[]>();
  for (const u of units) {
    if (placed.has(u) || (u.id !== null && seen.has(u.id))) continue;
    let slot = -1;
    out.forEach((o, i) => { if (o.at !== null && !Number.isNaN(u.at) && o.at <= u.at) slot = i; });
    if (slot === -1 && Number.isNaN(u.at)) slot = out.length - 1;
    if (slot === -1) before.push(...u.rows);
    else after.set(slot, [...(after.get(slot) ?? []), ...u.rows]);
  }
  return [...before, ...out.flatMap((o, i) => [...o.rows, ...(after.get(i) ?? [])])];
}

/** The earlier door's answer, or why there is none. */
export type ChatEarlierRead = ChatEarlierAnswer | 'off-shape' | 'no-answer';

/** What an earlier page answer becomes: its items, with what "Show earlier" asks for next (the first item's uuid, when the page
 *  holds fewer than its total and that item names one; else none), or why the page cannot be shown (the answer's cause, detail or
 *  word; the outcome of a page that is not rows). */
export function earlierPageOf(r: ChatEarlierRead):
  | { readonly kind: 'rows'; readonly items: readonly Readonly<Record<string, unknown>>[]; readonly next: string | null }
  | { readonly kind: 'unreachable'; readonly cause: string } {
  if (r === 'off-shape' || r === 'no-answer') return { kind: 'unreachable', cause: r };
  if (!r.ok) return { kind: 'unreachable', cause: r.cause ?? r.detail ?? r.error };
  if (r.page.outcome !== 'rows') return { kind: 'unreachable', cause: r.page.outcome };
  const items = r.page.items as readonly Readonly<Record<string, unknown>>[];
  const first = items[0]?.['uuid'];
  return { kind: 'rows', items, next: r.page.shown < r.page.total && typeof first === 'string' ? first : null };
}

/** An earlier page's items (the history door's `rows`, each untrusted) as chat rows. Each item is read by the fields Task 3's
 *  measurement pinned: `role` and `text` (and `uuid` for its key). An assistant item is its text; a user item goes through
 *  `turnOrigin` like a live one (a nudge becomes a link to its message); an item with no readable role or text is one untrusted
 *  block, never dropped and never the operator's words. */
export function historyItemsToChat(items: readonly Readonly<Record<string, unknown>>[]): readonly ChatRow[] {
  return items.map((it, i): ChatRow => {
    const key = `h-${typeof it['uuid'] === 'string' ? it['uuid'] : i}`;
    const text = it['text'];
    const role = it['role'];
    if (typeof text === 'string' && role === 'assistant') return { kind: 'history-text', key, text };
    if (typeof text === 'string' && role === 'user') {
      const o = turnOrigin(text);
      if (o.kind === 'nudge') return { kind: 'message-link', key, id: o.id };
      if (o.kind === 'ccrc') return { kind: 'ccrc-line', key, name: o.name };
      return { kind: 'pane-turn', key, text };
    }
    let block: string;
    try { block = typeof text === 'string' ? text : JSON.stringify(it); } catch { block = ''; }
    return { kind: 'untrusted-block', key, text: block };
  });
}

// ── the words ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The ticks lit, as words, in order: "recorded, queued, picked up". `delivery` says queued or delivered. */
export function tickWords(t: ChatTicks): string {
  const word = (s: TickStage): string => (s === 'delivery' ? t.delivery ?? tickStageWords(s) : tickStageWords(s));
  const lit = TICK_STAGES.filter((s) => t.lit[s]).map(word);
  return t.unknown ? `${lit.join(', ')} (state unknown to this console)` : lit.join(', ');
}

/** A divider's label: "generation n", or "term t, generation n" at the first of a new term, so a rebind is visible. */
export function dividerWords(d: Extract<ChatEntry, { kind: 'divider' }>): string {
  return d.newTerm ? `term ${d.gen.term}, generation ${d.gen.n}` : `generation ${d.gen.n}`;
}
/** What a divider offers for its generation's earlier text: a page to show, or where to read it. The live one offers nothing. */
export function earlierWords(d: Extract<ChatEntry, { kind: 'divider' }>): string | null {
  if (d.current) return null;
  return d.earlier === 'readable' ? `Show generation ${d.gen.n}` : `Read generation ${d.gen.n} in ccrc history`;
}

export const PANE_TURN_WORDS = "Typed in the Overlord's pane, not from the console";
/** A prompt ccrc typed, named: "ccrc: mail nudge". */
export const ccrcLineWords = (name: string): string => `ccrc: ${name.replace(/-/g, ' ')}`;
export const messageLinkWords = (id: number): string => `Operator message ${id}`;
export const OFF_RECORD_WORDS = 'off the record';
export const CUT_WORDS = 'cut to fit';
export const READ_CEILING_WORDS = 'Paused updating for a moment';
export const MESSAGES_UNMEASURED_WORDS = 'Messages could not be read';
export const GENERATIONS_UNMEASURED_WORDS = 'Earlier generations could not be read';
export const EARLIER_UNREACHABLE_WORDS = 'Earlier history is not reachable now';
export const READINESS_UNMEASURED_WORDS = "The Overlord's state could not be read";
export const NO_OVERLORD_WORDS = 'No Overlord is started. Messages already sent stay in the record.';
export const THREAD_NO_ANSWER_WORDS = 'No answer from the server; this is the conversation as last read.';
export const THREAD_OFF_SHAPE_WORDS = "This server's answer could not be read; this is the conversation as last read.";
export const READING_WORDS = 'Reading the conversation';
export const NOBODY_TO_SEND_WORDS = 'No Overlord is started, so there is nobody to send to.';
/** The thread holds the newest `CHAT_PAGE_ROWS` messages; this line says so when the door answers that older ones exist. */
export const OLDER_MESSAGES_WORDS = `Older messages are in the record; this shows the newest ${CHAT_PAGE_ROWS}.`;
/** The off-the-record toggle's description while a message is on its way (review 4084 F2): the toggle is held then, so the clear
 *  that follows never undoes a press made during the wait. */
export const TOGGLE_HELD_WORDS = 'Held while the message is sent.';

/** Why the thread could not be read this time. The last thread read is kept beside it, never replaced by an empty one. */
export type ThreadTrouble =
  | { readonly kind: 'ceiling' }
  | { readonly kind: 'refused'; readonly words: string }
  | { readonly kind: 'no-answer' }
  | { readonly kind: 'off-shape' };

/** The trouble's line. `read`: whether any thread was read before, so a first read that fails never says "as last read". */
export function threadTroubleWords(t: ThreadTrouble, read: boolean): string {
  if (t.kind === 'ceiling') return READ_CEILING_WORDS;
  if (t.kind === 'refused') return t.words;
  if (read) return t.kind === 'no-answer' ? THREAD_NO_ANSWER_WORDS : THREAD_OFF_SHAPE_WORDS;
  return t.kind === 'no-answer'
    ? 'No answer from the server; the conversation could not be read yet.'
    : "This server's answer could not be read; the conversation could not be read yet.";
}

/** The two refusal words the chat acts on beyond showing them: the designation moved (keep the draft, drop its key and term,
 *  read again at once), and the console's read ceiling (keep the thread, wait). Read by lookup, so no branch spells a word. */
const CHAT_REFUSAL_ROLE_MAP = { 'stale-designation': 'moved', 'read-ceiling': 'ceiling' } as const;
export type ChatRefusalRole = (typeof CHAT_REFUSAL_ROLE_MAP)[keyof typeof CHAT_REFUSAL_ROLE_MAP];
export function chatRefusalRole(error: string): ChatRefusalRole | null {
  return Object.hasOwn(CHAT_REFUSAL_ROLE_MAP, error) ? CHAT_REFUSAL_ROLE_MAP[error as keyof typeof CHAT_REFUSAL_ROLE_MAP] : null;
}

/** What the chat says after a send beside the refusal's own words (`apiErrorText`'s), or null for nothing more. A replay (the
 *  retry of a send whose answer was lost) answers the first record's fact, so when it went the other way than the toggle now
 *  says, the first record stands, and the notice says which (review F3). A fresh toggled send whose answer carries no `offRecord`
 *  echo was recorded on the record by a server that does not know the toggle (question 4). */
export function sendNotice(a: ChatSendAnswer, toggled: boolean): string | null {
  if (a.kind === 'recorded' && a.replay) {
    return a.offRecord === toggled ? null : `This message was already recorded ${a.offRecord ? 'off the record' : 'on the record'}; the first record stands.`;
  }
  if (a.kind === 'recorded') return toggled && !a.offRecord ? 'Recorded on the record: this server does not know the toggle' : null;
  if (a.kind === 'off-shape') return 'This server did not record the message; it may have been typed into the pane.';
  if (a.kind === 'no-answer') return 'No answer from the server. Your message is kept; send it again.';
  return chatRefusalRole(a.error) === 'moved' ? 'The Overlord changed. Your message was not sent; send it again.' : null;
}

// The Operator Model's vocabulary (context C11; Overlord W1 private store plan, Task 2). L0: it imports nothing, because the
// PWA bundles `shared/*.ts`. The operator's messages to the designated session: their states, the events that move them,
// the actor allowed each event, the message moves table, the settlement kinds, the read ledger's words, the text bound,
// the nudge's subject helpers and the wire row. Each runtime list is derived from its map, so a word is spelled once.
// Its one import is the injected-prompt list, for the nudge line's head (the chat's recogniser reads the line the mail lane
// types, so the line has one grammar, here).
import { INJECTED_PROMPTS } from './injected-prompts.mjs';

const MESSAGE_STATE_MAP = {
  recorded: 'the row committed; no nudge is queued yet',
  queued: "the nudge's delivery is queued behind the mail gate",
  delivered: 'the nudge was typed into the pane',
  'picked-up': 'the prompt hook reported the id',
  settled: 'a door cited it, acknowledge settled it, or the route marked it',
  spent: 'a root request cited it (W2)',
} as const;
export type MessageState = keyof typeof MESSAGE_STATE_MAP;
export const MESSAGE_STATES = Object.keys(MESSAGE_STATE_MAP) as MessageState[];
export const isMessageState = (v: unknown): v is MessageState =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(MESSAGE_STATE_MAP, v);

const MESSAGE_EVENT_MAP = {
  queue: "the nudge's delivery row was queued",
  deliver: 'the mail lane typed the nudge',
  'pick-up': "the prompt hook reported the nudge's id",
  settle: 'a citing door, acknowledge, or the settlement mark settled it',
  spend: 'a root request cited it (W2)',
  unsettle: 'the boot pass found a settlement no row proves (I8)',
} as const;
export type MessageEvent = keyof typeof MESSAGE_EVENT_MAP;
export const MESSAGE_EVENTS = Object.keys(MESSAGE_EVENT_MAP) as MessageEvent[];
export const isMessageEvent = (v: unknown): v is MessageEvent =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(MESSAGE_EVENT_MAP, v);

const MESSAGE_ACTOR_MAP = {
  route: 'the prompt route (queue; settle by the mark)',
  'mail-lane': 'the mail lane (deliver)',
  hook: "the hook's pick-up report door (pick-up)",
  acknowledge: 'the acknowledge door (settle)',
  'citing-door': 'a door that cites the message, after its own commit (settle, spend)',
  'boot-pass': 'the boot pass (unsettle; queue, for a nudge never queued; deliver, for a queued row whose nudge is acked (F3); spend, W2)',
} as const;
export type MessageActor = keyof typeof MESSAGE_ACTOR_MAP;
export const MESSAGE_ACTORS = Object.keys(MESSAGE_ACTOR_MAP) as MessageActor[];
export const isMessageActor = (v: unknown): v is MessageActor =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(MESSAGE_ACTOR_MAP, v);

/** Who may send each event. */
export const MESSAGE_EVENT_ACTORS: Readonly<Record<MessageEvent, readonly MessageActor[]>> = {
  queue: ['route', 'boot-pass'],
  deliver: ['mail-lane', 'boot-pass'],
  'pick-up': ['hook'],
  settle: ['route', 'acknowledge', 'citing-door'],
  spend: ['citing-door', 'boot-pass'],
  unsettle: ['boot-pass'],
};

const SETTLED_BY_MAP = { cite: 'a citing door', acknowledge: 'the acknowledge door', mark: "the route's settlement mark" } as const;
export type SettledBy = keyof typeof SETTLED_BY_MAP;
export const SETTLED_BY = Object.keys(SETTLED_BY_MAP) as SettledBy[];
export const isSettledBy = (v: unknown): v is SettledBy =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(SETTLED_BY_MAP, v);
/** What a `settle` records as its `settledBy`, by the actor that sent it. */
export const SETTLED_BY_ACTOR: Readonly<Record<'route' | 'acknowledge' | 'citing-door', SettledBy>> = {
  route: 'mark', acknowledge: 'acknowledge', 'citing-door': 'cite',
};

/** Where an accepted move takes a row: a state, or, for `unsettle`, the furthest delivery stage its stamps prove
 *  (`deliveryStageOf`, `server/src/operatorModel/messages.ts`). */
export type MessageMoveTarget = MessageState | 'delivery-stage';

/** state × event → next state, or absent where the move is refused. A delivery event on a row past its stage keeps its
 *  state and stamps the time only. `deliver` and `pick-up` may arrive out of order across processes, so each skips the
 *  stages it did not see. Total from W1: `spend` is W2's. Table 1 of the plan. */
export const MESSAGE_MOVES: Readonly<Record<MessageState, Readonly<Partial<Record<MessageEvent, MessageMoveTarget>>>>> = {
  recorded: { queue: 'queued', deliver: 'delivered', 'pick-up': 'picked-up', settle: 'settled', spend: 'spent' },
  queued: { deliver: 'delivered', 'pick-up': 'picked-up', settle: 'settled', spend: 'spent' },
  delivered: { 'pick-up': 'picked-up', settle: 'settled', spend: 'spent' },
  'picked-up': { deliver: 'picked-up', settle: 'settled', spend: 'spent' },
  settled: { queue: 'settled', deliver: 'settled', 'pick-up': 'settled', spend: 'spent', unsettle: 'delivery-stage' },
  spent: { queue: 'spent', deliver: 'spent', 'pick-up': 'spent' },
};

/** The stamp column each event writes when it is null. `unsettle` writes none: it clears the settlement pair. */
export const MESSAGE_EVENT_STAMP: Readonly<Record<MessageEvent, MessageStamp | null>> = {
  queue: 'queuedAt', deliver: 'deliveredAt', 'pick-up': 'pickedUpAt', settle: 'settledAt', spend: 'spentAt', unsettle: null,
};
const MESSAGE_STAMP_MAP = {
  queuedAt: 'the nudge was queued', deliveredAt: 'the nudge was typed', pickedUpAt: 'the hook reported the id',
  settledAt: 'it was settled', spentAt: 'a root request cited it',
} as const;
export type MessageStamp = keyof typeof MESSAGE_STAMP_MAP;
export const MESSAGE_STAMPS = Object.keys(MESSAGE_STAMP_MAP) as MessageStamp[];

/** The message text's bound, in UTF-8 bytes, the cut mark included (slug `message-text-cap`). */
export const MESSAGE_TEXT_MAX_BYTES = 16_384;

/** The nudge mail's sender and subject (slug `message-nudge-rides-the-mail-lane`): system mail from `operator`. */
export const OPERATOR_MESSAGE_SENDER = 'operator';
const SUBJECT_PREFIX = 'operator-message:';
export const operatorMessageSubject = (id: number): string => `${SUBJECT_PREFIX}${id}`;
/** The id a nudge's subject names, or null: a positive safe integer in canonical decimal, nothing else. */
export function operatorMessageIdOf(subject: string): number | null {
  if (!subject.startsWith(SUBJECT_PREFIX)) return null;
  const digits = subject.slice(SUBJECT_PREFIX.length);
  if (!/^[1-9][0-9]*$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}
export const isOperatorMessageMail = (m: { readonly fromId: string; readonly subject: string }): boolean =>
  m.fromId === OPERATOR_MESSAGE_SENDER && operatorMessageIdOf(m.subject) !== null;
const NUDGE_MARKER_HEAD = 'Operator message ';
const NUDGE_MARKER = new RegExp(`${NUDGE_MARKER_HEAD.trim().replace(' ', '\\s+')}\\s+[1-9][0-9]*\\s*:`);
/** The nudge mail's body: the id and the `messages` door, never the text (the private store plan, Task 6; the route's
 *  nudge and the boot pass's re-nudge say the same words). */
export const operatorMessageNudgeBody = (id: number): string => `${NUDGE_MARKER_HEAD}${id}: read it with your messages door.`;
/** The whole line the mail lane types for an operator message: the mail nudge's generic head, so `sendPrompt`'s 24-character
 *  echo needle and the injected-prompt census are unchanged, then the body above. `envelope.ts#renderOperatorMessageNudge`
 *  types exactly this, and `operatorMessageNudgeIdOf` reads it back (the Overlord W1 chat plan, question 6). */
export const operatorMessageNudgeLine = (id: number): string => `${INJECTED_PROMPTS['mail-nudge'].text} ${operatorMessageNudgeBody(id)}`;
const escapeRe = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUDGE_LINE = new RegExp(
  `^${escapeRe(`${INJECTED_PROMPTS['mail-nudge'].text} ${NUDGE_MARKER_HEAD}`)}([1-9][0-9]*)${escapeRe(': read it with your messages door.')}$`,
);
/** The id a transcript user turn names when it is exactly an operator message's nudge line, or null. One trailing newline is
 *  trimmed and nothing else (the injected-prompt reader's rule); a leading space, a trailing word, a zero, a sign, a decimal or
 *  an id past the largest safe integer is no nudge. */
export function operatorMessageNudgeIdOf(line: string): number | null {
  if (typeof line !== 'string') return null;
  const whole = line.endsWith('\n') ? line.slice(0, -1) : line;
  const m = NUDGE_LINE.exec(whole);
  if (m === null) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}
/** Whether a box's text carries an operator message's nudge marker (`Operator message <id>:`), wherever a narrow pane wrapped it. The
 *  generic mail nudge's resume asks it so it never presses Enter on that line: the line names one message, and the generic head it
 *  opens with is shared (review 2550 F2). */
export const carriesOperatorMessageMarker = (boxText: string): boolean => NUDGE_MARKER.test(boxText);
/** The key under which the prompt route marks the operator's newest message to the designated session in W1a's
 *  `operator_marks` (slug `overlord-mark-key`): `@` can begin no programme slug, so it names no programme. */
export const OVERLORD_OPERATOR_MARK = '@overlord';

/** The console's send key for one composed message (open question 17): 16 to 64 characters of `[A-Za-z0-9_-]`. */
export const SEND_KEY_MIN_CHARS = 16;
export const SEND_KEY_MAX_CHARS = 64;
const SEND_KEY_SHAPE = new RegExp(`^[A-Za-z0-9_-]{${SEND_KEY_MIN_CHARS},${SEND_KEY_MAX_CHARS}}$`);
export const isSendKey = (v: unknown): v is string => typeof v === 'string' && SEND_KEY_SHAPE.test(v);

const READ_DOOR_MAP = {
  board: "the Overlord's board read",
  messages: "the operator's messages read",
  inbox: "the Overlord's inbox read",
  history: "the Overlord's history read",
  sequence: "the sequence cursor's read",
  chat: "the operator's read of the Overlord's chat thread",
  'chat-history': "the operator's read of one page of an earlier generation",
} as const;   // W4 adds model, feed
export type ReadDoor = keyof typeof READ_DOOR_MAP;
export const READ_DOORS = Object.keys(READ_DOOR_MAP) as ReadDoor[];
export const isReadDoor = (v: unknown): v is ReadDoor =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(READ_DOOR_MAP, v);

const READ_CALLER_MAP = {
  overlord: 'the designated session',
  reader: 'one of its readers, through the door process',
  operator: "the operator's signed-in console",
} as const;
export type ReadCaller = keyof typeof READ_CALLER_MAP;
export const READ_CALLERS = Object.keys(READ_CALLER_MAP) as ReadCaller[];
export const isReadCaller = (v: unknown): v is ReadCaller =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(READ_CALLER_MAP, v);

/** How the line's `generation` was read: measured, unmeasured, or not a session's read (the console's). */
const GENERATION_READ_MAP = {
  measured: 'the caller generation was read',
  unmeasured: 'the caller generation could not be read',
  'not-a-session': "the operator's console has no generation",
} as const;
export type GenerationRead = keyof typeof GENERATION_READ_MAP;
export const GENERATION_READS = Object.keys(GENERATION_READ_MAP) as GenerationRead[];
export const isGenerationRead = (v: unknown): v is GenerationRead =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(GENERATION_READ_MAP, v);

/** The turn marker reader's words, mirrored: `TURN_MARK_STATES` and `TurnMarkUnread` (`server/src/coord/stall.ts`). A
 *  parity test holds the mirror equal in both directions (slug `null-turn-state-is-a-console-read`). */
export const READ_TURN_STATES = ['working', 'done', 'failed', 'absent', 'unmeasured', 'malformed', 'foreign', 'stale'] as const;
export type ReadTurnState = (typeof READ_TURN_STATES)[number];
export const isReadTurnState = (v: unknown): v is ReadTurnState =>
  typeof v === 'string' && (READ_TURN_STATES as readonly string[]).includes(v);

/** The read ledger's bounds: a scope is the door's canonical target, an outcome the door's own kebab word. */
export const READ_SCOPE_MAX_CHARS = 200;
export const READ_OUTCOME_MAX_CHARS = 40;

/** One read line, as a door states it. */
export interface ReadLine {
  readonly at: number;
  readonly door: ReadDoor;
  readonly caller: ReadCaller;
  readonly scope: string;
  readonly count: number;
  readonly outcome: string;
  readonly generation: number | null;
  readonly generationRead: GenerationRead;
  readonly turnState: ReadTurnState | null;
}

/** One message as the inbox, `messages` and the chat read it. */
export interface OperatorMessageRow {
  readonly id: number;
  readonly at: number;
  readonly term: number;
  readonly state: MessageState | 'unknown';
  readonly text: string;
  readonly cut: boolean;
  readonly sha256: string;
  readonly queuedAt: number | null;
  readonly deliveredAt: number | null;
  readonly pickedUpAt: number | null;
  readonly settledAt: number | null;
  readonly settledBy: SettledBy | 'unknown' | null;
  readonly spentAt: number | null;
  /** Sent under the chat's off-the-record toggle (§9.4 rule 9): still recorded and answered, but no feed learns from it. A row
   *  written before the column reads false. */
  readonly offRecord: boolean;
}

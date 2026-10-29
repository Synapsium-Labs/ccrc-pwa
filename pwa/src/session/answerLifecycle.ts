// The answer's lifecycle, one reducer for the ask sheets and the notification (D-7183; ARCH-29 #542, spec K5).
//
// PURE (L1): events in, commands out as data. No fetch, no store, no React. The sheets (`DialogSheet`, which renders
// `EnvelopeSheet`'s content) hold one instance (`createAnswerLifecycle`) and perform its commands through an injected
// seam (`performAnswer`, `AnswerSeam`); the notification's request is rendered from `answerRequest` (`ASK_REQUEST`).
//
// The doors (W7 C7g, D-7185, D-7485): an option row, the own words, a multiSelect set and the notification's ask are
// answers to an operator question, and go to W3 Q3f's `POST /api/questions/session-<id>/answer` with the family's body
// (`questionBodyOf`), through one writer, `lib/api.ts#answerQuestion`. Against a server without `questions-v1`
// (`lib/serverCaps.ts`) the same answer goes to the old door it replaces (`LEGACY_ANSWER_DOORS`, the skew row; C7p
// deletes it with the aliases). The tab move and Deny are not answers: they stay session doors (`/dialog/tab`, and the
// literal Escape through `/interrupt`).
//
// What it holds, and why each piece is ONE value:
//  - `phase`: the option answer, the tab move and Deny (`sending`), an option answer that landed and waits for the pane
//    to move on (`sent`), and a refusal (`failed`, which carries the door's refusal TOKEN, never a sentence: each surface
//    words the token from its own table, `askWords.ts` for the sheets, `refusalWords.ts#NOTIFICATION_REFUSAL_TEXT` for
//    the notification).
//  - `own`: the own-words text and its call (D-5090), keyed to the call and never to `dialog.id`, which the typing changes.
//  - `pick`: a multiSelect question's set and its commit (D-5091), for the same reason.
//  - `dismissal`: what the operator waved away (`key`), the pane dialog live when an envelope was hidden (`dialogId`,
//    D-5089) and the envelope's screen it was hidden on (`screen`).
//
// The guard (D-5089, D-5090, D-5091): one send at a time, and nothing dismissable while one is in flight. A send event
// while `locked` is refused (no command, the state unchanged), and so is a `dismiss`. The state is updated
// synchronously at dispatch (`createAnswerLifecycle`), so a second tap handled in the same tick as the first finds the
// lock taken: the guard the sheet once kept in a ref beside its render state is this state itself.
import { formatQuestionId, type Dialog, type DialogAnswered, type DialogTabTarget, type QuestionAnswerBody } from '../../../shared/api';
import type { Api } from '../lib/api';
import type { PickCall, WordsCall } from './AskParts';
import { freeTextSlot, questionKey, slotHolds } from './askLive';

// ─── state ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The sends the sheets make. `answer` is an option row (or Allow, option 1), `text` the own words, `multi` a
 *  multiSelect commit, `tab` a tab move, `deny` Deny's literal Escape. */
export type SheetSendKind = 'answer' | 'text' | 'multi' | 'tab' | 'deny';

/** A refusal token: the door's own code (`ApiError.message`), or `failed` for a write that did not go through. Never a
 *  sentence. */
export type RefusalToken = string;

export type AnswerPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending'; readonly send: 'answer'; readonly option: number }
  | { readonly kind: 'sending'; readonly send: 'tab' | 'deny' }
  | { readonly kind: 'sent'; readonly option: number }
  | { readonly kind: 'failed'; readonly send: SheetSendKind; readonly refusal: RefusalToken };

/** The own-words text and its call, one value so the two change together (D-5090). */
export interface OwnWords {
  readonly text: string;
  readonly call: WordsCall | null;
}

/** The boxes' set and its commit, one value (D-5091). `id` is the question (dialog id) `picked` belongs to: a set is
 *  never carried from one question to another. */
export interface PickState {
  readonly id: string | null;
  readonly picked: readonly number[] | null;
  readonly call: PickCall | null;
}

/** What the operator waved away. `key`: a pane dialog's id, or a hooked ask's key (a hash of the envelope's JSON);
 *  `dialogId`: the pane dialog live when the ENVELOPE was hidden (D-5089); `screen`: the envelope's screen it was
 *  hidden on, meaningful only while `key` is that ask. */
export interface Dismissal {
  readonly key: string | null;
  readonly dialogId: string | null;
  readonly screen: string | null;
}

export interface AnswerState {
  readonly phase: AnswerPhase;
  readonly own: OwnWords;
  readonly pick: PickState;
  readonly dismissal: Dismissal;
}

/** No own-words text, and no call. */
export const NO_WORDS: OwnWords = { text: '', call: null };
/** No box touched, and no commit. */
export const NO_PICK: PickState = { id: null, picked: null, call: null };
const NO_DISMISSAL: Dismissal = { key: null, dialogId: null, screen: null };
const IDLE: AnswerPhase = { kind: 'idle' };

export const INITIAL_ANSWER_STATE: AnswerState = { phase: IDLE, own: NO_WORDS, pick: NO_PICK, dismissal: NO_DISMISSAL };

/** Is an own-words call under way (running, or answered and waiting for the pane to move on)? */
export const wordsInFlight = (call: WordsCall | null): boolean => call !== null && call.state !== 'refused';
/** Is a multiSelect commit under way (running, or answered and waiting for the pane to move on)? */
export const picksInFlight = (call: PickCall | null): boolean => call !== null;

/** The option whose answer is in flight or landed and waiting (the sheets' `answering…` marker), else null. */
export function answeringOption(s: AnswerState): number | null {
  if (s.phase.kind === 'sent') return s.phase.option;
  if (s.phase.kind === 'sending' && s.phase.send === 'answer') return s.phase.option;
  return null;
}
export const isDenying = (s: AnswerState): boolean => s.phase.kind === 'sending' && s.phase.send === 'deny';
export const isTabbing = (s: AnswerState): boolean => s.phase.kind === 'sending' && s.phase.send === 'tab';

/** The sends holding the lock now. At most one can START at a time; the set is what each surface's partial locks read
 *  (a row's own send does not disable that row's own controls). */
export function inFlight(s: AnswerState): ReadonlySet<SheetSendKind> {
  const out = new Set<SheetSendKind>();
  if (answeringOption(s) !== null) out.add('answer');
  if (isTabbing(s)) out.add('tab');
  if (isDenying(s)) out.add('deny');
  if (wordsInFlight(s.own.call)) out.add('text');
  if (picksInFlight(s.pick.call)) out.add('multi');
  return out;
}

/** Anything in flight, apart from the sends named in `except`. With no `except` it is the lock: it refuses another send
 *  and the dismissal. */
export function busy(s: AnswerState, except: readonly SheetSendKind[] = []): boolean {
  for (const k of inFlight(s)) if (!except.includes(k)) return true;
  return false;
}

/** Does `dialog` show the question `call` was made for (`questionKey`)? */
const showsQuestion = (dialog: Dialog | null, call: WordsCall): dialog is Dialog =>
  dialog !== null && questionKey(dialog, call.row) === call.question;

/** Does `dialog` still show the question `call` typed into, its free-text row holding exactly `text`? That is the
 *  typed row of this very send (the stream may deliver it after the call answered), not other text, and not a new
 *  question. */
export const showsSent = (dialog: Dialog | null, call: WordsCall, text: string): boolean =>
  showsQuestion(dialog, call) && slotHolds(freeTextSlot(dialog, call.row - 1), text);

// ─── commands ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type AnswerCommand =
  | { readonly kind: 'answer'; readonly sessionId: string; readonly dialogId: string; readonly optionIndex: number }
  | { readonly kind: 'text'; readonly sessionId: string; readonly dialogId: string; readonly optionIndex: number; readonly text: string }
  | { readonly kind: 'multi'; readonly sessionId: string; readonly dialogId: string; readonly optionIndexes: readonly number[] }
  | { readonly kind: 'tab'; readonly sessionId: string; readonly dialogId: string; readonly to: DialogTabTarget; readonly from?: number }
  | { readonly kind: 'deny'; readonly sessionId: string }
  | { readonly kind: 'ask'; readonly sessionId: string; readonly askKey: string; readonly optionIndexes: readonly number[] };

/** The commands the sheets issue: every kind but the notification's `ask`. */
export type SheetCommand = Exclude<AnswerCommand, { kind: 'ask' }>;

// ─── events ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type AnswerEvent =
  // Sends. Each is refused while `busy`.
  | { readonly type: 'answer'; readonly sessionId: string; readonly dialogId: string; readonly option: number }
  | { readonly type: 'text'; readonly sessionId: string; readonly dialogId: string; readonly row: number; readonly question: string }
  | { readonly type: 'multi'; readonly sessionId: string; readonly dialogId: string; readonly wanted: readonly number[] }
  | { readonly type: 'tab'; readonly sessionId: string; readonly dialogId: string; readonly to: DialogTabTarget; readonly from?: number }
  | { readonly type: 'deny'; readonly sessionId: string }
  // Settles. `waiting`: the pane has not moved on yet, so the send stays busy (computed by the caller from the store).
  | { readonly type: 'answer-refused'; readonly refusal: RefusalToken }
  | { readonly type: 'answer-landed' }
  | { readonly type: 'text-landed'; readonly text: string; readonly call: WordsCall; readonly waiting: boolean }
  | { readonly type: 'text-refused'; readonly text: string; readonly call: WordsCall; readonly refusal: RefusalToken }
  | { readonly type: 'multi-landed'; readonly dialogId: string; readonly wanted: readonly number[]; readonly waiting: boolean }
  | { readonly type: 'multi-refused'; readonly dialogId: string; readonly wanted: readonly number[]; readonly refusal: RefusalToken }
  | { readonly type: 'tab-settled'; readonly refusal?: RefusalToken }
  | { readonly type: 'deny-settled'; readonly refusal?: RefusalToken }
  // The operator's own edits, which send nothing.
  | { readonly type: 'words'; readonly text: string }
  | { readonly type: 'toggle'; readonly dialogId: string; readonly index: number; readonly seed: readonly number[] }
  // A new screen (the pane dialog's id changed, or the held surface closed). `onScreen` is the dialog on screen, null
  // when the surface closed.
  | { readonly type: 'screen'; readonly onScreen: Dialog | null }
  // Dismissal. `dismiss` is the container's close (refused while busy); `leave` is the hide that opens the terminal
  // from a surface that cannot be answered here (never refused: it is the way out); `raise` clears the dismissal.
  | { readonly type: 'dismiss'; readonly hooked: boolean; readonly askKey: string | null; readonly screen: string | null; readonly dialogId: string | null }
  | { readonly type: 'leave'; readonly hooked: boolean; readonly askKey: string | null; readonly screen: string | null; readonly dialogId: string | null }
  | { readonly type: 'raise' };

export interface AnswerStep {
  readonly state: AnswerState;
  /** The request to perform, or null. */
  readonly command: SheetCommand | null;
  /** True when the event was refused by the guard (a send or a dismissal while busy, a toggle while busy). */
  readonly refused: boolean;
}

const refuse = (state: AnswerState): AnswerStep => ({ state, command: null, refused: true });
const to = (state: AnswerState, command: SheetCommand | null = null): AnswerStep => ({ state, command, refused: false });

const hidden = (s: AnswerState, e: { hooked: boolean; askKey: string | null; screen: string | null; dialogId: string | null }): AnswerState => {
  if (e.hooked) return { ...s, dismissal: { key: e.askKey, screen: e.screen, dialogId: e.dialogId } };
  if (e.dialogId !== null) return { ...s, dismissal: { ...s.dismissal, key: e.dialogId } };
  return s;
};

/** The reducer. Pure: the same state and event always give the same step. */
export function answerStep(s: AnswerState, e: AnswerEvent): AnswerStep {
  switch (e.type) {
    case 'answer':
      if (busy(s)) return refuse(s);
      return to({ ...s, phase: { kind: 'sending', send: 'answer', option: e.option } },
        { kind: 'answer', sessionId: e.sessionId, dialogId: e.dialogId, optionIndex: e.option });
    case 'text': {
      if (busy(s)) return refuse(s);
      const call: WordsCall = { row: e.row, question: e.question, state: 'flight' };
      return to({ ...s, own: { text: s.own.text, call } },
        { kind: 'text', sessionId: e.sessionId, dialogId: e.dialogId, optionIndex: e.row, text: s.own.text.trim() });
    }
    case 'multi': {
      if (busy(s)) return refuse(s);
      const call: PickCall = { dialogId: e.dialogId, wanted: e.wanted, state: 'flight' };
      return to({ ...s, pick: { ...s.pick, call } },
        { kind: 'multi', sessionId: e.sessionId, dialogId: e.dialogId, optionIndexes: e.wanted });
    }
    case 'tab':
      if (busy(s)) return refuse(s);
      return to({ ...s, phase: { kind: 'sending', send: 'tab' } },
        { kind: 'tab', sessionId: e.sessionId, dialogId: e.dialogId, to: e.to, ...(e.from === undefined ? {} : { from: e.from }) });
    case 'deny':
      if (busy(s)) return refuse(s);
      return to({ ...s, phase: { kind: 'sending', send: 'deny' } }, { kind: 'deny', sessionId: e.sessionId });

    case 'answer-landed':
      // A landed option answer stays busy until the pane moves on (`screen`); one the screen already ended is spent.
      return to(s.phase.kind === 'sending' && s.phase.send === 'answer' ? { ...s, phase: { kind: 'sent', option: s.phase.option } } : s);
    case 'answer-refused':
      // Ends an option answer's marker, whichever one holds it; any other send's phase is not this refusal's.
      return to(answeringOption(s) !== null || s.phase.kind === 'idle' || s.phase.kind === 'failed'
        ? { ...s, phase: { kind: 'failed', send: 'answer', refusal: e.refusal } } : s);
    case 'text-landed':
      return to({ ...s, own: e.waiting ? { text: e.text, call: { ...e.call, state: 'landed' } } : NO_WORDS });
    case 'text-refused':
      return to({
        ...s,
        own: { text: e.text, call: { ...e.call, state: 'refused' } },
        phase: s.phase.kind === 'sending' || s.phase.kind === 'sent' ? s.phase : { kind: 'failed', send: 'text', refusal: e.refusal },
      });
    case 'multi-landed':
      return to({ ...s, pick: e.waiting ? { id: e.dialogId, picked: e.wanted, call: { dialogId: e.dialogId, wanted: e.wanted, state: 'landed' } } : NO_PICK });
    case 'multi-refused':
      return to({
        ...s,
        pick: { id: e.dialogId, picked: e.wanted, call: null },
        phase: s.phase.kind === 'sending' || s.phase.kind === 'sent' ? s.phase : { kind: 'failed', send: 'multi', refusal: e.refusal },
      });
    case 'tab-settled':
      if (!isTabbing(s)) return to(s);
      return to({ ...s, phase: e.refusal === undefined ? IDLE : { kind: 'failed', send: 'tab', refusal: e.refusal } });
    case 'deny-settled':
      if (!isDenying(s)) return to(s);
      return to({ ...s, phase: e.refusal === undefined ? IDLE : { kind: 'failed', send: 'deny', refusal: e.refusal } });

    case 'words':
      return to({ ...s, own: { ...s.own, text: e.text } });
    case 'toggle': {
      if (busy(s)) return refuse(s);
      const base = s.pick.id === e.dialogId && s.pick.picked !== null ? s.pick.picked : e.seed;
      const picked = base.includes(e.index) ? base.filter((k) => k !== e.index) : [...base, e.index];
      return to({ ...s, pick: { ...s.pick, id: e.dialogId, picked } });
    }

    case 'screen': {
      // A new question (or a cleared one) ends an option answer's marker, in flight or landed (a tab move and Deny keep
      // theirs until they settle). D-5090: it ends an own-words answer that LANDED, unless the new frame is that send's
      // own typed row; a call still in FLIGHT is never touched (the typing changes the id mid-call). D-5091: it ends a
      // multiSelect commit that landed and forgets the set touched on the last question; a commit in FLIGHT keeps its
      // call, and its settle decides.
      const phase = s.phase.kind === 'sending' && s.phase.send !== 'answer' ? s.phase : IDLE;
      const o = s.own;
      const own = o.call?.state === 'landed' && !showsSent(e.onScreen, o.call, o.text) ? NO_WORDS : o;
      const pick = s.pick.call?.state === 'flight' ? s.pick : NO_PICK;
      return to({ ...s, phase, own, pick });
    }

    case 'dismiss':
      // Non-dismissable while an answer is in flight: the open sheet is the only honest record that the tap is landing.
      if (busy(s)) return refuse(s);
      return to(hidden(s, e));
    case 'leave':
      return to(hidden(s, e));
    case 'raise':
      return to({ ...s, dismissal: { ...s.dismissal, key: null, dialogId: null } });
  }
}

// ─── the holder ────────────────────────────────────────────────────────────────────────────────────────────────────

/** One lifecycle's state, updated synchronously at `dispatch`, with listeners for a view to re-render on. */
export interface AnswerLifecycle {
  get(): AnswerState;
  dispatch(e: AnswerEvent): AnswerStep;
  subscribe(listener: () => void): () => void;
}

export function createAnswerLifecycle(initial: AnswerState = INITIAL_ANSWER_STATE): AnswerLifecycle {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    dispatch: (e) => {
      const step = answerStep(state, e);
      if (step.state !== state) {
        state = step.state;
        for (const l of [...listeners]) l();
      }
      return step;
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

// ─── performing a sheet's command ──────────────────────────────────────────────────────────────────────────────────

/** The writers the sheets' commands go through: `lib/api.ts`'s `api` by default, injected for tests. One writer for
 *  every answer (`answerQuestion`, which chooses the door), and the two session doors that answer nothing. */
export type AnswerSeam = Pick<Api, 'answerQuestion' | 'answerDialogTab' | 'interrupt'>;

/** The commands that answer an operator question, and so take the family's door. */
export type QuestionCommand = Extract<AnswerCommand, { kind: 'answer' | 'text' | 'multi' | 'ask' }>;

/** The body a question command sends to `POST /api/questions/session-<id>/answer` (`shared/api.ts#QuestionAnswerBody`):
 *  an option row `{kind:'dialog', dialogId, optionIndex}`, the own words the same with `text`, a multiSelect set
 *  `{kind:'dialog', multi:true, dialogId, optionIndexes}`, and the notification's `{kind:'ask', askKey, optionIndexes}`. */
export function questionBodyOf(c: QuestionCommand): QuestionAnswerBody {
  switch (c.kind) {
    case 'answer':
      return { kind: 'dialog', dialogId: c.dialogId, optionIndex: c.optionIndex };
    case 'text':
      return { kind: 'dialog', dialogId: c.dialogId, optionIndex: c.optionIndex, text: c.text };
    case 'multi':
      return { kind: 'dialog', multi: true, dialogId: c.dialogId, optionIndexes: [...c.optionIndexes] };
    case 'ask':
      return { kind: 'ask', askKey: c.askKey, optionIndexes: [...c.optionIndexes] };
  }
}

/** Perform a sheet's command through `seam`: the one place a sheet's answer is written. An answer route's reply
 *  (`DialogAnswered`) is returned for the kinds that carry one; Deny's interrupt answers nothing. */
export function performAnswer(c: Exclude<SheetCommand, { kind: 'deny' }>, seam: AnswerSeam): Promise<DialogAnswered>;
export function performAnswer(c: Extract<SheetCommand, { kind: 'deny' }>, seam: AnswerSeam): Promise<void>;
export function performAnswer(c: SheetCommand, seam: AnswerSeam): Promise<DialogAnswered | void> {
  switch (c.kind) {
    case 'answer':
    case 'text':
    case 'multi':
      return seam.answerQuestion(c.sessionId, questionBodyOf(c));
    case 'tab':
      return seam.answerDialogTab(c.sessionId, { dialogId: c.dialogId, to: c.to, ...(c.from === undefined ? {} : { from: c.from }) });
    case 'deny':
      // Deny's literal Escape, Claude Code's own hint for declining a permission confirm.
      return seam.interrupt(c.sessionId, 'deny');
  }
}

// ─── the request each command's door takes ─────────────────────────────────────────────────────────────────────────

export interface AnswerRequest {
  readonly method: 'POST';
  readonly path: string;
  readonly headers: { readonly 'content-type': 'application/json' };
  /** The JSON body, as the bytes sent. */
  readonly body: string;
}

/** The operator answer doors W3 Q3f's family replaces, under `/api/sessions/<id>`, kept for ONE reason: a server
 *  without `questions-v1` (an older one, or a rollback) is answered through them (W7 C7g's skew row). Every server
 *  before C7p still answers them, as aliases into the family's core; C7p deletes this table with them. */
export const LEGACY_ANSWER_DOORS = { ask: '/ask', row: '/dialog', text: '/dialog/text', multi: '/dialog/multi' } as const;

/** The family's operator door: `POST /api/questions/<question id>/answer`, the id `shared/api.ts#formatQuestionId`'s
 *  `session-<id>`. */
const QUESTIONS_PATH_PREFIX = '/api/questions/';
const QUESTIONS_ANSWER_SUFFIX = '/answer';
const questionsAnswerPath = (sessionId: string): string =>
  `${QUESTIONS_PATH_PREFIX}${encodeURIComponent(formatQuestionId({ kind: 'session', sessionId }))}${QUESTIONS_ANSWER_SUFFIX}`;

/** The `ask` command's declared shape (the notification's answer), read by `answerRequest` and by the renderer of
 *  `push-sw.js`'s generated region, so the two never drift: the family's door and body (`questionsPathPrefix`,
 *  `questionIdPrefix`, `questionsPathSuffix`, `kindField`/`kindValue`) on a `questions-v1` server, the old door
 *  (`pathPrefix`, `pathSuffix`) otherwise. The action is the notification's `ask:<key>:<index>`: the key minted
 *  server-side and carried verbatim, the index a number, never derived from a label. */
export const ASK_REQUEST = {
  method: 'POST',
  pathPrefix: '/api/sessions/',
  pathSuffix: LEGACY_ANSWER_DOORS.ask,
  questionsPathPrefix: QUESTIONS_PATH_PREFIX,
  questionIdPrefix: 'session-',
  questionsPathSuffix: QUESTIONS_ANSWER_SUFFIX,
  contentType: 'application/json',
  kindField: 'kind',
  kindValue: 'ask',
  keyField: 'askKey',
  indexesField: 'optionIndexes',
  actionPattern: '^ask:([^:]+):(\\d+)$',
} as const;

/** The notification action `ask:<key>:<index>` for session `sessionId`, as the `ask` command, or null when the action
 *  is not one (or there is no session): then nothing is sent and the app opens. */
export function askCommandOf(action: string, sessionId: string | null): Extract<AnswerCommand, { kind: 'ask' }> | null {
  const m = new RegExp(ASK_REQUEST.actionPattern).exec(action);
  if (m === null || sessionId === null) return null;
  return { kind: 'ask', sessionId, askKey: m[1]!, optionIndexes: [Number(m[2])] };
}

const sessionPath = (id: string, suffix: string): string => `/api/sessions/${encodeURIComponent(id)}${suffix}`;
const json = (path: string, body: unknown): AnswerRequest =>
  ({ method: 'POST', path, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** The door and the JSON value an answer to session `sessionId`'s question takes: the family's door with `body` when
 *  `questions` (the server advertises `questions-v1`), else the old door `body` names, with that door's own body (the
 *  family's minus `kind` and `multi`), byte for byte what it took before C7g. `lib/api.ts#answerQuestion` posts it. */
export function questionAnswerRequest(sessionId: string, body: QuestionAnswerBody, questions: boolean): { path: string; payload: unknown } {
  if (questions) return { path: questionsAnswerPath(sessionId), payload: body };
  if (body.kind === 'ask') {
    return { path: sessionPath(sessionId, LEGACY_ANSWER_DOORS.ask), payload: { [ASK_REQUEST.keyField]: body.askKey, [ASK_REQUEST.indexesField]: body.optionIndexes } };
  }
  if ('multi' in body) return { path: sessionPath(sessionId, LEGACY_ANSWER_DOORS.multi), payload: { dialogId: body.dialogId, optionIndexes: body.optionIndexes } };
  if (body.text !== undefined) {
    return { path: sessionPath(sessionId, LEGACY_ANSWER_DOORS.text), payload: { dialogId: body.dialogId, optionIndex: body.optionIndex, text: body.text } };
  }
  return { path: sessionPath(sessionId, LEGACY_ANSWER_DOORS.row), payload: { dialogId: body.dialogId, optionIndex: body.optionIndex } };
}

/** The request a command's door takes on a server that does (`questions`) or does not advertise `questions-v1`: the
 *  method, the path and the JSON body, byte for byte what that kind's writer sends (`lib/api.ts#answerQuestion` for
 *  the sheets' answers, `answerDialogTab` and `interrupt` for the two session doors, `push-sw.js` for `ask`). */
export function answerRequest(c: AnswerCommand, questions: boolean): AnswerRequest {
  switch (c.kind) {
    case 'answer':
    case 'text':
    case 'multi':
    case 'ask': {
      const r = questionAnswerRequest(c.sessionId, questionBodyOf(c), questions);
      return json(r.path, r.payload);
    }
    case 'tab':
      return json(sessionPath(c.sessionId, '/dialog/tab'), { dialogId: c.dialogId, to: c.to, ...(c.from === undefined ? {} : { from: c.from }) });
    case 'deny':
      return json(sessionPath(c.sessionId, '/interrupt'), { source: 'deny' });
  }
}

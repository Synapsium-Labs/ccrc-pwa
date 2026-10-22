import { createHash } from 'node:crypto';
import type { DialogAsk, DialogMulti, HookAsk, HookAskQuestion } from '../../shared/api.js';
import type { HookState, HookStateRawRead } from './hookstate.js';
import { pairMatches } from './transcript/ask.js';
import type { PushPayload } from './push.js';

/**
 * Stable digest of a questions envelope's CONTENT — the first question's text
 * and its option labels, in order.
 *
 * This is the server-side twin of the correspondence gate `DialogSheet` got in
 * Build 1's fix wave: a client answers the question it was SHOWN, or it does
 * not answer. Content, not coordinates, so a re-render cannot forge it and a
 * reordered menu cannot silently redirect an answer to a different option.
 *
 * Approval envelopes deliberately have no key: they are answered through the
 * pane dialog path, where the rendered rows are the truth.
 */
export function askKey(ask: HookAsk | null): string | null {
  if (ask === null || !('questions' in ask)) return null;
  const q = ask.questions[0];
  if (q === undefined) return null;
  const material = JSON.stringify([q.question, q.options.map((o) => o.label)]);
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/** What a stream's last pane reading shows of the menu on screen: the transcript-aligned question (`Dialog.ask`), for
 *  an unparsed multiSelect menu its labels (`Dialog.multi`), for a review screen the question texts it lists
 *  (`reviewQuestions`; absent when the menu is not a review screen), and the raw pane of an UNPARSED capture (null for a
 *  parsed menu or none). `sessionws.ts`'s `DialogSeen` satisfies it. */
export interface MenuEvidence {
  ask: DialogAsk | null;
  multi?: DialogMulti;
  review?: readonly string[];
  raw: string | null;
}

/** The questions of an aged envelope the stream may keep: the session's own (`current`), `waiting`, a questions
 *  envelope. Null for every other raw read. The eligibility half of `keepAgedAsk`. */
function agedQuestions(raw: HookStateRawRead): HookAskQuestion[] | null {
  if (!raw.ok || raw.identity !== 'current' || raw.state.state !== 'waiting') return null;
  const ask = raw.state.ask;
  return ask !== null && 'questions' in ask ? ask.questions : null;
}

/** THE question-text match of both correspondence arms: `pairMatches`, the tree's one normalised-prefix rule. A review
 *  lists only the first line of a wrapped question, a prefix of the envelope's text. */
const sameQuestion = (a: string, b: string): boolean => pairMatches(a, b);

/** The correspondence half: is the pane's parsed or multi menu question `q`? */
function showsQuestion(menu: MenuEvidence, q: HookAskQuestion): boolean {
  if (menu.ask !== null) {
    const shown = menu.ask;
    return sameQuestion(shown.question, q.question) && shown.options.length === q.options.length
      && shown.options.every((o, i) => o === null || o.label === q.options[i]!.label);
  }
  const multi = menu.multi;
  return multi !== undefined && multi.options.length === q.options.length
    && multi.options.every((o, i) => pairMatches(o.label, q.options[i]!.label));
}

/**
 * D-6324: keep an AGED hook envelope on the per-session stream while the pane's menu is that envelope's call.
 *
 * `foldHookStateRead` drops an envelope older than `HOOKSTATE_FRESH_MS`, which cleared the sheet's structured copy at
 * 30 minutes under a question still on screen. True only when the raw read is the current session's, `waiting`, a
 * questions envelope, and the pane shows it, by one of three arms:
 * - a parsed menu: SOME question of the envelope (every question, not only the first that `askKey` hashes: the pane
 *   may be on the second) has the same text and the same option labels;
 * - an unparsed multi menu: its labels match one question's through `pairMatches`;
 * - the review screen the ask ends on, which lists the questions it asked: at least one is listed, and EVERY listed
 *   question is one of the envelope's. "Every listed", not "all listed", because a tall review can lose rows from the
 *   capture. It covers a one-question multiSelect ask, which Claude Code also ends on a review, and it drops an
 *   envelope on the review of another call.
 *
 * Question texts are compared by ONE matcher for the parsed and review arms (`sameQuestion`). The parsed arm trusts
 * `alignAsk`'s forgiveness: it receives only alignments `alignAsk` produced, where a `null` entry is a row it forgave
 * under its own bound (one miss, from four options up), and keeps no second bound of its own.
 *
 * Legitimately different from the 30-minute cut that holds for every reader that DISPLAYS or ANSWERS the envelope (the
 * fleet card, the push body, the coordinator hold, `answerAsk`'s read): only the per-session stream holds a live menu
 * measurement and its transcript alignment in the same tick. The one existing unaged reader is the stall watch's
 * `stallHookAskOf` (`watch.ts`), whose answer is a run verdict and never a surface. Raising `HOOKSTATE_FRESH_MS`
 * instead would widen all of them, the key-based answer gate included.
 */
export function keepAgedAsk(raw: HookStateRawRead, menu: MenuEvidence): boolean {
  const questions = agedQuestions(raw);
  if (questions === null) return false;
  if (menu.review !== undefined) {
    return menu.review.length > 0 && menu.review.every((t) => questions.some((q) => sameQuestion(t, q.question)));
  }
  return questions.some((q) => showsQuestion(menu, q));
}

/** The stream's keep decision and how many consecutive mid-redraw captures it has seen (`nextAgedKeep`). */
export interface AgedKeep { kept: boolean; redraws: number }
export const NO_AGED_KEEP: AgedKeep = { kept: false, redraws: 0 };

/**
 * D-6324: the stream's next keep decision. An unparsed capture that carries no `multi` is a menu grabbed mid-redraw
 * (`parseDialog` gives it a new pane-hash id and no alignment), so the FIRST such capture keeps the previous decision
 * while the envelope is still eligible, and the envelope does not flap `ask_cleared` / `ask`. A second consecutive one,
 * a parsed menu that does not correspond, and no menu decide as `keepAgedAsk` does. A tick with no `reading` (its
 * capture failed, so `seenDialog` is the previous capture's) leaves the count alone: a redraw then a failed capture is
 * not two redraws. The envelope's eligibility is re-checked either way.
 */
export function nextAgedKeep(prev: AgedKeep, raw: HookStateRawRead, menu: MenuEvidence, reading: boolean): AgedKeep {
  if (!reading) return { kept: prev.kept && agedQuestions(raw) !== null, redraws: prev.redraws };
  const redraws = menu.raw !== null && menu.multi === undefined ? prev.redraws + 1 : 0;
  const kept = redraws === 1 ? prev.kept && agedQuestions(raw) !== null : keepAgedAsk(raw, menu);
  return { kept, redraws };
}

/**
 * D-5293: the ONE eligibility rule for answering a hook-reported ask by option
 * index — what `answerAsk` (`inject/ask.ts`) will press, and therefore what
 * the parent's hold (`askActions` is its sole gate, D-2173) may hold and what
 * a notification may offer. `answerAsk` refuses every envelope this refuses
 * before it reads the pane; `askActions` is null for every one of them. Each
 * `false` is a refusal named in `askActions`' docstring below: no question
 * envelope, more than one question, a multiSelect question, no options, a
 * blank option label anywhere in the envelope. Envelope only: whether the hook
 * is `waiting`, and whether the key and the pane still match, are the callers'.
 * D-5367: the ask-sheet work (#491, #493) widened only the `/dialog/*` pane
 * routes, not `answerAsk`, so this admits exactly what `askActions` admitted
 * before it: the lane gains no envelope until `answerAsk` itself widens.
 */
export function answerableAsk(ask: HookAsk | null): boolean {
  if (ask === null || !('questions' in ask)) return false;
  if (ask.questions.length !== 1) return false;
  const q = ask.questions[0]!;
  if (q.multiSelect === true) return false;
  if (q.options.length === 0) return false;
  // The whole envelope, not just the two labels a push would ship: an
  // unreadable label at index 5 refuses index 0 exactly as hard.
  return !q.options.some((o) => o.label.trim() === '');
}

/** At most TWO notification actions. That is the platform ceiling on Android,
 *  and it is why the payload sends the first two labels and leaves everything
 *  else to the notification body, which deep-links as it always has. */
export const MAX_ASK_ACTIONS = 2;

/**
 * Notification actions for a hook-reported ask, or `null` when this ask must
 * not be answerable from a notification.
 *
 * The rule is one sentence: **offer an action only where `answerAsk` would
 * accept it.** An action the route will always refuse is worse than no action —
 * it costs the operator a tap, a wait and a refusal sentence to learn what the
 * server already knew when it composed the push.
 *
 * So each `null` below mirrors a specific refusal in `inject/ask.ts`:
 *  - no fresh envelope, or not `waiting` → `stale-ask` / `not-waiting`.
 *  - an APPROVAL envelope → it has no key at all (`askKey` returns null) and is
 *    answered on the pane dialog path, where the rendered rows are the truth.
 *  - MORE THAN ONE question → `multi-question`. `session-hook.sh` writes the
 *    whole array once and the state stays frozen at `waiting` until the tool
 *    call returns, while the pane advances Q1→Q2, so nothing in the envelope
 *    can say which question is currently painted.
 *  - no options (a free-text ask) → there is no index to send.
 *  - a MULTI-SELECT question → `multiselect` (D-5048). The route used to
 *    accept a one-index tap and send its digit then Enter, which narrowed a
 *    question that takes several answers down to one; on Claude Code 2.1.280
 *    and later that Enter toggled the cursor row instead of committing. It now
 *    refuses every multiSelect question before any key. Multi-select is
 *    answered in the app, where the boxes are visible, through
 *    `POST /api/sessions/:id/dialog/multi`.
 *  - a BLANK option label ANYWHERE in the envelope → see below.
 *
 * A blank label poisons the WHOLE envelope, so the answer is `null`, not "ship
 * the readable siblings". `answerAsk`'s menu-identity gate matches EVERY option
 * against the pane's rows through `pairMatches`, which refuses whenever either
 * side normalises to '' — and a whitespace-only label always does. So one blank
 * label at any index means every index is refused with `menu-mismatch`, for the
 * life of the question, whichever way tmux renders the row (keep the spaces and
 * `leftCol` trims the scraped label to ''; strip them, as tmux does by default,
 * and the row fails `OPTION_RE` so no rows are scraped at all). Shipping the
 * siblings would hand the operator exactly what the rule above forbids: a
 * button that costs a tap, a wait and a refusal sentence — and a false one at
 * that ("The terminal is showing something else now" about the very menu on
 * screen). The blankness is provable here, from the envelope alone.
 *
 * Indices travel inside the action id, never as a position, so the `slice`
 * below cannot shift an action onto the wrong option.
 */
export function askActions(hs: HookState | null): PushPayload['actions'] | null {
  if (hs === null || hs.state !== 'waiting') return null;
  const ask = hs.ask;
  // D-5293: the envelope half of the rule is `answerableAsk`, the one the
  // operator's route refuses on too, never a second copy of its tests.
  if (!answerableAsk(ask)) return null;
  const q = (ask as { questions: HookAskQuestion[] }).questions[0];
  const key = askKey(ask);
  if (q === undefined || key === null) return null;
  return q.options
    .slice(0, MAX_ASK_ACTIONS)
    .map((o, i) => ({ action: `ask:${key}:${i}`, title: o.label }));
}

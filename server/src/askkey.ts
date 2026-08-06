import { createHash } from 'node:crypto';
import type { HookAsk } from '../../shared/api.js';
import type { HookState } from './hookstate.js';
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
 *  - a MULTI-SELECT question → the route would accept a one-index tap and
 *    commit it with Enter (`inject/ask.ts`'s "gated on the QUESTION's kind"
 *    branch), which narrows a question that takes several answers down to one
 *    and submits it irrevocably. That is not a refusal this function is
 *    dodging — it is an ANSWER the operator never chose to send, and a
 *    notification button has no room to say "this submits and ends the
 *    question". Multi-select is answered in the app, where the boxes are
 *    visible.
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
  if (ask === null || !('questions' in ask)) return null;
  if (ask.questions.length !== 1) return null;
  const q = ask.questions[0];
  const key = askKey(ask);
  if (q === undefined || key === null) return null;
  if (q.multiSelect === true) return null;
  if (q.options.length === 0) return null;
  // The whole envelope, not just the two labels that would ship: an unreadable
  // label at index 5 refuses index 0 exactly as hard.
  if (q.options.some((o) => o.label.trim() === '')) return null;
  return q.options
    .slice(0, MAX_ASK_ACTIONS)
    .map((o, i) => ({ action: `ask:${key}:${i}`, title: o.label }));
}

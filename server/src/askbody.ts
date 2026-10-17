/**
 * D-5302 (spec `docs/superpowers/specs/2026-10-17-coordinator-first-routing-design.md` §9): the ONE home of an ask
 * push's body, and of the bodies the coordinator lane replaces it with.
 *
 * Both raise sites in `watch.ts` (the immediate `raise` and the held `hold`) used to push
 * `dialog.title || <fallback>`, and the pane scrape's title is only the nearest non-blank line above the options: on
 * a box-drawn dialog that line is the box's own edge. 14 of 36 measured ask bodies were a lone `│`. The hook envelope
 * is the better source on every count — it is what Claude Code asked, not what the pane happened to paint — so it
 * is read first, and the scraped title is kept only when it carries a letter or digit once its border glyphs are
 * stripped.
 *
 * Order:
 * 1. A question envelope: the FIRST question's text (its header only when the text is blank). Not the header first,
 *    as the fleet card's one-line glance does (`hookAskSummary`): a push body is the operator's whole view of the
 *    ask, and the header is a two-word label for it.
 * 2. An approval envelope: `tool: summary`, through `hookAskSummary` (`fleet.ts`), the one reader of that envelope,
 *    so the redaction spec §6.7 puts there (`redactCommand`, Task 12) reaches the push without a second call site.
 * 3. The dialog title, with box-drawing (U+2500..U+257F) and block (U+2580..U+259F) characters trimmed off its ends,
 *    only when what remains has a letter or digit.
 * 4. `ASK_PUSH_FALLBACK_BODY`.
 *
 * An envelope is read only while the hook reports `waiting`, the same gate `hookAskSummary` and `askActions` apply:
 * a `working` or `done` hookstate's `ask` is the PREVIOUS question's, and naming it on this push would be wrong.
 */
import { hookAskSummary } from './fleet.js';
import type { HookState } from './hookstate.js';

/** The body of an ask push when neither the envelope nor the scraped title says anything. Spelled here only
 *  (`single-definition.test.ts`). */
export const ASK_PUSH_FALLBACK_BODY = 'Claude has a question';

/** Whitespace, box-drawing and block elements (the two Unicode ranges a TUI border is drawn from) at either end. */
const BORDER_EDGES = /^[\s\u2500-\u259f]+|[\s\u2500-\u259f]+$/gu;
const HAS_WORD = /[\p{L}\p{N}]/u;

/** An ask push's body: the envelope first, then a title that says something, then the fallback. */
export function askPushBody(hs: HookState | null, dialog: { title: string }): string {
  return envelopeBody(hs) ?? titleBody(dialog.title) ?? ASK_PUSH_FALLBACK_BODY;
}

function envelopeBody(hs: HookState | null): string | null {
  if (hs === null || hs.state !== 'waiting' || hs.ask === null) return null;
  if ('questions' in hs.ask) {
    const q = hs.ask.questions[0];
    return q ? (q.question.trim() || q.header?.trim() || null) : null;
  }
  return hookAskSummary(hs);
}

function titleBody(title: string): string | null {
  const t = title.replace(BORDER_EDGES, '');
  return HAS_WORD.test(t) ? t : null;
}

/** The body that replaces a child's ask push while its coordinator holds the question (Tasks 5 and 7). */
export const withCoordinatorBody = (parent: string): string => `With coordinator ${parent}`;

/** The body that replaces a child's ask push once its coordinator has answered it (Task 4's late answer). */
export const answeredByBody = (parent: string): string => `Answered by ${parent}`;

/** The body that replaces a child's approval push once its coordinator has ruled (Task 16). */
export const approvalRuledBody = (parent: string, verdict: 'allow' | 'deny'): string =>
  `${verdict === 'allow' ? 'Allowed' : 'Denied'} by ${parent}`;

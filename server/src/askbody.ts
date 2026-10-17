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
 *    Cut to `ASK_SUMMARY_MAX_LEN` (D-5356): the old body was one pane line, bounded by the pane's width, and an
 *    uncut question is pushed, kept in the NotifyLog ring and archived in `feed_events` whole — and a payload over a
 *    push service's ~4 KB limit is refused and `PushService.notify` swallows it.
 * 2. An approval envelope: the TOOL NAME and a fixed phrase, `Bash — permission requested`, NEVER the command
 *    (D-5356). Every push body is also stored, in the NotifyLog ring and coord.db's durable `feed_events`, and a
 *    child's command can carry a token; until Task 12's `redactCommand` is applied where the approval summary
 *    enters the wire (Task 16), no part of `summary` is read here. (Before Task 3 a permission prompt's body was its
 *    scraped top line, `Bash command`, which named no command either.)
 *    An approval envelope with no tool name gives the fallback, never the title.
 * 3. The dialog title, with box-drawing (U+2500..U+257F) and block (U+2580..U+259F) characters trimmed off its ends,
 *    only when what remains has a letter or digit.
 * 4. `ASK_PUSH_FALLBACK_BODY`.
 *
 * An envelope is read only while the hook reports `waiting`, the same gate `hookAskSummary` and `askActions` apply:
 * a `working` or `done` hookstate's `ask` is the PREVIOUS question's, and naming it on this push would be wrong.
 */
import { ASK_SUMMARY_MAX_LEN } from './fleet.js';
import type { HookState } from './hookstate.js';

/** The body of an ask push when neither the envelope nor the scraped title says anything. Spelled here only
 *  (`single-definition.test.ts`). */
export const ASK_PUSH_FALLBACK_BODY = 'Claude has a question';

/** D-5356: what an approval's push body says after the tool name. Fixed text: the command is never read. */
export const APPROVAL_PUSH_PHRASE = 'permission requested';

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
    const text = q ? (q.question.trim() || q.header?.trim() || null) : null;
    return text === null ? null : text.slice(0, ASK_SUMMARY_MAX_LEN);   // D-5356
  }
  // D-5356: the tool name only — `summary` (the command) is not read until the redactor lands (Task 16). An approval
  // envelope decides the body even with no tool name: it never falls through to a scraped title, which on a
  // permission dialog can be a line of the command.
  const tool = hs.ask.approval.tool.trim().slice(0, ASK_SUMMARY_MAX_LEN);
  return tool === '' ? ASK_PUSH_FALLBACK_BODY : `${tool} — ${APPROVAL_PUSH_PHRASE}`;
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

// The envelope-to-dialog pairing, computed on the server (D-7031; ARCH-58 (#793), server half; plan
// docs/superpowers/plans/2026-10-26-consolidation-w3-questions.md, Task Q3g): which of the hook envelope's questions the
// pane is painting, the one its title names when labels cannot say, and which screen of the ask the pane is on. Facts
// of position only, never text to render (D-6325).
//
// A PORT of `pwa/src/session/askLive.ts`'s position facts (`questionCorresponds`, `liveQuestion`, `namedQuestion`,
// `shownQuestion`, `askScreen`, `titleMatches`, `WRAP_BAR_RE`), held equal to it over Q3a's corpus
// (`server/test/ask-pairing.test.ts`, against the table `ask-pairing-table.test.ts` records). The client keeps its copy
// until W7, which reads this module's answer off the wire (`pairing` on the `ask` and `dialog` frames) and deletes it.
// Until then a change to one is a change to both, and the parity row reds on a drift.
//
// L1, PURE: it imports `shared/api`'s types and `shared/ask-menu`'s rules, and nothing else; no fs, no store, no clock.
// `Dialog.multi`, `parsed` and the review screen are read through `shared/ask-menu.ts`'s rules (`reviewRows`), never
// spelled again.
//
// The option match is the server's one normalize-and-prefix rule, `pairMatches`, imported, never spelled again.
import type { Dialog, HookAskQuestion } from '../../../shared/api.js';
import { reviewRows } from '../../../shared/ask-menu.js';
import { pairMatches } from '../transcript/ask.js';

/** The pairing of one question envelope with one pane reading: `shownQuestion`'s four facts, `askScreen`, and
 *  `questionCorresponds` per question. */
export interface AskPairing {
  readonly live: number | null;
  readonly named: number | null;
  readonly shown: number;
  readonly placed: number | null;
  readonly screen: string | null;
  readonly corresponds: readonly boolean[];
}

/** The questions of an AskUserQuestion envelope (`HookAsk`'s question arm). */
export interface AskPairingQuestions {
  readonly questions: readonly HookAskQuestion[];
}

/** Trim, lowercase and collapse whitespace runs: what the title match compares. */
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Does the envelope question `q` describe the same live menu `dialog` is showing, every option lined up with the
 *  pane's option at its position? An answer types the pane by index, so no row is forgiven here (unlike `alignAsk`).
 *  An unparsed `dialog` never corresponds (I1), except through `Dialog.multi` (D-5091): a `multiSelect` question
 *  corresponds only to a pane carrying `multi`, with EQUAL counts, and any other question only to a parsed menu with at
 *  least its options' rows. */
export function questionCorresponds(q: HookAskQuestion, dialog: Dialog | null): boolean {
  if (dialog === null) return false;
  if (q.multiSelect === true || dialog.multi !== undefined) {
    const boxes = dialog.multi?.options;
    if (q.multiSelect !== true || boxes === undefined || boxes.length !== q.options.length) return false;
    return q.options.every((o, i) => pairMatches(boxes[i]!.label, o.label));
  }
  if (!dialog.parsed) return false;
  if (dialog.options.length < q.options.length) return false;
  return q.options.every((o, i) => pairMatches(dialog.options[i]!.label, o.label));
}

/** A wrapped question's rows are painted under a `│ ` bar, and the pane's title is the last of them, bar included. */
export const WRAP_BAR_RE = /^\s*│\s*/;

/** Does the pane's `title` name `question`? The title, a leading `│ ` stripped, is a SUFFIX of the question once both
 *  are normalized: a question that fits one row is its whole text, a wrapped one is its last row. Markdown is literal on
 *  screen, so nothing is unescaped. An empty title names nothing. */
export function titleMatches(question: string, title: string): boolean {
  const t = norm(title.replace(WRAP_BAR_RE, ''));
  return t !== '' && norm(question).endsWith(t);
}

/** Which of the envelope's questions the pane is painting, as an index, or null when that cannot be told. Labels decide
 *  first: exactly one candidate (`questionCorresponds`, over the questions that list options) wins whatever the title
 *  reads; two or more are a tie only the title breaks (`titleMatches`), with exactly one survivor; anything else is
 *  null. */
export function liveQuestion(ask: AskPairingQuestions, dialog: Dialog | null): number | null {
  const candidates = ask.questions
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => q.options.length > 0 && questionCorresponds(q, dialog));
  if (candidates.length === 1) return candidates[0]!.i;
  if (candidates.length === 0 || dialog === null) return null;
  const named = candidates.filter(({ q }) => titleMatches(q.question, dialog.title));
  return named.length === 1 ? named[0]!.i : null;
}

/** The one question whose text the pane's title names (`titleMatches`), as an index, else null. */
export function namedQuestion(ask: AskPairingQuestions, dialog: Dialog | null): number | null {
  if (dialog === null) return null;
  const named = ask.questions.flatMap((q, i) => (titleMatches(q.question, dialog.title) ? [i] : []));
  return named.length === 1 ? named[0]! : null;
}

/** `live` (`liveQuestion`), `named` (`namedQuestion`), `shown` (the live question, else the named one, else question
 *  1: a display, never answered) and `placed` (where the pane IS: `live ?? named`, else null). */
export function shownQuestion(
  ask: AskPairingQuestions, dialog: Dialog | null,
): { live: number | null; named: number | null; shown: number; placed: number | null } {
  const live = liveQuestion(ask, dialog);
  const named = namedQuestion(ask, dialog);
  return { live, named, shown: live ?? named ?? 0, placed: live ?? named };
}

/** Which screen of the ask the pane is on, by question identity: `review` for the review screen (`reviewRows`),
 *  `q<i>` for question `i` (`liveQuestion`, else `namedQuestion`), or null for a screen that cannot be placed. Never the
 *  raw dialog id, which changes as the free-text row is typed into. */
export function askScreen(ask: AskPairingQuestions, dialog: Dialog | null): string | null {
  if (dialog === null) return null;
  if (reviewRows(dialog) !== null) return 'review';
  const i = liveQuestion(ask, dialog) ?? namedQuestion(ask, dialog);
  return i === null ? null : `q${i}`;
}

/** The pairing of one question envelope with one pane reading, as the wire carries it (`AskPairing`). */
export function pairEnvelope(ask: AskPairingQuestions, dialog: Dialog | null): AskPairing {
  const { live, named, shown, placed } = shownQuestion(ask, dialog);
  return {
    live, named, shown, placed,
    screen: askScreen(ask, dialog),
    corresponds: ask.questions.map((q) => questionCorresponds(q, dialog)),
  };
}

// What a live AskUserQuestion pane is showing, read for the sheet (D-5089, plan
// docs/superpowers/plans/2026-10-15-ask-sheet-half.md, Task 1): which of the envelope's questions the pane is painting,
// the one its title names when labels cannot say, the review screen an ask ends on and its summary, the free-text
// row under a question's options, and the `Chat about this` row under that.
//
// PURE: it imports `shared/api`'s types and `shared/ask-menu`'s rules, and nothing else; no React, no store. Both
// sheets read it (the envelope's and the scraped one), so the two cannot disagree about what is on screen.
//
// Every screen fact here is a rule from `shared/ask-menu.ts`, never spelled again (`single-definition.test.ts`). The
// facts were measured on Claude Code 2.1.300 (`server/test/fixtures/panes/cc300-ask-*.txt`, the server half's plan
// docs/superpowers/plans/2026-10-15-ask-server-half.md, "Facts the sheet half needs"):
// - one question at a time is painted, and its title is the question's text, or for a question too long for one row
//   its LAST row under a `│ ` bar; markdown is not rendered, so backticks and asterisks reach the title verbatim;
// - the free-text row is row n+1 under a question's n options, `Type something.` while empty, the text once typed;
//   the two-column preview layout paints none, and `Chat about this` sits where it would be;
// - the review screen is told by its body's last line and its two rows, never its first line: a review taller than
//   `parseDialog`'s 20-row climb loses its heading and its title (`cc300-ask-review-4q-long`);
// - a multiSelect question's boxes are its own options, read into `Dialog.multi` (D-5048), and the answer lists the
//   boxes in the order they became ticked (`cc300-ask-review-tick-order`); the last question's commit row reads
//   `Submit` and lands on the review (D-5091).
import type { Dialog, DialogMulti, HookAskQuestion } from '../../../shared/api';
import {
  CHAT_ABOUT_ROW_RE,
  COMMIT_LAST_RE,
  FREE_TEXT_PLACEHOLDER_RE,
  REVIEW_CANCEL_ROW_RE,
  REVIEW_HEADING_RE,
  REVIEW_READY_RE,
  REVIEW_SUBMIT_ROW_RE,
} from '../../../shared/ask-menu';

/** The questions of an AskUserQuestion envelope (`HookAsk`'s question arm). */
export interface AskQuestions {
  readonly questions: readonly HookAskQuestion[];
}

/** Mirrors server/src/transcript/ask.ts's `pairMatches`/`norm`: normalize by
 *  trim + lowercase + collapsed whitespace, then compare as prefixes, since
 *  either side may be the truncated one (leftCol cuts a scraped label at a
 *  run of two spaces or the two-column gutter). Reimplemented here — not
 *  imported — because the pwa doesn't depend on server code; keep this
 *  identical to ask.ts's rule or the two layers' notion of "the same
 *  question" drifts apart. */
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
const prefixMatches = (a: string, b: string): boolean => {
  const [x, y] = [norm(a), norm(b)];
  return x !== '' && y !== '' && (x.startsWith(y) || y.startsWith(x));
};

/** C1: does the envelope's first question describe the same live menu
 *  `dialog` is showing? `answer()` types `dialog`'s pane by INDEX, so this
 *  has to be sure the envelope's copy and the pane's rows are the same
 *  question before a tap is allowed to walk it — every one of the envelope's
 *  options must line up with the pane's option at that same position (no
 *  forgiveness the way ask.ts's `alignAsk` allows when merely deciding which
 *  question is on screen: here the index is about to be TYPED). I1: an
 *  unparsed `dialog` never corresponds — it has no reliable per-position
 *  labels to compare (a multi-select menu parses this way — by its footer on
 *  older builds, by its row checkboxes on 2.1.280; so does a capture taken
 *  mid-redraw), so treating it as a match would answer a tap
 *  by sending a stray arrow-key walk into a pane that isn't the numbered
 *  menu it looks like.
 *
 *  D-5091: except through `Dialog.multi`, the one unparsed menu whose rows WERE
 *  read per position (D-5048): a multiSelect question's boxes, answered by
 *  their digits through `/dialog/multi`, never by a walk. The kinds must agree:
 *  a `multiSelect` question corresponds only to a pane carrying `multi`, and
 *  any other question only to a parsed menu, so a box is never answered by one
 *  tap and a row never by a set of ticks. Against the boxes the count must be
 *  EQUAL, not merely covered: they are the question's own options, where a
 *  parsed menu's rows run on past them (the free-text row, `Chat about this`). */
export function questionCorresponds(q: HookAskQuestion, dialog: Dialog | null): boolean {
  if (dialog === null) return false;
  if (q.multiSelect === true || dialog.multi !== undefined) {
    const boxes = dialog.multi?.options;
    if (q.multiSelect !== true || boxes === undefined || boxes.length !== q.options.length) return false;
    return q.options.every((o, i) => prefixMatches(boxes[i]!.label, o.label));
  }
  if (!dialog.parsed) return false;
  if (dialog.options.length < q.options.length) return false;
  return q.options.every((o, i) => prefixMatches(dialog.options[i]!.label, o.label));
}

/** A wrapped question's rows are painted under a `│ ` bar, and the pane's title is the last of them, bar included. */
const WRAP_BAR_RE = /^\s*│\s*/;

/** Does the pane's `title` name `question`? The title, with a leading `│ ` stripped, is a SUFFIX of the question once
 *  both are normalized (`norm`): a question that fits one row is its whole text, a wrapped one is its last row.
 *  Markdown is literal on screen, so nothing is unescaped. An empty title names nothing. */
export function titleMatches(question: string, title: string): boolean {
  const t = norm(title.replace(WRAP_BAR_RE, ''));
  return t !== '' && norm(question).endsWith(t);
}

/**
 * Which of the envelope's questions is the pane painting, as an index into `ask.questions`, or null when that cannot
 * be told. A tap on the sheet types the pane's option by index, so a wrong answer here is a wrong answer sent.
 *
 * Labels decide first. The candidates are the questions with options that correspond to the pane's rows by position
 * (`questionCorresponds`). EXACTLY ONE candidate wins on its own, whatever the title reads: question texts are unique
 * in a tool call, and a title made mandatory would turn a question that answers today into "can't be matched"
 * whenever Claude Code paints its text differently from the envelope (the diagnosis's correction). Two or more
 * candidates (Yes/No asked twice) are a tie, which only the title breaks (`titleMatches`): exactly one survivor wins,
 * and anything else is null. No candidate is null. A one-question envelope therefore keeps the labels-only rule.
 *
 * Never a candidate: a question listing no options (`every` over none is vacuously true, so it would match any parsed
 * pane). A `multiSelect` one is a candidate only against the boxes of `Dialog.multi` (D-5091), never against a parsed
 * menu, where one tap would tick a box and answer nothing (`questionCorresponds` holds both rules).
 */
export function liveQuestion(ask: AskQuestions, dialog: Dialog | null): number | null {
  const candidates = ask.questions
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => q.options.length > 0 && questionCorresponds(q, dialog));
  if (candidates.length === 1) return candidates[0]!.i;
  if (candidates.length === 0 || dialog === null) return null;
  const named = candidates.filter(({ q }) => titleMatches(q.question, dialog.title));
  return named.length === 1 ? named[0]!.i : null;
}

/** The one question whose text the pane's title names (`titleMatches`), as an index into `ask.questions`, else null.
 *  It names what labels cannot reach, such as a multiSelect question (unparsed, so nothing corresponds), so the sheet
 *  can say which question is up even when it cannot answer it. */
export function namedQuestion(ask: AskQuestions, dialog: Dialog | null): number | null {
  if (dialog === null) return null;
  const named = ask.questions.flatMap((q, i) => (titleMatches(q.question, dialog.title) ? [i] : []));
  return named.length === 1 ? named[0]! : null;
}

/** Is the pane on the review screen an ask ends on? Parsed, exactly two rows reading `Submit answers` and `Cancel`
 *  (`REVIEW_SUBMIT_ROW_RE`, `REVIEW_CANCEL_ROW_RE`), and the body ending with the ready line (`REVIEW_READY_RE`). Never
 *  keyed on the body's first line or the title: a review too tall for `parseDialog`'s climb loses both. */
export function isAskReview(dialog: Dialog | null): boolean {
  if (dialog === null || !dialog.parsed || dialog.options.length !== 2) return false;
  const [submit, cancel] = dialog.options as [Dialog['options'][number], Dialog['options'][number]];
  return REVIEW_SUBMIT_ROW_RE.test(submit.label.trim())
    && REVIEW_CANCEL_ROW_RE.test(cancel.label.trim())
    && REVIEW_READY_RE.test((dialog.body ?? '').trimEnd());
}

/** The tab row a multi-question ask paints at the top of its box: `←  ☒ Caching  ☐ Tracing  ✔ Submit  →`. */
const TAB_ROW_RE = /^←.*→$/;

/** Mirrors server/src/pane/dialog.ts's `isRule`: a line of `─` (spaces allowed), at least 8 wide. */
const isRule = (line: string): boolean => {
  const t = line.trim();
  return t.length >= 8 && [...t].every((c) => c === '─' || c === ' ');
};

/**
 * The review screen's summary, as the pane paints it: the warning line when a question was skipped, then each answered
 * question and its answer. Read from `dialog.raw`, never `body`: `body` is cut at `parseDialog`'s 20-row climb, and a
 * review with long answers is taller (`cc300-ask-review-4q-long` keeps only the last answers in its body).
 *
 * The lines after the nearest tab row or rule above the LAST ready line (the same words said in chat above the box
 * are earlier), up to that line; with neither above it, from the top of the capture, which the review then fills.
 * The `Review your answers` heading is dropped (it becomes the sheet's title), blank edges are trimmed, and the indent
 * every line shares is removed. Everything else is verbatim, trailing space aside. Empty when no ready line is painted.
 */
export function reviewSummary(dialog: Dialog): string[] {
  const lines = dialog.raw.split('\n').map((l) => l.trimEnd());
  let ready = -1;
  for (let i = lines.length - 1; i >= 0 && ready < 0; i--) if (REVIEW_READY_RE.test(lines[i]!.trim())) ready = i;
  if (ready < 0) return [];
  let from = 0;
  for (let i = ready - 1; i >= 0; i--) {
    const t = lines[i]!.trim();
    if (TAB_ROW_RE.test(t) || isRule(t)) {
      from = i + 1;
      break;
    }
  }
  let out = trimBlankEdges(lines.slice(from, ready));
  if (out.length > 0 && REVIEW_HEADING_RE.test(out[0]!.trim())) out = trimBlankEdges(out.slice(1));
  const indent = Math.min(...out.filter((l) => l !== '').map((l) => l.length - l.trimStart().length));
  return Number.isFinite(indent) && indent > 0 ? out.map((l) => l.slice(indent)) : out;
}

function trimBlankEdges(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a] === '') a++;
  while (b > a && lines[b - 1] === '') b--;
  return lines.slice(a, b);
}

/** The free-text row under a question, as the sheet offers it (D-5090):
 *  - `empty`: the placeholder row, which own words are typed into;
 *  - `held`: a row already holding text, and that text (`rowText`);
 *  - `none`: no free-text row the sheet can use. */
export type FreeTextSlot =
  | { kind: 'empty'; index: number }
  | { kind: 'held'; index: number; text: string }
  | { kind: 'none' };

/** Mirrors server/src/inject/send.ts's `rowText`, the echo rule of `answerDialogText` (D-5047): a row's label, then its
 *  description, whitespace runs collapsed and the ends trimmed. A typed answer longer than one screen row is read as
 *  its first row (the label) and the rest (the description), so the two together are the whole text (measured exact
 *  for a 1000-character answer, `cc300-ask-freetext-1000`). Keep the two identical, or the sheet offers a retry the
 *  route refuses. */
export function rowText(o: { label: string; description?: string }): string {
  return (o.description === undefined ? o.label : `${o.label} ${o.description}`).replace(/\s+/g, ' ').trim();
}

/**
 * The free-text row under a question with `n` options, read off a parsed pane.
 *
 * With `n` known, the row printed `n + 1` is the slot: `empty` while it passes `FREE_TEXT_PLACEHOLDER_RE`, `none` when
 * it is absent or is `Chat about this` (`CHAT_ABOUT_ROW_RE`: the two-column preview layout, which paints no free-text
 * row), and otherwise `held`, with its text. With `n` unknown, only the placeholder row can be told from an option, so
 * the slot is that row, else `none`. An unparsed screen (a multiSelect question, whose free text v1 does not answer)
 * has none.
 */
export function freeTextSlot(dialog: Dialog, n: number | null): FreeTextSlot {
  if (!dialog.parsed) return { kind: 'none' };
  if (n === null) {
    const empty = dialog.options.find((o) => FREE_TEXT_PLACEHOLDER_RE.test(o.label));
    return empty === undefined ? { kind: 'none' } : { kind: 'empty', index: empty.index };
  }
  const row = dialog.options.find((o) => o.index === n + 1);
  if (row === undefined || CHAT_ABOUT_ROW_RE.test(row.label)) return { kind: 'none' };
  if (FREE_TEXT_PLACEHOLDER_RE.test(row.label)) return { kind: 'empty', index: row.index };
  return { kind: 'held', index: row.index, text: rowText(row) };
}

/** The question a free-text row belongs to, as a key: the pane's title and every row's label except the free-text
 *  row `row` itself. Typing changes that row (its label becomes the text, and so the dialog id, which hashes the
 *  labels), never the others, so the key holds through a text call's whole walk; a different question, or the same
 *  title over different options, is a different key. An own-words call is keyed by it (D-5090), so a call made for one
 *  question never says which row is the free-text row on another. */
export function questionKey(dialog: Dialog, row: number): string {
  return JSON.stringify([dialog.title, dialog.options.map((o) => (o.index === row ? null : o.label))]);
}

/** Does the slot hold exactly `text`, by the server's echo rule (`rowText` on both sides)? A row holding exactly the
 *  text a refused call sent is the stranded-text retry (D-5090): the route proves it and submits it without typing
 *  (D-5047's retry arm). Any other text in the row is the operator's to finish or clear in the terminal. */
export function slotHolds(slot: FreeTextSlot, text: string): boolean {
  return slot.kind === 'held' && slot.text === rowText({ label: text });
}

/** Does the slot hold only the START of `text`, by the same echo rule? A capture taken while tmux was typing, or an
 *  echo that failed part way, leaves the row holding a prefix of the answer. The route refuses to type after it
 *  (`not-free-text`: typing would append), so it is the terminal's to clear; once it is, Send types the whole text. */
export function slotHoldsPart(slot: FreeTextSlot, text: string): boolean {
  if (slot.kind !== 'held' || slot.text === '') return false;
  const whole = rowText({ label: text });
  return whole !== slot.text && whole.startsWith(slot.text);
}

/** The `Chat about this` row of a parsed pane (`CHAT_ABOUT_ROW_RE`), or undefined. A tap on it declines the WHOLE ask
 *  so the user can talk it over (measured), which both sheets say on the row itself (D-5090). */
export function chatRow(dialog: Dialog): Dialog['options'][number] | undefined {
  return dialog.parsed ? dialog.options.find((o) => CHAT_ABOUT_ROW_RE.test(o.label)) : undefined;
}

/** The boxes the pane shows ticked on a multiSelect question, by their digits, in screen order (D-5091). */
export function paneTicks(multi: DialogMulti): number[] {
  return multi.options.filter((o) => o.checked).map((o) => o.index);
}

/**
 * The set a multiSelect commit sends (`api.answerDialogMulti`, D-5048), ordered as the answer will list it: `ticked` is
 * the operator's set, in the order its boxes were ticked. The answer lists boxes in the order they became ticked
 * (measured, `cc300-ask-review-tick-order`), and the route sends a digit only for a box whose tick differs on the pane,
 * new ticks in the order asked. So a box the pane already shows ticked is never re-sent and keeps its place (screen
 * order here, which is all the pane tells), whatever happened to it on the sheet meanwhile, and the boxes ticked from
 * the sheet follow in tap order. A box the pane shows ticked and `ticked` leaves out is unticked, and not listed.
 */
export function wantedTicks(multi: DialogMulti, ticked: readonly number[]): number[] {
  const onPane = paneTicks(multi);
  return [...onPane.filter((k) => ticked.includes(k)), ...ticked.filter((k) => !onPane.includes(k))];
}

/** Is this the ask's last question, whose commit lands on the review screen rather than the next question
 *  (`COMMIT_LAST_RE` on the commit row's word)? */
export function commitsToReview(multi: DialogMulti): boolean {
  return COMMIT_LAST_RE.test(multi.commit.trim());
}

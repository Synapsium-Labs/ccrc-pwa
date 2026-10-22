// What a live AskUserQuestion pane is showing, read for the sheet (D-5089, plan
// docs/superpowers/plans/2026-10-15-ask-sheet-half.md, Task 1): which of the envelope's questions the pane is painting,
// the one its title names when labels cannot say, the review screen an ask ends on, the free-text row under a
// question's options, and the `Chat about this` row under that.
//
// D-6325: `askSource` (below) decides what an ask surface may SHOW, and nothing here hands the pane's text to a
// renderer any more. `paneQuestion` and `reviewSummary`, which did, are deleted: the functions that remain read the pane
// only to say WHICH of Claude's own questions is up and where its cursor and tabs are, facts of position.
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
import type { AskOption, Dialog, DialogAsk, DialogMulti, HookAsk, HookAskQuestion } from '../../../shared/api';
import {
  ASK_TAB_ROW_RE,
  CHAT_ABOUT_ROW_RE,
  COMMIT_LAST_RE,
  FREE_TEXT_PLACEHOLDER_RE,
  parseAskTabs,
  reviewRows,
  type AskTab,
  type ReviewRows,
} from '../../../shared/ask-menu';

/** One of Claude's own questions as a surface renders it (D-6325): the hook envelope's question, or the transcript's copy
 *  of one. The transcript's options may carry a `preview` (an option's worked example), which the hook's never do. */
export type StructuredQuestion = Omit<HookAskQuestion, 'options'> & { options: readonly AskOption[] };

/** The questions of an AskUserQuestion envelope (`HookAsk`'s question arm), or of the transcript's copy. */
export interface AskQuestions {
  readonly questions: readonly StructuredQuestion[];
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

/** C1: does the envelope question `q` describe the same live menu `dialog`
 *  is showing? `liveQuestion` asks it of EVERY question of the envelope
 *  (D-5089), never the first alone. `answer()` types `dialog`'s pane by INDEX, so this
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
export function questionCorresponds(q: StructuredQuestion, dialog: Dialog | null): boolean {
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

/** Which question of the envelope the sheet is showing, worked out once for everything that draws it (D-6325: the header
 *  in `DialogSheet`'s one container, and the question's rows in `EnvelopeSheet`). `live` is the question the pane is
 *  painting (`liveQuestion`) and `named` the one its title names (`namedQuestion`); `shown` is what the sheet displays:
 *  the live question, else the named one, else question 1, displayed read-only and never answered; `placed` is where
 *  the pane IS (`live ?? named`, else null: the fallback to question 1 is a display, not a position). */
export interface ShownQuestion {
  readonly live: number | null;
  readonly named: number | null;
  readonly shown: number;
  readonly placed: number | null;
}

export function shownQuestion(ask: AskQuestions, dialog: Dialog | null): ShownQuestion {
  const live = liveQuestion(ask, dialog);
  const named = namedQuestion(ask, dialog);
  return { live, named, shown: live ?? named ?? 0, placed: live ?? named };
}

/** Which screen of the ask the pane is on, by QUESTION IDENTITY (decision `ask-envelope-dismissal-per-screen`):
 *  `review` for the review screen (`isAskReview`), `q<i>` for question `i` (`liveQuestion`, else `namedQuestion` by its
 *  title), or null for a screen the sheet cannot place (no menu, or an unparsed or unmatched grab). Never the raw
 *  dialog id: that hashes every row's label, so typing into the free-text row in the terminal repaints the SAME
 *  question under a new id, and a mid-redraw grab of it comes back unparsed under another. */
export function askScreen(ask: AskQuestions, dialog: Dialog | null): string | null {
  if (dialog === null) return null;
  if (isAskReview(dialog)) return 'review';
  const i = liveQuestion(ask, dialog) ?? namedQuestion(ask, dialog);
  return i === null ? null : `q${i}`;
}

/** Is the pane on the review screen an ask ends on? `reviewRows` (`shared/ask-menu.ts`) says, and which rows are its
 *  Submit and Cancel: the strict D-5089 shape, or the lenient arm (decision `ask-review-lenient-arm`), which finds both
 *  rows by label on any screen that paints the ready line. Never keyed on the body's first line or the title: a review
 *  too tall for `parseDialog`'s climb loses both. */
export function isAskReview(dialog: Dialog | null): boolean {
  return reviewRows(dialog) !== null;
}

/** The word of the review's Submit row, and of the transcript's Answer control while that review is up (D-6325): fixed
 *  words, never the pane's own label. */
export const SUBMIT_ANSWERS = 'Submit answers';

/** The transcript's Answer control's word for the live pane menu (decision `ask-answer-control-says-submit`): while
 *  it is an ask's review screen, `Submit answers` (D-6325: the fixed word, not the pane's label), so a hidden sheet is
 *  one labelled click from Submit; otherwise undefined, the control's own `Answer`. It still only raises the sheet. */
export function answerControlLabel(dialog: Dialog | null): string | undefined {
  return reviewRows(dialog) === null ? undefined : SUBMIT_ANSWERS;
}

/** `s` with the box-drawing characters (U+2500 to U+257F) taken out and the ends trimmed (D-6325). A pane can paint a
 *  row inside its frame (`│ Type something. │`), and `FREE_TEXT_PLACEHOLDER_RE` is anchored at both ends, so the bars
 *  made an empty free-text row read as an option whose label was the bars (defect 1b's first cause). */
export function stripBox(s: string): string {
  return s.replace(/[\u2500-\u257F]/g, '').trim();
}

/** Is this row label the empty free-text row, with any box characters around it ignored? */
const isPlaceholderLabel = (label: string): boolean => FREE_TEXT_PLACEHOLDER_RE.test(stripBox(label));

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
    const empty = dialog.options.find((o) => isPlaceholderLabel(o.label));
    return empty === undefined ? { kind: 'none' } : { kind: 'empty', index: empty.index };
  }
  const row = dialog.options.find((o) => o.index === n + 1);
  if (row === undefined || CHAT_ABOUT_ROW_RE.test(row.label)) return { kind: 'none' };
  if (isPlaceholderLabel(row.label)) return { kind: 'empty', index: row.index };
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

/** The commit row's word as the SHEET says it (D-6325): `Review answers` on the ask's last question, else `Next`. The
 *  commit button and every sentence that names the row read it from here, never the pane's own label for the row. */
export const COMMIT_REVIEW = 'Review answers';
export const COMMIT_NEXT = 'Next';
export const commitWord = (multi: DialogMulti): string => (commitsToReview(multi) ? COMMIT_REVIEW : COMMIT_NEXT);

/** Which tab of the pane's tab row is the question with this `header` (decision `ask-tab-strip`): its 0-based place when
 *  exactly one tab carries it, else null. The pane marks its active tab by colour alone, so the scraped sheet knows its
 *  place only through the transcript's header for the question, and two tabs with one header say nothing. */
export function headerTab(tabs: readonly AskTab[], header: string | undefined): number | null {
  if (header === undefined || header.trim() === '') return null;
  const at = tabs.flatMap((t, i) => (t.header === header.trim() ? [i] : []));
  return at.length === 1 ? at[0]! : null;
}

/** Has the sheet changed this multiSelect question's boxes without committing them (`picked` against the pane's
 *  ticks)? A tab move leaves the pane's ticks as they are, so it would lose them: ←/→ and the tab strip wait. */
export function picksUncommitted(multi: DialogMulti, picked: readonly number[] | null): boolean {
  if (picked === null) return false;
  const pane = paneTicks(multi);
  return picked.length !== pane.length || picked.some((k) => !pane.includes(k));
}

/**
 * I4: is there anything accessible to actually show? Mirrors the scraped path's own blank-question fallback, but a hook
 * envelope has no second source of its own, so "blank" here means "treat as absent" rather than "render with an empty
 * title", which would leave the sheet with no accessible name at all. A type guard so the call site gets `hookAsk`
 * narrowed to `HookAsk` for free. Moved here from `DialogSheet.tsx` (D-6325): `askSource` is its first reader now.
 */
export function isUsableAsk(a: HookAsk | null): a is HookAsk {
  if (a === null) return false;
  if ('approval' in a) return true;
  return a.questions.length > 0 && a.questions[0]!.question.trim() !== '';
}

/** One trailing `(Recommended)`, with any space around it: Claude's own mark on the option it prefers. Anchored at the
 *  end, so a label that says the word anywhere else keeps it. */
const RECOMMENDED_TAIL_RE = /\s*\(recommended\)\s*$/i;

/**
 * An option's label split from Claude's own `(Recommended)` mark (D-6325): the row shows the label and a chip reads
 * "Recommended". ONE trailing tag is taken off (case and the space around it do not matter); `Recommended reading`
 * and `Use the (Recommended) path` stay whole, and a label that is only the tag keeps itself, since nothing would be
 * left to read.
 */
export function optionCopy(label: string): { label: string; recommended: boolean } {
  const stripped = label.replace(RECOMMENDED_TAIL_RE, '');
  return stripped.trim() === '' ? { label, recommended: false } : { label: stripped, recommended: stripped !== label };
}

/** What an ask surface may show (D-6325): the answer of `askSource`. */
export type AskSource =
  /** No menu, or no `ask`/`ask_cleared` frame yet on this connection: nothing to show. */
  | { kind: 'none' }
  /** The hook's permission envelope; its summary is already redacted on the wire. */
  | { kind: 'approval'; approval: { tool: string; summary: string } }
  /** The pane is on the ask's review screen. `summary` lists each structured question's header and the pane's mark
   *  (a position fact; null when the tab row does not line up with the questions); never a pane line. */
  | { kind: 'review'; rows: ReviewRows; summary: { header: string; answered: boolean | null }[] }
  /** Claude's own question: the hook's envelope, or the transcript's copy when every row aligned. */
  | { kind: 'structured'; questions: readonly StructuredQuestion[]; from: 'hook' | 'transcript' }
  /** Ask evidence and no structured copy that fully aligns: the surface says so and offers the terminal. */
  | { kind: 'ask-unreadable' }
  /** A menu with no ask evidence (a plan approval, a TUI prompt): the only variant that carries pane text, because no
   *  structured copy exists for it. */
  | { kind: 'menu'; title: string; options: Dialog['options'] }
  /** An unparsed menu with no ask evidence. */
  | { kind: 'terminal-only' };

export interface AskSourceInput {
  /** The stream's hook envelope. */
  ask: HookAsk | null;
  /** The pane's menu. */
  dialog: Dialog | null;
  /** Has an `ask` or `ask_cleared` frame arrived on THIS connection (the store's `askFrameSeen`)? */
  askFrameSeen: boolean;
}

/** The transcript's copy of the question as a structured one, or null while any row did not align (a `null` option) or
 *  the question is blank. An option's `preview` is kept (D-6325): it is Claude's own worked example for that row, and
 *  the surface draws it under the row as the scraped sheet did. */
function transcriptQuestion(a: DialogAsk | undefined): StructuredQuestion | null {
  if (a === undefined || a.question.trim() === '' || a.options.some((o) => o === null)) return null;
  const q: StructuredQuestion = {
    question: a.question,
    multiSelect: a.multiSelect,
    options: a.options.map((o) => {
      const { label, description, preview } = o!;
      return {
        label,
        ...(description === undefined ? {} : { description }),
        ...(preview === undefined ? {} : { preview }),
      };
    }),
  };
  if (a.header !== undefined) q.header = a.header;
  return q;
}

/** A question's header chip, or `Question <n>` (1-based) for one with none: the one name the tab strip and the review's
 *  summary give a question (D-6325). */
export function questionHeader(q: { header?: string }, index: number): string {
  return q.header !== undefined && q.header.trim() !== '' ? q.header.trim() : `Question ${index + 1}`;
}

/** The tab strip's chips (D-6325, R3): each structured question's header, with the pane's mark of whether it is
 *  answered, by position. The pane's tab row says only HOW MANY tabs there are and which are answered; the words are
 *  Claude's. Null (no strip) unless the pane paints a tab row with exactly one tab per question. */
export function tabChips(
  questions: readonly { header?: string }[], paneTabs: readonly AskTab[] | null,
): { header: string; answered: boolean }[] | null {
  if (paneTabs === null || paneTabs.length !== questions.length) return null;
  return questions.map((q, i) => ({ header: questionHeader(q, i), answered: paneTabs[i]!.answered }));
}

/** Is the pane showing an ask at all (D-6325)? A `Dialog.ask` (even partly aligned), a `Dialog.multi` (a multiSelect
 *  AskUserQuestion by definition), the free-text row (box characters stripped), the Chat row, or the ask's tab row. The
 *  fleet row's hook state is NOT evidence: it is gone past the 30-minute cut and cannot tell a question from an approval. */
function hasAskEvidence(dialog: Dialog): boolean {
  return dialog.ask !== undefined
    || dialog.multi !== undefined
    || freeTextSlot(dialog, null).kind === 'empty'
    || chatRow(dialog) !== undefined
    || dialog.raw.split('\n').some((l) => ASK_TAB_ROW_RE.test(l.trim()));
}

/**
 * What an ask surface may SHOW, decided once (D-6325, plan T1b). On an AskUserQuestion no string the PWA renders comes
 * from the pane: the pane supplies facts of position (is a menu up, where is its cursor, which tab is current and
 * which are answered), and the words come from Claude's own question. The first rule that holds wins:
 *
 *  1. no frame on this connection yet: `none` (an `ask` the store holds from before a drop is not current);
 *  2. a usable approval envelope: `approval`, with or without a menu;
 *  3. the pane is the ask's review screen: `review`, fixed words and a summary of the structured headers;
 *  4. a usable question envelope: `structured` from the hook, with or without a menu;
 *  5. no menu: `none`;
 *  6. the transcript's copy, every row aligned: `structured` from the transcript;
 *  7. ask evidence and nothing that aligns: `ask-unreadable`;
 *  8. a parsed menu with no ask evidence: `menu`, the only variant that carries pane text;
 *  9. otherwise `terminal-only`.
 *
 * PURE: values in, a value out; the store's types are not imported here.
 */
export function askSource({ ask, dialog, askFrameSeen }: AskSourceInput): AskSource {
  if (!askFrameSeen) return { kind: 'none' };
  const envelope = isUsableAsk(ask) ? ask : null;
  if (envelope !== null && 'approval' in envelope) return { kind: 'approval', approval: envelope.approval };
  const hookQuestions = envelope !== null && 'questions' in envelope ? envelope.questions : null;
  const rows = dialog === null ? null : reviewRows(dialog);
  if (dialog !== null && rows !== null) {
    // The questions the summary lists: the envelope's, else the transcript's copy even if partly aligned (its header is
    // still Claude's own). None at all lists nothing; a raw line is never a substitute.
    const questions: readonly { header?: string }[] = hookQuestions ?? (dialog.ask === undefined ? [] : [dialog.ask]);
    const tabs = parseAskTabs(dialog.raw)?.tabs ?? null;
    const marks = tabs !== null && tabs.length === questions.length ? tabs : null;
    return {
      kind: 'review',
      rows,
      summary: questions.map((q, i) => ({
        header: questionHeader(q, i),
        answered: marks === null ? null : marks[i]!.answered,
      })),
    };
  }
  if (hookQuestions !== null) return { kind: 'structured', questions: hookQuestions, from: 'hook' };
  if (dialog === null) return { kind: 'none' };
  const copy = transcriptQuestion(dialog.ask);
  if (copy !== null) return { kind: 'structured', questions: [copy], from: 'transcript' };
  if (hasAskEvidence(dialog)) return { kind: 'ask-unreadable' };
  if (dialog.parsed) return { kind: 'menu', title: (dialog.title.split('\n')[0] ?? '').trim(), options: dialog.options };
  return { kind: 'terminal-only' };
}

// The parts of an AskUserQuestion sheet that BOTH sheets render (D-5089, plan
// docs/superpowers/plans/2026-10-15-ask-sheet-half.md, Task 2): the envelope's (`EnvelopeSheet.tsx`, while the hook's
// envelope is fresh) and the scraped one (`DialogSheet.tsx`, which takes over when the envelope ages out and
// `ask_cleared` arrives, 30 minutes into an unanswered ask). Written once here so the hand-off cannot change what the
// operator sees mid-ask: the same eyebrow, the same review screen, the same sentence for a question the sheet cannot
// answer yet.
//
// What is on the pane is read by `askLive.ts`; this file only renders it. Every row is `@ccrc/ui`'s `OptionRow`, and
// every class here is one chat.css already grounds (`.dlg-*`, `.opts`, `.ask-envelope-more*`).
//
// D-5090 (Task 3) adds the own-words region (`OwnWords`) and the `Chat about this` row (`ChatRow`), which both sheets
// render under the live question's options. The own-words STATE is not here: it lives in `DialogSheet`, keyed to the
// call, so a hand-off mid-call (`ask_cleared`) carries the same text and the same call to the scraped sheet.
import type { ReactNode } from 'react';
import { DIALOG_TEXT_MAX, type Dialog, type HookAskQuestion } from '../../../shared/api';
import { EYEBROW, OptionRow } from '@ccrc/ui';
import { reviewSummary, slotHolds, type FreeTextSlot } from './askLive';
import { ownWordsHeld } from './askWords';
import './chat.css';

/** The sheet's title on the review screen an ask ends on (the pane's own heading, which a tall review scrolls off). */
export const REVIEW_TITLE = 'Review your answers';

/** A multiSelect question the sheet can name (its title) but not answer: one tap ticks a box and answers nothing.
 *  D-5091 turns it into boxes where the pane carries `Dialog.multi`; this stays for a pane that does not. Every
 *  multiSelect question is followed by another question or by the review (measured), and both come back here. */
export const SEVERAL_ANSWERS =
  'This one takes several answers, so pick them on the terminal pane. The next question, or the review, comes back here.';

/** What Cancel on the review does, said before the tap: it rejects the whole tool call and every answer with it
 *  (measured, `cc300-ask-review-cancelled`: "User declined to answer questions"). */
const CANCEL_DECLINES_ALL = 'Declines every question in this ask — nothing you answered is sent.';

/** The review's Cancel row. `isAskReview` proved the screen has exactly two rows, Submit answers then Cancel. */
const REVIEW_CANCEL_INDEX = 2;

/**
 * The sheet's kicker: `claude is asking`, the question's header chip when it has one, and `n of N` when the sheet
 * knows which of several questions it is showing. Only the envelope sheet knows that: the pane marks its active tab
 * by colour alone, which a plain capture cannot see, so the scraped sheet passes no `progress`.
 */
export function AskEyebrow({
  header,
  progress,
}: {
  header?: string;
  progress?: { n: number; of: number };
}): ReactNode {
  return (
    <>
      claude is asking
      {header && (
        <>
          {' '}
          <span className="dlg-header-chip">{header}</span>
        </>
      )}
      {progress && (
        <>
          {' · '}
          <span>{`${progress.n} of ${progress.of}`}</span>
        </>
      )}
    </>
  );
}

/**
 * The review screen an ask ends on: the pane's summary, then the pane's own two rows. `Submit answers` is `answer(1)`
 * and sends every answer; `Cancel` is `answer(2)` and says first that it declines them all.
 *
 * The summary is `reviewSummary`'s, read from `dialog.raw` (never `body`, which a tall review loses its top answers
 * from), in `.dlg-body`: pre-wrap, breaks anywhere, and scrolls at 38vh, so a 1000-character answer wraps and the two
 * rows stay reachable under it at every width.
 */
export function AskReview({
  dialog,
  answering,
  locked,
  onAnswer,
}: {
  dialog: Dialog;
  /** The option index whose answer is in flight, as the sheet's own rows read it. */
  answering: number | null;
  /** Another send is in flight (an own-words call, D-5090), so no row may start one. */
  locked: boolean;
  onAnswer: (optionIndex: number) => void;
}): ReactNode {
  const summary = reviewSummary(dialog);
  return (
    <>
      {summary.length > 0 && <p className="dlg-body">{summary.join('\n')}</p>}
      <div className="opts">
        {dialog.options.map((o) => {
          const selected = o.index === dialog.selectedIndex;
          const waiting = answering === o.index;
          return (
            <OptionRow
              key={`${dialog.id}:${o.index}`}
              selected={selected}
              glyph={selected ? '❯' : ''}
              index={o.index}
              label={o.label}
              sublabel={o.index === REVIEW_CANCEL_INDEX ? CANCEL_DECLINES_ALL : undefined}
              disabled={locked || answering !== null}
              busy={waiting}
              onClick={() => onAnswer(o.index)}
              marker={waiting ? <span className="opt-wait">answering…</span> : undefined}
              enter={!waiting && selected ? '↵' : undefined}
            />
          );
        })}
      </div>
    </>
  );
}

/**
 * The ask's other questions, read-only under their own separator: one row per question, its number in the ask, its
 * text and its header chip. No `onClick`, so each is a plain `<div aria-disabled>` a screen reader never offers as
 * tappable. Nothing here sends: the pane paints one question at a time, and the sheet answers that one. None for a
 * one-question ask.
 */
export function OtherQuestions({
  questions,
  shown,
}: {
  questions: readonly HookAskQuestion[];
  /** The question the sheet is showing, as an index into `questions`; every other one is listed. */
  shown: number;
}): ReactNode {
  if (questions.length < 2) return null;
  return (
    <div className="ask-envelope-more">
      <p className={`ask-envelope-more-heading ${EYEBROW}`}>other questions in this ask</p>
      <div className="opts">
        {questions.map((q, i) =>
          i === shown ? null : (
            <OptionRow
              key={i}
              index={i + 1}
              label={q.question}
              marker={q.header ? <span className="dlg-header-chip">{q.header}</span> : undefined}
              disabled
            />
          ),
        )}
      </div>
    </div>
  );
}

/**
 * An own-words answer's call (D-5090), as the sheet keeps it. Keyed to the CALL, never to `dialog.id`: typing changes
 * the id (it hashes the labels, and the free-text row's label becomes the text), so the stream can deliver the typed
 * row while the call is still running, and nothing about that frame may reset the send.
 *  - `flight`: the call is running.
 *  - `landed`: it answered ok, and the sheet waits for the pane to move on, as a tapped option does (`answer`).
 *  - `refused`: it was refused, the text is kept, and the sheet reads the pane again.
 */
export interface WordsCall {
  /** The free-text row the call typed into (its printed index). */
  readonly row: number;
  /** The pane's title when it was sent: the question the row belongs to. */
  readonly title: string;
  readonly state: 'flight' | 'landed' | 'refused';
}

/** The own-words field's text and call, held by `DialogSheet` and handed to whichever sheet is showing. */
export interface Words {
  /** The field's text, kept until a call answers ok. */
  readonly text: string;
  readonly call: WordsCall | null;
  readonly onText: (text: string) => void;
  /** Send the text into the free-text row printed `row`. */
  readonly onSend: (row: number) => void;
}

/** Is an own-words send under way (running, or answered and waiting for the pane to move on)? While it is, no row
 *  may start another send and the sheet may not be dismissed. */
export const wordsBusy = (call: WordsCall | null): boolean => call !== null && call.state !== 'refused';

/** The pane paints no free-text row under this question: the two-column preview layout. Its Chat row is the way to
 *  talk it over, then the composer. The row is named by the label the pane paints (`chat`), never spelled here: the
 *  rule that finds it has one home (`shared/ask-menu.ts`, `single-definition.test.ts`). */
const noWordsRow = (chat: string): string =>
  `This question has no own-words row on the terminal. Tap ${chat} to talk it over, then reply in the composer — or answer in the terminal.`;

/** The free-text row already holds text the operator did not send from here: typing would append to it. */
const ROW_HOLDS_OTHER = "The terminal's own-words row already holds other text — finish or clear it there.";

/** The free-text row holds exactly the kept text: a refused attempt typed it and never pressed Enter. */
const WORDS_STRANDED = 'Your answer is typed in the terminal but not sent yet — Send submits it.';

/** Why Send is held back for a trailing `;` (`ownWordsHeld`). */
const TRAILING_SEMICOLON = "A trailing ; doesn't survive the trip to the terminal — leave it off, or answer there.";

/** What `Chat about this` does, said on the row before the tap (measured: a rejection of the whole tool call). */
const CHAT_DECLINES = 'Declines this ask so you can talk it over in the chat.';

/**
 * Answer in your own words (D-5090), under the live question's options, where the pane paints its free-text row:
 *  - `empty`: the field and Send, which types the text into that row (`api.answerDialogText`, through `onSend`);
 *  - `held` with exactly the kept text: the stranded-text retry. The field keeps the text, read-only (the row holds
 *    that text and no other would be accepted), and Send submits what the terminal holds without typing it again;
 *  - `held` with other text: one line, no field;
 *  - `none`: one line pointing to `Chat about this`, when the pane has that row; nothing when it does not (a menu
 *    that is not an AskUserQuestion, whose own text rows are the next effort).
 * While a send is under way none of that is read: the field shows the text, disabled, and Send is busy, whatever the
 * pane paints meanwhile (the typed row under a new id is this send, not other text).
 *
 * The field paints `--fs-input` (16px), so focusing it never zooms iOS Safari, and it shares one row with Send at
 * every width (`.dlg-reply`: the field flexes, Send keeps its 44px).
 */
export function OwnWords({
  slot,
  chat,
  words,
  locked,
}: {
  slot: FreeTextSlot;
  /** The label of the pane's Chat row (`chatRow`), which the `none` line points to; null when the pane paints none. */
  chat: string | null;
  words: Words;
  /** An option's answer is in flight. */
  locked: boolean;
}): ReactNode {
  const { text, call, onText, onSend } = words;
  const busy = wordsBusy(call);
  let row: number;
  if (call !== null && busy) {
    row = call.row;
  } else if (slot.kind === 'none') {
    return chat !== null ? <p className="dlg-copy">{noWordsRow(chat)}</p> : null;
  } else if (slot.kind === 'held' && !slotHolds(slot, text)) {
    return <p className="dlg-copy">{ROW_HOLDS_OTHER}</p>;
  } else {
    row = slot.index;
  }
  const stranded = !busy && slot.kind === 'held';
  const held = ownWordsHeld(text);
  return (
    <>
      <form
        className="dlg-reply"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !locked && held === null) onSend(row);
        }}
      >
        <input
          className="dlg-reply-input"
          type="text"
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder="…or answer in your own words"
          maxLength={DIALOG_TEXT_MAX}
          readOnly={stranded}
          disabled={busy || locked}
          aria-label="Answer in your own words"
        />
        <button
          type="submit"
          className="dlg-reply-send"
          disabled={busy || locked || held !== null}
          aria-busy={busy || undefined}
        >
          Send
          {busy && <span className="opt-wait"> answering…</span>}
        </button>
      </form>
      {stranded && <p className="dlg-copy">{WORDS_STRANDED}</p>}
      {held === 'semicolon' && <p className="dlg-copy">{TRAILING_SEMICOLON}</p>}
    </>
  );
}

/**
 * The pane's own `Chat about this` row, after the own-words region, saying what a tap does: it declines the whole ask
 * so the operator can talk it over in the chat (the composer). A row of its own (`.opts` draws the rule the pane draws
 * above it), answered like any other row, by its printed index. Nothing presses it on the operator's behalf.
 */
export function ChatRow({
  row,
  selectedIndex,
  answering,
  disabled,
  onAnswer,
}: {
  row: Dialog['options'][number];
  /** The pane's cursor row, when the sheet shows the cursor (the scraped sheet does, the envelope's does not). */
  selectedIndex?: number;
  answering: number | null;
  disabled: boolean;
  onAnswer: (optionIndex: number) => void;
}): ReactNode {
  const waiting = answering === row.index;
  const selected = selectedIndex === row.index;
  return (
    <div className="opts">
      <OptionRow
        selected={selected}
        glyph={selectedIndex === undefined ? undefined : selected ? '❯' : ''}
        index={row.index}
        label={row.label}
        sublabel={CHAT_DECLINES}
        disabled={disabled}
        busy={waiting}
        onClick={() => onAnswer(row.index)}
        marker={waiting ? <span className="opt-wait">answering…</span> : undefined}
        enter={!waiting && selected ? '↵' : undefined}
      />
    </div>
  );
}

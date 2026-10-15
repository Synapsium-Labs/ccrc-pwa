// The parts of an AskUserQuestion sheet that BOTH sheets render (D-5089, plan
// docs/superpowers/plans/2026-10-15-ask-sheet-half.md, Task 2): the envelope's (`EnvelopeSheet.tsx`, while the hook's
// envelope is fresh) and the scraped one (`DialogSheet.tsx`, which takes over when the envelope ages out and
// `ask_cleared` arrives, 30 minutes into an unanswered ask). Written once here so the hand-off cannot change what the
// operator sees mid-ask: the same eyebrow, the same review screen, the same sentence for a question the sheet cannot
// answer yet.
//
// What is on the pane is read by `askLive.ts`; this file only renders it. Every row is `@ccrc/ui`'s `OptionRow`, and
// every class here is one chat.css already grounds (`.dlg-*`, `.opts`, `.ask-envelope-more*`).
import type { ReactNode } from 'react';
import type { Dialog, HookAskQuestion } from '../../../shared/api';
import { EYEBROW, OptionRow } from '@ccrc/ui';
import { reviewSummary } from './askLive';
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
  onAnswer,
}: {
  dialog: Dialog;
  /** The option index whose answer is in flight, as the sheet's own rows read it. */
  answering: number | null;
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
              disabled={answering !== null}
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

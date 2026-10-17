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
//
// D-5091 (Task 4) adds a multiSelect question's boxes (`MultiPick`), which both sheets render in place of the option
// rows when the pane carries `Dialog.multi`. Their state, the operator's set and the commit's call, lives in
// `DialogSheet` for the same reason.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { Dialog, DialogMulti, HookAskQuestion } from '../../../shared/api';
import { Button, EYEBROW, FOCUS_RING, OptionRow } from '@ccrc/ui';
import { reviewRows, type AskTab } from '../../../shared/ask-menu';
import { rowKey } from './askKeys';
import type { AskKeys } from './useAskKeys';
import {
  commitsToReview, paneTicks, reviewSummary, slotHolds, slotHoldsPart, wantedTicks, type FreeTextSlot,
} from './askLive';
import {
  MULTI_FREE_TEXT_TICKED, cursorOffOptions, cursorPlace, multiHeld, ownWordsCount, ownWordsHeld,
} from './askWords';
import './chat.css';

/** The sheet's title on the review screen an ask ends on (the pane's own heading, which a tall review scrolls off). */
export const REVIEW_TITLE = 'Review your answers';

/** A multiSelect question the sheet can name (its title) but not answer: one tap ticks a box and answers nothing.
 *  D-5091 answers it with boxes where the pane carries `Dialog.multi` (`MultiPick`); this stays for a pane that does
 *  not (the 2.1.222 shape, no commit row on screen, whose keys were never measured). Every multiSelect question is
 *  followed by another question or by the review (measured), and both come back here. */
export const SEVERAL_ANSWERS =
  'This one takes several answers, so pick them on the terminal pane. The next question, or the review, comes back here.';

/** What Cancel on the review does, said before the tap: it rejects the whole tool call and every answer with it
 *  (measured, `cc300-ask-review-cancelled`: "User declined to answer questions"). */
const CANCEL_DECLINES_ALL = 'Declines every question in this ask — nothing you answered is sent.';

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
 * Decision `ask-sheet-escape-never-interrupts`: Escape on an ask sheet HIDES it and does nothing else. Radix handles the
 * key in a document capture listener (its dismiss runs after this, and is not prevented), so stopping the event there
 * keeps it from the window, where the session header's desktop Escape binding would interrupt the turn. The header half
 * of the same rule is its own guard (D-5235), which ignores an Escape a sheet handled; either half alone holds it.
 */
export const escapeHidesOnly = (e: KeyboardEvent): void => e.stopPropagation();

/** A row's keyboard wiring (decision `ask-sheet-keyboard-model`): its element and roving tab stop when the sheet's keys
 *  are on, and the digit that answers it. */
export function keyed(
  keys: AskKeys | undefined, k: number,
): { ref?: (el: HTMLElement | null) => void; tabIndex?: number; keyShortcut?: string } {
  return keys === undefined ? {} : { ...keys.bind(rowKey(k)), keyShortcut: k <= 9 ? String(k) : undefined };
}

/** Is printed row `k` the highlighted one: the keyboard's highlight when the sheet's keys are on, else the pane's
 *  cursor (`selectedIndex`), or never when the sheet shows no cursor. */
export const lit = (keys: AskKeys | undefined, k: number, selectedIndex?: number): boolean =>
  keys !== undefined ? keys.hl === rowKey(k) : selectedIndex === k;

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
  keys,
}: {
  dialog: Dialog;
  /** The option index whose answer is in flight, as the sheet's own rows read it. */
  answering: number | null;
  /** Another send is in flight (an own-words call, D-5090), so no row may start one. */
  locked: boolean;
  onAnswer: (optionIndex: number) => void;
  /** The sheet's keyboard (`useAskKeys`), whose digits include this screen's `1` and `2`. */
  keys?: AskKeys;
}): ReactNode {
  const summary = reviewSummary(dialog);
  // Submit and Cancel by LABEL (`reviewRows`, decision `ask-review-lenient-arm`), and only those two: a review with
  // anything numbered painted after its rows still offers exactly the pane's own two, each under its printed digit.
  const rows = reviewRows(dialog);
  const shown = rows === null ? [] : dialog.options.filter((o) => o.index === rows.submit || o.index === rows.cancel);
  const disabled = locked || answering !== null;
  // Claude Code's own keys on this screen (decision `ask-review-digit-keys`, the operator's ruling "Match Claude Code"):
  // `1` submits every answer and `2` cancels AT ONCE, which declines the whole ask, exactly as in the terminal. The
  // Cancel row keeps saying so (`CANCEL_DECLINES_ALL`). They are the sheet's keyboard now (`useAskKeys`, decision
  // `ask-sheet-keyboard-model`), with ↑/↓ wrapping between the two rows and ← back to the last question.
  return (
    <>
      {summary.length > 0 && <p className="dlg-body">{summary.join('\n')}</p>}
      <div className="opts">
        {shown.map((o) => {
          const selected = lit(keys, o.index, dialog.selectedIndex);
          const waiting = answering === o.index;
          return (
            <OptionRow
              key={`${dialog.id}:${o.index}`}
              {...keyed(keys, o.index)}
              selected={selected}
              glyph={selected ? '❯' : ''}
              index={o.index}
              label={o.label}
              sublabel={o.index === rows?.cancel ? CANCEL_DECLINES_ALL : undefined}
              disabled={disabled}
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
  /** The question the call was made for (`questionKey` of the pane it was sent against): the call speaks for that
   *  question only. The scraped sheet reads its free-text row from the call only while the pane shows it, so a
   *  refused call that outlives its question never hides another question's option. */
  readonly question: string;
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

/** The free-text row the own-words FIELD types into, or null where the region offers no field (a line at most). A
 *  send under way keeps its own row; otherwise the pane's free-text row must be there, and either empty, or holding
 *  text with the operator's own text to keep in view (the stranded retry, part of it, or other text beside it).
 *  `OwnWords` renders by this, and the scraped sheet's foot line names own words only where it is not null. */
export function ownWordsRow(slot: FreeTextSlot, text: string, call: WordsCall | null): number | null {
  if (call !== null && wordsBusy(call)) return call.row;
  if (slot.kind === 'none') return null;
  return slot.kind === 'empty' || slotHolds(slot, text) || text.trim() !== '' ? slot.index : null;
}

/** The pane paints no free-text row under this question: the two-column preview layout. Its Chat row is the way to
 *  talk it over, then the composer. The row is named by the label the pane paints (`chat`), never spelled here: the
 *  rule that finds it has one home (`shared/ask-menu.ts`, `single-definition.test.ts`). */
const noWordsRow = (chat: string): string =>
  `This question has no own-words row on the terminal. Tap ${chat} to talk it over, then reply in the composer — or answer in the terminal.`;

/** The free-text row already holds text the operator did not send from here: typing would append to it. */
const ROW_HOLDS_OTHER = "The terminal's own-words row already holds other text — finish or clear it there.";

/** The free-text row holds the start of the kept text: an attempt typed part of it (or the capture caught tmux part
 *  way). The route will not type after it, so the row is the terminal's to clear; then Send types the whole text. */
const WORDS_PART =
  "The terminal's own-words row holds only part of your answer — clear it there, and Send types the whole of it.";

/** The free-text row holds exactly the kept text: a refused attempt typed it and never pressed Enter. */
const WORDS_STRANDED = 'Your answer is typed in the terminal but not sent yet — Send submits it.';

/** Why Send is held back for a trailing `;` (`ownWordsHeld`). */
const TRAILING_SEMICOLON = "A trailing ; doesn't survive the trip to the terminal — leave it off, or answer there.";

/** Why Send is held back for a control character (`ownWordsHeld`), which the field draws as a gap or not at all, so
 *  the operator may not see what is wrong: said the way the count says a text is over the limit. */
const CONTROL_CHARACTER =
  "A tab or another control character can't be typed into the terminal's own-words row — Send waits until it's gone. Or answer in the terminal.";

/** What `Chat about this` does, said on the row before the tap (measured: a rejection of the whole tool call). */
const CHAT_DECLINES = 'Declines this ask so you can talk it over in the chat.';

/**
 * Answer in your own words (D-5090), under the live question's options, where the pane paints its free-text row:
 *  - `empty`: the field and Send, which types the text into that row (`api.answerDialogText`, through `onSend`);
 *  - `held` with exactly the kept text: the stranded-text retry. The field keeps the text, read-only (the row holds
 *    that text and no other would be accepted), and Send submits what the terminal holds without typing it again;
 *  - `held` with other text: one line saying why Send waits, and the field with the operator's own text whenever
 *    there is any, never hidden behind the line: the start of it (an echo that failed part way) is the terminal's to
 *    clear, anything else to finish or clear there; once the row is empty again Send types the text;
 *  - `held` with other text and nothing typed here: the line alone;
 *  - `none`: one line pointing to `Chat about this`, when the pane has that row; nothing when it does not (a menu
 *    that is not an AskUserQuestion, whose own text rows are the next effort).
 * While a send is under way none of that is read: the field shows the text, disabled, and Send is busy, whatever the
 * pane paints meanwhile (the typed row under a new id is this send, not other text).
 *
 * The field paints `--fs-input` (16px), so focusing it never zooms iOS Safari, and it shares one row with Send at
 * every width (`.dlg-reply`: the field flexes, Send keeps its 44px and one width, busy or not). Everything here sits
 * in one `.dlg-words` block, spaced the same above and below, so the field's focus ring clears the rows on both
 * sides.
 */
export function OwnWords({
  slot,
  chat,
  words,
  locked,
  keys,
}: {
  slot: FreeTextSlot;
  /** The label of the pane's Chat row (`chatRow`), which the `none` line points to; null when the pane paints none. */
  chat: string | null;
  words: Words;
  /** An option's answer is in flight. */
  locked: boolean;
  /** The sheet's keyboard: the field is its `words` row (↑/↓ leave it; ←/→ stay its caret's). */
  keys?: AskKeys;
}): ReactNode {
  const { text, call, onText, onSend } = words;
  const countId = useId();
  const controlId = useId();
  const busy = wordsBusy(call);
  const row = ownWordsRow(slot, text, call);
  if (row === null) {
    if (slot.kind === 'held') return <OwnWordsLine>{ROW_HOLDS_OTHER}</OwnWordsLine>;
    return chat !== null ? <OwnWordsLine>{noWordsRow(chat)}</OwnWordsLine> : null;
  }
  // The row holds text the route would not type after: part of the operator's own, or someone else's.
  const taken = busy || slot.kind !== 'held' || slotHolds(slot, text)
    ? null
    : slotHoldsPart(slot, text) ? 'part' : 'other';
  const stranded = !busy && slot.kind === 'held' && taken === null;
  const held = ownWordsHeld(text);
  // Near the limit, how much of it the text uses; over it, why Send waits. Never a silent cut (`ownWordsHeld`).
  const count = ownWordsCount(text);
  // The lines that say why Send waits for what is in the field describe the field, so a screen reader hears them there.
  const describedBy = [count !== null ? countId : null, held === 'control' ? controlId : null]
    .filter((d) => d !== null).join(' ');
  return (
    <div className="dlg-words">
      <form
        className="dlg-reply"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !locked && held === null && taken === null) onSend(row);
        }}
      >
        <input
          ref={keys?.bind('words').ref}
          className="dlg-reply-input"
          type="text"
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder="…or answer in your own words"
          readOnly={stranded}
          disabled={busy || locked}
          aria-label="Answer in your own words"
          aria-describedby={describedBy || undefined}
        />
        <button
          type="submit"
          className="dlg-reply-send"
          disabled={busy || locked || held !== null || taken !== null}
          aria-busy={busy || undefined}
        >
          {/* Both faces share the button's one grid cell, so it is as wide as the wider face whichever shows, and
              Send never changes width while busy (`Send answering…` once grew it by 79px and squeezed the field mid
              word). The face not showing is aria-hidden, which chat.css also hides from sight. Busy is the chat's
              three working dots, narrower than the word Send, so Send is only as wide as its idle word: a busy face
              drawn as `Sending…` made Send 96px and clipped the field's placeholder at 360 and 375. A screen reader
              hears `Sending…`. */}
          <span aria-hidden={busy || undefined}>Send</span>
          <span className="dlg-reply-wait" aria-hidden={!busy || undefined}>
            {busy && (
              <>
                <i />
                <i />
                <i />
              </>
            )}
            <span className="sr-only">Sending…</span>
          </span>
        </button>
      </form>
      {count !== null && <p className="dlg-copy" id={countId}>{count}</p>}
      {held === 'control' && <p className="dlg-copy" id={controlId}>{CONTROL_CHARACTER}</p>}
      {stranded && <p className="dlg-copy">{WORDS_STRANDED}</p>}
      {taken === 'part' && <p className="dlg-copy">{WORDS_PART}</p>}
      {taken === 'other' && <p className="dlg-copy">{ROW_HOLDS_OTHER}</p>}
      {held === 'semicolon' && <p className="dlg-copy">{TRAILING_SEMICOLON}</p>}
    </div>
  );
}

/** The own-words region when it is one line and no field: the same `.dlg-words` block, so it is spaced the same above
 *  and below as the field is. */
function OwnWordsLine({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="dlg-words">
      <p className="dlg-copy">{children}</p>
    </div>
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
  keys,
}: {
  row: Dialog['options'][number];
  /** The pane's cursor row, when the sheet shows the cursor (the scraped sheet does, the envelope's does not). */
  selectedIndex?: number;
  answering: number | null;
  disabled: boolean;
  onAnswer: (optionIndex: number) => void;
  /** The sheet's keyboard: Chat's digit only highlights it, since it declines the whole ask. */
  keys?: AskKeys;
}): ReactNode {
  const waiting = answering === row.index;
  const selected = lit(keys, row.index, selectedIndex);
  return (
    <div className="opts">
      <OptionRow
        {...keyed(keys, row.index)}
        selected={selected}
        glyph={selectedIndex === undefined && keys === undefined ? undefined : selected ? '❯' : ''}
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

/**
 * A multiSelect commit's call (D-5091), as the sheet keeps it: keyed to the CALL, as an own-words send is, so neither a
 * repaint of the boxes the server is ticking nor an `ask_cleared` mid-call changes anything about it.
 *  - `flight`: the call is running;
 *  - `landed`: it answered ok, and the sheet waits for the pane to move on, as a tapped option does (`answer`).
 * A refusal ends the call, and the set it sent stays the operator's (`Picks.picked`), so trying again sends it again.
 */
export interface PickCall {
  /** The question the set was committed to: its dialog id, which names the question, never its ticks (D-5048). */
  readonly dialogId: string;
  /** The set sent, in the order sent. The boxes show it until the pane moves on. */
  readonly wanted: readonly number[];
  readonly state: 'flight' | 'landed';
}

/** The boxes' state and their commit, held by `DialogSheet` and handed to whichever sheet is showing. */
export interface Picks {
  /** The operator's set for the live question, in the order the boxes were ticked here; null while no box has been
   *  touched on the sheet, when the boxes follow the pane's ticks (ticks made in the terminal show). */
  readonly picked: readonly number[] | null;
  readonly call: PickCall | null;
  /** Tick or untick the box printed `index`. */
  readonly onToggle: (index: number) => void;
  /** Commit `wanted`, the WHOLE set to leave ticked (`api.answerDialogMulti`). */
  readonly onCommit: (wanted: readonly number[]) => void;
}

/** Is a multiSelect commit under way (running, or answered and waiting for the pane to move on)? While it is, no row may
 *  start another send and the sheet may not be dismissed. */
export const picksBusy = (call: PickCall | null): boolean => call !== null;

/** Free text inside a multiSelect question is not answered from the sheet in v1 (D-5048 refuses it). */
const MULTI_OWN_WORDS = 'Own words on a pick-several question go in the terminal.';

/**
 * A multiSelect question's boxes (D-5091), where the pane carries `Dialog.multi`: one checkbox row per box, then the
 * commit. A tap on a box changes only the sheet; the commit sends the WHOLE set at once (`api.answerDialogMulti`,
 * D-5048), which ticks and unticks on the pane only the boxes that differ, proves the ticks, and commits.
 *  - The boxes follow the pane's ticks until the operator touches one here (`Picks.picked`); from then the sheet's set
 *    stands until the question changes. While a commit is under way they show the set it sent.
 *  - The commit reads `Next`, or `Review answers` on the last question, where Tab lands on the review screen
 *    (`commitsToReview`). It is held back where the route would refuse (`multiHeld`): no box ticked, the free-text box
 *    ticked, or the cursor off the boxes; each of the last two says so in one line.
 *  - Free text inside such a question is the terminal's, said in one line where the pane paints the row.
 *
 * Rows are `@ccrc/ui`'s `OptionRow` with `checked` (role `checkbox`, 52px and up at every width); the commit is the
 * sheet's full-width primary `Button` in `.dlg-actions`, as every sheet's main action is.
 */
export function MultiPick({
  multi,
  dialogId,
  copy,
  picks,
  locked,
  keys,
}: {
  multi: DialogMulti;
  /** The live dialog's id: a call committed to another question shows nothing of its set here. */
  dialogId: string;
  /** The envelope's copy for the boxes, by position (`questionCorresponds` matched them one for one); the pane's own
   *  labels and descriptions otherwise. */
  copy?: HookAskQuestion['options'];
  picks: Picks;
  /** Another send is in flight (an option's answer, or own words). */
  locked: boolean;
  /** The sheet's keyboard: a digit toggles its box, ↑/↓ run the boxes then the commit. */
  keys?: AskKeys;
}): ReactNode {
  const { picked, call, onToggle, onCommit } = picks;
  const busy = picksBusy(call);
  const ticked = call !== null && call.dialogId === dialogId ? call.wanted : (picked ?? paneTicks(multi));
  const wanted = wantedTicks(multi, ticked);
  const held = busy ? null : multiHeld(multi, wanted);
  return (
    <>
      <div className="opts">
        {multi.options.map((o, k) => {
          const c = copy?.[k];
          return (
            <OptionRow
              key={`${dialogId}:${o.index}`}
              {...keyed(keys, o.index)}
              checked={ticked.includes(o.index)}
              index={o.index}
              label={c?.label ?? o.label}
              sublabel={c?.description || o.description}
              disabled={busy || locked}
              onClick={() => onToggle(o.index)}
            />
          );
        })}
      </div>
      {held === 'free-text' && <p className="dlg-copy">{MULTI_FREE_TEXT_TICKED}</p>}
      {held === 'cursor' && <p className="dlg-copy">{cursorOffOptions(cursorPlace(multi))}</p>}
      {multi.freeText !== null && <p className="dlg-copy">{MULTI_OWN_WORDS}</p>}
      <div className="dlg-actions">
        <Button
          {...(keys === undefined ? {} : keys.bind('commit'))}
          variant="primary"
          // A flex box drops the marker's leading space (`Nextanswering…`); the gap keeps the two apart.
          className="gap-2"
          disabled={busy || locked || held !== null}
          aria-busy={busy || undefined}
          onClick={() => onCommit(wanted)}
        >
          {commitsToReview(multi) ? 'Review answers' : 'Next'}
          {busy && <span className="opt-wait"> answering…</span>}
        </Button>
      </div>
    </>
  );
}

/** Why ←/→ and the tab strip wait on a multiSelect question: a tab move leaves the pane's ticks as they are, so boxes
 *  changed here and not committed would be lost. */
export const TABS_HELD = 'Commit your picks with Next first, or untick them, to move to another question.';

/**
 * The ask's tab strip (decision `ask-tab-strip`): one chip per question, its header and whether the pane marks it
 * answered (`☒`) or not yet (`☐`), then `✔ Submit`, read off the pane's own tab row (`parseAskTabs`). The chip of the
 * screen showing is marked current. A chip MOVES THE PANE there (`POST /dialog/tab`), the same move the arrow keys make,
 * and the sheet follows the screen the pane lands on: a sheet-local view of another question could not answer it, since
 * answers are positional on the live menu. Each chip is named `Go to …` for a screen reader: `✔ Submit` reaches the
 * review, where `Submit answers` submits, and must not be heard as a submit itself.
 *  - A question chip needs to know which tab is up (`active`), since only colour marks it on the pane; where the sheet
 *    cannot tell (the scraped sheet on an unnamed question), the question chips wait and `✔ Submit` still works.
 *  - Every chip waits while a send or a move is under way, and while picks are uncommitted (`TABS_HELD`).
 *  - It replaces nothing: the `n of N` kicker and the other-questions list stay.
 * At every width it is one row; a phone scrolls the chips sideways inside the strip, never the page, and each chip is
 * 44px tall. The same component in both skins, which colour it through their own tokens.
 */
export function AskTabs({
  tabs,
  active,
  onReview,
  held,
  busy,
  onGo,
}: {
  tabs: readonly AskTab[];
  /** The question showing (0-based), or null when the sheet cannot tell or the review is showing. */
  active: number | null;
  onReview: boolean;
  held: boolean;
  busy: boolean;
  onGo: (to: number | 'submit') => void;
}): ReactNode {
  // A phone scrolls the chips sideways; the chip of the screen showing is scrolled into the strip's view whenever it
  // changes, so question 4 of 4 is never the one chip out of sight. `nearest` on both axes: the strip only.
  const strip = useRef<HTMLDivElement | null>(null);
  const at = onReview ? 'submit' : active;
  useEffect(() => {
    const chip = strip.current?.querySelector<HTMLElement>('[aria-current="step"]');
    chip?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [at]);
  // One chip per question, then Submit, drawn by ONE block: the two kinds differ only in what they say and where they go.
  const chips = [
    ...tabs.map((t, i) => ({
      key: `q${i}`,
      mark: t.answered ? '☒' : '☐',
      label: t.header,
      name: `Go to ${t.header}, ${t.answered ? 'answered' : 'not answered yet'}`,
      current: !onReview && active === i,
      // A question chip needs the tab showing as `from`, which only the review or a known question gives.
      waits: !onReview && active === null,
      to: i + 1 as number | 'submit',
    })),
    {
      key: 'submit', mark: '✔', label: 'Submit', name: 'Go to Submit', current: onReview, waits: false,
      to: 'submit' as const,
    },
  ];
  return (
    <>
      <div ref={strip} className="ask-tabs" role="group" aria-label="Questions in this ask">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`ask-tab ${FOCUS_RING}`}
            aria-label={c.name}
            aria-current={c.current ? 'step' : undefined}
            disabled={busy || held || c.current || c.waits}
            onClick={() => onGo(c.to)}
          >
            <span aria-hidden="true">{c.mark}</span>
            <span>{c.label}</span>
          </button>
        ))}
      </div>
      {held && <p className="dlg-copy">{TABS_HELD}</p>}
    </>
  );
}

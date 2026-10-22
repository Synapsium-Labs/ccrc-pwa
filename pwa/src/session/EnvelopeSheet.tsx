// The ASK ENVELOPE's own sheet. The pure helpers that decide
// whether it may answer moved to `askLive.ts` (D-5089), which both sheets read.
//
// WHY IT IS ITS OWN FILE. `DialogSheet.tsx` was 843 lines carrying TWO
// renderings of one question — the pane SCRAPE and this ENVELOPE — and the
// file header there is about why both exist. This half is the envelope: the
// sheet and the preview disclosure only it opens.
// The controller keeps the polling, the dismissal slot and the senders; it
// imports the two things it still renders itself.
//
// D-6325: this is the ONE renderer of Claude's own question now. `askSource` hands it the questions from the hook's
// envelope (`from: 'hook'`) or, once that has aged out, the transcript's copy (`from: 'transcript'`), which carries an
// option's `preview` too; the scraped sheet that used to take over is gone (an unreadable ask says so, and offers the
// terminal). The review screen is rendered by `DialogSheet` for every source of copy, so it is not here, and `TerminalCta`'s
// callers are now this sheet's dead end and `DialogSheet`'s `ask-unreadable` and `terminal-only` surfaces.
//
// `TerminalCta` is written once, here, and `DialogSheet` imports it for its `ask-unreadable` and `terminal-only` surfaces:
// its own docstring is about exactly that, copy written twice drifts in a way no type catches.
//
// The classes stay `dlg-*`: chat.css grounds them and these are their only
// consumers. The shape moves, the ground stays.
import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import type { Dialog, DialogTabTarget } from '../../../shared/api';
import { parseAskTabs } from '../../../shared/ask-menu';
import { Button, OptionRow, Sheet, toast } from '@ccrc/ui';
import { api, ApiError, failedTo } from '../lib/api';
// C1's correspondence check lives in `askLive.ts` (D-5089), beside the rules that choose which question is live:
// `liveQuestion` applies it to EVERY question of the envelope, and the title only breaks a tie.
import { chatRow, freeTextSlot, liveQuestion, namedQuestion, optionCopy, tabChips, type AskQuestions } from './askLive';
import {
  AskHeader, AskTabs, ChatRow, FOOT_PLAIN, FOOT_WITH_OTHER, MultiPick, OptionPreview, OtherQuestions, OwnWords,
  SEVERAL_ANSWERS, escapeHidesOnly, keyed, lit, ownWordsRow, picksBusy, recommendedTag, wordsBusy, type Asker,
  type Picks, type Words,
} from './AskParts';
import { keyTabs, multiKeys, questionKeys, rowKey, type KeyScreen } from './askKeys';
import { useAskKeys } from './useAskKeys';
import './chat.css';

/** The way out of a question this app cannot render: open the terminal, or
 *  not now.
 *
 *  TWO CALL SITES, and the second is not a near-copy — it was the same eight
 *  lines, WORDS INCLUDED. That is the part worth naming: "Open terminal to
 *  answer" and "Not now" are copy, and copy written twice drifts in a way no
 *  type catches. The handlers stay the callers': the unparsed branch hides the
 *  sheet, the parsed one closes it behind a busy gate, and those are two
 *  different things on purpose (see `openTerminal` below). */
export function TerminalCta({ onOpen, onLater }: { onOpen: () => void; onLater: () => void }): ReactNode {
  return (
    <div className="dlg-actions">
      <Button variant="primary" onClick={onOpen}>
        Open terminal to answer
      </Button>
      <button type="button" className="dlg-later" onClick={onLater}>
        Not now
      </button>
    </div>
  );
}

/**
 * The hook-sourced envelope's own content — see the file header for why this
 * exists alongside the scraped rendering above instead of replacing it, and
 * for the fix-round-1 summary of what changed here.
 *
 * Dismissal: `open`/`onHide` are wired from the PARENT exactly like the
 * scraped sheet's own `open`/`hide` (same `dismissedKey` slot, see there) —
 * a scrim tap, Esc, or swipe only hides this sheet, refused while a send
 * here (`answering` OR `denying`) is in flight, and never touches the store:
 * the header badge and fleet card keep signalling regardless.
 *
 * Fail-visible: `onSelectOption` IS `answer()` from the scraped flow (passed
 * down verbatim, so a tap here walks the live pane exactly as a scraped
 * option tap does) — and that walk needs `dialog` (re-parses the PANE, which
 * the envelope has none of its own). Fix round 3 (Critical): needing `dialog`
 * turned out not to be enough — `dialog` can be non-null and still describe
 * a DIFFERENT question than the envelope (see the file header), so
 * `canAnswer` below is a real correspondence check (`questionCorresponds`
 * for questions, a Yes-first check for approval), not a bare null check. So
 * numbered options and Allow (the same call at index 1) are tappable only
 * when `dialog` is non-null, parsed, AND describes the same thing the
 * envelope does; otherwise they render visibly disabled behind the same
 * "Open terminal to answer"/"Not now" CTA the unparsed-scraped branch above
 * already uses. Deny has no scraped counterpart to reuse and no such
 * dependency either — Escape has no option index to walk to, so it calls
 * `api.interrupt` directly (the same call SessionScreen's stop button makes)
 * and stays enabled regardless of `dialog`.
 */
export function EnvelopeSheet({
  id,
  ask,
  from = 'hook',
  asker,
  dialog,
  answering,
  words,
  picks,
  open,
  onHide,
  onSelectOption,
  onOpenTerminal,
  tabbing = false,
  picksHeld = false,
  onTab,
}: {
  id: string;
  /** What `askSource` says to show: a permission request, or Claude's own questions (D-6325). */
  ask: { approval: { tool: string; summary: string } } | AskQuestions;
  /** Where the questions came from: the hook's envelope, or the transcript's copy once that has aged out. Only the
   *  wrapper's `data-source` says which; the surface is the same. */
  from?: 'hook' | 'transcript';
  /** Who is asking, for the header (D-6325). */
  asker?: Asker | null;
  /** The scraped dialog `answer()` needs to have anything to send against.
   *  null means the envelope showed up with no matching live pane menu yet
   *  (or it moved on) — read-only until one appears. */
  dialog: Dialog | null;
  /** The scraped flow's in-flight option index — shared so a numbered-option
   *  tap here disables the same way a scraped one does. */
  answering: number | null;
  /** D-5090: the own-words text and its call. Held by the PARENT, never here, so an `ask_cleared` mid-call hands the
   *  same text and call to the scraped sheet when this one unmounts. */
  words: Words;
  /** D-5091: a multiSelect question's set and its commit, held by the PARENT for the same reason as `words`. */
  picks: Picks;
  open: boolean;
  onHide: () => void;
  onSelectOption: (optionIndex: number) => void;
  onOpenTerminal?: () => void;
  /** Decision `ask-dialog-tab-route`: a tab move is under way (held by the parent, which sends it). */
  tabbing?: boolean;
  /** The boxes were changed here and not committed, so a tab move waits (`picksUncommitted`). */
  picksHeld?: boolean;
  /** Move the pane to another tab: `prev`/`next`, `submit`, or question tab k with `from` the tab showing (1-based). */
  onTab?: (to: DialogTabTarget, from?: number) => void;
}): ReactNode {
  // Deny's own busy flag: interrupt is not "answering an option" (there is no
  // optionIndex for Escape), so it can't reuse `answering` — but it disables
  // the same buttons `answering` would, and vice versa, so neither send can
  // race the other, and BOTH gate dismissal below (the open sheet is the only
  // honest record that a tap is still landing — same rule the scraped sheet's
  // `close` follows for `answering` alone).
  const [denying, setDenying] = useState(false);
  // D-5090: an own-words send is a send too, and refuses the others and the dismissal while it is under way. So is a
  // multiSelect commit (D-5091).
  const sendingWords = wordsBusy(words.call);
  const picking = picksBusy(picks.call);
  const busy = answering !== null || denying || sendingWords || picking || tabbing;
  // D-5089: WHICH question, before anything about it. The hook writes every question of an ask at once and keeps the
  // envelope until the tool call ends, while the pane paints one question at a time and then the review screen. So
  // the sheet answers the question the PANE is painting (`liveQuestion`: labels first, a unique correspondence winning
  // on its own, the title breaking only a tie), not `questions[0]`. The review is told first (`askSource`, D-6325:
  // `DialogSheet` renders it and this sheet never sees it), because a question whose labels happen to read like its
  // two rows must never be taken for it. `shown` is what the sheet displays: the live question, else the one the pane's
  // title names (a multiSelect question, which labels cannot reach), else question 1 — displayed read-only, never
  // answered.
  const questions = 'approval' in ask ? null : ask;
  const live = questions === null ? null : liveQuestion(questions, dialog);
  const named = questions === null ? null : namedQuestion(questions, dialog);
  const shown = live ?? named ?? 0;
  // A question the envelope carries NO OPTIONS for: `options: []`. Hoisted out
  // of `canAnswer` because two things read it and they must not drift — the
  // gate below, and the copy that explains an ungated sheet. It is a property
  // of the ENVELOPE and fixed for that envelope's whole life: no pane update,
  // no reparse, nothing the user can wait for will ever add options to it.
  //
  // What it is NOT is proof that the TUI is asking for prose. This used to be
  // named and commented as "free text — the TUI's own 'chat about this' shape
  // at the envelope level", and the pane disproves that: `Chat about this`
  // arrives as an OPTION LABEL in a populated list (`shared/ask-menu.ts`'s
  // `CHAT_ABOUT_ROW_RE`). `options: []` says only that this envelope lists nothing
  // to tap; the user-facing copy below therefore states that, and stops short
  // of telling the operator what the terminal wants from them. D-5089: of the
  // question SHOWN, which is the one the copy is about.
  const noOptions = questions !== null && questions.questions[shown]!.options.length === 0;
  // A multi-select question, by the envelope's own JSON, that the pane's title names. No single tap answers one:
  // `answerDialog` walks the cursor and presses Enter, and on Claude Code 2.1.280 and later Enter on a multi-select
  // row TICKS that box and submits nothing (measured on real captures). D-5091: where the pane carries `Dialog.multi`,
  // `liveQuestion` takes it as a candidate through its boxes, and the sheet answers it with boxes (`MultiPick`). A
  // pane without it (the 2.1.222 shape) is never a candidate, so the question can only be NAMED, and the copy then
  // says what it is rather than that it cannot be matched.
  // `=== true` because a hook payload that omitted the field must not read as multi-select either way.
  const severalAnswers = questions !== null && named !== null && live === null
    && questions.questions[named]!.multiSelect === true;
  // C1: a real correspondence check, not a null check — see fix round 3 in
  // the file header and `questionCorresponds` (`askLive.ts`). Approval and questions
  // use different rules because they answer differently: Allow always types
  // index 1, so the one thing that has to be true is that index 1 on the
  // pane reads like "Yes" (the file's longstanding assumption, now asserted
  // rather than trusted); a question can have any number of options, so
  // every one of them has to line up by position — which `liveQuestion` checks
  // for every question of the envelope (D-5089).
  // Task 7: a question the envelope gives no options for (`options: []`) has
  // nothing to correspond BY — `questionCorresponds`'s `every` over an empty
  // array is vacuously true, which would read as "answerable" the moment ANY
  // parsed dialog happened to be live. `liveQuestion` never offers one as a
  // candidate, so it is never live, and the only honest state is the same
  // fail-visible terminal CTA an unmatched dialog renders below.
  const canAnswer =
    'approval' in ask
      ? dialog !== null && dialog.parsed && /^yes/i.test(dialog.options[0]?.label ?? '')
      : live !== null;

  const close = (): void => {
    if (busy) return;
    onHide();
  };

  const deny = async (): Promise<void> => {
    if (busy) return;
    setDenying(true);
    try {
      await api.interrupt(id, 'deny');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // interrupt's `not-busy` can mean EITHER "the agent already finished
        // on its own" or "someone else already answered this same request" —
        // the response can't tell them apart, so the copy doesn't pretend to.
        toast("Couldn't stop — the session may be idle or the request already resolved");
      } else {
        toast(failedTo('decline', err), 'error');
      }
    } finally {
      setDenying(false);
    }
  };

  // The fail-visible CTA (I-critical #2): identical markup to the unparsed
  // scraped branch above, so a dialog-less envelope reads as "the same kind
  // of dead end", not a new one. Both buttons route through `close` (not a
  // raw `onHide`) — stricter than that branch needs to be (nothing there can
  // ever be `answering`), but Deny here CAN be in flight with `dialog` still
  // null, and hopping to the terminal mid-Deny would be a second action
  // landing on top of an unresolved first one.
  //
  // Fix round 2: `close()` alone only refuses to HIDE while busy — it does
  // not, and must not, stop `onOpenTerminal?.()` from firing right after it,
  // since `onClick={() => { close(); onOpenTerminal?.(); }}` runs the second
  // statement UNCONDITIONALLY regardless of what `close()` decided. That
  // let a busy Deny (dialog can be null while Deny is still in flight — see
  // above) navigate to the terminal anyway, exactly the "second action
  // landing on top of an unresolved first one" this comment already claimed
  // was prevented. `openTerminal` below gates the WHOLE handler on `busy`
  // itself, once, so both the hide and the navigation are refused together.
  const openTerminal = (): void => {
    if (busy) return;
    close();
    onOpenTerminal?.();
  };
  const terminalCta = !canAnswer && (
    <TerminalCta onOpen={openTerminal} onLater={close} />
  );

  // D-5090/D-5091: the live question's free-text row, Chat row and boxes, read only while it IS the live menu.
  const pane = questions !== null && live !== null && dialog !== null ? dialog : null;
  const shownOptions = questions === null ? 0 : questions.questions[shown]!.options.length;
  const slot = pane !== null ? freeTextSlot(pane, shownOptions) : { kind: 'none' as const };
  const chat = pane !== null ? chatRow(pane) : undefined;
  const boxes = pane?.multi;
  // `n of N` only for a question the pane is painting (live) or names (its title): the fallback to question 1 is a
  // display, not a position, and a pane on another ask entirely would make "1 of N" a guess (D-5089).
  const placed = live ?? named;
  // Decisions `ask-sheet-keyboard-model` and `ask-tab-strip`: the pane's tab row, where the sheet is on it (the
  // question it is showing by the pane), and the keys over the screen showing. Worked out before any branch returns,
  // since the hook runs on every render. Nothing is keyed while the sheet cannot answer what it shows.
  const tabRow = questions !== null && dialog !== null ? parseAskTabs(dialog.raw) : null;
  const tabs = keyTabs(tabRow?.tabs.length ?? null, placed, false, picksHeld);
  const keyScreen: KeyScreen | null = pane === null ? null
    : boxes !== undefined ? multiKeys(boxes.options.map((o) => o.index), tabs)
      : questionKeys(
        Array.from({ length: shownOptions }, (_, k) => k + 1),
        ownWordsRow(slot, words.text, words.call),
        chat?.index ?? null,
        tabs,
      );
  const cursor = dialog === null ? null : dialog.multi !== undefined ? dialog.multi.cursor : dialog.selectedIndex;
  const keys = useAskKeys({
    screenId: dialog === null ? null : `${dialog.id}:${shown}`,
    screen: keyScreen,
    start: typeof cursor === 'number' ? rowKey(cursor) : cursor === 'commit' ? 'commit' : null,
    open,
    onAnswer: onSelectOption,
    onToggle: picks.onToggle,
    onTab: (to) => onTab?.(to),
    // The free-text row's digit chooses `Other` (D-6325, R5): the field opens under it.
    onWords: () => words.onOpen(questions === null ? '' : questions.questions[shown]!.question),
  });
  // D-6325, R3: the chips carry Claude's own headers, the pane's tab row only the count and the marks; no strip unless
  // the pane paints one tab per question (a transcript copy of one question therefore draws one only on a one-tab row).
  const chips = questions === null ? null : tabChips(questions.questions, tabRow?.tabs ?? null);
  const strip = chips !== null && onTab !== undefined && (
    <AskTabs
      tabs={chips}
      active={placed}
      onReview={false}
      held={picksHeld}
      busy={busy}
      onGo={(to) => onTab(to, placed === null ? undefined : placed + 1)}
    />
  );

  if ('approval' in ask) {
    const { tool, summary } = ask.approval;
    const allowing = answering === 1;
    return (
      <Sheet
        open={open}
        onClose={close}
        onEscapeKeyDown={escapeHidesOnly}
        eyebrow={<AskHeader asker={asker} />}
        title={tool}
        titleScroll={false}
      >
        <div data-source="hook" className="ask-envelope">
          <p className="dlg-copy">{summary}</p>
          {!canAnswer && (
            <p className="dlg-copy">
              This can't be matched to what's on the terminal yet — Allow can't be sent until it does.
            </p>
          )}
          <div className="dlg-actions">
            <Button
              variant="primary"
              // A flex box drops the marker's leading space (`Allowanswering…`); the gap keeps the two apart.
              className="gap-2"
              disabled={!canAnswer || busy}
              aria-busy={allowing || undefined}
              onClick={() => onSelectOption(1)}
            >
              Allow
              {allowing && <span className="opt-wait"> answering…</span>}
            </Button>
            <button
              type="button"
              className="dlg-later"
              disabled={busy}
              aria-busy={denying || undefined}
              onClick={() => void deny()}
            >
              Deny
              {denying && <span className="opt-wait"> answering…</span>}
            </button>
          </div>
          {terminalCta}
        </div>
      </Sheet>
    );
  }

  // The question the pane is painting is the tappable one (I3, as D-5089 left it). The digit space `answerDialog`
  // walks is one live menu's worth of options at a time, so a question is wired only while it IS the live menu:
  // envelope option k is pane row k + 1, head-anchored, because `questionCorresponds` matched them by position. The
  // others are listed read-only (`OtherQuestions`), shown, never silently dropped, and never wired to a send this
  // sheet has no way to route safely; each becomes tappable when the pane paints it.
  const q = ask.questions[shown]!; // `askSource` proves question 1 exists (a usable envelope, or an aligned copy)
  const count = ask.questions.length;
  // D-5090: the live question's free-text row, at n + 1 under its n options, and the pane's `Chat about this` row (`slot`
  // and `chat`, above), read only while the question IS the live menu: an unmatched one is answered in the terminal
  // (the CTA above says so). D-5091: its boxes (`boxes`) take the option rows' place when it is a multiSelect question
  // the pane carries as `Dialog.multi`; such a question has no own-words region here (its free text is the terminal's
  // in v1) and no Chat row (`Dialog.multi` carries none).
  const eyebrow = (
    <AskHeader
      header={q.header}
      progress={count > 1 && placed !== null ? { n: placed + 1, of: count } : undefined}
      asker={asker}
    />
  );

  return (
    <Sheet
      open={open}
      onClose={close}
      onEscapeKeyDown={escapeHidesOnly}
      eyebrow={eyebrow}
      title={q.question}
      titleScroll={false}
    >
      <div data-source={from} className="ask-envelope" ref={keys.root}>
        {strip}
        {/* Three different dead ends, and the copy must not confuse them. An
            unmatched question is TRANSIENT — the pane can catch up, and then
            the rows below become tappable — so "wait" is honest advice. An
            option-less envelope is not: `options: []` is fixed for the life
            of the envelope, there are no rows to become tappable, and nothing
            the user waits for can change that. Telling them to wait would be
            a claim the state cannot support (and an unbounded wait). A
            multiSelect question the pane's title names is neither: the sheet
            knows exactly which question is up, and that one tap cannot answer
            it (D-5089, until D-5091's boxes).

            What the option-less sentence must NOT do is guess what the
            terminal wants instead. It used to say "this one wants an answer
            in your own words" — an inference from `options: []` that the pane
            itself disproves (the TUI's free-text escape hatch arrives as an
            option LABEL, in a populated list), and one that would send the
            operator to type prose at a menu. It now says only what is known:
            this envelope lists nothing to tap, and the pane is where the
            answer goes. */}
        {!canAnswer && (
          <p className="dlg-copy">
            {noOptions
              ? 'This question has no options to choose from. Answer it in the terminal.'
              : severalAnswers
                ? SEVERAL_ANSWERS
                : "This can't be matched to what's on the terminal yet — answer it there, or wait for it to catch up."}
          </p>
        )}
        {/* A multiSelect question is never answered by one tap: answerDialog
            walks to ONE option index and presses Enter, and Enter on a
            multi-select row ticks it. D-5091 answers it with boxes where the
            pane carries `Dialog.multi`: the WHOLE set at once, through the
            digits `/dialog/multi` sends (`MultiPick`). Otherwise it renders the
            same plain rows as a single-select one, never tappable, and two
            gates keep it that way, either alone enough: `questionCorresponds`
            takes a multiSelect question only through `Dialog.multi` (the
            envelope's own flag against the pane's), and `parseDialog` answers
            { parsed: false } for a multi-select, by its footer on older builds
            and by the checkboxes on its rows on 2.1.280, and an unparsed
            dialog without `multi` never corresponds. */}
        {pane !== null && boxes !== undefined ? (
          <MultiPick
            multi={boxes}
            dialogId={pane.id}
            copy={q.options}
            picks={picks}
            locked={answering !== null || sendingWords || tabbing}
            keys={keys}
          />
        ) : (
          <>
            <div className="opts">
              {q.options.map((o, oi) => {
                const idx = oi + 1;
                const waiting = answering === idx;
                // The keyboard's highlight wears the cursor, as on the pane (decision `ask-sheet-keyboard-model`); a
                // question the sheet cannot answer shows none.
                const selected = keyScreen !== null && lit(keys, idx);
                // `(Recommended)` leaves the label for a tag after it (D-6325); the answer still goes by the printed index.
                const { label, recommended } = optionCopy(o.label);
                return (
                  // The preview is keyed by its question's text, so a new question opens its own previews instead of
                  // inheriting the last one's folded state (the scraped rows keyed it by the pane's dialog id).
                  <Fragment key={`${shown}:${oi}`}>
                    <OptionRow
                      {...(keyScreen === null ? {} : keyed(keys, idx))}
                      selected={selected}
                      glyph={keyScreen === null ? undefined : selected ? '❯' : ''}
                      enter={!waiting && selected ? '↵' : undefined}
                      index={idx}
                      label={label}
                      tag={recommendedTag(recommended)}
                      sublabel={o.description}
                      disabled={!canAnswer || answering !== null || sendingWords || picking || tabbing}
                      busy={waiting}
                      onClick={() => onSelectOption(idx)}
                      marker={waiting ? <span className="opt-wait">answering…</span> : undefined}
                    />
                    {/* A transcript option's worked example, folded under its row and open on the highlighted one. */}
                    {o.preview && <OptionPreview key={q.question} text={o.preview} defaultOpen={selected} />}
                  </Fragment>
                );
              })}
              {/* `Other`, through the pane's free-text row (D-5090, D-6325): the last row of the list, the field and Send
                  under it once chosen. A send under way stays on screen even if the pane stops matching mid-call. */}
              {(pane !== null || sendingWords) && (
                <OwnWords
                  slot={slot}
                  chat={chat !== undefined}
                  words={words}
                  question={q.question}
                  locked={answering !== null || picking || tabbing}
                  keys={keyScreen === null ? undefined : keys}
                />
              )}
            </div>
            {chat && (
              <ChatRow
                row={chat}
                answering={answering}
                disabled={busy}
                onAnswer={onSelectOption}
                keys={keyScreen === null ? undefined : keys}
              />
            )}
          </>
        )}
        {terminalCta}
        <OtherQuestions questions={ask.questions} shown={shown} />
        {/* The foot line says what a tap does, and names Other only where the row is offered (a pick-several question
            says in its own line how to add an answer). Nothing is said under a question the sheet cannot answer. */}
        {canAnswer && (
          <p className="sheet-foot">
            {boxes === undefined && ownWordsRow(slot, words.text, words.call) !== null ? FOOT_WITH_OTHER : FOOT_PLAIN}
          </p>
        )}
      </div>
    </Sheet>
  );
}

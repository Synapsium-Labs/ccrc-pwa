// The hook-sourced ASK ENVELOPE's own sheet, and the two pure helpers that
// decide whether it may answer.
//
// WHY IT IS ITS OWN FILE. `DialogSheet.tsx` was 843 lines carrying TWO
// renderings of one question — the pane SCRAPE and this ENVELOPE — and the
// file header there is about why both exist. This half is the envelope: the
// sheet, its correspondence check, and the preview disclosure only it opens.
// The controller keeps the polling, the dismissal slot and the scraped
// rendering; it imports the two things it still renders itself.
//
// `TerminalCta` travels here because BOTH halves render it (the controller's
// unparsed-scrape branch and this sheet's ungated one) and its own docstring
// is about exactly that: copy written twice drifts in a way no type catches.
// It is exported for the one caller left behind.
//
// The classes stay `dlg-*`: chat.css grounds them and these are their only
// consumers. The shape moves, the ground stays.
import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import type { Dialog, HookAsk, HookAskQuestion } from '../../../shared/api';
import { Button, OptionRow, Sheet, toast } from '@ccrc/ui';
import { api, ApiError, apiErrorText } from '../lib/api';
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
 *  menu it looks like. */
function questionCorresponds(q: HookAskQuestion, dialog: Dialog | null): boolean {
  if (dialog === null || !dialog.parsed) return false;
  if (dialog.options.length < q.options.length) return false;
  return q.options.every((o, i) => prefixMatches(dialog.options[i]!.label, o.label));
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
  dialog,
  answering,
  open,
  onHide,
  onSelectOption,
  onOpenTerminal,
}: {
  id: string;
  ask: HookAsk;
  /** The scraped dialog `answer()` needs to have anything to send against.
   *  null means the envelope showed up with no matching live pane menu yet
   *  (or it moved on) — read-only until one appears. */
  dialog: Dialog | null;
  /** The scraped flow's in-flight option index — shared so a numbered-option
   *  tap here disables the same way a scraped one does. */
  answering: number | null;
  open: boolean;
  onHide: () => void;
  onSelectOption: (optionIndex: number) => void;
  onOpenTerminal?: () => void;
}): ReactNode {
  // Deny's own busy flag: interrupt is not "answering an option" (there is no
  // optionIndex for Escape), so it can't reuse `answering` — but it disables
  // the same buttons `answering` would, and vice versa, so neither send can
  // race the other, and BOTH gate dismissal below (the open sheet is the only
  // honest record that a tap is still landing — same rule the scraped sheet's
  // `close` follows for `answering` alone).
  const [denying, setDenying] = useState(false);
  const busy = answering !== null || denying;
  // A question the envelope carries NO OPTIONS for: `options: []`. Hoisted out
  // of `canAnswer` because two things read it and they must not drift — the
  // gate below, and the copy that explains an ungated sheet. It is a property
  // of the ENVELOPE and fixed for that envelope's whole life: no pane update,
  // no reparse, nothing the user can wait for will ever add options to it.
  //
  // What it is NOT is proof that the TUI is asking for prose. This used to be
  // named and commented as "free text — the TUI's own 'chat about this' shape
  // at the envelope level", and this same file disproves that: `CHAT_ABOUT_RE`
  // exists precisely because "chat about this" arrives as an OPTION LABEL in a
  // populated list. `options: []` says only that this envelope lists nothing
  // to tap; the user-facing copy below therefore states that, and stops short
  // of telling the operator what the terminal wants from them.
  const noOptions = !('approval' in ask) && ask.questions[0]!.options.length === 0;
  // A multi-select question, by the envelope's own JSON. No single tap answers
  // one: `answerDialog` walks the cursor and presses Enter, and on Claude Code
  // 2.1.280 Enter on a multi-select row TICKS that box and submits nothing
  // (measured on real captures); older builds submitted whatever was already
  // ticked. This used to rest on the pane parse alone — "a multi-select pane
  // ALWAYS comes back { parsed: false }" — and 2.1.280 broke that by dropping
  // the footer the parse keyed on. The envelope says it directly, so the gate
  // no longer depends on how the pane reads. `=== true` because a hook
  // payload that omitted the field must not read as multi-select either way.
  const multiSelect = !('approval' in ask) && ask.questions[0]!.multiSelect === true;
  // C1: a real correspondence check, not a null check — see fix round 3 in
  // the file header and `questionCorresponds` above. Approval and questions
  // use different rules because they answer differently: Allow always types
  // index 1, so the one thing that has to be true is that index 1 on the
  // pane reads like "Yes" (the file's longstanding assumption, now asserted
  // rather than trusted); a question can have any number of options, so
  // every one of them has to line up by position.
  // Task 7: a question the envelope gives no options for (`options: []`) has
  // nothing to correspond BY —
  // `questionCorresponds`'s `every` over an empty array is vacuously true,
  // which would read as "answerable" the moment ANY parsed dialog happened
  // to be live, even one describing a wholly different question. There is
  // nothing to tap either way (`first.options.map` below renders zero rows
  // for it — no text input is added here; see the file header on why typing
  // blind into a live menu is refused everywhere else too), so the only
  // honest state is the same fail-visible terminal CTA an unmatched dialog
  // already renders below. This guards the CALL SITE, not
  // `questionCorresponds` itself — that function's own contract (every
  // OPTION lines up by position) is unchanged.
  const canAnswer =
    'approval' in ask
      ? dialog !== null && dialog.parsed && /^yes/i.test(dialog.options[0]?.label ?? '')
      : !noOptions && !multiSelect && questionCorresponds(ask.questions[0]!, dialog);

  const close = (): void => {
    if (busy) return;
    onHide();
  };

  const deny = async (): Promise<void> => {
    if (busy) return;
    setDenying(true);
    try {
      await api.interrupt(id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // interrupt's `not-busy` can mean EITHER "the agent already finished
        // on its own" or "someone else already answered this same request" —
        // the response can't tell them apart, so the copy doesn't pretend to.
        toast("Couldn't stop — the session may be idle or the request already resolved");
      } else {
        toast(`Couldn't decline — ${apiErrorText(err)}`, 'error');
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

  if ('approval' in ask) {
    const { tool, summary } = ask.approval;
    const allowing = answering === 1;
    return (
      <Sheet open={open} onClose={close} eyebrow="claude is asking" title={tool}>
        <div data-source="hook" className="ask-envelope">
          <p className="dlg-copy">{summary}</p>
          {!canAnswer && (
            <p className="dlg-copy">
              This can't be matched to what's on the terminal pane yet — Allow can't be sent
              until it does.
            </p>
          )}
          <div className="dlg-actions">
            <Button
              variant="primary"
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

  // I3: only the FIRST question is tappable. The digit space `answerDialog`
  // walks is one live menu's worth of options at a time (it re-parses the
  // pane, which shows one question at a time) — a global digit across
  // MULTIPLE questions would answer the wrong one, since tapping question 2's
  // first option would still send digit 1, which IS question 1's own first
  // option. Further questions in the envelope (AskUserQuestion can ask more
  // than one at once) render below, read-only — shown, never silently
  // dropped, just not wired to a send this sheet has no way to route safely.
  const first = ask.questions[0]!; // isUsableAsk (the caller's guard) proves this
  const rest = ask.questions.slice(1);
  const eyebrow = first.header ? (
    <>
      claude is asking <span className="dlg-header-chip">{first.header}</span>
    </>
  ) : (
    'claude is asking'
  );

  return (
    <Sheet open={open} onClose={close} eyebrow={eyebrow} title={first.question}>
      <div data-source="hook" className="ask-envelope">
        {/* Two different dead ends, and the copy must not confuse them. An
            unmatched question is TRANSIENT — the pane can catch up, and then
            the rows below become tappable — so "wait" is honest advice. An
            option-less envelope is not: `options: []` is fixed for the life
            of the envelope, there are no rows to become tappable, and nothing
            the user waits for can change that. Telling them to wait would be
            a claim the state cannot support (and an unbounded wait).

            What the option-less sentence must NOT do is guess what the
            terminal wants instead. It used to say "this one wants an answer
            in your own words" — an inference from `options: []` that this
            file itself disproves (`CHAT_ABOUT_RE`: the TUI's free-text
            escape hatch arrives as an option LABEL, in a populated list), and
            one that would send the operator to type prose at a menu. It now
            says only what is known: this envelope lists nothing to tap, and
            the pane is where the answer goes. */}
        {!canAnswer && (
          <p className="dlg-copy">
            {noOptions
              ? 'This envelope carries no options, so there is nothing to tap here — answer it on the terminal pane.'
              : multiSelect
                ? 'This question takes more than one answer, and a tap here can only send one — pick them on the terminal pane.'
                : "This can't be matched to what's on the terminal pane yet — answer it there, or wait for it to catch up."}
          </p>
        )}
        {/* v1: a multiSelect question renders the same plain rows as a
            single-select one, and they are never tappable: answerDialog walks
            to ONE option index and presses Enter, and there is no wire
            capacity to submit more than one. Two gates keep it that way, and
            either alone does: `multiSelect` in `canAnswer` (the envelope's
            own flag), and the pane parse — `parseDialog` answers
            { parsed: false } for a multi-select, by its footer on older
            builds and by the checkboxes on its rows on 2.1.280, and an
            unparsed dialog never corresponds. The second was the ONLY gate
            until 2.1.280 dropped the footer it keyed on. */}
        <div className="opts">
          {first.options.map((o, oi) => {
            const idx = oi + 1;
            const waiting = answering === idx;
            return (
              <OptionRow
                key={oi}
                index={idx}
                label={o.label}
                sublabel={o.description}
                disabled={!canAnswer || answering !== null}
                busy={waiting}
                onClick={() => onSelectOption(idx)}
                marker={waiting ? <span className="opt-wait">answering…</span> : undefined}
              />
            );
          })}
        </div>
        {terminalCta}
        {rest.length > 0 && (
          // Read-only: see the comment above `first` for why only the first
          // question ever sends. Plain divs, not buttons — nothing here
          // should read as tappable to a screen reader either. I3: a muted
          // colour alone (`.opt[aria-disabled='true']`, in @ccrc/ui's
          // option-row.css since the row was extracted) was easy
          // to miss at a glance — the heading below and `.ask-envelope-more`'s
          // separator rule say in words what the colour only implies.
          <div className="ask-envelope-more">
            <p className="ask-envelope-more-heading">answer these in the terminal</p>
            {rest.map((q, qi) => (
              <Fragment key={qi}>
                {q.header && <p className="dlg-header-chip">{q.header}</p>}
                <p className="dlg-copy">{q.question}</p>
                <div className="opts">
                  {q.options.map((o, oi) => (
                    // No onClick, so OptionRow renders a plain <div
                    // aria-disabled> rather than a button — the same shape
                    // this site hand-wrote, now chosen in one place.
                    <OptionRow
                      key={oi}
                      index={oi + 1}
                      label={o.label}
                      sublabel={o.description}
                      disabled
                    />
                  ))}
                </div>
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

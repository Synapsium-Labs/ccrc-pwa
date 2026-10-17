import type { Tmux } from '../exec.js';
import { autoContinueArmed, editHintShown, freeTextRow, hasMenu, parseDialog, turnRunning } from '../pane/dialog.js';
import type { KeyedQueue } from './queue.js';
import {
  composePrompt, isDialogMultiIndexes, isDialogTab, isDialogText, MAIL_ENVELOPE_FENCE,
  type Dialog, type DialogAnswered, type DialogMultiRefuseCode, type DialogRefuseCode, type DialogTabMoved,
  type DialogTabRefuseCode, type DialogTextRefuseCode,
} from '../../../shared/api.js';
import { CHAT_ABOUT_ROW_RE, FREE_TEXT_PLACEHOLDER_RE, parseAskTabs, reviewRows } from '../../../shared/ask-menu.js';

export interface SendDeps {
  tmux: Tmux;
  queue: KeyedQueue;
  sleep?: (ms: number) => Promise<void>;
  /** Clock behind the clear's wall-clock budget; injectable so a test can prove
   *  the budget bounds the loop without spending the budget. */
  now?: () => number;
}

export type SendResult =
  | { ok: true }
  | { ok: false;
      error: 'not-alive' | 'dialog-open' | 'draft-present' | 'draft-clear-failed' | 'verify-failed' | 'enter-ignored'
        // THE CAPTURE HOLDS NO INPUT BOX AT ALL, which is not the same fact as
        // any other token here and needs its own name. Measured on a live fleet
        // pane 2026-09-18: a draft ~326 visual rows tall in a 50-row pane
        // scrolls its OWN marker row out of `capture-pane`'s window, so every
        // reader in this file — `draftOf` and `continuationRows` alike, both
        // anchored on the same last-`❯` scan — answers "empty box" for a box
        // holding 2.8 KB of the operator's text. It is not `draft-present` (we
        // cannot read the draft), not `verify-failed` (on the guard arm nothing
        // was typed), and emphatically not success.
        //
        // WHY IT MATTERS THAT IT REFUSES BEFORE TYPING: without this the state
        // is ABSORBING. The guard fell open, the type loop appended onto the
        // unreadable box, the echo could never match, and the arm left the text
        // in place by ruling — so every retry made the box TALLER and the marker
        // row further out of reach. Measured: five copies of one sentence
        // concatenated with no separator, and no send could ever land again.
        | 'box-unreadable'
        // D-2368. The pane's own status line says Claude Code will continue on
        // its own; nothing was pressed. Only reachable when the caller opted
        // in via `holdIfAutoContinueArmed` — see that option's own docstring.
        | 'auto-continue-armed'
        // Worker stall watch §4.1. The pane's last 8 rows show a turn running
        // ("esc to interrupt"), and nothing was pressed. This is reachable only
        // when the caller opted in via `refuseIfTurnRunning`; see that option's
        // own docstring.
        | 'turn-running'
        // D-5046. tmux refused one line's literal send, so the loop stopped
        // there and pressed no Enter. Not `not-alive`: the session may be
        // alive, with the lines typed before it still in its box. Before this
        // the refusal was ignored and the message submitted without the line.
        | 'type-failed';
      draft?: string;
      pane?: string;
      /**
       * The server WATCHED `draft` echo into the box as this call's own text and
       * then failed to make it leave. So: `draft` is our whole message, the box
       * still holds it, and one more Enter would send exactly it. ADDITIVE and
       * absence-permits: an older server never sends it, so a client that gates
       * on `=== true` degrades to no rescue — today's behaviour, the safe
       * direction.
       *
       * IT IS NOT A SYNONYM FOR A `code`. `draft` carries four different
       * meanings across the failure arms and only two of them support the claim
       * above:
       *  - OUR OWN ECHOED TEXT — `enter-ignored`. The echo loop proved the box
       *    holds it; both Enters were swallowed. Earns the flag, unless the
       *    marker row is blank, which a row-capped box can show
       *    (D-5088): a rescue cannot name a blank row.
       *  - OUR OWN MESSAGE, COLLAPSED INTO A PASTE CHIP — the ordinary
       *    `verify-failed`. Earns the flag; see that arm for the provenance
       *    argument, and `PASTE_CHIP` for what the widget is doing.
       *  - THE OTHER TEXT — `draft-present`, and the ordinary `verify-failed`
       *    when the row is not a chip, which reports whatever the box last read.
       *  - A FAILED CLEAR'S RESIDUE, a fragment of the message — the attachment
       *    path's `verify-failed`. `submitEnter`'s correspondence gate cannot
       *    tell this from the first: the residue IS what the box reads, so it
       *    matches, Enter is pressed, and a truncated prompt is submitted. This
       *    flag is the discriminator, and the attachment path still never sets
       *    it.
       *
       * WHAT THE ORDINARY `verify-failed` ARM WITHHOLDS IT FOR, and the
       * correction that opened the arm up. That arm is reached when
       * `draftOf(pane).startsWith(needle)` was false on every poll. This
       * comment used to enumerate three shapes that reach it — an EMPTY box
       * (nothing to send; `submitEnter` answers `nothing-to-submit`), SOMEBODY
       * ELSE'S words (a rescue would submit a human's half-typed sentence), and
       * a PARTIAL RENDER of our own message, a fragment — and concluded that
       * "the one case that would deserve the flag, the box holding our whole
       * message, is unreachable here by construction: it would have set
       * `echoed`".
       *
       * THAT CONCLUSION WAS FALSE, and measured false against a live box
       * (2026-09-15): a long single-paragraph operator message was collapsed by
       * the widget into `❯ [Pasted text #1]`, which starts with no needle, so
       * the arm refused with the text sitting complete in the box and the PWA
       * offering no button at all. A FOURTH shape reaches it, and it is exactly
       * the deserving one. The first three still withhold the flag.
       *
       * AND THE FOURTH NO LONGER WAITS FOR THE TAP when the server can prove the
       * chip is its own (D-5087, `ownPasteChip`): it presses
       * the Enter itself, so that send answers `ok` or, Enter swallowed twice,
       * `enter-ignored` with this flag. Only a chip-led row that fails one of
       * `ownPasteChip`'s guards still reaches `verify-failed` with the flag.
       */
      submittable?: boolean };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const PANE_TAIL = 2000;

/** How long to wait for the input box to empty after Enter, and how often to
 *  look. A busy session accepts the turn just as fast as an idle one — it
 *  queues the message — so this is bounded by render time, not by Claude. */
const SUBMIT_POLL_MS = 120;
const SUBMIT_TRIES = 8;

/** How long to wait for the input box to echo the typed text (~2.4 s total).
 *  A busy pane re-renders lazily; the old single 200 ms check called that a
 *  failed send. */
const ECHO_POLL_MS = 200;
const ECHO_TRIES = 12;
/** Prefix matched against the pane. Short enough to sit on the box's first
 *  visual line, so a wrapped message can't split it across a line break. */
const ECHO_NEEDLE = 24;

const SGR = /\x1b\[[0-9;]*m/g;                 // any ANSI colour/attr code
// A dim `\e[2m…\e[0m` run = ghost/placeholder text. Real captures interleave
// OTHER SGR codes inside the run (e.g. Claude Code's queue hint renders as
// `\e[2m\e[39mPress up to edit queued messages\e[0m` — a colour reset sits
// right after the dim-on code), so `[^\x1b]*` alone can't span it: the match
// fails, the hint is never stripped, and draftOf reads it as a real draft —
// blocking the NEXT send with draft-present for a message that never landed.
// Allow interleaved `\e[...m` codes inside the span, non-greedily so it can't
// swallow past the nearest reset into real trailing content.
//
// The terminator itself must accept ANY reset-family code, not just the bare
// `\e[0m`: tmux 3.4 normalises a dim-off (`\e[22m`) immediately followed by
// another attribute turning on into a COMBINED code like `\e[0;1m` — verified
// live (`\e[2mghost\e[22m\e[1mBOLD REAL\e[0m` typed into a real tmux pane
// captures back as `\e[2mghost\e[0;1mBOLD REAL\e[0m`). A terminator anchored
// on the literal `\e[0m` alone doesn't match `\e[0;1m`, but the OLD
// interleaved alternative (`\x1b\[[0-9;]*m`, unconditionally) DID — so the
// non-greedy scan swallowed `\e[0;1m` as "just another interleaved code" and
// kept consuming real text ("BOLD REAL") looking for the next bare `\e[0m`,
// destroying it. The interleaved alternative below excludes any code that
// starts with `0` (a reset, bare or combined) via a negative lookahead, so a
// reset — combined or not — always ends the span instead of being absorbed
// by it, and the terminator itself accepts the combined form.
const DIM_SPAN = /\x1b\[2m(?:\x1b\[(?!0[;m])[0-9;]*m|[^\x1b])*?\x1b\[0[0-9;]*m/g;

/**
 * Text the user actually typed into the live input box, trimmed; '' when empty.
 * Input is an ANSI-preserving capture (`captureAnsi`). Three real-pane
 * subtleties, all learned from live captures:
 *  - Past user turns render with a `❯ ` prefix in the scrollback ABOVE the input
 *    box, so the box is the LAST `❯` line, never the first.
 *  - The EMPTY input box marker is `❯` + U+00A0 NON-BREAKING SPACE, not a plain
 *    space — so match the `❯` alone and let trim() (which strips U+00A0) do the rest.
 *  - Claude Code shows a DIM ghost-suggestion (e.g. "continue") in the empty box,
 *    wrapped in `\e[2m…\e[0m`. It is NOT a real draft (backspace/^U can't clear it,
 *    typing replaces it), so strip dim spans before reading the box — otherwise
 *    every send into a session showing a suggestion fails draft-clear-failed.
 */
export type BoxRead =
  | { box: 'present'; draft: string }
  | { box: 'absent' };

/**
 * The measured reading: tells AN EMPTY BOX from NO BOX IN THIS CAPTURE.
 *
 * The fourth subtlety, and the one that cost a live session (2026-09-18): the
 * box is not always in the window. `captureAnsi` is `capture-pane -p -e` with
 * no `-S`, i.e. the VISIBLE 50 rows; Claude Code renders a draft taller than
 * that by scrolling the box's own interior, and the marker row — the only row
 * that carries `❯` — goes with it. The scan then finds nothing, which is a
 * fact about THE CAPTURE, never about the box. Callers that would type, clear
 * or claim a submit must refuse on `absent`; see `SendResult`'s
 * `box-unreadable`.
 */
export const draftOfMeasured = (ansiPane: string): BoxRead => {
  const boxLine = ansiPane.split('\n').filter((l) => l.replace(SGR, '').startsWith('❯')).at(-1);
  if (boxLine === undefined) return { box: 'absent' };
  return { box: 'present', draft: boxLine.replace(DIM_SPAN, '').replace(SGR, '').slice(1).trim() };
};

/**
 * THE DELIBERATE COLLAPSE, kept so every older caller keeps its exact meaning:
 * a capture with no box reads as an empty one. It DERIVES from
 * `draftOfMeasured` rather than re-scanning, so this file has one definition of
 * where the box is and no adapter narrows a distinction it was never handed —
 * the same shape `io.ts`'s convenience reads take beside their measured
 * siblings. Anything that acts on the answer wants the sibling.
 */
export const draftOf = (ansiPane: string): string => {
  const read = draftOfMeasured(ansiPane);
  return read.box === 'present' ? read.draft : '';
};

/**
 * Did the turn actually leave the input box? Proof is that OUR TEXT is gone —
 * not that the box is empty. Claude Code 2.1.220, when busy, does not empty
 * the box on Enter: it queues the message and swaps the row for a hint
 * ("Press up to edit queued messages"), which is not '' and never becomes ''
 * while the hint is up. Judging success by emptiness alone burned both Enter
 * attempts on every busy-session send and reported a message that WAS
 * delivered as `enter-ignored`.
 *
 * `needle` is the same prefix the echo check proved landed in the box, so
 * "no longer starts with needle" means our text left — however the row now
 * reads: today's queue hint, the dim ghost-suggestion `draftOf` already
 * strips, or whatever chrome a future Claude Code version puts there. When
 * `needle` is '' (a prompt with no non-blank line), there is nothing to prove
 * left, so fall back to the emptiness check exactly as before.
 */
async function submitted(
  d: SendDeps,
  id: string,
  sleep: (ms: number) => Promise<void>,
  still: StillInBox,
): Promise<boolean> {
  for (let i = 0; i < SUBMIT_TRIES; i++) {
    await sleep(SUBMIT_POLL_MS);
    const pane = await d.tmux.captureAnsi(id);
    if (pane === null) return false;
    const read = draftOfMeasured(pane);
    // ABSENCE IS NOT PROOF OF DEPARTURE, and this is the one place where the
    // collapse read as the OPPOSITE of the truth: with no box in the capture
    // `draftOf` answers '', `!''.startsWith(needle)` is true, and this function
    // reported "our text left the box" — a send claimed DELIVERED while it sat
    // unsubmitted. Reachable exactly when our own typing grows the box past the
    // window between the echo poll and this one. Skip the poll instead; if every
    // poll is blind the loop falls out below and the caller refuses.
    if (read.box === 'absent') continue;
    if (!still(pane, read.draft)) return true;
  }
  return false;
}

/**
 * What says OUR TEXT is still in the box, read from one capture that has a box
 * (`pane`, and `draft`, its marker row). `submitted` polls it after Enter and
 * calls the turn taken on the first capture where it is false.
 */
type StillInBox = (pane: string, draft: string) => boolean;

/** The proof every send has used: the marker row still starts with `needle`
 *  (the prefix the echo check proved landed), or, when `needle` is '', the
 *  marker row is still non-empty. See `submitted`. */
const stillStartsWith = (needle: string): StillInBox => (_pane, draft) =>
  needle === '' ? draft !== '' : draft.startsWith(needle);

/**
 * Press Enter (up to twice — the SAME one-retry-after-an-overlay budget
 * `sendPrompt`'s own tail below spends after typing) and report whether
 * `needle` proved the text left the box. Factored out so `sendPrompt`'s
 * `resumeIfOwn` branch — which presses Enter on text ALREADY sitting in the
 * box rather than retyping it — shares the identical submit-proof discipline
 * as the ordinary type-then-submit path, instead of a second hand-rolled copy
 * that could drift from it.
 */
async function pressEnterAndConfirm(
  d: SendDeps,
  id: string,
  sleep: (ms: number) => Promise<void>,
  still: StillInBox,
): Promise<SendResult> {
  await d.tmux.sendKey(id, 'Enter');
  if (await submitted(d, id, sleep, still)) return { ok: true };
  await d.tmux.sendKey(id, 'Enter');
  if (await submitted(d, id, sleep, still)) return { ok: true };
  const stuck = await d.tmux.capture(id);
  const last = draftOfMeasured(await d.tmux.captureAnsi(id) ?? '');
  // THE NAME STAYS `enter-ignored` — we pressed twice and the text never left,
  // which is what that token reports and is true whatever the last capture
  // shows. What CANNOT survive an absent box is the CLAIM beside it:
  // `submittable` asserts "the box row IS the message and one Enter sends
  // exactly it", and `draft` is the correspondence claim `submitEnter` gates
  // that rescue on. With no box in the capture, `draftOf` would hand both of
  // them '' — a rescue button wired to a reading of nothing. Withhold the
  // claim, keep the diagnosis. (The PWA gates its button on a non-blank
  // `draft` as well, so this is the second lock on the same door.)
  if (last.box === 'absent') return { ok: false, error: 'enter-ignored', pane: (stuck ?? '').slice(-PANE_TAIL) };
  return {
    ok: false, error: 'enter-ignored',
    draft: last.draft,
    pane: (stuck ?? '').slice(-PANE_TAIL),
    // We typed it, we watched it echo, and nothing has cleared it: the box row
    // IS the message and Enter would send exactly it. See `SendResult`.
    //
    // EXCEPT ON A BLANK MARKER ROW, which only a row-capped box reaches here
    // (D-5088: the first row in view can be a blank line of our
    // message). `submitEnter` refuses a blank row and its route a blank
    // `expect`, so a flag over `draft: ''` would be a rescue with no subject.
    // The diagnosis stays.
    ...(last.draft !== '' ? { submittable: true } : {}),
  };
}

/** How long to let the pane settle after a C-u before reading the box again. */
const CLEAR_POLL_MS = 150;
/**
 * Wall-clock ceiling on ONE clear, blind presses included.
 *
 * The whole of `sendPrompt` runs inside the session's `KeyedQueue` slot, so
 * every millisecond spent here is a millisecond in which that session accepts
 * nothing else — not the next prompt, not `/interrupt`. The bound has to be
 * time, not presses: presses are sized off the message, so a press cap alone
 * lets a long message hold the lock for minutes (a 200-line prompt at ~150 ms
 * per look-round is over a minute).
 */
const CLEAR_BUDGET_MS = 3000;
/**
 * Look-rounds allowed AFTER the blind floor at the attachment site, where the
 * floor is already sized to the text we typed. Slack for a widget that costs
 * more presses than measured, not the primary mechanism.
 */
const CLEAR_EXTRA_PRESSES = 6;
/**
 * Press ceiling for `replaceDraft`, where the draft's size is unknowable
 * (`draftOf` returns the box's first row only) so there is no floor to compute
 * and every press has to be paid for with a look. This is a BACKSTOP: at
 * CLEAR_POLL_MS a round the budget above stops the loop first (~20 rounds), so
 * the number only matters if polling is free. It was 8 — which is 2N-1 for
 * N=4, i.e. any 5-line draft (a pasted stack trace, a log excerpt) hit the cap,
 * lost four of its five rows to the presses that DID land, and came back
 * `draft-clear-failed` reporting only the one row left. Nothing is saved by
 * keeping it low: the loop exits on the first empty read, so a high ceiling
 * costs time only on a box that genuinely will not clear, which the budget
 * bounds anyway.
 */
const REPLACE_MAX_PRESSES = 24;

/**
 * Pane width, read off the capture itself — `capture-pane` emits one line per
 * visual row and the box's rules span the full width, so the longest row is the
 * width. Clamped at both ends: a narrow answer only ever costs extra no-op
 * presses, so the floor (80, the narrowest real terminal) guards against a
 * capture with no full-width row in it, and the ceiling keeps an absurd width
 * from under-counting rows on a genuinely wide pane.
 */
const paneWidth = (pane: string): number =>
  Math.min(400, Math.max(80, ...pane.split('\n').map((l) => l.replace(SGR, '').length)));

/**
 * How many VISUAL rows `lines` occupies in a box `width` columns wide.
 *
 * Kills are per visual row, not per logical line, and WRAPPED rows cost less
 * than rows made by M-Enter, which each need a second press to join the newline
 * away. Two independent live measurements on 2026-07-27 disagree by one press
 * on the wrapped case — a 260-char line in a 120-column pane cleared in 3
 * presses over 3 rows, while a 611-char line in the 220-column pane this fleet
 * actually runs took 4 over 3 rows — so treat "1 press per wrapped row" as the
 * shape and not as an exact cost. Either way it is under 2 per row, where
 * M-Enter rows are exactly 2N-1 (1→1, 2→3, 3→5, 4→7, measured with a capture
 * between every press).
 *
 * So charging 2 per visual row OVER-estimates a wrapped draft and is exact for
 * an unwrapped one. That is the direction we want: the floor is fired blind, an
 * under-estimate would strand text, and over-pressing an empty box is a no-op
 * (measured: 12 presses at a 2-line draft left a clean box). The look phase
 * after the floor catches any case where this bound is nonetheless too low.
 */
const visualRows = (lines: readonly string[], width: number): number =>
  lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / Math.max(1, width - 2))), 0);

type ClearOutcome =
  | { state: 'cleared' }
  | { state: 'residue'; draft: string }
  | { state: 'menu' }
  | { state: 'dead' }
  /** No box in the capture — the presses are landing somewhere we cannot read,
   *  so neither `cleared` nor `residue` can be claimed. See `draftOfMeasured`. */
  | { state: 'unreadable' };

/**
 * Empty the input box and report what is left.
 *
 * C-u is kill-to-ROW-start with the caret at the end of the LAST row, and a row
 * emptied by a kill still has to be JOINED AWAY by a second press when a
 * newline made it — so an N-line draft costs 2N-1 presses, not N (measured
 * against a live Claude Code 2.1.220 box on 2026-07-27, capture between every
 * press: 1→1, 2→3, 3→5, 4→7).
 *
 * Two phases, because the two failure modes need opposite things:
 *
 *  - `blind`: presses fired back-to-back with NO reads. This is what actually
 *    clears the box, and it is deliberately render-INDEPENDENT. The clear runs
 *    on the verify-failed path, and the commonest reason a verify fails is that
 *    the pane is not rendering what we typed — so a loop that stops when the
 *    box "reads empty" stops on the FIRST read of exactly that stale frame and
 *    strands the whole prompt. Bursting is safe on the real widget: 5 back-to-
 *    back C-u with no settle emptied a 3-line draft completely (measured).
 *  - the look rounds: press, settle, re-read. Slack for a widget whose cost is
 *    not what we measured, and the only way to learn what is actually left.
 *
 * Terminating a look round on the box's FIRST row alone was sound only while
 * that row had started NON-blank: kills run bottom-up and `draftOf` reads row
 * one (the `❯` marker sits there; continuation rows are indented two spaces
 * and carry no marker — both confirmed against real `capture-pane -e` bytes,
 * see LIVE_CU_FRAMES in the tests), so row one is the LAST to empty. On a box
 * whose marker row was ALREADY blank the argument inverts: the first look
 * round reads '' with every row below it untouched, and reporting `cleared`
 * there hands the caller a box it is about to concatenate onto. Since the
 * clobber guard sees the whole box (`hasContentBelowMarker`), that shape is
 * reachable on both clear arms — and `replaceDraft` is operator-reachable from
 * the PWA — so the terminator asks the same question the guard does.
 * Detecting PROGRESS from draftOf is
 * impossible for the same reason — its value is unchanged for every press but
 * the last — which is why the bound below is wall-clock and not "presses that
 * changed nothing".
 *
 * Every path is bounded by CLEAR_BUDGET_MS, checked in both phases, because
 * this runs holding the session's queue slot.
 */
async function clearBox(
  d: SendDeps,
  id: string,
  sleep: (ms: number) => Promise<void>,
  opts: { blind: number; look: number },
): Promise<ClearOutcome> {
  const now = d.now ?? Date.now;
  const deadline = now() + CLEAR_BUDGET_MS;

  for (let i = 0; i < Math.max(1, opts.blind); i++) {
    if (i > 0 && now() >= deadline) break;   // always at least one press
    await d.tmux.sendKey(id, 'C-u');
  }

  for (let i = 0; ; i++) {
    await sleep(CLEAR_POLL_MS);
    const ansi = await d.tmux.captureAnsi(id);
    if (ansi === null) return { state: 'dead' };
    // A dialog can open between the draft check at the top of sendPrompt and
    // here (a slash-command palette — and an attachment prompt's first
    // keystroke is a literal '/'). With a menu up there is no input box: the
    // only `❯` on screen is the cursor on the selected OPTION, so draftOf reads
    // that row as a draft, it never empties, and we would spend the entire cap
    // hammering C-u into a live menu and then report the user their own
    // "1. Yes" as leftover text. Bail and let the caller say so.
    if (hasMenu(ansi.replace(SGR, ''))) return { state: 'menu' };
    // THE BOX IS NOT IN THIS CAPTURE. Every terminator below reads the box, so
    // continuing would hammer C-u into a pane whose content we cannot see and
    // then report `cleared` off a scan that found nothing — destroying an
    // operator's draft and calling it success. Stop and say which it is.
    if (draftOfMeasured(ansi).box === 'absent') return { state: 'unreadable' };
    // THE WHOLE BOX, not the marker row. `draftOf` reads row one only, and this
    // used to terminate on that alone.
    if (draftOf(ansi) === '' && !hasContentBelowMarker(ansi)) return { state: 'cleared' };
    // `residue.draft` still reports the MARKER ROW — that field is display, and
    // on a blank marker row it correctly reports '' meaning "row one is empty".
    // The caller's own refusal is what carries the full text (`draft-present`,
    // which reports `boxText`).
    const left = draftOf(ansi);
    if (i >= opts.look || now() >= deadline) return { state: 'residue', draft: left };
    await d.tmux.sendKey(id, 'C-u');
  }
}

/**
 * Second-row correspondence for `resumeIfOwn`'s per-delivery discrimination
 * (blocking review finding, F3): does the box's FIRST CONTINUATION row —
 * one row below the marker, invisible to `draftOf` — correspond to THIS
 * call's own SECOND composed line, when there is one to check?
 *
 * Exists because the marker row alone cannot always tell two different
 * deliveries to the SAME session apart: `renderEnvelope`'s first rendered
 * line is the constant fence ("```ccrc-mail") on every mail envelope, so
 * `needle` (`sendPrompt`'s own marker-row check, below) is that same fence
 * for essentially every mail message — a draft left behind by a DIFFERENT
 * envelope's lost Enter starts with it exactly as our own would. The
 * second rendered line (`id: <delivery id>`) is what actually varies per
 * delivery, and it lands one row below the marker because `sendPrompt`'s
 * own M-Enter loop puts one composed line per visual row (see
 * `continuationRows`, which this reads from) — so comparing it is the
 * cheapest available proof of PER-MESSAGE identity, not merely
 * per-marker-row-prefix identity.
 *
 * When this call's own composed text has no second line (`parts[1]` is
 * absent or blank — every non-mail, single-line caller), there is nothing
 * further to disambiguate against: the marker-row check is all the
 * precision that ever existed for a one-line message, so this returns
 * `true` rather than manufacturing a distinction that isn't there.
 */
function matchesOwnDraft(ansiPane: string, parts: readonly string[]): boolean {
  const second = (parts[1] ?? '').trim();
  if (second === '') return true;
  const boxSecond = continuationRows(ansiPane)[0] ?? '';
  return boxSecond.startsWith(second.slice(0, ECHO_NEEDLE));
}

/**
 * Draft shapes only THIS system's OLD typed-envelope lane could ever have
 * produced: a Claude Code paste-chip collapse of a multi-line envelope it
 * typed (`[Pasted text #N …]`), or a stranded ```ccrc-mail fence opener —
 * `renderEnvelope`'s own first rendered line — left un-submitted by a lost
 * Enter. The reference-nudge lane (robust-mail-delivery spec §1) never types
 * a multi-line payload again, so once every corrupted box has been migrated
 * past, this matches nothing new — it exists to recover what the old lane
 * already left behind, not to widen what counts as "ours" going forward.
 *
 * Deliberately narrow: a genuine human draft matches NEITHER shape — no
 * human mid-sentence thought starts with a literal `[Pasted text #` chip or
 * opens a ```ccrc-mail fence — so `clearMailResidue`'s gate on this function
 * can never clear a human's own text (F2).
 *
 * AND IT STAYS A PURE TEXT PREDICATE. Task 407 wanted the stranded `/clear`
 * `dispatch.ts` leaves behind cleared too, and the obvious place looked like a
 * third rung here. It is not: `/clear` is four characters a human plausibly
 * types and leaves sitting, so no property of the STRING distinguishes ours
 * from theirs, and this function's whole guarantee above — "matches nothing a
 * human would write" — would have become false. The distinction that actually
 * exists is PROVENANCE, and provenance is not in this function's arguments.
 * See `isStrandedClear` and `sendPrompt`'s `ownStrandedClear` below.
 *
 * The fence comes from `MAIL_ENVELOPE_FENCE` (`shared/api.ts`) rather than a
 * hand-spelled literal — `single-definition.test.ts`'s own recorded gap,
 * taking the invitation its comment left by name.
 */
/**
 * Claude Code's input box COLLAPSES a large burst of typed text into a chip —
 * `[Pasted text #1]`, or `[Pasted text #1 +54 lines]` when the payload carried
 * newlines. It is the widget's own rendering of text it holds in full, not a
 * truncation: pressing Enter submits the whole thing.
 *
 * Named for the shape rather than for one caller, because it now has two with
 * opposite questions. `isMailResidue` asks "could a human have written this?"
 * (no — so the old lane's residue is safe to clear). The echo check asks "is
 * this our own message, collapsed?" and answers it from PROVENANCE, not from
 * the string: see the ordinary `verify-failed` arm.
 */
const PASTE_CHIP = /^\[Pasted text #\d+/;
export function isMailResidue(draft: string): boolean {
  if (draft === '') return false;
  if (PASTE_CHIP.test(draft)) return true;
  if (draft.startsWith('```') && draft.includes(MAIL_ENVELOPE_FENCE)) return true;
  return false;
}

/**
 * ONE chip and nothing else on the row, in the two shapes Claude Code 2.1.300
 * was measured drawing (fixtures `cc300-paste-chip-1000.txt`,
 * `cc300-paste-chip-lines.txt`): `[Pasted text #N]`, and `[Pasted text #N +M
 * lines]` when the collapsed read held M newlines. Anchored at BOTH ends, unlike
 * `PASTE_CHIP`, because the question here is "is this row exactly one chip" and
 * not "does it start like one": `[Pasted text #3][Pasted text #4]` (one line split
 * across two reads) and `[Pasted text #8] amet…` (a chip with typed text after
 * it) both start like one and neither is one.
 */
const LONE_PASTE_CHIP = /^\[Pasted text #\d+(?: \+(\d+) lines)?\]$/;

/**
 * Claude Code collapses a terminal read into a chip only when it holds MORE than
 * this many characters. Measured on 2.1.300, macOS and Linux alike: 800 is typed
 * as text, 801 collapses. Characters, not bytes: 801 Cyrillic characters (about
 * 1.6 KB) typed in one call were drawn as text on macOS, whose reads are about
 * 1 KB, so no read held more than 800 of them. A read cannot hold more characters
 * than the call that typed it, so a chip over a line of 800 or fewer is not that
 * line. If a later version lowers the threshold, a shorter line's chip falls back
 * to the tap, which is the safe direction.
 */
const PASTE_COLLAPSE_FLOOR = 800;

/**
 * What `sendPrompt` PROVED about the box before its type loop, the provenance
 * half of D-5087. `proven-empty`: the clobber guard read an
 * empty box (no marker-row text, no rows below it). `cleared-by-us`: the box
 * held something and this call's own clear emptied it (`replaceDraft`,
 * `clearMailResidue`, `ownStrandedClear`). `unproven` is the starting value, so a
 * path that forgets to establish the proof submits nothing.
 */
export type TypeProvenance = 'unproven' | 'proven-empty' | 'cleared-by-us';

/**
 * D-5087. Is the box holding OUR whole message, collapsed into a
 * paste chip, so that one Enter sends exactly it? Answers the chip row (the
 * needle `submitted()` proves departure with) or `null`, and `null` keeps the
 * ordinary `verify-failed` refusal, `submittable` and all.
 *
 * The operator report this answers: a long paragraph pasted into the PWA
 * composer came back `verify-failed` with the text sitting complete in the box
 * behind `[Pasted text #N]`, and the send needed a second act, a tap or an Enter
 * at the terminal, carrying no information the server did not have. A human
 * looking at `[Pasted text #1]` cannot see what it holds either.
 *
 * Four guards, every one required:
 *  1. PROVENANCE. The box was proven empty, or emptied by this call, before the
 *     type loop, and this call has held the session's queue slot since. So the
 *     chip arrived after our own `sendLiteral`. No property of the string says
 *     it is ours; the sequence does (the same argument `ownStrandedClear`
 *     makes).
 *  2. ONE CHIP, AND NOTHING ELSE IN THE BOX. The marker row is exactly one chip
 *     and there is no box row below it. Two chips (a line split across two
 *     reads), a chip with typed text after it, or a chip with more rows below
 *     are all refused: each is either not provably the whole message or not
 *     provably only ours.
 *  3. THE LINE COUNT CORRESPONDS. A chip that states `+M lines` holds M newlines,
 *     so M must be the newlines we typed. A chip that states none holds one line,
 *     so we must have typed one.
 *  4. IT COULD HAVE COLLAPSED. The collapsed read holds over
 *     `PASTE_COLLAPSE_FLOOR` characters, so the line (or, with a line count, the
 *     message) we typed must too.
 *
 * WHAT IT DOES NOT PROVE: that Claude Code kept every character behind the chip.
 * The tap it replaces did not prove that either; it pressed the same Enter on
 * the same row. Shapes that DO show a loss, such as macOS's lost head (only the
 * tail of a long line drawn, no chip), fail guard 2 and keep their refusal.
 */
export function ownPasteChip(ansiPane: string, parts: readonly string[], provenance: TypeProvenance): string | null {
  if (provenance === 'unproven') return null;
  const read = draftOfMeasured(ansiPane);
  if (read.box === 'absent') return null;
  const chip = LONE_PASTE_CHIP.exec(read.draft);
  if (chip === null || continuationRows(ansiPane).length > 0) return null;
  const stated = chip[1] === undefined ? 0 : Number(chip[1]);
  if (stated !== parts.length - 1) return null;
  const collapsed = chip[1] === undefined ? parts[0]! : parts.join('\n');
  if (collapsed.length <= PASTE_COLLAPSE_FLOOR) return null;
  return read.draft;
}

/** A row that is exactly one chip with no line count: what one typed line over
 *  `PASTE_COLLAPSE_FLOOR` draws (`cc300-paste-tall-with-chip.txt`,
 *  `cc300-paste-chip-first-rows-below.txt`). */
const BARE_PASTE_CHIP = /^\[Pasted text #\d+\]$/;
/** Any chip anywhere in a row, so a shape `BARE_PASTE_CHIP` does not vouch for
 *  (two chips, a chip with text after it, a counted chip) refuses rather than
 *  being read as typed text. */
const ANY_PASTE_CHIP = /\[Pasted text #\d+/;

/**
 * The most box rows Claude Code 2.1.300 shows before it scrolls the box inside
 * itself, for a pane `paneRows` tall: (rows - 10) / 2, wrapped rows counted.
 * Measured by the investigations at 30, 40, 50 and 70 rows (10, 15, 20, 30) and
 * here at 50 (`cc300-paste-tall-*.txt`). The fleet pins its windows at 50 rows
 * (`PINNED_WINDOW_ROWS`), so 20 there. A version that changes it makes a hidden
 * head unprovable, and the send falls back to today's refusal.
 */
const boxRowCap = (paneRows: number): number => Math.floor((paneRows - 10) / 2);

/** Whitespace removed. Claude Code wraps a long line at spaces, and a row is
 *  read trimmed, so only the non-space characters of a line survive the
 *  rendering in order; comparing those is comparing what was typed. */
const squash = (s: string): string => s.replace(/\s+/g, '');

/**
 * Every row of the box, the marker row first (read as `draftOf` reads it) and
 * then every row down to the closing rule, BLANK ROWS INCLUDED (a blank row is a
 * blank line of the message), each with dim spans and SGR stripped and trimmed.
 * `null` when the capture has no marker row, or no rule closes the box: a box
 * whose bottom is not on screen cannot be read whole.
 */
function boxRows(ansiPane: string): string[] | null {
  const lines = ansiPane.split('\n');
  let marker = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i]!.replace(SGR, '').startsWith('❯')) marker = i;
  if (marker === -1) return null;
  const rows = [lines[marker]!.replace(DIM_SPAN, '').replace(SGR, '').slice(1).trim()];
  for (let i = marker + 1; i < lines.length; i++) {
    const row = lines[i]!.replace(DIM_SPAN, '').replace(SGR, '');
    if (isRuleRow(row)) return rows;
    rows.push(row.trim());
  }
  return null;
}

/**
 * D-5088. Is the box the RENDERING of what we typed, read whole?
 * Answers the last `ECHO_NEEDLE` non-space characters in view (the tail
 * `stillContains` proves departure with), or `null`, which keeps the refusal.
 *
 * Reached only when the echo needle never matched, and built for two measured
 * shapes the needle cannot see (Claude Code 2.1.300, 220x50):
 *  - THE ROW CAP (`cc300-paste-tall-*.txt`). The box shows at most
 *    `boxRowCap` rows, keeps the LAST rows in view and draws `❯` on the first
 *    of them, so a message taller than 20 rows has a later line, or a blank
 *    one, on the marker row. Today that is `verify-failed` with no
 *    `submittable`, and one Enter at the terminal sent the whole text intact.
 *  - A LONG FIRST LINE with lines below it (`cc300-paste-chip-first-rows-below.txt`):
 *    a chip on the marker row and our own rows under it, which
 *    `ownPasteChip`'s one-chip guard rightly refuses.
 *
 * The box is split into runs at its chip rows, and so is what we typed (every
 * line over `PASTE_COLLAPSE_FLOOR` is a chip, every other line is text), the
 * text of each run whitespace-free (`squash`). Guards, all required:
 *  1. PROVENANCE, exactly as `ownPasteChip`'s.
 *  2. THE BOX CLOSES, and every chip in it is a bare one (`ANY_PASTE_CHIP` on a
 *     row that is not `BARE_PASTE_CHIP` refuses).
 *  3. EVERY CHIP IN VIEW. As many chips on screen as lines we typed over the
 *     floor. A long line hidden above the window could have lost its head
 *     (measured on macOS for lines of 1023 to about 1821 characters: only the
 *     tail is drawn, with no chip), and only a chip in view shows it did not.
 *     It also refuses the AUTO-SUBMIT SPLIT (measured: M-Enter straight after
 *     a long first line submitted that line alone, and the rest landed in a
 *     fresh box), because the sent part's chip is not on screen.
 *  4. THE TEXT MATCHES. Every run after the first chip in view equals ours;
 *     the run before it is a SUFFIX of ours (the window may start mid-line).
 *  5. A HIDDEN HEAD NEEDS A FULL BOX. When that first run is not the whole of
 *     ours, the box has exactly `boxRowCap` rows for this pane's height: the
 *     cap is the one measured reason for a head to be out of view.
 *  6. SOMETHING IN VIEW. Not a box of blank rows.
 *
 * WHAT IT DOES NOT PROVE: the characters above the window, which nothing on
 * screen shows. They are lines of 800 characters or fewer (guard 3), which are
 * typed as text and never collapse; the echo the ordinary path accepts proves
 * the first 24 characters of a message and nothing below them.
 */
export function ownRenderedBox(ansiPane: string, parts: readonly string[], provenance: TypeProvenance): string | null {
  if (provenance === 'unproven') return null;
  const rows = boxRows(ansiPane);
  if (rows === null) return null;
  const seen: string[] = [''];
  for (const row of rows) {
    if (BARE_PASTE_CHIP.test(row)) seen.push('');
    else if (ANY_PASTE_CHIP.test(row)) return null;
    else seen[seen.length - 1] += squash(row);
  }
  const typed: string[] = [''];
  for (const part of parts) {
    if (part.length > PASTE_COLLAPSE_FLOOR) typed.push('');
    else typed[typed.length - 1] += squash(part);
  }
  if (seen.length !== typed.length) return null;
  for (let i = 1; i < seen.length; i++) if (seen[i] !== typed[i]) return null;
  if (!typed[0]!.endsWith(seen[0]!)) return null;
  const paneRows = ansiPane.replace(/\n$/, '').split('\n').length;
  if (seen[0] !== typed[0] && rows.length !== boxRowCap(paneRows)) return null;
  const inView = squash(rows.join(''));
  if (inView === '') return null;
  // Trailing backslashes are left out of the tail: Claude Code 2.1.300 turns `\` + Enter into a NEWLINE (measured),
  // consuming the backslash and submitting nothing, so a tail that included it would vanish from a box still holding
  // our whole message.
  return inView.replace(/\\+$/, '').slice(-ECHO_NEEDLE);
}

/** `ownRenderedBox`'s submit proof: the box, read whole, still CONTAINS the tail
 *  that was in view (anywhere, not only at its end). False on an emptied box, on
 *  the queue hint (dim, so stripped), and on anything else typed after our turn
 *  left. A box whose closing rule is not on the capture counts as still holding
 *  it: a frame that cannot be read whole is not proof that the turn left. Both
 *  found by the branch verifier: `\` + Enter adds a row instead of submitting,
 *  and an "ends with" proof read that as gone. */
const stillContains = (tail: string): StillInBox => (pane) => {
  const rows = boxRows(pane);
  return rows === null || squash(rows.join('')).includes(tail);
};

/** The exact text `dispatch.ts` types into a resumed worker's box before a
 *  wave brief (`sendPrompt(..., '/clear')`) — the one draft `ownStrandedClear`
 *  can ever be about. */
const STRANDED_CLEAR = '/clear';

/**
 * Does this box hold EXACTLY the `/clear` a caller is claiming it stranded —
 * that one line, and nothing else?
 *
 * The text half of a two-part gate, and by itself it proves NOTHING: a
 * `/clear` sitting in a box is equally consistent with an operator having
 * typed one and walked away. `sendPrompt` only consults this when the caller
 * has separately PROVEN the send was its own (`ownStrandedClear`), and a
 * caller with no proof gets the ordinary `draft-present` refusal — the
 * default, not a fallback.
 *
 * THE WHOLE BOX, not the marker row: the stranded send was one line, so a box
 * with rows below the marker is not the box we left, and a C-u fired at it
 * would land on whatever is underneath. Same unit the clobber guard and
 * `clearBox`'s terminator read, for the same reason (§4.2).
 */
const isStrandedClear = (ansiPane: string): boolean =>
  draftOf(ansiPane) === STRANDED_CLEAR && !hasContentBelowMarker(ansiPane);

/**
 * Inject a prompt into the session's Claude Code input box, serialized per
 * session through the KeyedQueue. Refuses to clobber a half-typed draft
 * unless `replaceDraft`, verifies the pane echoed the text before Enter, and
 * verifies the box emptied after it.
 *
 * `resumeIfOwn` (bug #21 / F3 — the mail lane's own un-submitted injection
 * self-blocking its own retry, dogfood-measured on the build4 program's wave
 * 1): a caller that sets this is stating "the box may already hold exactly
 * what I am about to send, left there by MY OWN prior attempt whose Enter
 * did not land — if so, finish submitting it rather than refusing it as a
 * foreign draft." See the `draft` branch below for the discrimination this
 * buys, and its own limit.
 *
 * `clearMailResidue` (robust-mail-delivery spec §2.2): a caller that sets
 * this is stating "if the box holds MACHINE residue this system's own old
 * lane left behind (`isMailResidue`), clear it and proceed — never a human
 * draft, which `isMailResidue` structurally cannot match." Checked AFTER
 * `resumeIfOwn` (an own stale nudge is resumed, not cleared and retyped) and
 * BEFORE the ordinary `replaceDraft`/`draft-present` fork, so a caller that
 * sets both gets: resume own draft > clear+type over recognized residue >
 * replace (if asked) > refuse.
 *
 * `ownStrandedClear` (Task 407, operator ruling): a caller that sets this is
 * stating "I HAVE PROOF this system typed a `/clear` into this box and the
 * session never took it" — not "this box looks like it holds one". The
 * difference is the entire feature. `dispatch.ts` types that literal before a
 * wave brief and documents the wedge a swallowed Enter creates: the mail
 * lane's next sweep refuses `draft-present`, keeps refusing, and parks the
 * brief `undeliverable` with nothing surfacing why — one dirty box silences a
 * wave. But `/clear` is also four characters an operator plausibly types and
 * leaves sitting, and no property of the text tells the two apart, so THIS
 * FLAG, not the string, is what opens the clear. `watch.ts` sets it from
 * `CoordStore.strandedClear` — a durable `clear-refused:enter-ignored` run
 * event — and a caller with nothing to read passes nothing and gets the
 * ordinary refusal. Same rung as `clearMailResidue`, and both still lose to
 * `resumeIfOwn`.
 *
 * `holdIfAutoContinueArmed` (D-2368): a caller that sets this is stating "if
 * Claude Code's own limit recovery is armed on this pane, refuse rather than
 * type" — ONLY the mail lane sets it. A human's send from the PWA is exactly
 * the documented cancel (any keystroke discards the continuation), and
 * `dispatch.ts`'s `/clear` ends the conversation on purpose, so neither of
 * those callers may opt in: this defaults OFF, and the ordinary path types
 * over an armed pane exactly as it always has.
 *
 * `refuseIfTurnRunning` (worker stall watch §4.1). A caller that sets this is
 * stating: "if the pane's last 8 rows show a turn running (`turnRunning`,
 * "esc to interrupt"), refuse rather than type." ONLY the mail lane sets it,
 * and only when it is delivering on a live word other than `idle`: the
 * `shell` word, whose idleness is a rule about Claude Code's own status
 * file, not a measurement of this pane. It is a drift tripwire, not a proof.
 * A `--remote-control` pane never renders the phrase and a narrow pane can
 * wrap it, so passing this check proves nothing about idleness.
 * It is decided AFTER the auto-continue hold, because an armed limit is the
 * stronger reason and the mail lane has its own arm for it. It is decided
 * BEFORE the menu check, over the same 8-row window, so a stale phrase
 * scrolled above that window never refuses. It defaults OFF: a human's send
 * from the PWA and `dispatch.ts`'s `/clear` type over a running turn exactly
 * as they always have.
 */
export function sendPrompt(
  d: SendDeps,
  id: string,
  text: string,
  opts: { replaceDraft?: boolean; attachments?: readonly string[]; resumeIfOwn?: boolean;
          clearMailResidue?: boolean; ownStrandedClear?: boolean; holdIfAutoContinueArmed?: boolean;
          refuseIfTurnRunning?: boolean } = {},
): Promise<SendResult> {
  const sleep = d.sleep ?? defaultSleep;
  // Computed up front, from `text`/`attachments` alone — independent of the
  // pane, and needed BEFORE the draft check below now that `resumeIfOwn`
  // must compare against it there too, not only in the echo-verification
  // loop this was previously computed just ahead of.
  //
  // Attachment paths go first, each on its own line, then the user's text —
  // one atomic turn, so the transcript reads image-above-caption and a send
  // that fails to verify can't strand a bare path in the box.
  const attachments = opts.attachments ?? [];
  const composed = composePrompt(text, attachments);
  // Alt+Enter is newline inside the Claude Code input box.
  const parts = composed.split('\n');
  const needle = (parts.find((p) => p.trim().length > 0) ?? '').trim().slice(0, ECHO_NEEDLE);
  return d.queue.run(id, async (): Promise<SendResult> => {
    const pane = await d.tmux.captureAnsi(id);
    if (pane === null) return { ok: false, error: 'not-alive' };

    const plain = pane.replace(SGR, '');
    // D-2368: before the menu check — on an armed screen the limit is the reason
    // nothing may be typed, whatever else is drawn.
    //
    // DECIDED ON THE LAST 8 LINES, matching ccd's own window (`_pane_auto_continue_armed`
    // is fed `tail -8` at both its call sites, ccd/ccd), not the whole `plain` capture
    // (final review finding 2, 2026-09-10). `AUTO_CONTINUE_RE`'s phrases ("continuing
    // automatically", "continuing shortly") are ordinary English a ccrc session routinely
    // has scrolled into its 220x50 pane — swap.log, this file, an earlier limit episode —
    // and testing the WHOLE capture against them held mail on a false positive that could
    // never expire (the sweep's back-off counts no attempt for this error, by design).
    const armWindow = plain.replace(/\n$/, '').split('\n').slice(-8).join('\n');
    if (opts.holdIfAutoContinueArmed && autoContinueArmed(armWindow)) return { ok: false, error: 'auto-continue-armed', pane: plain.slice(-PANE_TAIL) };
    // Worker stall watch §4.1: a turn is running in the pane's last 8 rows. This
    // comes after the auto-continue hold (the stronger reason, with its own arm in
    // the mail lane) and before the menu check, over the SAME window, so a stale
    // "esc to interrupt" in scrollback never refuses. See the option's docstring.
    if (opts.refuseIfTurnRunning && turnRunning(armWindow)) return { ok: false, error: 'turn-running', pane: plain.slice(-PANE_TAIL) };
    // A menu owns the keyboard and there is no input box to type into — the only
    // `❯` on screen is the cursor resting on the selected OPTION. draftOf would
    // read that row ("1. Forward-fill per class ┌────…") as a half-typed draft
    // and report draft-present, and answering "replace" would fire C-u and then
    // type the message as raw keystrokes into a live menu. Refuse instead; the
    // caller's job is to answer the question.
    if (hasMenu(plain)) return { ok: false, error: 'dialog-open' };

    // THE BOX HAS TO BE IN THE CAPTURE BEFORE ANY READING BELOW MEANS ANYTHING.
    // Both halves of the clobber guard — `draftOf` and `hasContentBelowMarker`
    // — are anchored on the same last-`❯` scan, so a capture without one fails
    // them OPEN TOGETHER and the type loop appends onto whatever is really
    // there. This is the one keystroke-free refusal that keeps that from being
    // reachable, and it is deliberately the FIRST box reading in the function.
    // See `SendResult`'s `box-unreadable` for the live measurement.
    const box = draftOfMeasured(pane);
    if (box.box === 'absent') return { ok: false, error: 'box-unreadable', pane: plain.slice(-PANE_TAIL) };

    const draft = box.draft;
    // THE BOX HOLDS ANYTHING — not "the marker row is non-blank". A wedge whose
    // FIRST row is blank was invisible here: measured, a send into such a box
    // issued zero C-u and typed onto the end of the existing content, so the
    // session received the concatenation as ONE turn — including dispatch's
    // `/clear`, which would submit `…brief text/clear` on a single line.
    // `hasContentBelowMarker` already existed for `submitEnter`, which named
    // this exact pane `blank-first-row`; the guard simply never asked.
    //
    // WHERE THE SHAPE STILL COMES FROM, after Task 402. That task makes
    // `composePrompt` strip leading blank lines, so neither the app's Composer
    // nor the coordinator nor a curl caller can MANUFACTURE a blank marker row
    // any more. The two producers that remain are a HUMAN typing Enter first
    // into the box, and any pre-402 client still on the wire. Both are enough:
    // this guard is what stands between them and a silent concatenation.
    //
    // `provenance` records which proof let the type loop run, for the paste-chip
    // arm below (`ownPasteChip`). It starts `unproven` and only the two proofs
    // set it: this guard reading an empty box, or one of this call's own clears
    // returning `cleared`.
    let provenance: TypeProvenance = 'unproven';
    if (draft || hasContentBelowMarker(pane)) {
      // `resumeIfOwn`'s discrimination: `needle` is derived from THIS call's
      // OWN `text`, and `submitEnter`'s own correspondence gate already
      // established the doctrine this reuses — "the box's MARKER ROW... is
      // all draftOf can see and all [a prior observation] could have
      // carried, so equality of it is exactly as much correspondence as
      // exists to prove" (`submitEnter`'s own docstring). But a draft that
      // starts with `needle` is only THIS DELIVERY'S own unsent text to
      // that precision when `needle` itself can tell deliveries apart — and
      // for mail it usually cannot: `renderEnvelope`'s first line is the
      // SAME constant fence ("```ccrc-mail") on every envelope, so `needle`
      // is that fence for essentially every mail message, and a marker-row
      // check alone would treat ANY envelope sitting in the box as THIS
      // one — including a DIFFERENT message to the same session, mistakenly
      // submitting its bytes under this delivery's row (blocking review
      // finding: a second envelope to the same session was mis-submitted
      // exactly this way). So the check goes one row deeper whenever there
      // is a second line to check: `matchesOwnDraft` compares the box's
      // FIRST CONTINUATION row — invisible to `draftOf`, but not to
      // `continuationRows` — against this call's own second composed line,
      // the field `renderEnvelope` actually varies per delivery
      // (`id: <delivery id>`). Only when marker row AND (when present)
      // second row both correspond is this trusted as OUR draft — so finish
      // the submit (press Enter, verified) rather than either retyping over
      // it (would double the text) or refusing it as `draft-present` (would
      // wedge forever: this function never retries on its own, so an
      // unrecognized "own" draft would answer `draft-present` on every
      // future call for as long as it sits there — the exact self-block F3
      // measured live). A draft that does NOT match — any genuine human
      // draft, or another delivery's own still-unsent envelope — falls
      // straight through to the ordinary `draft-present` refusal below,
      // untouched: F2 (never type over a human mid-sentence) is unaffected,
      // because this branch only ever PRESSES ENTER, never clears or types.
      if (opts.resumeIfOwn && needle !== '' && draft.startsWith(needle) && matchesOwnDraft(pane, parts)) {
        return pressEnterAndConfirm(d, id, sleep, stillStartsWith(needle));
      }
      // `clearMailResidue`: the box holds MACHINE residue this system's OLD
      // typed-envelope lane left behind (a paste-chip collapse or a stranded
      // ```ccrc-mail fence — `isMailResidue`'s own docstring), and the caller
      // has said it is safe to clear it. Checked before the ordinary
      // `replaceDraft`/`draft-present` fork so a residue-aware caller need not
      // also pass `replaceDraft` — clearing recognized machine debris is not
      // the same permission as clearing whatever a human is mid-typing.
      //
      // `ownStrandedClear` rides the SAME clear, deliberately: the act is
      // identical (C-u the box, then type), and only the permission differs.
      // `isMailResidue` answers "no human writes this"; `ownStrandedClear`
      // answers "this system PROVED it wrote this one" — a `/clear` with no
      // proof behind it falls through to the refusal below, untouched, which
      // is what keeps the refuse-only ruling true for an operator who typed
      // the same four characters.
      if ((opts.clearMailResidue === true && isMailResidue(draft))
          || (opts.ownStrandedClear === true && isStrandedClear(pane))) {
        const cleared = await clearBox(d, id, sleep, { blind: 1, look: REPLACE_MAX_PRESSES - 1 });
        if (cleared.state === 'dead') return { ok: false, error: 'not-alive' };
        if (cleared.state === 'menu') return { ok: false, error: 'dialog-open' };
        // A clear whose own reads went blind cannot claim either outcome; the
        // caller gets the box's own name for it rather than a residue report
        // built from a scan that found no box.
        if (cleared.state === 'unreadable') return { ok: false, error: 'box-unreadable' };
        if (cleared.state === 'residue') return { ok: false, error: 'draft-clear-failed', draft: cleared.draft };
        // cleared.state === 'cleared' → fall through to the type loop below.
        provenance = 'cleared-by-us';
      } else if (!opts.replaceDraft) {
        // `boxText`, not `draft`: the operator is being shown what this refusal
        // is protecting, and every row of it is at stake — the conflict sheet
        // renders this and builds "Append anyway" out of it. On a blank marker
        // row `draft` is '' and this is rows 2..N, which is exactly the case
        // that must never send '' (an empty well, and an append that drops what
        // it claims to be appending to).
        return { ok: false, error: 'draft-present', draft: boxText(pane) };
      } else {
        // A single C-u could never clear a draft of two or more lines (see
        // clearBox), so "replace" failed with draft-clear-failed on any user
        // draft that had a line break in it. No blind floor is available here —
        // draftOf sees the box's first row only, so the draft's size is unknown —
        // so every press is paid for with a look, bounded by the clear's budget.
        const cleared = await clearBox(d, id, sleep, { blind: 1, look: REPLACE_MAX_PRESSES - 1 });
        if (cleared.state === 'dead') return { ok: false, error: 'not-alive' };
        // A menu that opened while we were clearing owns the keyboard exactly as
        // one that was up before we started does, and gets the same answer.
        if (cleared.state === 'menu') return { ok: false, error: 'dialog-open' };
        // A clear whose own reads went blind cannot claim either outcome; the
        // caller gets the box's own name for it rather than a residue report
        // built from a scan that found no box.
        if (cleared.state === 'unreadable') return { ok: false, error: 'box-unreadable' };
        if (cleared.state === 'residue') return { ok: false, error: 'draft-clear-failed', draft: cleared.draft };
        provenance = 'cleared-by-us';
      }
    } else {
      provenance = 'proven-empty';
    }
    // D-5046: every line's send is CHECKED, and the first refusal stops the
    // loop before another key. The echo proof below reads the first line's
    // needle only, so a line tmux refused used to leave a hole in the middle
    // of the message while the echo still matched and Enter still went: the
    // session got the message without that line, and the caller got `ok`.
    // What was typed so far stays in the box. The attachment lane's failed-echo
    // clear below is NOT run on this arm: with `--` in place, what is left to
    // make tmux refuse a literal is the session or the link failing (inferred,
    // not measured), and a clear would meet the same failure.
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) await d.tmux.sendKey(id, 'M-Enter');
      if (!(await d.tmux.sendLiteral(id, parts[i]!))) return { ok: false, error: 'type-failed' };
    }

    // Wait for the box to echo what we typed. This POLLS rather than taking one
    // capture 200ms in: the single shot raced the TUI's re-render, and losing
    // that race reported "the session never showed the text" for a message that
    // was sitting in the box perfectly — we then bailed before pressing Enter,
    // so it stayed there until someone hit Enter by hand. A slow render is not
    // a failed send. The needle stays short and comes from the FIRST line, which
    // the box never wraps (it starts at column 2), so wrapping can't split it.
    // Trimmed: `draftOf` trims the box row, and a trimmed line under 24 chars
    // can't end in whitespace, so an untrimmed needle would false-negative on
    // any short first line ending in a space/tab (a markdown hard break, e.g.).
    // (`needle` itself is now computed above, ahead of the queue's `run` —
    // see that computation's own comment for why the `resumeIfOwn` branch
    // needs it earlier than this echo-verification loop does.)
    let after: string | null = null;

    if (attachments.length > 0) {
      // Attachment prompts all begin with the same ~24 chars of clips path
      // (e.g. /home/you/.cc-cli…), so the whole-pane check below would
      // happily match an identical path left in the scrollback by an earlier
      // turn. Prove the echo against the INPUT BOX instead: it was verified
      // empty a few lines up, so a needle on the box row can only be what we
      // just typed. Ordinary text (the branch below) has no such collision
      // risk and keeps the battle-tested whole-pane check.
      let echoed = needle === '';
      // THE FRESHEST MEASUREMENT, absent included, and NOT "did any poll ever
      // see a box". Three answers have to reach the refusals below and one
      // boolean cannot carry them: `null` = every capture failed (the session
      // is gone), `{box:'absent'}` = a capture came back with no input box in
      // it, `{box:'present'}` = a reading of the box itself.
      //
      // WHY THE LAST POLL DECIDES AND "EVER" DOES NOT (review finding, measured
      // against this arm): our own typing is what pushes an over-tall box out of
      // the capture window, so the ordinary sequence is a FIRST poll that still
      // sees the box — mid-render, before our text lands, which is the very race
      // this loop polls for — and later polls that see none. An ever-saw-a-box
      // flag is disarmed by that first poll, and on THIS arm the fall-through
      // fires the blind floor below into a box nothing can read: the operator's
      // own hundreds of rows, shredded by a clear that cannot see them.
      let lastBox: BoxRead | null = null;
      for (let i = 0; i < ECHO_TRIES && !echoed; i++) {
        await sleep(ECHO_POLL_MS);
        const ansi = await d.tmux.captureAnsi(id);
        if (ansi === null) continue;
        lastBox = draftOfMeasured(ansi);
        if (lastBox.box === 'absent') continue;
        if (lastBox.draft.startsWith(needle)) echoed = true;
      }
      if (!echoed) {
        after ??= await d.tmux.capture(id);
        // BEFORE THE CLEAR, because the clear is the dangerous half. The floor
        // below is fired BLIND — 2 presses per visual row of OUR text, sized off
        // what we typed and not off what the box holds — and the box we cannot
        // read may hold an operator's own hundreds of rows. Firing into it would
        // shred exactly the draft this file's refuse-never-destroy ruling exists
        // to protect. Say the box is unreadable and touch nothing.
        // A `null` reading is NOT this case: every capture failed, the session
        // is gone, and the clear below reports `dead` — which is what turns it
        // into `not-alive`. Only a pane that came back WITHOUT a box lands here.
        if (lastBox !== null && lastBox.box === 'absent') return { ok: false, error: 'box-unreadable', pane: (after ?? '').slice(-PANE_TAIL) };
        // A failed send must not stand a bare clip path in the live box — but
        // C-u can fail just like the replaceDraft clear above can, so clearBox
        // re-reads and reports what's left rather than assuming it worked.
        //
        // This used to press `parts.length` times, which under-clears every
        // multi-line prompt: C-u costs 2 presses per row, so an attachment
        // prompt (always ≥2 lines) kept its FIRST line — a bare clip path —
        // and the next send came back `draft-present` carrying exactly what
        // this feature exists to keep out of the box.
        //
        // The floor is fired BLIND, because we are here precisely because the
        // box would not show us what we typed: a clear that stops when the box
        // "reads empty" believes the same stale frame that failed the echo and
        // stops after one press. We know exactly what we typed, so we know
        // what it costs — 2 presses per visual row — and no read is needed to
        // spend it. The look rounds after it only report residue.
        const floor = 2 * visualRows(parts, paneWidth(pane)) - 1;
        const cleared = await clearBox(d, id, sleep, { blind: floor, look: CLEAR_EXTRA_PRESSES });
        // A pane that died mid-clear is `not-alive`, the same as at the
        // replaceDraft site: `verify-failed` with no residue is byte-identical
        // to a clean clear, so reporting it that way told the caller "cleared"
        // when the truth is "unknown, and the session is gone".
        if (cleared.state === 'dead') return { ok: false, error: 'not-alive' };
        // THE THIRD CLEAR SITE, and the last place the new distinction was
        // still narrowed back. The box was readable on the last echo poll — the
        // refusal above proves it — and left the window WHILE the clear was
        // running, which the blind floor can do all by itself by growing what
        // it was meant to shrink. Reporting that as `verify-failed` claims
        // something about a box ("it never echoed") that nothing can see, and
        // drops the one sentence that names the remedy. `menu` keeps its own
        // spread below for the reason its comment gives; this is not that.
        if (cleared.state === 'unreadable') return { ok: false, error: 'box-unreadable', pane: (after ?? '').slice(-PANE_TAIL) };
        return {
          ok: false,
          error: 'verify-failed',
          pane: (after ?? '').slice(-PANE_TAIL),
          // `menu` reports no residue: with a dialog up the row draftOf reads
          // is the selected OPTION, and handing the user "1. Yes" back as
          // their leftover draft is worse than saying nothing. The pane tail
          // shows the menu.
          ...(cleared.state === 'residue' ? { draft: cleared.draft } : {}),
        };
      }
    } else {
      // BOX-SCOPED, not whole-pane. `after.includes(needle)` proved only that
      // the characters appear SOMEWHERE on screen — and a session's scrollback
      // routinely holds the operator's own earlier phrasing of the same
      // request, so a send into a box that never rendered passed the check,
      // pressed Enter into nothing, and returned ok:true. The attachment path
      // above has read the box for exactly this reason since it shipped; the
      // difference was never a real distinction between the two payload shapes.
      //
      // This converts some silent false-successes into `verify-failed`
      // refusals. That is the point, and it is safe because such a refusal
      // leaves the text in the box and REPORTS the box, so the operator can see
      // what is actually there instead of being sent to a terminal blind.
      //
      // ONE capture per poll, as before: the ansi read REPLACES the plain one
      // rather than joining it, so the success path's budget is unchanged.
      let echoed = needle === '';
      // The same three answers as the attachment arm's twin, in one value — see
      // its comment for why the LAST poll decides. This also retires the old
      // `let lastAnsi = ''`, which was '' both for "twelve dead captures" and
      // for "a live pane whose box read empty" and so could not be read back
      // safely at all; the measured reading carries that distinction itself.
      let lastBox: BoxRead | null = null;
      // The capture `lastBox` was read from, set in the same breath, so it is
      // null exactly when `lastBox` is: the paste-chip arm below reads the
      // whole box from it, not just the marker row `lastBox` carries.
      let lastPane: string | null = null;
      for (let i = 0; i < ECHO_TRIES && !echoed; i++) {
        await sleep(ECHO_POLL_MS);
        const ansi = await d.tmux.captureAnsi(id);
        if (ansi === null) continue;
        lastBox = draftOfMeasured(ansi);
        lastPane = ansi;
        if (lastBox.box === 'absent') continue;
        if (lastBox.draft.startsWith(needle)) echoed = true;
      }
      if (!echoed) {
        // EVERY capture failed: the session is gone, and none of what the arm
        // below says is true of it — there is no box holding the text, and no
        // draft to hand back. Answering `verify-failed` with an empty draft
        // made a dead pane byte-identical to a live one that never rendered.
        // The attachment path's own clear reports `dead` for exactly this and
        // returns `not-alive`; this is the same question and the same answer.
        if (lastBox === null || lastPane === null) return { ok: false, error: 'not-alive' };
        // D-5087: the box holds OUR whole message behind ONE
        // paste chip, proven by `ownPasteChip`'s four guards. Then the needle
        // never matching is the widget's rendering, not a failed send, and the
        // Enter the operator would otherwise press (a tap, or at the terminal)
        // is pressed here, with the same submit proof every send gets: the chip
        // row must leave the box (`submitted`). An Enter swallowed twice comes
        // back `enter-ignored` with `submittable`, the chip as its draft. Any
        // other shape, chips that fail a guard included, falls through to the
        // refusal below exactly as before.
        const ownChip = ownPasteChip(lastPane, parts, provenance);
        if (ownChip !== null) return pressEnterAndConfirm(d, id, sleep, stillStartsWith(ownChip.slice(0, ECHO_NEEDLE)));
        // D-5088: the box is the RENDERING of what we typed, read
        // whole: a row-capped box whose marker row is a later line (or a blank
        // one), or long lines drawn as chips among our own rows. Proven by
        // `ownRenderedBox`'s guards, and submitted with the proof that OUR TAIL
        // (the last characters in view) left the box, since the marker row of a
        // row-capped box is no part of the message we can name in advance.
        const ownTail = ownRenderedBox(lastPane, parts, provenance);
        if (ownTail !== null) return pressEnterAndConfirm(d, id, sleep, stillContains(ownTail));
        // THE TEXT STAYS IN THE BOX — no clearBox, no C-u (operator ruling:
        // refuse, never destroy). That was already true; what was missing was
        // saying so. Hand back the box row, FOR DISPLAY, exactly as the
        // attachment arm hands back its residue.
        //
        // AND NO `submittable`. Reaching here means the box never started with
        // our needle on any poll, so what the row holds is an empty box, or
        // somebody else's words, or a partial render of our own message — a
        // fragment, which is the one shape this flag was invented to keep a
        // rescue away from. The case that would deserve it cannot arrive here:
        // a box holding our whole message sets `echoed`. See
        // `SendResult.submittable`. (Two corrections stand below and above
        // this paragraph: a chip-led row is the FOURTH SHAPE, and a box the two
        // arms above can read whole as ours never reaches here at all.)
        //
        // The pane tail is a PLAIN capture, taken once, here — it is display
        // for a human, and the escape codes would only make it unreadable.
        after = await d.tmux.capture(id);
        // EVERY POLL CAME BACK WITHOUT A BOX. `verify-failed` would be a claim
        // about the box ("it never echoed the text"), and there was no box to
        // make a claim about; `draft` would be '' from the collapse, which the
        // PWA renders as "the session never echoed it back" — false, and it
        // sends the operator looking in the wrong place. The text is in the box
        // and untouched either way; only the name changes, and the name is what
        // tells them to go clear an over-tall draft.
        if (lastBox.box === 'absent') return { ok: false, error: 'box-unreadable', pane: (after ?? '').slice(-PANE_TAIL) };
        const lastDraft = lastBox.draft;
        // THE FOURTH SHAPE, and the one the flag's own docstring called
        // unreachable. Claude Code collapses a large typed burst into
        // `[Pasted text #N]` — the box then holds our WHOLE message and shows a
        // chip instead of it, so `startsWith(needle)` is false on every poll and
        // we arrive here having proved the opposite of what is true.
        //
        // THE CLAIM IS PROVENANCE, NOT TEXT, which is the distinction this file
        // already draws for `ownStrandedClear`: no property of the string
        // `[Pasted text #1]` says it is ours. What says so is the sequence —
        // the box was proven empty or cleared before the type loop (the
        // `draft-present` gate above is the only way past it), this call holds
        // the session's queue slot, and the chip appeared after our own
        // `sendLiteral`. The window in which a human at the terminal could have
        // pasted between those two acts is the same window every other check
        // here already lives with.
        //
        // AND THE RESCUE IS ALREADY CORRECT FOR IT. `submitEnter` compares the
        // box row against `expect` and, after Enter, proves OUR TEXT left using
        // `draft.slice(0, ECHO_NEEDLE)` — the needle comes from the row it just
        // read, so a chip verifies as a chip. Nothing downstream needs to learn
        // about paste chips; this arm only stops withholding the flag.
        //
        // It stays a REFUSAL HERE, for every chip `ownPasteChip` above would not
        // vouch for (two chips on the row, a chip with rows below it, a line
        // count that is not ours, a line too short to have collapsed): the
        // operator taps Send it. The machine does not submit a box it could not
        // read, which is the whole of §4.1's argument and is untouched. The one
        // shape it now submits itself is the one it CAN read whole.
        return {
          ok: false, error: 'verify-failed', pane: (after ?? '').slice(-PANE_TAIL),
          draft: lastDraft,
          ...(PASTE_CHIP.test(lastDraft) ? { submittable: true } : {}),
        };
      }
    }

    // Enter is not reliably a submit. Claude Code's box swallows it while an
    // overlay is up — the slash-command palette, an `@`-mention picker, a
    // mid-render frame — and the text just sits there. Returning ok:true on the
    // keystroke alone reported success for messages that were never sent: the
    // PWA's optimistic bubble then expired on its own timer and the message
    // vanished with no error anywhere. So: press, confirm OUR TEXT left the box
    // (see `submitted`), press once more if it didn't (that second Enter is
    // what submits after an overlay consumed the first), and only then claim
    // it landed. (`pressEnterAndConfirm` — shared with the `resumeIfOwn`
    // branch above, which presses Enter on text already sitting in the box
    // instead of reaching this point at all.)
    return pressEnterAndConfirm(d, id, sleep, stillStartsWith(needle));
  });
}

/** A box-horizontal rule row — the same convention `pane/dialog.ts`'s private
 *  `isRule` matches for AskUserQuestion separators (a run of `─`), reused
 *  here for the identical glyph Claude Code draws immediately below the
 *  input box itself (see `LIVE_CU_FRAMES` in `test/send.test.ts`: the closing
 *  rule sits right after the box's last row, with no gap, at every height
 *  those live captures measured — 1 to 3 rows). */
const isRuleRow = (line: string): boolean => {
  const t = line.trim();
  return t.length >= 8 && [...t].every((c) => c === '─' || c === ' ');
};

/**
 * Every non-blank box row STRICTLY BELOW the marker row, in order, up to
 * (not including) the closing rule — the content `draftOf` never reads,
 * because its documented contract is the marker row only (see its own
 * docstring). Shared by `hasContentBelowMarker` (presence only) and
 * `resumeIfOwn`'s per-delivery discrimination below (the first row's
 * CONTENT, not just whether one exists).
 *
 * Reachable end-to-end, but NO LONGER FROM US. `sendPrompt` used to write a
 * leading blank line with `M-Enter` whenever the composed prompt's first
 * `\n`-split part was `''` (its own `parts` loop above); Task 402 made
 * `composePrompt` strip leading blank lines, and `sendPrompt` calls it itself,
 * so no caller — the app's Composer, the coordinator, a curl — can manufacture
 * that shape any more. The two producers that remain are a HUMAN pressing Enter
 * in the box before typing, and any pre-402 client still on the wire; the
 * clobber guard's own comment above states the same position, which is the one
 * to trust. Either way the shape is a blank marker row with real text one row
 * down, invisible to `draftOf` — which is why this function exists.
 *
 * The real captures back exactly one claim, and this function is scoped to
 * only that claim: a rule row closes the box immediately, so any non-blank
 * row between the marker and the first rule row is box content, never
 * chrome (chrome is only ever seen AFTER that rule — and shares the box's
 * own two-space indent, which is why indentation alone cannot tell a
 * continuation row from chrome: only the rule boundary can). This proves
 * PRESENCE (of each row), not identity beyond the row's own text — a pasted
 * separator line could itself look like a rule and cut the scan short
 * (under-detecting, the safe direction).
 */
function continuationRows(ansiPane: string): string[] {
  const lines = ansiPane.split('\n');
  let markerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.replace(SGR, '').startsWith('❯')) markerIdx = i;   // last ❯ line, same as draftOf
  }
  if (markerIdx === -1) return [];
  const rows: string[] = [];
  for (let i = markerIdx + 1; i < lines.length; i++) {
    const stripped = lines[i]!.replace(DIM_SPAN, '').replace(SGR, '');
    if (isRuleRow(stripped)) break;
    if (stripped.trim() !== '') rows.push(stripped.trim());
  }
  return rows;
}

/** Is there box content strictly BELOW the marker row? See `continuationRows`
 *  — this only asks whether that array is non-empty; the result is never used
 *  to build a submit needle or to press Enter, only to decide whether
 *  claiming the box is empty would be false. */
function hasContentBelowMarker(ansiPane: string): boolean {
  return continuationRows(ansiPane).length > 0;
}

/**
 * Everything the box holds, marker row first, blank rows dropped — the text a
 * clobber refusal is REFUSING TO DESTROY, and therefore the text the operator
 * has to be shown before deciding to replace or append to it.
 *
 * `draftOf` alone is the marker row, which is the wrong unit for that question
 * twice over: a wedge whose marker row is blank reads as an empty box, and an
 * ordinary two-line human draft reads as its first line, so the PWA's conflict
 * sheet showed one row and "Append anyway" retyped that row plus the new text —
 * silently destroying rows 2..N.
 *
 * NOT used for `enter-ignored`. That refusal's `draft` is a CORRESPONDENCE
 * CLAIM handed back to `submitEnter`, whose gate compares `draftOf`'s
 * single-row reading against it; a multi-row claim would refuse `box-mismatch`
 * on every rescue. Two questions, two readings, deliberately.
 */
const boxText = (ansiPane: string): string =>
  [draftOf(ansiPane), ...continuationRows(ansiPane)].filter((r) => r !== '').join('\n');

/**
 * Press Enter once on a box that already holds `expect`.
 *
 * The rescue for `sendPrompt`'s `enter-ignored`: the text is verified present
 * and the operator's only remedy today is the sentence "open the terminal to
 * check". A message that tells the user to do something the UI could do is the
 * same dead end as a hidden force-delete button.
 *
 * ONE Enter, verified. `sendPrompt` already spent two on this box; a third
 * fired in a loop would carry no information the first two didn't. A human tap
 * does: they looked at the pane first.
 *
 * `expect` is the CORRESPONDENCE GATE, and it is not optional. Enter submits
 * whatever the box holds, which is not necessarily what the caller thinks it
 * holds: between the failed send and the tap, a second send can clear the box
 * and type its own message (`sendPrompt`'s `replaceDraft` fires `C-u` and
 * retypes), or a second `enter-ignored` can leave a DIFFERENT message sitting
 * there. Pressing Enter then sends someone else's text while the caller
 * attributes the outcome — success included — to the message it was rescuing.
 * So the caller must state what it believes is in the box (the `draft` the
 * 409 handed it, which is this same `draftOf` reading), and this refuses with
 * its own name unless the box still reads exactly that. It is the same stance
 * `answerAsk` takes with `askKey` and its menu-identity gate: answer the thing
 * you were shown, or answer nothing.
 *
 * The comparison is the box's MARKER ROW, trimmed, both sides — that row is
 * all `draftOf` can see and all the 409 could have carried, so equality of it
 * is exactly as much correspondence as exists to prove. A longer message that
 * differs only below its first row is therefore not distinguished; what IS
 * distinguished is the case that actually happens (a cleared or replaced box).
 */
export function submitEnter(
  d: SendDeps,
  id: string,
  expect: string,
): Promise<{ ok: true } | { ok: false; error: 'not-alive' | 'dialog-open' | 'box-unreadable' | 'nothing-to-submit' | 'blank-first-row' | 'box-mismatch' | 'enter-ignored' }> {
  const sleep = d.sleep ?? defaultSleep;
  return d.queue.run(id, async () => {
    const pane = await d.tmux.captureAnsi(id);
    if (pane === null) return { ok: false, error: 'not-alive' as const };
    // Same reasoning as sendPrompt's own guard: with a menu up the only `❯` on
    // screen is the cursor on the selected OPTION, so draftOf would read a menu
    // row as a draft and this would press Enter on somebody's question.
    if (hasMenu(pane.replace(SGR, ''))) return { ok: false, error: 'dialog-open' as const };
    // No box in the capture: `nothing-to-submit` and `blank-first-row` are both
    // claims about a box that is there, and the correspondence gate below would
    // compare the operator's `expect` against a reading of nothing. Pressing
    // Enter on that is exactly the unproven submit this function's gate exists
    // to refuse. (The rescue button is gated on `submittable`, which no arm sets
    // for an unreadable box, so this is belt and braces — and belt and braces is
    // the standing of every other check in here.)
    const read = draftOfMeasured(pane);
    if (read.box === 'absent') return { ok: false, error: 'box-unreadable' as const };
    const draft = read.draft;
    if (draft === '') {
      // Blank marker row: usually a genuinely empty box, but see
      // `hasContentBelowMarker` — a box whose FIRST row is blank with real text
      // one row down renders identically on THIS row. Naming that case honestly
      // beats claiming there is nothing to send when there might be.
      //
      // NOT "a message whose first line is itself blank", which is what this
      // said before the wave-check: Task 402 made `composePrompt` strip leading
      // blank lines, so our own message cannot carry one. `continuationRows`
      // and the clobber guard both state the producers that remain — a human
      // pressing Enter in the box first, and any pre-402 client.
      //
      // NEITHER token says anything about the caller's message. An empty box
      // is not proof that it went through: `clearBox` empties one too.
      return hasContentBelowMarker(pane)
        ? { ok: false, error: 'blank-first-row' as const }
        : { ok: false, error: 'nothing-to-submit' as const };
    }
    // A box holding something, but not what the caller was shown.
    if (draft !== expect.trim()) return { ok: false, error: 'box-mismatch' as const };

    await d.tmux.sendKey(id, 'Enter');
    // The same proof sendPrompt uses: OUR TEXT left the box, not "the box is
    // empty" — a busy session swaps the row for its queue hint instead.
    const needle = draft.slice(0, ECHO_NEEDLE);
    return (await submitted(d, id, sleep, stillStartsWith(needle)))
      ? { ok: true as const }
      : { ok: false, error: 'enter-ignored' as const };
  });
}

/** `answerDialog`'s answer. The refusals are `DialogRefuseCode` (`shared/api.ts`), where each is described. */
export type DialogResult = DialogAnswered | { ok: false; error: DialogRefuseCode };

/** `settleNext`'s pause between captures, and its wall-clock budget from the answer's last key. */
const SETTLE_POLL_MS = 100;
const SETTLE_BUDGET_MS = 1500;

/** What a capture shows, as the session stream would frame it: the menu `parseDialog` reads, or null for no menu
 *  (the same `hasMenu` gate as `sessionws.ts`'s `checkDialog`, SGR stripped). */
function screenOf(pane: string): Dialog | null {
  return hasMenu(pane.replace(SGR, '')) ? parseDialog(pane) : null;
}

/**
 * The screen an answer moved the pane to (decision `ask-answer-returns-next-screen`): captured every 100 ms after the
 * answer's last key, for at most 1.5 s of wall-clock time (`d.now`; each capture is raced against what is left of it,
 * so a slow remote capture cannot hold the session's keyboard queue past it), until the pane shows a screen other than
 * the one answered (`still` says which screens are still that one) TWICE IN A ROW, so a capture taken mid-repaint is never returned as the next screen. The
 * screen is a Dialog, or null for no menu at all (the ask was submitted or declined). Absent (`{}`) when the pane did
 * not settle on another screen within the budget, which leaves the caller on the session stream's next frame, as before.
 *
 * Why it exists (the 2026-10-16 report): the sheet that answered the last question learned of the review screen only
 * from the stream's 2 s poll. One poll that saw no menu sent `dialog_cleared`, and until a later poll sent the review,
 * the envelope sheet had nothing to match and showed "Open terminal to answer". The answer's own route has the
 * keyboard queue and the pane: it can say where the pane went.
 *
 * A failed capture (null) is no reading: it neither moves nor settles. Reads only; it never sends a key.
 */
async function settleNext(
  d: SendDeps, id: string, still: (dialog: Dialog) => boolean, sleep: (ms: number) => Promise<void>,
): Promise<{ next?: Dialog | null }> {
  const now = d.now ?? Date.now;
  const deadline = now() + SETTLE_BUDGET_MS;
  let seen: { next: Dialog | null; key: string } | null = null;
  for (;;) {
    if (now() >= deadline) return {};
    await sleep(Math.min(SETTLE_POLL_MS, deadline - now()));
    if (now() >= deadline) return {};
    const pane = await captureWithin(d, id, deadline - now());
    if (now() >= deadline || pane === OUT_OF_TIME) return {};
    if (pane === null) continue;
    const next = screenOf(pane);
    if (next !== null && still(next)) {
      seen = null;
      continue;
    }
    const key = next === null ? '' : `${next.id}\n${next.parsed ? '' : next.raw}`;
    if (seen !== null && seen.key === key) return { next };
    seen = { next, key };
  }
}

const OUT_OF_TIME = Symbol('out-of-time');

/** One capture, given up on after `ms` of real time. On the fleet a capture is a remote call that can wait 15 s, and
 *  `settleNext` runs inside the session's keyboard queue: the budget has to bound the wait, not only the count. A
 *  capture given up on is left to finish on its own; nothing reads it. */
function captureWithin(d: SendDeps, id: string, ms: number): Promise<string | null | typeof OUT_OF_TIME> {
  let timer: NodeJS.Timeout | undefined;
  const out = new Promise<typeof OUT_OF_TIME>((resolve) => {
    timer = setTimeout(() => resolve(OUT_OF_TIME), Math.max(0, ms));
    timer.unref?.();
  });
  return Promise.race([d.tmux.capture(id), out]).finally(() => clearTimeout(timer));
}

/**
 * Answer a pane menu dialog by walking the ❯ marker to `optionIndex` and
 * confirming. Refuses when the on-screen dialog no longer matches `dialogId`
 * (stale) and never presses Enter unless the re-captured pane proves the
 * marker landed on the requested option.
 *
 * Never on an AskUserQuestion's free-text row (D-5045): Enter there while it
 * is empty rejects the WHOLE ask, every answered question with it, and a row
 * that holds text would be submitted as an answer the caller never typed here.
 * `freeTextRow` is asked twice. First on the screen the request was checked
 * against, before any key. Then on the screen the walk landed on, before
 * Enter, because the pane can move on between the two captures and put the
 * free-text row under the requested index. `walk-failed` cannot see that: the
 * cursor IS on that index. Walking THROUGH the row to "Chat about this" stays
 * allowed. Up and Down never select or submit, and Enter on Chat after such a
 * walk was measured to give Chat's own outcome.
 *
 * Never on an unparsed menu (`unparsed-dialog`), checked on both screens: its `selectedIndex` is a constant 1 that
 * proves nothing about the cursor. A multiSelect question is one (D-5048 keeps it `parsed: false`, its rows on
 * `Dialog.multi`), and Enter there toggles a box, ticks the empty free-text box, or commits the question from
 * Next/Submit, measured on 2.1.300. `/dialog/multi` answers it.
 */
export function answerDialog(
  d: SendDeps,
  id: string,
  dialogId: string,
  optionIndex: number,
): Promise<DialogResult> {
  const sleep = d.sleep ?? defaultSleep;
  return d.queue.run(id, async (): Promise<DialogResult> => {
    const pane = await d.tmux.capture(id);
    if (pane === null) return { ok: false, error: 'not-alive' };

    const dialog = parseDialog(pane);
    if (!dialog || dialog.id !== dialogId) return { ok: false, error: 'stale-dialog' };
    if (freeTextRow(pane) === optionIndex) return { ok: false, error: 'free-text-row' };
    if (!dialog.parsed) return { ok: false, error: 'unparsed-dialog' };

    await walkCursor(d, id, dialog.selectedIndex, optionIndex, sleep);

    const after = await d.tmux.capture(id);
    const landed = after === null ? null : parseDialog(after);
    if (after === null || !landed) return { ok: false, error: 'walk-failed' };
    if (!landed.parsed) return { ok: false, error: 'unparsed-dialog' };
    if (landed.selectedIndex !== optionIndex) return { ok: false, error: 'walk-failed' };
    if (freeTextRow(after) === optionIndex) return { ok: false, error: 'free-text-row' };

    await d.tmux.sendKey(id, 'Enter');
    return { ok: true, ...(await settleNext(d, id, (now) => now.id === dialogId, sleep)) };
  });
}

/** The pause after each walk key, so the TUI has repainted the cursor before the next key or the landing capture. */
const WALK_STEP_MS = 150;

/**
 * Walk a menu's ❯ cursor from row `from` to row `to`: one Down (or Up) per row, with a pause after each. Up and Down
 * only move the cursor. They never select, submit or type, which is why a walk is safe across any row, the free-text
 * row included. The one walk `answerDialog` and `answerDialogText` (D-5047) both send. Each caller re-captures
 * afterwards and proves where the cursor landed before it presses anything else.
 */
async function walkCursor(
  d: SendDeps, id: string, from: number, to: number, sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const delta = to - from;
  const key = delta > 0 ? 'Down' : 'Up';
  for (let i = 0; i < Math.abs(delta); i++) {
    await d.tmux.sendKey(id, key);
    await sleep(WALK_STEP_MS);
  }
}

/** `answerDialogText`'s answer. The refusals are `DialogTextRefuseCode` (`shared/api.ts`), where each is described. */
export type DialogTextResult = DialogAnswered | { ok: false; error: DialogTextRefuseCode };

/** Whitespace runs collapsed and the ends trimmed: how a row's text and the caller's text are compared. The pane keeps
 *  no run: `leftCol` cuts a label at two spaces, and a wrapped answer's rows are joined back with one space. */
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** What a parsed menu row shows: its label, then its description. A typed answer longer than one screen row is read
 *  as its first row (the label) and the rest (the description), so the two together are the whole text (measured
 *  exact for a 1000-character answer, `cc300-ask-freetext-1000.txt`). */
const rowText = (row: Dialog['options'][number]): string =>
  collapse(row.description === undefined ? row.label : `${row.label} ${row.description}`);

/**
 * Type `text` into an AskUserQuestion's free-text ("Type something.") row and submit it as the answer (D-5047,
 * `POST /api/sessions/:id/dialog/text`). Enter on that row while it is EMPTY rejects the WHOLE ask and discards every
 * question already answered (measured on Claude Code 2.1.300 and 2.1.291), so each step is proved on a fresh capture:
 *
 *  1. `isDialogText` (`shared/api.ts`) or `bad-text`, before the pane is touched.
 *  2. The menu is the one the caller was shown (`stale-dialog`), and the row is its free-text row (`freeTextRow`), read
 *     off a parsed menu (`not-free-text`). An unparsed multiSelect question has no parsed rows, so free text inside a
 *     multiSelect is refused here (not in v1). The row is either the empty placeholder, which is typed into, or it
 *     already holds exactly this text, the retry arm below. Any other text in it is `not-free-text`: typing appends.
 *  3. The walk (`walkCursor`, shared with `answerDialog`).
 *  4. FOCUS: a capture shows the same title, the cursor on the row, the row still as step 2 read it, and the footer's
 *     edit hint (`editHintShown`). Measured: the hint outlives the row after a walk through it, so it never proves
 *     focus alone. Otherwise `focus-failed`, with nothing typed.
 *  5. The text, after tmux's `--` (D-5046). A literal send tmux refuses is `echo-failed`, with no Enter.
 *  6. ECHO, polled as `sendPrompt` polls its own: a capture shows the same title, the cursor still on the row, and the
 *     row holding exactly the text. The dialog id is NOT compared: typing changes it, since it hashes the labels and
 *     the row's label is now the text. A row that still reads as the placeholder proves nothing, even when the text
 *     is those very words. Otherwise `echo-failed`, and NO Enter.
 *  7. Enter.
 *
 * The retry arm: a send that typed but never proved its echo leaves the text in the row. Measured: the text survives
 * stepping off and back on, the hint returns on the held row, and Enter there submits the text. So a row that holds
 * exactly this text is walked to and proved at step 4 (which then proves the echo too), and submitted without typing.
 */
export function answerDialogText(
  d: SendDeps,
  id: string,
  dialogId: string,
  optionIndex: number,
  text: string,
): Promise<DialogTextResult> {
  if (!isDialogText(text)) return Promise.resolve({ ok: false, error: 'bad-text' });
  const sleep = d.sleep ?? defaultSleep;
  const want = collapse(text);
  return d.queue.run(id, async (): Promise<DialogTextResult> => {
    const pane = await d.tmux.capture(id);
    if (pane === null) return { ok: false, error: 'not-alive' };

    const dialog = parseDialog(pane);
    if (!dialog || dialog.id !== dialogId) return { ok: false, error: 'stale-dialog' };
    const row = dialog.options.find((o) => o.index === optionIndex);
    if (row === undefined || freeTextRow(pane) !== optionIndex) return { ok: false, error: 'not-free-text' };
    const held = !FREE_TEXT_PLACEHOLDER_RE.test(row.label);
    if (held && rowText(row) !== want) return { ok: false, error: 'not-free-text' };

    /** Is `screen` this request's row: the same title, the cursor on it, and holding what this arm needs? */
    const onRow = (screen: Dialog | null, holds: 'empty' | 'text'): boolean => {
      if (screen === null || screen.title !== dialog.title || screen.selectedIndex !== optionIndex) return false;
      const at = screen.options.find((o) => o.index === optionIndex);
      if (at === undefined) return false;
      const placeholder = FREE_TEXT_PLACEHOLDER_RE.test(at.label);
      return holds === 'empty' ? placeholder : !placeholder && rowText(at) === want;
    };

    await walkCursor(d, id, dialog.selectedIndex, optionIndex, sleep);

    const after = await d.tmux.capture(id);
    if (after === null || !onRow(parseDialog(after), held ? 'text' : 'empty') || !editHintShown(after)) {
      return { ok: false, error: 'focus-failed' };
    }

    if (!held) {
      if (!(await d.tmux.sendLiteral(id, text))) return { ok: false, error: 'echo-failed' };
      let echoed = false;
      for (let i = 0; i < ECHO_TRIES && !echoed; i++) {
        await sleep(ECHO_POLL_MS);
        const seen = await d.tmux.capture(id);
        echoed = seen !== null && onRow(parseDialog(seen), 'text');
      }
      if (!echoed) return { ok: false, error: 'echo-failed' };
    }

    await d.tmux.sendKey(id, 'Enter');
    // Typing changed this screen's id (it hashes the row's label), so "still this question" is its title and every
    // other row's label, the pwa's `questionKey` rule.
    const others = (screen: Dialog): string[] => screen.options.filter((o) => o.index !== optionIndex).map((o) => o.label);
    const same = (screen: Dialog): boolean =>
      screen.parsed && screen.title === dialog.title && others(screen).join('\n') === others(dialog).join('\n');
    return { ok: true, ...(await settleNext(d, id, same, sleep)) };
  });
}

/** `answerDialogMulti`'s answer. The refusals are `DialogMultiRefuseCode` (`shared/api.ts`), where each is described. */
export type DialogMultiResult = DialogAnswered | { ok: false; error: DialogMultiRefuseCode };

/**
 * Answer a multiSelect AskUserQuestion question (D-5048, `POST /api/sessions/:id/dialog/multi`): leave exactly the
 * boxes `optionIndexes` names ticked, then commit the question. Measured on Claude Code 2.1.300 (2.1.280 agrees):
 *  - a digit k toggles box k, ticking or unticking it, and the cursor does not move;
 *  - Enter TOGGLES the cursor row and commits nothing, which is why `answerAsk` refuses this question;
 *  - Tab from an option row commits the ticks and moves on, to the next question or the review screen;
 *  - with the cursor on the free-text row a digit is TYPED into it, and Tab on the `Next` row after a walk through the
 *    free-text row was swallowed, the screen byte-identical;
 *  - the answer lists the boxes in the order they were ticked, and a revisited question keeps its ticks.
 *
 * So, each step on a fresh capture:
 *  1. `isDialogMultiIndexes` (`shared/api.ts`) or `bad-indexes`, before the pane is touched.
 *  2. The menu is the one the caller was shown (`stale-dialog`; the id holds across ticks and cursor moves), and it is
 *     a multiSelect question `parseDialog` reads into `Dialog.multi` (`not-multiselect`).
 *  3. Every index is one of the question's own options (`not-an-option`): never the free-text row, which v1 does not
 *     answer, nor `Chat about this`.
 *  4. The free-text box is clear (`free-text-ticked`), since Tab would commit it with the options.
 *  5. The cursor rests on an option row and the footer shows no edit hint (`cursor-not-on-option`). Nothing walks it
 *     there: on the free-text row a digit is typed, and below it Tab was swallowed.
 *  6. A digit for each box whose tick differs from the wanted set: those to untick first, in screen order, then those
 *     to tick, in the order asked, so the answer lists them that way after any box already ticked.
 *  7. TICKS, polled as `sendPrompt` polls its echo: a capture shows the same dialog id, exactly the wanted boxes
 *     ticked, the free-text box clear, the cursor on the row it was on, and no edit hint. Else `ticks-failed`, NO Tab.
 *  8. Tab.
 *  9. MOVED, polled the same way: a capture shows a menu under another TITLE, the next question or the review screen
 *     (a multiSelect question is always followed by one of them). Not the id: text typed into the free-text row
 *     changes the id under the same title, and that is no commit. Else `commit-failed`.
 *
 * Every proof is a capture, never a key's exit code: a digit that did not land fails step 7, a Tab that did not land
 * fails step 9.
 */
export function answerDialogMulti(
  d: SendDeps,
  id: string,
  dialogId: string,
  optionIndexes: readonly number[],
): Promise<DialogMultiResult> {
  if (!isDialogMultiIndexes(optionIndexes)) return Promise.resolve({ ok: false, error: 'bad-indexes' });
  const sleep = d.sleep ?? defaultSleep;
  const want = new Set(optionIndexes);
  return d.queue.run(id, async (): Promise<DialogMultiResult> => {
    const pane = await d.tmux.capture(id);
    if (pane === null) return { ok: false, error: 'not-alive' };

    const dialog = parseDialog(pane);
    if (!dialog || dialog.id !== dialogId) return { ok: false, error: 'stale-dialog' };
    const multi = dialog.multi;
    if (multi === undefined) return { ok: false, error: 'not-multiselect' };
    const option = (i: number) => multi.options.find((o) => o.index === i);
    if (optionIndexes.some((i) => option(i) === undefined)) return { ok: false, error: 'not-an-option' };
    if (multi.freeText?.checked === true) return { ok: false, error: 'free-text-ticked' };
    const cursor = multi.cursor;
    if (typeof cursor !== 'number' || option(cursor) === undefined || editHintShown(pane)) {
      return { ok: false, error: 'cursor-not-on-option' };
    }

    const untick = multi.options.filter((o) => o.checked && !want.has(o.index)).map((o) => o.index);
    const tick = optionIndexes.filter((i) => !option(i)!.checked);
    for (const k of [...untick, ...tick]) {
      await d.tmux.sendKey(id, String(k));
      await sleep(WALK_STEP_MS);
    }

    /** Does `screen` show this question with exactly the wanted ticks, the cursor where it was, and no hint? */
    const ticked = (screen: string | null): boolean => {
      if (screen === null || editHintShown(screen)) return false;
      const now = parseDialog(screen);
      if (now === null || now.id !== dialogId || now.multi === undefined) return false;
      return now.multi.cursor === cursor && now.multi.freeText?.checked !== true &&
        now.multi.options.every((o) => o.checked === want.has(o.index));
    };
    let proved = false;
    for (let i = 0; i < ECHO_TRIES && !proved; i++) {
      await sleep(ECHO_POLL_MS);
      proved = ticked(await d.tmux.capture(id));
    }
    if (!proved) return { ok: false, error: 'ticks-failed' };

    await d.tmux.sendKey(id, 'Tab');

    let moved = false;
    for (let i = 0; i < ECHO_TRIES && !moved; i++) {
      await sleep(ECHO_POLL_MS);
      const seen = await d.tmux.capture(id);
      const next = seen === null ? null : parseDialog(seen);
      moved = next !== null && next.title !== dialog.title;
    }
    if (!moved) return { ok: false, error: 'commit-failed' };
    return { ok: true, ...(await settleNext(d, id, (now) => now.title === dialog.title, sleep)) };
  });
}

/** `moveDialogTab`'s answer. The refusals are `DialogTabRefuseCode` (`shared/api.ts`), where each is described. */
export type DialogTabResult = DialogTabMoved | { ok: false; error: DialogTabRefuseCode };

/** Where a screen's ❯ cursor rests: the printed row on a single-select question or the review, `Dialog.multi`'s
 *  reading on a multiSelect one. */
const cursorOf = (dialog: Dialog): number | 'commit' | null =>
  dialog.multi !== undefined ? dialog.multi.cursor : dialog.selectedIndex;

/**
 * Is the cursor somewhere Claude Code swallows ←/→? Measured on 2.1.296 and 2.1.302: on the free-text row, empty or
 * holding text, the arrows move its text caret (the screen stays byte for byte), and on `Chat about this` they do
 * nothing either. On a multiSelect question, anything but one of its own boxes (the free-text box, the commit row,
 * Chat), where only the boxes were measured to pass → on.
 */
function cursorOffOptions(pane: string, dialog: Dialog): boolean {
  if (dialog.multi !== undefined) {
    const at = dialog.multi.cursor;
    return typeof at !== 'number' || !dialog.multi.options.some((o) => o.index === at);
  }
  const free = freeTextRow(pane);
  if (free !== null && dialog.selectedIndex >= free) return true;
  const row = dialog.options.find((o) => o.index === dialog.selectedIndex);
  return row !== undefined && CHAT_ABOUT_ROW_RE.test(row.label.trim());
}

/**
 * Walk the cursor Up to row 1, one key at a time, capturing after each: the free-text row and Chat sit below the
 * options, and a multiSelect question's commit row is unnumbered, so the count is read off the screen rather than worked
 * out. Up only moves the cursor (typed text survives stepping off, 2.1.300 `walk-4-stepped-off`, and 2.1.296), and it is
 * never pressed on row 1, where it would wrap to the free-text row. The landing is the proof: the same question
 * (`title`) with the cursor on row 1. The returned screen is that landing, or null when the walk did not get there.
 */
async function walkToFirstRow(
  d: SendDeps, id: string, title: string, steps: number, sleep: (ms: number) => Promise<void>,
): Promise<Dialog | null> {
  for (let i = 0; i <= steps; i++) {
    const pane = await d.tmux.capture(id);
    const now = pane === null ? null : parseDialog(pane);
    if (now === null || now.title !== title) return null;
    if (cursorOf(now) === 1) return now;
    if (i === steps) return null;
    await d.tmux.sendKey(id, 'Up');
    await sleep(WALK_STEP_MS);
  }
  return null;
}

/**
 * Move an AskUserQuestion's PANE to another tab (decision `ask-dialog-tab-route`, `POST /api/sessions/:id/dialog/tab`):
 * ←/→ as Claude Code's own keys, so the sheet's arrows and its tab strip move the one thing that can answer, and the
 * sheet follows the screen it lands on. Measured on 2.1.296 (220x50) and 2.1.302: → from the last question is the
 * review (even with a question skipped, which the review then warns about); ← on question 1 and → on the review do
 * nothing; a revisited question marks its earlier answer ✔ and puts the cursor back on row 1.
 *
 * Each step on a fresh capture, and never Enter, Tab or a digit (Enter on an empty free-text row declines the whole ask):
 *  1. `isDialogTab` or `bad-request`, before the pane is touched.
 *  2. The menu is the one the caller was shown (`stale-dialog`), it paints a tab row (`parseAskTabs`, `no-tabs`), and it
 *     is a screen whose cursor can be read: parsed, or a multiSelect question (`unparsed-dialog`).
 *  3. The presses. The review is told by its own rows (`reviewRows`), so there the current tab is known: one past the
 *     last question. On a question it is not (colour alone marks it), so a numbered target takes the caller's `from`.
 *     → on the review is refused `no-move` with no key; a target already up answers ok with no key.
 *  4. Off the free-text row first: where the cursor rests on it or below it, ←/→ are swallowed, so it is walked Up to
 *     row 1 and the landing proved (`walk-failed` otherwise, with no arrow pressed).
 *  5. One arrow at a time, each proved by `settleNext`: a screen with another id, seen twice in a row. None within the
 *     budget is `no-move`, no menu at all is `menu-gone`. `submit` presses → until the review, at most once per tab.
 */
export function moveDialogTab(d: SendDeps, id: string, body: unknown): Promise<DialogTabResult> {
  if (!isDialogTab(body)) return Promise.resolve({ ok: false, error: 'bad-request' });
  const { dialogId, to, from } = body;
  const sleep = d.sleep ?? defaultSleep;
  return d.queue.run(id, async (): Promise<DialogTabResult> => {
    const pane = await d.tmux.capture(id);
    if (pane === null) return { ok: false, error: 'not-alive' };
    const dialog = parseDialog(pane);
    if (!dialog || dialog.id !== dialogId) return { ok: false, error: 'stale-dialog' };
    const row = parseAskTabs(pane);
    if (row === null) return { ok: false, error: 'no-tabs' };
    const onReview = reviewRows(dialog) !== null;
    if (!onReview && !dialog.parsed && dialog.multi === undefined) return { ok: false, error: 'unparsed-dialog' };

    const review = row.tabs.length + 1;
    let key: 'Left' | 'Right';
    let count: number;
    if (to === 'prev') {
      key = 'Left';
      count = 1;
    } else if (to === 'next' || to === 'submit') {
      if (onReview) return to === 'submit' ? { ok: true, next: dialog } : { ok: false, error: 'no-move' };
      key = 'Right';
      count = to === 'next' ? 1 : row.tabs.length;
    } else {
      const at = onReview ? review : from;
      if (to > row.tabs.length || at === undefined || at > review) return { ok: false, error: 'bad-request' };
      if (to === at) return { ok: true, next: dialog };
      key = to < at ? 'Left' : 'Right';
      count = Math.abs(to - at);
    }

    let now: Dialog = dialog;
    if (!onReview && cursorOffOptions(pane, dialog)) {
      // A multiSelect reading's numbered rows are its boxes (`Dialog.options` is empty there): below them sit the
      // free-text box, the commit row and Chat, so the walk from Chat is at most boxes + 2 Ups.
      const rows = dialog.multi !== undefined ? dialog.multi.options.length : dialog.options.length;
      const landed = await walkToFirstRow(d, id, dialog.title, rows + 3, sleep);
      if (landed === null) return { ok: false, error: 'walk-failed' };
      now = landed;
    }

    for (let i = 0; i < count; i++) {
      await d.tmux.sendKey(id, key);
      const prev = now.id;
      const moved = await settleNext(d, id, (s) => s.id === prev, sleep);
      if (moved.next === undefined) return { ok: false, error: 'no-move' };
      if (moved.next === null) return { ok: false, error: 'menu-gone' };
      now = moved.next;
      if (to === 'submit' && reviewRows(now) !== null) return { ok: true, next: now };
    }
    return to === 'submit' ? { ok: false, error: 'no-move' } : { ok: true, next: now };
  });
}

/**
 * Send Escape to a mid-turn session; refuses when it isn't busy. Busy-ness is
 * resolved by the injected `isBusy` (the authoritative live status file), NOT
 * the pane: a --remote-control pane never renders "esc to interrupt" at all,
 * and an RC-off pane does render it, but the same marker can sit under (or
 * beside) a dialog painted over it — either way pane-based busy detection
 * would report the wrong thing, and the live status file is the one signal
 * that also sees subagents. The mail lane's `turnRunning` (`pane/dialog.ts`)
 * does read that marker — for exactly these reasons, only as a best-effort
 * tripwire behind the live file, never as the reading. And `isBusy` is
 * `liveSessionStatus`'s collapse (`fleet.ts`'s `liveStatus`): `shell` and
 * `waiting` read busy too, as does an idle main loop whose background agents
 * still run, so this can send Escape to a session with no turn in flight.
 */
export function interrupt(
  d: SendDeps,
  id: string,
  isBusy: () => Promise<boolean>,
): Promise<{ ok: true } | { ok: false; error: 'not-alive' | 'not-busy' }> {
  return d.queue.run(id, async (): Promise<{ ok: true } | { ok: false; error: 'not-alive' | 'not-busy' }> => {
    const pane = await d.tmux.capture(id);
    if (pane === null) return { ok: false, error: 'not-alive' };
    if (!(await isBusy())) return { ok: false, error: 'not-busy' };
    await d.tmux.sendKey(id, 'Escape');
    return { ok: true };
  });
}

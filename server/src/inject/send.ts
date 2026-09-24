import type { Tmux } from '../exec.js';
import { autoContinueArmed, hasMenu, parseDialog } from '../pane/dialog.js';
import type { KeyedQueue } from './queue.js';
import { composePrompt, MAIL_ENVELOPE_FENCE } from '../../../shared/api.js';

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
        | 'auto-continue-armed';
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
       *    holds it; both Enters were swallowed. Earns the flag.
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
  needle: string,
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
    const draft = read.draft;
    if (needle === '' ? draft === '' : !draft.startsWith(needle)) return true;
  }
  return false;
}

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
  needle: string,
): Promise<SendResult> {
  await d.tmux.sendKey(id, 'Enter');
  if (await submitted(d, id, sleep, needle)) return { ok: true };
  await d.tmux.sendKey(id, 'Enter');
  if (await submitted(d, id, sleep, needle)) return { ok: true };
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
    submittable: true,
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
 */
export function sendPrompt(
  d: SendDeps,
  id: string,
  text: string,
  opts: { replaceDraft?: boolean; attachments?: readonly string[]; resumeIfOwn?: boolean;
          clearMailResidue?: boolean; ownStrandedClear?: boolean; holdIfAutoContinueArmed?: boolean } = {},
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
        return pressEnterAndConfirm(d, id, sleep, needle);
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
      }
    }
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) await d.tmux.sendKey(id, 'M-Enter');
      await d.tmux.sendLiteral(id, parts[i]!);
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
      for (let i = 0; i < ECHO_TRIES && !echoed; i++) {
        await sleep(ECHO_POLL_MS);
        const ansi = await d.tmux.captureAnsi(id);
        if (ansi === null) continue;
        lastBox = draftOfMeasured(ansi);
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
        if (lastBox === null) return { ok: false, error: 'not-alive' };
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
        // `SendResult.submittable`.
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
        // It stays a REFUSAL, deliberately: the operator taps Send it. The
        // machine does not submit a box it could not read, which is the whole
        // of §4.1's argument and is untouched.
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
    return pressEnterAndConfirm(d, id, sleep, needle);
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
    return (await submitted(d, id, sleep, needle))
      ? { ok: true as const }
      : { ok: false, error: 'enter-ignored' as const };
  });
}

/**
 * Answer a pane menu dialog by walking the ❯ marker to `optionIndex` and
 * confirming. Refuses when the on-screen dialog no longer matches `dialogId`
 * (stale) and never presses Enter unless the re-captured pane proves the
 * marker landed on the requested option.
 */
export function answerDialog(
  d: SendDeps,
  id: string,
  dialogId: string,
  optionIndex: number,
): Promise<{ ok: true } | { ok: false; error: 'not-alive' | 'stale-dialog' | 'walk-failed' }> {
  const sleep = d.sleep ?? defaultSleep;
  return d.queue.run(id, async (): Promise<{ ok: true } | { ok: false; error: 'not-alive' | 'stale-dialog' | 'walk-failed' }> => {
    const pane = await d.tmux.capture(id);
    if (pane === null) return { ok: false, error: 'not-alive' };

    const dialog = parseDialog(pane);
    if (!dialog || dialog.id !== dialogId) return { ok: false, error: 'stale-dialog' };

    const delta = optionIndex - dialog.selectedIndex;
    const key = delta > 0 ? 'Down' : 'Up';
    for (let i = 0; i < Math.abs(delta); i++) {
      await d.tmux.sendKey(id, key);
      await sleep(150);
    }

    const after = await d.tmux.capture(id);
    const landed = after === null ? null : parseDialog(after);
    if (!landed || landed.selectedIndex !== optionIndex) return { ok: false, error: 'walk-failed' };

    await d.tmux.sendKey(id, 'Enter');
    return { ok: true };
  });
}

/**
 * Send Escape to a mid-turn session; refuses when it isn't busy. Busy-ness is
 * resolved by the injected `isBusy` (the authoritative live status file), NOT
 * the pane: a --remote-control pane never renders "esc to interrupt" at all,
 * and an RC-off pane does render it, but the same marker can sit under (or
 * beside) a dialog painted over it — either way pane-based busy detection
 * would report the wrong thing, and the live status file is the one signal
 * that also sees subagents.
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

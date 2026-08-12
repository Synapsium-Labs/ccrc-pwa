import type { Tmux } from '../exec.js';
import { hasMenu, parseDialog } from '../pane/dialog.js';
import type { KeyedQueue } from './queue.js';
import { composePrompt } from '../../../shared/api.js';

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
  | { ok: false; error: 'not-alive' | 'dialog-open' | 'draft-present' | 'draft-clear-failed' | 'verify-failed' | 'enter-ignored'; draft?: string; pane?: string };

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
export const draftOf = (ansiPane: string): string => {
  const boxLine = ansiPane.split('\n').filter((l) => l.replace(SGR, '').startsWith('❯')).at(-1);
  if (boxLine === undefined) return '';
  return boxLine.replace(DIM_SPAN, '').replace(SGR, '').slice(1).trim();
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
    const draft = draftOf(pane);
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
  return { ok: false, error: 'enter-ignored', draft: draftOf(await d.tmux.captureAnsi(id) ?? ''), pane: (stuck ?? '').slice(-PANE_TAIL) };
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
  | { state: 'dead' };

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
 * Terminating a look round on `draftOf() === ''` is sound because kills run
 * bottom-up while `draftOf` reads the box's FIRST row (the `❯` marker sits
 * there; continuation rows are indented two spaces and carry no marker — both
 * confirmed against real `capture-pane -e` bytes, see LIVE_CU_FRAMES in the
 * tests), so that row is the LAST to empty. Detecting PROGRESS from draftOf is
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
    const left = draftOf(ansi);
    if (left === '') return { state: 'cleared' };
    if (i >= opts.look || now() >= deadline) return { state: 'residue', draft: left };
    await d.tmux.sendKey(id, 'C-u');
  }
}

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
 */
export function sendPrompt(
  d: SendDeps,
  id: string,
  text: string,
  opts: { replaceDraft?: boolean; attachments?: readonly string[]; resumeIfOwn?: boolean } = {},
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

    // A menu owns the keyboard and there is no input box to type into — the only
    // `❯` on screen is the cursor resting on the selected OPTION. draftOf would
    // read that row ("1. Forward-fill per class ┌────…") as a half-typed draft
    // and report draft-present, and answering "replace" would fire C-u and then
    // type the message as raw keystrokes into a live menu. Refuse instead; the
    // caller's job is to answer the question.
    if (hasMenu(pane.replace(SGR, ''))) return { ok: false, error: 'dialog-open' };

    const draft = draftOf(pane);
    if (draft) {
      // `resumeIfOwn`'s discrimination: `needle` is derived from THIS call's
      // OWN `text`, and `submitEnter`'s own correspondence gate already
      // established the doctrine this reuses verbatim — "the box's MARKER
      // ROW... is all draftOf can see and all [a prior observation] could
      // have carried, so equality of it is exactly as much correspondence as
      // exists to prove" (`submitEnter`'s own docstring). A draft that STARTS
      // WITH our own needle is, to that same precision, THIS delivery's own
      // unsent text, not someone else's — so finish the submit (press Enter,
      // verified) rather than either retyping over it (would double the
      // text) or refusing it as `draft-present` (would wedge forever: this
      // function never retries on its own, so an unrecognized "own" draft
      // would answer `draft-present` on every future call for as long as it
      // sits there — the exact self-block F3 measured live). A draft that
      // does NOT match — any genuine human draft included — falls straight
      // through to the ordinary `draft-present` refusal two lines down,
      // untouched: F2 (never type over a human mid-sentence) is unaffected,
      // because this branch only ever PRESSES ENTER, never clears or types.
      if (opts.resumeIfOwn && needle !== '' && draft.startsWith(needle)) {
        return pressEnterAndConfirm(d, id, sleep, needle);
      }
      if (!opts.replaceDraft) return { ok: false, error: 'draft-present', draft };
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
      if (cleared.state === 'residue') return { ok: false, error: 'draft-clear-failed', draft: cleared.draft };
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
      for (let i = 0; i < ECHO_TRIES && !echoed; i++) {
        await sleep(ECHO_POLL_MS);
        const ansi = await d.tmux.captureAnsi(id);
        if (ansi === null) continue;
        if (draftOf(ansi).startsWith(needle)) echoed = true;
      }
      if (!echoed) {
        after ??= await d.tmux.capture(id);
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
      for (let i = 0; i < ECHO_TRIES; i++) {
        await sleep(ECHO_POLL_MS);
        after = await d.tmux.capture(id);
        if (after !== null && (needle === '' || after.includes(needle))) break;
        if (i === ECHO_TRIES - 1) {
          return { ok: false, error: 'verify-failed', pane: (after ?? '').slice(-PANE_TAIL) };
        }
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
 * Is there box content strictly BELOW the marker row — a continuation row
 * `draftOf` never reads, because its documented contract is the marker row
 * only (see its own docstring)?
 *
 * Reachable end-to-end: `sendPrompt` writes a leading blank line with
 * `M-Enter` whenever the composed prompt's first `\n`-split part is `''`
 * (its own `parts` loop above), so an `enter-ignored` on a message that
 * *starts* with a blank line leaves exactly this shape — a blank marker row
 * with the real text one row down, invisible to `draftOf`. Reporting
 * `nothing-to-submit` for that pane would be a lie: there is something to
 * send, this function just cannot prove what.
 *
 * The real captures back exactly one claim, and this function is scoped to
 * only that claim: a rule row closes the box immediately, so any non-blank
 * row between the marker and the first rule row is box content, never
 * chrome (chrome is only ever seen AFTER that rule — and shares the box's
 * own two-space indent, which is why indentation alone cannot tell a
 * continuation row from chrome: only the rule boundary can). This proves
 * PRESENCE, not identity — a pasted separator line could itself look like a
 * rule and cut the scan short (under-detecting, the safe direction) — so
 * the result is never used to build a submit needle or to press Enter, only
 * to decide whether claiming the box is empty would be false.
 */
function hasContentBelowMarker(ansiPane: string): boolean {
  const lines = ansiPane.split('\n');
  let markerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.replace(SGR, '').startsWith('❯')) markerIdx = i;   // last ❯ line, same as draftOf
  }
  if (markerIdx === -1) return false;
  for (let i = markerIdx + 1; i < lines.length; i++) {
    const stripped = lines[i]!.replace(DIM_SPAN, '').replace(SGR, '');
    if (isRuleRow(stripped)) return false;
    if (stripped.trim() !== '') return true;
  }
  return false;
}

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
): Promise<{ ok: true } | { ok: false; error: 'not-alive' | 'dialog-open' | 'nothing-to-submit' | 'blank-first-row' | 'box-mismatch' | 'enter-ignored' }> {
  const sleep = d.sleep ?? defaultSleep;
  return d.queue.run(id, async () => {
    const pane = await d.tmux.captureAnsi(id);
    if (pane === null) return { ok: false, error: 'not-alive' as const };
    // Same reasoning as sendPrompt's own guard: with a menu up the only `❯` on
    // screen is the cursor on the selected OPTION, so draftOf would read a menu
    // row as a draft and this would press Enter on somebody's question.
    if (hasMenu(pane.replace(SGR, ''))) return { ok: false, error: 'dialog-open' as const };
    const draft = draftOf(pane);
    if (draft === '') {
      // Blank marker row: usually a genuinely empty box, but see
      // `hasContentBelowMarker` — a message whose first line is itself blank
      // renders identically on THIS row. Naming that case honestly beats
      // claiming there is nothing to send when there might be.
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
 * resolved by the injected `isBusy` (the authoritative live status file), NOT the
 * pane: a --remote-control pane never renders "esc to interrupt", so pane-based
 * busy detection would always (wrongly) report idle.
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

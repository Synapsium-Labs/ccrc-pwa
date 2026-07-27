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
 * Kills are per visual row, not per logical line: a 260-char line typed into a
 * 120-column pane occupied 3 rows and took 3 presses to clear, one per row
 * (measured 2026-07-27 on a live box) — where 3 rows produced by M-Enter take
 * 5, because each newline additionally has to be joined away. Counting rows
 * and charging 2 per row therefore over-estimates a wrapped draft and is exact
 * for an unwrapped one; over-pressing an empty box is a no-op (measured: 12
 * presses at a 2-line draft left a clean box), so erring high is free.
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
 */
export function sendPrompt(
  d: SendDeps,
  id: string,
  text: string,
  opts: { replaceDraft?: boolean; attachments?: readonly string[] } = {},
): Promise<SendResult> {
  const sleep = d.sleep ?? defaultSleep;
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

    // Attachment paths go first, each on its own line, then the user's text —
    // one atomic turn, so the transcript reads image-above-caption and a send
    // that fails to verify can't strand a bare path in the box.
    const attachments = opts.attachments ?? [];
    const composed = composePrompt(text, attachments);

    // Alt+Enter is newline inside the Claude Code input box.
    const parts = composed.split('\n');
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
    const needle = (parts.find((p) => p.trim().length > 0) ?? '').trim().slice(0, ECHO_NEEDLE);
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
    // it landed.
    await d.tmux.sendKey(id, 'Enter');
    if (await submitted(d, id, sleep, needle)) return { ok: true };
    await d.tmux.sendKey(id, 'Enter');
    if (await submitted(d, id, sleep, needle)) return { ok: true };
    const stuck = await d.tmux.capture(id);
    return { ok: false, error: 'enter-ignored', draft: draftOf(await d.tmux.captureAnsi(id) ?? ''), pane: (stuck ?? '').slice(-PANE_TAIL) };
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

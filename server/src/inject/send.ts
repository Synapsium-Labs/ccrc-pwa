import type { Tmux } from '../exec.js';
import { parseDialog } from '../pane/dialog.js';
import type { KeyedQueue } from './queue.js';

export interface SendDeps { tmux: Tmux; queue: KeyedQueue; sleep?: (ms: number) => Promise<void> }

export type SendResult =
  | { ok: true }
  | { ok: false; error: 'not-alive' | 'draft-present' | 'draft-clear-failed' | 'verify-failed'; draft?: string; pane?: string };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const PANE_TAIL = 2000;

const SGR = /\x1b\[[0-9;]*m/g;                 // any ANSI colour/attr code
const DIM_SPAN = /\x1b\[2m[^\x1b]*\x1b\[0m/g;  // a dim `\e[2m…\e[0m` run = ghost/placeholder text

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
const draftOf = (ansiPane: string): string => {
  const boxLine = ansiPane.split('\n').filter((l) => l.replace(SGR, '').startsWith('❯')).at(-1);
  if (boxLine === undefined) return '';
  return boxLine.replace(DIM_SPAN, '').replace(SGR, '').slice(1).trim();
};

/**
 * Inject a prompt into the session's Claude Code input box, serialized per
 * session through the KeyedQueue. Refuses to clobber a half-typed draft
 * unless `replaceDraft`, and verifies the pane echoed the text before Enter.
 */
export function sendPrompt(
  d: SendDeps,
  id: string,
  text: string,
  opts: { replaceDraft?: boolean } = {},
): Promise<SendResult> {
  const sleep = d.sleep ?? defaultSleep;
  return d.queue.run(id, async (): Promise<SendResult> => {
    const pane = await d.tmux.captureAnsi(id);
    if (pane === null) return { ok: false, error: 'not-alive' };

    const draft = draftOf(pane);
    if (draft) {
      if (!opts.replaceDraft) return { ok: false, error: 'draft-present', draft };
      await d.tmux.sendKey(id, 'C-u');
      await sleep(150);
      const cleared = await d.tmux.captureAnsi(id);
      if (cleared === null) return { ok: false, error: 'not-alive' };
      const left = draftOf(cleared);
      if (left) return { ok: false, error: 'draft-clear-failed', draft: left };
    }

    // Alt+Enter is newline inside the Claude Code input box.
    const parts = text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) await d.tmux.sendKey(id, 'M-Enter');
      await d.tmux.sendLiteral(id, parts[i]!);
    }

    await sleep(200);
    const after = await d.tmux.capture(id);
    const needle = parts.find((p) => p.trim().length > 0)?.slice(0, 30) ?? '';
    if (after === null || (needle !== '' && !after.includes(needle))) {
      return { ok: false, error: 'verify-failed', pane: (after ?? '').slice(-PANE_TAIL) };
    }

    await d.tmux.sendKey(id, 'Enter');
    return { ok: true };
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

import type { Tmux } from '../exec.js';
import type { KeyedQueue } from './queue.js';

export interface SendDeps { tmux: Tmux; queue: KeyedQueue; sleep?: (ms: number) => Promise<void> }

export type SendResult =
  | { ok: true }
  | { ok: false; error: 'not-alive' | 'draft-present' | 'draft-clear-failed' | 'verify-failed'; draft?: string; pane?: string };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const PANE_TAIL = 2000;

/** Text after `❯ ` on the prompt line, trimmed; '' when no prompt line is visible. */
const draftOf = (pane: string): string =>
  pane.split('\n').find((l) => l.startsWith('❯ '))?.slice(2).trim() ?? '';

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
    const pane = await d.tmux.capture(id);
    if (pane === null) return { ok: false, error: 'not-alive' };

    const draft = draftOf(pane);
    if (draft) {
      if (!opts.replaceDraft) return { ok: false, error: 'draft-present', draft };
      await d.tmux.sendKey(id, 'C-u');
      await sleep(150);
      const cleared = await d.tmux.capture(id);
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

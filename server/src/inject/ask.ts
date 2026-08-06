import type { SendDeps } from './send.js';
import type { HookAsk } from '../../../shared/api.js';
import { askKey } from '../askkey.js';

export interface AskDeps extends SendDeps {
  /** The session's CURRENT hook state, re-read at answer time — never the copy
   *  the client was shown. This is what makes the key check meaningful. */
  readAsk: (id: string) => Promise<{ ask: HookAsk | null; state: 'working' | 'waiting' | 'done' } | null>;
}

export type AskResult =
  | { ok: true }
  | { ok: false; error: 'not-alive' | 'not-waiting' | 'stale-ask' | 'ask-mismatch' | 'range' | 'multiselect' };

/**
 * Answer a hook-reported AskUserQuestion by option index, without the pane
 * coordinates `answerDialog` needs.
 *
 * MEASURED, Build 1 live probe against Claude Code 2.1.222: a DIGIT ALONE both
 * selects and confirms a single-select question — no Enter, and sending one
 * would submit the NEXT thing. Multi-select is the opposite: each digit toggles
 * and Enter commits, which is why it is this route's acceptance test.
 *
 * Fail-shut, in order, each hazard with its own name (analysis Tier-1 #4).
 */
export async function answerAsk(
  d: AskDeps,
  id: string,
  key: string,
  indexes: readonly number[],
): Promise<AskResult> {
  return d.queue.run(id, async (): Promise<AskResult> => {
    if ((await d.tmux.capture(id)) === null) return { ok: false, error: 'not-alive' };

    const hs = await d.readAsk(id);
    if (hs === null) return { ok: false, error: 'stale-ask' };
    if (hs.state !== 'waiting') return { ok: false, error: 'not-waiting' };

    // An approval envelope keys to null, so it can never match a client key —
    // the mismatch branch below is its refusal, and it is the right one.
    const current = askKey(hs.ask);
    if (current === null || current !== key) return { ok: false, error: 'ask-mismatch' };

    const q = (hs.ask as { questions: { multiSelect?: boolean; options: unknown[] }[] }).questions[0]!;
    if (indexes.length === 0) return { ok: false, error: 'range' };
    if (indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= q.options.length)) {
      return { ok: false, error: 'range' };
    }
    // Digits are the transport, so an option past the ninth has no keystroke.
    if (indexes.some((i) => i > 8)) return { ok: false, error: 'range' };
    if (indexes.length > 1 && q.multiSelect !== true) return { ok: false, error: 'multiselect' };

    for (const i of indexes) await d.tmux.sendKey(id, String(i + 1));
    // Single-select needs NO Enter — the digit already confirmed. Pressing one
    // would land on whatever the TUI showed next.
    if (indexes.length > 1) await d.tmux.sendKey(id, 'Enter');
    return { ok: true };
  });
}

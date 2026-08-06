import type { SendDeps } from './send.js';
import type { HookAsk } from '../../../shared/api.js';
import { askKey } from '../askkey.js';
import { hasMenu } from '../pane/dialog.js';

export interface AskDeps extends SendDeps {
  /** The session's CURRENT hook state, re-read at answer time — never the copy
   *  the client was shown. This is what makes the key check meaningful. */
  readAsk: (id: string) => Promise<{ ask: HookAsk | null; state: 'working' | 'waiting' | 'done' } | null>;
}

export type AskResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'not-alive' | 'not-waiting' | 'stale-ask' | 'ask-mismatch' | 'multi-question'
        | 'range' | 'multiselect' | 'duplicate-index' | 'no-menu';
    };

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
    // Captured ONCE and reused below for the menu-freshness check (`no-menu`)
    // rather than a second capture right before the keypress — see that
    // check's own comment for why the single snapshot is what a SERIALIZED
    // repeat call needs, not what a closer-to-the-keypress capture would buy.
    const pane = await d.tmux.capture(id);
    if (pane === null) return { ok: false, error: 'not-alive' };

    const hs = await d.readAsk(id);
    if (hs === null) return { ok: false, error: 'stale-ask' };
    if (hs.state !== 'waiting') return { ok: false, error: 'not-waiting' };

    // An approval envelope keys to null, so it can never match a client key —
    // the mismatch branch below is its refusal, and it is the right one.
    const current = askKey(hs.ask);
    if (current === null || current !== key) return { ok: false, error: 'ask-mismatch' };

    // `session-hook.sh` writes a multi-question envelope ONCE, whole, and the
    // hookstate file stays frozen at this exact `ask` — same key included —
    // until PostToolUse fires for the ENTIRE tool call, which does not happen
    // until every question in it has been answered. The pane, meanwhile,
    // advances question by question. So `askKey` (which hashes only the
    // first question, deliberately — see its own docstring) cannot tell "Q1 is
    // live" from "Q2 is live": the key the client was shown for Q1 still
    // matches after Q1 has been answered and Q2 is what is actually on
    // screen. Hashing every question would not fix this either — the whole
    // envelope is equally frozen, so no digest of it can distinguish the two
    // moments. There is no way to prove which question the pane is currently
    // painting without the pane's own text (which is exactly what this route
    // was built to avoid needing) — so refuse outright, the same stance
    // `DialogSheet.tsx` already takes client-side (`questionCorresponds` /
    // "wire the first question only") for the identical reason.
    const questions = (hs.ask as { questions: { multiSelect?: boolean; options: unknown[] }[] }).questions;
    if (questions.length > 1) return { ok: false, error: 'multi-question' };
    const q = questions[0]!;

    if (indexes.length === 0) return { ok: false, error: 'range' };
    if (indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= q.options.length)) {
      return { ok: false, error: 'range' };
    }
    // Digits are the transport, so an option past the ninth has no keystroke.
    if (indexes.some((i) => i > 8)) return { ok: false, error: 'range' };
    if (indexes.length > 1 && q.multiSelect !== true) return { ok: false, error: 'multiselect' };
    // [0,0] on a multiSelect question toggles the SAME option twice — which
    // cancels out to nothing selected — and then Enter commits that empty
    // selection. That is not a refusal-shaped failure, it is a WRONG ANSWER
    // sent with ok:true, which is worse: refuse rather than silently submit
    // a selection the client never asked for.
    if (new Set(indexes).size !== indexes.length) return { ok: false, error: 'duplicate-index' };

    // The LAST gate before a keystroke, and deliberately last: everything
    // above is about whether this ANSWER still makes sense; this is about
    // whether there is still a MENU to send it into. `answerAsk` calls are
    // serialized per-session through `d.queue.run`, so a repeat POST (a
    // retried request, a double-tap) that arrives after an earlier call
    // already pressed a digit and closed the menu runs its OWN fresh
    // `capture` above, at THIS call's entry — by the time execution reaches
    // here, that capture already reflects whatever the earlier press left
    // on screen (the input box, or the NEXT permission menu, where digits
    // also select). Without this check that repeat sails through every gate
    // above unchanged (same key, same in-range indexes) and presses into
    // whatever now owns the keyboard. `answerDialog` gets the same property
    // from its own stale-dialog re-check; this is this route's version of it.
    if (!hasMenu(pane)) return { ok: false, error: 'no-menu' };

    for (const i of indexes) await d.tmux.sendKey(id, String(i + 1));
    // Single-select needs NO Enter — the digit already confirmed. Pressing one
    // would land on whatever the TUI showed next.
    if (indexes.length > 1) await d.tmux.sendKey(id, 'Enter');
    return { ok: true };
  });
}

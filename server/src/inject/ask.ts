import type { SendDeps } from './send.js';
import type { HookAsk, HookAskQuestion } from '../../../shared/api.js';
import { askKey } from '../askkey.js';
import { hasMenu, paneOptionRows } from '../pane/dialog.js';
import { pairMatches } from '../transcript/ask.js';

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
        | 'range' | 'multiselect' | 'duplicate-index' | 'no-menu' | 'menu-mismatch';
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
    const questions = (hs.ask as { questions: HookAskQuestion[] }).questions;
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

    // The LAST gates before a keystroke, and deliberately last: everything
    // above is about whether this ANSWER still makes sense; these are about
    // whether the thing on screen is the MENU it was written for. The pane is
    // captured HERE, not at entry, so nothing this function does afterwards
    // can age it — `readAsk` alone is a registry read plus a hookstate read,
    // two agent round trips in remote mode, and the earlier capture spent
    // that whole window going stale.
    const pane = await d.tmux.capture(id);
    if (pane === null) return { ok: false, error: 'not-alive' };

    // `no-menu`: nothing is asking anything. `answerAsk` calls are serialized
    // per-session through `d.queue.run`, so a repeat POST (a retried request,
    // a double-tap) arriving after an earlier call already pressed a digit
    // and closed the menu sees the input box here and stops, instead of
    // sailing through every gate above unchanged (same key, same in-range
    // indexes) and pressing into whatever now owns the keyboard.
    if (!hasMenu(pane)) return { ok: false, error: 'no-menu' };

    // `menu-mismatch`: a menu IS up, but not this one. Presence alone is not
    // the safety property this route needs — `hasMenu` says only "some menu",
    // and a Claude Code Bash permission prompt IS one. The window is real: the
    // human can answer in the terminal and the next tool call can paint its
    // permission prompt before `session-hook.sh` has rewritten the hookstate
    // to `working`, which leaves `waiting` + a still-matching key + a menu
    // that is not ours — and digit `2` there is "Yes, and don't ask again".
    // No capture placement closes that; only reading the rows does.
    //
    // Identity, then, not presence: the pane's numbered rows must BE this
    // question's options, in order, by the same rule `alignAsk` uses to decide
    // which question a menu is showing and `DialogSheet.tsx` mirrors before it
    // lets a tap through (`pairMatches` — imported, not restated). Extra
    // TRAILING rows are tolerated because the TUI appends its own ("Chat about
    // this", "Type something else") below the real options and they carry no
    // marker; the head-anchored prefix is what the client's gate proves too,
    // and what makes it hold on real captures.
    const rows = paneOptionRows(pane);
    const matches =
      rows.length >= q.options.length &&
      q.options.every((o, i) => pairMatches(rows[i]!.label, o.label));
    if (!matches) return { ok: false, error: 'menu-mismatch' };

    for (const i of indexes) await d.tmux.sendKey(id, String(i + 1));
    // Gated on the QUESTION's kind, never on how many options were picked. On
    // a multi-select menu a digit only TOGGLES a box; Enter is what commits,
    // so a one-option multi-select answer needs it exactly as much as a
    // three-option one — without it the session stays `waiting` with a box
    // ticked while this returns ok:true, and the retry toggles it back off.
    // Single-select is the opposite and must NOT get one: the digit already
    // confirmed, so an Enter would submit whatever the TUI painted next.
    if (q.multiSelect === true) await d.tmux.sendKey(id, 'Enter');
    return { ok: true };
  });
}

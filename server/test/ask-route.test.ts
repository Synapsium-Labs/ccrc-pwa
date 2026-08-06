import { describe, it, expect } from 'vitest';
import { askKey } from '../src/askkey.js';

const ask = (question: string, labels: string[]) => ({
  questions: [{ question, options: labels.map((label) => ({ label })) }],
});

describe('askKey', () => {
  it('is stable across re-reads of the same envelope', () => {
    expect(askKey(ask('Which colour?', ['Red', 'Blue'])))
      .toBe(askKey(ask('Which colour?', ['Red', 'Blue'])));
  });

  it('changes when the question changes', () => {
    expect(askKey(ask('Which colour?', ['Red', 'Blue'])))
      .not.toBe(askKey(ask('Which shape?', ['Red', 'Blue'])));
  });

  it('changes when an option label changes', () => {
    expect(askKey(ask('Which colour?', ['Red', 'Blue'])))
      .not.toBe(askKey(ask('Which colour?', ['Red', 'Green'])));
  });

  it('changes when options are reordered — position is part of the answer', () => {
    expect(askKey(ask('Which colour?', ['Red', 'Blue'])))
      .not.toBe(askKey(ask('Which colour?', ['Blue', 'Red'])));
  });

  it('has no key for an approval envelope — those answer through the pane path', () => {
    expect(askKey({ approval: { tool: 'Bash', summary: 'rm -rf /tmp/x' } })).toBeNull();
  });

  it('has no key for a null ask or an empty questions array', () => {
    expect(askKey(null)).toBeNull();
    expect(askKey({ questions: [] })).toBeNull();
  });
});

import { answerAsk } from '../src/inject/ask.js';
import { KeyedQueue } from '../src/inject/queue.js';

// A single-select AskUserQuestion menu, shaped enough to trip `hasMenu`
// (`Enter to select` alone is sufficient — see pane/dialog.ts's MENU_RE).
// Used as the default `capture` so every test below exercises the SAME
// pane-freshness gate `answerAsk` now runs; tests that want "no menu is up"
// override it explicitly rather than relying on an accidentally-menu-less
// default (review Important 1's fix, and its own coverage).
const MENU_PANE = '❯ 1. Red\n  2. Blue\nEnter to select\n';
const NOT_A_MENU_PANE = 'done\n❯ \n';

function deps(overrides: Partial<Parameters<typeof answerAsk>[0]> = {}) {
  const keys: string[] = [];
  return {
    keys,
    d: {
      queue: new KeyedQueue(),
      tmux: {
        capture: async () => MENU_PANE,
        captureAnsi: async () => MENU_PANE,
        sendKey: async (_id: string, k: string) => { keys.push(k); },
        sendLiteral: async (_id: string, t: string) => { keys.push(`lit:${t}`); },
      } as never,
      readAsk: async () => ({ ask: ask('Which colour?', ['Red', 'Blue']), state: 'waiting' as const }),
      sleep: async () => {},
      ...overrides,
    },
  };
}

describe('answerAsk', () => {
  it('sends the digit alone for a single-select answer', async () => {
    const { keys, d } = deps();
    const r = await answerAsk(d as never, 'cc-x', askKey(ask('Which colour?', ['Red', 'Blue']))!, [1]);
    expect(r).toEqual({ ok: true });
    expect(keys).toEqual(['2']);   // 0-based index 1 → the digit 2; it selects AND confirms
  });

  it('refuses a key that does not match the current envelope', async () => {
    const { keys, d } = deps();
    const r = await answerAsk(d as never, 'cc-x', 'deadbeefdeadbeef', [0]);
    expect(r).toEqual({ ok: false, error: 'ask-mismatch' });
    expect(keys).toEqual([]);      // nothing was pressed
  });

  it('refuses when the hook is not waiting', async () => {
    const { d } = deps({ readAsk: async () => ({ ask: null, state: 'working' as const }) });
    expect(await answerAsk(d as never, 'cc-x', 'k', [0])).toEqual({ ok: false, error: 'not-waiting' });
  });

  it('refuses an out-of-range index', async () => {
    const { d } = deps();
    const key = askKey(ask('Which colour?', ['Red', 'Blue']))!;
    expect(await answerAsk(d as never, 'cc-x', key, [7])).toEqual({ ok: false, error: 'range' });
  });

  it('refuses multiple indexes when the question is not multiSelect', async () => {
    const { d } = deps();
    const key = askKey(ask('Which colour?', ['Red', 'Blue']))!;
    expect(await answerAsk(d as never, 'cc-x', key, [0, 1])).toEqual({ ok: false, error: 'multiselect' });
  });

  it('sends every digit then Enter for a multiSelect answer', async () => {
    const multi = { questions: [{ question: 'Pick some', multiSelect: true,
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }] };
    const { keys, d } = deps({ readAsk: async () => ({ ask: multi, state: 'waiting' as const }) });
    const r = await answerAsk(d as never, 'cc-x', askKey(multi)!, [0, 2]);
    expect(r).toEqual({ ok: true });
    expect(keys).toEqual(['1', '3', 'Enter']);
  });

  it('refuses an approval envelope — those are the pane path', async () => {
    const { d } = deps({ readAsk: async () => ({ ask: { approval: { tool: 'Bash', summary: '' } }, state: 'waiting' as const }) });
    expect(await answerAsk(d as never, 'cc-x', 'k', [0])).toEqual({ ok: false, error: 'ask-mismatch' });
  });

  it('refuses a dead pane', async () => {
    const { d } = deps();
    (d.tmux as unknown as { capture: () => Promise<string | null> }).capture = async () => null;
    const key = askKey(ask('Which colour?', ['Red', 'Blue']))!;
    expect(await answerAsk(d as never, 'cc-x', key, [0])).toEqual({ ok: false, error: 'not-alive' });
  });

  // — Task 2 review, CRITICAL — a multi-question envelope defeats the key gate —
  //
  // `session-hook.sh` writes the WHOLE `questions` array once and the
  // hookstate file stays frozen — same `ask`, same key — until PostToolUse
  // fires for the entire tool call, which is after every question in it has
  // been answered. The pane advances question-by-question underneath that
  // frozen file, so after Q1 is answered `askKey` still matches: nothing
  // above this test would have refused a second POST from pressing a digit
  // into Q2's live menu. Refuse the whole shape instead, unconditionally.
  describe('multi-question envelopes (CRITICAL fix)', () => {
    const twoQuestions = {
      questions: [
        { question: 'Which env?', options: [{ label: 'Staging' }, { label: 'Prod' }] },
        { question: 'Which region?', options: [{ label: 'EU' }, { label: 'US' }] },
      ],
    };

    it('refuses a multi-question envelope even on a key that matches (Q1 still live)', async () => {
      const { keys, d } = deps({ readAsk: async () => ({ ask: twoQuestions, state: 'waiting' as const }) });
      const r = await answerAsk(d as never, 'cc-x', askKey(twoQuestions)!, [0]);
      expect(r).toEqual({ ok: false, error: 'multi-question' });
      expect(keys).toEqual([]);
    });

    it('still refuses after the pane has visibly moved on to Q2 — the exploit path', async () => {
      // The hookstate file (readAsk) is UNCHANGED from Q1 — same frozen ask,
      // same key — but the pane now shows a DIFFERENT menu (Q2's). This is
      // the live exploit: without the multi-question refusal, ask-mismatch
      // would not catch it (the key still matches) and the digit would land
      // on Q2.
      const q2Pane = '❯ 1. EU\n  2. US\nEnter to select\n';
      const keys: string[] = [];
      const { d } = deps({
        tmux: {
          capture: async () => q2Pane,
          captureAnsi: async () => q2Pane,
          sendKey: async (_id: string, k: string) => { keys.push(k); },
          sendLiteral: async () => {},
        } as never,
        readAsk: async () => ({ ask: twoQuestions, state: 'waiting' as const }),
      });
      const r = await answerAsk(d as never, 'cc-x', askKey(twoQuestions)!, [0]);
      expect(r).toEqual({ ok: false, error: 'multi-question' });
      expect(keys).toEqual([]);
    });
  });

  // — Task 2 review, Important 1 — replay window / menu freshness —
  describe('menu freshness (no-menu)', () => {
    it('refuses when the captured pane shows no menu at all', async () => {
      const keys: string[] = [];
      const { d } = deps({
        tmux: {
          capture: async () => NOT_A_MENU_PANE,
          captureAnsi: async () => NOT_A_MENU_PANE,
          sendKey: async (_id: string, k: string) => { keys.push(k); },
          sendLiteral: async () => {},
        } as never,
      });
      const key = askKey(ask('Which colour?', ['Red', 'Blue']))!;
      expect(await answerAsk(d as never, 'cc-x', key, [0])).toEqual({ ok: false, error: 'no-menu' });
      expect(keys).toEqual([]);
    });

    it('a repeat POST after the menu already closed is refused, not replayed into whatever is on screen now', async () => {
      // Models the exploit shape directly: same key, same indexes, but by the
      // time THIS call's own capture runs, the earlier press already closed
      // the menu (the input box is on screen instead) — proving the pane read
      // is per-call, not a cached snapshot from an earlier answered call.
      const key = askKey(ask('Which colour?', ['Red', 'Blue']))!;
      const { keys, d } = deps();
      const first = await answerAsk(d as never, 'cc-x', key, [1]);
      expect(first).toEqual({ ok: true });

      (d.tmux as unknown as { capture: () => Promise<string> }).capture = async () => NOT_A_MENU_PANE;
      const replay = await answerAsk(d as never, 'cc-x', key, [1]);
      expect(replay).toEqual({ ok: false, error: 'no-menu' });
      expect(keys).toEqual(['2']); // only the first call's press landed
    });
  });

  // — Task 2 review, Important 2 — digit-range ordering, actually pinned —
  //
  // The original suite's only `range` test used index 7 against a 2-option
  // question, which trips the OUT-OF-BOUNDS branch and never reaches the
  // `i > 8` branch below it — so the "digits are the only keystroke, options
  // past the ninth have none" rule had zero coverage of its own. Ten options
  // makes index 9 IN BOUNDS (0 <= 9 < 10) while still having no digit.
  describe('digit-range ceiling past the ninth option (Important 2)', () => {
    const tenOptions = {
      questions: [{ question: 'Pick one of ten', options: Array.from({ length: 10 }, (_, i) => ({ label: `Opt ${i}` })) }],
    };
    const tenOptionsMulti = {
      questions: [{ question: 'Pick some of ten', multiSelect: true,
        options: Array.from({ length: 10 }, (_, i) => ({ label: `Opt ${i}` })) }],
    };

    it('refuses an in-bounds index past the ninth option (single-select)', async () => {
      const { keys, d } = deps({ readAsk: async () => ({ ask: tenOptions, state: 'waiting' as const }) });
      const r = await answerAsk(d as never, 'cc-x', askKey(tenOptions)!, [9]);
      expect(r).toEqual({ ok: false, error: 'range' });
      expect(keys).toEqual([]);
    });

    it('refuses an in-bounds index past the ninth option through the multiSelect path', async () => {
      const { keys, d } = deps({ readAsk: async () => ({ ask: tenOptionsMulti, state: 'waiting' as const }) });
      const r = await answerAsk(d as never, 'cc-x', askKey(tenOptionsMulti)!, [0, 9]);
      expect(r).toEqual({ ok: false, error: 'range' });
      expect(keys).toEqual([]);
    });

    it('the ninth option itself (index 8, digit 9) is answerable', async () => {
      const { keys, d } = deps({ readAsk: async () => ({ ask: tenOptions, state: 'waiting' as const }) });
      const r = await answerAsk(d as never, 'cc-x', askKey(tenOptions)!, [8]);
      expect(r).toEqual({ ok: true });
      expect(keys).toEqual(['9']);
    });
  });

  // — Task 2 review, "also fix" — duplicate indexes on a multiSelect —
  describe('duplicate indexes (correctness bug fix)', () => {
    const multi = { questions: [{ question: 'Pick some', multiSelect: true,
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }] };

    it('refuses [0,0] rather than toggling the same option twice and committing an empty selection', async () => {
      const { keys, d } = deps({ readAsk: async () => ({ ask: multi, state: 'waiting' as const }) });
      const r = await answerAsk(d as never, 'cc-x', askKey(multi)!, [0, 0]);
      expect(r).toEqual({ ok: false, error: 'duplicate-index' });
      expect(keys).toEqual([]);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askKey } from '../src/askkey.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const pane = (name: string): string => readFileSync(path.join(fixturesDir, 'panes', name), 'utf8');

/**
 * The AskUserQuestion envelope out of a transcript fixture, in the shape
 * `session-hook.sh` would have written for it.
 *
 * READ, not retyped: the point of a real-capture test is that the pane and the
 * labels came from the same moment, and a hand-copied label list would let them
 * drift the instant either fixture is touched. Deliberately naive about the
 * transcript's shape — `readPendingAsk`'s gates are not what is under test here,
 * and pulling them in would need a `FleetIO`.
 */
function askFromTranscript(name: string): { questions: { question: string; multiSelect?: boolean; options: { label: string }[] }[] } {
  for (const line of readFileSync(path.join(fixturesDir, name), 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const content = (JSON.parse(line) as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content as Array<Record<string, unknown>>) {
      if (b?.['type'] !== 'tool_use' || b['name'] !== 'AskUserQuestion') continue;
      const qs = (b['input'] as { questions: { question: string; multiSelect?: boolean; options: { label: string }[] }[] }).questions;
      return { questions: qs.map((q) => ({
        question: q.question,
        ...(q.multiSelect === true ? { multiSelect: true } : {}),
        options: q.options.map((o) => ({ label: o.label })),   // no description/preview: the hook copies neither
      })) };
    }
  }
  throw new Error(`no AskUserQuestion tool_use in ${name}`);
}

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
// (`Enter to select` alone is sufficient — see pane/dialog.ts's MENU_RE) AND
// to satisfy the menu-IDENTITY gate: its rows are `ask('Which colour?', …)`'s
// own options, in order. Used as the default `capture` so every test below
// exercises the same gates `answerAsk` runs; tests that want a different pane
// pass one explicitly rather than relying on a default that happens to fit.
const MENU_PANE = '❯ 1. Red\n  2. Blue\nEnter to select\n';
const NOT_A_MENU_PANE = 'done\n❯ \n';
// A multi-select menu as Claude Code actually paints one — checkbox chrome on
// every row and a "Space to select · Enter to confirm" footer (fixture:
// server/test/fixtures/panes/multiselect.txt). The `[ ]` is the row's STATE,
// never part of its label, which is why the row reader strips it before the
// identity gate compares against the hook's verbatim labels.
const MULTI_PANE = '◍ Pick some\n\n❯ 1. [ ] A\n  2. [ ] B\n  3. [ ] C\n\nSpace to select · Enter to confirm\n';
// A Bash permission prompt: a REAL menu, where digit 2 is "Yes, and don't ask
// again". This is what `hasMenu` alone cannot tell apart from the question.
const PERMISSION_PANE =
  'Bash command\n\n  rm -rf /tmp/x\n\n  Do you want to proceed?\n' +
  "❯ 1. Yes\n  2. Yes, and don't ask again for rm commands\n  3. No, and tell Claude what to do differently\n\n" +
  'Enter to confirm\n';

function deps(
  overrides: Partial<Parameters<typeof answerAsk>[0]> = {},
  pane: string = MENU_PANE,
) {
  const keys: string[] = [];
  return {
    keys,
    d: {
      queue: new KeyedQueue(),
      tmux: {
        capture: async () => pane,
        captureAnsi: async () => pane,
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
    const { keys, d } = deps({ readAsk: async () => ({ ask: multi, state: 'waiting' as const }) }, MULTI_PANE);
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
      const tenPane = `${Array.from({ length: 10 }, (_, i) => `${i === 0 ? '❯ ' : '  '}${i + 1}. Opt ${i}`)
        .join('\n')}\nEnter to select\n`;
      const { keys, d } = deps({ readAsk: async () => ({ ask: tenOptions, state: 'waiting' as const }) }, tenPane);
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
      const { keys, d } = deps({ readAsk: async () => ({ ask: multi, state: 'waiting' as const }) }, MULTI_PANE);
      const r = await answerAsk(d as never, 'cc-x', askKey(multi)!, [0, 0]);
      expect(r).toEqual({ ok: false, error: 'duplicate-index' });
      expect(keys).toEqual([]);
    });
  });

  // — whole-branch review, CRITICAL 1 — the commit is the QUESTION's property —
  //
  // The Enter was gated on `indexes.length > 1`, so a multiSelect answered
  // with ONE option pressed a digit — which on a multi-select menu only
  // TOGGLES — sent no Enter, and returned ok:true. The session stays `waiting`
  // with a box ticked while the client is told it answered, and the retry
  // presses the same digit and toggles it back OFF, ok:true again. Same class
  // as the `duplicate-index` refusal above (a WRONG ANSWER sent with ok:true,
  // not a refusal-shaped failure) through a different door — and uncovered
  // because the only multiSelect success test above uses TWO indexes.
  //
  // `DialogSheet.tsx` is what makes it reachable: it renders every multiSelect
  // option as a plain single-tap row, so the moment a later PR wires that UI
  // to /ask, a tap sends `optionIndexes: [k]`.
  describe('a one-option multiSelect answer still commits (CRITICAL 1)', () => {
    const multi = { questions: [{ question: 'Pick some', multiSelect: true,
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }] };

    it('sends the digit AND Enter for a single-index multiSelect answer', async () => {
      const { keys, d } = deps({ readAsk: async () => ({ ask: multi, state: 'waiting' as const }) }, MULTI_PANE);
      const r = await answerAsk(d as never, 'cc-x', askKey(multi)!, [1]);
      expect(r).toEqual({ ok: true });
      expect(keys).toEqual(['2', 'Enter']);   // toggle, then commit
    });

    it("tolerates the TUI's own trailing row on the pane and still commits", async () => {
      // One-column layouts number the TUI's extra rows on after the real
      // options (`4. …`), so the pane legitimately carries MORE rows than the
      // envelope has options. The identity gate is head-anchored for exactly
      // this reason — the same tolerance `DialogSheet.tsx`'s client-side gate
      // has, and why it holds on real captures.
      const withExtra = MULTI_PANE.replace(
        '  3. [ ] C\n', '  3. [ ] C\n  4. [ ] Chat about this\n',
      );
      const { keys, d } = deps({ readAsk: async () => ({ ask: multi, state: 'waiting' as const }) }, withExtra);
      expect(await answerAsk(d as never, 'cc-x', askKey(multi)!, [0])).toEqual({ ok: true });
      expect(keys).toEqual(['1', 'Enter']);
    });

    // The single-select half of the same rule — no Enter, ever — is pinned by
    // "sends the digit alone for a single-select answer" at the top of this file.
  });

  // — whole-branch review, IMPORTANT 2 — presence is not identity —
  //
  // `hasMenu` answers "is SOME menu up", and a Claude Code permission prompt
  // IS one. So `waiting` + a matching key + a menu that isn't ours put digit
  // `2` on "Yes, and don't ask again". The gate now reads the pane's numbered
  // rows and requires them to BE this question's options, in order.
  describe('menu identity (menu-mismatch)', () => {
    const key = askKey(ask('Which colour?', ['Red', 'Blue']))!;

    it('refuses a permission prompt standing where the question was', async () => {
      const { keys, d } = deps({}, PERMISSION_PANE);
      expect(await answerAsk(d as never, 'cc-x', key, [1]))
        .toEqual({ ok: false, error: 'menu-mismatch' });
      expect(keys).toEqual([]);   // NOT "Yes, and don't ask again"
    });

    it('refuses a different question whose menu happens to be up', async () => {
      const otherPane = '❯ 1. EU\n  2. US\nEnter to select\n';
      const { keys, d } = deps({}, otherPane);
      expect(await answerAsk(d as never, 'cc-x', key, [0]))
        .toEqual({ ok: false, error: 'menu-mismatch' });
      expect(keys).toEqual([]);
    });

    it('refuses a menu whose rows are OUR options reordered — position is the answer', async () => {
      const swapped = '❯ 1. Blue\n  2. Red\nEnter to select\n';
      const { keys, d } = deps({}, swapped);
      expect(await answerAsk(d as never, 'cc-x', key, [0]))
        .toEqual({ ok: false, error: 'menu-mismatch' });
      expect(keys).toEqual([]);
    });

    // — the gate's claim, against captures nobody typed by hand —
    //
    // Every other pane in this file is a synthetic string written to suit the
    // assertion, so the comment on the identity gate ("what makes it hold on
    // real captures") had nothing pinning it. These three use captures taken
    // off live sessions, paired with the envelope that actually accompanied
    // them, so a future edit to the normalisation rule breaks a test instead
    // of the fleet.
    describe('real captures', () => {
      it('accepts a real one-column AskUserQuestion, TUI-appended rows and all', async () => {
        // `ask-user-question-real.txt` is a v2.1.216 capture. Its own scrollback
        // carries the prompt that produced it — "with exactly these options:
        // Red, Green, Blue" — so the envelope below is not a guess. The pane
        // numbers FIVE rows: the three real options, then the TUI's own
        // "4. Type something." and "5. Chat about this", which is the
        // extra-trailing-rows tolerance on a capture rather than a mock.
        const colour = { questions: [{
          question: 'Which colour do you prefer?',
          options: [{ label: 'Red' }, { label: 'Green' }, { label: 'Blue' }],
        }] };
        const { keys, d } = deps(
          { readAsk: async () => ({ ask: colour, state: 'waiting' as const }) },
          pane('ask-user-question-real.txt'),
        );
        expect(await answerAsk(d as never, 'cc-x', askKey(colour)!, [1])).toEqual({ ok: true });
        expect(keys).toEqual(['2']);   // Green, digit alone — single-select
      });

      it('accepts a real TWO-COLUMN capture whose rows are cut at the gutter', async () => {
        // The hard direction for `pairMatches`: the two-column layout clips
        // every visible label at the detail box ("Forward-fill per class"),
        // while the envelope carries the full text ("…(Recommended) - carry the
        // last seen rate per class"). The PANE is the truncated side here, the
        // envelope in the one-column case above — which is the whole reason the
        // rule compares prefixes in BOTH directions.
        const askEnvelope = askFromTranscript('transcript-ask-2col.jsonl');
        const { keys, d } = deps(
          { readAsk: async () => ({ ask: askEnvelope, state: 'waiting' as const }) },
          pane('ask-2col-chat-about.txt'),
        );
        expect(await answerAsk(d as never, 'cc-x', askKey(askEnvelope)!, [0])).toEqual({ ok: true });
        expect(keys).toEqual(['1']);
      });

      it('refuses the same menu captured mid-redraw — the rows are not there to prove', async () => {
        // `ask-2col-partial-redraw.txt` is the SAME menu, grabbed while it was
        // being repainted: the footer is still up (so `hasMenu` says yes) but
        // only one numbered row survived. `parseDialog` already calls this
        // capture unparsed and `DialogSheet` already refuses to let a tap
        // through it; this is the server refusing the same pane for the same
        // reason, one keystroke later. Same stance at both layers.
        const askEnvelope = askFromTranscript('transcript-ask-2col.jsonl');
        const { keys, d } = deps(
          { readAsk: async () => ({ ask: askEnvelope, state: 'waiting' as const }) },
          pane('ask-2col-partial-redraw.txt'),
        );
        expect(await answerAsk(d as never, 'cc-x', askKey(askEnvelope)!, [0]))
          .toEqual({ ok: false, error: 'menu-mismatch' });
        expect(keys).toEqual([]);
      });
    });

    it('captures the pane AFTER readAsk, so the hookstate read cannot age it', async () => {
      // The window the finding names: `readAsk` is a registry read plus a
      // hookstate read — two agent round trips in remote mode — and the human
      // can answer in the terminal inside it, with Claude Code painting the
      // next permission prompt before `session-hook.sh` rewrites the state to
      // `working`. An entry-time capture sees the question and the digit lands
      // on the prompt. Modelled directly: the pane changes DURING readAsk.
      let pane = MENU_PANE;
      const keys: string[] = [];
      const d = {
        queue: new KeyedQueue(),
        tmux: {
          capture: async () => pane,
          captureAnsi: async () => pane,
          sendKey: async (_id: string, k: string) => { keys.push(k); },
          sendLiteral: async () => {},
        } as never,
        readAsk: async () => {
          pane = PERMISSION_PANE;
          return { ask: ask('Which colour?', ['Red', 'Blue']), state: 'waiting' as const };
        },
        sleep: async () => {},
      };
      expect(await answerAsk(d as never, 'cc-x', key, [1]))
        .toEqual({ ok: false, error: 'menu-mismatch' });
      expect(keys).toEqual([]);
    });
  });
});

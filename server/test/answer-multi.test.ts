import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyedQueue } from '../src/inject/queue.js';
import { answerDialogMulti, type SendDeps } from '../src/inject/send.js';
import { parseDialog } from '../src/pane/dialog.js';
import { Tmux, type Runner } from '../src/exec.js';
import { tmuxTarget } from '../../shared/tmux-target.js';

// D-5048 (plan docs/superpowers/plans/2026-10-15-ask-server-half.md, Task 4): `POST /api/sessions/:id/dialog/multi`
// answers a multiSelect AskUserQuestion question. Measured on Claude Code 2.1.300: a digit k toggles box k (ticks it,
// or unticks it) and the cursor stays; Enter TOGGLES the cursor row and commits nothing; Tab from an option row commits
// the ticks and moves on, to the next question or the review screen. With the cursor on the free-text row a digit is
// TYPED into it, and Tab on the Next row after a walk through the free-text row was swallowed. So the route sends a
// digit only for a box whose tick differs from the wanted set, proves the ticks on a fresh capture, and only then sends
// Tab, and proves the screen moved on. Every pane here is a recorded 2.1.300 screen (`fixtures/panes/cc300-ask-*.txt`,
// 220x50, read with `capture-pane -p` as `Tmux.capture` reads), or one marked DERIVED with the edit it makes.


/** `answer-text.test.ts`'s scripted-capture fake: capture-pane answers the scripted panes in order (the last one
 *  repeats; null is exit 1). Every other tmux call succeeds. */
function fakeTmux(panes: (string | null)[]) {
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') {
      const pane = panes[Math.min(capIdx, panes.length - 1)] ?? null;
      capIdx++;
      return pane === null ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: pane, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { tmux: new Tmux(run), calls };
}

const sendKeysCalls = (calls: string[][]) => calls.filter((c) => c[1] === 'send-keys');
const captureCalls = (calls: string[][]) => calls.filter((c) => c[1] === 'capture-pane');
/** A fake clock that only sleeps move, so `settleNext`'s 1.5 s wall-clock budget is spent in fake time. */
const deps = (tmux: Tmux): SendDeps => {
  let t = 0;
  return { tmux, queue: new KeyedQueue(), sleep: async (ms) => { t += ms; }, now: () => t };
};

const panesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes');
const fixture = (name: string): string => readFileSync(path.join(panesDir, name), 'utf8');
const SID = 'lane-a:project-a';
const key = (k: string): string[] => ['tmux', 'send-keys', '-t', tmuxTarget(SID), k];
const keys = (...ks: string[]): string[][] => ks.map(key);
const idOf = (pane: string): string => parseDialog(pane)!.id;
/** A DERIVED pane: `from` must be on the recorded screen, or the derivation silently tests the original. */
const derive = (pane: string, from: string, to: string): string => {
  expect(pane, `the derivation's anchor "${from}" is not on the screen`).toContain(from);
  return pane.replace(from, to);
};
const hasTab = (calls: string[][]): boolean => sendKeysCalls(calls).some((c) => c.at(-1) === 'Tab');

// "Which features do you want?" (Q2 of 3): 1. [ ] Logging, 2. [ ] Metrics, 3. [ ] Tracing, 4. [ ] Type something,
// the unnumbered Next row, a rule, 5. Chat about this. Its id holds across ticks and cursor moves.
const FEAT_OPEN = fixture('cc300-ask-multiselect-next-open.txt');          // nothing ticked, cursor on 1
const FEAT_1 = fixture('cc300-ask-multiselect-digit1.txt');                // Logging ticked, cursor on 1
const FEAT_1_3 = fixture('cc300-ask-multiselect-digit1-3.txt');            // Logging and Tracing ticked, cursor on 1
const FEAT_ROW3 = fixture('cc300-ask-multiselect-row3.txt');               // 1 and 3 ticked, cursor on 3, no hint
const FEAT_ON_FREETEXT = fixture('cc300-ask-multiselect-on-freetext.txt'); // 1 and 3 ticked, cursor on 4, the hint
const FEAT_NEXT = fixture('cc300-ask-multiselect-next-focused.txt');       // 1 and 3 ticked, cursor on Next, the hint
/** The free-text box ticked by digit 4 while the cursor sat on row 1 (an earlier 2.1.300 probe, the same question). */
const FEAT_FREETEXT_TICKED = fixture('cc300-ask-multiselect-freetext-ticked.txt');
/** Tab from an option row committed "Which features do you want?": the screen moved on to "Which tools?". */
const TOOLS_Q = fixture('cc300-ask-multiselect-submit-open.txt');

// One recorded ask, end to end, of two multiSelect questions: "Which tools?" (Hammer, Saw, Drill; Next) and "Which
// sizes?" (Small, Large; Submit). Saw and Drill were ticked, Tab moved on, Left came back to a REVISITED "Which tools?"
// (ticks kept, cursor reset to row 1). There digit 2 unticked Saw and digit 1 ticked Hammer, Tab moved on again, digit 2
// ticked Large, and Tab reached the review, which read "Which tools? → Drill, Hammer" (tick order) and "Large".
const TOOLS_OPEN = fixture('cc300-ask-multiselect-tools-open.txt');
const TOOLS_REVISIT = fixture('cc300-ask-multiselect-tools-revisit.txt');               // Saw, Drill ticked, cursor on 1
const TOOLS_REVISIT_2_1 = fixture('cc300-ask-multiselect-tools-revisit-digit2-1.txt');  // Hammer, Drill ticked
const SIZES_OPEN = fixture('cc300-ask-multiselect-sizes-open.txt');
const SIZES_LARGE = fixture('cc300-ask-multiselect-sizes-large.txt');
const REVIEW = fixture('cc300-ask-review-tick-order.txt');

describe('answerDialogMulti: ticks the boxes, proves the ticks, then Tab (D-5048)', () => {
  it('toggles only the rows whose tick differs, proves the ticks, then Tab', async () => {
    const { tmux, calls } = fakeTmux([FEAT_1, FEAT_1_3, TOOLS_Q]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1), [1, 3]);
    expect(res).toEqual({ ok: true, next: parseDialog(TOOLS_Q) });
    // Logging is already ticked: digit 1 would UNtick it. Only Tracing differs.
    expect(sendKeysCalls(calls)).toEqual(keys('3', 'Tab'));
  });

  it('a revisited question: unticks first, then ticks, then Tab — the recorded sequence, end to end', async () => {
    const { tmux, calls } = fakeTmux([TOOLS_REVISIT, TOOLS_REVISIT_2_1, SIZES_OPEN]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(TOOLS_REVISIT), [1, 3]);
    expect(res).toEqual({ ok: true, next: parseDialog(SIZES_OPEN) });
    expect(sendKeysCalls(calls)).toEqual(keys('2', '1', 'Tab'));
    // The ticks never changed the id the caller holds, and what was committed is what the review lists.
    expect(idOf(TOOLS_REVISIT_2_1)).toBe(idOf(TOOLS_REVISIT));
    expect(REVIEW).toContain('→ Drill, Hammer');
  });

  it('ticks in the order asked, since the answer lists the boxes in the order they were ticked', async () => {
    const { tmux, calls } = fakeTmux([TOOLS_OPEN, TOOLS_REVISIT_2_1, SIZES_OPEN]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(TOOLS_OPEN), [3, 1]);
    expect(res).toEqual({ ok: true, next: parseDialog(SIZES_OPEN) });
    expect(sendKeysCalls(calls)).toEqual(keys('3', '1', 'Tab'));
  });

  it('nothing differs: no digit, the ticks proved, then Tab', async () => {
    const { tmux, calls } = fakeTmux([FEAT_1_3, FEAT_1_3, TOOLS_Q]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1_3), [3, 1]);
    expect(res).toEqual({ ok: true, next: parseDialog(TOOLS_Q) });
    expect(sendKeysCalls(calls)).toEqual(keys('Tab'));
  });

  it('the last question: Tab lands on the review screen', async () => {
    const { tmux, calls } = fakeTmux([SIZES_OPEN, SIZES_LARGE, REVIEW]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(SIZES_OPEN), [2]);
    expect(res).toEqual({ ok: true, next: parseDialog(REVIEW) });
    expect(sendKeysCalls(calls)).toEqual(keys('2', 'Tab'));
  });

  it('a slow render is waited for: the tick proof is polled', async () => {
    const { tmux, calls } = fakeTmux([FEAT_1, FEAT_1, FEAT_1, FEAT_1_3, TOOLS_Q]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1), [1, 3]);
    expect(res).toEqual({ ok: true, next: parseDialog(TOOLS_Q) });
    expect(sendKeysCalls(calls)).toEqual(keys('3', 'Tab'));
  });

  it('a slow commit is waited for: the move is polled', async () => {
    const { tmux, calls } = fakeTmux([FEAT_1_3, FEAT_1_3, FEAT_1_3, FEAT_1_3, TOOLS_Q]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1_3), [1, 3]);
    expect(res).toEqual({ ok: true, next: parseDialog(TOOLS_Q) });
    expect(sendKeysCalls(calls)).toEqual(keys('Tab'));
  });

  // ── Refused before any key ──

  it('stale dialog id: zero keys', async () => {
    const { tmux, calls } = fakeTmux([FEAT_1]);
    expect(await answerDialogMulti(deps(tmux), SID, 'deadbeef', [1])).toEqual({ ok: false, error: 'stale-dialog' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('no menu on screen: stale-dialog, zero keys', async () => {
    const { tmux, calls } = fakeTmux(['done\n❯ \n']);
    expect(await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1), [1])).toEqual({ ok: false, error: 'stale-dialog' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('not-alive when the capture fails: zero keys', async () => {
    const { tmux, calls } = fakeTmux([null]);
    expect(await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1), [1])).toEqual({ ok: false, error: 'not-alive' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it.each([
    ['a single-select question', 'cc300-ask-q1-of-2.txt'],
    ['the review screen', 'cc300-ask-review-tick-order.txt'],
    // The 2.1.222 shape ("Space to select · Enter to confirm"): checkboxes, but no Next/Submit row. Its commit key was
    // Enter, and Tab there was never measured.
    ['a multi-select painted with no Next or Submit row', 'multiselect.txt'],
  ])('not-multiselect on %s: zero keys', async (_name, name) => {
    const pane = fixture(name);
    const { tmux, calls } = fakeTmux([pane]);
    expect(await answerDialogMulti(deps(tmux), SID, idOf(pane), [1])).toEqual({ ok: false, error: 'not-multiselect' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it.each([
    [[4], 'the free-text row (free text inside a multiSelect question is not in v1)'],
    [[5], '"Chat about this"'],
    [[1, 6], 'a row past the menu'],
  ])('not-an-option for %j, %s: zero keys', async (indexes) => {
    const { tmux, calls } = fakeTmux([FEAT_1]);
    expect(await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1), indexes)).toEqual({ ok: false, error: 'not-an-option' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('free-text-ticked: the free-text box is ticked, and Tab would commit it with the options', async () => {
    const { tmux, calls } = fakeTmux([FEAT_FREETEXT_TICKED]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_FREETEXT_TICKED), [1, 3]);
    expect(res).toEqual({ ok: false, error: 'free-text-ticked' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it.each([
    // Recorded: a digit here is TYPED into the row ("4. [✔] 2"), which ticks it and changes the dialog's id.
    ['on the free-text row', FEAT_ON_FREETEXT, [1, 3]],
    // Recorded twice: Tab on the Next row after a walk through the free-text row left the screen byte-identical.
    ['on the Next row, the edit hint showing', FEAT_NEXT, [1, 3]],
    ['on the Next row of another question', fixture('cc300-ask-multiselect-walk-to-next.txt'), [1]],
  ])('cursor-not-on-option with the cursor %s: zero keys', async (_name, pane, indexes) => {
    const { tmux, calls } = fakeTmux([pane]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(pane), indexes);
    expect(res).toEqual({ ok: false, error: 'cursor-not-on-option' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('cursor-not-on-option with the cursor on "Chat about this" (DERIVED: the ❯ moved from row 1 to row 5)', async () => {
    const onChat = derive(derive(FEAT_1, '❯ 1. [✔] Logging', '  1. [✔] Logging'), '  5. Chat about this', '❯ 5. Chat about this');
    expect(idOf(onChat)).toBe(idOf(FEAT_1));
    const { tmux, calls } = fakeTmux([onChat]);
    expect(await answerDialogMulti(deps(tmux), SID, idOf(onChat), [1, 3])).toEqual({ ok: false, error: 'cursor-not-on-option' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('cursor-not-on-option when the edit hint shows, even with the cursor on an option row (DERIVED: row 3 + the hint)', async () => {
    // The hint says the free-text input may still hold the keys. Measured, it outlives the row only BELOW it (Next,
    // Chat): a walk back up onto an option row drops it. A screen that shows both is unmeasured, so it is refused.
    const hinted = derive(FEAT_ROW3, 'Tab/Arrow keys to navigate · Esc to cancel', 'Tab/Arrow keys to navigate · ctrl+g to edit in Vim · Esc to cancel');
    const { tmux, calls } = fakeTmux([hinted]);
    expect(await answerDialogMulti(deps(tmux), SID, idOf(hinted), [1, 3])).toEqual({ ok: false, error: 'cursor-not-on-option' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it.each([
    ['an empty set (Tab on no box skips the question, which is not an answer)', []],
    ['a repeated index', [1, 1]],
    ['index 0', [0]],
    ['a negative index', [-1]],
    ['an index past the digits', [10]],
    ['a fraction', [1.5]],
    ['NaN', [Number.NaN]],
  ])('bad-indexes before any capture or key: %s', async (_name, indexes) => {
    const { tmux, calls } = fakeTmux([FEAT_1, FEAT_1_3, TOOLS_Q]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1), indexes as number[]);
    expect(res).toEqual({ ok: false, error: 'bad-indexes' });
    expect(captureCalls(calls)).toEqual([]);
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  // ── ticks-failed: digits sent, and NO Tab ──

  it('no re-capture shows the wanted ticks: ticks-failed, and no Tab', async () => {
    const { tmux, calls } = fakeTmux([FEAT_1, FEAT_1]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1), [1, 3]);
    expect(res).toEqual({ ok: false, error: 'ticks-failed' });
    expect(sendKeysCalls(calls)).toEqual(keys('3'));
  });

  it('the pane moved on to another question before the proof: ticks-failed, no Tab', async () => {
    const { tmux, calls } = fakeTmux([FEAT_1, TOOLS_Q]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1), [1, 3]);
    expect(res).toEqual({ ok: false, error: 'ticks-failed' });
    expect(hasTab(calls)).toBe(false);
  });

  it('another question showing the same ticks is not this one: ticks-failed, no Tab', async () => {
    // "Which tools?" with Saw and Drill ticked, the cursor on row 1: the very ticks and cursor wanted on "Which features
    // do you want?", on a question that moved in under it. The dialog id tells them apart.
    const { tmux, calls } = fakeTmux([FEAT_OPEN, fixture('cc300-ask-multiselect-submit-digit2-3.txt')]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_OPEN), [2, 3]);
    expect(res).toEqual({ ok: false, error: 'ticks-failed' });
    expect(sendKeysCalls(calls)).toEqual(keys('2', '3'));
  });

  it('the ticks match but the cursor moved to another option row: ticks-failed, no Tab', async () => {
    // A digit does not move the cursor (measured), so a cursor that moved means someone else is at the keys.
    const { tmux, calls } = fakeTmux([FEAT_1, FEAT_ROW3]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1), [1, 3]);
    expect(res).toEqual({ ok: false, error: 'ticks-failed' });
    expect(sendKeysCalls(calls)).toEqual(keys('3'));
  });

  it('the ticks and cursor match but the edit hint appeared (DERIVED: digit1-3 + the hint): ticks-failed, no Tab', async () => {
    const hinted = derive(FEAT_1_3, 'Tab/Arrow keys to navigate · Esc to cancel', 'Tab/Arrow keys to navigate · ctrl+g to edit in Vim · Esc to cancel');
    const { tmux, calls } = fakeTmux([FEAT_1, hinted]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1), [1, 3]);
    expect(res).toEqual({ ok: false, error: 'ticks-failed' });
    expect(sendKeysCalls(calls)).toEqual(keys('3'));
  });

  it('the ticks match but the cursor is now on the free-text row: ticks-failed, no Tab', async () => {
    const { tmux, calls } = fakeTmux([FEAT_1, FEAT_ON_FREETEXT]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1), [1, 3]);
    expect(res).toEqual({ ok: false, error: 'ticks-failed' });
    expect(hasTab(calls)).toBe(false);
  });

  it('the wanted options are ticked, and so is the free-text box: ticks-failed, no Tab', async () => {
    const { tmux, calls } = fakeTmux([FEAT_1, FEAT_FREETEXT_TICKED]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1), [1, 3]);
    expect(res).toEqual({ ok: false, error: 'ticks-failed' });
    expect(hasTab(calls)).toBe(false);
  });

  it('the capture after the digits fails: ticks-failed, no Tab', async () => {
    const { tmux, calls } = fakeTmux([FEAT_OPEN, null]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_OPEN), [2]);
    expect(res).toEqual({ ok: false, error: 'ticks-failed' });
    expect(sendKeysCalls(calls)).toEqual(keys('2'));
  });

  // ── commit-failed: Tab sent, the screen did not move ──

  it('the screen did not move after Tab: commit-failed', async () => {
    const { tmux, calls } = fakeTmux([FEAT_1_3]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1_3), [1, 3]);
    expect(res).toEqual({ ok: false, error: 'commit-failed' });
    expect(sendKeysCalls(calls)).toEqual(keys('Tab'));
  });

  it('a new id under the SAME title is no commit: text in the free-text row changes the id, not the question', async () => {
    // Recorded: a digit typed into the free-text row ("4. [✔] 2") changes the dialog's id, since the id hashes the
    // labels. The question did not move on, so the move is proved by the title.
    const typed = fixture('cc300-ask-multiselect-digit-typed-on-freetext.txt');
    expect(idOf(typed)).not.toBe(idOf(FEAT_1_3));
    expect(parseDialog(typed)!.title).toBe(parseDialog(FEAT_1_3)!.title);
    const { tmux, calls } = fakeTmux([FEAT_1_3, FEAT_1_3, typed]);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1_3), [1, 3]);
    expect(res).toEqual({ ok: false, error: 'commit-failed' });
    expect(sendKeysCalls(calls)).toEqual(keys('Tab'));
  });

  it('no menu at all after Tab is no proof: a multiSelect question is always followed by a question or the review', async () => {
    const { tmux, calls } = fakeTmux([FEAT_1_3, FEAT_1_3, 'done\n❯ \n']);
    const res = await answerDialogMulti(deps(tmux), SID, idOf(FEAT_1_3), [1, 3]);
    expect(res).toEqual({ ok: false, error: 'commit-failed' });
    expect(sendKeysCalls(calls)).toEqual(keys('Tab'));
  });
});

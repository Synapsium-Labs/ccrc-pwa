import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyedQueue } from '../src/inject/queue.js';
import { answerDialogText, type SendDeps } from '../src/inject/send.js';
import { parseDialog } from '../src/pane/dialog.js';
import { Tmux, type Runner } from '../src/exec.js';
import { tmuxTarget } from '../../shared/tmux-target.js';
import { DIALOG_TEXT_MAX } from '../../shared/api.js';

// D-5047 (plan docs/superpowers/plans/2026-10-15-ask-server-half.md, Task 3): `POST /api/sessions/:id/dialog/text`
// types an answer into an AskUserQuestion's free-text ("Type something.") row. Enter on that row while it is EMPTY
// rejects the WHOLE ask and discards every question already answered (measured on Claude Code 2.1.300 and 2.1.291), so
// nothing is typed until a capture proves the cursor is on the empty row, and Enter is pressed only once a capture
// proves the row holds exactly the text. Every pane here is a recorded 2.1.300 screen (`fixtures/panes/cc300-ask-*.txt`,
// 220x50, read with `capture-pane -p` as `Tmux.capture` reads), or one marked DERIVED with the edit it makes.


/** `answer.test.ts`'s scripted-capture fake: capture-pane answers the scripted panes in order (the last one repeats;
 *  null is exit 1). `failLiteral` makes every `send-keys -l` exit 1, as tmux does when the session has gone. */
function fakeTmux(panes: (string | null)[], opts: { failLiteral?: boolean } = {}) {
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') {
      const pane = panes[Math.min(capIdx, panes.length - 1)] ?? null;
      capIdx++;
      return pane === null ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: pane, stderr: '' };
    }
    if (opts.failLiteral === true && args[0] === 'send-keys' && args[3] === '-l') return { code: 1, stdout: '', stderr: '' };
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
const literal = (t: string): string[] => ['tmux', 'send-keys', '-t', tmuxTarget(SID), '-l', '--', t];
const idOf = (pane: string): string => parseDialog(pane)!.id;
/** A DERIVED pane: `from` must be on the recorded screen, or the derivation silently tests the original. */
const derive = (pane: string, from: string, to: string): string => {
  expect(pane, `the derivation's anchor "${from}" is not on the screen`).toContain(from);
  return pane.replace(from, to);
};
const hasEnter = (calls: string[][]): boolean => sendKeysCalls(calls).some((c) => c.at(-1) === 'Enter');

// One recorded walk, "Enable tracing?" (Yes / No / 3. Type something. / rule / 4. Chat about this), in screen order.
const OPEN = fixture('cc300-ask-same-labels-q2.txt');                 // cursor on 1. Yes
const FOCUSED = fixture('cc300-ask-freetext-walk-2-focused.txt');     // cursor on the empty row, footer gains the hint
const TYPED = fixture('cc300-ask-freetext-walk-3-typed.txt');         // the row holds TEXT, the cursor on it
const STEPPED_OFF = fixture('cc300-ask-freetext-walk-4-stepped-off.txt'); // TEXT held, cursor up on 2. No, no hint
const BACK_ON_HELD = fixture('cc300-ask-freetext-walk-5-back-on-held.txt'); // TEXT held, cursor back on it, the hint
/** The text that recording typed. It starts with '-', which only reaches the row after tmux's `--` (D-5046). */
const TEXT = '- only in staging, sampled 10%';

describe('answerDialogText: types into the free-text row, proved focused and echoed before Enter (D-5047)', () => {
  it('walks onto the empty Type something. row, proves focus, types after --, proves the echo, then presses Enter', async () => {
    const { tmux, calls } = fakeTmux([OPEN, FOCUSED, TYPED]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, TEXT);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down'), literal(TEXT), key('Enter')]);
    // Typing changed the dialog id (it hashes the labels, and the row's label is now the text), while the title
    // stayed. So the echo is proved by the title and the row, never by the id the caller sent.
    expect(idOf(TYPED)).not.toBe(idOf(OPEN));
    expect(parseDialog(TYPED)!.title).toBe(parseDialog(OPEN)!.title);
  });

  it('the cursor already on the empty row: no walk keys at all', async () => {
    const { tmux, calls } = fakeTmux([FOCUSED, FOCUSED, TYPED]);
    const res = await answerDialogText(deps(tmux), SID, idOf(FOCUSED), 3, TEXT);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([literal(TEXT), key('Enter')]);
  });

  it('a 1000-character answer: one literal, and the echo is proved over every row it wraps to', async () => {
    // A long question, so its title is the wrapped question's last row, `│ ` kept. The 1000-character answer was typed
    // as one literal and painted as 5 rows: parseDialog reads the first row as the label and the rest as the
    // description, and label + ' ' + description is the text exactly. The label alone is a prefix of it.
    const open = fixture('cc300-ask-wrapped-question.txt');
    const focused = fixture('cc300-ask-wrapped-question-focused.txt');
    const typed = fixture('cc300-ask-freetext-1000.txt');
    const row = parseDialog(typed)!.options[2]!;
    const text = `${row.label} ${row.description!}`;
    expect(text).toHaveLength(DIALOG_TEXT_MAX);
    expect(row.label.length).toBeLessThan(text.length);
    const { tmux, calls } = fakeTmux([open, focused, typed]);
    const res = await answerDialogText(deps(tmux), SID, idOf(open), 3, text);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down'), literal(text), key('Enter')]);
  });

  it('a slow render is waited for: the echo is polled, as the composer polls its own', async () => {
    const { tmux, calls } = fakeTmux([OPEN, FOCUSED, FOCUSED, TYPED]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, TEXT);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down'), literal(TEXT), key('Enter')]);
  });

  // ── The stranded echo: a row that already holds exactly the requested text ──

  it('a retry onto a row that already holds exactly the text walks, proves it, presses Enter, and types nothing', async () => {
    // A send that typed but never proved its echo leaves the text in the row. Measured: the text survives stepping
    // off and back on, the hint returns on the held row, and Enter there submits the text as the answer.
    const { tmux, calls } = fakeTmux([STEPPED_OFF, BACK_ON_HELD]);
    const res = await answerDialogText(deps(tmux), SID, idOf(STEPPED_OFF), 3, TEXT);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Enter')]);
  });

  it('a retry with the cursor already on the held row is one Enter', async () => {
    const { tmux, calls } = fakeTmux([BACK_ON_HELD, BACK_ON_HELD]);
    const res = await answerDialogText(deps(tmux), SID, idOf(BACK_ON_HELD), 3, TEXT);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([key('Enter')]);
  });

  // ── Refused before any key ──

  it('stale dialog id: zero keys', async () => {
    const { tmux, calls } = fakeTmux([OPEN]);
    const res = await answerDialogText(deps(tmux), SID, 'deadbeef', 3, TEXT);
    expect(res).toEqual({ ok: false, error: 'stale-dialog' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('no menu on screen: stale-dialog, zero keys', async () => {
    const { tmux, calls } = fakeTmux(['done\n❯ \n']);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, TEXT);
    expect(res).toEqual({ ok: false, error: 'stale-dialog' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('not-alive when the capture fails: zero keys', async () => {
    const { tmux, calls } = fakeTmux([null]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, TEXT);
    expect(res).toEqual({ ok: false, error: 'not-alive' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it.each([
    [2, 'an ordinary option ("No")'],
    [4, '"Chat about this"'],
  ])('index %i, %s, is not the free-text row: zero keys', async (index) => {
    const { tmux, calls } = fakeTmux([OPEN]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), index, TEXT);
    expect(res).toEqual({ ok: false, error: 'not-free-text' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('a row holding DIFFERENT text is refused: typing would append to it, and Enter would submit the mix', async () => {
    const held = fixture('cc300-ask-freetext-held.txt'); // "Which fruit?": row 3 holds "Mango", the cursor on it
    const { tmux, calls } = fakeTmux([held]);
    const res = await answerDialogText(deps(tmux), SID, idOf(held), 3, 'Papaya');
    expect(res).toEqual({ ok: false, error: 'not-free-text' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('a multiSelect question\'s free-text row is refused: free text inside multiSelect is not in v1', async () => {
    // The cursor sits on "4. [ ] Type something". A digit or text typed there ticks the box and changes the screen.
    const multi = fixture('cc300-ask-multiselect-on-freetext.txt');
    const { tmux, calls } = fakeTmux([multi]);
    const res = await answerDialogText(deps(tmux), SID, idOf(multi), 4, TEXT);
    expect(res).toEqual({ ok: false, error: 'not-free-text' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('the review screen has no free-text row', async () => {
    const review = fixture('cc300-ask-review-same-labels.txt');
    const { tmux, calls } = fakeTmux([review]);
    const res = await answerDialogText(deps(tmux), SID, idOf(review), 1, TEXT);
    expect(res).toEqual({ ok: false, error: 'not-free-text' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('a row whose text equals the answer is still not the free-text row: the review screen\'s "Cancel"', async () => {
    // "2. Cancel" holds exactly the text "Cancel", which is what a held free-text row looks like to the retry arm. It
    // is an ordinary row, and Enter on it was measured to reject the whole ask, every answer with it.
    const review = fixture('cc300-ask-review-same-labels.txt');
    const { tmux, calls } = fakeTmux([review]);
    const res = await answerDialogText(deps(tmux), SID, idOf(review), 2, 'Cancel');
    expect(res).toEqual({ ok: false, error: 'not-free-text' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['two lines', 'line one\nline two'],
    ['a CRLF', 'line one\r\nline two'],
    ['an Escape sequence', '\x1b[31mred'],
    ['a Tab', 'a\tb'],
    ['ctrl+g, which opens the external editor', 'edit\x07'],
    ['DEL', 'oops\x7f'],
    ['an 8-bit CSI (C1)', 'csi\u009b31m'],
    ['a Unicode line separator', 'one\u2028two'],
    ['one character over the cap', 'x'.repeat(DIALOG_TEXT_MAX + 1)],
  ])('bad-text before any capture or key: %s', async (_name, text) => {
    const { tmux, calls } = fakeTmux([OPEN, FOCUSED, TYPED]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, text);
    expect(res).toEqual({ ok: false, error: 'bad-text' });
    expect(captureCalls(calls)).toEqual([]);
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  // ── focus-failed: nothing typed, no Enter ──

  it('the walk did not land: focus-failed, no literal, no Enter', async () => {
    const { tmux, calls } = fakeTmux([OPEN, OPEN]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, TEXT);
    expect(res).toEqual({ ok: false, error: 'focus-failed' });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down')]);
  });

  it('the cursor on the row but no edit hint in the footer (DERIVED): focus-failed', async () => {
    const noHint = derive(FOCUSED, ' · ctrl+g to edit in Vim', '');
    const { tmux, calls } = fakeTmux([OPEN, noHint]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, TEXT);
    expect(res).toEqual({ ok: false, error: 'focus-failed' });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down')]);
  });

  it('the hint alone proves nothing: it outlives the row, and here the cursor sits on Chat about this', async () => {
    // Recorded: a walk THROUGH the free-text row leaves the hint on the row below it.
    const open = fixture('cc300-ask-1q-open.txt');
    const { tmux, calls } = fakeTmux([open, fixture('cc300-ask-1q-walk-through-to-chat.txt')]);
    const res = await answerDialogText(deps(tmux), SID, idOf(open), 3, TEXT);
    expect(res).toEqual({ ok: false, error: 'focus-failed' });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down')]);
  });

  it('the pane moved on to another question during the walk: focus-failed', async () => {
    // "Enable caching?" was answered in the terminal meanwhile; "Enable tracing?" now shows its own empty row,
    // focused, under the same index. Its title is not the one the request was checked against.
    const q1 = fixture('cc300-ask-same-labels-q1.txt');
    const { tmux, calls } = fakeTmux([q1, FOCUSED]);
    const res = await answerDialogText(deps(tmux), SID, idOf(q1), 3, TEXT);
    expect(res).toEqual({ ok: false, error: 'focus-failed' });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down')]);
  });

  it('the empty row filled during the walk: focus-failed, nothing typed onto it', async () => {
    const { tmux, calls } = fakeTmux([OPEN, BACK_ON_HELD]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, 'Papaya');
    expect(res).toEqual({ ok: false, error: 'focus-failed' });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down')]);
  });

  it('a retry whose held row is EMPTY by the time the walk lands: focus-failed, and never Enter on the empty row', async () => {
    // The row held the text on the first look and reads as the empty placeholder on the landing. Enter there would
    // reject the whole ask, so the retry arm proves the held text again before it presses anything.
    const { tmux, calls } = fakeTmux([STEPPED_OFF, FOCUSED]);
    const res = await answerDialogText(deps(tmux), SID, idOf(STEPPED_OFF), 3, TEXT);
    expect(res).toEqual({ ok: false, error: 'focus-failed' });
    expect(sendKeysCalls(calls)).toEqual([key('Down')]);
  });

  it('the capture after the walk fails: focus-failed', async () => {
    const { tmux, calls } = fakeTmux([OPEN, null]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, TEXT);
    expect(res).toEqual({ ok: false, error: 'focus-failed' });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down')]);
  });

  // ── echo-failed: typed, and NO Enter ──

  it('the text never showed: echo-failed, and NO Enter on what may still be the empty row', async () => {
    const { tmux, calls } = fakeTmux([OPEN, FOCUSED, FOCUSED]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, TEXT);
    expect(res).toEqual({ ok: false, error: 'echo-failed' });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down'), literal(TEXT)]);
  });

  it('the row shows other text: echo-failed, no Enter (tmux drops a trailing ";" from a literal, measured on 3.7c)', async () => {
    // The recorded row holds TEXT. Asked to type TEXT + ';', tmux would type TEXT and drop the ';', which is exactly
    // this screen: the row holds less than was asked, and Enter would submit an answer nobody wrote.
    const { tmux, calls } = fakeTmux([OPEN, FOCUSED, TYPED]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, `${TEXT};`);
    expect(res).toEqual({ ok: false, error: 'echo-failed' });
    expect(hasEnter(calls)).toBe(false);
  });

  it('the title changed under the typing (DERIVED): echo-failed, no Enter', async () => {
    const otherTitle = derive(TYPED, '\nEnable tracing?\n', '\nEnable caching?\n');
    const { tmux, calls } = fakeTmux([OPEN, FOCUSED, otherTitle]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, TEXT);
    expect(res).toEqual({ ok: false, error: 'echo-failed' });
    expect(hasEnter(calls)).toBe(false);
  });

  it('the cursor left the row before Enter: echo-failed, since Enter answers whatever row the cursor is on', async () => {
    const { tmux, calls } = fakeTmux([OPEN, FOCUSED, STEPPED_OFF]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, TEXT);
    expect(res).toEqual({ ok: false, error: 'echo-failed' });
    expect(hasEnter(calls)).toBe(false);
  });

  it('a text that reads as the empty placeholder can never prove its echo: echo-failed, no Enter', async () => {
    // The row reads "Type something." both before and after typing those words, so no capture tells "typed" from
    // "empty", and Enter on an empty row rejects the whole ask.
    const { tmux, calls } = fakeTmux([OPEN, FOCUSED, FOCUSED]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, 'Type something.');
    expect(res).toEqual({ ok: false, error: 'echo-failed' });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down'), literal('Type something.')]);
  });

  it('tmux refuses the literal send: echo-failed, no Enter', async () => {
    const { tmux, calls } = fakeTmux([OPEN, FOCUSED, TYPED], { failLiteral: true });
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, TEXT);
    expect(res).toEqual({ ok: false, error: 'echo-failed' });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down'), literal(TEXT)]);
  });
});

// Decision `ask-answer-returns-next-screen`: the typed answer returns the screen the pane moved to. Typing changed the
// question's id (its label is the text), so the typed row is still the answered question, never "the next screen": the
// tests above, whose pane stays on TYPED, answer `{ ok: true }` with no `next`.
describe('answerDialogText returns the screen it moved to', () => {
  it('the typed answer to the last question returns the review screen', async () => {
    const review = fixture('cc300-ask-review-same-labels.txt');
    const { tmux } = fakeTmux([OPEN, FOCUSED, TYPED, review, review]);
    const res = await answerDialogText(deps(tmux), SID, idOf(OPEN), 3, TEXT);
    expect(res).toEqual({ ok: true, next: parseDialog(review) });
  });
});

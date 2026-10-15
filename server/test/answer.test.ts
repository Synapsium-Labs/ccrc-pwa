import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyedQueue } from '../src/inject/queue.js';
import { answerDialog, interrupt, type SendDeps } from '../src/inject/send.js';
import { parseDialog } from '../src/pane/dialog.js';
import { Tmux, type Runner } from '../src/exec.js';
import { tmuxTarget } from '../../shared/tmux-target.js';

const noSleep = async () => {};

/** Tmux backed by a fake runner: capture-pane returns scripted panes in order (last one repeats; null → code 1). */
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
const deps = (tmux: Tmux): SendDeps => ({ tmux, queue: new KeyedQueue(), sleep: noSleep });

const OPTS = ['A + B drawer (Recommended)', 'A pure', 'B first, A later', 'Other'];

/** The ask-user-question menu with the ❯ marker on option `selected`. */
function menuPane(selected: number): string {
  const lines = ['● Which architecture should we go with?', ''];
  OPTS.forEach((label, i) => {
    const n = i + 1;
    lines.push(`${n === selected ? '❯' : ' '} ${n}. ${label}`);
  });
  lines.push('', 'Enter to confirm · Esc to cancel');
  return lines.join('\n') + '\n';
}

const DIALOG_ID = parseDialog(menuPane(1))!.id;

/** The real spinner row from fixtures/panes/busy.txt, plus the blank line an
 *  RC-off pane paints between it and the dialog below — same shape as
 *  sessionws.test.ts's / push-copy.test.ts's D-102 combo panes. Prepending it
 *  leaves `menuPane`'s title and labels (hence `Dialog.id`) unchanged. */
const BUSY = '✳ Cerebrating… (12s · ↑ 1.2k tokens · esc to interrupt)\n\n';

describe('answerDialog', () => {
  it('walks down 2 with 150ms steps, verifies landing, then Enter', async () => {
    const { tmux, calls } = fakeTmux([menuPane(1), menuPane(3)]);
    const res = await answerDialog(deps(tmux), 'x', DIALOG_ID, 3);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', '=cc-x:', 'Down'],
      ['tmux', 'send-keys', '-t', '=cc-x:', 'Down'],
      ['tmux', 'send-keys', '-t', '=cc-x:', 'Enter'],
    ]);
  });

  it('walks up when the target is above the selection', async () => {
    const { tmux, calls } = fakeTmux([menuPane(3), menuPane(1)]);
    const res = await answerDialog(deps(tmux), 'x', DIALOG_ID, 1);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', '=cc-x:', 'Up'],
      ['tmux', 'send-keys', '-t', '=cc-x:', 'Up'],
      ['tmux', 'send-keys', '-t', '=cc-x:', 'Enter'],
    ]);
  });

  it('stale dialog id: no keys sent', async () => {
    const { tmux, calls } = fakeTmux([menuPane(1)]);
    const res = await answerDialog(deps(tmux), 'x', 'deadbeef', 2);
    expect(res).toEqual({ ok: false, error: 'stale-dialog' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('stale when the pane no longer shows a menu', async () => {
    const { tmux, calls } = fakeTmux(['done\n❯ \n']);
    const res = await answerDialog(deps(tmux), 'x', DIALOG_ID, 2);
    expect(res).toEqual({ ok: false, error: 'stale-dialog' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('walk lands wrong: walk-failed and Enter never sent', async () => {
    const { tmux, calls } = fakeTmux([menuPane(1), menuPane(1)]);
    const res = await answerDialog(deps(tmux), 'x', DIALOG_ID, 3);
    expect(res).toEqual({ ok: false, error: 'walk-failed' });
    const sk = sendKeysCalls(calls);
    expect(sk).toEqual([
      ['tmux', 'send-keys', '-t', '=cc-x:', 'Down'],
      ['tmux', 'send-keys', '-t', '=cc-x:', 'Down'],
    ]);
    expect(sk.some((c) => c[c.length - 1] === 'Enter')).toBe(false);
  });

  it('not-alive when capture fails', async () => {
    const { tmux, calls } = fakeTmux([null]);
    const res = await answerDialog(deps(tmux), 'x', DIALOG_ID, 2);
    expect(res).toEqual({ ok: false, error: 'not-alive' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  // D-102 fix round 2. parseDialog's own busy-veto used to make this pane
  // read as no-dialog-here, so a busy marker painted alongside a still-open
  // menu forced 'stale-dialog' — an accidental refusal in the ONE path that
  // types keys into a live session. Nothing else in the suite notices this
  // widening (a busy veto re-added inside answerDialog leaves the whole repo
  // green): pin it here, directly.
  it('D-102: a busy spinner painted alongside the menu no longer refuses the answer', async () => {
    const { tmux, calls } = fakeTmux([BUSY + menuPane(1), BUSY + menuPane(2)]);
    const res = await answerDialog(deps(tmux), 'x', DIALOG_ID, 2);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', '=cc-x:', 'Down'],
      ['tmux', 'send-keys', '-t', '=cc-x:', 'Enter'],
    ]);
  });
});

// D-5045 (plan docs/superpowers/plans/2026-10-15-ask-server-half.md, Task 1). Enter on an AskUserQuestion's EMPTY
// "Type something." row does not answer the question: it rejects the WHOLE tool call ("User declined to answer
// questions"), and every question already answered is thrown away with it. Measured on Claude Code 2.1.300 and
// 2.1.291. So `answerDialog` refuses that row before any key. Every pane here is a recorded 2.1.300 screen
// (`fixtures/panes/cc300-ask-*.txt`), or one marked DERIVED with the edit it makes.
describe('answerDialog and the free-text row (D-5045)', () => {
  const panesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes');
  const fixture = (name: string): string => readFileSync(path.join(panesDir, name), 'utf8');
  const SID = 'lane-a:project-a';
  const key = (k: string): string[] => ['tmux', 'send-keys', '-t', tmuxTarget(SID), k];
  const idOf = (pane: string): string => parseDialog(pane)!.id;
  /** A DERIVED pane: `from` must be on the recorded screen, or the derivation silently tests the original. */
  const derive = (pane: string, from: string, to: string): string => {
    expect(pane, `the derivation's anchor "${from}" is not on the screen`).toContain(from);
    return pane.replace(from, to);
  };
  const Q2 = fixture('cc300-ask-same-labels-q2.txt');             // "Enable tracing?": Yes / No / Type something. / Chat
  const Q2_FOCUSED = fixture('cc300-ask-freetext-walk-2-focused.txt'); // the same screen, cursor on row 3

  it('refuses to walk onto the empty Type something. row: Enter there rejects the whole ask', async () => {
    const { tmux, calls } = fakeTmux([Q2, Q2_FOCUSED]);
    const res = await answerDialog(deps(tmux), SID, idOf(Q2), 3);
    expect(res).toEqual({ ok: false, error: 'free-text-row' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('the structural backstop refuses a re-worded placeholder (DERIVED: "Type something." reads "Other")', async () => {
    // The bundle's own row is `label: "Other"` with a variable placeholder, and an older synthetic shape painted
    // `4. Other`: the label is one rendered string. The row directly above the rule that precedes a NUMBERED "Chat
    // about this" is the input row whatever it says.
    const open = derive(Q2, '3. Type something.', '3. Other');
    const focused = derive(Q2_FOCUSED, '3. Type something.', '3. Other');
    const { tmux, calls } = fakeTmux([open, focused]);
    const res = await answerDialog(deps(tmux), SID, idOf(open), 3);
    expect(res).toEqual({ ok: false, error: 'free-text-row' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('the placeholder label alone names the row when no numbered Chat row backs it (DERIVED: Chat unnumbered)', async () => {
    const open = derive(Q2, '  4. Chat about this', '  Chat about this');
    const focused = derive(Q2_FOCUSED, '  4. Chat about this', '  Chat about this');
    expect(parseDialog(open)!.options.map((o) => o.label)).toEqual(['Yes', 'No', 'Type something.', 'Chat about this']);
    const { tmux, calls } = fakeTmux([open, focused]);
    const res = await answerDialog(deps(tmux), SID, idOf(open), 3);
    expect(res).toEqual({ ok: false, error: 'free-text-row' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('a row that holds typed text is refused too: answerDialog never submits typed text', async () => {
    // "Mango" was typed into Q1's free-text row; the cursor rests on it. Enter here WOULD submit "Mango" — as an
    // answer nobody chose in the sheet. The free-text route's retry arm (D-5047) is the one path that submits it.
    const held = fixture('cc300-ask-freetext-held.txt');
    const { tmux, calls } = fakeTmux([held, held]);
    const res = await answerDialog(deps(tmux), SID, idOf(held), 3);
    expect(res).toEqual({ ok: false, error: 'free-text-row' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('a multiSelect question\'s "[ ] Type something" row is refused before any key', async () => {
    const multi = fixture('cc300-ask-multiselect-next-open.txt');
    const { tmux, calls } = fakeTmux([multi, multi]);
    const res = await answerDialog(deps(tmux), SID, idOf(multi), 4);
    expect(res).toEqual({ ok: false, error: 'free-text-row' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('the landing is looked at again: a walk that lands on a free-text row never presses Enter', async () => {
    // Row 3 is "Blue" on the screen the request was checked against, and the free-text row on the screen the walk
    // lands on: the pane moved on between the two captures. `walk-failed` cannot see it, since the cursor IS on row 3.
    const q1 = fixture('cc300-ask-q1-of-2.txt');
    const { tmux, calls } = fakeTmux([q1, Q2_FOCUSED]);
    const res = await answerDialog(deps(tmux), SID, idOf(q1), 3);
    expect(res).toEqual({ ok: false, error: 'free-text-row' });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down')]);
  });

  // ── Companions: no over-refusal ──

  it('an ordinary option still answers ("No" on the same screen)', async () => {
    const { tmux, calls } = fakeTmux([Q2, fixture('cc300-ask-freetext-walk-1-down.txt')]);
    const res = await answerDialog(deps(tmux), SID, idOf(Q2), 2);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Enter')]);
  });

  it('"Chat about this" still answers: the walk passes THROUGH the free-text row, and Enter lands on Chat', async () => {
    // Measured: Enter on Chat after a walk through the empty row gives Chat's own outcome, not the empty-row cancel.
    const open = fixture('cc300-ask-1q-open.txt');
    const { tmux, calls } = fakeTmux([open, fixture('cc300-ask-1q-walk-through-to-chat.txt')]);
    const res = await answerDialog(deps(tmux), SID, idOf(open), 4);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down'), key('Down'), key('Enter')]);
  });

  it('the two-column layout\'s last real option still answers: its "Chat about this" is unnumbered', async () => {
    // That layout has no free-text row at all ("Notes: press n to add notes" instead). Its last numbered row is a
    // real option directly above a rule and an UNNUMBERED Chat row, so a backstop that accepted that shape would
    // refuse a real answer here.
    const open = fixture('ask-2col-chat-about.txt');
    const landed = derive(derive(open, '❯ 1. Forward-fill', '  1. Forward-fill'), '  3. Ship as-is', '❯ 3. Ship as-is');
    const { tmux, calls } = fakeTmux([open, landed]);
    const res = await answerDialog(deps(tmux), SID, idOf(open), 3);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([key('Down'), key('Down'), key('Enter')]);
  });

  it('the review screen\'s "Submit answers" still answers', async () => {
    const review = fixture('cc300-ask-review-same-labels.txt');
    const { tmux, calls } = fakeTmux([review, review]);
    const res = await answerDialog(deps(tmux), SID, idOf(review), 1);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([key('Enter')]);
  });
});

describe('interrupt', () => {
  // Busy-ness comes from an injected resolver (the authoritative live status
  // file), NOT the pane: a --remote-control pane never renders "esc to
  // interrupt" at all, and an RC-off pane does render it, but the same marker
  // can sit under (or beside) a dialog painted over it — either way
  // pane-based busy detection would report the wrong thing, and the live
  // status file is the one signal that also sees subagents (inject/send.ts's
  // `interrupt` docstring, D-102).
  it('busy (per resolver): sends Escape', async () => {
    const { tmux, calls } = fakeTmux(['generation in progress\n❯ \n']);
    const res = await interrupt(deps(tmux), 'x', async () => true);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', '=cc-x:', 'Escape']]);
  });

  it('idle (per resolver): not-busy, no keys sent', async () => {
    const { tmux, calls } = fakeTmux(['scrollback\n❯ \n']);
    const res = await interrupt(deps(tmux), 'x', async () => false);
    expect(res).toEqual({ ok: false, error: 'not-busy' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('not-alive when capture fails', async () => {
    const { tmux } = fakeTmux([null]);
    const res = await interrupt(deps(tmux), 'x', async () => true);
    expect(res).toEqual({ ok: false, error: 'not-alive' });
  });
});

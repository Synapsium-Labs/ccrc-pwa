import { describe, it, expect } from 'vitest';
import { KeyedQueue } from '../src/inject/queue.js';
import { answerDialog, interrupt, type SendDeps } from '../src/inject/send.js';
import { parseDialog } from '../src/pane/dialog.js';
import { Tmux, type Runner } from '../src/exec.js';

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
      ['tmux', 'send-keys', '-t', 'cc-x', 'Down'],
      ['tmux', 'send-keys', '-t', 'cc-x', 'Down'],
      ['tmux', 'send-keys', '-t', 'cc-x', 'Enter'],
    ]);
  });

  it('walks up when the target is above the selection', async () => {
    const { tmux, calls } = fakeTmux([menuPane(3), menuPane(1)]);
    const res = await answerDialog(deps(tmux), 'x', DIALOG_ID, 1);
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', 'cc-x', 'Up'],
      ['tmux', 'send-keys', '-t', 'cc-x', 'Up'],
      ['tmux', 'send-keys', '-t', 'cc-x', 'Enter'],
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
      ['tmux', 'send-keys', '-t', 'cc-x', 'Down'],
      ['tmux', 'send-keys', '-t', 'cc-x', 'Down'],
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
      ['tmux', 'send-keys', '-t', 'cc-x', 'Down'],
      ['tmux', 'send-keys', '-t', 'cc-x', 'Enter'],
    ]);
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
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', 'cc-x', 'Escape']]);
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

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
});

describe('interrupt', () => {
  it('busy pane: sends Escape', async () => {
    const { tmux, calls } = fakeTmux(['✻ Pondering… (esc to interrupt)\n']);
    const res = await interrupt(deps(tmux), 'x');
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', 'cc-x', 'Escape']]);
  });

  it('idle pane: not-busy, no keys sent', async () => {
    const { tmux, calls } = fakeTmux(['scrollback\n❯ \n']);
    const res = await interrupt(deps(tmux), 'x');
    expect(res).toEqual({ ok: false, error: 'not-busy' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('not-alive when capture fails', async () => {
    const { tmux } = fakeTmux([null]);
    const res = await interrupt(deps(tmux), 'x');
    expect(res).toEqual({ ok: false, error: 'not-alive' });
  });
});

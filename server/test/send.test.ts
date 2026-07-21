import { describe, it, expect } from 'vitest';
import { KeyedQueue } from '../src/inject/queue.js';
import { sendPrompt } from '../src/inject/send.js';
import { Tmux, type Runner } from '../src/exec.js';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
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

describe('KeyedQueue', () => {
  it('same key runs FIFO even when the first fn is slow', async () => {
    const q = new KeyedQueue();
    const order: string[] = [];
    const p1 = q.run('k', async () => { await wait(30); order.push('a'); return 'a'; });
    const p2 = q.run('k', async () => { order.push('b'); return 'b'; });
    expect(await Promise.all([p1, p2])).toEqual(['a', 'b']);
    expect(order).toEqual(['a', 'b']);
  });

  it('different keys interleave', async () => {
    const q = new KeyedQueue();
    const order: string[] = [];
    const pa = q.run('a', async () => { await wait(40); order.push('a'); });
    const pb = q.run('b', async () => { order.push('b'); });
    await Promise.all([pa, pb]);
    expect(order).toEqual(['b', 'a']);
  });

  it('a rejected fn does not block later fns on the same key', async () => {
    const q = new KeyedQueue();
    await expect(q.run('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await q.run('k', async () => 42)).toBe(42);
  });
});

describe('sendPrompt', () => {
  it('happy path: sends -l literal, verifies echo, then Enter', async () => {
    const { tmux, calls } = fakeTmux([
      'scrollback\n❯ \n',             // initial capture — empty draft
      'scrollback\n❯ hello world\n',  // verify capture echoes the text
    ]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'myid', 'hello world');
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', 'cc-myid', '-l', 'hello world'],
      ['tmux', 'send-keys', '-t', 'cc-myid', 'Enter'],
    ]);
  });

  it('not-alive when capture fails; nothing sent', async () => {
    const { tmux, calls } = fakeTmux([null]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi');
    expect(res).toEqual({ ok: false, error: 'not-alive' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('draft-present returns the draft text and sends nothing', async () => {
    const { tmux, calls } = fakeTmux(['❯ half-typed thought\n']);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi');
    expect(res).toEqual({ ok: false, error: 'draft-present', draft: 'half-typed thought' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('replaceDraft clears with C-u then proceeds', async () => {
    const { tmux, calls } = fakeTmux([
      '❯ old draft\n',  // initial — draft present
      '❯ \n',           // after C-u — cleared
      '❯ new text\n',   // verify
    ]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'new text', { replaceDraft: true });
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', 'cc-x', 'C-u'],
      ['tmux', 'send-keys', '-t', 'cc-x', '-l', 'new text'],
      ['tmux', 'send-keys', '-t', 'cc-x', 'Enter'],
    ]);
  });

  it('draft-clear-failed when C-u leaves the draft; only C-u was sent', async () => {
    const { tmux, calls } = fakeTmux(['❯ stubborn\n', '❯ stubborn\n']);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi', { replaceDraft: true });
    expect(res).toEqual({ ok: false, error: 'draft-clear-failed', draft: 'stubborn' });
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', 'cc-x', 'C-u']]);
  });

  it('multiline sends M-Enter between literals', async () => {
    const { tmux, calls } = fakeTmux(['❯ \n', '❯ a\n  b\n']);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'a\nb');
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', 'cc-x', '-l', 'a'],
      ['tmux', 'send-keys', '-t', 'cc-x', 'M-Enter'],
      ['tmux', 'send-keys', '-t', 'cc-x', '-l', 'b'],
      ['tmux', 'send-keys', '-t', 'cc-x', 'Enter'],
    ]);
  });

  it('ignores ❯ history lines; input box is the LAST ❯ line and uses a non-breaking space', async () => {
    // Real Claude Code panes render past user turns with `❯ ` (regular space)
    // ABOVE the live input box — and the empty input box renders as `❯` + U+00A0
    // NON-BREAKING SPACE. The draft check must read the input box (last ❯ line,
    // nbsp-marked), not the first ❯ history line — else every prompt into a
    // session with history false-positives as draft-present and is dropped.
    const NBSP = ' ';
    const withHistory = (box: string) =>
      'past context\n' +
      '❯ /effort ultracode\n' +               // history: ❯ + regular space
      '  ⎿  Set effort level to ultracode\n' +
      '❯ SENTINEL ping - reply with pong\n' +  // history: ❯ + regular space
      '● pong\n' +
      '─────────────────\n' +
      `❯${box === '' ? NBSP : ' ' + box}\n` +  // input box: ❯ + nbsp when empty
      '─────────────────\n' +
      '  👤 team·max │ 🤖 Fable 5\n';
    const { tmux, calls } = fakeTmux([
      withHistory(''),            // empty input box (❯ + nbsp) despite history ❯ lines above
      withHistory('hello world'), // verify: input box now echoes the text
    ]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'myid', 'hello world');
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', 'cc-myid', '-l', 'hello world'],
      ['tmux', 'send-keys', '-t', 'cc-myid', 'Enter'],
    ]);
  });

  it('ignores the dim ghost-suggestion placeholder in an empty input box', async () => {
    // Claude Code shows a DIM suggestion (e.g. "continue") in the empty box,
    // wrapped in \e[2m…\e[0m. It is not a real draft — sends must proceed, not
    // fail draft-present / draft-clear-failed. Draft check reads captureAnsi.
    const E = '\x1b';
    const placeholder = `some history\n${E}[39m❯ ${E}[2mcontinue${E}[0m\n`;
    const verify = `some history\n❯ hello\n`;
    const { tmux, calls } = fakeTmux([placeholder, verify]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hello');
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', 'cc-x', '-l', 'hello'],
      ['tmux', 'send-keys', '-t', 'cc-x', 'Enter'],
    ]);
    // draft check must use the ANSI capture (-e), not the plain one.
    expect(calls.some((c) => c[0] === 'tmux' && c[1] === 'capture-pane' && c.includes('-e'))).toBe(true);
  });

  it('reads a REAL typed draft (not dim) as a draft', async () => {
    const E = '\x1b';
    const realDraft = `history\n${E}[39m❯ half-typed thought\n`;
    const { tmux, calls } = fakeTmux([realDraft]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi');
    expect(res).toEqual({ ok: false, error: 'draft-present', draft: 'half-typed thought' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('detects a real draft in the input box even with history ❯ lines above', async () => {
    // The clip-path case: ccd clip types a path into the input box (no Enter),
    // and there is conversation history above. draftOf must return the box text.
    const pane =
      'earlier turn\n❯ old submitted prompt\n● a reply\n────\n❯ /home/u/.cc-clips/cctest/clip-1.png \n────\n status';
    const { tmux, calls } = fakeTmux([pane]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi');
    expect(res).toEqual({ ok: false, error: 'draft-present', draft: '/home/u/.cc-clips/cctest/clip-1.png' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('verify-failed when the pane never echoes the text; Enter never sent', async () => {
    const { tmux, calls } = fakeTmux(['❯ \n', '❯ \n']);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'will not appear');
    expect(res).toMatchObject({ ok: false, error: 'verify-failed' });
    expect((res as { pane?: string }).pane).toContain('❯');
    const sk = sendKeysCalls(calls);
    expect(sk).toContainEqual(['tmux', 'send-keys', '-t', 'cc-x', '-l', 'will not appear']);
    expect(sk.some((c) => c[c.length - 1] === 'Enter')).toBe(false);
  });
});

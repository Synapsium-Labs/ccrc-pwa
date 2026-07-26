import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
      'scrollback\n❯ \n',             // after Enter — box emptied, turn accepted
    ]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'myid', 'hello world');
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', 'cc-myid', '-l', 'hello world'],
      ['tmux', 'send-keys', '-t', 'cc-myid', 'Enter'],
    ]);
  });

  it('refuses to type while a menu owns the keyboard, instead of inventing a draft', async () => {
    // A live AskUserQuestion pane: the ONLY ❯ line is the cursor on the selected
    // option, so the old draft read returned "1. Forward-fill per class ┌───…"
    // and the PWA offered to "replace" it — which would have fired C-u and typed
    // the message into the menu as raw keystrokes.
    const pane = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes', 'ask-2col-chat-about.txt'),
      'utf8',
    );
    const { tmux, calls } = fakeTmux([pane]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'option 1 please');
    expect(res).toEqual({ ok: false, error: 'dialog-open' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('still refuses when the menu pane also carries a stale "esc to interrupt" in scrollback', async () => {
    // paneState() would call this pane busy (BUSY_RE scans the whole capture) and
    // never reach its menu branch — which is why the guard uses hasMenu().
    const pane = 'esc to interrupt\n\n❯ 1. Yes\n  2. No\n  Enter to select\n';
    const { tmux, calls } = fakeTmux([pane]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi');
    expect(res).toEqual({ ok: false, error: 'dialog-open' });
    expect(sendKeysCalls(calls)).toEqual([]);
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
      '❯ \n',           // after Enter — box emptied
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
    const { tmux, calls } = fakeTmux(['❯ \n', '❯ a\n  b\n', '❯ \n']);
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
      withHistory(''),            // after Enter — box emptied
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
    // The ghost suggestion reappearing in the emptied box still reads as empty.
    const { tmux, calls } = fakeTmux([placeholder, verify, placeholder]);
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

  // The silent-drop class: Enter reaches the pane but Claude Code's box does
  // not submit (an overlay — slash palette, @-mention picker — consumes it, or
  // the frame was mid-render). Before post-Enter verification this returned
  // ok:true and the message was simply lost.
  it('re-presses Enter when the box did not empty, and succeeds if the retry lands', async () => {
    const { tmux, calls } = fakeTmux([
      '❯ \n',            // initial — empty
      '❯ /model opus\n', // verify (ansi read) — echoed
      '❯ /model opus\n', // verify (plain read, taken unconditionally alongside the ansi one)
      '❯ /model opus\n', // after 1st Enter — STILL in the box (overlay ate it)
      '❯ /model opus\n',
      '❯ /model opus\n',
      '❯ /model opus\n',
      '❯ /model opus\n',
      '❯ /model opus\n',
      '❯ /model opus\n',
      '❯ /model opus\n',
      '❯ \n',            // after 2nd Enter — box emptied
    ]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', '/model opus');
    expect(res).toEqual({ ok: true });
    const enters = sendKeysCalls(calls).filter((c) => c[c.length - 1] === 'Enter');
    expect(enters).toHaveLength(2);
  });

  it('enter-ignored — reported as a failure, never as a send, when the text stays put', async () => {
    const { tmux } = fakeTmux(['❯ \n', '❯ stuck text\n']); // last pane repeats: box never empties
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'stuck text');
    expect(res).toMatchObject({ ok: false, error: 'enter-ignored', draft: 'stuck text' });
  });

  it('a busy session still counts as submitted — the box empties even while Claude works', async () => {
    const busy = 'esc to interrupt\n❯ \n';
    const { tmux } = fakeTmux(['❯ \n', '❯ do the thing\n', busy]);
    expect(await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'do the thing')).toEqual({ ok: true });
  });
});

describe('sendPrompt with attachments', () => {
  const P = '/home/u/.cc-clips/claude2-Proj/clip-20260726-150340-a1b2.png';

  it('types the paths above the text as one turn', async () => {
    const { tmux, calls } = fakeTmux([
      '❯ \n',        // initial capture — empty draft
      `❯ ${P}\n`,    // verify capture — box echoes the path (needle from line 1)
      '❯ \n',        // after Enter — box emptied, turn accepted
    ]);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'what is this', { attachments: [P] },
    );
    expect(res).toEqual({ ok: true });
    // Alt+Enter separates the lines; the path goes first.
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', 'cc-x', '-l', P],
      ['tmux', 'send-keys', '-t', 'cc-x', 'M-Enter'],
      ['tmux', 'send-keys', '-t', 'cc-x', '-l', 'what is this'],
      ['tmux', 'send-keys', '-t', 'cc-x', 'Enter'],
    ]);
  });

  it('verifies the echo against the input box, not the scrollback', async () => {
    // The identical path sits in scrollback from an earlier turn, but the box is
    // empty — the send never echoed and must NOT be reported ok.
    const { tmux, calls } = fakeTmux([`some earlier turn ${P}\n\n❯ \n`]);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', '', { attachments: [P] },
    );
    expect(res).toMatchObject({ ok: false, error: 'verify-failed' });
    expect(sendKeysCalls(calls).some((c) => c[c.length - 1] === 'Enter')).toBe(false);
  });

  it('clears the box when a send with attachments fails to verify', async () => {
    const { tmux, calls } = fakeTmux(['❯ \n']); // box stays empty — never echoes
    await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'x', { attachments: [P] });
    // Otherwise the paths are stranded in the live box — the exact state this
    // whole design exists to remove.
    expect(sendKeysCalls(calls)).toContainEqual(['tmux', 'send-keys', '-t', 'cc-x', 'C-u']);
  });

  it('still refuses a scrollback-only match when attachments are present', async () => {
    // The case the strict box-row check exists for: an identical clip path sits
    // in scrollback from an earlier turn, but the box never echoes it this send.
    const { tmux, calls } = fakeTmux([`turn 1: ${P}\n\n❯ \n`]);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'caption', { attachments: [P] },
    );
    expect(res).toMatchObject({ ok: false, error: 'verify-failed' });
    expect(sendKeysCalls(calls).some((c) => c[c.length - 1] === 'Enter')).toBe(false);
  });

  it('reports the residual draft when C-u fails to clear after a failed verify', async () => {
    // C-u is kill-to-line-start; whether it actually clears a multi-line
    // Claude Code draft is NOT verified here (or anywhere in this suite) — this
    // only exercises the reporting path for when C-u's clear doesn't take,
    // mirroring the pre-existing replaceDraft C-u check above.
    const NONMATCH = '❯ \n'; // empty box — never echoes the attachment path
    const panes = [
      ...Array(14).fill(NONMATCH),      // initial + 12 echo polls + the failure-path `after` read
      '❯ stubborn leftover\n',          // post-C-u re-capture — still holds text
    ];
    const { tmux, calls } = fakeTmux(panes);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', '', { attachments: [P] },
    );
    expect(res).toMatchObject({ ok: false, error: 'verify-failed', draft: 'stubborn leftover' });
    expect(sendKeysCalls(calls)).toContainEqual(['tmux', 'send-keys', '-t', 'cc-x', 'C-u']);
  });
});

describe('sendPrompt echo verification', () => {
  it('verifies an ordinary multi-line prompt whose first line ends in whitespace', async () => {
    // 'note:  \nsecond line' — a markdown hard break, which is what the PWA
    // posts even after its own `value.trim()` (the trim only strips the ends
    // of the WHOLE message, not an internal line break). An untrimmed needle
    // ('note:  ') can never match `draftOf`'s trimmed box row ('note:') nor,
    // coincidentally, the plain-capture path below if the pane renders the
    // trailing spaces away — so the needle itself must be trimmed.
    const { tmux, calls } = fakeTmux([
      '❯ \n',                       // initial — empty draft
      '❯ note:  \n  second line\n', // verify — echoed
      '❯ \n',                       // after Enter — box emptied
    ]);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'note:  \nsecond line',
    );
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', 'cc-x', '-l', 'note:  '],
      ['tmux', 'send-keys', '-t', 'cc-x', 'M-Enter'],
      ['tmux', 'send-keys', '-t', 'cc-x', '-l', 'second line'],
      ['tmux', 'send-keys', '-t', 'cc-x', 'Enter'],
    ]);
  });

  it('waits for a slow pane to render the text instead of calling it a failed send', async () => {
    // The bug this covers: one capture 200ms after typing raced the TUI's
    // re-render. Losing that race reported "the session never showed the text"
    // and — worse — returned BEFORE pressing Enter, so the message sat in the
    // box until someone hit Enter by hand.
    const { tmux, calls } = fakeTmux([
      '❯ \n',                    // initial — empty box
      '❯ \n',                    // 1st echo poll: not rendered yet
      '❯ \n',                    // 2nd: still nothing
      '❯ a slow but real message\n', // 3rd: there it is
      '❯ \n',                    // after Enter — submitted
    ]);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'a slow but real message',
    );
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls).some((c) => c[c.length - 1] === 'Enter')).toBe(true);
  });

  it('still reports verify-failed when the text never arrives at all', async () => {
    const { tmux, calls } = fakeTmux(['❯ \n', '❯ \n']); // last pane repeats: never echoes
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'will not appear',
    );
    expect(res).toMatchObject({ ok: false, error: 'verify-failed' });
    expect(sendKeysCalls(calls).some((c) => c[c.length - 1] === 'Enter')).toBe(false);
  });
});

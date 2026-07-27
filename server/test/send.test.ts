import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyedQueue } from '../src/inject/queue.js';
import { sendPrompt, draftOf } from '../src/inject/send.js';
import { Tmux, type Runner } from '../src/exec.js';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const noSleep = async () => {};

/**
 * The queued-message box row, captured verbatim from a real busy Claude Code
 * 2.1.220 session (2026-07-26). Dim-wrapped, but with a colour-reset SGR code
 * (`\e[39m`) interleaved between the dim-on code and the text — the shape
 * that broke the original `DIM_SPAN` regex (`[^\x1b]*` can't span an escape).
 */
const CAPTURED_QUEUE_HINT_ROW =
  '\x1b[38;5;246m❯\xa0\x1b[2m\x1b[39mPress up to edit queued messages\x1b[0m';

/**
 * A real half-typed draft immediately following a dim run, captured from an
 * actual tmux 3.4 pane (isolated `-L` socket, `capture-pane -e`; the process
 * that produced it: `printf '❯ \e[2mghost\e[22m\e[1mBOLD REAL\e[0m\n'` typed
 * into the pane). tmux normalises the dim-off (`\e[22m`) immediately followed
 * by another attribute turning on (`\e[1m`) into a single COMBINED code,
 * `\e[0;1m` — not the bare `\e[0m` any fixture had exercised before. This is
 * the shape that made the round-2 `DIM_SPAN` swallow real text: its
 * terminator only matched literal `\e[0m`, but its interleaved-code
 * alternative matched `\e[0;1m` too, so the non-greedy scan absorbed it as
 * "just another code inside the span" and kept consuming "BOLD REAL" looking
 * for a bare `\e[0m` that came only at the very end.
 */
const TMUX_CAPTURED_COMBINED_RESET_ROW =
  '❯ \x1b[2mghost\x1b[0;1mBOLD REAL\x1b[0m';

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

// Claude Code 2.1.220 does NOT empty the box on Enter when the session is
// busy — it queues the turn and swaps the box row for a hint ("Press up to
// edit queued messages"), captured live against a real busy session. The old
// emptiness-only proof burned both Enter attempts on every busy-session send
// and reported a message that WAS delivered as `enter-ignored`. `submitted()`
// now proves submission by OUR TEXT leaving the box (no longer starting with
// the echo needle), falling back to the emptiness check only when there is no
// needle to prove left.
describe('sendPrompt submission proof survives a busy session queueing the message', () => {
  it('busy session: box swaps to the queue hint (captured verbatim, not empty) — counts as submitted, only one Enter', async () => {
    const { tmux, calls } = fakeTmux([
      '❯ \n',                                // initial — empty draft
      '❯ ship it\n',                          // echo verify — box shows our text
      `${CAPTURED_QUEUE_HINT_ROW}\n`,         // after Enter — CC queued it; box never empties (captured live)
    ]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'ship it');
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls).filter((c) => c[c.length - 1] === 'Enter')).toHaveLength(1);
  });

  it('genuinely stuck: our text sits unchanged through both attempts — still enter-ignored', async () => {
    const { tmux, calls } = fakeTmux([
      '❯ \n',                    // initial — empty
      '❯ stuck words here\n',    // echo verify, then repeats: box never changes after either Enter
    ]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'stuck words here');
    expect(res).toMatchObject({ ok: false, error: 'enter-ignored', draft: 'stuck words here' });
    expect(sendKeysCalls(calls).filter((c) => c[c.length - 1] === 'Enter')).toHaveLength(2);
  });

  it('ordinary idle send: box empties as before — still ok with a single Enter', async () => {
    const { tmux, calls } = fakeTmux([
      '❯ \n',            // initial — empty
      '❯ plain send\n',  // echo verify
      '❯ \n',            // after Enter — box emptied
    ]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'plain send');
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls).filter((c) => c[c.length - 1] === 'Enter')).toHaveLength(1);
  });

  it('whitespace-only prompt (empty needle) still uses the emptiness fallback', async () => {
    // No non-blank line in the composed text, so there is nothing for the box
    // to "no longer start with" — `submitted` must fall back to `draftOf === ''`.
    const { tmux, calls } = fakeTmux(['❯ \n', '❯ \n', '❯ \n']);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', '   ');
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls).filter((c) => c[c.length - 1] === 'Enter')).toHaveLength(1);
  });
});

// Second bug from the same root cause, found from the captured bytes above:
// the queue hint is DIM (`\e[2m`), and Claude Code interleaves a colour-reset
// code (`\e[39m`) between the dim-on code and the text. The original
// `DIM_SPAN` (`\x1b\[2m[^\x1b]*\x1b\[0m`) requires NO escapes in between, so it
// never matches, `draftOf` returns the hint text as a real draft, and the
// NEXT send into that session is refused with draft-present — a message that
// truly never lands, the second symptom of the same live bug report.
describe('draftOf strips the dim queue hint even with an interleaved SGR code', () => {
  it('reads the captured queue-hint row as empty, not as the hint text', () => {
    const pane = `some history\n${CAPTURED_QUEUE_HINT_ROW}\n`;
    expect(draftOf(pane)).toBe('');
  });

  it('sendPrompt into a session that already shows the queued-message hint does not refuse draft-present — it types and sends normally', async () => {
    const { tmux, calls } = fakeTmux([
      `some history\n${CAPTURED_QUEUE_HINT_ROW}\n`, // initial — a message is already queued
      '❯ another message\n',                         // echo verify
      '❯ \n',                                        // after Enter — accepted
    ]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'another message');
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', 'cc-x', '-l', 'another message'],
      ['tmux', 'send-keys', '-t', 'cc-x', 'Enter'],
    ]);
  });

  it('still strips a genuine (non-interleaved) dim ghost-suggestion — the case DIM_SPAN was originally written for', () => {
    // Same pane shape as the existing "ignores the dim ghost-suggestion
    // placeholder" sendPrompt test above, exercised directly against draftOf.
    const E = '\x1b';
    const pane = `some history\n${E}[39m❯ ${E}[2mcontinue${E}[0m\n`;
    expect(draftOf(pane)).toBe('');
  });

  it('still detects a real typed draft as draft-present (load-bearing: a looser dim regex must not swallow real text)', () => {
    const E = '\x1b';
    // A real typed draft prefixed by an ordinary (non-dim) SGR code, the way
    // the captured row itself is — draftOf must still read the real text.
    expect(draftOf(`history\n${E}[39m❯ half-typed thought\n`)).toBe('half-typed thought');
  });

  it('a dim span followed by further real, differently-styled text on the same row: only the dim run is stripped', () => {
    // Guards the non-greedy `*?` specifically: a GREEDY interleaved-tolerant
    // regex would match from the first `\e[2m` all the way to the LAST
    // `\e[0m` on the line, swallowing real trailing text along with the dim
    // run. Built to fail loudly if `DIM_SPAN` is ever loosened to `*` instead
    // of `*?`.
    const E = '\x1b';
    const NBSP = '\xa0';
    const boxLine =
      `${E}[38;5;246m❯${NBSP}${E}[2m${E}[39mghost text${E}[0m and real text with ${E}[31mcolor${E}[0m more`;
    expect(draftOf(`history\n${boxLine}\n`)).toBe('and real text with color more');
  });
});

// Round-3 finding: the round-2 interleaved-tolerant DIM_SPAN accepted ANY SGR
// code as "just another code inside the span", including reset-family codes
// like tmux's combined `\e[0;1m` (dim-off + bold-on emitted as one escape).
// Its terminator only matched the bare `\e[0m`, so the scan ran straight past
// the point the dim run actually ended and kept consuming real text looking
// for a bare reset that came later — silently destroying a user's half-typed
// draft and letting a send type over it. `DIM_SPAN` now excludes reset codes
// from the interleaved alternative and accepts any reset-family code
// (`\e[0m`, `\e[0;1m`, …) as the terminator.
describe('DIM_SPAN does not swallow real text after a tmux combined reset (\\e[0;Nm)', () => {
  it('draftOf reads the real text after a tmux-normalised combined reset, not empty', () => {
    // TMUX_CAPTURED_COMBINED_RESET_ROW came back from an actual tmux 3.4
    // pane (see its definition above) — not hand-authored escapes.
    expect(draftOf(`history\n${TMUX_CAPTURED_COMBINED_RESET_ROW}\n`)).toBe('BOLD REAL');
  });

  it('sendPrompt refuses draft-present for that row — the clobber guard — and sends nothing', async () => {
    const { tmux, calls } = fakeTmux([`history\n${TMUX_CAPTURED_COMBINED_RESET_ROW}\n`]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'URGENT do not send');
    expect(res).toEqual({ ok: false, error: 'draft-present', draft: 'BOLD REAL' });
    // Nothing typed, nothing submitted — the send must not type over the draft.
    expect(sendKeysCalls(calls).some((c) => c.includes('-l'))).toBe(false);
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('every dim case exercised so far is unaffected by the combined-reset fix', () => {
    expect(draftOf(`some history\n${CAPTURED_QUEUE_HINT_ROW}\n`)).toBe(''); // captured queue hint
    const E = '\x1b';
    expect(draftOf(`some history\n${E}[39m❯ ${E}[2mcontinue${E}[0m\n`)).toBe(''); // ghost suggestion
    expect(draftOf(`history\n${E}[39m❯ half-typed thought\n`)).toBe('half-typed thought'); // plain draft
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

  it('fires one C-u per typed line, because C-u is kill-to-LINE-start', async () => {
    // An attachment prompt is always ≥2 lines (paths, then text). A single C-u
    // that only kills the current line would leave the clip paths sitting in
    // the box, and the next send would hit `draft-present` holding exactly the
    // thing this feature exists to keep out of the box. C-u on an empty box is
    // a no-op, so over-pressing costs nothing.
    const P2 = '/home/u/.cc-clips/claude2-Proj/clip-20260726-150341-c3d4.jpg';
    const { tmux, calls } = fakeTmux(['❯ \n']); // box stays empty — never echoes
    await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep },
      'x', 'caption', { attachments: [P, P2] },
    );
    const cu = sendKeysCalls(calls).filter((c) => c[c.length - 1] === 'C-u');
    expect(cu).toHaveLength(3); // two paths + the caption line
  });

  it('reports the residual draft when C-u fails to clear after a failed verify', async () => {
    // C-u is kill-to-line-start and is now fired once per typed line (see the
    // test above), but whether that actually empties a Claude Code draft is not
    // observable from a fake pane — this only exercises the reporting path for
    // when the clear doesn't take, mirroring the replaceDraft C-u check above.
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

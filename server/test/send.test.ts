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
const cuPresses = (calls: string[][]) => sendKeysCalls(calls).filter((c) => c[c.length - 1] === 'C-u').length;

/**
 * SIX CONSECUTIVE REAL FRAMES of a 3-line draft being cleared, `tmux
 * capture-pane -p -e` between every C-u (2026-07-27, Claude Code 2.1.220 in an
 * isolated scratch tmux session, 120 columns, 1.2 s settle per press; the draft
 * was typed with `send-keys -l` + `M-Enter` and never submitted).
 *
 * Everything here is verbatim capture bytes, assembled only to avoid repeating
 * the rows that are identical in all six frames: the two chrome rows below the
 * box, and the rule above and below it (shortened from 120 `─` to keep the file
 * readable — a rule carries no `❯` at any length). The frame-varying part is
 * BOX_ROWS, which is exactly what the pane showed.
 *
 * This is here because the clear's termination argument rests on a claim about
 * layout that had only ever been asserted by a hand-written render(): that the
 * `❯` marker sits on the box's FIRST row, that continuation rows are indented
 * and carry no marker, and that nothing BELOW the box starts with `❯` — so
 * `draftOf`'s `.at(-1)` lands on row one, the last row to empty. If any of that
 * were wrong the loop could stop on a box that still holds text. The frames
 * also re-measure the count that the caps are sized from: 5 presses for 3
 * lines, independently of the run that produced the finding doc.
 */
const LIVE_CU_FRAMES = ((): string[] => {
  const RULE = '\x1b[38;5;244m' + '─'.repeat(24);
  const CHROME = [
    '\x1b[39m  \x1b[38;5;246m👤 \x1b[36mteam·max\x1b[38;5;246m \x1b[2m│\x1b[0m\x1b[38;5;246m 🤖 Opus 5 (1M context) · xhigh \x1b[2m│\x1b[0m\x1b[38;5;246m 🎯 cu-probe \x1b[2m│\x1b[0m\x1b[38;5;246m 💲 $0.0000\x1b[39m',
    '  \x1b[38;5;73m⏸ plan mode on\x1b[38;5;246m (shift+tab to cycle)\x1b[39m',
  ];
  // Appears from the first kill onward. Note it does NOT start with `❯`.
  const YANK_HINT = ' '.repeat(91) + '\x1b[38;5;246mCtrl+Y to paste deleted text\x1b[39m';
  const BOX_ROWS: string[][] = [
    ['\x1b[39m❯\xa0AAA first line', '  BBB second line', '  CCC third line'], // typed
    ['\x1b[39m❯\xa0AAA first line', '  BBB second line', ''],                 // press 1: row 3 killed
    ['\x1b[39m❯\xa0AAA first line', '  BBB second line'],                     // press 2: joined away
    ['\x1b[39m❯\xa0AAA first line', ''],                                      // press 3: row 2 killed
    ['\x1b[39m❯\xa0AAA first line'],                                          // press 4: joined away
    ['\x1b[39m❯\xa0'],                                                        // press 5: empty
  ];
  return BOX_ROWS.map((rows, i) =>
    [...(i > 0 ? [YANK_HINT] : []), RULE, ...rows, RULE, ...CHROME].join('\n') + '\n');
})();

/**
 * A MODEL of the Claude Code input box. `fakeTmux` replays scripted frames and
 * so cannot represent state — but the whole correctness of the clear is about
 * state, so the clear needs a pane that answers according to what was actually
 * done to it.
 *
 * C-u semantics measured against a live box on 2026-07-27 (pane captured
 * between every press): C-u is kill-to-ROW-start with the caret at the end of
 * the LAST row, and a row emptied by a kill still has to be JOINED AWAY by a
 * second press when a newline made it. Text is therefore consumed bottom-up at
 * two presses per line, minus one for the final line — 2N-1, i.e. a 2-line
 * draft takes 3 presses and a 3-line draft 5. Presses against an already-empty
 * box are no-ops (12 of them left a 2-line draft's box clean).
 *
 * Deliberately NOT modelled: wrapping. A logical line too long for the pane
 * occupies several visual rows and each costs one press with no join (260 chars
 * at 120 columns = 3 rows = 3 presses, measured), so a wrapped draft is CHEAPER
 * per row than this model. Production sizes its blind floor at 2 presses per
 * visual row, which is exact here and over-generous there; over-pressing is a
 * no-op, under-pressing is the bug.
 */
function inputBox(initial: readonly string[] = [''], width = 120) {
  let lines = [...initial];
  const NBSP = '\xa0';
  return {
    get lines(): string[] { return [...lines]; },
    isEmpty: (): boolean => lines.length === 1 && lines[0] === '',
    pressCu(): void {
      const last = lines.length - 1;
      if (lines[last] !== '') lines[last] = '';       // kill to row start
      else if (lines.length > 1) lines.pop();          // join the emptied row away
      // single empty row: no-op
    },
    type: (s: string): void => { lines[lines.length - 1] += s; },
    newline: (): void => { lines.push(''); },
    submit: (): void => { lines = ['']; },
    /**
     * The pane the way Claude Code really draws it — shape taken from
     * LIVE_CU_FRAMES: full-width rules, the `❯` marker on the FIRST box row
     * only, continuation rows indented two spaces, and chrome rows below the
     * box that carry no marker. `draftOf` therefore reads row one, which (kills
     * running bottom-up) is the LAST row to empty.
     */
    render: (): string =>
      [
        'earlier turn',
        '● a reply',
        '─'.repeat(width),
        `❯${lines[0] === '' ? NBSP : ' ' + lines[0]}`,
        ...lines.slice(1).map((l) => '  ' + l),
        '─'.repeat(width),
        '  👤 team·max │ 🤖 Opus 5 (1M context) · xhigh',
      ].join('\n') + '\n',
  };
}

/**
 * `inputBox` wired behind a real `Tmux`, with a VIRTUAL CLOCK: every tmux
 * invocation costs `SPAWN_MS` and every sleep costs what it sleeps, so a test
 * can measure the wall clock a clear would really burn — and how long the
 * session's queue slot is held — without burning it.
 *
 * The first `staleFrames` captures come back as the frame the pane showed
 * BEFORE anything was typed: the slow-render failure the echo poll exists for,
 * and precisely the case that strands a clip path in a box the code believes is
 * empty. `Infinity` models a pane that never re-renders at all.
 */
const SPAWN_MS = 8;   // measured order of magnitude for a `tmux` subprocess
function boxTmux(opts: {
  initial?: readonly string[];
  staleFrames?: number;
  width?: number;
  /** Pane text to answer with instead of the box, from capture `n` onward. */
  overlayFrom?: number;
  overlay?: string;
  /** Capture `n` onward fails (pane died). */
  dieFrom?: number;
} = {}) {
  const box = inputBox(opts.initial, opts.width);
  const stale = opts.staleFrames ?? 0;
  const frozen = inputBox(opts.initial, opts.width).render();
  const calls: string[][] = [];
  let captures = 0;
  let ms = 0;
  const clock = { now: () => ms, sleep: async (n: number) => { ms += n; } };
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    ms += SPAWN_MS;
    if (args[0] === 'capture-pane') {
      captures++;
      if (opts.dieFrom !== undefined && captures >= opts.dieFrom) return { code: 1, stdout: '', stderr: '' };
      if (opts.overlayFrom !== undefined && captures >= opts.overlayFrom) {
        return { code: 0, stdout: opts.overlay ?? '', stderr: '' };
      }
      return { code: 0, stdout: captures <= stale ? frozen : box.render(), stderr: '' };
    }
    if (args[0] === 'send-keys') {
      const key = args[args.length - 1]!;
      if (args[3] === '-l') box.type(key);
      else if (key === 'M-Enter') box.newline();
      else if (key === 'C-u') box.pressCu();
      else if (key === 'Enter') box.submit();
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { tmux: new Tmux(run), calls, box, clock };
}

// These exercise the DOUBLE, not send.ts — they would stay green if clearBox
// were gutted. They are here because every production assertion below is only
// as good as this model, so the model is pinned to real captures first.
describe('the input-box double is faithful to real captures', () => {
  const pressesToEmpty = (lines: string[]): number => {
    const box = inputBox(lines);
    let n = 0;
    while (!box.isEmpty() && n < 20) { box.pressCu(); n++; }
    return n;
  };

  it('reproduces the measured press counts for N = 1..4', () => {
    // The finding doc's first probe reported "3 lines … empty by p7", which its
    // re-measurement retracted: the marker string being grepped for appeared in
    // the echoed command and inflated every count. These are the corrected
    // numbers, and LIVE_CU_FRAMES below is a third, independent run of N=3.
    expect(pressesToEmpty(['one'])).toBe(1);
    expect(pressesToEmpty(['first line', 'second line'])).toBe(3);
    expect(pressesToEmpty(['one', 'two', 'three'])).toBe(5);
    expect(pressesToEmpty(['a', 'b', 'c', 'd'])).toBe(7);
  });

  it('further presses on an emptied box are no-ops', () => {
    const box = inputBox(['only line']);
    box.pressCu();
    expect(box.isEmpty()).toBe(true);
    box.pressCu(); box.pressCu();
    expect(box.lines).toEqual(['']);
  });

  it('steps through the six REAL frames identically, frame for frame', () => {
    // The model's whole job is to answer draftOf the way the real pane does
    // while text is being killed out from under it. Same 3-line draft, same
    // press sequence, compared against verbatim capture bytes.
    const box = inputBox(['AAA first line', 'BBB second line', 'CCC third line']);
    const seen: string[] = [];
    for (let i = 0; i < LIVE_CU_FRAMES.length; i++) {
      if (i > 0) box.pressCu();
      expect(draftOf(box.render())).toBe(draftOf(LIVE_CU_FRAMES[i]!));
      seen.push(draftOf(LIVE_CU_FRAMES[i]!));
    }
    // ...and what the real pane showed: row 1 unchanged for four presses, empty
    // only on the fifth. Progress is invisible to draftOf; emptiness is not.
    expect(seen).toEqual(['AAA first line', 'AAA first line', 'AAA first line', 'AAA first line', 'AAA first line', '']);
    expect(box.isEmpty()).toBe(true);
  });

  it('real frames: the caret is on the box\'s FIRST row and nothing below the box carries one', () => {
    // The assumption `draftOf`'s `.at(-1)` depends on, checked against bytes
    // rather than against the fixture that was written to satisfy it.
    for (const frame of LIVE_CU_FRAMES) {
      const rows = frame.split('\n');
      const caretRows = rows.map((l, i) => [l, i] as const).filter(([l]) => l.replace(/\x1b\[[0-9;]*m/g, '').startsWith('❯'));
      expect(caretRows).toHaveLength(1);                       // one marker in the whole pane
      const [, boxRow] = caretRows[0]!;
      // every row after it — continuation rows, the rule, both chrome rows
      for (const below of rows.slice(boxRow + 1)) {
        expect(below.replace(/\x1b\[[0-9;]*m/g, '').startsWith('❯')).toBe(false);
      }
    }
  });
});

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
    // Updated with the 2026-07-27 measurement: the clear presses until the box
    // reads empty, so a box that never clears spends the whole ceiling. What
    // this test is really about is unchanged — nothing but C-u is sent, and the
    // residual draft is reported instead of being typed over.
    const { tmux, calls } = fakeTmux(['❯ stubborn\n', '❯ stubborn\n']);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi', { replaceDraft: true });
    expect(res).toEqual({ ok: false, error: 'draft-clear-failed', draft: 'stubborn' });
    expect(new Set(sendKeysCalls(calls).map((c) => c.join(' ')))).toEqual(
      new Set(['tmux send-keys -t cc-x C-u']),
    );
    // The ceiling, reached only because `sleep` is free here; against a real
    // clock the 3 s budget stops it first (see the budget tests below).
    expect(cuPresses(calls)).toBe(24);
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

// F3 / bug #21 (build4 dogfood, docs/superpowers/programs/build4.md): the
// mail delivery lane types an envelope via sendPrompt; when its Enter is
// lost, the text sits in the box as a "draft" that the LANE'S OWN NEXT
// attempt then reads as draft-present and backs off — forever, since nothing
// else will ever empty that box. `resumeIfOwn` is the opt-in escape hatch: a
// draft that matches the caller's OWN text (to the same marker-row precision
// `submitEnter`'s correspondence gate already trusts) is finished, not
// refused. It is OFF by default — sendPrompt's other two callers (the
// operator's composer, `/clear` in coord/dispatch.ts) must keep refusing
// outright, exactly as before.
describe('sendPrompt resumeIfOwn (F3 / bug #21)', () => {
  it('finishes submitting a draft that already matches the caller\'s own text — no retype, one Enter', async () => {
    const { tmux, calls } = fakeTmux([
      '❯ hello world\n', // initial capture — OUR OWN text, left by a prior lost Enter
      '❯ \n',             // after Enter — box emptied
    ]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hello world', { resumeIfOwn: true });
    expect(res).toEqual({ ok: true });
    // No `-l` literal send anywhere: the text was never retyped, only submitted.
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', 'cc-x', 'Enter']]);
  });

  it('still refuses a foreign human draft as draft-present, even with resumeIfOwn set — the sacred guard (F2)', async () => {
    const { tmux, calls } = fakeTmux(['❯ completely unrelated human thought\n']);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hello world', { resumeIfOwn: true });
    expect(res).toEqual({ ok: false, error: 'draft-present', draft: 'completely unrelated human thought' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('without resumeIfOwn, an identical own-text draft is STILL refused as draft-present — opt-in only', async () => {
    const { tmux, calls } = fakeTmux(['❯ hello world\n']);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hello world');
    expect(res).toEqual({ ok: false, error: 'draft-present', draft: 'hello world' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('reports enter-ignored, not draft-present, when the resumed own draft still will not submit', async () => {
    const { tmux } = fakeTmux(['❯ hello world\n']); // last pane repeats: never empties, never leaves
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hello world', { resumeIfOwn: true });
    expect(res).toMatchObject({ ok: false, error: 'enter-ignored', draft: 'hello world' });
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

  it('fires the full 2-per-row floor even when the pane claims the box is already empty', async () => {
    // The guarantee this test exists to hold is "never fewer presses than the
    // text costs". Was "one C-u per typed line" (3 for a 3-line prompt), too
    // few — clearing 3 rows costs 5. But a clear that merely LOOKS after each
    // press would satisfy any count against this fake, whose box reads empty
    // from the first frame: it would stop at one press and strand the text,
    // which is exactly what happens when a stale render is why the echo failed.
    // So the floor is fired blind, and this pane can't talk it out of it.
    const P2 = '/home/u/.cc-clips/claude2-Proj/clip-20260726-150341-c3d4.jpg';
    const { tmux, calls } = fakeTmux(['❯ \n']); // box stays empty — never echoes
    await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep },
      'x', 'caption', { attachments: [P, P2] },
    );
    expect(cuPresses(calls)).toBe(5); // 2 paths + caption = 3 rows → 2*3-1
  });

  it('sizes the floor by VISUAL rows, so a caption that wraps still gets cleared', async () => {
    // C-u kills a visual ROW, not a logical line: a 260-char line at 120
    // columns occupied 3 rows and took 3 presses (measured 2026-07-27). A floor
    // computed from `split('\n').length` alone would under-press by one per
    // wrapped row and leave the tail of a long caption — with the clip path
    // above it — in the box.
    const long = 'w'.repeat(300);            // 3 rows in a 120-column box
    const { tmux, calls } = fakeTmux([`${'─'.repeat(120)}\n❯ \n`]);
    await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', long, { attachments: [P] },
    );
    expect(cuPresses(calls)).toBe(7);        // path (1 row) + caption (3) = 4 rows → 2*4-1
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

// The defect this file's stateful double was built for. C-u costs 2 presses per
// row, not one per line (measured 2026-07-27), so the old `parts.length` loop
// under-pressed on EVERY multi-line draft: a 2-line attachment prompt got 2
// presses where it needed 3, leaving the bare clip path sitting on line 1 of the
// live box — the next send then came back `draft-present` carrying exactly the
// thing this cleanup exists to remove. Judged against box STATE, not a press count.
describe('the failed-send cleanup actually empties the box', () => {
  const P = '/home/u/.cc-clips/claude2-Proj/clip-20260726-150340-a1b2.png';

  it('empties the box even though the pane NEVER re-renders — the reason the verify failed', async () => {
    // `staleFrames: Infinity` is the case that matters: the pane goes on showing
    // the pre-typing frame forever, which is the commonest reason an echo check
    // fails in the first place. So every read the cleanup takes says "the box is
    // empty" while both typed lines are really sitting in it, and a clear that
    // stops when the box reads empty stops after ONE press and strands the whole
    // prompt. (A finite `staleFrames: 14` — initial check + 12 echo polls + the
    // failure-path plain capture — is the largest staleness whose LAST frame is
    // fresh again, and would hide exactly this.)
    const { tmux, calls, box } = boxTmux({ staleFrames: Infinity });
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'what is this', { attachments: [P] },
    );
    expect(res).toMatchObject({ ok: false, error: 'verify-failed' });
    expect(box.lines).toEqual(['']);          // ← the assertion. Box state, not the pane's story about it.
    expect(draftOf(box.render())).toBe('');   // no clip path left for the next send to trip on
    expect((res as { draft?: string }).draft).toBeUndefined();
    expect(cuPresses(calls)).toBe(3);         // 2 rows → 2*2-1, fired blind
  });

  it('a 3-line attachment prompt needs 5 presses and gets them, stale pane or not', async () => {
    const P2 = '/home/u/.cc-clips/claude2-Proj/clip-20260726-150341-c3d4.jpg';
    const { tmux, calls, box } = boxTmux({ staleFrames: Infinity });
    await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'caption', { attachments: [P, P2] },
    );
    expect(box.lines).toEqual(['']);
    expect(cuPresses(calls)).toBe(5);
  });

  it('a 1-row prompt costs a single press', async () => {
    const { tmux, calls, box } = boxTmux({ staleFrames: Infinity });
    await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', '', { attachments: [P] },
    );
    expect(box.lines).toEqual(['']);
    expect(cuPresses(calls)).toBe(1);
  });

  it('replaceDraft clears a 3-line user draft instead of reporting draft-clear-failed', async () => {
    // The second site of the same bug: one C-u could never clear a draft of two
    // or more lines, so choosing "replace" in the conflict sheet failed loudly.
    const { tmux, calls, box } = boxTmux({ initial: ['line one', 'line two', 'line three'] });
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'fresh text', { replaceDraft: true },
    );
    expect(res).toEqual({ ok: true });
    expect(cuPresses(calls)).toBe(5);
    expect(box.lines).toEqual(['']); // submitted
    const typed = sendKeysCalls(calls).filter((c) => c.includes('-l'));
    expect(typed).toEqual([['tmux', 'send-keys', '-t', 'cc-x', '-l', 'fresh text']]);
  });

  it('replaceDraft clears a 5-line draft — a pasted stack trace is not an exotic case', async () => {
    // The old ceiling of 8 was 2N-1 for N=4 exactly, so five lines hit it: the
    // presses that DID land destroyed four of the user's rows, and the send was
    // then refused with `draft-clear-failed` reporting the one row left, which
    // reads to the user as "nothing happened". Nothing was bought by keeping the
    // ceiling low — the clear exits on the first empty read either way.
    const { tmux, calls, box } = boxTmux({ initial: ['l1', 'l2', 'l3', 'l4', 'l5'] });
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'fresh', { replaceDraft: true },
    );
    expect(res).toEqual({ ok: true });
    expect(cuPresses(calls)).toBe(9);   // 2*5-1
    expect(box.lines).toEqual(['']);
  });

  it('a pane that dies mid-clear is not-alive, not draft-clear-failed', async () => {
    const { tmux } = fakeTmux(['❯ old draft\n', null]);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi', { replaceDraft: true },
    );
    expect(res).toEqual({ ok: false, error: 'not-alive' });
  });

  it('a pane that dies mid-cleanup after a failed verify is not-alive too, not a silent "cleared"', async () => {
    // `verify-failed` with no `draft` is byte-identical to the clean-clear case
    // above, so reporting a dead pane that way told the caller the box had been
    // emptied when the truth is "unknown". The two clear sites now agree on what
    // a null capture means.
    const { tmux } = boxTmux({ staleFrames: 14, dieFrom: 15 }); // dies on the first post-C-u read
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'what is this', { attachments: [P] },
    );
    expect(res).toEqual({ ok: false, error: 'not-alive' });
  });
});

// A dialog can open between the draft check at the top of sendPrompt and the
// clear — and an attachment prompt's very first keystroke is a literal '/', so
// the slash-command palette is a live way to get one. With a menu up there is no
// input box: the only ❯ on screen is the cursor on the selected OPTION, which
// never empties, so the clear would spend its entire ceiling hammering C-u into
// the menu and then hand the user "1. Yes" back as their own leftover draft.
describe('a menu that opens mid-clear stops the clear', () => {
  const MENU = 'some scrollback\n\n❯ 1. Yes\n  2. No\n  Enter to select\n';
  const P = '/home/u/.cc-clips/claude2-Proj/clip-20260726-150340-a1b2.png';

  it('replaceDraft answers dialog-open, the same as a menu that was already up', async () => {
    // capture 1 = a real draft (passes the guard at the top), everything after
    // = a live menu.
    const { tmux, calls } = fakeTmux(['❯ my draft\n', MENU]);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi', { replaceDraft: true },
    );
    expect(res).toEqual({ ok: false, error: 'dialog-open' });
    expect(cuPresses(calls)).toBe(1);  // bails on the first read, instead of 24 into a live menu
    expect(sendKeysCalls(calls).some((c) => c.includes('-l'))).toBe(false);
  });

  it('the attachment cleanup stops pressing and reports no residual draft', async () => {
    const panes = [...Array(14).fill('❯ \n'), MENU];
    const { tmux, calls } = fakeTmux(panes);
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'what is this', { attachments: [P] },
    );
    expect(res).toMatchObject({ ok: false, error: 'verify-failed' });
    expect((res as { draft?: string }).draft).toBeUndefined();  // never "1. Yes"
    expect(cuPresses(calls)).toBe(3);   // the blind floor, then it sees the menu and stops
  });
});

// Everything in sendPrompt runs inside the session's KeyedQueue slot, so a clear
// that grinds is a session that accepts nothing — not the next prompt, not
// /interrupt. The old cleanup cap was `2 * parts.length + 2`, sized off the
// message: a 200-line prompt bought 402 presses and a minute of sleeps, and a
// 500-line one several minutes, all with the lock held.
describe('a clear cannot hold the session queue open', () => {
  const P = '/home/u/.cc-clips/claude2-Proj/clip-20260726-150340-a1b2.png';
  /** Wall clock the clear itself spent, i.e. from the last typed keystroke on. */
  const clearElapsed = (clock: { now: () => number }, before: number) => clock.now() - before;

  it('a 500-line attachment prompt is bounded by the 3 s budget, not by its line count', async () => {
    const text = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const { tmux, calls, clock } = boxTmux({ staleFrames: Infinity });
    let atClear = 0;
    const sleep = async (ms: number) => {
      // the clear is the only thing that sleeps CLEAR_POLL_MS after typing
      if (atClear === 0 && ms === 150) atClear = clock.now();
      await clock.sleep(ms);
    };
    const res = await sendPrompt(
      { tmux, queue: new KeyedQueue(), sleep, now: clock.now }, 'x', text, { attachments: [P] },
    );
    expect(res).toMatchObject({ ok: false, error: 'verify-failed' });
    // Unbounded, this is 1002 presses; the budget stops the blind burst partway.
    expect(cuPresses(calls)).toBeLessThan(500);
    expect(clearElapsed(clock, atClear - 150)).toBeLessThan(3500);
  });

  it('a box that will not clear releases the queue inside the budget, so /interrupt is not stuck behind it', async () => {
    const { tmux, clock } = boxTmux({ initial: ['stuck'], overlayFrom: 2, overlay: '❯ stuck forever\n' });
    const queue = new KeyedQueue();
    const order: string[] = [];
    const send = sendPrompt(
      { tmux, queue, sleep: clock.sleep, now: clock.now }, 'x', 'hi', { replaceDraft: true },
    ).then((r) => { order.push('send'); return r; });
    const second = queue.run('x', async () => { order.push('interrupt'); }); // same session key
    const res = await send;
    await second;
    expect(res).toMatchObject({ ok: false, error: 'draft-clear-failed', draft: 'stuck forever' });
    expect(order).toEqual(['send', 'interrupt']);  // it did wait — that is the point
    expect(clock.now()).toBeLessThan(3500);        // ...but not for a minute
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

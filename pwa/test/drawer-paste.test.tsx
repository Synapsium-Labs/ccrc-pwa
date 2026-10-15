// What a paste and the `ctrl` latch put on the wire (D-5007; spec 2026-10-14
// §5.4; plan Task 12, revised for the operator's ruling R-LIVE, 2026-10-15:
// phones type live into the terminal's own textarea, and `TermInput` is not
// built).
//
// This file holds:
// - the framing, pure (`typedFrame.ts`): `sanitizeTyped` drops every C0 control
//   but tab and newline, DEL and every ESC, so neither bracketed-paste marker
//   survives it; `typedFrame` sends one line literally and brackets text that
//   holds a newline exactly as xterm 6.0.0's own `paste()` does, minus any
//   marker inside it. Measured against the real terminal's `paste()`, which is
//   also shown sending a pasted end marker straight through (the reason for all
//   of this, plan Refinement 11);
// - the letter a latched `ctrl` takes, pure: from a `beforeinput` (insertText,
//   or the one letter that opens a composition) and from a keydown that
//   reports a real key;
// - the drawer, against the REAL terminal it builds: the latch takes its letter
//   from xterm's textarea, sends the control code once through the ^C/^D guard,
//   and never lets the letter through as well; unlatched, nothing is prevented
//   and typing reaches the socket exactly as xterm sends it;
// - the paste guard (plan Refinement 11; P3 ruled yes): a paste anywhere in
//   the terminal's host, in either view, is taken in the capture phase, before
//   xterm's own handler (which stops propagation at the textarea), and sent as
//   `typedFrame(text)`, so a pasted `\e[201~` never reaches a frame;
// - text a keyboard INSERTS (D-5114): an `input` event's
//   insertText, a composition's commit and the textarea diff after a
//   keyCode-229 keydown are no paste event, so the guard above never saw them
//   and they reached the session raw, end marker and CRs included (measured by
//   the stage-1 verifier, in both views). Each now opens a window, and a chunk
//   xterm sends inside it goes as `insertedFrame` says: one key's bytes as they
//   are (`oneKey`), anything longer as `typedFrame` frames a paste. Outside a
//   window nothing is touched: a key, and a reply the terminal sends of its own;
//   every window closes, and a real key opens none.
//   RED FIRST, 2026-10-15: against stubs (`oneKey` true for one character,
//   `insertedFrame` the identity), 9 of the 13 new cases failed; the four that
//   passed are negatives such stubs cannot fail (two pure ones: text is not one
//   key, plain text goes as it is; and the drawer's two: keys unchanged inside
//   a window, a reply untouched outside one), each proved by a row below.
//
// RED FIRST, measured 2026-10-15: against the tree before Task 12's green (this
// file, the two markers in `keyBar.ts`, `typedFrame.ts` as a stub whose
// functions return their input or null, and nothing wired in the drawer), 23 of
// the 35 cases failed. The 12 that passed are the ones such a tree cannot fail:
// the markers by value; printable text kept and one line sent literally (the
// stub returns its input); xterm's own paste measured on its own; the readers'
// negatives (2); and the drawer's negatives, which hold while nothing is wired
// (the open composition, the non-letter, the unlatched typing, the view flip,
// the re-attach, and a single pasted line, which xterm sends as is with
// bracketed paste off). The view-flip and re-attach cases bite only once the
// latch is wired; their mutation rows below are what prove them.
//
// MUTATION TABLE (plan Task 12 Step 5, and the rows this build adds; RUN
// 2026-10-15, each mutant applied, the named suite run alone, restored and
// checked byte for byte). Every row went RED:
//   sanitizeTyped keeps ESC ............................ the `\e[201~` case, and 6 more (both views' guard)
//   bracketed paste for single-line text too ........... the `hello` case, and 3 more
//   newlines sent as \n inside the brackets ............ the `a\nb` case, and 6 more (the xterm comparisons)
//   the paste guard registered in the bubble phase ..... the paste-guard cases (both views), and 2 more
//   the latch reads keydown only ....................... the beforeinput cases (5: insertText, composition, guard)
//   the latch prevents beforeinput while unlatched ..... the not-latched case, and the non-letter case
//   the latch reads beforeinput only (no keydown arm) .. the real-key case
//   a composition's letter taken by "begins with" ...... the open-composition case, and its pure twin
//   the drop never armed ............................... the composition case
//   the drop armed even when the cancel took ........... the insertText case (its later `c` eaten)
//   the drop waits for an equal chunk (lingers) ........ the grown-composition case
//   the paste guard acts in the wrapped view only ...... the grid paste case, and the screen-element case
//   the latch survives the view leaving `wrapped` ...... the view-flip case
//   the latch survives a re-attach ..................... the re-attach case
//   typedFrame.ts spells a marker itself ............... drawer-keybar.test.tsx's "spells no key byte" scan
// and for D-5114 (RUN 2026-10-15, the same way; every row RED):
//   insertedFrame sends the insertion as it is ......... the three paths in both views, and the pure case
//   insertedFrame frames every chunk, a key included .. the key-in-a-window case, and the pure twin
//   no window for an input event ........................ the insertText cases (both views)
//   no window for a composition's end .................. the composition cases (both views)
//   no window for a keyCode-229 keydown ................ the 229 cases (both views)
//   the window closes after one turn ................... the composition and 229 cases (xterm reads a turn later)
//   every chunk treated as inserted (no window) ........ the reply case
//   the window listens in the bubble phase ............. the insertText cases (xterm's handler is at the target)
//   oneKey lets the paste markers through .............. the markers case, and the lone-marker case
//   oneKey takes any chunk that starts with ESC ........ the not-one-key case
//   oneKey takes one character only .................... every key the bar sends, and 3 more
// and for the window's end (the stage-1 verifier's mutants, GREEN before the
// window-closes cases: the one negative painted its query before any
// insertion). RUN 2026-10-15 on an isolated copy, the same way; every row RED:
//   no window ever closes (its decrement dropped) ...... the four window-closes cases
//   an input event's window never closes ............... the two insertText window-closes cases
//   a keyCode-229 keydown's window never closes ........ the two 229 window-closes cases
//   every keydown opens a window, a real key's too ..... the real-key case
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import { KEY_SEQ, PASTE_CLOSE, PASTE_OPEN, oneKey } from '../src/session/keyBar';
import { insertedFrame, inputLetter, keyLetter, sanitizeTyped, typedFrame } from '../src/session/typedFrame';
import { VIEW_OVERRIDE_KEY, type StorageLike } from '../src/session/drawerView';
import { SYNTHETIC_SCREENS } from './fixtures/drawer/synthetic';

const made = vi.hoisted(() => ({ terms: [] as unknown[] }));
// The real Terminal, remembered as it is made, so a case can reach the one the
// drawer built by itself (its textarea, and a write to wait on).
vi.mock('@xterm/xterm', async (importOriginal) => {
  const real = await importOriginal<typeof import('@xterm/xterm')>();
  class Terminal extends real.Terminal {
    constructor(...args: ConstructorParameters<typeof real.Terminal>) {
      super(...args);
      made.terms.push(this);
    }
  }
  return { ...real, Terminal };
});

const { TerminalDrawer } = await import('../src/session/TerminalDrawer');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  FakeSocket.instances.length = 0;
  for (const t of made.terms) (t as XTerm).dispose();
  made.terms.length = 0;
  document.body.replaceChildren();
});

/** How many times `needle` occurs in `hay`. */
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

/** Let xterm's own `setTimeout(0)` work land: a composition's commit, and the
 *  textarea diff it reads after a keyCode-229 keydown. */
const tick = (): Promise<void> => act(async () => { await new Promise<void>((r) => { setTimeout(r, 5); }); });
/** Let every insertion window opened so far close. A window lasts two turns of
 *  the task queue, the second queued only when the first runs, so a fixed delay
 *  is not enough: on a loaded machine `tick`'s 5 ms timer can fall due before
 *  that second turn is even queued (MEASURED: a full run at load 6 framed the
 *  reply with the window still open). Each turn here is queued only once the
 *  one before it has run, so a window's own second turn is always ahead of it. */
const windowsClosed = (): Promise<void> => act(async () => {
  for (let i = 0; i < 3; i += 1) await new Promise<void>((r) => { setTimeout(r, 0); });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: the framing, pure
// ─────────────────────────────────────────────────────────────────────────────

describe('the paste markers, by value', () => {
  it('are CSI 200~ and CSI 201~, xterm\'s own', () => {
    expect(PASTE_OPEN).toBe('\x1b[200~');
    expect(PASTE_CLOSE).toBe('\x1b[201~');
  });
});

describe('sanitizeTyped', () => {
  it('removes every C0 control but tab and newline, and DEL', () => {
    for (let c = 0; c < 0x20; c++) {
      const ch = String.fromCharCode(c);
      const kept = c === 0x09 || c === 0x0a;
      expect(sanitizeTyped(`a${ch}b`), `U+${c.toString(16).padStart(4, '0')}`).toBe(kept ? `a${ch}b` : 'ab');
    }
    expect(sanitizeTyped('a\x7fb'), 'DEL').toBe('ab');
  });

  it('removes every ESC, so neither paste marker can frame anything', () => {
    expect(sanitizeTyped(`${PASTE_OPEN}x${PASTE_CLOSE}`)).toBe('[200~x[201~');
    expect(sanitizeTyped('\x1b\x1b[A\x1b')).toBe('[A');
  });

  it('keeps printable text whole: ASCII, accents, CJK, emoji, tabs and newlines', () => {
    const s = 'git commit -m "fix: é 日本 🙂"\tdone\nls ~/x | wc -l';
    expect(sanitizeTyped(s)).toBe(s);
  });
});

describe('typedFrame', () => {
  it('sends a single line literally', () => {
    expect(typedFrame('hello')).toBe('hello');
    expect(typedFrame('a\tb')).toBe('a\tb');
  });

  it('brackets text that holds a newline, each newline a CR', () => {
    expect(typedFrame('a\nb')).toBe('\x1b[200~a\rb\x1b[201~');
    expect(typedFrame('ls\n')).toBe('\x1b[200~ls\r\x1b[201~');
  });

  it('reads CRLF and a lone CR as one newline', () => {
    expect(typedFrame('a\r\nb')).toBe(typedFrame('a\nb'));
    expect(typedFrame('a\rb')).toBe(typedFrame('a\nb'));
    expect(typedFrame('a\r\n\r\nb')).toBe('\x1b[200~a\r\rb\x1b[201~');
  });

  it('a pasted end marker cannot close the brackets early: exactly one, at the end', () => {
    const out = typedFrame('a\x1b[201~\rrm -rf x');
    expect(count(out, PASTE_CLOSE), 'a second end marker reached the frame').toBe(1);
    expect(out.endsWith(PASTE_CLOSE)).toBe(true);
    expect(out).toBe('\x1b[200~a[201~\rrm -rf x\x1b[201~');
  });

  it('text that sanitises to nothing is nothing, and a lone line of controls never brackets', () => {
    expect(typedFrame('\x1b\x03\x7f')).toBe('');
    expect(typedFrame('\x1b[201~')).toBe('[201~');
  });
});

describe('typedFrame against xterm 6.0.0\'s own paste', () => {
  /** The real terminal, opened, with bracketed paste on (as tmux turns it on
   *  in the drawer's xterm while Claude Code has it on), and what its
   *  `paste()` hands `onData`. */
  async function xtermPaste(text: string): Promise<string> {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const term = new Terminal({ cols: 80, rows: 5 });
    term.open(el);
    await new Promise<void>((r) => { term.write('\x1b[?2004h', r); });
    const out: string[] = [];
    term.onData((d) => out.push(d));
    term.paste(text);
    return out.join('');
  }

  it.each([
    ['two lines', 'line one\nline two'],
    ['CRLF', 'line one\r\nline two\r\n'],
    ['a trailing newline', 'ls -la\n'],
    ['a tab and a blank line', 'a\tb\n\nc'],
  ])('types the bytes xterm\'s own paste would, for text with no marker in it: %s', async (_name, text) => {
    expect(typedFrame(text)).toBe(await xtermPaste(text));
  });

  it('xterm\'s own paste sends a pasted end marker straight through (the reason for the guard)', async () => {
    const own = await xtermPaste('a\x1b[201~\rrm -rf x');
    expect(count(own, PASTE_CLOSE), 'xterm learned to strip the marker: the guard may be revisited').toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 (pure): the letter a latched ctrl takes
// ─────────────────────────────────────────────────────────────────────────────

describe('the letter a latched ctrl takes from a beforeinput', () => {
  it('insertText: its first character, when that is an ASCII letter', () => {
    expect(inputLetter('insertText', 'c')).toBe('c');
    expect(inputLetter('insertText', 'R')).toBe('R');
    expect(inputLetter('insertText', 'cat')).toBe('c');
    expect(inputLetter('insertText', '1')).toBeNull();
    expect(inputLetter('insertText', 'é')).toBeNull();
    expect(inputLetter('insertText', ' c')).toBeNull();
    expect(inputLetter('insertText', '')).toBeNull();
    expect(inputLetter('insertText', null)).toBeNull();
  });

  it('insertCompositionText: only the one letter that opens a composition', () => {
    expect(inputLetter('insertCompositionText', 'r')).toBe('r');
    // A letter added to a composition already open: the event's data is the
    // whole composition, whose first letter is not the one just typed.
    expect(inputLetter('insertCompositionText', 'helc')).toBeNull();
    expect(inputLetter('insertCompositionText', '日')).toBeNull();
  });

  it('nothing else', () => {
    for (const t of ['insertReplacementText', 'insertFromPaste', 'insertLineBreak', 'deleteContentBackward', '']) {
      expect(inputLetter(t, 'c'), t).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Text a keyboard INSERTS (D-5114), pure
// ─────────────────────────────────────────────────────────────────────────────

/** What a keyboard's clipboard chip, a suggestion or an IME can hand xterm's
 *  textarea as ONE insertion: an end marker, then a line that would submit. */
const HOSTILE_INSERT = 'a\x1b[201~\rrm -rf x\r';
/** DECRQSS for the scroll margins: a query xterm answers of its own, with a
 *  DCS string that is no key's shape. */
const DCS_QUERY = '\x1bP$qr\x1b\\';
/** xterm's answer, as it sends it: ESC intact, never framed as text. */
const DCS_REPLY = /^\x1bP1\$r[0-9;]*r\x1b\\$/;

describe('one key\'s bytes', () => {
  it('every key the bar sends is one key', () => {
    for (const [k, bytes] of Object.entries(KEY_SEQ)) expect(oneKey(bytes), k).toBe(true);
  });

  it('so is every shape xterm 6.0.0 sends for a key: a character, Alt and one character, CSI, SS3', () => {
    for (const s of ['a', 'é', '🙂', '\x1bx', '\x1b\r', '\x1b\x1b', '\x1b\x7f', '\x1bOA', '\x1b[1;5C', '\x1b[3~', '\x1b[15;2~', '\x1bOP']) {
      expect(oneKey(s), JSON.stringify(s)).toBe(true);
    }
  });

  it('text is not, nor two keys, nor a bracketed-paste marker, which no key sends', () => {
    for (const s of ['ab', 'hello', 'a\r', '\x1b[A\x1b[B', HOSTILE_INSERT, PASTE_OPEN, PASTE_CLOSE, '\x1bP1$r0m\x1b\\']) {
      expect(oneKey(s), JSON.stringify(s)).toBe(false);
    }
  });
});

describe('insertedFrame: what an insertion is sent as', () => {
  it('one key\'s bytes, and text with no control in it, go as they are', () => {
    for (const s of ['c', '\r', '\x7f', '\x1b[A', 'hello world', 'héllo 日本 🙂', 'a\tb']) {
      expect(insertedFrame(s), JSON.stringify(s)).toBe(s);
    }
  });

  it('text carrying a control no key typed goes as a paste would: an end marker in it frames nothing, and no line submits', () => {
    const out = insertedFrame(HOSTILE_INSERT);
    expect(out).toBe(typedFrame(HOSTILE_INSERT));
    expect(out.startsWith(PASTE_OPEN)).toBe(true);
    expect(count(out, PASTE_CLOSE), 'a second end marker reached the frame').toBe(1);
    expect(out.endsWith(PASTE_CLOSE)).toBe(true);
    expect(insertedFrame('a\nb')).toBe(typedFrame('a\nb'));
    expect(insertedFrame(PASTE_CLOSE), 'a lone end marker inserted is text').toBe('[201~');
  });
});

describe('the letter a latched ctrl takes from a keydown', () => {
  const key = (k: string, more: Partial<Parameters<typeof keyLetter>[0]> = {}) =>
    keyLetter({ key: k, keyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, ...more });

  it('one ASCII letter, shifted or not', () => {
    expect(key('c')).toBe('c');
    expect(key('C')).toBe('C');
  });

  it('nothing with a modifier that is not shift, nothing mid-composition, nothing an IME reports', () => {
    expect(key('c', { ctrlKey: true })).toBeNull();
    expect(key('c', { altKey: true })).toBeNull();
    expect(key('c', { metaKey: true })).toBeNull();
    expect(key('c', { isComposing: true })).toBeNull();
    expect(key('c', { keyCode: 229 })).toBeNull();
    for (const k of ['Unidentified', 'Process', 'Enter', 'Escape', '1', 'é', ' ']) expect(key(k), k).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The drawer, against the real terminal it builds
// ─────────────────────────────────────────────────────────────────────────────

class FakeSocket {
  static instances: FakeSocket[] = [];
  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void { /* nothing to tear down */ }
  /** Every frame's data, in order; the frames are all `input` or the test fails. */
  inputs(): string[] {
    return this.sent.map((raw) => {
      const f = JSON.parse(raw) as { type: string; data: string };
      expect(f.type, 'the drawer sent a frame that is not input').toBe('input');
      return f.data;
    });
  }
}
const makeSocket = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;

const ID = 'lane-a:project-a';

const memStore = (): StorageLike & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
};

const exitScreen = SYNTHETIC_SCREENS.find((s) => s.name === 'exit-notice');
if (exitScreen === undefined) throw new Error('the synthetic exit-notice screen is missing');

/** The drawer, open on its own real terminal, with the view chosen by a stored
 *  override (jsdom has no layout, so the glass is never measured and the
 *  override alone decides). */
function mount(view: 'wrapped' | 'grid') {
  const store = memStore();
  store.map.set(VIEW_OVERRIDE_KEY, view);
  const el = <TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} viewStorage={() => store} />;
  const utils = render(el);
  const ws = FakeSocket.instances.at(-1);
  if (ws === undefined) throw new Error('the drawer opened no socket');
  act(() => ws.onopen?.());
  const term = made.terms.at(-1) as XTerm;
  const ta = term.textarea;
  if (ta === undefined) throw new Error('the drawer did not open its terminal');
  const host = utils.baseElement.querySelector<HTMLElement>('.term-screen > .term-host');
  if (host === null) throw new Error('no terminal host');
  /** tmux's bytes, parsed. */
  const paint = async (bytes: string): Promise<void> => {
    act(() => ws.onmessage?.({ data: bytes }));
    await act(async () => { await new Promise<void>((r) => { term.write('', r); }); });
  };
  return { ...utils, ws, term, ta, host, paint, store };
}

/** A bar button by its accessible name. By attribute rather than by role: a
 *  role query walks the whole document's accessibility tree, the real
 *  terminal's 51 rendered rows included, and MEASURED (2026-10-15) the latch
 *  cases spent 1–2 s each on it alone in isolation and passed vaul's and
 *  vitest's 5 s under a loaded full run. Every bar button is a `Keycap`
 *  named by its `aria-label`, so the attribute IS its accessible name. */
const barButton = (name: string): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`.term-keys button[aria-label="${name}"]`);
/** Tap ⋯ (when its row is closed), then `ctrl`. */
const latch = (): void => {
  if (barButton('Control') === null) fireEvent.click(barButton('More keys')!);
  fireEvent.click(barButton('Control')!);
  expect(barButton('Control')).toHaveAttribute('aria-pressed', 'true');
};
const ctrlPressed = (): string | null => barButton('Control')?.getAttribute('aria-pressed') ?? null;

/** A `beforeinput` as a browser dispatches it. A composition's is not
 *  cancelable (Input Events Level 2), and a browser will not let it be. */
const beforeInput = (target: Element, inputType: string, data: string): InputEvent => {
  const ev = new InputEvent('beforeinput', {
    inputType, data, bubbles: true, composed: true, cancelable: inputType !== 'insertCompositionText',
  });
  act(() => { target.dispatchEvent(ev); });
  return ev;
};
/** A key a keyboard reports as a real key: a physical one, or an on-screen one
 *  that is not composing. xterm 6.0.0 sends such a letter AT KEYDOWN and
 *  cancels the event, so no `beforeinput` ever follows it. */
const realKey = (target: Element, k: string, more: Record<string, unknown> = {}): void => {
  act(() => { fireEvent.keyDown(target, { key: k, code: `Key${k.toUpperCase()}`, keyCode: k.toUpperCase().charCodeAt(0), ...more }); });
};
/** An IME composition, as Gboard opens one on xterm's textarea: the event,
 *  then the text the browser puts into the textarea, then (at `end`) the
 *  commit xterm reads back out of the textarea a tick later. */
const composition = (ta: HTMLTextAreaElement) => {
  /** What the textarea held before the composition: xterm reads the commit
   *  from that offset on (`CompositionHelper.compositionstart`). */
  let base = '';
  return {
    start: (): void => {
      base = ta.value;
      act(() => { fireEvent.compositionStart(ta, { data: '' }); });
    },
    type: (text: string): InputEvent => {
      const ev = beforeInput(ta, 'insertCompositionText', text);
      act(() => { fireEvent.compositionUpdate(ta, { data: text }); });
      ta.value = base + text;
      return ev;
    },
    end: async (text: string): Promise<void> => {
      act(() => { fireEvent.compositionEnd(ta, { data: text }); });
      await tick();
    },
  };
};

describe('the latch takes its letter from xterm\'s textarea (Step 2)', () => {
  it('insertText: prevented, the control code sent once at once, the latch cleared, and a later letter typed as itself', () => {
    const d = mount('wrapped');
    latch();
    const ev = beforeInput(d.ta, 'insertText', 'c');
    expect(ev.defaultPrevented, 'the letter was let into the textarea').toBe(true);
    expect(d.ws.inputs()).toEqual([KEY_SEQ.ctrlC]);
    expect(ctrlPressed(), 'the latch did not clear').toBe('false');

    // The cancel took, so nothing of the letter is pending: the next `c` typed
    // is a `c`.
    realKey(d.ta, 'c');
    expect(d.ws.inputs()).toEqual([KEY_SEQ.ctrlC, 'c']);
  });

  it('a word inserted whole while latched: its first letter, and nothing of the word', () => {
    const d = mount('wrapped');
    latch();
    expect(beforeInput(d.ta, 'insertText', 'react').defaultPrevented).toBe(true);
    expect(d.ws.inputs()).toEqual([KEY_SEQ.ctrlR]);
  });

  it('the letter that opens a composition: the control code at once, and the composition sends nothing when it ends', async () => {
    const d = mount('wrapped');
    const ime = composition(d.ta);
    latch();
    ime.start();
    ime.type('r');
    expect(d.ws.inputs(), 'the control code waited for the composition').toEqual([KEY_SEQ.ctrlR]);
    expect(ctrlPressed()).toBe('false');
    await ime.end('r');
    expect(d.ws.inputs(), 'the composition\'s letter reached the session too').toEqual([KEY_SEQ.ctrlR]);

    // Once: the same letter typed afterwards is typed.
    realKey(d.ta, 'r');
    expect(d.ws.inputs()).toEqual([KEY_SEQ.ctrlR, 'r']);
  });

  it('a composition that grows past the letter is sent as xterm sends it, and the drop is spent on it: a later letter is never eaten', async () => {
    const d = mount('wrapped');
    const ime = composition(d.ta);
    latch();
    ime.start();
    ime.type('c');
    ime.type('ch');
    ime.type('chat');
    await ime.end('chat');
    // The grown word keeps its `c` (the plan's drop matches the lone letter
    // only; the residual is named in the stage's open issues).
    expect(d.ws.inputs()).toEqual([KEY_SEQ.ctrlC, 'chat']);
    realKey(d.ta, 'c');
    expect(d.ws.inputs(), 'a later `c` was eaten by a drop left armed').toEqual([KEY_SEQ.ctrlC, 'chat', 'c']);
  });

  it('a letter added to a composition already open is not taken: no control code from the composition\'s first letter', async () => {
    const d = mount('wrapped');
    const ime = composition(d.ta);
    ime.start();
    ime.type('hel');
    latch();
    const ev = ime.type('helc');
    expect(ev.defaultPrevented).toBe(false);
    expect(d.ws.inputs(), 'the latch sent the control code of the composition\'s first letter').toEqual([]);
    expect(ctrlPressed(), 'the latch cleared without taking a letter').toBe('true');
    await ime.end('helc');
    expect(d.ws.inputs()).toEqual(['helc']);
  });

  it('a key reported as a real key: the control code once, and xterm never sends the letter', () => {
    const d = mount('wrapped');
    latch();
    realKey(d.ta, 'b');
    expect(d.ws.inputs(), 'the letter was typed instead of, or as well as, its control code').toEqual([KEY_SEQ.ctrlB]);
    expect(ctrlPressed()).toBe('false');
    realKey(d.ta, 'b');
    expect(d.ws.inputs()).toEqual([KEY_SEQ.ctrlB, 'b']);
  });

  it('a non-letter is not taken: the latch stays, and the key is typed', () => {
    const d = mount('wrapped');
    latch();
    expect(beforeInput(d.ta, 'insertText', '1').defaultPrevented).toBe(false);
    act(() => { fireEvent.keyDown(d.ta, { key: '1', code: 'Digit1', keyCode: 49 }); });
    expect(d.ws.inputs()).toEqual(['1']);
    expect(ctrlPressed()).toBe('true');
  });

  it('with ctrl not latched, beforeinput is never prevented, and typing reaches the socket exactly as xterm sends it', async () => {
    const d = mount('wrapped');
    for (const [type, data] of [['insertText', 'c'], ['insertText', 'Cat'], ['insertCompositionText', 'c']] as const) {
      expect(beforeInput(d.ta, type, data).defaultPrevented, `${type} ${data}`).toBe(false);
    }
    realKey(d.ta, 'c');
    // An on-screen keyboard that composes: keyCode 229, then the browser's
    // insertion, which xterm reads back out of the textarea.
    act(() => { fireEvent.keyDown(d.ta, { key: 'Unidentified', keyCode: 229 }); });
    d.ta.value += 'hi';
    await tick();
    const ime = composition(d.ta);
    ime.start();
    ime.type('word');
    await ime.end('word');
    expect(d.ws.inputs()).toEqual(['c', 'hi', 'word']);
  });

  it('the latch\'s letter goes through the ^C/^D guard: with the exit notice showing, latched `c` sends nothing and asks', async () => {
    const d = mount('wrapped');
    await d.paint(exitScreen.stream);
    latch();
    expect(beforeInput(d.ta, 'insertText', 'c').defaultPrevented).toBe(true);
    expect(d.ws.inputs(), 'the latch sent ^C past the guard').toEqual([]);
    expect(screen.getByRole('group', { name: 'Confirm Control C' })).toHaveTextContent('Claude Code will exit');
    fireEvent.click(barButton('Cancel')!);
    expect(d.ws.inputs()).toEqual([]);
  });

  it('a latch the view no longer shows is cleared: flipped to the grid, a typed letter is a letter', () => {
    const d = mount('wrapped');
    latch();
    fireEvent.click(document.querySelector<HTMLButtonElement>('.term-chips button[aria-label^="Wrapped view:"]')!);
    expect(d.baseElement.querySelector('.term-wrap'), 'the chip did not flip to the grid').toBeNull();
    realKey(d.ta, 'c');
    expect(d.ws.inputs(), 'an invisible latch turned a letter into a control code').toEqual(['c']);
  });

  it('a re-attach starts unlatched', () => {
    const d = mount('wrapped');
    latch();
    d.rerender(<TerminalDrawer id={ID} open={false} onClose={() => {}} makeSocket={makeSocket} viewStorage={() => d.store} />);
    d.rerender(<TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} viewStorage={() => d.store} />);
    const ws = FakeSocket.instances.at(-1)!;
    act(() => ws.onopen?.());
    const ta = (made.terms.at(-1) as XTerm).textarea!;
    realKey(ta, 'c');
    expect(ws.inputs(), 'the last attach\'s latch took the new attach\'s letter').toEqual(['c']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: the paste guard (Refinement 11; P3: both views)
// ─────────────────────────────────────────────────────────────────────────────

/** A paste event carrying `text`, as the clipboard hands it over. */
const pasteOn = (target: Element, text: string): Event => {
  const ev = createEvent.paste(target, {
    clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
  act(() => { fireEvent(target, ev); });
  return ev;
};

const HOSTILE = 'a\x1b[201~\rrm -rf x';

describe('the paste guard', () => {
  it.each(['wrapped', 'grid'] as const)('%s view: a paste on xterm\'s textarea is taken before xterm sees it and sent as typedFrame(text), once', async (view) => {
    const d = mount(view);
    // Claude Code turns bracketed paste on and tmux passes it to the drawer's
    // xterm: the case where xterm's own paste would bracket.
    await d.paint('\x1b[?2004h');
    const reached = vi.fn();
    d.ta.addEventListener('paste', reached);

    const ev = pasteOn(d.ta, HOSTILE);
    expect(ev.defaultPrevented, 'the browser was let paste into the textarea').toBe(true);
    expect(reached, 'the paste reached xterm\'s textarea: propagation was not stopped').not.toHaveBeenCalled();
    expect(d.ws.inputs(), 'the paste was not sent as the guard frames it, once').toEqual([typedFrame(HOSTILE)]);
    expect(count(d.ws.inputs().join(''), PASTE_CLOSE), 'a pasted end marker reached a frame').toBe(1);
  });

  it('a single line is sent literally', () => {
    const d = mount('wrapped');
    pasteOn(d.ta, 'hello');
    expect(d.ws.inputs()).toEqual(['hello']);
  });

  it('a paste over the screen itself (xterm\'s own element) is guarded too', async () => {
    const d = mount('grid');
    await d.paint('\x1b[?2004h');
    const screenEl = d.term.element;
    if (screenEl === undefined) throw new Error('the terminal has no element');
    pasteOn(screenEl, HOSTILE);
    expect(d.ws.inputs()).toEqual([typedFrame(HOSTILE)]);
  });

  it('a paste that sanitises to nothing sends nothing, and xterm does not send it either', () => {
    const d = mount('wrapped');
    const ev = pasteOn(d.ta, '\x1b\x03');
    expect(ev.defaultPrevented).toBe(true);
    expect(d.ws.sent).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Text a keyboard INSERTS, in the drawer (D-5114)
// ─────────────────────────────────────────────────────────────────────────────

/** An `input` event as a browser dispatches one for a keyboard's insertion. */
const inputOn = (ta: HTMLTextAreaElement, data: string): void => {
  act(() => {
    ta.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data, bubbles: true, composed: true }));
  });
};

// MEASURED before this (the verifier's probe, against the real xterm 6.0.0 the
// drawer builds): an insertion carrying `\e[201~` and CRs reached the socket raw
// in both views by all three paths, each CR an Enter. The paste guard saw none
// of them, because none is a `paste` event.
describe('text a keyboard inserts cannot end a bracketed paste or submit a line', () => {
  it.each(['wrapped', 'grid'] as const)('%s view: an input event\'s insertText', async (view) => {
    const d = mount(view);
    await d.paint('\x1b[?2004h');
    inputOn(d.ta, HOSTILE_INSERT);
    expect(d.ws.inputs()).toEqual([typedFrame(HOSTILE_INSERT)]);
  });

  it.each(['wrapped', 'grid'] as const)('%s view: the textarea diff xterm reads after a keyCode-229 keydown', async (view) => {
    const d = mount(view);
    await d.paint('\x1b[?2004h');
    act(() => { fireEvent.keyDown(d.ta, { key: 'Unidentified', keyCode: 229 }); });
    d.ta.value += HOSTILE_INSERT;
    await tick();
    expect(d.ws.inputs()).toEqual([typedFrame(HOSTILE_INSERT)]);
  });

  it.each(['wrapped', 'grid'] as const)('%s view: a composition\'s commit', async (view) => {
    const d = mount(view);
    await d.paint('\x1b[?2004h');
    const ime = composition(d.ta);
    ime.start();
    ime.type(HOSTILE_INSERT);
    await ime.end(HOSTILE_INSERT);
    expect(d.ws.inputs()).toEqual([typedFrame(HOSTILE_INSERT)]);
  });

  it('plain text inserted goes as it is, and a key pressed while an insertion is landing is still the key', async () => {
    const d = mount('wrapped');
    inputOn(d.ta, 'hello world');
    // The insertion's window is still open: a real key keeps its bytes.
    act(() => { fireEvent.keyDown(d.ta, { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }); });
    act(() => { fireEvent.keyDown(d.ta, { key: 'Escape', code: 'Escape', keyCode: 27 }); });
    act(() => { fireEvent.keyDown(d.ta, { key: 'Enter', code: 'Enter', keyCode: 13 }); });
    await tick();
    expect(d.ws.inputs()).toEqual(['hello world', '\x1b[A', '\x1b', '\r']);
  });

  it('a reply the terminal sends of its own, outside any insertion, is never touched', async () => {
    const d = mount('grid');
    // DECRQSS for the scroll margins: xterm answers with a DCS string, which is
    // no key's shape, on the socket as tmux asked for it.
    await d.paint(DCS_QUERY);
    const replies = d.ws.inputs();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(DCS_REPLY);
  });

  // THE WINDOW CLOSES. On a phone every keystroke the keyboard inserts opens
  // one, so a window that stayed open after the first would frame every later
  // reply the terminal sends of its own (a DCS or OSC report tmux asked for) as
  // typed text, its ESC stripped, into Claude Code's box. The case above paints
  // its query before any insertion, so it cannot see that; these insert first,
  // let the window's two task turns pass, then paint the query (the stage-1
  // verifier's mutant, every window left open, was GREEN before them).
  it.each(['wrapped', 'grid'] as const)('%s view: the window an insertText opened closes, and a reply after it is untouched', async (view) => {
    const d = mount(view);
    inputOn(d.ta, 'hello');
    await tick();
    await windowsClosed();
    await d.paint(DCS_QUERY);
    const sent = d.ws.inputs();
    expect(sent[0], 'the insertion itself').toBe('hello');
    expect(sent).toHaveLength(2);
    expect(sent[1], 'a reply after the insertion was framed as typed text: its window never closed').toMatch(DCS_REPLY);
  });

  it.each(['wrapped', 'grid'] as const)('%s view: the window a keyCode-229 keydown opened closes once its diff is read', async (view) => {
    const d = mount(view);
    act(() => { fireEvent.keyDown(d.ta, { key: 'Unidentified', keyCode: 229 }); });
    d.ta.value += 'hello';
    await tick();
    await windowsClosed();
    await d.paint(DCS_QUERY);
    const sent = d.ws.inputs();
    expect(sent[0], 'the diff xterm read after the 229 keydown').toBe('hello');
    expect(sent).toHaveLength(2);
    expect(sent[1], 'a reply after the 229 insertion was framed as typed text: its window never closed').toMatch(DCS_REPLY);
  });

  it('a real key opens no window: a reply that lands while the key is still being sent is untouched', async () => {
    const d = mount('grid');
    // xterm 6.0.0 sends an unmodified letter at keydown; the reply below is
    // parsed within the same two task turns a window would last.
    realKey(d.ta, 'a');
    await d.paint(DCS_QUERY);
    const sent = d.ws.inputs();
    expect(sent[0]).toBe('a');
    expect(sent).toHaveLength(2);
    expect(sent[1], 'a keydown that is no insertion opened a window, and the reply was framed').toMatch(DCS_REPLY);
  });
});

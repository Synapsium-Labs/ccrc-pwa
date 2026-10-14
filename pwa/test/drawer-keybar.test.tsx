// The drawer's key bar (D-5007, spec 2026-10-14 §5.4). What this file pins:
// (a) KEY_SEQ, the one table of key bytes, by value — its first eight are the
//     drawer's old quick-key bytes exactly;
// (b) `ctrlCode`: one ASCII letter, and nothing else, becomes its C0 control;
// (c) the two bars: the grid view's strip (the old keys, then ^C) and the
//     wrapped view's `esc ↑ ↓ ⏎ ^C ⌫ ⋯` with the row `⋯` opens, the history
//     door beside both and never inside a row of keys;
// (d) the one-shot `ctrl` latch, which the text field of a later task feeds;
// (e) below 420px the bar wraps, read from chat.css as text (jsdom applies no
//     stylesheet), and every key is a --tap-min target;
// (f) single definition: no key byte is spelled under `pwa/src/session/`
//     outside `keyBar.ts`, and the scan is proved live on that file;
// (g) no two modules under `pwa/src` differ only in case, which is why the
//     component is `KeyBarView.tsx` beside the pure `keyBar.ts`;
// (h) the ^C/^D guard (Task 11): a TAP of ^C or ^D — from the bar in either
//     view, or through the latch — asks before it sends while Claude Code's
//     exit notice is on the screen, reading the model at tap time; a physical
//     Ctrl-C typed into the terminal is never asked about.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Terminal } from '@xterm/xterm';
import { TerminalDrawer, type DrawerTerm } from '../src/session/TerminalDrawer';
import { atBlock, declValue, ruleIn } from './cssRule';
import {
  GRID_KEYS,
  GUARDED_KEYS,
  KEY_CAP,
  KEY_SEQ,
  OVERFLOW_KEYS,
  PRIMARY_KEYS,
  ctrlCode,
  exitNoticeShowing,
  guardedKey,
  type KeyName,
} from '../src/session/keyBar';
import { KeyBar, useCtrlLatch, useExitGuard, useKeyInput } from '../src/session/KeyBarView';
import { readModel, rowText } from '../src/session/drawerModel';
import { PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS, TMUX_STATUS_ROWS } from '../../shared/api';
import { SYNTHETIC_SCREENS } from './fixtures/drawer/synthetic';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  FakeSocket.instances.length = 0;
});

const chatCss = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'session', 'chat.css'),
  'utf8',
);

const legends = (el: Element): string[] =>
  Array.from(el.querySelectorAll('button')).map((b) => b.textContent ?? '');

/** The screen a bar's guard reads: none, unless a case hands one in. */
const noScreen = (): readonly string[] => [];

/** The wrapped bar wired as the drawer wires it: `useKeyInput`, so the latch
 *  sends through the same guard as the caps. The stand-in letters are the text
 *  field's (a later task) offer of one typed character to the latch. */
function Wrapped({
  send,
  action,
  screen = noScreen,
}: {
  send: (d: string) => void;
  action?: ReactNode;
  screen?: () => readonly string[];
}): ReactNode {
  const { guard, latch } = useKeyInput(send, screen);
  return (
    <>
      <KeyBar view="wrapped" guard={guard} latch={latch} action={action} />
      <button type="button" onClick={() => latch.take('c')}>
        stand-in letter c
      </button>
      <button type="button" onClick={() => latch.take('d')}>
        stand-in letter d
      </button>
      <button type="button" onClick={() => latch.take('1')}>
        stand-in digit 1
      </button>
    </>
  );
}

/** The grid strip, wired the same way. */
function Grid({
  send,
  action,
  screen = noScreen,
}: {
  send: (d: string) => void;
  action?: ReactNode;
  screen?: () => readonly string[];
}): ReactNode {
  const { guard } = useKeyInput(send, screen);
  return <KeyBar view="grid" guard={guard} action={action} />;
}

const door = (
  <button type="button" className="keycap keycap--act" aria-label="Scroll back">
    hist
  </button>
);

// — fakes —

class FakeSocket {
  static instances: FakeSocket[] = [];
  url: string;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  lastFrame(): unknown {
    const raw = this.sent.at(-1);
    return raw === undefined ? undefined : JSON.parse(raw);
  }
}

const makeSocket = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;

const fakeTermFactory = (cols = 48, rows = 20) => {
  const write = vi.fn<(data: string) => void>();
  const dispose = vi.fn<() => void>();
  let grid = { cols, rows };
  let dataCb: ((data: string) => void) | null = null;
  const hosts: HTMLElement[] = [];
  const makeTerm = (): DrawerTerm => {
    let opened = false;
    return {
      write: (d) => write(d),
      onData: (cb) => {
        dataCb = cb;
      },
      onWheel: () => {},
      pin: () => {},
      propose: () => ({ ...grid }),
      setFontSize: () => {},
      open: (host) => {
        hosts.push(host);
        opened = true;
      },
      isOpen: () => opened,
      model: () => [],
      statusRow: () => [],
      onParsed: () => () => {},
      focus: () => {},
      dispose,
    };
  };
  return { makeTerm, write, dispose, hosts, type: (d: string) => dataCb?.(d) };
};

const ID = 'lane-a:project-a';

describe('KEY_SEQ, by value', () => {
  it.each([
    ['esc', '\x1b'],
    ['up', '\x1b[A'],
    ['down', '\x1b[B'],
    ['left', '\x1b[D'],
    ['right', '\x1b[C'],
    ['enter', '\r'],
    ['tab', '\t'],
    ['shiftTab', '\x1b[Z'],
    ['ctrlC', '\x03'],
    ['ctrlD', '\x04'],
    ['backspace', '\x7f'],
    ['pgUp', '\x1b[5~'],
    ['pgDn', '\x1b[6~'],
    ['ctrlU', '\x15'],
    ['ctrlO', '\x0f'],
    ['ctrlR', '\x12'],
    ['ctrlT', '\x14'],
    ['ctrlB', '\x02'],
    ['space', ' '],
  ] as [KeyName, string][])('%s is %j', (name, bytes) => {
    expect(KEY_SEQ[name]).toBe(bytes);
  });

  it('covers the named keys exactly, each with a distinct accessible label', () => {
    const names: KeyName[] = [
      'esc',
      'up',
      'down',
      'left',
      'right',
      'enter',
      'ctrlC',
      'ctrlD',
      'backspace',
      'tab',
      'shiftTab',
      'space',
      'pgUp',
      'pgDn',
      'ctrlU',
      'ctrlO',
      'ctrlR',
      'ctrlT',
      'ctrlB',
    ];
    expect(Object.keys(KEY_SEQ).sort()).toEqual(names.slice().sort());
    const labels = new Set<string>();
    for (const k of names) {
      expect(KEY_CAP[k]).toBeDefined();
      expect(KEY_CAP[k].legend.length).toBeGreaterThan(0);
      expect(KEY_CAP[k].label.length).toBeGreaterThan(0);
      expect(labels.has(KEY_CAP[k].label)).toBe(false);
      labels.add(KEY_CAP[k].label);
    }
  });
});

describe('ctrlCode', () => {
  it.each([
    ['a', '\x01'],
    ['A', '\x01'],
    ['c', '\x03'],
    ['z', '\x1a'],
    ['Z', '\x1a'],
  ] as [string, string][])('%s → %j', (ch, code) => {
    expect(ctrlCode(ch)).toBe(code);
  });

  it.each([
    ['1'],
    ['0'],
    ['9'],
    ['é'],
    ['ab'],
    [''],
    [' '],
    ['@'],
    ['['],
    ['`'],
    ['{'],
  ] as [string][])('%s → null', (ch) => {
    expect(ctrlCode(ch)).toBeNull();
  });
});

describe('the lists', () => {
  it('PRIMARY_KEYS', () => {
    expect(PRIMARY_KEYS).toEqual(['esc', 'up', 'down', 'enter', 'ctrlC', 'backspace']);
  });

  it('OVERFLOW_KEYS', () => {
    expect(OVERFLOW_KEYS).toEqual([
      'left',
      'right',
      'tab',
      'shiftTab',
      'space',
      'pgUp',
      'pgDn',
      'ctrlU',
      'ctrlO',
      'ctrlR',
      'ctrlT',
      'ctrlB',
    ]);
  });

  it('GRID_KEYS', () => {
    expect(GRID_KEYS).toEqual([
      'esc',
      'up',
      'down',
      'left',
      'right',
      'tab',
      'shiftTab',
      'enter',
      'ctrlC',
    ]);
  });
});

describe('the wrapped view bar', () => {
  it('renders the primary row and the history door, with overflow closed', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Terminal keys' });
    expect(toolbar.classList.contains('term-keys')).toBe(true);
    expect(toolbar.classList.contains('term-keys--wrapped')).toBe(true);
    expect(legends(toolbar.querySelector('.term-keys-seq')!)).toEqual([
      'esc',
      '↑',
      '↓',
      '⏎',
      '^C',
      '⌫',
      '⋯',
    ]);
    expect(document.querySelector('.term-keys-more')).toBeNull();
    expect(screen.getByRole('button', { name: 'More keys' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles the overflow row', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} />);
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    const more = document.querySelector('.term-keys-more')!;
    expect(legends(more)).toEqual([
      '←',
      '→',
      'tab',
      '⇧tab',
      'space',
      'PgUp',
      'PgDn',
      '^U',
      '^O',
      '^R',
      '^T',
      '^B',
      'ctrl',
    ]);
    expect(screen.getByRole('button', { name: 'More keys' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    expect(document.querySelector('.term-keys-more')).toBeNull();
  });

  it.each([
    ...PRIMARY_KEYS.map((k): [KeyName, 'primary'] => [k, 'primary']),
    ...OVERFLOW_KEYS.map((k): [KeyName, 'overflow'] => [k, 'overflow']),
  ])('tapping %s (the %s row) sends its KEY_SEQ bytes', (k, section) => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} />);
    if (section === 'overflow') {
      fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    }
    fireEvent.click(screen.getByRole('button', { name: KEY_CAP[k].label }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(KEY_SEQ[k]);
  });

  it('More keys and Control are actions that send nothing', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} />);
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    expect(send).not.toHaveBeenCalled();
  });

  it('places the action outside both key rows', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} />);
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    const action = screen.getByRole('button', { name: 'Scroll back' });
    expect(action.closest('.term-keys')).not.toBeNull();
    expect(action.closest('.term-keys-seq')).toBeNull();
    expect(action.closest('.term-keys-more')).toBeNull();
  });

  it('keeps focus on pointer down for every key', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} />);
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    const buttons = screen.getByRole('toolbar', { name: 'Terminal keys' }).querySelectorAll('button');
    for (const button of buttons) {
      if (button.getAttribute('aria-label') === 'Scroll back') continue;
      expect(button.classList.contains('keycap')).toBe(true);
      expect(fireEvent.pointerDown(button)).toBe(false);
    }
  });
});

describe('the ctrl latch', () => {
  it('latches and unlatches without sending', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} />);
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    const ctrl = screen.getByRole('button', { name: 'Control' });
    fireEvent.click(ctrl);
    expect(ctrl).toHaveAttribute('aria-pressed', 'true');
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(ctrl);
    expect(ctrl).toHaveAttribute('aria-pressed', 'false');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the control code on the next letter and clears', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} />);
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    fireEvent.click(screen.getByRole('button', { name: 'stand-in letter c' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith('\x03');
    const ctrl = screen.getByRole('button', { name: 'Control' });
    expect(ctrl).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'stand-in letter c' }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('ignores a non-letter while latched', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} />);
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    fireEvent.click(screen.getByRole('button', { name: 'stand-in digit 1' }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Control' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('takes only the first of two characters before a re-render', () => {
    const send = vi.fn<(d: string) => void>();
    const { result } = renderHook(() => useCtrlLatch(send));
    act(() => result.current.setLatched(true));
    let a = false;
    let b = false;
    act(() => {
      a = result.current.take('a');
      b = result.current.take('b');
    });
    expect(a).toBe(true);
    expect(b).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith('\x01');
  });

  it('take returns false when not latched', () => {
    const send = vi.fn<(d: string) => void>();
    const { result } = renderHook(() => useCtrlLatch(send));
    act(() => {
      expect(result.current.take('a')).toBe(false);
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('unlatches when the overflow row closes', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} />);
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    const ctrl = screen.getByRole('button', { name: 'Control' });
    expect(ctrl).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'stand-in letter c' }));
    expect(send).not.toHaveBeenCalled();
  });
});

describe('the grid view strip', () => {
  it('renders the grid keys and the history door', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Grid send={send} action={door} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Terminal keys' });
    expect(toolbar.classList.contains('term-keys')).toBe(true);
    expect(toolbar.classList.contains('term-keys--grid')).toBe(true);
    expect(legends(toolbar.querySelector('.term-keys-seq')!)).toEqual([
      'esc',
      '↑',
      '↓',
      '←',
      '→',
      'tab',
      '⇧tab',
      '⏎',
      '^C',
    ]);
    expect(screen.queryByRole('button', { name: 'More keys' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Control' })).toBeNull();
    const action = screen.getByRole('button', { name: 'Scroll back' });
    expect(action.closest('.term-keys')).not.toBeNull();
    expect(action.closest('.term-keys-seq')).toBeNull();
  });

  it('Control C sends ^C', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Grid send={send} action={door} />);
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith('\x03');
  });

  it.each(GRID_KEYS)('%s sends its sequence', (k) => {
    const send = vi.fn<(d: string) => void>();
    render(<Grid send={send} action={door} />);
    fireEvent.click(screen.getByRole('button', { name: KEY_CAP[k].label }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(KEY_SEQ[k]);
  });
});

describe('the drawer renders the grid strip', () => {
  it('shows the grid keys and the history door in the right places', () => {
    const t = fakeTermFactory();
    render(
      <TerminalDrawer
        id={ID}
        open
        onClose={() => {}}
        makeSocket={makeSocket}
        makeTerm={t.makeTerm}
      />,
    );
    const toolbar = screen.getByRole('toolbar', { name: 'Terminal keys' });
    expect(legends(toolbar.querySelector('.term-keys-seq')!)).toEqual([
      'esc',
      '↑',
      '↓',
      '←',
      '→',
      'tab',
      '⇧tab',
      '⏎',
      '^C',
    ]);
    const doorEl = screen.getByRole('button', { name: 'Scroll back' });
    expect(doorEl.closest('.term-keys')).not.toBeNull();
    expect(doorEl.closest('.term-keys-seq')).toBeNull();
  });

  it('sends nothing before the socket opens, then sends Control C as input', () => {
    const t = fakeTermFactory();
    render(
      <TerminalDrawer
        id={ID}
        open
        onClose={() => {}}
        makeSocket={makeSocket}
        makeTerm={t.makeTerm}
      />,
    );
    const ws = FakeSocket.instances.at(-1);
    if (!ws) throw new Error('drawer opened no socket');
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    expect(ws.sent).toHaveLength(0);
    act(() => ws.onopen?.());
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    expect(ws.lastFrame()).toEqual({ type: 'input', data: '\x03' });
    expect(ws.sent).toHaveLength(1);
  });
});

describe('below 420px the bar is two rows, never a strip', () => {
  it('has a 420px media rule that wraps the bar and stops scrolling the sequence', () => {
    const narrow = atBlock(chatCss, '@media (max-width: 420px)');
    expect(declValue(ruleIn(narrow, '.term-keys'), 'flex-wrap')).toBe('wrap');
    expect(declValue(ruleIn(narrow, '.term-keys-seq'), 'flex-wrap')).toBe('wrap');
    expect(declValue(ruleIn(narrow, '.term-keys-seq'), 'overflow-x')).toBe('visible');
  });

  it('the wrapped view and its overflow row are flex-wrapped', () => {
    expect(declValue(ruleIn(chatCss, '.term-keys--wrapped'), 'flex-wrap')).toBe('wrap');
    expect(declValue(ruleIn(chatCss, '.term-keys-more'), 'flex-wrap')).toBe('wrap');
    expect(declValue(ruleIn(chatCss, '.term-keys-more'), 'flex')).toBe('1 0 100%');
  });

  it('every key is a --tap-min target in both views', () => {
    const base = ruleIn(chatCss, '.term-keys .keycap');
    expect(declValue(base, 'min-width')).toBe('var(--tap-min)');
    expect(declValue(base, 'min-height')).toBe('var(--tap-min)');

    const send = vi.fn<(d: string) => void>();
    const { rerender } = render(<Grid send={send} action={door} />);
    const grid = screen.getByRole('toolbar', { name: 'Terminal keys' });
    for (const b of grid.querySelectorAll('button')) {
      expect(b.classList.contains('keycap')).toBe(true);
      expect(b.closest('.term-keys')).toBe(grid);
    }
    rerender(<Wrapped send={send} action={door} />);
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    const wrapped = screen.getByRole('toolbar', { name: 'Terminal keys' });
    for (const b of wrapped.querySelectorAll('button')) {
      expect(b.classList.contains('keycap')).toBe(true);
      expect(b.closest('.term-keys')).toBe(wrapped);
    }
  });
});

describe('one table of key bytes', () => {
  const SESSION_DIR = path.join(import.meta.dirname, '..', 'src', 'session');
  /** Every way a key byte can be spelled in TS source. */
  const ESC_SPELLING = /\\x1b|\\u001b|\\u\{1b\}/i; // Esc, every arrow, ⇧tab, PgUp, PgDn
  const BARE_LITERAL = /(['"`])\\[rt]\1/; // Enter or Tab as a bare literal
  const KEY_BYTE_SPELLINGS: readonly RegExp[] = [
    ESC_SPELLING,
    /\\x[01][0-9a-f]|\\x7f/i, // a C0 control or DEL by \x: the ^ keys, Backspace
    /\\u00[01][0-9a-f]|\\u007f|\\u\{[01]?[0-9a-f]\}|\\u\{7f\}/i, // the same by \u
    BARE_LITERAL,
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/, // a raw control byte pasted into the source
  ];
  /** Comments blanked (line count kept): prose may NAME a byte, code may not spell one. */
  const code = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const hits = (file: string, res: readonly RegExp[]): string[] =>
    code(readFileSync(file, 'utf8'))
      .split('\n')
      .flatMap((line, i) =>
        res.some((re) => re.test(line))
          ? [`${path.relative(SESSION_DIR, file)}:${i + 1}: ${line.trim()}`]
          : [],
      );

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* walk(full);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        yield full;
      }
    }
  }

  it('spells no key byte outside keyBar.ts', () => {
    const found: string[] = [];
    const scanned: string[] = [];
    for (const file of walk(SESSION_DIR)) {
      if (file === path.join(SESSION_DIR, 'keyBar.ts')) continue;
      scanned.push(file);
      found.push(...hits(file, KEY_BYTE_SPELLINGS));
    }
    expect(found, 'a key byte spelled outside KEY_SEQ').toEqual([]);
    const names = scanned.map((f) => path.relative(SESSION_DIR, f));
    expect(names).toContain('TerminalDrawer.tsx');
    expect(names).toContain('KeyBarView.tsx');
  });

  it('liveness: the scanner really matches keyBar.ts', () => {
    const escHits = hits(path.join(SESSION_DIR, 'keyBar.ts'), [ESC_SPELLING]);
    const bareHits = hits(path.join(SESSION_DIR, 'keyBar.ts'), [BARE_LITERAL]);
    expect(escHits.length).toBeGreaterThan(0);
    expect(bareHits.length).toBeGreaterThan(0);
  });
});

// — (g) no two modules that differ only in case —
//
// MEASURED while this bar was built: with `keyBar.ts` and `KeyBar.tsx` side by
// side, on a case-insensitive disk (macOS's default) `import … from './KeyBar'`
// resolved to `keyBar.ts`, so the component never loaded (`useCtrlLatch is not a
// function`), and tsc refused the pair (TS1149). A case-sensitive disk, the CI
// runner's, sees nothing wrong, so only a test that reads the names holds it.
describe('no two modules under pwa/src differ only in case', () => {
  it('every extensionless module path names one file on any disk', () => {
    const SRC = path.join(import.meta.dirname, '..', 'src');
    const byFolded = new Map<string, string[]>();
    const visit = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
          const rel = path.relative(SRC, full);
          const key = rel.replace(/\.[^.]+$/, '').toLowerCase();
          byFolded.set(key, [...(byFolded.get(key) ?? []), rel]);
        }
      }
    };
    visit(SRC);
    const clashes = [...byFolded.values()].filter((names) => names.length > 1);
    expect(clashes, 'two modules a case-insensitive disk cannot tell apart').toEqual([]);
    // Liveness: the walk reached both halves of the bar.
    expect(byFolded.has(path.join('session', 'keybar'))).toBe(true);
    expect(byFolded.has(path.join('session', 'keybarview'))).toBe(true);
  });
});

// — (h) the ^C/^D guard (Task 11, D-5007; spec 2026-10-14 §5.4, W11) —
//
// Claude Code clears a draft on the first Ctrl-C and then shows `Press Ctrl-C
// again to exit` under its box (W11): a second one ends the session. A tap has
// no feel, so while that notice is on the screen a tapped ^C or ^D asks first.

const exitScreen = SYNTHETIC_SCREENS.find((s) => s.name === 'exit-notice');
if (exitScreen === undefined) throw new Error('the synthetic exit-notice screen is missing');
const NOTICE = /Press Ctrl-C again to exit/;
const noticeAt = exitScreen.rows.findIndex((r) => NOTICE.test(r));

/** The exit-notice screen with its notice moved `n` rows up, and the footer
 *  it left showing the ordinary hint. */
const noticeHigher = (n: number): string[] => {
  const rows = [...exitScreen.rows];
  rows[noticeAt - n] = rows[noticeAt]!;
  rows[noticeAt] = '  ? for shortcuts';
  return rows;
};

/** A screen recorded from real Claude Code (2.1.291, 220x50) that drew its box
 *  MID-SCREEN, with blank rows under its footer: the model's last rows are
 *  blank there, so the notice under the box is not among them. */
const MID_SCREEN_CAPTURE = path.join(
  import.meta.dirname, '..', '..', 'server', 'test', 'fixtures', 'panes', 'cc291-model-ack-220x50-full.txt',
);
const midScreen = (): string[] => {
  const rows = readFileSync(MID_SCREEN_CAPTURE, 'utf8').split('\n').map((r) => r.replace(/ +$/, ''));
  let footer = rows.length - 1;
  while (footer > 0 && rows[footer]!.trim() === '') footer--;
  rows[footer] = '  Press Ctrl-C again to exit';
  return rows;
};

const RECORDED_ROOT = path.join(import.meta.dirname, 'fixtures', 'drawer', 'recorded');
const recordedCaptures = readdirSync(RECORDED_ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) =>
    readdirSync(path.join(RECORDED_ROOT, d.name))
      .filter((f) => f.endsWith('.json'))
      .map((f): [string, readonly string[]] => {
        const j = JSON.parse(readFileSync(path.join(RECORDED_ROOT, d.name, f), 'utf8')) as {
          scenario: string;
          capture: readonly string[];
        };
        return [j.scenario, j.capture];
      }),
  );

describe('exitNoticeShowing: the notice under the box, and only there', () => {
  it('the synthetic exit-notice screen holds the notice in its footer, under the box', () => {
    expect(exitScreen.rows).toHaveLength(PINNED_WINDOW_ROWS);
    expect(noticeAt).toBe(PINNED_WINDOW_ROWS - 2);
    expect(exitNoticeShowing(exitScreen.rows)).toBe(true);
  });

  it('is false for the same text five rows higher', () => {
    expect(exitNoticeShowing(noticeHigher(5))).toBe(false);
  });

  it('looks at exactly four rows: three rows up is in, four rows up is out', () => {
    expect(exitNoticeShowing(noticeHigher(3))).toBe(true);
    expect(exitNoticeShowing(noticeHigher(4))).toBe(false);
  });

  it('reads Ctrl-D the same way', () => {
    const rows = [...exitScreen.rows];
    rows[noticeAt] = '  Press Ctrl-D again to exit';
    expect(exitNoticeShowing(rows)).toBe(true);
  });

  it('counts the last four rows above the blank rows under them, where Claude Code draws its box mid-screen', () => {
    const rows = midScreen();
    // The premise, measured on the recorded capture: its last four rows are
    // blank, so a guard reading them literally would never see the notice.
    expect(rows.slice(-4).every((r) => r === '')).toBe(true);
    expect(exitNoticeShowing(rows)).toBe(true);
  });

  it('is false with no notice: every other synthetic screen', () => {
    for (const s of SYNTHETIC_SCREENS) {
      if (s === exitScreen) continue;
      expect(exitNoticeShowing(s.rows), s.name).toBe(false);
    }
  });

  it.each(recordedCaptures)('is false with no notice: the recorded %s', (_name, capture) => {
    expect(capture).toHaveLength(PINNED_WINDOW_ROWS);
    expect(exitNoticeShowing(capture)).toBe(false);
  });

  it('is false for an empty or blank screen', () => {
    expect(exitNoticeShowing([])).toBe(false);
    expect(exitNoticeShowing(Array.from({ length: PINNED_WINDOW_ROWS }, () => ''))).toBe(false);
  });
});

describe('the guarded keys', () => {
  it('are ^C and ^D', () => {
    expect(GUARDED_KEYS).toEqual(['ctrlC', 'ctrlD']);
  });

  it('guardedKey names a guarded key from its bytes, and nothing else', () => {
    expect(guardedKey(KEY_SEQ.ctrlC)).toBe('ctrlC');
    expect(guardedKey(KEY_SEQ.ctrlD)).toBe('ctrlD');
    expect(guardedKey(ctrlCode('c')!)).toBe('ctrlC');
    expect(guardedKey(ctrlCode('D')!)).toBe('ctrlD');
    for (const k of Object.keys(KEY_SEQ) as KeyName[]) {
      if (GUARDED_KEYS.includes(k)) continue;
      expect(guardedKey(KEY_SEQ[k]), k).toBeNull();
    }
    expect(guardedKey(ctrlCode('u')!)).toBeNull();
    expect(guardedKey('c')).toBeNull();
    expect(guardedKey('')).toBeNull();
  });
});

const confirmGroup = (): HTMLElement | null => document.querySelector('.term-confirm');

describe('the bar asks before ^C or ^D would exit Claude Code', () => {
  const showing = (): readonly string[] => exitScreen.rows;

  it('wrapped: ^C with the notice sends nothing and names the consequence', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} screen={showing} />);
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    expect(send).not.toHaveBeenCalled();
    const group = screen.getByRole('group', { name: 'Confirm Control C' });
    expect(group).toHaveTextContent('Claude Code will exit');
    expect(screen.getByRole('button', { name: 'Send Control C' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('wrapped: Send sends the byte once, and the bar comes back', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} screen={showing} />);
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send Control C' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(KEY_SEQ.ctrlC);
    expect(confirmGroup()).toBeNull();
    expect(screen.getByRole('button', { name: 'Control C' })).toBeInTheDocument();
  });

  it('wrapped: Cancel sends nothing, and the bar comes back', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} screen={showing} />);
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(send).not.toHaveBeenCalled();
    expect(confirmGroup()).toBeNull();
    expect(screen.getByRole('button', { name: 'Control C' })).toBeInTheDocument();
  });

  it('wrapped: without the notice, ^C sends at once', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} screen={() => noticeHigher(5)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(KEY_SEQ.ctrlC);
    expect(confirmGroup()).toBeNull();
  });

  it('wrapped: a key that is not guarded is never held, notice or not', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} screen={showing} />);
    for (const k of PRIMARY_KEYS) {
      if (GUARDED_KEYS.includes(k)) continue;
      fireEvent.click(screen.getByRole('button', { name: KEY_CAP[k].label }));
      expect(send).toHaveBeenLastCalledWith(KEY_SEQ[k]);
    }
    expect(send).toHaveBeenCalledTimes(PRIMARY_KEYS.length - 1);
    expect(confirmGroup()).toBeNull();
  });

  it('the latch then c, with the notice, is held like the cap', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} screen={showing} />);
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    fireEvent.click(screen.getByRole('button', { name: 'stand-in letter c' }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Confirm Control C' })).toHaveTextContent('Claude Code will exit');
    fireEvent.click(screen.getByRole('button', { name: 'Send Control C' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(KEY_SEQ.ctrlC);
    // The latch was used up by the letter it took: it does not wait for another.
    expect(screen.getByRole('button', { name: 'Control' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('the latch then d, with the notice, holds ^D', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} screen={showing} />);
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    fireEvent.click(screen.getByRole('button', { name: 'stand-in letter d' }));
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send Control D' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(KEY_SEQ.ctrlD);
  });

  it('the latch then c, without the notice, sends ^C at once', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} />);
    fireEvent.click(screen.getByRole('button', { name: 'More keys' }));
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    fireEvent.click(screen.getByRole('button', { name: 'stand-in letter c' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(KEY_SEQ.ctrlC);
    expect(confirmGroup()).toBeNull();
  });

  it('grid: the same guard covers the strip ^C', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Grid send={send} action={door} screen={showing} />);
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Confirm Control C' })).toHaveTextContent('Claude Code will exit');
    fireEvent.click(screen.getByRole('button', { name: 'Send Control C' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(KEY_SEQ.ctrlC);
  });

  it('the screen is read at tap time, not when the bar mounted', () => {
    const send = vi.fn<(d: string) => void>();
    let rows: readonly string[] = noticeHigher(5);
    render(<Grid send={send} action={door} screen={() => rows} />);
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    expect(send).toHaveBeenCalledTimes(1);
    rows = exitScreen.rows;
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(confirmGroup()).not.toBeNull();
  });

  it('the confirm keeps focus where it is, and its caps are --tap-min keycaps in the bar', () => {
    const send = vi.fn<(d: string) => void>();
    render(<Wrapped send={send} action={door} screen={showing} />);
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    const toolbar = screen.getByRole('toolbar', { name: 'Terminal keys' });
    for (const name of ['Send Control C', 'Cancel']) {
      const b = screen.getByRole('button', { name });
      expect(b.closest('.term-keys')).toBe(toolbar);
      expect(b.classList.contains('keycap')).toBe(true);
      expect(fireEvent.pointerDown(b)).toBe(false);
    }
    // The history door stays beside it.
    expect(screen.getByRole('button', { name: 'Scroll back' }).closest('.term-confirm')).toBeNull();
  });

  it('confirm sends once even when it is reached twice before a re-render', () => {
    const send = vi.fn<(d: string) => void>();
    const { result } = renderHook(() => useExitGuard(send, showing));
    act(() => result.current.send(KEY_SEQ.ctrlC));
    expect(result.current.held).toBe('ctrlC');
    act(() => {
      result.current.confirm();
      result.current.confirm();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.held).toBeNull();
  });

  it('the confirm text is measured by the contrast gate: it paints its own ground', () => {
    const word = ruleIn(chatCss, '.term-confirm-word');
    expect(declValue(word, 'color')).toBe('var(--ink-on-well)');
    expect(declValue(word, 'background')).toBe('var(--bg-well)');
  });
});

/** A drawer terminal whose model is a REAL xterm buffer: what the socket
 *  writes is parsed, and `model()` reads it as the drawer's own does. */
const realBufferTerm = () => {
  const real = new Terminal({
    cols: PINNED_WINDOW_COLS,
    rows: PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS,
    allowProposedApi: true,
  });
  let parsed: Promise<void> = Promise.resolve();
  let dataCb: ((data: string) => void) | null = null;
  const makeTerm = (): DrawerTerm => {
    let opened = false;
    return {
      write: (d) => {
        parsed = new Promise<void>((resolve) => real.write(d, resolve));
      },
      onData: (cb) => {
        dataCb = cb;
      },
      onWheel: () => {},
      pin: () => {},
      propose: () => ({ cols: 48, rows: 20 }),
      setFontSize: () => {},
      open: () => {
        opened = true;
      },
      isOpen: () => opened,
      model: () => readModel(real.buffer.active, real.cols, real.rows - TMUX_STATUS_ROWS),
      statusRow: () => readModel(real.buffer.active, real.cols, real.rows).at(-1) ?? [],
      onParsed: () => () => {},
      focus: () => {},
      dispose: () => {},
    };
  };
  return {
    makeTerm,
    parsed: () => parsed,
    type: (d: string) => dataCb?.(d),
    dispose: () => real.dispose(),
  };
};

describe('the drawer guards its ^C against the live model', () => {
  const mount = () => {
    const t = realBufferTerm();
    const utils = render(
      <TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} makeTerm={t.makeTerm} />,
    );
    const ws = FakeSocket.instances.at(-1);
    if (!ws) throw new Error('drawer opened no socket');
    act(() => ws.onopen?.());
    const paint = async (bytes: string): Promise<void> => {
      act(() => ws.onmessage?.({ data: bytes }));
      await t.parsed();
    };
    return { t, ws, paint, ...utils };
  };

  it('the model holds the notice where the guard looks', async () => {
    const { t, paint } = mount();
    await paint(exitScreen.stream);
    expect(exitNoticeShowing(realModelRows(t))).toBe(true);
    t.dispose();
  });

  it('a notice that arrives after the drawer opened holds the next ^C', async () => {
    const { t, ws, paint } = mount();
    await paint(hintStream());
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    expect(ws.sent.map((f) => JSON.parse(f))).toEqual([{ type: 'input', data: KEY_SEQ.ctrlC }]);

    await paint(exitScreen.stream);
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    expect(ws.sent).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Confirm Control C' })).toHaveTextContent('Claude Code will exit');

    fireEvent.click(screen.getByRole('button', { name: 'Send Control C' }));
    expect(ws.sent).toHaveLength(2);
    expect(ws.lastFrame()).toEqual({ type: 'input', data: KEY_SEQ.ctrlC });
    t.dispose();
  });

  it('Cancel sends nothing', async () => {
    const { t, ws, paint } = mount();
    await paint(exitScreen.stream);
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ws.sent).toHaveLength(0);
    expect(confirmGroup()).toBeNull();
    t.dispose();
  });

  it('a physical Ctrl-C typed into the terminal is not asked about', async () => {
    const { t, ws, paint } = mount();
    await paint(exitScreen.stream);
    t.type(KEY_SEQ.ctrlC);
    expect(ws.sent.map((f) => JSON.parse(f))).toEqual([{ type: 'input', data: KEY_SEQ.ctrlC }]);
    expect(confirmGroup()).toBeNull();
    t.dispose();
  });

  it('a confirm left open does not survive the drawer closing', async () => {
    const { t, ws, paint, rerender } = mount();
    await paint(exitScreen.stream);
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    expect(confirmGroup()).not.toBeNull();
    rerender(<TerminalDrawer id={ID} open={false} onClose={() => {}} makeSocket={makeSocket} makeTerm={t.makeTerm} />);
    rerender(<TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} makeTerm={t.makeTerm} />);
    expect(confirmGroup()).toBeNull();
    expect(ws.sent).toHaveLength(0);
    t.dispose();
  });
});

/** The rows the drawer's guard reads, from a terminal built like its own. */
function realModelRows(t: ReturnType<typeof realBufferTerm>): string[] {
  return t.makeTerm().model().map(rowText);
}

/** The exit-notice screen as it was before the first Ctrl-C: the ordinary
 *  hint in the footer where the notice will be. */
function hintStream(): string {
  const stream = exitScreen!.stream.replace('Press Ctrl-C again to exit', '? for shortcuts');
  if (stream === exitScreen!.stream) throw new Error('the exit-notice stream no longer spells its notice');
  return stream;
}

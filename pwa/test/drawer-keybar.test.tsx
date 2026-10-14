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
//     component is `KeyBarView.tsx` beside the pure `keyBar.ts`.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TerminalDrawer, type DrawerTerm } from '../src/session/TerminalDrawer';
import { atBlock, declValue, ruleIn } from './cssRule';
import {
  GRID_KEYS,
  KEY_CAP,
  KEY_SEQ,
  OVERFLOW_KEYS,
  PRIMARY_KEYS,
  ctrlCode,
  type KeyName,
} from '../src/session/keyBar';
import { KeyBar, useCtrlLatch } from '../src/session/KeyBarView';

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

function Wrapped({ send, action }: { send: (d: string) => void; action?: ReactNode }): ReactNode {
  const latch = useCtrlLatch(send);
  return (
    <>
      <KeyBar view="wrapped" send={send} latch={latch} action={action} />
      <button type="button" onClick={() => latch.take('c')}>
        stand-in letter c
      </button>
      <button type="button" onClick={() => latch.take('1')}>
        stand-in digit 1
      </button>
    </>
  );
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
    render(<KeyBar view="grid" send={send} action={door} />);
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
    render(<KeyBar view="grid" send={send} action={door} />);
    fireEvent.click(screen.getByRole('button', { name: 'Control C' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith('\x03');
  });

  it.each(GRID_KEYS)('%s sends its sequence', (k) => {
    const send = vi.fn<(d: string) => void>();
    render(<KeyBar view="grid" send={send} action={door} />);
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
    const { rerender } = render(<KeyBar view="grid" send={send} action={door} />);
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

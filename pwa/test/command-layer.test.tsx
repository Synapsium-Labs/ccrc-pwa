// The command layer (D-5103): the ⌘K palette, the single keys and chords, and
// the two ways Escape could reach through the palette to the session header.
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Sheet } from '@ccrc/ui';
import { AUTH_VERDICTS } from '../../shared/api';
import { CommandLayer } from '../src/command/CommandLayer';
import { CHORD_MS } from '../src/command/useShortcuts';
import { clearAuthLost, raiseAuthLost } from '../src/lib/auth';
import { useLocation } from '../src/lib/router';
import { setSkin } from '../src/lib/skin';
import { Composer } from '../src/session/Composer';
import { SessionHeader, type SessionHeaderProps } from '../src/session/SessionHeader';
import { useFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';

// (pointer: fine), as header.test.tsx stubs it: the header binds the physical
// Escape key only where a fine pointer says a keyboard is likely.
const stubPointer = (fine: boolean): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('pointer: fine') ? fine : false,
    media: q, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null,
    dispatchEvent: () => false,
  }));
};

const A = fleetSession({ id: 'project-a-one', project: 'project-a', name: 'first', bucket: 'attention', statusUpdatedAt: 3 });
const B = fleetSession({ id: 'project-a-two', project: 'project-a', name: 'second', bucket: 'idle', statusUpdatedAt: 2 });

const headerProps = (over: Partial<SessionHeaderProps> = {}): SessionHeaderProps => ({
  session: A,
  status: 'busy',
  statusUpdatedAt: null,
  onInterrupt: vi.fn(),
  onOpenTerminal: vi.fn(),
  onBack: vi.fn(),
  onChangeModel: vi.fn(),
  onChangeEffort: vi.fn(),
  onMoveAccount: vi.fn(),
  onArchive: vi.fn(),
  onRestore: vi.fn(),
  onOpenHistory: vi.fn(),
  onReapWorkspace: vi.fn(),
  roster: TEST_ROSTER,
  ...over,
});

const palette = (): HTMLElement | null => screen.queryByRole('combobox');
const openPalette = (): HTMLElement => {
  fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
  return screen.getByRole('combobox');
};
const shortcutsSheet = (): HTMLElement | null => screen.queryByRole('dialog', { name: 'Keyboard shortcuts' });

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  useFleetStore.setState({ sessions: [A, B], runs: [], blocked: false });
});

afterEach(() => {
  cleanup();
  clearAuthLost();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setSkin('refined');
  try { localStorage.clear(); } catch { /* jsdom always has it */ }
});

describe('opening the palette', () => {
  it('⌘K opens; Ctrl+K opens', () => {
    render(<CommandLayer />);
    expect(palette()).toBeNull();
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    expect(palette(), '⌘K').not.toBeNull();
    fireEvent.keyDown(palette()!, { key: 'Escape' });
    expect(palette()).toBeNull();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(palette(), 'Ctrl+K').not.toBeNull();
  });

  it('⌘K opens from inside a text field too', () => {
    render(<><Composer onSend={vi.fn()} pending={[]} /><CommandLayer /></>);
    const box = screen.getByRole('textbox');
    act(() => box.focus());
    fireEvent.keyDown(box, { key: 'k', metaKey: true });
    expect(palette()).not.toBeNull();
  });

  it("typing 'runs' then Enter navigates to /runs and closes", () => {
    render(<CommandLayer />);
    const input = openPalette();
    expect(document.activeElement, 'the input takes focus').toBe(input);
    fireEvent.change(input, { target: { value: 'runs' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(window.location.pathname).toBe('/runs');
    expect(palette()).toBeNull();
  });

  it('an option runs on click, without taking focus first', () => {
    render(<CommandLayer />);
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'go to accounts' } });
    const option = screen.getByRole('option', { name: /Go to Accounts/ });
    const down = fireEvent.mouseDown(option);
    expect(down, 'mousedown is prevented, so focus stays in the input').toBe(false);
    fireEvent.click(option);
    expect(window.location.pathname).toBe('/accounts');
  });

  it('says so when nothing matches', () => {
    render(<CommandLayer />);
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'zzzzqq' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/No command matches/)).toBeTruthy();
  });
});

describe('Escape in the palette never reaches the session header', () => {
  it('Escape inside the palette closes it and does not interrupt a busy session', () => {
    stubPointer(true);
    const p = headerProps();
    render(<><SessionHeader {...p} /><CommandLayer /></>);
    const input = openPalette();
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(palette(), 'the palette closed').toBeNull();
    expect(p.onInterrupt).not.toHaveBeenCalled();
  });

  it('Escape with focus on an option does not interrupt', () => {
    stubPointer(true);
    const p = headerProps();
    render(<><SessionHeader {...p} /><CommandLayer /></>);
    openPalette();
    // D-5456: the header's own guard (D-5235) already skips an Escape Radix
    // prevented, so the interrupt alone cannot see the palette's stop. A plain
    // window listener, as any app key handler is, can.
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    try {
      const option = screen.getAllByRole('option')[0]!;
      act(() => option.focus());
      expect(document.activeElement, 'an option is focusable at tabIndex -1').toBe(option);
      fireEvent.keyDown(option, { key: 'Escape', code: 'Escape', keyCode: 27 });
    } finally {
      window.removeEventListener('keydown', reached);
    }
    expect(palette(), 'the palette closed').toBeNull();
    expect(p.onInterrupt).not.toHaveBeenCalled();
    expect(reached, 'the Escape went on past the palette to the window').not.toHaveBeenCalled();
  });

  it('the control: with the palette shut, Escape still interrupts the busy session', () => {
    stubPointer(true);
    const p = headerProps();
    render(<><SessionHeader {...p} /><CommandLayer /></>);
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(p.onInterrupt).toHaveBeenCalledTimes(1);
  });
});

describe('focus stays in the input', () => {
  it('the options are not in the tab order, and ↓ moves aria-activedescendant while focus stays in the input', () => {
    render(<CommandLayer />);
    const input = openPalette();
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(2);
    for (const o of options) {
      expect(o.tagName, 'an option is not a button').not.toBe('BUTTON');
      expect(o.tabIndex, 'an option is out of the tab order').toBe(-1);
      expect(o.querySelector('button, a[href], input, [tabindex="0"]'), 'nothing tabbable inside').toBeNull();
    }
    expect(input.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]!.id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1]!.id);
    expect(options[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant'), '↑ from the top wraps to the end')
      .toBe(options[options.length - 1]!.id);
    expect(document.activeElement).toBe(input);
  });
});

describe('the single keys', () => {
  it("'?' with shiftKey opens the shortcuts sheet", () => {
    render(<CommandLayer />);
    fireEvent.keyDown(document.body, { key: '?', shiftKey: true });
    expect(shortcutsSheet()).not.toBeNull();
    expect(screen.getByText('Next session')).toBeTruthy();
  });

  it('a single key with Ctrl, Alt or Meta held fires nothing', () => {
    render(<CommandLayer />);
    for (const mod of ['ctrlKey', 'altKey', 'metaKey'] as const) {
      fireEvent.keyDown(document.body, { key: '?', shiftKey: true, [mod]: true });
      expect(shortcutsSheet(), `? with ${mod}`).toBeNull();
      fireEvent.keyDown(document.body, { key: ']', [mod]: true });
      expect(window.location.pathname, `] with ${mod}`).toBe('/');
      fireEvent.keyDown(document.body, { key: 'g', [mod]: true });
      fireEvent.keyDown(document.body, { key: 'r' });
      expect(window.location.pathname, `g with ${mod}, then r`).toBe('/');
    }
  });

  it('`]` typed in the composer\'s textarea stays text; on the page body it moves to the next session', () => {
    render(<><Composer onSend={vi.fn()} pending={[]} /><CommandLayer /></>);
    const box = screen.getByRole('textbox');
    act(() => box.focus());
    // A composer holding text keeps every key (D-5457): only an EMPTY one
    // passes `[`, `]` and `?` to the page, and that is the next describe's.
    fireEvent.change(box, { target: { value: 'see' } });
    const typed = fireEvent.keyDown(box, { key: ']' });
    expect(typed, 'the key is not prevented, so the text field takes it').toBe(true);
    expect(window.location.pathname).toBe('/');
    fireEvent.keyDown(document.body, { key: ']' });
    expect(window.location.pathname, 'from no session, ] opens the first').toBe(`/s/${A.id}`);
    fireEvent.keyDown(document.body, { key: ']' });
    expect(window.location.pathname).toBe(`/s/${B.id}`);
    fireEvent.keyDown(document.body, { key: '[' });
    expect(window.location.pathname).toBe(`/s/${A.id}`);
  });

  it('the g chords go to a screen, and match on the key, not the physical code', () => {
    render(<CommandLayer />);
    fireEvent.keyDown(document.body, { key: 'g', code: 'KeyX' });
    fireEvent.keyDown(document.body, { key: 'i', code: 'KeyY' });
    expect(window.location.pathname).toBe('/mail');
    fireEvent.keyDown(document.body, { key: 'r', code: 'KeyG' });
    expect(window.location.pathname, 'r alone is not a chord').toBe('/mail');
  });

  it('no shortcut fires while auth is lost', () => {
    render(<CommandLayer />);
    act(() => raiseAuthLost(AUTH_VERDICTS[0]!));
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    expect(palette(), '⌘K').toBeNull();
    fireEvent.keyDown(document.body, { key: ']' });
    expect(window.location.pathname, ']').toBe('/');
    fireEvent.keyDown(document.body, { key: '?', shiftKey: true });
    expect(shortcutsSheet(), '?').toBeNull();
  });

  it('no shortcut fires while the build is blocked', () => {
    render(<CommandLayer />);
    act(() => useFleetStore.setState({ blocked: true }));
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(palette()).toBeNull();
    fireEvent.keyDown(document.body, { key: ']' });
    expect(window.location.pathname).toBe('/');
  });
});

describe('the base commands, through the palette', () => {
  it('Switch layout → Instrument stamps data-skin instrument', () => {
    render(<CommandLayer />);
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'switch layout' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const page = screen.getByRole('combobox');
    expect(page.getAttribute('value') ?? (page as HTMLInputElement).value, 'a page starts empty').toBe('');
    expect(screen.getByRole('option', { name: /Instrument \(preview\)/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Match this device/ })).toBeTruthy();
    fireEvent.change(page, { target: { value: 'instrument' } });
    fireEvent.keyDown(page, { key: 'Enter' });
    expect(document.documentElement.getAttribute('data-skin')).toBe('instrument');
    expect(palette()).toBeNull();
  });

  it('Backspace on an empty page goes back to the commands', () => {
    render(<CommandLayer />);
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'switch theme' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('option', { name: /Dracula/ })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Backspace' });
    expect(screen.getByRole('option', { name: /Go to Fleet/ })).toBeTruthy();
  });

  it('Open session… lists the fleet in its own order and opens one', () => {
    render(<CommandLayer />);
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'open session' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('first'), expect.stringContaining('second'),
    ]);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'second' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(window.location.pathname).toBe(`/s/${B.id}`);
  });
});

// THE DESKTOP SESSION SCREEN (D-5457). On a fine pointer the composer takes
// focus every time the session changes, so after one `]` the next key lands in
// a textarea. A browser fires each key at `document.activeElement`; so does
// `press`. The route below keys the composer on the session, as SessionScreen
// does, so each arrival re-fires its autofocus.
function SessionRoute(): ReactNode {
  const { path } = useLocation();
  const m = /^\/s\/([^/]+)$/.exec(path);
  return m === null ? null : <Composer key={m[1]} id={decodeURIComponent(m[1]!)} onSend={vi.fn()} pending={[]} />;
}
/** The composer's autofocus is deferred a tick (`setTimeout(…, 0)`). */
const settle = (): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const press = (init: Parameters<typeof fireEvent.keyDown>[1]): boolean =>
  fireEvent.keyDown(document.activeElement ?? document.body, init);

describe('the keys on a desktop session screen', () => {
  it('`]` and `[` walk the fleet from the autofocused, empty composer', async () => {
    stubPointer(true);
    render(<><SessionRoute /><CommandLayer /></>);
    press({ key: ']' });
    expect(window.location.pathname).toBe(`/s/${A.id}`);
    await settle();
    expect(document.activeElement?.tagName, 'the composer took focus, as it does on a desk').toBe('TEXTAREA');
    expect(press({ key: ']' }), 'the step is prevented, so no `]` lands in the box').toBe(false);
    expect(window.location.pathname, 'the second `]` from inside the composer').toBe(`/s/${B.id}`);
    await settle();
    press({ key: ']' });
    expect(window.location.pathname, 'the third wraps to the first').toBe(`/s/${A.id}`);
    await settle();
    press({ key: '[' });
    expect(window.location.pathname).toBe(`/s/${B.id}`);
  });

  it('`?` opens the shortcuts from the empty composer', async () => {
    stubPointer(true);
    window.history.replaceState(null, '', `/s/${A.id}`);
    render(<><SessionRoute /><CommandLayer /></>);
    await settle();
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    press({ key: '?', shiftKey: true });
    expect(shortcutsSheet()).not.toBeNull();
  });

  it('the g chords stay text in the composer, empty or not: "gr" starts a word', async () => {
    stubPointer(true);
    window.history.replaceState(null, '', `/s/${A.id}`);
    render(<><SessionRoute /><CommandLayer /></>);
    await settle();
    expect(press({ key: 'g' })).toBe(true);
    expect(press({ key: 'r' })).toBe(true);
    expect(window.location.pathname).toBe(`/s/${A.id}`);
  });

  it('an input that is not the composer keeps `]` even when empty', () => {
    render(<><input aria-label="Search" /><CommandLayer /></>);
    const box = screen.getByRole('textbox', { name: 'Search' });
    act(() => box.focus());
    expect(press({ key: ']' })).toBe(true);
    expect(window.location.pathname).toBe('/');
  });

  it('a composer arriving behind a CLOSING dialog still takes focus', async () => {
    // A palette that ran a command stays mounted while it animates out,
    // `role="dialog"` at `data-state="closed"`. Only an OPEN one holds focus.
    stubPointer(true);
    render(<><div role="dialog" data-state="closed" /><Composer id="x" onSend={vi.fn()} pending={[]} /></>);
    await settle();
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
  });
});

describe('the guards on a single key', () => {
  it('`]` and `?` do nothing while a sheet is open', () => {
    render(<><Sheet open onClose={() => {}} title="Busy"><p>held</p></Sheet><CommandLayer /></>);
    fireEvent.keyDown(document.body, { key: ']' });
    expect(window.location.pathname).toBe('/');
    fireEvent.keyDown(document.body, { key: '?', shiftKey: true });
    expect(shortcutsSheet()).toBeNull();
  });

  it('a `]` some surface already prevented does nothing', () => {
    render(<CommandLayer />);
    const claim = (e: Event): void => e.preventDefault();
    document.addEventListener('keydown', claim);
    try {
      fireEvent.keyDown(document.body, { key: ']' });
    } finally {
      document.removeEventListener('keydown', claim);
    }
    expect(window.location.pathname).toBe('/');
  });

  it('`]` in a SELECT stays put', () => {
    render(<><select aria-label="Pick"><option>a</option></select><CommandLayer /></>);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Pick' }), { key: ']' });
    expect(window.location.pathname).toBe('/');
  });

  it('`]` in a contenteditable stays put', () => {
    render(<><div data-testid="ed" contentEditable suppressContentEditableWarning>x</div><CommandLayer /></>);
    const ed = screen.getByTestId('ed');
    // jsdom does not implement isContentEditable; a browser reports true here.
    Object.defineProperty(ed, 'isContentEditable', { value: true });
    fireEvent.keyDown(ed, { key: ']' });
    expect(window.location.pathname).toBe('/');
  });

  it('a held `]` (auto-repeat) steps once', () => {
    render(<CommandLayer />);
    fireEvent.keyDown(document.body, { key: ']' });
    fireEvent.keyDown(document.body, { key: ']', repeat: true });
    expect(window.location.pathname).toBe(`/s/${A.id}`);
  });

  it('`g`, then a wait past the chord window, then `r` does not navigate', () => {
    render(<CommandLayer />);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(10_000);
    fireEvent.keyDown(document.body, { key: 'g' });
    now.mockReturnValue(10_000 + CHORD_MS + 1);
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(window.location.pathname).toBe('/');
    // The control: inside the window it is a chord.
    now.mockReturnValue(20_000);
    fireEvent.keyDown(document.body, { key: 'g' });
    now.mockReturnValue(20_000 + CHORD_MS);
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(window.location.pathname).toBe('/runs');
  });
});

describe('the palette as drawn', () => {
  it('the active option wears the tint and the rail; the others wear neither', () => {
    render(<CommandLayer />);
    openPalette();
    const [first, second] = screen.getAllByRole('option');
    for (const c of ['bg-phosphor-tint', 'shadow-[inset_2px_0_0_var(--accent)]']) {
      expect(first!.className.split(/\s+/), `the active option: ${c}`).toContain(c);
      expect(second!.className.split(/\s+/), `an idle option: ${c}`).not.toContain(c);
    }
  });

  it("its motion retimes vaul's keyframes with the tokens, content and overlay alike", () => {
    render(<CommandLayer />);
    const dialog = openPalette().closest('[role="dialog"]')!;
    const overlay = document.querySelector('[data-vaul-overlay]')!;
    for (const [name, el] of [['content', dialog], ['overlay', overlay]] as const) {
      const cls = el.className.split(/\s+/);
      expect(cls, `${name} open`).toContain('data-[state=open]:[animation-duration:var(--dur-base)]!');
      expect(cls, `${name} closed`).toContain('data-[state=closed]:[animation-duration:var(--dur-fast)]!');
      expect(cls, `${name} curve`).toContain('data-[state=open]:[animation-timing-function:var(--curve-swift)]!');
    }
  });
});

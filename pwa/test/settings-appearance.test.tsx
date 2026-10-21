// Settings › Appearance's Theme preview grid (settings Task R2e; spec §5.2; D-5503).
//
// Thirteen cards in ONE radio group: Follow the system first, then the eight dark and four light palettes, each card
// stamped with its own `data-theme` so it is drawn in the palette it names. Arrow keys move the choice and write it
// once; the checked card is the stored theme, read back after a reload, never a copy of the last tap.
// `theme-picker.test.tsx` holds the store's own cases (storage, the palette's "Switch theme…", throwing storage).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PHOSPHOR, SYSTEM, THEMES } from '@ccrc/ui';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { initTheme } from '../src/lib/theme';
import { declValue, ruleIn, selectorsOf } from './cssRule';
import { AppearanceSection } from '../src/screens/settings/AppearanceSection';

const KEY = 'ccrc-theme';
const ROOT = path.join(import.meta.dirname, '..', '..');
const media = (matches: boolean) => ({ matches, addEventListener: () => {} });

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); initTheme(media(false)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

// The Theme fieldset (the Switch theme door) holds the cards' one radiogroup.
const theme = (): HTMLElement => screen.getByRole('group', { name: 'Theme' });
const grid = (): HTMLElement => within(theme()).getByRole('radiogroup', { name: 'Theme palettes' });
const radios = (): HTMLInputElement[] => within(grid()).getAllByRole('radio') as HTMLInputElement[];
const card = (r: HTMLInputElement): HTMLElement => r.closest('.settings-palette') as HTMLElement;
const checked = (): HTMLInputElement[] => radios().filter((r) => r.checked);

describe('the Theme preview grid', () => {
  it('13 cards, Follow the system first', () => {
    render(<AppearanceSection />);
    const all = radios();
    expect(all).toHaveLength(13);
    expect(all).toHaveLength(THEMES.length + 1);
    expect(all.map((r) => r.value)).toEqual([SYSTEM, ...THEMES.map((t) => t.id)]);
    expect(all[0]).toHaveAccessibleName(/^Follow system/);
    expect(document.querySelectorAll('.settings-palette')).toHaveLength(13);
  });

  it('each palette card carries its own data-theme, Phosphor & Ink included', () => {
    // The card IS the palette: tokens.css's blocks are attribute selectors, so they resolve on the card. Phosphor &
    // Ink answers to [data-theme='phosphor'] too, so its card is dark on a light page; Follow the system is not a
    // palette and stamps none.
    render(<AppearanceSection />);
    for (const r of radios()) {
      const c = card(r);
      if (r.value === SYSTEM) expect(c.hasAttribute('data-theme'), r.value).toBe(false);
      else expect(c.getAttribute('data-theme'), r.value).toBe(r.value);
    }
  });

  it('tokens.css draws Phosphor & Ink by name: its colours, and only its colours, answer to the attribute', () => {
    // On a light device Follow the system stamps data-theme='light' on the root; without the alias the Phosphor card
    // drew in Daylight, a copy of the card beside it. Type, density and motion stay :root-only, or the card would reset
    // Instrument's :root[data-skin] values inside it.
    const tokens = readFileSync(path.join(ROOT, 'ui/src/styles/tokens.css'), 'utf8');
    const named = ruleIn(tokens, "[data-theme='phosphor']");
    expect(selectorsOf(tokens, "[data-theme='phosphor']")).toContain(':root');
    expect(declValue(named, '--bg-surface')).toBe(declValue(ruleIn(tokens, ':root'), '--bg-surface'));
    for (const t of ['--bg-page', '--ink-primary', '--accent', '--status-attention', '--status-dead']) {
      expect(declValue(named, t), t).not.toBeNull();
    }
    for (const m of named.matchAll(/(--[\w-]+)\s*:/g)) {
      expect(m[1], 'a non-colour token in the aliased block').not.toMatch(/^--(fs|family|weight|lh|ls|sp|r|dur|curve|z|row|head|gutter|pad|gap|page|measure|tap|case)-?/);
    }
  });

  it('one tab stop: only the checked card\'s input is in the tab order', () => {
    localStorage.setItem(KEY, 'nord');
    initTheme(media(false));
    render(<AppearanceSection />);
    const stops = radios().filter((r) => r.tabIndex === 0);
    expect(stops.map((r) => r.value)).toEqual(['nord']);
    expect(stops[0]!.checked).toBe(true);
  });

  it('every radio is described by its note, at every width (the visible note hides on a phone)', () => {
    render(<AppearanceSection />);
    for (const r of radios()) {
      const note = r.value === SYSTEM ? /after dark/i : THEMES.find((t) => t.id === r.value)!.note;
      expect(r, r.value).toHaveAccessibleDescription(note);
    }
  });

  it('each card names its palette and carries today\'s note in its title', () => {
    render(<AppearanceSection />);
    for (const t of THEMES) {
      const r = radios().find((x) => x.value === t.id)!;
      expect(card(r).getAttribute('title')).toBe(t.note);
      expect(within(card(r)).getByText(t.label)).toBeInTheDocument();
    }
  });

  it('arrow keys move the choice and write it once', () => {
    // A counting store, stubbed in whole: which Storage `localStorage` is depends on the Node version (jsdom's, whose
    // methods an instance spy does not reliably intercept, or setup.ts's in-memory shim), so a spy is not portable.
    const items = new Map<string, string>();
    const set = vi.fn((k: string, v: string) => { items.set(k, String(v)); });
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => items.get(k) ?? null, setItem: set, removeItem: (k: string) => { items.delete(k); },
      clear: () => items.clear(), key: () => null, get length() { return items.size; },
    });
    render(<AppearanceSection />);
    // `false` is a cancelled event: the browser's own radio arrowing must not move the choice a second time.
    expect(fireEvent.keyDown(radios()[0]!, { key: 'ArrowRight' })).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBeNull(); // Phosphor & Ink is :root
    expect(set.mock.calls.filter(([k]) => k === KEY)).toEqual([[KEY, PHOSPHOR]]);
    expect(checked().map((r) => r.value)).toEqual([PHOSPHOR]);
    expect(document.activeElement).toBe(radios()[1]);

    fireEvent.keyDown(radios()[1]!, { key: 'ArrowDown' });
    expect(checked().map((r) => r.value)).toEqual(['light']);
    fireEvent.keyDown(radios()[2]!, { key: 'ArrowLeft' });
    fireEvent.keyDown(radios()[1]!, { key: 'ArrowUp' });
    expect(checked().map((r) => r.value)).toEqual([SYSTEM]);
    // and it wraps, both ways
    fireEvent.keyDown(radios()[0]!, { key: 'ArrowLeft' });
    expect(checked().map((r) => r.value)).toEqual([THEMES[THEMES.length - 1]!.id]);
    fireEvent.keyDown(radios()[12]!, { key: 'ArrowRight' });
    expect(checked().map((r) => r.value)).toEqual([SYSTEM]);
    expect(set.mock.calls.filter(([k]) => k === KEY)).toHaveLength(6);
    // Any other key is the browser's: Tab and Space are not taken.
    expect(fireEvent.keyDown(radios()[0]!, { key: 'Tab' })).toBe(true);
    expect(set.mock.calls.filter(([k]) => k === KEY)).toHaveLength(6);
  });

  it('the checked card is the stored theme after a reload', () => {
    const first = render(<AppearanceSection />);
    fireEvent.click(radios().find((r) => r.value === 'dracula')!);
    expect(localStorage.getItem(KEY)).toBe('dracula');
    first.unmount();
    // A reload: the boot reads storage, and the grid opens on it.
    localStorage.setItem(KEY, 'solarized-light');
    initTheme(media(false));
    render(<AppearanceSection />);
    expect(checked().map((r) => r.value)).toEqual(['solarized-light']);
    expect(card(checked()[0]!).getAttribute('data-active')).toBe('true');
  });

  it('the checked card wears a check glyph, and only it does', () => {
    localStorage.setItem(KEY, 'nord');
    initTheme(media(false));
    render(<AppearanceSection />);
    const marks = [...document.querySelectorAll('.settings-palette-check')];
    expect(marks).toHaveLength(1);
    expect(marks[0]!.closest('.settings-palette')?.getAttribute('data-theme')).toBe('nord');
  });

  it('under the grid, the checked card\'s note, and only its', () => {
    localStorage.setItem(KEY, 'gruvbox-dark');
    initTheme(media(false));
    render(<AppearanceSection />);
    const notes = [...document.querySelectorAll('.settings-palette-current')];
    expect(notes).toHaveLength(1);
    expect(notes[0]!.textContent).toBe(THEMES.find((t) => t.id === 'gruvbox-dark')!.note);
  });

  it('Layout renders above Theme', () => {
    render(<AppearanceSection />);
    const layout = screen.getByRole('group', { name: 'Layout' });
    expect(layout.compareDocumentPosition(grid()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(theme()).toHaveAttribute('data-command', 'switch-theme');
  });
});

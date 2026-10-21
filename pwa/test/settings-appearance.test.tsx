// Settings › Appearance's Theme preview grid (settings Task R2e; spec §5.2; D-5503).
//
// Thirteen cards in ONE radio group: Follow the system first, then the eight dark and four light palettes, each card
// stamped with its own `data-theme` so it is drawn in the palette it names. Arrow keys move the choice and write it
// once; the checked card is the stored theme, read back after a reload, never a copy of the last tap.
// `theme-picker.test.tsx` holds the store's own cases (storage, the palette's "Switch theme…", throwing storage).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PHOSPHOR, SYSTEM, THEMES } from '@ccrc/ui';
import { initTheme } from '../src/lib/theme';
import { AppearanceSection } from '../src/screens/settings/AppearanceSection';

const KEY = 'ccrc-theme';
const media = (matches: boolean) => ({ matches, addEventListener: () => {} });

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); initTheme(media(false)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const grid = (): HTMLElement => screen.getByRole('radiogroup', { name: 'Theme' });
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

  it('each palette card carries its own data-theme', () => {
    // The card IS the palette: tokens.css's blocks are attribute selectors, so they resolve on the card. Phosphor is
    // :root and answers to no attribute, so its card stamps none; Follow the system is not a palette and stamps none.
    render(<AppearanceSection />);
    for (const r of radios()) {
      const c = card(r);
      if (r.value === SYSTEM || r.value === PHOSPHOR) expect(c.hasAttribute('data-theme'), r.value).toBe(false);
      else expect(c.getAttribute('data-theme'), r.value).toBe(r.value);
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
    render(<AppearanceSection />);
    const set = vi.spyOn(localStorage, 'setItem');
    fireEvent.keyDown(radios()[0]!, { key: 'ArrowRight' });
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
  });
});

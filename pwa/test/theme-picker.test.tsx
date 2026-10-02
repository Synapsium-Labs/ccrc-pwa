// The theme picker's seam: storage -> document, and the control that drives it.
//
// `theme-catalogue.test.ts` covers @ccrc/ui's pure functions and the Storybook
// decorator. This covers the APP's half, which had none: the storage reads and
// writes, the fallbacks when storage throws, and the Settings control itself.
// A user-visible control with no red suite behind it is the shape of thing
// that quietly stops working.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PHOSPHOR, SYSTEM, THEMES } from '@ccrc/ui';
import { initTheme, rememberTheme, setTheme, storedTheme } from '../src/lib/theme';
import { AppearanceSection } from '../src/screens/SettingsScreen';

const KEY = 'ccrc-theme';
/** A media stub the theme module accepts in place of a MediaQueryList. */
const media = (matches: boolean) => ({ matches, addEventListener: () => {} });

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('the stored preference', () => {
  it('is SYSTEM when nothing has been chosen', () => {
    expect(storedTheme()).toBe(SYSTEM);
  });

  it('round-trips a pinned palette', () => {
    rememberTheme('nord');
    expect(storedTheme()).toBe('nord');
  });

  it('falls back to SYSTEM for a value this build cannot render', () => {
    // A palette from a NEWER build. Honouring it would stamp an attribute no
    // block answers — every token falling through to :root while the picker
    // claims the missing theme is active.
    localStorage.setItem(KEY, 'palette-from-the-future');
    expect(storedTheme()).toBe(SYSTEM);
  });

  it('survives storage that throws, rather than taking the app down', () => {
    // Private windows and some embedded WebViews throw on access, and this
    // runs before first paint — an exception here is a blank app.
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    });
    expect(storedTheme()).toBe(SYSTEM);
    expect(() => rememberTheme('nord')).not.toThrow();
  });
});

describe('applying a choice stamps the document', () => {
  it('pins a palette and remembers it', () => {
    setTheme('dracula', media(false));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dracula');
    expect(localStorage.getItem(KEY)).toBe('dracula');
  });

  it('Phosphor REMOVES the attribute rather than writing one', () => {
    setTheme('nord', media(false));
    setTheme(PHOSPHOR, media(false));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(KEY)).toBe(PHOSPHOR);
  });

  it('a pinned palette ignores the OS in both directions', () => {
    setTheme('nord', media(true));
    expect(document.documentElement.getAttribute('data-theme')).toBe('nord');
    setTheme('nord', media(false));
    expect(document.documentElement.getAttribute('data-theme')).toBe('nord');
  });

  it('boot honours a pinned palette over the system setting', () => {
    localStorage.setItem(KEY, 'gruvbox-dark');
    initTheme(media(true));          // a light desktop
    expect(document.documentElement.getAttribute('data-theme')).toBe('gruvbox-dark');
  });

  it('boot with no preference follows the system, as it always did', () => {
    initTheme(media(true));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    document.documentElement.removeAttribute('data-theme');
    initTheme(media(false));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('the Appearance control', () => {
  // THE REAL COMPONENT. An earlier draft of this block rebuilt the radio group
  // inline and asserted against its own reimplementation — which would have
  // stayed green through any change to the shipped one. `AppearanceSection` is
  // exported for exactly this reason; the rest of SettingsScreen mounts an
  // updates poll a radio-group test has no business needing.
  it('offers every palette the app can render, plus Follow system', () => {
    render(<AppearanceSection />);
    expect(screen.getAllByRole('radio')).toHaveLength(THEMES.length + 1);
    // Anchored: each row's accessible name is "<label> <note>", and the
    // Follow-system note names both Phosphor palettes — so an unanchored
    // match finds two radios and the ambiguity is the test's, not the UI's.
    expect(screen.getByRole('radio', { name: /^Follow system/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Phosphor & Ink/ })).toBeInTheDocument();
  });

  it('applies immediately on pick — there is no Save to forget', () => {
    render(<AppearanceSection />);
    fireEvent.click(screen.getByRole('radio', { name: /^Nord/ }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('nord');
    expect(localStorage.getItem(KEY)).toBe('nord');
  });

  it('opens showing what is actually applied, not a default', () => {
    localStorage.setItem(KEY, 'tokyo-night');
    render(<AppearanceSection />);
    expect((screen.getByRole('radio', { name: /^Tokyo Night/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('groups dark and light, so the first choice anyone makes is visible', () => {
    render(<AppearanceSection />);
    expect(screen.getByText('Dark')).toBeInTheDocument();
    expect(screen.getByText('Light')).toBeInTheDocument();
  });

  it('each row previews its OWN palette, by stamping data-theme on the swatch', () => {
    // The swatches are the palette, not a hand-copied approximation of it:
    // tokens.css's blocks are plain attribute selectors, so they resolve on any
    // element. A row therefore cannot lie about its colours. Phosphor is the
    // one row that stamps nothing — it is :root.
    render(<AppearanceSection />);
    const swatches = [...document.querySelectorAll('.settings-theme-swatch')];
    expect(swatches.length).toBe(THEMES.length);
    expect(swatches.filter((s) => s.getAttribute('data-theme') === 'nord')).toHaveLength(1);
    expect(swatches.filter((s) => !s.hasAttribute('data-theme'))).toHaveLength(1);
  });
});

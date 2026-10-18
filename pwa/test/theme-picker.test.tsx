// The theme picker's seam: storage -> document, and the control that drives it.
//
// `theme-catalogue.test.ts` covers @ccrc/ui's pure functions and the Storybook
// decorator. This covers the APP's half, which had none: the storage reads and
// writes, the fallbacks when storage throws, and the Settings control itself.
// A user-visible control with no red suite behind it is the shape of thing
// that quietly stops working.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PHOSPHOR, SYSTEM, THEMES } from '@ccrc/ui';
import { initTheme, rememberTheme, setTheme, storedTheme } from '../src/lib/theme';
import { AppearanceSection } from '../src/screens/SettingsScreen';
import { baseCommands } from '../src/command/commands';
import type { CommandContext, CommandPage } from '../src/command/registry';

const KEY = 'ccrc-theme';
/** A media stub the theme module accepts in place of a MediaQueryList. */
const media = (matches: boolean) => ({ matches, addEventListener: () => {} });

// Boot as main.tsx does: `initTheme()` reads the stored choice the picker opens on (D-5572).
beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); initTheme(media(false)); });
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
    // Scoped to the Theme group: Appearance also holds the Layout picker
    // (skin-picker.test.tsx), whose radios are not palettes.
    expect(within(screen.getByRole('group', { name: 'Theme' })).getAllByRole('radio')).toHaveLength(THEMES.length + 1);
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
    initTheme(media(false));
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

  it('each swatch sits beside its own name, not at the far edge of the row', () => {
    // As the row's last item behind a `flex: 1` body, the swatch rendered at
    // the section's right edge — measured ~1400px from its name at a 1920px
    // window. It is the name's preview, so it shares the name's line: the
    // name's NEXT SIBLING, inside the one head, at every width.
    render(<AppearanceSection />);
    const swatches = [...document.querySelectorAll('.settings-theme-swatch')];
    expect(swatches.length).toBe(THEMES.length);
    for (const sw of swatches) {
      const name = sw.previousElementSibling;
      expect(name?.classList.contains('settings-theme-name')).toBe(true);
      expect(sw.parentElement?.classList.contains('settings-theme-head')).toBe(true);
      // and the head is inside the body the row's flex gives the width to
      expect(sw.parentElement?.parentElement?.classList.contains('settings-theme-body')).toBe(true);
    }
  });
});

// D-5572: the palette's "Switch theme…" (command/commands.ts) calls setTheme
// from outside Settings, as the palette's "Switch layout" calls setSkin
// (D-5096). The Theme radios follow the choice in force, not a copy taken at
// mount, so the checked row is never stale and can be picked straight back.
describe('the Theme picker follows a choice made anywhere', () => {
  const radio = (name: RegExp): HTMLInputElement =>
    within(screen.getByRole('group', { name: 'Theme' })).getByRole('radio', { name }) as HTMLInputElement;

  /** Run "Switch theme…" → <title> as the palette does, through the real registry. */
  const viaPalette = (title: string): void => {
    const ctx = { setTheme: (c: string) => setTheme(c, media(false)) } as unknown as CommandContext;
    const page = baseCommands().find((c) => c.id === 'switch-theme')!.run(ctx) as CommandPage;
    const cmd = page.commands.find((c) => c.title === title)!;
    act(() => { cmd.run(ctx); });
  };

  it('a palette switch moves the checked row', () => {
    render(<AppearanceSection />);
    expect(radio(/^Follow system/).checked).toBe(true);
    viaPalette('Nord');
    expect(document.documentElement.getAttribute('data-theme')).toBe('nord');
    expect(radio(/^Nord/).checked).toBe(true);
    expect(radio(/^Follow system/).checked).toBe(false);
  });

  it('and the reverse: a row picked here, then switched away in the palette, picks straight back', () => {
    render(<AppearanceSection />);
    fireEvent.click(radio(/^Nord/));
    expect(radio(/^Nord/).checked).toBe(true);
    viaPalette('Follow system');
    expect(radio(/^Follow system/).checked).toBe(true);
    expect(radio(/^Nord/).checked).toBe(false);
    // The once-stale row is a live choice again: clicking it applies.
    fireEvent.click(radio(/^Nord/));
    expect(document.documentElement.getAttribute('data-theme')).toBe('nord');
    expect(localStorage.getItem(KEY)).toBe('nord');
    expect(radio(/^Nord/).checked).toBe(true);
  });

  it('a pick in one mounted picker moves every other', () => {
    const first = render(<AppearanceSection />);
    const second = render(<AppearanceSection />);
    const nord = (r: typeof first): HTMLInputElement =>
      within(within(r.container).getByRole('group', { name: 'Theme' })).getByRole('radio', { name: /^Nord/ }) as HTMLInputElement;
    fireEvent.click(nord(first));
    expect(nord(second).checked).toBe(true);
  });

  it('with storage that throws, a palette switch still moves the row for the session', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    });
    initTheme(media(false));
    render(<AppearanceSection />);
    expect(() => viaPalette('Dracula')).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dracula');
    expect(radio(/^Dracula/).checked).toBe(true);
  });
});

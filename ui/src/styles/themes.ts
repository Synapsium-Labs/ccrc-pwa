// The selectable palettes, and the ONLY thing about them that is typed by hand.
//
// A theme's colours live in tokens.css as a `[data-theme='<id>']` block, and
// every gate DISCOVERS those blocks rather than reading a list — a list of
// things-to-audit is the same drift class as a list of colours, and a palette
// nobody listed would be a palette nobody measured.
//
// A human-readable LABEL cannot be derived from a CSS selector, so exactly one
// enumeration is unavoidable. This is it. It is bound to reality rather than
// trusted: `pwa/test/theme-catalogue.test.ts` asserts these ids are EXACTLY the
// `[data-theme='…']` blocks the auditor finds in tokens.css, in both
// directions. A palette added without an entry here reds; an entry here
// without a palette reds.
//
// PHOSPHOR & INK IS `:root`, SO SELECTING IT REMOVES THE ATTRIBUTE. It has no
// block of its own — giving the default one would make it an override of
// itself and double every measurement to describe the palette the gate already
// started from. Its id is still a plain string (`'phosphor'`): the NAME of a
// choice and the DOM effect of applying it are two different facts, and
// collapsing them into a nullable id would put two meanings on one `null` at
// the seam between the picker and the document.
//
// 'system' is likewise a real, named choice — follow `prefers-color-scheme`
// between the two Phosphor palettes — and is the DEFAULT, which is what the
// app did before any of this was selectable.

/** Always a string. `PHOSPHOR` is applied by REMOVING `data-theme`. */
export interface ThemeChoice {
  readonly id: string;
  readonly label: string;
  /** Which way the palette reads, for grouping in a picker. */
  readonly mode: 'dark' | 'light';
  /** One line on what it is, shown under the name. */
  readonly note: string;
}

/** The id whose palette is `:root` rather than a `[data-theme]` block. */
export const PHOSPHOR = 'phosphor';
/** Follow the operating system between the two Phosphor palettes. */
export const SYSTEM = 'system';

export const THEMES: readonly ThemeChoice[] = [
  { id: PHOSPHOR, label: 'Phosphor & Ink', mode: 'dark',
    note: 'The console’s own. Glow means life.' },
  { id: 'light', label: 'Phosphor Daylight', mode: 'light',
    note: 'The same system in daylight — wells stay dark.' },

  { id: 'nord', label: 'Nord', mode: 'dark',
    note: 'Arctic blue-greys, low saturation.' },
  { id: 'tokyo-night', label: 'Tokyo Night', mode: 'dark',
    note: 'Deep indigo with neon accents.' },
  { id: 'dracula', label: 'Dracula', mode: 'dark',
    note: 'High-contrast purple and pink.' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', mode: 'dark',
    note: 'Warm pastels on a soft dark ground.' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', mode: 'dark',
    note: 'Retro warm earth tones.' },
  { id: 'one-dark', label: 'One Dark', mode: 'dark',
    note: 'The Atom editor classic.' },
  { id: 'solarized-dark', label: 'Solarized Dark', mode: 'dark',
    note: 'Precision teal, engineered for long sessions.' },

  { id: 'github-light', label: 'GitHub Light', mode: 'light',
    note: 'Crisp neutral white, familiar everywhere.' },
  { id: 'solarized-light', label: 'Solarized Light', mode: 'light',
    note: 'Warm paper with the same precision hues.' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', mode: 'light',
    note: 'Soft pastels on warm white.' },
];

/** Where the choice is remembered. Read by the pre-paint snippet in index.html
 *  as well as by the app, so the key is exported rather than spelled twice. */
export const THEME_STORAGE_KEY = 'ccrc-theme';

/** What a stored preference means to THIS build.
 *
 *  Anything unknown — a palette from a newer build, a hand-edited value, a
 *  cleared store — resolves to SYSTEM. Leaving the document stamped with a
 *  theme whose block is not in this bundle would not fall back gracefully: the
 *  attribute matches no rule, so every token falls through to `:root` while
 *  the picker still claims the missing theme is active. Worse, it is invisible
 *  to the contrast gate, which can only measure blocks that exist. */
export function resolveTheme(stored: string | null | undefined): string {
  if (stored === SYSTEM) return SYSTEM;
  if (stored === null || stored === undefined || stored === '') return SYSTEM;
  return THEMES.some((t) => t.id === stored) ? stored : SYSTEM;
}

/** Stamp a RESOLVED choice onto the document.
 *
 *  `systemPrefersLight` is passed in rather than read here so the caller owns
 *  the media query — the app subscribes to it and re-stamps on change, and a
 *  test can state the answer instead of faking a MediaQueryList. */
export function applyTheme(
  choice: string, root: HTMLElement, systemPrefersLight: boolean,
): void {
  const id = choice === SYSTEM ? (systemPrefersLight ? 'light' : PHOSPHOR) : choice;
  if (id === PHOSPHOR) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', id);
}

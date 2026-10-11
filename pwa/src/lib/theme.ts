// Theme reachability — a palette defined in tokens.css must actually be
// APPLIED, not just defined.
//
// This file owns three things and nothing else: the stored preference, the
// system media query, and keeping the browser-chrome `theme-color` meta on the
// page's own background. WHICH palettes exist, what they are called, and what
// stamping one means are all @ccrc/ui's (`styles/themes.ts`) — this app picks
// among them, it does not enumerate them.
//
// The default is SYSTEM: follow `prefers-color-scheme` between the two
// Phosphor palettes, which is exactly what the app did before any of this was
// selectable. A pinned palette ignores the OS entirely — someone on a light
// desktop who chose Nord gets Nord after dark too.
import { THEME_STORAGE_KEY, SYSTEM, applyTheme, resolveTheme } from '@ccrc/ui';

/** The slice of MediaQueryList the theme needs — injectable for tests. */
export interface ThemeMedia {
  matches: boolean;
  addEventListener(type: 'change', cb: (e: { matches: boolean }) => void): void;
}

/** The stored choice, or SYSTEM when there is none or it is unreadable.
 *
 *  Storage throws in a private window and in some embedded WebViews, and this
 *  runs before first paint — an exception here is a blank app, so the read is
 *  guarded and a failure is simply "no preference". */
export function storedTheme(): string {
  try {
    return resolveTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return SYSTEM;
  }
}

/** Remember a choice. A failed write is not an error the user needs: the theme
 *  still applies for this session, it just will not survive a reload. */
export function rememberTheme(choice: string): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* private window, blocked storage — the session keeps the theme anyway */
  }
}

function chrome(root: HTMLElement): void {
  // Keep the browser/PWA chrome on the page's own background. Guarded: in
  // environments without the tokens stylesheet (unit tests) the var resolves
  // empty and the meta is left alone.
  const bg = getComputedStyle(root).getPropertyValue('--bg-page').trim();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (bg !== '' && meta !== null) meta.content = bg;
}

/** Apply a choice now, and remember it. Used by the picker. */
export function setTheme(
  choice: string,
  mq: ThemeMedia = window.matchMedia('(prefers-color-scheme: light)'),
): void {
  const root = document.documentElement;
  applyTheme(resolveTheme(choice), root, mq.matches);
  rememberTheme(choice);
  chrome(root);
}

/** Wire the theme at boot (main.tsx).
 *
 *  The media subscription stays live even when a palette is PINNED, and that
 *  is deliberate rather than wasteful: the listener re-reads the stored choice
 *  each time, so a user who switches back to "System" later gets the current
 *  OS answer without a reload, and a pinned palette simply ignores the event. */
export function initTheme(
  mq: ThemeMedia = window.matchMedia('(prefers-color-scheme: light)'),
): void {
  const root = document.documentElement;
  applyTheme(storedTheme(), root, mq.matches);
  chrome(root);
  mq.addEventListener('change', (e) => {
    applyTheme(storedTheme(), root, e.matches);
    chrome(root);
  });
}

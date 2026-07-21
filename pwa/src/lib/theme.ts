// Theme reachability — the "true light theme" in tokens.css must actually be
// applied, not just defined. Dark stays the identity default; the app follows
// the system setting: `prefers-color-scheme: light` stamps
// `data-theme="light"` on the root (the selector every light token hangs off)
// and live setting changes flow through without a reload. The browser-chrome
// `theme-color` meta re-reads --bg-page after every flip so installed-app
// chrome always matches the glass — values come from the loaded tokens, never
// hardcoded here.

/** The slice of MediaQueryList the theme needs — injectable for tests. */
export interface ThemeMedia {
  matches: boolean;
  addEventListener(type: 'change', cb: (e: { matches: boolean }) => void): void;
}

function apply(light: boolean): void {
  const root = document.documentElement;
  if (light) root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');

  // Keep the browser/PWA chrome on the page's own background. Guarded: in
  // environments without the tokens stylesheet (unit tests) the var resolves
  // empty and the meta is left alone.
  const bg = getComputedStyle(root).getPropertyValue('--bg-page').trim();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (bg !== '' && meta !== null) meta.content = bg;
}

/** Wire the theme to the system setting; call once at boot (main.tsx). */
export function initTheme(
  mq: ThemeMedia = window.matchMedia('(prefers-color-scheme: light)'),
): void {
  apply(mq.matches);
  mq.addEventListener('change', (e) => apply(e.matches));
}

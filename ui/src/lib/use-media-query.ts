import { useSyncExternalStore } from 'react';

/** THE DESK WIDTH CLASS (D-5678, D-5933), WRITTEN ONCE: the master–detail split, the desk accounts bar and the
 *  Sheet's desktop arm all read it here. CSS cannot import a TS constant, so `shell.css`, `skins.css` and
 *  `tokens.css` write the same number in their `@media` blocks, `min-[900px]:` utilities spell it for Tailwind, and
 *  `pwa/test/shell-css.test.ts` holds them together. No other TS file writes the query
 *  (`pwa/test/sheet-desktop-arm.test.tsx`). */
export const DESK_QUERY = '(min-width: 900px)';

/** Reactive CSS media-query match. Lets the shell move chrome between the
 *  mobile and desktop layouts (e.g. the accounts strip: inside the fleet on
 *  phones, a top bar on desktop) by rendering the component in exactly one
 *  place — no duplication, no double polling. Re-renders on viewport crossings. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false, // no window (tests/SSR): default to mobile layout
  );
}

/** At the desk width (`DESK_QUERY`). */
export function useDesk(): boolean {
  return useMediaQuery(DESK_QUERY);
}

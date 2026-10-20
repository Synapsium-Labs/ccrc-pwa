import { useSyncExternalStore } from 'react';

/** The desk width class (D-5678): the master–detail split and the desk accounts bar. `shell.css` writes the same
 *  number in its two blocks, and `shell-css.test.ts` holds the three together. */
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

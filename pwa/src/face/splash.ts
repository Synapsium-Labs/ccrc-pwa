// The splash's one decision, and its words (the Overlord face plan, Task 9; L1, pure).
//
// The installed app opens on the character and the typed `overlord_` mark. It leaves once the fleet has been heard
// and the typing is done, and never after `SPLASH_MAX_MS`, link or no link. `Splash.tsx` (L4) reads the clock and
// `matchMedia`, holds the latch ("once false, stays false") and calls `splashShows`; nothing is decided there.
export const SPLASH_TYPE_MS = 1200; // the wordmark's typing (`wordmark.css`)
export const SPLASH_MAX_MS = 4000; // never longer

/** The two lines under the mark, written once. */
export const SPLASH_TAGLINE = 'Your agents await.';
export const SPLASH_MOTTO = 'RESISTANCE IS OPTIONAL';

export interface SplashFacts {
  /** `matchMedia('(display-mode: standalone)')` at boot: a tab never shows the splash. */
  readonly standalone: boolean;
  /** Milliseconds since mount. */
  readonly sinceMs: number;
  /** The fleet store has received its first frame. */
  readonly frameSeen: boolean;
  readonly reducedMotion: boolean;
}

export function splashShows(f: SplashFacts): boolean {
  if (!f.standalone) return false;
  if (f.sinceMs >= SPLASH_MAX_MS) return false;
  if (!f.frameSeen) return true;
  return !(f.reducedMotion || f.sinceMs >= SPLASH_TYPE_MS);
}

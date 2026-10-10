// Does this viewer want motion suppressed?
//
// WHY THIS IS NOT framer-motion's `useReducedMotion`, which does the same job
// and which this package already has on hand.
//
// A consumer's test cannot mock a module INSIDE this package. `vi.mock(…)` is
// registered against the test file's own module graph, and @ccrc/ui is an
// inlined external dependency there (pwa/vite.config.ts's
// `test.server.deps.inline`), so the mock reaches the test file and nothing
// else — measured: a `vi.mock('framer-motion')` that flipped the preference in
// the test's own import left the component rendering the un-reduced branch.
// Removing ui's own copy of framer-motion changed nothing, so this is a mock
// SCOPE boundary, not a duplicate-package resolution problem.
//
// `matchMedia` is a GLOBAL. A consumer's test stubs it once and every package
// in the process observes the same answer, so the preference stays steerable
// from the only place that can steer it. That is the whole reason this exists:
// a component whose reduced-motion branch cannot be reached by a test is a
// component with an untestable half.
//
// It also does not cache. framer-motion's hook memoises its first answer in
// module state, which is why consumers had to mock the module rather than move
// the media query — a preference changed mid-session was never observed.
import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** `true` when the viewer has asked for reduced motion. Falls to `false` where
 *  `matchMedia` is absent (SSR, an old jsdom), which is the safe default: the
 *  animation plays, rather than every animated component silently going still
 *  on a platform that simply could not answer. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());

  useEffect(() => {
    const mql = typeof window !== 'undefined' && window.matchMedia?.(QUERY);
    if (!mql) return;
    // Re-read on subscribe: the stub a test installs, or a preference the user
    // changed, may both have landed between the initial render and this effect.
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent): void => { setReduced(e.matches); };
    // `addListener` is the pre-2019 Safari spelling; it is still the only one
    // some embedded WebKits implement, and this app ships to phones.
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
      return () => { mql.removeEventListener('change', onChange); };
    }
    mql.addListener?.(onChange);
    return () => { mql.removeListener?.(onChange); };
  }, []);

  return reduced;
}

/** THE ONE-SHOT READ, exported because a non-component needs it too: the
 *  app's router asks the same question before it starts a view transition,
 *  and it spelled the media query for itself until the literal census found
 *  the second copy. A hook is the wrong shape there — the router is a
 *  function, and it wants the answer once, at the moment of the navigation.
 *
 *  `false` where `matchMedia` is absent (SSR, an old jsdom), which is the safe
 *  default in both places: the animation plays, rather than everything
 *  silently going still on a platform that simply could not answer. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.(QUERY)?.matches ?? false;
}

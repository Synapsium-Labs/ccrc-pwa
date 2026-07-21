// Tiny path router shared by the shell (app.tsx) and screens. Lives outside
// app.tsx so screens can navigate without importing the shell (no cycles).
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/** document.startViewTransition, where the platform has it. */
type DocWithVT = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/** Programmatic navigation for screens/cards: pushState + notify the router.
 *  Route changes ride a view transition when the platform supports it — the
 *  card→chat shared-element morph (the tapped card title carries
 *  `view-transition-name: session-title` into the chat header; timing lives
 *  in base.css on the ::view-transition pseudos). Reduced motion and older
 *  engines get the plain instant swap. */
export function navigate(path: string): void {
  const go = (): void => {
    history.pushState(null, '', path);
    // flushSync so the new screen is in the DOM before the transition
    // captures its "new" snapshot (no-op for the non-transition path).
    flushSync(() => {
      dispatchEvent(new PopStateEvent('popstate'));
    });
  };
  const vt = (document as DocWithVT).startViewTransition?.bind(document);
  const reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (vt && !reduced) vt(go);
  else go();
}

/** Current location.pathname, live across pushState/back/forward. */
export function usePath(): string {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const onPop = (): void => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  return path;
}

// Tiny path router shared by the shell (app.tsx) and screens. Lives outside
// app.tsx so screens can navigate without importing the shell (no cycles).
import { useEffect, useState } from 'react';

/** Programmatic navigation for screens/cards: pushState + notify the router. */
export function navigate(path: string): void {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
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

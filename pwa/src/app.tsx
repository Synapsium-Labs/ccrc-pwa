// Router shell. Two path routes: `/` (fleet) and `/s/:id` (session).
// The real screens land in Tasks 6–7 (src/screens/); until then this renders
// token-styled placeholders so the dev shell never shows unstyled fallbacks.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/** Programmatic navigation for screens/cards: pushState + notify the router. */
export function navigate(path: string): void {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

function usePath(): string {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const onPop = (): void => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  return path;
}

function FleetPlaceholder(): ReactNode {
  return (
    <main className="min-h-dvh bg-page px-4 pt-[calc(var(--sp-6)+var(--safe-top))]">
      <p className="font-mono text-2xs uppercase tracking-[var(--tracking-caps)] text-ink-tertiary">
        fleet
      </p>
      <h1 className="mt-1 font-mono text-2xl font-medium text-ink">ccrc</h1>
      <p className="mt-3 text-base text-ink-secondary">Sessions load here.</p>
    </main>
  );
}

function SessionPlaceholder({ id }: { id: string }): ReactNode {
  return (
    <main className="min-h-dvh bg-page px-4 pt-[calc(var(--sp-6)+var(--safe-top))]">
      <button
        type="button"
        className="min-h-[var(--tap-min)] font-mono text-sm text-accent"
        onClick={() => navigate('/')}
      >
        ‹ fleet
      </button>
      <h1 className="mt-2 font-mono text-lg font-medium text-ink">{id}</h1>
      <p className="mt-3 text-base text-ink-secondary">This session loads here.</p>
    </main>
  );
}

export function App(): ReactNode {
  const path = usePath();
  const m = /^\/s\/([^/]+)\/?$/.exec(path);
  if (m) return <SessionPlaceholder id={decodeURIComponent(m[1]!)} />;
  return <FleetPlaceholder />;
}

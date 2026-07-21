// Router shell. Two path routes: `/` (FleetScreen) and `/s/:id` (session —
// the real screen lands in Task 7; until then a token-styled placeholder so
// the dev shell never shows unstyled fallbacks). ToastHost mounts here so
// stores/screens can fire toasts from anywhere.
import type { ReactNode } from 'react';
import { ToastHost } from './components/Toast';
import { navigate, usePath } from './lib/router';
import { FleetScreen } from './screens/FleetScreen';

export { navigate } from './lib/router';

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
  return (
    <>
      {m ? <SessionPlaceholder id={decodeURIComponent(m[1]!)} /> : <FleetScreen />}
      <ToastHost />
    </>
  );
}

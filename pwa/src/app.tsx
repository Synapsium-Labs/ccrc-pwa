// Router shell. Two path routes: `/` (FleetScreen) and `/s/:id`
// (SessionScreen). ToastHost mounts here so stores/screens can fire toasts
// from anywhere.
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { ToastHost } from './components/Toast';
import { usePath } from './lib/router';
import { FleetScreen } from './screens/FleetScreen';
import { SessionScreen } from './screens/SessionScreen';
import { useFleetStore } from './stores/fleet';

export { navigate } from './lib/router';

export function App(): ReactNode {
  const path = usePath();
  useEffect(() => {
    // The fleet stream is the app's heartbeat: connect once at the shell so
    // deep links to /s/:id still get live names, limits and dialog badges.
    // connect() is idempotent; the socket survives navigation.
    useFleetStore.getState().connect();
  }, []);
  const m = /^\/s\/([^/]+)\/?$/.exec(path);
  return (
    <>
      {m ? <SessionScreen id={decodeURIComponent(m[1]!)} /> : <FleetScreen />}
      <ToastHost />
    </>
  );
}

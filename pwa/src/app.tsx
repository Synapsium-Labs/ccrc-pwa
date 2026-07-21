// Router shell. Two path routes: `/` (FleetScreen) and `/s/:id`
// (SessionScreen). ToastHost mounts here so stores/screens can fire toasts
// from anywhere.
import type { ReactNode } from 'react';
import { ToastHost } from './components/Toast';
import { usePath } from './lib/router';
import { FleetScreen } from './screens/FleetScreen';
import { SessionScreen } from './screens/SessionScreen';

export { navigate } from './lib/router';

export function App(): ReactNode {
  const path = usePath();
  const m = /^\/s\/([^/]+)\/?$/.exec(path);
  return (
    <>
      {m ? <SessionScreen id={decodeURIComponent(m[1]!)} /> : <FleetScreen />}
      <ToastHost />
    </>
  );
}

// The console's root, `/` (Overlord W1 home, Task 2; plan question 1, slug `home-root-replaces-to-the-place`): L4. It asks the
// store where the home is (`useHome`, `homePlace` alone) and replaces the address with that place's path once the answer is
// decided (`useHomeSettled`), so `/` never stays in history and a back never returns to it. Until then a desk's pane says
// "Loading…"; a phone shows the Fleet under `/` (`shellViewOf('/')` answers `fleet`), the safe thing to see while the home is
// decided. A read that fails or times out is decided too: it answers the Fleet.
import { useEffect, type ReactNode } from 'react';
import { navigate } from '../lib/router';
import { placePath } from '../lib/routes';
import { useHome, useHomeSettled } from '../stores/overlord';

export function HomeRoute(): ReactNode {
  const settled = useHomeSettled();
  const { place } = useHome();
  useEffect(() => {
    if (settled) navigate(placePath(place), { replace: true });
  }, [settled, place]);
  return <p className="shell-placeholder-copy" role="status">Loading…</p>;
}

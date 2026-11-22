// The console's root, `/` (Overlord W1 home, Task 2; plan question 1, slug `home-root-replaces-to-the-place`): L4. It asks the
// store where the home is (`useHome`, `homePlace` alone) and replaces the address with that place's path once the answer is
// decided (`useHomeSettled`), so `/` never stays in history and a back never returns to it. Until then a desk's pane says
// "Loading…"; a phone shows the Fleet under `/` (`shellViewOf('/')` answers `fleet`), the safe thing to see while the home is
// decided. A read that fails or times out is decided too: it answers the Fleet.
import { useEffect, type ReactNode } from 'react';
import { navigate } from '../lib/router';
import { placePath } from '../lib/routes';
import { useHome, useHomeSettled } from '../stores/overlord';

/** Replace the address with `href` once this commit's effects have all run. A child's effect runs before its parent's, and
 *  the shell's `useLocation` subscribes to `popstate` in its own effect, so a replace made in this route's first effect would
 *  dispatch before the shell listens and be lost. A microtask runs after the whole commit; one superseded by a later answer,
 *  or by unmounting, does nothing. The replace names the address it leaves (`navigate`'s `from`), so it lands only while the
 *  page is still that address: a view transition runs it a frame later, and a navigation made in between (a tap, a key, a
 *  link) is never overwritten (review 3319 F1). Shared with `OverlordRoute`. */
export function useReplaceWhen(href: string | null): void {
  useEffect(() => {
    if (href === null) return undefined;
    const from = location.pathname + location.search;
    let live = true;
    queueMicrotask(() => { if (live) navigate(href, { replace: true, from }); });
    return () => { live = false; };
  }, [href]);
}

export function HomeRoute(): ReactNode {
  const settled = useHomeSettled();
  const { place } = useHome();
  useReplaceWhen(settled ? placePath(place) : null);
  return <p className="shell-placeholder-copy" role="status">Loading…</p>;
}

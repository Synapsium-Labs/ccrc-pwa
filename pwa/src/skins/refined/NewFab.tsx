// Refined's `+ New` on a phone (W2 Task S5, D-5471; spec §5.3, Fleet, phone row): an extended primary button at the
// bottom right, above the safe-area inset, built with `commandDoor('new-session')` (the plan's door table).
//
// MOUNTED, NEVER CSS-HIDDEN (the plan's "one instance per width", `skin-boundary.test.ts` (j)): not at ≥900, where the
// app bar's `+ New session` is the door, and not off the fleet route, where the fleet column is still mounted but
// hidden by the phone swap (`shell.css`). While mounted it publishes its measured height plus its margin as
// `--phone-nav-h`, the one variable for whatever chrome is fixed to a phone's bottom edge, and removes it on unmount;
// `ToastHost` adds it to `--composer-h`, so a toast clears it, and the fleet list's bottom reservation follows it (the
// token's 0px default is in `tokens.css`; the inline value on the root outranks it).
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button, Icon } from '@ccrc/ui';
import { commandDoor } from '../../command/door';
import { useLocation } from '../../lib/router';
import { matchRoute } from '../../lib/routes';
import { DESK_QUERY, useMediaQuery } from '../../lib/useMediaQuery';

/** The bottom-edge chrome's height, read by `ToastHost` and the fleet list (`fleet.css`). */
export const PHONE_NAV_H = '--phone-nav-h';

function MountedFab(): ReactNode {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const root = document.documentElement;
    // Its margin is `refined.css`'s `bottom` on `.ref-fab`, the same token.
    const publish = (): void => root.style.setProperty(PHONE_NAV_H, `calc(${el.getBoundingClientRect().height}px + var(--sp-4))`);
    publish();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty(PHONE_NAV_H);
    };
  }, []);
  return (
    <Button ref={ref} {...commandDoor('new-session')} variant="primary" size="fit" aria-label="New session" className="ref-fab gap-1">
      <Icon name="plus" />
      New
    </Button>
  );
}

export function NewFab(): ReactNode {
  const desk = useMediaQuery(DESK_QUERY);
  const { path } = useLocation();
  const onFleet = matchRoute(path)?.route.id === 'fleet';
  return desk || !onFleet ? null : <MountedFab />;
}

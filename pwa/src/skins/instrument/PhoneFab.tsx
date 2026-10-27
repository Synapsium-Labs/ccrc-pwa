// Instrument's round `+` on a phone (desk-polish T2b, D-6328): today's floating New session, built with
// `commandDoor('new-session')` so a tap runs the one command the top bar's `+` and the palette run.
//
// MOUNTED BELOW 900 ONLY, NEVER CSS-HIDDEN (`skin-boundary.test.ts` (j)): at the desk the top bar's `+` is the one
// New session door, and a second one floating over the session rows is a duplicate that covers them. S11 later
// replaces this with its phone top bar's `+`. It keeps the `fab` class: `fleet.css` styles it.
import type { ReactNode } from 'react';
import { commandDoor } from '../../command/door';
import { useDesk } from '../../lib/useMediaQuery';

export function PhoneFab(): ReactNode {
  const desk = useDesk();
  return desk ? null : (
    <button type="button" className="fab" aria-label="New session" {...commandDoor('new-session')}>
      <span aria-hidden="true">+</span>
    </button>
  );
}

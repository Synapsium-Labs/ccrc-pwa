// An anchor wearing the design system's ghost button: a link that stands alone as a control, so it has the button's
// tap floor (`buttonVariants()` carries `min-h-tap`, which `control-census.test.ts`'s VARIANT arm checks). One owner
// for the shape, so PrSheet's "Open on GitHub" and Settings' Cleanup pause resume door cannot drift apart.
//
// ITS OWN HOVER AND PRESS (D-5101): the variant gates both on `enabled:`, which matches form controls only, so an
// anchor would never lift or sink. The two ungated utilities give it the ghost's grounds (`hover-states.test.ts`).
import { buttonVariants, cn } from '@ccrc/ui';

export const GHOST_ANCHOR = cn(buttonVariants({ variant: 'ghost' }), 'hover:bg-hover active:bg-pressed');

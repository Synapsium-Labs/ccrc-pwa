// TextLink — a link that sits INSIDE a line of text and opens another site
// (D-5550). The first anchor @ccrc/ui draws: until now every app anchor was
// hand-drawn, and the control census (`pwa/test/control-census.test.ts`)
// registered each one by file and class. A link in prose is one shape, so it
// is a primitive, and an app line that needs one renders this.
//
// INLINE BY CONTRACT, so NO TAP FLOOR. WCAG 2.2 SC 2.5.8 exempts a target
// "in a sentence or block of text" — the same exemption the census grants the
// app's bare-URL and markdown links — because a 44px box around a word would
// reflow the prose around every link. Never use it as a standalone control:
// that is a `Button` (or `buttonVariants` on an anchor, PrSheet's "Open on
// GitHub").
//
// IT PAINTS NO COLOUR. The reset gives `a` `color: inherit`, and this keeps
// it: the link is the surrounding text's ink, marked by its underline, so it
// is measured wherever its text already is and adds no pair to the contrast
// gate. The ring is the shared FOCUS_RING, on keyboard focus only.
//
// A NEW BROWSING CONTEXT, ALWAYS: `target="_blank"` with `noopener
// noreferrer`. A caller in an installed PWA passes an `onClick` that opens
// the URL itself (the app's `openExternal`), because a plain `_blank` there
// can navigate the app window instead.
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';

export const TEXT_LINK =
  `underline decoration-1 underline-offset-2 hover:decoration-2 rounded-sm [overflow-wrap:anywhere] ${FOCUS_RING}`;

export interface TextLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'target' | 'rel'> {
  href: string;
  children: ReactNode;
}

export function TextLink({ className, children, ...props }: TextLinkProps): ReactNode {
  return (
    <a target="_blank" rel="noopener noreferrer" className={cn(TEXT_LINK, className)} {...props}>
      {children}
    </a>
  );
}

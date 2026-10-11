// Prose — markdown as this console renders it.
//
// A COMPOSITE WITH NO CHILDREN OF ITS OWN. It renders one element and imports
// one stylesheet, which is unusual enough to say why: what makes prose prose
// is seventy-six rules, not a tree. `MessageBubble` still owns the
// `react-markdown` component map — WHICH element a token becomes is this app's
// business, and how it LOOKS is this package's — so the only thing that needed
// a home here was the look.
//
// IT IS NOT A `Well`. A well is a quoted surface with its own dark ground in
// both themes; prose is the page's own ink on the page's own ground, with a
// reading measure on the text and none on the code. The two meet inside this
// stylesheet, where `.code-block` IS a well that prose happens to contain.
//
// THE MEASURE IS THE ONE THING TO KNOW. `--measure-prose` (72ch) caps
// paragraphs, lists and headings and deliberately does NOT cap `pre`, tables
// or images: data keeps the full pane. It is inert below 640px, so a phone
// sees no sign of it and a desktop pane does — which is why the sandbox's
// desktop surface is the only place the rule is visible at all.
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import './prose.css';

/** The hook class the stylesheet is written against, exported so a consumer
 *  can name it without hard-coding the string — `MessageBubble`'s tests select
 *  on it, and so does the app's own `.chat-item` spacing. */
export const PROSE = 'msg-assist';

export interface ProseProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Prose({ className, children, ...props }: ProseProps): ReactNode {
  return <div className={cn(PROSE, className)} {...props}>{children}</div>;
}

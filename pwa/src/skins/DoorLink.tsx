// A place's door in a desk bar (Refined's tabs, Instrument's doors), by the Docs tab rule (desktop polish wave 174,
// `lib/docTab.ts`). A place the rule sends to a new tab, today the Docs place at a desk, is a link: an anchor wearing the
// door (`DOOR`, `@ccrc/ui`, the button's own chrome), with a real address and `target="_blank"`, so one click opens one
// Docs tab and the browser's middle click and copy link work on it. Every other place keeps its door, the registry's "Go to"
// command (`commandDoor`). Both skins draw their places through this one component, so neither names a place.
import type { ReactNode } from 'react';
import { DOOR, DOOR_GLYPH, Door, cn } from '@ccrc/ui';
import { commandDoor, doorMark } from '../command/door';
import { NEW_TAB_WORDS } from '../lib/docTab';
import { placePath } from '../lib/routes';
import { useTabLink } from '../lib/useTabLink';

export interface PlaceDoorProps {
  /** A `top` row of `ROUTES`: its door is `go-<id>`, its address `placePath(id)`. */
  readonly id: string;
  /** Decoration beside the word, `aria-hidden`; `null`, `undefined`, `false` and `''` draw nothing, as `Door`'s. */
  readonly glyph: ReactNode;
  readonly 'aria-label': string;
  readonly 'aria-current'?: 'page';
  readonly className?: string;
  readonly children?: ReactNode;
}

export function PlaceDoor({ id, glyph, className, children, 'aria-label': name, 'aria-current': current }: PlaceDoorProps): ReactNode {
  const props = useTabLink()(placePath(id));
  if (props.target === undefined) {
    return <Door {...commandDoor(`go-${id}`)} glyph={glyph} aria-label={name} aria-current={current} className={className}>{children}</Door>;
  }
  const drawn = glyph !== null && glyph !== undefined && glyph !== false && glyph !== '';
  return (
    <a {...props} {...doorMark(`go-${id}`)} aria-label={name + NEW_TAB_WORDS} aria-current={current} className={cn(DOOR, className)}>
      {drawn && <span className={DOOR_GLYPH} aria-hidden="true">{glyph}</span>}
      {children}
    </a>
  );
}

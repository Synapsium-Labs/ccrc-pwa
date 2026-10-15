// BareRow — a row that is a button and wears no chrome at all.
//
// FIVE RULES IN ONE STYLESHEET, six declarations each, identical:
// `.fleet-archived-row` and `.fleet-runs-row` (the fleet screen's two footers),
// `.proj-released-toggle` and `.proj-archived-toggle` (a project card's two
// disclosures) and `.archive-row` (a row on the archive screen). No fill, no
// border, no radius, no press — a full-width tap target at the floor, aligned
// left, and that is the whole of it.
//
// NOT A `ListRow`. That one draws a hairline under itself, stands 52px rather
// than 44, and scales on press, because it is a row in a LIST that a thumb
// drags past. These five are rows that happen to be pressable: a footer, two
// disclosures and a line on a screen. The two shapes agree on `background:
// none` and disagree on everything that makes a row look like one.
//
// WHAT IT DOES NOT CARRY is as deliberate as what it does. No type, no ink, no
// padding: the five disagreed on all three (`--fs-xs` against `--fs-2xs`,
// tertiary ink against primary, `0 var(--sp-2)` against `0` against a grid's
// own gap), and each difference is that row's own voice rather than drift.
// Folding any of them in would have meant picking one of five.
//
// `w-full` IS IN, and one consumer overrides it — `.fleet-runs-line
// .fleet-runs-row` sets `width: auto` so the row can share a line. An app
// sheet is unlayered and beats a utility, so that override still lands; the
// one-way layer order is what makes "the component proposes, the app
// disposes" true rather than aspirational.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';

/** The six, token for token as all five rules declared them. */
export const BARE_ROW =
  'w-full min-h-tap border-0 bg-transparent text-left cursor-pointer'
  + ' disabled:cursor-default'
  + ` ${FOCUS_RING}`;

export interface BareRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The hook class, always: it carries this row's own type, ink, padding and
   *  — for two of the five — the grid or flex it lays its children out in. */
  className: string;
  children: ReactNode;
}

export function BareRow(
  { className, type = 'button', children, ...props }: BareRowProps,
): ReactNode {
  return (
    <button type={type} className={cn(BARE_ROW, className)} {...props}>{children}</button>
  );
}

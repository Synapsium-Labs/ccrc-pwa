// Select — the one control this design system could not render.
//
// TWO FILES DECLARED IT AND NOTHING HELD THEM IN AGREEMENT: the routing row's
// three fields (`NewSessionSheet`) and the fleet head's class chooser
// (`FleetScreen`) both wore `.route-select`, a fleet.css rule, and the second
// one also had to UNDO that rule's width. The system had a `TextInput` and no
// `Select`, so the app's only dropdown lived in an app stylesheet and the
// design system could not answer "what does a chooser look like here".
//
// IT IS `TextInput`'S CHROME, token for token, and that is the finding rather
// than a decision: `.route-select` and `TEXT_INPUT` declared the same ten
// things — the same hairline, the same raised ground, the same `--r-md`, the
// same tap floor, the same `--fs-input`. Two spellings of one field. The three
// differences are listed below and each one is about being a `<select>`.
//
// WHY THIS CARRIES NO SIZE AXIS, for the reason `TextInput`'s header gives at
// length: `--fs-input` is 16px because iOS Safari zooms the viewport on focus
// for anything smaller, and a `<select>` is a focusable field like any other.
//
// THE WIDTH IS THE WHOLE REASON THIS IS A UTILITY STRING RATHER THAN A RULE.
// `.route-select { width: 100% }` is right for a field stacked in a grid cell
// and wrong for a control sized to its own option list, so the fleet head's
// chooser had to override it — and the override that SHIPPED
// (`.fleet-class-select { width: auto }`, one class against one class, 650
// lines earlier in the same sheet) lost the tie to source order and never
// applied once. The control rendered 286px wide instead of 167px and the head
// overflowed the viewport by 225px at 390px. The fix was a compound selector:
// a cascade trick holding a layout decision together.
//
// As a utility, `w-full` is not overridden — it is REMOVED. `cn` is
// tailwind-merge, so `cn(SELECT, 'w-auto')` emits one width utility and the
// caller's is the one that survives, with no selector, no specificity and no
// source order anywhere in the answer. `pwa/test/fleet-css.test.ts` pins that
// where it used to pin the specificity.
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { TEXT_INPUT } from './text-input';

/** The chooser's chrome — `TEXT_INPUT`'s, plus the one difference.
 *
 *  IT IS DERIVED, NOT COPIED, and the census is why: the first draft spelled
 *  the ten utilities out, and `literal-census.test.ts` came back red naming
 *  the line it shared with `text-input.tsx`. It was right. A select and a text
 *  field are the same field in this palette — same hairline, same raised
 *  ground, same `--r-md`, same tap floor, same `--fs-input` — and writing that
 *  twice is how the two drift when one of them is fixed.
 *
 *  `px-2` rather than `TEXT_INPUT`'s `px-3`: a `<select>` draws the platform's
 *  own disclosure arrow inside its box and pays for it out of the same width,
 *  which is what the `.route-select` rule this replaces already allowed for.
 *  `cn` REPLACES the padding rather than fighting it — the same mechanism the
 *  width override at the fleet head depends on.
 *
 *  `placeholder:text-ink-tertiary` rides along inert: a `<select>` has no
 *  placeholder, its empty choice is an `<option>` with a word in it. Stripping
 *  an utility that does nothing would mean spelling the rest out again, which
 *  is the copy this derivation exists to refuse.
 *
 *  `appearance` is NOT reset. The native control is the one every mobile
 *  platform knows how to open as a wheel or a sheet, and replacing it with a
 *  drawn arrow is a custom listbox with its own keyboard story — a different
 *  component, not a variant of this one.
 *
 *  NO SIZE AXIS, for `TextInput`'s reason, which it inherits along with the
 *  token: `--fs-input` is 16px because iOS Safari zooms the viewport on focus
 *  for anything smaller, and a `<select>` is a focusable field like any other.
 *
 *  NOT a cva either: there is one shape, and `className` is the extension
 *  mechanism — which here is also the width mechanism. */
export const SELECT = cn(TEXT_INPUT, 'px-2');

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  className?: string;
}

export function Select({ className, children, ...props }: SelectProps): ReactNode {
  return <select className={cn(SELECT, className)} {...props}>{children}</select>;
}

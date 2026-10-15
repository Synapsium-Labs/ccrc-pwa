// Option row — one tappable line in a chooser: the TUI menu row gone native.
// A PRIMITIVE, so it has no opinion about what it is showing. It owns the
// ROW: the two leading fixed-width columns, the wrapping body, the trailing
// ↵/● affordance, and the selected tint. What the row MEANS — a routing
// field that is inert on this lane, a class serving one rung down, an answer
// in flight — is the caller's, and arrives through `marker` or `children`
// wearing the caller's own class names.
//
// Why this exists at all: the same seven class names were hand-written by two
// components in the app, which is the drift `design-system-boundary.test.ts`
// exists to catch — a class string is not an import, so a vocabulary with two
// authors has no single definition to outlive. Those names are emitted here
// and nowhere else now.
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';
import './option-row.css';

export interface OptionRowProps {
  /** The row's first line. */
  label: ReactNode;
  /** The sub-sentence under it — the fix for choosing options blind. */
  sublabel?: ReactNode;
  /** Anything else that belongs INSIDE the body, under the sublabel, where it
   *  wraps with the text rather than competing with the trailing slot. */
  children?: ReactNode;
  /** Paints the accent tint. */
  selected?: boolean;
  /** Leading cursor column. Pass `''` to reserve the column's width on the
   *  rows that are not wearing the cursor — otherwise the labels of a list
   *  with one selected row would not line up. */
  glyph?: ReactNode;
  /** Mono index column — the digit ccd's own TUI menu answers to. */
  index?: ReactNode;
  /** The right-aligned affordance on the row that Enter would take (`↵`, `●`).
   *  Rendered aria-hidden: it is decoration beside the row's own name. */
  enter?: ReactNode;
  /** Trailing slot for a caller's own marker, rendered verbatim. Callers that
   *  have one never pass `enter` as well — the two share the slot, and which
   *  of them a row has earned is the caller's fact, not this row's. */
  marker?: ReactNode;
  /** Present ⇒ the row is a <button>. Absent ⇒ a plain <div>, which is what a
   *  read-only row must be so a screen reader never offers it as tappable.
   *  The stylesheet already carries both halves (`:disabled` matches only a
   *  real form control, `[aria-disabled]` covers the div), so the element and
   *  the disabled spelling are chosen together, here, once. */
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** Defined ⇒ the row is a CHECKBOX, one of several that may be ticked at
   *  once (a multiSelect question's boxes): `role="checkbox"` and
   *  `aria-checked` on the element `onClick` chose, so a screen reader hears a
   *  box and whether it is ticked rather than a button. With no `glyph` of the
   *  caller's, the glyph column DRAWS the box (`CheckBox`): an 18px frame,
   *  filled with the accent and carrying a tick once ticked, dimmed with the
   *  row when it is disabled. Decoration beside the row's own name, like the
   *  cursor it stands in for. Undefined ⇒ an ordinary row, exactly as before.
   *  No class of its own: the box rides the column every row already has,
   *  marked `data-box`, so the owned vocabulary does not grow. */
  checked?: boolean;
  className?: string;
}

export function OptionRow({
  label,
  sublabel,
  children,
  selected,
  glyph,
  index,
  enter,
  marker,
  onClick,
  disabled,
  busy,
  checked,
  className,
}: OptionRowProps): ReactNode {
  // The ring rides the row only when it IS a control — `onClick` absent
  // means a plain <div>, and a div that cannot be focused must not carry
  // focus utilities that would never fire.
  const cls = cn('opt', onClick !== undefined && FOCUS_RING, selected && 'opt--selected', className);
  // A box is a checkbox to assistive tech too, whichever element `onClick` chose.
  const box = checked === undefined ? {} : { role: 'checkbox', 'aria-checked': checked };
  const inner = (
    <>
      {glyph !== undefined ? (
        <span className="opt-glyph" aria-hidden="true">
          {glyph}
        </span>
      ) : (
        checked !== undefined && <CheckBox ticked={checked} />
      )}
      {index !== undefined && (
        <span className="opt-idx" aria-hidden="true">
          {index}
        </span>
      )}
      <span className="opt-body">
        <span className="opt-label">{label}</span>
        {sublabel && <span className="opt-desc">{sublabel}</span>}
        {children}
      </span>
      {/* ONE TRAILING SLOT, AND `marker` WINS IT. Both props target the same
          position and the prop docs say a call site never passes both — but a
          doc is not a mechanism, and rendering both produced two marks in the
          slot with no warning. `marker` takes precedence because it is the
          app's own word about this row (`inert on this lane`), and the
          primitive's `↵`/`●` is the generic thing it would be overriding. */}
      {marker ?? (enter !== undefined && (
        <span className="opt-enter" aria-hidden="true">
          {enter}
        </span>
      ))}
    </>
  );
  if (!onClick) {
    return (
      <div className={cls} {...box} aria-disabled={disabled || undefined} aria-busy={busy || undefined}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      {...box}
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {inner}
    </button>
  );
}

/** The box a checkbox row draws in its glyph column. DRAWN, not a character: `☑`/`☐` set in the column's 14px came out
 *  as about 8px of ink, in the same accent ink ticked or not, so the state was a speck at every width. The frame is
 *  18px; ticked, it fills with the accent and the tick is drawn in the ink made for the accent. Every paint is in
 *  option-row.css (`.opt-glyph[data-box]`), so a theme recolours it and a disabled row dims it. */
function CheckBox({ ticked }: { ticked: boolean }): ReactNode {
  return (
    <span className="opt-glyph" aria-hidden="true" data-box={ticked ? 'ticked' : 'clear'}>
      <svg viewBox="0 0 18 18" width="18" height="18">
        <rect x="1" y="1" width="16" height="16" rx="4" />
        {ticked && <path d="M5 9.4l2.7 2.7L13.2 6.4" />}
      </svg>
    </span>
  );
}

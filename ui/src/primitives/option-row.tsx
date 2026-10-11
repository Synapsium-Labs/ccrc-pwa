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
  className,
}: OptionRowProps): ReactNode {
  // The ring rides the row only when it IS a control — `onClick` absent
  // means a plain <div>, and a div that cannot be focused must not carry
  // focus utilities that would never fire.
  const cls = cn('opt', onClick !== undefined && FOCUS_RING, selected && 'opt--selected', className);
  const inner = (
    <>
      {glyph !== undefined && (
        <span className="opt-glyph" aria-hidden="true">
          {glyph}
        </span>
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
      <div className={cls} aria-disabled={disabled || undefined} aria-busy={busy || undefined}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {inner}
    </button>
  );
}

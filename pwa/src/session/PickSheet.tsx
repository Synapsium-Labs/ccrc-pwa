// A tappable chooser sheet — one-tap model / effort selection. Rows reuse the
// dialog `.opt` chrome; the active row wears the ❯ + a filled dot. Tapping
// hands the whole row back to the caller, which writes the routing record
// (a context-window switch then surfaces its own confirm dialog through
// DialogSheet).
import type { ReactNode } from 'react';
import { Sheet } from '../components/Sheet';
import type { PickOption } from '../lib/models';
import './chat.css';

export interface PickSheetProps {
  open: boolean;
  onClose: () => void;
  eyebrow: string;
  title: string;
  options: PickOption[];
  onPick: (option: PickOption) => void;
}

export function PickSheet({ open, onClose, eyebrow, title, options, onPick }: PickSheetProps): ReactNode {
  return (
    <Sheet open={open} onClose={onClose} eyebrow={eyebrow} title={title}>
      <div className="opts">
        {options.map((o) => (
          <button
            key={`${o.route.field}=${o.route.value}`}
            type="button"
            className={o.active ? 'opt opt--selected' : 'opt'}
            onClick={() => onPick(o)}
          >
            <span className="opt-glyph" aria-hidden="true">{o.active ? '❯' : ''}</span>
            <span className="opt-body">
              <span className="opt-label">{o.label}</span>
              {o.sublabel && <span className="opt-desc">{o.sublabel}</span>}
              {o.active && o.degradedTo !== undefined && (
                // Whole-branch review M1: ccd's `.degraded` stamp — no lane
                // could serve the intended class, so it served one rung down
                // (spec §5.4). It sits BESIDE the intended row, inside the
                // body rather than in the right-hand marker slot, because
                // that slot is `inertOnThisLane`'s and a degraded field can
                // be inert too — two different facts, never one line.
                <span className="opt-degraded">serving {o.degradedTo} (share ceiling)</span>
              )}
            </span>
            {o.active && o.inertOnThisLane && (
              // S6 Task 4: ccd's `.inert` names this field on the session's
              // CURRENT lane — the intended value still renders (the active
              // row), but there is nothing a queued badge could confirm, so
              // this replaces the enter dot rather than joining it.
              <span className="opt-inert">inert on this lane</span>
            )}
            {o.active && !o.inertOnThisLane && (
              <span className="opt-enter" aria-hidden="true">●</span>
            )}
          </button>
        ))}
      </div>
      <p className="sheet-foot">tap to switch — it applies in the session</p>
    </Sheet>
  );
}

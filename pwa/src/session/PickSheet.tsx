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
            </span>
            {o.active && (
              <span className="opt-enter" aria-hidden="true">●</span>
            )}
          </button>
        ))}
      </div>
      <p className="sheet-foot">tap to switch — it applies in the session</p>
    </Sheet>
  );
}

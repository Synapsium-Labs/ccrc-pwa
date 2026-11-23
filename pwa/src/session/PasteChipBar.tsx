// The paste-chip row (desktop-polish wave 169): one chip per long paste the draft holds, above the field beside the
// attachment tray. The token in the field (`[Pasted text #N +L lines]`) is where the text sits; this row is where it
// is acted on. Expand puts the full text back into the field in place, as ordinary text; Remove takes the token and
// its text together. Ring L4: it renders what `liveChips` (pasteChips.ts, L1) listed and calls back, deciding nothing.
import type { ReactNode } from 'react';
import { FOCUS_RING } from '@ccrc/ui';
import type { LiveChip } from './pasteChips';
import './pasteChips.css';

export interface PasteChipBarProps {
  chips: readonly LiveChip[];
  onExpand: (n: number) => void;
  onRemove: (n: number) => void;
  disabled?: boolean;
}

const linesWord = (lines: number): string => `${lines} ${lines === 1 ? 'line' : 'lines'}`;

export function PasteChipBar({ chips, onExpand, onRemove, disabled = false }: PasteChipBarProps): ReactNode {
  if (chips.length === 0) return null;
  return (
    <ul className="paste-chips" aria-label="Pasted text">
      {chips.map((c) => (
        <li key={c.n} className="paste-chip" title={c.head || undefined}>
          <span className="paste-chip-label">
            <span className="paste-chip-n">#{c.n}</span>
            <span className="paste-chip-lines">{linesWord(c.lines)}</span>
            {c.head !== '' && <span className="paste-chip-head">{c.head}</span>}
          </span>
          <button
            type="button"
            className={`paste-chip-act ${FOCUS_RING}`}
            aria-label={`Expand pasted text #${c.n}, ${linesWord(c.lines)}, into the message`}
            disabled={disabled}
            onClick={() => onExpand(c.n)}
          >
            expand
          </button>
          <button
            type="button"
            className={`paste-chip-remove ${FOCUS_RING}`}
            aria-label={`Remove pasted text #${c.n}`}
            disabled={disabled}
            onClick={() => onRemove(c.n)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// The paste-chip row (desktop-polish wave 169): one chip per long paste the draft holds, above the field beside the
// attachment tray. The chip in the field (its label, `[Pasted text #N +L lines]`, between two invisible markers) is
// where the text sits; this row is where it is acted on. Expand puts the full text back into the field in place, as
// ordinary text; Remove takes the chip out of the field (its text stays in the draft's table, for an undo). When an edit
// the composer did not plan broke a pasted block, the row says so, with Undo (the browser's own, one step) and Dismiss
// (the broken block's leftover markers go); the composer holds the send meanwhile. Ring L4: it renders what
// `liveChips` (pasteChips.ts, L1) listed and what the composer decided, and calls back, deciding nothing.
import type { ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import { linesWord, type LiveChip } from './pasteChips';
import './pasteChips.css';

export interface PasteChipBarProps {
  chips: readonly LiveChip[];
  /** Each act names the chip by where it starts in the field (`LiveChip.at`): one number can stand twice. */
  onExpand: (at: number) => void;
  onRemove: (at: number) => void;
  disabled?: boolean;
  /** A pasted block is broken: show the notice and its two controls. */
  broken?: boolean;
  onUndo?: () => void;
  onDismiss?: () => void;
}

export function PasteChipBar({
  chips, onExpand, onRemove, disabled = false, broken = false, onUndo, onDismiss,
}: PasteChipBarProps): ReactNode {
  if (chips.length === 0 && !broken) return null;
  return (
    <>
      {broken && (
        <div className="paste-broken" role="status">
          <p className="paste-broken-text">
            The last edit broke a pasted block. Sending is held until you undo it or dismiss it.
          </p>
          <Button variant="ghost" size="fit" className="paste-chip-act flex-none" disabled={disabled}
            aria-label="Undo the edit that broke the pasted block" onClick={onUndo}>
            undo
          </Button>
          <Button variant="ghost" size="fit" className="paste-chip-act flex-none" disabled={disabled}
            aria-label="Dismiss the broken pasted block and keep the text as it shows" onClick={onDismiss}>
            dismiss
          </Button>
        </div>
      )}
      {chips.length > 0 && (
        <ul className="paste-chips" aria-label="Pasted text">
          {chips.map((c) => (
            <li key={c.at} className="paste-chip" title={c.head || undefined}>
              <span className="paste-chip-label">
                <span className="paste-chip-n">#{c.n}</span>
                <span className="paste-chip-lines">{linesWord(c.lines)}</span>
                {c.head !== '' && <span className="paste-chip-head">{c.head}</span>}
              </span>
              {/* The design system's ghost Button, at its 44px floor at every width (the chip grows to hold it). */}
              <Button
                variant="ghost"
                size="fit"
                className="paste-chip-act flex-none"
                aria-label={`Expand pasted text #${c.n}, ${linesWord(c.lines)}, into the message`}
                disabled={disabled}
                onClick={() => onExpand(c.at)}
              >
                expand
              </Button>
              <Button
                variant="ghost"
                size="fit"
                className="paste-chip-remove flex-none min-w-tap"
                aria-label={`Remove pasted text #${c.n}`}
                disabled={disabled}
                onClick={() => onRemove(c.at)}
              >
                <span aria-hidden="true">×</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

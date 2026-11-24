// The paste-chip row (desktop-polish wave 169): one chip per long paste the draft holds, above the field beside the
// attachment tray. The chip in the field (its label, `[Pasted text #N +L lines]`, between two invisible markers) is
// where the text sits; this row is where it is acted on. Expand puts the full text back into the field in place, as
// ordinary text; Remove takes the chip out of the field (its text stays in the draft's table, for an undo). While markers
// stand outside every chip (an edit the composer did not plan broke a block, markers came with no chip, or an undo
// brought back an old label), the row says so, with Undo last edit (one step of the browser's own, whatever the newest
// edit is) and Dismiss (the leftover markers go); the composer holds the send meanwhile. Ring L4: it renders what
// `liveChips` (pasteChips.ts, L1) listed and what the composer decided, and calls back, deciding nothing.
import type { ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import { BROKEN_NOTICE, linesWord, type LiveChip } from './pasteChips';
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

/** One worded act of the row (expand, undo, dismiss): the design system's ghost Button, at its 44px floor at every
 *  width (the chip grows to hold it), written once. */
function ChipAct({ label, disabled, onClick, children }: {
  label: string; disabled: boolean; onClick?: () => void; children: ReactNode;
}): ReactNode {
  return (
    <Button variant="ghost" size="fit" className="paste-chip-act flex-none" aria-label={label} disabled={disabled}
      onClick={onClick}>
      {children}
    </Button>
  );
}

export function PasteChipBar({
  chips, onExpand, onRemove, disabled = false, broken = false, onUndo, onDismiss,
}: PasteChipBarProps): ReactNode {
  if (chips.length === 0 && !broken) return null;
  return (
    <>
      {broken && (
        <div className="paste-broken" role="status">
          <p className="paste-broken-text">{BROKEN_NOTICE}</p>
          {/* One step of the browser's own undo, whatever the newest edit is: it says so. */}
          <ChipAct label="Undo last edit" disabled={disabled} onClick={onUndo}>
            undo last edit
          </ChipAct>
          <ChipAct label="Dismiss the markers and keep the text as it shows" disabled={disabled} onClick={onDismiss}>
            dismiss
          </ChipAct>
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
              <ChipAct label={`Expand pasted text #${c.n}, ${linesWord(c.lines)}, into the message`} disabled={disabled}
                onClick={() => onExpand(c.at)}>
                expand
              </ChipAct>
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

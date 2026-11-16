import type { ReactNode } from 'react';
import { OptionRow } from '@ccrc/ui';
import { PROVIDER_ROWS } from '../fleet/accountWords';
import type { Choice, DoorProvider } from './connectFlow';

/**
 * The connect sheet's first frame (spec §5, §12.3 frame 1; accounts plan Task A18): three `OptionRow`s. A provider
 * whose cap word the fleet does not advertise narrows in place, read-only, with its reason under its line; so does
 * every row while the screen is offline (`blocked`), whose sentence the sheet states once above the frames.
 */
export function ProviderFrame({ choices, blocked, onPick }: {
  choices: readonly Choice<DoorProvider>[];
  blocked: boolean;
  onPick: (p: DoorProvider) => void;
}): ReactNode {
  return (
    <div className="acct-frame" data-frame="provider">
      {choices.map((c) => {
        const row = PROVIDER_ROWS[c.value];
        const open = c.narrowed === null && !blocked;
        return (
          <OptionRow
            key={c.value}
            label={row.name}
            sublabel={row.line}
            disabled={!open || undefined}
            onClick={open ? () => onPick(c.value) : undefined}
            enter={open ? '›' : undefined}
          >
            {c.narrowed !== null && <span className="acct-narrowed">{c.narrowed}</span>}
          </OptionRow>
        );
      })}
    </div>
  );
}

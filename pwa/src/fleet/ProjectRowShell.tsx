// A PROJECT ROW's own chrome — the selection class, the chevron that marks
// it, and the name — with each picker's own tail after it.
//
// TWO PICKERS, ONE SELECTION VOCABULARY. `NewSessionSheet`'s project list and
// `StartProgramSheet`'s wrote the same four lines: the `proj-row` /
// `proj-row--selected` ternary, the glyph that is `❯` when selected and empty
// when not, and the name. What follows differs and stays each caller's —
// `NewSessionSheet` shows the project's pool then its directory,
// `StartProgramSheet` shows the directory then the program-readiness chips.
//
// THE BLOCK CENSUS COULD NOT SEE IT, correctly: its signature is the WHOLE
// tree, and these two trees differ from the third child down. What was copied
// is a shared HEAD under two different tails — which the literal half could
// not see either, because it reads `className=` attributes and the selection
// is a ternary. The literal census that found it reads string literals
// wherever they appear.
//
// The classes stay `proj-*`: fleet.css grounds them, and `fleet-css.test.ts`
// pins `.proj-row--selected`'s own ink. The shape moves, the ground stays.
import type { ReactNode } from 'react';
import { ListRow } from '@ccrc/ui';
import './fleet.css';

export function ProjectRowShell({ selected, name, onPick, children }: {
  selected: boolean;
  name: string;
  onPick: () => void;
  /** This picker's own tail — pool, directory, readiness. */
  children: ReactNode;
}): ReactNode {
  return (
    <ListRow
      className={selected ? 'proj-row proj-row--selected' : 'proj-row'}
      onClick={onPick}
    >
      <span className="proj-glyph" aria-hidden="true">{selected ? '❯' : ''}</span>
      <span className="proj-name">{name}</span>
      {children}
    </ListRow>
  );
}

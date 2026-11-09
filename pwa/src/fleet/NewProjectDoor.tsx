// The fleet screen's "New project" door (add-project spec 2026-11-04 §2, as redrawn): where the eye looks for it, just
// above the list it adds to, instead of a quiet row under the last card. Placed by `FleetScreen`, not a skin's part, so
// every skin has it.
//
// IT COSTS NO HEIGHT WHERE THE RUNS LINE IS DRAWN (`inline`): it rides that line, beside the class chooser, for the
// chooser's own reason (the line is full-width and nearly empty). A row of its own pushed the first session row past
// the phone's budget (`refined-phone.browser.test.ts`, 440 px at 390×844). Where no runs line is drawn (Instrument's
// desk column) it is a row of its own, at the row's end.
import type { ReactNode } from 'react';
import { Button, Icon } from '@ccrc/ui';
import { PROJECT_ADD_TEXT } from './projectAddWords';
import './fleet.css';

export function NewProjectDoor({ inline, onNewProject }: { inline: boolean; onNewProject: () => void }): ReactNode {
  const door = (
    <Button variant="ghost" size="fit" className="fleet-new-project flex-none gap-1" onClick={onNewProject}>
      <Icon name="plus" />
      {PROJECT_ADD_TEXT.open}
    </Button>
  );
  return inline ? door : <div className="fleet-projects-head flex justify-end">{door}</div>;
}

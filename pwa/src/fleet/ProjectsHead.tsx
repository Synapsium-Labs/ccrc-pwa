// The head over the fleet list (add-project spec 2026-11-04 §2, as redrawn): the "New project" door where the eye looks
// for it, at the top of the list it adds to, instead of a quiet row under the last card. Placed by `FleetScreen`, not a
// skin's part, so every skin has it. Over the shared project cards it names them ("Projects"); over a skin's own list
// (Instrument's status-grouped table, whose groups are not projects) it is the door alone, at the row's end.
import type { ReactNode } from 'react';
import { Button, Icon } from '@ccrc/ui';
import { PROJECT_ADD_TEXT } from './projectAddWords';
import './fleet.css';

export function ProjectsHead({ named, onNewProject }: { named: boolean; onNewProject: () => void }): ReactNode {
  return (
    <div className="fleet-projects-head flex items-center gap-2">
      {named && <h2 className="fleet-projects-title m-0 min-w-0 flex-auto">{PROJECT_ADD_TEXT.projectsHead}</h2>}
      <Button variant="ghost" size="fit" className="ms-auto flex-none gap-1" onClick={onNewProject}>
        <Icon name="plus" />
        {PROJECT_ADD_TEXT.open}
      </Button>
    </div>
  );
}

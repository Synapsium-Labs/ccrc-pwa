// The sheet the fleet screen's "New project" doors open (add-project spec 2026-11-04 §2): clone a GitHub repository, or
// start an empty one, as a new project under the projects root on the fleet box. The form is `AddProjectForm`'s, shared
// with the new-session sheet's inline add; this file is the host: a sheet, its pinned confirm, and the success toast,
// whose action starts a session in the new project (`onStartSession`). Mounted at screen level beside the other sheets
// (`FleetFlows`).
import type { ReactNode } from 'react';
import { Button, QC_ACTIONS, Sheet, toast } from '@ccrc/ui';
import type { ProjectAddBody } from '../../../shared/projectAdd';
import type { ProjectAddOutcome } from './useProjectRows';
import { useProjectAddForm } from './AddProjectForm';
import { PROJECT_ADD_TEXT, projectAddedText } from './projectAddWords';
import './fleet.css';

export interface AddProjectSheetProps {
  open: boolean;
  onClose: () => void;
  /** `useProjectRows.addProject`: owns the in-flight guard and the refresh. */
  add: (body: ProjectAddBody) => Promise<ProjectAddOutcome>;
  /** Whether an add is in flight. */
  adding: boolean;
  /** The success toast's action: opens the new-session sheet on the project just added. Absent: a toast with no action. */
  onStartSession?: (project: string) => void;
}

export function AddProjectSheet({ open, onClose, add, adding, onStartSession }: AddProjectSheetProps): ReactNode {
  const form = useProjectAddForm({
    active: open,
    add,
    adding,
    onAdded: (added, dismissed) => {
      // True with or without the sheet, so a success that lands after a dismissal is said too, with its action.
      const text = projectAddedText(added.name, added.source);
      if (onStartSession === undefined) toast(text);
      else toast(text, 'info', { label: PROJECT_ADD_TEXT.startSession, onClick: () => onStartSession(added.name) });
      if (!dismissed) onClose();
    },
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow={PROJECT_ADD_TEXT.eyebrow}
      title={PROJECT_ADD_TEXT.title}
      footer={
        <div className={QC_ACTIONS}>
          <Button variant="primary" disabled={adding} onClick={form.submit}>{form.confirmLabel}</Button>
          <Button variant="ghost" onClick={onClose}>{PROJECT_ADD_TEXT.cancel}</Button>
        </div>
      }
    >
      {form.fields}
    </Sheet>
  );
}

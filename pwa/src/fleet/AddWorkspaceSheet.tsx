// The sheet the project card's `+` opens (named workspaces S7, design 2026-10-20 §2.2). `+` used to create at once;
// it now asks, because the create is irreversible and the slug is chosen for life. Two taps still add an
// automatically named workspace (`+`, then Add workspace), with no keyboard: the field never autofocuses.
//
// WHAT EACH CASE SENDS.
//   * An empty field: `add(project)` and nothing else. The request is today's, byte for byte (the class the
//     chooser holds rides in it, as before): `useProjectRows.addWorkspace` owns that, and `api.workspaceAdd` sends no
//     name for a blank one.
//   * A name: `add(project, { name })`. No account is chosen at this door (the box places it, the line above the
//     confirm says where), so no wrapper rides.
//   * A refused name: the confirm is disabled and NOTHING is sent.
//
// EVERY REFUSAL STAYS IN THE SHEET, with the operator's text intact (`classifyAddError` / `addRefusalText`): a 409
// naming a taken slug, ccd's own reason, a box whose ccd is too old. Success closes it; the new row arrives over the
// fleet stream. Mounted at screen level beside the other sheets (`FleetFlows`), never inside a card.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { RosterWire } from '../../../shared/api';
import { Button, Sheet, toast } from '@ccrc/ui';
import { navigate } from '../lib/router';
import { NAME_FIELD_CLASS, WorkspaceNameField } from './WorkspaceNameField';
import { useNamePreview } from './useNamePreview';
import { landsOnLine, type ProjectPlacementRead } from './placementWords';
import { useProjectedHome } from './useProjectedHome';
import type { AddOutcome } from './useProjectRows';
import { addRefusalText, classifyAddError } from './workspaceAddWords';
import { LINEAR_SETTINGS_PATH } from './workspaceNameWords';
import './fleet.css';

export const ADD_WORKSPACE_TEXT = {
  eyebrow: 'new workspace',
  empty: 'Add workspace',
  adding: 'Adding…',
  cancel: 'Cancel',
  emptyHint: 'Leave empty for an automatic name.',
} as const;

export interface AddWorkspaceSheetProps {
  /** The project whose `+` was tapped; `null` is closed. */
  project: string | null;
  onClose: () => void;
  /** `useProjectRows.addWorkspace`: owns the class the chooser holds, the in-flight set and the refresh. */
  add: (project: string, opts?: { name?: string }) => Promise<AddOutcome>;
  /** Whether a create for this project is in flight (the card's own `+` reads the same set). */
  adding: boolean;
  /** This project's placement read, for the "lands on" line. */
  placement: ProjectPlacementRead;
  roster: readonly RosterWire[];
}

export function AddWorkspaceSheet({ project, onClose, add, adding, placement, roster }: AddWorkspaceSheetProps): ReactNode {
  const open = project !== null;
  // The project survives vaul's exit animation: the sheet is closed by `project` turning null, and its title must
  // not go blank while it slides away.
  const shown = useRef<string>('');
  if (project !== null) shown.current = project;
  const name = project ?? shown.current;

  const projected = useProjectedHome(open);
  const [value, setValue] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  // A create answers after its sheet was closed (Cancel, scrim, Escape): its words are for a sheet that is gone, and
  // the next opening must not inherit them. Bumped on every close.
  const generation = useRef(0);

  const preview = useNamePreview(value);

  // A closed sheet forgets: reopening starts with an empty field and no refusal. `vaul` unmounts the panel on
  // `open={false}`, so this lives in the parent, not in a child that would be unmounted with it.
  useEffect(() => {
    if (open) return;
    generation.current += 1;
    setValue('');
    setRefusal(null);
  }, [open]);

  const edit = (next: string): void => {
    setValue(next);
    setRefusal(null);
  };

  /** The confirm's own gate, and Enter's: a refused name sends nothing, and a create in flight is not asked twice. */
  const canSubmit = preview.kind !== 'refused' && !adding;

  const submit = async (): Promise<void> => {
    // No guard for `adding` or a refused name here: the confirm is DISABLED for both (the only way to submit), and a
    // second request for a project in flight is `addWorkspace`'s own `busy`.
    if (project === null) return;
    const mine = generation.current;
    setRefusal(null);
    const outcome = await add(project, preview.kind === 'named' ? { name: value } : {});
    if (outcome.kind === 'busy') return;
    const dismissed = mine !== generation.current;
    const failure = outcome.kind === 'refused'
      ? addRefusalText(classifyAddError(outcome.error), { door: 'plus', project, slug: preview.kind === 'named' ? preview.slug : null, roster, dismissed })
      : null;
    if (dismissed) {
      // The sheet was dismissed while the request was in flight: its words have no sheet to sit in, and the next opening
      // must not inherit them, so a refusal is said once, as an error toast, in the words that are true without the
      // sheet (its text is NOT kept). A create that landed needs none (the board shows it).
      if (failure !== null) toast(failure, 'error');
      return;
    }
    if (outcome.kind === 'added') {
      if (outcome.answer.named) toast(`Added ${outcome.answer.title}`);
      onClose();
      return;
    }
    setRefusal(failure);
  };

  const lands = landsOnLine(placement, projected, roster);
  const goSettings = (): void => { onClose(); navigate(LINEAR_SETTINGS_PATH); };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow={ADD_WORKSPACE_TEXT.eyebrow}
      title={`Add a workspace to ${name}`}
      footer={
        // `NAME_FIELD_CLASS.confirmRow` is `QC_ACTIONS` with a `minmax(0, 1fr)` column, so a long name's confirm cannot push
        // past the panel (its own comment has the measurement).
        <div className={NAME_FIELD_CLASS.confirmRow}>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {/* A long name is cut with an ellipsis, never wrapped: the confirm stays one line and whole. */}
            {/* ONE LABEL WHATEVER IS TYPED (design §2.2: "Add workspace"): the title the operator typed is the preview's
                line above, and a refused name is told in the sentence under the field, not on a dimmed button. */}
            <span className={NAME_FIELD_CLASS.confirmLabel}>{adding ? ADD_WORKSPACE_TEXT.adding : ADD_WORKSPACE_TEXT.empty}</span>
          </Button>
          <Button variant="ghost" onClick={onClose}>{ADD_WORKSPACE_TEXT.cancel}</Button>
        </div>
      }
    >
      <div className={NAME_FIELD_CLASS.sheetBody}>
        {lands !== null && <p className={NAME_FIELD_CLASS.hint}>{lands}</p>}
        <WorkspaceNameField
          value={value}
          onChange={edit}
          preview={preview}
          project={name}
          emptyHint={ADD_WORKSPACE_TEXT.emptyHint}
          locked={adding}
          onSubmit={() => { if (canSubmit) void submit(); }}
          onOpenSettings={goSettings}
        />
        {refusal !== null && <p role="alert" className={NAME_FIELD_CLASS.refusal}>{refusal}</p>}
      </div>
    </Sheet>
  );
}

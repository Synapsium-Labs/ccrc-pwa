// The sheet the fleet screen's "Add project" row opens (add-project spec 2026-11-04 §2): clone a GitHub repository, or
// start an empty one, as a new project under the projects root on the fleet box. On `AddWorkspaceSheet`'s model: the
// fields never autofocus (a phone's keyboard stays down), a closed sheet forgets (vaul unmounts the panel, so the reset
// lives here), a refusal stays in the sheet with the operator's text intact, and an answer that lands after a dismissal
// is said once as a toast, never inside the next opening (the generation guard).
//
// WHAT IT DECIDES IS `projectAddWords.ts`'s (`formVerdict`, `prefillName`, the sentences); this file only holds the
// form and acts on the verdict. The name follows the repository as it is typed until the operator edits it by hand
// (clearing it hands it back to the repository). A hint shows only after a blur or a submit, so the form stays calm
// while the operator types. Mounted at screen level beside the other sheets (`FleetFlows`).
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, QC_ACTIONS, RadioFieldset, Sheet, toast } from '@ccrc/ui';
import type { ProjectAddBody, ProjectAddSource } from '../../../shared/projectAdd';
import type { ProjectAddOutcome } from './useProjectRows';
import { NAME_FIELD_CLASS, PlainTextField } from './WorkspaceNameField';
import { PROJECT_ADD_TEXT, formVerdict, prefillName, projectAddRefusalText, projectAddedText } from './projectAddWords';
import './fleet.css';

export interface AddProjectSheetProps {
  open: boolean;
  onClose: () => void;
  /** `useProjectRows.addProject`: owns the in-flight guard and the refresh. */
  add: (body: ProjectAddBody) => Promise<ProjectAddOutcome>;
  /** Whether an add is in flight. */
  adding: boolean;
  /** The fleet has no sessions, so the screen is the first-run panel and shows no project card: the success toast says
   *  where to start a session in the new project. */
  firstRun?: boolean;
}

/** The form's grid, with a block-end gutter of the focus ring's reach (`--sp-1`, as the sheet body's inline one): the
 *  sheet body scrolls, so it clips, and a focused field that is the form's last child would lose its ring's bottom edge. */
const FORM_CLASS = `${NAME_FIELD_CLASS.sheetBody} pb-1`;

const SOURCES: { value: ProjectAddSource; label: string }[] = [
  { value: 'github', label: PROJECT_ADD_TEXT.github },
  { value: 'empty', label: PROJECT_ADD_TEXT.empty },
];

const NO_HINTS = { repo: false, name: false };

export function AddProjectSheet({ open, onClose, add, adding, firstRun = false }: AddProjectSheetProps): ReactNode {
  const [source, setSource] = useState<ProjectAddSource>('github');
  const [repo, setRepo] = useState('');
  const [name, setName] = useState('');
  /** The operator typed the name: the repository stops prefilling it. */
  const [named, setNamed] = useState(false);
  /** Which fields have earned their hint (a blur, or a submit for both). */
  const [shown, setShown] = useState(NO_HINTS);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Bumped on every close: an answer issued under an older generation belongs to a sheet that is gone.
  const generation = useRef(0);

  useEffect(() => {
    if (open) return;
    generation.current += 1;
    setSource('github');
    setRepo('');
    setName('');
    setNamed(false);
    setShown(NO_HINTS);
    setRefusal(null);
  }, [open]);

  const plan = formVerdict({ source, repo, name });
  const repoHint = shown.repo && plan.kind === 'hold' ? plan.repo : null;
  const nameHint = shown.name && plan.kind === 'hold' ? plan.name : null;

  const editRepo = (next: string): void => {
    setRepo(next);
    setRefusal(null);
    if (!named) setName(prefillName(next));
  };
  const editName = (next: string): void => {
    setName(next);
    setNamed(next.trim() !== '');
    setRefusal(null);
  };
  const pick = (next: ProjectAddSource): void => {
    setSource(next);
    setRefusal(null);
  };

  const submit = async (): Promise<void> => {
    if (adding) return;
    if (plan.kind === 'hold') {
      setShown({ repo: true, name: true });
      return;
    }
    const mine = generation.current;
    setRefusal(null);
    const outcome = await add(plan.body);
    if (outcome.kind === 'busy') return;
    const dismissed = mine !== generation.current;
    if (outcome.kind === 'added') {
      // True with or without the sheet, so a success that lands after a dismissal is said too.
      const said = outcome.answer === 'unreadable' ? { name: plan.name, source: plan.body.source } : outcome.answer;
      toast(projectAddedText(said.name, said.source, { firstRun }));
      if (!dismissed) onClose();
      return;
    }
    const text = projectAddRefusalText(outcome.error, plan.body.source);
    if (dismissed) toast(text, 'error');
    else setRefusal(text);
  };
  const onEnter = (): void => { void submit(); };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow={PROJECT_ADD_TEXT.eyebrow}
      title={PROJECT_ADD_TEXT.add}
      footer={
        <div className={QC_ACTIONS}>
          <Button variant="primary" disabled={adding} onClick={onEnter}>
            {!adding ? PROJECT_ADD_TEXT.add : source === 'github' ? PROJECT_ADD_TEXT.cloning : PROJECT_ADD_TEXT.creating}
          </Button>
          <Button variant="ghost" onClick={onClose}>{PROJECT_ADD_TEXT.cancel}</Button>
        </div>
      }
    >
      <div className={adding ? `${FORM_CLASS} ${NAME_FIELD_CLASS.locked}` : FORM_CLASS} data-locked={adding ? 'true' : undefined}>
        <RadioFieldset legend={PROJECT_ADD_TEXT.source} name="project-add-source" options={SOURCES} value={source} onPick={pick} disabled={adding} />
        {source === 'github' && (
          <ProjectAddField
            label={PROJECT_ADD_TEXT.repo}
            value={repo}
            placeholder={PROJECT_ADD_TEXT.repoPlaceholder}
            hint={repoHint}
            locked={adding}
            onChange={editRepo}
            onBlur={() => setShown((s) => ({ ...s, repo: true }))}
            onEnter={onEnter}
          />
        )}
        <ProjectAddField
          label={PROJECT_ADD_TEXT.name}
          value={name}
          hint={nameHint}
          locked={adding}
          onChange={editName}
          onBlur={() => setShown((s) => ({ ...s, name: true }))}
          onEnter={onEnter}
        />
        {adding && source === 'github' && <p role="status" className={NAME_FIELD_CLASS.hint}>{PROJECT_ADD_TEXT.cloningNote}</p>}
        {refusal !== null && <p role="alert" className={NAME_FIELD_CLASS.refusal}>{refusal}</p>}
      </div>
    </Sheet>
  );
}

interface ProjectAddFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  /** The calm hint under the field, or `null` for none. */
  hint: string | null;
  locked: boolean;
  onChange: (next: string) => void;
  onBlur: () => void;
  onEnter: () => void;
}

/** One labelled line of the form (`PlainTextField`: a repository and a project name are not prose), with its hint. */
function ProjectAddField({ label, value, placeholder, hint, locked, onChange, onBlur, onEnter }: ProjectAddFieldProps): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={NAME_FIELD_CLASS.stack}>
      <PlainTextField
        id={id}
        label={label}
        value={value}
        placeholder={placeholder}
        disabled={locked}
        aria-invalid={hint !== null ? true : undefined}
        aria-describedby={hint !== null ? hintId : undefined}
        onChange={onChange}
        onBlur={onBlur}
        onEnter={onEnter}
      />
      {hint !== null && <p id={hintId} className={NAME_FIELD_CLASS.hint}>{hint}</p>}
    </div>
  );
}

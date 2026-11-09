// The Add project FORM (add-project spec 2026-11-04 §2), one form with two hosts: `AddProjectSheet` (the fleet screen's
// "New project" door) and the new-session sheet's inline add (its "New project" row and its search offers). Moved here
// from `AddProjectSheet` so the two hosts share the state, the guards and the words rather than each keeping a copy.
//
// On `AddWorkspaceSheet`'s model: the fields never autofocus (a phone's keyboard stays down), a host that stops showing
// the form (`active` false) makes it forget, a refusal stays in the form with the operator's text intact, and an answer
// that lands after the form went away is said once as a toast, never inside the next opening (the generation guard).
//
// WHAT IT DECIDES IS `projectAddWords.ts`'s (`formVerdict`, `prefillName`, the sentences); this file only holds the
// form and acts on the verdict. The name follows the repository as it is typed until the operator edits it by hand
// (clearing it hands it back to the repository). A hint shows only after a blur or a submit, so the form stays calm
// while the operator types.
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RadioFieldset, toast } from '@ccrc/ui';
import type { ProjectAddBody, ProjectAddSource } from '../../../shared/projectAdd';
import type { ProjectAddOutcome } from './useProjectRows';
import { NAME_FIELD_CLASS, PlainTextField } from './WorkspaceNameField';
import { PROJECT_ADD_TEXT, formVerdict, prefillName, projectAddRefusalText, type ProjectAddForm } from './projectAddWords';
import './fleet.css';

/** The project an add made, as said to the operator: the server's echo, or what the form sent when the echo was
 *  unreadable (the project WAS added). */
export interface ProjectAdded { name: string; source: ProjectAddSource }

export interface ProjectAddFormHost {
  /** Whether the host is showing the form. Going false forgets the form and orphans an answer still in flight. */
  active: boolean;
  /** `useProjectRows.addProject`: owns the in-flight guard and the refresh. */
  add: (body: ProjectAddBody) => Promise<ProjectAddOutcome>;
  /** Whether an add is in flight. */
  adding: boolean;
  /** A success. `dismissed`: the form went away while it ran, so the host says it without acting on a form that is
   *  gone. */
  onAdded: (added: ProjectAdded, dismissed: boolean) => void;
}

export interface ProjectAddFormState {
  source: ProjectAddSource;
  /** The confirm's label: "Add project", or what is running. */
  confirmLabel: string;
  /** Sends what the form holds (or reveals every hint when it holds back). */
  submit: () => void;
  /** Fills the form (the search offers' prefill) and, with `send`, submits that form at once. */
  fill: (form: ProjectAddForm, opts?: { send?: boolean }) => void;
  /** The fields, the progress note and the refusal, for the host to place. */
  fields: ReactNode;
}

const EMPTY_FORM: ProjectAddForm = { source: 'github', repo: '', name: '' };
const NO_HINTS = { repo: false, name: false };

const SOURCES: { value: ProjectAddSource; label: string }[] = [
  { value: 'github', label: PROJECT_ADD_TEXT.github },
  { value: 'empty', label: PROJECT_ADD_TEXT.empty },
];

/** The form's grid, with a block-end gutter of the focus ring's reach (`--sp-1`, as the sheet body's inline one): the
 *  sheet body scrolls, so it clips, and a focused field that is the form's last child would lose its ring's bottom edge. */
const FORM_CLASS = `${NAME_FIELD_CLASS.sheetBody} pb-1`;

export function useProjectAddForm({ active, add, adding, onAdded }: ProjectAddFormHost): ProjectAddFormState {
  const [form, setForm] = useState<ProjectAddForm>(EMPTY_FORM);
  /** The operator typed the name: the repository stops prefilling it. */
  const [named, setNamed] = useState(false);
  /** Which fields have earned their hint (a blur, or a submit for both). */
  const [shown, setShown] = useState(NO_HINTS);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Bumped whenever the form stops showing: an answer issued under an older generation belongs to a form that is gone.
  const generation = useRef(0);

  useEffect(() => {
    if (active) return;
    generation.current += 1;
    setForm(EMPTY_FORM);
    setNamed(false);
    setShown(NO_HINTS);
    setRefusal(null);
  }, [active]);

  const plan = formVerdict(form);
  const repoHint = shown.repo && plan.kind === 'hold' ? plan.repo : null;
  const nameHint = shown.name && plan.kind === 'hold' ? plan.name : null;

  const send = async (sent: ProjectAddForm): Promise<void> => {
    if (adding) return;
    const verdict = formVerdict(sent);
    if (verdict.kind === 'hold') {
      setShown({ repo: true, name: true });
      return;
    }
    const mine = generation.current;
    setRefusal(null);
    const outcome = await add(verdict.body);
    if (outcome.kind === 'busy') return;
    const dismissed = mine !== generation.current;
    if (outcome.kind === 'added') {
      // True with or without the form, so a success that lands after a dismissal is said too.
      onAdded(outcome.answer === 'unreadable' ? { name: verdict.name, source: verdict.body.source } : outcome.answer, dismissed);
      return;
    }
    const text = projectAddRefusalText(outcome.error, verdict.body.source);
    if (dismissed) toast(text, 'error');
    else setRefusal(text);
  };

  const submit = (): void => { void send(form); };
  const fill = (next: ProjectAddForm, opts: { send?: boolean } = {}): void => {
    setForm(next);
    setNamed(next.name.trim() !== '');
    setShown(NO_HINTS);
    setRefusal(null);
    if (opts.send === true) void send(next);
  };

  const editRepo = (repo: string): void => {
    setForm((f) => ({ ...f, repo, name: named ? f.name : prefillName(repo) }));
    setRefusal(null);
  };
  const editName = (name: string): void => {
    setForm((f) => ({ ...f, name }));
    setNamed(name.trim() !== '');
    setRefusal(null);
  };
  const pick = (source: ProjectAddSource): void => {
    setForm((f) => ({ ...f, source }));
    setRefusal(null);
  };

  const confirmLabel = !adding
    ? PROJECT_ADD_TEXT.add
    : form.source === 'github' ? PROJECT_ADD_TEXT.cloning : PROJECT_ADD_TEXT.creating;

  const fields = (
    <div className={adding ? `${FORM_CLASS} ${NAME_FIELD_CLASS.locked}` : FORM_CLASS} data-locked={adding ? 'true' : undefined}>
      <RadioFieldset legend={PROJECT_ADD_TEXT.source} name="project-add-source" options={SOURCES} value={form.source} onPick={pick} disabled={adding} />
      {form.source === 'github' && (
        <ProjectAddField
          label={PROJECT_ADD_TEXT.repo}
          value={form.repo}
          placeholder={PROJECT_ADD_TEXT.repoPlaceholder}
          hint={repoHint}
          locked={adding}
          onChange={editRepo}
          onBlur={() => setShown((s) => ({ ...s, repo: true }))}
          onEnter={submit}
        />
      )}
      <ProjectAddField
        label={PROJECT_ADD_TEXT.name}
        value={form.name}
        hint={nameHint}
        locked={adding}
        onChange={editName}
        onBlur={() => setShown((s) => ({ ...s, name: true }))}
        onEnter={submit}
      />
      {adding && form.source === 'github' && <p role="status" className={NAME_FIELD_CLASS.hint}>{PROJECT_ADD_TEXT.cloningNote}</p>}
      {refusal !== null && <p role="alert" className={NAME_FIELD_CLASS.refusal}>{refusal}</p>}
    </div>
  );

  return { source: form.source, confirmLabel, submit, fill, fields };
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

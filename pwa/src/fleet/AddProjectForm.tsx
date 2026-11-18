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
import { OptionRow, RadioFieldset, Select, toast } from '@ccrc/ui';
import { HIERARCHY_TEXT, coordinatorWords } from './hierarchyWords';
import type { ProjectAddBody, ProjectAddSource } from '../../../shared/projectAdd';
import type { ProjectAddOutcome } from './useProjectRows';
import { NAME_FIELD_CLASS, PlainTextField } from './WorkspaceNameField';
import {
  LINKING_ADD_TEXT, PROJECT_ADD_TEXT, formVerdict, prefillName, projectAddRefusalText, type LinkingChoice, type ProjectAddForm,
} from './projectAddWords';
import './fleet.css';

/** The project an add made, as said to the operator: the server's echo, or what the form sent when the echo was
 *  unreadable (the project WAS added). */
export interface ProjectAdded {
  name: string;
  source: ProjectAddSource;
  /** What the linking fields held when the form sent (D-8147); only a host that shows them (`linking`) gets it. */
  linking?: LinkingChoice;
}

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
  /** Show the two optional linking fields (D-8147): a Linear team key, and for a clone the template pull request. The
   *  add-project sheet only; the new-session sheet's inline add leaves it off and shows neither. */
  linking?: boolean;
  /** The coordinators the owner select offers (D-8184), read when the form opens, as the follow-up acts are injected; absent: no owner field. */
  loadCoordinators?: () => Promise<readonly { id: string; live: boolean }[]>;
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

export function useProjectAddForm({ active, add, adding, onAdded, linking = false, loadCoordinators }: ProjectAddFormHost): ProjectAddFormState {
  const [form, setForm] = useState<ProjectAddForm>(EMPTY_FORM);
  /** The operator typed the name: the repository stops prefilling it. */
  const [named, setNamed] = useState(false);
  /** Which fields have earned their hint (a blur, or a submit for both). */
  const [shown, setShown] = useState(NO_HINTS);
  const [refusal, setRefusal] = useState<string | null>(null);
  /** The linking fields (D-8147), held beside the form: the key as typed (upper-cased) and the template box. */
  const [teamKey, setTeamKey] = useState('');
  const [template, setTemplate] = useState(false);
  /** The hierarchy fields (D-8184): the owner chosen (empty: the default), the initiatives toggle, and the coordinators to choose from. */
  const [owner, setOwner] = useState('');
  const [initiatives, setInitiatives] = useState(true);
  const [coordinators, setCoordinators] = useState<readonly { id: string; live: boolean }[] | 'unread'>([]);
  const ownerId = useId();
  // Bumped whenever the form stops showing: an answer issued under an older generation belongs to a form that is gone.
  const generation = useRef(0);

  useEffect(() => {
    if (!active || !linking || loadCoordinators === undefined) return;
    let live = true;
    loadCoordinators().then((c) => { if (live) setCoordinators(c); }, () => { if (live) setCoordinators('unread'); });
    return () => { live = false; };
  }, [active, linking, loadCoordinators]);

  useEffect(() => {
    if (active) return;
    generation.current += 1;
    setForm(EMPTY_FORM);
    setNamed(false);
    setShown(NO_HINTS);
    setRefusal(null);
    setTeamKey('');
    setTemplate(false);
    setOwner('');
    setInitiatives(true);
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
    // What the linking fields hold NOW goes with the add: the form may be reset before the answer lands.
    const key = teamKey.trim().toUpperCase();
    const choice: LinkingChoice = { teamKey: key === '' ? null : key, template: verdict.body.source === 'github' && template, owner: owner === '' ? null : owner, initiativesOff: !initiatives };
    const outcome = await add(verdict.body);
    if (outcome.kind === 'busy') return;
    const dismissed = mine !== generation.current;
    if (outcome.kind === 'added') {
      // True with or without the form, so a success that lands after a dismissal is said too.
      const added = outcome.answer === 'unreadable' ? { name: verdict.name, source: verdict.body.source } : outcome.answer;
      onAdded(linking ? { ...added, linking: choice } : added, dismissed);
      return;
    }
    const text = projectAddRefusalText(outcome.error, verdict.body.source);
    if (dismissed) toast(text, 'error');
    else setRefusal(text);
  };

  const submit = (): void => { void send(form); };
  const fill = (next: ProjectAddForm, opts: { send?: boolean } = {}): void => {
    setForm(next);
    // A name the repository suggests is not one typed by hand: it keeps following the repository.
    setNamed(next.name.trim() !== '' && next.name !== prefillName(next.repo));
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
      {linking && (
        <>
          <ProjectAddField
            label={LINKING_ADD_TEXT.teamKey}
            value={teamKey}
            hint={null}
            locked={adding}
            onChange={(next) => setTeamKey(next.toUpperCase())}
            onBlur={() => undefined}
            onEnter={submit}
          />
          {coordinators === 'unread' && <p role="status" className={NAME_FIELD_CLASS.hint}>{LINKING_ADD_TEXT.ownersUnread}</p>}
          {coordinators !== 'unread' && coordinators.length > 0 && (
            <div className="grid gap-1">
              <label htmlFor={ownerId} className={NAME_FIELD_CLASS.hint}>{LINKING_ADD_TEXT.owner}</label>
              <Select id={ownerId} value={owner} disabled={adding} onChange={(e) => setOwner(e.target.value)}>
                <option value="">{LINKING_ADD_TEXT.ownerDefault}</option>
                {coordinators.map((c) => <option key={c.id} value={c.id}>{coordinatorWords(c)}</option>)}
              </Select>
            </div>
          )}
          <OptionRow label={HIERARCHY_TEXT.initiatives} checked={initiatives} disabled={adding} onClick={() => setInitiatives((v) => !v)} />
          {form.source === 'github' && (
            <OptionRow label={LINKING_ADD_TEXT.template} checked={template} disabled={adding} onClick={() => setTemplate((t) => !t)} />
          )}
        </>
      )}
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

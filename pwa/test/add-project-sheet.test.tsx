// The sheet the fleet screen's "New project" doors open (add-project spec 2026-11-04 §2). It is driven the way the screen
// drives it: `open` true is open, false is closed, and a close is a `rerender` (vaul unmounts the panel at
// `open={false}`, so a reset that lived inside it would never run). `fireEvent`, not `userEvent`: vaul's drag handler
// raises unhandled errors under `userEvent`'s pointer sequence (`add-workspace-sheet.test.tsx` says the same).
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import { AddProjectSheet, type AddProjectSheetProps } from '../src/fleet/AddProjectSheet';
import { PROJECT_ADD_HINT, PROJECT_ADD_REFUSAL_TEXT, PROJECT_ADD_TEXT, projectAddedText } from '../src/fleet/projectAddWords';
import type { ProjectAddOutcome } from '../src/fleet/useProjectRows';
import { ApiError } from '../src/lib/apiError';
import { api } from '../src/lib/api';
import { useProjectAddForm } from '../src/fleet/AddProjectForm';
import { LINKING_REFUSAL_TEXT } from '../src/lib/refusalWords';
import { LINKING_ADD_TEXT } from '../src/fleet/projectAddWords';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const added = (name: string, source: 'github' | 'empty' = 'github'): ProjectAddOutcome =>
  ({ kind: 'added', answer: { ok: true, name, source } });
const refuse = (status: number, body: unknown): ProjectAddOutcome => ({ kind: 'refused', error: new ApiError(status, body) });

const props = (over: Partial<AddProjectSheetProps> = {}): AddProjectSheetProps => ({
  open: true,
  onClose: vi.fn(),
  add: vi.fn().mockResolvedValue(added('repo')),
  adding: false,
  ...over,
});

const mount = (p: AddProjectSheetProps) => render(<><ToastHost /><AddProjectSheet {...p} /></>);
const rerenderWith = (r: ReturnType<typeof mount>, p: AddProjectSheetProps): void => {
  r.rerender(<><ToastHost /><AddProjectSheet {...p} /></>);
};

const repoField = (): HTMLInputElement => screen.getByLabelText(PROJECT_ADD_TEXT.repo) as HTMLInputElement;
const nameField = (): HTMLInputElement => screen.getByLabelText(PROJECT_ADD_TEXT.name) as HTMLInputElement;
const typeIn = (el: HTMLInputElement, text: string): void => { fireEvent.change(el, { target: { value: text } }); };
const confirm = (): HTMLElement => screen.getByRole('button', { name: PROJECT_ADD_TEXT.add });
const pickEmpty = (): void => { fireEvent.click(screen.getByLabelText(PROJECT_ADD_TEXT.empty)); };

describe('opening', () => {
  it('opens on From GitHub with both fields, and sends nothing', () => {
    const p = props();
    mount(p);
    expect(screen.getByText(PROJECT_ADD_TEXT.title, { selector: 'h2' })).toBeInTheDocument();
    expect((screen.getByLabelText(PROJECT_ADD_TEXT.github) as HTMLInputElement).checked).toBe(true);
    expect(repoField().value).toBe('');
    expect(nameField().value).toBe('');
    expect(p.add).not.toHaveBeenCalled();
  });

  it('is closed when not open', () => {
    mount(props({ open: false }));
    expect(screen.queryByLabelText(PROJECT_ADD_TEXT.repo)).not.toBeInTheDocument();
  });

  it('never autofocuses a field, so a phone\'s keyboard stays down', async () => {
    mount(props());
    await screen.findByLabelText(PROJECT_ADD_TEXT.repo);
    expect(document.activeElement?.tagName).not.toBe('INPUT');
  });

  it('the Empty choice hides the repository field', () => {
    mount(props());
    pickEmpty();
    expect(screen.queryByLabelText(PROJECT_ADD_TEXT.repo)).not.toBeInTheDocument();
    expect(nameField()).toBeInTheDocument();
  });
});

describe('the name follows the repository until the operator names it', () => {
  it('prefills the name as the repository is typed', () => {
    mount(props());
    typeIn(repoField(), 'example/re');
    expect(nameField().value).toBe('re');
    typeIn(repoField(), 'https://github.com/example/repo.git');
    expect(nameField().value).toBe('repo');
  });

  it('stops following once the name is edited by hand, and follows again after it is cleared', () => {
    mount(props());
    typeIn(repoField(), 'example/repo');
    typeIn(nameField(), 'project-a');
    typeIn(repoField(), 'example/other');
    expect(nameField().value).toBe('project-a');
    typeIn(nameField(), '');
    typeIn(repoField(), 'example/third');
    expect(nameField().value).toBe('third');
  });
});

describe('calm hints', () => {
  it('says nothing while the repository is being typed, and the hint after a blur', () => {
    mount(props());
    typeIn(repoField(), 'not a repo');
    expect(screen.queryByText(PROJECT_ADD_HINT.repo)).not.toBeInTheDocument();
    fireEvent.blur(repoField());
    expect(screen.getByText(PROJECT_ADD_HINT.repo)).toBeInTheDocument();
    expect(repoField()).toHaveAttribute('aria-invalid', 'true');
  });

  it('a submit of a form that does not parse sends nothing and names each field', async () => {
    const p = props();
    mount(p);
    typeIn(repoField(), 'https://gitlab.com/example/repo');
    fireEvent.click(confirm());
    expect(screen.getByText(PROJECT_ADD_HINT.repo)).toBeInTheDocument();
    expect(screen.getByText(PROJECT_ADD_HINT.nameNeeded)).toBeInTheDocument();
    typeIn(nameField(), '-lead');
    expect(screen.getByText(PROJECT_ADD_HINT.name)).toBeInTheDocument();
    expect(p.add).not.toHaveBeenCalled();
  });

  it('a repository whose own name cannot name a project prefills nothing and asks for a name, calmly, only on submit', async () => {
    const p = props();
    mount(p);
    typeIn(repoField(), 'example/.github');
    fireEvent.blur(repoField());
    expect(nameField().value).toBe('');
    expect(screen.queryByText(PROJECT_ADD_HINT.repo)).not.toBeInTheDocument();
    expect(screen.queryByText(PROJECT_ADD_HINT.nameNeeded)).not.toBeInTheDocument();
    fireEvent.click(confirm());
    expect(screen.getByText(PROJECT_ADD_HINT.nameNeeded)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(p.add).not.toHaveBeenCalled();
    typeIn(nameField(), 'dot-github');
    fireEvent.click(confirm());
    await waitFor(() => expect(p.add).toHaveBeenCalledWith({ source: 'github', repo: 'example/.github', name: 'dot-github' }));
  });

  it('the hint goes as soon as the text parses', () => {
    mount(props());
    typeIn(repoField(), 'nope');
    fireEvent.blur(repoField());
    typeIn(repoField(), 'example/repo');
    expect(screen.queryByText(PROJECT_ADD_HINT.repo)).not.toBeInTheDocument();
  });
});

describe('adding', () => {
  it('a clone sends the repository and the name, closes, and toasts', async () => {
    const p = props();
    mount(p);
    typeIn(repoField(), ' example/repo ');
    fireEvent.click(confirm());
    await waitFor(() => expect(p.add).toHaveBeenCalledWith({ source: 'github', repo: 'example/repo', name: 'repo' }));
    expect(await screen.findByText('Added project repo')).toBeInTheDocument();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('an empty project sends its name and says what it can take', async () => {
    const p = props({ add: vi.fn().mockResolvedValue(added('project-a', 'empty')) });
    mount(p);
    pickEmpty();
    typeIn(nameField(), 'project-a');
    fireEvent.click(confirm());
    await waitFor(() => expect(p.add).toHaveBeenCalledWith({ source: 'empty', name: 'project-a' }));
    expect(await screen.findByText(projectAddedText('project-a', 'empty'))).toBeInTheDocument();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('the toast\'s Start session starts a session in the new project, and a host without one offers no action', async () => {
    const onStartSession = vi.fn();
    const p = props({ onStartSession });
    mount(p);
    typeIn(repoField(), 'example/repo');
    fireEvent.click(confirm());
    expect(await screen.findByText(projectAddedText('repo', 'github'))).toBeInTheDocument();
    // `hidden`: this host's `onClose` is a spy, so the modal sheet stays up and hides the page behind it from the tree.
    fireEvent.click(screen.getByRole('button', { name: PROJECT_ADD_TEXT.startSession, hidden: true }));
    expect(onStartSession).toHaveBeenCalledWith('repo');
    expect(screen.queryByText(projectAddedText('repo', 'github'))).not.toBeInTheDocument();
    cleanup();
    mount(props());
    typeIn(repoField(), 'example/repo');
    fireEvent.click(confirm());
    expect(await screen.findByText(projectAddedText('repo', 'github'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: PROJECT_ADD_TEXT.startSession, hidden: true })).not.toBeInTheDocument();
  });

  it('an answer it cannot read still closes, naming the project it sent', async () => {
    const p = props({ add: vi.fn().mockResolvedValue({ kind: 'added', answer: 'unreadable' }) });
    mount(p);
    typeIn(repoField(), 'example/repo');
    fireEvent.click(confirm());
    expect(await screen.findByText('Added project repo')).toBeInTheDocument();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('while a clone is in flight the confirm is disabled and says Cloning…, and the fields are locked', () => {
    mount(props({ adding: true }));
    const busy = screen.getByRole('button', { name: PROJECT_ADD_TEXT.cloning });
    expect(busy).toBeDisabled();
    expect(repoField()).toBeDisabled();
    expect(nameField()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(PROJECT_ADD_TEXT.cloningNote);
  });

  it('an empty project in flight says Creating…', () => {
    const p = props();
    const r = mount(p);
    pickEmpty();
    rerenderWith(r, { ...p, adding: true });
    expect(screen.getByRole('button', { name: PROJECT_ADD_TEXT.creating })).toBeDisabled();
    expect(screen.queryByText(PROJECT_ADD_TEXT.cloningNote)).not.toBeInTheDocument();
  });

  it('the form keeps a block-end gutter of the ring reach, so the last focused field keeps its whole ring', () => {
    mount(props());
    expect(nameField().closest('[class*="pb-1"]')).not.toBeNull();
  });

  it('a busy answer says nothing and keeps the sheet', async () => {
    const p = props({ add: vi.fn().mockResolvedValue({ kind: 'busy' }) });
    mount(p);
    typeIn(repoField(), 'example/repo');
    fireEvent.click(confirm());
    await waitFor(() => expect(p.add).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(p.onClose).not.toHaveBeenCalled();
  });
});

describe('refusals stay in the sheet', () => {
  it('a taken name is said in the sheet, and the typed text is kept', async () => {
    const p = props({ add: vi.fn().mockResolvedValue(refuse(409, { ok: false, error: 'project-exists' })) });
    mount(p);
    typeIn(repoField(), 'example/repo');
    fireEvent.click(confirm());
    expect((await screen.findByRole('alert')).textContent).toBe(PROJECT_ADD_REFUSAL_TEXT['project-exists']);
    expect(repoField().value).toBe('example/repo');
    expect(nameField().value).toBe('repo');
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('a failed clone says git\'s short reason', async () => {
    const p = props({ add: vi.fn().mockResolvedValue(refuse(502, { ok: false, stderr: "remote: Repository not found.\nfatal: repository 'x' not found" })) });
    mount(p);
    typeIn(repoField(), 'example/repo');
    fireEvent.click(confirm());
    expect((await screen.findByRole('alert')).textContent).toMatch(/no such repository/);
  });

  it('an empty project\'s failure is told as the folder it could not create, never as GitHub\'s', async () => {
    const p = props({ add: vi.fn().mockResolvedValue(refuse(502, { ok: false, stderr: 'ccd: git init failed for project-a: fatal: Permission denied' })) });
    mount(p);
    pickEmpty();
    typeIn(nameField(), 'project-a');
    fireEvent.click(confirm());
    expect((await screen.findByRole('alert')).textContent).toBe("The fleet box couldn't create the project folder: Permission denied");
  });

  it('an answer the server could not wait for says the project may be there', async () => {
    const p = props({ add: vi.fn().mockResolvedValue(refuse(504, { ok: false, error: 'outcome-unknown' })) });
    mount(p);
    typeIn(repoField(), 'example/repo');
    fireEvent.click(confirm());
    expect((await screen.findByRole('alert')).textContent).toMatch(/may or may not have been added/);
  });

  it('editing a field clears the refusal', async () => {
    const p = props({ add: vi.fn().mockResolvedValue(refuse(409, { ok: false, error: 'project-exists' })) });
    mount(p);
    typeIn(repoField(), 'example/repo');
    fireEvent.click(confirm());
    await screen.findByRole('alert');
    typeIn(nameField(), 'project-b');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('closing', () => {
  it('forgets everything: the choice, both fields, the hints and the refusal', async () => {
    const p = props({ add: vi.fn().mockResolvedValue(refuse(409, { ok: false, error: 'project-exists' })) });
    const r = mount(p);
    pickEmpty();
    typeIn(nameField(), 'project-a');
    fireEvent.click(confirm());
    await screen.findByRole('alert');

    rerenderWith(r, { ...p, open: false });
    await waitFor(() => expect(screen.queryByLabelText(PROJECT_ADD_TEXT.name)).not.toBeInTheDocument());
    rerenderWith(r, { ...p, open: true });

    expect((screen.getByLabelText(PROJECT_ADD_TEXT.github) as HTMLInputElement).checked).toBe(true);
    expect(repoField().value).toBe('');
    expect(nameField().value).toBe('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a name typed by hand is forgotten too: the next opening prefills it from the repository again', async () => {
    const p = props();
    const r = mount(p);
    typeIn(nameField(), 'project-a');
    rerenderWith(r, { ...p, open: false });
    await waitFor(() => expect(screen.queryByLabelText(PROJECT_ADD_TEXT.name)).not.toBeInTheDocument());
    rerenderWith(r, { ...p, open: true });
    typeIn(repoField(), 'example/repo');
    expect(nameField().value).toBe('repo');
  });

  it('a refusal that lands after the sheet was closed is an error toast, never the next opening\'s', async () => {
    let answer!: (o: ProjectAddOutcome) => void;
    const p = props({ add: vi.fn().mockImplementation(() => new Promise<ProjectAddOutcome>((resolve) => { answer = resolve; })) });
    const r = mount(p);
    typeIn(repoField(), 'example/repo');
    fireEvent.click(confirm());
    rerenderWith(r, { ...p, open: false });
    rerenderWith(r, { ...p, open: true });
    await act(async () => { answer(refuse(409, { ok: false, error: 'project-exists' })); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await screen.findByText(PROJECT_ADD_REFUSAL_TEXT['project-exists'])).toBeInTheDocument();
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('a success that lands after the sheet was closed still toasts, and closes nothing', async () => {
    let answer!: (o: ProjectAddOutcome) => void;
    const p = props({ add: vi.fn().mockImplementation(() => new Promise<ProjectAddOutcome>((resolve) => { answer = resolve; })) });
    const r = mount(p);
    typeIn(repoField(), 'example/repo');
    fireEvent.click(confirm());
    rerenderWith(r, { ...p, open: false });
    await act(async () => { answer(added('repo')); });
    expect(await screen.findByText('Added project repo')).toBeInTheDocument();
    expect(p.onClose).not.toHaveBeenCalled();
  });
});

// The linking standard's two optional fields (D-8147, plan Task 8): the add-project sheet only, never the new-session
// sheet's inline add.
describe('Linear team key and the template PR (D-8147)', () => {
  const keyField = (): HTMLInputElement => screen.getByLabelText(LINKING_ADD_TEXT.teamKey) as HTMLInputElement;
  const templateBox = (): HTMLElement => screen.getByRole('checkbox', { name: new RegExp(LINKING_ADD_TEXT.template) });
  const fillClone = (): void => { typeIn(repoField(), 'example/repo'); };

  it('a clone with a team key saves it after the add', async () => {
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({
      ok: true, linking: { teamKey: 'KEY', override: null, measured: { state: 'unmeasured' }, mode: 'unknown' },
    });
    const p = props();
    mount(p);
    fillClone();
    typeIn(keyField(), 'key');
    expect(keyField().value).toBe('KEY');
    fireEvent.click(confirm());
    await waitFor(() => expect(save).toHaveBeenCalledWith('repo', { teamKey: 'KEY', override: null }));
    expect(await screen.findByText(`${projectAddedText('repo', 'github')} ${LINKING_ADD_TEXT.keySaved('KEY')}`)).toBeInTheDocument();
    expect(p.onClose).toHaveBeenCalled();
  });

  it('a team key the box refuses is said in its fixed sentence, and the project is still added', async () => {
    vi.spyOn(api, 'saveLinking').mockRejectedValue(new ApiError(400, { ok: false, error: 'bad-team-key', detail: 'box text' }));
    mount(props());
    fillClone();
    typeIn(keyField(), 'k');
    fireEvent.click(confirm());
    const toastText = await screen.findByText(new RegExp(`^${projectAddedText('repo', 'github')} `));
    expect(toastText.textContent).toContain(LINKING_REFUSAL_TEXT['bad-team-key']);
    expect(toastText.textContent).not.toContain('box text');
  });

  it('a failed template act shows the fixed sentence, never the box\'s stderr', async () => {
    vi.spyOn(api, 'saveLinking').mockResolvedValue({
      ok: true, linking: { teamKey: 'KEY', override: null, measured: { state: 'unmeasured' }, mode: 'unknown' },
    });
    vi.spyOn(api, 'openTemplatePr').mockRejectedValue(new ApiError(502, { ok: false, error: 'template-failed', stderr: 'pr-template: push failed for ccrc/linking-template' }));
    mount(props());
    fillClone();
    typeIn(keyField(), 'KEY');
    fireEvent.click(templateBox());
    fireEvent.click(confirm());
    const toastText = await screen.findByText(new RegExp(`^${projectAddedText('repo', 'github')} `));
    expect(toastText.textContent).toContain(LINKING_REFUSAL_TEXT['template-failed']);
    expect(toastText.textContent).not.toContain('push failed');
  });

  it('the template box runs the template act after the add and reports it in the toast', async () => {
    vi.spyOn(api, 'saveLinking').mockResolvedValue({
      ok: true, linking: { teamKey: 'KEY', override: null, measured: { state: 'unmeasured' }, mode: 'unknown' },
    });
    const open = vi.spyOn(api, 'openTemplatePr').mockResolvedValue({ ok: true, url: 'https://github.com/example/repo/pull/3' });
    mount(props());
    fillClone();
    typeIn(keyField(), 'KEY');
    expect(templateBox()).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(templateBox());
    expect(templateBox()).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(confirm());
    await waitFor(() => expect(open).toHaveBeenCalledWith('repo'));
    expect(await screen.findByText(new RegExp('https://github.com/example/repo/pull/3'))).toBeInTheDocument();
  });

  it('a repository not read yet says when to open the template from Settings', async () => {
    vi.spyOn(api, 'saveLinking').mockResolvedValue({
      ok: true, linking: { teamKey: 'KEY', override: null, measured: { state: 'unmeasured' }, mode: 'unknown' },
    });
    vi.spyOn(api, 'openTemplatePr').mockRejectedValue(new ApiError(409, { ok: false, error: 'repo-unmeasured' }));
    mount(props());
    fillClone();
    typeIn(keyField(), 'KEY');
    fireEvent.click(templateBox());
    fireEvent.click(confirm());
    expect(await screen.findByText(new RegExp(LINKING_ADD_TEXT.unmeasured))).toBeInTheDocument();
  });

  it('the empty arm shows no template box, and still offers the key', () => {
    mount(props());
    pickEmpty();
    expect(screen.queryByRole('checkbox', { name: new RegExp(LINKING_ADD_TEXT.template) })).not.toBeInTheDocument();
    expect(keyField()).toBeInTheDocument();
  });

  it('an add with neither field makes no linking call', async () => {
    const save = vi.spyOn(api, 'saveLinking');
    const open = vi.spyOn(api, 'openTemplatePr');
    mount(props());
    fillClone();
    fireEvent.click(confirm());
    expect(await screen.findByText('Added project repo')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('the new-session inline add shows neither field', () => {
    function Inline(): ReactNode {
      const form = useProjectAddForm({ active: true, add: vi.fn(), adding: false, onAdded: vi.fn() });
      return form.fields;
    }
    render(<Inline />);
    expect(screen.queryByLabelText(LINKING_ADD_TEXT.teamKey)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(repoField()).toBeInTheDocument();
  });
});

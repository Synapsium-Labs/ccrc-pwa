// Adding a project from the new-session sheet (add-project spec 2026-11-04 §2, as redrawn): step 2's "New project" row
// opens the shared form in the sheet's body; a search that reads as a GitHub repository, or as a new name nothing
// matches, offers that add as a row whose one tap fills the form and sends it; a success returns to the list, re-reads
// it, and picks the new project. A sheet opened on a project (`initialProject`) picks it once an account is chosen,
// never a crossing one. `fireEvent`, not `userEvent`: vaul's drag handler raises under `userEvent`'s pointer sequence.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import type { ProjectRow, RosterWire } from '../../shared/api';
import type { ProjectAddBody } from '../../shared/projectAdd';
import { NewSessionSheet } from '../src/fleet/NewSessionSheet';
import { PROJECT_ADD_REFUSAL_TEXT, PROJECT_ADD_TEXT, projectAddedText } from '../src/fleet/projectAddWords';
import type { ProjectAddOutcome } from '../src/fleet/useProjectRows';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;
const proj = (name: string, pool?: ProjectRow['pool']): ProjectRow =>
  ({ name, workdir: `/w/${name}`, ...(pool === undefined ? {} : { pool }) });
const roster: RosterWire[] = TEST_ROSTER.map((a) => ({ ...a, pool: a.id === 'claude' ? 'pool-a' : null }));

interface Opened {
  add: ReturnType<typeof vi.fn<(body: ProjectAddBody) => Promise<ProjectAddOutcome>>>;
  projects: ReturnType<typeof vi.spyOn>;
  store: FleetStore;
}

/** Mounts the sheet with `lists` as the successive `/api/projects` answers (the last repeats), and picks team·max. */
const open = async (
  lists: ProjectRow[][],
  opts: {
    add?: (body: ProjectAddBody) => Promise<ProjectAddOutcome>; initialProject?: string; withAdd?: boolean; adding?: boolean;
  } = {},
): Promise<Opened> => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', sessions: [], roster }); });
  let call = 0;
  const projects = vi.spyOn(api, 'projects').mockImplementation(async () => {
    const list = lists[Math.min(call, lists.length - 1)]!;
    call += 1;
    return { roots: ['/w'], projects: list };
  });
  vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
  const add = vi.fn(opts.add ?? (async (body: ProjectAddBody): Promise<ProjectAddOutcome> =>
    ({ kind: 'added', answer: { ok: true, name: body.name ?? 'thing', source: body.source } })));
  render(
    <>
      <ToastHost />
      <NewSessionSheet
        open
        onClose={vi.fn()}
        fleet={store}
        initialProject={opts.initialProject ?? null}
        addingProject={opts.adding ?? false}
        {...(opts.withAdd === false ? {} : { addProject: add })}
      />
    </>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
  await screen.findByRole('searchbox', { name: 'Search projects' });
  return { add, projects, store };
};

const search = (q: string): void => {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search projects' }), { target: { value: q } });
};
const newProjectRow = (): HTMLElement | null => screen.queryByRole('button', { name: PROJECT_ADD_TEXT.open });

describe('the New project row', () => {
  it('heads the list, and opens the form in the sheet with a way back', async () => {
    await open([[proj('alpha')]]);
    expect(await screen.findByText('alpha')).toBeInTheDocument();
    fireEvent.click(newProjectRow()!);
    expect(screen.getByLabelText(PROJECT_ADD_TEXT.repo)).toBeInTheDocument();
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: PROJECT_ADD_TEXT.add })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(PROJECT_ADD_TEXT.back) }));
    expect(await screen.findByText('alpha')).toBeInTheDocument();
    expect(screen.queryByLabelText(PROJECT_ADD_TEXT.repo)).not.toBeInTheDocument();
  });

  it('a host that gives no add offers none: no row, no search offer', async () => {
    await open([[proj('alpha')]], { withAdd: false });
    expect(await screen.findByText('alpha')).toBeInTheDocument();
    expect(newProjectRow()).toBeNull();
    search('example/new-thing');
    expect(screen.queryByRole('button', { name: /^Clone / })).toBeNull();
  });

  it('an add from the form returns to the list, re-reads it and picks the new project', async () => {
    const { add, projects } = await open([[proj('alpha')], [proj('alpha'), proj('fresh')]]);
    await screen.findByText('alpha');
    fireEvent.click(newProjectRow()!);
    fireEvent.click(screen.getByLabelText(PROJECT_ADD_TEXT.empty));
    fireEvent.change(screen.getByLabelText(PROJECT_ADD_TEXT.name), { target: { value: 'fresh' } });
    fireEvent.click(screen.getByRole('button', { name: PROJECT_ADD_TEXT.add }));
    await waitFor(() => expect(add).toHaveBeenCalledWith({ source: 'empty', name: 'fresh' }));
    expect(await screen.findByText(projectAddedText('fresh', 'empty'))).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Start fresh on / })).toBeInTheDocument();
    expect(projects).toHaveBeenCalledTimes(2);
  });

  it('a refusal stays in the form with what was typed', async () => {
    const add = async (): Promise<ProjectAddOutcome> =>
      ({ kind: 'refused', error: new ApiError(409, { error: 'project-exists' }) });
    await open([[proj('alpha')]], { add });
    await screen.findByText('alpha');
    fireEvent.click(newProjectRow()!);
    fireEvent.change(screen.getByLabelText(PROJECT_ADD_TEXT.repo), { target: { value: 'example/alpha2' } });
    fireEvent.click(screen.getByRole('button', { name: PROJECT_ADD_TEXT.add }));
    expect(await screen.findByText(PROJECT_ADD_REFUSAL_TEXT['project-exists'])).toBeInTheDocument();
    expect((screen.getByLabelText(PROJECT_ADD_TEXT.repo) as HTMLInputElement).value).toBe('example/alpha2');
  });
});

describe('the search offers', () => {
  it('a pasted repository offers its clone, and one tap sends it and picks the new project', async () => {
    const { add } = await open([[proj('alpha')], [proj('alpha'), proj('new-thing')]]);
    await screen.findByText('alpha');
    search('https://github.com/example/new-thing');
    expect(screen.queryByText(/^No project matches/)).toBeNull();
    expect(newProjectRow()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Clone example\/new-thing/ }));
    await waitFor(() => expect(add).toHaveBeenCalledWith(
      { source: 'github', repo: 'https://github.com/example/new-thing', name: 'new-thing' },
    ));
    expect(await screen.findByRole('button', { name: /^Start new-thing on / })).toBeInTheDocument();
  });

  it('a repository whose project is already here shows that project, and offers no clone', async () => {
    await open([[proj('alpha'), proj('repo')]]);
    await screen.findByText('alpha');
    search('example/repo');
    expect(screen.getByText('repo')).toBeInTheDocument();
    expect(screen.queryByText('alpha')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Clone / })).toBeNull();
  });

  it('a repository whose name cannot be a project\'s opens the form for a name, and sends nothing', async () => {
    const { add } = await open([[proj('alpha')]]);
    await screen.findByText('alpha');
    search('example/.github');
    fireEvent.click(screen.getByRole('button', { name: /Clone example\/\.github/ }));
    expect((screen.getByLabelText(PROJECT_ADD_TEXT.repo) as HTMLInputElement).value).toBe('example/.github');
    expect((screen.getByLabelText(PROJECT_ADD_TEXT.name) as HTMLInputElement).value).toBe('');
    expect(add).not.toHaveBeenCalled();
  });

  it('a new name nothing matches offers an empty project; a name that matches offers nothing', async () => {
    const { add } = await open([[proj('alpha')], [proj('alpha'), proj('fresh-idea')]]);
    await screen.findByText('alpha');
    search('alp');
    expect(screen.queryByRole('button', { name: /^Create empty project/ })).toBeNull();
    search('fresh-idea');
    fireEvent.click(screen.getByRole('button', { name: /Create empty project fresh-idea/ }));
    await waitFor(() => expect(add).toHaveBeenCalledWith({ source: 'empty', name: 'fresh-idea' }));
    expect(await screen.findByRole('button', { name: /^Start fresh-idea on / })).toBeInTheDocument();
  });
});

describe('a sheet opened on a project', () => {
  it('picks it once an account is chosen', async () => {
    await open([[proj('alpha'), proj('beta')]], { initialProject: 'beta' });
    expect(await screen.findByRole('button', { name: /^Start beta on / })).toBeInTheDocument();
  });

  it('never picks a crossing one: it opens the disclosure and leaves the pick to the operator', async () => {
    await open([[proj('alpha'), proj('beta', { state: 'tagged', name: 'pool-b' })]], { initialProject: 'beta' });
    expect(await screen.findByText('beta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a project' })).toBeDisabled();
  });
});

describe('an add that outlives its form', () => {
  /** An add that answers when `settle` is called. */
  const deferred = (): { add: (body: ProjectAddBody) => Promise<ProjectAddOutcome>; settle: (name: string) => void } => {
    let resolve: (o: ProjectAddOutcome) => void = () => {};
    return {
      add: () => new Promise<ProjectAddOutcome>((r) => { resolve = r; }),
      settle: (name) => resolve({ kind: 'added', answer: { ok: true, name, source: 'empty' } }),
    };
  };

  it('offers no add while one runs: no New project row, no search offer', async () => {
    await open([[proj('alpha')]], { adding: true });
    await screen.findByText('alpha');
    expect(newProjectRow()).toBeNull();
    search('example/new-thing');
    expect(screen.queryByRole('button', { name: /^Clone / })).toBeNull();
  });

  it('a clone whose name a project of another repository holds takes the owner\'s name, in one tap', async () => {
    const { add } = await open([[{ ...proj('api'), repo: { state: 'named', slug: 'other/api' } }]]);
    await screen.findByText('api');
    search('third/api');
    fireEvent.click(screen.getByRole('button', { name: /Clone third\/api/ }));
    await waitFor(() => expect(add).toHaveBeenCalledWith({ source: 'github', repo: 'third/api', name: 'third-api' }));
  });

  it('holds Back while an add runs (the plane\'s `addingProject`), and frees it when none does', async () => {
    const d = deferred();
    const store = createFleetStore({ makeSocket: fakeSocket });
    act(() => { store.setState({ conn: 'open', sessions: [], roster }); });
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects: [proj('alpha')] });
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
    const sheet = (adding: boolean) => (
      <NewSessionSheet open onClose={vi.fn()} fleet={store} addProject={d.add} addingProject={adding} />
    );
    const r = render(sheet(false));
    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    await screen.findByText('alpha');
    search('fresh');
    fireEvent.click(screen.getByRole('button', { name: /Create empty project fresh/ }));
    r.rerender(sheet(true));
    expect(screen.getByRole('button', { name: new RegExp(PROJECT_ADD_TEXT.back) })).toBeDisabled();
    cleanup();
    await open([[proj('alpha')]]);
    await screen.findByText('alpha');
    fireEvent.click(screen.getByRole('button', { name: PROJECT_ADD_TEXT.open }));
    expect(screen.getByRole('button', { name: new RegExp(PROJECT_ADD_TEXT.back) })).toBeEnabled();
  });

  it('a sheet closed mid-add says the add, re-opens at step 1 with no form and picks nothing', async () => {
    const d = deferred();
    const store = createFleetStore({ makeSocket: fakeSocket });
    act(() => { store.setState({ conn: 'open', sessions: [], roster }); });
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects: [proj('alpha'), proj('fresh')] });
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
    const sheet = (isOpen: boolean) => (
      <>
        <ToastHost />
        <NewSessionSheet open={isOpen} onClose={vi.fn()} fleet={store} addProject={d.add} addingProject={false} />
      </>
    );
    const r = render(sheet(true));
    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    await screen.findByText('alpha');
    fireEvent.click(screen.getByRole('button', { name: PROJECT_ADD_TEXT.open }));
    fireEvent.click(screen.getByLabelText(PROJECT_ADD_TEXT.empty));
    fireEvent.change(screen.getByLabelText(PROJECT_ADD_TEXT.name), { target: { value: 'fresh' } });
    fireEvent.click(screen.getByRole('button', { name: PROJECT_ADD_TEXT.add }));
    r.rerender(sheet(false));
    await act(async () => { d.settle('fresh'); });
    expect(await screen.findByText(projectAddedText('fresh', 'empty'))).toBeInTheDocument();
    r.rerender(sheet(true));
    expect(await screen.findByRole('button', { name: /team·max/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(PROJECT_ADD_TEXT.name)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /team·max/ }));
    await screen.findByText('fresh');
    expect(screen.getByRole('button', { name: 'Choose a project' })).toBeDisabled();
  });
});


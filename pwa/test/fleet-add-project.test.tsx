// The fleet screen's "New project" door (add-project spec 2026-11-04 §2, as redrawn): a button in the head over the
// project list, and one in the first-run panel, so a brand-new fleet with no sessions can add its first project too.
// Both live in `FleetScreen` itself, outside the skin parts, so every skin shows them. Each opens the one sheet
// `FleetFlows` mounts, and an add goes through the projects plane, which re-reads `GET /api/projects`. The success
// toast's "Start session" opens the new-session sheet, which picks the new project once an account is chosen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import type { FleetSession, UpdatesView } from '../../shared/api';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { FleetScreen } from '../src/screens/FleetScreen';
import { FleetChromeProvider } from '../src/fleet/FleetChrome';
import { FleetFlows } from '../src/fleet/FleetFlows';
import { PROJECT_ADD_TEXT, projectAddedText } from '../src/fleet/projectAddWords';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';

const makeStore = (): FleetStore =>
  createFleetStore({
    makeSocket: () =>
      ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
  });

const session = (over: Partial<FleetSession> = {}): FleetSession =>
  fleetSession({ id: 'a', project: 'alpha', workspace: 'quiet-mesa', statusUpdatedAt: Date.now(), ...over });

beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
  vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
  vi.spyOn(api, 'fleetHealth').mockReturnValue(new Promise(() => {}));
  vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = (sessions: FleetSession[]): FleetStore => {
  const store = makeStore();
  render(
    <FleetChromeProvider store={store}>
      <ToastHost />
      <FleetScreen store={store} />
      <FleetFlows />
    </FleetChromeProvider>,
  );
  act(() => { store.setState({ conn: 'open', sessions, roster: TEST_ROSTER }); });
  return store;
};

const door = (): HTMLElement => screen.getByRole('button', { name: PROJECT_ADD_TEXT.open });
const sheetOpen = (): boolean => screen.queryByLabelText(PROJECT_ADD_TEXT.name) !== null;

describe('the Add project door', () => {
  it('sits in the head over the project list, which names it, and opens the sheet', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [] });
    mount([session()]);
    expect(screen.getByRole('heading', { name: PROJECT_ADD_TEXT.projectsHead })).toBeInTheDocument();
    // Above the list it adds to, not under it.
    const list = document.querySelector('.fleet-list')!;
    expect(door().compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('.fleet-add-project-row')).toBeNull();
    expect(sheetOpen()).toBe(false);
    fireEvent.click(door());
    await waitFor(() => expect(sheetOpen()).toBe(true));
  });

  it('is in the first-run panel too, beside Start a session', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [] });
    mount([]);
    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    fireEvent.click(door());
    await waitFor(() => expect(sheetOpen()).toBe(true));
  });

  it.each([
    ['the project list', [session()]],
    ['the first-run panel', []],
  ])('an add from %s posts the form, re-reads the projects, closes and toasts', async (_where, sessions) => {
    const toastText = projectAddedText('repo', 'github');
    const projects = vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [] });
    const add = vi.spyOn(api, 'projectAdd').mockResolvedValue({ ok: true, name: 'repo', source: 'github' });
    mount(sessions);
    fireEvent.click(door());
    await waitFor(() => expect(sheetOpen()).toBe(true));
    const before = projects.mock.calls.length;
    fireEvent.change(screen.getByLabelText(PROJECT_ADD_TEXT.repo), { target: { value: 'example/repo' } });
    fireEvent.click(screen.getByRole('button', { name: PROJECT_ADD_TEXT.add }));
    await waitFor(() => expect(add).toHaveBeenCalledWith({ source: 'github', repo: 'example/repo', name: 'repo' }));
    expect(await screen.findByText(toastText)).toBeInTheDocument();
    await waitFor(() => expect(projects.mock.calls.length).toBe(before + 1));
    await waitFor(() => expect(sheetOpen()).toBe(false));
  });

  it('the toast\'s Start session opens the new-session sheet, which picks the new project once an account is chosen', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [{ name: 'repo', workdir: '/p/repo' } as never] });
    vi.spyOn(api, 'projectAdd').mockResolvedValue({ ok: true, name: 'repo', source: 'github' });
    mount([session()]);
    fireEvent.click(door());
    await waitFor(() => expect(sheetOpen()).toBe(true));
    fireEvent.change(screen.getByLabelText(PROJECT_ADD_TEXT.repo), { target: { value: 'example/repo' } });
    fireEvent.click(screen.getByRole('button', { name: PROJECT_ADD_TEXT.add }));
    fireEvent.click(await screen.findByRole('button', { name: PROJECT_ADD_TEXT.startSession }));
    expect(await screen.findByText('Start a session', { selector: 'h2' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    expect(await screen.findByRole('button', { name: /^Start repo on / })).toBeInTheDocument();
  });
});

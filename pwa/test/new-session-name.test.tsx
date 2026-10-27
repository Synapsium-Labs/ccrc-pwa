// The "Name or Linear ticket" field in the new-session sheet (named workspaces S8, design §2.1). Empty is today's
// start on the main checkout, byte for byte; a name is a workspace create on the account the operator picked. The
// door closes, with its sentence, for a crossing project and for an account a workspace never starts on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import type { ProjectRow, RosterWire } from '../../shared/api';
import { NewSessionSheet, NEW_SESSION_NAME_TEXT } from '../src/fleet/NewSessionSheet';
import { NAME_FIELD_CLASS, NAME_FIELD_TEXT } from '../src/fleet/WorkspaceNameField';
import { LINEAR_SETTINGS_PATH, LOOKUP_NOTE, NAME_DOOR_TEXT } from '../src/fleet/workspaceNameWords';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';

beforeEach(() => {
  vi.spyOn(api, 'linearResolve').mockResolvedValue({ title: 'ENG-1234 - Fix the login flow', source: 'linear', note: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;
const pooled = (byId: Record<string, string>): RosterWire[] =>
  TEST_ROSTER.map((account) => ({ ...account, pool: byId[account.id] ?? null }));
const POOLS = { claude: 'pool-a', claude9: 'pool-a' };

const proj = (name: string, pool?: ProjectRow['pool']): ProjectRow => ({
  name, workdir: `/w/${name}`, ...(pool === undefined ? {} : { pool }),
});
const PROJECTS: ProjectRow[] = [
  proj('demo', { state: 'tagged', name: 'pool-a' }),
  proj('quiet-basin', { state: 'tagged', name: 'pool-b' }),
];

const field = (): HTMLInputElement => screen.getByLabelText(NAME_FIELD_TEXT.label) as HTMLInputElement;
const type = (text: string): void => { fireEvent.change(field(), { target: { value: text } }); };
const start = (name: string | RegExp): HTMLElement => screen.getByRole('button', { name });

interface Opened { onClose: ReturnType<typeof vi.fn>; rerender: (open: boolean) => void }

/** Open the sheet on `roster`, land the project list, and pick `account` at step 1. */
const openAt = async (account: RegExp | null = /team·max/, roster: RosterWire[] = pooled(POOLS)): Promise<Opened> => {
  vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects: PROJECTS });
  vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
  const store: FleetStore = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', sessions: [], roster }); });
  const onClose = vi.fn();
  const ui = (open: boolean) => <><ToastHost /><NewSessionSheet open={open} onClose={onClose} fleet={store} /></>;
  const r = render(ui(true));
  if (account !== null) fireEvent.click(await screen.findByRole('button', { name: account }));
  return { onClose, rerender: (open) => r.rerender(ui(open)) };
};
const pickDemo = async (): Promise<void> => { fireEvent.click(await screen.findByText('demo')); };

describe('where the field is', () => {
  it('is not at the account step, and not before a project is picked', async () => {
    await openAt(null);
    expect(screen.queryByLabelText(NAME_FIELD_TEXT.label)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    await screen.findByText('demo');
    expect(screen.queryByLabelText(NAME_FIELD_TEXT.label)).not.toBeInTheDocument();
  });

  it('appears once a project is picked, never takes the focus, and says what empty means here', async () => {
    await openAt();
    await pickDemo();
    expect(field()).toBeEnabled();
    expect(document.activeElement).not.toBe(field());
    expect(screen.getByText(NEW_SESSION_NAME_TEXT.emptyHint)).toBeInTheDocument();
  });
});

describe('an empty field is today\'s start', () => {
  it('sends createSession with today\'s body and never the workspace create', async () => {
    const create = vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    const add = vi.spyOn(api, 'workspaceAdd');
    await openAt();
    await pickDemo();
    fireEvent.click(start(/^Start demo on team·max/));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ wrapper: 'claude', project: 'demo', workdir: '/w/demo' }));
    expect(add).not.toHaveBeenCalled();
  });

  it('a blank field is empty, and the route row still rides createSession', async () => {
    const create = vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    const add = vi.spyOn(api, 'workspaceAdd');
    await openAt();
    await pickDemo();
    type('   ');
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'opus' } });
    fireEvent.click(start(/^Start demo on team·max/));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ wrapper: 'claude', project: 'demo', workdir: '/w/demo', route: { class: 'opus' } }));
    expect(add).not.toHaveBeenCalled();
  });

  it('a failed plain start still toasts ccd\'s words, as before', async () => {
    vi.spyOn(api, 'createSession').mockRejectedValue(new ApiError(502, { ok: false, stderr: 'no tmux' }));
    await openAt();
    await pickDemo();
    fireEvent.click(start(/^Start demo on team·max/));
    expect(await screen.findByText(/no tmux/)).toBeInTheDocument();
  });
});

describe('a name starts a workspace on the account that was picked', () => {
  it('sends workspaceAdd(project, {name, wrapper}) and never createSession', async () => {
    const create = vi.spyOn(api, 'createSession');
    const add = vi.spyOn(api, 'workspaceAdd').mockResolvedValue({ named: false });
    const { onClose } = await openAt(/team·alt/);
    await pickDemo();
    type('Login cleanup');
    fireEvent.click(start('Start Login cleanup on team·alt'));
    await waitFor(() => expect(add).toHaveBeenCalledWith('demo', { name: 'Login cleanup', wrapper: 'claude9' }));
    expect(create).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('carries the routing row with it', async () => {
    const add = vi.spyOn(api, 'workspaceAdd').mockResolvedValue({ named: false });
    await openAt();
    await pickDemo();
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'opus' } });
    fireEvent.change(screen.getByLabelText('Workflows'), { target: { value: 'on' } });
    type('ENG-1234');
    fireEvent.click(start('Start ENG-1234 on team·max'));
    await waitFor(() => expect(add).toHaveBeenCalledWith('demo', {
      name: 'ENG-1234', wrapper: 'claude', route: { class: 'opus', workflow: 'on' },
    }));
  });

  it('narrates the confirm with the ticket id, and says what a name changes (only while a name is there)', async () => {
    await openAt();
    await pickDemo();
    expect(screen.queryByText(NEW_SESSION_NAME_TEXT.named)).not.toBeInTheDocument();
    type('!!');
    expect(screen.queryByText(NEW_SESSION_NAME_TEXT.named)).not.toBeInTheDocument();
    type('ENG-1234');
    expect(start('Start ENG-1234 on team·max')).toBeEnabled();
    expect(screen.getByText(NEW_SESSION_NAME_TEXT.named)).toBeInTheDocument();
    expect(screen.getByText('new workspace demo-eng-1234 · branch ws/eng-1234')).toBeInTheDocument();
  });

  it('cuts a long name out of the confirm with an ellipsis, so the account stays in sight', async () => {
    // jsdom lays nothing out: `browser/name-field.browser.test.tsx` measures the rects; this holds the mechanism.
    await openAt();
    await pickDemo();
    type('Investigate the flaky upload test on the staging runner');
    const label = start(/^Start Investigate/).querySelector('span');
    expect(label).toHaveClass('truncate');
    expect(label).toHaveClass('min-w-0');
  });

  it('opens the session the box answered, and closes without a toast', async () => {
    vi.spyOn(api, 'workspaceAdd').mockResolvedValue({ named: true, id: 'demo-eng-1234', slug: 'eng-1234', title: 'ENG-1234 - Fix the login flow' });
    const { onClose } = await openAt();
    await pickDemo();
    type('ENG-1234');
    fireEvent.click(start('Start ENG-1234 on team·max'));
    await waitFor(() => expect(window.location.pathname).toBe('/s/demo-eng-1234'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^Starting/)).not.toBeInTheDocument();
  });

  it('opens the id the SERVER answered, whatever the preview showed', async () => {
    // The preview said `demo-eng-1234`; the answer names another id. The sheet navigates to the id it was answered and
    // never rebuilds one from the preview or the typed text.
    vi.spyOn(api, 'workspaceAdd').mockResolvedValue({ named: true, id: 'demo-eng-1234-2', slug: 'eng-1234-2', title: 'ENG-1234 - Fix the login flow' });
    await openAt();
    await pickDemo();
    type('ENG-1234');
    await screen.findByText('from Linear');
    fireEvent.click(start('Start ENG-1234 on team·max'));
    await waitFor(() => expect(window.location.pathname).toBe('/s/demo-eng-1234-2'));
  });

  it('an answer this build cannot read names no title at all: never the typed text, which the server may have resolved to another', async () => {
    vi.spyOn(api, 'workspaceAdd').mockResolvedValue({ named: false });
    await openAt();
    await pickDemo();
    type('Login cleanup');
    fireEvent.click(start('Start Login cleanup on team·max'));
    expect(await screen.findByText('Starting demo on team·max…')).toBeInTheDocument();
    expect(screen.queryByText('Starting Login cleanup on team·max…')).not.toBeInTheDocument();
  });

  it('a refused name disables the confirm and sends nothing', async () => {
    const create = vi.spyOn(api, 'createSession');
    const add = vi.spyOn(api, 'workspaceAdd');
    await openAt();
    await pickDemo();
    type('!!');
    expect(screen.getByText('That has no letters or numbers in it.')).toBeInTheDocument();
    // The label stays the door's plain one (a disabled button is dimmed below readable contrast): the sentence above says what to fix.
    const c = start('Start demo on team·max');
    expect(c).toBeDisabled();
    fireEvent.click(c);
    expect(add).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(api.linearResolve).not.toHaveBeenCalled();
  });
});

describe('Enter in the field', () => {
  it('starts exactly as the confirm does: a name is a workspace create', async () => {
    const add = vi.spyOn(api, 'workspaceAdd').mockResolvedValue({ named: false });
    await openAt();
    await pickDemo();
    type('Login cleanup');
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(add).toHaveBeenCalledWith('demo', { name: 'Login cleanup', wrapper: 'claude' }));
  });

  it('an empty field starts on the main checkout, as the confirm does', async () => {
    const create = vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    await openAt();
    await pickDemo();
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(create).toHaveBeenCalledWith({ wrapper: 'claude', project: 'demo', workdir: '/w/demo' }));
  });

  it('sends nothing for a refused name', async () => {
    const add = vi.spyOn(api, 'workspaceAdd');
    const create = vi.spyOn(api, 'createSession');
    await openAt();
    await pickDemo();
    type('!!');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(add).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('does not double-start while a request is in flight', async () => {
    const add = vi.spyOn(api, 'workspaceAdd').mockImplementation(() => new Promise(() => {}));
    await openAt();
    await pickDemo();
    type('Login cleanup');
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(add).toHaveBeenCalledTimes(1);
  });
});

describe('while a request is in flight everything it was built from is locked', () => {
  it('the field is read-only and the project list, the account change and the three selects are disabled', async () => {
    vi.spyOn(api, 'workspaceAdd').mockImplementation(() => new Promise(() => {}));
    await openAt();
    await pickDemo();
    type('Login cleanup');
    fireEvent.click(start('Start Login cleanup on team·max'));
    await screen.findByRole('button', { name: 'Starting…' });
    expect(field()).toBeDisabled();
    expect(screen.getByRole('button', { name: /change/ })).toBeDisabled();
    expect(screen.getByPlaceholderText('Search projects')).toBeDisabled();
    for (const l of ['Class', 'Effort', 'Workflows']) expect(screen.getByLabelText(l)).toBeDisabled();
    // The project rows are inside the same disabled fieldset: tapping another changes nothing.
    expect(screen.getByText('demo').closest('fieldset')).toBeDisabled();
  });

  it('and the whole body is dimmed, in the same way the + sheet dims its field, and only once', async () => {
    vi.spyOn(api, 'workspaceAdd').mockImplementation(() => new Promise(() => {}));
    await openAt();
    await pickDemo();
    expect(field().closest('[data-locked]')).toBeNull();
    type('Login cleanup');
    fireEvent.click(start('Start Login cleanup on team·max'));
    await screen.findByRole('button', { name: 'Starting…' });
    const locked = field().closest('[data-locked]');
    expect(locked).not.toBeNull();
    for (const cls of NAME_FIELD_CLASS.locked.split(' ')) expect(locked).toHaveClass(cls);
    // One dimmed ancestor: the field does not dim itself again inside the body's dim (the two would multiply).
    expect(locked?.parentElement?.closest('[data-locked]') ?? null).toBeNull();
    expect(locked?.querySelectorAll('[data-locked]').length).toBe(0);
    // The project list and the selects are inside the same dimmed body.
    expect(locked).toContainElement(screen.getByLabelText('Class'));
    expect(locked).toContainElement(screen.getByPlaceholderText('Search projects'));
  });

  it('they unlock when the request fails, with the operator\'s text intact', async () => {
    vi.spyOn(api, 'workspaceAdd').mockRejectedValue(new ApiError(409, { ok: false, error: 'slug-taken' }));
    await openAt();
    await pickDemo();
    type('ENG-1234');
    fireEvent.click(start('Start ENG-1234 on team·max'));
    await screen.findByRole('alert');
    expect(field()).toBeEnabled();
    expect(field().value).toBe('ENG-1234');
    expect(screen.getByLabelText('Class')).toBeEnabled();
  });
});

describe('the confirm is pinned, not the last thing in a scrolling body', () => {
  it('lives in the sheet footer, so it stays in reach however tall the preview grows', async () => {
    await openAt();
    await pickDemo();
    type('ENG-1234');
    const confirm = start('Start ENG-1234 on team·max');
    expect(confirm.closest('.sheet-footer')).not.toBeNull();
  });
});

describe('every refusal keeps the sheet open and the text in the field', () => {
  it('an old ccd that cannot title says what clearing the name does AT THIS DOOR: the main checkout, not an automatic workspace', async () => {
    vi.spyOn(api, 'workspaceAdd').mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported', needs: 'ws-title-v1' }));
    await openAt();
    await pickDemo();
    type('ENG-501');
    fireEvent.click(start('Start ENG-501 on team·max'));
    const text = (await screen.findByRole('alert')).textContent ?? '';
    expect(text).toContain('clear the name to start on the main checkout');
    expect(text).not.toContain('automatic name');
  });

  it('a taken slug stays at the project step with the field intact', async () => {
    vi.spyOn(api, 'workspaceAdd').mockRejectedValue(new ApiError(409, { ok: false, error: 'slug-taken' }));
    const { onClose } = await openAt();
    await pickDemo();
    type('ENG-1234');
    fireEvent.click(start('Start ENG-1234 on team·max'));
    expect(await screen.findByRole('alert')).toHaveTextContent('demo-eng-1234 already exists');
    expect(field().value).toBe('ENG-1234');
    expect(onClose).not.toHaveBeenCalled();
    expect(start('Start ENG-1234 on team·max')).toBeEnabled();
  });

  it('an old box says so plainly', async () => {
    vi.spyOn(api, 'workspaceAdd').mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported', needs: 'ws-wrapper-v1' }));
    await openAt();
    await pickDemo();
    type('Login cleanup');
    fireEvent.click(start('Start Login cleanup on team·max'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/ccd is too old to start a named workspace on the account you picked/);
    expect(field().value).toBe('Login cleanup');
  });

  it('an account refusal goes back to the account step with ccd\'s reason, and keeps the project and the name', async () => {
    const add = vi.spyOn(api, 'workspaceAdd')
      .mockRejectedValueOnce(new ApiError(409, { ok: false, error: 'account-refused', reason: 'claude:auth-dead' }))
      .mockResolvedValueOnce({ named: false });
    const { onClose } = await openAt();
    await pickDemo();
    type('Login cleanup');
    fireEvent.click(start('Start Login cleanup on team·max'));

    // The account step, with the reason in words and nothing created.
    expect(await screen.findByRole('alert')).toHaveTextContent("team·max can't sign in right now. Pick another account. Nothing was created.");
    expect(screen.getByRole('button', { name: /team·alt/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(NAME_FIELD_TEXT.label)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Another account: the project is still picked, the name is still typed, and the notice is gone.
    fireEvent.click(screen.getByRole('button', { name: /team·alt/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(field().value).toBe('Login cleanup');
    fireEvent.click(await screen.findByRole('button', { name: 'Start Login cleanup on team·alt' }));
    await waitFor(() => expect(add).toHaveBeenLastCalledWith('demo', { name: 'Login cleanup', wrapper: 'claude9' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('an account refusal AFTER the worktree exists says what is left on the box, never "Nothing was created"', async () => {
    vi.spyOn(api, 'workspaceAdd').mockRejectedValue(new ApiError(409, { ok: false, error: 'account-refused', reason: 'claude:auth-dead', leftBehind: true }));
    const { onClose } = await openAt();
    await pickDemo();
    type('Login cleanup');
    fireEvent.click(start('Start Login cleanup on team·max'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/team·max can't sign in right now\. The worktree and branch for demo-login-cleanup were already made and are still on the fleet box with no session\./);
    expect(alert).toHaveTextContent('adopt them there with: ccd start <account> demo <worktree>');
    expect(alert).not.toHaveTextContent(/Nothing was created/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the refusal goes away when the name is edited', async () => {
    vi.spyOn(api, 'workspaceAdd').mockRejectedValue(new ApiError(409, { ok: false, error: 'slug-taken' }));
    await openAt();
    await pickDemo();
    type('ENG-1234');
    fireEvent.click(start('Start ENG-1234 on team·max'));
    await screen.findByRole('alert');
    type('ENG-1235');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('a door that cannot take a name', () => {
  it('a crossing project disables the field with its sentence, and a typed name is never sent', async () => {
    const create = vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    const add = vi.spyOn(api, 'workspaceAdd');
    await openAt();
    await pickDemo();
    type('Login cleanup');
    expect(start('Start Login cleanup on team·max')).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'show other pools (1)' }));
    fireEvent.click(screen.getByText('quiet-basin'));
    expect(field()).toBeDisabled();
    expect(screen.getByText(NAME_DOOR_TEXT.crossing)).toBeInTheDocument();

    fireEvent.click(start(/^Start quiet-basin on team·max/));
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      wrapper: 'claude', project: 'quiet-basin', workdir: '/w/quiet-basin', crossPool: true,
    }));
    expect(add).not.toHaveBeenCalled();
    expect(api.linearResolve).not.toHaveBeenCalled();
  });

  it('an account a workspace never starts on disables the field with its sentence', async () => {
    const create = vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    const add = vi.spyOn(api, 'workspaceAdd');
    await openAt(/^gpt/);
    await pickDemo();
    expect(field()).toBeDisabled();
    expect(screen.getByText(NAME_DOOR_TEXT.overflow)).toBeInTheDocument();
    fireEvent.click(start(/^Start demo on gpt/));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ wrapper: 'gpt', project: 'demo', workdir: '/w/demo' }));
    expect(add).not.toHaveBeenCalled();
  });

  it('a normal account and an in-pool project leave the door open', async () => {
    await openAt();
    await pickDemo();
    expect(field()).toBeEnabled();
    expect(screen.queryByText(NAME_DOOR_TEXT.crossing)).not.toBeInTheDocument();
    expect(screen.queryByText(NAME_DOOR_TEXT.overflow)).not.toBeInTheDocument();
  });
});

describe('closing and the Settings pointer', () => {
  it('forgets the name and any refusal: the close is a rerender, because vaul unmounts the panel', async () => {
    vi.spyOn(api, 'workspaceAdd').mockRejectedValue(new ApiError(409, { ok: false, error: 'slug-taken' }));
    const { rerender } = await openAt();
    await pickDemo();
    type('ENG-1234');
    fireEvent.click(start('Start ENG-1234 on team·max'));
    await screen.findByRole('alert');

    rerender(false);
    rerender(true);
    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    await pickDemo();
    expect(field().value).toBe('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('forgets an account refusal too: the reopened sheet\'s first step says nothing of it', async () => {
    vi.spyOn(api, 'workspaceAdd').mockRejectedValue(new ApiError(409, { ok: false, error: 'account-refused', reason: 'claude:auth-dead' }));
    const { rerender } = await openAt();
    await pickDemo();
    type('Login cleanup');
    fireEvent.click(start('Start Login cleanup on team·max'));
    await screen.findByRole('alert');

    rerender(false);
    rerender(true);
    expect(await screen.findByRole('button', { name: /team·max/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('an answer that lands after the sheet was closed is not shown to the next opening', async () => {
    let refuse!: (e: unknown) => void;
    vi.spyOn(api, 'workspaceAdd').mockImplementation(() => new Promise((_resolve, reject) => { refuse = reject; }));
    const { rerender } = await openAt();
    await pickDemo();
    type('ENG-1234');
    fireEvent.click(start('Start ENG-1234 on team·max'));
    rerender(false);
    rerender(true);
    await act(async () => { refuse(new ApiError(409, { ok: false, error: 'account-refused', reason: 'claude:auth-dead' })); });
    // The sheet is on its first step, fresh, and holds nothing about a create it never made; the refusal was said once,
    // as an error toast, because a dismissed sheet has nowhere to put it.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await screen.findByText(/can't sign in right now/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /team·max/ })).toBeInTheDocument();
    // Said for a sheet that is gone: it created nothing, and does not send the operator to an account step they left.
    expect(screen.queryByText(/Pick another account/)).not.toBeInTheDocument();
    expect(screen.getByText(/can't sign in right now\. Nothing was created\./)).toBeInTheDocument();
  });

  it('a taken slug that lands after the sheet was closed does not promise the text was kept', async () => {
    let refuse!: (e: unknown) => void;
    vi.spyOn(api, 'workspaceAdd').mockImplementation(() => new Promise((_resolve, reject) => { refuse = reject; }));
    const { rerender } = await openAt();
    await pickDemo();
    type('ENG-1234');
    fireEvent.click(start('Start ENG-1234 on team·max'));
    rerender(false);
    rerender(true);
    await act(async () => { refuse(new ApiError(409, { ok: false, error: 'slug-taken' })); });
    expect(await screen.findByText('demo-eng-1234 already exists. Open it from the board.')).toBeInTheDocument();
    expect(screen.queryByText(/Your text is kept/)).not.toBeInTheDocument();
    expect(screen.queryByText(/change the name/)).not.toBeInTheDocument();
  });

  it('the pointer closes the sheet and goes to Settings → Security', async () => {
    (api.linearResolve as ReturnType<typeof vi.fn>).mockResolvedValue({ title: 'ENG-1234', source: 'offline', note: 'not-configured' });
    const { onClose } = await openAt();
    await pickDemo();
    type('ENG-1234');
    expect(await screen.findByText(LOOKUP_NOTE['not-configured'].hint, undefined, { timeout: 2000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: LOOKUP_NOTE['not-configured'].pointer }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe(LINEAR_SETTINGS_PATH);
  });
});

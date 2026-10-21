// The sheet the project card's `+` opens (named workspaces S7). It is driven the way the screen drives it: `project`
// non-null is open, null is closed, and a close is a `rerender` (vaul unmounts the panel at `open={false}`, so a
// reset that lived inside it would never run). Tests use `fireEvent`: vaul's drag handler raises unhandled errors
// under `userEvent`'s pointer sequence (measured on the branch this design ported from).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import { AddWorkspaceSheet, type AddWorkspaceSheetProps } from '../src/fleet/AddWorkspaceSheet';
import { NAME_FIELD_CLASS, NAME_FIELD_TEXT } from '../src/fleet/WorkspaceNameField';
import type { AddOutcome } from '../src/fleet/useProjectRows';
import { LINEAR_SETTINGS_PATH, LOOKUP_NOTE } from '../src/fleet/workspaceNameWords';
import { matchRoute } from '../src/lib/routes';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { TEST_ROSTER } from './rosterFixture';

beforeEach(() => {
  vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster: TEST_ROSTER });
  vi.spyOn(api, 'linearResolve').mockResolvedValue({ title: 'ENG-1234 - Fix the login flow', source: 'linear', note: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

const ADDED: AddOutcome = { kind: 'added', answer: { named: false } };

const props = (over: Partial<AddWorkspaceSheetProps> = {}): AddWorkspaceSheetProps => ({
  project: 'project-a',
  onClose: vi.fn(),
  add: vi.fn().mockResolvedValue(ADDED),
  adding: false,
  placement: { kind: 'pending' },
  roster: TEST_ROSTER,
  ...over,
});

const mount = (p: AddWorkspaceSheetProps) => render(<><ToastHost /><AddWorkspaceSheet {...p} /></>);
const rerenderWith = (r: ReturnType<typeof mount>, p: AddWorkspaceSheetProps): void => {
  r.rerender(<><ToastHost /><AddWorkspaceSheet {...p} /></>);
};

const field = (): HTMLInputElement => screen.getByLabelText(NAME_FIELD_TEXT.label) as HTMLInputElement;
const type = (text: string): void => { fireEvent.change(field(), { target: { value: text } }); };
const confirm = (name: string | RegExp = 'Add workspace'): HTMLElement => screen.getByRole('button', { name });
const refuse = (status: number, body: unknown): AddOutcome => ({ kind: 'refused', error: new ApiError(status, body) });

describe('opening', () => {
  it('opens on a project and creates nothing', () => {
    const p = props();
    mount(p);
    expect(screen.getByText('Add a workspace to project-a')).toBeInTheDocument();
    expect(p.add).not.toHaveBeenCalled();
  });

  it('is closed for no project', () => {
    mount(props({ project: null }));
    expect(screen.queryByText(/Add a workspace to/)).not.toBeInTheDocument();
  });

  it('never autofocuses the field, so a phone\'s keyboard stays down on the two-tap path', async () => {
    mount(props());
    await screen.findByLabelText(NAME_FIELD_TEXT.label);
    expect(document.activeElement).not.toBe(field());
    expect(document.activeElement?.tagName).not.toBe('INPUT');
  });

  it('says where it will land, from the placement read', async () => {
    mount(props({ placement: { kind: 'measured', pool: { state: 'untagged' }, placement: { kind: 'projected', wrapper: 'claude9', score: 29 } } }));
    expect(await screen.findByText('Lands on team·alt — 71% free.')).toBeInTheDocument();
  });

  it('says nothing about placement when the read says nothing', () => {
    mount(props());
    expect(screen.queryByText(/Lands on/)).not.toBeInTheDocument();
  });
});

describe('an empty field is today\'s create', () => {
  it('sends the project alone: no name, no wrapper', async () => {
    const p = props();
    mount(p);
    fireEvent.click(confirm());
    await waitFor(() => expect(p.add).toHaveBeenCalledTimes(1));
    expect(p.add).toHaveBeenCalledWith('project-a', {});
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('treats a blank field the same way', async () => {
    const p = props();
    mount(p);
    type('   ');
    fireEvent.click(confirm());
    await waitFor(() => expect(p.add).toHaveBeenCalledWith('project-a', {}));
  });

  it('closes without a toast: the new row arrives over the stream', async () => {
    const p = props();
    mount(p);
    fireEvent.click(confirm());
    await waitFor(() => expect(p.onClose).toHaveBeenCalled());
    expect(screen.queryByText(/^Added /)).not.toBeInTheDocument();
  });
});

describe('a name', () => {
  it('keeps ONE confirm label whatever is typed, and sends the name as typed', async () => {
    const p = props();
    mount(p);
    type('ENG-1234');
    fireEvent.click(confirm());
    await waitFor(() => expect(p.add).toHaveBeenCalledWith('project-a', { name: 'ENG-1234' }));
  });

  it('a plain name is named in its own words', async () => {
    const p = props();
    mount(p);
    type('Login cleanup');
    fireEvent.click(confirm());
    await waitFor(() => expect(p.add).toHaveBeenCalledWith('project-a', { name: 'Login cleanup' }));
  });

  it('a named success toasts the title the box gave it, and closes', async () => {
    const p = props({ add: vi.fn().mockResolvedValue({ kind: 'added', answer: { named: true, id: 'project-a-eng-1234', slug: 'eng-1234', title: 'ENG-1234 - Fix the login flow' } }) });
    mount(p);
    type('ENG-1234');
    fireEvent.click(confirm());
    expect(await screen.findByText('Added ENG-1234 - Fix the login flow')).toBeInTheDocument();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('the toast names the title the box answered, not the preview\'s or the typed one (the server resolves again at create)', async () => {
    const p = props({ add: vi.fn().mockResolvedValue({ kind: 'added', answer: { named: true, id: 'project-a-eng-1234', slug: 'eng-1234', title: 'ENG-1234 - Retitled upstream' } }) });
    mount(p);
    type('ENG-1234');
    await screen.findByText('from Linear', undefined, { timeout: 2000 });
    fireEvent.click(confirm());
    expect(await screen.findByText('Added ENG-1234 - Retitled upstream')).toBeInTheDocument();
    expect(screen.queryByText('Added ENG-1234 - Fix the login flow')).not.toBeInTheDocument();
  });

  it('a refused name disables the confirm, says why, and calls nothing', () => {
    const p = props();
    mount(p);
    type('!!');
    const c = confirm();
    expect(c).toBeDisabled();
    expect(screen.getByText('That has no letters or numbers in it.')).toBeInTheDocument();
    fireEvent.click(c);
    expect(p.add).not.toHaveBeenCalled();
    expect(api.linearResolve).not.toHaveBeenCalled();
    type('a');
    expect(confirm()).toBeDisabled();
    expect(p.add).not.toHaveBeenCalled();
  });

  it('un-refuses the moment the name is fixed', () => {
    mount(props());
    type('!!');
    type('Login cleanup');
    expect(confirm()).toBeEnabled();
  });
});

describe('every refusal keeps the sheet open and the text in the field', () => {
  const cases: [string, AddOutcome, RegExp][] = [
    ['a taken slug', refuse(409, { ok: false, error: 'slug-taken' }), /project-a-eng-1234 already exists/],
    ['an old ccd', refuse(501, { ok: false, error: 'unsupported', needs: 'ws-title-v1' }), /ccd is too old to name a workspace/],
    ['ccd\'s own failure', refuse(502, { ok: false, stderr: 'no origin/HEAD' }), /no origin\/HEAD/],
    ['a name the server refused', refuse(400, { ok: false, error: 'bad-name', reason: 'too-short' }), /at least two characters/],
    ['a request that never answered', { kind: 'refused', error: new TypeError('Failed to fetch') }, /may not have been created/],
  ];
  it.each(cases)('%s', async (_name, outcome, words) => {
    const p = props({ add: vi.fn().mockResolvedValue(outcome) });
    mount(p);
    type('ENG-1234');
    fireEvent.click(confirm());
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
    expect(field().value).toBe('ENG-1234');
    expect(p.onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Add a workspace to project-a')).toBeInTheDocument();
    expect(confirm()).toBeEnabled();
  });

  it('the refusal goes away when the operator edits, and a retry sends again', async () => {
    const add = vi.fn().mockResolvedValueOnce(refuse(409, { ok: false, error: 'slug-taken' })).mockResolvedValueOnce(ADDED);
    const p = props({ add });
    mount(p);
    type('ENG-1234');
    fireEvent.click(confirm());
    await screen.findByRole('alert');
    type('ENG-1234-b');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(confirm());
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add).toHaveBeenLastCalledWith('project-a', { name: 'ENG-1234-b' });
    await waitFor(() => expect(p.onClose).toHaveBeenCalled());
  });

  it('an empty-field refusal also stays in the sheet, so another try is one tap', async () => {
    const p = props({ add: vi.fn().mockResolvedValue(refuse(502, { ok: false, stderr: 'no origin/HEAD' })) });
    mount(p);
    fireEvent.click(confirm());
    expect(await screen.findByRole('alert')).toHaveTextContent(/no origin\/HEAD/);
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('a second request for a project whose first has not answered sends nothing and says nothing', async () => {
    const p = props({ add: vi.fn().mockResolvedValue({ kind: 'busy' }) });
    mount(p);
    fireEvent.click(confirm());
    await waitFor(() => expect(p.add).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(p.onClose).not.toHaveBeenCalled();
  });
});

describe('Enter in the field', () => {
  it('submits exactly when the confirm would, and sends the name as typed', async () => {
    const p = props();
    mount(p);
    type('Login cleanup');
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(p.add).toHaveBeenCalledWith('project-a', { name: 'Login cleanup' }));
    expect(p.add).toHaveBeenCalledTimes(1);
  });

  it('an empty field is the plain create, as the confirm is', async () => {
    const p = props();
    mount(p);
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(p.add).toHaveBeenCalledWith('project-a', {}));
  });

  it('sends nothing for a refused name, or while a create is in flight, or while an IME is composing', () => {
    const p = props();
    const r = mount(p);
    type('!!');
    fireEvent.keyDown(field(), { key: 'Enter' });
    type('Login cleanup');
    fireEvent.keyDown(field(), { key: 'Enter', isComposing: true });
    fireEvent.keyDown(field(), { key: 'a' });
    expect(p.add).not.toHaveBeenCalled();
    rerenderWith(r, { ...p, adding: true });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(p.add).not.toHaveBeenCalled();
  });
});

describe('a long name cannot widen the confirm', () => {
  // jsdom lays nothing out; `browser/name-field.browser.test.tsx` measures the rects in Chrome (the confirm ran to 632px
  // at a 390px phone before this). These two hold the mechanism: a column that never sizes past the panel, and a label
  // that is cut with an ellipsis instead of wrapping.
  it('pins the footer to a minmax(0, 1fr) column', () => {
    mount(props());
    expect(confirm().parentElement).toHaveClass('grid-cols-[minmax(0,1fr)]');
  });

  it('cuts the confirm\'s label instead of wrapping it', () => {
    mount(props());
    type('Investigate the flaky upload test on the staging runner');
    const label = confirm().querySelector('span');
    expect(label).toHaveClass('truncate');
    expect(label).toHaveClass('min-w-0');
  });
});

describe('in flight', () => {
  it('locks the field: what is typed cannot change under a request already sent', () => {
    mount(props({ adding: true }));
    expect(field()).toBeDisabled();
  });

  it('dims the field the way the new-session sheet dims its body, so the two doors lock alike', () => {
    mount(props({ adding: true }));
    for (const cls of NAME_FIELD_CLASS.locked.split(' ')) expect(field().closest('[data-locked]')).toHaveClass(cls);
    cleanup();
    mount(props({ adding: false }));
    expect(field().closest('[data-locked]')).toBeNull();
  });

  it('stands the confirm down and says what it is doing', () => {
    mount(props({ adding: true }));
    expect(confirm('Adding…')).toBeDisabled();
  });
});

describe('closing', () => {
  it('forgets the text and the refusal: the close is a rerender, because vaul unmounts the panel', async () => {
    const p = props({ add: vi.fn().mockResolvedValue(refuse(409, { ok: false, error: 'slug-taken' })) });
    const r = mount(p);
    type('ENG-1234');
    fireEvent.click(confirm());
    await screen.findByRole('alert');

    rerenderWith(r, { ...p, project: null });
    await waitFor(() => expect(screen.queryByLabelText(NAME_FIELD_TEXT.label)).not.toBeInTheDocument());
    rerenderWith(r, { ...p, project: 'project-a' });

    expect(field().value).toBe('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(confirm()).toBeEnabled();
  });

  it('an answer that lands after the sheet was closed is not shown to the next opening', async () => {
    let answer!: (o: AddOutcome) => void;
    const p = props({ add: vi.fn().mockImplementation(() => new Promise<AddOutcome>((resolve) => { answer = resolve; })) });
    const r = mount(p);
    type('ENG-1234');
    fireEvent.click(confirm());
    rerenderWith(r, { ...p, project: null });
    rerenderWith(r, { ...p, project: 'project-a' });
    await act(async () => { answer(refuse(409, { ok: false, error: 'slug-taken' })); });
    // Not inside the next opening, but not silent either: the refusal is said once, as an error toast.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // And true without the sheet: the text was NOT kept (a closed sheet forgets), so the toast does not say it was, nor
    // tell the operator to change a name they can no longer see.
    expect(await screen.findByText('project-a-eng-1234 already exists. Open it from the board.')).toBeInTheDocument();
    expect(screen.queryByText(/Your text is kept/)).not.toBeInTheDocument();
    expect(screen.queryByText(/change the name/)).not.toBeInTheDocument();
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('Cancel closes without creating', () => {
    const p = props();
    mount(p);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.add).not.toHaveBeenCalled();
  });

  it('keeps the project\'s name on the title while the sheet slides away', async () => {
    // vaul holds the panel until its exit animation ends; jsdom has none, so one is named for it (the pool sheet's
    // own exit-animation test does the same).
    const getComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElt) => {
      const styles = getComputedStyle(element, pseudoElt);
      if (element instanceof HTMLElement && element.hasAttribute('data-vaul-drawer')) {
        Object.defineProperty(styles, 'animationName', {
          configurable: true,
          get: () => element.dataset.state === 'closed' ? 'slideToBottom' : 'slideFromBottom',
        });
      }
      return styles;
    });
    const p = props();
    const r = mount(p);
    await screen.findByText('Add a workspace to project-a');
    rerenderWith(r, { ...p, project: null });
    // Mid-exit the panel is still on screen, and its title must not have lost the project.
    expect(screen.getByText('Add a workspace to project-a')).toBeInTheDocument();
  });
});

describe('the Settings pointer', () => {
  it('closes the sheet and goes to Settings → Security, where the Linear section is', async () => {
    (api.linearResolve as ReturnType<typeof vi.fn>).mockResolvedValue({ title: 'ENG-1234', source: 'offline', note: 'not-configured' });
    const p = props();
    mount(p);
    type('ENG-1234');
    expect(await screen.findByText(LOOKUP_NOTE['not-configured'].hint, undefined, { timeout: 2000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: LOOKUP_NOTE['not-configured'].pointer }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe(LINEAR_SETTINGS_PATH);
  });

  it('points at the page the route table calls Security, which holds the Linear section', () => {
    expect(LINEAR_SETTINGS_PATH).toBe('/settings/security');
    expect(matchRoute(LINEAR_SETTINGS_PATH)?.route.id).toBe('settings-security');
  });
});

// The Rename sheet (named workspaces S9): the create doors' own field, pre-filled with the workspace's title, changing
// the title and never the slug. Driven the way the actions sheet drives it: `open` and the session are props, a close is a
// `rerender` (vaul unmounts the panel at `open={false}`). Tests use `fireEvent`: vaul's drag handler raises unhandled
// errors under `userEvent`'s pointer sequence.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import type { FleetSession } from '../../shared/api';
import { RenameSheet, type RenameSheetProps } from '../src/fleet/RenameSheet';
import { NAME_FIELD_TEXT } from '../src/fleet/WorkspaceNameField';
import { RENAME_TEXT, classifyRenameError, renameRefusalText } from '../src/fleet/workspaceRenameWords';
import { BLANK_TITLE_TEXT, LINEAR_SETTINGS_PATH, LOOKUP_NOTE } from '../src/fleet/workspaceNameWords';
import { WS_TITLE_MAX_BYTES } from '../../shared/slug';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { fleetSession } from './fleetFixture';

const session = (over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  id: 'project-a-quiet-harbor', project: 'project-a', workspace: 'quiet-harbor', branch: 'ws/quiet-harbor',
  title: 'Investigate flaky upload test', ...over,
});

const props = (over: Partial<RenameSheetProps> = {}): RenameSheetProps => ({
  session: session(), open: true, onClose: vi.fn(), onRenamed: vi.fn(), ...over,
});

const mount = (p: RenameSheetProps) => render(<><ToastHost /><RenameSheet {...p} /></>);
const rerenderWith = (r: ReturnType<typeof mount>, p: RenameSheetProps): void => {
  r.rerender(<><ToastHost /><RenameSheet {...p} /></>);
};

const field = (): HTMLInputElement => screen.getByLabelText(NAME_FIELD_TEXT.label) as HTMLInputElement;
const type = (text: string): void => { fireEvent.change(field(), { target: { value: text } }); };
const button = (name: string | RegExp): HTMLElement => screen.getByRole('button', { name });
const refuse = (status: number, body: unknown): ApiError => new ApiError(status, body);

let rename: MockInstance<typeof api.workspaceTitle>;
beforeEach(() => {
  rename = vi.spyOn(api, 'workspaceTitle').mockResolvedValue({ title: 'Upload retry spike' });
  vi.spyOn(api, 'linearResolve').mockResolvedValue({ title: 'ENG-1301 - Fix the upload retry', source: 'linear', note: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

describe('opening', () => {
  it('pre-fills the current title, says the slug stays, and sends nothing', () => {
    mount(props());
    expect(field().value).toBe('Investigate flaky upload test');
    expect(screen.getByText(RENAME_TEXT.unchanged)).toBeInTheDocument();
    expect(rename).not.toHaveBeenCalled();
  });

  it('never autofocuses the field', async () => {
    mount(props());
    await screen.findByLabelText(NAME_FIELD_TEXT.label);
    expect(document.activeElement).not.toBe(field());
  });

  it('with the title as it stands, Save is disabled and a ticket-shaped title asks Linear nothing', () => {
    mount(props({ session: session({ title: 'ENG-1301 - Fix the upload retry' }) }));
    expect(button(RENAME_TEXT.save)).toBeDisabled();
    expect(api.linearResolve).not.toHaveBeenCalled();
  });

  it('a workspace with no title opens on an empty field, Clear disabled, and says it is named automatically', () => {
    mount(props({ session: session({ title: null }) }));
    expect(field().value).toBe('');
    expect(screen.getByText(RENAME_TEXT.automatic)).toBeInTheDocument();
    expect(button(RENAME_TEXT.clear)).toBeDisabled();
    expect(screen.queryByRole('button', { name: RENAME_TEXT.save })).not.toBeInTheDocument();
  });

  it('is closed when not open', () => {
    mount(props({ open: false }));
    expect(screen.queryByText(RENAME_TEXT.title)).not.toBeInTheDocument();
  });
});

describe('saving a title', () => {
  it('sends the typed title as it is, toasts the title the box gave it, and closes both sheets', async () => {
    const p = props();
    mount(p);
    type('Upload retry spike');
    expect(screen.getByText('slug stays quiet-harbor')).toBeInTheDocument();
    fireEvent.click(button(RENAME_TEXT.save));
    await waitFor(() => expect(rename).toHaveBeenCalledWith('project-a-quiet-harbor', { title: 'Upload retry spike' }));
    await waitFor(() => expect(p.onRenamed).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Renamed to Upload retry spike')).toBeInTheDocument();
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('a ticket id is looked up, shown as the title the board will carry, and sent as typed for the server to resolve', async () => {
    const p = props();
    mount(p);
    type('ENG-1301');
    expect(await screen.findByText('ENG-1301 - Fix the upload retry')).toBeInTheDocument();
    expect(screen.getByText(NAME_FIELD_TEXT.fromLinear)).toBeInTheDocument();
    expect(screen.getByText('slug stays quiet-harbor')).toBeInTheDocument();
    expect(screen.queryByText(/new workspace/)).not.toBeInTheDocument();
    fireEvent.click(button(RENAME_TEXT.save));
    await waitFor(() => expect(rename).toHaveBeenCalledWith('project-a-quiet-harbor', { title: 'ENG-1301' }));
  });

  it('never says a slug is made: no "new workspace" line and no shortened note, even for a long name', () => {
    mount(props());
    type('a very long title '.repeat(4));
    expect(screen.queryByText(/new workspace/)).not.toBeInTheDocument();
    expect(screen.queryByText(NAME_FIELD_TEXT.shortened)).not.toBeInTheDocument();
    expect(screen.getByText('slug stays quiet-harbor')).toBeInTheDocument();
  });

  // A rename never changes the slug, so the slug grammar has no say in a title: these were all refused before.
  it.each([
    ['CJK, no ASCII letter or digit', '日本語のタイトル'],
    ['an emoji', '🚀'],
    ['one character', 'x'],
    ['punctuation', '!!'],
  ])('%s is a title: previewed as typed, the confirm enabled, and sent as typed', async (_why, title) => {
    const p = props();
    mount(p);
    type(title);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText('slug stays quiet-harbor')).toBeInTheDocument();
    expect(button(RENAME_TEXT.save)).toBeEnabled();
    expect(api.linearResolve).not.toHaveBeenCalled();
    fireEvent.click(button(RENAME_TEXT.save));
    await waitFor(() => expect(rename).toHaveBeenCalledWith('project-a-quiet-harbor', { title }));
  });

  it('a title with nothing in it but control characters is refused in the field: its own sentence, the confirm disabled, nothing sent', () => {
    mount(props());
    type('\u0001\u0002');
    expect(screen.getByText(BLANK_TITLE_TEXT)).toBeInTheDocument();
    expect(button(RENAME_TEXT.fixName)).toBeDisabled();
    fireEvent.click(button(RENAME_TEXT.fixName));
    expect(rename).not.toHaveBeenCalled();
  });

  it('a title past the byte cap is previewed as it will be saved: shortened, ending in an ellipsis', () => {
    mount(props());
    type('語'.repeat(400));
    const shown = screen.getByText(/^語+…$/);
    expect(new TextEncoder().encode(shown.textContent ?? '').length).toBeLessThanOrEqual(WS_TITLE_MAX_BYTES);
  });

  it('a Linear lookup that failed keeps the title typed and the Save open, with the way to Settings', async () => {
    vi.spyOn(api, 'linearResolve').mockResolvedValue({ title: 'ENG-1301', source: 'offline', note: 'not-configured' });
    mount(props());
    type('ENG-1301');
    expect(await screen.findByText(LOOKUP_NOTE['not-configured'].hint)).toBeInTheDocument();
    expect(button(RENAME_TEXT.save)).toBeEnabled();
    fireEvent.click(button('Connect Linear in Settings'));
    expect(window.location.pathname).toBe(LINEAR_SETTINGS_PATH);
  });
});

describe('clearing the title', () => {
  it('emptying the field turns the confirm into Clear title, which sends {clear: true}', async () => {
    const p = props();
    mount(p);
    type('');
    expect(screen.getByText(RENAME_TEXT.clearHint)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RENAME_TEXT.save })).not.toBeInTheDocument();
    fireEvent.click(button(RENAME_TEXT.clear));
    await waitFor(() => expect(rename).toHaveBeenCalledWith('project-a-quiet-harbor', { clear: true }));
    await waitFor(() => expect(p.onRenamed).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Title cleared')).toBeInTheDocument();
  });

  it('a blank field is a clear too, never a blank title', async () => {
    mount(props());
    type('   ');
    fireEvent.click(button(RENAME_TEXT.clear));
    await waitFor(() => expect(rename).toHaveBeenCalledWith('project-a-quiet-harbor', { clear: true }));
  });

  it('while a title is typed, a ghost Clear title beside Save clears without emptying the field', async () => {
    mount(props());
    type('Something else');
    expect(button(RENAME_TEXT.save)).toBeEnabled();
    fireEvent.click(button(RENAME_TEXT.clear));
    await waitFor(() => expect(rename).toHaveBeenCalledWith('project-a-quiet-harbor', { clear: true }));
  });

  it('a workspace with no title offers no ghost Clear', () => {
    mount(props({ session: session({ title: null }) }));
    type('Something');
    expect(screen.getByRole('button', { name: RENAME_TEXT.save })).toBeEnabled();
    expect(screen.queryByRole('button', { name: RENAME_TEXT.clear })).toBeNull();
  });
});

describe("each refusal stays in the sheet, in its own sentence, with the operator's text", () => {
  const cases: [string, ApiError][] = [
    ['400 bad-name', refuse(400, { ok: false, error: 'bad-name', reason: 'too-short' })],
    ['400 name-too-long', refuse(400, { ok: false, error: 'name-too-long' })],
    ['400 bad-title', refuse(400, { ok: false, error: 'bad-title', reason: 'too-long' })],
    ['404 unknown-session', refuse(404, { ok: false, error: 'unknown-session' })],
    ['409 not-a-workspace', refuse(409, { ok: false, error: 'not-a-workspace' })],
    ['501 unsupported', refuse(501, { ok: false, error: 'unsupported', needs: 'ws-title' })],
    ['502 title-not-saved', refuse(502, { ok: false, error: 'title-not-saved' })],
    ['502 stderr', refuse(502, { ok: false, stderr: 'no space left' })],
  ];
  it.each(cases)('%s', async (_name, error) => {
    rename.mockRejectedValue(error);
    const p = props();
    mount(p);
    type('Upload retry spike');
    fireEvent.click(button(RENAME_TEXT.save));
    const alert = await screen.findByRole('alert');
    // The sentence the sheet shows is the one `classifyRenameError` + `renameRefusalText` give this error.
    expect(alert).toHaveTextContent(renameRefusalText(classifyRenameError(error)));
    expect(field().value).toBe('Upload retry spike');
    expect(p.onRenamed).not.toHaveBeenCalled();
    expect(button(RENAME_TEXT.save)).toBeEnabled();
  });

  it('a box whose ccd predates the verb is told so plainly', async () => {
    rename.mockRejectedValue(refuse(501, { ok: false, error: 'unsupported', needs: 'ws-title' }));
    mount(props());
    type('Upload retry spike');
    fireEvent.click(button(RENAME_TEXT.save));
    expect(await screen.findByRole('alert')).toHaveTextContent("The fleet box's ccd is too old to rename a workspace.");
  });

  it('a network failure says the title may not have changed', async () => {
    rename.mockRejectedValue(new TypeError('Failed to fetch'));
    mount(props());
    type('Upload retry spike');
    fireEvent.click(button(RENAME_TEXT.save));
    expect(await screen.findByRole('alert')).toHaveTextContent('may not have changed');
  });

  it('typing again clears the refusal', async () => {
    rename.mockRejectedValue(refuse(409, { ok: false, error: 'not-a-workspace' }));
    mount(props());
    type('Upload retry spike');
    fireEvent.click(button(RENAME_TEXT.save));
    await screen.findByRole('alert');
    type('Upload retry spike 2');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('the reset', () => {
  it('a close forgets what was typed and the refusal: reopening starts from the stored title', async () => {
    rename.mockRejectedValue(refuse(409, { ok: false, error: 'not-a-workspace' }));
    const p = props();
    const r = mount(p);
    type('Half typed');
    fireEvent.click(button(RENAME_TEXT.save));
    await screen.findByRole('alert');
    rerenderWith(r, { ...p, open: false });
    rerenderWith(r, { ...p, open: true });
    expect(field().value).toBe('Investigate flaky upload test');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a retarget to another session starts from THAT session\'s title, and drops a text typed for the first', () => {
    const p = props();
    const r = mount(p);
    type('Half typed for A');
    rerenderWith(r, { ...p, session: session({ id: 'project-a-still-water', workspace: 'still-water', title: 'Second title' }) });
    expect(field().value).toBe('Second title');
  });

  it('a title that changes under an open sheet does not overwrite what the operator typed', () => {
    const p = props();
    const r = mount(p);
    type('Half typed');
    rerenderWith(r, { ...p, session: session({ title: 'Changed on the box' }) });
    expect(field().value).toBe('Half typed');
  });

  it("a rename that answers after its sheet was closed does not close the actions sheet or leave a stale state", async () => {
    let finish: (v: { title: string }) => void = () => {};
    rename.mockReturnValue(new Promise((res) => { finish = res; }));
    const p = props();
    const r = mount(p);
    type('Upload retry spike');
    fireEvent.click(button(RENAME_TEXT.save));
    await waitFor(() => expect(rename).toHaveBeenCalled());
    rerenderWith(r, { ...p, open: false });
    finish({ title: 'Upload retry spike' });
    await Promise.resolve();
    await Promise.resolve();
    expect(p.onRenamed).not.toHaveBeenCalled();
  });
});

describe('a refusal that arrives after the sheet was dismissed', () => {
  it('is said once as an error toast, and never shown inside a later opening', async () => {
    let fail: (e: unknown) => void = () => {};
    rename.mockReturnValue(new Promise((_res, rej) => { fail = rej; }));
    const p = props();
    const r = mount(p);
    type('Upload retry spike');
    fireEvent.click(button(RENAME_TEXT.save));
    await waitFor(() => expect(rename).toHaveBeenCalled());
    rerenderWith(r, { ...p, open: false });
    rerenderWith(r, { ...p, open: true });
    fail(refuse(404, { ok: false, error: 'unknown-session' }));
    expect(await screen.findByText(renameRefusalText({ kind: 'unknown-session' }))).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(p.onRenamed).not.toHaveBeenCalled();
  });
});

describe('while a request is in flight', () => {
  it('the confirm says so and a second tap sends nothing more', async () => {
    let finish: (v: { title: string }) => void = () => {};
    rename.mockReturnValue(new Promise((res) => { finish = res; }));
    mount(props());
    type('Upload retry spike');
    fireEvent.click(button(RENAME_TEXT.save));
    const busy = await screen.findByRole('button', { name: RENAME_TEXT.saveBusy });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(rename).toHaveBeenCalledTimes(1);
    finish({ title: 'Upload retry spike' });
  });
});

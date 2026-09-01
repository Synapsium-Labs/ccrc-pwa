// The naming door. The properties that matter are: the `+` no longer creates
// on tap, the auto path is unchanged, a bad name never reaches the server, and
// a refusal keeps the sheet open with the operator's text intact.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewWorkspaceSheet } from '../src/fleet/NewWorkspaceSheet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const setup = (onCreate = vi.fn().mockResolvedValue(undefined)) => {
  const onClose = vi.fn();
  const r = render(
    <NewWorkspaceSheet
      project="demo" onClose={onClose} onCreate={onCreate}
      projectedLabel="Lands on team·alt."
    />,
  );
  return { onCreate, onClose, r };
};


/** `fireEvent`, not `userEvent`: every sheet suite in this tree uses it,
 *  because userEvent's full pointer sequence drives vaul's drag handler and
 *  `getTranslate` throws in jsdom — 16 unhandled TypeErrors that vitest warns
 *  "might cause false positive tests". Found by review of this branch. */
const typeInto = async (v: string): Promise<void> => {
  fireEvent.change(field(), { target: { value: v } });
};

const field = (): HTMLElement => screen.getByLabelText('Name or Linear ticket');
const confirm = (): HTMLElement => screen.getByRole('button', { name: /^(Create|Add a workspace|Creating)/ });

describe('NewWorkspaceSheet', () => {
  it('says where the workspace will land, as a sentence', async () => {
    // A phone never renders a `title` attribute, which is where the card's `+`
    // keeps this fact. The sheet is the one place it can be read.
    setup();
    expect(await screen.findByText('Lands on team·alt.')).toBeTruthy();
  });

  it('the auto path sends NO name — byte-identical to the old one-tap +', async () => {
    const { onCreate } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a workspace to demo' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('demo', undefined));
  });

  it('previews the id that will be created, and creates exactly that', async () => {
    // The preview is load-bearing, not decoration: the slug is the directory,
    // the id, the branch and the unit FOR LIFE, and no verb renames it. The
    // operator sees it before committing.
    const { onCreate } = setup();
    await typeInto('ENG-1234');
    // Scoped to the preview line: the slug deliberately appears TWICE on
    // screen — once as the preview, once in the button's own label — and an
    // unscoped query cannot tell which one it found. `document`, not the
    // render container: Sheet renders through a portal.
    await waitFor(() => expect(document.querySelector('.proj-none')?.textContent ?? '')
      .toContain('demo-eng-1234'));
    fireEvent.click(screen.getByRole('button', { name: 'Create demo-eng-1234' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('demo', 'ENG-1234'));
  });

  it('a pasted Linear URL keeps the title slug Linear already put in it', async () => {
    const { onCreate } = setup();
    await typeInto('https://linear.app/acme/issue/ENG-1234/fix-the-login-flow');
    await waitFor(() => expect(document.querySelector('.proj-none')?.textContent ?? '')
      .toContain('demo-eng-1234-fix-the-login-flow'));
    // The RAW text goes to the server — not a pre-slugified one. The server
    // derives with the same function, and the raw text is what a Linear lookup
    // needs.
    fireEvent.click(confirm());
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(
      'demo', 'https://linear.app/acme/issue/ENG-1234/fix-the-login-flow'));
  });

  it('says when a long name was shortened, rather than silently truncating', async () => {
    setup();
    await typeInto('ENG-1234 fix login redirect loop');
    expect(await screen.findByText(/shortened to fit/)).toBeTruthy();
  });

  it('a bad name disarms the button and never reaches the server', async () => {
    // The client guard is a UX shortcut, not the authority — the server's 400
    // still holds the line. This test says exactly that: the call is not made.
    const { onCreate } = setup();
    await typeInto('!!!');
    await waitFor(() => expect((confirm() as HTMLButtonElement).disabled).toBe(true));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('each refusal says its own thing', async () => {
    // Three reasons, three sentences. Collapsing them would leave the operator
    // guessing which of three different fixes to apply.
    setup();
    await typeInto('x');
    expect(await screen.findByText(/at least two characters/)).toBeTruthy();
    await typeInto('');
    await typeInto('https://github.com/x/y/issues/3');
    expect(await screen.findByText(/isn't a Linear issue/)).toBeTruthy();
  });

  it('a refusal keeps the sheet OPEN with the text intact', async () => {
    // The collision case, which is not an edge case: one ticket maps to one
    // slug, so a second workspace for the same ticket is refused BY DESIGN and
    // the operator's next move is to edit the name — impossible if we closed.
    const onCreate = vi.fn().mockRejectedValue(new Error('slug in use: eng-1234'));
    const { onClose } = setup(onCreate);
    await typeInto('ENG-1234');
    fireEvent.click(confirm());
    expect(await screen.findByText(/slug in use: eng-1234/)).toBeTruthy();
    expect(onClose, 'a refusal must not close the sheet').not.toHaveBeenCalled();
    expect((field() as HTMLInputElement).value).toBe('ENG-1234');
  });

  it('the refusal clears on the next keystroke', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('slug in use: eng-1234'));
    setup(onCreate);
    await typeInto('ENG-1234');
    fireEvent.click(confirm());
    expect(await screen.findByText(/slug in use/)).toBeTruthy();
    // An EDIT of the same name, which is the real next move after a collision
    // — `fireEvent.change` sets the whole value, so this is `ENG-1234` edited
    // to `ENG-12345` rather than a lone keystroke.
    await typeInto('ENG-12345');
    await waitFor(() => expect(screen.queryByText(/slug in use/)).toBeNull());
    // And the field really holds the edit, so the operator did not lose it.
    expect((field() as HTMLInputElement).value).toBe('ENG-12345');
  });

  it('closes on success', async () => {
    const { onClose } = setup();
    await typeInto('ENG-1234');
    fireEvent.click(confirm());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('an empty field does NOT disarm the confirm — naming is optional', async () => {
    // Pins the deliberate decision, so a later change that adds a fourth
    // disabled reason cannot quietly make naming mandatory.
    setup();
    expect((confirm() as HTMLButtonElement).disabled).toBe(false);
  });

  it('the input does not fight a phone keyboard', async () => {
    // A slug is lowercase and a ticket id is not prose. Autocapitalise alone
    // turns `eng-1234` into `Eng-1234` on iOS, which is a different slug.
    setup();
    const el = field();
    expect(el.getAttribute('autocapitalize')).toBe('off');
    expect(el.getAttribute('autocorrect')).toBe('off');
    expect(el.getAttribute('spellcheck')).toBe('false');
    // No autofocus: the auto-name path must stay two thumb taps with no
    // keyboard covering half the screen.
    expect(el.hasAttribute('autofocus')).toBe(false);
  });
});

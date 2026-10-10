// The slash menu's INTEGRATION, which `slash.test.ts` deliberately does not
// reach: that file pins the two pure functions (`slashQuery`,
// `filterCommands`); this one pins what the composer does with them — the one
// fetch per session, its failure arm, the rows it draws, and the text a tap
// leaves in the box.
//
// Measured, not guessed: `Composer.tsx` carried 19 uncovered statements at
// 83.62%, and the slash lane was the bulk of them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Composer } from '../src/session/Composer';
import { api } from '../src/lib/api';

const ID = 'claude:OpenClawHetzner';

const COMMANDS = {
  builtins: [
    { name: 'compact', desc: 'summarize the conversation', kind: 'builtin' as const },
    { name: 'clear', desc: 'start fresh', kind: 'builtin' as const },
  ],
  skills: [
    { name: 'graphify', desc: 'graph the repo', kind: 'skill' as const },
  ],
};

let commands: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  commands = vi.spyOn(api, 'commands').mockResolvedValue(COMMANDS);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const box = () => screen.getByPlaceholderText('Message this session');
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

describe('the slash menu asks the box, once', () => {
  it('fetches on the first `/` and lists builtins and skills together', async () => {
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    expect(commands, 'nothing is fetched before a slash is typed').not.toHaveBeenCalled();
    type('/');
    await waitFor(() => expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument());
    expect(commands).toHaveBeenCalledWith(ID);
    expect(screen.getByText('/compact')).toBeInTheDocument();
    expect(screen.getByText('/graphify')).toBeInTheDocument();
  });

  it('marks a SKILL and leaves a builtin unmarked — they are not the same thing', async () => {
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    type('/');
    const skill = await screen.findByText('/graphify');
    expect(skill.querySelector('.slash-badge')?.textContent).toBe('skill');
    expect(screen.getByText('/compact').querySelector('.slash-badge'),
      'a builtin wearing a skill badge would be a lie about where it runs').toBeNull();
  });

  it('caches for the session: a second `/` costs no second request', async () => {
    // `commands !== null` in the effect's guard. The route makes one agent
    // round trip per call, and the command list cannot change under a running
    // session.
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    type('/');
    await screen.findByText('/compact');
    type('hello');
    type('/com');
    await screen.findByText('/compact');
    expect(commands).toHaveBeenCalledTimes(1);
  });

  it('narrows as the query grows, through `filterCommands`', async () => {
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    type('/cl');
    await screen.findByText('/clear');
    expect(screen.queryByText('/graphify'), 'a narrowed query must not keep offering everything').toBeNull();
  });
});

describe('what a tap leaves behind', () => {
  it('writes `/name ` WITH the trailing space, and puts focus back in the box', async () => {
    // The space is the whole point: the reader's next keystroke is the
    // command's argument, and a composer that made them type a separator
    // first would have taken the tap and given nothing back.
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    type('/com');
    fireEvent.click(await screen.findByRole('button', { name: /\/compact/ }));
    expect((box() as HTMLTextAreaElement).value).toBe('/compact ');
    expect(document.activeElement, 'the box keeps the caret — the next thing typed is an argument')
      .toBe(box());
  });
});

describe('when the box cannot answer', () => {
  it('renders no menu and does not retry on the next keystroke', async () => {
    // The `.catch(() => setCommands([]))` arm: `[]` is "asked and got
    // nothing", which is what stops the effect asking again — a retry per
    // keystroke would be one agent round trip per character.
    commands.mockRejectedValue(new Error('501'));
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    type('/');
    await waitFor(() => expect(commands).toHaveBeenCalledTimes(1));
    type('/co');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(commands).toHaveBeenCalledTimes(1);
  });

  it('asks nothing at all without a session id', () => {
    // The composer renders on a screen whose id has not resolved yet; a
    // request keyed on `undefined` would 404 and poison the cache with `[]`.
    render(<Composer onSend={vi.fn()} pending={[]} />);
    type('/');
    expect(commands).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows no menu for ordinary prose', async () => {
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    type('hello there');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(commands).not.toHaveBeenCalled();
  });
});

// — the gates on the drop target, and the send nobody can make —
describe('a composer with no session, or a dead one', () => {
  it('a drag over it arms no overlay, and a drop stages nothing', () => {
    // Both halves gated on the SAME pair, and both arms uncovered: a composer
    // with no `id` has nowhere to upload to, and a disabled one belongs to a
    // dead session. Arming the dashed overlay there promises a drop that
    // cannot land.
    const { container } = render(<Composer onSend={vi.fn()} pending={[]} />);
    const composer = container.querySelector('.composer');
    if (!(composer instanceof HTMLElement)) throw new Error('no .composer');

    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.dragOver(composer, { dataTransfer: { files: [file], types: ['Files'] } });
    expect(composer.getAttribute('data-drop'), 'the overlay armed with nowhere to upload').toBeNull();

    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    composer.dispatchEvent(ev);
    expect(ev.defaultPrevented, 'the drop was claimed by a composer that cannot take it').toBe(false);
  });

  it('a DISABLED composer with a session is gated the same way', () => {
    const { container } = render(<Composer id={ID} onSend={vi.fn()} pending={[]} disabled />);
    const composer = container.querySelector('.composer');
    if (!(composer instanceof HTMLElement)) throw new Error('no .composer');
    fireEvent.dragOver(composer, { dataTransfer: { files: [], types: ['Files'] } });
    expect(composer.getAttribute('data-drop')).toBeNull();
  });

  it('Send does nothing at all on an empty box', () => {
    // `canSend`'s own guard, behind a button that is already disabled for the
    // same reason — so this pins the OUTCOME the two share. An Enter keypress
    // reaches the handler even where a tap cannot.
    const onSend = vi.fn();
    const { container } = render(<Composer id={ID} onSend={onSend} pending={[]} />);
    const box = container.querySelector('textarea');
    if (!(box instanceof HTMLTextAreaElement)) throw new Error('no textarea');
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend, 'a whitespace-only box was sent').not.toHaveBeenCalled();
  });
});

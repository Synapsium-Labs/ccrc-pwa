// The composer's opt-in props for the Overlord chat (Overlord W1, the chat, Task 4; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`, question 5: the kept draft).
//
// First, a CHARACTERIZATION of the Session screen's composer as it is, green on the composer before the props landed and
// unchanged after: the box clears at hand-off, the text of a failed send lives in its `PendingSend` (the store's), a
// `draft-present` refusal opens the conflict sheet, W1a's `renewing` keeps the text in the failed bubble, and with no
// session id there is no attach control and no slash read. Then the two props: `onRecord`, which keeps the text until the
// answer and clears only on `clear`, and `leading`, a node drawn before the send control.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Composer } from '../src/session/Composer';
import { createSessionStore, type SessionStoreDeps } from '../src/stores/session';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';

type Prompt = NonNullable<SessionStoreDeps['api']>['prompt'];

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const box = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: 'Message' });
const type = (text: string): void => { fireEvent.change(box(), { target: { value: text } }); };
const sendButton = (): HTMLElement => screen.getByRole('button', { name: 'Send' });

function harness(prompt: Prompt) {
  const store = createSessionStore('lane-a-project-a', { api: { prompt } });
  function Harness() {
    const pending = store((s) => s.pending);
    return <Composer onSend={store.getState().send} pending={pending} onResolve={store.getState().resolve} />;
  }
  render(<Harness />);
  return store;
}

describe('the Session screen\'s composer, as it is (characterization)', () => {
  it('a send hands the text over and clears the box at once, before any answer', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} pending={[]} />);
    type('hello there');
    fireEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledWith('hello there');
    expect(onSend.mock.calls[0]).toHaveLength(1);
    expect(box().value, 'cleared in the same act, not after the answer').toBe('');
  });

  it('a failed send keeps its text in the store\'s PendingSend, not in the box', async () => {
    const prompt = vi.fn<Prompt>().mockRejectedValue(new ApiError(500, { ok: false, error: 'tmux-failed' }));
    const store = harness(prompt);
    type('lost words');
    await act(async () => { fireEvent.click(sendButton()); });
    expect(box().value).toBe('');
    expect(store.getState().pending).toEqual([expect.objectContaining({ text: 'lost words', state: 'failed' })]);
  });

  it('a draft-present refusal opens the conflict sheet, and Replace re-sends through onResolve', async () => {
    const prompt = vi.fn<Prompt>()
      .mockRejectedValueOnce(new ApiError(409, { ok: false, error: 'draft-present', draft: 'left over' }))
      .mockResolvedValue(undefined);
    harness(prompt);
    type('mine');
    await act(async () => { fireEvent.click(sendButton()); });
    fireEvent.click(await screen.findByRole('button', { name: 'Replace draft' }));
    expect(prompt).toHaveBeenLastCalledWith('lane-a-project-a', 'mine', expect.objectContaining({ replaceDraft: true }));
  });

  it('W1a\'s renewing refusal keeps the text in the failed bubble and opens no sheet', async () => {
    const prompt = vi.fn<Prompt>().mockRejectedValue(new ApiError(503, { ok: false, error: 'renewing' }));
    const store = harness(prompt);
    type('wait for me');
    await act(async () => { fireEvent.click(sendButton()); });
    expect(box().value).toBe('');
    expect(store.getState().pending).toEqual([expect.objectContaining({ text: 'wait for me', state: 'failed', code: 'renewing' })]);
    expect(screen.queryByRole('button', { name: 'Replace draft' })).toBeNull();
  });

  it('with no session id there is no attach control and a slash reads no commands', () => {
    const commands = vi.spyOn(api, 'commands');
    render(<Composer onSend={vi.fn()} pending={[]} />);
    expect(screen.queryByRole('button', { name: /attach/i })).toBeNull();
    type('/');
    expect(commands).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox', { name: 'Slash commands' })).toBeNull();
  });
});

describe('onRecord: the text is kept until the answer, and cleared only on clear', () => {
  const deferred = () => {
    let settle: (v: 'clear' | 'keep') => void = () => {};
    const p = new Promise<'clear' | 'keep'>((r) => { settle = r; });
    return { p, settle };
  };

  it('keeps the text while the answer is on its way, holds Send, then clears on clear', async () => {
    const d = deferred();
    const onRecord = vi.fn(() => d.p);
    const onSend = vi.fn();
    render(<Composer onSend={onSend} onRecord={onRecord} pending={[]} />);
    type('to the Overlord');
    fireEvent.click(sendButton());
    expect(onRecord).toHaveBeenCalledWith('to the Overlord');
    expect(onSend, 'onRecord takes the send').not.toHaveBeenCalled();
    expect(box().value, 'kept until the answer').toBe('to the Overlord');
    expect(sendButton(), 'one send at a time').toBeDisabled();
    await act(async () => { d.settle('clear'); await d.p; });
    expect(box().value).toBe('');
  });

  it('keeps the text on keep, and Send works again', async () => {
    render(<Composer onRecord={() => Promise.resolve('keep' as const)} pending={[]} />);
    type('refused once');
    await act(async () => { fireEvent.click(sendButton()); });
    expect(box().value).toBe('refused once');
    expect(sendButton()).not.toBeDisabled();
  });

  it('keeps the text when the answer throws', async () => {
    render(<Composer onRecord={() => Promise.reject(new Error('boom'))} pending={[]} />);
    type('still here');
    await act(async () => { fireEvent.click(sendButton()); });
    expect(box().value).toBe('still here');
    expect(sendButton()).not.toBeDisabled();
  });

  it('a draft edited while the answer is on its way is not cleared by it', async () => {
    const d = deferred();
    render(<Composer onRecord={() => d.p} pending={[]} />);
    type('first');
    fireEvent.click(sendButton());
    type('first, and more');
    await act(async () => { d.settle('clear'); await d.p; });
    expect(box().value).toBe('first, and more');
  });
});

describe('leading: a node drawn before the send control', () => {
  it('draws the node inside the input bar, before Send', () => {
    render(<Composer onRecord={() => Promise.resolve('keep' as const)} pending={[]}
      leading={<button type="button">Off the record</button>} />);
    const lead = screen.getByRole('button', { name: 'Off the record' });
    const send = sendButton();
    expect(lead.closest('.inputbar')).not.toBeNull();
    expect(lead.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

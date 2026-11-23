// Paste chips in the composer (desktop-polish wave 169; Goals modification 90, second half): the component half. The
// decision is pinned in paste-chips.test.ts; this pins that the composer acts on it. A long text paste shows as one
// token in the field and one chip in the row above it, the send carries the full text byte for byte through today's
// send rules, Expand and Remove act from the row, Backspace takes a whole token, a broken token comes back as text, and
// the retry and draft-conflict paths re-send the expanded text through the real session store.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Composer } from '../src/session/Composer';
import { createSessionStore, type SessionStoreDeps } from '../src/stores/session';

type Prompt = NonNullable<SessionStoreDeps['api']>['prompt'];
import { ApiError } from '../src/lib/apiError';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const lines = (n: number, tag = 'line'): string => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n');

const field = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
const sendButton = (): HTMLElement => screen.getByRole('button', { name: 'Send' });

/** Paste `text` at the field's current selection; returns whether the browser's own paste would have run. */
const pasteText = (text: string): boolean =>
  fireEvent.paste(field(), { clipboardData: { items: [], files: [], getData: () => text } });

/** An edit as the browser makes one: the new value, the caret it leaves, then the `input` event React reads. */
const edit = (value: string, caret = value.length): void => {
  const el = field();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
  el.setSelectionRange(caret, caret);
  fireEvent.input(el);
};

const caretAt = (at: number): void => {
  field().focus();
  field().setSelectionRange(at, at);
};

const mount = () => {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} pending={[]} />);
  return onSend;
};

describe('a long paste becomes a chip', () => {
  it('one chip: the field shows the token, the row shows the chip, the send carries the full text', () => {
    const onSend = mount();
    const text = 'q'.repeat(900);
    expect(pasteText(text)).toBe(false); // the composer took the paste
    expect(field().value).toBe('[Pasted text #1 +1 line]');
    expect(screen.getByRole('list', { name: 'Pasted text' })).toBeInTheDocument();
    fireEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledWith(text);
    expect(field().value).toBe('');
    expect(screen.queryByRole('list', { name: 'Pasted text' })).toBeNull();
  });

  it('several chips among typed text, byte for byte, in their places', () => {
    const onSend = mount();
    const t1 = lines(20, 'one');
    const t2 = 'z'.repeat(850);
    edit('before  middle  after');
    caretAt(7);
    pasteText(t1);
    const at = field().value.indexOf('middle') + 'middle '.length;
    caretAt(at);
    pasteText(t2);
    expect(field().value).toBe('before [Pasted text #1 +20 lines] middle [Pasted text #2 +1 line] after');
    fireEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledWith(`before ${t1} middle ${t2} after`);
  });

  it('a chip at the start and one at the end', () => {
    const onSend = mount();
    const t1 = 's'.repeat(800);
    const t2 = lines(13);
    edit('typed');
    caretAt(0);
    pasteText(t1);
    caretAt(field().value.length);
    pasteText(t2);
    fireEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledWith(`${t1}typed${t2}`);
  });

  it('CR LF content is sent as the LF the field would have held', () => {
    const onSend = mount();
    const raw = Array.from({ length: 14 }, (_, i) => `crlf ${i}`).join('\r\n');
    pasteText(raw);
    expect(field().value).toBe('[Pasted text #1 +14 lines]');
    fireEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledWith(raw.replace(/\r\n/g, '\n'));
  });

  it('tab-bearing content keeps every tab; only today’s whole-message trim touches the edges', () => {
    const onSend = mount();
    const inner = `def f():\n\treturn 1\t# tab\n${'\tcol\tcol\n'.repeat(12)}end`;
    pasteText(`\n  ${inner}  \n`);
    fireEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledWith(inner);
  });

  it('a whitespace-only long paste cannot be sent, as typed whitespace cannot', () => {
    const onSend = mount();
    pasteText(' '.repeat(900));
    expect(field().value).toBe('[Pasted text #1 +1 line]');
    expect(sendButton()).toBeDisabled();
    fireEvent.click(sendButton());
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('the floors', () => {
  it('799 characters goes in as ordinary text; 800 is a chip', () => {
    mount();
    expect(pasteText('a'.repeat(799))).toBe(true);
    expect(screen.queryByRole('list', { name: 'Pasted text' })).toBeNull();
    expect(pasteText('a'.repeat(800))).toBe(false);
    expect(field().value).toBe('[Pasted text #1 +1 line]');
  });

  it('12 lines goes in as ordinary text; 13 lines is a chip', () => {
    mount();
    expect(pasteText(lines(12))).toBe(true);
    expect(pasteText(lines(13))).toBe(false);
    expect(field().value).toBe('[Pasted text #1 +13 lines]');
  });
});

describe('numbering', () => {
  it('counts up within a draft and starts again at #1 after a send', () => {
    mount();
    pasteText(lines(13));
    caretAt(field().value.length);
    pasteText(lines(14));
    expect(field().value).toBe('[Pasted text #1 +13 lines][Pasted text #2 +14 lines]');
    fireEvent.click(sendButton());
    pasteText(lines(15));
    expect(field().value).toBe('[Pasted text #1 +15 lines]');
  });
});

describe('expand and remove from the chip row', () => {
  it('Expand puts the full text in the field in place, as ordinary text', () => {
    const onSend = mount();
    const text = lines(14);
    edit('a  b');
    caretAt(2);
    pasteText(text);
    fireEvent.click(screen.getByRole('button', { name: 'Expand pasted text #1, 14 lines, into the message' }));
    expect(field().value).toBe(`a ${text} b`);
    expect(screen.queryByRole('list', { name: 'Pasted text' })).toBeNull();
    fireEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledWith(`a ${text} b`);
  });

  it('Remove takes the token and its text together', () => {
    const onSend = mount();
    edit('a  b');
    caretAt(2);
    pasteText(lines(14));
    fireEvent.click(screen.getByRole('button', { name: 'Remove pasted text #1' }));
    expect(field().value).toBe('a  b');
    fireEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledWith('a  b');
  });

  it('Backspace right after a token removes the whole token; Delete right before one does too', () => {
    mount();
    edit('ab');
    caretAt(1);
    pasteText(lines(14));
    const token = '[Pasted text #1 +14 lines]';
    caretAt(1 + token.length);
    fireEvent.keyDown(field(), { key: 'Backspace' });
    expect(field().value).toBe('ab');
    caretAt(1);
    pasteText(lines(15));
    caretAt(1);
    fireEvent.keyDown(field(), { key: 'Delete' });
    expect(field().value).toBe('ab');
  });
});

describe('never lose pasted text silently', () => {
  it('a hand-edited token is expanded back to its full text in place, with what was typed', () => {
    const onSend = mount();
    const text = lines(14);
    edit('ab');
    caretAt(1);
    pasteText(text);
    const v = field().value;
    edit(`${v.slice(0, 6)}X${v.slice(6)}`, 7);
    expect(field().value).toBe(`a${text}Xb`);
    fireEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledWith(`a${text}Xb`);
  });

  it('undo then redo of a chip insertion brings the token back with its text', () => {
    const onSend = mount();
    const text = lines(30);
    pasteText(text);
    const token = field().value;
    edit('', 0); // the browser's undo
    expect(screen.queryByRole('list', { name: 'Pasted text' })).toBeNull();
    edit(token); // its redo
    expect(screen.getByRole('list', { name: 'Pasted text' })).toBeInTheDocument();
    fireEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledWith(text);
  });
});

describe('the retry and draft-conflict paths send the expanded text', () => {
  const harness = (prompt: Prompt) => {
    const store = createSessionStore('lane-a-project-a', { api: { prompt } });
    function Harness() {
      const pending = store((s) => s.pending);
      return <Composer onSend={store.getState().send} pending={pending} onResolve={store.getState().resolve} />;
    }
    render(<Harness />);
    return store;
  };

  it('Retry re-sends the full text, not the token', async () => {
    const prompt = vi.fn<Prompt>()
      .mockRejectedValueOnce(new ApiError(503, { ok: false, error: 'agent-down' }))
      .mockResolvedValue(undefined);
    const store = harness(prompt);
    const text = lines(20);
    edit('see: ');
    caretAt(5);
    pasteText(text);
    await act(async () => { fireEvent.click(sendButton()); });
    expect(prompt).toHaveBeenNthCalledWith(1, 'lane-a-project-a', `see: ${text}`, expect.anything());
    const failed = store.getState().pending.find((p) => p.state === 'failed');
    expect(failed?.text).toBe(`see: ${text}`);
    await act(async () => { store.getState().retry(failed!.key); });
    expect(prompt).toHaveBeenNthCalledWith(2, 'lane-a-project-a', `see: ${text}`, expect.anything());
  });

  it('the draft-conflict sheet’s Replace draft and Append anyway carry the full text', async () => {
    const prompt = vi.fn<Prompt>()
      .mockRejectedValueOnce(new ApiError(409, { ok: false, error: 'draft-present', draft: 'left over' }))
      .mockResolvedValue(undefined);
    harness(prompt);
    const text = 'w'.repeat(1200);
    pasteText(text);
    await act(async () => { fireEvent.click(sendButton()); });
    fireEvent.click(await screen.findByRole('button', { name: 'Append anyway' }));
    expect(prompt).toHaveBeenLastCalledWith('lane-a-project-a', `left over\n${text}`, expect.objectContaining({ replaceDraft: true }));
  });

  it('Replace draft carries the full text alone', async () => {
    const prompt = vi.fn<Prompt>()
      .mockRejectedValueOnce(new ApiError(409, { ok: false, error: 'draft-present', draft: 'left over' }))
      .mockResolvedValue(undefined);
    harness(prompt);
    const text = lines(40);
    pasteText(text);
    await act(async () => { fireEvent.click(sendButton()); });
    fireEvent.click(await screen.findByRole('button', { name: 'Replace draft' }));
    expect(prompt).toHaveBeenLastCalledWith('lane-a-project-a', text, expect.objectContaining({ replaceDraft: true }));
  });
});

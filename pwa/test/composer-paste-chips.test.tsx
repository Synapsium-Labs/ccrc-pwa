// Paste chips in the composer (desktop-polish wave 169; Goals modification 90, second half): the component half. The
// decisions are pinned in paste-chips.test.ts; this pins that the composer performs them. A long text paste shows as one
// label in the field and one chip in the row above it; the send carries the full text byte for byte through today's
// send rules; Expand and Remove act from the row and leave focus and the caret in the field; Backspace and Delete
// (planned at `beforeinput`) take a whole label with typed text kept on both sides; a key typed inside a label expands
// it; an edit that lands anyway is repaired; a label that is only text stays text (review 3457 F4, A1); copy and cut
// carry a chip's full text, and a drag of one is refused; undo and redo restore the draft the field held, by position
// (review 3469 F1-F3); an input method's composition is never scripted and is repaired when it ends (F4); and the retry
// and draft-conflict paths re-send the expanded text through the real session store. jsdom has no `execCommand`, so every edit here takes the composer's fallback path;
// the browser leg (`browser/paste-chips.browser.test.ts`) measures the native one.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Composer } from '../src/session/Composer';
import { createSessionStore, type SessionStoreDeps } from '../src/stores/session';
import { ApiError } from '../src/lib/apiError';

type Prompt = NonNullable<SessionStoreDeps['api']>['prompt'];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const lines = (n: number, tag = 'line'): string => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n');
const label = (n: number, l: number): string => `[Pasted text #${n} +${l} ${l === 1 ? 'line' : 'lines'}]`;

const field = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
const sendButton = (): HTMLElement => screen.getByRole('button', { name: 'Send' });
const chipRow = (): HTMLElement | null => screen.queryByRole('list', { name: 'Pasted text' });

/** Paste `text` at the field's current selection; returns whether the browser's own paste would have run. */
const pasteText = (text: string): boolean =>
  fireEvent.paste(field(), { clipboardData: { items: [], files: [], getData: () => text } });

/** An edit as the browser makes one: the new value, the caret it leaves, then the `input` event React reads. */
const edit = (value: string, caret = value.length, inputType = 'insertText'): void => {
  const el = field();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
  el.setSelectionRange(caret, caret);
  fireEvent(el, new InputEvent('input', { bubbles: true, inputType }));
};

/** A `beforeinput` at the field's selection; returns whether the browser's own edit would have run. */
const beforeInput = (inputType: string, data: string | null = null): boolean => {
  let browsers = true;
  act(() => {
    browsers = field().dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data }));
  });
  return browsers;
};

const caretAt = (at: number, end = at): void => {
  field().focus();
  field().setSelectionRange(at, end);
};

/** Focus somewhere else, as a click on a chip's control does. */
const blurField = (): void => {
  screen.getByRole('button', { name: 'Send' }).focus();
};

const mount = (props: Partial<Parameters<typeof Composer>[0]> = {}) => {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} pending={[]} {...props} />);
  return onSend;
};

const send = (onSend: ReturnType<typeof vi.fn>): unknown => {
  fireEvent.click(sendButton());
  return onSend.mock.calls.at(-1)?.[0];
};

describe('a long paste becomes a chip', () => {
  it('one chip: the field shows the label, the row shows the chip, the send carries the full text', () => {
    const onSend = mount();
    const text = 'q'.repeat(900);
    expect(pasteText(text)).toBe(false); // the composer took the paste
    expect(field().value).toBe(label(1, 1));
    expect(chipRow()).toBeInTheDocument();
    expect(send(onSend)).toBe(text);
    expect(field().value).toBe('');
    expect(chipRow()).toBeNull();
  });

  it('several chips among typed text, byte for byte, in their places', () => {
    const onSend = mount();
    const t1 = lines(20, 'one');
    const t2 = 'z'.repeat(850);
    edit('before  middle  after');
    caretAt(7);
    pasteText(t1);
    caretAt(field().value.indexOf('middle') + 'middle '.length);
    pasteText(t2);
    expect(field().value).toBe(`before ${label(1, 20)} middle ${label(2, 1)} after`);
    expect(send(onSend)).toBe(`before ${t1} middle ${t2} after`);
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
    expect(send(onSend)).toBe(`${t1}typed${t2}`);
  });

  it('CR LF content is sent as the LF the field would have held', () => {
    const onSend = mount();
    const raw = Array.from({ length: 14 }, (_, i) => `crlf ${i}`).join('\r\n');
    pasteText(raw);
    expect(field().value).toBe(label(1, 14));
    expect(send(onSend)).toBe(raw.replace(/\r\n/g, '\n'));
  });

  it('tab-bearing content keeps every tab; only today’s whole-message trim touches the edges', () => {
    const onSend = mount();
    const inner = `def f():\n\treturn 1\t# tab\n${'\tcol\tcol\n'.repeat(12)}end`;
    pasteText(`\n  ${inner}  \n`);
    expect(send(onSend)).toBe(inner);
  });

  it('a whitespace-only long paste cannot be sent, as typed whitespace cannot', () => {
    const onSend = mount();
    pasteText(' '.repeat(900));
    expect(field().value).toBe(label(1, 1));
    expect(sendButton()).toBeDisabled();
    fireEvent.click(sendButton());
    expect(onSend).not.toHaveBeenCalled();
  });

  it('during a turn, a whitespace-only chip is no draft: the slot stays Stop (A2)', () => {
    mount({ busy: true, onInterrupt: vi.fn() });
    pasteText(' '.repeat(900));
    expect(field().value).toBe(label(1, 1));
    // Nothing would be sent, so the send slot is still the one Stop, and no Send shows.
    expect(screen.getAllByRole('button', { name: 'Stop' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });
});

describe('the floors', () => {
  it('799 characters goes in as ordinary text; 800 is a chip', () => {
    mount();
    expect(pasteText('a'.repeat(799))).toBe(true);
    expect(chipRow()).toBeNull();
    expect(pasteText('a'.repeat(800))).toBe(false);
    expect(field().value).toBe(label(1, 1));
  });

  it('12 lines goes in as ordinary text; 13 lines is a chip', () => {
    mount();
    expect(pasteText(lines(12))).toBe(true);
    expect(pasteText(lines(13))).toBe(false);
    expect(field().value).toBe(label(1, 13));
  });
});

describe('numbering', () => {
  it('counts up within a draft and starts again at #1 after a send', () => {
    const onSend = mount();
    pasteText(lines(13));
    caretAt(field().value.length);
    pasteText(lines(14));
    expect(field().value).toBe(`${label(1, 13)}${label(2, 14)}`);
    send(onSend);
    pasteText(lines(15));
    expect(field().value).toBe(label(1, 15));
  });
});

describe('expand and remove from the chip row leave focus and the caret in the field (F3)', () => {
  it('Expand puts the full text in the field in place, caret after it', () => {
    const onSend = mount();
    const text = lines(14);
    edit('a  b');
    caretAt(2);
    pasteText(text);
    blurField();
    fireEvent.click(screen.getByRole('button', { name: 'Expand pasted text #1, 14 lines, into the message' }));
    expect(field().value).toBe(`a ${text} b`);
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd]).toEqual([2 + text.length, 2 + text.length]);
    expect(chipRow()).toBeNull();
    expect(send(onSend)).toBe(`a ${text} b`);
  });

  it('Remove takes the label and its text together, caret where it stood', () => {
    const onSend = mount();
    edit('a  b');
    caretAt(2);
    pasteText(lines(14));
    blurField();
    fireEvent.click(screen.getByRole('button', { name: 'Remove pasted text #1' }));
    expect(field().value).toBe('a  b');
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd]).toEqual([2, 2]);
    expect(send(onSend)).toBe('a  b');
  });
});

describe('Backspace and Delete take a whole label, with typed text kept on both sides (F2)', () => {
  const setup = (): string => {
    edit('ab');
    caretAt(1);
    pasteText(lines(14));
    return label(1, 14);
  };

  it('Backspace right after the label', () => {
    const onSend = mount();
    const token = setup();
    caretAt(1 + token.length);
    expect(beforeInput('deleteContentBackward')).toBe(false); // the composer took the key
    expect(field().value).toBe('ab');
    expect([field().selectionStart, field().selectionEnd]).toEqual([1, 1]);
    expect(send(onSend)).toBe('ab');
  });

  it('Delete right before the label', () => {
    const onSend = mount();
    setup();
    caretAt(1);
    expect(beforeInput('deleteContentForward')).toBe(false);
    expect(field().value).toBe('ab');
    expect(send(onSend)).toBe('ab');
  });

  it('a key typed inside the label expands it, then the key; the caret follows the key', () => {
    const onSend = mount();
    setup();
    caretAt(6);
    expect(beforeInput('insertText', 'X')).toBe(false);
    expect(field().value).toBe(`a${lines(14)}Xb`);
    expect([field().selectionStart, field().selectionEnd]).toEqual([2 + lines(14).length, 2 + lines(14).length]);
    expect(send(onSend)).toBe(`a${lines(14)}Xb`);
  });

  it('a short paste inside the label expands it, then the pasted text', () => {
    const onSend = mount();
    setup();
    caretAt(6);
    expect(pasteText('hi')).toBe(false);
    expect(field().value).toBe(`a${lines(14)}hib`);
    expect(send(onSend)).toBe(`a${lines(14)}hib`);
  });

  it('keys away from any label are the browser’s own', () => {
    mount();
    setup();
    caretAt(0);
    expect(beforeInput('insertText', 'X')).toBe(true);
    expect(beforeInput('deleteContentBackward')).toBe(true);
  });
});

describe('never lose pasted text silently', () => {
  it('an edit that lands inside a label anyway is repaired in place, caret after what was typed', () => {
    const onSend = mount();
    const text = lines(14);
    edit('ab');
    caretAt(1);
    pasteText(text);
    const v = field().value;
    edit(`${v.slice(0, 6)}X${v.slice(6)}`, 7, 'insertFromDrop');
    expect(field().value).toBe(`a${text}Xb`);
    expect([field().selectionStart, field().selectionEnd]).toEqual([1 + text.length + 1, 1 + text.length + 1]);
    expect(send(onSend)).toBe(`a${text}Xb`);
  });

  it('undo after a removal brings the chip back with its text; a typed label does not', () => {
    const onSend = mount();
    const text = lines(30);
    pasteText(text);
    const token = field().value;
    caretAt(token.length);
    beforeInput('deleteContentBackward');
    expect(field().value).toBe('');
    edit(token, token.length, 'historyUndo');
    expect(chipRow()).toBeInTheDocument();
    expect(send(onSend)).toBe(text);
    // The same label typed by hand into a fresh draft is text.
    pasteText(lines(30, 'other'));
    caretAt(field().value.length);
    beforeInput('deleteContentBackward');
    edit(token, token.length, 'insertText');
    expect(chipRow()).toBeNull();
    expect(send(onSend)).toBe(token);
  });
});

describe('an input method’s composition is never scripted (review 3469 F4)', () => {
  /** A composition event as Chrome sends one: composing, and not cancelable. */
  const composing = (data: string): boolean => {
    let browsers = true;
    act(() => {
      browsers = field().dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: false, inputType: 'insertCompositionText', data, isComposing: true,
      }));
    });
    return browsers;
  };

  it('a composition beforeinput inside a label is left to the browser: no plan is performed', () => {
    mount();
    const text = lines(14);
    edit('ab');
    caretAt(1);
    pasteText(text);
    const v = field().value;
    caretAt(6);
    expect(composing('k')).toBe(true);
    expect(field().value).toBe(v);
    // Nor a cancelable one marked as composing.
    let browsers = true;
    act(() => {
      browsers = field().dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: 'k', isComposing: true,
      }));
    });
    expect(browsers).toBe(true);
    expect(field().value).toBe(v);
    // Nor one that cannot be cancelled, composing or not.
    act(() => {
      browsers = field().dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: false, inputType: 'insertText', data: 'k',
      }));
    });
    expect(browsers).toBe(true);
    expect(field().value).toBe(v);
  });

  it('a composition that lands inside a label is repaired when it ends, once, caret after it', () => {
    const onSend = mount();
    const text = lines(14);
    edit('ab');
    caretAt(1);
    pasteText(text);
    const v = field().value;
    fireEvent.compositionStart(field());
    edit(`${v.slice(0, 6)}k${v.slice(6)}`, 7, 'insertCompositionText');
    // Mid-composition nothing is written back: the field holds what the input method made.
    expect(field().value).toBe(`${v.slice(0, 6)}k${v.slice(6)}`);
    edit(`${v.slice(0, 6)}か${v.slice(6)}`, 7, 'insertCompositionText');
    fireEvent.compositionEnd(field());
    expect(field().value).toBe(`a${text}かb`);
    expect([field().selectionStart, field().selectionEnd]).toEqual([2 + text.length, 2 + text.length]);
    expect(send(onSend)).toBe(`a${text}かb`);
  });

  it('a composition beside a label keeps the chip', () => {
    const onSend = mount();
    const text = lines(14);
    edit('ab');
    caretAt(1);
    pasteText(text);
    const v = field().value;
    fireEvent.compositionStart(field());
    edit(`${v.slice(0, -1)}か${v.slice(-1)}`, v.length, 'insertCompositionText');
    fireEvent.compositionEnd(field());
    expect(field().value).toBe(`a${label(1, 14)}かb`);
    expect(chipRow()).toBeInTheDocument();
    expect(send(onSend)).toBe(`a${text}かb`);
  });
});

describe('undo and redo restore the draft the field held, by position (review 3469 F1-F3)', () => {
  const nextToken = label(2, 20);
  const holderText = `holder\n${lines(9, 'h')}\n${nextToken}\n${lines(9, 't')}`;
  const nextText = lines(20, 'next');

  it('F2: a long paste inside a label whose text holds the new label: the appended label is the chip', () => {
    const onSend = mount();
    pasteText(holderText);
    caretAt(5);
    pasteText(nextText);
    expect(field().value).toBe(`${holderText}${nextToken}`);
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('.paste-chip-n')?.textContent)).toEqual(['#2']);
    expect(send(onSend)).toBe(`${holderText}${nextText}`);
  });

  it('F3 (a): Expand, delete everything, undo: the live chip returns at its own place', () => {
    const onSend = mount();
    pasteText(holderText);
    caretAt(field().value.length);
    pasteText(nextText);
    fireEvent.click(screen.getByRole('button', { name: 'Expand pasted text #1, 20 lines, into the message' }));
    const expanded = field().value;
    expect(expanded).toBe(`${holderText}${nextToken}`);
    edit('', 0, 'deleteContentBackward');
    edit(expanded, expanded.length, 'historyUndo');
    expect(send(onSend)).toBe(`${holderText}${nextText}`);
  });

  it('F3 (b): a removed chip stays removed through undo and redo of an Expand that exposes its label', () => {
    const onSend = mount();
    pasteText(holderText);
    caretAt(field().value.length);
    pasteText(nextText);
    fireEvent.click(screen.getByRole('button', { name: 'Remove pasted text #2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand pasted text #1, 20 lines, into the message' }));
    edit(label(1, 20), label(1, 20).length, 'historyUndo');
    expect(chipRow()).toBeInTheDocument();
    edit(holderText, holderText.length, 'historyRedo');
    expect(chipRow()).toBeNull();
    expect(send(onSend)).toBe(holderText);
  });

  it('F1: redo of an Expand whose text starts with [ gives that text once', () => {
    const onSend = mount();
    const text = `[12:00:01] log head\n${lines(20, 'br')}`;
    edit('ab');
    caretAt(1);
    pasteText(text);
    const labelled = field().value;
    fireEvent.click(screen.getByRole('button', { name: 'Expand pasted text #1, 21 lines, into the message' }));
    edit(labelled, 1 + label(1, 21).length, 'historyUndo');
    expect(chipRow()).toBeInTheDocument();
    edit(`a${text}b`, 1 + text.length, 'historyRedo');
    expect(field().value).toBe(`a${text}b`);
    expect(chipRow()).toBeNull();
    expect(send(onSend)).toBe(`a${text}b`);
  });

  it('an undo past the oldest draft held, while the draft has pasted texts, is cancelled before it lands', () => {
    mount();
    pasteText(lines(30));
    expect(beforeInput('historyUndo')).toBe(true);
    edit('', 0, 'historyUndo');
    expect(beforeInput('historyUndo')).toBe(false);
    expect(beforeInput('historyRedo')).toBe(true);
  });

  it('after a send, a step to a draft the composer no longer holds brings no chip back: what shows is what is sent', () => {
    const onSend = mount();
    pasteText(lines(30));
    const token = field().value;
    edit(`${token}x`);
    expect(send(onSend)).toBe(`${lines(30)}x`);
    // Chrome's undo after a send is a no-op (browser leg); were a browser to restore the old value, it is text.
    edit(token, token.length, 'historyUndo');
    expect(chipRow()).toBeNull();
    expect(send(onSend)).toBe(token);
  });

  it('with no pasted text in the draft, undo and redo are the browser’s own, as they always were', () => {
    mount();
    expect(beforeInput('historyUndo')).toBe(true);
    expect(beforeInput('historyRedo')).toBe(true);
  });
});

describe('a label that is only text stays text (F4, A1)', () => {
  it('a label from an earlier draft, pasted beside this draft’s chip with the same label, is sent as written', () => {
    const onSend = mount();
    pasteText(lines(14, 'old'));
    const oldLabel = field().value;
    send(onSend);
    pasteText(lines(14, 'new'));
    expect(field().value).toBe(oldLabel); // the same label, on a different chip
    // A short paste is the browser's own (jsdom performs none, so the test types what Chrome would insert).
    caretAt(field().value.length);
    expect(pasteText(` ${oldLabel}`)).toBe(true);
    edit(`${oldLabel} ${oldLabel}`, field().value.length + 1 + oldLabel.length, 'insertFromPaste');
    expect(send(onSend)).toBe(`${lines(14, 'new')} ${oldLabel}`);
  });

  it('a label inside a pasted text stays literal, before and after Expand', () => {
    const onSend = mount();
    pasteText(lines(13, 'one'));
    const one = field().value;
    caretAt(one.length);
    const inner = `${one}\n${'w'.repeat(800)}`;
    pasteText(inner);
    fireEvent.click(screen.getByRole('button', { name: 'Expand pasted text #2, 2 lines, into the message' }));
    expect(field().value).toBe(`${one}${inner}`);
    expect(send(onSend)).toBe(`${lines(13, 'one')}${inner}`);
  });
});

describe('copy and cut carry a chip’s full text, never its label', () => {
  const clip = () => {
    const setData = vi.fn();
    return { setData, data: { setData, getData: () => '', items: [], files: [] } };
  };

  it('copy of a selection holding a chip', () => {
    mount();
    edit('ab');
    caretAt(1);
    pasteText(lines(14));
    caretAt(0, field().value.length);
    const c = clip();
    expect(fireEvent.copy(field(), { clipboardData: c.data })).toBe(false);
    expect(c.setData).toHaveBeenCalledWith('text/plain', `a${lines(14)}b`);
    expect(field().value).toBe(`a${label(1, 14)}b`);
  });

  it('cut gives the full text and removes the chip; a paste of it back is a chip again', () => {
    const onSend = mount();
    edit('ab');
    caretAt(1);
    pasteText(lines(14));
    caretAt(1, 1 + label(1, 14).length);
    const c = clip();
    expect(fireEvent.cut(field(), { clipboardData: c.data })).toBe(false);
    expect(c.setData).toHaveBeenCalledWith('text/plain', lines(14));
    expect(field().value).toBe('ab');
    caretAt(2);
    pasteText(lines(14));
    expect(field().value).toBe(`ab${label(2, 14)}`);
    expect(send(onSend)).toBe(`ab${lines(14)}`);
  });

  it('a drag of a selection holding any part of a chip is refused; one holding none is the browser’s own (review 3469 A7)', () => {
    mount();
    edit('ab');
    caretAt(1);
    pasteText(lines(14));
    caretAt(0, 4);
    expect(fireEvent.dragStart(field())).toBe(false);
    caretAt(0, 1);
    expect(fireEvent.dragStart(field())).toBe(true);
  });

  it('copy of a selection with no chip is the browser’s own', () => {
    mount();
    edit('plain words');
    caretAt(0, 5);
    const c = clip();
    expect(fireEvent.copy(field(), { clipboardData: c.data })).toBe(true);
    expect(c.setData).not.toHaveBeenCalled();
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

  it('Retry re-sends the full text, not the label', async () => {
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

  it('the draft-conflict sheet’s Append anyway carries the full text', async () => {
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

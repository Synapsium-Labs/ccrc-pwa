// Paste chips in the composer (desktop-polish wave 169; Goals modification 90, second half): the component half. The
// decisions are pinned in paste-chips.test.ts; this pins that the composer performs them. A long text paste shows as one
// chip in the field (its label between two invisible markers) and one chip in the row above it; the send carries the
// full text byte for byte through today's send rules; Expand and Remove act from the row and leave focus and the caret
// in the field; Backspace and Delete beside a chip take it whole, with typed text kept on both sides; the caret and the
// selection are kept off a chip's inside; an edit that breaks one anyway is cleaned up; a label that is only text stays
// text; undo and redo are whatever value the browser restores, parsed; the cases of review 3480 (F1, F2, F3, F6); copy
// and cut carry a chip's full text, and a drag of one is refused; and the retry and draft-conflict paths re-send the
// expanded text through the real session store. jsdom has no `execCommand`, so every edit here takes the composer's
// fallback path; the browser leg (`browser/paste-chips.browser.test.ts`) measures the native one.
//
// The review 3480 cases read positions from the field's value and history steps carry a value captured from the field,
// so they run unchanged against the revision that review read (the task note's red-first count).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Composer } from '../src/session/Composer';
import { createSessionStore, type SessionStoreDeps } from '../src/stores/session';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';

type Prompt = NonNullable<SessionStoreDeps['api']>['prompt'];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const lines = (n: number, tag = 'line'): string => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n');
/** The visible label, and the chip as the field holds it: that label between the two markers. */
const token = (n: number, l: number): string => `[Pasted text #${n} +${l} ${l === 1 ? 'line' : 'lines'}]`;
const label = (n: number, l: number): string => `\u2062${token(n, l)}\u2063`;

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

/** The numbers the chip row lists, in order. */
const rowNumbers = (): (string | null | undefined)[] =>
  screen.queryAllByRole('listitem').map((li) => li.querySelector('.paste-chip-n')?.textContent);

/** The browser's selectionchange after a key or a pointer moved the selection to [start, end) (`backward` when the
 *  focus is at the start). */
const moveTo = (start: number, end = start, backward = false): void => {
  field().focus();
  field().setSelectionRange(start, end, backward ? 'backward' : 'forward');
  act(() => { document.dispatchEvent(new Event('selectionchange')); });
};
const sel = (): [number, number] => [field().selectionStart, field().selectionEnd];

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

  it('a slash command picked from the menu replaces the draft, so its chips number from #1 again (review 3480 A9)', async () => {
    vi.spyOn(api, 'commands').mockResolvedValue({
      builtins: [{ name: 'compact', desc: 'summarize the conversation', kind: 'builtin' }], skills: [],
    });
    mount({ id: 'claude:project-a' });
    pasteText(lines(13));
    edit('/comp');
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /compact/ })));
    expect(field().value).toBe('/compact ');
    caretAt(field().value.length);
    pasteText(lines(14));
    expect(field().value).toBe(`/compact ${label(1, 14)}`);
  });
});

describe('expand and remove from the chip row leave focus and the caret in the field', () => {
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
    expect(sel()).toEqual([2 + text.length, 2 + text.length]);
    expect(chipRow()).toBeNull();
    expect(send(onSend)).toBe(`a ${text} b`);
  });

  it('Remove takes the chip, caret where it stood; undo brings it back with its text', () => {
    const onSend = mount();
    const text = lines(14);
    edit('a  b');
    caretAt(2);
    pasteText(text);
    const withChip = field().value;
    blurField();
    fireEvent.click(screen.getByRole('button', { name: 'Remove pasted text #1' }));
    expect(field().value).toBe('a  b');
    expect(document.activeElement).toBe(field());
    expect(sel()).toEqual([2, 2]);
    edit(withChip, 2 + label(1, 14).length, 'historyUndo');
    expect(rowNumbers()).toEqual(['#1']);
    expect(send(onSend)).toBe(`a ${text} b`);
  });
});

describe('Backspace and Delete beside a chip take it whole, with typed text kept on both sides', () => {
  const setup = (): string => {
    edit('ab');
    caretAt(1);
    pasteText(lines(14));
    return label(1, 14);
  };

  it('Backspace right after the chip', () => {
    const onSend = mount();
    const chip = setup();
    caretAt(1 + chip.length);
    expect(beforeInput('deleteContentBackward')).toBe(false); // the composer took the key
    expect(field().value).toBe('ab');
    expect(sel()).toEqual([1, 1]);
    expect(send(onSend)).toBe('ab');
  });

  it('Delete right before the chip', () => {
    const onSend = mount();
    setup();
    caretAt(1);
    expect(beforeInput('deleteContentForward')).toBe(false);
    expect(field().value).toBe('ab');
    expect(send(onSend)).toBe('ab');
  });

  it('a word delete beside the chip takes it whole (jsdom gives no word range)', () => {
    const onSend = mount();
    const chip = setup();
    caretAt(1 + chip.length);
    expect(beforeInput('deleteWordBackward')).toBe(false);
    expect(field().value).toBe('ab');
    expect(send(onSend)).toBe('ab');
  });

  it('keys away from any chip, and line deletes, are the browser’s own', () => {
    mount();
    const chip = setup();
    caretAt(0);
    expect(beforeInput('insertText', 'X')).toBe(true);
    expect(beforeInput('deleteContentBackward')).toBe(true);
    caretAt(1 + chip.length);
    expect(beforeInput('deleteSoftLineBackward')).toBe(true);
    expect(beforeInput('deleteHardLineBackward')).toBe(true);
  });

  it('typed text loses any marker', () => {
    const onSend = mount();
    caretAt(0);
    expect(beforeInput('insertText', 'x⁢y⁣')).toBe(false);
    expect(field().value).toBe('xy');
    expect(send(onSend)).toBe('xy');
  });
});

describe('a caret never rests inside a chip, and a selection covers one whole', () => {
  const setup = (): { s: number; e: number } => {
    edit('ab');
    caretAt(1);
    pasteText(lines(14));
    return { s: 1, e: 1 + label(1, 14).length };
  };

  it('a key that moves the caret into a chip carries it to the far side, each way', () => {
    mount();
    const { s, e } = setup();
    moveTo(s);
    moveTo(s + 1);
    expect(sel()).toEqual([e, e]);
    moveTo(e - 1);
    expect(sel()).toEqual([s, s]);
  });

  it('a pointer takes the nearer side', () => {
    mount();
    const { s, e } = setup();
    moveTo(0);
    fireEvent.pointerDown(field());
    moveTo(s + 3);
    expect(sel()).toEqual([s, s]);
    moveTo(e - 2);
    expect(sel()).toEqual([e, e]);
    fireEvent.pointerUp(document);
  });

  it('shift-arrow into a chip selects it whole; back again leaves it', () => {
    mount();
    const { s, e } = setup();
    moveTo(s);
    moveTo(s, s + 1);
    expect(sel()).toEqual([s, e]);
    moveTo(s, e - 1);
    expect(sel()).toEqual([s, s]);
  });

  it('a selection ending inside a chip covers it before Backspace applies', () => {
    const onSend = mount();
    setup();
    caretAt(0, 4); // no selectionchange yet: the edit itself widens
    expect(beforeInput('deleteContentBackward')).toBe(false);
    expect(field().value).toBe('b');
    expect(send(onSend)).toBe('b');
  });
});

describe('review 3480: chips through a paste over a selection, a key over a chip, undo and redo, and Enter', () => {
  const t1 = lines(14, 'one');
  const t2 = lines(15, 'two');
  const t3 = lines(20, 'three');

  it('F1: a long paste over a selection from plain text into a chip replaces the chip and is a chip', () => {
    const onSend = mount();
    edit('ab');
    caretAt(1);
    pasteText(t1);
    const v = field().value;
    caretAt(0, v.indexOf('[Pasted') + 5);
    expect(pasteText(t3)).toBe(false);
    expect(rowNumbers()).toEqual(['#2']);
    expect(send(onSend)).toBe(`${t3}b`);
  });

  it('F1: a long paste over a selection from one chip into another replaces both and is a chip', () => {
    const onSend = mount();
    edit('amb');
    caretAt(2);
    pasteText(t2);
    caretAt(1);
    pasteText(t1);
    const v = field().value;
    caretAt(v.indexOf('[Pasted') + 4, v.lastIndexOf('[Pasted') + 5);
    expect(pasteText(t3)).toBe(false);
    expect(rowNumbers()).toEqual(['#3']);
    expect(send(onSend)).toBe(`a${t3}b`);
  });

  it('F2: `[` typed over a fully selected chip replaces it; nothing is revived', () => {
    const onSend = mount();
    pasteText(t1);
    caretAt(0, field().value.length);
    expect(beforeInput('insertText', '[')).toBe(true); // the browser's own edit
    edit('[', 1, 'insertText');
    expect(field().value).toBe('[');
    expect(chipRow()).toBeNull();
    expect(send(onSend)).toBe('[');
  });

  it('F2: a short paste starting with `[` over a fully selected chip replaces it', () => {
    const onSend = mount();
    pasteText(t1);
    caretAt(0, field().value.length);
    if (pasteText('[x]')) edit('[x]', 3, 'insertFromPaste'); // the browser's own paste, as jsdom performs none
    expect(field().value).toBe('[x]');
    expect(chipRow()).toBeNull();
    expect(send(onSend)).toBe('[x]');
  });

  it('F3: an undo that skips a hand-typed copy of the label brings the real chip back', () => {
    const onSend = mount();
    pasteText(t1);
    const withChip = field().value;
    caretAt(withChip.length);
    beforeInput('deleteContentBackward');
    expect(field().value).toBe('');
    // The label typed by hand, a key at a time, then more.
    let typed = '';
    for (const ch of `${token(1, 14)} z`) {
      typed += ch;
      edit(typed);
    }
    expect(chipRow()).toBeNull();
    // A browser that undoes the delete and the typing in one step restores the value the chip had.
    edit(withChip, withChip.length, 'historyUndo');
    expect(rowNumbers()).toEqual(['#1']);
    expect(send(onSend)).toBe(t1);
  });

  it('F3: a hand-typed copy of a live label beside the real chip stays text through undo and redo', () => {
    const onSend = mount();
    pasteText(t1);
    const withChip = field().value;
    let typed = withChip;
    for (const ch of ` ${token(1, 14)}`) {
      typed += ch;
      edit(typed);
    }
    const both = field().value;
    expect(rowNumbers()).toEqual(['#1']);
    edit(withChip, withChip.length, 'historyUndo');
    expect(rowNumbers()).toEqual(['#1']);
    edit(both, both.length, 'historyRedo');
    expect(rowNumbers()).toEqual(['#1']);
    expect(send(onSend)).toBe(`${t1} ${token(1, 14)}`);
  });

  it('F6: Enter that confirms a composition does not send', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('pointer: fine'), media: q, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
    }));
    try {
      const onSend = mount();
      pasteText(t1);
      fireEvent.compositionStart(field());
      fireEvent.keyDown(field(), { key: 'Enter', isComposing: true });
      fireEvent.keyDown(field(), { key: 'Enter', keyCode: 229 });
      expect(onSend).not.toHaveBeenCalled();
      fireEvent.compositionEnd(field());
      fireEvent.keyDown(field(), { key: 'Enter' });
      expect(onSend).toHaveBeenCalledWith(t1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('what an edit breaks anyway is cleaned up, never sent as a bare label', () => {
  it('text dropped inside a label: the broken chip goes, the dropped text stays, the caret after it', () => {
    const onSend = mount();
    const text = lines(14);
    edit('ab');
    caretAt(1);
    pasteText(text);
    const v = field().value;
    edit(`${v.slice(0, 6)}X${v.slice(6)}`, 7, 'insertFromDrop');
    expect(field().value).toBe('aXb');
    expect(sel()).toEqual([2, 2]);
    expect(chipRow()).toBeNull();
    // The text stays in the table, so the browser's undo brings the chip back.
    edit(v, v.length, 'historyUndo');
    expect(field().value).toBe(v);
    expect(rowNumbers()).toEqual(['#1']);
    expect(send(onSend)).toBe(`a${text}b`);
  });

  it('a line delete that took part of a chip takes the rest of its label', () => {
    const onSend = mount();
    edit('xx');
    caretAt(2);
    pasteText(lines(14));
    const v = field().value;
    edit(`xx${v.slice(2, 12)}`, 12, 'deleteSoftLineForward');
    expect(field().value).toBe('xx');
    expect(send(onSend)).toBe('xx');
  });

  it('after a send, an old chip a browser brought back is no chip and no label', () => {
    const onSend = mount();
    pasteText(lines(30));
    const withChip = field().value;
    edit(`${withChip}x`);
    expect(send(onSend)).toBe(`${lines(30)}x`);
    // Chrome's undo after a send does nothing (browser leg); were a browser to restore the old value, its label goes.
    edit(`${withChip}x`, withChip.length + 1, 'historyUndo');
    expect(field().value).toBe('x');
    expect(chipRow()).toBeNull();
  });
});

describe('an input method’s composition is never scripted', () => {
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

  it('a composing or non-cancelable beforeinput beside a chip is left to the browser', () => {
    mount();
    edit('ab');
    caretAt(1);
    pasteText(lines(14));
    const v = field().value;
    caretAt(1 + label(1, 14).length);
    expect(composing('k')).toBe(true);
    expect(field().value).toBe(v);
    let browsers = true;
    act(() => {
      browsers = field().dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: false, inputType: 'deleteContentBackward',
      }));
    });
    expect(browsers).toBe(true);
    expect(field().value).toBe(v);
  });

  it('a composition beside a chip keeps it, and the chip row stays through it', () => {
    const onSend = mount();
    const text = lines(14);
    edit('ab');
    caretAt(1);
    pasteText(text);
    const v = field().value;
    fireEvent.compositionStart(field());
    edit(`${v.slice(0, -1)}k${v.slice(-1)}`, v.length, 'insertCompositionText');
    expect(rowNumbers()).toEqual(['#1']);
    edit(`${v.slice(0, -1)}か${v.slice(-1)}`, v.length, 'insertCompositionText');
    fireEvent.compositionEnd(field());
    expect(field().value).toBe(`a${label(1, 14)}かb`);
    expect(send(onSend)).toBe(`a${text}かb`);
  });

  it('a composition that broke a chip is left alone while it runs and cleaned up when it ends', () => {
    const onSend = mount();
    edit('ab');
    caretAt(1);
    pasteText(lines(14));
    const v = field().value;
    fireEvent.compositionStart(field());
    const mid = `${v.slice(0, 6)}k${v.slice(6)}`;
    edit(mid, 7, 'insertCompositionText');
    expect(field().value).toBe(mid);
    edit(`${v.slice(0, 6)}か${v.slice(6)}`, 7, 'insertCompositionText');
    fireEvent.compositionEnd(field());
    expect(field().value).toBe('aかb');
    expect(send(onSend)).toBe('aかb');
  });
});

describe('a label that is only text stays text', () => {
  it('a label from an earlier draft, pasted beside this draft’s chip with the same label, is sent as written', () => {
    const onSend = mount();
    pasteText(lines(14, 'old'));
    send(onSend);
    pasteText(lines(14, 'new'));
    caretAt(field().value.length);
    // Copy gives a chip's text, never its label, so the label arrives as typed text.
    expect(pasteText(` ${token(1, 14)}`)).toBe(true);
    edit(`${label(1, 14)} ${token(1, 14)}`, label(1, 14).length + 1 + token(1, 14).length, 'insertFromPaste');
    expect(rowNumbers()).toEqual(['#1']);
    expect(send(onSend)).toBe(`${lines(14, 'new')} ${token(1, 14)}`);
  });

  it('a label inside a pasted text stays literal, before and after Expand', () => {
    const onSend = mount();
    pasteText(lines(13, 'one'));
    caretAt(field().value.length);
    const inner = `${token(1, 13)}\n${'w'.repeat(800)}`;
    pasteText(inner);
    fireEvent.click(screen.getByRole('button', { name: 'Expand pasted text #2, 2 lines, into the message' }));
    expect(field().value).toBe(`${label(1, 13)}${inner}`);
    expect(rowNumbers()).toEqual(['#1']);
    expect(send(onSend)).toBe(`${lines(13, 'one')}${inner}`);
  });

  it('a paste holding a marker is a chip, whatever its length', () => {
    const onSend = mount();
    const text = 'a⁣b';
    expect(pasteText(text)).toBe(false);
    expect(field().value).toBe(label(1, 1));
    expect(send(onSend)).toBe('ab');
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

  it('cut of a selection ending inside a chip takes the whole chip and gives its whole text, once (review 3480 A1)', () => {
    const onSend = mount();
    edit('ab');
    caretAt(1);
    pasteText(lines(14));
    caretAt(0, 5);
    const c = clip();
    expect(fireEvent.cut(field(), { clipboardData: c.data })).toBe(false);
    expect(c.setData).toHaveBeenCalledWith('text/plain', `a${lines(14)}`);
    expect(field().value).toBe('b');
    caretAt(0);
    pasteText(`a${lines(14)}`);
    expect(send(onSend)).toBe(`a${lines(14)}b`);
  });

  it('a drag of a selection holding a chip is refused; one holding none is the browser’s own', () => {
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

// A long paste goes to the session as a saved file (desktop-polish wave 194): the composer half. At Send every chip is
// saved first through the existing upload, byte for byte its text, and the message goes out with one pointer line in
// each chip's place (`pasteSend.ts`, `shared/pastePointer.ts`); while it saves Send is held, and a failed save sends
// nothing until the operator taps Retry (which saves only what is missing) or "Send as typed text" (today's send). A
// shell line's chips go as typed text. The cases mount the composer WITH a session id, as the session screen does; the
// paste-chip cases of wave 169 mount it without one, which is today's route, unchanged (`composer-paste-chips.test.tsx`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { addChip, emptyChips } from '../src/session/pasteChips';
import { Composer } from '../src/session/Composer';
import { createSessionStore, type SessionStoreDeps } from '../src/stores/session';
import { api, uploadErrorText } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { CLIP_MAX_BYTES, composePrompt, type StagedClip } from '../../shared/api';
import { PASTE_UPLOAD_NAME, pastePointer, readPastePointer } from '../../shared/pastePointer';
import {
  PASTE_SAVING_TEXT, PASTE_TYPED_LABEL, pasteRetryLabel, pasteUnpointableText,
} from '../src/session/longPasteWords';
import { PASTE_SAVE_DEADLINE_MS, usePasteSave } from '../src/session/usePasteSave';

type Prompt = NonNullable<SessionStoreDeps['api']>['prompt'];

const SID = 'lane-a-project-a';
const STORE = `/home/user-a/.cc-clips/${SID}`;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const lines = (n: number, tag = 'line'): string => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n');
const label = (n: number, l: number): string =>
  `⁢${`[Pasted text #${n} +${l} ${l === 1 ? 'line' : 'lines'}]`.replace(/ /g, ' ')}⁣`;

const field = (): HTMLTextAreaElement => document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement;
const sendButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Send' });
const pasteText = (text: string): boolean =>
  fireEvent.paste(field(), { clipboardData: { items: [], files: [], getData: () => text } });
const edit = (value: string, caret = value.length, inputType = 'insertText'): void => {
  const el = field();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
  el.setSelectionRange(caret, caret);
  fireEvent(el, new InputEvent('input', { bubbles: true, inputType }));
};
const caretEnd = (): void => {
  field().focus();
  field().setSelectionRange(field().value.length, field().value.length);
};

/** Every upload the composer made: the file, its text, and the clip it was answered with. */
interface Saved { file: File; text: string; clip: StagedClip }

/** `api.upload` answering each pasted text with a fresh clip path in this session's store (a document keeps its own
 *  name's stem), or as `answer` says for the nth call (0-based). */
function mockUpload(answer: (call: number, file: File) => 'ok' | Error | Promise<never> = () => 'ok') {
  const saved: Saved[] = [];
  let calls = 0;
  const spy = vi.spyOn(api, 'upload').mockImplementation(async (_id, file) => {
    const call = calls++;
    const a = answer(call, file);
    if (a instanceof Error) throw a;
    if (a !== 'ok') return a;
    const text = await file.text();
    const stem = file.name === PASTE_UPLOAD_NAME ? 'paste' : file.name.replace(/\.[^.]*$/, '');
    const ext = file.name.slice(file.name.lastIndexOf('.') + 1);
    const name = `clip-20261127-153012-${String(call).padStart(8, '0')}-${stem}.${ext}`;
    const clip = { path: `${STORE}/${name}`, name, bytes: file.size };
    saved.push({ file, text, clip });
    return clip;
  });
  return { spy, saved, paths: () => saved.map((s) => s.clip.path) };
}

const mount = (props: Partial<Parameters<typeof Composer>[0]> = {}) => {
  const onSend = vi.fn();
  const view = render(<Composer onSend={onSend} pending={[]} id={SID} {...props} />);
  return { onSend, view };
};

/** Tap Send and let every save and its answer settle. */
const tapSend = async (): Promise<void> => {
  await act(async () => { fireEvent.click(sendButton()); });
  await act(async () => { await Promise.resolve(); });
};

const sentText = (onSend: ReturnType<typeof vi.fn>): string => onSend.mock.calls.at(-1)?.[0] as string;

describe('a send with chips saves each pasted text and sends pointers', () => {
  it('one chip: one file of its text, and the message is its pointer line', async () => {
    const up = mockUpload();
    const { onSend } = mount();
    const text = lines(214);
    pasteText(text);
    await tapSend();
    expect(up.spy).toHaveBeenCalledTimes(1);
    expect(up.saved[0]!.file.name).toBe('paste.txt');
    expect(up.saved[0]!.text).toBe(text);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(sentText(onSend)).toBe(pastePointer(up.paths()[0]!, 214));
    expect(field().value).toBe('');
  });

  it('two chips: one file each, two pointers in order', async () => {
    const up = mockUpload();
    const { onSend } = mount();
    pasteText(lines(20, 'a'));
    caretEnd();
    pasteText('b'.repeat(900));
    await tapSend();
    expect(up.saved.map((s) => s.text)).toEqual([lines(20, 'a'), 'b'.repeat(900)]);
    expect(sentText(onSend)).toBe(`${pastePointer(up.paths()[0]!, 20)}\n${pastePointer(up.paths()[1]!, 1)}`);
  });

  it('a chip between typed text keeps the text on both sides, adding only line breaks', async () => {
    const up = mockUpload();
    const { onSend } = mount();
    edit('look at this  and fix it', 13);
    pasteText(lines(14));
    await tapSend();
    expect(sentText(onSend)).toBe(`look at this \n${pastePointer(up.paths()[0]!, 14)}\n and fix it`);
  });

  it('a chip beside a tray attachment: the attachment goes as today, and does not count the chip', async () => {
    const up = mockUpload();
    const { onSend } = mount();
    const doc = new File(['# notes'], 'notes.md', { type: 'text/markdown' });
    await act(async () => { fireEvent.drop(field().closest('.composer')!, { dataTransfer: { files: [doc] } }); });
    pasteText(lines(30));
    await tapSend();
    const [text, opts] = onSend.mock.calls.at(-1)! as [string, { attachments: { path: string }[] }];
    const pasted = up.saved.find((s) => s.file.name === PASTE_UPLOAD_NAME)!;
    const notes = up.saved.find((s) => s.file.name === 'notes.md')!;
    expect(text).toBe(pastePointer(pasted.clip.path, 30));
    expect(opts.attachments.map((a) => a.path)).toEqual([notes.clip.path]);
  });

  it('the file holds the chip\'s text byte for byte: a quote, a pipe, an emoji and a 5,000-character line', async () => {
    const up = mockUpload();
    mount();
    const text = `say "hi" | grep x 😀\n${'z'.repeat(5000)}\nend`;
    pasteText(text);
    await tapSend();
    const bytes = new Uint8Array(await up.saved[0]!.file.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(new TextEncoder().encode(text)));
  });

  it('a lone surrogate is the encoder\'s one exception: it is saved as U+FFFD', async () => {
    const up = mockUpload();
    mount();
    pasteText(`${'q'.repeat(900)}\ud800`);
    await tapSend();
    expect(up.saved[0]!.text).toBe(`${'q'.repeat(900)}�`);
  });

  it('a slash command with a chip takes the pointer, like any draft', async () => {
    const up = mockUpload();
    const { onSend } = mount();
    edit('/review ');
    caretEnd();
    pasteText(lines(15));
    await tapSend();
    expect(sentText(onSend)).toBe(`/review \n${pastePointer(up.paths()[0]!, 15)}`);
  });

  it('a draft with no chip sends as today and saves nothing', async () => {
    const up = mockUpload();
    const { onSend } = mount();
    edit('  plain words ');
    await tapSend();
    expect(up.spy).not.toHaveBeenCalled();
    expect(sentText(onSend)).toBe('plain words');
  });
});

describe('a shell line goes as typed text', () => {
  it('`!` then a chip sends today\'s text and saves nothing', async () => {
    const up = mockUpload();
    const { onSend } = mount();
    edit('!cat ');
    caretEnd();
    const text = lines(20);
    pasteText(text);
    await tapSend();
    expect(up.spy).not.toHaveBeenCalled();
    expect(sentText(onSend)).toBe(`!cat ${text}`);
  });

  it('a leading space or newline is trimmed by the send, so it is still a shell line', async () => {
    for (const lead of [' ', '\n']) {
      const up = mockUpload();
      const { onSend, view } = mount();
      edit(`${lead}!cat `);
      caretEnd();
      pasteText(lines(20));
      await tapSend();
      expect(up.spy).not.toHaveBeenCalled();
      expect(sentText(onSend)).toBe(`!cat ${lines(20)}`);
      view.unmount();
      vi.restoreAllMocks();
    }
  });

  it('a chip first whose pasted text begins with `!` is no shell line now: the pointer goes', async () => {
    const up = mockUpload();
    const { onSend } = mount();
    pasteText(`!rm -rf build\n${lines(20)}`);
    await tapSend();
    expect(up.saved[0]!.text).toBe(`!rm -rf build\n${lines(20)}`);
    expect(sentText(onSend)).toBe(pastePointer(up.paths()[0]!, 21));
  });

  it('a tray attachment in front makes it no shell line: the chip takes the pointer', async () => {
    const up = mockUpload();
    const { onSend } = mount();
    const doc = new File(['x'], 'notes.md', { type: 'text/markdown' });
    await act(async () => { fireEvent.drop(field().closest('.composer')!, { dataTransfer: { files: [doc] } }); });
    edit('!cat ');
    caretEnd();
    pasteText(lines(20));
    await tapSend();
    const pasted = up.saved.find((s) => s.file.name === PASTE_UPLOAD_NAME)!;
    expect(sentText(onSend)).toBe(`!cat \n${pastePointer(pasted.clip.path, 20)}`);
  });
});

describe('a failed save sends nothing', () => {
  it('nothing is sent and nothing typed: the prompt call is never made; the chip says why, with no paste text', async () => {
    mockUpload(() => new ApiError(413, { ok: false, error: 'too-large' }));
    const prompt = vi.fn<Prompt>().mockResolvedValue(undefined);
    const store = createSessionStore(SID, { api: { prompt } });
    render(<Composer onSend={store.getState().send} pending={[]} id={SID} />);
    const secret = 'secret-token-value-0000';
    pasteText(`${lines(20)}\n${secret}`);
    await tapSend();
    expect(prompt).not.toHaveBeenCalled();
    expect(store.getState().pending).toEqual([]);
    const alert = screen.getByRole('alert');
    expect(alert.querySelector('.paste-notice-text')?.textContent).toBe(`Pasted text #1: ${uploadErrorText('too-large')}`);
    expect(alert.textContent).not.toContain(secret);
    expect(screen.getByRole('button', { name: pasteRetryLabel(1) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: PASTE_TYPED_LABEL })).toBeInTheDocument();
    expect(field().value).toBe(label(1, 21));
  });

  it('a pasted text over the limit is refused before any request, in the tray\'s words', async () => {
    const up = mockUpload();
    const { onSend } = mount();
    pasteText('x'.repeat(CLIP_MAX_BYTES + 1));
    await tapSend();
    expect(up.spy).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Pasted text #1 is 12.1 MB — 12 MB per file is the limit');
  });

  it('a saved path that would not read back as this session\'s is refused, and nothing is sent', async () => {
    vi.spyOn(api, 'upload').mockResolvedValue({
      path: '/home/user-a/.cc-clips/lane-b/clip-20261127-153012-00000000-paste.txt', name: 'x', bytes: 1,
    });
    const { onSend } = mount();
    pasteText(lines(20));
    await tapSend();
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').querySelector('.paste-notice-text')?.textContent)
      .toBe(pasteUnpointableText(1));
    expect(pasteUnpointableText(1)).toContain('so it can go only as typed text');
  });

  it('that failure offers only "Send as typed text" (Retry could change nothing), and its tap sends the typed text', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue({
      path: '/home/user-a/.cc-clips/lane-b/clip-20261127-153012-00000000-paste.txt', name: 'x', bytes: 1,
    });
    const { onSend } = mount();
    pasteText(lines(20));
    await tapSend();
    const alert = screen.getByRole('alert');
    expect(Array.from(alert.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))).toEqual([PASTE_TYPED_LABEL]);
    expect(screen.queryByRole('button', { name: pasteRetryLabel(1) })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: PASTE_TYPED_LABEL })); });
    expect(sentText(onSend)).toBe(lines(20));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('Retry saves only what is still missing and reuses the saved file', async () => {
    const up = mockUpload((call) => (call === 1 ? new ApiError(502, { ok: false, error: 'agent-down' }) : 'ok'));
    const { onSend } = mount();
    pasteText(lines(20, 'a'));
    caretEnd();
    pasteText(lines(30, 'b'));
    await tapSend();
    expect(onSend).not.toHaveBeenCalled();
    expect(up.spy).toHaveBeenCalledTimes(2);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: pasteRetryLabel(2) })); });
    await act(async () => { await Promise.resolve(); });
    expect(up.spy).toHaveBeenCalledTimes(3);
    expect(up.saved.map((s) => s.text)).toEqual([lines(20, 'a'), lines(30, 'b')]);
    expect(sentText(onSend)).toBe(`${pastePointer(up.paths()[0]!, 20)}\n${pastePointer(up.paths()[1]!, 30)}`);
  });

  it('a failed chip that is removed takes its notice with it', async () => {
    mockUpload((call) => (call === 1 ? new ApiError(502, { ok: false, error: 'agent-down' }) : 'ok'));
    mount();
    pasteText(lines(20, 'a'));
    caretEnd();
    pasteText(lines(30, 'b'));
    await tapSend();
    expect(screen.getByRole('alert').textContent).toContain('Pasted text #2');
    fireEvent.click(screen.getByRole('button', { name: 'Remove pasted text #2' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"Send as typed text" sends today\'s text, saves nothing more, and only on the tap', async () => {
    const up = mockUpload(() => new ApiError(502, { ok: false, error: 'agent-down' }));
    const { onSend } = mount();
    edit('see: ');
    caretEnd();
    pasteText(lines(20));
    await tapSend();
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: PASTE_TYPED_LABEL })); });
    expect(up.spy).toHaveBeenCalledTimes(1);
    expect(sentText(onSend)).toBe(`see: ${lines(20)}`);
  });
});

describe('Send is held while saving', () => {
  it('visibly; the field and the tray take nothing; a second tap or Enter sends nothing twice', async () => {
    let release!: (c: StagedClip) => void;
    const spy = vi.spyOn(api, 'upload').mockImplementation(() => new Promise((r) => { release = r; }));
    const { onSend } = mount();
    pasteText(lines(20));
    await act(async () => { fireEvent.click(sendButton()); });
    expect(sendButton()).toBeDisabled();
    expect(sendButton()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status').textContent).toBe(PASTE_SAVING_TEXT);
    expect(field().readOnly).toBe(true);
    expect(pasteText(lines(30))).toBe(false);
    expect(screen.getByRole('button', { name: 'Attach a file' })).toBeDisabled();
    const doc = new File(['x'], 'late.md', { type: 'text/markdown' });
    await act(async () => { fireEvent.drop(field().closest('.composer')!, { dataTransfer: { files: [doc] } }); });
    await act(async () => { fireEvent.click(sendButton()); });
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true });
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ path: `${STORE}/clip-20261127-153012-00000000-paste.txt`, name: 'n', bytes: 1 });
      await Promise.resolve();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(field().readOnly).toBe(false);
  });

  it('a save past its deadline fails with Retry, so the hold always ends', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'upload').mockImplementation(() => new Promise(() => undefined));
    const { onSend } = mount();
    pasteText(lines(20));
    await act(async () => { fireEvent.click(sendButton()); });
    expect(sendButton()).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(PASTE_SAVE_DEADLINE_MS); });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').querySelector('.paste-notice-text')?.textContent)
      .toBe('Pasted text #1 was not saved within 120 seconds');
    expect(screen.getByRole('button', { name: pasteRetryLabel(1) })).toBeEnabled();
  });

  it('runs at most four saves at once; the rest wait their turn', async () => {
    const waiting: ((c: StagedClip) => void)[] = [];
    let n = 0;
    const spy = vi.spyOn(api, 'upload').mockImplementation(() => new Promise((r) => { waiting.push(r); }));
    const { onSend } = mount();
    for (let i = 0; i < 6; i += 1) {
      caretEnd();
      pasteText(lines(13 + i));
    }
    await act(async () => { fireEvent.click(sendButton()); });
    expect(spy).toHaveBeenCalledTimes(4);
    while (waiting.length > 0) {
      await act(async () => {
        waiting.shift()!({ path: `${STORE}/clip-20261127-153012-${String(n++).padStart(8, '0')}-paste.txt`, name: 'n', bytes: 1 });
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    expect(spy).toHaveBeenCalledTimes(6);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('the chip row\'s Expand and Remove cannot be used while saving', async () => {
    vi.spyOn(api, 'upload').mockImplementation(() => new Promise(() => undefined));
    mount();
    pasteText(lines(20));
    await act(async () => { fireEvent.click(sendButton()); });
    expect(screen.getByRole('button', { name: 'Expand pasted text #1, 20 lines, into the message' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove pasted text #1' })).toBeDisabled();
  });

  it('a draft changed while saving by any way the hold does not cover is not sent, and stays', async () => {
    let release!: (c: StagedClip) => void;
    vi.spyOn(api, 'upload').mockImplementation(() => new Promise((r) => { release = r; }));
    const { onSend } = mount();
    pasteText(lines(20));
    await act(async () => { fireEvent.click(sendButton()); });
    // A read-only field still takes a change made by script (an extension, an autofill); the send must not follow it.
    edit(`${field().value} more`);
    await act(async () => {
      release({ path: `${STORE}/clip-20261127-153012-00000000-paste.txt`, name: 'n', bytes: 1 });
      await Promise.resolve();
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(field().value).toBe(`${label(1, 20)} more`);
  });

  it('a question card that comes up while saving keeps the draft: nothing is sent, and the saved file is reused later', async () => {
    let release!: (c: StagedClip) => void;
    const spy = vi.spyOn(api, 'upload').mockImplementation(() => new Promise((r) => { release = r; }));
    const onSend = vi.fn();
    const { rerender } = render(<Composer onSend={onSend} pending={[]} id={SID} />);
    pasteText(lines(20));
    await act(async () => { fireEvent.click(sendButton()); });
    rerender(<Composer onSend={onSend} pending={[]} id={SID} askUp />);
    const path = `${STORE}/clip-20261127-153012-00000000-paste.txt`;
    await act(async () => { release({ path, name: 'n', bytes: 1 }); await Promise.resolve(); });
    expect(onSend).not.toHaveBeenCalled();
    expect(field().value).toBe(label(1, 20));
    rerender(<Composer onSend={onSend} pending={[]} id={SID} />);
    await tapSend();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sentText(onSend)).toBe(pastePointer(path, 20));
  });

  it('leaving the session while a save is in flight sends nothing', async () => {
    let release!: (c: StagedClip) => void;
    vi.spyOn(api, 'upload').mockImplementation(() => new Promise((r) => { release = r; }));
    const { onSend, view } = mount();
    pasteText(lines(20));
    await act(async () => { fireEvent.click(sendButton()); });
    view.unmount();
    await act(async () => {
      release({ path: `${STORE}/clip-20261127-153012-00000000-paste.txt`, name: 'n', bytes: 1 });
      await Promise.resolve();
    });
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('a send is one snapshot taken at the tap (review 4119 F1)', () => {
  const DOC = `${STORE}/clip-20261127-153012-dddddddd-notes.md`;
  /** Documents stage at once; a pasted text's save waits for `release`. */
  const deferPaste = () => {
    let release!: () => void;
    let late = 0;
    const spy = vi.spyOn(api, 'upload').mockImplementation(async (_id, file) => {
      if (file.name !== PASTE_UPLOAD_NAME) {
        late += 1;
        return { path: late === 1 ? DOC : `${STORE}/clip-20261127-153012-eeeeeeee-late.md`, name: file.name, bytes: 1 };
      }
      await new Promise<void>((r) => { release = r; });
      return { path: `${STORE}/clip-20261127-153012-00000000-paste.txt`, name: 'n', bytes: 1 };
    });
    return { spy, release: async () => { await act(async () => { release(); await Promise.resolve(); await Promise.resolve(); }); } };
  };
  const drop = async (name: string): Promise<boolean> => {
    let taken = true;
    await act(async () => {
      taken = fireEvent.drop(field().closest('.composer')!, {
        dataTransfer: { files: [new File(['x'], name, { type: 'text/markdown' })] },
      });
    });
    return taken;
  };
  const sentFiles = (onSend: ReturnType<typeof vi.fn>): unknown =>
    (onSend.mock.calls.at(-1)?.[1] as { attachments?: { path: string }[] } | undefined)?.attachments?.map((a) => a.path);

  it('a `!` draft with an attachment in front: the attachment removed during the save still goes, so no shell line', async () => {
    const up = deferPaste();
    const { onSend } = mount();
    await drop('notes.md');
    edit('!cat ');
    caretEnd();
    pasteText(lines(20));
    await act(async () => { fireEvent.click(sendButton()); });
    // jsdom lets a click through a disabled fieldset (a browser does not): this is a tray that changed after the tap.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove notes.md' })); });
    await up.release();
    expect(sentText(onSend)).toBe(`!cat \n${pastePointer(`${STORE}/clip-20261127-153012-00000000-paste.txt`, 20)}`);
    expect(sentFiles(onSend)).toEqual([DOC]);
  });

  it('the tray\'s remove control cannot be used while saving, and says so', async () => {
    deferPaste();
    mount();
    await drop('notes.md');
    pasteText(lines(20));
    const remove = screen.getByRole('button', { name: 'Remove notes.md' });
    expect(remove).toBeEnabled();
    await act(async () => { fireEvent.click(sendButton()); });
    expect(remove).toBeDisabled();
    expect(remove.closest('fieldset')).toHaveProperty('disabled', true);
  });

  it('an attachment that finishes staging after the tap is not in the send', async () => {
    const up = deferPaste();
    const { onSend } = mount();
    pasteText(lines(20));
    await act(async () => { fireEvent.click(sendButton()); });
    const input = document.querySelector('input.attach-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'late.md', { type: 'text/markdown' })] } });
      await Promise.resolve();
    });
    await up.release();
    expect(sentText(onSend)).toBe(pastePointer(`${STORE}/clip-20261127-153012-00000000-paste.txt`, 20));
    expect(sentFiles(onSend)).toBeUndefined();
  });

  it('a file dropped during a save is cancelled, so the browser keeps the page, and is taken nowhere', async () => {
    const up = deferPaste();
    const { onSend } = mount();
    pasteText(lines(20));
    await act(async () => { fireEvent.click(sendButton()); });
    const composer = field().closest('.composer')!;
    expect(fireEvent.dragOver(composer)).toBe(false);
    expect(composer).not.toHaveAttribute('data-drop');
    expect(await drop('late.md')).toBe(false);
    expect(up.spy).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.attach-tray')).toBeNull();
    await up.release();
    expect(sentFiles(onSend)).toBeUndefined();
  });
});

describe('the save hook on its own', () => {
  it('answers null to a second save while one runs, and uploads nothing more for it', async () => {
    let release!: (c: StagedClip) => void;
    const upload = vi.fn(() => new Promise<StagedClip>((r) => { release = r; }));
    const { result } = renderHook(() => usePasteSave(SID, upload));
    const a = addChip(emptyChips(), lines(20), 1);
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.save(a.field, a.chips);
      second = result.current.save(a.field, a.chips);
    });
    await expect(second).resolves.toBeNull();
    const path = `${STORE}/clip-20261127-153012-00000000-paste.txt`;
    await act(async () => { release({ path, name: 'n', bytes: 1 }); await first; });
    await expect(first).resolves.toEqual(new Map([[1, { path, text: lines(20) }]]));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('a session change in place while a save runs ends the hold: the answer is dropped, nothing fails', async () => {
    let release!: (c: StagedClip) => void;
    const upload = vi.fn(() => new Promise<StagedClip>((r) => { release = r; }));
    const { result, rerender } = renderHook(({ sid }) => usePasteSave(sid, upload), { initialProps: { sid: SID } });
    const a = addChip(emptyChips(), lines(20), 1);
    let saved!: Promise<unknown>;
    act(() => { saved = result.current.save(a.field, a.chips); });
    expect(result.current.saving).toBe(true);
    rerender({ sid: 'lane-b-project-a' });
    await act(async () => {
      release({ path: `${STORE}/clip-20261127-153012-00000000-paste.txt`, name: 'n', bytes: 1 });
      await saved;
    });
    await expect(saved).resolves.toBeNull();
    expect(result.current.saving).toBe(false);
    expect(result.current.failures.size).toBe(0);
  });

  it('another session starts the saved table again: the same draft is saved anew there', async () => {
    const upload = vi.fn(async (sid: string) => (
      { path: `/home/user-a/.cc-clips/${sid}/clip-20261127-153012-00000000-paste.txt`, name: 'n', bytes: 1 }));
    const { result, rerender } = renderHook(({ sid }) => usePasteSave(sid, upload), { initialProps: { sid: SID } });
    const a = addChip(emptyChips(), lines(20), 1);
    await act(async () => { await result.current.save(a.field, a.chips); });
    expect(upload).toHaveBeenCalledTimes(1);
    rerender({ sid: 'lane-b-project-a' });
    let again!: unknown;
    await act(async () => { again = await result.current.save(a.field, a.chips); });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(again).toEqual(new Map([[1, {
      path: '/home/user-a/.cc-clips/lane-b-project-a/clip-20261127-153012-00000000-paste.txt', text: lines(20),
    }]]));
  });
});

describe('a saved file is never attached to another text (condition 3)', () => {
  it('save fails for one of two chips, the saved one is removed, another paste comes, an undo brings the first back', async () => {
    const up = mockUpload((call) => (call === 1 ? new ApiError(502, { ok: false, error: 'agent-down' }) : 'ok'));
    const { onSend } = mount();
    const A = lines(20, 'a');
    const B = lines(30, 'b');
    const C = lines(40, 'c');
    pasteText(A);
    caretEnd();
    pasteText(B);
    await tapSend();
    const withBoth = field().value;
    fireEvent.click(screen.getByRole('button', { name: 'Remove pasted text #1' }));
    caretEnd();
    pasteText(C);
    edit(`${withBoth}${label(3, 40)}`, undefined, 'historyUndo');
    await tapSend();
    const sent = sentText(onSend).split('\n').map((l) => readPastePointer(l, SID));
    const byPath = new Map(up.saved.map((s) => [s.clip.path, s.text]));
    expect(sent.map((p) => byPath.get(p!.path))).toEqual([A, B, C]);
  });
});

describe('a send that fails after the saves (condition 5)', () => {
  const harness = (prompt: Prompt) => {
    const store = createSessionStore(SID, { api: { prompt } });
    function Harness() {
      const pending = store((s) => s.pending);
      return <Composer onSend={store.getState().send} pending={pending} onResolve={store.getState().resolve} id={SID} />;
    }
    render(<Harness />);
    return store;
  };

  it('the failed bubble holds the pointer text, the field is clear, and Retry saves nothing again', async () => {
    const up = mockUpload();
    const prompt = vi.fn<Prompt>()
      .mockRejectedValueOnce(new ApiError(503, { ok: false, error: 'agent-down' }))
      .mockResolvedValue(undefined);
    const store = harness(prompt);
    pasteText(lines(20));
    await tapSend();
    const pointer = pastePointer(up.paths()[0]!, 20);
    expect(prompt).toHaveBeenNthCalledWith(1, SID, pointer, expect.anything());
    expect(field().value).toBe('');
    const failed = store.getState().pending.find((p) => p.state === 'failed')!;
    expect(failed.text).toBe(pointer);
    await act(async () => { store.getState().retry(failed.key); });
    expect(prompt).toHaveBeenNthCalledWith(2, SID, pointer, expect.anything());
    expect(up.spy).toHaveBeenCalledTimes(1);
  });

  it('the draft-conflict choices resend the pointer text and save nothing', async () => {
    const up = mockUpload();
    const prompt = vi.fn<Prompt>()
      .mockRejectedValueOnce(new ApiError(409, { ok: false, error: 'draft-present', draft: 'left over' }))
      .mockResolvedValue(undefined);
    harness(prompt);
    pasteText(lines(40));
    await tapSend();
    fireEvent.click(await screen.findByRole('button', { name: 'Append anyway' }));
    expect(prompt).toHaveBeenLastCalledWith(SID, `left over\n${pastePointer(up.paths()[0]!, 40)}`,
      expect.objectContaining({ replaceDraft: true }));
    expect(up.spy).toHaveBeenCalledTimes(1);
  });

  it('the store clears the pending send on the echo of the pointer text, and on no other', async () => {
    const up = mockUpload();
    const prompt = vi.fn<Prompt>().mockResolvedValue(undefined);
    const store = harness(prompt);
    const text = lines(20);
    pasteText(text);
    await tapSend();
    const pointer = pastePointer(up.paths()[0]!, 20);
    expect(store.getState().pending.map((p) => composePrompt(p.text, []))).toEqual([pointer]);
    const echo = (uuid: string, said: string): void => {
      act(() => {
        store.getState().apply({
          type: 'events', uuid: 's1', offset: 1,
          events: [{ kind: 'user', uuid, ts: new Date(Date.now() + 1000).toISOString(), text: said }],
        });
      });
    };
    echo('e1', text);
    expect(store.getState().pending).toHaveLength(1);
    echo('e2', pointer);
    expect(store.getState().pending).toHaveLength(0);
  });
});

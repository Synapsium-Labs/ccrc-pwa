// Pasting a screenshot into the composer — ⌘⇧4 then ⌘V, the desktop path that
// skips the filesystem and the file picker entirely. It reuses the "+" button's
// pipeline (downscale → api.upload → the server's `ccd clip` types the saved
// path into the session's input box), so this covers only what paste adds:
// spotting an image on the clipboard, naming it so the server admits it, and
// leaving ordinary text pastes completely untouched.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Composer } from '../src/session/Composer';
import { clipboardImage, namedClipboardImage } from '../src/session/useAttachImage';
import { api } from '../src/lib/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ID = 'claude:OpenClawHetzner';

/** A DataTransfer-shaped clipboard carrying `files` plus optional text. */
const clipboard = (files: File[], text = ''): DataTransfer =>
  ({
    items: [
      ...(text ? [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] : []),
      ...files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    ],
    getData: () => text,
  }) as unknown as DataTransfer;

const shot = (type = 'image/png', name = 'image.png') =>
  new File([new Uint8Array(64)], name, { type });

describe('clipboardImage', () => {
  it('finds the image among clipboard items, and ignores text-only pastes', () => {
    expect(clipboardImage(clipboard([shot()]))?.type).toBe('image/png');
    expect(clipboardImage(clipboard([], 'just some text'))).toBeNull();
    expect(clipboardImage(null)).toBeNull();
  });
});

describe('namedClipboardImage', () => {
  it('names an unnamed clipboard file by its real type — the server admits by extension', () => {
    // Safari hands over an empty name; the upload route matches /\.(png|jpe?g|webp)$/.
    const named = namedClipboardImage(shot('image/jpeg', ''), 1700000000000);
    expect(named?.name).toBe('pasted-1700000000000.jpg');
    expect(named?.type).toBe('image/jpeg');
  });

  it('keeps a name that already carries an accepted extension', () => {
    expect(namedClipboardImage(shot('image/png', 'Screenshot.png'), 1)?.name).toBe('Screenshot.png');
  });

  it('refuses a type the server would reject rather than mislabelling it', () => {
    expect(namedClipboardImage(shot('image/gif', 'anim.gif'), 1)).toBeNull();
  });
});

describe('Composer paste', () => {
  it('uploads a pasted screenshot and does not let it fall into the text box', () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(undefined as never);
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);

    const box = screen.getByRole('textbox');
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboard([shot()]) });
    fireEvent(box, event);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]![0]).toBe(ID);
    expect(event.defaultPrevented).toBe(true);
    expect((box as HTMLTextAreaElement).value).toBe('');
  });

  it('leaves an ordinary text paste to the browser', () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(undefined as never);
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);

    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboard([], 'hello') });
    fireEvent(screen.getByRole('textbox'), event);

    expect(upload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing on a dead session — the composer is read-only', () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(undefined as never);
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} disabled />);

    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboard([shot()]) });
    fireEvent(screen.getByRole('textbox'), event);

    expect(upload).not.toHaveBeenCalled();
  });
});

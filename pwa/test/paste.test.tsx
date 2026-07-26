// Pasting screenshots into the composer — ⌘⇧4 then ⌘V, the desktop path that
// skips the filesystem and the file picker entirely. It shares the tray's own
// pipeline (useStagedImages: downscale → api.upload → a chip appears), so this
// covers only what paste itself adds: spotting every image on the clipboard
// (plural — a paste can carry more than one), naming each so the server
// admits it, and leaving ordinary text pastes completely untouched.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Composer } from '../src/session/Composer';
import { clipboardImages, namedClipboardImage } from '../src/session/useAttachImage';
import { api } from '../src/lib/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ID = 'claude:OpenClawHetzner';
const STAGED_CLIP = { path: '/p/clip-1-a1b2.png', name: 'clip-1-a1b2.png', bytes: 9 };

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

describe('clipboardImages', () => {
  it('finds every image among clipboard items, and ignores text-only pastes', () => {
    expect(clipboardImages(clipboard([shot()])).map((f) => f.type)).toEqual(['image/png']);
    expect(clipboardImages(clipboard([], 'just some text'))).toEqual([]);
    expect(clipboardImages(null)).toEqual([]);
  });

  it('returns every image when several are pasted at once, in clipboard order', () => {
    const files = clipboardImages(
      clipboard([shot('image/png', 'a.png'), shot('image/jpeg', 'b.jpg')]),
    );
    expect(files.map((f) => f.name)).toEqual(['a.png', 'b.jpg']);
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
  it('stages a pasted screenshot as a chip and never lets it fall into the text box', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(STAGED_CLIP);
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);

    const box = screen.getByRole('textbox');
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboard([shot()]) });
    fireEvent(box, event);

    expect(event.defaultPrevented).toBe(true);
    expect((box as HTMLTextAreaElement).value).toBe('');
    await screen.findByAltText('image.png');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]![0]).toBe(ID);
  });

  it('stages every image from a multi-image paste in one add() batch', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(STAGED_CLIP);
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);

    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: clipboard([shot('image/png', 'a.png'), shot('image/png', 'b.png')]),
    });
    fireEvent(screen.getByRole('textbox'), event);

    await screen.findByAltText('a.png');
    await screen.findByAltText('b.png');
    expect(upload).toHaveBeenCalledTimes(2);
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

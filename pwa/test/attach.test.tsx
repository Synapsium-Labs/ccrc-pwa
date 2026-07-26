// Task 11 — the composer owns the attachment tray. AttachButton is now a
// stateless trigger (`onPick` hands back every picked file in one batch); the
// staging, downscale, and upload pipeline that used to live inside the button
// lives in useStagedImages (test/staged-images.test.tsx) and is wired into the
// composer here. The old fire-and-forget path — `useAttachImage`,
// `clipboardImage`, `AttachImage` — is gone from useAttachImage.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { api, ApiError } from '../src/lib/api';
import { AttachButton } from '../src/session/AttachButton';
import { downscaleImage } from '../src/session/useAttachImage';
import { Composer } from '../src/session/Composer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ID = 'claude:OpenClawHetzner';

/** The hidden file input backing the attach button. */
const fileInput = (): HTMLInputElement => {
  const el = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!el) throw new Error('attach input not rendered');
  return el;
};

const pick = (file: File): void => {
  fireEvent.change(fileInput(), { target: { files: [file] } });
};

// — AttachButton: a stateless trigger now; the pipeline lives in useStagedImages —

describe('AttachButton', () => {
  it('hands every picked file to onPick in one batch, never one call per file', () => {
    const onPick = vi.fn();
    render(<AttachButton onPick={onPick} />);

    const a = new File(['a'], 'a.png', { type: 'image/png' });
    const b = new File(['b'], 'b.png', { type: 'image/png' });
    fireEvent.change(fileInput(), { target: { files: [a, b] } });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith([a, b]);
  });

  it('accepts multiple files at the OS picker level', () => {
    render(<AttachButton onPick={vi.fn()} />);
    expect(fileInput()).toHaveAttribute('multiple');
  });

  it('clears the input value so re-picking the same file still fires change', () => {
    render(<AttachButton onPick={vi.fn()} />);
    pick(new File(['a'], 'a.png', { type: 'image/png' }));
    expect(fileInput().value).toBe('');
  });

  it('a dead session disables the button', () => {
    render(<AttachButton onPick={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Attach an image' })).toBeDisabled();
  });

  it('does not force direct camera capture — the gallery is the main lane', () => {
    render(<AttachButton onPick={vi.fn()} />);
    expect(fileInput().hasAttribute('capture')).toBe(false);
  });
});

// — downscaleImage geometry + encoding (canvas mocked; jsdom has no 2d context) —
// Unchanged from the old fire-and-forget path — useStagedImages calls this
// same function, just imported from its new home now that AttachButton no
// longer re-exports it.

describe('downscaleImage', () => {
  const stubCanvas = (): { canvas: () => HTMLCanvasElement; toBlob: ReturnType<typeof vi.spyOn> } => {
    let captured: HTMLCanvasElement | null = null;
    const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      captured = this;
      return ctx;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (cb: BlobCallback, type?: string) {
        cb(new Blob(['encoded'], { type }));
      } as unknown as typeof HTMLCanvasElement.prototype.toBlob);
    return {
      canvas: () => {
        if (!captured) throw new Error('canvas never used');
        return captured;
      },
      toBlob,
    };
  };

  it('caps the long edge at 2048px, preserves aspect, and keeps a PNG a PNG', async () => {
    // A pasted screenshot is the main reason this path exists, and its value is
    // the small text in it — re-encoding UI type as JPEG rings around every
    // glyph. Size is already bounded by the 2048px cap.
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 4096, height: 1024, close })),
    );
    const h = stubCanvas();

    const out = await downscaleImage(new File(['x'], 'big.png', { type: 'image/png' }));

    expect(h.canvas().width).toBe(2048);
    expect(h.canvas().height).toBe(512);
    expect(h.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined);
    expect(out.type).toBe('image/png');
    expect(close).toHaveBeenCalled(); // bitmap memory released
  });

  it('still encodes non-PNG sources as JPEG 0.85 — photos have no type to smear', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 4096, height: 1024, close: vi.fn() })),
    );
    const h = stubCanvas();

    const out = await downscaleImage(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }));

    expect(h.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
    expect(out.type).toBe('image/jpeg');
  });

  it('never upscales an image already inside the cap', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })),
    );
    const h = stubCanvas();

    await downscaleImage(new File(['x'], 'small.jpg', { type: 'image/jpeg' }));

    expect(h.canvas().width).toBe(800);
    expect(h.canvas().height).toBe(600);
  });
});

// — Composer wiring —

describe('Composer attach wiring', () => {
  it('renders the attach button when given a session id, not otherwise', () => {
    const { rerender } = render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    expect(screen.getByRole('button', { name: 'Attach an image' })).toBeInTheDocument();

    rerender(<Composer onSend={vi.fn()} pending={[]} />);
    expect(screen.queryByRole('button', { name: 'Attach an image' })).not.toBeInTheDocument();
  });

  it('a dead session disables attach along with the rest of the composer', () => {
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} disabled />);
    expect(screen.getByRole('button', { name: 'Attach an image' })).toBeDisabled();
  });

  it('sends the staged paths with the text and clears the tray', async () => {
    vi.spyOn(api, 'upload').mockResolvedValue(
      { path: '/p/clip-1-a1b2.png', name: 'clip-1-a1b2.png', bytes: 9 });
    const onSend = vi.fn();
    render(<Composer onSend={onSend} pending={[]} id={ID} />);
    pick(new File(['tiny'], 'shot.png', { type: 'image/png' }));
    await screen.findByAltText('shot.png');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'what is this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledWith('what is this', {
      attachments: [{ path: '/p/clip-1-a1b2.png', previewUrl: expect.stringMatching(/^blob:/) }],
    });
    // Released, not revoked — the pending bubble still needs that URL.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('allows an image with no text — that is a legitimate prompt', async () => {
    vi.spyOn(api, 'upload').mockResolvedValue(
      { path: '/p/clip-1-a1b2.png', name: 'clip-1-a1b2.png', bytes: 9 });
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    pick(new File(['tiny'], 'shot.png', { type: 'image/png' }));
    await screen.findByAltText('shot.png');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('refuses to send while a chip has failed — it would drop the image silently', async () => {
    vi.spyOn(api, 'upload').mockRejectedValue(new ApiError(502, { error: 'nope' }));
    const onSend = vi.fn();
    render(<Composer onSend={onSend} pending={[]} id={ID} />);
    pick(new File(['tiny'], 'shot.png', { type: 'image/png' }));
    await screen.findByRole('button', { name: /retry/i });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });
});

// — Composer drag-and-drop —

describe('Composer drag-and-drop', () => {
  const composerEl = (container: HTMLElement): HTMLElement => {
    const el = container.querySelector<HTMLElement>('.composer');
    if (!el) throw new Error('.composer not rendered');
    return el;
  };

  const dragEvent = (
    type: 'dragover' | 'dragleave' | 'drop',
    detail: { files?: File[]; relatedTarget?: EventTarget | null },
  ): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    if (detail.files !== undefined) {
      Object.defineProperty(event, 'dataTransfer', { value: { files: detail.files } });
    }
    if ('relatedTarget' in detail) {
      Object.defineProperty(event, 'relatedTarget', { value: detail.relatedTarget });
    }
    return event;
  };

  it('stages every dropped image in one add() batch', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(
      { path: '/p/clip-1-a1b2.png', name: 'clip-1-a1b2.png', bytes: 9 });
    const { container } = render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    const a = new File(['a'], 'a.png', { type: 'image/png' });
    const b = new File(['b'], 'b.png', { type: 'image/png' });

    const event = dragEvent('drop', { files: [a, b] });
    fireEvent(composerEl(container), event);

    expect(event.defaultPrevented).toBe(true);
    await screen.findByAltText('a.png');
    await screen.findByAltText('b.png');
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('leaves a text/URL drop (no files) to the browser instead of swallowing it', () => {
    const { container } = render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    const event = dragEvent('drop', { files: [] });
    fireEvent(composerEl(container), event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('only clears the drop overlay once the pointer actually leaves .composer', () => {
    const { container } = render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    const composer = composerEl(container);
    const textbox = screen.getByRole('textbox');

    fireEvent(composer, dragEvent('dragover', { files: [] }));
    expect(composer).toHaveAttribute('data-drop', 'true');

    // dragleave bubbles from every child on the way out — landing on a child
    // of .composer (the textarea) must not clear the overlay.
    fireEvent(composer, dragEvent('dragleave', { relatedTarget: textbox }));
    expect(composer).toHaveAttribute('data-drop', 'true');

    // Actually leaving .composer (relatedTarget outside it, or null when the
    // drag leaves the window) does clear it.
    fireEvent(composer, dragEvent('dragleave', { relatedTarget: null }));
    expect(composer).not.toHaveAttribute('data-drop');
  });
});

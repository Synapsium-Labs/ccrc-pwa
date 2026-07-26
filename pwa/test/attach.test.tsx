// Task 11 — image attach: the composer's AttachButton uploads a picked image
// through api.upload; anything but a small PNG goes through the client-side
// canvas downscale first (max 2048px long edge, JPEG 0.85) so phone-camera
// originals never ride the phone's uplink at 10MB; failures toast with a
// Retry that re-runs the same upload.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastHost } from '../src/components/Toast';
import { api, ApiError } from '../src/lib/api';
import { AttachButton, downscaleImage } from '../src/session/AttachButton';
import { Composer } from '../src/session/Composer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ID = 'claude:OpenClawHetzner';
const SUCCESS_COPY = 'Image attached to the prompt — add your text and send';

/** api.upload now resolves the staged clip (Task 8); these tests only care
 *  that the promise resolves, not the payload shape. */
const STAGED_CLIP = { path: '/home/u/.cc-clips/claude:OpenClawHetzner/clip-1-a1b2.png', name: 'clip-1-a1b2.png', bytes: 9 };

/** The hidden file input backing the attach button. */
const fileInput = (): HTMLInputElement => {
  const el = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!el) throw new Error('attach input not rendered');
  return el;
};

const pick = (file: File): void => {
  fireEvent.change(fileInput(), { target: { files: [file] } });
};

// — AttachButton upload flow —

describe('AttachButton', () => {
  it('uploads a small PNG as-is — screenshots skip the lossy downscale', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(STAGED_CLIP);
    const downscale = vi.fn<(f: File) => Promise<Blob>>();
    render(
      <>
        <AttachButton id={ID} downscale={downscale} />
        <ToastHost />
      </>,
    );

    const file = new File(['tiny-png-bytes'], 'shot.png', { type: 'image/png' });
    pick(file);

    expect(await screen.findByText(SUCCESS_COPY)).toBeInTheDocument();
    expect(downscale).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledWith(ID, file);
  });

  it('sends an oversized image through downscaleImage first, as a JPEG blob', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(STAGED_CLIP);
    const small = new Blob(['downscaled'], { type: 'image/jpeg' });
    const downscale = vi.fn<(f: File) => Promise<Blob>>().mockResolvedValue(small);
    render(
      <>
        <AttachButton id={ID} downscale={downscale} />
        <ToastHost />
      </>,
    );

    // A PNG over the 1MB skip-threshold must go through the downscale.
    const big = new File([new Uint8Array(1024 * 1024 + 1)], 'shot.png', { type: 'image/png' });
    pick(big);

    expect(await screen.findByText(SUCCESS_COPY)).toBeInTheDocument();
    expect(downscale).toHaveBeenCalledWith(big);

    // The upload carries the downscaled bytes, re-wrapped as a .jpg file so
    // the server's extension check accepts it.
    expect(upload).toHaveBeenCalledTimes(1);
    const sent = upload.mock.calls[0]![1];
    expect(sent).toBeInstanceOf(Blob);
    expect(sent.type).toBe('image/jpeg');
    expect(sent.name).toBe('shot.jpg');
  });

  it('camera JPEGs go through the downscale regardless of size', async () => {
    vi.spyOn(api, 'upload').mockResolvedValue(STAGED_CLIP);
    const downscale = vi
      .fn<(f: File) => Promise<Blob>>()
      .mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
    render(
      <>
        <AttachButton id={ID} downscale={downscale} />
        <ToastHost />
      </>,
    );

    const photo = new File(['jpeg-bytes'], 'IMG_0042.jpeg', { type: 'image/jpeg' });
    pick(photo);

    expect(await screen.findByText(SUCCESS_COPY)).toBeInTheDocument();
    expect(downscale).toHaveBeenCalledWith(photo);
  });

  it('a failed upload toasts the server error with a Retry that re-uploads', async () => {
    const upload = vi
      .spyOn(api, 'upload')
      .mockRejectedValueOnce(new ApiError(502, { ok: false, stderr: 'ccd clip: no such session' }))
      .mockResolvedValueOnce(STAGED_CLIP);
    render(
      <>
        <AttachButton id={ID} downscale={vi.fn()} />
        <ToastHost />
      </>,
    );

    const file = new File(['tiny'], 'shot.png', { type: 'image/png' });
    pick(file);

    // The failure interrupts (role=alert) and carries ccd's own words.
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByRole('alert')).toHaveTextContent(/no such session/);

    fireEvent.click(retry);
    expect(await screen.findByText(SUCCESS_COPY)).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenLastCalledWith(ID, file);
  });
});

// — downscaleImage geometry + encoding (canvas mocked; jsdom has no 2d context) —

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
});

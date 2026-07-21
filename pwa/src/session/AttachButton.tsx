// AttachButton — the composer's image lane. A ghost "+" in the input bar
// backed by a hidden <input type="file" accept="image/*" capture>; picking an
// image downscales it client-side (longest edge 2048px, JPEG 0.85 — a phone
// camera original is 10MB+ and the prompt only needs a legible picture), then
// uploads through api.upload (the server's `ccd clip` types the file's path
// into the session prompt). Small PNGs (<1MB) skip the re-encode: they're
// screenshots whose crisp text a JPEG pass would smear. While the upload
// runs, an indeterminate phosphor ring spins on the button; failure toasts
// ccd's own words with a Retry that re-runs the same upload.
import { useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { toast } from '../components/Toast';
import { api, apiErrorText } from '../lib/api';
import './chat.css';

/** PNGs under this size upload untouched — lossless screenshots stay lossless. */
const SMALL_PNG_MAX = 1024 * 1024;
/** Longest edge after downscale (px). */
const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.85;

/** Canvas downscale: cap the longest edge at 2048px (never upscale), re-encode
 *  as JPEG 0.85. Exported for tests; injectable into AttachButton the same way
 *  stores and sockets are elsewhere. */
export async function downscaleImage(file: File | Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas is unavailable');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("couldn't encode the image"))),
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}

export interface AttachButtonProps {
  /** Session id the image lands in. */
  id: string;
  /** Dead session: the whole composer is read-only. */
  disabled?: boolean;
  /** Injectable for tests; defaults to the real canvas downscale. */
  downscale?: (file: File) => Promise<Blob>;
}

export function AttachButton({
  id,
  disabled = false,
  downscale = downscaleImage,
}: AttachButtonProps): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const attach = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      const keepOriginal = file.type === 'image/png' && file.size < SMALL_PNG_MAX;
      // Downscaled bytes are re-wrapped as a .jpg File — the server admits
      // uploads by filename extension (png|jpe?g|webp), and a bare Blob has none.
      const payload = keepOriginal
        ? file
        : new File([await downscale(file)], `${file.name.replace(/\.[^.]*$/, '')}.jpg`, {
            type: 'image/jpeg',
          });
      await api.upload(id, payload);
      toast('Image attached to the prompt — add your text and send');
    } catch (err) {
      toast(`Couldn't attach the image — ${apiErrorText(err)}`, 'error', {
        label: 'Retry',
        onClick: () => void attach(file),
      });
    } finally {
      setBusy(false);
    }
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ''; // re-picking the same file must fire change again
    if (file) void attach(file);
  };

  return (
    <>
      <input
        ref={input}
        className="attach-input"
        type="file"
        accept="image/*"
        capture
        tabIndex={-1}
        aria-hidden="true"
        onChange={onPick}
      />
      <button
        type="button"
        className="attach-btn"
        aria-label="Attach an image"
        aria-busy={busy || undefined}
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
      >
        <span aria-hidden="true">+</span>
      </button>
    </>
  );
}

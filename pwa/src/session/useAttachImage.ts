// The image-attach lane, shared by its two doors: the composer's "+" picker and
// pasting a screenshot straight into the prompt. Both end in the same place —
// downscale if needed, upload, and let the server's `ccd clip` type the saved
// file's path into the session's input box.
import { useState } from 'react';
import { toast } from '../components/Toast';
import { api, apiErrorText } from '../lib/api';

/** PNGs under this size upload untouched — lossless screenshots stay lossless. */
const SMALL_PNG_MAX = 1024 * 1024;
/** Longest edge after downscale (px). */
const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.85;

/** The image types the server admits, by filename extension. */
const EXT_FOR_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Canvas downscale: cap the longest edge at 2048px (never upscale). PNG sources
 * re-encode as PNG, everything else as JPEG 0.85 — the whole point of pasting a
 * screenshot is that Claude can read the small text in it, and a JPEG pass over
 * UI type rings around every glyph. Photos (the JPEG path) have no such edges
 * and keep the much smaller file.
 * Exported for tests; injectable the same way stores and sockets are elsewhere.
 */
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
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("couldn't encode the image"))),
        type,
        type === 'image/jpeg' ? JPEG_QUALITY : undefined,
      );
    });
  } finally {
    bitmap.close();
  }
}

/**
 * A clipboard image arrives as a File with no useful name — Chrome calls every
 * one of them "image.png", Safari leaves it empty — but the server admits
 * uploads by filename extension. Give it one, derived from the actual MIME type,
 * and keep the timestamp so two pastes never collide in the clips directory.
 * Returns null for a type we can't accept, so the caller can say so.
 */
export function namedClipboardImage(file: File, now: number): File | null {
  const ext = EXT_FOR_TYPE[file.type];
  if (!ext) return null;
  if (new RegExp(`\\.(png|jpe?g|webp)$`, 'i').test(file.name)) return file;
  return new File([file], `pasted-${now}.${ext}`, { type: file.type });
}

/** The image on the clipboard, if this paste carried one. Text pastes → null. */
export function clipboardImage(data: DataTransfer | null): File | null {
  const items = Array.from(data?.items ?? []);
  const image = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  return image?.getAsFile() ?? null;
}

export interface AttachImage {
  busy: boolean;
  attach: (file: File) => Promise<void>;
}

export function useAttachImage(
  id: string,
  downscale: (file: File) => Promise<Blob> = downscaleImage,
): AttachImage {
  const [busy, setBusy] = useState(false);

  const attach = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      const keepOriginal = file.type === 'image/png' && file.size < SMALL_PNG_MAX;
      // Downscaled bytes are re-wrapped as a named File — the server admits
      // uploads by filename extension, and a bare Blob has none. The extension
      // follows what the downscale actually produced.
      let payload = file;
      if (!keepOriginal) {
        const blob = await downscale(file);
        const ext = blob.type === 'image/png' ? 'png' : 'jpg';
        payload = new File([blob], `${file.name.replace(/\.[^.]*$/, '')}.${ext}`, {
          type: blob.type,
        });
      }
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

  return { busy, attach };
}

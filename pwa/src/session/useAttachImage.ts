// The staged-images tray's engine: the composer's "+" picker, pasting a
// screenshot, and dragging one in all end up here — downscale if needed,
// upload, and hold the result as a chip until the composer sends or the user
// removes it. (This file used to also hold a fire-and-forget `useAttachImage`
// that typed the upload's path straight into the textarea; the tray replaced
// it — see git history around the attachment-tray feature for that path.)
import { useEffect, useRef, useState } from 'react';
import { toast } from '../components/Toast';
import { api, apiErrorText, uploadErrorText } from '../lib/api';

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

/** Every image on the clipboard. Text pastes give []. */
export function clipboardImages(data: DataTransfer | null): File[] {
  return Array.from(data?.items ?? [])
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null);
}

export const MAX_IMAGES = 4;

export interface StagedImage {
  key: string;
  file: File;
  previewUrl: string;
  state: 'uploading' | 'staged' | 'failed';
  path?: string;
  width?: number;
  height?: number;
  error?: string;
}

export interface StagedImages {
  images: StagedImage[];
  add: (files: readonly File[]) => void;
  remove: (key: string) => void;
  retry: (key: string) => void;
  /** Empty the tray WITHOUT revoking — send hands the object URLs to the
   *  PendingSend, which shows them and revokes them when it resolves. */
  release: () => void;
  uploading: boolean;
  hasFailed: boolean;
}

export function useStagedImages(
  id: string,
  downscale: (file: File) => Promise<Blob> = downscaleImage,
): StagedImages {
  const [images, setImages] = useState<StagedImage[]>([]);
  const seq = useRef(0);
  // React batches state updates, so a second add() in the same tick would not
  // see the first one's result if we read/write through the functional
  // setState form. The ref is the single source of truth; state just mirrors
  // it so renders pick it up.
  const listRef = useRef<StagedImage[]>([]);

  const commit = (next: StagedImage[]): void => {
    listRef.current = next;
    setImages(next);
  };

  const patch = (key: string, next: Partial<StagedImage>): void =>
    commit(listRef.current.map((i) => (i.key === key ? { ...i, ...next } : i)));

  const upload = async (key: string, file: File): Promise<void> => {
    try {
      const keepOriginal = file.type === 'image/png' && file.size < SMALL_PNG_MAX;
      let payload = file;
      if (!keepOriginal) {
        const blob = await downscale(file);
        const ext = blob.type === 'image/png' ? 'png' : 'jpg';
        payload = new File([blob], `${file.name.replace(/\.[^.]*$/, '')}.${ext}`, { type: blob.type });
      }
      // Measure the PAYLOAD on both branches — the caption answers "did the
      // downscale ruin my screenshot", and keepOriginal never decodes otherwise.
      const bitmap = await createImageBitmap(payload);
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close();
      const clip = await api.upload(id, payload);
      patch(key, { state: 'staged', path: clip.path, width, height, error: undefined });
    } catch (err) {
      // Say it out loud as well as on the chip. The chip alone was a dead end:
      // a 413 arrived as a thumbnail whose only affordance was a retry that can
      // never succeed, with the reason set on the image and rendered nowhere.
      // (The toast that used to carry this was removed because it covered the
      // composer; the `--composer-h` offset now lifts toasts clear of it.)
      const why = uploadErrorText(apiErrorText(err));
      patch(key, { state: 'failed', error: why });
      toast(why, 'error');
    }
  };

  const add = (files: readonly File[]): void => {
    const cur = listRef.current;
    const room = MAX_IMAGES - cur.length;
    if (files.length > room) toast(`Four images per message — send these first`, 'error');

    // Built OUTSIDE any updater: pure, so StrictMode's double-invoke cannot
    // duplicate chips or leak an extra object URL, and two add() calls in the
    // same tick each see the other's result via listRef rather than a stale
    // closure over `cur`.
    const accepted: StagedImage[] = [];
    for (const file of files.slice(0, Math.max(0, room))) {
      const named = namedClipboardImage(file, Date.now() + accepted.length);
      if (named === null) {
        toast(`Can't attach ${file.type || 'that'} — PNG, JPEG or WebP only`, 'error');
        continue;
      }
      seq.current += 1;
      accepted.push({
        key: `img${seq.current}`,
        file: named,
        previewUrl: URL.createObjectURL(named),
        state: 'uploading',
      });
    }
    if (accepted.length === 0) return;
    commit([...cur, ...accepted]);
    for (const img of accepted) void upload(img.key, img.file);
  };

  const remove = (key: string): void => {
    const gone = listRef.current.find((i) => i.key === key);
    if (gone) URL.revokeObjectURL(gone.previewUrl);
    commit(listRef.current.filter((i) => i.key !== key));
  };

  const retry = (key: string): void => {
    const img = listRef.current.find((i) => i.key === key);
    if (!img || img.state !== 'failed') return;
    patch(key, { state: 'uploading', error: undefined });
    void upload(key, img.file);
  };

  // Deliberately does NOT revoke: at send the object URLs pass to the
  // PendingSend, which renders them in the optimistic bubble and revokes them
  // when it confirms or is discarded. Revoking here would blank that bubble.
  const release = (): void => commit([]);

  // Whatever is STILL staged when the composer goes away is the hook's to free —
  // navigating back to the fleet with four chips up leaked up to 48 MB of image.
  // Safe against release(): it empties listRef synchronously, so URLs already
  // handed to a PendingSend are no longer in the list this reads.
  useEffect(() => () => {
    for (const img of listRef.current) URL.revokeObjectURL(img.previewUrl);
  }, []);

  return {
    images, add, remove, retry, release,
    uploading: images.some((i) => i.state === 'uploading'),
    hasFailed: images.some((i) => i.state === 'failed'),
  };
}

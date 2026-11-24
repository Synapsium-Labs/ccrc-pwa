// The staged-attachments tray's engine: the composer's "+" picker, pasting a
// screenshot, and dragging a file in all end up here — downscale if it is an
// image, upload, and hold the result as a chip until the composer sends or the
// user removes it. (This file used to also hold a fire-and-forget
// `useAttachImage` that typed the upload's path straight into the textarea; the
// tray replaced it — see git history around the attachment-tray feature.)
//
// TWO KINDS, one lane, and ANY FILE (2026-11-24). A picture is staged for what
// it looks like, so it may be re-encoded on the way. Every other file is
// staged for what reads it — the path is typed into the session and the
// session opens the file itself — so it is uploaded byte-identical and never
// touches the canvas. Which kind a file is comes from `isImageClip` on its
// NAME, the same answer the server and the bubble reach, rather than from a
// `File.type` the OS may not have set. What remains of a gate is the two
// limits, `CLIP_MAX_BYTES` per file and `CLIP_MAX_PER_MESSAGE` per message.
import { useEffect, useRef, useState } from 'react';
import { toast, type StagedImage } from '@ccrc/ui';
import { CLIP_MAX_BYTES, CLIP_MAX_PER_MESSAGE, hasClipExt, isImageClip } from '../../../shared/api';
import { api, apiErrorText, uploadErrorText } from '../lib/api';

/** PNGs under this size upload untouched — lossless screenshots stay lossless. */
const SMALL_PNG_MAX = 1024 * 1024;
/** Longest edge after downscale (px). */
const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.85;

/** The declared picture types, and the extension each is named for when its
 *  file's own name has no usable one, so it still thumbnails and may still
 *  downscale, as on main. The type decides nothing else: it never overrides a
 *  usable extension. A frozen table with no prototype, because the key is a
 *  type the browser declares: `constructor` or `__proto__` must find nothing
 *  (review 3647 F7, the repair `CLIP_MIME` got on the server). */
const EXT_FOR_TYPE: Readonly<Partial<Record<string, string>>> = Object.freeze(Object.assign(
  Object.create(null) as Record<string, string>,
  { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' },
));

/**
 * The OS picker's filter: NONE. Any file is admitted, and an `accept` with no
 * value is what makes a phone offer everything at once — on iOS the photo
 * library, the camera and Files in one sheet. A list here (it was `image/*`
 * plus the document extensions) is what greyed every other file out.
 *
 * Still handed to `@ccrc/ui`'s `AttachButton` as its `accept` prop, and still
 * derived here rather than in the design system: undefined leaves the input
 * with no `accept` attribute at all, which is the button's documented "every
 * file" case.
 */
export const ATTACH_ACCEPT: string | undefined = undefined;

/** The extension a file with none of the admitted shape is given before upload.
 *  `noext` claims no format — a `.bin` or a `.txt` would — and says plainly to
 *  the reader on the far end what happened to the name: `README` arrives as
 *  `clip-…-README.noext`. */
export const NEUTRAL_EXT = 'noext';

/** Bytes, the way the refusal says them: one decimal place of MB, rounded UP,
 *  so a file one byte over the limit never reads as the limit itself. */
const mb = (bytes: number): string => `${(Math.ceil((bytes * 10) / (1024 * 1024)) / 10).toFixed(1)} MB`;

/** The one refusal that remains before an upload: the per-file limit, said
 *  with the file's name and its size. */
export function tooLargeText(name: string, bytes: number): string {
  return `${name} is ${mb(bytes)} — ${String(CLIP_MAX_BYTES / (1024 * 1024))} MB per file is the limit`;
}

/**
 * Worth handing to `add()`: every file. Drag-and-drop and paste both use it,
 * and since any file is admitted there is nothing left to tell apart by type
 * or name — the limits are `add()`'s, where a refusal can be said. Kept as a
 * function because the composer's two doors import it.
 */
export function isAttachable(_file: File): boolean {
  return true;
}

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
 * The name the upload will carry. A file with an extension of the admitted
 * shape is handed back untouched, whatever type it declares, so the stem that
 * reaches the prompt is the name the user recognises. Otherwise the name gains
 * an extension: a DECLARED picture (`image/png`, `image/jpeg`, `image/webp`)
 * gains that picture's, so it thumbnails and may downscale as on main, and any
 * other file gains `.noext`. A nameless file takes `pasted-<ms>` as its stem,
 * the timestamp keeping two pastes from colliding; any other keeps its own
 * name whole as the stem (`shot` becomes `shot.png`, `README` `README.noext`).
 */
export function namedUpload(file: File, now: number): File {
  if (hasClipExt(file.name)) return file;
  const stem = file.name === '' ? `pasted-${String(now)}` : file.name;
  return new File([file], `${stem}.${EXT_FOR_TYPE[file.type] ?? NEUTRAL_EXT}`, { type: file.type });
}

/** Every attachable file on the clipboard. Text pastes give []. */
export function clipboardFiles(data: DataTransfer | null): File[] {
  return Array.from(data?.items ?? [])
    .filter((i) => i.kind === 'file')
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null)
    .filter(isAttachable);
}

export const MAX_IMAGES = CLIP_MAX_PER_MESSAGE;

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
      if (!isImageClip(file.name)) {
        // A document goes up EXACTLY as it arrived. Everything below this line
        // is image machinery: the canvas pass would either throw on a PDF or,
        // worse, succeed and upload a picture of nothing, and `createImageBitmap`
        // throws on text — which would land the chip in `failed` with a decoder
        // error as the reason. There are no dimensions to report either.
        // Oversize was refused in `add()`, before this chip existed.
        const staged = await api.upload(id, file);
        patch(key, { state: 'staged', path: staged.path, error: undefined });
        return;
      }
      const keepOriginal = file.type === 'image/png' && file.size < SMALL_PNG_MAX;
      let payload = file;
      if (!keepOriginal) {
        const blob = await downscale(file);
        const ext = blob.type === 'image/png' ? 'png' : 'jpg';
        payload = new File([blob], `${file.name.replace(/\.[^.]*$/, '')}.${ext}`, { type: blob.type });
      }
      // A picture is measured AFTER the downscale, which is what may bring it
      // under the limit; the server refuses the same bytes, but this says the
      // size, and it costs no request.
      if (payload.size > CLIP_MAX_BYTES) throw new Error(tooLargeText(file.name, payload.size));
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
      // `apiErrorText`'s floor is the bare message, so the size refusal thrown
      // above reaches the chip and the toast as its own sentence.
      const why = uploadErrorText(apiErrorText(err));
      patch(key, { state: 'failed', error: why });
      toast(why, 'error');
    }
  };

  const add = (files: readonly File[]): void => {
    const cur = listRef.current;
    const room = MAX_IMAGES - cur.length;
    if (files.length > room) toast(`${String(CLIP_MAX_PER_MESSAGE)} attachments per message — send these first`, 'error');

    // Built OUTSIDE any updater: pure, so StrictMode's double-invoke cannot
    // duplicate chips or leak an extra object URL, and two add() calls in the
    // same tick each see the other's result via listRef rather than a stale
    // closure over `cur`.
    const accepted: StagedImage[] = [];
    for (const file of files.slice(0, Math.max(0, room))) {
      // Named FIRST: whether this is a picture is decided on the name it will
      // carry, so a nameless clipboard picture waits for its downscale as on
      // main, and the refusal always has a name to say (review 3647 F1).
      const named = namedUpload(file, Date.now() + accepted.length);
      // Anything else goes up byte for byte, so its size now is its size at
      // the server: refuse it here, with no chip, rather than upload 40 MB to
      // be told no.
      if (!isImageClip(named.name) && named.size > CLIP_MAX_BYTES) {
        toast(tooLargeText(named.name, named.size), 'error');
        continue;
      }
      seq.current += 1;
      accepted.push({
        key: `img${seq.current}`,
        file: named,
        // Images only — see the field's own note. `URL.createObjectURL` would
        // happily hand back a URL for a .md nobody is going to render.
        ...(isImageClip(named.name) ? { previewUrl: URL.createObjectURL(named) } : {}),
        state: 'uploading',
      });
    }
    if (accepted.length === 0) return;
    commit([...cur, ...accepted]);
    for (const img of accepted) void upload(img.key, img.file);
  };

  const remove = (key: string): void => {
    const gone = listRef.current.find((i) => i.key === key);
    if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
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
    for (const img of listRef.current) if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
  }, []);

  return {
    images, add, remove, retry, release,
    uploading: images.some((i) => i.state === 'uploading'),
    hasFailed: images.some((i) => i.state === 'failed'),
  };
}

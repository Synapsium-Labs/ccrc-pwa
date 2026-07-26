// AttachButton — the composer's "+" picker: a ghost button backed by a hidden
// <input type="file" accept="image/*">. The pipeline it feeds (downscale,
// upload, `ccd clip` typing the path into the prompt) lives in useAttachImage,
// shared with pasting a screenshot straight into the composer.
import { useRef } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useAttachImage, downscaleImage } from './useAttachImage';
import './chat.css';

// Re-exported so the canvas downscale keeps its original import path.
export { downscaleImage };

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
  const { busy, attach } = useAttachImage(id, downscale);

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ''; // re-picking the same file must fire change again
    if (file) void attach(file);
  };

  return (
    <>
      {/* No `capture` attribute: it forces the camera, and the main lane here
          is picking an existing screenshot from the gallery — the picker still
          offers the camera on phones. */}
      <input
        ref={input}
        className="attach-input"
        type="file"
        accept="image/*"
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

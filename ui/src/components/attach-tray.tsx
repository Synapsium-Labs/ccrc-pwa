// The attachment tray — chips above the input bar. This is the whole feedback
// surface for attaching: the old success toast is gone, because it landed on top
// of the very input it told you to type into.
import type { ReactNode } from 'react';
import './attach-spin.css';
import './attach-tray.css';

/** One image on its way into a message, in whichever of the three states the
 *  composer's upload pipeline has it. The SHAPE lives here, with the only
 *  thing that renders it, rather than with the hook that fills it: the tray is
 *  the design system's and the hook is the app's, and the hook already depends
 *  on this package. `state` is the chip's whole vocabulary — `failed` is the
 *  one that grows a control (retry), which is why it is a word and not a
 *  boolean beside `path`. */
export interface StagedImage {
  key: string;
  file: File;
  previewUrl: string;
  state: 'uploading' | 'staged' | 'failed';
  path?: string;
  width?: number;
  height?: number;
  /** Why the upload failed. The chip's `title` is the only place this survives
   *  once the toast that also carried it has gone. */
  error?: string;
}

export interface AttachTrayProps {
  images: StagedImage[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}

export function AttachTray({ images, onRemove, onRetry }: AttachTrayProps): ReactNode {
  if (images.length === 0) return null;
  return (
    <ul className="attach-tray" aria-label="Attached images">
      {/* `title` is the only place a failure reason survives on the chip itself
          — the prose also goes out as a toast the moment it happens, but that
          is gone by the time the user comes back to look at the dead chip. */}
      {images.map((img) => (
        <li key={img.key} className="attach-chip" data-state={img.state} title={img.error}>
          {/* The thumbnail's rounded-corner clip. On a failed chip this is
              deliberately NOT a button — the whole-media retry tap used to
              overlap the remove button's hit area with no way to tell them
              apart; retry is now only the strip below, so the thumbnail here
              is inert on a failed chip (does nothing), same as it is on every
              other state. */}
          <span className="attach-chip-media">
            <img src={img.previewUrl} alt={img.file.name} className="attach-thumb" />
            {img.state !== 'failed' && (
              <span className="attach-strip">
                {img.state === 'uploading'
                  ? 'uploading…'
                  : img.width && img.height
                    ? `${img.width}×${img.height}`
                    : ''}
              </span>
            )}
          </span>
          {img.state === 'failed' && (
            <button
              type="button"
              className="attach-strip attach-chip-retry"
              onClick={() => onRetry(img.key)}
            >
              retry
            </button>
          )}
          <button
            type="button"
            className="attach-remove"
            aria-label={`Remove ${img.file.name}`}
            onClick={() => onRemove(img.key)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

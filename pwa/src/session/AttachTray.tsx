// The attachment tray — chips above the input bar. This is the whole feedback
// surface for attaching: the old success toast is gone, because it landed on top
// of the very input it told you to type into.
import type { ReactNode } from 'react';
import type { StagedImage } from './useAttachImage';
import './chat.css';

export interface AttachTrayProps {
  images: StagedImage[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}

export function AttachTray({ images, onRemove, onRetry }: AttachTrayProps): ReactNode {
  if (images.length === 0) return null;
  return (
    <ul className="attach-tray" aria-label="Attached images">
      {images.map((img) => (
        <li key={img.key} className="attach-chip" data-state={img.state}>
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

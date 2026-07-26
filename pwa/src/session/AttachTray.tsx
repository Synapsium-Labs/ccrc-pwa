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
          {img.state === 'failed' ? (
            <button type="button" className="attach-chip-retry" onClick={() => onRetry(img.key)}>
              <img src={img.previewUrl} alt={img.file.name} className="attach-thumb" />
              <span className="attach-strip">retry</span>
            </button>
          ) : (
            <>
              <img src={img.previewUrl} alt={img.file.name} className="attach-thumb" />
              <span className="attach-strip">
                {img.state === 'uploading'
                  ? 'uploading…'
                  : img.width && img.height
                    ? `${img.width}×${img.height}`
                    : ''}
              </span>
            </>
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

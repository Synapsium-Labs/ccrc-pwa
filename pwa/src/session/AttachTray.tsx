// The attachment tray — chips above the input bar. This is the whole feedback
// surface for attaching: the old success toast is gone, because it landed on top
// of the very input it told you to type into.
//
// A chip draws whichever of two things it has. An image has a thumbnail and its
// pixel dimensions (the "did the downscale ruin my screenshot" answer). A
// DOCUMENT has neither, so it draws its extension where the picture would be
// and its NAME in the strip below — for a document the name is the only thing
// that says which of four staged files this one is.
import type { ReactNode } from 'react';
import type { StagedImage } from './useAttachImage';
import './chat.css';

/** The badge a document chip wears: its extension, upper-cased, or '?' for the
 *  shapes that have none. Never longer than the four characters the 72px box
 *  has room for — `CLIP_DOC_EXTS` holds nothing longer, and a stray one would
 *  be truncated by CSS rather than allowed to break the layout. */
function extBadge(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '?' : name.slice(dot + 1).toUpperCase();
}

export interface AttachTrayProps {
  images: StagedImage[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}

export function AttachTray({ images, onRemove, onRetry }: AttachTrayProps): ReactNode {
  if (images.length === 0) return null;
  return (
    <ul className="attach-tray" aria-label="Attachments">
      {/* `title` is the only place a failure reason survives on the chip itself
          — the prose also goes out as a toast the moment it happens, but that
          is gone by the time the user comes back to look at the dead chip. */}
      {images.map((img) => (
        <li
          key={img.key}
          className="attach-chip"
          data-state={img.state}
          // The error keeps this slot when there is one — a failed chip's whole
          // reason lives here. Otherwise a document lends it its full name,
          // which the strip below can only show truncated.
          title={img.error ?? (img.previewUrl === undefined ? img.file.name : undefined)}
        >
          {/* The thumbnail's rounded-corner clip. On a failed chip this is
              deliberately NOT a button — the whole-media retry tap used to
              overlap the remove button's hit area with no way to tell them
              apart; retry is now only the strip below, so the thumbnail here
              is inert on a failed chip (does nothing), same as it is on every
              other state. */}
          <span className="attach-chip-media">
            {img.previewUrl !== undefined ? (
              <img src={img.previewUrl} alt={img.file.name} className="attach-thumb" />
            ) : (
              // aria-hidden: the extension is decoration over the name, which
              // the remove button's label already reads out in full.
              <span className="attach-doc" aria-hidden="true">{extBadge(img.file.name)}</span>
            )}
            {img.state !== 'failed' && (
              <span className="attach-strip">
                {img.state === 'uploading'
                  ? 'uploading…'
                  : img.previewUrl === undefined
                    ? img.file.name
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

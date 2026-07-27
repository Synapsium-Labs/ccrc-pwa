// AttachButton — the composer's "+" picker: a stateless trigger backed by a
// hidden <input type="file" accept="image/*" multiple>. It only hands back
// whatever the user picked; the downscale/upload/preview pipeline that used
// to live here now lives in useStagedImages, shared with paste and
// drag-and-drop so all three doors hand the whole batch to `add()` at once.
import { useRef } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import './chat.css';

export interface AttachButtonProps {
  /** Every file the user picked, handed over in one batch — never call this
   *  once per file; the composer's `add()` must see the whole selection. */
  onPick: (files: File[]) => void;
  /** Dead session: the whole composer is read-only. */
  disabled?: boolean;
}

export function AttachButton({ onPick, disabled = false }: AttachButtonProps): ReactNode {
  const input = useRef<HTMLInputElement>(null);

  const onChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // re-picking the same file(s) must fire change again
    if (files.length > 0) onPick(files);
  };

  return (
    <>
      {/* No `capture` attribute: it forces the camera, and the main lane here
          is picking existing screenshots from the gallery — the picker still
          offers the camera on phones. `multiple` lets one pick cover several
          images up to the tray's own cap. */}
      <input
        ref={input}
        className="attach-input"
        type="file"
        accept="image/*"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={onChange}
      />
      <button
        type="button"
        className="attach-btn"
        aria-label="Attach an image"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <span aria-hidden="true">+</span>
      </button>
    </>
  );
}

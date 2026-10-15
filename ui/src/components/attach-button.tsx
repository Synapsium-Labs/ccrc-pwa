// AttachButton — the composer's "+" picker: a stateless trigger backed by a
// hidden <input type="file" multiple>. It only hands back whatever the user
// picked; the downscale/upload/preview pipeline that used to live here now
// lives in useStagedImages, shared with paste and drag-and-drop so all three
// doors hand the whole batch to `add()` at once.
import { useRef } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';
import type { ChangeEvent, ReactNode } from 'react';
import './attach-spin.css';
import './attach-button.css';

export interface AttachButtonProps {
  /** Every file the user picked, handed over in one batch — never call this
   *  once per file; the composer's `add()` must see the whole selection. */
  onPick: (files: File[]) => void;
  /** The OS picker's filter, DERIVED by the app from the list of types its
   *  server admits (the composer passes `ATTACH_ACCEPT`). A prop rather than a
   *  constant here because that list lives in shared/, which this package may
   *  not take a value from. Never write a bare `image/*` at a call site: that
   *  is what greyed every document out of the picker. Absent, the picker
   *  offers every file and the composer's own gate answers a refusal. */
  accept?: string;
  /** Dead session: the whole composer is read-only. */
  disabled?: boolean;
}

export function AttachButton({ onPick, accept, disabled = false }: AttachButtonProps): ReactNode {
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
          files up to the tray's own cap. `accept` is DERIVED by the app (see
          the prop): a bare `image/*` here is what greyed every document out
          in the OS picker while the drop and paste doors said nothing at all. */}
      <input
        ref={input}
        className="attach-input"
        type="file"
        accept={accept}
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={onChange}
      />
      <button
        type="button"
        className={cn('attach-btn', FOCUS_RING)}
        aria-label="Attach a file"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <span aria-hidden="true">+</span>
      </button>
    </>
  );
}

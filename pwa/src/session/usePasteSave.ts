// The saves behind a long paste sent as a file (desktop-polish wave 194). Ring L4, context C3: it performs the uploads
// that `pasteSend.ts` (L1) plans and holds what came of them; the composer asks it at Send and decides nothing here.
//
// At Send, every chip the draft sends that has no file for its current text is saved as a `.txt` clip in the session's
// own folder through the existing upload (`api.upload`, unchanged), byte for byte its text in UTF-8, under the neutral
// name `PASTE_UPLOAD_NAME`. A saved file is kept beside the exact text it was saved from, for the life of the draft,
// so a retry saves only what is still missing and never a saved chip again, and a changed text is saved anew.
//
// THE HOLD ALWAYS ENDS. The upload is a POST, and the API client gives a POST no deadline (`limitedFetch` bounds GETs
// only), so each save is raced against `PASTE_SAVE_DEADLINE_MS` here, not in the client. Past it the chip fails with
// that reason and Retry; the upload itself is not cancelled, so a late answer may still leave a file on the box, and a
// retry saves another (a residual the task note states). At most `PASTE_SAVES_AT_ONCE` saves run at once: the tray
// already uploads its four files at once, so the server and the agent link take four in parallel today; more chips
// wait their turn.
//
// LEAVING ENDS IT. When the composer goes away, or its session changes, while a save is in flight, the answer is
// dropped and nothing is sent; a session change ends the hold too, with no failure shown. A file already saved stays
// on the box (no route deletes a clip).
//
// SECRETS. No failure is toasted and nothing is logged: the reason shows on the chip only, in the upload's own words,
// which hold no character of the paste.
import { useEffect, useRef, useState } from 'react';
import { CLIP_MAX_BYTES, CLIP_MAX_PER_MESSAGE } from '../../../shared/api';
import { PASTE_UPLOAD_NAME } from '../../../shared/pastePointer';
import { api, apiErrorText, uploadErrorText } from '../lib/api';
import type { StagedClip } from '../../../shared/api';
import { pasteFailedText, pasteName, pasteTimeoutText } from './longPasteWords';
import type { PasteChips } from './pasteChips';
import { pasteBytes, pastesToSave, type SavedPaste, type SavedPastes } from './pasteSend';
import { tooLargeText } from './useAttachImage';

/** How long one save may take before its chip fails with Retry: two minutes, enough for the 12 MB limit over a slow
 *  phone link, and short enough that Send is never held for good. */
export const PASTE_SAVE_DEADLINE_MS = 120_000;

/** How many saves run at once: the tray's own number (`CLIP_MAX_PER_MESSAGE` files upload at once there). */
export const PASTE_SAVES_AT_ONCE = CLIP_MAX_PER_MESSAGE;

/** Why a chip's save failed, and whether saving again could change it: an upload's refusal or a deadline can, a saved
 *  file the plan refused cannot (it stands for the same text, and Retry would only meet it again). */
export interface PasteFailure {
  readonly text: string;
  readonly retry: boolean;
}

export interface PasteSave {
  /** A save is in flight: Send is held. */
  readonly saving: boolean;
  /** Why each chip's last save failed, by chip number; empty when none did. */
  readonly failures: ReadonlyMap<number, PasteFailure>;
  /** Save every chip `value` sends that has no file for its text. Resolves to the files when every one is saved, or
   *  null when any failed, another save was already running, or the composer or its session went away meanwhile. */
  save: (value: string, chips: PasteChips) => Promise<SavedPastes | null>;
  /** Mark chips failed with a reason the caller decided: the plan refused their saved file, which no retry changes. */
  fail: (reasons: ReadonlyMap<number, string>) => void;
  /** The message went: forget the files and the failures, for the next draft. */
  reset: () => void;
}

type Upload = (id: string, file: File) => Promise<StagedClip>;

export function usePasteSave(
  id: string,
  upload: Upload = (sid, file) => api.upload(sid, file),
  deadlineMs: number = PASTE_SAVE_DEADLINE_MS,
): PasteSave {
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<ReadonlyMap<number, PasteFailure>>(new Map());
  const saved = useRef(new Map<number, SavedPaste>());
  const busy = useRef(false);
  const mounted = useRef(true);
  const idNow = useRef(id);
  idNow.current = id;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Another session's files are never this one's: a session change starts the table again.
  useEffect(() => { saved.current = new Map(); }, [id]);

  /** One save, bounded by the deadline; its failure is a reason, never a throw. */
  const saveOne = async (sid: string, n: number, text: string): Promise<string | null> => {
    const bytes = pasteBytes(text);
    if (bytes > CLIP_MAX_BYTES) return tooLargeText(pasteName(n), bytes);
    const file = new File([text], PASTE_UPLOAD_NAME, { type: 'text/plain' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), deadlineMs); });
    try {
      const clip = await Promise.race([upload(sid, file), late]);
      if (clip === 'late') return pasteTimeoutText(n, Math.round(deadlineMs / 1000));
      if (idNow.current === sid) saved.current.set(n, { path: clip.path, text });
      return null;
    } catch (err) {
      return pasteFailedText(n, uploadErrorText(apiErrorText(err)));
    } finally {
      clearTimeout(timer);
    }
  };

  const save = async (value: string, chips: PasteChips): Promise<SavedPastes | null> => {
    if (busy.current) return null;
    const sid = id;
    const todo = pastesToSave(value, chips, saved.current);
    if (todo.length === 0) return new Map(saved.current);
    busy.current = true;
    setSaving(true);
    setFailures(new Map());
    const failed = new Map<number, PasteFailure>();
    const queue = [...todo];
    const worker = async (): Promise<void> => {
      for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
        const why = await saveOne(sid, n, chips.get(n)!.text);
        if (why !== null) failed.set(n, { text: why, retry: true });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PASTE_SAVES_AT_ONCE, todo.length) }, worker));
    busy.current = false;
    if (!mounted.current) return null;
    // The hold ends on every path while mounted, the session change included: the answer is dropped, nothing is sent,
    // and the composer is free again (review 4119 F3).
    setSaving(false);
    if (idNow.current !== sid) {
      setFailures(new Map());
      return null;
    }
    setFailures(failed);
    return failed.size === 0 ? new Map(saved.current) : null;
  };

  const fail = (reasons: ReadonlyMap<number, string>): void =>
    setFailures(new Map([...reasons].map(([n, text]) => [n, { text, retry: false }])));
  const reset = (): void => {
    saved.current = new Map();
    setFailures(new Map());
  };

  return { saving, failures, save, fail, reset };
}

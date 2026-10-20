// Rename an existing workspace (named workspaces S9, design 2026-10-20 §6), opened from the session's actions sheet. It
// changes the TITLE the board shows and nothing else: the slug, the branch and the id are the workspace's for life, and
// the field says so (`slug stays <slug>`). It is the create doors' own field, `WorkspaceNameField`, pre-filled with the
// current title, so a ticket id or a pasted link resolves here exactly as it does at the `+` (the same preview, the same
// Linear lookup, the server resolving again at Save).
//
// WHAT EACH CASE SENDS.
//   * A changed, accepted title: `api.workspaceTitle(id, {title})`.
//   * The field emptied, on a workspace that has a title: the confirm reads "Clear title" and sends `{clear: true}`,
//     which hands the row back to the automatic namer. A ghost "Clear title" beside it does the same while a title is
//     typed, so clearing never depends on knowing that an empty field means it.
//   * The title as it stands, a refused one, or an empty field on a workspace with no title: the confirm is DISABLED
//     and NOTHING is sent.
//
// EVERY REFUSAL STAYS IN THE SHEET, with the operator's text intact (`classifyRenameError` / `renameRefusalText`). The
// PWA does not know what `ccd caps` lists, so a box whose ccd predates the verb answers 501 and the sheet says so
// plainly; Rename is not hidden on it. Success closes both sheets: the new title arrives on the next fleet frame.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import { Button, Sheet, toast } from '@ccrc/ui';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { NAME_FIELD_CLASS, WorkspaceNameField } from './WorkspaceNameField';
import { useNamePreview } from './useNamePreview';
import { LINEAR_SETTINGS_PATH } from './workspaceNameWords';
import { RENAME_TEXT, classifyRenameError, renameRefusalText } from './workspaceRenameWords';
import './fleet.css';

export interface RenameSheetProps {
  /** The workspace being renamed; its slug is `workspace`. A main checkout is never passed (the actions sheet does not offer it). */
  session: FleetSession;
  open: boolean;
  /** Cancel, the scrim, Escape: closes this sheet only. */
  onClose: () => void;
  /** A rename landed: closes this sheet and the actions sheet under it. */
  onRenamed: () => void;
}

export function RenameSheet({ session, open, onClose, onRenamed }: RenameSheetProps): ReactNode {
  const current = session.title ?? '';
  const [value, setValue] = useState(current);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);
  // A rename answers after its sheet was closed (Cancel, scrim) or retargeted at another session: its words are for a
  // sheet that is gone, and the next opening must not inherit them. Bumped on every reset.
  const generation = useRef(0);

  // Opening, and a retarget to another session while open, start from that session's title. NOT on `session.title`
  // itself: the fleet frame can change it under the sheet, and what the operator has typed must not be overwritten.
  useEffect(() => {
    generation.current += 1;
    setValue(current);
    setRefusal(null);
    setBusy(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `current` is read at the moment of opening only, see above
  }, [open, session.id]);

  const typed = value.trim();
  const edited = typed !== current;
  // The title as it stands is not previewed: it would raise a Linear lookup on opening for a ticket-shaped title, and it
  // has nothing to preview. The field then shows `unchanged` in the preview's place.
  const slug = session.workspace ?? '';
  const preview = useNamePreview(edited ? value : '', { keepSlug: slug });
  const clearing = typed === '';
  const hasTitle = (session.title ?? null) !== null;

  const send = async (change: { title: string } | { clear: true }): Promise<void> => {
    if (busy !== null) return;
    const mine = generation.current;
    setBusy('clear' in change ? 'clear' : 'save');
    setRefusal(null);
    try {
      const answer = await api.workspaceTitle(session.id, change);
      if (mine !== generation.current) return;
      toast('clear' in change ? 'Title cleared' : `Renamed to ${answer === 'unreadable' || answer.title === null ? typed : answer.title}`);
      onRenamed();
    } catch (err) {
      const text = renameRefusalText(classifyRenameError(err));
      // Dismissed while the request was in flight: the sentence has no sheet to sit in, so it is an error toast.
      if (mine !== generation.current) { toast(text, 'error'); return; }
      setRefusal(text);
    } finally {
      if (mine === generation.current) setBusy(null);
    }
  };

  const edit = (next: string): void => {
    setValue(next);
    setRefusal(null);
  };

  const emptyHint = clearing ? (hasTitle ? RENAME_TEXT.clearHint : RENAME_TEXT.automatic) : RENAME_TEXT.unchanged;
  const refused = edited && preview.kind === 'refused';
  const canSend = clearing ? hasTitle : edited && !refused;
  const confirmLabel = clearing
    ? (busy === 'clear' ? RENAME_TEXT.clearBusy : RENAME_TEXT.clear)
    : busy === 'save' ? RENAME_TEXT.saveBusy : RENAME_TEXT.save;
  const goSettings = (): void => { onClose(); navigate(LINEAR_SETTINGS_PATH); };
  /** The confirm's own gate, which Enter in the field follows exactly. */
  const confirm = (): void => {
    if (!canSend || busy !== null) return;
    void send(clearing ? { clear: true } : { title: value });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow={session.project}
      title={RENAME_TEXT.title}
      footer={
        <div className={NAME_FIELD_CLASS.confirmRow}>
          <Button variant="primary" disabled={!canSend || busy !== null} onClick={confirm}>
            <span className={NAME_FIELD_CLASS.confirmLabel}>{confirmLabel}</span>
          </Button>
          {!clearing && hasTitle && (
            <Button variant="ghost" disabled={busy !== null} onClick={() => void send({ clear: true })}>
              {busy === 'clear' ? RENAME_TEXT.clearBusy : RENAME_TEXT.clear}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>{RENAME_TEXT.cancel}</Button>
        </div>
      }
    >
      <div className={NAME_FIELD_CLASS.sheetBody}>
        <WorkspaceNameField
          value={value}
          onChange={edit}
          preview={preview}
          project={session.project}
          emptyHint={emptyHint}
          keepSlug={slug}
          placeholder={RENAME_TEXT.placeholder}
          locked={busy !== null}
          onSubmit={confirm}
          onOpenSettings={goSettings}
        />
        {refusal !== null && <p role="alert" className={NAME_FIELD_CLASS.refusal}>{refusal}</p>}
      </div>
    </Sheet>
  );
}

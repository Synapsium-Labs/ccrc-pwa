// The withdraw sheet of one entry of a project's landing line (landing order wave 5k). L4: it draws the line as read and
// sends the operator's confirm; it decides nothing (the plan's section 4.5).
//
// THE SNAPSHOT (R3). On opening the sheet takes the entry and its direct dependants as read; a new `view` while it is
// open changes nothing it shows or sends, so a poll cannot move the pin time under the operator. After a refusal it takes
// the next read whose identity differs from the snapshot's view (the hook gives a new object only when the line changed,
// a re-pin included), or `null`, as its new snapshot, in the open, with the refusal's sentence kept above it. Confirm
// sends the snapshot's pin time, never a clock value and never a later poll's.
//
// THE RE-READ IS NOT THE SHEET'S (fix round 1, F1). The sheet may be closed while its call is in flight (Cancel, Escape
// and the backdrop stay live), and a closed sheet is unmounted. So the re-read on every answer of the door, refusal or
// not, is the line's act: `LandingLine` passes a withdrawer that re-reads once per answer, whether this sheet is still
// open or not. This sheet's arms set only its own state, which React drops once it has unmounted; a sheet opened again
// is a new instance, so an earlier answer shows nothing in it.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, QC_ACTIONS, Sheet } from '@ccrc/ui';
import type { LandingLineView, LandingWithdrawAnswer } from '../../../shared/landingLine';
import { api } from '../lib/api';
import { landingRunless, withdrawPreviewOf, type WithdrawPreview } from './landingLineView';
import {
  SHEET_AS_READ, SHEET_CANCEL, SHEET_COMES_BACK, SHEET_CONFIRM, SHEET_CONFIRM_BUSY, SHEET_DEPENDANTS, SHEET_DONE, SHEET_DONE_BUTTON,
  SHEET_FREES_NOTHING, SHEET_GITHUB, SHEET_GONE, SHEET_LEAVES, SHEET_NO_RUN, SHEET_TITLE, SHEET_TOLD, landingFailureOf, landingNoticeText,
} from './landingWords';
import './landing-line.css';

export type LandingWithdrawer = (project: string, pr: number, pinnedAt: number) => Promise<{ ok: true } & LandingWithdrawAnswer>;

export interface LandingWithdrawSheetProps {
  /** The line as now read, or `null` once the line has nothing to say (the entry has then gone). The sheet reads it only
   *  when it opens and after a refusal (R3). */
  project: string; view: LandingLineView | null; entryId: number; pr: number;
  /** `done` once the door has answered (the `Done` button, Escape or the backdrop in the done phase), else `cancel`. */
  onClose: (after: 'done' | 'cancel') => void; withdraw?: LandingWithdrawer;
}

interface Snapshot { view: LandingLineView | null; preview: WithdrawPreview | null }
const snapshotOf = (view: LandingLineView | null, entryId: number): Snapshot =>
  ({ view, preview: view === null ? null : withdrawPreviewOf(view, entryId) });
type Phase = { kind: 'confirm' } | { kind: 'done'; answer: LandingWithdrawAnswer; preview: WithdrawPreview };

export function LandingWithdrawSheet({
  project, view, entryId, pr, onClose, withdraw = api.landingWithdraw,
}: LandingWithdrawSheetProps): ReactNode {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => snapshotOf(view, entryId));
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The plan's flag (R3), set by a refusal: the next read that differs from the snapshot's view, or `null`, becomes the snapshot. */
  const [awaitingRead, setAwaitingRead] = useState(false);
  useEffect(() => {
    if (!awaitingRead || (view !== null && view === snapshot.view)) return;
    setSnapshot(snapshotOf(view, entryId));
    setAwaitingRead(false);
  }, [awaitingRead, view, snapshot.view, entryId]);

  const preview = snapshot.preview;
  const confirm = (): void => {
    if (busy || preview === null) return;   // a second tap while the first is in flight sends nothing (focus stays)
    setBusy(true);
    setError(null);
    withdraw(project, preview.entry.pr, preview.entry.pinnedAt).then(
      (answer) => {
        setBusy(false);
        setPhase({ kind: 'done', answer, preview });
      },
      (err: unknown) => {
        setBusy(false);
        setError(landingFailureOf(err, 'withdraw').text);
        setAwaitingRead(true);
      },
    );
  };
  const close = (): void => onClose(phase.kind === 'done' ? 'done' : 'cancel');

  const footer = phase.kind === 'done'
    ? <div className={QC_ACTIONS}><Button variant="primary" onClick={close}>{SHEET_DONE_BUTTON}</Button></div>
    : (
      <div className={QC_ACTIONS}>
        <Button variant="danger" disabled={preview === null} onClick={confirm}>{busy ? SHEET_CONFIRM_BUSY : SHEET_CONFIRM(pr)}</Button>
        <Button variant="ghost" onClick={close}>{SHEET_CANCEL}</Button>
      </div>
    );

  return (
    <Sheet open onClose={close} title={SHEET_TITLE(pr)} footer={footer}>
      <div className="landing-withdraw-sheet">
        {phase.kind === 'done' ? <DoneBody phase={phase} pr={pr} /> : (
          <>
            {preview === null ? <p>{SHEET_GONE(pr)}</p> : <ConfirmBody preview={preview} project={project} pr={pr} />}
            {error !== null && <p className="landing-withdraw-error" role="alert">{error}</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}

function ConfirmBody({ preview, project, pr }: { preview: WithdrawPreview; project: string; pr: number }): ReactNode {
  return (
    <>
      <p>{SHEET_LEAVES(pr, project)}</p>
      <p>{SHEET_FREES_NOTHING}</p>
      <p>{SHEET_DEPENDANTS(preview.dependants.map((d) => d.pr))}</p>
      <p>{SHEET_AS_READ}</p>
      <p>{SHEET_TOLD}</p>
      <p>{preview.runless ? SHEET_NO_RUN : SHEET_COMES_BACK}</p>
      <p>{SHEET_GITHUB}</p>
    </>
  );
}

/** The answer, from the snapshot the confirm sent and the door's own answer; it reads no later view (F1). */
function DoneBody({ phase, pr }: { phase: Extract<Phase, { kind: 'done' }>; pr: number }): ReactNode {
  const prOf = (id: number): number | null => phase.preview.view.entries.find((e) => e.id === id)?.pr ?? null;
  return (
    <>
      <p>{SHEET_DONE(pr)}</p>
      {phase.answer.notices.length > 0 && (
        <ul className="landing-withdraw-notices">
          {phase.answer.notices.map((o) => <li key={`${o.word}:${o.entryId}`}>{landingNoticeText(o, pr, prOf)}</li>)}
        </ul>
      )}
      <p>{landingRunless(phase.answer.entry) ? SHEET_NO_RUN : SHEET_COMES_BACK}</p>
    </>
  );
}

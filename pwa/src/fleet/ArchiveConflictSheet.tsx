// The archive-conflict sheet — what `409 run-open` looks like to a human.
//
// WITHOUT THIS SHEET the operator sees a toast: `apiErrorText` is stderr-first, then `API_ERROR_TEXT` (which spreads
// `ARCHIVE_REFUSAL_TEXT`, so `run-open` is a sentence now, not a bare slug), and a 409 has no stderr. The sentence
// is "A run still claims this workspace." — and a toast names no run and offers no way forward. This sheet names the
// run and keeps "Archive anyway" under the operator's own hand. Its one door today is `PrSheet`; the actions sheet's
// archive goes through `ArchiveSheet`, which shares this file's validator, `isArchiveConflictRun`.
//
// On `Sheet`, modelled line-for-line on `AbandonSheet` — the one 409 idiom in
// this codebase that dispatches on status, reads a SECOND body field so the
// sentence is a measurement rather than a guess, and KEEPS THE SHEET OPEN on
// refusal. `QuickConfirm` cannot host this: its confirm runs
// `onConfirm(); onClose();` unconditionally, so it closes on every tap, win
// or lose, and "Archive anyway" can itself be refused.
//
// WHERE `{force:true}` DELIBERATELY DOES NOT LIVE:
//   - not a checkbox: that is a pre-commitment made BEFORE the operator has
//     seen the refusal, and the refusal is the whole information;
//   - not a long-press: `SessionActionsSheet` and `SessionLine` both record
//     REMOVING exactly that gesture — "a hidden gesture is the wrong home for
//     recovery";
//   - not `QuickConfirm`, above.
// A second tap in a sheet that survived the refusal is the only shape that
// satisfies "the operator's own hands stay able to do it; they just have to
// mean it".
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ARCHIVE_REFUSALS, isArchiveRefusal } from '../../../shared/api';
import { Button, Sheet } from '@ccrc/ui';
import { ARCHIVE_REFUSAL_TEXT, ApiError, UNSUPPORTED_VERB_TEXT, api } from '../lib/api';
import './fleet.css';

/** One run named by a `409 run-open` body. DEGRADE, NEVER INVENT: if `runs`
 *  is absent the sheet says "A run is still open on this workspace" and names
 *  no id. */
export interface ArchiveConflictRun {
  id: number; program: string; wave: number; waveOf: number | null;
}

/** THERE IS NO `onOpenRun` HERE, and the omission is a decision, not an
 *  oversight (Build 8 Wave 2 review, Finding 3). This sheet shipped with an
 *  optional `onOpenRun` and an "Open the run" button gated on it — and NEITHER
 *  door passed it. `PrSheet` and `SessionActionsSheet` both mount this sheet
 *  with `sessionId`/`runs`/`onClose`/`onDone` only, so the control never
 *  rendered anywhere in the app; its only caller was its own unit test, which
 *  is coverage of something no operator can reach.
 *
 *  It was DROPPED rather than wired because neither door has run-board
 *  navigation to hand it: `SessionActionsSheet` lives on FleetScreen and
 *  `PrSheet` under SessionHeader, and neither takes a navigate/route prop —
 *  inventing one is a surface the plan never designed, decided from a review
 *  finding.
 *
 *  TO ADD IT BACK, a future door needs three things it does not have today:
 *  a way to reach `/runs` focused on ONE run id (RunsScreen has no per-run
 *  route), a rule for what happens to the sheet and to the door underneath it
 *  when navigation leaves the screen, and a caller that actually passes the
 *  prop. Until all three exist, the button would be dead weight again. */
export interface ArchiveConflictSheetProps {
  sessionId: string | null;
  runs: readonly ArchiveConflictRun[] | null;
  onClose: () => void;
  onDone?: () => void;
}

/** THE ONE VALIDATOR of a run, shared by every reader of a run-bearing body in the client: `runOpenRuns` below and
 *  `ArchiveSheet`'s `runsOf` (its `ended`, `closed`, `notClosed` and `coordinator-has-open-runs` members) both filter
 *  through it, so a fix to what counts as a readable run lands once.
 *
 *  ALL FOUR fields are measured, `waveOf` included. It used to be the one
 *  this predicate ASSERTED and did not check — and a type predicate that
 *  asserts is a lie the compiler then believes everywhere downstream: a
 *  member merely OMITTING `waveOf` passed as `undefined`, and `runPhrase`
 *  suppresses the `/total` suffix only on `=== null`, so the sheet rendered
 *  "wave 2/undefined" at the operator. `null` is admitted because it is the
 *  LEGITIMATE value (a wave whose total is not known); anything else is a
 *  body this build cannot read, and the sheet's degrade case — "A run is
 *  still open on this workspace", naming no id — is the right answer to it. */
export const isArchiveConflictRun = (v: unknown): v is ArchiveConflictRun =>
  typeof v === 'object' && v !== null
  && typeof (v as ArchiveConflictRun).id === 'number'
  && typeof (v as ArchiveConflictRun).program === 'string'
  && typeof (v as ArchiveConflictRun).wave === 'number'
  && ((v as ArchiveConflictRun).waveOf === null || typeof (v as ArchiveConflictRun).waveOf === 'number');

/** `409 { error:'run-open', runs }` -> the runs, or `null` for any other
 *  error. THE ONE READER of that body in the whole client: Task 213 wires TWO
 *  doors (`PrSheet`, `SessionActionsSheet`) into this sheet, and a reader per
 *  door is how the two sentences drift. A member of `runs` is read by
 *  `isArchiveConflictRun`, the one validator of a run that `ArchiveSheet` shares.
 *
 *  THREE answers, three different facts, and they must not collapse into two:
 *    - `null`  — not a run-open refusal at all: the caller toasts it exactly
 *                as it always did;
 *    - `[]`    — a run-open refusal whose `runs` we could not read (absent,
 *                not an array, or every member malformed). The sheet still
 *                opens and says "A run is still open on this workspace",
 *                naming no id;
 *    - `[…]`   — the runs, as measured by the server.
 *  Collapsing the middle case into `null` is the defect this whole surface
 *  exists to close — it would send a refusal the operator can act on back to
 *  a toast carrying a bare slug. */
export function runOpenRuns(err: unknown): readonly ArchiveConflictRun[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body;
  if (typeof body !== 'object' || body === null) return null;
  if ((body as { error?: unknown }).error !== ARCHIVE_REFUSALS.runOpen) return null;
  const raw = (body as { runs?: unknown }).runs;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isArchiveConflictRun);
}

/** `err` -> the sentence rendered INSIDE the sheet. Status-first dispatch,
 *  `AbandonSheet.abandonErrorText`'s own shape: every branch returns a string,
 *  because a failed forced archive has nowhere else to be said. */
function archiveErrorText(err: unknown): string {
  if (!(err instanceof ApiError)) return 'the archive was refused, for a reason this build does not recognise';
  if (err.status === 404) return 'that session is gone — the fleet will catch up';
  // Workspace lifecycle §5.2: the door's typed refusals, in the words every archive surface uses.
  const code = typeof err.body === 'object' && err.body !== null ? (err.body as { error?: unknown }).error : undefined;
  if (err.status === 409 && isArchiveRefusal(code)) return ARCHIVE_REFUSAL_TEXT[code];
  if (err.status === 501) return UNSUPPORTED_VERB_TEXT;
  if (err.status === 502) {
    const stderr = typeof err.body === 'object' && err.body !== null
      ? (err.body as { stderr?: unknown }).stderr : undefined;
    return typeof stderr === 'string' && stderr.trim().length > 0 ? stderr.trim() : 'the archive failed on the box';
  }
  return 'the archive was refused, for a reason this build does not recognise';
}

export const runPhrase = (r: ArchiveConflictRun): string =>
  `run ${r.id} — ${r.program} wave ${r.wave}${r.waveOf === null ? '' : `/${r.waveOf}`}`;

/** The claimed workspace's two sentences, ONE spelling for the two sheets that say them: this one, behind the PR
 *  sheet's door, and `ArchiveSheet`'s `run-open` case (workspace lifecycle §5.2). `null` runs degrade, never invent. */
export const claimedSentence = (named: readonly ArchiveConflictRun[] | null): string =>
  named === null
    ? 'A run is still open on this workspace'
    : named.length === 1
      ? `${runPhrase(named[0]!)} is still open on this workspace.`
      : `${named.map(runPhrase).join('; ')} are still open on this workspace.`;

export const CLAIMED_CONSEQUENCE =
  'Archiving stops the session and puts the worktree away. Nothing is deleted, but the run loses the workspace it is working in.';

export function ArchiveConflictSheet({
  sessionId, runs, onClose, onDone,
  archive = api.archive,
}: ArchiveConflictSheetProps & {
  /** Injectable for tests, `AbandonSheet`'s own idiom — the real
   *  `api.archive`'s URL and body are pinned separately in `api.test.ts`, so
   *  this injection is never the ONLY coverage of the write path. */
  archive?: typeof api.archive;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `gen`, `AbandonSheet`/`ReapSheet`'s idiom: this sheet is mounted at screen
  // level and `sessionId === null` merely renders nothing, so `busy`/`error`
  // would otherwise survive every close and every switch of target.
  const gen = useRef(0);
  useEffect(() => {
    setBusy(false);
    setError(null);
    return () => { gen.current += 1; };
  }, [sessionId]);

  if (sessionId === null) return null;
  const named = runs !== null && runs.length > 0 ? runs : null;

  const force = (): void => {
    if (busy) return;
    const mine = gen.current;
    setBusy(true);
    setError(null);
    void archive(sessionId, { force: true }).then(
      () => {
        if (gen.current !== mine) return;
        setBusy(false);
        onDone?.();
        onClose();
      },
      (err: unknown) => {
        if (gen.current !== mine) return;
        setBusy(false);
        setError(archiveErrorText(err));
      },
    );
  };

  return (
    <Sheet open onClose={onClose} title="This workspace is claimed">
      <div className="archive-conflict-sheet">
        {/* MERGE NOTE: main moved both sentences behind `claimedSentence` and
            `CLAIMED_CONSEQUENCE`, which is a single-source-of-truth win this
            branch has no argument with — the branch had only restyled the
            literals it replaced. Main's text, the branch's utilities. */}
        <p className="qc-consequence text-base leading-normal text-ink-secondary mb-5">
          {claimedSentence(named)}
        </p>
        <p className="qc-consequence text-base leading-normal text-ink-secondary mb-5">
          {CLAIMED_CONSEQUENCE}
        </p>
        <div className="qc-actions grid gap-2">
          <Button variant="primary" disabled={busy} onClick={force}>
            {busy ? 'Archiving…' : 'Archive anyway'}
          </Button>
          {/* Two buttons, not three — see the `onOpenRun` note on
              `ArchiveConflictSheetProps` for the affordance that was here and
              why it went. */}
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
        {error !== null && <p className="abandon-error">{error}</p>}
      </div>
    </Sheet>
  );
}

// The review cap's lift sheet (D-6911, #1410): the one sheet both doors open, the run board's "Waiting on you" band and
// the cap's record in Mail. It reads the ask the `cap-review-rounds` refusal composed (`GET /api/coord/review-cap/:id`,
// D-6910), shows it, and posts `{ run }` to `POST /api/coord/review-cap` only when the operator confirms in the page.
//
// On `Sheet`, not `QuickConfirm`, for `AbandonSheet`'s reason: a lift can be refused, and the refusal is said in the
// sheet, which stays open. Mounted unconditionally at screen level; `run === null` is closed and renders nothing.
//
// The lift does not need the ask: a failed read says so and still offers the lift, so an unreadable report never
// stands between the operator and the door the notice told them about. The route is idempotent, so a second tab that
// lifted first is a 200 here and the sheet closes as for its own lift. It keeps `AbandonSheet`'s busy flag and
// superseded-answer guard, but not its status and code branches: both calls' failures read `REVIEW_CAP_REFUSAL_TEXT`.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ReviewCapView, RunSummary } from '../../../shared/api';
import { Button, QC_ACTIONS, QC_CONSEQUENCE, Sheet } from '@ccrc/ui';
import { REVIEW_CAP_REFUSAL_TEXT, api, apiErrorText, refusalText } from '../lib/api';
import { findingsWords, reviewCapOf } from './reviewCapWords';
import './fleet.css';

/** A failed call, in words: the review cap's own refusals first, then the api funnel's general sentence. No status or
 *  code branches of its own (`refusal-literal-ratchet`); a 401 is the funnel's login screen, never this sheet's. */
const failureText = (err: unknown): string => refusalText(err, REVIEW_CAP_REFUSAL_TEXT) ?? apiErrorText(err);

type AskRead = { kind: 'loading' } | { kind: 'read'; view: ReviewCapView } | { kind: 'failed'; why: string };

export interface LiftCapSheetProps {
  run: RunSummary | null;
  onClose: () => void;
  /** After a lift landed. Mail passes none: its door reads the live runs frame, which carries the lift. */
  onDone?: () => void;
  /** Injectable for tests; the real calls' URL, method and body are pinned in `api.test.ts`. */
  loadAsk?: (run: number) => Promise<ReviewCapView>;
  lift?: (run: number) => Promise<unknown>;
}

export function LiftCapSheet({
  run, onClose, onDone, loadAsk = api.reviewCap, lift = api.liftReviewCap,
}: LiftCapSheetProps): ReactNode {
  const [ask, setAsk] = useState<AskRead>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `AbandonSheet`'s generation guard: every close and every switch of target bumps `gen` in the effect's cleanup, and
  // each answer acts only if the generation it was issued under is still current. So a superseded read never renders,
  // and a superseded lift never closes the sheet or reports a lift for a run no longer shown.
  const gen = useRef(0);
  const targetId = run?.id ?? null;
  useEffect(() => {
    setAsk({ kind: 'loading' });
    setBusy(false);
    setError(null);
    if (targetId !== null) {
      const mine = gen.current;
      loadAsk(targetId).then(
        (view) => { if (gen.current === mine) setAsk({ kind: 'read', view }); },
        (err: unknown) => { if (gen.current === mine) setAsk({ kind: 'failed', why: failureText(err) }); },
      );
    }
    return () => { gen.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  if (run === null) return null;

  const confirm = (): void => {
    if (busy) return;
    const mine = gen.current;
    setBusy(true);
    setError(null);
    lift(run.id).then(
      () => {
        if (gen.current !== mine) return;
        setBusy(false);
        onDone?.();
        onClose();
      },
      (err: unknown) => {
        if (gen.current !== mine) return;
        setBusy(false);
        setError(failureText(err));
      },
    );
  };

  const row = reviewCapOf(run);
  const counts = ask.kind === 'read' ? ask.view.ask : row !== null && row !== 'unmeasured' ? row : null;
  const where = `Run ${run.id} · ${run.programTitle} wave ${run.wave}`;

  return (
    <Sheet
      open
      onClose={onClose}
      title="Lift the review cap?"
      footer={
        <div className={QC_ACTIONS}>
          <Button variant="primary" disabled={busy} onClick={confirm}>
            {busy ? 'Lifting…' : 'Lift cap'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className="lift-cap-sheet">
        <p className={QC_CONSEQUENCE}>
          {counts === null
            ? `${where} reached its review cap, so a further review was refused.`
            : `${where} has had ${counts.rounds} of ${counts.cap} review rounds, so a further review was refused.`}
          {' '}Lifting the cap lets this run open more review rounds.
        </p>
        {ask.kind === 'loading' && <p className="lift-cap-note">Reading the ask…</p>}
        {ask.kind === 'failed' && (
          <p className="lift-cap-note">The ask could not be read: {ask.why} You can still lift the cap.</p>
        )}
        {ask.kind === 'read' && <AskBody view={ask.view} />}
        {error !== null && <p className="abandon-error">{error}</p>}
      </div>
    </Sheet>
  );
}

function AskBody({ view }: { view: ReviewCapView }): ReactNode {
  const last = view.ask.lastReview;
  return (
    <>
      {view.liftedAt !== null && <p className="lift-cap-note">The cap is already lifted for this run.</p>}
      <p className="lift-cap-note">
        {last.summary === null ? 'No review has reported yet.' : `Last review (run ${last.reviewRunId}): ${last.summary}`}
      </p>
      {last.report !== null && <p className="lift-cap-note lift-cap-report">Report: {last.report}</p>}
      <ul className="lift-cap-findings" aria-label="Open findings">
        {findingsWords(last.findings).map((line, i) => <li key={i}>{line}</li>)}
      </ul>
    </>
  );
}

// The abandon sheet — the run board's release valve for a wedged run (spec
// §4.3, Task 12). Two taps: the row's own `.run-abandon` control (D-B4-14,
// RunsScreen.tsx) opens this sheet, and THIS sheet's own confirm button is
// the second tap that actually sends `POST /api/runs/:id/abandon`.
//
// On `Sheet`, not `QuickConfirm` (brief, Step 3): `QuickConfirm`'s confirm
// button runs `onConfirm(); onClose();` unconditionally
// (`components/QuickConfirm.tsx:33-34`) — it closes on every tap, win or
// lose. An abandon can be REFUSED (409 bad-transition, 404, 501, 502) and
// each refusal needs its own sentence rendered IN the sheet, which stays
// open so the operator can read it and retry — the exact shape
// `QuickConfirm`'s close-on-confirm forbids.
//
// "The phone can abandon; the phone can never archive" (spec §4.3, global
// constraint): the route this sheet calls (`api.abandonRun`) takes no body
// at all, so there is structurally no field here that could carry an
// archive flag even by accident — and this sheet offers no archive control
// of any kind, anywhere, which is a negative pin (`abandon-sheet.test.tsx`).
//
// "A release destroys nothing" (spec §4.3): unlike the reap flow's audit ->
// confirmed-destroy ceremony (`ReapSheet.tsx`), a release destroys no data —
// the worktree survives, the record stays — so the two-tap confirm naming
// the run and its workspace IS the whole ceremony here, not a truncated one.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { isRunState, type RunSummary } from '../../../shared/api';
import { RUN_WORD } from './runWords';
import { Sheet } from '../components/Sheet';
import { ApiError, api } from '../lib/api';
import './fleet.css';

/** The refusal vocabulary this sheet renders its OWN sentence for. A total
 *  `Record`, per the brief's own interface — `unknown` is the designated
 *  catch-all for a refusal this build has never heard of (a `RunRefuseCode`
 *  under `refused`, or any other shape), the same "never a blank cell"
 *  discipline `runWords.ts`'s own `RUN_WORD.unknown` already uses one file
 *  over. Deliberately NOT keyed on every `RunRefuseCode` member: D-B4-1/2
 *  make `not-dispatched`, `prhistory-unreadable` and the five `verifyDone`
 *  codes structurally unreachable on THIS route (pinned server-side,
 *  `coord-abandon.test.ts`) — adding members for them here would be
 *  copy-pasting a vocabulary this route can never actually speak. */
export const ABANDON_COPY: Record<
  'unknown-run' | 'bad-transition' | 'unsupported' | 'fleet-failed' | 'unknown',
  string
> = {
  'unknown-run': 'that run is gone — the board will catch up',
  'bad-transition': 'this run already closed',
  unsupported: 'the fleet host needs the newer ccd',
  'fleet-failed': 'the release failed',
  unknown: 'the abandon was refused, for a reason this build does not recognise',
};

/** `err` -> the sentence to render inline in the sheet. Same status-first
 *  dispatch as `CoordBanner.tsx`'s own `inlinePauseError` (Task 11) — 404,
 *  409, 501, 502 each get their OWN read of `err.body`, never a single
 *  generic "request failed". Unlike that banner, every branch here returns a
 *  string (never `null`): this sheet has no ordinary-toast fallback to defer
 *  to — a failed abandon has nowhere else to be said. */
function abandonErrorText(err: unknown): string {
  if (!(err instanceof ApiError)) return ABANDON_COPY.unknown;
  if (err.status === 404) return ABANDON_COPY['unknown-run'];
  if (err.status === 409) {
    const body = err.body;
    const code = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
    if (code === 'bad-transition') {
      // `from` is the state the run was ALREADY in — the fact that makes
      // "this run already closed" a measurement rather than a guess. A
      // hardcoded "it was already done" would pass every test that only
      // ever sent `from: 'done'`; reading it back off the body is what a
      // `from: 'failed'` case actually exercises.
      const from = typeof body === 'object' && body !== null ? (body as { from?: unknown }).from : undefined;
      const word = isRunState(from) ? RUN_WORD[from] : null;
      return word === null ? ABANDON_COPY['bad-transition'] : `${ABANDON_COPY['bad-transition']} — it was already ${word}`;
    }
    // A `409 {refused: RunRefuseCode}` shape — structurally unreachable on
    // this route today (see ABANDON_COPY's own docstring), but the client
    // does not get to assume the server can never send it; `unknown` is the
    // total map's designated answer for a refusal this build has never
    // heard of, not a crash and not a blank sheet.
    return ABANDON_COPY.unknown;
  }
  if (err.status === 501) return ABANDON_COPY.unsupported;
  if (err.status === 502) {
    // ccd's own stderr, verbatim — more specific than anything this sheet
    // could say, the same priority `apiErrorText` (`lib/api.ts`) already
    // gives it for every other lifecycle route.
    const stderr = typeof err.body === 'object' && err.body !== null
      ? (err.body as { stderr?: unknown }).stderr
      : undefined;
    return typeof stderr === 'string' && stderr.trim().length > 0 ? stderr.trim() : ABANDON_COPY['fleet-failed'];
  }
  // 400 bad-request (non-integer id) is not reachable from the UI (the phone
  // always has a real run id) and anything else this route has never sent
  // falls to the same total catch-all.
  return ABANDON_COPY.unknown;
}

export interface AbandonSheetProps {
  run: RunSummary | null;
  onClose: () => void;
  onDone?: () => void;
}

export function AbandonSheet({
  run,
  onClose,
  onDone,
  abandonRun = api.abandonRun,
}: AbandonSheetProps & {
  /** Injectable for tests, same shape `CoordBanner`'s own `coordPause` prop
   *  uses — defaults to the real `api.abandonRun`, whose own URL/method are
   *  pinned separately in `api.test.ts` so this injection is never the ONLY
   *  coverage of the write path. */
  abandonRun?: (id: number) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (run === null) return null;

  const ws = run.workspace ?? run.branch ?? String(run.id);

  const confirm = (): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void abandonRun(run.id).then(
      () => {
        setBusy(false);
        onDone?.();
        onClose();
      },
      (err: unknown) => {
        setBusy(false);
        setError(abandonErrorText(err));
      },
    );
  };

  return (
    <Sheet open onClose={onClose} title="Abandon this run?">
      <div className="abandon-sheet">
        <p className="qc-consequence">
          {`Abandon run ${run.id} — ${ws}? A release destroys nothing: the worktree survives, the record stays.`}
        </p>
        <div className="qc-actions">
          <button type="button" className="btn-primary" disabled={busy} onClick={confirm}>
            {busy ? 'Abandoning…' : 'Abandon'}
          </button>
          <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
        {error !== null && <p className="abandon-error">{error}</p>}
      </div>
    </Sheet>
  );
}

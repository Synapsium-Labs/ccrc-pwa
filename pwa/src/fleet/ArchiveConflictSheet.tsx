// The archive-conflict sheet — what `409 run-open` looks like to a human.
//
// WITHOUT THIS FILE the operator sees the toast "Archiving failed —
// run-open": `apiErrorText` is stderr-first, then `API_ERROR_TEXT` (one key,
// `unsupported`), then `err.message`, which `ApiError`'s constructor sets
// from `body.error` — and a 409 has no stderr. A bare slug in a toast is the
// precise defect `API_ERROR_TEXT`'s own docstring was written to close.
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
import { Sheet } from '../components/Sheet';
import { ApiError, UNSUPPORTED_VERB_TEXT, api } from '../lib/api';
import './fleet.css';

/** One run named by a `409 run-open` body. DEGRADE, NEVER INVENT: if `runs`
 *  is absent the sheet says "A run is still open on this workspace" and names
 *  no id. */
export interface ArchiveConflictRun {
  id: number; program: string; wave: number; waveOf: number | null;
}

export interface ArchiveConflictSheetProps {
  sessionId: string | null;
  runs: readonly ArchiveConflictRun[] | null;
  onClose: () => void;
  onDone?: () => void;
  onOpenRun?: (runId: number) => void;
}

/** `409 { error:'run-open', runs }` -> the runs, or `null` for any other
 *  error. THE ONE READER of that body in the whole client: Task 213 wires TWO
 *  doors (`PrSheet`, `SessionActionsSheet`) into this sheet, and a reader per
 *  door is how the two sentences drift.
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
  if ((body as { error?: unknown }).error !== 'run-open') return null;
  const raw = (body as { runs?: unknown }).runs;
  if (!Array.isArray(raw)) return [];
  // ALL FOUR fields are measured, `waveOf` included. It used to be the one
  // this predicate ASSERTED and did not check — and a type predicate that
  // asserts is a lie the compiler then believes everywhere downstream: a
  // member merely OMITTING `waveOf` passed as `undefined`, and `runPhrase`
  // suppresses the `/total` suffix only on `=== null`, so the sheet rendered
  // "wave 2/undefined" at the operator. `null` is admitted because it is the
  // LEGITIMATE value (a wave whose total is not known); anything else is a
  // body this build cannot read, and the sheet's degrade case — "A run is
  // still open on this workspace", naming no id — is the right answer to it.
  return raw.filter((r): r is ArchiveConflictRun =>
    typeof r === 'object' && r !== null
    && typeof (r as ArchiveConflictRun).id === 'number'
    && typeof (r as ArchiveConflictRun).program === 'string'
    && typeof (r as ArchiveConflictRun).wave === 'number'
    && ((r as ArchiveConflictRun).waveOf === null
        || typeof (r as ArchiveConflictRun).waveOf === 'number'));
}

/** `err` -> the sentence rendered INSIDE the sheet. Status-first dispatch,
 *  `AbandonSheet.abandonErrorText`'s own shape: every branch returns a string,
 *  because a failed forced archive has nowhere else to be said. */
function archiveErrorText(err: unknown): string {
  if (!(err instanceof ApiError)) return 'the archive was refused, for a reason this build does not recognise';
  if (err.status === 404) return 'that session is gone — the fleet will catch up';
  if (err.status === 501) return UNSUPPORTED_VERB_TEXT;
  if (err.status === 502) {
    const stderr = typeof err.body === 'object' && err.body !== null
      ? (err.body as { stderr?: unknown }).stderr : undefined;
    return typeof stderr === 'string' && stderr.trim().length > 0 ? stderr.trim() : 'the archive failed on the box';
  }
  return 'the archive was refused, for a reason this build does not recognise';
}

const runPhrase = (r: ArchiveConflictRun): string =>
  `run ${r.id} — ${r.program} wave ${r.wave}${r.waveOf === null ? '' : `/${r.waveOf}`}`;

export function ArchiveConflictSheet({
  sessionId, runs, onClose, onDone, onOpenRun,
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
        <p className="qc-consequence">
          {named === null
            ? 'A run is still open on this workspace'
            : named.length === 1
              ? `${runPhrase(named[0]!)} is still open on this workspace.`
              : `${named.map(runPhrase).join('; ')} are still open on this workspace.`}
        </p>
        <p className="qc-consequence">
          Archiving stops the session and puts the worktree away. Nothing is deleted, but the
          run loses the workspace it is working in.
        </p>
        <div className="qc-actions">
          <button type="button" className="btn-primary" disabled={busy} onClick={force}>
            {busy ? 'Archiving…' : 'Archive anyway'}
          </button>
          {named !== null && onOpenRun !== undefined && (
            <button type="button" className="btn-ghost" disabled={busy}
                    onClick={() => onOpenRun(named[0]!.id)}>
              Open the run
            </button>
          )}
          <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
        {error !== null && <p className="abandon-error">{error}</p>}
      </div>
    </Sheet>
  );
}

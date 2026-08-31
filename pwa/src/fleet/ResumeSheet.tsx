// The resume sheet — the run board's door onto a program whose COORDINATOR
// died (the abandon sheet's opposite: that one releases a wedged run, this one
// gets the program moving again without releasing anything).
//
// Three doors, cheapest first, and the order is the argument:
//   1. Revive — `ccd ensure` on the claimant. Costs nothing, changes no
//      ledger, and is right whenever the pane merely died.
//   2. Re-kickoff — durable mail carrying the RESUME sentence
//      (`programResumeKickoff`), not the wave-1 one: an open run does not need
//      re-opening, and re-opening it is not a harmless no-op.
//   3. Reclaim — rewrites `claimedBy` across every run of the program. The
//      only one of the three that cannot be undone by waiting, which is why it
//      is REVEALED (after Revive has been tried, or by the explicit "that id
//      cannot be revived" control) rather than offered alongside the others.
//
// On `Sheet`, not `QuickConfirm`, for `AbandonSheet`'s own measured reason
// (`AbandonSheet.tsx`): `QuickConfirm` runs `onConfirm(); onClose();`
// unconditionally, and every door here can be REFUSED with a sentence the
// operator has to read before retrying.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { isReclaimRefuseCode, type RunSummary } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { ApiError, api, apiErrorText, kickoffErrorText } from '../lib/api';
import './fleet.css';

/** The reclaim refusals this sheet renders its OWN sentence for — a total
 *  `Record` with `unknown` as the designated catch-all, the "never a blank
 *  cell" discipline `ABANDON_COPY` and `RUN_WORD.unknown` already hold. Keyed
 *  on the conditions THIS route can reach (the door's own status map), not on
 *  every `RunRefuseCode`: copying a vocabulary this route can never speak is
 *  what `ABANDON_COPY`'s own docstring argues against, one file over. */
export const RECLAIM_COPY: Record<
  'unknown-run' | 'unknown-session' | 'no-claimant' | 'claimant-alive'
  | 'registry-unmeasurable' | 'not-configured' | 'bad-request' | 'unknown',
  string
> = {
  'unknown-run': 'that run is gone — the board will catch up',
  // NOT folded with `unknown-run` even though both arrive at 404: the two have
  // opposite remedies (wait for the board vs. type a different id), and the id
  // in question is one the operator just typed.
  'unknown-session': 'this box has no registry row for that id — type one it knows',
  'no-claimant': 'nobody claims this run, so there is nothing to hand over',
  'claimant-alive': 'the coordinator is not dead',
  'registry-unmeasurable': 'the registry could not be read, so this box cannot say who is alive',
  'not-configured': 'this box does not run coordination — there is no ledger to rewrite',
  'bad-request': 'that id is not one this box will accept',
  unknown: 'the hand-over was refused, for a reason this build does not recognise',
};

/** `err` -> the sentence rendered inline. Status-first, `abandonErrorText`'s
 *  own dispatch (`AbandonSheet.tsx`): each status gets its own read of
 *  `err.body`, never one generic "request failed", and EVERY branch returns a
 *  string — this sheet has no toast to defer to. */
function reclaimErrorText(err: unknown): string {
  if (!(err instanceof ApiError)) return RECLAIM_COPY.unknown;
  const body = typeof err.body === 'object' && err.body !== null
    ? (err.body as Record<string, unknown>) : {};
  if (err.status === 404) {
    return body.error === 'unknown-session' ? RECLAIM_COPY['unknown-session'] : RECLAIM_COPY['unknown-run'];
  }
  if (err.status === 409) {
    // BOTH keys, through the exported guard. The route spells `claimant-alive`
    // under `refused` (the `sendDispatchOutcome` family's shape); a coded
    // refusal under `error` is the shape its neighbours use, and a client does
    // not get to assume which one a future arm picks (D-1139).
    const code = isReclaimRefuseCode(body.refused) ? body.refused
      : isReclaimRefuseCode(body.error) ? body.error
      : null;
    if (code === 'no-claimant') return RECLAIM_COPY['no-claimant'];
    if (code === 'claimant-alive') {
      // `by` and `detail` are what make this a measurement rather than a
      // guess — `detail` is the evidence sentence L1 wrote so it would survive
      // the collapse to a code, and this is the surface it survived FOR
      // (D-1140: the word `claimant-alive` covers three inputs, and only
      // `detail` says which). Same reason `abandonErrorText` reads `from` off
      // a bad-transition body.
      const by = typeof body.by === 'string' && body.by !== '' ? body.by : null;
      const detail = typeof body.detail === 'string' && body.detail.trim() !== ''
        ? body.detail.trim() : null;
      const who = by === null ? RECLAIM_COPY['claimant-alive'] : `${by} is not dead`;
      return detail === null ? who : `${who} — ${detail}`;
    }
    return RECLAIM_COPY.unknown;
  }
  if (err.status === 502) {
    // `detail` is the only thing separating this code's two producers — an
    // unlistable registry and a tmux that did not answer (D-1139).
    const detail = typeof body.detail === 'string' && body.detail.trim() !== ''
      ? body.detail.trim() : null;
    return detail ?? RECLAIM_COPY['registry-unmeasurable'];
  }
  if (err.status === 501) return RECLAIM_COPY['not-configured'];
  if (err.status === 400) return RECLAIM_COPY['bad-request'];
  return RECLAIM_COPY.unknown;
}

export interface ResumeSheetProps {
  run: RunSummary | null;
  onClose: () => void;
  onDone?: () => void;
}

export function ResumeSheet({
  run,
  onClose,
  onDone,
  ensure = api.ensure,
  kickoff = api.kickoff,
  reclaimRun = api.reclaimRun,
}: ResumeSheetProps & {
  /** Injectable for tests, `AbandonSheet`'s own `abandonRun` shape — each
   *  defaults to the real client method, whose URL/method are pinned
   *  separately in `api.test.ts` so this injection is never the ONLY coverage
   *  of a write path. */
  ensure?: (id: string) => Promise<void>;
  kickoff?: (id: string, b: { slug: string; title: string; runId?: number; wave?: number })
    => Promise<{ queued: boolean }>;
  reclaimRun?: (id: number, claimedBy: string)
    => Promise<{ program: string; runIds: number[]; from: string; to: string }>;
}): ReactNode {
  /** WHICH door is in flight, not a bare boolean: three controls share one
   *  sheet, and "busy" has to disable all three while naming only the one the
   *  operator tapped. */
  const [busy, setBusy] = useState<'revive' | 'kickoff' | 'reclaim' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reclaimOpen, setReclaimOpen] = useState(false);
  const [to, setTo] = useState('');

  // `gen`, ReapSheet's/AbandonSheet's idiom (`AbandonSheet.tsx` carries the
  // full measurement of the two bugs it closes). This sheet is mounted
  // UNCONDITIONALLY at screen level and `run === null` renders nothing without
  // unmounting, so `busy`/`error`/`note`/`reclaimOpen`/`to` would otherwise
  // survive every close and every switch of target — and the reveal state and
  // the typed id are the two that would survive most damagingly: run 7's sheet
  // opening with the irreversible door already unlocked and run 3's operator's
  // typed id still in the box.
  const gen = useRef(0);
  const targetId = run?.id ?? null;
  useEffect(() => {
    setBusy(null); setError(null); setNote(null); setReclaimOpen(false); setTo('');
    return () => { gen.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  if (run === null) return null;

  const claimedBy = run.claimedBy;
  const revive = (): void => {
    if (busy !== null || claimedBy === null) return;
    const mine = gen.current;
    setBusy('revive'); setError(null); setNote(null);
    void ensure(claimedBy).then(
      () => {
        if (gen.current !== mine) return;   // superseded — a different run's sheet is open now
        setBusy(null);
        // Revealed on BOTH arms. A revive that returned 200 is not a
        // coordinator that came back: `ccd ensure` reports that it asked, and
        // the pane's return is a later fact this sheet cannot await. The
        // operator who watches the row stay dead needs the next door already
        // in front of them.
        setReclaimOpen(true);
        setNote(`Asked the fleet to bring ${claimedBy} back. If the row does not come alive, hand the program to another session below.`);
      },
      (err: unknown) => {
        if (gen.current !== mine) return;
        setBusy(null);
        setReclaimOpen(true);
        // `apiErrorText`, not a map of this sheet's own: `/ensure` is an
        // ordinary lifecycle route that fails as 502 `{stderr}`, and ccd's own
        // words are more specific than anything this component could say —
        // the priority that function's docstring already argues for.
        setError(apiErrorText(err));
      },
    );
  };

  const reKickoff = (): void => {
    if (busy !== null || claimedBy === null) return;
    const mine = gen.current;
    setBusy('kickoff'); setError(null); setNote(null);
    void kickoff(claimedBy, {
      slug: run.program, title: run.programTitle, runId: run.id, wave: run.wave,
    }).then(
      (res) => {
        if (gen.current !== mine) return;
        setBusy(null);
        // The two answers are DIFFERENT sentences. `queued:false` folds "this
        // program's kickoff is already waiting" with "a different program's
        // is" — the fold stays folded by decision (D-1132; no store read
        // returns a mail BODY), so the sentence says "a kickoff", never "this
        // program's kickoff". What it must not do is claim something was
        // queued when nothing was.
        setNote(res.queued
          ? `The re-kickoff is queued for ${claimedBy}. It names run ${run.id} at wave ${run.wave}, and the mail lane will not interrupt a busy session.`
          : `A kickoff is already waiting for ${claimedBy} — it has not been read yet. Nothing new was queued.`);
      },
      (err: unknown) => {
        if (gen.current !== mine) return;
        setBusy(null);
        // The composition wave 4 shipped for exactly this route
        // (`lib/api.ts`), reused rather than a fifth per-surface map: three of
        // the five codes it can answer with are owned by `uploadErrorText`,
        // which is why they are not in `API_ERROR_TEXT`.
        setError(kickoffErrorText(apiErrorText(err)));
      },
    );
  };

  const reclaim = (): void => {
    const target = to.trim();
    if (busy !== null || target === '') return;
    const mine = gen.current;
    setBusy('reclaim'); setError(null); setNote(null);
    void reclaimRun(run.id, target).then(
      () => {
        if (gen.current !== mine) return;
        setBusy(null);
        // The ONE door that closes on success: `claimedBy` has been rewritten
        // across every run of this program, so the board's cold read is now
        // the stale half and `onDone` is what refreshes it.
        onDone?.();
        onClose();
      },
      (err: unknown) => {
        if (gen.current !== mine) return;   // superseded — this refusal belongs to a run no longer shown
        setBusy(null);
        setError(reclaimErrorText(err));
      },
    );
  };

  return (
    <Sheet open onClose={onClose} title="The coordinator is gone">
      <div className="abandon-sheet">
        <p className="qc-consequence">
          {claimedBy === null
            // Unreachable from the board (the row's gate needs a claimant to
            // measure), and stated rather than collapsed into `return null`:
            // "no run" and "a run nobody claims" are two conditions, and one
            // render for both is the overloaded seam this repo bans.
            ? `Run ${run.id} names no coordinator, so there is nobody to revive and nothing to hand over.`
            : `${claimedBy} claims run ${run.id} — ${run.program}, wave ${run.wave} — and this box measured it dead. Cheapest door first: bring the pane back, tell it to pick the wave up, or hand the program to another session.`}
        </p>
        {claimedBy !== null && (
          <div className="qc-actions">
            <button type="button" className="btn-primary" disabled={busy !== null} onClick={revive}>
              {busy === 'revive' ? 'Reviving…' : `Revive ${claimedBy}`}
            </button>
            <button type="button" className="btn-ghost" disabled={busy !== null} onClick={reKickoff}>
              {busy === 'kickoff' ? 'Queueing…' : 'Re-kickoff'}
            </button>
            {reclaimOpen ? (
              <>
                {/* `.sess-hold-input` verbatim, not a new class: the same
                    object — a single-line id field inside a fleet sheet — and
                    it is already self-grounded, tap-floored and carries the
                    ::placeholder ink. The identical reuse `.run-row` already
                    makes of `.sess-unmeasured`. */}
                <input
                  type="text"
                  className="sess-hold-input"
                  aria-label={`Hand run ${run.id} to this session id`}
                  placeholder="session id"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
                <button type="button" className="btn-ghost"
                        disabled={busy !== null || to.trim() === ''} onClick={reclaim}>
                  {busy === 'reclaim' ? 'Handing over…' : 'Reclaim'}
                </button>
              </>
            ) : (
              <button type="button" className="btn-ghost" disabled={busy !== null}
                      onClick={() => setReclaimOpen(true)}>
                That id cannot be revived
              </button>
            )}
            <button type="button" className="btn-ghost" disabled={busy !== null} onClick={onClose}>
              Cancel
            </button>
          </div>
        )}
        {note !== null && <p className="qc-consequence">{note}</p>}
        {error !== null && <p className="abandon-error">{error}</p>}
      </div>
    </Sheet>
  );
}

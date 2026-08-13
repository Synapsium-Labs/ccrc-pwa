// Per-session actions, behind the line's `···`. A sheet rather than a
// long-press: discoverability beats density here.
//
// There is deliberately NO workspace delete here. `ccd ws-rm` used to sit on
// this sheet as an unconfirmed one-tap button under a comment claiming it
// "refuses an unmerged branch" — it does not; it keeps the branch and warns on
// stderr, which a tap has nowhere to show. Its only data guard is
// `git status --porcelain`, blind to a gitignored `.env`; it asks the remote
// nothing, so it cannot know the work is in main; and it carries no
// confirmation, so nothing re-proves the tree at the instant of deletion.
// Cleanup now goes archive -> audit -> confirmed reap.
//
// Swap hands off to the existing SwapSheet rather than reimplementing the
// account picker, its limit gauges and its consequence confirm.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import { QuickConfirm } from '../components/QuickConfirm';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { api, apiErrorText, HOLD_EMPTY_REASON_TEXT } from '../lib/api';
import { accountLabel } from '../lib/accounts';
import { sessionLabel } from './sessionLabel';
import { SwapSheet } from './SwapSheet';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import './fleet.css';

/** Release's consequence sentence — what re-arming the auto-archive gate
 *  actually re-enables, named BEFORE the tap that sends it (spec's naming
 *  rule for every refusal/consequence).
 *
 *  MAY, NOT WILL — fix-wave observation. ccd's own `cmd_ws_release` comment
 *  says "the very next archiveMerged sweep MAY archive a merged workspace",
 *  and the gate behind it has a second deferral the hold knows nothing about:
 *  `archiveSafety` still answers busy/attached for a session someone is
 *  watching or that is mid-turn. The PrSheet two taps away is careful to name
 *  that as its own separate reason; promising "will archive" here converted a
 *  may into a will and then claimed ccd said so. */
const RELEASE_CONSEQUENCE =
  "released — the next sweep may archive it once its PR merges (a busy or attached session defers).";

const CRITICAL = 75;

export function SessionActionsSheet({
  session,
  open,
  onClose,
  onReap,
  fleet = useFleetStore,
}: {
  session: FleetSession | null;
  open: boolean;
  onClose: () => void;
  /** The guarded replacement for the one-tap delete this sheet used to carry
   *  (see the file banner above). Required, not optional: an actions sheet
   *  that cannot reach cleanup is exactly the state the old unguarded button
   *  left behind, and optionality is how it would come back for one caller. */
  onReap: (id: string) => void;
  fleet?: FleetStore;
}): ReactNode {
  const roster = fleet((s) => s.roster);
  // Every hook runs BEFORE the null guard below: `session` goes null whenever
  // the sheet closes, and a conditional hook would throw on that render.
  const [swapOpen, setSwapOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [archBusy, setArchBusy] = useState(false);
  // Hold's reason composer — open/closed, the typed text, and a refusal the
  // empty-reason check leaves behind. `holdBusy` is separate from `archBusy`:
  // the two actions are mutually exclusive on screen (never-both, see the
  // buttons below) but nothing enforces that FOR the busy flags themselves,
  // and sharing one would freeze Hold's own disabled state on an unrelated
  // archive in flight.
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState('');
  const [holdError, setHoldError] = useState<string | null>(null);
  const [holdBusy, setHoldBusy] = useState(false);
  // Release's consequence confirm — a QuickConfirm sibling, same shape as
  // SwapSheet's `target`, open only once Release names what it does. No busy
  // flag: like SwapSheet's `move()`, the confirm tap already WAS the
  // consequence check, so nothing left waits on the request before closing.
  const [releaseConfirmOpen, setReleaseConfirmOpen] = useState(false);
  // Forget's consequence confirm — same QuickConfirm shape as Release's.
  const [forgetConfirmOpen, setForgetConfirmOpen] = useState(false);

  // A closed sheet forgets Swap (mirrors NewSessionSheet's own reset-on-close
  // effect). FleetScreen now keeps this component mounted across a close
  // (Finding 2) instead of unmounting it, so `swapOpen` no longer resets for
  // free the way it used to — left alone, the NEXT session tapped would open
  // this sheet with SwapSheet already stacked on top of it (Finding 3).
  useEffect(() => {
    if (open) return;
    setSwapOpen(false);
  }, [open]);

  // Hold's composer and Release's confirm get a WIDER reset than swapOpen's:
  // unconditional on either `open` or `session.id` changing, not merely on
  // close. This is SwapSheet's own idiom for its identical `target` state
  // (SwapSheet.tsx's comment on the class), applied one level up because
  // these two live directly on this component rather than a nested child.
  // The reason it must fire on a session SWITCH too, not just a close:
  // FleetScreen's `openActionsFor` can retarget `actionsSession` to a
  // DIFFERENT session while `actionsOpen` stays true (tap another row's ···
  // while this sheet is already open) — without this, a reason half-typed
  // for session A, or session A's still-open "released…" confirm, would be
  // sitting there when session B's sheet renders.
  useEffect(() => {
    setHoldOpen(false);
    setHoldReason('');
    setHoldError(null);
    setReleaseConfirmOpen(false);
    setForgetConfirmOpen(false);
  }, [open, session?.id]);

  if (!session) return null;

  const restart = async (): Promise<void> => {
    if (restarting) return;
    setRestarting(true);
    try {
      await api.ensure(session.id);
      onClose();
    } catch (err) {
      // apiErrorText, never err.message: the runCcd routes fail as
      // 502 { ok, stderr } with no `error` key, so err.message yields the
      // generic "request failed (502)" and ccd's refusal never reaches anyone.
      toast(`Couldn't restart — ${apiErrorText(err)}`, 'error');
    } finally {
      setRestarting(false);
    }
  };

  const archiveNow = async (): Promise<void> => {
    if (archBusy) return;
    setArchBusy(true);
    try {
      await api.archive(session.id);
      onClose();
    } catch (err) {
      toast(`Couldn't archive — ${apiErrorText(err)}`, 'error');
    } finally {
      setArchBusy(false);
    }
  };

  const restoreNow = async (): Promise<void> => {
    if (archBusy) return;
    setArchBusy(true);
    try {
      await api.restore(session.id);
      onClose();
    } catch (err) {
      toast(`Couldn't restore — ${apiErrorText(err)}`, 'error');
    } finally {
      setArchBusy(false);
    }
  };

  // Empty reason refuses CLIENT-SIDE, before `api.hold` is ever called —
  // ccd's own sentence (`HOLD_EMPTY_REASON_TEXT`), inline in the composer
  // rather than a toast, so it reads next to the box that needs fixing
  // instead of a separate surface the operator has to correlate back to it.
  // The server re-checks the identical rule (a client is not where trust
  // ends), so this is a UX shortcut, not the enforcement.
  const confirmHold = async (): Promise<void> => {
    const reason = holdReason.trim();
    if (reason === '') {
      setHoldError(HOLD_EMPTY_REASON_TEXT);
      return;
    }
    if (holdBusy) return;
    setHoldBusy(true);
    setHoldError(null);
    try {
      await api.hold(session.id, reason);
      setHoldOpen(false);
      setHoldReason('');
      onClose();
    } catch (err) {
      toast(`Couldn't hold — ${apiErrorText(err)}`, 'error');
    } finally {
      setHoldBusy(false);
    }
  };

  // Fire-and-forget, same shape as SwapSheet's `move()`: QuickConfirm's own
  // button already ran the consequence past the operator (that IS the
  // confirmation), so there is nothing left to await before closing — a
  // failure still reaches them, via the toast the request awaits inside.
  const releaseNow = (): void => {
    void (async () => {
      try {
        await api.release(session.id);
      } catch (err) {
        toast(`Couldn't release — ${apiErrorText(err)}`, 'error');
      }
    })();
    onClose();
  };

  // Same fire-and-forget shape as `releaseNow`, for the same reason: the
  // QuickConfirm tap was the consequence check. On success the sweep drops the
  // row and FleetScreen's own effect closes anything still pointing at it; a
  // refusal (held, still running, a workspace) arrives as ccd's stderr in the
  // toast — the server re-proves every gate on the box, this button decides
  // nothing.
  const forgetNow = (): void => {
    void (async () => {
      try {
        await api.forget(session.id);
      } catch (err) {
        toast(`Couldn't forget — ${apiErrorText(err)}`, 'error');
      }
    })();
    onClose();
  };

  const five = session.limits?.five ?? null;
  const seven = session.limits?.seven ?? null;
  const critical =
    session.status === 'dead' ? null
    : five !== null && five > CRITICAL ? '5h'
    : seven !== null && seven > CRITICAL ? '7d'
    : null;

  const label = sessionLabel(session);

  return (
    <>
      <Sheet open={open} onClose={onClose} title={label} eyebrow={session.project}>
        <div className="sess-sheet">
          <button type="button" className="btn-ghost" onClick={() => void restart()} disabled={restarting}>
            {restarting ? 'Restarting…' : 'Restart session'}
          </button>

          {/* §4.4: "what would revive it" is a sentence the row can print and
              a button the operator already has. The button above posts
              POST /api/sessions/:id/ensure (`restart()`, this file) — already
              keyed by id, already whitelisted, already ungated by decision —
              and §3.1 made `ensure` restore supervision, so it needs no new
              argv, no new grant and no new caps line. The note names the
              terminal spelling too, because §3.4's operator (the one who read
              the account off the board and minted a DIFFERENT id) is exactly
              who needs the one-argument form. */}
          {session.lifecycle === 'orphan' && (
            <p className="sess-sheet-note">
              {`Nothing is watching this session — no supervisor, so no auto-swap, no auto-compact and no record when it dies. Restart session revives it: the same thing ccd start ${session.id} does at a terminal.`}
            </p>
          )}

          <button type="button" className="btn-ghost" onClick={() => setSwapOpen(true)}>
            Swap account
          </button>

          {session.workspace !== null && session.archivedAt === null && (
            <button type="button" className="btn-ghost" disabled={archBusy}
                    onClick={() => void archiveNow()}>
              {archBusy ? 'Archiving…' : 'Archive workspace'}
            </button>
          )}
          {session.workspace !== null && session.archivedAt !== null && (
            <button type="button" className="btn-ghost" disabled={archBusy}
                    onClick={() => void restoreNow()}>
              {archBusy ? 'Restoring…' : 'Restore workspace'}
            </button>
          )}

          {/* Hold/Release — workspace-only and archived refuses too, the same
              two refusals `ccd ws-hold` itself states ("not a workspace —
              nothing ever auto-archives a main checkout" / "archived —
              restore first: a hold cannot protect a pane that is already
              gone"). `session.held` is the one gate for which of the two
              shows — never both, same shape as the Archive/Restore pair
              above. The opener and the reason composer are mutually
              exclusive renders (not a stacked sheet): with only ONE control
              ever on screen for this row, "tap Hold, submit empty" needs no
              disambiguation between two same-named buttons. */}
          {session.workspace !== null && session.archivedAt === null
            && session.held === null && !holdOpen && (
            <button type="button" className="btn-ghost"
                    onClick={() => { setHoldOpen(true); setHoldError(null); }}>
              Hold
            </button>
          )}
          {session.workspace !== null && session.archivedAt === null
            && session.held === null && holdOpen && (
            <div className="sess-hold-form">
              <input
                type="text"
                className="sess-hold-input"
                placeholder="program:name wave:2/4"
                aria-label="Hold reason"
                value={holdReason}
                /* The refusal clears on the FIRST keystroke, not on the next
                   Confirm: it was only ever cleared inside `confirmHold`
                   AFTER the non-empty check passed, so "empty reason — say
                   which program holds this" sat under a box with a perfectly
                   good reason typed into it until the operator submitted
                   again. An error that outlives its cause reads as a refusal
                   of what is on screen now. */
                onChange={(e) => { setHoldReason(e.target.value); setHoldError(null); }}
                autoFocus
              />
              {/* Client-side refusal, ccd's own sentence — see `confirmHold`. */}
              {holdError !== null && <p className="sess-hold-error">{holdError}</p>}
              <div className="sess-hold-actions">
                <button type="button" className="btn-primary" disabled={holdBusy}
                        onClick={() => void confirmHold()}>
                  {holdBusy ? 'Holding…' : 'Confirm'}
                </button>
                <button type="button" className="btn-ghost"
                        onClick={() => { setHoldOpen(false); setHoldReason(''); setHoldError(null); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {session.held !== null && (
            <>
              <button type="button" className="btn-ghost" onClick={() => setReleaseConfirmOpen(true)}>
                Release
              </button>
              {/* The reason is already the fleet chip's whole job (SessionLine's
                  `.sess-held`) — repeated here because the actions sheet is
                  where Release's consequence lives, and the reason belongs
                  next to the control that ends it. */}
              <p className="sess-sheet-note">Held — {session.held}</p>
            </>
          )}

          {/* The guarded replacement for the one-tap delete this sheet used to
              carry. Archived only: archive is the staging step, and the audit
              this opens refuses `not-archived` anyway — offering it earlier
              would just be a button that always refuses. */}
          {session.workspace !== null && session.archivedAt !== null && (
            <button type="button" className="btn-ghost sess-sheet-remove"
                    onClick={() => onReap(session.id)}>
              Clean up workspace…
            </button>
          )}

          {/* The end-of-life a non-workspace session never had: stop leaves
              the registry row deliberately, archive/reap are workspace-only,
              so a dead wrapper session was an immortal fleet line. Dead AND
              non-workspace, strictly: a live session's removal is a kill and
              goes through Stop first; a workspace's removal destroys git
              state and goes through the audited sheet above. ccd re-proves
              both gates (and the hold) on the box. */}
          {session.workspace === null && session.status === 'dead' && (
            <button type="button" className="btn-ghost sess-sheet-remove"
                    onClick={() => setForgetConfirmOpen(true)}>
              Forget session…
            </button>
          )}

          {session.status !== 'dead' && session.wrapper !== session.home && (
            <p className="sess-sheet-note">
              Pinned to {accountLabel(roster, session.home)}, running on{' '}
              {accountLabel(roster, session.wrapper)} — moved when its account filled up.
            </p>
          )}

          {/* The line only had room for `⚠`; this is where it gets to say what
              it means and what will happen. */}
          {critical !== null && (
            <p className="sess-sheet-note">
              {critical} limit near — this session will move to another account.
            </p>
          )}
        </div>
      </Sheet>

      <SwapSheet
        session={session}
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        fleet={fleet}
      />

      {/* Same shape as SwapSheet's own target confirm: the consequence
          sentence does the explaining, confirming fires the request and
          closes — see `releaseNow`'s comment for why nothing awaits it. */}
      <QuickConfirm
        open={releaseConfirmOpen}
        onClose={() => setReleaseConfirmOpen(false)}
        title="Release the hold?"
        consequence={RELEASE_CONSEQUENCE}
        confirmLabel="Release"
        onConfirm={releaseNow}
      />

      {/* What goes AND what is kept, named before the tap — a removal the
          sheet does not describe is not one anybody consented to. Nothing
          here is irreversible: the entry can be recreated by starting the
          session again, and the two things that exist nowhere else are
          exactly the two this verb refuses to touch. */}
      <QuickConfirm
        open={forgetConfirmOpen}
        onClose={() => setForgetConfirmOpen(false)}
        title={`Forget ${label}?`}
        consequence="Its registry entry is removed and the row leaves the fleet. The transcript and any pasted images stay on disk; nothing in git is touched. Starting the session again recreates it."
        confirmLabel="Forget"
        onConfirm={forgetNow}
      />
    </>
  );
}

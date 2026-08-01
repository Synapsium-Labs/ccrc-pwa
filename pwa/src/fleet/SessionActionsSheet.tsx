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
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { api, apiErrorText } from '../lib/api';
import { accountLabel } from '../lib/accounts';
import { SwapSheet } from './SwapSheet';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import './fleet.css';

const CRITICAL = 75;

export function SessionActionsSheet({
  session,
  open,
  onClose,
  fleet = useFleetStore,
}: {
  session: FleetSession | null;
  open: boolean;
  onClose: () => void;
  fleet?: FleetStore;
}): ReactNode {
  // Every hook runs BEFORE the null guard below: `session` goes null whenever
  // the sheet closes, and a conditional hook would throw on that render.
  const [swapOpen, setSwapOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // A closed sheet forgets Swap (mirrors NewSessionSheet's own reset-on-close
  // effect). FleetScreen now keeps this component mounted across a close
  // (Finding 2) instead of unmounting it, so `swapOpen` no longer resets for
  // free the way it used to — left alone, the NEXT session tapped would open
  // this sheet with SwapSheet already stacked on top of it (Finding 3).
  useEffect(() => {
    if (open) return;
    setSwapOpen(false);
  }, [open]);

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

  const five = session.limits?.five ?? null;
  const seven = session.limits?.seven ?? null;
  const critical =
    session.status === 'dead' ? null
    : five !== null && five > CRITICAL ? '5h'
    : seven !== null && seven > CRITICAL ? '7d'
    : null;

  const label = session.name ?? session.branch ?? session.workspace ?? session.id;

  return (
    <>
      <Sheet open={open} onClose={onClose} title={label} eyebrow={session.project}>
        <div className="sess-sheet">
          <button type="button" className="btn-ghost" onClick={() => void restart()} disabled={restarting}>
            {restarting ? 'Restarting…' : 'Restart session'}
          </button>

          <button type="button" className="btn-ghost" onClick={() => setSwapOpen(true)}>
            Swap account
          </button>

          {session.status !== 'dead' && session.wrapper !== session.home && (
            <p className="sess-sheet-note">
              Pinned to {accountLabel(session.home)}, running on{' '}
              {accountLabel(session.wrapper)} — moved when its account filled up.
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
    </>
  );
}

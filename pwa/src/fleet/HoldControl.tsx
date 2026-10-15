// Hold — the opener, the reason composer, and the one refusal that is read
// next to the box that needs fixing.
//
// WHY IT IS ITS OWN FILE. Four pieces of state, a surface-local error reader,
// a send, and two mutually exclusive renders, all about one verb, spread
// across three regions of a 593-line sheet. Nothing else in that sheet reads
// any of it.
//
// THE RESET IS THE PART THAT HAD TO TRAVEL CAREFULLY. The sheet resets this
// composer on `open` OR `session.id` changing — not merely on close — because
// `FleetScreen`'s `openActionsFor` can retarget the sheet to a DIFFERENT
// session while it stays open (tap another row's ··· while this one is up),
// and a reason half-typed for session A must not be sitting in session B's
// box. Unmounting does not cover that case: the control stays mounted across
// a retarget whenever both sessions are holdable, so the effect is kept.
//
// The classes stay `sess-hold-*`: fleet.css grounds them and this is their
// only consumer. The shape moves, the ground stays.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import { Button, TextInput, toast } from '@ccrc/ui';
import { api, ApiError, apiErrorText, HOLD_EMPTY_REASON_TEXT } from '../lib/api';
import './fleet.css';

/**
 * D-2731. The hold route is the one caller here whose refusal carries a sentence
 * the operator can ACT on: `oversize` arrives with `limit` and a `detail` saying
 * the reason is written verbatim and refused rather than shortened.
 * `apiErrorText` has no entry for `oversize` — and must not grow one, since the
 * kickoff translator already owns that slug with a different sentence — so
 * without this reader the toast read `Couldn't hold — oversize`, which narrows a
 * distinction the server took care to send. Surface-local for exactly that
 * reason: the same slug means two things at two seams.
 */
const holdErrorText = (err: unknown): string => {
  const body: unknown = err instanceof ApiError ? err.body : null;
  if (body !== null && typeof body === 'object') {
    const { error, detail } = body as { error?: unknown; detail?: unknown };
    if (error === 'oversize' && typeof detail === 'string') return detail;
  }
  return apiErrorText(err);
};

export interface HoldControlProps {
  session: FleetSession;
  /** The sheet's own open flag — half of the reset key, see the file header. */
  sheetOpen: boolean;
  /** The sheet's dismissal, run once a hold lands. */
  onHeld: () => void;
}

/** The caller decides WHETHER a hold is offered at all (workspace-only, not
 *  archived, not already held — `ccd ws-hold`'s own two refusals, quoted where
 *  that decision is made). This owns only what happens once it is. */
export function HoldControl({ session, sheetOpen, onHeld }: HoldControlProps): ReactNode {
  // `busy` is this control's alone: the sheet's other actions are mutually
  // exclusive with Hold on screen, but nothing enforces that for the busy
  // flags themselves, and a shared one would freeze Confirm's disabled state
  // on an unrelated Restore in flight.
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOpen(false);
    setReason('');
    setError(null);
  }, [sheetOpen, session.id]);

  // Empty reason refuses CLIENT-SIDE, before `api.hold` is ever called —
  // ccd's own sentence (`HOLD_EMPTY_REASON_TEXT`), inline in the composer
  // rather than a toast, so it reads next to the box that needs fixing
  // instead of a separate surface the operator has to correlate back to it.
  // The server re-checks the identical rule (a client is not where trust
  // ends), so this is a UX shortcut, not the enforcement.
  const confirm = async (): Promise<void> => {
    const typed = reason.trim();
    if (typed === '') {
      setError(HOLD_EMPTY_REASON_TEXT);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.hold(session.id, typed);
      setOpen(false);
      setReason('');
      onHeld();
    } catch (err) {
      toast(`Couldn't hold — ${holdErrorText(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  // The opener and the composer are mutually exclusive renders (not a stacked
  // sheet): with only ONE control ever on screen for this row, "tap Hold,
  // submit empty" needs no disambiguation between two same-named buttons.
  if (!open) {
    return (
      <Button variant="ghost" onClick={() => { setOpen(true); setError(null); }}>
        Hold
      </Button>
    );
  }
  return (
    <div className="sess-hold-form">
      <TextInput
        placeholder="program:name wave:2/4"
        aria-label="Hold reason"
        value={reason}
        /* The refusal clears on the FIRST keystroke, not on the next
           Confirm: it was only ever cleared inside the send AFTER the
           non-empty check passed, so "empty reason — say which program holds
           this" sat under a box with a perfectly good reason typed into it
           until the operator submitted again. An error that outlives its
           cause reads as a refusal of what is on screen now. */
        onChange={(e) => { setReason(e.target.value); setError(null); }}
        autoFocus
      />
      {/* Client-side refusal, ccd's own sentence — see `confirm` above. */}
      {error !== null && <p className="sess-hold-error">{error}</p>}
      <div className="sess-hold-actions">
        <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Holding…' : 'Confirm'}
        </Button>
        <Button variant="ghost"
                onClick={() => { setOpen(false); setReason(''); setError(null); }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

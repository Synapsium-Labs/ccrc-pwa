// "Start new sessions here" on the Accounts card (D-8195): whether new sessions may start on a lane, the roster's
// `homeAble`, which `ccrc account set --placement full|overflow` writes (spec §8.4) through `POST /api/accounts/:id/set`.
//
// NOT THE KILL SWITCH. The knob above it (`AccountKnob`) switches the whole lane on or off. This one leaves the lane on
// and only says whether new sessions are placed on it; an overflow-only lane keeps every session it runs and can still
// be picked by hand or by a pool. So it has a visible label of its own, its own row under the knob's, and its own
// accessible name ("<label>: Start new sessions here"), where the knob's is "<id>: lane on or off".
//
// ONE TAP, THEN A CONFIRM. A tap opens `QuickConfirm` with the sentence that says what changes; only Confirm sends the
// act. The switch moves only on the server's ack (the route re-reads the roster), as the knob does, and a refusal never
// moves it: the toast says why, worded from its code (`laneActRefusal`). While any act runs on the lane, or when the
// screen cannot act (`blocked`: offline, an insecure origin, a fleet without the acts), it is drawn disabled, named by
// the knob row's reason.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { QuickConfirm } from '@ccrc/ui';
import { HOME_ABLE_LABEL, homeAbleConfirm, homeAbleRow } from './accountWords';
import { LaneSwitch, type LaneActKind } from './AccountKnob';
import './fleet.css';

export interface AccountHomeAbleProps {
  id: string;
  /** The lane's label, which the confirm names. */
  label: string;
  /** Whether new sessions may start on the lane, as the roster has it (or as an ack set it). */
  on: boolean;
  /** Why the screen cannot run any lane act (`connectBlock`, or offline), or `null`. */
  blocked: string | null;
  /** The act in flight on the lane, whichever it is. */
  busy: LaneActKind | undefined;
  /** Runs the confirmed change: `true` lets new sessions start here. */
  onConfirm: (homeAble: boolean) => void;
}

export function AccountHomeAble({ id, label, on, blocked, busy, onConfirm }: AccountHomeAbleProps): ReactNode {
  const [asking, setAsking] = useState(false);
  const words = homeAbleConfirm(label, !on);
  return (
    <div className="acct-home" data-on={on ? 'true' : 'false'}>
      <LaneSwitch
        on={on}
        name={`${label}: ${HOME_ABLE_LABEL}`}
        busy={busy === 'placement'}
        describedBy={blocked !== null ? `acct-knob-reason-${id}` : undefined}
        disabled={busy !== undefined || blocked !== null}
        onClick={() => setAsking(true)}
      />
      <span className="acct-home-words">
        <span className="acct-home-label">{HOME_ABLE_LABEL}</span>
        <span className="acct-home-state">{homeAbleRow(on)}</span>
      </span>
      <QuickConfirm
        open={asking}
        onClose={() => setAsking(false)}
        title={words.title}
        consequence={words.consequence}
        confirmLabel={words.confirmLabel}
        onConfirm={() => onConfirm(!on)}
      />
    </div>
  );
}

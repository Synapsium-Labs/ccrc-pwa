// The kill switch row and Check (spec 2026-10-18 accounts-connect §10, §13.1; accounts plan Task A14, D-7732).
//
// THE KNOB MOVES ONLY ON THE SERVER'S ACK. It draws the lane's switch as the last answer has it; a press sends the
// route and the knob stays where it was, busy, until the answer lands. On a 200 the knob takes the lane the answer
// re-read (the route reads the box back, never infers), and holds it until the store's refreshed `/api/accounts`
// answer has landed; on a refusal it never moved, and the toast says why, worded from the refusal's code alone. No
// confirm sheet: the switch is reversible, and switching off keeps every running session (§10).
//
// NOT READY. A lane that is off and not ready cannot be turned on: the knob is disabled and its reason sits beneath it
// ("Not ready: the last check didn't pass. Check it first.", or "Check it once to turn it on" for a lane with no check
// recorded), with **Check · one test reply** beside it. Turning a lane OFF is never held back by readiness: it is the
// kill switch.
//
// WHEN THE SCREEN CANNOT ACT. With no `connect` (a dark gate's answer, an older server) the row is not drawn. With a
// `connect` that says the fleet cannot run the acts, or an insecure origin, the row is drawn with the knob disabled and
// the server's reason beneath it.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, toast } from '@ccrc/ui';
import type { AccountStateWord } from '../../../shared/accounts';
import type { LaneWire } from '../../../shared/api';
import { api } from '../lib/api';
import { CHECK_LABEL, STATE_LAMPS, laneActRefusal, switchRow } from './accountWords';
import './fleet.css';

/** An act in flight on a lane, and the switch an ack has set until the store's next answer lands. */
export interface LaneActs {
  /** The act in flight on each lane. */
  readonly busy: Readonly<Record<string, 'check' | 'switch'>>;
  /** The switch each ack set (true: on), held until the refreshed answer has landed. */
  readonly acked: Readonly<Record<string, boolean>>;
  check(id: string): void;
  flip(id: string, toOn: boolean): void;
}

/** The screen's lane acts. `refresh` re-reads `/api/accounts` through the store, its one reader. */
export function useLaneActs(refresh: () => Promise<void>): LaneActs {
  const [busy, setBusy] = useState<Record<string, 'check' | 'switch'>>({});
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const settle = (id: string): void => setBusy((b) => { const { [id]: _done, ...rest } = b; return rest; });
  const release = (id: string): void => setAcked((a) => { const { [id]: _done, ...rest } = a; return rest; });
  const run = (id: string, kind: 'check' | 'switch', act: () => Promise<void>): void => {
    if (busy[id] !== undefined) return;
    setBusy((b) => ({ ...b, [id]: kind }));
    void act().finally(() => settle(id));
  };
  return {
    busy, acked,
    check: (id) => run(id, 'check', async () => {
      try {
        const a = await api.accountCheck(id);
        toast(`${id} checked: ${wordOf(a.lane)}.`);
      } catch (e) {
        toast(laneActRefusal('check', id, e), 'error');
      }
      await refresh();
    }),
    flip: (id, toOn) => run(id, 'switch', async () => {
      try {
        const a = toOn ? await api.accountEnable(id) : await api.accountDisable(id);
        // The ack: the lane as the route re-read it, held until the store's refreshed answer lands.
        setAcked((x) => ({ ...x, [id]: a.lane.state.word !== 'off' }));
      } catch (e) {
        toast(laneActRefusal('switch', id, e), 'error');
      }
      await refresh();
      release(id);
    }),
  };
}

const wordOf = (lane: LaneWire): string => {
  const w = lane.state.word as AccountStateWord;
  return STATE_LAMPS[w]?.word ?? lane.state.word;
};

export interface AccountKnobProps {
  id: string;
  /** The switch as the last answer has it (or as an ack set it). */
  on: boolean;
  /** Why the knob cannot turn the lane on, or `null` when it can (always `null` for a lane that is on). */
  notReady: string | null;
  /** Why the screen cannot run any lane act (`connectBlock`), or `null`. */
  blocked: string | null;
  /** The live sessions on the lane, which keep running when it is switched off. */
  running: number;
  busy: 'check' | 'switch' | undefined;
  onFlip: () => void;
  onCheck: () => void;
}

/** The row: the switch, its sentence, Check, and the reason beneath, which wraps under the knob, never beside it. */
export function AccountKnob({ id, on, notReady, blocked, running, busy, onFlip, onCheck }: AccountKnobProps): ReactNode {
  const reason = blocked ?? notReady;
  const switchDisabled = busy !== undefined || blocked !== null || (!on && notReady !== null);
  return (
    <div className="acct-knob" data-on={on ? 'true' : 'false'}>
      <button
        type="button"
        role="switch"
        className="acct-switch"
        aria-checked={on}
        aria-label={`${id}: new sessions`}
        aria-busy={busy === 'switch' || undefined}
        aria-describedby={reason !== null ? `acct-knob-reason-${id}` : undefined}
        disabled={switchDisabled}
        onClick={onFlip}
      >
        <span className="acct-switch-track" aria-hidden="true"><span className="acct-switch-thumb" /></span>
      </button>
      <span className="acct-knob-state">{switchRow(on, running)}</span>
      {blocked === null && (
        <Button
          variant="ghost" size="fit" className="acct-check"
          disabled={busy !== undefined} aria-busy={busy === 'check' || undefined} onClick={onCheck}
        >
          {CHECK_LABEL}
        </Button>
      )}
      {reason !== null && <p className="acct-knob-reason" id={`acct-knob-reason-${id}`}>{reason}</p>}
    </div>
  );
}

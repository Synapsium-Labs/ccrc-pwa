// The Waiting on you row for a session on a usage limit that no account has room to take (D-8123, limit-swap-autofix Task
// 11). The fleet's limit watchdog found the sign and no account with measured room, so it left a record
// (`FleetSession.limitWait`) and this row is that record in the operator's words. It carries its OWN controls, per the
// ruling that an item carries its own control (one tap, then a confirm sentence):
//
//   - "Swap to…" opens the existing swap sheet narrowed to the accounts with MEASURED room (`accountsWithMeasuredRoom`,
//     the same rule ccd rescues by). The list is read off the fleet store's accounts answer, so an account appears the
//     moment a limits poll gives it room. With none, the control says "No account has room yet" and is off. The pick,
//     its confirm and the session-busy second tap are the sheet's own.
//   - "Wait until reset at HH:MM" records the choice (`api.limitWait`). The server's record then carries `waiting`, the
//     row reads "Waiting until HH:MM", and "Swap to…" stays.
//
// NOTHING HERE TOUCHES THE TERMINAL. The row moves a session by ending it and resuming it on another account (the swap
// door) or leaves it alone (the wait door): it never sends keys, because a key reaching Claude Code's rate-limit menu can
// pick "Switch to usage credits".
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, QuickConfirm, toast } from '@ccrc/ui';
import { SEVEN_DAY_CEILING_PCT } from '../../../shared/serviceability';
import { accountsWithMeasuredRoom, type LimitRoomRow } from '../../../shared/limitRoom';
import { SwapSheet } from '../fleet/SwapSheet';
import { useAccountUsage } from '../fleet/useProjectedHome';
import { accountLabel } from '../lib/accounts';
import { ApiError, api, failedTo } from '../lib/api';
import { resetClock } from '../lib/clock';
import { useFleetStore } from '../stores/fleet';
import { LIMIT_WORD, ageWords, limitPill, type LimitRow } from './ledgerWords';
import { RowMain, RowMeta } from './rowParts';

/** The swap control's words while no account has room, and the wait control's when the record states no reset. */
export const NO_ROOM_YET_WORD = 'No account has room yet';
export const WAIT_NO_CLOCK_WORD = 'Wait until the limit resets';

/** "15:00", or "15:00 · 12 Nov" when it is not today, on the page's clock and zone; `null` when the record states no reset. */
const resetWords = (reset: number | null, now: number): string | null => (reset === null ? null : resetClock(reset / 1000, new Date(now)));

export function LimitWaitRow({ limit, now }: { limit: LimitRow; now: number }): ReactNode {
  const roster = useFleetStore((s) => s.roster);
  const usage = useAccountUsage(true);
  const [picking, setPicking] = useState(false);
  const [confirmWait, setConfirmWait] = useState(false);
  const { session } = limit;

  // The accounts a rescue may name: measured room, not switched off, not measured dead; and not the one the session is
  // stopped on (the sheet leaves the current account out too, and an account at the limit has no room anyway).
  const room = useMemo(() => {
    const byWrapper: Record<string, LimitRoomRow> = {};
    for (const a of usage ?? []) byWrapper[a.wrapper] = a;
    return accountsWithMeasuredRoom(byWrapper, SEVEN_DAY_CEILING_PCT).filter((w) => w !== session.wrapper);
  }, [usage, session.wrapper]);

  const when = resetWords(limit.reset, now);
  const stoppedOn = accountLabel(roster, limit.account);

  const wait = (): void => {
    void (async () => {
      try {
        await api.limitWait(limit.sessionId);
        toast(`${limit.title} waits until ${when ?? 'the limit resets'}.`);
      } catch (err) {
        // The record closed between the frame and the tap: the session moved on its own, or its limit cleared. Not a failure.
        const gone = err instanceof ApiError && err.status === 409;
        toast(gone ? `${limit.title} has moved on its own, or its limit has cleared.` : failedTo('record the wait for', err), gone ? 'info' : 'error');
      }
    })();
  };

  return (
    <li className="wl-limit" data-testid="limit-wait-row" data-session={limit.sessionId} data-state="limit" data-needed="blocking"
        data-waiting={limit.waiting ? 'true' : 'false'}>
      <span className="wl-kind">{LIMIT_WORD}</span>
      <RowMain what={`${limit.title} is on a usage limit and no account has room`}
               why={`Stopped on ${stoppedOn}. It stays stopped until you move it to an account with room or the limit resets.`} />
      <RowMeta pills={[limitPill(limit)]} when={`since ${ageWords(limit.since, now)}`} />
      <span className="wl-limit-acts">
        <Button variant="primary" size="fit" disabled={room.length === 0} onClick={() => setPicking(true)}>
          {room.length === 0 ? NO_ROOM_YET_WORD : 'Swap to…'}
        </Button>
        {limit.waiting
          ? <span data-waiting-until="">{`Waiting until ${when ?? 'the limit resets'}`}</span>
          : <Button variant="ghost" size="fit" onClick={() => setConfirmWait(true)}>{when === null ? WAIT_NO_CLOCK_WORD : `Wait until reset at ${when}`}</Button>}
      </span>
      <SwapSheet session={session} open={picking} onClose={() => setPicking(false)} only={room} />
      <QuickConfirm
        open={confirmWait}
        onClose={() => setConfirmWait(false)}
        title="Wait until the limit resets?"
        consequence={`${limit.title} stays where it is, on ${stoppedOn}, until ${when ?? 'the limit resets'}. Nothing moves it before then; once `
          + `${stoppedOn} has room, ccrc restarts it in place. You can still swap it from here.`}
        confirmLabel="Wait"
        onConfirm={wait}
      />
    </li>
  );
}

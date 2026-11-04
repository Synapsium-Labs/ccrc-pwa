// WHAT A SHEET MAY SAY OF A LANE'S OLD CREDENTIAL, AS THE SHEET STAYS OPEN (accounts plan Task A38, D-7872 (10); D-7992). The
// answer is `oldCredentialOf`'s, and this hook is how a sheet reads it. It reads when a sentence is written, from the lane
// and the telemetry row the screen holds then, so a lane signed out elsewhere while the sheet is open gets the words its
// new facts allow, whichever render started the attempt. It never moves to `kept`: a credential arriving while the sheet
// is open proves nothing the sheet needs (it may be the new one), and once the sheet has said the old one is not known
// to be there, it stays that way until it closes.
//
// THE NEW CREDENTIAL ENDS THE READING. Once one goes in, the lane's facts are about it and no longer about the old one
// (the box clears the check when it swaps, and the fresh check measures the new credential), so `freeze` keeps what the
// sheet knew of the old credential for the rest of its ending.
//
// A SIGN-OUT THE LANE DOES NOT SHOW YET. The lane the screen holds is from before it until a read lands, and a read can
// fail, which is likely just after an answer went missing, so `readLaneAfterSignOut` marks the lane in the store first.
// Until the store has read it again, no sheet says the lane keeps what it showed.
//
// A SIGN-OUT THE BOX ANSWERED. `removed` is known here before any read (`signedOutHere`). `absent` is not: it proves
// nothing where a sign-in lives in the keychain, so `readTheLane` hands the sentence back to the lane, whose read says.
import { useRef } from 'react';
import { ACCOUNT_OP_KILL_GRACE_MS, ACCOUNT_SUB_TIMEOUT_MS, type AccountUsage, type LaneWire } from '../../../shared/api';
import type { OldCredential } from '../fleet/accountWords';
import { useFleetStore } from '../stores/fleet';
import { oldCredentialOf } from './connectFlow';

/** A sign-out with no answer may still be running on the box, and a read before it ends shows the lane as it was. This is
 *  as long as the verb can run. */
const SIGN_OUT_UNANSWERED_MS = ACCOUNT_SUB_TIMEOUT_MS.credential + ACCOUNT_OP_KILL_GRACE_MS;

/** A sign-out that may have changed lane `id` (`answered`: the box said what it did; otherwise it may still be doing it):
 *  the lane is marked until the store has read it again, and read now. Whether or not the sheet is still open. */
export function readLaneAfterSignOut(id: string, answered: boolean, refresh: () => Promise<'ok' | 'error'>): void {
  useFleetStore.getState().markLaneUnread(id, answered ? 0 : SIGN_OUT_UNANSWERED_MS);
  void refresh();
}

export interface OldCredentialReading {
  /** What a sentence written now may say. */
  readonly now: () => OldCredential;
  /** This sheet's own sign-out removed the sign-in: it knows before the lane is read again. */
  readonly signedOutHere: () => void;
  /** This sheet's own sign-out found nothing to remove: what it knew, frozen or not, gives way to the lane. */
  readonly readTheLane: () => void;
  /** The new credential went in: what the sheet knows of the old one stays as it is now. */
  readonly freeze: () => void;
}

export function useOldCredential(
  id: string, lane: LaneWire | undefined, usage: Pick<AccountUsage, 'authDead'> | null | undefined,
): OldCredentialReading {
  const facts = useRef({ lane, usage });
  facts.current = { lane, usage };
  const reading = (): OldCredential =>
    oldCredentialOf(facts.current.lane, facts.current.usage, useFleetStore.getState().lanesUnread[id] !== undefined);
  const held = useRef<OldCredential | null>(null);
  held.current ??= reading();
  const frozen = useRef(false);

  const now = (): OldCredential => {
    const read = reading();
    if (held.current !== 'signed-out' && read !== 'kept' && !frozen.current) held.current = read;
    return held.current!;
  };
  return {
    now,
    signedOutHere: () => { held.current = 'signed-out'; },
    readTheLane: () => { held.current = reading(); frozen.current = false; },
    freeze: () => { now(); frozen.current = true; },
  };
}

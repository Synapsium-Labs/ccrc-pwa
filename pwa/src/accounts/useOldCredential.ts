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
import { useRef } from 'react';
import type { AccountUsage, LaneWire } from '../../../shared/api';
import type { OldCredential } from '../fleet/accountWords';
import { oldCredentialOf } from './connectFlow';

export interface OldCredentialReading {
  /** What a sentence written now may say. */
  readonly now: () => OldCredential;
  /** This sheet's own sign-out has the box's answer: it knows before the lane is read again. */
  readonly signedOutHere: () => void;
  /** The new credential went in: what the sheet knows of the old one stays as it is now. */
  readonly freeze: () => void;
}

export function useOldCredential(
  lane: LaneWire | undefined, usage: Pick<AccountUsage, 'authDead'> | null | undefined,
): OldCredentialReading {
  const facts = useRef({ lane, usage });
  facts.current = { lane, usage };
  const held = useRef<OldCredential | null>(null);
  held.current ??= oldCredentialOf(lane, usage);
  const frozen = useRef(false);

  const now = (): OldCredential => {
    const read = oldCredentialOf(facts.current.lane, facts.current.usage);
    if (held.current !== 'signed-out' && read !== 'kept' && !frozen.current) held.current = read;
    return held.current!;
  };
  return {
    now,
    signedOutHere: () => { held.current = 'signed-out'; },
    freeze: () => { now(); frozen.current = true; },
  };
}

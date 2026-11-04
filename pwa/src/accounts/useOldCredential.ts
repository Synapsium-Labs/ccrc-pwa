// WHAT A SHEET MAY SAY OF A LANE'S OLD CREDENTIAL, AS THE SHEET STAYS OPEN (accounts plan Task A38, D-7872 (10)). The
// answer is `oldCredentialOf`'s, and this hook is how a sheet reads it. It reads when a sentence is written, from the lane
// and the telemetry row the screen holds then, so a lane signed out elsewhere while the sheet is open gets the words its
// new facts allow, whichever render started the attempt. It moves only away from `kept`: a passing check arriving while
// the sheet is open proves nothing the sheet needs (it may be the new credential's), and once the sheet has said it cannot
// be sure, it stays that way until it closes.
//
// THE NEW CREDENTIAL ENDS THE READING. Once one goes in, the lane's facts are about it and no longer about the old one
// (the box clears the check when it swaps, and the fresh check measures the new credential), so `freeze` keeps what the
// sheet knew of the old credential for the rest of its ending.
import { useRef, useState } from 'react';
import type { AccountUsage, LaneWire } from '../../../shared/api';
import type { OldCredential } from '../fleet/accountWords';
import { oldCredentialOf } from './connectFlow';
import { forgetSignOut, signOutOf } from './signOuts';

export interface OldCredentialReading {
  /** What a sentence written now may say. */
  readonly now: () => OldCredential;
  /** This sheet's own sign-out has the box's answer: the one thing that makes the sheet certain. */
  readonly signedOutHere: () => void;
  /** The new credential went in: what the sheet knows of the old one stays as it is now. */
  readonly freeze: () => void;
}

export function useOldCredential(
  id: string, lane: LaneWire | undefined, usage: Pick<AccountUsage, 'authDead'> | null | undefined,
): OldCredentialReading {
  const facts = useRef({ lane, usage });
  facts.current = { lane, usage };
  /** The answer on mount. A passing check newer than a sign-out this app ran retires that sign-out's record. */
  const [opened] = useState<OldCredential>(() => {
    const record = signOutOf(id);
    const said = oldCredentialOf(lane, usage, record);
    if (record !== undefined && said === 'kept') forgetSignOut(id);
    return said;
  });
  const held = useRef<OldCredential>(opened);
  const frozen = useRef(false);

  const now = (): OldCredential => {
    if (held.current === 'kept' && !frozen.current) held.current = oldCredentialOf(facts.current.lane, facts.current.usage, signOutOf(id));
    return held.current;
  };
  return {
    now,
    signedOutHere: () => { held.current = oldCredentialOf(facts.current.lane, facts.current.usage, signOutOf(id), true); },
    freeze: () => { now(); frozen.current = true; },
  };
}

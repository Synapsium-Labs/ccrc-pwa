import { laneNotReadyReason, stateWordFor } from '../../../shared/accounts.js';
import { ACCOUNT_CAPS, type AccountOriginClass, type AccountsConnect, type LaneWire, type RosterWire } from '../../../shared/api.js';
import type { AccountLimits, LaneStatesRead } from '../limits.js';
import type { SecretMasker } from './mask.js';

/**
 * `GET /api/accounts`'s `lanes` (spec §3.4, §13.1; D-5517; accounts plan Task A12): one `LaneWire` per rostered lane,
 * whatever its file says. The state word is `stateWordFor`'s, from the telemetry row (`readLimits`) and the lane state
 * (`readLaneStates`); every other field is the lane-state file's, already held to its grammar, and the whole map is
 * masked before it is answered (D-5755 (11): any fleet-user process can write the file). It reads each lane's kind off
 * the answer's own `RosterWire` rows, so `rosterKindOf` stays the accounts handler's one derivation. Built only for a
 * reader with the session verdict; the route decides that.
 */
export function lanesWire(
  roster: readonly Pick<RosterWire, 'id' | 'provider' | 'kind'>[],
  limits: Readonly<Record<string, AccountLimits>>,
  read: LaneStatesRead,
  masker: Pick<SecretMasker, 'maskDeep'>,
  now: number,
): Record<string, LaneWire> {
  const out: Record<string, LaneWire> = {};
  for (const entry of roster) {
    const l = limits[entry.id];
    const lane = read.lanes[entry.id] ?? { kind: 'absent' };
    const st = lane.kind === 'read' ? lane.state : null;
    const notReady = laneNotReadyReason(lane);
    out[entry.id] = {
      state: stateWordFor({
        disabled: (l?.disabled ?? false) || read.disabled.has(entry.id),
        authDead: l?.authDead ?? false,
        five: l?.five ?? null, seven: l?.seven ?? null,
        fiveResetAt: l?.fiveResetAt ?? null, sevenResetAt: l?.sevenResetAt ?? null,
        ...(entry.provider !== undefined ? { provider: entry.provider } : {}),
        ...(entry.kind !== undefined ? { kind: entry.kind } : {}),
        lane, now,
      }),
      ...(st?.check !== undefined ? { check: st.check } : {}),
      ...(st?.identity !== undefined ? { identity: st.identity } : {}),
      ...(st?.identitySource !== undefined ? { identitySource: st.identitySource } : {}),
      ...(st?.keyHint !== undefined ? { keyHint: st.keyHint } : {}),
      ...(st?.validatedAt !== undefined ? { validatedAt: st.validatedAt } : {}),
      ...(st?.credit !== undefined ? { credit: st.credit } : {}),
      ...(st?.mintedAt !== undefined ? { mintedAt: st.mintedAt } : {}),
      ready: notReady === null,
      ...(notReady !== null ? { notReadyReason: notReady } : {}),
    };
  }
  return masker.maskDeep(out) as Record<string, LaneWire>;
}

/** `GET /api/accounts`'s `connect` (spec §12.6, §13.1; D-5511): whether the fleet advertises the account subs
 *  (`account-v2` in its measured caps; no evidence is `unsupported`), the gate (only a session reader is ever sent
 *  this, so it is `armed`), `cfg.origin`'s class, and this session's step-up freshness, absent when there is none. */
export function accountsConnect(o: {
  ccdVerbs: readonly string[] | null; origin: AccountOriginClass; stepUpFreshUntil: number | null;
}): AccountsConnect {
  const accountOps = o.ccdVerbs !== null && o.ccdVerbs.includes(ACCOUNT_CAPS[0]) ? 'available' : 'unsupported';
  return {
    accountOps, gate: 'armed', origin: o.origin,
    ...(o.stepUpFreshUntil !== null ? { stepUpFreshUntil: o.stepUpFreshUntil } : {}),
  };
}

// The swap route's turn guard (D-5240, working-state spec §5.9, "The server and the PWA"). Pure: the route measures
// (`turnVerdictFor`, before the queue and again inside it) and runs ccd; these two functions only decide.
import { SWAP_REFUSALS, type SwapRefusal } from '../../shared/api.js';
import type { TurnVerdict } from './coord/archiveDoor.js';

/**
 * What the swap route answers a measured turn verdict with — archive's consent rule. Without consent a turn MEASURED
 * in progress is `session-busy`, which the operator may consent to lose (`interrupt`); a turn nobody could read is
 * `status-unknown` WHATEVER the consent, because consent covers a measured turn only (ccd's `cmd_swap` refuses an
 * unreadable status whatever its flags, for the same reason). `null` proceeds.
 */
export function swapTurnRefusal(verdict: TurnVerdict, interrupt: boolean): SwapRefusal | null {
  if (verdict === 'unmeasured') return SWAP_REFUSALS.statusUnknown;
  if (verdict === 'busy' && !interrupt) return SWAP_REFUSALS.sessionBusy;
  return null;
}

/**
 * ccd's own refusal of a swap, as the route's word for it — or `null` for every other failure, which keeps the generic
 * 502. `cmd_swap`'s manual gate dies `ccd: session-busy: …` or `ccd: status-unknown: …` (`die`'s `ccd: ` prefix, then
 * the code, then a colon), so a turn that began between the route's in-queue read and ccd's act still reaches the
 * operator as `session-busy`, with its "swap anyway". Read off the FIRST stderr line's PREFIX only: a stderr that
 * quotes the phrase mid-line, or on a later line, is some other failure.
 */
export function ccdSwapRefusal(stderr: string): SwapRefusal | null {
  const first = stderr.split('\n', 1)[0] ?? '';
  for (const code of Object.values(SWAP_REFUSALS)) {
    if (first.startsWith(`ccd: ${code}:`)) return code;
  }
  return null;
}

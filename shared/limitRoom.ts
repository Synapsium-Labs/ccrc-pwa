// D-8123 (limit-swap-autofix Task 10): does an account have MEASURED room? ONE definition, here in L0 (imports nothing),
// the TypeScript twin of ccd's `_limit_score` taken under `SWAP_CEILING` and of the refusal `_avail` makes at the ceiling.
// The limit watchdog moves a limit-blocked session only to an account with measured room, and when no account has any it
// raises the Waiting on you item whose "Swap to…" lists the accounts that gain room as limits frames arrive; the page asks
// this function for the same answer ccd gives, instead of keeping a third spelling of the rule that would drift.
// `server/test/limit-room-parity.test.ts` runs one table of file layouts through this function and through ccd.
//
// WHAT "MEASURED" MEANS (the rank rule `server/src/limits.ts` `measured()` and ccd's `_limit_score` share): every window the
// plan applies has a reading that has not rolled over. A score is a MAXIMUM, so one known half bounds the truth only from
// below; a half nobody has read, or one whose window ended (its 0 is inferred from a timestamp, never observed), makes the
// row unknown, and unknown is never room. A plan with no 5h window (`fiveWindowMinutes === 0`) applies the weekly window
// alone. Room is a measured score UNDER the ceiling: AT the ceiling every turn is paid overage.

/** The fields of an account's limits row the rule reads: `AccountLimits` (the server's) and `AccountUsage` (the wire's) both
 *  carry them. `disabled` and `authDead` are optional so a bare figure row can be asked too. */
export interface LimitRoomRow {
  readonly five: number | null;
  readonly seven: number | null;
  readonly fiveRolledOver: boolean;
  readonly sevenRolledOver: boolean;
  readonly fiveWindowMinutes?: number | null;
  readonly disabled?: boolean;
  readonly authDead?: boolean;
}

/** The measured pressure (the larger applicable window), or null when the row is unknown. */
function pressureOf(row: LimitRoomRow): number | null {
  if (row.fiveWindowMinutes === 0) {
    return row.seven === null || row.sevenRolledOver ? null : row.seven;
  }
  if (row.five === null || row.seven === null || row.fiveRolledOver || row.sevenRolledOver) return null;
  return Math.max(row.five, row.seven);
}

/** Whether the row measures every window the plan applies and sits under `ceiling`. An absent row is unmeasured. Reads the
 *  figures only: whether the account is switched off is `accountsWithMeasuredRoom`'s question, not this rule's. */
export function hasMeasuredRoom(row: LimitRoomRow | null | undefined, ceiling: number): boolean {
  if (row === null || row === undefined) return false;
  const pressure = pressureOf(row);
  return pressure !== null && pressure < ceiling;
}

/** The accounts a rescue or an operator's "Swap to…" may name: measured room, and not switched off (`disabled`) or
 *  measured dead (`authDead`), which ccd's `_account_ok` would refuse anyway. Roster order is the map's key order. */
export function accountsWithMeasuredRoom(
  limits: Readonly<Record<string, LimitRoomRow>> | null | undefined,
  ceiling: number,
): string[] {
  if (limits === null || limits === undefined) return [];
  return Object.keys(limits).filter((w) => {
    const row = limits[w]!;
    return row.disabled !== true && row.authDead !== true && hasMeasuredRoom(row, ceiling);
  });
}

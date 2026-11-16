// The 17-lane fixture every lanes-strip suite shares (desktop polish S5b, D-6530): the jsdom cases (accounts-strip,
// refined-phone, instrument-shell, app, strip-fold) and the browser leg (refined-phone, lanes-row) read ONE set of
// lanes, so the freest four, the hidden thirteen and the fold's words are asserted against the same data everywhere.
// No DOM and no vitest import: the browser leg's files import it too. `nowSec` is passed in, so each caller keeps its
// own clock and the countdowns stay ahead of it.
//
// 17 lanes: one rolled over, one signed out, one never read, one with a long label, a few with a window but no
// reset, one at its 5h limit, the rest reading both windows with a reset ahead. `counted` is, per shown window,
// whether a countdown must print.
import type { AccountUsage, RosterWire } from '../../shared/api';

/** One lane of the fixture and what its card must show. */
export interface LaneCase {
  /** The lane as `GET /api/accounts` reports it. */
  acct: AccountUsage;
  label: string;
  /** The windows its card prints, in order. */
  windows: string[];
  /** Per printed window, whether a countdown must print. */
  counted: boolean[];
}

/** The fixture's lanes and roster, with every reset worked out from `nowSec` (epoch seconds). */
export function seventeenLanes(nowSec: number): { cases: LaneCase[]; accounts: AccountUsage[]; roster: RosterWire[] } {
  const cases: LaneCase[] = Array.from({ length: 17 }, (_, i) => {
    const acct: AccountUsage = {
      wrapper: `w${i}`, five: 20 + i * 4, seven: 10 + i * 3, ts: nowSec - 60, fiveResetAt: nowSec + 7200,
      sevenResetAt: nowSec + 3 * 86400, fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
    };
    let label = `lane-${String.fromCharCode(97 + i)}`;
    let counted = [true, true];
    if (i === 0) { Object.assign(acct, { five: 0, fiveRolledOver: true, fiveResetAt: nowSec - 60 }); counted = [false, true]; }
    if (i === 1) acct.authDead = true;
    if (i === 2) { Object.assign(acct, { five: null, seven: null, fiveResetAt: null, sevenResetAt: null }); counted = []; }
    if (i === 3) label = 'lane-with-a-very-long-name-q';
    if (i === 4) { Object.assign(acct, { seven: null, fiveResetAt: null, sevenResetAt: null }); counted = [false]; }
    if (i === 5) { Object.assign(acct, { five: null, fiveResetAt: null, sevenResetAt: null }); counted = [false]; }
    // The one lane at its 5h limit, so the fold's words have a rate-limited lane to count.
    if (i === 16) acct.five = 100;
    const windows = [acct.five !== null ? '5h' : null, acct.seven !== null ? '7d' : null].filter((w): w is string => w !== null);
    return { acct, label, windows, counted };
  });
  return {
    cases,
    accounts: cases.map((c) => c.acct),
    roster: cases.map((c, i) => ({ id: `w${i}`, label: c.label, hue: 'cyan', homeAble: true, hidden: false, pool: null })),
  };
}

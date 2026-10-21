// D-5866 (plan docs/superpowers/plans/2026-10-20-consolidation-w1b-schedule-listing-redactor.md, Task C1k, Step 2;
// ARCH-71 (#806); spec K12's `ccdCan`). ONE question for "can this box's ccd do this": `ccdCan(state, row)` over the
// `CCD_CAN` table, keyed by `CCD_ARGV` row name. A row carries the `ccd caps` token that answers it and its
// no-evidence default, or `'none'` for a verb that is ungated by decision. The row is a NAME, never an argv: rows
// share first argv words across different tokens (`route` and `routeApply`), and a lane asks before any argv exists.
import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_POOLS_CAP, ACTOR_FLAGS_CAP, CCD_ARGV, CCD_CAN, CHILD_ARGV_CAP, COLLECT_CAP, EXPIRE_CAP,
  HIBERNATE_HOLD_OK_CAP, POOLS_CAP, ROUTE_APPLY_CAP, ROUTE_ARGV_CAP, ROUTE_CAP, SWAP_BUSY_CAP, ccdCan,
} from '../src/ccdargv.js';
import type { FleetState } from '../src/fleetstate.js';

const stateOf = (v: readonly string[] | null): FleetState =>
  ({ connected: true, downSince: null, ccdVerbs: v === null ? null : [...v], rosterFp: null, build: null });
const ROWS = Object.keys(CCD_ARGV) as (keyof typeof CCD_ARGV)[];

describe('ccdCan(state, row) answers by the row\'s own token and default (D-5866)', () => {
  it('no evidence (no list, no state) gives the row\'s default', () => {
    for (const s of [stateOf(null), undefined]) {
      expect(ccdCan(s, 'wsExpire'), 'a refusing row').toBe(false);
      expect(ccdCan(s, 'wsCollect'), 'a refusing row').toBe(false);
      expect(ccdCan(s, 'wsArchive'), 'a permitting row').toBe(true);
      expect(ccdCan(s, 'wsCollectAudit'), 'a permitting row').toBe(true);
    }
    for (const row of ROWS) {
      const r = CCD_CAN[row];
      expect(ccdCan(stateOf(null), row), row).toBe(r === 'none' || r.default === 'permit');
    }
  });

  it('a refuse row with the token absent is false, and true with it', () => {
    expect(ccdCan(stateOf(['ws-expire', 'caps']), 'wsExpire'), 'the bare verb is not the token').toBe(false);
    expect(ccdCan(stateOf([EXPIRE_CAP]), 'wsExpire')).toBe(true);
    expect(ccdCan(stateOf([]), 'wsCollect')).toBe(false);
    expect(ccdCan(stateOf([COLLECT_CAP]), 'wsCollect')).toBe(true);
  });

  it('a permit row with the list present and the verb absent is false', () => {
    expect(ccdCan(stateOf(['caps']), 'wsArchive')).toBe(false);
    expect(ccdCan(stateOf([]), 'prStateSession')).toBe(false);
    expect(ccdCan(stateOf(['ws-archive']), 'wsArchive')).toBe(true);
  });

  it('a \'none\' row is true over every state', () => {
    const none = ROWS.filter((r) => CCD_CAN[r] === 'none');
    expect(none, 'the stop rows are ungated by decision').toEqual(expect.arrayContaining(['stopId', 'stopPair']));
    for (const row of none) {
      for (const s of [undefined, stateOf(null), stateOf([]), stateOf(['caps'])]) expect(ccdCan(s, row), row).toBe(true);
    }
  });

  it('a flag token is not a row, and no row is answered by a flag', () => {
    const FLAGS = [ACTOR_FLAGS_CAP, POOLS_CAP, ROUTE_ARGV_CAP, CHILD_ARGV_CAP, SWAP_BUSY_CAP, 'stop-surface',
      HIBERNATE_HOLD_OK_CAP, ACCOUNT_POOLS_CAP];
    const tokens = ROWS.map((r) => CCD_CAN[r]).flatMap((r) => (r === 'none' ? [] : [r.token]));
    expect(tokens.filter((t) => FLAGS.includes(t))).toEqual([]);
    expect(Object.keys(CCD_CAN).filter((k) => FLAGS.includes(k))).toEqual([]);
  });

  it('two rows that share a first argv word answer by their own tokens (route and routeApply)', () => {
    expect(CCD_ARGV.route('s', 'effort', 'high')[0]).toBe(CCD_ARGV.routeApply('s', 'effort', 'high')[0]);
    expect(ccdCan(stateOf([ROUTE_CAP]), 'route')).toBe(true);
    expect(ccdCan(stateOf([ROUTE_CAP]), 'routeApply')).toBe(false);
    expect(ccdCan(stateOf([ROUTE_APPLY_CAP]), 'routeApply')).toBe(true);
    expect(ccdCan(stateOf([ROUTE_APPLY_CAP]), 'route')).toBe(false);
    expect(ccdCan(stateOf(['route']), 'routeApply'), 'route apply needs the route-apply token').toBe(false);
  });
});

// THE SESSION FACTS, version and cost (D-5104; the audit's F6, data half).
//
// Every `FleetSession` carries `version` (Claude Code's own, from its session
// file) and `usage`, whose `cost` is the statusline's `cost.total_cost_usd`
// and whose `stale` is the server's freshness verdict. Nothing in `pwa/src`
// read either before `sessionFacts`. These cases pin the one rule the model
// exists for: a value nobody measured is `—`, never `$0.00` and never an empty
// word, and a measured zero is a value.
//
// MEASURED (plan Task 16, Step 3; each mutant applied alone to
// `sessionFacts.ts` and run against this file alone; baseline 5 passed):
//
//   | mutant                                       | red                                         |
//   |----------------------------------------------|---------------------------------------------|
//   | `cost ?? 0`                                  | a missing usage key…; stale is carried      |
//   | `s.usage.cost` without the optional chain    | a missing usage key… and a null version… —  |
//   |                                              | both throw `Cannot read properties of …`    |
//   | `stale` dropped (`stale: false`)             | stale is carried                            |
//   | `0` treated as unmeasured (`&& cost !== 0`,  | a measured zero is $0.00                    |
//   | and the truthy `cost ?` form)                |                                             |
//   | the empty-version arm deleted                | a null version is unmeasured…               |
//   | `-0` not normalised                          | a measured zero is $0.00                    |
//   | the `<$0.01` arm deleted                     | cost reads as US dollars…                   |
import { describe, expect, it } from 'vitest';
import type { FleetSession, SessionUsage } from '../../shared/api';
import { sessionFacts } from '../src/session/sessionFacts';
import { fleetSession } from './fleetFixture';

const usage = (over: Partial<SessionUsage> = {}): SessionUsage => ({
  ts: 1_700_000_000, model: null, class: null, effort: null, ctxPct: null,
  cost: null, stale: false, ...over,
});

const withCost = (cost: number | null, stale = false): FleetSession =>
  fleetSession({ usage: usage({ cost, stale }) });

/** A row from a server older than the `usage` field. A `fleet` frame is CAST,
 *  never revived, so on such a row the key is simply absent: `undefined` at
 *  runtime, which the declared `SessionUsage | null` does not admit. */
const olderServerRow = (): FleetSession => {
  const row: Record<string, unknown> = { ...fleetSession({ version: '2.1.0' }) };
  delete row['usage'];
  return row as unknown as FleetSession;
};

describe('sessionFacts (D-5104, F6): version and cost as words, never a fabricated value', () => {
  it('a null version is unmeasured, never an empty word', () => {
    expect(sessionFacts(fleetSession({ version: null })).version).toEqual({ word: '—', measured: false });
    // The server passes any string through from the session file
    // (`livestate.ts`), so an empty one can arrive. It is no word either.
    expect(sessionFacts(fleetSession({ version: '' })).version).toEqual({ word: '—', measured: false });
    // A string is shown as it is.
    expect(sessionFacts(fleetSession({ version: '2.1.0' })).version).toEqual({ word: '2.1.0', measured: true });
  });

  it('a missing usage key (an older server) is unmeasured, not $0.00', () => {
    const row = olderServerRow();
    expect('usage' in row, 'the fixture really omits the key').toBe(false);
    expect(sessionFacts(row).cost).toEqual({ word: '—', measured: false, stale: false });
    // No sidecar reading (`null`), and a reading that carries no cost, are the
    // same fact to this model: nobody measured a spend.
    expect(sessionFacts(fleetSession({ usage: null })).cost).toEqual({ word: '—', measured: false, stale: false });
    expect(sessionFacts(withCost(null)).cost).toEqual({ word: '—', measured: false, stale: false });
    // The version beside it is still read: one missing fact is not two.
    expect(sessionFacts(row).version).toEqual({ word: '2.1.0', measured: true });
  });

  it('cost reads as US dollars at two decimals, with <$0.01 below a cent', () => {
    expect(sessionFacts(withCost(1.5)).cost).toEqual({ word: '$1.50', measured: true, stale: false });
    expect(sessionFacts(withCost(0.42)).cost.word).toBe('$0.42');
    expect(sessionFacts(withCost(3)).cost.word).toBe('$3.00');
    expect(sessionFacts(withCost(0.01)).cost.word).toBe('$0.01');
    expect(sessionFacts(withCost(1234.5)).cost.word).toBe('$1,234.50');
    // Above zero and below a cent: spent, but less than two decimals can say.
    expect(sessionFacts(withCost(0.0042)).cost).toEqual({ word: '<$0.01', measured: true, stale: false });
    expect(sessionFacts(withCost(0.0099)).cost.word).toBe('<$0.01');
  });

  it('a measured zero is $0.00, measured', () => {
    expect(sessionFacts(withCost(0)).cost).toEqual({ word: '$0.00', measured: true, stale: false });
    // `JSON.parse` keeps a negative zero, and it is the same measurement.
    expect(sessionFacts(withCost(-0)).cost).toEqual({ word: '$0.00', measured: true, stale: false });
  });

  it('stale is carried', () => {
    expect(sessionFacts(withCost(2, true)).cost).toEqual({ word: '$2.00', measured: true, stale: true });
    expect(sessionFacts(withCost(2, false)).cost).toEqual({ word: '$2.00', measured: true, stale: false });
    // A stale reading that carries no cost is still a stale reading.
    expect(sessionFacts(withCost(null, true)).cost).toEqual({ word: '—', measured: false, stale: true });
  });
});

// THE SESSION FACTS: what Claude Code build a session runs, and what it has
// spent (D-5104; the audit's F6, data half).
//
// WHAT WAS UNREAD. Every `FleetSession` carries `version` (Claude Code's own,
// from its session file) and `usage`, whose `cost` is the statusline's
// `cost.total_cost_usd` (`ccd/statusline-command.sh`, the usage sidecar) and
// whose `stale` is the server's freshness verdict against `USAGE_FRESH_S`.
// Nothing in `pwa/src` read either. This model is the one reader, so the UI
// half has nothing left to decide: it renders `word`, and styles on
// `measured` and `stale`.
//
// NO UI YET, deliberately. The readouts belong in `SessionHeader.tsx`, which
// #402 holds, and then in the second wave's inspectors. A later plan places
// them, citing D-5104. Until then this file is pure and imports one type.
//
// THE RULE IT EXISTS FOR: a number is a measurement. A value nobody measured
// reads `—`, never `$0.00` and never an empty word, and a measured zero is a
// value (`$0.00`), never `—`. The two must not collapse, because "this session
// has spent nothing" and "nobody knows what it has spent" are different facts.
import type { FleetSession } from '../../../shared/api';

/** The word for a fact nobody measured: the same dash the meters and the
 *  archive sizes use. */
export const UNMEASURED = '—';

/** Above zero and below a cent: spent, but less than two decimals can say. */
export const BELOW_A_CENT = '<$0.01';

export interface VersionFact {
  readonly word: string;
  readonly measured: boolean;
}

export interface CostFact {
  readonly word: string;
  readonly measured: boolean;
  /** The reading's age verdict, carried from `usage.stale` whenever there is
   *  a reading, with or without a cost in it. With no reading at all there is
   *  nothing to be stale, so it is `false`, and `measured: false` is the fact
   *  a reader acts on first. */
  readonly stale: boolean;
}

export interface SessionFacts {
  readonly version: VersionFact;
  readonly cost: CostFact;
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/** US dollars at two decimals. `-0` (which `JSON.parse` keeps) is the same
 *  measurement as `0`, and is normalised so it never reads `-$0.00`. */
const costWord = (cost: number): string =>
  (cost > 0 && cost < 0.01 ? BELOW_A_CENT : usd.format(cost === 0 ? 0 : cost));

/** Pure. One session row in, its two facts out as words.
 *
 *  `usage` is declared `SessionUsage | null`, but it can be MISSING at runtime
 *  too: an older server omits the field, and a `fleet` frame is cast, never
 *  revived. So every read of it goes through `?.`. A missing `usage`, a
 *  `null` one, and a reading whose `cost` is `null` are all unmeasured.
 *
 *  `version` is any string the session file carried (`livestate.ts` passes it
 *  through), so an empty one is unmeasured too, never an empty word. */
export function sessionFacts(s: FleetSession): SessionFacts {
  const version = s.version;
  const cost = s.usage?.cost;
  return {
    version: typeof version === 'string' && version !== ''
      ? { word: version, measured: true }
      : { word: UNMEASURED, measured: false },
    cost: {
      ...(typeof cost === 'number'
        ? { word: costWord(cost), measured: true }
        : { word: UNMEASURED, measured: false }),
      stale: s.usage?.stale === true,
    },
  };
}

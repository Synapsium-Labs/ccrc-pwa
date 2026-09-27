// Routing spec 2026-09-14 §5.4 — the serviceability clause: may THIS lane run a
// session of THAT class right now? ONE definition, here in L0 (imports nothing
// but a sibling `shared/` value, like `roster.ts`), mirrored in bash by ccd's
// `_serviceable` and driven over one fixture table in both languages
// (`server/test/fixtures/serviceability.ts`), the way `poolrule.ts` / `_pool_ok`
// are — because two implementations of one rule drift, and a placement forecast
// the PWA shows must not disagree with the placement ccd makes.
//
// THREE ANSWERS, NEVER TWO, plus two edges: `servable` and `unservable` are
// MEASUREMENTS; `unmeasured` is the honest absence of one (no reading, no row,
// a null estimate, a pass older than SHARE_FRESH_S) and never degrades anything
// (§5.4: "ccd does not degrade on a fabricated fact"); `skipped` is `class:
// default` — the lane's own settings decide and the clause does not apply.
import { CLASSES, type ModelClass } from './models.js';

/** The Fable share ceiling, in percent of the account's PRICED weekly usage —
 *  the sweep's `fableShare.estimate` (a proxy, labelled as one wherever it is
 *  shown: spec §2, §5.4). 40 until the operator sets it from measured share.
 *  `ccd/ccd`'s `FABLE_SHARE_CEILING_PCT` is the bash twin, pinned equal by
 *  `ccd-serviceable.test.ts`. Placement refuses AT the ceiling, so a lane never
 *  reaches the point where the next Fable turn bills credits. */
export const FABLE_SHARE_CEILING_PCT = 40;

/** A sweep pass older than this measures nothing for placement: two 4-hourly
 *  passes. Bash twin `SHARE_FRESH_S`, pinned equal. */
export const SHARE_FRESH_S = 28_800;

/** The seven-day figure the swap predicate already refuses at — ccd's
 *  `SWAP_CEILING` (98), which `ccd-serviceable.test.ts` harvests and pins this
 *  equal to. Opus, Sonnet and Haiku serviceability is that same test on that
 *  same figure (§5.4: "Opus and Sonnet serviceability use the single
 *  seven_day figure"); it is spelled here so both languages agree on it. */
export const SEVEN_DAY_CEILING_PCT = 98;

/** One account's Fable share as the sweep last measured it. `estimatePct` is
 *  `floor(estimate * 100 + 0.5)` — NOT `Math.round`: the bash twin rounds in
 *  Python, whose `round` is banker's, and a twin that disagrees at .5 is a
 *  parity defect waiting for the one account that sits exactly there. */
export interface ShareReading { estimatePct: number | null; finishedAtS: number }

/** What the clause needs to know about a lane — read by the caller (server:
 *  `readLimits` + `readSharesMeasured`; ccd: `_limit_field` + `_share_pct`),
 *  never by this function, so it stays pure. `seven` is the lane's MEASURED
 *  seven-day percentage: `null` when nothing measured it OR its window rolled
 *  over (`AccountLimits.sevenRolledOver`, `_limit_field`'s retraction). */
export interface LaneFacts {
  anthropic: boolean;
  seven: number | null;
  share: ShareReading | null;
}

export type Serviceability =
  | { kind: 'skipped' }
  | { kind: 'servable'; figurePct: number }
  | { kind: 'unservable'; why: 'ceiling'; figurePct: number; ceilingPct: number }
  | { kind: 'unservable'; why: 'backend' }
  | { kind: 'unmeasured'; why: 'no-figure' | 'stale' };

/** One rung DOWN the ladder (§3 "the class ladder"): the predecessor of `cls`
 *  in `CLASSES` (ascending order), or `null` for the ladder's bottom rung.
 *  DERIVED from `CLASSES`, never respelled — `single-definition.test.ts`
 *  admits a file to the four class names only when it walks them, and this
 *  function is the walk, not a fifth hand-typed copy of the sequence. ccd's
 *  `_class_below` walks `ROUTE_CLASSES` (descending) for the same answer;
 *  `ccd-serviceable.test.ts` pins the two ladders equal. */
export function classBelow(cls: ModelClass): ModelClass | null {
  const i = CLASSES.indexOf(cls);
  return i > 0 ? CLASSES[i - 1]! : null;
}

export function serviceability(cls: ModelClass | 'default', lane: LaneFacts, nowS: number): Serviceability {
  if (cls === 'default') return { kind: 'skipped' };
  if (cls === 'fable') {
    // A backend that is not Anthropic has no Fable to serve. That is a fact of
    // the roster (`telemetry !== 'anthropic'`, the predicate `generate.mjs`
    // projects into CCRC_ANTHROPIC_BACKEND), so it is a measurement, decided
    // BEFORE any figure: a gpt lane's share estimate is 0 — "no Fable usage" —
    // and reading that as servable would place a Fable session where Fable
    // does not exist.
    if (!lane.anthropic) return { kind: 'unservable', why: 'backend' };
    if (lane.share === null || lane.share.estimatePct === null) return { kind: 'unmeasured', why: 'no-figure' };
    if (nowS - lane.share.finishedAtS > SHARE_FRESH_S) return { kind: 'unmeasured', why: 'stale' };
    return lane.share.estimatePct >= FABLE_SHARE_CEILING_PCT
      ? { kind: 'unservable', why: 'ceiling', figurePct: lane.share.estimatePct, ceilingPct: FABLE_SHARE_CEILING_PCT }
      : { kind: 'servable', figurePct: lane.share.estimatePct };
  }
  if (lane.seven === null) return { kind: 'unmeasured', why: 'no-figure' };
  return lane.seven >= SEVEN_DAY_CEILING_PCT
    ? { kind: 'unservable', why: 'ceiling', figurePct: lane.seven, ceilingPct: SEVEN_DAY_CEILING_PCT }
    : { kind: 'servable', figurePct: lane.seven };
}

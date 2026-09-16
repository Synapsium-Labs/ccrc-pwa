// Routing spec 2026-09-14 §3 "Escalation", "Demotion" — the two pure ladders
// every routing decision walks. `EFFORT_LADDER` is a NEW L0 vocabulary (no
// `shared/` file exported an effort-level list before this one); ccd's own
// `ROUTE_EFFORT_STOPS="low medium high xhigh max"` (`ccd/ccd`) is its bash
// MIRROR, pinned by the parity test in `server/test/routing-ladder.test.ts`
// — never hand-edited to a different list on either side. `CLASSES`
// (`shared/models.ts`) is already ladder order and is not re-derived here —
// every class value below is read off that array by index, never hand-typed
// as a fourth name, so this file deliberately never spells the top class's
// own name (the one `single-definition.test.ts`'s "the model files" describe
// scans for, alongside the other three, to catch a hand-copied
// enumeration — this file is not one).
//
// L0: this file imports nothing but its two `shared/` siblings — no
// `node:*`, no `fs`, no clock, no reply — because the PWA bundles it
// directly, the way `shared/poolrule.ts` and `shared/serviceability.ts` do.
import { CLASSES, type ModelClass } from './models.js';
import type { FailureKind } from './api.js';

/** The five effort rungs a routing decision walks, in slider order (D-2808's
 *  own comment on `ROUTE_EFFORT_STOPS`). `auto` and `ultracode` are
 *  deliberately excluded from the ladder itself: `ultracode` is `xhigh` +
 *  workflows with no slider row of its own, and `auto` is the absence of a
 *  typed value — neither is a RUNG the ladder moves between, though both are
 *  legal `RungCurrent.effort` values a caller may report. */
export const EFFORT_LADDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortRung = (typeof EFFORT_LADDER)[number];

/** §3: a subagent's class ladder ends at Opus — Fable is never assigned to a
 *  subagent, however an escalation would otherwise resolve. */
export const SUBAGENT_CLASS_CEILING: ModelClass = 'opus';

/** The rung a session is reported to be on right now. `effort` widens past
 *  `EffortRung` to the two values a live session can report that are not
 *  rungs themselves — the ladder functions below give each its own answer. */
export interface RungCurrent {
  readonly class: ModelClass;
  readonly effort: EffortRung | 'auto' | 'ultracode';
}

/** A previously-applied demotion the caller has not yet reversed. `from`/`to`
 *  are the values IN THE DEMOTION'S OWN DIRECTION (the rung it moved off of,
 *  the rung it landed on) — a reversal walks them back the other way. */
export interface Demotion {
  readonly field: 'class' | 'effort';
  readonly from: string;
  readonly to: string;
}

export type RungTarget =
  | { kind: 'move'; mode: 'escalate' | 'reverse-demotion'; field: 'class' | 'effort'; from: string; to: string; why: string }
  | { kind: 'ceiling'; why: string }        // nothing above (the top class at max effort; opus for a subagent at xhigh with max forbidden by the rule)
  | { kind: 'no-effort-rungs'; why: string }; // haiku takes no effort: a shallow failure on haiku is a class rung, handled inside escalate — this arm is for `ultracode`

const classIndex = (cls: ModelClass): number => CLASSES.indexOf(cls);

/** `auto` counts as `high` for the arithmetic (the model's own default).
 *  `ultracode` has no slider row of its own — §3's comment on `EFFORT_LADDER`
 *  places it at the `xhigh` tier ("xhigh + workflows") — but `escalate()`
 *  never reaches this mapping for `ultracode`: it answers `no-effort-rungs`
 *  before doing any arithmetic, so only `demote()` ever exercises this leg. */
const effortIndex = (e: EffortRung | 'auto' | 'ultracode'): number => {
  if (e === 'auto') return EFFORT_LADDER.indexOf('high');
  if (e === 'ultracode') return EFFORT_LADDER.indexOf('xhigh');
  return EFFORT_LADDER.indexOf(e);
};

/** The class-rung move shared by `kind: 'ceiling'` and the `unclear`
 *  class-aware case on sonnet — same mechanics (one class up, effort reset to
 *  high, a subagent stops at Opus, the top class has nothing above it),
 *  different reason for having been triggered, which `reason` supplies
 *  verbatim. */
const classEscalation = (current: RungCurrent, scope: 'main' | 'subagent', reason: string): RungTarget => {
  const next = CLASSES[classIndex(current.class) + 1];
  if (next === undefined) {
    return { kind: 'ceiling', why: `${current.class} is the top of the class ladder — nothing above it` };
  }
  if (scope === 'subagent' && current.class === SUBAGENT_CLASS_CEILING) {
    return { kind: 'ceiling', why: 'a subagent ladder ends at opus — nothing past it is ever assigned to a subagent' };
  }
  return {
    kind: 'move', mode: 'escalate', field: 'class', from: current.class, to: next,
    why: `${reason} — escalating to ${next}, effort reset to high`,
  };
};

/** §3 "Escalation": shallow → effort +1 within the class; ceiling → class +1 (effort reset to 'high'); unclear → effort-first, class-aware:
 *  on sonnet, when the next effort rung would be xhigh or max, the class rung to opus instead (2.5× per token ≈ xhigh, < max). `max` only from
 *  `xhigh` and only when priorSameKind ≥ 1 (a second failed check of the same kind). Any failed check first reverses `lastDemotion` if it is
 *  not yet reversed (mode 'reverse-demotion'); the ladder applies on the NEXT failure. haiku: an effort rung is a class rung to sonnet·high.
 *  `effort: 'auto'` counts as 'high' for the arithmetic (the model's default); 'ultracode' answers no-effort-rungs (its next rung is a class rung the caller decides). */
export function escalate(
  kind: FailureKind,
  current: RungCurrent,
  scope: 'main' | 'subagent',
  priorSameKind: number,
  lastDemotion: Demotion | null,
): RungTarget {
  if (lastDemotion !== null) {
    return {
      kind: 'move', mode: 'reverse-demotion', field: lastDemotion.field,
      from: lastDemotion.to, to: lastDemotion.from,
      why: `reversing the unreversed demotion (${lastDemotion.field} ${lastDemotion.from}->${lastDemotion.to}) before the ladder applies to this failure`,
    };
  }

  if (kind === 'ceiling') {
    return classEscalation(current, scope, `class ceiling reached on ${current.class}`);
  }

  // shallow and unclear both start from an effort rung — haiku (no effort
  // ladder at all) and ultracode (no rung above it) opt out before any
  // arithmetic runs.
  if (current.class === 'haiku') {
    return {
      kind: 'move', mode: 'escalate', field: 'class', from: 'haiku', to: 'sonnet',
      why: 'haiku takes no effort; an effort rung on haiku is a class rung to sonnet at high',
    };
  }
  if (current.effort === 'ultracode') {
    return { kind: 'no-effort-rungs', why: 'ultracode has no effort rungs; its next rung is a class rung the caller decides' };
  }

  const next = EFFORT_LADDER[effortIndex(current.effort) + 1];

  // unclear, class-aware: sonnet never sits in the xhigh/max zone — it jumps
  // class instead, at the same point a plain effort-first ladder would have
  // reached that zone.
  if (kind === 'unclear' && current.class === 'sonnet' && (next === 'xhigh' || next === 'max')) {
    return classEscalation(current, scope, "sonnet's next effort rung would cost like xhigh or more");
  }

  if (next === undefined) {
    return { kind: 'ceiling', why: `${current.effort} is the top effort rung; a ${kind} failure has no further effort rung` };
  }
  if (next === 'max') {
    if (scope === 'subagent') return { kind: 'ceiling', why: 'max effort is forbidden for a subagent' };
    if (priorSameKind < 1) {
      return { kind: 'ceiling', why: `max needs a second failed check of the same kind (${kind}); this is the first` };
    }
  }
  return {
    kind: 'move', mode: 'escalate', field: 'effort', from: current.effort, to: next,
    why: `${kind} failure; escalating effort from ${current.effort} to ${next}`,
  };
}

/** §3 "Demotion": one rung down on the named field; never below low / haiku (the mechanical floor); a class rung down resets effort to 'high'.
 *  `RungTarget.mode` has two literals — `'escalate'` (a fresh move) and
 *  `'reverse-demotion'` (undoing a STORED demotion, `escalate()`'s own arm
 *  above) — and a demotion is neither an escalation nor a reversal of one, so
 *  a successful demote() reports `mode: 'escalate'`: the generic "this is a
 *  freshly computed move, not a restore of something remembered" tag, which
 *  is what both of demote()'s own moves are. */
export function demote(current: RungCurrent, field: 'class' | 'effort'): RungTarget | { kind: 'floor'; why: string } {
  if (field === 'effort') {
    const idx = effortIndex(current.effort);
    if (idx <= 0) return { kind: 'floor', why: 'low is the mechanical floor for effort' };
    const prev = EFFORT_LADDER[idx - 1]!;
    return {
      kind: 'move', mode: 'escalate', field: 'effort', from: current.effort, to: prev,
      why: `demoting effort from ${current.effort} to ${prev}`,
    };
  }
  const idx = classIndex(current.class);
  if (idx <= 0) return { kind: 'floor', why: 'haiku is the mechanical floor for class' };
  const prev = CLASSES[idx - 1]!;
  return {
    kind: 'move', mode: 'escalate', field: 'class', from: current.class, to: prev,
    why: `demoting class from ${current.class} to ${prev} and resetting effort to high`,
  };
}

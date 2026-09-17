// One truth table for the routing ladders (routing spec 2026-09-14 §3
// "Escalation"/"Demotion"), driven against `shared/routing-ladder.ts`'s
// `escalate()` and `demote()`. Every row asserts the WHOLE `RungTarget` (or
// `{ kind: 'floor' }`) object, not just its `kind` — the `why` text is part
// of the contract because Task 2's door composes it verbatim into the
// argv `--reason` and the run event.
//
// `escalate()` and `demote()` have different signatures (escalate takes
// `kind`/`scope`/`priorSameKind`/`lastDemotion`; demote takes only `field`),
// so this table overloads the `kind` column as the row's OPERATION
// discriminant: the three `FailureKind` values run `escalate()`, and the two
// `'demote-class'`/`'demote-effort'` sentinels run `demote()` with that field
// — `scope`, `prior` and `lastDemotion` are meaningless for a demote row and
// left at their defaults.
import type { ModelClass } from '../../../shared/models.js';
import type { FailureKind } from '../../../shared/api.js';
import type { Demotion, RungCurrent, RungTarget } from '../../../shared/routing-ladder.js';

export interface RoutingLadderCase {
  name: string;
  kind: FailureKind | 'demote-class' | 'demote-effort';
  current: RungCurrent;
  scope?: 'main' | 'subagent';
  prior?: number;
  lastDemotion?: Demotion | null;
  want: RungTarget | { kind: 'floor'; why: string };
}

const cur = (cls: ModelClass, effort: RungCurrent['effort']): RungCurrent => ({ class: cls, effort });

export const ROUTING_LADDER_CASES: readonly RoutingLadderCase[] = [
  {
    name: 'shallow: opus·high escalates effort to xhigh',
    kind: 'shallow', current: cur('opus', 'high'), scope: 'main', prior: 0, lastDemotion: null,
    want: { kind: 'move', mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh',
      why: 'shallow failure; escalating effort from high to xhigh' },
  },
  {
    name: 'shallow: opus·xhigh with no prior same-kind failure ceilings — max needs a second failure',
    kind: 'shallow', current: cur('opus', 'xhigh'), scope: 'main', prior: 0, lastDemotion: null,
    want: { kind: 'ceiling', why: 'max needs a second failed check of the same kind (shallow); this is the first' },
  },
  {
    name: 'shallow: opus·xhigh with one prior same-kind failure escalates to max',
    kind: 'shallow', current: cur('opus', 'xhigh'), scope: 'main', prior: 1, lastDemotion: null,
    want: { kind: 'move', mode: 'escalate', field: 'effort', from: 'xhigh', to: 'max',
      why: 'shallow failure; escalating effort from xhigh to max' },
  },
  {
    name: 'shallow: opus·xhigh on a subagent ceilings — max is forbidden for a subagent, prior notwithstanding',
    kind: 'shallow', current: cur('opus', 'xhigh'), scope: 'subagent', prior: 5, lastDemotion: null,
    want: { kind: 'ceiling', why: 'max effort is forbidden for a subagent' },
  },
  {
    name: 'ceiling: sonnet·high on main escalates class to opus, effort reset noted in why',
    kind: 'ceiling', current: cur('sonnet', 'high'), scope: 'main', prior: 0, lastDemotion: null,
    want: { kind: 'move', mode: 'escalate', field: 'class', from: 'sonnet', to: 'opus',
      why: 'class ceiling reached on sonnet — escalating to opus, effort reset to high' },
  },
  {
    name: 'ceiling: opus·high on a subagent ceilings — the ladder ends at opus',
    kind: 'ceiling', current: cur('opus', 'high'), scope: 'subagent', prior: 0, lastDemotion: null,
    want: { kind: 'ceiling', why: 'a subagent ladder ends at opus — nothing past it is ever assigned to a subagent' },
  },
  {
    name: 'ceiling: fable ceilings regardless of scope',
    kind: 'ceiling', current: cur('fable', 'high'), scope: 'main', prior: 0, lastDemotion: null,
    want: { kind: 'ceiling', why: 'fable is the top of the class ladder — nothing above it' },
  },
  {
    name: 'unclear: opus·high escalates effort to xhigh — opus is not the class-aware case',
    kind: 'unclear', current: cur('opus', 'high'), scope: 'main', prior: 0, lastDemotion: null,
    want: { kind: 'move', mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh',
      why: 'unclear failure; escalating effort from high to xhigh' },
  },
  {
    name: 'unclear: sonnet·high escalates class to opus — the class-aware rule',
    kind: 'unclear', current: cur('sonnet', 'high'), scope: 'main', prior: 0, lastDemotion: null,
    want: { kind: 'move', mode: 'escalate', field: 'class', from: 'sonnet', to: 'opus',
      why: "sonnet's next effort rung would cost like xhigh or more — escalating to opus, effort reset to high" },
  },
  {
    name: 'unclear: sonnet·medium escalates effort to high — below the class-aware threshold',
    kind: 'unclear', current: cur('sonnet', 'medium'), scope: 'main', prior: 0, lastDemotion: null,
    want: { kind: 'move', mode: 'escalate', field: 'effort', from: 'medium', to: 'high',
      why: 'unclear failure; escalating effort from medium to high' },
  },
  {
    name: 'shallow: haiku takes no effort — an effort rung is a class rung to sonnet',
    kind: 'shallow', current: cur('haiku', 'high'), scope: 'main', prior: 0, lastDemotion: null,
    want: { kind: 'move', mode: 'escalate', field: 'class', from: 'haiku', to: 'sonnet',
      why: 'haiku takes no effort; an effort rung on haiku is a class rung to sonnet at high' },
  },
  {
    name: "shallow: opus·auto escalates effort to xhigh — auto counts as high for the arithmetic",
    kind: 'shallow', current: cur('opus', 'auto'), scope: 'main', prior: 0, lastDemotion: null,
    want: { kind: 'move', mode: 'escalate', field: 'effort', from: 'auto', to: 'xhigh',
      why: 'shallow failure; escalating effort from auto to xhigh' },
  },
  {
    name: 'shallow: opus·ultracode answers no-effort-rungs',
    kind: 'shallow', current: cur('opus', 'ultracode'), scope: 'main', prior: 0, lastDemotion: null,
    want: { kind: 'no-effort-rungs', why: 'ultracode has no effort rungs; its next rung is a class rung the caller decides' },
  },
  {
    name: 'an unreversed lastDemotion is reversed first, regardless of kind (ceiling here)',
    kind: 'ceiling', current: cur('opus', 'medium'), scope: 'main', prior: 0,
    lastDemotion: { field: 'effort', from: 'high', to: 'medium' },
    want: { kind: 'move', mode: 'reverse-demotion', field: 'effort', from: 'medium', to: 'high',
      why: 'reversing the unreversed demotion (effort high->medium) before the ladder applies to this failure' },
  },
  {
    name: 'demote: opus·high effort steps down to medium',
    kind: 'demote-effort', current: cur('opus', 'high'),
    want: { kind: 'move', mode: 'demote', field: 'effort', from: 'high', to: 'medium',
      why: 'demoting effort from high to medium' },
  },
  {
    name: 'demote: sonnet·low effort is already at the floor',
    kind: 'demote-effort', current: cur('sonnet', 'low'),
    want: { kind: 'floor', why: 'low is the mechanical floor for effort' },
  },
  {
    name: 'demote: haiku class is already at the floor',
    kind: 'demote-class', current: cur('haiku', 'high'),
    want: { kind: 'floor', why: 'haiku is the mechanical floor for class' },
  },
  {
    name: 'demote: opus class steps down to sonnet, effort reset to high',
    kind: 'demote-class', current: cur('opus', 'high'),
    want: { kind: 'move', mode: 'demote', field: 'class', from: 'opus', to: 'sonnet',
      why: 'demoting class from opus to sonnet and resetting effort to high' },
  },
  {
    // Final review, finding #1: the ONE class rung whose reset is not `high`.
    // ccd refuses `class=haiku` beside an effort LEVEL outright, so this
    // row's `auto` is what keeps the door's argv writable at all.
    name: 'demote: sonnet class steps down to haiku, effort reset to auto — haiku takes no effort level',
    kind: 'demote-class', current: cur('sonnet', 'high'),
    want: { kind: 'move', mode: 'demote', field: 'class', from: 'sonnet', to: 'haiku',
      why: 'demoting class from sonnet to haiku and resetting effort to auto' },
  },
  {
    name: 'a class demotion reverses with its companion effort reset named in the why',
    kind: 'shallow', current: cur('sonnet', 'high'), scope: 'main', prior: 0,
    lastDemotion: { field: 'class', from: 'opus', to: 'sonnet' },
    want: { kind: 'move', mode: 'reverse-demotion', field: 'class', from: 'sonnet', to: 'opus',
      why: 'reversing the unreversed demotion (class opus->sonnet) before the ladder applies to this failure, effort reset to high' },
  },
  {
    name: 'demote: opus·ultracode answers no-effort-rungs — same vocabulary escalate uses',
    kind: 'demote-effort', current: cur('opus', 'ultracode'),
    want: { kind: 'no-effort-rungs', why: 'ultracode has no effort rungs; its next rung is a class rung the caller decides' },
  },
  {
    name: 'demote: opus·auto steps down to medium — auto counts as high for the arithmetic',
    kind: 'demote-effort', current: cur('opus', 'auto'),
    want: { kind: 'move', mode: 'demote', field: 'effort', from: 'auto', to: 'medium',
      why: 'demoting effort from auto to medium' },
  },
  {
    name: 'shallow: opus·max with a prior same-kind failure still ceilings — max is the top effort rung',
    kind: 'shallow', current: cur('opus', 'max'), scope: 'main', prior: 1, lastDemotion: null,
    want: { kind: 'ceiling', why: 'max is the top effort rung; a shallow failure has no further effort rung' },
  },
  {
    name: 'a subagent cannot receive back an unreversed demotion whose origin was effort max',
    kind: 'shallow', current: cur('opus', 'xhigh'), scope: 'subagent', prior: 0,
    lastDemotion: { field: 'effort', from: 'max', to: 'xhigh' },
    want: { kind: 'ceiling',
      why: "the unreversed demotion's origin (effort max) is unreachable for a subagent — max effort is forbidden for a subagent" },
  },
  {
    name: 'on main, the same demotion reverses freely — max origin included',
    kind: 'shallow', current: cur('opus', 'xhigh'), scope: 'main', prior: 0,
    lastDemotion: { field: 'effort', from: 'max', to: 'xhigh' },
    want: { kind: 'move', mode: 'reverse-demotion', field: 'effort', from: 'xhigh', to: 'max',
      why: 'reversing the unreversed demotion (effort max->xhigh) before the ladder applies to this failure' },
  },
  {
    name: 'a subagent cannot receive back an unreversed demotion whose origin class is above the subagent ceiling',
    kind: 'shallow', current: cur('opus', 'high'), scope: 'subagent', prior: 0,
    lastDemotion: { field: 'class', from: 'fable', to: 'opus' },
    want: { kind: 'ceiling',
      why: "the unreversed demotion's origin (class fable) is unreachable for a subagent — a subagent ladder ends at opus" },
  },
];

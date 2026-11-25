// L1 policy, context C4 (landing order wave 5i). The landing read's ONE view of a project's hold: the persisted
// `mainRedHold` is moved by the same pure transition the store's apply uses (`landingLine.ts#mainRedNext`) over the
// watcher's latest control snapshot, and BOTH the order's flags and the binding are decided from that one value. So the
// read can never answer `order.paused` for main-red beside a ready binding, or the reverse, when the persisted flag and the
// snapshot disagree. Pure: no clock (the caller's `nowMs`), no store, no write; the flag's one writer stays `applyLandingControl`.
import type { LandingBinding, LandingLineFlags } from '../../../shared/landingLine.js';
import { landingBindingOf, mainRedNext } from './landingLine.js';
import type { LandingControlRead } from './radar.js';
import type { LandingMutationFacts } from './landingWrites.js';

export function landingReadView(facts: LandingMutationFacts, control: LandingControlRead | undefined, nowMs: number):
  { flags: LandingLineFlags; binding: LandingBinding } {
  const next = control === undefined ? null : mainRedNext(facts.flags.mainRedHold, control, nowMs, facts.project);
  const flags = next === null ? facts.flags : { ...facts.flags, mainRedHold: next.value };
  return { flags, binding: landingBindingOf({ ...facts, flags }, control, nowMs) };
}

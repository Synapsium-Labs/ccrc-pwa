// L1, context C3 (Session Conversation): `generationStep`, the generation machine (Overlord spec §3.3.11, H12, Table
// 3.3.11a, "The receipt has two halves", `degraded`). Pure: what each event does to one generation's view, and which
// acts the renewal lane should take for it. The lane owns the row and its compare-and-set; the deadline is a stored
// column the lane reads through the `Clock` port and reports here as a `deadline` event. Each deadline is set once, on
// entry, and the work of a state fits inside it (the coordinator's ruling, slug deadline-set-once-rounds-fit-inside):
// `carded`'s one re-nudge comes at its nudge point (`CARDED_NUDGE_AT_MS`, a second column set once on entry), and
// `probing`'s second round follows a failed first one, both inside their state's own seconds.
//
// The same machine for every long-lived role (C49, C50). Any event a state does not name is ignored: the same view, no
// action. So `active` is reached from `probing` only, after a matching card read and a passed round, and `ended` is
// terminal.
import type { GenerationState, TriggerClass } from '../../../shared/continuity.js';

export type GenEvent =
  | { readonly kind: 'due'; readonly cls: TriggerClass }       // from active, or from degraded when hard
  | { readonly kind: 'drained' }                                // no reader running, deliveries held
  | { readonly kind: 'handover' }                               // the handover note arrived
  | { readonly kind: 'host-ended' }                             // the receipt's first half: the old conversation ended
  | { readonly kind: 'host-failed'; readonly afterEnd: boolean }
  | { readonly kind: 'started'; readonly resumed: boolean }     // a SessionStart that is not a compaction
  | { readonly kind: 'card-read'; readonly hashMatches: boolean }
  | { readonly kind: 'probes'; readonly passed: boolean }
  | { readonly kind: 'nudge-due' }                              // carded's nudge point passed (set once on entry)
  | { readonly kind: 'deadline' }                               // the state's stored deadline passed (set once on entry)
  | { readonly kind: 'renew-now' };

export interface GenView {
  readonly state: GenerationState;
  /** The state the renewal began from, as recorded on the row. A failure before the receipt's first half returns to
   *  `active` either way (A2). */
  readonly from: 'active' | 'degraded';
  /** `renew` calls in this `clearing`: one per try. */
  readonly tries: number;
  readonly cls: TriggerClass | null;
  /** `carded` re-nudged its card once already (at its nudge point). */
  readonly renudged: boolean;
  /** Probe rounds that failed in this `probing`. */
  readonly probeRounds: number;
  /** The receipt's first half came in this `clearing`: the old conversation ended. */
  readonly hostEnded: boolean;
  /** This generation has read its card and passed a round (or was already working when the machine began). */
  readonly proven: boolean;
}

export type GenAction = 'hold-deliveries' | 'release-deliveries' | 'assemble-checkpoint' | 'ask-handover' | 'renew'
  | 'renudge-card' | 'start-probes' | 'raise-item' | 'set-hold-off' | 'mint-next' | 'end-this';

export interface GenStep { readonly next: GenView; readonly actions: readonly GenAction[] }

/** A working generation, outside any renewal. */
export const GEN_ACTIVE: GenView = { state: 'active', from: 'active', tries: 0, cls: null, renudged: false, probeRounds: 0, hostEnded: false, proven: true };
/** A generation as a start mints it: at `carded`, not yet proven, its deliveries held until it is `active`. */
export const GEN_MINTED: GenView = { ...GEN_ACTIVE, state: 'carded', proven: false };

const same = (g: GenView): GenStep => ({ next: g, actions: [] });
const to = (g: GenView, state: GenerationState, actions: readonly GenAction[], over: Partial<GenView> = {}): GenStep =>
  ({ next: { ...g, ...over, state }, actions });

/** Into `draining`: the renewal begins from `from`. */
const drain = (g: GenView, from: 'active' | 'degraded', cls: TriggerClass): GenStep =>
  to(g, 'draining', ['hold-deliveries'], { from, cls, tries: 0, renudged: false, probeRounds: 0, hostEnded: false });

/** A failure before the receipt's first half: back to `active` with a hold-off, whether the renewal began in `active`
 *  or in `degraded` (the model's FAILED_RENEWAL_RETURNS='active'; plan review 1890, A2), but only for a generation
 *  that has read its card and passed a round: one degraded before that returns to `degraded`, because a generation
 *  never becomes `active` without them (§3.3.11; the coordinator's ruling on ask, slug failed-renewal-returns-to-active-only-if-proven). */
const back = (g: GenView): GenStep => (g.proven
  ? to(GEN_ACTIVE, 'active', ['release-deliveries', 'set-hold-off'])
  : to({ ...GEN_ACTIVE, from: 'degraded', proven: false }, 'degraded', ['release-deliveries']));

/** Into `degraded` after the first half, or when a card or probes fail: one operator item. */
const degrade = (g: GenView): GenStep =>
  to({ ...GEN_ACTIVE, from: 'degraded', proven: g.proven }, 'degraded', ['release-deliveries', 'raise-item']);

/** Into `clearing`: the host ends the conversation and starts a fresh one; this is the try's one `renew`. */
const clear = (g: GenView): GenStep => to(g, 'clearing', ['renew'], { tries: 1, hostEnded: false });

/** Every start that is not a compaction ends this generation; the lane mints the next at `carded` (`GEN_MINTED`). */
const startedHere = (g: GenView): GenStep => to(g, 'ended', ['end-this', 'mint-next']);

const HANDLERS: Readonly<Record<GenerationState, (g: GenView, e: GenEvent) => GenStep>> = {
  active: (g, e) => {
    if (e.kind === 'due') return drain(g, 'active', e.cls);
    if (e.kind === 'renew-now') return drain(g, 'active', 'hard');
    if (e.kind === 'started') return startedHere(g);
    return same(g);
  },
  draining: (g, e) => {
    if (e.kind === 'drained') {
      return g.cls === 'hard' ? clear(g) : to(g, 'checkpointed', ['assemble-checkpoint', 'ask-handover']);
    }
    if (e.kind === 'deadline') return back(g);
    if (e.kind === 'started') return startedHere(g);
    return same(g);
  },
  checkpointed: (g, e) => {
    if (e.kind === 'handover' || e.kind === 'deadline') return clear(g);
    if (e.kind === 'started') return startedHere(g);
    return same(g);
  },
  clearing: (g, e) => {
    if (e.kind === 'host-ended') return to(g, 'clearing', [], { hostEnded: true });
    if (e.kind === 'host-failed') {
      if (!g.hostEnded && !e.afterEnd) return back(g);
      return to(g, 'clearing', ['renew'], { tries: g.tries + 1, hostEnded: true });
    }
    if (e.kind === 'deadline') return g.hostEnded ? degrade(g) : back(g);
    if (e.kind === 'started') return startedHere(g);
    return same(g);
  },
  carded: (g, e) => {
    if (e.kind === 'card-read' && e.hashMatches) return to(g, 'probing', ['start-probes'], { probeRounds: 0 });
    if (e.kind === 'nudge-due' && !g.renudged) return to(g, 'carded', ['renudge-card'], { renudged: true });
    if (e.kind === 'deadline') return degrade(g);
    if (e.kind === 'started') return startedHere(g);
    return same(g);
  },
  probing: (g, e) => {
    if (e.kind === 'probes') {
      if (e.passed) return to(GEN_ACTIVE, 'active', ['release-deliveries']);
      return g.probeRounds >= 1 ? degrade(g) : to(g, 'probing', ['renudge-card', 'start-probes'], { probeRounds: 1 });
    }
    if (e.kind === 'deadline') return degrade(g);
    if (e.kind === 'started') return startedHere(g);
    return same(g);
  },
  degraded: (g, e) => {
    if (e.kind === 'due' && e.cls === 'hard') return drain(g, 'degraded', 'hard');
    if (e.kind === 'renew-now') return drain(g, 'degraded', 'hard');
    if (e.kind === 'started') return startedHere(g);
    return same(g);
  },
  ended: (g) => same(g),
};

/** One event on one generation: its next view and the acts the lane takes. */
export function generationStep(g: GenView, e: GenEvent): GenStep {
  return HANDLERS[g.state](g, e);
}

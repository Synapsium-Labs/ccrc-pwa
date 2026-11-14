// L1, context C3 (Session Conversation): `generationStep`, the generation machine (Overlord spec §3.3.11, H12, Table
// 3.3.11a, "The receipt has two halves", `degraded`). Pure: what each event does to one generation's view, and which
// acts the renewal lane should take for it. The lane owns the row and its compare-and-set; the deadline is a stored
// column the lane reads through the `Clock` port and reports here as a `deadline` event. Each deadline is set once, on
// entry, and the work of a state fits inside it (the coordinator's ruling, slug deadline-set-once-rounds-fit-inside):
// `carded`'s one re-nudge comes at its nudge point (`CARDED_NUDGE_AT_MS`, a second column set once on entry), and
// `probing`'s second round follows a failed first one, both inside their state's own seconds.
//
// The same machine for every long-lived role (C49, C50). Any event a state does not name is ignored: the same view, no
// action. So `active` is reached only through a proven generation: from `probing` after a matching card read and a
// passed round, or by `back()` for a generation that was proven before its renewal began. `ended` is terminal.
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
  /** `renew` calls in this `clearing`: one per try. */
  readonly tries: number;
  readonly cls: TriggerClass | null;
  /** `carded` re-nudged its card once already (at its nudge point). */
  readonly renudged: boolean;
  /** Probe rounds that failed in this `probing` (0 or 1): the count of failed rounds, not of rounds opened. */
  readonly probeRounds: number;
  /** The receipt's first half came in this `clearing`: the old conversation ended. */
  readonly hostEnded: boolean;
  /** This generation has read its card and passed a round (or was already working when the machine began). It does
   *  not outlive the conversation: a renewal that degrades after the receipt's first half leaves it false (review
   *  1912, F5). */
  readonly proven: boolean;
}

export type GenAction = 'hold-deliveries' | 'release-deliveries' | 'assemble-checkpoint' | 'ask-handover' | 'renew'
  | 'renudge-card' | 'start-probes' | 'raise-item' | 'set-hold-off' | 'mint-next' | 'end-this';

/** `changed`: the next view differs from the view stepped, in any field (a step can keep the state and change a counter:
 *  `carded`'s re-nudge, `clearing`'s receipt and retries, `probing`'s second round). The lane writes every changed step and
 *  only those (the coordinator's ruling F5 on review 2023). */
export interface GenStep { readonly next: GenView; readonly actions: readonly GenAction[]; readonly changed: boolean }

/** A working generation, outside any renewal. */
export const GEN_ACTIVE: GenView = { state: 'active', tries: 0, cls: null, renudged: false, probeRounds: 0, hostEnded: false, proven: true };
/** A generation as a start mints it: at `carded`, not yet proven, its deliveries held until it is `active`. */
export const GEN_MINTED: GenView = { ...GEN_ACTIVE, state: 'carded', proven: false };

/** A step before `changed` is measured: `generationStep` measures it once, on the whole view. */
type Move = Omit<GenStep, 'changed'>;
const same = (g: GenView): Move => ({ next: g, actions: [] });
const to = (g: GenView, state: GenerationState, actions: readonly GenAction[], over: Partial<GenView> = {}): Move =>
  ({ next: { ...g, ...over, state }, actions });

/** Into `draining`, from `active` or `degraded`. */
const drain = (g: GenView, cls: TriggerClass): Move =>
  to(g, 'draining', ['hold-deliveries'], { cls, tries: 0, renudged: false, probeRounds: 0, hostEnded: false });

/** Into `degraded`: one operator item, on every step into it (review 1912, F1; one open item per generation is the
 *  renewal act's to keep, not the machine's). After the receipt's first half the old conversation has ended, so the
 *  generation is no longer proven (F5). */
const degrade = (g: GenView): Move =>
  to({ ...GEN_ACTIVE, proven: g.proven && !g.hostEnded }, 'degraded', ['release-deliveries', 'raise-item']);

/** A failure before the receipt's first half (§3.3.11): "returns the generation to `active` with a hold-off if it was
 *  proven, whichever state the renewal began from, and to `degraded` with one operator item if it was not" (the
 *  model's FAILED_RENEWAL_RETURNS='proven'; slug failed-renewal-returns-to-active-only-if-proven). */
const back = (g: GenView): Move => (g.proven
  ? to(GEN_ACTIVE, 'active', ['release-deliveries', 'set-hold-off'])
  : degrade(g));

/** Into `clearing`: the host ends the conversation and starts a fresh one; this is the try's one `renew`. */
const clear = (g: GenView): Move => to(g, 'clearing', ['renew'], { tries: 1, hostEnded: false });

/** Every start that is not a compaction ends this generation; the lane mints the next at `carded` (`GEN_MINTED`). */
const startedHere = (g: GenView): Move => to(g, 'ended', ['end-this', 'mint-next']);

const HANDLERS: Readonly<Record<GenerationState, (g: GenView, e: GenEvent) => Move>> = {
  active: (g, e) => {
    if (e.kind === 'due') return drain(g, e.cls);
    if (e.kind === 'renew-now') return drain(g, 'hard');
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
  // A failed first round asks the session to read its card again and opens round two. The re-read is advisory: a
  // `card-read` in `probing` is ignored, so round two can pass without one being seen; the card matched on entry
  // (review 1912, F17).
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
    if (e.kind === 'due' && e.cls === 'hard') return drain(g, 'hard');
    if (e.kind === 'renew-now') return drain(g, 'hard');
    if (e.kind === 'started') return startedHere(g);
    return same(g);
  },
  ended: (g) => same(g),
};

/** Every field of a view, so `changed` compares the whole of it: a record over `keyof GenView`, so a new field is a compile
 *  error here until it is listed. */
const VIEW_FIELDS: Readonly<Record<keyof GenView, true>> = {
  state: true, tries: true, cls: true, renudged: true, probeRounds: true, hostEnded: true, proven: true,
};
const VIEW_KEYS = Object.keys(VIEW_FIELDS) as readonly (keyof GenView)[];

/** One event on one generation: its next view, the acts the lane takes, and whether the view changed. */
export function generationStep(g: GenView, e: GenEvent): GenStep {
  const m = HANDLERS[g.state](g, e);
  return { ...m, changed: VIEW_KEYS.some((k) => m.next[k] !== g[k]) };
}

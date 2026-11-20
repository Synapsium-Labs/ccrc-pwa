// L1 policy, context C2 (Fleet Mutation): the one mapping of a `ccd route --session <id> --set …` answer (mid-turn mail
// plan `docs/superpowers/plans/2026-11-19-mid-turn-mail.md` Task 4.1, P11). Pure, and it imports nothing: it takes only
// the three fields of the runner's answer it reads (`ports.ts#CcdResult` satisfies the shape), so no L1 file reaches up
// to the L2 port for a type.
//
// Three writers of a route field share it: the generations lane's PreCompact field (`continuity/renewalWiring.ts`), the
// launch-profile lane (`continuity/profileLane.ts`) and the mailhold projection (`coord/mailHoldLane.ts`). Each keeps its
// own pre-checks before it calls `ccd` (a capability it lacks, an id it refuses, a lane that is not live), so a word such
// as `capability-missing` or `unsupported` never passes through here: this answers only for a `ccd` call that was made.
//
// A call that never ran (the agent link dropped, `ran: false`) is `unreachable`, never ccd's refusal (D-6034): it is
// unmeasured and retried, and a reader that folded it into `refused` would report a refusal no ccd made.

/** What a `routeSet` call came to: written, never run, or refused by ccd with the first line it printed. */
export type RouteSetOutcome =
  | { readonly kind: 'written' }
  | { readonly kind: 'unreachable'; readonly detail: string }
  | { readonly kind: 'refused'; readonly reason: string };

/** The fields of a `runCcd` answer this reads. */
export interface RouteSetAnswer { readonly ran: boolean; readonly ok: boolean; readonly stderr: string }

/** The answer for a call that never ran. Each caller hands the whole answer to `routeSetOutcome`, a reader the not-ran
 *  census (`server/test/consolidationCensus.ts#RAN_CARRY_READERS`) lists, so no site narrows `ran === false` itself. */
const ROUTE_SET_UNREACHABLE: RouteSetOutcome = { kind: 'unreachable', detail: 'ccd did not run' };

/** Map one `routeSet` answer. `ran` is read first, so a not-ran answer is never read by its `ok`. */
export function routeSetOutcome(res: RouteSetAnswer): RouteSetOutcome {
  if (res.ran === false) return ROUTE_SET_UNREACHABLE;
  if (res.ok) return { kind: 'written' };
  return { kind: 'refused', reason: res.stderr.split('\n')[0]?.trim() || 'no stderr' };
}

/**
 * THE POLICY DECISION POINT ON LINEAR WRITES, its port (#1444, spec §8, D-7672). L2: types only. The proxy's write
 * routes (LK9) ask it at step 10 of spec §6.3, after validation, routing and the resolve, and before the journal row
 * and the mutation, through `askWithDeadline` (`policyPoint.ts`, which holds the two-second deadline and the default,
 * `allowAll`, D-7687). It is shaped so that #279's external authorizer implements `LinearWritePolicy` with no change
 * here.
 *
 * THE ACTOR IS ATTRIBUTION, NEVER A GRANT (R8). `actor.id` and `actor.uuid` are the pair the client derived from its
 * pane and the registry vouched for, which a session holding the box token can set to a neighbour's (spec §1.5).
 * A policy may refuse by actor, for example to stop one runaway session, but no allow rule may depend on `actor`:
 * any session can present any registered id. #279's authorizer client inherits this rule.
 */

/** What a write asks. Every resource value is the resolved one: `teamKey` and `issue` are the team and the current
 *  identifier the resolve found (spec §4.5), never the reference's prefix, and `parentTeamKey` the resolved parent's
 *  team when the write names a parent. */
export interface LinearWriteAsk {
  actor: { kind: 'session'; id: string; uuid: string };
  verb: 'operate';
  /** The matched route pattern. */
  route: string;
  resource: {
    workspaceId: string;
    /** The resolved current team (spec §4.5), never the reference's prefix. */
    teamKey: string;
    /** The resolved current identifier; null on a create. */
    issue: string | null;
    /** The resolved parent's team when `parent` is set, else null. */
    parentTeamKey: string | null;
    op: 'create' | 'update' | 'comment';
  };
}

/** A policy's answer. Any other shape, a throw or no answer within the deadline is `policy-unavailable`. */
export type LinearWriteDecision =
  | { allow: true; decisionId: string | null }
  | { allow: false; why: 'denied' | 'unavailable'; decisionId: string | null };

/** The port. No allow rule may depend on `ask.actor`. */
export type LinearWritePolicy = (ask: LinearWriteAsk) => Promise<LinearWriteDecision>;

/** The two words the point refuses with: a deny is `policy-denied` (403); a throw, a timeout or a bad shape is
 *  `policy-unavailable` (503). */
export type LinearPolicyRefusal = 'policy-denied' | 'policy-unavailable';

/** What the point answers the route: through, with the decision id, or refused with its word. */
export type LinearPolicyVerdict =
  | { allow: true; decisionId: string | null }
  | { allow: false; code: LinearPolicyRefusal; decisionId: string | null };

// D-6794: the route a dispatch runs on when its coordinator passed none, one row per run kind. L0: a table and
// nothing else, so the server fills it (`dispatchDecide.ts`) and the matrix test pins it to the prose rule the
// coordinator reads (`ccd/coordinator-skill/references/routing-matrix.md`). A row changes in both places in one PR.
import type { RouteFields } from './api.js';

/** The run kinds that have a default; a `kind: 'unknown'` row (D-2795) has none and keeps the lane default. */
export type RouteDefaultKind = 'work' | 'review';

/** `work` is the matrix's spec'd-worker row (Opus high main loop, Sonnet subagents, workflows off, compact 40);
 *  `review` is the review session's main loop (Sonnet high, workflows on for the held-out panel only, compact 40). */
export const ROUTE_DEFAULT_BY_KIND: Readonly<Record<RouteDefaultKind, Readonly<RouteFields>>> = {
  work: { class: 'opus', effort: 'high', subagent: 'sonnet', workflow: 'off', compact: '40' },
  review: { class: 'sonnet', effort: 'high', subagent: 'sonnet', workflow: 'on', compact: '40' },
};

/** The default route for a run kind, a fresh copy, or `null` when the kind has none. */
export function routeDefaultFor(kind: string): RouteFields | null {
  return kind === 'work' || kind === 'review' ? { ...ROUTE_DEFAULT_BY_KIND[kind] } : null;
}

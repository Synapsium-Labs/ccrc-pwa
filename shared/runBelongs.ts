// D-8077 (the ruled plan's W1; spec 2026-11-04 §12): the child marker's one reader and its one question, moved here from
// `pwa/src/fleet/runWords.ts` so the run-close lane (server) and the abandon sheet (PWA) read the same definition. L0:
// this file imports `./api` for the wire type alone. `runWords.ts` re-exports `childMarkOf` and `ChildMarkRead`, so
// `abandonChildOf` is unchanged.
import type { ChildMark } from './api.js';

/** What a fleet row's `child` field says — four answers, never folded. `child`: a
 *  marker naming run `runId`. `none`: no marker — or no key at all, which only a
 *  server predating child marks sends, and such a server reclaims nothing.
 *  `unreadable`: the server could not read the marker. `unrecognised`: a shape this
 *  build cannot read (a newer or faulty server). */
export type ChildMarkRead =
  | { readonly kind: 'child'; readonly runId: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'unrecognised' };

/** THE ONE READER of `FleetSession.child`. Optional here although the
 *  wire type requires it: the live `fleet` frame is cast, never revived. Callers:
 *  `childOfRunLabel` (the fleet line), `abandonChildOf` (the abandon sheet) and the run-close lane's `fleetActFor`.
 *  Which runs can be this workspace's is the wire's binding now (`workerOf`,
 *  D-7182), not a reading of the mark.
 *  The label says nothing for `none` OR `unrecognised`; the sheet must hedge on
 *  `unrecognised` and not on `none`. So
 *  this answers four ways, and the label's `null` is never reused as a mark. */
export const childMarkOf = (session: { child?: ChildMark }): ChildMarkRead => {
  const c: unknown = session.child;
  if (c === undefined) return { kind: 'none' };
  if (c === null || typeof c !== 'object') return { kind: 'unrecognised' };
  const o = c as { kind?: unknown; runId?: unknown };
  if (o.kind === 'child' && typeof o.runId === 'number' && Number.isSafeInteger(o.runId)) {
    return { kind: 'child', runId: o.runId };
  }
  if (o.kind === 'none') return { kind: 'none' };
  if (o.kind === 'unreadable') return { kind: 'unreadable' };
  return { kind: 'unrecognised' };
};

/** Does a READABLE marker name this run? True only for a `child` mark of exactly `runId`: a workspace resumed for a later
 *  wave carries a later run's id, and a recycled name carries another's, and neither belongs to this run. */
export const runBelongsTo = (mark: ChildMarkRead, runId: number): boolean => mark.kind === 'child' && mark.runId === runId;

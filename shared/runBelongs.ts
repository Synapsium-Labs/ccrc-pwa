// D-8077 (the ruled plan's W1; spec 2026-11-04 §12): the child marker's one question, so the run-close lane (server) and the abandon
// sheet (PWA) ask the same thing. L0: this file imports `./api` for the wire type alone. The READER of the marker
// (`childMarkOf`, over the optional wire field) is still `pwa/src/fleet/runWords.ts`'s and moves here with the PWA half of D-8077;
// the server never needs it, because the registry already hands the lane a validated `ChildMark`, which is a `ChildMarkRead`.
import type { ChildMark } from './api.js';

/** What a fleet row's `child` field says — four answers, never folded. `child`: a
 *  marker naming run `runId`. `none`: no marker — or no key at all, which only a
 *  server predating child marks sends, and such a server reclaims nothing.
 *  `unreadable`: the server could not read the marker. `unrecognised`: a shape this
 *  build cannot read (a newer or faulty server). The server's own `ChildMark` is the first three. */
export type ChildMarkRead = ChildMark | { readonly kind: 'unrecognised' };

/** Does a READABLE marker name this run? True only for a `child` mark of exactly `runId`: a workspace resumed for a later
 *  wave carries a later run's id, and a recycled name carries another's, and neither belongs to this run. */
export const runBelongsTo = (mark: ChildMarkRead, runId: number): boolean => mark.kind === 'child' && mark.runId === runId;

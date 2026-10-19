// One decision, shared by the Settings sections that read a route of their own (the stall-watch section and the temp
// root collector section, path-identity spec 2026-10-12 §5.7): which failed read means "not available on this
// server". Pure; it imports only the client's error class.
import { ApiError } from './api';

/** Why a Settings section's read produced no view. `not-configured` is a server with nothing to offer for that
 *  section (no coordination database, or an older build without the route), which the section renders INSTEAD of any
 *  view that landed; `failed` is every other read that did not land. */
export type SettingsReadFailure = 'not-configured' | 'failed';

/** The two answers that mean "not available on this server", each status with its own code: 501 `not-configured` (no
 *  coordination database) and 404 `not-found` (the server's `/api/*` not-found answer, from an older build that lacks
 *  the route: the stall section's departure `older-server-404-reads-not-configured`). A 404 or 501 carrying any other
 *  body is a read that failed, Fastify's own default 404 body included: folding it in would overload one value with
 *  two conditions a section renders differently. A route's other refusals (the collector's 503
 *  `state-unmeasurable`) are `failed` here; a section that has one reads it itself. */
const NOT_CONFIGURED_ANSWERS: ReadonlyArray<readonly [number, string]> = [[501, 'not-configured'], [404, 'not-found']];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The status AND its code, both: a status alone is not an answer this helper may read. */
export function settingsReadFailure(err: unknown): SettingsReadFailure {
  if (!(err instanceof ApiError)) return 'failed';
  const body = err.body;
  if (!isObject(body)) return 'failed';
  const code = body.error;
  return NOT_CONFIGURED_ANSWERS.some(([status, want]) => err.status === status && code === want)
    ? 'not-configured'
    : 'failed';
}

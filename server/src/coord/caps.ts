import type { CoordCaps } from '../../../shared/api.js';

/**
 * L1: pure — the DECISION about a caps write, with no clock, no fs and no
 * `reply`, checked by `coord-caps-policy.test.ts`'s purity scan at the bottom of
 * that file. The write itself is `CoordStore.setCaps` and the door is
 * `POST /api/coord/caps`.
 *
 * That citation used to name `single-definition.test.ts`'s coord-ring scan, and
 * was wrong (D-1219): that scan holds no `./db.js` import, no `node:sqlite`
 * import and no `coord.db` receiver — none of the three properties this sentence
 * claims. Measured: an `fs` import and a module-scope `Date.now()` left it green.
 * A miscited check is worse than an uncited claim, because it stops the next
 * reader from looking.
 *
 * This module exists because `setCaps` validates NOTHING and returns `void`
 * (`store.ts:1357`, D-1164): it binds both fields straight into an UPDATE, so
 * 0, -5, 1.5 and 1e9 all persist. Nothing in `server/src` had ever called it,
 * so the absence never showed — the caps changed by hand-editing sqlite.
 *
 * It REFUSES rather than clamps, following `ledger.ts`'s own shape (a named
 * ceiling plus a policy function that answers a typed union). A clamp would
 * store a number the operator did not ask for and answer 200, which is the
 * same lie as a silent truncation; `store.ts`'s `clampMailLimit` idiom is for
 * LIMIT arguments, never for policy values.
 */

/** One is the floor, and the reason is a wedge rather than tidiness.
 *  `dispatch.ts:238` refuses on `usage.running >= caps.maxConcurrentWorkers`,
 *  so a stored `0` refuses EVERY dispatch for ever — and unlike the pause
 *  marker, which has a deliberately ungated door precisely so a wedge keeps a
 *  release valve it can reach, a zeroed cap has none. */
export const CAP_MIN = 1;

/** A fat-finger ceiling, not a claim about fleet size. The box these caps
 *  govern runs about twenty live sessions, so sixty-four is far above any real
 *  setting and far below the range where `640` could read as deliberate. ONE
 *  ceiling for both fields, on `MAIL_QUIET_MS`'s own stated principle: two
 *  numbers for one policy is two numbers to get out of step. */
export const CAP_MAX = 64;

/** The two members are what a route must tell apart, so they carry different
 *  shapes rather than one nullable field: a refusal has a reason to say and a
 *  success has caps to write, and neither is the other's absence. */
export type CapsDecision =
  | { readonly ok: true; readonly next: CoordCaps }
  | { readonly ok: false; readonly detail: string };

/** The FULL conjunction, and the lower bound is not optional — D-1151 is the
 *  recorded case of borrowing this shape one term short, on the kickoff route,
 *  where only the integer half made the trip. */
const wellFormed = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= CAP_MIN && v <= CAP_MAX;

/** The settable fields, enumerated ONCE — the route, the refusal detail and the
 *  merge below all read this rather than each spelling the pair again. */
const FIELDS = ['maxConcurrentWorkers', 'maxSessionsPerDay'] as const;

/**
 * `body` is a PARTIAL: an omitted field keeps its current value, so an operator
 * moving one dial does not have to restate the other and cannot clobber it with
 * a stale reading.
 *
 * An unknown extra key is IGNORED, not refused — a newer client's third field
 * must not be a 400 from an older server (the wire rule, absence-permits, read
 * in the other direction). A body that asks for NOTHING is refused, because
 * answering `ok` to it would make "the caps are now what you sent" and "you
 * sent nothing" the same 200.
 */
export function decideCaps(current: CoordCaps, body: unknown): CapsDecision {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, detail: 'body must be an object' };
  }
  const b = body as Record<string, unknown>;
  const asked = FIELDS.filter((k) => b[k] !== undefined);
  if (asked.length === 0) {
    return { ok: false,
      detail: `at least one of ${FIELDS.join(' or ')} must be given` };
  }
  for (const k of asked) {
    if (!wellFormed(b[k])) {
      return { ok: false,
        detail: `${k} must be an integer between ${CAP_MIN} and ${CAP_MAX}` };
    }
  }
  const next = { ...current };
  for (const k of asked) next[k] = b[k] as number;
  return { ok: true, next };
}

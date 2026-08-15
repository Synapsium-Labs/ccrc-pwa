// The ROW's lifecycle qualifier — the sentence a dead (or unsupervised) row
// adds beside its state word. Its own small table, deliberately NOT
// SessionLine's `WORD` and deliberately not a `SessionBucket` member: M10
// measured what a new bucket token does to an already-deployed PWA (the live
// fleet frame is cast, not revived, so an unknown bucket reaches RANK as NaN,
// WORD as `undefined`, and `DOT[status].cls` as a THROW). A qualifier is
// additive by construction — an older build that has never heard of it
// renders one cell fewer and nothing else changes.
//
// Same shape as runWords.ts's RUN_WORD/`runState` pair, for the same reason:
// the table is total over the union, and the door into it tolerates a token
// this build was never compiled to know.
import type { FleetSession, SessionLifecycle } from '../../../shared/api';

/** Every lifecycle except `stopped`, which needs the stamp to say anything
 *  useful and is handled in the function below. `running` maps to `null` on
 *  purpose: a healthy row has nothing to qualify, and a chip on every row is
 *  a chip nobody reads. */
const QUALIFIER: Record<Exclude<SessionLifecycle, 'stopped'>, string | null> = {
  running: null,
  unsupervised: 'running unsupervised',
  restarting: 'restarting',
  orphan: 'orphan — nothing is watching it',
  'never-started': 'never started',
  /** Spec §4.3: an unreadable registry must NEVER print `orphan`. The two
   *  states have opposite remedies — one says "nothing is bringing this
   *  back", the other says "we could not look". */
  unmeasurable: 'lifecycle unreadable',
};

/** '<1m' | '5m' | '3h' | '2d'. Same shape as SessionLine's `subagentElapsed`
 *  and PrKeycap's `rel()` — reimplemented locally for the reason both of
 *  those already record: there is no shared time-formatting module to import
 *  from yet. Unlike `rel()` this never returns null; a stop always has an
 *  age, even a fresh one. */
function elapsed(at: number, now: number): string {
  const m = Math.floor(Math.max(0, now - at) / 60_000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** The two halves of a stop stamp, each present only if the frame really
 *  carries it. See `lifecycleQualifier` below for why a *typed* field needs
 *  checking at all; this is where the checking lives so the sentence builder
 *  reads as four cases rather than four guards. */
function stampParts(by: unknown): { surface: string | null; at: number | null } {
  const o = (typeof by === 'object' && by !== null ? by : {}) as { surface?: unknown; at?: unknown };
  return {
    surface: typeof o.surface === 'string' && o.surface !== '' ? o.surface : null,
    at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : null,
  };
}

/**
 * The row's qualifier, or null when there is nothing to add.
 *
 * Both fields are read through `?? null` rather than directly, and that is
 * not defensive noise: `pwa/src/stores/fleet.ts`'s `asFleetMsg` validates
 * only `Array.isArray(sessions)` and casts, so a row from a server that
 * predates these fields lacks the keys at RUNTIME even though `FleetSession`
 * types them as present. `unmeasuredFields`' own docstring in shared/api.ts
 * records what that cost the last time (a TypeError that took the renderer
 * down, not one cell). The parameter type is structural for the same reason.
 *
 * The same argument runs one level DEEPER than the `?? null`s, which is where
 * the final review found it stopping. Tolerating a missing OBJECT while
 * trusting its KEYS is only half a guard when the frame is cast and the two
 * ends are versioned apart — ccd writes the stamp, the server reshapes it,
 * this reads it, and all three ship separately. Measured against cast frames:
 * `{surface:'pwa'}` rendered "stopped by pwa, NaNd ago" and `{at:…}` rendered
 * "stopped by undefined, <1m ago". Neither threw, so the renderer-blanking
 * hazard really was closed — but a row saying NaNd is a row nobody can act
 * on, and "stopped by undefined" invents a surface nobody declared.
 *
 * So each half degrades on its own: say what the frame carries, and say
 * nothing where it carries nothing. Collapsing a half-read stamp to bare
 * `stopped` would be the other error — throwing away the half that WAS read.
 *
 * `now` is a parameter, not a `Date.now()` call inside: the ladder-shaped
 * decisions in this repo stay clock-free so their tests can be too.
 */
export function lifecycleQualifier(
  session: { lifecycle?: FleetSession['lifecycle']; stoppedBy?: FleetSession['stoppedBy'] },
  now: number = Date.now(),
): string | null {
  const lifecycle = session.lifecycle ?? null;
  if (lifecycle === null) return null;
  if (lifecycle === 'stopped') {
    const by = session.stoppedBy ?? null;
    if (by === null) return 'stopped';
    // The surface is a DECLARATION, not an authentication (§4.1) — rendered
    // verbatim, the same rule `.sess-held` follows for the hold reason.
    const { surface, at } = stampParts(by);
    const age = at === null ? null : `${elapsed(at, now)} ago`;
    if (surface === null && age === null) return 'stopped';
    if (age === null) return `stopped by ${surface}`;
    if (surface === null) return `stopped, ${age}`;
    return `stopped by ${surface}, ${age}`;
  }
  return QUALIFIER[lifecycle] ?? null;
}

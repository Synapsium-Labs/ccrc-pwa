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
    // The surface is a DECLARATION, not an authentication (§4.1) — rendered
    // verbatim, the same rule `.sess-held` follows for the hold reason.
    return by === null ? 'stopped' : `stopped by ${by.surface}, ${elapsed(by.at, now)} ago`;
  }
  return QUALIFIER[lifecycle] ?? null;
}

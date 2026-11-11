// The stall watch's L0 values that live outside `shared/api.ts` (stall watch settings, design 2026-10-05 §12 and §13;
// programme stall-watch-settings, wave 4). `shared/api.ts` is cited by line from the spec and plan corpus, and other
// programmes append at its foot, so these sit in a file of their own. L0: the PWA bundles `shared/`, so this file
// takes no value import and no `node:` module. Its one import is a type from `./api.js`, erased at build.
//
// What lives here, once:
// - `StallWatchRefusal`, `STALL_WATCH_REFUSALS` and `isStallWatchRefusal`: the codes `POST /api/coord/stall-watch`
//   refuses with. `stall-settings-route.test.ts` holds the list equal to the codes the POST handler sends.
// - `stallDurationText`, the one duration formatter: the Settings section writes every duration it shows with it (the
//   quiet bounds, step and built-in, the counts window), and the server's feed body writes a quiet-time change with
//   it, so one value is never worded two ways. `single-definition.test.ts` holds the hours-and-minutes template here.
// - the stall watch's arms (moved from `coord/stall.ts` so the L0 trigger table can derive from them): `STALL_ARM_MAP`
//   (private), `StallArm`, `STALL_ARMS` and `isStallArm`.
// The line for an answer that carries none of those codes is `STALL_CONFIRM_TEXT.unconfirmed`, in `shared/api.ts`
// with the section's other words, where the PWA's device-word scan reads it.
import type { StallConfirmRequired } from './api.js';

/** Every refusal code `POST /api/coord/stall-watch` answers with (stall-watch settings §10, §13): spelled once, as a
 *  total table's keys, and the runtime list derived. An answer carrying any other code confirms nothing about the
 *  write (`an-answer-without-a-refusal-code-reads-unconfirmed` (D-4045)). */
export type StallWatchRefusal = 'bad-request' | 'not-configured' | StallConfirmRequired['error'];
const STALL_WATCH_REFUSAL_TABLE: Readonly<Record<StallWatchRefusal, true>> = {
  'bad-request': true, 'not-configured': true, 'confirm-required': true,
};
export const STALL_WATCH_REFUSALS: readonly StallWatchRefusal[] =
  Object.keys(STALL_WATCH_REFUSAL_TABLE) as StallWatchRefusal[];
/** The refusal guard: the `includes` form, never `in`, so an inherited key such as `constructor` is never a code. */
export function isStallWatchRefusal(v: unknown): v is StallWatchRefusal {
  return typeof v === 'string' && (STALL_WATCH_REFUSALS as readonly string[]).includes(v);
}

/** A span in hours and minutes, rounded to the minute first: "30 min", "2 h", "1 h 30 min". */
export function stallDurationText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The watch's arms: wave 1's (§4.2) and wave 2's (§5.2). Each key is added with the code that fires it, and
 *  `coord/stall.ts#STALL_ARM_WAVE` says which wave's arming it answers to. */
const STALL_ARM_MAP = {
  quiet: 'the ladder: the worker holds the ball and has been idle past the quiet threshold (r1 worker, r2 coordinator, r3 operator)',
  'limit-cap': 'the usage-limit hold past its cap: one operator push per episode',
  'dialog-cap': 'a dialog with no question behind it, past the quiet threshold: one operator push per dialog, keyed on its live stamp',
  'coord-ball': 'the coordinator has held the ball past its cap with no mail on the run: one operator push per episode',
  'orphan-d': 'a restart killed background tasks the session ran at its last turn end, and it sat idle past ORPHAN_D_IDLE_MS (any session): a mail to it, then an operator push',
  restarted: 'a restart cut a run worker\'s background tasks short (D5, #759): a mail to the worker at once, then one heads-up to its coordinator, at most one per worker on its run per RESTARTED_HEADS_UP_MS',
  'orphan-e': 'the session ended its turn over a wake-bearing background task and sat idle past ORPHAN_E_IDLE_MS with no turn: a mail to it',
  failed: 'the turn ended on a StopFailure and the session sat idle past FAILED_IDLE_MS: by its STOP_FAILURE_ERRORS class, a mail to it or to the coordinator',
  frozen: 'the marker reads working under a busy word and no hook event arrived for FROZEN_NO_EVENT_MS: the coordinator, or the operator',
  dead: 'the worker read orphan or never-started, or was absent from the registry, for DEAD_GRACE_MS: the coordinator, or the operator',
  'coord-deaf': 'the worker passed the ball to its coordinator and that mail sat unacked COORD_DEAF_MS from its first delivery, or DELEGATE_CAP_MS + COORD_DEAF_MS from its queue while it stays queued behind the gate: one operator push',
  'mail-stuck': 'a delivery to the session stayed queued MAIL_STUCK_MS after its main loop went idle (a live idle or shell word in every mode, the strict mode included, an accepted residual; or a finished turn under a live busy, which the `busy` mode delivers on only while the strict mode is absent), or behind a registry gate: one operator push per delivery',
  'marker-unreadable': 'the turn marker read unmeasured or malformed for MARKER_UNREADABLE_MS: one operator push per episode',
  'coord-blocked': 'mail to a coordinator (no child marker, claiming an open run) still queued COORD_BLOCKED_HELD_MS from its queue time, whatever word it reads: one operator push per episode naming the gate reason, rung 2 at a COORD_BLOCKED_STRETCH_MS busy or waiting stretch or a COORD_BLOCKED_OLD_MS old mail; it only reports (D-6942)',
} as const;
export type StallArm = keyof typeof STALL_ARM_MAP;
export const STALL_ARMS = Object.keys(STALL_ARM_MAP) as StallArm[];
export function isStallArm(v: string): v is StallArm {
  return Object.prototype.hasOwnProperty.call(STALL_ARM_MAP, v);
}

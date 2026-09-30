/**
 * THE MAIL GATE'S TURN-IDLE DECISION, AND ITS MODE (worker stall watch, wave 1,
 * spec §4.1).
 *
 * L1, pure. This module imports NOTHING: not a type, not a builtin, not
 * `shared/api.ts`. It declares its input as a structural shape of its own
 * (`TurnLive`), so `watch.ts` hands it `readLiveState`'s answer and this file
 * never names `LiveState`. That type lives beside `FleetIO`, an L3 port. It has
 * no clock either: `now` is an argument. `turnidle.test.ts` pins both.
 *
 * WHAT CHANGED, AND WHY. The gate used to refuse every live word except
 * `idle`. But Claude Code writes `shell` only from an IDLE main loop: it is
 * `idle` relabelled while a `local_bash` task still runs, such as a background
 * shell or a shell Monitor. A running turn never reads `shell` (spec §3.1,
 * checked against the binary in 2.1.277–2.1.284), and typed input does not wait
 * on background work. So refusing mail on `shell` held it for no reason. Run
 * 129's mail 2407 sat 83.5 h that way, and S3's 2443/2445 sat 48.9 h, each
 * behind an orphaned wait loop that kept the word at `shell`.
 *
 * THE RULES. The first match wins:
 * - no live read (`null`) gives `not-idle`, as `!live` did: an unreadable
 *   answer is never idle;
 * - `idle` goes to the quiet rule;
 * - `shell` gives `not-idle` under `strict`, and otherwise goes to the quiet rule;
 * - every other word (`busy`, `waiting`, `''`, anything unknown) gives
 *   `not-idle`. The match is exact. `waiting` stays refused under every mode
 *   (D-76), because a dialog owns the keyboard.
 * The quiet rule: a null `statusUpdatedAt`, or one younger than `quietMs`, gives
 * `not-quiet`. Otherwise the mail is delivered, with `since = statusUpdatedAt`.
 * The word is judged before the moment, so strict `shell` reads `not-idle`,
 * never `not-quiet`.
 *
 * `via` records WHICH word delivered, because the caller needs it: `sweepMail`
 * passes `refuseIfTurnRunning` to `sendPrompt` only when `via !== 'idle'`. The
 * pane guard is a tripwire for a build where `shell` stopped meaning idle. It
 * is never a second check on an `idle` that needs none.
 */

/** The gate's mode. `shell` is the default. `strict` restores the pre-wave-1
 *  rule, under which only `idle` delivers. */
export type MailTurnMode = 'strict' | 'shell';

/** `$REG/mail-gate-strict`. While it exists, `shell` is refused as it was before
 *  wave 1. The operator touches it and removes it BY HAND on the fleet box
 *  (`touch` to set, `rm -f` to clear); nothing in the tree writes it. It is read
 *  by LISTING, from the one listing `sweepMail` already takes, so an unlistable
 *  registry has already failed the sweep shut before any mode is read. */
export const MAIL_GATE_STRICT_MARKER = 'mail-gate-strict';

/** An exact name in the listing, never a substring: a registry directory holds
 *  `<id>.<field>` files, and only the marker itself counts. */
export function mailTurnModeOf(listing: readonly string[]): MailTurnMode {
  return listing.includes(MAIL_GATE_STRICT_MARKER) ? 'strict' : 'shell';
}

/** The two fields of Claude Code's live status file this decision reads. */
export interface TurnLive { readonly status: string; readonly statusUpdatedAt: number | null }

export type MailTurnVerdict =
  | { readonly deliver: true; readonly since: number; readonly via: 'idle' | 'shell' }
  | { readonly deliver: false; readonly gate: 'not-idle' | 'not-quiet' };

export function mailTurnIdle(live: TurnLive | null, now: number, quietMs: number, mode: MailTurnMode): MailTurnVerdict {
  if (live === null) return { deliver: false, gate: 'not-idle' };
  const via = live.status === 'idle' ? 'idle' : live.status === 'shell' && mode !== 'strict' ? 'shell' : null;
  if (via === null) return { deliver: false, gate: 'not-idle' };
  if (live.statusUpdatedAt === null || now - live.statusUpdatedAt < quietMs) return { deliver: false, gate: 'not-quiet' };
  return { deliver: true, since: live.statusUpdatedAt, via };
}

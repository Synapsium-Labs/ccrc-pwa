/**
 * THE MAIL GATE'S TURN-IDLE DECISION, AND ITS MODE (worker stall watch, wave 1 spec §4.1, wave 2 spec §5.1).
 *
 * L1, pure. This module imports NOTHING: not a type, not a builtin, not `shared/api.ts`. It declares its inputs as
 * structural shapes of its own (`TurnLive`, `TurnMarkFact`), so `watch.ts` hands it `readLiveState`'s answer and
 * `readTurnMarkMeasured`'s, and this file never names `LiveState` or `TurnMarkRead`. Those live beside `FleetIO` and
 * in `coord/stall.ts`; `turnidle.test.ts` pins that `TurnMarkRead` stays assignable to `TurnMarkFact`
 * (turnidle-declares-its-mark-shape (D-3621)). It has no clock either: `now` is an argument. `turnidle.test.ts` pins both.
 *
 * WAVE 1: `shell`. Claude Code writes `shell` only from an IDLE main loop: it is `idle` relabelled while a
 * `local_bash` task still runs, such as a background shell or a shell Monitor. A running turn never reads `shell`
 * (spec §3.1, checked against the binary in 2.1.277–2.1.284), and typed input does not wait on background work. So
 * refusing mail on `shell` held it for no reason. Run 129's mail 2407 sat 83.5 h that way, and S3's 2443/2445 sat
 * 48.9 h, each behind an orphaned wait loop that kept the word at `shell`.
 *
 * WAVE 2: `busy`. The word is ambiguous: a running turn, or a main loop idling over background agents. The turn
 * marker (`$REG/<id>.turn.json`, written by the session hook on main-thread events only) tells the two apart: a
 * current `done` or `failed` marker under `busy` is a turn that has ended. Delivering on it is armed BY HAND in two
 * steps: `mail-gate-busy-shadow` (decide, deliver nothing, let `watch.ts` log what it would have delivered), then
 * `mail-gate-busy` (deliver). The 09-28 coordinator rulings would have landed at 14:34 and 14:51.
 *
 * THE MODE. strict > busy > busy-shadow > shell (busy-gate-precedence (D-3606)): `mail-gate-strict` restores the pre-wave-1
 * rule whatever else is touched. The three marker names are spelled ONLY in this file
 * (gate-markers-spelled-in-turnidle-only (D-3607)): the no-writer pin matches by substring, and one busy marker's name is a
 * prefix of the other's.
 *
 * THE RULES. The first match wins:
 * - no live read (`null`) gives `not-idle`: an unreadable answer is never idle;
 * - `idle` goes to the quiet rule on `statusUpdatedAt`, under every mode. It does not read the marker;
 * - `shell` delivers only under a mode on the POSITIVE list `shell`, `busy-shadow`, `busy`
 *   (shell-allowed-by-positive-list (D-3622)), never "not strict", so a mode added later is refused until someone places it.
 *   Under the default `shell` mode the marker is NOT consulted at all (shell-mode-ignores-the-marker (D-3674)): wave 2 ships
 *   dark, so wave 1's answer holds exactly, whatever the hook wrote. Only under `busy-shadow` and `busy` does a
 *   `working` marker at least as new as `statusUpdatedAt` give `not-idle`, because that turn is running
 *   (working-marker-refuses-shell-as-not-idle (D-3623)). An OLDER `working` marker is an interrupted turn (Stop does not
 *   fire on Esc) and is read as done at `statusUpdatedAt`: the quiet rule runs as with no marker;
 * - `busy` is read only under `busy` and `busy-shadow`, and delivers only on a current `done` or `failed` marker:
 *   - no marker read, or one read `unmeasured` or `malformed`, is a fleet fault. Under `busy` it is
 *     `turn-mark-unreadable` (turn-mark-unreadable-gate (D-3625)), so it never hides behind `not-idle`. Under `busy-shadow`,
 *     which delivers nothing, it is `not-idle`;
 *   - `absent` (an older fleet build), `foreign` and `stale` take the wave-1 answer, `not-idle`. So does `working`;
 *   - inside a restart's grace (`graceUntil`: a restart cut a turn short and ccd redrives it) it is `not-idle`;
 *   - then the quiet rule runs on `stopAt`, never on `statusUpdatedAt`, which does not move at a turn end under
 *     `busy`. Under `busy` a missing or too-recent `stopAt` is `not-quiet`, and a quiet one delivers `via: 'busy'`.
 *     Under `busy-shadow` both are `not-idle`, and a quiet one also carries `wouldDeliver` and `since`, so that
 *     `watch.ts` can log the line (busy-shadow-verdict-arm (D-3624)): this module cannot log;
 * - every other word (`waiting`, `''`, anything unknown) gives `not-idle`. The match is exact. `waiting` stays refused
 *   under every mode (D-76), because a dialog owns the keyboard.
 * The quiet rule: a null moment, or one younger than `quietMs`, gives `not-quiet`. Otherwise the mail is delivered,
 * with `since` = that moment. The word is judged before the moment, so strict `shell` reads `not-idle`, never
 * `not-quiet`.
 *
 * `via` records WHICH word delivered, because the caller needs it: `sweepMail` passes `refuseIfTurnRunning` to
 * `sendPrompt` only when `via !== 'idle'`, so a `shell` or `busy` delivery is checked against the pane first. The pane
 * guard is a tripwire for a build where `shell` stopped meaning idle, or a stale `done` marker. It is never a second
 * check on an `idle` that needs none.
 */

/** The gate's mode. `shell` is the default. `strict` restores the pre-wave-1 rule, under which only `idle`
 *  delivers. `busy-shadow` and `busy` also read `busy` through the turn marker. */
export type MailTurnMode = 'strict' | 'shell' | 'busy-shadow' | 'busy';

/** `$REG/mail-gate-strict`. While it exists, `shell` and `busy` are refused as they were before wave 1, whatever else
 *  is touched. The operator touches it and removes it BY HAND on the fleet box (`touch` to set, `rm -f` to clear);
 *  nothing in the tree writes it. It is read by LISTING, from the one listing `sweepMail` already takes, so an
 *  unlistable registry has already failed the sweep shut before any mode is read. */
export const MAIL_GATE_STRICT_MARKER = 'mail-gate-strict';
/** `$REG/mail-gate-busy`: deliver on `busy` when the turn marker says the main turn has ended (§5.1). The second
 *  of the two hand-armed steps. Touched and removed by hand, like the others; nothing in the tree writes it. */
export const MAIL_GATE_BUSY_MARKER = 'mail-gate-busy';
/** `$REG/mail-gate-busy-shadow`: the first step. The gate decides `busy` exactly as the busy mode would, delivers
 *  nothing, and `watch.ts` logs each delivery it would have made, once, for the operator to check against the
 *  transcript before touching the busy marker. Nothing in the tree writes it. */
export const MAIL_GATE_BUSY_SHADOW_MARKER = 'mail-gate-busy-shadow';

/** Exact names in the listing, never substrings: a registry directory holds `<id>.<field>` files, and only the
 *  markers themselves count. The most conservative marker present wins. */
export function mailTurnModeOf(listing: readonly string[]): MailTurnMode {
  if (listing.includes(MAIL_GATE_STRICT_MARKER)) return 'strict';
  if (listing.includes(MAIL_GATE_BUSY_MARKER)) return 'busy';
  if (listing.includes(MAIL_GATE_BUSY_SHADOW_MARKER)) return 'busy-shadow';
  return 'shell';
}

/** Whether `mailTurnIdle` consults `mark` under this mode: only `busy-shadow` and `busy`
 *  (shell-mode-ignores-the-marker (D-3674)). A positive list, so a mode added later reads no marker until someone places it.
 *  `sweepMail` reads the marker iff this is true, so the read and the decision are one rule, decided here in L1 and
 *  never spelled again in `watch.ts`. */
export function mailTurnReadsMark(mode: MailTurnMode): boolean {
  return mode === 'busy' || mode === 'busy-shadow';
}

/** The two fields of Claude Code's live status file this decision reads. */
export interface TurnLive { readonly status: string; readonly statusUpdatedAt: number | null }

/** The marker as the gate reads it. `TurnMarkRead` (coord/stall.ts) is assignable to it. */
export type TurnMarkFact =
  | { readonly ok: true; readonly state: 'working' | 'done' | 'failed'; readonly at: number; readonly stopAt: number | null; readonly graceUntil: number | null }
  | { readonly ok: false; readonly reason: 'absent' | 'unmeasured' | 'malformed' | 'foreign' | 'stale' };

export type MailTurnVerdict =
  | { readonly deliver: true; readonly since: number; readonly via: 'idle' | 'shell' | 'busy' }
  | { readonly deliver: false; readonly gate: 'not-idle' | 'not-quiet' | 'turn-mark-unreadable' }
  | { readonly deliver: false; readonly gate: 'not-idle'; readonly wouldDeliver: true; readonly since: number };

/** The quiet rule for `idle` and `shell`: their moment is `statusUpdatedAt`. */
function quietRule(moment: number | null, now: number, quietMs: number, via: 'idle' | 'shell'): MailTurnVerdict {
  if (moment === null || now - moment < quietMs) return { deliver: false, gate: 'not-quiet' };
  return { deliver: true, since: moment, via };
}

/** `mark === null`: not read, which the caller does under `strict` and `shell`: it reads the marker only when
 *  `mailTurnReadsMark(mode)` is true (`busy-shadow` and `busy`), and when it is false this function never consults
 *  `mark` at all (shell-mode-ignores-the-marker (D-3674)). Both sites below ask that one rule. */
export function mailTurnIdle(live: TurnLive | null, mark: TurnMarkFact | null, now: number, quietMs: number, mode: MailTurnMode): MailTurnVerdict {
  if (live === null) return { deliver: false, gate: 'not-idle' };
  if (live.status === 'idle') return quietRule(live.statusUpdatedAt, now, quietMs, 'idle');
  if (live.status === 'shell') {
    if (mode !== 'shell' && mode !== 'busy-shadow' && mode !== 'busy') return { deliver: false, gate: 'not-idle' };
    const readsMark = mailTurnReadsMark(mode);
    if (readsMark && mark !== null && mark.ok && mark.state === 'working' && live.statusUpdatedAt !== null && mark.at >= live.statusUpdatedAt) {
      return { deliver: false, gate: 'not-idle' };
    }
    return quietRule(live.statusUpdatedAt, now, quietMs, 'shell');
  }
  if (live.status !== 'busy' || !mailTurnReadsMark(mode)) return { deliver: false, gate: 'not-idle' };
  if (mark === null || (!mark.ok && (mark.reason === 'unmeasured' || mark.reason === 'malformed'))) {
    return { deliver: false, gate: mode === 'busy' ? 'turn-mark-unreadable' : 'not-idle' };
  }
  if (!mark.ok || mark.state === 'working') return { deliver: false, gate: 'not-idle' };
  if (mark.graceUntil !== null && now < mark.graceUntil) return { deliver: false, gate: 'not-idle' };
  if (mark.stopAt === null || now - mark.stopAt < quietMs) return { deliver: false, gate: mode === 'busy' ? 'not-quiet' : 'not-idle' };
  if (mode === 'busy') return { deliver: true, since: mark.stopAt, via: 'busy' };
  return { deliver: false, gate: 'not-idle', wouldDeliver: true, since: mark.stopAt };
}

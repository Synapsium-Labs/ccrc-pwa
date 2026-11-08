/**
 * THE WAKE BUDGET (D-5242, `hibernate-long-idle-sessions`, plan Task 17b): L1, pure.
 *
 * Every wake of a hibernated session is a cold `--resume` (`ccd ensure`), on a box measured at its memory cap, and
 * `ccd`'s spawn path has no concurrency control of its own. So AUTOMATIC wakes — the mail lane's — are bounded
 * fleet-wide: at most `WAKE_BURST` in any `WAKE_WINDOW_MS`, the rest left outstanding (never parked) for a later sweep.
 * A wake somebody ASKED for — the operator's `POST /api/sessions/:id/ensure`, a dispatch resuming its worker — is never
 * refused (the operator asked; a dispatch's resume is the coordinator's), but it is recorded and counts in the window, so
 * an automatic wake never lands on top of one.
 *
 * The window's state is ONE in-memory list the server owns (`FleetWatcher.admitWake`, handed to the routes through the
 * watcher the way the coordination handle is). A restart empties it, which can let one extra burst through, and no more.
 * The figure is lowered by a PR, never by hand (plan Task 19's stop rule).
 *
 * THE MEMORY GATE (D-8122). An automatic wake is a cold start, and the budget above counts wakes, not memory. So an
 * `auto` wake is also refused for this pass while the node's memory pressure is at or above the gate level, or the
 * session slice's headroom is below the floor (`wakeMemoryGate`). Refused is never parked: nothing is recorded, no
 * slot is taken, and the next pass asks again. A reading that is missing or unreadable ADMITS (fail open) and says so
 * in its `note`, so the gate can never stop the fleet waking on a box whose agent predates the headroom field. An
 * `asked` wake never reads the gate. Both figures are box settings with neutral defaults (`wakeGateConfigOf`,
 * server/src/config.ts): `CCRC_WAKE_PRESSURE_GATE` and `CCRC_WAKE_HEADROOM_MIN_GIB`.
 */
import { CLAUDE_HEADROOM_GATE_BYTES } from '../../../shared/claudeVersion.js';
import type { PressureLevel } from '../../../shared/pressure.js';

/** At most this many wakes, automatic and asked together, in any `WAKE_WINDOW_MS`, before an automatic one waits. */
export const WAKE_BURST = 2;
/** The window, in MS. A wake exactly this old no longer counts. */
export const WAKE_WINDOW_MS = 60_000;

/** `auto`: the mail lane's; refused while the window is full. `asked`: an operator's or a dispatch's; always admitted. */
export type WakeKind = 'auto' | 'asked';

/** Admit a wake at `now`? Returns the window's new list: the wakes still inside it, plus this one when it is admitted.
 *  The list handed in is never mutated. */
export function wakeAdmit(recent: readonly number[], now: number, kind: WakeKind): { admit: boolean; recent: number[] } {
  const live = recent.filter((t) => now - t < WAKE_WINDOW_MS);
  if (kind === 'auto' && live.length >= WAKE_BURST) return { admit: false, recent: live };
  return { admit: true, recent: [...live, now] };
}

// ── the memory gate (D-8122) ────────────────────────────────────────────────────────────────────────────────────────

/** `CCRC_WAKE_PRESSURE_GATE`: the pressure level at or above which an automatic wake waits. `warn` is PSI full at or
 *  above `PSI_WARN_FULL_PCT`, `critical` at or above `PSI_CRITICAL_FULL_PCT` (shared/pressure.ts); `off` never waits
 *  on pressure (the headroom floor still applies). */
export type WakePressureGate = 'warn' | 'critical' | 'off';
const WAKE_PRESSURE_GATE_MAP: Record<WakePressureGate, true> = { warn: true, critical: true, off: true };
export const WAKE_PRESSURE_GATES: readonly WakePressureGate[] = Object.keys(WAKE_PRESSURE_GATE_MAP) as WakePressureGate[];
export const WAKE_PRESSURE_GATE_DEFAULT: WakePressureGate = 'warn';
/** `CCRC_WAKE_HEADROOM_MIN_GIB`'s default, DERIVED from spec decision 6's one figure (`CLAUDE_HEADROOM_GATE_BYTES`). */
export const WAKE_HEADROOM_MIN_GIB_DEFAULT = CLAUDE_HEADROOM_GATE_BYTES / 2 ** 30;
/** The largest floor the setting takes, in GiB. */
export const WAKE_HEADROOM_MIN_GIB_MAX = 1024;

/** The gate's two figures, as the server holds them. `headroomMinBytes` 0 turns the floor off. */
export interface WakeGateConfig { readonly pressure: WakePressureGate; readonly headroomMinBytes: number }
export const WAKE_GATE_DEFAULT: WakeGateConfig = { pressure: WAKE_PRESSURE_GATE_DEFAULT, headroomMinBytes: CLAUDE_HEADROOM_GATE_BYTES };

/** What the node's last reading says at the wake: the pressure level (`unmeasured` when there is no fresh reading)
 *  and the session slice's headroom in bytes (`null` when the agent did not report one). */
export interface WakeMemoryReading { readonly level: PressureLevel; readonly headroomBytes: number | null }

/** Why the gate refused: the level it met, or a headroom below the floor. */
export type WakeMemoryRefusal = 'pressure-warn' | 'pressure-critical' | 'headroom-low';
/** Why the gate admitted without a reading (fail open). */
export type WakeMemoryNote = 'pressure-unmeasured' | 'headroom-unmeasured';

export type WakeMemoryVerdict =
  | { readonly admit: true; readonly notes: readonly WakeMemoryNote[] }
  | { readonly admit: false; readonly refused: WakeMemoryRefusal };

const LEVEL_RANK: Record<'ok' | 'warn' | 'critical', number> = { ok: 0, warn: 1, critical: 2 };

/** The gate (D-8122): refuse while pressure is at or above the gate level or headroom is under the floor; admit, with a
 *  note, on a reading that is not there. Pressure is judged first, so a thrash names itself rather than its headroom. */
export function wakeMemoryGate(r: WakeMemoryReading, cfg: WakeGateConfig): WakeMemoryVerdict {
  const notes: WakeMemoryNote[] = [];
  if (cfg.pressure !== 'off') {
    if (r.level === 'unmeasured') notes.push('pressure-unmeasured');
    else if (LEVEL_RANK[r.level] >= LEVEL_RANK[cfg.pressure]) {
      return { admit: false, refused: r.level === 'critical' ? 'pressure-critical' : 'pressure-warn' };
    }
  }
  if (cfg.headroomMinBytes > 0) {
    if (r.headroomBytes === null) notes.push('headroom-unmeasured');
    else if (r.headroomBytes < cfg.headroomMinBytes) return { admit: false, refused: 'headroom-low' };
  }
  return { admit: true, notes };
}

/** A wake-gate journal line (a refusal, or a fail-open admit) is said at most once per word in this long. */
export const WAKE_GATE_LINE_MS = 10 * 60_000;

/** The word a refusal is journalled and shown by, beside the budget's own `wake-budget`. */
export const wakeRefusalWord = (r: WakeMemoryRefusal): string => `memory-gate:${r}`;

/** An automatic wake admitted before its act (the automatic roll's, D-7542): `refund` gives the slot back when the act
 *  woke nothing (ccd refused it, or its wake failed and the row went back to sleep), so a roll that did not wake
 *  anything neither eats `WAKE_BURST` nor holds the mail lane's floor on that session. A second call does nothing. */
export interface WakeAdmission { readonly refund: () => void }
/** An automatic wake the memory gate refused for this pass (D-8122): its word (`wakeRefusalWord`), journalled where the
 *  lane journals its skips. A budget refusal stays `null`, as before. */
export interface WakeRefused { readonly refused: string }

/** The window's list with ONE admission at `at` taken back (D-7542). An `at` no longer in it (pruned, or refunded
 *  already) changes nothing. The list handed in is never mutated. */
export function wakeRefund(recent: readonly number[], at: number): number[] {
  const out = [...recent];
  const i = out.lastIndexOf(at);
  if (i >= 0) out.splice(i, 1);
  return out;
}


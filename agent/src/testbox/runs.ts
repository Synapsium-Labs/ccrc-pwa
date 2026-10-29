// D-7406, D-7501 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.1 "Ref lifetime", §2.2, §2.4).
// L1, pure and clock-free: the run lifecycle. A run takes a free run user `k`, then runs its prepare unit, its run unit
// and its clean unit, in that order; the user goes back to the pool only when the run's directory is gone, and a clean
// that fails holds the user out, counted, until a later sweep's clean succeeds. The start-up sweep cleans every
// `runs/<k>/run` that no active unit owns. `prepareFailed` reasons are `TESTBOX_FALLBACK`'s words. Results, logs and
// refs are kept for `CCRC_TESTBOX_RETENTION`; a run's refs go only after that time AND its directory's deletion.
//
// D-7501: the prepare unit says why it failed on its last stderr line, in `TESTBOX_FALLBACK`'s words; that output
// file is written by the system manager outside the run directory (spec §2.2), so the service reads it there.
import { TESTBOX_FALLBACK, type TestboxFallbackId, type TestboxPrepareFailed, type TestboxPrepareFailure } from '../../../shared/testbox.js';

// ---------------------------------------------------------------------------------------------------------------
// The run-user pool.
// ---------------------------------------------------------------------------------------------------------------

export type SlotState = 'free' | 'busy' | 'held';
export const SLOT_STATE_MAP: Record<SlotState, true> = { free: true, busy: true, held: true };

export interface Slot {
  readonly k: number;
  readonly state: SlotState;
  /** The run the slot serves (busy) or whose directory it still holds (held); `null` for a directory the start-up
   *  sweep found with no run the service knows. */
  readonly runId: string | null;
  /** Failed cleans while held. */
  readonly failures: number;
}

export type Pool = readonly Slot[];

/** `k` from 1 to `CCRC_TESTBOX_RUNS`, all free. */
export function makePool(runs: number): Pool {
  return Array.from({ length: runs }, (_, i) => ({ k: i + 1, state: 'free' as const, runId: null, failures: 0 }));
}

const put = (pool: Pool, s: Slot): Pool => pool.map((x) => (x.k === s.k ? s : x));

/** The lowest free run user, now busy with `runId`; `null` when none is free. */
export function takeUser(pool: Pool, runId: string): { readonly pool: Pool; readonly k: number } | null {
  const free = pool.find((s) => s.state === 'free');
  if (free === undefined) return null;
  return { pool: put(pool, { k: free.k, state: 'busy', runId, failures: 0 }), k: free.k };
}

/** A clean ended. The user is free only when the clean succeeded AND the directory is gone; otherwise it is held,
 *  one more failure counted. */
export function cleaned(pool: Pool, k: number, ok: boolean, dirGone: boolean): Pool {
  const s = pool.find((x) => x.k === k);
  if (s === undefined) return pool;
  if (ok && dirGone) return put(pool, { k, state: 'free', runId: null, failures: 0 });
  return put(pool, { k, state: 'held', runId: s.runId, failures: s.failures + 1 });
}

/** The held run users by name, for the status answer (spec §2.7). */
export function heldUsers(pool: Pool, prefix: string): string[] {
  return pool.filter((s) => s.state === 'held').map((s) => `${prefix}${s.k}`);
}

/** The run ids whose directory still exists (busy or held). */
export function liveRunIds(pool: Pool): ReadonlySet<string> {
  return new Set(pool.filter((s) => s.state !== 'free' && s.runId !== null).map((s) => s.runId as string));
}

export interface SlotSeen {
  readonly k: number;
  /** `runs/<k>/run` exists. */
  readonly runDir: boolean;
  /** A prepare, run or clean unit of `k` is active. */
  readonly active: boolean;
}

/** The start-up sweep (spec §2.2): a slot whose directory exists with no active unit is cleaned; one with an active
 *  unit is held until a later sweep finds it inactive; the rest start free. A box reboot leaves nothing behind. */
export function startupSweep(pool: Pool, seen: readonly SlotSeen[]): { readonly pool: Pool; readonly clean: readonly number[] } {
  let next = pool;
  const clean: number[] = [];
  for (const s of seen) {
    if (!s.runDir) continue;
    next = put(next, { k: s.k, state: 'held', runId: null, failures: 0 });
    if (!s.active) clean.push(s.k);
  }
  return { pool: next, clean };
}

/** The held slots a sweep retries: every held one whose units are no longer active. */
export function retrySweep(pool: Pool, active: ReadonlySet<number>): readonly number[] {
  return pool.filter((s) => s.state === 'held' && !active.has(s.k)).map((s) => s.k);
}

// ---------------------------------------------------------------------------------------------------------------
// The run's phases.
// ---------------------------------------------------------------------------------------------------------------

export type RunPhase = 'queued' | 'prepare' | 'run' | 'clean' | 'done';
export const RUN_PHASE_MAP: Record<RunPhase, true> = { queued: true, prepare: true, run: true, clean: true, done: true };

export interface RunState {
  readonly runId: string;
  readonly phase: RunPhase;
  readonly k: number | null;
  readonly cancelled: boolean;
  readonly prepareFailed: TestboxPrepareFailed | null;
  /** The command's exit, once the run unit ended. */
  readonly exit: number | null;
}

export type RunEvent =
  | { readonly t: 'admitted'; readonly k: number }
  | { readonly t: 'prepared'; readonly exit: number; readonly lastStderr: string | null }
  | { readonly t: 'ran'; readonly exit: number }
  | { readonly t: 'cancel' }
  | { readonly t: 'cleaned' };

/** What the run manager does next. */
export type RunAct =
  | { readonly t: 'start-prepare'; readonly k: number }
  | { readonly t: 'start-run'; readonly k: number }
  | { readonly t: 'start-clean'; readonly k: number }
  | { readonly t: 'stop'; readonly unit: 'prepare' | 'run'; readonly k: number }
  | { readonly t: 'drop' }
  | { readonly t: 'summarise' }
  | { readonly t: 'none' };

export const queuedRun = (runId: string): RunState => ({ runId, phase: 'queued', k: null, cancelled: false, prepareFailed: null, exit: null });

/** One step of the lifecycle. An event that does not belong to the phase changes nothing. */
export function step(r: RunState, ev: RunEvent): { readonly run: RunState; readonly act: RunAct } {
  const none = { run: r, act: { t: 'none' } as const };
  switch (ev.t) {
    case 'admitted':
      if (r.phase !== 'queued') return none;
      return { run: { ...r, phase: 'prepare', k: ev.k }, act: { t: 'start-prepare', k: ev.k } };
    case 'prepared': {
      if (r.phase !== 'prepare' || r.k === null) return none;
      if (ev.exit !== 0 && !r.cancelled) {
        return { run: { ...r, phase: 'clean', prepareFailed: prepareFailedFrom(ev.exit, ev.lastStderr) }, act: { t: 'start-clean', k: r.k } };
      }
      if (r.cancelled) return { run: { ...r, phase: 'clean' }, act: { t: 'start-clean', k: r.k } };
      return { run: { ...r, phase: 'run' }, act: { t: 'start-run', k: r.k } };
    }
    case 'ran':
      if (r.phase !== 'run' || r.k === null) return none;
      return { run: { ...r, phase: 'clean', exit: ev.exit }, act: { t: 'start-clean', k: r.k } };
    case 'cancel':
      if (r.cancelled) return none;
      if (r.phase === 'queued') return { run: { ...r, phase: 'done', cancelled: true }, act: { t: 'drop' } };
      if ((r.phase === 'prepare' || r.phase === 'run') && r.k !== null) {
        return { run: { ...r, cancelled: true }, act: { t: 'stop', unit: r.phase, k: r.k } };
      }
      return { run: { ...r, cancelled: true }, act: { t: 'none' } };
    case 'cleaned':
      if (r.phase !== 'clean') return none;
      return { run: { ...r, phase: 'done' }, act: { t: 'summarise' } };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The prepare's failure reason, in TESTBOX_FALLBACK's words (spec §2.4's last three rows).
// ---------------------------------------------------------------------------------------------------------------

const PREPARE_IDS: readonly TestboxPrepareFailure[] = ['prepare-failed', 'install-failed', 'build-failed'];

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A fallback row's text with its `<…>` holes as wildcards, anchored. */
function rowPattern(id: TestboxFallbackId): RegExp {
  const row = TESTBOX_FALLBACK.find((r) => r.id === id);
  if (row === undefined) throw new Error(`no fallback row ${id}`);
  return new RegExp(`^${row.text.split(/<[^>]+>/).map(escape).join('.+')}$`);
}

/** A row's text with its holes filled in order. */
export function fillRow(id: TestboxFallbackId, holes: readonly string[]): string {
  const row = TESTBOX_FALLBACK.find((r) => r.id === id);
  if (row === undefined) throw new Error(`no fallback row ${id}`);
  let i = 0;
  return row.text.replace(/<[^>]+>/g, (h) => holes[i++] ?? h);
}

/** The prepare unit's last stderr line, when it is one of the three prepare rows, is the reason; anything else is a
 *  prepare that failed at its own step with its exit. */
export function prepareFailedFrom(exit: number, lastStderr: string | null): TestboxPrepareFailed {
  const line = (lastStderr ?? '').trim();
  for (const id of PREPARE_IDS) if (rowPattern(id).test(line)) return { id, text: line };
  return { id: 'prepare-failed', text: fillRow('prepare-failed', ['checkout', `exit ${exit}`]) };
}

// ---------------------------------------------------------------------------------------------------------------
// Retention (spec §2.1 "Ref lifetime", §2.3 "Results").
// ---------------------------------------------------------------------------------------------------------------

export interface KeptRun {
  readonly runId: string;
  /** When the run ended, or when the service first saw its refs (ms since the epoch, given by the caller). */
  readonly at: number;
  readonly results: boolean;
  readonly logs: boolean;
  readonly refs: boolean;
}

export interface RetentionPlan {
  readonly results: readonly string[];
  readonly logs: readonly string[];
  readonly refs: readonly string[];
}

/** What to delete now. Results and logs go once older than the retention time; refs only then AND once the run's
 *  directory is gone, so a shared checkout never loses an object it names. */
export function retentionPlan(kept: readonly KeptRun[], live: ReadonlySet<string>, now: number, retentionMs: number): RetentionPlan {
  const old = kept.filter((r) => now - r.at >= retentionMs);
  return {
    results: old.filter((r) => r.results).map((r) => r.runId),
    logs: old.filter((r) => r.logs).map((r) => r.runId),
    refs: old.filter((r) => r.refs && !live.has(r.runId)).map((r) => r.runId),
  };
}

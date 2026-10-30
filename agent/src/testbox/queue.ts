// D-7406, D-7420 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.8). L1, pure and clock-free:
// the box's own queue. First come first served across sessions; at most `CCRC_TESTBOX_SESSION_RUNS` running runs per
// session (D-7420), a later run of a busy session waits while an earlier-queued run of another session may pass it;
// at most `CCRC_TESTBOX_RUNS` running at once, a pristine build counting as one, and at most one pristine build at a
// time (spec §2.2). Positions are 1-based places in the waiting list, recomputed as the queue moves. Step 1's fleet-wide
// admission queue governs local runs only and is not this.

export type QueueKind = 'run' | 'pristine';
export const QUEUE_KIND_MAP: Record<QueueKind, true> = { run: true, pristine: true };

export interface QueueEntry {
  readonly id: string;
  /** The submitting session; a pristine build's is the service's own word for it. */
  readonly session: string;
  readonly kind: QueueKind;
}

export interface QueueState {
  /** In arrival order. */
  readonly waiting: readonly QueueEntry[];
  readonly running: readonly QueueEntry[];
}

export interface QueueLimits {
  /** `CCRC_TESTBOX_RUNS`. */
  readonly runs: number;
  /** `CCRC_TESTBOX_SESSION_RUNS` (D-7420). */
  readonly sessionRuns: number;
}

export const EMPTY_QUEUE: QueueState = { waiting: [], running: [] };

const known = (s: QueueState, id: string): boolean => s.waiting.some((e) => e.id === id) || s.running.some((e) => e.id === id);

/** A new entry at the back. An id already queued or running is refused (`null`): two runs never share one. */
export function enqueue(s: QueueState, e: QueueEntry): QueueState | null {
  if (known(s, e.id)) return null;
  return { waiting: [...s.waiting, e], running: s.running };
}

/** Whether `e` may start now beside `running`. */
function mayStart(running: readonly QueueEntry[], e: QueueEntry, limits: QueueLimits): boolean {
  if (running.length >= limits.runs) return false;
  if (e.kind === 'pristine') return !running.some((r) => r.kind === 'pristine');
  return running.filter((r) => r.kind === 'run' && r.session === e.session).length < limits.sessionRuns;
}

/** Every waiting entry that may start, in arrival order, moved to running. */
export function admit(s: QueueState, limits: QueueLimits): { readonly state: QueueState; readonly started: readonly QueueEntry[] } {
  const running = [...s.running];
  const waiting: QueueEntry[] = [];
  const started: QueueEntry[] = [];
  for (const e of s.waiting) {
    if (mayStart(running, e, limits)) { running.push(e); started.push(e); } else waiting.push(e);
  }
  return { state: { waiting, running }, started };
}

/** A running entry ended: it leaves the running set. */
export function finish(s: QueueState, id: string): QueueState {
  return { waiting: s.waiting, running: s.running.filter((e) => e.id !== id) };
}

/** A cancel: a waiting entry leaves the queue (`waiting`); a running one is the run manager's to stop (`running`). */
export function cancel(s: QueueState, id: string): { readonly state: QueueState; readonly was: 'waiting' | 'running' | 'unknown' } {
  if (s.waiting.some((e) => e.id === id)) return { state: { waiting: s.waiting.filter((e) => e.id !== id), running: s.running }, was: 'waiting' };
  if (s.running.some((e) => e.id === id)) return { state: s, was: 'running' };
  return { state: s, was: 'unknown' };
}

/** Each waiting run's 1-based position. */
export function positions(s: QueueState): ReadonlyMap<string, number> {
  return new Map(s.waiting.map((e, i) => [e.id, i + 1]));
}

/** What the status answer reports. */
export function queueCounts(s: QueueState): { readonly inProgress: number; readonly queueDepth: number } {
  return { inProgress: s.running.length, queueDepth: s.waiting.length };
}

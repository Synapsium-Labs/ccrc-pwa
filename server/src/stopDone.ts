import type { FleetSession } from '../../shared/api.js';

/**
 * STOP A FINISHED RUN'S WORKER (D-5370, `stop-worker-at-run-done`): the pure verdict.
 *
 * A dispatched worker whose run reached `done` keeps its Claude Code process alive until somebody stops it — child
 * reclamation removes the workspace only once the programme has finished with it (`childReclaimDecision`,
 * `coord/childReclaim.ts`: `final`, a retired programme or a spent child), and a wave that is not the last is none of
 * those. Measured 2026-10-17: of 28 long-idle sessions stopped by hand on a fleet box pinned at its memory cap, 23 were
 * workers whose runs were already `done` and merged, each holding about 200 MiB for days. The operator ruled: a
 * finished run's worker is stopped once idle, and restarts on re-dispatch — the dispatch resume arm already calls
 * `ccd ensure` (`coord/dispatch.ts`), which re-supervises and resumes a stopped session.
 *
 * L1: decisions only, over what the sweep (`stopDoneSweep.ts`, L4) measured. It imports L0 alone.
 *
 * A STRICT SUBSET OF HIBERNATION (D-5242, plan Tasks 16 to 19, spec §5.11), on purpose: every hold below that
 * hibernation also has carries hibernation's own word (`HIBERNATE_HOLDS`, Task 17a), so when hibernation lands this
 * lane is absorbed by it — the same population, the same holds, with `hibernate` (which a viewer's open screen wakes)
 * in place of `stop` (which a re-dispatch's `ensure` wakes). The words that are this lane's alone say why the lane is
 * narrower: only a dispatched child (`not-a-child`), only once its newest run is `done` (`no-run`, `not-done`,
 * `close-unplaced`) and a grace has passed (`grace`), and only through a declared stop (`no-surface`).
 */

/** Every reason the lane leaves a session running this pass — a `Record`, so the list below is derived and a word
 *  cannot be added without its meaning. Retried every pass; none is a terminal state. */
const STOP_DONE_HOLD_MAP = {
  'not-a-child': 'no child marker: the operator\'s own session, or a coordinator — only dispatched children are stopped',
  'child-unreadable': 'the child marker could not be read',
  archived: 'archived: the archive already stopped it',
  stopped: 'already stopped (the registry carries its stop stamp)',
  unmeasured: 'its identity or its status was not measured',
  held: 'a hold stands: a programme declares it mid-flight',
  stranded: 'stranded by an automatic swap',
  'swap-blocked': 'a swap was refused for it',
  substrate: 'a substrate marker stands',
  'runs-unreadable': 'the coordination store could not answer its runs',
  'no-run': 'no run names it as worker',
  'not-done': 'its newest run is not `done`',
  'close-unplaced': 'its newest run reads `done` with no close time',
  grace: 'its run closed less than the grace ago',
  'run-worker': 'another open run names it as worker',
  'run-claimant': 'it claims an open run (it coordinates)',
  claim: 'it holds a live claim',
  mail: 'mail to it is outstanding',
  viewer: 'somebody has it on screen, or the server started too recently to know',
  menu: 'a pane menu is pending',
  bucket: 'its bucket is not `idle` (a `done` row is badged: its result may be unread)',
  background: 'background work is running',
  roster: 'subagents are running',
  'no-surface': 'this box\'s ccd cannot record a declared stop surface',
  pane: 'no live pane to stop',
  'live-word': 'its live word is not `idle`',
  turn: 'the fail-closed turn verdict is not `idle`',
} as const satisfies Record<string, string>;

export type StopDoneHold = keyof typeof STOP_DONE_HOLD_MAP;
export const STOP_DONE_HOLDS: readonly StopDoneHold[] = Object.keys(STOP_DONE_HOLD_MAP) as StopDoneHold[];
export function stopDoneHoldText(h: StopDoneHold): string { return STOP_DONE_HOLD_MAP[h]; }

/** How long after its run's close a worker is left alone, whatever else it reads — room for the coordinator's next
 *  wave to be opened onto it (`run-worker` then holds it). */
export const STOP_DONE_GRACE_MS = 10 * 60_000;

/** At most this many stops a pass, fleet-wide: a herd of stops is a herd of supervisors restarting on a re-dispatch,
 *  and a slower drain costs nothing (the 2026-08-14 usage-scan herd). */
export const STOP_DONE_PER_PASS = 3;

/** At most this many candidates have their live state read a pass (tmux and live-file reads each). */
export const STOP_DONE_MEASURES_PER_PASS = 6;

/** The lane's own cadence, off the watcher's tick. */
export const STOP_DONE_SWEEP_MS = 60_000;

/** After a stop the box refused, the lane does not ask again for this long. In memory only: a restart asks once more. */
export const STOP_DONE_RETRY_MS = 60 * 60_000;

/** The kill switch: while `$REG/stop-done-disabled` is listed the lane does nothing at all. The operator's to touch and
 *  remove BY HAND — nothing in the tree writes it (`single-definition.test.ts`). */
export const STOP_DONE_DISABLED_MARKER = 'stop-done-disabled';

/** The registry row's facts the verdict reads — the fleet frame's own row, so the lane sees what the PWA shows. */
export type StopDoneRow = Pick<FleetSession,
  'id' | 'archivedAt' | 'held' | 'stoppedBy' | 'unmeasured' | 'statusUnmeasured' | 'dialogPending' | 'background'
  | 'subagents' | 'stranded' | 'swapBlocked' | 'substrate' | 'child' | 'bucket'>;

/** The coordination store's answers for one session, read once a pass (and again at the act). */
export type StopDoneStoreRead =
  | { readonly ok: false; readonly detail: string }
  | {
    readonly ok: true;
    /** The session's NEWEST run as worker (`lastRunBySession`), or null when no run names it. */
    readonly last: { readonly runId: number; readonly state: string; readonly closedAt: number | null } | null;
    readonly openWorker: boolean;
    readonly openClaimant: boolean;
    readonly claim: boolean;
    readonly mail: boolean;
  };

/** The live reads, made only for a session every other hold has passed. `unread` asks the sweep to make them. */
export type StopDoneLive =
  | { readonly kind: 'unread' }
  | {
    readonly kind: 'read';
    /** `liveWordFor`'s answer, the RAW word; `no-pane`/`no-config-dir`/`unmeasured` when it gave none. */
    readonly word: { readonly ok: true; readonly word: string } | { readonly ok: false; readonly reason: 'no-pane' | 'no-config-dir' | 'unmeasured' };
    /** `turnVerdictFor`'s answer. */
    readonly turn: 'idle' | 'busy' | 'unmeasured';
  };

export interface StopDoneInput {
  readonly row: StopDoneRow;
  readonly store: StopDoneStoreRead;
  /** `Presence.isVisible` for this id. */
  readonly viewer: boolean;
  /** Milliseconds since the server started: presence is never persisted, so a viewer that has not reconnected yet
   *  reads as none for one presence TTL after a start. */
  readonly sinceStartMs: number;
  readonly presenceTtlMs: number;
  /** `stopSurfaceSupported`: the box's ccd records `--surface`, so the stop is journaled as declared. */
  readonly surface: boolean;
  readonly live: StopDoneLive;
  readonly now: number;
  readonly graceMs: number;
}

export type StopDoneVerdict =
  | { readonly act: 'stop'; readonly runId: number }
  | { readonly act: 'measure' }
  | { readonly act: 'hold'; readonly reason: StopDoneHold };

/**
 * Stop this worker? The holds run cheapest first, and the live reads come last: `measure` asks the sweep to read them
 * for a session nothing else holds. Every read the verdict could not make HOLDS — never an unmeasured stop.
 */
export function stopDoneVerdict(i: StopDoneInput): StopDoneVerdict {
  const hold = (reason: StopDoneHold): StopDoneVerdict => ({ act: 'hold', reason });
  const r = i.row;
  if (r.child.kind === 'none') return hold('not-a-child');
  if (r.child.kind === 'unreadable') return hold('child-unreadable');
  if (r.archivedAt !== null) return hold('archived');
  if (r.stoppedBy !== null) return hold('stopped');
  if (r.unmeasured.length > 0 || r.statusUnmeasured) return hold('unmeasured');
  if (r.held !== null) return hold('held');
  if (r.stranded !== null) return hold('stranded');
  if (r.swapBlocked !== null) return hold('swap-blocked');
  if (r.substrate !== null) return hold('substrate');
  const s = i.store;
  if (!s.ok) return hold('runs-unreadable');
  if (s.last === null) return hold('no-run');
  if (s.last.state !== 'done') return hold('not-done');
  if (s.last.closedAt === null) return hold('close-unplaced');
  if (i.now - s.last.closedAt < i.graceMs) return hold('grace');
  if (s.openWorker) return hold('run-worker');
  if (s.openClaimant) return hold('run-claimant');
  if (s.claim) return hold('claim');
  if (s.mail) return hold('mail');
  if (i.viewer || i.sinceStartMs < i.presenceTtlMs) return hold('viewer');
  if (r.dialogPending) return hold('menu');
  if (r.bucket !== 'idle') return hold('bucket');
  if (r.background !== null) return hold('background');
  if (r.subagents !== null && r.subagents.length > 0) return hold('roster');
  if (!i.surface) return hold('no-surface');
  if (i.live.kind === 'unread') return { act: 'measure' };
  const w = i.live.word;
  if (!w.ok) return hold(w.reason === 'unmeasured' ? 'unmeasured' : 'pane');
  if (w.word !== 'idle') return hold('live-word');
  if (i.live.turn !== 'idle') return hold(i.live.turn === 'unmeasured' ? 'unmeasured' : 'turn');
  return { act: 'stop', runId: s.last.runId };
}

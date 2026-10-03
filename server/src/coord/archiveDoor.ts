/**
 * The archive door's decision (workspace lifecycle spec §5.2): `POST /api/sessions/:id/archive` is ONE "Archive" for
 * both kinds of row. `server.ts` measures (the registry row, the live row, the worktree, the verb) and acts (the stop
 * argv, `ws-archive`); everything that DECIDES lives here, so the route stays a wiring of measurements to acts.
 *
 * L1 in close.ts's sense, not pure: the coordination half reads the store and ends a programme through a declared
 * port (`ArchiveCoordPort`, declared by this consumer), and `server.ts` runs `decideArchive` on the coordination
 * serialiser (`CoordRoutesHandle.withAbandon`). No fs, no fastify, no clock.
 *
 * THE ORDER IS THE CONTRACT: every check that can refuse runs before any act that cannot be undone (spec §5.2, §8).
 * `decideArchive` refuses, in order: a turn in progress without `interrupt`; a workspace whose worktree this box
 * PROVED gone; a run naming the session as its WORKER, without `force` (the existing door, unchanged); a
 * non-terminal run naming it as CLAIMANT, without `programme:'end'`, or an unreadable store either way (fail-shut,
 * `runs: []` — a store read that THROWS is unreadable too, never a 500); a box whose ccd predates `ws-archive`; and,
 * with `programme:'end'`, any run the abandon arm could not move from its row alone (`abandonRefusal` — a run already
 * `closing`, the spec's own example), found before the first run is ended. Only then does it act, and its one act is
 * ending the programme (each run through the abandon door's own decision); an abandon that still refuses — or throws
 * — stops the door there, naming what it closed, with nothing stopped or archived. What remains for `server.ts` —
 * the stop argv, then `ws-archive` — is decided here too (`stop`, `wsArchive`), and `archiveOutcome` maps
 * `ws-archive`'s answer to the wire.
 *
 * The worker check sits ABOVE the verb gate on purpose, as it always has: a claimed workspace is refused as CLAIMED
 * even on a host whose ccd predates the verb — the claim is the more specific fact, and a 501 would send the operator
 * chasing a fleet upgrade that was never the obstacle.
 *
 * What no check here can see is what only ccd can measure — its own status read, the archive manifest and, on a
 * box that cannot read the worktree, the worktree itself (`worktreeOf`). ccd refuses those before ITS act, so an
 * archive refused there has stopped nothing unless `stop` was asked; when it was, the answer is the partial outcome
 * (`archived:false, stopped:true`), and when a programme was ended first, every answer after it says so (`ended`).
 * Spec §5.2 asks for EVERY refusable check before any act; these are the ones the server cannot run, by measurement.
 */
import {
  ARCHIVE_REFUSALS, archiveInterrupts, type ArchiveBody, type ArchiveRefusal, type FleetSession,
} from '../../../shared/api.js';
import type { MeasuredStat } from '../io.js';
import type { CloseOutcome } from './close.js';
import type { OpenSibling, OpenSiblingsResult } from './store.js';

/** The consents a request carries, read once. `force` and `interrupt` are honoured only as `true` (anything else is
 *  absent, as `force` always was); `programme` is `'end'` or absent — a consent to end a programme is exact or it is
 *  refused (`archiveFlags` answers `null` → 400). */
export interface ArchiveFlags {
  readonly force: boolean;
  readonly interrupt: boolean;
  readonly programmeEnd: boolean;
}

export function archiveFlags(raw: unknown): ArchiveFlags | null {
  if (raw === undefined || raw === null) return { force: false, interrupt: false, programmeEnd: false };
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  // Keyed by L0's `ArchiveBody`, the wire shape the PWA builds: a renamed consent is a compile error here.
  const b = raw as { readonly [K in keyof ArchiveBody]?: unknown };
  if (b.programme !== undefined && b.programme !== 'end') return null;
  return { force: b.force === true, interrupt: b.interrupt === true, programmeEnd: b.programme === 'end' };
}

/** What `server.ts` measured before deciding. `busy` is `archiveInterrupts` of the row assembled on the request;
 *  `worktree` and `verbSupported` are read for a workspace only (a main checkout never reaches `ws-archive`).
 *  `worktree: 'unmeasured'` is NOT a refusal: in remote mode — the live deployment — the fleet agent's read roots
 *  (`checkPath`) exclude `~/worktrees`, so this box can never stat a workspace's worktree there, and refusing on
 *  that would refuse every archive. ccd's own `[[ -d $workdir ]]` refusal, which precedes its act, measures it. */
export interface ArchiveMeasure {
  readonly workspace: boolean;
  readonly busy: boolean;
  readonly worktree: 'present' | 'absent' | 'unmeasured';
  readonly verbSupported: boolean;
}

/**
 * What `server.ts` read to answer "would a STOP nobody consented to interrupt lose a turn?" — every condition its own
 * word, never a null, because the rule below treats each as it must, and a reading that could not be made (`'unread'`,
 * `'unmeasured'`) is not one that came back empty (`'no-state'`, `'missing'`). `server.ts` skips only the reads a verdict
 * makes impossible — no pid unless the pane is `live`, no live file without a pid and a config dir — and decides nothing
 * about which reads matter.
 */
export type StopReadings =
  /** `tmux has-session` proved there is no pane — the one reading that needs nothing else. */
  | { readonly pane: 'gone' }
  /** tmux could not be asked (D-308: a server it cannot reach is not a dead session). */
  | { readonly pane: 'unknown' }
  | { readonly pane: 'live'; readonly pid: 'unread' }
  | { readonly pane: 'live'; readonly pid: number; readonly configDir: 'none' }
  | {
    readonly pane: 'live'; readonly pid: number; readonly configDir: 'present';
    readonly liveFile: LiveFileReading; readonly row: StopRowReading;
  };

/** `<configDir>/sessions/<pid>.json`, as `readLiveStateMeasured` answers it, with the status word kept as read. */
export type LiveFileReading =
  | { readonly read: 'ok'; readonly status: string }
  | { readonly read: 'no-state' }
  | { readonly read: 'unmeasured' };

/** The fleet frame's row for this session (`assembleFleet`, on the request): the two fields `archiveInterrupts` reads,
 *  or `'missing'` when the frame produced no row. */
export type StopRowReading = Pick<FleetSession, 'status' | 'bucket'> | 'missing';

/**
 * Whether a STOP nobody consented to interrupt would lose no turn — `_ws_status`'s own fail-closed rule (ccd/ccd),
 * decided over what `server.ts` measured (D-3878: it was `idleForStop`'s body in L4). It is read this way because
 * `cmd_stop` refuses nothing: for a main checkout this is the only guard there is, and for a workspace under
 * `programme:'end'` it is the only read that can refuse BEFORE the programme ends (`busyReadFailsClosed`, D-3877).
 * The frame's own row cannot answer it alone: it folds what it could not measure towards rest — tmux `unknown` reads
 * dead (D-309), an unread pane pid or an absent live file leaves `idle`.
 *
 * `gone` is the one idle without a further reading (no pane, nothing running). A live pane is idle only when ALL hold,
 * else it is busy: its pid was read; its wrapper has a config dir; its live file affirmatively reads `idle` (an
 * allowlist, as ccd's — `busy`, `waiting`, an absent file and an unread one all fail); and the frame's row exists and
 * reports no turn and no question (`archiveInterrupts`). tmux `unknown` is busy.
 */
export function stopIsIdle(r: StopReadings): boolean {
  if (r.pane === 'gone') return true;
  if (r.pane === 'unknown') return false;
  if (r.pid === 'unread' || r.configDir === 'none') return false;
  if (r.liveFile.read !== 'ok' || r.liveFile.status !== 'idle') return false;
  return r.row !== 'missing' && !archiveInterrupts(r.row);
}

/**
 * Which read answers `ArchiveMeasure.busy` — a DECISION, so it is made here and `server.ts` obeys it (D-3877). A
 * `true` is the fail-closed read, `stopIsIdle` over `StopReadings`; a `false` is the fleet frame's own row
 * (`archiveInterrupts`), with ccd's `_ws_status` behind it at `ws-archive`.
 *
 * - A main checkout: always fail-closed. Its stop refuses nothing, so this read is the only guard it has.
 * - A workspace that is to END its programme, with nobody having consented to `interrupt`: fail-closed too. The end is
 *   the one act that cannot be undone, and the frame's row folds what it could not measure towards rest — tmux
 *   `unknown`, an unread pid, an absent live file — so reading it here would end the programme and THEN have
 *   `ws-archive`'s fail-closed status refuse `session-busy`/`status-unknown`. `interrupt` is the consent to lose the turn,
 *   so with it the read has nothing left to refuse.
 * - Any other workspace archive: the frame's row, as before; nothing irreversible runs ahead of ccd's own read.
 */
export function busyReadFailsClosed(workspace: boolean, flags: ArchiveFlags): boolean {
  return !workspace || (flags.programmeEnd && !flags.interrupt);
}

/** A worktree's measured presence (D-114: absent and unreadable are two facts, and only the first is "gone"). A
 *  stat the agent refused as outside its read roots arrives as `unreadable` (`remote/io.ts`), so it is `unmeasured`. */
export function worktreeOf(s: MeasuredStat): ArchiveMeasure['worktree'] {
  return s.ok ? 'present' : s.reason === 'absent' ? 'absent' : 'unmeasured';
}

/** The coordination reads and the one act — DECLARED BY THIS CONSUMER (L2). `server.ts` wires it over `CoordStore`
 *  and the two functions `CoordRoutesHandle.withAbandon` hands it; `null` on a box with no coordination database,
 *  which archives exactly as it did before coordination existed. */
export interface ArchiveCoordPort {
  openRunsForSession(sessionId: string): OpenSiblingsResult;
  openRunsClaimedBy(claimantId: string): OpenSiblingsResult;
  /** What the abandon arm would refuse for this run from its row alone, read without acting (close.ts's
   *  `abandonRefusal`); `null` when it can move it. */
  abandonRefusal(runId: number): Extract<CloseOutcome, { ok: false }> | null;
  abandon(runId: number): Promise<CloseOutcome>;
}

/** An answer the route sends as it stands. */
export interface ArchiveReply { readonly status: number; readonly body: Readonly<Record<string, unknown>> }

export type ArchiveDecision =
  | { readonly ok: false; readonly reply: ArchiveReply }
  | { readonly ok: true; readonly stop: boolean; readonly wsArchive: boolean; readonly ended: readonly OpenSibling[] };

const refuse = (status: number, error: ArchiveRefusal | 'unsupported', extra: Record<string, unknown> = {}):
  ArchiveDecision => ({ ok: false, reply: { status, body: { ok: false, error, ...extra } } });

const thrown = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A store read that THROWS — a `node:sqlite` error; `CoordMutex.run` is `try`/`finally` with no catch and there is no
 *  error handler, so it would leave as a bare 500 — is a store this box could not read, and refuses fail-shut exactly
 *  as one does (`runs: []`), never as a 500 the sheet cannot answer. */
const measured = (read: () => OpenSiblingsResult): OpenSiblingsResult => {
  try { return read(); } catch (e) { return { ok: false, kind: 'run-unreadable', detail: thrown(e) }; }
};

/** Why one abandon refused, in words a sheet can show: `closeRun`'s refusal kind, and its detail where it has one. */
export function closeRefusalOf(id: number, r: Extract<CloseOutcome, { ok: false }>):
  { readonly id: number; readonly kind: string; readonly detail?: string } {
  switch (r.kind) {
    case 'bad-transition': return { id, kind: r.kind, detail: `${r.from} → ${r.to}` };
    case 'refused': return { id, kind: r.kind, detail: r.code };
    case 'doneVerdict': return { id, kind: r.kind, detail: r.code };
    case 'hold-oversize': case 'hold-invalid': return { id, kind: r.kind, detail: r.detail };
    case 'fleetFailed': return { id, kind: r.kind, detail: r.stderr.trim() };
    default: return { id, kind: r.kind };
  }
}

export async function decideArchive(
  port: ArchiveCoordPort | null, id: string, flags: ArchiveFlags, m: ArchiveMeasure,
): Promise<ArchiveDecision> {
  if (m.busy && !flags.interrupt) return refuse(409, ARCHIVE_REFUSALS.sessionBusy);
  // A PROVEN absence only. `unmeasured` proceeds: see `ArchiveMeasure.worktree`.
  if (m.workspace && m.worktree === 'absent') return refuse(409, ARCHIVE_REFUSALS.worktreeGone);
  let claimed: readonly OpenSibling[] = [];
  if (port !== null) {
    if (!flags.force) {
      const worker = measured(() => port.openRunsForSession(id));
      // D-2545: refused as CLAIMED with an EMPTY `runs` — the field's shape does not change with the condition.
      if (!worker.ok) return refuse(409, ARCHIVE_REFUSALS.runOpen, { runs: [] });
      if (worker.siblings.length > 0) return refuse(409, ARCHIVE_REFUSALS.runOpen, { runs: worker.siblings });
    }
    const coordinates = measured(() => port.openRunsClaimedBy(id));
    // Fail-shut, with or without `programme:'end'`: a programme this box cannot enumerate cannot be ended.
    if (!coordinates.ok) return refuse(409, ARCHIVE_REFUSALS.coordinatorHasOpenRuns, { runs: [] });
    claimed = coordinates.siblings;
    if (claimed.length > 0 && !flags.programmeEnd) {
      return refuse(409, ARCHIVE_REFUSALS.coordinatorHasOpenRuns, { runs: claimed });
    }
  }
  if (m.workspace && !m.verbSupported) return refuse(501, 'unsupported');
  // The last check: every run the abandon arm could not move from its row alone, found BEFORE the first is ended —
  // otherwise whether a programme is left partly ended would depend on run id order. Nothing is ended here.
  for (const run of claimed) {
    let why: Extract<CloseOutcome, { ok: false }> | null;
    try { why = port!.abandonRefusal(run.id); } catch (e) {
      return refuse(409, ARCHIVE_REFUSALS.programmePartlyEnded,
        { closed: [], notClosed: claimed, refusal: { id: run.id, kind: 'threw', detail: thrown(e) } });
    }
    if (why !== null) {
      return refuse(409, ARCHIVE_REFUSALS.programmePartlyEnded,
        { closed: [], notClosed: claimed, refusal: closeRefusalOf(run.id, why) });
    }
  }
  // THE ONE ACT THIS FUNCTION TAKES, and the last thing it does. In id order; the first refusal stops the door, so a
  // partly ended programme is never followed by a stop or an archive. An abandon that THROWS after an earlier one
  // ended its run answers the same way, naming what was closed, rather than leaving as a 500 that names nothing.
  const ended: OpenSibling[] = [];
  for (const [i, run] of claimed.entries()) {
    let out: CloseOutcome;
    try { out = await port!.abandon(run.id); } catch (e) {
      return refuse(409, ARCHIVE_REFUSALS.programmePartlyEnded,
        { closed: ended, notClosed: claimed.slice(i), refusal: { id: run.id, kind: 'threw', detail: thrown(e) } });
    }
    if (!out.ok) {
      return refuse(409, ARCHIVE_REFUSALS.programmePartlyEnded,
        { closed: ended, notClosed: claimed.slice(i), refusal: closeRefusalOf(run.id, out) });
    }
    ended.push(run);
  }
  return { ok: true, stop: flags.interrupt || !m.workspace, wsArchive: m.workspace, ended };
}

/**
 * The stop's own busy re-read refused (`server.ts`: a stop nobody consented to interrupt — a main checkout's — re-reads
 * busy fail-closed at the act, because `cmd_stop` refuses nothing). A turn began after the door's first read: during
 * the claim reads, the mutex wait or the programme end. `409 session-busy`, carrying the runs already ended, so the
 * busy question that follows never reads as "nothing happened".
 */
export function busyAtStop(ended: readonly OpenSibling[]): ArchiveReply {
  return { status: 409, body: { ok: false, error: ARCHIVE_REFUSALS.sessionBusy, ...(ended.length > 0 ? { ended } : {}) } };
}

/**
 * ccd's refusal of `ws-archive`, as the door's word for it — or `null` for one this build has no word for. Read off
 * `cmd_ws_archive`'s own `die` lines (`ccd: <message>`), which `archive-ccd-words.test.ts` produces by running the
 * real verb in a fixture HOME, so a reworded ccd reds there rather than silently losing its word here.
 */
export function ccdArchiveRefusal(stderr: string): ArchiveRefusal | null {
  const lines = stderr.split('\n').map((l) => l.trim());
  if (lines.includes('ccd: session-busy')) return ARCHIVE_REFUSALS.sessionBusy;
  if (lines.includes('ccd: status-unknown')) return ARCHIVE_REFUSALS.statusUnknown;
  if (lines.some((l) => l.startsWith('ccd: worktree is gone: '))) return ARCHIVE_REFUSALS.worktreeGone;
  if (lines.some((l) => /^ccd: (cannot describe \S+ truthfully|empty archive manifest for \S+|archive manifest for \S+ is not valid JSON) — nothing was touched$/.test(l))) {
    return ARCHIVE_REFUSALS.manifestUnbuildable;
  }
  return null;
}

/**
 * `ws-archive`'s answer on the wire, once the door has acted. Success is `archived:true`. A refusal AFTER the door
 * stopped the session is the partial outcome — `200 {archived:false, stopped:true, refusal}`: the row is a stopped,
 * unarchived workspace, visible at the top level with Archive offered again. A refusal with nothing stopped is a 409
 * with ccd's word (`detail` carries its sentence), or today's 502 `{stderr}` when this build has no word for it.
 * `ended` rides every answer once a programme was ended, so the operator is never told only half of what happened.
 */
export function archiveOutcome(
  stopped: boolean, ended: readonly OpenSibling[], res: { ok: boolean; stderr: string },
): ArchiveReply {
  if (res.ok) return { status: 200, body: { ok: true, archived: true, stopped, ended } };
  const refusal = ccdArchiveRefusal(res.stderr);
  const detail = res.stderr.trim();
  if (stopped) return { status: 200, body: { ok: true, archived: false, stopped: true, ended, refusal, detail } };
  const endedSpread = ended.length > 0 ? { ended } : {};
  if (refusal !== null) return { status: 409, body: { ok: false, error: refusal, detail, ...endedSpread } };
  return { status: 502, body: { ok: false, stderr: res.stderr, ...endedSpread } };
}

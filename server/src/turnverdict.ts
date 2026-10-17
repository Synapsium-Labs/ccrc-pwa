/**
 * The turn reads' ONE home (D-5238): "what turn would this act lose?", read on the request, for every caller that
 * asks it — the archive door and the interrupt route (`server.ts`, D-5236), and the dispatch resume arm's `/clear`
 * gate (`coord/dispatch.ts`, through its required `DispatchRunDeps.turnVerdict` port, wired in `coord/routes.ts`).
 * Moved out of `server.ts`'s closure so a second caller reads the SAME reads instead of a copy that drifts.
 *
 * L3: it reads tmux, the live file, the hookstate and `assembleFleet`; it DECIDES nothing — `stopVerdict`
 * (`coord/archiveDoor.ts`, L1) holds the rule and its reasoning. The watcher's pane-scraped reads arrive as THUNKS,
 * read at call time, so a call never sees a snapshot captured when the deps object was built.
 */
import { configDirFor, type CcrcConfig } from './config.js';
import type { Tmux } from './exec.js';
import type { FleetIO } from './io.js';
import { assembleFleet } from './fleet.js';
import type { FleetWatcher } from './watch.js';
import type { SessionRecord } from './registry.js';
import { readHookState } from './hookstate.js';
import { readLiveStateMeasured } from './livestate.js';
import type { FleetSession } from '../../shared/api.js';
import {
  stopVerdict, type LiveFileReading, type StopRowReading, type TurnVerdict,
} from './coord/archiveDoor.js';

export interface TurnReadDeps {
  io: FleetIO; cfg: CcrcConfig; tmux: Tmux;
  /** The watcher's newest pane-scraped reads, read at call time (thunks, so a call never sees a stale snapshot
   *  captured when the deps object was built); `undefined` when no watcher runs, as today. */
  pendingDialogs: () => ReadonlySet<string> | undefined;
  statuslines: () => ReturnType<FleetWatcher['currentStatuslines']> | undefined;
}

/** `TurnReadDeps` over an optional watcher — the one spelling of the two thunks, for `server.ts` and
 *  `coord/routes.ts` alike. */
export function turnReadDeps(
  base: { io: FleetIO; cfg: CcrcConfig; tmux: Tmux },
  watcher: Pick<FleetWatcher, 'currentPending' | 'currentStatuslines'> | undefined,
): TurnReadDeps {
  return {
    io: base.io, cfg: base.cfg, tmux: base.tmux,
    pendingDialogs: () => watcher?.currentPending(),
    statuslines: () => watcher?.currentStatuslines(),
  };
}

/**
 * The row the fleet frame would assemble for ONE session, measured on the request — the archive door's busy read
 * (workspace lifecycle §5.2: "read from the same live state the fleet frame uses: status/hookState, re-read on the
 * request, for both kinds of row"). `assembleFleet` over this one registry row, so its tmux and live-file reads and
 * its bucket ladder are the frame's own, with this session's hook state read from disk now rather than taken from
 * the watcher's last sweep. The pane-scraped pieces (a dialog menu, a Workflow row) are the watcher's newest. No
 * `coord`: no field `archiveInterrupts` reads comes from it.
 */
export async function liveRowFor(d: TurnReadDeps, rec: SessionRecord, uuid: string): Promise<FleetSession | null> {
  return (await liveRowWithHookFor(d, rec, uuid)).row;
}

/** `liveRowFor`'s row with the stamp and event of the hook state it was assembled from (`updatedAt`, the stamp D-75
 *  compares with the live file's, and `event`), which the row does not carry: ONE hookstate read for all three, so they
 *  cannot disagree. Null when no fresh hook state was read. The interrupt route's reads (D-5236). */
export async function liveRowWithHookFor(d: TurnReadDeps, rec: SessionRecord, uuid: string):
Promise<{ row: FleetSession | null; hookUpdatedAt: number | null; hookEvent: string | null }> {
  const hs = await readHookState(d.io, d.cfg.registryDir, rec.id, uuid, Date.now());
  const [row] = await assembleFleet(d.io, d.cfg, d.tmux, undefined, d.pendingDialogs(),
    d.statuslines(), undefined, undefined, new Map(hs === null ? [] : [[rec.id, hs]]), [rec]);
  return { row: row ?? null, hookUpdatedAt: hs?.updatedAt ?? null, hookEvent: hs?.event ?? null };
}

/** The pane reads in ccd's order, each skipped only when an earlier answer makes it impossible: the wrapper's config
 *  dir, the tmux verdict, the pane pid, the live file. The one sequence both exports below read. */
type PaneReads =
  | { configDir: 'none' }
  | { configDir: 'present'; pane: 'gone' | 'unknown' }
  | { configDir: 'present'; pane: 'live'; pid: 'unread' }
  | { configDir: 'present'; pane: 'live'; pid: number; liveFile: LiveFileReading; since: number | null };

async function readPane(d: TurnReadDeps, rec: SessionRecord): Promise<PaneReads> {
  const cfgDir = configDirFor(d.cfg, rec.wrapper);
  if (cfgDir === undefined) return { configDir: 'none' };
  const v = await d.tmux.sessionVerdict(rec.id);
  if (v.verdict !== 'live') return { configDir: 'present', pane: v.verdict };
  const pid = await d.tmux.panePid(rec.id);
  if (pid === null) return { configDir: 'present', pane: 'live', pid: 'unread' };
  const read = await readLiveStateMeasured(d.io, cfgDir, pid);
  const liveFile: LiveFileReading = read.ok ? { read: 'ok', status: read.state.status } : { read: read.reason };
  return { configDir: 'present', pane: 'live', pid, liveFile, since: read.ok ? read.state.statusUpdatedAt : null };
}

/**
 * The session's RAW live word — the status its live file carries, never `liveStatus()`'s collapse — with the file's
 * `statusUpdatedAt`. `no-pane` is a pane tmux proved gone; `no-config-dir` a wrapper this roster does not carry;
 * everything that could not be read (tmux unreachable, an unread pid, an absent, unreadable or malformed live file) is
 * `unmeasured`.
 */
export async function liveWordFor(d: TurnReadDeps, rec: SessionRecord):
Promise<{ ok: true; word: string; since: number | null } | { ok: false; reason: 'no-pane' | 'no-config-dir' | 'unmeasured' }> {
  const r = await readPane(d, rec);
  if (r.configDir === 'none') return { ok: false, reason: 'no-config-dir' };
  if (r.pane === 'gone') return { ok: false, reason: 'no-pane' };
  if (r.pane !== 'live' || r.pid === 'unread' || r.liveFile.read !== 'ok') return { ok: false, reason: 'unmeasured' };
  return { ok: true, word: r.liveFile.status, since: r.since };
}

/**
 * The READS behind "what turn would a STOP lose?" (`stopVerdict`, `coord/archiveDoor.ts`, D-3878, holds the rule and
 * its reasoning, and since 3881 answers idle, busy or unmeasured): the wrapper's config dir FIRST (a pure config
 * lookup, in ccd's order — F2), then the tmux verdict, then — only for a `live` pane — its pid and its live file, then
 * the frame's row. A read a verdict makes impossible is skipped, never faked; which reads MATTER is the rule's to say,
 * so none is skipped for being redundant. Read FAIL-CLOSED because `cmd_stop` refuses nothing: for a main checkout
 * this is the only guard there is. Its second caller is a workspace whose programme is to end or that is archived with
 * `interrupt` (`busyReadFailsClosed`, D-3877, F7), where it is the only read that can refuse before that end or stop;
 * every other workspace keeps `ws-archive`'s own fail-closed `_ws_status` behind the door. Its third is the dispatch
 * resume arm's `/clear` gate (D-5238), at the gate and again immediately before the act. `liveRowFor` cannot answer
 * it alone: the frame folds what it could not measure towards rest.
 */
export async function turnVerdictFor(d: TurnReadDeps, rec: SessionRecord, uuid: string): Promise<TurnVerdict> {
  const r = await readPane(d, rec);
  if (r.configDir === 'none') return stopVerdict({ configDir: 'none' });
  if (r.pane !== 'live') return stopVerdict({ configDir: 'present', pane: r.pane });
  if (r.pid === 'unread') return stopVerdict({ configDir: 'present', pane: 'live', pid: 'unread' });
  const row: StopRowReading = (await liveRowFor(d, rec, uuid)) ?? 'missing';
  return stopVerdict({ configDir: 'present', pane: 'live', pid: r.pid, liveFile: r.liveFile, row });
}

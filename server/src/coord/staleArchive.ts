import type { SessionRecord } from '../registry.js';
import type { FleetState } from '../fleetstate.js';
import type { Presence } from '../presence.js';
import type { CoordStore } from './store.js';
import type { RunCcd } from './ports.js';
import type { NoticeRecord } from '../notice.js';
import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import { configDirFor } from '../config.js';
import { ARCHIVE_IF_NO_PANE_CAP, CCD_ARGV, capSupported, sweepDec } from '../ccdargv.js';
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import { readSwitches } from '../../../shared/switches.js';
import {
  STALE_ARCHIVE_LIVE_MARKER, staleArchiveVerdict, type StaleArchiveFacts, type StaleArchiveSkip,
} from '../archivedExpiry.js';

/**
 * THE STALE-ARCHIVE ARM (fleet disk retention, D-6643; spec 2026-10-23 §2.7.5, G1): a workspace that is not a child and
 * was never a claimant, with no pane for 14 days, is archived. It is the only lane that archives; archive starts
 * expiry's own seven days, so nothing here deletes a file. `staleArchiveVerdict` (`archivedExpiry.ts`, L1) holds the
 * rule; this file GATHERS its facts and ACTS, and decides nothing.
 *
 * ONE PASS (`FleetWatcher.sweepStaleArchive`, hourly), on the tick's own registry rows and listing:
 *  1. `reclaim-paused` raised, a listing that did not come, or a box that does not advertise `archive-if-no-pane-v1`
 *     and the actor flags: the sightings are forgotten and nothing else happens, so a row needs two fresh sightings
 *     once the pause lifts;
 *  2. per row that passes the cheap conjuncts (a workspace, not archived, no child mark, no hold, never a claimant:
 *     `childReclaimCoordinatorClaims` and `openCoordinatorIds`, ANY past claim keeps), the pane is asked and the
 *     sighting kept or dropped; only a row seen absent gathers its evidence (the journal's newest `spawn`, `start` or
 *     `supervise`, `.supervised`, `.spawn`, `.woke` and the transcript's mtime);
 *  3. SHADOW (no `$REG/stale-archive-live`): a row that would be archived is recorded once, as a feed row, and
 *     nothing is composed. ARMED: at most ONE act a pass, fleet-wide, the longest-idle first, on the session's queue,
 *     presence re-read there, composing `ws-archive --session <id> --if-no-pane --reason stale`. The flag is the
 *     last guard: ccd refuses `live` when a pane or an active unit exists, so an archive can never kill a pane that
 *     came back. That answer is recorded in the outcome and nothing else, and the sightings start again.
 *  4. There is no mail: the session is not running.
 *
 * The marker has NO WRITER in the tree (`single-definition.test.ts`): the operator touches it by hand.
 */

/** The arm's cadence: hourly, which is also the gap between the two sightings a row needs. */
export const STALE_ARCHIVE_SWEEP_MS = 60 * 60_000;
/** The lane `ws-archive` records in its trail. */
export const STALE_ARCHIVE_ACTOR = 'sweep:stale-archive';
/** Journal acts that say a workspace ran or was brought up. */
const RUN_ACTS: readonly string[] = ['spawn', 'start', 'supervise'];
/** How many of a session's newest journal rows are read for them. */
const JOURNAL_ROWS = 500;

export interface StaleArchiveDeps {
  /** Undefined without a coordination store: the claims cannot be read, so every row is kept. */
  readonly coord: Pick<CoordStore, 'childReclaimCoordinatorClaims' | 'openCoordinatorIds' | 'lifecycleFor'> | undefined;
  /** Undefined: every row has a viewer (fail closed). */
  readonly presence: Pick<Presence, 'isVisible'> | undefined;
  /** The feed, `record-only`, bound by the composition root. */
  readonly notice: (event: NoticeRecord) => void;
  readonly runCcd: RunCcd;
  readonly fleetState: FleetState | undefined;
  /** tmux's answer for the id: `absent` only when it proved the session gone. */
  readonly pane: (rec: SessionRecord) => Promise<'absent' | 'present' | 'unmeasured'>;
  /** The current transcript's mtime (ms): `none` when the file is proven absent, `unreadable` when it could not be read. */
  readonly transcriptMtimeMs: (rec: SessionRecord) => Promise<number | 'none' | 'unreadable'>;
  /** `$REG/<id>.woke` as ms, or null. */
  readonly wokeAtMs: (rec: SessionRecord) => Promise<number | null>;
  readonly queueRun: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  readonly log: (line: string) => void;
  readonly now: () => number;
}

/** In memory only: a restart forgets it and the arm asks for two fresh sightings again, which only delays an archive. */
export interface StaleArchiveMemory {
  readonly sightings: Map<string, { firstAt: number; lastAt: number }>;
  /** Ids already recorded as "would archive" in the current unbroken run of eligible passes. */
  readonly would: Set<string>;
}

export type StaleArchiveOutcome =
  | { readonly kind: 'archived'; readonly id: string }
  | { readonly kind: 'would-archive'; readonly id: string }
  | { readonly kind: 'live-at-act'; readonly id: string }
  | { readonly kind: 'deferred'; readonly id: string; readonly why: StaleArchiveSkip | 'cap' }
  | { readonly kind: 'failed'; readonly id: string; readonly detail: string };

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The journal's newest run act for one session (ms), or null: no rows, no stamped rows, or a read that failed. */
function journalEvidence(coord: NonNullable<StaleArchiveDeps['coord']>, id: string): number | null {
  let newest: number | null = null;
  for (const e of coord.lifecycleFor({ sessionId: id, limit: JOURNAL_ROWS })) {
    if (e.at !== null && RUN_ACTS.includes(e.act) && (newest === null || e.at > newest)) newest = e.at;
  }
  return newest;
}

/** The newest sign this workspace ran, or null when nothing can be said. A transcript that could not be read makes it
 *  null, because the file might be the newest sign: doubt keeps. */
async function evidenceFor(deps: StaleArchiveDeps, coord: NonNullable<StaleArchiveDeps['coord']>, rec: SessionRecord): Promise<number | null> {
  const stamps: number[] = [];
  try {
    const j = journalEvidence(coord, rec.id);
    if (j !== null) stamps.push(j);
    if (rec.supervisedAt !== null) stamps.push(rec.supervisedAt * 1000);
    if (rec.spawn !== null) stamps.push(rec.spawn.at * 1000);
    const woke = await deps.wokeAtMs(rec);
    if (woke !== null) stamps.push(woke);
    const t = await deps.transcriptMtimeMs(rec);
    if (t === 'unreadable') return null;
    if (t !== 'none') stamps.push(t);
  } catch {
    return null;
  }
  return stamps.length === 0 ? null : Math.max(...stamps);
}

export async function staleArchivePass(
  deps: StaleArchiveDeps, mem: StaleArchiveMemory, records: readonly SessionRecord[], names: readonly string[] | null,
): Promise<StaleArchiveOutcome[]> {
  const out: StaleArchiveOutcome[] = [];
  const forget = (): void => { mem.sightings.clear(); mem.would.clear(); };
  const dec = sweepDec(deps.fleetState, STALE_ARCHIVE_ACTOR);
  // ONE — the pause, the listing and the capability. A listing that did not come cannot rule a raised pause out.
  if (names === null || readSwitches(names)[RECLAIM_PAUSE_MARKER] === 'set' || deps.coord === undefined
      || dec === null || !capSupported(deps.fleetState, ARCHIVE_IF_NO_PANE_CAP)) {
    forget();
    return out;
  }
  const live = readSwitches(names)[STALE_ARCHIVE_LIVE_MARKER] === 'set';
  const coord = deps.coord;
  const now = deps.now();
  let everClaimed: ReadonlySet<string> | null;
  try {
    everClaimed = new Set([...coord.childReclaimCoordinatorClaims().keys(), ...coord.openCoordinatorIds()]);
  } catch (err) {
    deps.log(`ccrc-server: stale-archive: the claims did not read (${errText(err)}) — nothing is archived this pass`);
    everClaimed = null;
  }
  // TWO — the sightings and the verdicts.
  const due: { rec: SessionRecord; evidenceAtMs: number }[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    if (rec.workspace === null || rec.archivedAt !== null) continue;
    seen.add(rec.id);
    // The cheap conjuncts first: a row that cannot be eligible costs no pane read.
    if (everClaimed === null || rec.child.kind !== 'none' || rec.held !== null || everClaimed.has(rec.id)
        || rec.unmeasured.length > 0) {
      mem.sightings.delete(rec.id);
      mem.would.delete(rec.id);
      continue;
    }
    let pane: StaleArchiveFacts['pane'];
    try { pane = await deps.pane(rec); } catch { pane = 'unmeasured'; }
    if (pane !== 'absent') {
      mem.sightings.delete(rec.id);
      mem.would.delete(rec.id);
      continue;
    }
    const had = mem.sightings.get(rec.id);
    const sightings = { firstAt: had?.firstAt ?? now, lastAt: now };
    mem.sightings.set(rec.id, sightings);
    const evidenceAtMs = await evidenceFor(deps, coord, rec);
    const v = staleArchiveVerdict(
      { workspace: rec.workspace, archivedAt: rec.archivedAt, child: rec.child, identityMeasured: rec.unmeasured.length === 0, held: rec.held },
      { claims: 'never', pane, sightings, viewer: deps.presence?.isVisible(rec.id) !== false, evidenceAtMs },
      now);
    if (!v.eligible) { mem.would.delete(rec.id); continue; }
    due.push({ rec, evidenceAtMs: evidenceAtMs! });
  }
  for (const id of [...mem.sightings.keys()]) if (!seen.has(id)) { mem.sightings.delete(id); mem.would.delete(id); }
  if (due.length === 0) return out;
  due.sort((a, b) => a.evidenceAtMs - b.evidenceAtMs || (a.rec.id < b.rec.id ? -1 : 1));
  // THREE — shadow records every due row once; armed acts on the longest idle, ONE a pass.
  if (!live) {
    for (const { rec, evidenceAtMs } of due) {
      out.push({ kind: 'would-archive', id: rec.id });
      if (mem.would.has(rec.id)) continue;
      mem.would.add(rec.id);
      deps.notice({
        kind: 'coord', sessionId: '', runId: null, title: 'Would archive a stale workspace',
        body: `${rec.id} has had no pane for ${Math.floor((now - evidenceAtMs) / 86_400_000)} days, was never a coordinator, and would be archived (shadow: the arm is not armed).`,
      });
    }
    return out;
  }
  const { rec } = due[0]!;
  out.push(await act(deps, mem, rec, dec));
  return out;
}

/** The act, on the session's queue: presence once more, then `ws-archive --if-no-pane --reason stale`. */
async function act(
  deps: StaleArchiveDeps, mem: StaleArchiveMemory, rec: SessionRecord, dec: NonNullable<ReturnType<typeof sweepDec>>,
): Promise<StaleArchiveOutcome> {
  const id = rec.id;
  return deps.queueRun(id, async (): Promise<StaleArchiveOutcome> => {
    if (deps.presence?.isVisible(id) !== false) return { kind: 'deferred', id, why: 'viewer' };
    let res: Awaited<ReturnType<RunCcd>>;
    try {
      res = await deps.runCcd(CCD_ARGV.wsArchive(id, { ...dec, reason: 'stale' }, { ifNoPane: true }));
    } catch (err) {
      return { kind: 'failed', id, detail: errText(err) };
    }
    if (res.ok) {
      mem.sightings.delete(id);
      mem.would.delete(id);
      deps.notice({
        kind: 'coord', sessionId: '', runId: null, title: 'Archived a stale workspace',
        body: `${id} had no pane for 14 days and was never a coordinator, so it was archived. Its seven days to expiry have started.`,
      });
      return { kind: 'archived', id };
    }
    if (/^ccd: live\s*$/m.test(res.stderr)) {
      mem.sightings.delete(id);
      mem.would.delete(id);
      deps.log(`ccrc-server: stale-archive: ${id} has a pane again — kept`);
      return { kind: 'live-at-act', id };
    }
    deps.log(`ccrc-server: stale-archive: archiving ${id} failed (${res.stderr.trim().slice(0, 200)}) — asked again next pass`);
    return { kind: 'failed', id, detail: res.stderr.trim().slice(0, 200) };
  });
}

// ── the arm's two reads that are not the store's (the watcher binds them) ───────────────────────────────────────────

/** `StaleArchiveDeps.pane` from the turn reads' raw live word: only a pane tmux proved gone is `absent`; a pane up is
 *  `present`; every other answer (no config dir, tmux unreachable, an unread pid or live file) is `unmeasured`. */
export function paneFromLiveWord(
  w: { readonly ok: true } | { readonly ok: false; readonly reason: 'no-pane' | 'no-config-dir' | 'unmeasured' },
): 'absent' | 'present' | 'unmeasured' {
  return w.ok ? 'present' : w.reason === 'no-pane' ? 'absent' : 'unmeasured';
}

/** `StaleArchiveDeps.transcriptMtimeMs`: the resolver's path for the session's current transcript, then a MEASURED stat.
 *  Only a proven absence is `none`; a stat that failed any other way is `unreadable`, which keeps the row. */
export async function transcriptMtimeVia(
  io: Pick<FleetIO, 'statMeasured'>, cfg: CcrcConfig, rec: SessionRecord,
  resolve: (a: { configDir: string; dir: string; registryWorkdir: string; uuid: string }) => Promise<{ path: string }>,
): Promise<number | 'none' | 'unreadable'> {
  const configDir = configDirFor(cfg, rec.wrapper);
  if (configDir === undefined) return 'unreadable';
  const st = await io.statMeasured((await resolve({ configDir, dir: rec.workdir, registryWorkdir: rec.workdir, uuid: rec.uuid })).path);
  return st.ok ? st.mtimeMs : st.reason === 'absent' ? 'none' : 'unreadable';
}

/** `StaleArchiveDeps.wokeAtMs`: `$REG/<id>.woke` (epoch seconds, `ccd`'s wake stamp), as ms. A file that is there but
 *  does not read or parse is not an absence; it throws, and the evidence gather reads that as no answer. */
export async function wokeAtVia(io: Pick<FleetIO, 'readFileMeasured'>, cfg: CcrcConfig, rec: SessionRecord): Promise<number | null> {
  const raw = await io.readFileMeasured(`${cfg.registryDir}/${rec.id}.woke`);
  if (!raw.ok) {
    if (raw.reason === 'absent') return null;
    throw new Error('.woke did not read');
  }
  const at = /^\s*(\d{1,12})\s*$/.exec(raw.content);
  if (at === null) throw new Error('.woke does not parse');
  return Number(at[1]) * 1000;
}

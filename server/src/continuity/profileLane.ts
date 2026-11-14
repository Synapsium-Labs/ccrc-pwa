// L4 delivery, context C3 (Session Conversation): the launch-profile lane (Overlord spec §3.6 H1, §3.3.7 H14, §3.3.4 C39; the
// plan is `docs/superpowers/plans/2026-11-10-overlord/w1a-launch-profiles.md`, Task 5). Every decision is elsewhere: `roleOf`
// decides the role, `profileFor` the route a session's launch should carry, `plainAutoMemoryOf` what the Settings row means,
// and `laneArmRowViewOf` whether a lane is live. This file reads, diffs and writes.
//
// ONE WRITER PER ROUTE FIELD. The lane is the one writer of `profile`, `automem` and `compactwindow` (lane-only: every door
// refuses them, `ROUTE_LANE_ONLY_FIELDS`), and it writes `compact` only while the `continuity` row is live. It writes through
// `CCD_ARGV.routeSet`, ONE argv per session with every changed field (ccd validates every pair before it writes any), behind
// the `route` verb's cap, and never a field whose value already stands, so an armed lane on a settled fleet sends nothing.
//
// SHADOW IS THE SEED. While the `launch-profile` row is shadow the pass counts the writes it would make and logs them; it
// sends nothing. A route it could not read is skipped and counted, never written blind. A session carrying the history
// programme's W3 steer marker (`~/.ccrc/history/steer-on/<id>`, the file the session hook's W3 gate reads) is skipped
// whole while the marker stands, and so is one whose marker could not be read, so the lane never moves a session in the
// steering cohort (the history coordinator's request of 2026-11-14).
//
// AN OLDER FLEET ccd. A ccd from before launch profiles PR A refuses the three fields by name, the whole call, before any
// write (`unknown routing field`). The lane's call carries only its own fields, so such a refusal loses nothing else; it
// is counted as failed and logged, and no capability word is added (the departure `no-cap-word-the-lane-call-is-its-own`).
import { CONTINUITY_LANE, LAUNCH_PROFILE_LANE, laneArmGate, type LaneArmLane } from '../../../shared/lane-arm.js';
import { ROUTE_LANE_ONLY_FIELDS, isRegistryId, type ChildMark, type RouteField, type RouteFields, type RunKind } from '../../../shared/api.js';
import type { ReadFailure } from '../../../shared/agent-protocol.js';
import { FLEET_ROLES } from '../../../shared/fleetRoles.js';
import { CCD_ARGV, ccdCan, sweepDec } from '../ccdargv.js';
import type { CoordStore } from '../coord/store.js';
import type { RunCcd } from '../coord/ports.js';
import { laneArmRowViewOf } from '../coord/laneArm.js';
import type { FleetState } from '../fleetstate.js';
import type { SessionRecord } from '../registry.js';
import { roleFactsOf, roleOf } from '../roleOf.js';
import type { UsageRead } from '../usage.js';
import { plainAutoMemoryOf, profileFor } from './profileFor.js';

/** The lane's `LANE_SCHEDULE` row. */
export const LAUNCH_PROFILE_LANE_ROW = 'launchProfile';
/** At most this many route writes a pass (the plan's five): a fleet armed at once converges over a few passes. */
export const PROFILE_WRITES_PER_PASS = 5;
type ProfileField = Extract<RouteField, 'compact' | 'profile' | 'automem' | 'compactwindow'>;
/** The route fields the lane writes, in the order it diffs and counts them: `compact`, and the lane-only fields less the
 *  generations lane's `precompact`. Derived, so the route vocabulary stays spelled once (`ROUTE_WRITABLE_FIELDS`). */
const LANE_ONLY_BUT_PRECOMPACT = ROUTE_LANE_ONLY_FIELDS.filter((f) => f !== 'precompact');
export const PROFILE_ROUTE_FIELDS = ['compact', ...LANE_ONLY_BUT_PRECOMPACT] as readonly ProfileField[];
/** The history W3 steer marker's directory under the fleet node's `~/.ccrc` (`cfg.ccrcDir`): the session hook reads
 *  `$HOME/.ccrc/history/steer-on/<id>`. A second spelling of `ccd/history/lib.mjs`'s `SWITCHES.steerOnDir` (another
 *  package, which server code does not import), held equal to it by `continuity-profile-lane.test.ts`. */
export const HISTORY_STEER_ON_DIR = 'history/steer-on';
/** The actor the route writes are journalled under on the box. */
export const PROFILE_LANE_ACTOR = 'launch-profile lane';

/** The store members the pass reaches, declared by this consumer. */
export type ProfileCoord = Pick<CoordStore, 'laneArmSetting' | 'openCoordinatorIds' | 'run' | 'plainAutoMemorySettings'>;

/** One registry row, as the tick listed it. */
export interface ProfileRow {
  readonly id: string;
  readonly child: ChildMark;
  /** The routing record as the registry read it: null for a session never routed; `unreadable` names a field whose read failed. */
  readonly route: SessionRecord['route'];
}

/** The fleet reads the pass makes, declared by this consumer. */
export interface ProfileReads {
  /** The session's usage sidecar (its `ctxWindow`), read only for a role whose profile has compaction while `continuity` is live. */
  usage(id: string): Promise<UsageRead>;
  /** The history W3 steer marker for this session: `present`, or why there is none (read only for a would-be write). */
  steerMarker(id: string): Promise<'present' | ReadFailure>;
}

/** The lane's memory across passes: the last line it logged, so an unchanged pass logs nothing. Never a decision's state. */
export interface ProfileLaneMemory { lastLine: string | null }

export interface ProfileLaneDeps {
  readonly coord: ProfileCoord;
  readonly reads: ProfileReads;
  /** How a live pass writes; null where there is no fleet to write to (it then writes nothing, live or not). */
  readonly act: { readonly runCcd: RunCcd; readonly fleetState: Pick<FleetState, 'ccdVerbs'> | undefined } | null;
  readonly log: (line: string) => void;
  /** A row's gate (`laneArmGate`), unless a test opens one; nothing in the server passes it. */
  readonly gate?: (lane: LaneArmLane) => string | null;
  readonly memory: ProfileLaneMemory;
}

export interface ProfileLaneResult {
  readonly live: boolean;
  readonly continuityLive: boolean;
  /** Sessions whose route differs from what their launch should carry (the writes a live pass would make). */
  readonly would: number;
  readonly byField: Readonly<Record<ProfileField, number>>;
  readonly written: number;
  readonly failed: number;
  /** Would-be writes past `PROFILE_WRITES_PER_PASS`, left for a later pass. */
  readonly deferred: number;
  /** Live, but ccd here carries no `route` verb (or there is no fleet to write to). */
  readonly unsupported: number;
  /** Rows skipped because a route field the lane writes could not be read. */
  readonly routeUnread: number;
  /** Rows skipped because the W3 steer marker stands, or could not be read. */
  readonly steered: number;
  readonly steerUnread: number;
  /** Plain rows whose `automem` was left alone because the Settings row could not be read. */
  readonly memoryUnread: number;
}

const zeroFields = (): Record<ProfileField, number> => ({ profile: 0, automem: 0, compact: 0, compactwindow: 0 });

/** One pass. It awaits the fleet reads and each write in turn; nothing it holds is a decision's durable state. */
export async function profilePass(deps: ProfileLaneDeps, rows: readonly ProfileRow[]): Promise<ProfileLaneResult> {
  const { coord } = deps;
  const gate = deps.gate ?? laneArmGate;
  const live = laneArmRowViewOf(LAUNCH_PROFILE_LANE, coord.laneArmSetting(LAUNCH_PROFILE_LANE), gate(LAUNCH_PROFILE_LANE)).live;
  const continuityLive = laneArmRowViewOf(CONTINUITY_LANE, coord.laneArmSetting(CONTINUITY_LANE), gate(CONTINUITY_LANE)).live;
  const memory = plainAutoMemoryOf(coord.plainAutoMemorySettings());
  let openCoordinators: ReadonlySet<string> | 'unmeasured';
  try { openCoordinators = new Set(coord.openCoordinatorIds()); } catch { openCoordinators = 'unmeasured'; }
  // A child's run kind; a run row that cannot be read, or whose read throws, is unmeasured (the generations lane's rule).
  const runKind = (child: ChildMark): RunKind | 'unmeasured' => {
    if (child.kind !== 'child') return 'unmeasured';
    try { const r = coord.run(child.runId); return r.ok && r.run !== null ? r.run.kind : 'unmeasured'; } catch { return 'unmeasured'; }
  };
  const byField = zeroFields();
  let would = 0; let written = 0; let failed = 0; let deferred = 0; let unsupported = 0;
  let routeUnread = 0; let steered = 0; let steerUnread = 0; let memoryUnread = 0;
  const failures: string[] = [];

  for (const r of rows) {
    if (!isRegistryId(r.id)) { routeUnread += 1; continue; }   // a listing never builds a refused id; refused here too, before any argv
    if (r.route !== null && r.route.unreadable.some((f) => (PROFILE_ROUTE_FIELDS as readonly string[]).includes(f))) { routeUnread += 1; continue; }
    const reading = roleOf(roleFactsOf(r.id, { child: r.child, childRunKind: runKind(r.child), openCoordinators, intentDeclared: 'unmeasured' }));
    let want = profileFor(reading, memory ?? 'off', null, continuityLive);
    const row = FLEET_ROLES[want.profile].launchProfile;
    if (continuityLive && row.compaction !== null) want = profileFor(reading, memory ?? 'off', windowOf(await deps.reads.usage(r.id)), true);
    const memoryKnown = memory !== null || row.autoMemory !== 'switch';
    if (!memoryKnown) memoryUnread += 1;
    const target: Readonly<Record<ProfileField, string | null>> = {
      profile: want.profile,
      automem: memoryKnown ? want.automem : null,
      compact: want.compact === null ? null : String(want.compact),
      compactwindow: want.compactwindow === null ? null : String(want.compactwindow),
    };
    const have = r.route?.fields ?? {};
    const diff: RouteFields = {};
    for (const f of PROFILE_ROUTE_FIELDS) { const v = target[f]; if (v !== null && have[f] !== v) diff[f] = v; }
    if (Object.keys(diff).length === 0) continue;
    const steer = await deps.reads.steerMarker(r.id);
    if (steer === 'present') { steered += 1; continue; }
    if (steer === 'unreadable') { steerUnread += 1; continue; }
    would += 1;
    for (const f of PROFILE_ROUTE_FIELDS) if (diff[f] !== undefined) byField[f] += 1;
    if (!live) continue;
    if (deps.act === null || !ccdCan(deps.act.fleetState, 'routeSet')) { unsupported += 1; continue; }
    if (written + failed >= PROFILE_WRITES_PER_PASS) { deferred += 1; continue; }
    const res = await deps.act.runCcd(CCD_ARGV.routeSet(r.id, diff, sweepDec(deps.act.fleetState, PROFILE_LANE_ACTOR)));
    // A call that never ran (the agent link dropped) is unmeasured, never ccd's refusal: it is retried next pass all the same.
    if (res.ran === false) { failed += 1; failures.push(`${r.id}: ccd did not run, so the write is unmeasured`); }
    else if (res.ok) written += 1;
    else { failed += 1; failures.push(`${r.id}: ${res.stderr.split('\n')[0]?.trim() || 'no stderr'}`); }
  }
  const result: ProfileLaneResult = {
    live, continuityLive, would, byField, written, failed, deferred, unsupported, routeUnread, steered, steerUnread, memoryUnread,
  };
  logPass(deps, result, failures);
  return result;
}

/** The measured window of a usage read, or null: a stale or missing reading is unmeasured, never a window. */
function windowOf(u: UsageRead): number | null {
  if (u.kind !== 'reading' || u.usage.stale) return null;
  const w = u.usage.ctxWindow;
  return typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : null;
}

/** The pass's line, logged only when it differs from the last one (a settled fleet logs once, not every minute); each
 *  failed write in a line of its own, every pass it fails. */
function logPass(deps: ProfileLaneDeps, r: ProfileLaneResult, failures: readonly string[]): void {
  const mode = r.live ? 'live' : 'shadow';
  const fields = PROFILE_ROUTE_FIELDS.filter((f) => r.byField[f] > 0).map((f) => `${f} ${r.byField[f]}`).join(', ');
  const parts = [r.would === 0 ? 'every route already names its launch profile' : `${r.would} session(s) ${r.live ? 'need' : 'would get'} a route write (${fields})`];
  if (r.live) parts.push(`written ${r.written}, failed ${r.failed}, deferred ${r.deferred}`);
  if (r.unsupported > 0) parts.push(`${r.unsupported} not written: ccd here has no route verb`);
  const skips = [
    r.routeUnread > 0 ? `${r.routeUnread} with a route field that could not be read` : '',
    r.steered > 0 ? `${r.steered} carrying the history W3 steer marker` : '',
    r.steerUnread > 0 ? `${r.steerUnread} whose steer marker could not be read` : '',
    r.memoryUnread > 0 ? `${r.memoryUnread} plain, automem left alone: the Settings row could not be read` : '',
  ].filter((s) => s !== '');
  if (skips.length > 0) parts.push(`skipped ${skips.join(', ')}`);
  const line = `ccrc-server: launch-profile (${mode}${r.continuityLive ? ', continuity live' : ''}): ${parts.join('; ')}`;
  if (line !== deps.memory.lastLine) { deps.log(line); deps.memory.lastLine = line; }
  for (const f of failures) deps.log(`ccrc-server: launch-profile: a route write failed, retried next pass: ${f}`);
}

// Push-outbox Task 1 (plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md, "Today's pushes, pinned"): the
// characterization of every push the server sends today, at the PAYLOAD. It is green on `main`'s code, and it is the one
// arbiter of the move that puts a verdict between the funnel and `PushService.notify`: that move changes `pushSeam.ts`'s
// double, and no case in this file.
//
// Every case reaches the recording double (`pushSeam.ts`) through `Deps.push` / `NoticeDeps.push`, the place
// `notice.ts#sendPush` reads it. For each site of the plan's table the suite pins the EXACT payloads the double received, in
// order (`title`, `body`, `sessionId`, `tag`, `url`, `actions`, and how many, by `toStrictEqual` over the whole payload),
// then drives the site again with the session VISIBLE (a real `Viewers` claim) and with NO push service (the key absent).
//
// HOW EACH SITE IS DRIVEN, and where it is driven at a nearer seam than its caller (also named in each block):
// - through its real entry point: a watcher `tick()` over fixture sessions (#1, #2, #3, #12, #13, #14), `sweepAsks` and
//   `sweepApprovals` (#16, #17), the question-door routes (#15), `sweepDisk` (#19), the run-open and advance routes
//   (#22, #23), the ledger routes (#21), `POST /api/notify` (#29), `FleetWatcher.pushRelease` (#28), `sweepDigest` (#18),
//   the merged lane through `tick()` (#10), the queue lane (#11), the stall watch through `sweepStalls` (#7, #8, #9).
// - through the lane's own function with the funnel's real sink over the seam, which is what the watcher passes it
//   (`noticeSink(this.deps)`): `runDriftPass` (#24, #25), `landedPass` (#26), `BuildCaptureLane.sweep` (#20).
// - through the watcher's private method, because its caller needs a heavy fixture the table's other rows already carry:
//   `pushSenderNotice` and `escalatePark` (#4, #5), and the delegation adoption sink's `notice` (#27) through the real
//   `runAdoptStep` of the lane's own rig.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Bus } from '../src/bus.js';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO, type MeasuredDisk } from '../src/io.js';
import { FleetWatcher, type StallTick } from '../src/watch.js';
import type { SessionRecord } from '../src/registry.js';
import { queueSystemMail } from '../src/coord/rundefsTx.js';
import { STALL_QUIET_MS, STALL_ESCALATE_MS, ORPHAN_D_IDLE_MS, ORPHAN_PUSH_MS } from '../src/coord/stall.js';
import { DELEGATION_SWEEP_MS } from '../src/watch.js';
import { LEASE_AUDIT_CAP, LEASE_MARK_CAP, LEASE_MARK_LOCK_CAP, ORPHAN_LEASE_CAP } from '../src/ccdargv.js';
import { DELEGATION_EVENTS_CAP, type DelegationCensusRecord } from '../src/coord/delegation-model.js';
import type { DelegationCensusPass } from '../src/coord/gitref.js';
import { NotifyLog } from '../src/notifylog.js';
import { Viewers } from '../src/viewer.js';
import { askKey } from '../src/askkey.js';
import { noticeSink, notify, notifyEach } from '../src/notice.js';
import { recordDeadCoordinatorThrew } from '../src/coord/endDeadCoordinator.js';
import { TIMER_MAIL_SENDER } from '../../shared/continuity-timers.js';
import type { PushPayload } from '../src/push.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type ReleaseListingRow, type UpdateIntentPatch } from '../src/coord/store.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath } from '../src/coord/updateintentlog.js';
import { FLEET_LABEL, SERVER_LABEL } from '../src/update/inventory.js';
import { runDriftPass, type DriftLaneDeps } from '../src/coord/driftLane.js';
import { landedPass, type LandedLaneDeps } from '../src/coord/landedLane.js';
import { BuildCaptureLane, type BuildCaptureAnswer, type BuildCaptureTransport } from '../src/buildCaptureLane.js';
import type { ClaimantReading } from '../src/deadCoordinator.js';
import type { CcdResult } from '../src/coord/ports.js';
import type { FleetState } from '../src/fleetstate.js';
import type { LandingAdvance } from '../src/coord/landingEntry.js';
import { DRIFT_PUSH_LIVE_MARKER } from '../../shared/switches.js';
import { FLEET_SCOPE, type FleetSession, type NodeRole, type UpdateChannel } from '../../shared/api.js';
import { PR_STATE_PR_CAP } from '../src/ccdargv.js';
import type { BuildCaptureJob } from '../../shared/claudeBuildTrust.js';
import { seedRoster, testDeps, withFakeClock } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { quietAtTestEnd } from './laneQuiet.js';
import { landingStoreOver } from './landingFixture.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { stepRoster } from './fixtures/advanceCases.js';
import { codexAuthDir } from './codexLaneFixture.js';
import { installPush, pushDeps, pushSeam, type PushSeam } from './pushSeam.js';
import { doorInsOf } from './questionDoorIns.js';
import {
  CHILD as AF_CHILD, PARENT as AF_PARENT, TOK as AF_TOK, hookInput, requestBody, standardFixture, uuidOf, type Approvals,
} from './approvalsHarness.js';

// ── the matrix every site runs through ─────────────────────────────────────────────────────────────────────────────

/** What a case drives a site under: the seam (`null`: no push service, the key absent), and whether the operator is looking at
 *  the site's session. A driver claims the visibility on its own session ids with `see`. */
interface Env { readonly seam: PushSeam | null; readonly visible: boolean; readonly viewers: Viewers; coord?: CoordStore; heartbeat?: () => void }
const envOf = (seam: PushSeam | null, visible: boolean): Env => ({ seam, visible, viewers: new Viewers() });
/** Claim `id` as visible when the case is the visible one. A site with no session of its own never calls this. */
const see = (e: Env, id: string): void => { if (e.visible) e.viewers.setVisible(Symbol('viewer'), id); };

/** One row of the plan's table. `drive` returns the ids it minted, and `sent` the exact payloads, in order, as a function of them. */
interface Site {
  readonly n: string;
  readonly name: string;
  readonly drive: (e: Env) => Promise<Record<string, number>>;
  readonly sent: (ids: Record<string, number>) => PushPayload[];
  /** What the double receives with the site's session visible: nothing, unless the site is sessionless or gate-free. */
  readonly sentVisible?: (ids: Record<string, number>) => PushPayload[];
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const c of cleanups.splice(0)) await c();
  removeTmpFixtures();
});

const strict = (got: readonly PushPayload[], want: readonly PushPayload[]): void => { expect([...got]).toStrictEqual([...want]); };

const SID = 'lane-a-project-a';       // the session under test
const SID_B = 'lane-b-project-a';     // a second session of the same project
const PROJECT = 'project-a';

// ── rig A: a watcher over fixture sessions (push-copy.test.ts's idiom) ─────────────────────────────────────────────

interface Seeded { pid: number; cfgDir: string }
const liveFile = (s: Seeded): string => path.join(s.cfgDir, 'sessions', `${s.pid}.json`);
const writeLive = (s: Seeded, id: string, status: 'busy' | 'idle'): void => {
  writeFileSync(liveFile(s), JSON.stringify({ pid: s.pid, sessionId: `s-${id}`, cwd: '/d', status, statusUpdatedAt: Date.now() }));
};
function seedSessions(home: string, specs: readonly string[]): Map<string, Seeded> {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfgDir = path.join(home, '.claude');
  mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
  const info = new Map<string, Seeded>();
  let pid = 41000;
  for (const spec of specs) {
    const [project, id] = spec.split('/');
    pid += 1;
    const fields: Record<string, string> = { wrapper: 'claude', project: project!, workdir: `/w/${id!}`, uuid: `u-${id!}`, started: '1' };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id!}.${f}`), v);
    const seeded: Seeded = { pid, cfgDir };
    info.set(id!, seeded);
    writeLive(seeded, id!, 'busy');
  }
  return info;
}
const BARE = 'ready\n❯ \n';
function runnerFor(info: Map<string, Seeded>, pane: () => string): Runner {
  return async (_cmd, args) => {
    if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes' && args.includes('-a')) {
      return { ran: true, code: 0, stdout: [...info].map(([id, v]) => `cc-${id} 1 0 ${v.pid}\n`).join(''), stderr: '' };
    }
    if (args[0] === 'list-panes') {
      const id = /^=cc-(.*):$/.exec(args[2] ?? '')?.[1] ?? '';
      const pid = info.get(id)?.pid;
      return { ran: true, code: 0, stdout: pid ? `${pid}\n` : '', stderr: '' };
    }
    if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: pane(), stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
}
const writeHookState = (home: string, id: string, ask: unknown, state = 'waiting'): void => {
  writeFileSync(path.join(home, '.cc-sessions', `${id}.hookstate.json`), JSON.stringify({
    v: 1, state, sessionId: `u-${id}`, pid: 1, updatedAt: Date.now(), ask, subagents: [],
  }));
};

interface WatcherRig {
  w: FleetWatcher; home: string; coord?: CoordStore; notifyLog?: NotifyLog; deps: ReturnType<typeof testDeps>;
  tick: () => Promise<void>;
  markIdle: (id: string) => void;
  setPane: (text: string) => void;
  writeAsk: (id: string, ask: unknown, state?: string) => void;
}
async function watcherRig(e: Env, o: {
  sessions: readonly string[]; coord?: boolean; ring?: boolean; clock?: boolean; home?: string;
}): Promise<WatcherRig> {
  const home = o.home ?? mkTmp('ccrc-pushchar-');
  const info = seedSessions(home, o.sessions);
  let pane = BARE;
  const coord = o.coord ? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))) : undefined;
  let notifyLog: NotifyLog | undefined;
  if (o.ring) { notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json')); await notifyLog.load(); }
  const base = testDeps(home, runnerFor(info, () => pane));
  const deps = installPush({ ...base, viewers: e.viewers, ...(coord ? { coord } : {}), ...(notifyLog ? { notifyLog } : {}) }, e.seam);
  if (o.clock) withFakeClock(deps);
  const w = quietAtTestEnd(new FleetWatcher(deps, new Bus(), 10_000, path.join(home, 'state-cache.json')));
  return {
    w, home, deps: deps as never, ...(coord ? { coord } : {}), ...(notifyLog ? { notifyLog } : {}),
    tick: () => w.tick(),
    markIdle: (id) => writeLive(info.get(id)!, id, 'idle'),
    setPane: (t) => { pane = t; },
    writeAsk: (id, ask, state) => writeHookState(home, id, ask, state),
  };
}
/** The watcher also raises a disk notice on a loaded fixture host, which is not under any site here (#19 drives it on purpose). */
const noDisk = (sent: readonly PushPayload[]): PushPayload[] => sent.filter((p) => p.tag !== 'disk');
const seenBy = (site: { n: string }, seam: PushSeam): PushPayload[] => (site.n === '19' ? seam.sent : noDisk(seam.sent));

// ── #1 FleetWatcher.tick's busy-to-idle edge ───────────────────────────────────────────────────────────────────────

const doneEdge = async (e: Env, sessions: readonly string[]): Promise<Record<string, number>> => {
  const r = await watcherRig(e, { sessions });
  see(e, SID);
  await r.tick();                 // priming: records busy
  r.markIdle(SID);
  await r.tick();                 // the edge
  return {};
};
const DONE: PushPayload = { title: '✓ Finished', body: 'Finished — back to idle', sessionId: SID, tag: `done-${SID}` };

// ── #2 pushNewMail, #3 pushNewRuns ─────────────────────────────────────────────────────────────────────────────────

const mailSite = async (e: Env): Promise<Record<string, number>> => {
  const r = await watcherRig(e, { sessions: [`${PROJECT}/${SID}`, `${PROJECT}/${SID_B}`], coord: true });
  see(e, SID);
  await r.tick();
  const m = r.coord!.insertMail({ fromId: SID_B, fromUuid: `u-${SID_B}`, toId: SID, runId: null, kind: 'finding', subject: 'first', body: 'b', artifacts: [] });
  r.coord!.queueDelivery(m.id, SID, 'envelope text');
  await r.tick();
  return { mail: m.id };
};
const runSite = async (e: Env): Promise<Record<string, number>> => {
  const r = await watcherRig(e, { sessions: [`${PROJECT}/${SID}`], coord: true });
  see(e, SID);
  await r.tick();
  const run = r.coord!.openRun({ program: 'prog-a', title: 'Prog A', project: PROJECT, wave: 1, waveOf: 3, claimedBy: SID_B }) as { id: number };
  r.coord!.setSession(run.id, SID);
  r.coord!.advance(run.id, 'dispatched', 'coordinator');
  await r.tick();
  return { run: run.id };
};

// ── #28 pushRelease ────────────────────────────────────────────────────────────────────────────────────────────────

const REL_T = 1_790_000_000_000;
const listed = (tag: string, channel: UpdateChannel = 'stable'): ReleaseListingRow => ({
  tag, channel, publishedAt: REL_T, commitSha: null, tarballUrl: `https://example.invalid/download/${tag}/ccrc-${tag}.tar.gz`,
  bundleListed: true, notes: null, draft: false,
});
const measured = (label: string, role: NodeRole, currentVersion: string | null): NodeMeasurement => ({
  nodeId: label, role, label, currentVersion, currentSha: 'a'.repeat(40), currentRef: 'main',
  currentBuiltAt: '2026-09-22T00:00:00Z', currentDirty: false, stampRead: 'ok', installState: 'complete',
  provenance: 'verified', caps: ['verify', 'node-id', 'floor'], agentOps: role === 'fleet' ? [] : null,
  highestVersion: currentVersion, previousVersion: null, floorRead: currentVersion === null ? 'absent' : 'measured', previousRead: 'absent',
  os: 'linux', measuredAt: REL_T, report: null,
});
const seedRelease = (coord: CoordStore, o: { releases: ReleaseListingRow[]; server: string | null; fleet: string | null }): void => {
  expect(coord.applyReleaseListing(o.releases, REL_T, 'complete')).toMatchObject({ ok: true });
  expect(coord.upsertNodeMeasurement(measured(SERVER_LABEL, 'server', o.server)).ok).toBe(true);
  expect(coord.upsertNodeMeasurement(measured(FLEET_LABEL, 'fleet', o.fleet)).ok).toBe(true);
};
const releaseRig = async (e: Env): Promise<WatcherRig> => {
  const r = await watcherRig(e, { sessions: [], coord: true });
  seedRelease(r.coord!, { releases: [listed('v0.0.9'), listed('v0.0.7')], server: 'v0.0.7', fleet: 'v0.0.7' });
  return r;
};
const RELEASE: PushPayload = {
  title: 'ccrc v0.0.9 is out', body: 'On stable — fleet and server are on v0.0.7. Tap to see what\'s new.',
  tag: 'release-v0.0.9', url: '/settings/updates',
};

// ── #29 POST /api/notify with push:true ────────────────────────────────────────────────────────────────────────────

const NOTIFY_TOKEN = 'f'.repeat(64);
const MOVED = 'lane-a: opus model-5.6-gamma → model-6.1-gamma';
const notifySite = async (e: Env, message = MOVED): Promise<Record<string, number>> => {
  const h = mkTmp('ccrc-pushchar-');
  const d = testDeps(h);
  seedRoster(h, stepRoster({ proxyPort: 45020, litellmPort: 45021, authDir: codexAuthDir('lane-a') }));
  const deps = installPush({ ...d, cfg: loadConfig({ CCRC_HOME: h }), mailToken: NOTIFY_TOKEN }, e.seam);
  const app = await buildServer(deps, new Bus());
  cleanups.push(() => app.close());
  const res = await app.inject({ method: 'POST', url: '/api/notify', headers: { 'x-ccrc-mail-token': NOTIFY_TOKEN }, payload: { message, push: true } });
  expect(res.statusCode).toBe(200);
  return {};
};

// ── #19 DiskAlarmLane.raiseNotice, through sweepDisk ───────────────────────────────────────────────────────────────

const GIB = 1024 ** 3;
const fsAt = (usedPct: number) => ({
  dev: '8:1', mount: '/srv/secret-mount', fsType: 'ext4', roots: ['home', 'projects'], sizeBytes: 100 * GIB, availBytes: (100 - usedPct) * GIB,
  freeBytes: (100 - usedPct) * GIB, files: 1_000_000, filesFree: 900_000, readOnly: false,
});
const reading = (pct: number): MeasuredDisk => ({ ok: true, measured: { filesystems: [fsAt(pct)], expectedMounts: [], missing: [] } as never });
const diskRig = async (e: Env, answers: MeasuredDisk[]) => {
  const home = mkTmp('ccrc-pushchar-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  let n = 0;
  const io: FleetIO = { ...localIO, statfsMeasured: async () => answers[Math.min(n++, answers.length - 1)]! };
  const deps = installPush({ ...testDeps(home), io, coord, notifyLog, viewers: e.viewers }, e.seam);
  vi.spyOn(Date, 'now').mockImplementation(() => 5_000_000);
  const watcher = quietAtTestEnd(new FleetWatcher(deps as never, new Bus()));
  const sweep = async (): Promise<void> => { watcher.kick('diskAlarm'); await watcher.sweepDisk(); };
  return { sweep, coord, notifyLog };
};
const DISK_WARN: PushPayload = {
  title: 'Fleet disk 86% full · 14 GiB free',
  body: 'Holds home, projects. Warns at 85%, critical at 92%.',
  sessionId: '', tag: 'disk',
};

// ── #20 BuildCaptureLane.raiseFailure ──────────────────────────────────────────────────────────────────────────────

const failCapture = (job: BuildCaptureJob): BuildCaptureAnswer =>
  ({ kind: 'answered', result: { build: job.build, pass: false, cwd: true, output: 'replay: 1 failed' } });
const captureSite = async (e: Env): Promise<Record<string, number>> => {
  const home = mkTmp('ccrc-pushchar-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const transport: BuildCaptureTransport = { capture: async (job) => failCapture(job) };
  const deps = installPush({ coord, notifyLog, viewers: e.viewers, buildCapture: transport }, e.seam);
  const lane = new BuildCaptureLane(() => deps as never, () => 1_000_000_000_000);
  await lane.sweep(['2.1.321']);
  return {};
};
const CAPTURE: PushPayload = {
  title: 'Claude Code 2.1.321 failed its capture',
  body: 'The replay tests failed on the test box, so 2.1.321 stays untrusted and children on it are refused approvals. '
    + 'Settings › Automation › Test box shows the output (its last 8192 characters) and Capture again.',
  sessionId: '', tag: 'claude-build-capture', url: '/settings',
};

// ── #21 ledgersRoutes.ts#pushBlocking ──────────────────────────────────────────────────────────────────────────────

interface LedgerRig { app: FastifyInstance; coord: CoordStore; runA: number }
async function ledgerRig(e: Env): Promise<LedgerRig> {
  const home = mkTmp('ccrc-pushchar-');
  seedRow(home, 'lane-a');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps = installPush({ ...testDeps(home, recorder().run), mailToken: ID_GATE_TOKEN, coord, viewers: e.viewers,
    notifyLog: new NotifyLog(path.join(home, '.ccrc', 'notify.json')) }, e.seam);
  const app = await buildServer(deps, new Bus());
  cleanups.push(() => app.close());
  const runA = (coord.openRun({ program: 'prog-a', title: 'PROG-A', project: PROJECT, wave: 1, waveOf: null, claimedBy: 'lane-a' }) as { id: number }).id;
  return { app, coord, runA };
}
const LEDGER_HEADERS = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const lanePost = (r: LedgerRig, url: string, payload: unknown) =>
  r.app.inject({ method: 'POST', url, headers: LEDGER_HEADERS, payload: payload as never });
const AS_LANE_A = { byId: 'lane-a', byUuid: 'u-lane-a' };
const RAISE = { kind: 'do', title: 'Turn on the setting', why: 'The wave needs it.', how: ['Open Settings', 'Switch it on'], neededBy: 'soon', soonLabel: 'before wave 6' };
const itemRaise = async (r: LedgerRig, over: Record<string, unknown> = {}): Promise<number> => {
  const res = await lanePost(r, '/api/programmes/prog-a/items', { ...AS_LANE_A, ...RAISE, ...over });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { id: number }).id;
};
const waitingPayload = (id: number): PushPayload => ({ title: 'Waiting on you', body: 'Turn on the setting', sessionId: '', tag: `item-${id}`, url: '/waiting' });
const itemRow = (r: LedgerRig, id: number) => {
  const i = r.coord.itemById(id)!;
  return { state: i.state, neededBy: i.neededBy, tickedAt: i.tickedAt, closedAt: i.closedAt };
};
const OPEN_BLOCKING = { state: 'open', neededBy: 'blocking', tickedAt: null, closedAt: null };

// ── asks: #12 raise, #13 held amendment, #14 minted released, #16 lapse ────────────────────────────────────────────

const ENVELOPE = { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] }] };
const MENU_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\n  3. Green\nEnter to select\n';
const ASK_KEY = askKey(ENVELOPE as never)!;
const ASK_ACTIONS = [{ action: `ask:${ASK_KEY}:0`, title: 'Red' }, { action: `ask:${ASK_KEY}:1`, title: 'Blue' }];
const askPayload = (id: string, extra: Partial<PushPayload> = {}): PushPayload => ({ title: '❓ Question', body: 'Which colour?', sessionId: id, tag: `ask-${id}`, ...extra });
const PARENT = SID_B;
interface AskRowSql { id: number; childId: string; parentId: string; state: string; releaseReason: string | null; releasedAt: number | null }
const askRows = (coord: CoordStore): AskRowSql[] =>
  coord.db.prepare('SELECT id, childId, parentId, state, releaseReason, releasedAt FROM asks ORDER BY id').all() as unknown as AskRowSql[];

/** The child's dispatch: a run claimed by PARENT naming SID, and the `.child` marker `ws-add --child` leaves. */
function dispatchChild(r: WatcherRig): number {
  const run = r.coord!.openRun({ program: 'prog-a', title: 'Prog A', project: PROJECT, wave: 1, waveOf: null, claimedBy: PARENT, coordProject: PROJECT }) as { id: number };
  r.coord!.setSession(run.id, SID);
  writeFileSync(path.join(r.home, '.cc-sessions', `${SID}.child`), String(run.id));
  return run.id;
}

/** #12: a top-level session's dialog, with the hook's envelope readable at the first sighting. */
const askRaise = async (e: Env, sessions: readonly string[] = [`${PROJECT}/${SID}`]): Promise<Record<string, number>> => {
  const r = await watcherRig(e, { sessions });
  see(e, SID);
  await r.tick();                         // priming: a bare prompt
  r.writeAsk(SID, ENVELOPE);
  r.setPane(MENU_PANE);
  await r.tick();                         // the menu appears
  return {};
};

const T_ASK = 1_785_400_000_000;
const ASK_GRACE_MS = 180_000;
let askNow = T_ASK;
/** A child under a live parent whose first sighting is an actionless dialog. `amend` then writes the envelope. */
const heldRig = async (e: Env, o: { envelope: 'at-first-sighting' | 'amended'; parentRow: boolean; clock?: boolean }): Promise<WatcherRig & { runId: number }> => {
  askNow = T_ASK;
  vi.spyOn(Date, 'now').mockImplementation(() => askNow);
  const sessions = o.parentRow ? [`${PROJECT}/${SID}`, `${PROJECT}/${PARENT}`] : [`${PROJECT}/${SID}`];
  const r = await watcherRig(e, { sessions, coord: true, clock: true });
  e.coord = r.coord;
  see(e, SID);
  const runId = dispatchChild(r);
  await r.tick();                         // priming
  r.setPane(MENU_PANE);
  if (o.envelope === 'at-first-sighting') {
    r.writeAsk(SID, ENVELOPE);
    await r.tick();                       // minted: held under a live parent, released under a dead one
  } else {
    r.writeAsk(SID, null, 'waiting');
    await r.tick();                       // first sighting: nothing to hold, the actionless push
    r.writeAsk(SID, ENVELOPE);
    await r.tick();                       // the amendment branch: held, the replacement push
  }
  return { ...r, runId };
};

/** #16: the grace window lapses and `releaseAsk` wins. */
const askLapse = async (e: Env): Promise<Record<string, number>> => {
  const r = await heldRig(e, { envelope: 'at-first-sighting', parentRow: true });
  askNow = T_ASK + ASK_GRACE_MS + 1;
  await r.w.sweepAsks();
  return { ask: askRows(r.coord!)[0]!.id };
};

// ── asks through the question doors (#15) and approvals (#17), on the approvals harness ──────────────────────────────

const ASK_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';
const PERMISSION_PANE = ['  ⎿  $ rm -rf build', '─'.repeat(60), ' Bash command', '   rm -rf build', '   Remove the build directory',
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and always allow access to this project', '   3. No',
  ' Esc to cancel · Tab to amend'].join('\n');
const T_DOOR = 1_784_600_000_000;
async function doorsRig(e: Env): Promise<Approvals & { runId: number }> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T_DOOR);
  const f = await standardFixture();
  installPush(f.deps as object, e.seam);
  cleanups.push(() => f.close());
  quietAtTestEnd(f.watcher);
  e.coord = f.coord;
  const token = Symbol('viewer');
  e.heartbeat = () => { if (e.visible) f.viewers.setVisible(token, AF_CHILD); };
  e.heartbeat();
  return f;
}
const afHookstate = (f: Approvals, ask: unknown): void => {
  writeFileSync(path.join(f.home, '.cc-sessions', `${AF_CHILD}.hookstate.json`), JSON.stringify({
    v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: uuidOf(AF_CHILD), pid: 4242, updatedAt: Date.now(), ask, subagents: [],
  }));
};
/** The child's ask painted, its hookstate waiting and the priming tick before: one ask row minted `held` for the parent. */
const afHeldAsk = async (f: Approvals): Promise<number> => {
  await f.watcher.tick();
  afHookstate(f, ENVELOPE);
  f.panes.set(AF_CHILD, ASK_PANE);
  await f.watcher.tick();
  const rows = askRows(f.coord);
  expect(rows.map((r) => r.state)).toEqual(['held']);
  return rows[0]!.id;
};
const AF_PARENT_BODY = { fromId: AF_PARENT, fromUuid: uuidOf(AF_PARENT) };
const doorsAsk = (verb: 'release' | 'lapse-then-answer') => async (e: Env): Promise<Record<string, number>> => {
  const f = await doorsRig(e);
  const id = await afHeldAsk(f);
  if (verb === 'release') {
    const res = await f.app.inject({ method: 'POST', url: `/api/questions/ask-${id}/release`, headers: AF_TOK, payload: { kind: 'ask', ...AF_PARENT_BODY } });
    expect(res.json()).toEqual({ ok: true });
  } else {
    vi.setSystemTime(T_DOOR + ASK_GRACE_MS + 1_000);
    e.heartbeat?.();
    await f.watcher.sweepAsks();
    const res = await f.app.inject({ method: 'POST', url: `/api/questions/ask-${id}/rule`, headers: AF_TOK,
      payload: { kind: 'ask', ...AF_PARENT_BODY, optionIndexes: [0], askKey: ASK_KEY } });
    expect(res.statusCode, res.body).toBe(200);
  }
  return { ask: id };
};
const approvalRaise = async (e: Env): Promise<{ f: Approvals; id: number }> => {
  const f = await doorsRig(e);
  await f.watcher.tick();                                           // priming
  const res = await f.request(requestBody(hookInput({})));
  expect(res.statusCode).toBe(201);
  const id = (res.json() as { id: number }).id;
  afHookstate(f, { approval: { tool: 'Bash', summary: 'rm -rf build' } });
  f.panes.set(AF_CHILD, PERMISSION_PANE);
  await f.watcher.tick();                                           // painted: its push is deferred 60 s
  return { f, id };
};
const doorsApprovalReleased = async (e: Env): Promise<Record<string, number>> => {
  const { f, id } = await approvalRaise(e);
  vi.setSystemTime(T_DOOR + 5_000);
  e.heartbeat?.();
  expect((await f.release(id, AF_PARENT)).json()).toEqual({ ok: true });
  return { approval: id };
};
const doorsApprovalRuled = async (e: Env): Promise<Record<string, number>> => {
  const f = await doorsRig(e);
  await afHeldAsk(f);                                               // a painted dialog the watcher has sighted, no held prompt
  doorInsOf(f.watcher).approvalRuled(AF_CHILD, '', AF_PARENT, 'allow');
  return {};
};
const approvalLapse = async (e: Env): Promise<Record<string, number>> => {
  const { f, id } = await approvalRaise(e);
  vi.setSystemTime(T_DOOR + 60_000);
  e.heartbeat?.();
  afHookstate(f, { approval: { tool: 'Bash', summary: 'rm -rf build' } });
  await f.watcher.tick();
  return { approval: id };
};

// ── #18 the digest beat ──────────────────────────────────────────────────────────────────────────────────────────

const digestSite = async (e: Env): Promise<Record<string, number>> => {
  const home = mkTmp('ccrc-pushchar-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const t0 = Date.parse('2026-10-17T08:00:00Z');
  const q = coord.insertAsk({ childId: SID, parentId: PARENT, runId: null, askKey: 'k1', askAt: t0, dialogId: 'd1', question: 'Which colour?',
    options: ['Red', 'Blue'], now: t0 });
  const take = coord.takeAskForAnswer(q, t0);
  expect(take.ok).toBe(true);
  coord.settleAsk(q, PARENT, 'Red', t0 + 60_000);
  const now = Date.parse('2026-10-18T07:00:30Z');
  const deps = installPush({ ...testDeps(home), monotonicMs: () => now, coord, notifyLog, viewers: e.viewers }, e.seam);
  const w = quietAtTestEnd(new FleetWatcher(deps, new Bus(), 10_000));
  w.sweepDigest(now);
  return {};
};
const DIGEST: PushPayload = {
  title: 'Coordinators decided 1 thing in your name', body: '1 answered — tap to review and correct', sessionId: '',
  tag: 'digest-2026-10-18', url: '/digest?day=2026-10-18',
};

// ── #4, #5 mail notices to the sender, #6 the brief not taken ──────────────────────────────────────────────────────

const mailNoticeRig = async (e: Env) => {
  const r = await watcherRig(e, { sessions: [`${PROJECT}/${SID}`, `${PROJECT}/${SID_B}`], coord: true });
  e.coord = r.coord;
  see(e, SID_B);
  const m = r.coord!.insertMail({ fromId: SID_B, fromUuid: `u-${SID_B}`, toId: SID, runId: null, kind: 'status', subject: 'wave brief', body: 'b', artifacts: [] });
  const priv = r.w as unknown as {
    pushSenderNotice(...a: unknown[]): void; escalatePark(...a: unknown[]): void; sweepBriefs(...a: unknown[]): boolean;
  };
  return { r, m, priv, projects: new Map([[SID_B, PROJECT], [SID, PROJECT]]), active: new Set([PROJECT]) };
};
const BLOCKED_WHY = 'the recipient is waiting out a usage limit on its own; the nudge is held until it resumes';
const REVIVED_WHY = 'its recipient is back, so the parked mail is queued to it again';
const senderNotice = (head: 'blocked' | 'revived', why: string, tag: string) => async (e: Env): Promise<Record<string, number>> => {
  const { r, m, priv, projects, active } = await mailNoticeRig(e);
  priv.pushSenderNotice(r.coord, m.id, SID, why, tag, projects, active, head);
  return { mail: m.id };
};
const PARK_WHY = 'parked — the nudge is sitting unsubmitted in the recipient\'s input box; it will be delivered when that box is submitted or cleared';
const parkEscalation = (fromRole: boolean) => async (e: Env): Promise<Record<string, number>> => {
  const { r, m, priv, projects, active } = await mailNoticeRig(e);
  if (fromRole) see(e, SID);
  const mailId = fromRole
    ? r.coord!.insertMail({ fromId: 'operator', fromUuid: 'operator', toId: SID, runId: null, kind: 'status', subject: 'operator mail', body: 'b', artifacts: [] }).id
    : m.id;
  priv.escalatePark(r.coord, { id: 9, mailId, toId: SID, parkReason: 'enter-ignored' }, projects, active);
  return { mail: mailId };
};

const T_BRIEF = 1_800_000_000_000;
const briefNotTaken = async (e: Env): Promise<Record<string, number>> => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T_BRIEF);
  const r = await watcherRig(e, { sessions: [`${PROJECT}/${SID}`, `${PROJECT}/${PARENT}`], coord: true, clock: true });
  e.coord = r.coord;
  see(e, SID);
  const opened = r.coord!.openRun({ program: 'prog-a', title: 'prog-a', project: PROJECT, wave: 1, waveOf: 2, claimedBy: PARENT });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  r.coord!.markDispatched(opened.id, SID, `${SID}-ws`, `ws/${SID}`, false, Date.now());
  expect(r.coord!.advance(opened.id, 'dispatched', 'coordinator').ok).toBe(true);
  const q = queueSystemMail(r.coord!, { program: 'prog-a', wave: 1, waveOf: 2 }, { fromId: 'coordinator', toId: SID, runId: opened.id, kind: 'status',
    subject: 'wave-brief', body: 'the wave brief' });
  if (!q.queued) throw new Error('brief not queued');
  const now = T_BRIEF + 10 * 60_000;
  const priv = r.w as unknown as { sweepBriefs(...a: unknown[]): boolean };
  priv.sweepBriefs(r.coord, r.coord!.unlandedBriefs(0), now, new Map([[SID, PROJECT]]), new Set([PROJECT]));
  return { run: opened.id };
};

// ── #7, #8, #9 the stall watch's operator rungs (stall-sweep.test.ts's rig) ───────────────────────────────────────────

const S_WORKER = SID;
const S_COORD = SID_B;                     // no registry row: measureClaimant says dead
const S_UUID = 'a'.repeat(36);
const S_PID = 4242;
const DISPATCHED_AT = Date.parse('2026-09-28T12:00:00Z');
const WORKER_MAIL_AT = Date.parse('2026-09-28T21:17:43Z');
const INBOUND_AT = Date.parse('2026-09-28T21:19:17Z');
const IDLE_AT = Date.parse('2026-09-28T21:56:31Z');
const KEY = WORKER_MAIL_AT;
const R1_AT = IDLE_AT + STALL_QUIET_MS;
const R2_AT = R1_AT + STALL_ESCALATE_MS;
const PRIME_AT = DISPATCHED_AT - 7_200_000;
const STARTED_AT = DISPATCHED_AT - 60_000;
const ARMED = ['stall-watch-live', 'stall-watch-escalate'];
const W2 = [...ARMED, 'stall-watch-w2-live'];
const ORPHAN = 'lane-c-project-a';
const ORPHAN_UUID = 'e'.repeat(36);
const RESTART_AT = Date.parse('2026-09-28T22:30:00Z');
const D_AT = RESTART_AT + 60_000 + ORPHAN_D_IDLE_MS;
const sAt = (ms: number): void => { vi.setSystemTime(ms); };
const sSeedRegistry = (home: string, id: string, uuid = S_UUID): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: PROJECT, workdir: `/w/${PROJECT}`, uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};
const sSeedLive = (home: string, over: Record<string, unknown> = {}): void => {
  const dir = path.join(home, '.claude', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${S_PID}.json`), JSON.stringify({
    pid: S_PID, sessionId: S_UUID, cwd: `/w/${PROJECT}`, name: null, nameSource: null, status: 'idle', statusUpdatedAt: IDLE_AT, version: '2.1.284', ...over,
  }));
};
const sSeedTurnMark = (home: string, id: string, over: Record<string, unknown>): void => {
  writeFileSync(path.join(home, '.cc-sessions', `${id}.turn.json`), JSON.stringify({
    v: 1, sessionId: S_UUID, state: 'done', event: 'Stop', at: IDLE_AT, turnAt: IDLE_AT - 600_000, stopAt: IDLE_AT,
    bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', ...over,
  }));
};
const fleetRow = (id: string, over: Partial<FleetSession> = {}): FleetSession => ({
  hibernatedAt: null,
  id, wrapper: 'claude', home: '/home/u', project: PROJECT, workdir: `/w/${PROJECT}`,
  workspace: `${id}-ws`, name: null, title: null, status: 'idle', statusUpdatedAt: IDLE_AT, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, background: null, lastEnd: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: 'running', stoppedBy: null, swapBlocked: null, stranded: null, limitWait: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, role: 'coordinator', releasedFrom: null, withCoordinator: null,
  ...over,
});
const regRow = (id: string, uuid: string = S_UUID): SessionRecord => ({
  hibernatedAt: null,
  namedByOperator: false, title: null,
  id, wrapper: 'claude', project: PROJECT, projectEvidence: 'measured', workdir: `/w/${PROJECT}`, uuid,
  started: true, home: null, pool: null, lastswap: null,
  workspace: `${id}-ws`, branch: null, branchEvidence: 'absent', base: null,
  prPhase: null, prNumber: null, prCheckedAt: null, archivedAt: null, archivedBytes: null, held: null,
  substrate: null, stopped: null, supervisedAt: null, swapBlocked: null, stranded: null, spawn: null, lastEnd: null, lifecycleUnmeasured: [],
  unmeasured: [], route: null, child: { kind: 'none' },
});
const sTick = (rows: readonly SessionRecord[]): StallTick => ({
  panePids: new Map(rows.map((r): [string, number | null] => [r.id, S_PID])), records: rows, refused: new Set(),
});
async function stallRig(e: Env) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PRIME_AT);
  const home = mkTmp('ccrc-pushchar-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { ran: true as const, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { ran: true as const, code: 0, stdout: `${S_PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { ran: true as const, code: 0, stdout: '❯ \n', stderr: '' };
    return { ran: true as const, code: 1, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  e.coord = coord;
  const deps = installPush({ ...testDeps(home, run), coord, viewers: e.viewers }, e.seam);
  const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), new Bus(), 2000, path.join(home, 'state-cache.json')));
  await w.tick();
  sSeedRegistry(home, S_WORKER);
  sSeedLive(home);
  const seedRun = (): number => {
    sAt(DISPATCHED_AT);
    const opened = coord.openRun({ program: 'prog-a', title: 'prog-a', project: PROJECT, wave: 9, waveOf: 9, claimedBy: S_COORD });
    if (!('id' in opened)) throw new Error('openRun refused');
    coord.markDispatched(opened.id, S_WORKER, `${S_WORKER}-ws`, `ws/${S_WORKER}`, false, DISPATCHED_AT);
    if (!coord.advance(opened.id, 'dispatched', 'coordinator').ok) throw new Error('advance refused');
    sAt(WORKER_MAIL_AT);
    coord.insertMail({ fromId: S_WORKER, fromUuid: S_UUID, toId: 'coordinator', runId: opened.id, kind: 'status', subject: 'progress', body: 'b', artifacts: [] });
    sAt(INBOUND_AT);
    coord.insertMail({ fromId: S_COORD, fromUuid: 'c'.repeat(36), toId: S_WORKER, runId: opened.id, kind: 'answer', subject: 'go on', body: 'b', artifacts: [] });
    return opened.id;
  };
  return { home, coord, w, seedRun };
}
/** #7: r1 then r2 fall due with the claimant dead, so r3 is the operator's push (the run's worker is the subject). */
const stallOperatorRung = async (e: Env): Promise<Record<string, number>> => {
  const r = await stallRig(e);
  see(e, S_WORKER);
  const runId = r.seedRun();
  sAt(R1_AT);
  await r.w.sweepStalls([fleetRow(S_WORKER)], ARMED, sTick([regRow(S_WORKER)]));
  sAt(R2_AT);
  await r.w.sweepStalls([fleetRow(S_WORKER)], ARMED, sTick([regRow(S_WORKER)]));
  return { run: runId };
};
/** #8: a waiting pane with no ask behind it, the run's worker (dialog-cap). */
const stallDialogCap = async (e: Env): Promise<Record<string, number>> => {
  const r = await stallRig(e);
  see(e, S_WORKER);
  sSeedLive(r.home, { status: 'waiting' });
  const runId = r.seedRun();
  sAt(R1_AT);
  await r.w.sweepStalls([fleetRow(S_WORKER)], ARMED, sTick([regRow(S_WORKER)]));
  return { run: runId };
};
/** #9: orphan D on a registry row that is no run's worker or coordinator: run-less, its latch in memory. */
const stallRunless = async (e: Env): Promise<Record<string, number>> => {
  const r = await stallRig(e);
  see(e, ORPHAN);
  sSeedRegistry(r.home, ORPHAN, ORPHAN_UUID);
  sSeedLive(r.home, { statusUpdatedAt: RESTART_AT + 60_000, startedAt: RESTART_AT - 5_000 });
  sSeedTurnMark(r.home, ORPHAN, { sessionId: ORPHAN_UUID, event: 'SessionStart', at: RESTART_AT, turnAt: RESTART_AT - 900_000,
    stopAt: RESTART_AT - 600_000, restartAt: RESTART_AT, lostBg: 2, lostKinds: 'shell,subagent', lostIds: 'bsh1,bag2' });
  const tick = (): StallTick => sTick([regRow(ORPHAN, ORPHAN_UUID)]);
  sAt(D_AT);
  await r.w.sweepStalls([fleetRow(ORPHAN)], W2, tick());
  sAt(D_AT + ORPHAN_PUSH_MS);
  await r.w.sweepStalls([fleetRow(ORPHAN)], W2, tick());
  return {};
};

// ── #10 the merged lane (hold-gate.test.ts's rig) ────────────────────────────────────────────────────────────────

const MERGED_ID = 'demo-quiet-basin';
const mergedLine = (id: string, number = 42): string => JSON.stringify({
  id, project: 'demo', repo: 'o/r', branch: `ws/${id}`, base: 'origin/main', baseShort: 'main',
  tip: 'f'.repeat(40), ahead: 3, dirty: 0, commits: [], template: null,
  rows: [{ number, state: 'MERGED', headRefName: `ws/${id}`, headRefOid: 'deadbee', baseRefName: 'main', isCrossRepository: false,
    mergedAt: '2026-07-20T10:00:00Z', mergeCommit: { oid: '7a68ca0' }, url: 'u', title: 't', isDraft: false, statusCheckRollup: null, ours: true }],
  phase: 'merged', number, checkedAt: 1785300000000, reason: null,
});
const mergedSite = async (e: Env): Promise<Record<string, number>> => {
  const home = mkTmp('ccrc-pushchar-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [f, v] of [['uuid', `u-${MERGED_ID}`], ['wrapper', 'claude'], ['workdir', `/w/${MERGED_ID}`], ['project', 'demo'],
    ['workspace', 'quiet-basin'], ['branch', `ws/${MERGED_ID}`], ['base', 'origin/main']]) writeFileSync(path.join(reg, `${MERGED_ID}.${f}`), v!);
  const dir = path.join(home, '.claude', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, '4242.json'), JSON.stringify({ pid: 4242, sessionId: '1'.repeat(36), cwd: '/d', status: 'idle', statusUpdatedAt: 1 }));
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: '4242\n', stderr: '' };
    if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'pr-state') return { ran: true, code: 0, stdout: mergedLine(MERGED_ID), stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  see(e, MERGED_ID);
  const deps = installPush({ ...testDeps(home, run), viewers: e.viewers }, e.seam);
  const w = quietAtTestEnd(new FleetWatcher(deps, new Bus(), 10_000));
  await w.tick();
  await vi.waitFor(() => expect((w as unknown as { mergedNotified: Set<string> }).mergedNotified.size).toBe(1));
  return {};
};

// ── #11 the queue lane (pr-queue-lane.test.ts's rig) ─────────────────────────────────────────────────────────────

const Q_ID = 'demo-quiet-basin';
const Q_T1 = '2026-09-23T11:30:00Z';
const Q_COORDINATOR = 'lane-b-demo';
const dequeuedLine = (): string => JSON.stringify({
  id: Q_ID, project: 'demo', repo: 'o/r', branch: `ws/${Q_ID}`, base: 'origin/main', baseShort: 'main',
  tip: 'f'.repeat(40), ahead: 1, dirty: 0, commits: [], template: null,
  rows: [{ number: 42, state: 'OPEN', headRefName: `ws/${Q_ID}`, headRefOid: 'deadbee', baseRefName: 'main', isCrossRepository: false,
    mergedAt: null, mergeCommit: null, url: 'u', title: 't', isDraft: false, statusCheckRollup: null, ours: true }],
  phase: 'open', number: 42, checkedAt: 1785300000000, reason: null, queue: 'dequeued', queueAt: Q_T1,
});
const queueSite = async (e: Env): Promise<Record<string, number>> => {
  const home = mkTmp('ccrc-pushchar-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [f, v] of [['uuid', `u-${Q_ID}`], ['wrapper', 'claude'], ['workdir', `/w/${Q_ID}`], ['project', 'demo'], ['workspace', 'quiet-basin'],
    ['branch', `ws/${Q_ID}`], ['base', 'origin/main']]) writeFileSync(path.join(reg, `${Q_ID}.${f}`), v!);
  writeFileSync(path.join(reg, 'hibernate-disabled'), '');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  e.coord = coord;
  const opened = coord.openRun({ program: 'landing', title: 't', project: 'demo', wave: 2, waveOf: 5, claimedBy: Q_COORDINATOR });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  coord.setSession(opened.id, Q_ID);
  for (const s of ['dispatched', 'working', 'awaiting-review', 'merging'] as const) expect(coord.advance(opened.id, s, 'test').ok, s).toBe(true);
  const log = new NotifyLog(path.join(home, 'notify.json'));
  await log.load();
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'pr-state') return { ran: true, code: 0, stdout: dequeuedLine(), stderr: '' };
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: '4242\n', stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  see(e, Q_ID);
  const deps = installPush({ ...testDeps(home, run), coord, notifyLog: log, viewers: e.viewers }, e.seam);
  const w = quietAtTestEnd(new FleetWatcher(deps, new Bus(), 10_000));
  w.kick('pr');
  await w.tick();
  await vi.waitFor(() => expect(coord.feedEvents(200).filter((x) => x.kind === 'queue')).toHaveLength(1));
  await vi.waitFor(() => expect(w.inFlight('pr')).toBeNull());
  return { run: opened.id };
};

// ── #22 the run-open route's review-cap refusal ──────────────────────────────────────────────────────────────────

const reviewCapSite = async (e: Env): Promise<Record<string, number>> => {
  const home = mkTmp('ccrc-pushchar-');
  seedRow(home, 'lane-a', { project: PROJECT });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  e.coord = coord;
  const deps = installPush({ ...testDeps(home, recorder().run), mailToken: ID_GATE_TOKEN, coord, viewers: e.viewers }, e.seam);
  const app = await buildServer(deps, new Bus());
  cleanups.push(() => app.close());
  const work = (coord.openRun({ program: 'prog-a', title: 'A', project: PROJECT, wave: 1, waveOf: null, claimedBy: 'lane-a' }) as { id: number }).id;
  coord.setSession(work, 'lane-a-ws1');
  for (const to of ['dispatched', 'working', 'awaiting-review'] as const) expect(coord.advance(work, to, 'test').ok).toBe(true);
  for (let i = 0; i < 3; i += 1) {
    const round = coord.openRun({ program: 'prog-a', title: 'R', project: PROJECT, wave: 1, waveOf: null, claimedBy: 'lane-a', kind: 'review', reviews: work }) as { id: number };
    coord.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(round.id);
  }
  see(e, 'lane-a');
  const res = await app.inject({ method: 'POST', url: '/api/runs', headers: LEDGER_HEADERS,
    payload: { program: 'prog-a', title: 'R4', kind: 'review', reviews: work, claimedBy: 'lane-a', claimedByUuid: 'u-lane-a', homeProject: PROJECT } });
  expect(res.statusCode, res.body).toBe(409);
  expect(res.json()).toMatchObject({ ok: false, refused: 'cap-review-rounds', by: '3' });
  return { work };
};

// ── #23 the advance route's landing ejection (landing-ejection-ask.test.ts's scenario) ───────────────────────────────

const L_PROJECT = 'demo';
const L_SID = 'demo-ep1';
const L_TIP = 'a'.repeat(40);
const ejectionSite = async (e: Env): Promise<Record<string, number>> => {
  const home = mkTmp('ccrc-pushchar-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  for (const id of ['lane-b-demo', L_SID]) seedRow(home, id, { project: L_PROJECT });
  const gitRoot = mkTmp('ccrc-pushchar-git-');
  const heads = path.join(gitRoot, L_PROJECT, '.git', 'refs', 'heads', 'ws');
  mkdirSync(heads, { recursive: true });
  writeFileSync(path.join(heads, L_SID), `${L_TIP}\n`);
  const prLine = JSON.stringify({ id: L_SID, baseShort: 'main', branch: `ws/${L_SID}`, ahead: 1, tip: L_TIP, checkedAt: Date.now(),
    rows: [{ number: 7, state: 'OPEN', headRefName: `ws/${L_SID}`, baseRefName: 'main', isCrossRepository: false, ours: true, isDraft: false }] });
  const run: Runner = async (_c, args) => (args[0] !== 'pr-state'
    ? { ran: true, code: 0, stdout: '', stderr: '' }
    : { ran: true, code: 0, stdout: `${prLine}\n`, stderr: '' });
  const dbPath = path.join(home, '.ccrc', 'coord.db');
  const coord = landingStoreOver(openCoordDb(dbPath), dbPath);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const base = testDeps(home, run);
  const deps = installPush({ ...base, mailToken: ID_GATE_TOKEN, coord, cfg: { ...base.cfg, projectsRoot: gitRoot },
    fleetState: { ccdVerbs: ['pr-state', 'pr-landing-v1'] } as never, notifyLog, viewers: e.viewers }, e.seam);
  const app = await buildServer(deps);
  cleanups.push(() => app.close());
  see(e, L_SID);
  const opened = coord.openRun({ program: 'landing', title: 't', project: L_PROJECT, wave: 1, waveOf: 3, claimedBy: 'lane-b-demo' });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  coord.setSession(opened.id, L_SID);
  expect(coord.advance(opened.id, 'dispatched', 'test').ok).toBe(true);
  expect(coord.advance(opened.id, 'working', 'test').ok).toBe(true);
  const fingerprint = { branchTip: L_TIP, prNumber: 7, prPhase: 'open', handoffCommit: L_TIP };
  const post = (to: string, extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: `/api/runs/${opened.id}/advance`, headers: LEDGER_HEADERS, payload: { to, fingerprint, ...extra } });
  const ok = async (res: ReturnType<typeof post>): Promise<void> => { const r = await res; expect(r.statusCode, r.body).toBe(200); };
  await ok(post('awaiting-review'));
  for (let i = 0; i < 2; i += 1) {
    if (i > 0) await ok(post('awaiting-review'));
    await ok(post('merging'));
    await ok(post('working', { ejection: { base: 'b'.repeat(40), kind: 'new-head' } }));
  }
  return { run: opened.id };
};

// ── #24, #25 the drift lane, #26 the landed lane ─────────────────────────────────────────────────────────────────

const HOUR = 3_600_000;
const DAY_MS = 24 * HOUR;
const T_DRIFT = Date.UTC(2027, 5, 1, 12);
const DRIFT_LIVE = [DRIFT_PUSH_LIVE_MARKER];
const alive: ClaimantReading = { state: 'alive', why: 'pane live' };
function driftRig(e: Env) {
  const home = mkTmp('ccrc-pushchar-');
  const db = openCoordDb(path.join(home, '.ccrc', 'coord.db'));
  const coord = new CoordStore(db);
  e.coord = coord;
  const notice = noticeSink({ coord, viewers: e.viewers, ...pushDeps(e.seam) });
  const deps = (names: readonly string[] | null): DriftLaneDeps => ({
    coord, names, childMarks: null, measure: () => Promise.resolve(alive), notice, warn: () => {},
  });
  let n = 0;
  const quietRun = (now: number, agoMs: number): number => {
    n += 1;
    const r = coord.openRun({ program: `prog-${n}`, title: 'T', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'lane-b-project-a' });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    db.prepare("UPDATE runs SET state = 'working' WHERE id = ?").run(r.id);
    db.prepare('INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.id, now - agoMs, 'dispatched', 'working', 'coordinator', null);
    return r.id;
  };
  return { coord, deps, quietRun };
}
const driftSummary = async (e: Env): Promise<Record<string, number>> => {
  const r = driftRig(e);
  r.quietRun(T_DRIFT, 5 * DAY_MS);
  await runDriftPass(r.deps(DRIFT_LIVE), T_DRIFT);
  return {};
};
const driftItem = async (e: Env): Promise<Record<string, number>> => {
  const r = driftRig(e);
  r.quietRun(T_DRIFT - 2 * HOUR, 5 * DAY_MS);
  await runDriftPass(r.deps(DRIFT_LIVE), T_DRIFT - 2 * HOUR);     // the first armed pass: the summary
  const run = r.quietRun(T_DRIFT, 5 * DAY_MS);
  await runDriftPass(r.deps(DRIFT_LIVE), T_DRIFT);                // a later one: the item
  return { run };
};

const L_BASE_TIME = Date.parse('2026-11-11T12:00:00Z');
const ZERO = { stderr: '', killed: false as const, signal: null };
const ran = (stdout: string): CcdResult => ({ ran: true, ok: true, stdout, ...ZERO });
const isoZ = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const landedLine = (pr: number, mergedAt: string): string => `${JSON.stringify({
  number: pr, headRefOid: 'a'.repeat(40), baseRefName: 'main', isCrossRepository: false, state: 'merged', mergedAt, mergeCommit: 'e'.repeat(40) })}\n`;
const landedSite = (mergedAgoMs: number) => async (e: Env): Promise<Record<string, number>> => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(L_BASE_TIME);
  const home = mkTmp('ccrc-pushchar-');
  const dbPath = path.join(home, '.ccrc', 'coord.db');
  const coord = landingStoreOver(openCoordDb(dbPath), dbPath);
  e.coord = coord;
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const notice = noticeSink({ notifyLog, coord, viewers: e.viewers, ...pushDeps(e.seam) });
  const deps: LandedLaneDeps = {
    coord, notice, memory: new Map(), now: () => L_BASE_TIME, warn: () => {},
    runCcd: async (argv) => ran(landedLine(Number(argv[argv.indexOf('--pr') + 1]), isoZ(L_BASE_TIME - mergedAgoMs))),
    fleetState: { ccdVerbs: [PR_STATE_PR_CAP] } as unknown as FleetState,
  };
  const o = coord.openRun({ program: 'prog-1', title: 't', project: PROJECT, wave: 1, waveOf: 99, claimedBy: 'lane-b-project-a' });
  if (!('id' in o)) throw new Error('fixture openRun refused');
  coord.setSession(o.id, 'lane-a-ws1');
  for (const to of ['dispatched', 'working', 'awaiting-review'] as const) if (!coord.advance(o.id, to, 'test').ok) throw new Error(`advance to ${to}`);
  const pin: LandingAdvance = { kind: 'pin', head: 'a'.repeat(40), pr: 302, mode: 'off', handoffCommit: 'c'.repeat(40) };
  if (!coord.advanceLanding({ runId: o.id, to: 'merging', causedBy: 'coordinator', landing: pin }).ok) throw new Error('fixture pin refused');
  see(e, 'lane-a-ws1');
  await landedPass(deps);
  return { run: o.id };
};

// ── #27 the delegation adoption sink (delegation-adoption-lane.test.ts's rig) ────────────────────────────────────────

const DELEGATION_NOW = Date.UTC(2026, 9, 15, 10, 30, 0);
const OWNER = 'demo-a';
const OWNER_INC = '0189abcd-1234-4678-9abc-0123456789ab';
const FULL_CAPS = ['caps', DELEGATION_EVENTS_CAP, LEASE_MARK_CAP, LEASE_MARK_LOCK_CAP, ORPHAN_LEASE_CAP, LEASE_AUDIT_CAP];
const delegationAt = (n: number): number => DELEGATION_NOW + n * DELEGATION_SWEEP_MS;
const WTX: DelegationCensusRecord = { project: 'demo', adminRecord: 'wt-x', canonicalPath: '/w/demo/.claude/worktrees/wt-x', headBranch: null,
  headSha: 'a'.repeat(40), claudeBase: 'b'.repeat(40), locked: false, baseAgreesFirstLog: true, state: 'present', diagnostic: null };
const delegationSite = async (e: Env): Promise<Record<string, number>> => {
  const home = mkTmp('ccrc-pushchar-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: path.join(home, 'projects') } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  e.coord = coord;
  const fleet = { connected: true, downSince: null, ccdVerbs: [...FULL_CAPS] };
  const runCcd = async (argv: readonly string[]): Promise<CcdResult> => { throw new Error(`unexpected ccd ${argv.join(' ')}`); };
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  const deps = installPush({ ...testDeps(home), monotonicMs: () => Date.now(), cfg, io: localIO, coord, fleetState: fleet, runCcd, notifyLog, viewers: e.viewers }, e.seam);
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  cleanups.push(() => watcher.closeDelegation().catch(() => undefined));
  const sessions = [{ id: OWNER, project: 'demo', status: 'idle', presence: 'alive', unmeasured: [], stoppedBy: null, archivedAt: null }];
  const pass = async (ms: number, recs: DelegationCensusRecord[]): Promise<void> => {
    vi.spyOn(Date, 'now').mockReturnValue(ms);
    const c: DelegationCensusPass = { measuredAt: ms, projects: new Map([['demo', { read: { ok: true, records: [] }, delegation: recs }]]),
      incarnations: new Map([[OWNER, { kind: 'measured', incarnation: OWNER_INC }]]) as never };
    (watcher as unknown as { delegationCensus: DelegationCensusPass | null }).delegationCensus = c;
    (watcher as unknown as { listedIds: ReadonlySet<string> | null }).listedIds = new Set([OWNER]);
    await watcher.sweepDelegation(sessions as never, sessions.map((x) => ({ id: x.id, project: x.project, child: { kind: 'none' } })) as never);
  };
  await pass(DELEGATION_NOW - 25 * 60_000, []);
  const lane = (watcher as unknown as { delegationLane(): Record<string, unknown> }).delegationLane();
  const firstDead = lane['firstDead'] as Map<string, number>;
  firstDead.set('lane-p1-demo', delegationAt(0) - 60_000).set('lane-p2-demo', delegationAt(0) - 60_000);
  await pass(delegationAt(0), [WTX]);
  firstDead.set('lane-p1-demo', delegationAt(1) - 60_000).set('lane-p2-demo', delegationAt(1) - 60_000);
  await pass(delegationAt(1), [WTX]);
  return {};
};

// ── the matrix of sites ──────────────────────────────────────────────────────────────────────────────────────────

const askPayloadOf = (id: string, withActions: boolean, body = 'Which colour?'): PushPayload =>
  ({ title: '❓ Question · project-a', body, sessionId: id, tag: `ask-${id}`, ...(withActions ? { actions: ASK_ACTIONS } : {}) });
const DRIFT_SUMMARY: PushPayload = {
  title: 'Out of step', body: "1 item is out of step; see today's digest", sessionId: '', tag: 'drift-summary', url: '/digest?day=2027-06-01',
};
const driftItemPayload = (run: number): PushPayload =>
  ({ title: 'Out of step', body: 'run 2 (working) has had no act for 120 h', sessionId: '', tag: `drift-run-quiet:${run}`, url: '/runs' });
const askLanePayload = (id: string): PushPayload => askPayload(id, { actions: ASK_ACTIONS });
const WITH_COORDINATOR = askPayload(SID, { body: `With coordinator ${PARENT}` });

const SITES: Site[] = [
  { n: '1', name: 'FleetWatcher.tick busy-to-idle edge (done, push)', drive: (e) => doneEdge(e, [`${PROJECT}/${SID}`]), sent: () => [DONE] },
  { n: '2', name: 'pushNewMail (mail, record-always)', drive: mailSite,
    sent: (i) => [{ title: `✉ finding › ${SID}`, body: 'first', sessionId: SID, tag: `mail-${SID}-${i['mail']}` }], sentVisible: () => [] },
  { n: '3', name: 'pushNewRuns (run, record-always)', drive: runSite,
    sent: (i) => [{ title: `▸ dispatched › ${PROJECT}`, body: 'program:prog-a wave 1/3', sessionId: SID, tag: `run-${i['run']}-dispatched` }], sentVisible: () => [] },
  { n: '4a', name: 'pushSenderNotice, blocked (mail, record-always)', drive: senderNotice('blocked', BLOCKED_WHY, 'mail-blocked-7'),
    sent: () => [{ title: `✉ blocked › ${SID}`, body: `wave brief: ${BLOCKED_WHY}`, sessionId: SID_B, tag: 'mail-blocked-7' }], sentVisible: () => [] },
  { n: '4b', name: 'pushSenderNotice, revived (mail, record-always)', drive: senderNotice('revived', REVIVED_WHY, `mail-revived-5`),
    sent: () => [{ title: `✉ revived › ${SID}`, body: `wave brief: ${REVIVED_WHY}`, sessionId: SID_B, tag: 'mail-revived-5' }], sentVisible: () => [] },
  { n: '5a', name: 'escalatePark, a session sent the mail (through pushSenderNotice)', drive: parkEscalation(false),
    sent: () => [{ title: `✉ blocked › ${SID}`, body: `wave brief: ${PARK_WHY}`, sessionId: SID_B, tag: 'mail-parked-9' }], sentVisible: () => [] },
  { n: '5b', name: 'escalatePark, a role sent the mail (tagged with the recipient)', drive: parkEscalation(true),
    sent: () => [{ title: `✉ blocked › ${SID}`, body: `operator mail: ${PARK_WHY}`, sessionId: SID, tag: 'mail-parked-9' }], sentVisible: () => [] },
  { n: '6', name: 'sweepBriefs, brief not taken (mail, record-always)', drive: briefNotTaken,
    sent: (i) => [{ title: `✉ brief not taken › ${SID}`, body: `brief not taken by ${SID}, run ${i['run']}: not yet attempted`, sessionId: SID, tag: `brief-not-taken-${i['run']}` }], sentVisible: () => [] },
  { n: '7', name: 'applyStall, the operator rung r3 (run, record-always)', drive: stallOperatorRung,
    sent: (i) => [{ title: `⚠ stalled › ${S_WORKER}-ws`, body: 'run 1 — prog-a wave 9/9: no mail from worker lane-a-project-a since 2026-09-28T21:17Z (3h 38m). Its coordinator lane-b-project-a measures dead, so no report went to it. Reclaim the run: POST /api/runs/1/reclaim.', sessionId: S_WORKER, tag: `stall-${i['run']}-quiet-3-${KEY}` }], sentVisible: () => [] },
  { n: '8', name: 'applyStallSession with a run, dialog-cap (record-always)', drive: stallDialogCap,
    sent: (i) => [{ title: `⚠ stalled › ${S_WORKER}-ws (dialog)`, body: 'run 1 — prog-a wave 9/9: worker lane-a-project-a shows a dialog with no question behind it; its live status has read waiting since 2026-09-28T21:56Z (2h 0m). Mail to the worker, its coordinator\'s included, cannot land while the dialog shows: answer or dismiss it on the pane.', sessionId: S_WORKER, tag: `stall-${i['run']}-dialog-cap-1-${IDLE_AT}` }], sentVisible: () => [] },
  { n: '9', name: 'applyStallSession run-less, orphan D (record-always)', drive: stallRunless,
    sent: () => [{ title: '⚠ orphaned › lane-c-project-a', body: 'session lane-c-project-a: 2 background task(s) (shell, subagent) did not survive the 2026-09-28T22:30Z restart. Its orphan notice #1, queued at 2026-09-28T22:46Z (0h 30m ago), is not delivered.', sessionId: ORPHAN, tag: `orphaned-${ORPHAN}-${RESTART_AT}` }], sentVisible: () => [] },
  { n: '10', name: 'announceMerged (merged, push)', drive: mergedSite,
    sent: () => [{ title: '✓ merged › quiet-basin', body: 'PR #42 merged; nothing archived.', sessionId: MERGED_ID, tag: `merged-${MERGED_ID}#42` }], sentVisible: () => [] },
  { n: '11', name: 'sweepLanding deliver step (queue, record-always)', drive: queueSite,
    sent: () => [{ title: '⤺ dequeued › quiet-basin', body: 'PR #42 left the merge queue without landing (removed 2026-09-23T11:30:00Z); GitHub does not re-enqueue it. Mailed coordinator lane-b-demo.', sessionId: Q_ID, tag: `queue-${Q_ID}#42:dequeued@${Q_T1}` }], sentVisible: () => [] },
  { n: '12', name: 'detectDialogs raise (ask, push)', drive: (e) => askRaise(e), sent: () => [askLanePayload(SID)], sentVisible: () => [] },
  { n: '13', name: 'detectDialogs held amendment, the with-coordinator replacement (ask, push)',
    drive: async (e) => { const r = await heldRig(e, { envelope: 'amended', parentRow: true }); return { run: r.runId }; },
    sent: () => [askPayload(SID), WITH_COORDINATOR], sentVisible: () => [] },
  { n: '14', name: 'pushRaised, an ask minted released (ask, push)',
    drive: async (e) => { const r = await heldRig(e, { envelope: 'at-first-sighting', parentRow: false }); return { run: r.runId }; },
    sent: () => [askLanePayload(SID)], sentVisible: () => [] },
  { n: '15a', name: 'question doors: the release door after declineAsk (ask, push)', drive: doorsAsk('release'),
    sent: () => [askPayloadOf(AF_CHILD, true)], sentVisible: () => [] },
  { n: '15b', name: 'question doors: answeredLate replaces the lapse push (ask, push)', drive: doorsAsk('lapse-then-answer'),
    sent: () => [askPayloadOf(AF_CHILD, true), askPayloadOf(AF_CHILD, false, `Answered by ${AF_PARENT}`)], sentVisible: () => [] },
  { n: '15c', name: 'question doors: approvalReleased (ask, push)', drive: doorsApprovalReleased,
    sent: () => [{ title: '❓ Question · project-a', body: 'Bash — permission requested', sessionId: AF_CHILD, tag: `ask-${AF_CHILD}` }], sentVisible: () => [] },
  { n: '15d', name: 'question doors: approvalRuled, through the watcher\'s door sink (ask, push)', drive: doorsApprovalRuled,
    sent: () => [{ title: '❓ Question · project-a', body: 'Allowed by project-a-calm-mesa', sessionId: AF_CHILD, tag: `ask-${AF_CHILD}` }], sentVisible: () => [] },
  { n: '16', name: 'questions.lapseAsks, push-and-drop after releaseAsk wins (ask, push)', drive: askLapse,
    sent: () => [askLanePayload(SID)], sentVisible: () => [] },
  { n: '17', name: 'questions.lapseApprovals, the deferred push (ask, push)', drive: approvalLapse,
    sent: () => [{ title: '❓ Question · project-a', body: 'Bash — permission requested', sessionId: AF_CHILD, tag: `ask-${AF_CHILD}` }], sentVisible: () => [] },
  { n: '18', name: 'digestBeat (coord, record-always)', drive: digestSite, sent: () => [DIGEST], sentVisible: () => [DIGEST] },
  { n: '19', name: 'DiskAlarmLane.raiseNotice (coord, push)',
    drive: async (e) => { const r = await diskRig(e, [reading(40), reading(40), reading(86), reading(86)]); for (let i = 0; i < 4; i += 1) await r.sweep(); return {}; },
    sent: () => [DISK_WARN], sentVisible: () => [DISK_WARN] },
  { n: '20', name: 'BuildCaptureLane.raiseFailure (coord, push)', drive: captureSite, sent: () => [CAPTURE], sentVisible: () => [CAPTURE] },
  { n: '21a', name: 'pushBlocking from the raise route (neededBy blocking)',
    drive: async (e) => { const r = await ledgerRig(e); e.coord = r.coord; return { item: await itemRaise(r, { neededBy: 'blocking', soonLabel: null, runId: r.runA }) }; },
    sent: (i) => [waitingPayload(i['item']!)], sentVisible: (i) => [waitingPayload(i['item']!)] },
  { n: '21b', name: 'pushBlocking from POST /api/items/:id/blocking',
    drive: async (e) => { const r = await ledgerRig(e); e.coord = r.coord; const id = await itemRaise(r); expect((await lanePost(r, `/api/items/${id}/blocking`, { ...AS_LANE_A, blocking: true })).statusCode).toBe(200); return { item: id }; },
    sent: (i) => [waitingPayload(i['item']!)], sentVisible: (i) => [waitingPayload(i['item']!)] },
  { n: '22', name: 'run-open route review-cap refusal (run, push)', drive: reviewCapSite,
    sent: (i) => [{ title: `Review cap reached on run ${i['work']}`, body: `Run ${i['work']} has had 3 review rounds (cap 3), so a further review was refused. No review has reported yet. Lift the cap for this run to allow another round.`, sessionId: '', tag: `review-cap-${i['work']}` }],
    sentVisible: (i) => [{ title: `Review cap reached on run ${i['work']}`, body: `Run ${i['work']} has had 3 review rounds (cap 3), so a further review was refused. No review has reported yet. Lift the cap for this run to allow another round.`, sessionId: '', tag: `review-cap-${i['work']}` }] },
  { n: '23', name: 'advance route landing ejection (run, record-always)', drive: ejectionSite,
    sent: (i) => [{ title: `Landing: ${L_PROJECT} #7 ejected twice`,
      body: `run ${i['run']}, ${L_PROJECT} #7: ejected from the landing line a second time (new-head against base ${'b'.repeat(12)}). The line holds nothing back; you decide whether it lands again, is fixed by hand or is withdrawn.`, sessionId: L_SID, tag: `landing-ejected-${L_PROJECT}-7` }], sentVisible: () => [] },
  { n: '24', name: 'driftLane summary (coord, push)', drive: driftSummary,
    sent: () => [DRIFT_SUMMARY], sentVisible: () => [DRIFT_SUMMARY] },
  { n: '25', name: 'driftLane item (coord, record-always)', drive: driftItem,
    sent: (i) => [DRIFT_SUMMARY, driftItemPayload(i['run']!)], sentVisible: (i) => [DRIFT_SUMMARY, driftItemPayload(i['run']!)] },
  { n: '26', name: 'landedLane.raiseLandedNotice, a fresh merge (merged, record-always)', drive: landedSite(60_000),
    sent: () => [{ title: '✓ merged › lane-a-ws1', body: 'PR #302 merged; nothing archived.', sessionId: 'lane-a-ws1', tag: 'merged-lane-a-ws1#302' }], sentVisible: () => [] },
  { n: '27', name: 'delegation adoption sink, an attention item (coord, push)', drive: delegationSite,
    sent: () => [{ title: 'delegation adoption suspended', body: 'Adoption is suspended: nothing waits yet, because several delegated parents died at once or the registry did not read. It resumes when the breaker clears.', sessionId: '', tag: 'coord-' }],
    sentVisible: () => [{ title: 'delegation adoption suspended', body: 'Adoption is suspended: nothing waits yet, because several delegated parents died at once or the registry did not read. It resumes when the breaker clears.', sessionId: '', tag: 'coord-' }] },
  { n: '28', name: 'FleetWatcher.pushRelease (notifyPushOnly)',
    drive: async (e) => { const r = await releaseRig(e); r.w.pushRelease(REL_T); return {}; },
    sent: () => [RELEASE], sentVisible: () => [RELEASE] },
  { n: '29', name: 'POST /api/notify push:true (notifyPushOnly)', drive: (e) => notifySite(e),
    sent: () => [{ title: 'Model classes', body: MOVED, tag: 'models-advance:lane-a:opus', url: '/accounts' }],
    sentVisible: () => [{ title: 'Model classes', body: MOVED, tag: 'models-advance:lane-a:opus', url: '/accounts' }] },
];

/** The source rows a site leaves, by their columns that carry no clock: asks and items. */
const sourceRows = (c: CoordStore): { asks: unknown[]; items: unknown[] } => ({
  asks: c.db.prepare('SELECT id, childId, parentId, state, releaseReason FROM asks ORDER BY id').all(),
  items: c.db.prepare('SELECT id, kind, title, neededBy, state FROM operator_items ORDER BY id').all(),
});
/** One run of a site, not visible: what it asked the notify log to record, and the source rows it left. */
async function recorded(site: Site, seam: PushSeam | null): Promise<{ log: unknown[]; rows: ReturnType<typeof sourceRows> | null }> {
  const record = vi.spyOn(NotifyLog.prototype, 'record');
  try {
    const e = envOf(seam, false);
    await site.drive(e);
    return { log: record.mock.calls.map((c) => c[0]), rows: e.coord === undefined ? null : sourceRows(e.coord) };
  } finally {
    record.mockRestore();
  }
}

describe.each(SITES)('#$n $name', (site) => {
  it('sends exactly these payloads, in this order', async () => {
    const seam = pushSeam();
    const ids = await site.drive(envOf(seam, false));
    strict(seenBy(site, seam), site.sent(ids));
  });

  it('with the session visible it sends what the gate lets through', async () => {
    const seam = pushSeam();
    const ids = await site.drive(envOf(seam, true));
    strict(seenBy(site, seam), (site.sentVisible ?? (() => []))(ids));
  });

  it('with no push service nothing throws, and the notify log and the source rows are what a run with one leaves', async () => {
    const withService = await recorded(site, pushSeam());
    expect(await recorded(site, null)).toStrictEqual(withService);
  }, 60_000); // two runs of the site, so twice a case's time
});

// ── the title suffix: " · <project>", added in FleetWatcher.pushOne when more than one project is active ───────────────

describe('the project suffix (FleetWatcher.pushOne)', () => {
  it('an ask with TWO active projects names the project', async () => {
    const seam = pushSeam();
    await askRaise(envOf(seam, false), [`${PROJECT}/${SID}`, 'project-b/lane-a-project-b']);
    strict(noDisk(seam.sent), [{ ...askLanePayload(SID), title: '❓ Question · project-a' }]);
  });

  it('an ask with ONE project (two sessions of it) has no suffix', async () => {
    const seam = pushSeam();
    await askRaise(envOf(seam, false), [`${PROJECT}/${SID}`, `${PROJECT}/${SID_B}`]);
    strict(noDisk(seam.sent), [askLanePayload(SID)]);
  });

  it('a done push with TWO active projects names the project too', async () => {
    const seam = pushSeam();
    await doneEdge(envOf(seam, false), [`${PROJECT}/${SID}`, 'project-b/lane-a-project-b']);
    strict(noDisk(seam.sent), [{ ...DONE, title: '✓ Finished · project-a' }]);
  });
});

// ── the source row after the push: asks (state, releasedAt) and items ───────────────────────────────────────────────

describe('the source row after the push', () => {
  const rowsOf = async (drive: Site['drive']): Promise<{ rows: AskRowSql[]; ids: Record<string, number>; e: Env }> => {
    const e = envOf(pushSeam(), false);
    const ids = await drive(e);
    return { rows: askRows(e.coord!), ids, e };
  };

  it('#13 a held ask: state held, no releasedAt, after its two pushes', async () => {
    const { rows } = await rowsOf((e) => heldRig(e, { envelope: 'amended', parentRow: true }).then((r) => ({ run: r.runId })));
    expect(rows).toEqual([{ id: 1, childId: SID, parentId: PARENT, state: 'held', releaseReason: null, releasedAt: null }]);
  });

  it('#14 an ask minted released: state released, releaseReason parent-not-live, releasedAt the mint time', async () => {
    const { rows } = await rowsOf((e) => heldRig(e, { envelope: 'at-first-sighting', parentRow: false }).then((r) => ({ run: r.runId })));
    expect(rows).toEqual([{ id: 1, childId: SID, parentId: PARENT, state: 'released', releaseReason: 'parent-not-live', releasedAt: T_ASK }]);
  });

  it('#16 the lapse: releaseAsk wins, state released with releasedAt the sweep time, no mint reason', async () => {
    const { rows } = await rowsOf(askLapse);
    expect(rows).toEqual([{ id: 1, childId: SID, parentId: PARENT, state: 'released', releaseReason: null, releasedAt: T_ASK + ASK_GRACE_MS + 1 }]);
  });

  it('#15a the release door: declineAsk leaves the row declined with releasedAt set', async () => {
    const { rows } = await rowsOf(doorsAsk('release'));
    expect(rows.map((r) => [r.state, r.releaseReason, r.releasedAt])).toStrictEqual([['declined', null, T_DOOR]]);
  });

  it('#15b a late answer after the lapse: the row ends answered', async () => {
    const { rows } = await rowsOf(doorsAsk('lapse-then-answer'));
    expect(rows.map((r) => r.state)).toStrictEqual(['answered']);
  });

  it('#21a a blocking raise leaves the item open, blocking and unticked', async () => {
    const e = envOf(pushSeam(), false);
    const r = await ledgerRig(e);
    const id = await itemRaise(r, { neededBy: 'blocking', soonLabel: null, runId: r.runA });
    expect(itemRow(r, id)).toStrictEqual(OPEN_BLOCKING);
  });

  it('#21b a soon item raised without a push, then moved to blocking: one push and the item blocking', async () => {
    const seam = pushSeam();
    const r = await ledgerRig(envOf(seam, false));
    const id = await itemRaise(r);
    expect(itemRow(r, id)).toStrictEqual({ ...OPEN_BLOCKING, neededBy: 'soon' });
    expect(seam.sent).toStrictEqual([]);
    expect((await lanePost(r, `/api/items/${id}/blocking`, { ...AS_LANE_A, blocking: true })).statusCode).toBe(200);
    expect(itemRow(r, id)).toStrictEqual(OPEN_BLOCKING);
    strict(seam.sent, [waitingPayload(id)]);
    // already blocking: no second push; lowering never pushes
    expect((await lanePost(r, `/api/items/${id}/blocking`, { ...AS_LANE_A, blocking: true })).statusCode).toBe(200);
    expect((await lanePost(r, `/api/items/${id}/blocking`, { ...AS_LANE_A, blocking: false })).statusCode).toBe(200);
    expect(seam.sent).toHaveLength(1);
  });

  it('#22 the review-cap refusal records its ask once: askedAt set, and a second refusal pushes nothing more', async () => {
    const seam = pushSeam();
    const e = envOf(seam, false);
    const ids = await reviewCapSite(e);
    const row = e.coord!.db.prepare('SELECT askedAt, askHandledAt, liftedAt FROM review_cap WHERE workRunId = ?').get(ids['work']!) as
      { askedAt: number | null; askHandledAt: number | null; liftedAt: number | null };
    expect(row.askedAt).not.toBeNull();
    expect([row.askHandledAt, row.liftedAt]).toStrictEqual([null, null]);
    expect(seam.sent).toHaveLength(1);
  });
});

// ── the release push's failed sentence, and the refusals of the push-only door ─────────────────────────────────────────

describe('notifyPushOnly callers', () => {
  it('#28 a rejected release send logs its `failed` sentence once and is not retried', async () => {
    const seam = pushSeam();
    seam.rejectNext(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await releaseRig(envOf(seam, false));
    expect(r.w.pushRelease(REL_T)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });
    const sentence = 'ccrc-server: update: the release push for v0.0.9 did not send — it is not retried; the fleet\'s update line and the settings screen still show the release (boom)';
    await vi.waitFor(() => expect(warn.mock.calls.map((c) => String(c[0]))).toContain(sentence));
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l === sentence)).toHaveLength(1);
    expect(r.w.pushRelease(REL_T + 60_000)).toStrictEqual({ did: 'skipped', why: 'nothing-to-notify' });
    expect(seam.sent).toHaveLength(1);
  });

  it('#28 with no push service the release is skipped as no-push-service and nothing is marked', async () => {
    const r = await releaseRig(envOf(null, false));
    expect(r.w.pushRelease(REL_T)).toStrictEqual({ did: 'skipped', why: 'no-push-service' });
    expect(r.coord!.releases().find((x) => x.tag === 'v0.0.9')?.notifiedAt).toBeNull();
  });

  it('#29 a rejected send logs `the push did not go out`', async () => {
    const seam = pushSeam();
    seam.rejectNext(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await notifySite(envOf(seam, false));
    await vi.waitFor(() => expect(warn.mock.calls.map((c) => String(c[0]))).toContain('ccrc-server: /api/notify: the push did not go out (boom)'));
  });

  it('#29 push:true on a line that is not a model-class line of a codex lane sends nothing', async () => {
    const seam = pushSeam();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await notifySite(envOf(seam, false), 'cc swap: s1 moved lane-a -> lane-b');
    expect(seam.sent).toStrictEqual([]);
  });
});

// ── what never pushes: every `record-only` writer and every `notifyEach` caller ──────────────────────────────────────

describe('record-only writers and notifyEach callers send nothing', () => {
  const ev = { kind: 'run' as const, sessionId: SID, runId: null, title: 't', body: 'b' };

  it('the funnel: record-only never sends, with a push service on the deps and nobody viewing', () => {
    const seam = pushSeam();
    notify({ push: seam.push, viewers: new Viewers() }, ev, 'record-only');
    notifyEach({ push: seam.push, viewers: new Viewers() }, [ev, ev], 'record-only');
    expect(seam.sent).toStrictEqual([]);
  });

  it('the control: the same deps in push mode do send, once per row of a batch', () => {
    const seam = pushSeam();
    notify({ push: seam.push, viewers: new Viewers() }, ev, 'push');
    notifyEach({ push: seam.push, viewers: new Viewers() }, [ev, ev], 'push');
    expect(seam.sent.map((p) => p.tag)).toStrictEqual([`run-${SID}`, `run-${SID}`, `run-${SID}`]);
  });

  it('endDeadCoordinator.ts (a notifyEach caller): its feed rows reach no push even when a push service rides on the deps', async () => {
    const seam = pushSeam();
    const home = mkTmp('ccrc-pushchar-');
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    recordDeadCoordinatorThrew({ coord, notifyLog, push: seam.push } as never, SID_B, null, 'boom', T_DRIFT);
    expect(coord.feedEvents(10).length).toBeGreaterThan(0);
    expect(seam.sent).toStrictEqual([]);
  });

  it('every notifyEach call in server/src is a record-only call whose deps name no push service', () => {
    const srcRoot = path.join(import.meta.dirname, '..', 'src');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (d.isDirectory()) walk(path.join(dir, d.name));
        else if (d.name.endsWith('.ts')) files.push(path.join(dir, d.name));
      }
    };
    walk(srcRoot);
    const found: Record<string, number> = {};
    for (const f of files) {
      if (f.endsWith(`${path.sep}notice.ts`)) continue;
      const src = readFileSync(f, 'utf8');
      const calls = [...src.matchAll(/\bnotifyEach\(([\s\S]*?)\n?\s*'(record-only|push|record-always)'/g)].filter((m) => !/function notifyEach/.test(m[0]));
      if (calls.length === 0) continue;
      found[path.relative(srcRoot, f).split(path.sep).join('/')] = calls.length;
      for (const m of calls) {
        expect(m[2], `${f}: a notifyEach call is not record-only`).toBe('record-only');
        expect(m[1], `${f}: a notifyEach call names a push service`).not.toMatch(/\bpush\b/);
      }
    }
    expect(found).toStrictEqual({ 'coord/endDeadCoordinator.ts': 1, 'coord/runCloseLane.ts': 3, 'coord/runCloseRefusals.ts': 1 });
  });

  it('#2 mail from the role timer, and #3 a `closing` run row and a swept close, are recorded and never pushed', async () => {
    const seam = pushSeam();
    const r = await watcherRig(envOf(seam, false), { sessions: [`${PROJECT}/${SID}`], coord: true });
    await r.tick();
    const m = r.coord!.insertMail({ fromId: TIMER_MAIL_SENDER, fromUuid: 'x', toId: SID, runId: null, kind: 'status', subject: 'timer: 1 due (7)', body: 'b', artifacts: [] });
    r.coord!.queueDelivery(m.id, SID, 'envelope');
    const run = r.coord!.openRun({ program: 'prog-a', title: 'Prog A', project: PROJECT, wave: 1, waveOf: 3, claimedBy: SID_B }) as { id: number };
    r.coord!.setSession(run.id, SID);
    r.coord!.advance(run.id, 'dispatched', 'coordinator');
    r.coord!.advance(run.id, 'closing', 'coordinator');
    r.coord!.advance(run.id, 'failed', 'sweep', 'expired:never-started');
    await r.tick();
    expect(noDisk(seam.sent).map((p) => p.tag)).toStrictEqual([`run-${run.id}-dispatched`]);
  });

  it('#19 the clear to normal is recorded and never pushed', async () => {
    const seam = pushSeam();
    const r = await diskRig(envOf(seam, false), [reading(40), reading(40), reading(86), reading(86), reading(40), reading(40)]);
    for (let i = 0; i < 6; i += 1) await r.sweep();
    expect(seam.sent.map((p) => p.title)).toStrictEqual(['Fleet disk 86% full · 14 GiB free']);
    expect(r.coord.feedEvents(10).map((x) => x.title)).toContain('Fleet disk back to normal');
  });

  it('#24 an unarmed drift pass records its shadow notice and pushes nothing', async () => {
    const seam = pushSeam();
    const r = driftRig(envOf(seam, false));
    r.quietRun(T_DRIFT, 5 * DAY_MS);
    await runDriftPass(r.deps([]), T_DRIFT);
    expect(seam.sent).toStrictEqual([]);
  });

  it('#26 a merge older than an hour is record-only', async () => {
    const seam = pushSeam();
    await landedSite(3 * HOUR)(envOf(seam, false));
    expect(seam.sent).toStrictEqual([]);
  });
});

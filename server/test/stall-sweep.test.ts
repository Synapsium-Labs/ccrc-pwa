// The stall watch's lane (spec 2026-09-29 §4.2, wave 1). `sweepStalls` READS, `stallVerdict` DECIDES, and the
// lane APPLIES the answer. The harness idioms are mail-sweep.test.ts's:
// - a fixture HOME;
// - a scripted tmux Runner answering `list-panes` with one pid;
// - the live-state file at `<home>/.claude/sessions/<pid>.json`;
// - a primed watcher and a push spy;
// - `Date` faked alone, so real timers keep flowing under the async reads.
// The times are S4's, measured (spec §1, and §4.2's example body): the worker's last mail at 21:17:43Z (#2509
// status), the newest mail to it at 21:19:17Z (#2510 answer), its main loop idle since 21:56:31Z, r1 due at
// 23:56:31Z.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher, STALL_SWEEP_MS, type StallTick } from '../src/watch.js';
import type { SessionRecord } from '../src/registry.js';
import { localIO, type FleetIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { COORDINATOR_PAUSE_MARKER } from '../src/coord/rundefs.js';
import {
  BACKLOG_HORIZON_MS, DEAD_GRACE_MS, FAILED_IDLE_MS, MAIL_STUCK_MS, MARKER_UNREADABLE_MS, ORPHAN_D_IDLE_MS, ORPHAN_E_IDLE_MS,
  ORPHAN_PUSH_MS, STALL_FAILED_PREFIX, stallFailedSubject,
  STALL_CHECK_PREFIX, STALL_ESCALATE_MS, STALL_OPERATOR_MS, STALL_ORPHANED_PREFIX, STALL_QUIET_MS, STALL_REPORT_PREFIX,
  parseStallDetail, stallDetail,
} from '../src/coord/stall.js';
import type { PushPayload } from '../src/push.js';
import { WAVE_DONE_SUBJECT, type FleetSession } from '../../shared/api.js';
import { tmuxTarget } from '../../shared/tmux-target.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { degradedReadIO } from './ioDoubles.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const WORKER = 'demo-quiet-mesa';
const OTHER_WORKER = 'demo-swift-hollow';
const COORD = 'demo-coordinator';
const UUID = 'a'.repeat(36);
const COORD_UUID = 'c'.repeat(36);
const PID = 4242;
// A local mirror of watch.ts's private constant (mail-sweep.test.ts's idiom): a drift shows up as a red here.
const MAIL_ARMED_HOLD_MS = 300_000;

const DISPATCHED_AT = Date.parse('2026-09-28T12:00:00Z');   // fixture choice: any time before the last mail
const WORKER_MAIL_AT = Date.parse('2026-09-28T21:17:43Z');  // S4 #2509 status
const INBOUND_AT = Date.parse('2026-09-28T21:19:17Z');      // S4 #2510 answer
const IDLE_AT = Date.parse('2026-09-28T21:56:31Z');         // S4 main loop idle since
const KEY = WORKER_MAIL_AT;                                  // episodeKeyMs: the worker's newest mail
const R1_AT = IDLE_AT + STALL_QUIET_MS;
const R2_AT = R1_AT + STALL_ESCALATE_MS;
const R3_AT = R2_AT + STALL_OPERATOR_MS;
const PRIME_AT = DISPATCHED_AT - 7_200_000;

const LIVE: readonly string[] = ['stall-watch-live'];
const ARMED: readonly string[] = ['stall-watch-live', 'stall-watch-escalate'];
/** Wave 2's arms armed too: live, escalate and `stall-watch-w2-live`, or live and w2 alone. */
const W2: readonly string[] = [...ARMED, 'stall-watch-w2-live'];
const W2_LIVE: readonly string[] = [...LIVE, 'stall-watch-w2-live'];
/** The live process's start (`startedAt`), before every marker these cases seed, so no marker reads stale. */
const STARTED_AT = DISPATCHED_AT - 60_000;
/** A registry row that is no run's worker or coordinator: orphan D's subject. */
const ORPHAN = 'demo-idle-basin';
const ORPHAN_UUID = 'e'.repeat(36);
const RESTART_AT = Date.parse('2026-09-28T22:30:00Z');

const at = (ms: number): void => { vi.setSystemTime(ms); };

const seedRegistry = (home: string, id: string, uuid = UUID): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** A fresh supervisor heartbeat, in epoch SECONDS (mail-sweep.test.ts's `seedSupervised`). */
const seedSupervised = (home: string, id: string, nowMs: number): void => {
  writeFileSync(path.join(home, '.cc-sessions', `${id}.supervised`), String(Math.floor(nowMs / 1000)));
};

const seedLiveState = (home: string, over: Record<string, unknown> = {}): void => {
  const dir = path.join(home, '.claude', 'sessions');
  mkdirSync(dir, { recursive: true });
  const body = {
    pid: PID, sessionId: UUID, cwd: '/w/demo', name: null, nameSource: null,
    status: 'idle', statusUpdatedAt: IDLE_AT, version: '2.1.284', ...over,
  };
  writeFileSync(path.join(dir, `${PID}.json`), JSON.stringify(body));
};

const seedHookState = (home: string, id: string, over: Record<string, unknown>): void => {
  writeFileSync(path.join(home, '.cc-sessions', `${id}.hookstate.json`), JSON.stringify({
    v: 1, state: 'waiting', sessionId: UUID, pid: PID, event: 'PreToolUse', updatedAt: IDLE_AT,
    ask: null, subagents: [], ...over,
  }));
};

/** `$REG/<id>.turn.json` in the shape `readTurnMarkMeasured` accepts: all fifteen keys, in the writer's order. By
 *  default a `done` Stop at the S4 idle time with no background task. */
const seedTurnMark = (home: string, id: string, over: Record<string, unknown> = {}): void => {
  writeFileSync(path.join(home, '.cc-sessions', `${id}.turn.json`), JSON.stringify({
    v: 1, sessionId: UUID, state: 'done', event: 'Stop', at: IDLE_AT, turnAt: IDLE_AT - 600_000, stopAt: IDLE_AT,
    bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', ...over,
  }));
};

/** A COMPLETE fleet row (fleet-health.test.ts's `session()` shape), alive and running. */
const fleetRow = (id: string, over: Partial<FleetSession> = {}): FleetSession => ({
  id, wrapper: 'claude', home: '/home/rc', project: 'demo', workdir: '/w/demo',
  workspace: `${id}-ws`, name: null, status: 'idle', statusUpdatedAt: IDLE_AT, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: 'running', stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' },
  ...over,
});

const store = (home: string): CoordStore => new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));

/** A complete registry row (`hold-gate.test.ts`'s literal), measured unless `over` says otherwise. */
const regRow = (id: string, uuid: string = UUID, over: Partial<SessionRecord> = {}): SessionRecord => ({
  id, wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid,
  started: true, home: null, pool: null, lastswap: null,
  workspace: `${id}-ws`, branch: null, branchEvidence: 'absent', base: null,
  prPhase: null, prNumber: null, prCheckedAt: null, archivedAt: null, archivedBytes: null, held: null,
  substrate: null, stopped: null, supervisedAt: null, swapBlocked: null, stranded: null, spawn: null, lifecycleUnmeasured: [],
  unmeasured: [], route: null, child: { kind: 'none' },
  ...over,
});

/** What `tick()` hands the lane (`StallTick`), built from this file's own fixtures: the scripted tmux pid for every
 *  row, and the seeded registry uuid. `null` models tmux answering none. The wiring describe runs the production
 *  path, where `tick()` builds the same two from `assembleFleet` and its registry read. */
const tickOf = (pid: number | null = PID, rows: readonly SessionRecord[] = [regRow(WORKER)]): StallTick => ({
  panePids: new Map(rows.map((r): [string, number | null] => [r.id, pid])), records: rows,
});

/** A `FleetIO` that records every `readFileMeasured` path and delegates to `localIO` (`degradedReadIO`'s shape). */
const countingIO = (sink: string[]): FleetIO => ({
  ...localIO,
  readFileMeasured: async (p, t, s) => { sink.push(p); return localIO.readFileMeasured(p, t, s); },
});

/** `panes` is the scripted `list-panes` answer, mutable so a case can take the pane pid away and give it back. */
interface Harness { home: string; calls: string[][]; run: Runner; panes: { code: number; stdout: string } }

const harness = (): Harness => {
  const home = mkTmp('ccrc-stall-sweep-');
  // Empty but LISTABLE before priming, or `tick()` fails shut and never sets `primed` (mail-sweep.test.ts).
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const calls: string[][] = [];
  const panes = { code: 0, stdout: `${PID}\n` };
  const run: Runner = async (_cmd, args) => {
    calls.push([...args]);
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: panes.code, stdout: panes.stdout, stderr: '' };
    if (args[0] === 'capture-pane') return { code: 0, stdout: '❯ \n', stderr: '' };
    return { code: 1, stdout: '', stderr: '' };
  };
  return { home, calls, run, panes };
};

const primedWatcher = async (h: Harness, coord: CoordStore, over: Partial<Deps> = {}): Promise<FleetWatcher> => {
  const deps: Deps = { ...testDeps(h.home, h.run), coord, ...over };
  const w = new FleetWatcher(deps, new Bus(), 2000, path.join(h.home, 'state-cache.json'));
  await w.tick();
  return w;
};

const pushSpy = (): { sent: PushPayload[]; push: { notify: (p: PushPayload) => Promise<void> } } => {
  const sent: PushPayload[] = [];
  return { sent, push: { notify: async (p: PushPayload) => { sent.push(p); } } };
};

/** Primed on an EMPTY registry, then the worker is seeded (mail-sweep.test.ts's order). `over` reaches the
 *  watcher's deps (an io double, say); the push spy is always the rig's own. */
const rig = async (over: Partial<Deps> = {}): Promise<{ h: Harness; coord: CoordStore; w: FleetWatcher; sent: PushPayload[] }> => {
  const h = harness();
  const coord = store(h.home);
  const { sent, push } = pushSpy();
  const w = await primedWatcher(h, coord, { ...over, push: push as never });
  seedRegistry(h.home, WORKER);
  seedLiveState(h.home);
  return { h, coord, w, sent };
};

interface RunSeed {
  program: string; worker?: string; dispatchedAt?: number;
  workerMail?: { at: number; subject: string } | null; inbound?: { at: number } | null;
}
/** One dispatched work run. By default it carries S4's two mails: the worker's status at 21:17:43Z, and
 *  the coordinator's answer to it at 21:19:17Z. */
const seedRun = (coord: CoordStore, o: RunSeed): number => {
  const worker = o.worker ?? WORKER;
  const dispatchedAt = o.dispatchedAt ?? DISPATCHED_AT;
  at(dispatchedAt);
  const opened = coord.openRun({ program: o.program, title: o.program, project: 'demo', wave: 9, waveOf: 9, claimedBy: COORD });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  coord.markDispatched(opened.id, worker, `${worker}-ws`, `ws/${worker}`, false, dispatchedAt);
  const adv = coord.advance(opened.id, 'dispatched', 'coordinator');
  if (!adv.ok) throw new Error(`advance refused: ${JSON.stringify(adv)}`);
  const wm = o.workerMail === undefined ? { at: WORKER_MAIL_AT, subject: 'progress' } : o.workerMail;
  if (wm !== null) {
    at(wm.at);
    coord.insertMail({ fromId: worker, fromUuid: UUID, toId: 'coordinator', runId: opened.id,
      kind: 'status', subject: wm.subject, body: 'b', artifacts: [] });
  }
  const ib = o.inbound === undefined ? { at: INBOUND_AT } : o.inbound;
  if (ib !== null) {
    at(ib.at);
    coord.insertMail({ fromId: COORD, fromUuid: COORD_UUID, toId: worker, runId: opened.id,
      kind: 'answer', subject: 'go on', body: 'b', artifacts: [] });
  }
  return opened.id;
};

interface MailRow { id: number; at: number; toId: string; runId: number | null; kind: string; subject: string }
const operatorMail = (coord: CoordStore): MailRow[] =>
  coord.db.prepare("SELECT id, at, toId, runId, kind, subject FROM mail WHERE fromId = 'operator' ORDER BY id")
    .all() as unknown as MailRow[];
const deliveriesOf = (coord: CoordStore, mailId: number): { toId: string; state: string }[] =>
  coord.db.prepare('SELECT toId, state FROM mail_deliveries WHERE mailId = ? ORDER BY id')
    .all(mailId) as unknown as { toId: string; state: string }[];
const stallRows = (coord: CoordStore, runId: number): string[] =>
  coord.runEvents(runId).flatMap((e) => (parseStallDetail(e.detail) === null ? [] : [e.detail as string]));
const mailBody = (coord: CoordStore, mailId: number): string =>
  (coord.db.prepare('SELECT body FROM mail WHERE id = ?').get(mailId) as unknown as { body: string }).body;
const lines = (spy: { mock: { calls: unknown[][] } }, text: string): number =>
  spy.mock.calls.filter((c) => String(c[0]).includes(text)).length;
const listPanes = (h: Harness): number => h.calls.filter((a) => a[0] === 'list-panes').length;
/** Matches the adapter's own exact target (`Tmux.hasSession`, D-3525), so a spelling drift reds the positive case
 *  rather than leaving the negative one vacuous. */
const hasSessionFor = (h: Harness, id: string): boolean =>
  h.calls.some((a) => a[0] === 'has-session' && a.includes(tmuxTarget(id)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PRIME_AT);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sweepStalls: gating', () => {
  it('does nothing before the watcher is primed, and judges once it is', async () => {
    const h = harness();
    const coord = store(h.home);
    const w = new FleetWatcher({ ...testDeps(h.home, h.run), coord }, new Bus(), 2000, path.join(h.home, 'state-cache.json'));
    seedRegistry(h.home, WORKER);
    seedLiveState(h.home);
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(operatorMail(coord)).toEqual([]);
    await w.tick();                         // priming: the tick's own dispatch returns unprimed
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(operatorMail(coord).map((m) => m.runId)).toEqual([runId]);
  });

  it('runs on its own clock: a second sweep inside STALL_SWEEP_MS does nothing', async () => {
    const { coord, w } = await rig();
    seedRun(coord, { program: 'demo-program' });
    at(R1_AT - STALL_SWEEP_MS / 2);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());    // quiet 2h less 30 s: none, but the clock is stamped
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());    // due, but 30 s after the last sweep
    expect(operatorMail(coord)).toEqual([]);
    at(R1_AT + STALL_SWEEP_MS / 2);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(operatorMail(coord)).toHaveLength(1);
  });

  it('holds one sweep in flight: a sweep started while one awaits its reads does nothing', async () => {
    const reads: string[] = [];
    const { coord, w } = await rig({ io: countingIO(reads) });
    seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    reads.length = 0;
    const first = w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    at(R1_AT + STALL_SWEEP_MS);                       // the clock alone would let the second through
    const second = w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    await Promise.all([first, second]);
    expect(reads.filter((p) => p.endsWith(`${WORKER}.turn.json`))).toHaveLength(1);
    expect(operatorMail(coord)).toHaveLength(1);
  });

  it('stall-watch-disabled: the lane returns before reading anything; nothing is recorded or sent', async () => {
    const reads: string[] = [];
    const { coord, w } = await rig({ io: countingIO(reads) });
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    reads.length = 0;
    await w.sweepStalls([fleetRow(WORKER)], ['stall-watch-disabled', ...ARMED], tickOf());
    expect(reads).toEqual([]);
    expect(operatorMail(coord)).toEqual([]);
    expect(stallRows(coord, runId)).toEqual([]);
  });

  it('does nothing, and warns nothing, without a coordination store', async () => {
    const h = harness();
    const reads: string[] = [];
    const w = new FleetWatcher({ ...testDeps(h.home, h.run), io: countingIO(reads) }, new Bus(), 2000, path.join(h.home, 'state-cache.json'));
    await w.tick();
    seedRegistry(h.home, WORKER);
    seedLiveState(h.home);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(R1_AT);
    reads.length = 0;
    await expect(w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf())).resolves.toBeUndefined();
    expect(lines(warn, 'stall-watch')).toBe(0);
    expect(reads).toEqual([]);
  });

  it('a throw outside the per-subject catch (the arming read) resolves, warns ONCE, and frees the in-flight flag', async () => {
    // The tick calls `sweepStalls(...).catch(() => {})`, so a throw that escaped the lane would kill it every
    // minute with no trace. The lane's own outer catch is what leaves one line behind.
    const { coord, w } = await rig();
    seedRun(coord, { program: 'demo-program' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = Object.assign([] as string[], { includes: (): boolean => { throw new Error('names unreadable'); } });
    at(R1_AT);
    await expect(w.sweepStalls([fleetRow(WORKER)], bad, tickOf())).resolves.toBeUndefined();
    expect(lines(warn, 'ccrc-server: stall-watch sweep failed (names unreadable) — one bad sweep must not kill the poll')).toBe(1);
    expect(lines(warn, 'stall-watch')).toBe(1);
    expect(operatorMail(coord)).toEqual([]);
    at(R1_AT + STALL_SWEEP_MS);                       // the `finally` still ran: the next sweep is not held in flight
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(operatorMail(coord)).toHaveLength(1);
  });
});

describe('sweepStalls: shadow and live (S4)', () => {
  it('shadow (no stall-watch-live): one stall-shadow row and one warn per fire, no mail, no repeat', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], [], tickOf());
    expect(stallRows(coord, runId)).toEqual([stallDetail('shadow', 'quiet', 1, KEY)]);
    expect(lines(warn, `ccrc-server: stall-watch shadow quiet r1 run ${runId} ${WORKER}`)).toBe(1);
    expect(operatorMail(coord)).toEqual([]);
    expect(sent).toEqual([]);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], [], tickOf());
    expect(lines(warn, 'stall-watch shadow')).toBe(1);
    expect(stallRows(coord, runId)).toHaveLength(1);
  });

  it('live: r1 is a stall-check mail from operator to the worker at 2 h of quiet, recorded, never pushed', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(operatorMail(coord)).toEqual([]);          // one minute short of 2 h
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    const mail = operatorMail(coord);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ toId: WORKER, runId, kind: 'status', at: R1_AT });
    expect(mail[0]!.subject.startsWith(STALL_CHECK_PREFIX)).toBe(true);
    expect(deliveriesOf(coord, mail[0]!.id)).toEqual([{ toId: WORKER, state: 'queued' }]);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
    expect(sent).toEqual([]);
  });

  it('a stale notice read re-fires a shadow rung: the observation row alone keeps it to one warn', async () => {
    const { coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], [], tickOf());
    vi.spyOn(coord, 'runEvents').mockReturnValueOnce([]);   // the verdict sees no r1 row and fires r1 again
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], [], tickOf());
    expect(lines(warn, 'stall-watch shadow')).toBe(1);
    expect(stallRows(coord, runId)).toHaveLength(1);
  });

  it('arming mid-episode, end to end: a shadow r1, then stall-watch-live sends ONE check, and r2 waits an hour from it', async () => {
    const { h, coord, w } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);          // alive, so r2 is a (shadow) report and never an r3
    const runId = seedRun(coord, { program: 'demo-program' });
    const checks = (): MailRow[] => operatorMail(coord).filter((m) => m.subject.startsWith(STALL_CHECK_PREFIX));
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], [], tickOf());      // shadow: a stall-shadow r1 row, no mail
    expect(checks()).toEqual([]);
    const LIVE_R1 = R1_AT + STALL_SWEEP_MS;
    at(LIVE_R1);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());    // stall-watch-live touched: the pending r1 goes out once
    expect(checks()).toHaveLength(1);
    expect(checks()[0]).toMatchObject({ toId: WORKER, runId, at: LIVE_R1 });
    at(LIVE_R1 + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(checks()).toHaveLength(1);
    const r1Rows = [stallDetail('shadow', 'quiet', 1, KEY), stallDetail('live', 'quiet', 1, KEY)];
    at(LIVE_R1 + STALL_ESCALATE_MS - STALL_SWEEP_MS); // an hour after the SHADOW r1: r2 is not due
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(stallRows(coord, runId)).toEqual(r1Rows);
    at(LIVE_R1 + STALL_ESCALATE_MS);                  // an hour after the LIVE r1: r2, shadow without escalate
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(stallRows(coord, runId)).toEqual([...r1Rows, stallDetail('shadow', 'quiet', 2, KEY)]);
    expect(operatorMail(coord)).toHaveLength(1);
  });
});

describe('sweepStalls: escalation', () => {
  it('without stall-watch-escalate, r2 and r3 stay shadow: nothing to the coordinator, no push', async () => {
    const { h, coord, w, sent } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);          // an alive coordinator: r2 would be sent if armed
    const runId = seedRun(coord, { program: 'demo-program' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    at(R3_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    const check = operatorMail(coord)[0]!;
    const checkDelivery = (coord.db.prepare('SELECT id FROM mail_deliveries WHERE mailId = ?').get(check.id) as unknown as { id: number }).id;
    expect(stallRows(coord, runId)).toEqual([
      stallDetail('live', 'quiet', 1, KEY),
      stallDetail('shadow', 'quiet', 2, KEY),
      stallDetail('shadow', 'quiet', 3, KEY),
      // Wave 2, dark: the check has sat queued 2 h (at least MAIL_STUCK_MS) since the worker went idle, so
      // mail-stuck records its shadow row. Without stall-watch-w2-live it sends nothing.
      stallDetail('shadow', 'mail-stuck', 1, checkDelivery),
    ]);
    expect(lines(warn, `ccrc-server: stall-watch shadow quiet r2 run ${runId} ${WORKER}`)).toBe(1);
    expect(lines(warn, `ccrc-server: stall-watch shadow quiet r3 run ${runId} ${WORKER}`)).toBe(1);
    expect(operatorMail(coord).map((m) => m.toId)).toEqual([WORKER]);
    expect(sent).toEqual([]);
  });

  it('armed: r2 is a stall: mail to the coordinator, after measureClaimant finds it alive', async () => {
    const { h, coord, w, sent } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    at(R2_AT - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(operatorMail(coord)).toHaveLength(1);      // r2 not due yet
    h.calls.length = 0;
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(hasSessionFor(h, COORD)).toBe(true);       // the coordinator was measured, on demand
    const r2 = operatorMail(coord)[1]!;
    expect(r2).toMatchObject({ toId: COORD, runId, kind: 'status', at: R2_AT });
    expect(r2.subject.startsWith(STALL_REPORT_PREFIX)).toBe(true);
    expect(deliveriesOf(coord, r2.id)).toEqual([{ toId: COORD, state: 'queued' }]);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY), stallDetail('live', 'quiet', 2, KEY)]);
    expect(sent).toEqual([]);                         // r2 reaches the phone through pushNewMail, not here
  });

  it('armed, coordinator dead: r2 is skipped and r3 pushes once at r1 + 1 h, naming the reclaim door', async () => {
    const { coord, w, sent } = await rig();           // COORD has no registry row: measureClaimant says dead
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      title: `⚠ stalled › ${WORKER}-ws`, sessionId: WORKER, tag: `stall-${runId}-quiet-3-${KEY}`,
    });
    expect(sent[0]!.body).toContain('/reclaim');
    expect(operatorMail(coord).map((m) => m.toId)).toEqual([WORKER]);   // no r2 mail
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY), stallDetail('live', 'quiet', 3, KEY)]);
    at(R2_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(sent).toHaveLength(1);
  });

  it('coordination paused: r2 is skipped without measuring, and r3 names the pause, never reclaim', async () => {
    const { h, coord, w, sent } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);          // alive; reclaim would refuse it
    const runId = seedRun(coord, { program: 'demo-program' });
    const names = [...ARMED, COORDINATOR_PAUSE_MARKER];
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], names, tickOf());
    h.calls.length = 0;
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], names, tickOf());
    expect(hasSessionFor(h, COORD)).toBe(false);
    expect(operatorMail(coord).map((m) => m.toId)).toEqual([WORKER]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: `⚠ stalled › ${WORKER}-ws`, tag: `stall-${runId}-quiet-3-${KEY}` });
    expect(sent[0]!.body).toMatch(/paus/i);
    expect(sent[0]!.body).not.toContain('reclaim');
  });

  it('arming live and escalate after a shadow r1: r2 waits an hour from the LIVE r1 and cites it, never the shadow row', async () => {
    const { h, coord, w } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], [], tickOf());      // shadow r1
    const LIVE_R1 = R1_AT + STALL_SWEEP_MS;
    at(LIVE_R1);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());   // both markers touched at once: the live r1 goes out
    const check = operatorMail(coord);
    expect(check).toHaveLength(1);
    expect(check[0]).toMatchObject({ toId: WORKER, runId, at: LIVE_R1 });
    at(LIVE_R1 + STALL_ESCALATE_MS - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(operatorMail(coord)).toHaveLength(1);      // the hour the live r1's body promised the worker
    at(LIVE_R1 + STALL_ESCALATE_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    const r2 = operatorMail(coord)[1]!;
    expect(r2).toMatchObject({ toId: COORD, runId, at: LIVE_R1 + STALL_ESCALATE_MS });
    expect(r2.subject.startsWith(STALL_REPORT_PREFIX)).toBe(true);
    const body = mailBody(coord, r2.id);
    expect(body).toContain(`Stall check #${check[0]!.id}`);
    expect(body).not.toContain('recorded in shadow');
  });

  it('r2 reports the stall check\'s own delivery row: its queued, delivered and acked times reach the body', async () => {
    const { h, coord, w } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);
    seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    const check = operatorMail(coord)[0]!;
    const d = coord.db.prepare('SELECT id FROM mail_deliveries WHERE mailId = ?').get(check.id) as unknown as { id: number };
    coord.markDelivered(d.id, R1_AT + 5_000);
    coord.markAcked(d.id, R1_AT + 60_000);
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    const r2 = operatorMail(coord)[1]!;
    expect(mailBody(coord, r2.id))
      .toContain(`Stall check #${check.id} was queued at 23:56:31Z, delivered at 23:56:36Z, acked at 23:57:31Z.`);
  });

  it('r2 tells a stall check with NO delivery row from one never delivered: the lane hands null, never a row of nulls', async () => {
    // Departure D-3585 r2-keeps-a-missing-delivery-row: `stallNewestDelivery` answers null for a mail with no delivery row,
    // and `stallReportMail` has a sentence for exactly that. Folding the null into {deliveredAt:null, ackedAt:null}
    // would narrow it to "not delivered, not acked", a claim about a row that does not exist.
    const { h, coord, w } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    const check = operatorMail(coord)[0]!;
    coord.db.prepare('DELETE FROM mail_deliveries WHERE mailId = ?').run(check.id);
    expect(deliveriesOf(coord, check.id)).toEqual([]);   // the control: the check's one delivery row is gone
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    const r2 = operatorMail(coord)[1]!;
    expect(r2).toMatchObject({ toId: COORD, runId, at: R2_AT });
    const body = mailBody(coord, r2.id);
    expect(body).toContain(`Stall check #${check.id} was queued at`);
    expect(body).toContain('has no delivery row');
    expect(body).not.toContain('not delivered');
  });
});

describe('sweepStalls: durability', () => {
  it('a restart (a new FleetWatcher on the same coord.db) does not re-send r1, and r2 still falls due at r1 + 1 h', async () => {
    const { h, coord, w } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);          // alive: r2 goes to it once due
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(operatorMail(coord)).toHaveLength(1);
    const again = await primedWatcher(h, store(h.home));
    at(R1_AT + STALL_SWEEP_MS);
    await again.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(operatorMail(coord)).toHaveLength(1);
    at(R2_AT - STALL_SWEEP_MS);
    await again.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(operatorMail(coord)).toHaveLength(1);      // r2 is timed from the stored r1 row, not from the restart
    at(R2_AT);
    await again.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    const mail = operatorMail(coord);
    expect(mail).toHaveLength(2);
    expect(mail[1]).toMatchObject({ toId: COORD, runId, at: R2_AT });
    expect(mail[1]!.subject.startsWith(STALL_REPORT_PREFIX)).toBe(true);
  });

  it('a restart does not re-push r3', async () => {
    const { h, coord, w, sent } = await rig();
    seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(sent).toHaveLength(1);
    const spy2 = pushSpy();
    const again = await primedWatcher(h, store(h.home), { push: spy2.push as never });
    at(R2_AT + STALL_SWEEP_MS);
    await again.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(spy2.sent).toEqual([]);
  });

  it('a stale notice read re-fires r3: the observation row alone keeps it to one push', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(sent).toHaveLength(1);
    const r3 = stallDetail('live', 'quiet', 3, KEY);
    vi.spyOn(coord, 'runEvents').mockReturnValueOnce(coord.runEvents(runId).filter((e) => e.detail !== r3));
    at(R2_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());   // re-measures the dead coordinator, re-fires r3
    expect(sent).toHaveLength(1);
  });

  it('a store throw on one subject warns and does not stop the next', async () => {
    const { h, coord, w } = await rig();
    seedRegistry(h.home, OTHER_WORKER);
    seedRun(coord, { program: 'prog-a' });
    seedRun(coord, { program: 'prog-b', worker: OTHER_WORKER });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const real = coord.currentAskFor.bind(coord);
    let thrown = false;
    vi.spyOn(coord, 'currentAskFor').mockImplementation((id: string) => {
      if (!thrown) { thrown = true; throw new Error('boom'); }
      return real(id);
    });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER), fleetRow(OTHER_WORKER)], LIVE, tickOf(PID, [regRow(WORKER), regRow(OTHER_WORKER)]));
    expect(operatorMail(coord)).toHaveLength(1);      // the second subject still got its r1
    expect(warn.mock.calls.some((c) => /^ccrc-server: stall-watch run \d+ \(demo-[a-z-]+\) failed \(boom\)/.test(String(c[0])))).toBe(true);
  });

  it('an unreadable or throwing candidate read warns and judges nothing', async () => {
    const { coord, w } = await rig();
    seedRun(coord, { program: 'demo-program' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cands = vi.spyOn(coord, 'stallCandidates').mockReturnValue({ ok: false, kind: 'run-unreadable', detail: 'bad row' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(lines(warn, 'ccrc-server: stall-watch candidates unreadable (run-unreadable: bad row)')).toBe(1);
    cands.mockImplementation(() => { throw new Error('SQLITE_BUSY'); });
    at(R1_AT + STALL_SWEEP_MS);
    await expect(w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf())).resolves.toBeUndefined();
    expect(lines(warn, 'ccrc-server: stall-watch candidate read failed (SQLITE_BUSY)')).toBe(1);
    expect(operatorMail(coord)).toEqual([]);
  });

  it('an unreadable mail read holds that subject, with a warn', async () => {
    const { coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(coord, 'stallMailFor').mockReturnValue({ ok: false, kind: 'mail-unreadable', detail: 'bad row' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(lines(warn, `ccrc-server: stall-watch run ${runId} mail unreadable (mail-unreadable: bad row)`)).toBe(1);
    expect(operatorMail(coord)).toEqual([]);
  });
});

describe('sweepStalls: the inputs the lane measures itself', () => {
  it('reads the RAW live word: a pane at shell, which FleetSession folds to busy, is judged', async () => {
    const { h, coord, w } = await rig();
    seedLiveState(h.home, { status: 'shell' });
    seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER, { status: 'busy' })], LIVE, tickOf());
    expect(operatorMail(coord)).toHaveLength(1);
  });

  it('control: a waiting pane with no ask behind it draws one dialog-cap push at 2 h of quiet', async () => {
    const { h, coord, w, sent } = await rig();
    seedLiveState(h.home, { status: 'waiting' });
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: `⚠ stalled › ${WORKER}-ws (dialog)`, tag: `stall-${runId}-dialog-cap-1-${KEY}` });
    expect(operatorMail(coord)).toEqual([]);          // neither worker nor coordinator can land on waiting
  });

  it('a hookstate ask OLDER than HOOKSTATE_FRESH_MS still holds (2a): the lane reads it unaged', async () => {
    const { h, coord, w, sent } = await rig();
    seedLiveState(h.home, { status: 'waiting' });
    seedHookState(h.home, WORKER, { updatedAt: IDLE_AT - 5_000, ask: { questions: [{ question: 'Which lane?', options: [{ label: 'a' }, { label: 'b' }] }] } });
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);                                        // 2 h after the ask: four times HOOKSTATE_FRESH_MS
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(sent).toEqual([]);
    expect(stallRows(coord, runId)).toEqual([]);
  });

  it('a waiting pane whose hookstate ask is a permission approval, not a question, is 2b: one dialog-cap push at 2 h', async () => {
    // The same time and the same correlation as the case above; only the envelope (and the event that writes it) differs. A
    // PermissionRequest approval (a background subagent's permission prompt among them) is a dialog with no
    // question behind it: spec §4.2 hold 2b, capped by §11 item 8's dialog-cap.
    const { h, coord, w, sent } = await rig();
    seedLiveState(h.home, { status: 'waiting' });
    seedHookState(h.home, WORKER, { updatedAt: IDLE_AT - 5_000, event: 'PermissionRequest', ask: { approval: { tool: 'Bash', summary: 'ls' } } });
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: `⚠ stalled › ${WORKER}-ws (dialog)`, tag: `stall-${runId}-dialog-cap-1-${KEY}` });
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'dialog-cap', 1, KEY)]);
    expect(operatorMail(coord)).toEqual([]);
  });

  it('an auto-continue hold that STARTED 9 min ago holds r1 (limit hold)', async () => {
    const { coord, w } = await rig();
    seedRun(coord, { program: 'demo-program' });
    const m = coord.insertMail({ fromId: 'demo-boss', fromUuid: 'u', toId: WORKER, runId: null, kind: 'finding', subject: 'hi', body: 'b', artifacts: [] });
    const d = coord.queueDelivery(m.id, WORKER, 'envelope');
    coord.backOff(d.id, 'auto-continue-armed', R1_AT - 9 * 60_000 + MAIL_ARMED_HOLD_MS, false);
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(operatorMail(coord)).toEqual([]);
  });

  it('an auto-continue hold that STARTED 12 min ago no longer holds (start = nextAttemptAt − MAIL_ARMED_HOLD_MS)', async () => {
    const { coord, w } = await rig();
    seedRun(coord, { program: 'demo-program' });
    const m = coord.insertMail({ fromId: 'demo-boss', fromUuid: 'u', toId: WORKER, runId: null, kind: 'finding', subject: 'hi', body: 'b', artifacts: [] });
    const d = coord.queueDelivery(m.id, WORKER, 'envelope');
    // nextAttemptAt is 7 min ago. The hold's START is 12 min ago, outside AUTO_CONTINUE_RECENT_MS.
    coord.backOff(d.id, 'auto-continue-armed', R1_AT - 12 * 60_000 + MAIL_ARMED_HOLD_MS, false);
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(operatorMail(coord)).toHaveLength(1);
  });

  it('two overlapping runs on one session: judged once, on the later dispatch, over both runs\' mail', async () => {
    const { coord, w } = await rig();
    // Run A (earlier) carries the worker's last mail; run B (later) carries the newest mail TO it.
    const runA = seedRun(coord, { program: 'prog-a', dispatchedAt: DISPATCHED_AT - 3_600_000, inbound: null });
    const runB = seedRun(coord, { program: 'prog-b', workerMail: null });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(operatorMail(coord).map((m) => m.runId)).toEqual([runB]);
    // KEY, not B's dispatchedAt: the worker's mail on run A is its last mail on the subject.
    expect(stallRows(coord, runB)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
    expect(stallRows(coord, runA)).toEqual([]);
  });

  it('a hand-off (wave-done) holds r1; a rejected wave-done hands the ball back and r1 comes 2 h later', async () => {
    const { coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program', workerMail: { at: WORKER_MAIL_AT, subject: WAVE_DONE_SUBJECT }, inbound: null });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(operatorMail(coord)).toEqual([]);          // the coordinator's ball, below its 30 h cap
    coord.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator', toId: WORKER, runId,
      kind: 'status', subject: 'wave-done-rejected', body: 'b', artifacts: [] });
    at(R1_AT + STALL_QUIET_MS - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(operatorMail(coord)).toEqual([]);          // quiet runs from the rejection
    at(R1_AT + STALL_QUIET_MS);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
  });
});

describe('sweepStalls: fail-shut inputs (hold 1)', () => {
  // Every input the verdict cannot measure holds the worker, and a hold writes NOTHING: no stall row, live or
  // shadow, no mail and no push. Each case runs ARMED at the time a healthy worker draws its first notice, so a
  // fold of the failed read into a healthy value shows as a real send. Each then heals the one fault and sweeps a
  // minute later: the same worker DOES draw that notice, so the empty result above was the fault's hold and
  // nothing else.
  const nothingWritten = (coord: CoordStore, runId: number, sent: readonly PushPayload[]): void => {
    expect(stallRows(coord, runId)).toEqual([]);
    expect(operatorMail(coord)).toEqual([]);
    expect(sent).toEqual([]);
  };

  it('no pane pid (the tick measured null, then no entry at all): held and nothing written; a pid, r1 goes out', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf(null));
    nothingWritten(coord, runId, sent);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, { panePids: new Map(), records: [regRow(WORKER)] });
    nothingWritten(coord, runId, sent);
    at(R1_AT + 2 * STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
  });

  it('no live file for the pane pid (no-state): held and nothing written; the file back, r1 goes out', async () => {
    const { h, coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    rmSync(path.join(h.home, '.claude', 'sessions', `${PID}.json`));
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    nothingWritten(coord, runId, sent);
    seedLiveState(h.home);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
  });

  it('an unrostered wrapper (no config dir): held and nothing written; a rostered wrapper, r1 goes out', async () => {
    const { h, coord, w, sent } = await rig();
    // The lane reads the wrapper off the tick's fleet row; the registry row says the same, for a coherent fixture.
    writeFileSync(path.join(h.home, '.cc-sessions', `${WORKER}.wrapper`), 'demo-unrostered');
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER, { wrapper: 'demo-unrostered' })], ARMED, tickOf());
    nothingWritten(coord, runId, sent);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
  });

  it('waiting, and the tick\'s registry row carries an unmeasured uuid: held and nothing written; measured, the dialog-cap push goes out', async () => {
    const { h, coord, w, sent } = await rig();
    seedLiveState(h.home, { status: 'waiting' });
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);                                        // 2 h of quiet: the dialog-cap is due
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf(PID, [regRow(WORKER, UUID, { unmeasured: ['uuid'] })]));
    nothingWritten(coord, runId, sent);               // the hookstate ask reads `unmeasured`, never "no ask"
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'dialog-cap', 1, KEY)]);
    expect(sent).toHaveLength(1);
  });

  it('waiting, and .hookstate.json unreadable: held and nothing written; readable, the dialog-cap push goes out', async () => {
    let broken = true;
    const { h, coord, w, sent } = await rig({ io: degradedReadIO((p) => broken && p.endsWith(`${WORKER}.hookstate.json`)) });
    seedLiveState(h.home, { status: 'waiting' });
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    nothingWritten(coord, runId, sent);
    broken = false;
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'dialog-cap', 1, KEY)]);
    expect(sent).toHaveLength(1);
  });

  it('waiting, and the asks row unreadable: held and nothing written; readable, the dialog-cap push goes out', async () => {
    const { h, coord, w, sent } = await rig();
    seedLiveState(h.home, { status: 'waiting' });
    const runId = seedRun(coord, { program: 'demo-program' });
    vi.spyOn(coord, 'currentAskFor').mockReturnValueOnce({ ok: false, kind: 'ask-unreadable', detail: 'x' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    nothingWritten(coord, runId, sent);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'dialog-cap', 1, KEY)]);
    expect(sent).toHaveLength(1);
  });

  it('idle, and the auto-continue read unreadable: held and nothing written; readable, r1 goes out', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    vi.spyOn(coord, 'autoContinueHeldUntil').mockReturnValueOnce({ ok: false, kind: 'delivery-unreadable', detail: 'x' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    nothingWritten(coord, runId, sent);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
  });

  it('idle, and the tick\'s fleet row names an unmeasured identity field: held and nothing written; measured, r1 goes out', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER, { unmeasured: ['uuid'] })], ARMED, tickOf());
    nothingWritten(coord, runId, sent);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
  });

  it('idle, and the tick\'s fleet row says its status is unmeasured: held and nothing written; measured, r1 goes out', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER, { statusUnmeasured: true })], ARMED, tickOf());
    nothingWritten(coord, runId, sent);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
  });
});

describe('sweepStalls: wiring', () => {
  it('tick() runs the lane on this tick\'s sessions and registry listing, its markers included', async () => {
    const { h, coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    seedSupervised(h.home, WORKER, R1_AT);
    writeFileSync(path.join(h.home, '.cc-sessions', 'stall-watch-live'), '');
    at(R1_AT);
    await w.tick();
    await vi.waitFor(() => expect(operatorMail(coord)).toHaveLength(1));
    expect(operatorMail(coord)[0]).toMatchObject({ toId: WORKER, runId });
  });

  it('rides tick(): dispatched right after the claim lanes, before primed is set, with no timer of its own', () => {
    const src = readFileSync(path.join(here, '../src/watch.ts'), 'utf8');
    const claims = src.indexOf('this.lapseClaims(sessions);');
    const lane = src.indexOf('void this.sweepStalls(sessions, registryRead.names, { panePids, records }).catch(');
    expect(src).toContain('this.usage, this.currentHeadBranches(), panePids);');   // the pids are assembleFleet's own
    const primed = src.indexOf('this.primed = true;');
    expect(claims).toBeGreaterThan(-1);
    expect(lane).toBeGreaterThan(claims);
    expect(primed).toBeGreaterThan(lane);
    expect(src.match(/setInterval\(/g)).toHaveLength(1);
    expect(src).toContain('export const STALL_SWEEP_MS = CLAIM_SWEEP_MS;');
  });
});

describe('sweepStalls: wave 2 (spec §5)', () => {
  const T0 = IDLE_AT + 1_800_000;                     // any time well inside the worker's first 2 h of quiet

  it('M6: three agent reads per worker, and no pane-pid read — the pid and the uuid are the tick\'s', async () => {
    const reads: string[] = [];
    const { h, coord, w } = await rig({ io: countingIO(reads) });
    seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    h.calls.length = 0;
    reads.length = 0;
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    const mine = reads.filter((p) => p.includes(`${WORKER}.`) || p.endsWith(`/${PID}.json`)).map((p) => path.basename(p)).sort();
    expect(mine).toEqual([`${PID}.json`, `${WORKER}.hookstate.json`, `${WORKER}.turn.json`]);
    expect(listPanes(h)).toBe(0);
    expect(operatorMail(coord)).toHaveLength(1);      // the control: those three reads were enough to judge r1
  });

  it('F4: the run verdict reads run mail only — the worker\'s run-less and off-run mail leave its key and rung as wave 1 had them', async () => {
    const rowsAtR1 = async (withPeer: boolean): Promise<string[]> => {
      const { coord, w } = await rig();
      const runId = seedRun(coord, { program: 'demo-program' });
      if (withPeer) {
        const other = seedRun(coord, { program: 'prog-other', worker: OTHER_WORKER, workerMail: null, inbound: null });
        at(WORKER_MAIL_AT + 600_000);                 // newer than the worker's last run mail: it would move the key
        coord.insertMail({ fromId: WORKER, fromUuid: UUID, toId: 'demo-peer', runId: null, kind: 'question', subject: 'peer q', body: 'b', artifacts: [] });
        coord.insertMail({ fromId: WORKER, fromUuid: UUID, toId: OTHER_WORKER, runId: other, kind: 'finding', subject: 'off-run', body: 'b', artifacts: [] });
        coord.insertMail({ fromId: 'demo-peer', fromUuid: 'u', toId: WORKER, runId: null, kind: 'answer', subject: 'peer a', body: 'b', artifacts: [] });
      }
      at(R1_AT);
      await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
      return stallRows(coord, runId);
    };
    expect(await rowsAtR1(false)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);   // the control
    expect(await rowsAtR1(true)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
  });

  it('dark (no stall-watch-w2-live): a worker whose lifecycle reads orphan for DEAD_GRACE_MS draws a shadow dead row, and no mail', async () => {
    const { coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    const dead = fleetRow(WORKER, { lifecycle: 'orphan' });
    at(T0);
    await w.sweepStalls([dead], ARMED, tickOf());
    at(T0 + DEAD_GRACE_MS);
    await w.sweepStalls([dead], ARMED, tickOf());
    expect(stallRows(coord, runId)).toEqual([stallDetail('shadow', 'dead', 1, KEY)]);
    expect(operatorMail(coord)).toEqual([]);
  });

  it('stall-watch-w2-live: that worker draws a stall: … dead: mail to its coordinator at DEAD_GRACE_MS, not before', async () => {
    const { coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    const dead = fleetRow(WORKER, { lifecycle: 'orphan' });
    at(T0);
    await w.sweepStalls([dead], W2, tickOf());
    at(T0 + DEAD_GRACE_MS - STALL_SWEEP_MS);
    await w.sweepStalls([dead], W2, tickOf());
    expect(operatorMail(coord)).toEqual([]);
    at(T0 + DEAD_GRACE_MS);
    await w.sweepStalls([dead], W2, tickOf());
    const mail = operatorMail(coord);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ toId: COORD, runId, kind: 'status', at: T0 + DEAD_GRACE_MS });
    expect(mail[0]!.subject.startsWith(`${STALL_REPORT_PREFIX} run ${runId} — dead:`)).toBe(true);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'dead', 1, KEY)]);
  });

  it('a worker missing from the tick (its registry row gone) for DEAD_GRACE_MS draws the dead report, naming the absent row', async () => {
    const { coord, w } = await rig();
    seedRun(coord, { program: 'demo-program' });
    const gone = tickOf(PID, []);
    at(T0);
    await w.sweepStalls([], W2, gone);
    at(T0 + DEAD_GRACE_MS - STALL_SWEEP_MS);
    await w.sweepStalls([], W2, gone);
    expect(operatorMail(coord)).toEqual([]);
    at(T0 + DEAD_GRACE_MS);
    await w.sweepStalls([], W2, gone);
    const mail = operatorMail(coord);
    expect(mail.map((m) => m.toId)).toEqual([COORD]);
    expect(mail[0]!.subject).toContain('registry row absent');
  });

  it('the absent clock is in memory: a new watcher (a server restart) starts DEAD_GRACE_MS again', async () => {
    const { h, coord, w } = await rig();
    seedRun(coord, { program: 'demo-program' });
    const gone = tickOf(PID, []);
    at(T0);
    await w.sweepStalls([], W2, gone);
    const again = await primedWatcher(h, store(h.home));
    at(T0 + 5 * 60_000);
    await again.sweepStalls([], W2, gone);
    at(T0 + DEAD_GRACE_MS);
    await again.sweepStalls([], W2, gone);
    expect(operatorMail(coord)).toEqual([]);          // 5 min on the new watcher's clock
    at(T0 + 5 * 60_000 + DEAD_GRACE_MS);
    await again.sweepStalls([], W2, gone);
    expect(operatorMail(coord).map((m) => m.toId)).toEqual([COORD]);
  });

  it('the since-maps are pruned: a worker that leaves the candidates and comes back absent starts DEAD_GRACE_MS again', async () => {
    const { coord, w } = await rig();
    seedRun(coord, { program: 'demo-program' });
    const gone = tickOf(PID, []);
    at(T0);
    await w.sweepStalls([], W2, gone);                // absent since T0
    vi.spyOn(coord, 'stallCandidates').mockReturnValueOnce({ ok: true, runs: [] });
    at(T0 + STALL_SWEEP_MS);
    await w.sweepStalls([], W2, gone);                // no candidates: the prune drops T0
    at(T0 + DEAD_GRACE_MS);
    await w.sweepStalls([], W2, gone);                // absent again, since now
    expect(operatorMail(coord)).toEqual([]);
    at(T0 + 2 * DEAD_GRACE_MS);
    await w.sweepStalls([], W2, gone);
    expect(operatorMail(coord).map((m) => m.toId)).toEqual([COORD]);   // the control: the clock runs from the return
  });

  // Orphan D on a registry row that is no run's worker or coordinator: a restart that lost two background tasks,
  // the live main loop idle since a minute after it.
  const seedOrphan = (home: string, over: Record<string, unknown> = {}): void => {
    seedRegistry(home, ORPHAN, ORPHAN_UUID);
    seedLiveState(home, { statusUpdatedAt: RESTART_AT + 60_000, startedAt: RESTART_AT - 5_000 });
    seedTurnMark(home, ORPHAN, {
      sessionId: ORPHAN_UUID, event: 'SessionStart', at: RESTART_AT, turnAt: RESTART_AT - 900_000,
      stopAt: RESTART_AT - 600_000, restartAt: RESTART_AT, lostBg: 2, lostKinds: 'shell,subagent', lostIds: 'bsh1,bag2', ...over,
    });
  };
  const orphanTick = (): StallTick => tickOf(PID, [regRow(ORPHAN, ORPHAN_UUID)]);
  const D_AT = RESTART_AT + 60_000 + ORPHAN_D_IDLE_MS;

  it('orphan D, run-less: one orphaned: self-mail at ORPHAN_D_IDLE_MS, never a second (another sweep, or a new watcher)', async () => {
    const { h, coord, w } = await rig();
    seedOrphan(h.home);
    at(D_AT - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(ORPHAN)], W2, orphanTick());
    expect(operatorMail(coord)).toEqual([]);          // a minute short of 15 min idle since the restart
    at(D_AT);
    await w.sweepStalls([fleetRow(ORPHAN)], W2, orphanTick());
    const mail = operatorMail(coord);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ toId: ORPHAN, runId: null, kind: 'status', at: D_AT });
    expect(mail[0]!.subject.startsWith(STALL_ORPHANED_PREFIX)).toBe(true);
    at(D_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(ORPHAN)], W2, orphanTick());
    const again = await primedWatcher(h, store(h.home));
    at(D_AT + 2 * STALL_SWEEP_MS);
    await again.sweepStalls([fleetRow(ORPHAN)], W2, orphanTick());
    expect(operatorMail(coord)).toHaveLength(1);      // deduped by its subject, which a restart does not forget
  });

  it('orphan D: ⚠ orphaned once, when the self-mail is still undelivered ORPHAN_PUSH_MS on; a new watcher may push once more (the latch is in memory)', async () => {
    const { h, w, sent } = await rig();
    seedOrphan(h.home);
    at(D_AT);
    await w.sweepStalls([fleetRow(ORPHAN)], W2, orphanTick());
    at(D_AT + ORPHAN_PUSH_MS - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(ORPHAN)], W2, orphanTick());
    expect(sent).toEqual([]);
    at(D_AT + ORPHAN_PUSH_MS);
    await w.sweepStalls([fleetRow(ORPHAN)], W2, orphanTick());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title.startsWith('⚠ orphaned')).toBe(true);
    expect(sent[0]).toMatchObject({ sessionId: ORPHAN, tag: `orphaned-${ORPHAN}-${RESTART_AT}` });
    at(D_AT + ORPHAN_PUSH_MS + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(ORPHAN)], W2, orphanTick());
    expect(sent).toHaveLength(1);
    const spy2 = pushSpy();
    const again = await primedWatcher(h, store(h.home), { push: spy2.push as never });
    at(D_AT + ORPHAN_PUSH_MS + 2 * STALL_SWEEP_MS);
    await again.sweepStalls([fleetRow(ORPHAN)], W2, orphanTick());
    expect(spy2.sent).toHaveLength(1);                 // documented (spec §5.2): the tag collapses the two on the phone
  });

  it('a registry row whose marker lost nothing costs ONE read; one that lost tasks costs two (the live file too)', async () => {
    const reads: string[] = [];
    const { h, w } = await rig({ io: countingIO(reads) });
    seedOrphan(h.home, { lostBg: 0, lostKinds: '', lostIds: '' });
    const orphanReads = (): string[] =>
      reads.filter((p) => p.includes(ORPHAN) || p.endsWith(`/${PID}.json`)).map((p) => path.basename(p)).sort();
    at(D_AT);
    reads.length = 0;
    await w.sweepStalls([fleetRow(ORPHAN)], W2, orphanTick());
    expect(orphanReads()).toEqual([`${ORPHAN}.turn.json`]);
    seedOrphan(h.home);                               // the control: lostBg 2
    at(D_AT + STALL_SWEEP_MS);
    reads.length = 0;
    await w.sweepStalls([fleetRow(ORPHAN)], W2, orphanTick());
    expect(orphanReads()).toEqual([`${PID}.json`, `${ORPHAN}.turn.json`]);
  });

  it('orphan E on a run worker: one orphaned: self-mail on its run, with a run_events row', async () => {
    const { h, coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    seedLiveState(h.home, { startedAt: STARTED_AT });
    seedTurnMark(h.home, WORKER, { bg: 1, bgKinds: 'subagent', bgIds: 'b989ocn62' });
    at(IDLE_AT + ORPHAN_E_IDLE_MS - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], W2_LIVE, tickOf());
    expect(operatorMail(coord)).toEqual([]);
    at(IDLE_AT + ORPHAN_E_IDLE_MS);
    await w.sweepStalls([fleetRow(WORKER)], W2_LIVE, tickOf());
    const mail = operatorMail(coord);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ toId: WORKER, runId, kind: 'status' });
    expect(mail[0]!.subject.startsWith(STALL_ORPHANED_PREFIX)).toBe(true);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'orphan-e', 1, IDLE_AT)]);
  });

  it('(b)-contamination: a coordinator\'s orphan E is run-less — a mail to it, and no row on the run it claims', async () => {
    const { h, coord, w } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);
    const runId = seedRun(coord, { program: 'demo-program' });
    seedLiveState(h.home, { startedAt: STARTED_AT });
    seedTurnMark(h.home, COORD, { sessionId: COORD_UUID, bg: 1, bgKinds: 'workflow', bgIds: 'wf1' });
    at(IDLE_AT + ORPHAN_E_IDLE_MS);
    await w.sweepStalls([fleetRow(WORKER), fleetRow(COORD)], W2_LIVE, tickOf(PID, [regRow(WORKER), regRow(COORD, COORD_UUID)]));
    const mail = operatorMail(coord);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ toId: COORD, runId: null, kind: 'status' });
    expect(mail[0]!.subject.startsWith(STALL_ORPHANED_PREFIX)).toBe(true);
    // A worker's proof (b) counts the orphan-e rows on ITS run; a coordinator's must never land there.
    expect(stallRows(coord, runId)).toEqual([]);
  });

  it('mail-disabled: every mail rung that would send holds; mail-stuck still pushes', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    // Queued at 21:19:17Z and never delivered: 2 h past the worker's idle start at r1's time.
    const m = coord.insertMail({ fromId: 'demo-boss', fromUuid: 'u', toId: WORKER, runId: null, kind: 'finding', subject: 'hi', body: 'b', artifacts: [] });
    const d = coord.queueDelivery(m.id, WORKER, 'envelope');
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], [...W2, 'mail-disabled'], tickOf());
    expect(operatorMail(coord)).toEqual([]);          // r1 would send: held `mail-disabled`
    expect(sent.map((p) => p.tag)).toEqual([`stall-${runId}-mail-stuck-1-${d.id}`]);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'mail-stuck', 1, d.id)]);
  });

  it('mail-disabled: a cap still pushes', async () => {
    const { h, coord, w, sent } = await rig();
    seedLiveState(h.home, { status: 'waiting' });
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], [...ARMED, 'mail-disabled'], tickOf());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ tag: `stall-${runId}-dialog-cap-1-${KEY}` });
  });

  it('mail-disabled: a rung that is shadow anyway still records its shadow row', async () => {
    const { coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ['mail-disabled'], tickOf());
    expect(stallRows(coord, runId)).toEqual([stallDetail('shadow', 'quiet', 1, KEY)]);
    expect(operatorMail(coord)).toEqual([]);
  });

  it('a turn that failed on a token this build cannot classify holds, and warns ONCE (never guessed into a self-wake)', async () => {
    const { h, coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    seedLiveState(h.home, { startedAt: STARTED_AT });
    seedTurnMark(h.home, WORKER, { state: 'failed', event: 'StopFailure', err: 'new_error' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(IDLE_AT + FAILED_IDLE_MS);
    await w.sweepStalls([fleetRow(WORKER)], W2, tickOf());
    at(IDLE_AT + FAILED_IDLE_MS + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], W2, tickOf());
    expect(lines(warn, `ccrc-server: stall-watch unknown StopFailure new_error on ${WORKER}`)).toBe(1);
    expect(operatorMail(coord)).toEqual([]);
    expect(stallRows(coord, runId)).toEqual([]);
  });

  it('hold 2a keeps the identity cut on the RAW read: a question from another process is no ask, so the waiting pane is 2b — one dialog-cap push at 2 h', async () => {
    // The pin the deleted unaged hookstate door's "keeps the identity gate" row carried, moved to the lane that now
    // makes the cut (`stallHookAskOf`): the raw read REPORTS `foreign`, and only a `current` file's ask holds 2a. The control is
    // "a hookstate ask OLDER than HOOKSTATE_FRESH_MS still holds (2a)" above: the same file under this session's
    // own sessionId holds, and nothing is sent.
    const { h, coord, w, sent } = await rig();
    seedLiveState(h.home, { status: 'waiting' });
    seedHookState(h.home, WORKER, {
      sessionId: '2'.repeat(36), updatedAt: IDLE_AT - 5_000,
      ask: { questions: [{ question: 'Which lane?', options: [{ label: 'a' }, { label: 'b' }] }] },
    });
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: `⚠ stalled › ${WORKER}-ws (dialog)`, tag: `stall-${runId}-dialog-cap-1-${KEY}` });
  });

  it('a coordinator whose turn marker stays unreadable MARKER_UNREADABLE_MS draws ⚠ marker once per first-seen time', async () => {
    const { h, coord, w, sent } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);
    seedRun(coord, { program: 'demo-program' });
    const markPath = path.join(h.home, '.cc-sessions', `${COORD}.turn.json`);
    writeFileSync(markPath, '{');                     // malformed
    const both = tickOf(PID, [regRow(WORKER), regRow(COORD, COORD_UUID)]);
    const sessions = [fleetRow(WORKER), fleetRow(COORD)];
    const markerTags = (): (string | undefined)[] => sent.filter((p) => p.title.startsWith('⚠ marker')).map((p) => p.tag);
    const M0 = IDLE_AT;
    at(M0);
    await w.sweepStalls(sessions, W2, both);
    at(M0 + MARKER_UNREADABLE_MS - STALL_SWEEP_MS);
    await w.sweepStalls(sessions, W2, both);
    expect(markerTags()).toEqual([]);
    at(M0 + MARKER_UNREADABLE_MS);
    await w.sweepStalls(sessions, W2, both);
    at(M0 + MARKER_UNREADABLE_MS + STALL_SWEEP_MS);
    await w.sweepStalls(sessions, W2, both);
    expect(markerTags()).toEqual([`stall-${COORD}-marker-unreadable-1-${M0}`]);
    rmSync(markPath);                                 // healed: the first-seen time is dropped
    const M1 = M0 + MARKER_UNREADABLE_MS + 2 * STALL_SWEEP_MS;
    at(M1);
    await w.sweepStalls(sessions, W2, both);
    writeFileSync(markPath, '{');                     // unreadable again: a new first-seen time
    const M2 = M1 + STALL_SWEEP_MS;
    at(M2);
    await w.sweepStalls(sessions, W2, both);
    at(M2 + MARKER_UNREADABLE_MS);
    await w.sweepStalls(sessions, W2, both);
    expect(markerTags()).toEqual([`stall-${COORD}-marker-unreadable-1-${M0}`, `stall-${COORD}-marker-unreadable-1-${M2}`]);
  });

  it('a coordinator\'s mail-stuck is run-less: one push per delivery, held by the in-memory latch, and no row on the run it claims', async () => {
    // Off a run, L1 cannot see a push it already sent (`stallRecordedDone` answers false), so it answers notify on
    // every sweep once MAIL_STUCK_MS has passed. The lane's `stallLatch` is what keeps it to one push.
    const { h, coord, w, sent } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);
    const runId = seedRun(coord, { program: 'demo-program' });
    // To the coordinator ROLE, delivered to the claimant, queued at 21:19:17Z and never delivered.
    const m = coord.insertMail({ fromId: WORKER, fromUuid: UUID, toId: 'coordinator', runId: null, kind: 'question', subject: 'q', body: 'b', artifacts: [] });
    const d = coord.queueDelivery(m.id, COORD, 'envelope');
    const both = tickOf(PID, [regRow(WORKER), regRow(COORD, COORD_UUID)]);
    const sessions = [fleetRow(WORKER), fleetRow(COORD)];
    const stuckTags = (): (string | undefined)[] => sent.filter((p) => p.tag?.includes('-mail-stuck-')).map((p) => p.tag);
    at(IDLE_AT + MAIL_STUCK_MS - STALL_SWEEP_MS);    // idle since 21:56:31Z, a minute short of MAIL_STUCK_MS
    await w.sweepStalls(sessions, W2, both);
    expect(stuckTags()).toEqual([]);
    at(IDLE_AT + MAIL_STUCK_MS);
    await w.sweepStalls(sessions, W2, both);
    at(IDLE_AT + MAIL_STUCK_MS + STALL_SWEEP_MS);
    await w.sweepStalls(sessions, W2, both);
    expect(stuckTags()).toEqual([`stall-${COORD}-mail-stuck-1-${d.id}`]);
    expect(stallRows(coord, runId)).toEqual([]);
  });

  it('an identity the tick cannot measure reads neither the marker nor the hookstate: the live file is the one read', async () => {
    // A marker or a hookstate cannot be compared with an identity nobody measured, so neither file is opened. M6's
    // row above is the control: the same worker, measured, costs exactly the live file, the marker and the hookstate.
    const reads: string[] = [];
    const { coord, w } = await rig({ io: countingIO(reads) });
    seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    reads.length = 0;
    await w.sweepStalls([fleetRow(WORKER)], W2, tickOf(PID, [regRow(WORKER, UUID, { unmeasured: ['uuid'] })]));
    const mine = reads.filter((p) => p.includes(`${WORKER}.`) || p.endsWith(`/${PID}.json`)).map((p) => path.basename(p));
    expect(mine).toEqual([`${PID}.json`]);
  });

  it('an identity the tick cannot measure reads no marker, so 2 h of it starts no marker-unreadable clock (worker or coordinator)', async () => {
    // The clock counts only a marker READ that answered `unmeasured` or `malformed`. An unmeasured registry uuid
    // reads neither the marker nor the hookstate; the `unmeasured` the lane then carries is its own, not the file's.
    const { h, coord, w, sent } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);
    const runId = seedRun(coord, { program: 'demo-program' });
    const sessions = [fleetRow(WORKER), fleetRow(COORD)];
    const markerTags = (): (string | undefined)[] => sent.filter((p) => p.title.startsWith('⚠ marker')).map((p) => p.tag);
    const unmeasured = tickOf(PID, [regRow(WORKER, UUID, { unmeasured: ['uuid'] }), regRow(COORD, COORD_UUID, { unmeasured: ['uuid'] })]);
    const M0 = IDLE_AT;
    for (const t of [M0, M0 + MARKER_UNREADABLE_MS, M0 + 2 * MARKER_UNREADABLE_MS]) {
      at(t);
      await w.sweepStalls(sessions, W2, unmeasured);
    }
    expect(markerTags()).toEqual([]);
    // The control: the worker's identity measured and its marker malformed. The clock starts on that READ, and the
    // arm fires an hour later, so the silence above is the identity rule's and not an arm that cannot fire here.
    writeFileSync(path.join(h.home, '.cc-sessions', `${WORKER}.turn.json`), '{');
    const measured = tickOf(PID, [regRow(WORKER), regRow(COORD, COORD_UUID, { unmeasured: ['uuid'] })]);
    const M1 = M0 + 2 * MARKER_UNREADABLE_MS + STALL_SWEEP_MS;
    at(M1);
    await w.sweepStalls(sessions, W2, measured);
    at(M1 + MARKER_UNREADABLE_MS);
    await w.sweepStalls(sessions, W2, measured);
    expect(markerTags()).toEqual([`stall-${runId}-marker-unreadable-1-${KEY}`]);
  });
});

describe('sweepStalls: wave 2, the session arms on every subject kind and the lane\'s own bookkeeping', () => {
  const T0 = IDLE_AT + 1_800_000;                     // well inside the worker's first 2 h of quiet
  const D_AT = RESTART_AT + 60_000 + ORPHAN_D_IDLE_MS;
  /** Case D's marker on `id`: a restart that lost two background tasks, the live main loop idle since a minute
   *  after it (the same live file serves every pane here: one PID). */
  const seedCaseD = (home: string, id: string, sessionId: string): void => {
    seedLiveState(home, { statusUpdatedAt: RESTART_AT + 60_000, startedAt: RESTART_AT - 5_000 });
    seedTurnMark(home, id, {
      sessionId, event: 'SessionStart', at: RESTART_AT, turnAt: RESTART_AT - 900_000,
      stopAt: RESTART_AT - 600_000, restartAt: RESTART_AT, lostBg: 2, lostKinds: 'workflow,subagent', lostIds: 'wf1,bag2',
    });
  };
  const orphanedTo = (coord: CoordStore, id: string): MailRow[] =>
    operatorMail(coord).filter((m) => m.toId === id && m.subject.startsWith(STALL_ORPHANED_PREFIX));

  it('a coordinator draws orphan D, run-less: one orphaned: self-mail with no run, and no row on the run it claims', async () => {
    // Spec §5.2: orphan (D) is for ANY session (slug `coordinators-draw-orphan-d`). A coordinator restarted with a
    // Workflow in flight is Case D's own shape, and orphan E cannot see it: the restart is after the Stop.
    const { h, coord, w } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);
    const runId = seedRun(coord, { program: 'demo-program' });
    seedCaseD(h.home, COORD, COORD_UUID);
    const both = tickOf(PID, [regRow(WORKER), regRow(COORD, COORD_UUID)]);
    const sessions = [fleetRow(WORKER), fleetRow(COORD)];
    at(D_AT);
    await w.sweepStalls(sessions, W2, both);
    at(D_AT + STALL_SWEEP_MS);
    await w.sweepStalls(sessions, W2, both);
    const mail = orphanedTo(coord, COORD);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ toId: COORD, runId: null, kind: 'status', at: D_AT });
    expect(stallRows(coord, runId)).toEqual([]);      // run-less: never on the run it claims
  });

  it('a run worker draws its own orphan D: one orphaned: self-mail on its run, and the delayed push is tagged orphaned-<worker>-<restartAt>', async () => {
    // Spec §5.2 "any session", and §4.2: the delayed orphan push's tag is orphaned-<toId>-<restartAt> for every
    // session, a run worker's included (`stallPushRoute`).
    const { h, coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    seedCaseD(h.home, WORKER, UUID);
    at(D_AT);
    await w.sweepStalls([fleetRow(WORKER)], W2, tickOf());
    const mail = orphanedTo(coord, WORKER);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ runId, kind: 'status', at: D_AT });
    at(D_AT + ORPHAN_PUSH_MS - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], W2, tickOf());
    expect(sent).toEqual([]);
    at(D_AT + ORPHAN_PUSH_MS);                        // the self-mail still undelivered ORPHAN_PUSH_MS on
    await w.sweepStalls([fleetRow(WORKER)], W2, tickOf());
    at(D_AT + ORPHAN_PUSH_MS + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], W2, tickOf());
    expect(sent.map((p) => p.tag)).toEqual([`orphaned-${WORKER}-${RESTART_AT}`]);
    expect(stallRows(coord, runId)).toEqual([
      stallDetail('live', 'orphan-d', 1, RESTART_AT), stallDetail('live', 'orphan-d', 2, RESTART_AT),
    ]);
  });

  it('a coordinator\'s repeated failure stays a repeat after its prior failed: mail leaves the 24 h read (failed-arm-bounded-by-the-mail-horizon)', async () => {
    // A prior failed: self-mail at S2 - 1 h, a server_error at S2. The repeat goes to the operator and never wakes the
    // session. A day later the prior mail is out of the lane's read, and the arm must not re-read the standing failure
    // as a first one and type a retry nudge into the pane.
    const { h, coord, w, sent } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);
    seedRun(coord, { program: 'demo-program' });
    const S2 = IDLE_AT;
    const PRIOR_AT = S2 - 3_600_000;
    at(PRIOR_AT);
    coord.insertMail({ fromId: 'operator', fromUuid: 'operator', toId: COORD, runId: null, kind: 'status',
      subject: stallFailedSubject('overloaded', PRIOR_AT - 600_000), body: 'b', artifacts: [] });
    seedLiveState(h.home, { startedAt: STARTED_AT });
    seedTurnMark(h.home, COORD, { sessionId: COORD_UUID, state: 'failed', event: 'StopFailure', err: 'server_error', at: S2, stopAt: S2 });
    const both = tickOf(PID, [regRow(WORKER), regRow(COORD, COORD_UUID)]);
    const sessions = [fleetRow(WORKER), fleetRow(COORD)];
    const failedMail = (): MailRow[] => operatorMail(coord).filter((m) => m.toId === COORD && m.subject.startsWith(STALL_FAILED_PREFIX));
    at(S2 + FAILED_IDLE_MS);
    await w.sweepStalls(sessions, W2, both);
    expect(sent.map((p) => p.tag)).toContain(`stall-${COORD}-failed-2-${S2}`);
    expect(failedMail()).toHaveLength(1);             // the prior one only: a repeat sends no self-wake
    at(PRIOR_AT + BACKLOG_HORIZON_MS + 60_000);       // the prior mail has left the read
    await w.sweepStalls(sessions, W2, both);
    expect(failedMail()).toHaveLength(1);
  });

  // Slug `stall-clocks-drop-on-an-unobserved-gap`. A first-seen clock claims "true at every sweep since", so a window in
  // which the lane observed nothing must restart it. The worker is absent at T0, the lane is blind for one step, and
  // three hours later the worker is absent again: the dead report waits DEAD_GRACE_MS from the return, never fires
  // at once with a duration nobody watched. One row per place the lane loses sight of the fleet.
  type Blind = (c: { coord: CoordStore; w: FleetWatcher; gone: StallTick; registry: { blind: boolean } }) => Promise<void>;
  const BLIND: [string, Blind][] = [
    ['stall-watch-disabled', async ({ w, gone }) => { await w.sweepStalls([], ['stall-watch-disabled', ...W2], gone); }],
    ['an unreadable candidate read', async ({ coord, w, gone }) => {
      vi.spyOn(coord, 'stallCandidates').mockReturnValueOnce({ ok: false, kind: 'run-unreadable', detail: 'bad row' });
      await w.sweepStalls([], W2, gone);
    }],
    ['a throwing candidate read', async ({ coord, w, gone }) => {
      vi.spyOn(coord, 'stallCandidates').mockImplementationOnce(() => { throw new Error('SQLITE_BUSY'); });
      await w.sweepStalls([], W2, gone);
    }],
    ['a tick whose registry will not list (the lane never runs)', async ({ w, registry }) => {
      registry.blind = true;
      await w.tick();
      registry.blind = false;
    }],
  ];
  it.each(BLIND)('a window the lane did not observe drops its first-seen clocks: %s', async (_name, blindStep) => {
    const registry = { blind: false };
    const io: FleetIO = {
      ...localIO,
      readdir: async (p, t, sig) => (registry.blind && p.endsWith('.cc-sessions') ? null : localIO.readdir(p, t, sig)),
    };
    const { coord, w } = await rig({ io });
    seedRun(coord, { program: 'demo-program' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gone = tickOf(PID, []);
    const reports = (): MailRow[] => operatorMail(coord).filter((m) => m.toId === COORD);
    at(T0);
    await w.sweepStalls([], W2, gone);                // absent since T0
    at(T0 + STALL_SWEEP_MS);
    await blindStep({ coord, w, gone, registry });    // the lane observes nothing
    const BACK = T0 + 3 * 3_600_000;
    at(BACK);
    await w.sweepStalls([], W2, gone);                // absent again: since now, not since T0
    at(BACK + DEAD_GRACE_MS - STALL_SWEEP_MS);
    await w.sweepStalls([], W2, gone);
    expect(reports()).toEqual([]);
    at(BACK + DEAD_GRACE_MS);                         // the control: the arm fires, a full grace after the return
    await w.sweepStalls([], W2, gone);
    expect(reports()).toHaveLength(1);
  });
});

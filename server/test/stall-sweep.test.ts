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
import { FleetWatcher, STALL_SWEEP_MS } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { COORDINATOR_PAUSE_MARKER } from '../src/coord/rundefs.js';
import {
  STALL_CHECK_PREFIX, STALL_ESCALATE_MS, STALL_OPERATOR_MS, STALL_QUIET_MS, STALL_REPORT_PREFIX,
  parseStallDetail, stallDetail,
} from '../src/coord/stall.js';
import type { PushPayload } from '../src/push.js';
import { WAVE_DONE_SUBJECT, type FleetSession } from '../../shared/api.js';
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
const hasSessionFor = (h: Harness, id: string): boolean =>
  h.calls.some((a) => a[0] === 'has-session' && a.includes(`cc-${id}`));

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
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
    expect(operatorMail(coord)).toEqual([]);
    await w.tick();                         // priming: the tick's own dispatch returns unprimed
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
    expect(operatorMail(coord).map((m) => m.runId)).toEqual([runId]);
  });

  it('runs on its own clock: a second sweep inside STALL_SWEEP_MS does nothing', async () => {
    const { coord, w } = await rig();
    seedRun(coord, { program: 'demo-program' });
    at(R1_AT - STALL_SWEEP_MS / 2);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);    // quiet 2h less 30 s: none, but the clock is stamped
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);    // due, but 30 s after the last sweep
    expect(operatorMail(coord)).toEqual([]);
    at(R1_AT + STALL_SWEEP_MS / 2);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
    expect(operatorMail(coord)).toHaveLength(1);
  });

  it('holds one sweep in flight: a sweep started while one awaits its reads does nothing', async () => {
    const { h, coord, w } = await rig();
    seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    h.calls.length = 0;
    const first = w.sweepStalls([fleetRow(WORKER)], LIVE);
    at(R1_AT + STALL_SWEEP_MS);                       // the clock alone would let the second through
    const second = w.sweepStalls([fleetRow(WORKER)], LIVE);
    await Promise.all([first, second]);
    expect(listPanes(h)).toBe(1);
    expect(operatorMail(coord)).toHaveLength(1);
  });

  it('stall-watch-disabled: the lane returns before reading anything; nothing is recorded or sent', async () => {
    const { h, coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    h.calls.length = 0;
    await w.sweepStalls([fleetRow(WORKER)], ['stall-watch-disabled', ...ARMED]);
    expect(listPanes(h)).toBe(0);
    expect(operatorMail(coord)).toEqual([]);
    expect(stallRows(coord, runId)).toEqual([]);
  });

  it('does nothing, and warns nothing, without a coordination store', async () => {
    const h = harness();
    const w = new FleetWatcher({ ...testDeps(h.home, h.run) }, new Bus(), 2000, path.join(h.home, 'state-cache.json'));
    await w.tick();
    seedRegistry(h.home, WORKER);
    seedLiveState(h.home);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(R1_AT);
    h.calls.length = 0;
    await expect(w.sweepStalls([fleetRow(WORKER)], LIVE)).resolves.toBeUndefined();
    expect(lines(warn, 'stall-watch')).toBe(0);
    expect(listPanes(h)).toBe(0);
  });
});

describe('sweepStalls: shadow and live (S4)', () => {
  it('shadow (no stall-watch-live): one stall-shadow row and one warn per fire, no mail, no repeat', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], []);
    expect(stallRows(coord, runId)).toEqual([stallDetail('shadow', 'quiet', 1, KEY)]);
    expect(lines(warn, `ccrc-server: stall-watch shadow quiet r1 run ${runId} ${WORKER}`)).toBe(1);
    expect(operatorMail(coord)).toEqual([]);
    expect(sent).toEqual([]);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], []);
    expect(lines(warn, 'stall-watch shadow')).toBe(1);
    expect(stallRows(coord, runId)).toHaveLength(1);
  });

  it('live: r1 is a stall-check mail from operator to the worker at 2 h of quiet, recorded, never pushed', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
    expect(operatorMail(coord)).toEqual([]);          // one minute short of 2 h
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
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
    await w.sweepStalls([fleetRow(WORKER)], []);
    vi.spyOn(coord, 'runEvents').mockReturnValueOnce([]);   // the verdict sees no r1 row and fires r1 again
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], []);
    expect(lines(warn, 'stall-watch shadow')).toBe(1);
    expect(stallRows(coord, runId)).toHaveLength(1);
  });

  it('arming mid-episode, end to end: a shadow r1, then stall-watch-live sends ONE check, and r2 waits an hour from it', async () => {
    const { h, coord, w } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);          // alive, so r2 is a (shadow) report and never an r3
    const runId = seedRun(coord, { program: 'demo-program' });
    const checks = (): MailRow[] => operatorMail(coord).filter((m) => m.subject.startsWith(STALL_CHECK_PREFIX));
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], []);      // shadow: a stall-shadow r1 row, no mail
    expect(checks()).toEqual([]);
    const LIVE_R1 = R1_AT + STALL_SWEEP_MS;
    at(LIVE_R1);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);    // stall-watch-live touched: the pending r1 goes out once
    expect(checks()).toHaveLength(1);
    expect(checks()[0]).toMatchObject({ toId: WORKER, runId, at: LIVE_R1 });
    at(LIVE_R1 + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
    expect(checks()).toHaveLength(1);
    const r1Rows = [stallDetail('shadow', 'quiet', 1, KEY), stallDetail('live', 'quiet', 1, KEY)];
    at(LIVE_R1 + STALL_ESCALATE_MS - STALL_SWEEP_MS); // an hour after the SHADOW r1: r2 is not due
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
    expect(stallRows(coord, runId)).toEqual(r1Rows);
    at(LIVE_R1 + STALL_ESCALATE_MS);                  // an hour after the LIVE r1: r2, shadow without escalate
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
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
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
    at(R3_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
    expect(stallRows(coord, runId)).toEqual([
      stallDetail('live', 'quiet', 1, KEY),
      stallDetail('shadow', 'quiet', 2, KEY),
      stallDetail('shadow', 'quiet', 3, KEY),
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
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    at(R2_AT - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(operatorMail(coord)).toHaveLength(1);      // r2 not due yet
    h.calls.length = 0;
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
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
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      title: `⚠ stalled › ${WORKER}-ws`, sessionId: WORKER, tag: `stall-${runId}-quiet-3-${KEY}`,
    });
    expect(sent[0]!.body).toContain('/reclaim');
    expect(operatorMail(coord).map((m) => m.toId)).toEqual([WORKER]);   // no r2 mail
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY), stallDetail('live', 'quiet', 3, KEY)]);
    at(R2_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(sent).toHaveLength(1);
  });

  it('coordination paused: r2 is skipped without measuring, and r3 names the pause, never reclaim', async () => {
    const { h, coord, w, sent } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);          // alive; reclaim would refuse it
    const runId = seedRun(coord, { program: 'demo-program' });
    const names = [...ARMED, COORDINATOR_PAUSE_MARKER];
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], names);
    h.calls.length = 0;
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], names);
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
    await w.sweepStalls([fleetRow(WORKER)], []);      // shadow r1
    const LIVE_R1 = R1_AT + STALL_SWEEP_MS;
    at(LIVE_R1);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);   // both markers touched at once: the live r1 goes out
    const check = operatorMail(coord);
    expect(check).toHaveLength(1);
    expect(check[0]).toMatchObject({ toId: WORKER, runId, at: LIVE_R1 });
    at(LIVE_R1 + STALL_ESCALATE_MS - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(operatorMail(coord)).toHaveLength(1);      // the hour the live r1's body promised the worker
    at(LIVE_R1 + STALL_ESCALATE_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
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
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    const check = operatorMail(coord)[0]!;
    const d = coord.db.prepare('SELECT id FROM mail_deliveries WHERE mailId = ?').get(check.id) as unknown as { id: number };
    coord.markDelivered(d.id, R1_AT + 5_000);
    coord.markAcked(d.id, R1_AT + 60_000);
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    const r2 = operatorMail(coord)[1]!;
    expect(mailBody(coord, r2.id))
      .toContain(`Stall check #${check.id} was queued at 23:56:31Z, delivered at 23:56:36Z, acked at 23:57:31Z.`);
  });

  it('r2 tells a stall check with NO delivery row from one never delivered: the lane hands null, never a row of nulls', async () => {
    // Departure r2-keeps-a-missing-delivery-row: `deliveryTimesFor` answers null for a mail with no delivery row,
    // and `stallReportMail` has a sentence for exactly that. Folding the null into {deliveredAt:null, ackedAt:null}
    // would narrow it to "not delivered, not acked", a claim about a row that does not exist.
    const { h, coord, w } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    const check = operatorMail(coord)[0]!;
    coord.db.prepare('DELETE FROM mail_deliveries WHERE mailId = ?').run(check.id);
    expect(deliveriesOf(coord, check.id)).toEqual([]);   // the control: the check's one delivery row is gone
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
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
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(operatorMail(coord)).toHaveLength(1);
    const again = await primedWatcher(h, store(h.home));
    at(R1_AT + STALL_SWEEP_MS);
    await again.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(operatorMail(coord)).toHaveLength(1);
    at(R2_AT - STALL_SWEEP_MS);
    await again.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(operatorMail(coord)).toHaveLength(1);      // r2 is timed from the stored r1 row, not from the restart
    at(R2_AT);
    await again.sweepStalls([fleetRow(WORKER)], ARMED);
    const mail = operatorMail(coord);
    expect(mail).toHaveLength(2);
    expect(mail[1]).toMatchObject({ toId: COORD, runId, at: R2_AT });
    expect(mail[1]!.subject.startsWith(STALL_REPORT_PREFIX)).toBe(true);
  });

  it('a restart does not re-push r3', async () => {
    const { h, coord, w, sent } = await rig();
    seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(sent).toHaveLength(1);
    const spy2 = pushSpy();
    const again = await primedWatcher(h, store(h.home), { push: spy2.push as never });
    at(R2_AT + STALL_SWEEP_MS);
    await again.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(spy2.sent).toEqual([]);
  });

  it('a stale notice read re-fires r3: the observation row alone keeps it to one push', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    at(R2_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(sent).toHaveLength(1);
    const r3 = stallDetail('live', 'quiet', 3, KEY);
    vi.spyOn(coord, 'runEvents').mockReturnValueOnce(coord.runEvents(runId).filter((e) => e.detail !== r3));
    at(R2_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);   // re-measures the dead coordinator, re-fires r3
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
    await w.sweepStalls([fleetRow(WORKER), fleetRow(OTHER_WORKER)], LIVE);
    expect(operatorMail(coord)).toHaveLength(1);      // the second subject still got its r1
    expect(warn.mock.calls.some((c) => /^ccrc-server: stall-watch run \d+ \(demo-[a-z-]+\) failed \(boom\)/.test(String(c[0])))).toBe(true);
  });

  it('an unreadable or throwing candidate read warns and judges nothing', async () => {
    const { coord, w } = await rig();
    seedRun(coord, { program: 'demo-program' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cands = vi.spyOn(coord, 'stallCandidates').mockReturnValue({ ok: false, kind: 'run-unreadable', detail: 'bad row' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
    expect(lines(warn, 'ccrc-server: stall-watch candidates unreadable (run-unreadable: bad row)')).toBe(1);
    cands.mockImplementation(() => { throw new Error('SQLITE_BUSY'); });
    at(R1_AT + STALL_SWEEP_MS);
    await expect(w.sweepStalls([fleetRow(WORKER)], LIVE)).resolves.toBeUndefined();
    expect(lines(warn, 'ccrc-server: stall-watch candidate read failed (SQLITE_BUSY)')).toBe(1);
    expect(operatorMail(coord)).toEqual([]);
  });

  it('an unreadable mail read holds that subject, with a warn', async () => {
    const { coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(coord, 'mailOnRuns').mockReturnValue({ ok: false, kind: 'mail-unreadable', detail: 'bad row' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
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
    await w.sweepStalls([fleetRow(WORKER, { status: 'busy' })], LIVE);
    expect(operatorMail(coord)).toHaveLength(1);
  });

  it('control: a waiting pane with no ask behind it draws one dialog-cap push at 2 h of quiet', async () => {
    const { h, coord, w, sent } = await rig();
    seedLiveState(h.home, { status: 'waiting' });
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
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
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
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
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
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
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
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
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
    expect(operatorMail(coord)).toHaveLength(1);
  });

  it('two overlapping runs on one session: judged once, on the later dispatch, over both runs\' mail', async () => {
    const { coord, w } = await rig();
    // Run A (earlier) carries the worker's last mail; run B (later) carries the newest mail TO it.
    const runA = seedRun(coord, { program: 'prog-a', dispatchedAt: DISPATCHED_AT - 3_600_000, inbound: null });
    const runB = seedRun(coord, { program: 'prog-b', workerMail: null });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
    expect(operatorMail(coord).map((m) => m.runId)).toEqual([runB]);
    // KEY, not B's dispatchedAt: the worker's mail on run A is its last mail on the subject.
    expect(stallRows(coord, runB)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
    expect(stallRows(coord, runA)).toEqual([]);
  });

  it('a hand-off (wave-done) holds r1; a rejected wave-done hands the ball back and r1 comes 2 h later', async () => {
    const { coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program', workerMail: { at: WORKER_MAIL_AT, subject: WAVE_DONE_SUBJECT }, inbound: null });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
    expect(operatorMail(coord)).toEqual([]);          // the coordinator's ball, below its 30 h cap
    coord.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator', toId: WORKER, runId,
      kind: 'status', subject: 'wave-done-rejected', body: 'b', artifacts: [] });
    at(R1_AT + STALL_QUIET_MS - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
    expect(operatorMail(coord)).toEqual([]);          // quiet runs from the rejection
    at(R1_AT + STALL_QUIET_MS);
    await w.sweepStalls([fleetRow(WORKER)], LIVE);
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

  it('no pane pid (tmux answers non-zero, then empty): held and nothing written; the pane back, r1 goes out', async () => {
    const { h, coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    h.panes.code = 1;
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    nothingWritten(coord, runId, sent);
    h.panes.code = 0;
    h.panes.stdout = '';
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    nothingWritten(coord, runId, sent);
    h.panes.stdout = `${PID}\n`;
    at(R1_AT + 2 * STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
  });

  it('no live file for the pane pid (no-state): held and nothing written; the file back, r1 goes out', async () => {
    const { h, coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    rmSync(path.join(h.home, '.claude', 'sessions', `${PID}.json`));
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    nothingWritten(coord, runId, sent);
    seedLiveState(h.home);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
  });

  it('an unrostered wrapper (no config dir): held and nothing written; a rostered wrapper, r1 goes out', async () => {
    const { h, coord, w, sent } = await rig();
    // The lane reads the wrapper off the tick's fleet row; the registry row says the same, for a coherent fixture.
    writeFileSync(path.join(h.home, '.cc-sessions', `${WORKER}.wrapper`), 'demo-unrostered');
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER, { wrapper: 'demo-unrostered' })], ARMED);
    nothingWritten(coord, runId, sent);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
  });

  it('waiting, and the registry .uuid unreadable: held and nothing written; readable, the dialog-cap push goes out', async () => {
    let broken = true;
    const { h, coord, w, sent } = await rig({ io: degradedReadIO((p) => broken && p.endsWith(`${WORKER}.uuid`)) });
    seedLiveState(h.home, { status: 'waiting' });
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);                                        // 2 h of quiet: the dialog-cap is due
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    nothingWritten(coord, runId, sent);
    broken = false;
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'dialog-cap', 1, KEY)]);
    expect(sent).toHaveLength(1);
  });

  it('waiting, and .hookstate.json unreadable: held and nothing written; readable, the dialog-cap push goes out', async () => {
    let broken = true;
    const { h, coord, w, sent } = await rig({ io: degradedReadIO((p) => broken && p.endsWith(`${WORKER}.hookstate.json`)) });
    seedLiveState(h.home, { status: 'waiting' });
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    nothingWritten(coord, runId, sent);
    broken = false;
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'dialog-cap', 1, KEY)]);
    expect(sent).toHaveLength(1);
  });

  it('waiting, and the asks row unreadable: held and nothing written; readable, the dialog-cap push goes out', async () => {
    const { h, coord, w, sent } = await rig();
    seedLiveState(h.home, { status: 'waiting' });
    const runId = seedRun(coord, { program: 'demo-program' });
    vi.spyOn(coord, 'currentAskFor').mockReturnValueOnce({ ok: false, kind: 'ask-unreadable', detail: 'x' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    nothingWritten(coord, runId, sent);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'dialog-cap', 1, KEY)]);
    expect(sent).toHaveLength(1);
  });

  it('idle, and the auto-continue read unreadable: held and nothing written; readable, r1 goes out', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    vi.spyOn(coord, 'autoContinueHeldUntil').mockReturnValueOnce({ ok: false, kind: 'delivery-unreadable', detail: 'x' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    nothingWritten(coord, runId, sent);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
  });

  it('idle, and the tick\'s fleet row names an unmeasured identity field: held and nothing written; measured, r1 goes out', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER, { unmeasured: ['uuid'] })], ARMED);
    nothingWritten(coord, runId, sent);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
  });

  it('idle, and the tick\'s fleet row says its status is unmeasured: held and nothing written; measured, r1 goes out', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER, { statusUnmeasured: true })], ARMED);
    nothingWritten(coord, runId, sent);
    at(R1_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], ARMED);
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
    const lane = src.indexOf('void this.sweepStalls(sessions, registryRead.names).catch(');
    const primed = src.indexOf('this.primed = true;');
    expect(claims).toBeGreaterThan(-1);
    expect(lane).toBeGreaterThan(claims);
    expect(primed).toBeGreaterThan(lane);
    expect(src.match(/setInterval\(/g)).toHaveLength(1);
    expect(src).toContain('export const STALL_SWEEP_MS = CLAIM_SWEEP_MS;');
  });
});

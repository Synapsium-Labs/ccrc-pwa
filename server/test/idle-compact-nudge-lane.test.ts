// D-5373 `idle-compact-nudge`: the watcher lane end to end. `sweepIdleCompactNudge` READS (fleet row, live status,
// turn marker, task list, transcript tail), `decideIdleCompactNudge` DECIDES (`idle-compact-nudge.test.ts` pins every
// hold), and the lane types through `sendPrompt` once per compaction. The harness idioms are stall-sweep.test.ts's:
// a fixture HOME, a scripted tmux Runner, a primed watcher, and `Date` faked alone. Fixture rows are the measured
// shapes (`idleNudgeFixtures.ts`), with neutral content.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher, IDLE_NUDGE_SWEEP_MS, type StallTick } from '../src/watch.js';
import type { SessionRecord } from '../src/registry.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { configDirFor } from '../src/config.js';
import { transcriptPath } from '../src/transcript/resolve.js';
import { IDLE_NUDGE_DISABLED_MARKER, idleNudgeFeedBody, idleNudgeRefusedBody } from '../src/idlenudge.js';
import { IDLE_COMPACT_NUDGE_PROMPT, type FleetSession } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { IDLE_TAIL, ROW, T_NOTICE, T_STOP, jsonl } from './idleNudgeFixtures.js';

const ID = 'demo-quiet-mesa';
const UUID = 'a'.repeat(36);
const PID = 4242;
const WORKDIR = '/w/demo';
/** 40 s after the notice: past the 30 s settle. */
const NOW = T_NOTICE + 40_000;
const PRIME_AT = T_STOP - 7_200_000;

const at = (ms: number): void => { vi.setSystemTime(ms); };

interface Harness { home: string; calls: string[][]; run: Runner }

/** A STATEFUL pane: an empty box, which echoes the literal text once `send-keys -l` typed it and empties on the next
 *  key press — whatever else captured the pane first (`detectDialogs` on a full tick). `fixed` pins one pane instead
 *  (a draft in the box). */
const harness = (fixed?: string): Harness => {
  const home = mkTmp('ccrc-idle-nudge-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const calls: string[][] = [];
  let box = '';
  const run: Runner = async (_cmd, args) => {
    calls.push([...args]);
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { code: 0, stdout: fixed ?? `❯ ${box}\n`, stderr: '' };
    if (args[0] === 'send-keys') {
      box = args[3] === '-l' ? box + args[5]! : '';
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: '' };
  };
  return { home, calls, run };
};

/** EVERY key press, not only literal text: a refusal must come before any keystroke (no C-u over a draft either). */
const anySends = (calls: string[][]): string[][] => calls.filter((a) => a[0] === 'send-keys');

const literalSends = (calls: string[][]): string[] =>
  calls.filter((a) => a[0] === 'send-keys' && a[3] === '-l').map((a) => a[5]!);

const cfgDir = (home: string): string => configDirFor(testDeps(home).cfg, 'claude')!;

const seedRegistry = (home: string): void => {
  const reg = path.join(home, '.cc-sessions');
  const fields = { wrapper: 'claude', project: 'demo', workdir: WORKDIR, uuid: UUID, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
};
const seedLive = (home: string, over: Record<string, unknown> = {}): void => {
  const dir = path.join(cfgDir(home), 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: UUID, cwd: WORKDIR, name: null, nameSource: null, status: 'idle',
    statusUpdatedAt: T_NOTICE, startedAt: T_STOP - 3_600_000, version: '2.1.302', ...over,
  }));
};
/** The marker after the Stop: `done`, no background task. */
const seedMark = (home: string, over: Record<string, unknown> = {}): void => {
  writeFileSync(path.join(home, '.cc-sessions', `${ID}.turn.json`), JSON.stringify({
    v: 1, sessionId: UUID, state: 'done', event: 'Stop', at: T_STOP + 1_000, turnAt: T_STOP - 60_000, stopAt: T_STOP + 1_000,
    bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', ...over,
  }));
};
/** A task list touched `ageMs` before NOW: one completed, one in progress, one pending. */
const seedTasks = (home: string, ageMs: number): void => {
  const dir = path.join(cfgDir(home), 'tasks', UUID);
  mkdirSync(dir, { recursive: true });
  const t = (NOW - ageMs) / 1000;
  ['completed', 'in_progress', 'pending'].forEach((status, i) => {
    const f = path.join(dir, `${i + 1}.json`);
    writeFileSync(f, JSON.stringify({ id: String(i + 1), subject: `Step ${i + 1}`, activeForm: `Doing step ${i + 1}`, description: '', status }));
    utimesSync(f, t, t);
  });
};
const seedTranscript = (home: string, rows: readonly object[]): void => {
  const f = transcriptPath(cfgDir(home), WORKDIR, UUID);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, jsonl(rows));
};

/** A complete fleet row (stall-sweep.test.ts's `fleetRow`), alive, running and idle. */
const fleetRow = (over: Partial<FleetSession> = {}): FleetSession => ({
  hibernatedAt: null,
  id: ID, wrapper: 'claude', home: '/home/rc', project: 'demo', workdir: WORKDIR,
  workspace: `${ID}-ws`, name: null, status: 'idle', statusUpdatedAt: T_NOTICE, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, background: null, lastEnd: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: 'running', stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, role: 'coordinator', releasedFrom: null, withCoordinator: null,
  ...over,
});
const regRow = (): SessionRecord => ({
  hibernatedAt: null,
  id: ID, wrapper: 'claude', project: 'demo', workdir: WORKDIR, uuid: UUID,
  started: true, home: null, pool: null, lastswap: null,
  workspace: `${ID}-ws`, branch: null, branchEvidence: 'absent', base: null,
  prPhase: null, prNumber: null, prCheckedAt: null, archivedAt: null, archivedBytes: null, held: null,
  substrate: null, stopped: null, supervisedAt: null, swapBlocked: null, stranded: null, spawn: null, lastEnd: null, lifecycleUnmeasured: [],
  unmeasured: [], route: null, child: { kind: 'none' },
});
const TICK: StallTick = { panePids: new Map([[ID, PID]]), records: [regRow()] };

interface Rig { h: Harness; coord: CoordStore; w: FleetWatcher; deps: Deps; log: NotifyLog }

/** Primed on an EMPTY registry (so priming captures no pane), then every fact of the happy path is seeded. */
const rig = async (o: { fixed?: string; notifyLog?: boolean; coord?: CoordStore; home?: Harness } = {}): Promise<Rig> => {
  const h = o.home ?? harness(o.fixed);
  const coord = o.coord ?? new CoordStore(openCoordDb(path.join(h.home, '.ccrc', 'coord.db')));
  const log = new NotifyLog(path.join(h.home, '.ccrc', 'notify.json'));
  await log.load();
  // `presence` is the visibility half alone (archived-expiry-lane.test.ts's idiom): the lane reads nothing else of it.
  const deps = {
    ...testDeps(h.home, h.run), coord, ...(o.notifyLog === false ? {} : { notifyLog: log }),
    presence: { isVisible: () => false },
  } as unknown as Deps;
  const w = new FleetWatcher(deps, new Bus(), 2000, path.join(h.home, 'state-cache.json'));
  at(PRIME_AT);
  await w.tick();
  seedRegistry(h.home);
  seedLive(h.home);
  seedMark(h.home);
  seedTasks(h.home, 10 * 60_000);
  seedTranscript(h.home, IDLE_TAIL);
  at(NOW);
  return { h, coord, w, deps, log };
};

const nudgeRows = (coord: CoordStore): { sessionId: string; title: string; body: string }[] =>
  coord.db.prepare("SELECT sessionId, title, body FROM feed_events WHERE kind = 'nudge' ORDER BY id")
    .all() as unknown as { sessionId: string; title: string; body: string }[];

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  vi.useRealTimers();
});
const warned = (text: string): number => warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes(text)).length;

describe('sweepIdleCompactNudge: the happy path types once, journaled (D-5373)', () => {
  it('an idle compaction with a fresh open task list: one prompt typed, one nudge feed row, one log line', async () => {
    const { h, coord, w } = await rig();
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT]);
    expect(nudgeRows(coord)).toEqual([{ sessionId: ID, title: '↻ Nudging after idle compaction', body: idleNudgeFeedBody('b1') }]);
    expect(warned(`idle-compact-nudge ${ID} compaction b1: typed`)).toBe(1);
  });
  it('the notice row is not required: trigger auto after a finished turn qualifies', async () => {
    const { h, w } = await rig();
    seedTranscript(h.home, IDLE_TAIL.filter((r) => r !== ROW.notice));
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT]);
  });
});

describe('sweepIdleCompactNudge: at most once per compaction (D-5373)', () => {
  it('a second sweep over the same compaction types nothing', async () => {
    const { h, w } = await rig();
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    at(NOW + IDLE_NUDGE_SWEEP_MS);
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT]);
  });
  it('ACROSS A RESTART: a new watcher over the same coord.db reads the nudge feed row and types nothing', async () => {
    const first = await rig();
    await first.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(first.h.calls)).toHaveLength(1);
    const second = await rig({ home: first.h, coord: first.coord });
    await second.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(first.h.calls)).toHaveLength(1);
    expect(nudgeRows(first.coord)).toHaveLength(1);
  });
  it('a send that was refused (a draft in the box) is never retried, and the feed says nothing was typed', async () => {
    const { h, coord, w } = await rig({ fixed: '❯ half-typed draft\n' });
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    at(NOW + IDLE_NUDGE_SWEEP_MS);
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    // No key press at all: not the text, and not a C-u over the operator's draft.
    expect(anySends(h.calls)).toEqual([]);
    expect(warned('refused (draft-present), not retried')).toBe(1);
    expect(nudgeRows(coord)).toEqual([
      { sessionId: ID, title: '↻ Nudging after idle compaction', body: idleNudgeFeedBody('b1') },
      { sessionId: ID, title: '↻ Nudge not typed', body: idleNudgeRefusedBody('b1', 'draft-present') },
    ]);
  });
  it('the durable row pruned (FEED_RETENTION): this process\'s own set still stops a second send', async () => {
    const { h, coord, w } = await rig();
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    coord.db.prepare("DELETE FROM feed_events WHERE kind = 'nudge'").run();
    at(NOW + IDLE_NUDGE_SWEEP_MS);
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT]);
  });
  it('a NEW idle compaction later is its own key and is nudged once more', async () => {
    const { h, w } = await rig();
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    const later = 4 * 3_600_000;
    const shift = (r: object, uuid: string): object => ({ ...r, uuid, timestamp: new Date(Date.parse((r as { timestamp: string }).timestamp) + later).toISOString() });
    seedTranscript(h.home, [...IDLE_TAIL, ROW.nudge, shift(ROW.endTurn, 'a9'), shift(ROW.stopHook, 'h9'),
      shift(ROW.boundary, 'b2'), shift(ROW.summary, 's2'), shift(ROW.notice, 'n2')]);
    seedLive(h.home, { statusUpdatedAt: T_NOTICE + later });
    seedTasks(h.home, -later + 10 * 60_000);
    at(NOW + later);
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT, IDLE_COMPACT_NUDGE_PROMPT]);
  });
});

describe('sweepIdleCompactNudge: the holds, read from the real files (D-5373)', () => {
  const holds: [string, (r: Rig) => void, FleetSession?][] = [
    ['the kill switch exists', () => {}],
    ['the task list is days old (the reported shape)', (r) => seedTasks(r.h.home, 3 * 24 * 3_600_000)],
    ['the task list has no open item', (r) => {
      const dir = path.join(cfgDir(r.h.home), 'tasks', UUID);
      writeFileSync(path.join(dir, '2.json'), JSON.stringify({ id: '2', subject: 'Step 2', status: 'completed' }));
      writeFileSync(path.join(dir, '3.json'), JSON.stringify({ id: '3', subject: 'Step 3', status: 'completed' }));
    }],
    ['the turn marker counts background work', (r) => seedMark(r.h.home, { bg: 1, bgKinds: 'monitor', bgIds: 'm1' })],
    ['the turn marker is working', (r) => seedMark(r.h.home, { state: 'working', event: 'UserPromptSubmit' })],
    ['the turn marker does not read', (r) => { writeFileSync(path.join(r.h.home, '.cc-sessions', `${ID}.turn.json`), 'not json'); }],
    ['the live status is busy', (r) => seedLive(r.h.home, { status: 'busy' })],
    ['the idle status is younger than the settle', (r) => seedLive(r.h.home, { statusUpdatedAt: NOW - 5_000 })],
    ['the operator typed after the compaction', (r) => seedTranscript(r.h.home, [...IDLE_TAIL, ROW.operator])],
    ['a turn ran after the compaction', (r) => seedTranscript(r.h.home, [...IDLE_TAIL, ROW.resumed])],
    ['the compaction was mid-turn', (r) => seedTranscript(r.h.home, [ROW.prompt, ROW.toolUse, ROW.toolResult, ROW.boundary, ROW.summary])],
    ['a pane dialog is pending', () => {}, fleetRow({ dialogPending: true })],
    ['an AskUserQuestion is open', () => {}, fleetRow({ askSummary: 'Which option?' })],
    ['the session is stopped', () => {}, fleetRow({ lifecycle: 'stopped' })],
    ['the workspace is archived', () => {}, fleetRow({ archivedAt: 1_700_000_000 })],
  ];
  it.each(holds)('HOLD: %s — nothing typed, nothing recorded', async (name, arrange, row) => {
    const r = await rig();
    arrange(r);
    const names = name === 'the kill switch exists' ? [IDLE_NUDGE_DISABLED_MARKER] : [];
    await r.w.sweepIdleCompactNudge([row ?? fleetRow()], names, TICK);
    expect(literalSends(r.h.calls)).toEqual([]);
    expect(nudgeRows(r.coord)).toEqual([]);
  });
  it('HOLD: no notify log, so no durable record can land — nothing typed, held before any record is tried', async () => {
    const r = await rig({ notifyLog: false });
    await r.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(anySends(r.h.calls)).toEqual([]);
    // Held as a row fact (`durable`), not caught later by the record-must-land check.
    expect(warned('did not land')).toBe(0);
  });
  it('HOLD: the notify log is present but the coord.db row throws (full disk, write lock) — nothing typed', async () => {
    const r = await rig();
    vi.spyOn(r.coord, 'recordFeedEvent').mockImplementation(() => { throw new Error('database is locked'); });
    await r.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(anySends(r.h.calls)).toEqual([]);
    expect(warned('the feed record did not land — nothing typed')).toBe(1);
  });
  it('CONTROL: the same rig with nothing arranged does type (the holds above are not vacuous)', async () => {
    const r = await rig();
    await r.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(r.h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT]);
  });
});

describe('sweepIdleCompactNudge: the send-time pane guards (D-5373)', () => {
  // Every fact read idle, but the pane itself says otherwise between the decision and the keystrokes. `sendPrompt`
  // refuses before any key press; the lane logs the reason and records the refusal row. Pane rows are the measured
  // shapes `send.test.ts` pins.
  const panes: [string, string, string][] = [
    ['a turn running on the pane', '✳ Cerebrating… (12s · esc to interrupt)\n❯ \n', 'turn-running'],
    ['an armed auto-continue', 'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel\n❯ \n', 'auto-continue-armed'],
  ];
  it.each(panes)('REFUSED: %s — no key press, the reason logged and in the feed', async (_name, pane, reason) => {
    const { h, coord, w } = await rig({ fixed: pane });
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(anySends(h.calls)).toEqual([]);
    expect(warned(`compaction b1: refused (${reason}), not retried`)).toBe(1);
    expect(nudgeRows(coord).map((r) => r.body)).toEqual([idleNudgeFeedBody('b1'), idleNudgeRefusedBody('b1', reason)]);
  });
});

describe('tick() runs the lane on its own clock, through the production fleet row (D-5373)', () => {
  it('a full tick over the seeded session types the nudge once', async () => {
    const r = await rig();
    // A fresh supervisor heartbeat (epoch SECONDS), so `assembleFleet` classifies the row `running`.
    writeFileSync(path.join(r.h.home, '.cc-sessions', `${ID}.supervised`), String(Math.floor(NOW / 1000)));
    await r.w.tick();
    await vi.waitFor(() => { expect(literalSends(r.h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT]); }, { timeout: 15_000 });
    expect(nudgeRows(r.coord)).toHaveLength(1);
  });
});

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
import { redactCommand } from '../src/coord/redact.js';
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
  id: ID, wrapper: 'claude', home: '/home/u', project: 'demo', workdir: WORKDIR,
  workspace: `${ID}-ws`, name: null, title: null, status: 'idle', statusUpdatedAt: T_NOTICE, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, background: null, lastEnd: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: 'running', stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, role: 'coordinator', releasedFrom: null, withCoordinator: null,
  ...over,
});
const regRow = (): SessionRecord => ({
  hibernatedAt: null,
  namedByOperator: false, title: null,
  id: ID, wrapper: 'claude', project: 'demo', workdir: WORKDIR, uuid: UUID,
  started: true, home: null, pool: null, lastswap: null,
  workspace: `${ID}-ws`, branch: null, branchEvidence: 'absent', base: null,
  prPhase: null, prNumber: null, prCheckedAt: null, archivedAt: null, archivedBytes: null, held: null,
  substrate: null, stopped: null, supervisedAt: null, swapBlocked: null, stranded: null, spawn: null, lastEnd: null, lifecycleUnmeasured: [],
  unmeasured: [], route: null, child: { kind: 'none' },
});
const TICK: StallTick = { panePids: new Map([[ID, PID]]), records: [regRow()], refused: new Set() };

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
  it('a send that was refused (a draft the stash did not take) is never retried, and the feed says nothing was typed', async () => {
    // D-5912: the nudge passes `onDraft: 'stash'`. This fixed pane never empties after `C-s` (a rebound key), so the
    // send refuses `stash-failed` (the stashed path, typed and restored, is `lane-draft-never-blocks.test.ts`).
    const { h, coord, w } = await rig({ fixed: '❯ half-typed draft\n' });
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    at(NOW + IDLE_NUDGE_SWEEP_MS);
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    // The one key is the stash's `C-s`: not the text, and not a C-u over the operator's draft.
    expect(anySends(h.calls).map((a) => a[3])).toEqual(['C-s']);
    expect(warned('refused (stash-failed), not retried')).toBe(1);
    expect(nudgeRows(coord)).toEqual([
      { sessionId: ID, title: '↻ Nudging after idle compaction', body: idleNudgeFeedBody('b1') },
      { sessionId: ID, title: '↻ Nudge not typed', body: idleNudgeRefusedBody('b1', 'stash-failed') },
    ]);
  });
  it('D-5912: the idle compact nudge with a draft: typed, draft restored', async () => {
    // A pane with Claude Code's measured stash (`send-stash.test.ts`'s five facts): `C-s` stashes a non-empty box and
    // shows ` › stashed ·` above the rule; a submit restores it.
    const home = mkTmp('ccrc-idle-nudge-stash-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const calls: string[][] = [];
    const st = { box: 'half-typed draft', stash: null as string | null, sent: [] as string[] };
    const rule = '─'.repeat(80);
    const run: Runner = async (_cmd, args) => {
      calls.push([...args]);
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
      if (args[0] === 'capture-pane') {
        return { code: 0, stdout: ['⏺ done', '', st.stash !== null ? ' › stashed ·' : '', rule, `❯ ${st.box}`, rule, ''].join('\n'), stderr: '' };
      }
      if (args[0] === 'send-keys') {
        if (args[3] === '-l') st.box += args[5]!;
        else if (args[3] === 'C-s' && st.box !== '') { st.stash = st.box; st.box = ''; }
        else if (args[3] === 'Enter' && st.box !== '') {
          st.sent.push(st.box); st.box = st.stash ?? ''; st.stash = null;
        }
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 1, stdout: '', stderr: '' };
    };
    const { w } = await rig({ home: { home, calls, run } });
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(anySends(calls).map((a) => (a[3] === '-l' ? `lit:${a[5]}` : a[3]))).toEqual(['C-s', `lit:${IDLE_COMPACT_NUDGE_PROMPT}`, 'Enter']);
    expect(st.sent).toEqual([IDLE_COMPACT_NUDGE_PROMPT]);
    expect(st.box).toBe('half-typed draft');
    expect(st.stash).toBeNull();
    expect(warned('typed')).toBe(1);
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

// The feed writer redacts every body before it is archived (spec §6.7, D-5298), and Claude Code's compaction uuid is
// 36 characters of letters, digits and hyphens: a token-shaped run the redactor masks. The "already nudged" read must
// compare in the form the writer stored, or the record never reads as landed and the nudge is never typed.
describe('sweepIdleCompactNudge: a real-shaped compaction uuid survives the feed\'s redaction (D-5298)', () => {
  const UUID = '3f1c2a7e-9b4d-4e21-8c6a-1d2e3f4a5b6c';
  const tail = (): object[] => IDLE_TAIL.map((r) => (r === ROW.boundary ? { ...ROW.boundary, uuid: UUID } : r));
  it('types once, and a second sweep and a restarted watcher type nothing more', async () => {
    const first = await rig();
    seedTranscript(first.h.home, tail());
    await first.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(first.h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT]);
    expect(warned(`compaction ${UUID}: typed`)).toBe(1);
    at(NOW + IDLE_NUDGE_SWEEP_MS);
    await first.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    const second = await rig({ home: first.h, coord: first.coord });
    seedTranscript(first.h.home, tail());
    await second.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(first.h.calls)).toHaveLength(1);
    expect(nudgeRows(first.coord)).toHaveLength(1);
  });
});

// D-5860 (Task C1f): `alreadyNudged` reads the compaction's KEY (`hasNotice`), no longer the archived body. Step 1
// pinned these rows on the body read; Step 3 changed only the rows OA-C3 ruled (operator, 2026-10-21: "A: the label
// decides"), each marked RULED with what it did before. Rows (a), (b) and (e) of the plan's table are the "happy path"
// and "at most once per compaction" blocks above (first nudge, the same compaction again, ACROSS A RESTART); the
// landing gate's row (the record throws, nothing typed) is "HOLD: the notify log is present but the coord.db row
// throws" above and C0c's feed-writers-pin row. Nudge rows are `recordOnly`: they are never pushed, before or after.
describe('C1f: the nudge\'s "already nudged" read is the compaction\'s key (D-5860, OA-C3 ruled A)', () => {
  const REWORDED = 'Nudging with a "continue" prompt (an earlier wording) (compaction b1)';
  it('(c) the row\'s body changed (a reworded deploy), same process: held by this process\'s own set', async () => {
    const { h, coord, w } = await rig();
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    coord.db.prepare("UPDATE feed_events SET body = ? WHERE kind = 'nudge'").run(REWORDED);
    at(NOW + IDLE_NUDGE_SWEEP_MS);
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT]);
    expect(nudgeRows(coord)).toHaveLength(1);
  });
  // RULED (OA-C3, A). Before: typed AGAIN, a second row (the body read missed the reworded row).
  it('(c) the row\'s body changed, then a restart: the key matches, so the same compaction is NOT typed again', async () => {
    const first = await rig();
    await first.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    first.coord.db.prepare("UPDATE feed_events SET body = ? WHERE kind = 'nudge'").run(REWORDED);
    const second = await rig({ home: first.h, coord: first.coord });
    await second.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(first.h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT]);
    expect(nudgeRows(first.coord).map((r) => r.body)).toEqual([REWORDED]);
    expect(warned(`idle-compact-nudge ${ID} compaction b1: typed`)).toBe(1);
  });
  // Departure `dedupe-key-legacy-text`: a row archived BEFORE the key (NULL) is still matched by its body, so the
  // deploy itself types nothing a second time.
  it('a row archived before the key existed is matched by its body: a restart onto the new build types nothing', async () => {
    const first = await rig();
    await first.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    first.coord.db.prepare("UPDATE feed_events SET dedupe_key = NULL WHERE kind = 'nudge'").run();
    const second = await rig({ home: first.h, coord: first.coord });
    await second.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(first.h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT]);
    expect(nudgeRows(first.coord)).toHaveLength(1);
  });
  it('(d) a ring restart (a new epoch), same process: held by this process\'s own set', async () => {
    const { h, coord, w, deps, log } = await rig();
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    const fresh = new NotifyLog(path.join(mkTmp('ccrc-idle-nudge-ring-'), 'notify.json'));
    await fresh.load();
    expect(fresh.epoch).not.toBe(log.epoch);
    (deps as unknown as { notifyLog: NotifyLog }).notifyLog = fresh;
    at(NOW + IDLE_NUDGE_SWEEP_MS);
    await w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT]);
    expect(nudgeRows(coord)).toHaveLength(1);
  });
  it('(d)+(e) a new epoch AND a restarted watcher: the archived row is matched whatever epoch wrote it', async () => {
    const first = await rig();
    await first.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    // A new home: a new notify log (a fresh epoch) and a new watcher, over the SAME coord.db.
    const second = await rig({ coord: first.coord });
    expect(second.log.epoch).not.toBe(first.log.epoch);
    await second.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    expect(literalSends(second.h.calls)).toEqual([]);
    expect(nudgeRows(first.coord)).toHaveLength(1);
  });

  // A SECOND compaction in the same session, later. The fixture keys (`b1`, `b2`) survive the redactor, so the block
  // above nudges it; Claude Code's real compaction uuids are 36-character token-shaped runs that `recordFeedEvent`
  // masks (D-5298), so every nudge row of a session archives with ONE body and the read matches the earlier one.
  const U1 = '3f1c2a7e-9b4d-4e21-8c6a-1d2e3f4a5b6c';
  const U2 = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
  const later = 4 * 3_600_000;
  const shift = (r: object, uuid: string): object =>
    ({ ...r, uuid, timestamp: new Date(Date.parse((r as { timestamp: string }).timestamp) + later).toISOString() });
  const twoCompactions = async (k1: string, k2: string, between: (r: Rig) => void = () => {}): Promise<Rig> => {
    const r = await rig();
    const first = IDLE_TAIL.map((x) => (x === ROW.boundary ? { ...ROW.boundary, uuid: k1 } : x));
    seedTranscript(r.h.home, first);
    await r.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    between(r);
    seedTranscript(r.h.home, [...first, ROW.nudge, shift(ROW.endTurn, 'a9'), shift(ROW.stopHook, 'h9'),
      shift(ROW.boundary, k2), shift(ROW.summary, 's2'), shift(ROW.notice, 'n2')]);
    seedLive(r.h.home, { statusUpdatedAt: T_NOTICE + later });
    seedTasks(r.h.home, -later + 10 * 60_000);
    at(NOW + later);
    await r.w.sweepIdleCompactNudge([fleetRow()], [], TICK);
    return r;
  };
  it('CONTROL: a second compaction whose key survives the redactor is nudged once more', async () => {
    const r = await twoCompactions('b1', 'b2');
    expect(literalSends(r.h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT, IDLE_COMPACT_NUDGE_PROMPT]);
  });
  // RULED (OA-C3; fixed under A and B alike). Before: the second compaction read as already nudged, nothing typed.
  it('a second compaction with a REAL-SHAPED uuid is nudged once more, though the redacted bodies collide', async () => {
    expect(redactCommand(idleNudgeFeedBody(U1))).toBe(redactCommand(idleNudgeFeedBody(U2)));
    const r = await twoCompactions(U1, U2);
    expect(literalSends(r.h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT, IDLE_COMPACT_NUDGE_PROMPT]);
    expect(nudgeRows(r.coord)).toHaveLength(2);
    expect(warned(`idle-compact-nudge ${ID} compaction ${U2}: typed`)).toBe(1);
  });
  // Departure `landing-gate-by-key`: once a later compaction can be nudged, a body re-read after its record would match
  // the EARLIER compaction's masked row and type over a row that did not land. The gate re-reads the key.
  it('the landing gate: a second compaction whose own row did not land types nothing, though the earlier row\'s body matches', async () => {
    const r = await twoCompactions(U1, U2, (x) => {
      vi.spyOn(x.coord, 'recordFeedEvent').mockImplementation(() => { throw new Error('database is locked'); });
    });
    expect(literalSends(r.h.calls)).toEqual([IDLE_COMPACT_NUDGE_PROMPT]);
    expect(nudgeRows(r.coord).map((x) => x.body), 'the premise: a body read would say landed')
      .toEqual([redactCommand(idleNudgeFeedBody(U2))]);
    expect(warned(`compaction ${U2}: the feed record did not land — nothing typed`)).toBe(1);
  });
});

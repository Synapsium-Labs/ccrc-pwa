// The dead-coordinator lane's ONE executor (workspace lifecycle spec 2026-09-24 §5.4, "No successor" and "The act"),
// run as the lane runs it: inside the coordination serialiser, handed the sweep's abandon. A scripted tmux and a
// fixture registry answer; `closeRun` is the real one (so the compare-and-set is the real one) over a fixture store;
// nothing reaches a box.
import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { closeRun, type CloseOutcome } from '../src/coord/close.js';
import { endDeadCoordinator, readDeadCoordinatorJournalTrust, recordDeadCoordinatorFeed, type EndDeadCoordinatorDeps } from '../src/coord/endDeadCoordinator.js';
import {
  DEAD_COORDINATOR_JOURNAL_TRUSTED, DEAD_COORDINATOR_LANE_LIVE_MARKER, type DeadCoordinatorJournalTrust,
} from '../src/deadCoordinator.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { NotifyLog } from '../src/notifylog.js';
import type { SessionVerdict } from '../src/exec.js';
import type { Runner } from '../src/exec.js';
import { LC_DIR_NAME, LC_ERRORS_NAME, type LifecycleHealth } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const CRASHED = 'demo-coord-crashed';
const HEIR = 'demo-coord-heir';
const NOW = 1_790_000_000_000;
const SEC = NOW / 1000;

interface Opts {
  live?: boolean; paused?: boolean; unlistable?: boolean;
  /** tmux's answer for the claimant, asked once per re-measure (default `gone`). */
  verdict?: (asked: number) => SessionVerdict;
  /** Called as tmux is asked — the moment inside the arm's re-measure, before the fleet act. */
  onMeasure?: (asked: number) => void;
  /** Called as a ccd verb is composed — the fleet act itself. */
  onVerb?: (verb: string) => void;
  /** The lane's reading of the journal itself (default: trusted). */
  trust?: DeadCoordinatorJournalTrust;
  /** The executor's clock at each re-measure (default: the pass's own instant, `NOW`). */
  clockAt?: number;
}

const rig = async (o: Opts = {}) => {
  const home = mkTmp('ccrc-end-dead-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  // The crashed coordinator: a row that started, whose supervisor heartbeat is long gone — `orphan`.
  for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'demo', workdir: `/w/${CRASHED}`, uuid: `u-${CRASHED}`,
    started: '1', supervised: String(SEC - 7200) })) writeFileSync(path.join(reg, `${CRASHED}.${k}`), v);
  if (o.live !== false) writeFileSync(path.join(reg, DEAD_COORDINATOR_LANE_LIVE_MARKER), '');
  if (o.paused === true) writeFileSync(path.join(reg, 'reclaim-paused'), '');
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => { calls.push(args); o.onVerb?.(args[0] ?? ''); return { code: 0, stdout: '', stderr: '' }; };
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  let asked = 0;
  const abandoned: number[] = [];
  const deps: EndDeadCoordinatorDeps = {
    coord, cfg: base.cfg, notifyLog,
    io: o.unlistable === true ? { ...base.io, readdir: async () => null } : base.io,
    tmux: { sessionVerdict: async () => { asked += 1; o.onMeasure?.(asked); return o.verdict?.(asked) ?? { verdict: 'gone' }; } },
    journalTrust: async () => o.trust ?? DEAD_COORDINATOR_JOURNAL_TRUSTED,
    now: () => o.clockAt ?? NOW,
    // The sweep's abandon exactly as the serialiser's handle runs it (`routes.ts`'s `withSweepAbandon`): the REAL
    // `closeRun`, `'sweep'`, the crashed id and the executor's re-measure.
    abandon: (runId, crashedId, stillCrashed): Promise<CloseOutcome> => {
      abandoned.push(runId);
      return closeRun({ coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd }, runId, { intent: 'abandon' }, 'sweep',
        { claimedBy: crashedId, stillCrashed });
    },
  };
  /** A working run of `program`, claimed by the crashed coordinator, dispatched into `worker`. */
  const working = (program: string, worker: string): number => {
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: 2, claimedBy: CRASHED });
    if (!('id' in r)) throw new Error('openRun refused');
    coord.markDispatched(r.id, worker, worker, `ws/${worker}`, false);
    for (const to of ['dispatched', 'working'] as const) expect(coord.advance(r.id, to, 'coordinator').ok).toBe(true);
    return r.id;
  };
  const stateOf = (id: number) => okRun(coord.run(id))!.state;
  return { home, reg, coord, deps, calls, abandoned, working, stateOf };
};

describe('the one executor — shadow, the switch, and the store', () => {
  it('SHADOW (no live file): "would end programme <slug> (<n> runs)" — the abandon arm is never reached', async () => {
    const r = await rig({ live: false });
    const a = r.working('alpha', 'demo-w1');
    const b = r.working('alpha', 'demo-w2');
    const c = r.working('beta', 'demo-w3');
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toEqual({ kind: 'would-end',
      programmes: [{ slug: 'alpha', runIds: [a, b] }, { slug: 'beta', runIds: [c] }] });
    expect(r.abandoned).toEqual([]);
    expect(r.calls, 'nothing composed').toEqual([]);
    expect([a, b, c].map(r.stateOf)).toEqual(['working', 'working', 'working']);
  });

  it('`reclaim-paused` — the one cleanup switch — stops it, live or shadow; so does a registry that would not list', async () => {
    for (const live of [true, false]) {
      const r = await rig({ paused: true, live });
      r.working('alpha', 'demo-w1');
      expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toMatchObject({ kind: 'paused-at-server' });
      expect(r.abandoned).toEqual([]);
    }
    const u = await rig({ unlistable: true });
    u.working('alpha', 'demo-w1');
    expect(await endDeadCoordinator(u.deps, CRASHED, NOW)).toMatchObject({ kind: 'paused-at-server' });
    expect(u.abandoned).toEqual([]);
  });

  it('a store that cannot say which runs the claimant holds ends nothing', async () => {
    const r = await rig();
    r.working('alpha', 'demo-w1');
    r.deps.coord.openRunsClaimedBy = () => { throw new Error('database is not open'); };
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toMatchObject({ kind: 'store-unreadable' });
    expect(r.abandoned).toEqual([]);
  });
});

describe('LIVE — each run re-measured inside the arm, then the abandon with the compare-and-set', () => {
  it('ends every run of every programme the claimant holds, failed, by the sweep', async () => {
    const r = await rig();
    const a = r.working('alpha', 'demo-w1');
    const c = r.working('beta', 'demo-w3');
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toEqual({ kind: 'ended',
      programmes: [{ slug: 'alpha', runIds: [a] }, { slug: 'beta', runIds: [c] }], open: [], stuck: [], stoppedBy: null });
    expect([a, c].map(r.stateOf)).toEqual(['failed', 'failed']);
    expect(r.coord.runEvents(a).at(-1)?.causedBy).toBe('sweep');
  });

  it('the claimant is re-measured before EACH close: a revive after the first ends the WHOLE act', async () => {
    // Run a: asked before its fleet act and after it (gone, gone); run b: asked before its fleet act — live.
    const r = await rig({ verdict: (n) => (n >= 3 ? { verdict: 'live' } : { verdict: 'gone' }) });
    const a = r.working('alpha', 'demo-w1');
    const b = r.working('alpha', 'demo-w2');
    const out = await endDeadCoordinator(r.deps, CRASHED, NOW);
    expect(out).toMatchObject({ kind: 'ended', programmes: [{ slug: 'alpha', runIds: [a] }], open: [{ slug: 'alpha', runIds: [b] }],
      stuck: [], stoppedBy: { kind: 'remeasured', why: expect.stringContaining('tmux reports the pane live') } });
    expect([a, b].map(r.stateOf)).toEqual(['failed', 'working']);
  });

  it('THE FORCED INTERLEAVING (ruling G): a revive of the SAME id after the lane measured it is seen before the fleet act — nothing is composed', async () => {
    // The race the spec names: `ccd ensure` on the crashed id takes no mutex and leaves `claimedBy` as it was, so the
    // compare-and-set cannot see it; the re-measure the arm runs immediately before the fleet act does.
    const r = await rig({ verdict: () => ({ verdict: 'live' }) });
    const a = r.working('alpha', 'demo-w1');
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toMatchObject({ kind: 'ended', programmes: [],
      open: [{ slug: 'alpha', runIds: [a] }], stoppedBy: { kind: 'remeasured' } });
    expect(r.stateOf(a)).toBe('working');
    expect(r.calls, 'no release was composed for its worker').toEqual([]);
  });

  it('a revive DURING the fleet act is seen after it, before the commit: the run stays open, and the stop says its worker was released', async () => {
    let releasedAt = 0;
    const r = await rig({ onVerb: (v) => { if (v === 'ws-release') releasedAt = 1; },
      verdict: () => (releasedAt === 1 ? { verdict: 'live' } : { verdict: 'gone' }) });
    const a = r.working('alpha', 'demo-w1');
    const out = await endDeadCoordinator(r.deps, CRASHED, NOW);
    expect(out).toMatchObject({ kind: 'ended', programmes: [], open: [{ slug: 'alpha', runIds: [a] }],
      stoppedBy: { kind: 'remeasured', why: expect.stringContaining(`after run ${a}'s worker was released`) } });
    expect(r.stateOf(a), 'never failed under a coordinator that came back').toBe('working');
  });

  it('a deliberate act journaled since the pass — the operator stopped it — ends the act too', async () => {
    const r = await rig({ onMeasure: (n) => {
      if (n === 1) r.coord.ingestJournal({ gen: '1790000000000000000', cursor: 100, size: 100, at: 1, rows: [parseJournalLine(JSON.stringify(
        { v: 1, uid: 'w4ex.1.1', at: NOW, act: 'stop', outcome: 'done', id: CRASHED, dec: { surface: 'pwa' } }))] });
    } });
    const a = r.working('alpha', 'demo-w1');
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toMatchObject({ kind: 'ended', programmes: [],
      stoppedBy: { kind: 'remeasured', why: expect.stringContaining('stop') } });
    expect(r.stateOf(a)).toBe('working');
  });

  it('a journal the re-measure cannot read, or cannot trust, is not a crash: it ends the act — never "no history"', async () => {
    const thrown = await rig();
    const a = thrown.working('alpha', 'demo-w1');
    thrown.deps.coord.deadCoordinatorJournalRows = () => { throw new Error('database disk image is malformed'); };
    expect(await endDeadCoordinator(thrown.deps, CRASHED, NOW)).toMatchObject({ kind: 'ended', programmes: [],
      stoppedBy: { kind: 'remeasured', why: expect.stringContaining('database disk image is malformed') } });
    expect(thrown.stateOf(a)).toBe('working');
    const untrusted = await rig({ trust: { untrusted: 'the lifecycle mirror is unavailable', gapGens: [], lastWriteErrorAt: null } });
    const b = untrusted.working('alpha', 'demo-w1');
    expect(await endDeadCoordinator(untrusted.deps, CRASHED, NOW)).toMatchObject({ kind: 'ended', programmes: [],
      stoppedBy: { kind: 'remeasured', why: expect.stringContaining('the lifecycle mirror is unavailable') } });
    expect(untrusted.stateOf(b)).toBe('working');
    expect([...thrown.calls, ...untrusted.calls]).toEqual([]);
  });

  it('the switches are read again before EACH run: a pause raised, or the lane disarmed, after the first close stops the rest', async () => {
    for (const how of ['paused', 'disarmed'] as const) {
      let first = true;
      const r: Awaited<ReturnType<typeof rig>> = await rig({ onVerb: (v) => {
        if (v !== 'ws-release' || !first) return;
        first = false;
        if (how === 'paused') writeFileSync(path.join(r.reg, 'reclaim-paused'), '');
        else rmSync(path.join(r.reg, DEAD_COORDINATOR_LANE_LIVE_MARKER));
      } });
      const a = r.working('alpha', 'demo-w1');
      const b = r.working('alpha', 'demo-w2');
      const out = await endDeadCoordinator(r.deps, CRASHED, NOW);
      expect(out, how).toMatchObject({ kind: 'ended', programmes: [], stoppedBy: { kind: 'switch' } });
      expect([a, b].map(r.stateOf), how).toEqual(['working', 'working']);
    }
  });

  it('a successor that took the programme is never failed — the compare-and-set, defence against a claimedBy writer outside this serialiser (none exists in this build)', async () => {
    // `reclaimProgram` stands for that writer; in this build its only caller, the reclaim door, waits on the same
    // serialiser, so this race is closed by the mutex and the compare-and-set is the second wall.
    let a = 0;
    const r = await rig({ onMeasure: () => { expect(r.coord.reclaimProgram(a, HEIR, NOW, null)).toMatchObject({ ok: true }); } });
    a = r.working('alpha', 'demo-w1');
    const out = await endDeadCoordinator(r.deps, CRASHED, NOW);
    expect(out).toMatchObject({ kind: 'ended', programmes: [], stuck: [], stoppedBy: { kind: 'successor', why: expect.stringContaining(HEIR) } });
    expect(r.stateOf(a), 'the successor’s run is untouched').toBe('working');
    expect(r.calls, 'and no release was composed for its worker').toEqual([]);
  });

  it('a RESTARTING coordinator is alive: a heartbeat written AFTER the pass instant (the clock has moved on) stops the act — nothing closed, no worker released', async () => {
    // `ccd supervise` stamps `.supervised` BEFORE it spawns the pane, so the heartbeat lands after the instant the lane's
    // pass captured. The re-measure reads the clock as it measures: against the pass's instant that heartbeat would be
    // "from the future", not fresh, and the restarting coordinator would read `orphan`.
    for (const [where, beat] of [['5 s AFTER the pass instant', SEC + 5], ['5 s BEFORE it (the control)', SEC - 5]] as const) {
      const r = await rig({ clockAt: NOW + 10_000 });
      writeFileSync(path.join(r.reg, `${CRASHED}.supervised`), String(beat));   // the supervisor stamped it; the pane is not up
      const a = r.working('alpha', 'demo-w1');
      expect(await endDeadCoordinator(r.deps, CRASHED, NOW), where).toMatchObject({ kind: 'ended', programmes: [], open: [{ slug: 'alpha', runIds: [a] }],
        stoppedBy: { kind: 'remeasured', why: expect.stringContaining('restarting') } });
      expect(r.stateOf(a), where).toBe('working');
      expect(r.calls, `${where}: no release composed`).toEqual([]);
    }
  });

  it('a run the abandon arm cannot move is listed, and the next one is still tried', async () => {
    const r = await rig();
    const a = r.working('alpha', 'demo-w1');
    expect(r.coord.advance(a, 'closing', 'coordinator').ok, 'a run already closing has no abandon edge').toBe(true);
    const b = r.working('alpha', 'demo-w2');
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toEqual({ kind: 'ended', programmes: [{ slug: 'alpha', runIds: [b] }],
      open: [{ slug: 'alpha', runIds: [a] }], stuck: [{ runId: a, why: 'bad-transition: closing → closing' }], stoppedBy: null });
  });
});

describe('the feed', () => {
  it('ONE row per ended programme in the spec’s words; a shadow row says nothing was ended — recorded, never pushed', async () => {
    const r = await rig();
    r.working('alpha', 'demo-w1');
    r.working('alpha', 'demo-w2');
    recordDeadCoordinatorFeed(r.deps, CRASHED, await endDeadCoordinator(r.deps, CRASHED, NOW), NOW - 3_600_000);
    const rows = r.coord.feedEvents(10).filter((e) => e.sessionId === CRASHED);
    expect(rows.map((e) => [e.title, e.body, e.runId])).toEqual([['dead coordinator: programme ended',
      `coordinator ${CRASHED} crashed (dead since 2026-09-21 13:13 UTC) and stayed dead an hour; programme alpha ended, 2 runs closed failed.`, null]]);
  });
});

describe('the journal-trust adapter — the errors file ccd writes only when it counts a failure', () => {
  const OK: LifecycleHealth = { state: 'ok', newestAt: 1, horizon: 1, rows: 1, generations: 1, gaps: 0, writeErrors: null, lastOk: 1 };
  const errorsFile = (r: Awaited<ReturnType<typeof rig>>) => path.join(r.reg, LC_DIR_NAME, LC_ERRORS_NAME);

  it('a null count with NO errors file is a PROVEN absence: trusted, no write failure', async () => {
    const r = await rig();
    expect(await readDeadCoordinatorJournalTrust(r.deps, OK)).toEqual({ hold: null,
      trust: { untrusted: null, gapGens: [], lastWriteErrorAt: null } });
  });

  it('a null count with an errors file PRESENT (the mirror could not read it) places the last failure at its mtime', async () => {
    const r = await rig();
    mkdirSync(path.dirname(errorsFile(r)), { recursive: true });
    writeFileSync(errorsFile(r), '3\n');
    const t = await readDeadCoordinatorJournalTrust(r.deps, OK);
    expect(t.trust.untrusted).toBeNull();
    expect(typeof t.trust.lastWriteErrorAt).toBe('number');
  });

  it('a COUNTED failure whose errors file has vanished is `unknown` too — absence only clears a null count', async () => {
    const r = await rig();
    expect((await readDeadCoordinatorJournalTrust(r.deps, { ...OK, writeErrors: 2 })).trust).toMatchObject({ untrusted: null, lastWriteErrorAt: 'unknown' });
  });

  it('a null count whose errors file cannot be statted — present, unreadable — is `unknown`, never "none"', async () => {
    const r = await rig();
    const io = { ...r.deps.io, statMeasured: async () => ({ ok: false as const, reason: 'unreadable' as const }) };
    expect((await readDeadCoordinatorJournalTrust({ ...r.deps, io }, OK)).trust).toMatchObject({ untrusted: null, lastWriteErrorAt: 'unknown' });
  });
});

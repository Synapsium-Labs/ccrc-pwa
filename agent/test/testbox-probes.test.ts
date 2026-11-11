// D-8290 (plan docs/superpowers/plans/2026-11-11-live-probe-budget.md). The live probe desk against FAKES: a fake runner
// that never launches Claude Code or tmux, fixture directories for the config directories, and a fixture budget file.
// The four rulings: a probe is refused on any node that is not the configured test box (the role from its install
// config's lines, never a hostname); two probes requested at once run one after the other, with the queue visible; a
// probe is pinned to the scratch account's config directory and its own tmux socket, and the guard refuses a fleet
// account's directory and any desk write into one; and the day's budget, from config, runs out and is visible.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  PROBE_REFUSAL_MAP, PROBE_REFUSAL_SENTENCE, readTestboxFrame,
  type ProbeAnswer, type ProbeRefusal, type ProbeSubmit, type RunLog, type RunSummary, type StatusAnswer,
} from '../../shared/testbox.js';
import { KNOB_FIELD_SEP, parseKnobLines, type KnobLine } from '../src/testbox/config.js';
import { ProbeDesk, type ProbeDeskDeps, type ProbeRunner } from '../src/testbox/probeDesk.js';
import { fileBudgetStore, fleetConfigDirs, realPathOf } from '../src/testbox/probeFs.js';
import {
  budgetOn, budgetRefusal, configDirRefusal, PROBE_KNOBS, probeRole, probeSettings, probeSpec, socketRefusal, utcDay, writeRefusal,
  type ProbeSpec,
} from '../src/testbox/probes.js';
import { admit, enqueue, EMPTY_QUEUE, finish } from '../src/testbox/queue.js';
import { FRAME_HANDLERS, TestboxService, type Conn, type ServiceSettings } from '../src/testbox/service.js';
import type { MirrorOps } from '../src/testbox/mirror.js';
import type { SystemManager } from '../src/testbox/systemd.js';
import { mkTmp } from './tmpHelpers.js';

const ID = (n: number): string => n.toString(16).padStart(32, '0');
const SUBMIT = (n: number, name = `probe-${n}`): ProbeSubmit => ({ t: 'probe.submit', probeId: ID(n), name, session: 'harness-a' });
const NOON = Date.parse('2026-11-11T12:00:00Z');

/** Knob lines as the box-mode printer prints them; `from` is `file` on a test box and `default` on a fleet node. */
const lines = (vals: Record<string, string>, from: 'file' | 'default'): Map<string, KnobLine> =>
  parseKnobLines(`${Object.entries(vals).map(([k, v]) => [k, v, v, from].join(KNOB_FIELD_SEP)).join('\n')}\n`);

/** A fixture box: a home with Claude Code's default directory and a roster lane, the scratch config directory, the
 *  probe root. */
function fixtureBox() {
  const base = realPathOf(mkTmp('ccrc-probe-'));
  const home = path.join(base, 'home');
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  mkdirSync(path.join(home, '.lane-a-config'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'accounts.json'), JSON.stringify({
    version: 1,
    accounts: [
      { id: 'claude', label: 'Upstream', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: false, telemetry: 'anthropic', hue: 'blue' },
      { id: 'lane-a', label: 'Lane A', configDirSuffix: '.lane-a-config', exec: { kind: 'generated' }, homeAble: true, telemetry: 'anthropic', hue: 'green' },
    ],
  }));
  const scratch = path.join(base, 'scratch', 'config');
  mkdirSync(scratch, { recursive: true });
  const root = path.join(base, 'testbox');
  return { base, home, scratch, root, probes: path.join(root, 'probes') };
}

const boxLines = (b: ReturnType<typeof fixtureBox>, over: Record<string, string> = {}): Map<string, KnobLine> => lines({
  CCRC_TESTBOX_ROOT: b.root, CCRC_TESTBOX_PROBE_CONFIG_DIR: b.scratch, CCRC_TESTBOX_PROBE_SOCKET: 'ccrc-probe',
  CCRC_TESTBOX_PROBES_PER_DAY: '3', ...over,
}, 'file');

class Sink {
  readonly frames: ProbeAnswer[] = [];
  send(f: ProbeAnswer): void {
    // Every frame the desk sends passes the frame family's one reader.
    const r = readTestboxFrame(JSON.stringify(f));
    if (!r.ok) throw new Error(`the desk sent a frame the reader refuses: ${r.reason}`);
    this.frames.push(f);
  }
  states(id: string): string[] { return this.frames.filter((f) => f.probeId === id).map((f) => f.state); }
  refusal(id: string): ProbeRefusal | null { return this.frames.find((f) => f.probeId === id && f.state === 'refused')?.refusal ?? null; }
}

/** A runner that holds each probe until the test lets it end, and records what it was handed. */
class GatedRunner implements ProbeRunner {
  readonly specs: ProbeSpec[] = [];
  private readonly gates: (() => void)[] = [];
  live = 0;
  maxLive = 0;
  async run(spec: ProbeSpec): Promise<{ exit: number }> {
    this.specs.push(spec);
    this.live++;
    this.maxLive = Math.max(this.maxLive, this.live);
    await new Promise<void>((resolve) => this.gates.push(resolve));
    this.live--;
    return { exit: 0 };
  }
  /** Let the oldest held probe end. */
  release(): void { this.gates.shift()?.(); }
  get held(): number { return this.gates.length; }
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

function desk(b: ReturnType<typeof fixtureBox>, over: Partial<ProbeDeskDeps> = {}, ls: Map<string, KnobLine> = boxLines(b)): ProbeDesk {
  return new ProbeDesk({
    role: probeRole(ls), settings: probeSettings(ls, b.probes, b.home), runner: new GatedRunner(),
    fleetDirs: () => fleetConfigDirs([b.home]), realPath: realPathOf, store: fileBudgetStore(path.join(b.probes, 'budget.json')),
    now: () => NOON, ...over,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 1. The entry point refuses on any node that is not the configured test box.
// ---------------------------------------------------------------------------------------------------------------

describe('the role, from the install config\'s lines (D-8290)', () => {
  it('a fleet node: no box file, so every box key reads from: default, and a probe is refused not-test-box', () => {
    const b = fixtureBox();
    const fleet = lines({ CCRC_TESTBOX_ROOT: '~/.ccrc/testbox', CCRC_TESTBOX_PROBE_CONFIG_DIR: '', CCRC_TESTBOX_PROBE_SOCKET: 'ccrc-probe', CCRC_TESTBOX_PROBES_PER_DAY: '10' }, 'default');
    expect(probeRole(fleet)).toBe('not-test-box');
    const runner = new GatedRunner();
    const d = desk(b, { runner }, fleet);
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    expect(sink.frames).toEqual([{ t: 'probe.state', probeId: ID(1), state: 'refused', refusal: 'not-test-box', detail: PROBE_REFUSAL_SENTENCE['not-test-box'], position: null, exit: null }]);
    expect(runner.specs).toEqual([]);
    expect(d.view()).toMatchObject({ enabled: false, refusal: 'not-test-box', used: 0 });
  });

  it('a fleet node even when its lines name a probe config directory (a default never makes a test box)', () => {
    const b = fixtureBox();
    const d = desk(b, {}, lines({ CCRC_TESTBOX_PROBE_CONFIG_DIR: b.scratch, CCRC_TESTBOX_PROBE_SOCKET: 'ccrc-probe', CCRC_TESTBOX_PROBES_PER_DAY: '3' }, 'default'));
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    expect(sink.refusal(ID(1))).toBe('not-test-box');
  });

  it('a test box: one line read from the box file (or named empty) is the role; probes off without a config directory', () => {
    const b = fixtureBox();
    expect(probeRole(boxLines(b))).toBe('test-box');
    expect(probeRole(parseKnobLines(['CCRC_TESTBOX_OS_MIRROR', '', '', 'empty'].join(KNOB_FIELD_SEP)))).toBe('test-box');
    const off = boxLines(b, { CCRC_TESTBOX_PROBE_CONFIG_DIR: '' });
    expect(probeSettings(off, b.probes, b.home)).toEqual({ ok: false, refusal: 'probes-off' });
    const d = desk(b, {}, off);
    expect(d.configured()).toBe(false);
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    expect(sink.refusal(ID(1))).toBe('probes-off');
  });

  it('no runner installed: refused no-runner, nothing counted', () => {
    const b = fixtureBox();
    const d = desk(b, { runner: null });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    expect(sink.refusal(ID(1))).toBe('no-runner');
    expect(d.view()).toMatchObject({ enabled: false, refusal: 'no-runner', used: 0 });
  });

  it('every refusal has its sentence, and the probe knobs are the three box keys', () => {
    expect(Object.keys(PROBE_REFUSAL_SENTENCE).sort()).toEqual(Object.keys(PROBE_REFUSAL_MAP).sort());
    expect(PROBE_KNOBS).toEqual(['CCRC_TESTBOX_PROBE_CONFIG_DIR', 'CCRC_TESTBOX_PROBE_SOCKET', 'CCRC_TESTBOX_PROBES_PER_DAY']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2. One at a time: the single-slot queue.
// ---------------------------------------------------------------------------------------------------------------

describe('the single-slot queue (D-8290)', () => {
  it('queue.ts: a probe may not start beside another probe, whatever the run limit', () => {
    let q = enqueue(EMPTY_QUEUE, { id: 'a', session: 's1', kind: 'probe' })!;
    q = enqueue(q, { id: 'b', session: 's2', kind: 'probe' })!;
    const first = admit(q, { runs: 9, sessionRuns: 9 });
    expect(first.started.map((e) => e.id)).toEqual(['a']);
    expect(admit(first.state, { runs: 9, sessionRuns: 9 }).started).toEqual([]);
    expect(admit(finish(first.state, 'a'), { runs: 9, sessionRuns: 9 }).started.map((e) => e.id)).toEqual(['b']);
  });

  it('two probes requested at once run one after the other, the second waiting at position 1, the queue in the status block', async () => {
    const b = fixtureBox();
    const runner = new GatedRunner();
    const d = desk(b, { runner });
    const s1 = new Sink();
    const s2 = new Sink();
    d.submit(SUBMIT(1, 'probe-one'), s1);
    d.submit(SUBMIT(2, 'probe-two'), s2);
    await tick();
    expect(runner.held).toBe(1);
    expect(s1.states(ID(1))).toEqual(['queued', 'running']);
    expect(s2.frames).toEqual([{ t: 'probe.state', probeId: ID(2), state: 'queued', refusal: null, detail: null, position: 1, exit: null }]);
    expect(d.view()).toMatchObject({ enabled: true, refusal: null, running: 'probe-one', waiting: ['probe-two'], used: 2, perDay: 3, day: '2026-11-11' });

    runner.release();
    await tick();
    await tick();
    expect(s1.states(ID(1))).toEqual(['queued', 'running', 'ended']);
    expect(s2.states(ID(2))).toEqual(['queued', 'running']);
    expect(d.view()).toMatchObject({ running: 'probe-two', waiting: [] });

    runner.release();
    await d.settled();
    expect(s2.states(ID(2))).toEqual(['queued', 'running', 'ended']);
    expect(runner.maxLive).toBe(1);
    expect(runner.specs.map((s) => s.name)).toEqual(['probe-one', 'probe-two']);
    expect(d.idle()).toBe(true);
    expect(d.view()).toMatchObject({ running: null, waiting: [] });
  });

  it('a runner that throws ends its probe at 255 and the next one starts; a reused id is refused', async () => {
    const b = fixtureBox();
    let n = 0;
    const runner: ProbeRunner = { run: async () => { n++; if (n === 1) throw new Error('boom'); return { exit: 3 }; } };
    const d = desk(b, { runner });
    const s = new Sink();
    d.submit(SUBMIT(1), s);
    d.submit(SUBMIT(2), s);
    await d.settled();
    expect(s.frames.filter((f) => f.state === 'ended').map((f) => [f.probeId, f.exit])).toEqual([[ID(1), 255], [ID(2), 3]]);
    d.submit(SUBMIT(1), s);
    expect(s.refusal(ID(1))).toBe('probe-id-used');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 3. The pinned environment and the config directory guard.
// ---------------------------------------------------------------------------------------------------------------

describe('the pinned environment and the config directory guard (D-8290)', () => {
  it('the spec: the scratch config directory, a probe-owned home and tmux directory, the dedicated -L name; no fleet TMUX', async () => {
    const b = fixtureBox();
    const runner = new GatedRunner();
    const d = desk(b, { runner });
    d.submit(SUBMIT(1), new Sink());
    await tick();
    const env = new Map(runner.specs[0]!.env);
    expect(env.get('CLAUDE_CONFIG_DIR')).toBe(b.scratch);
    expect(env.get('HOME')).toBe(path.join(b.probes, 'home'));
    expect(env.get('TMUX_TMPDIR')).toBe(path.join(b.probes, 'tmux'));
    expect(env.get('CCRC_PROBE_TMUX_SOCKET')).toBe('ccrc-probe');
    expect(runner.specs[0]!.socket).toBe('ccrc-probe');
    expect([...env.keys()].filter((k) => k.startsWith('TMUX') && k !== 'TMUX_TMPDIR')).toEqual([]);
    expect([...env.keys()].sort()).toEqual(['CCRC_PROBE_TMUX_SOCKET', 'CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH', 'TMUX_TMPDIR']);
    runner.release();
    await d.settled();
  });

  it('the deciders: a fleet account\'s directory, a path inside one, one around one, a fleet-named segment, an unsafe path', () => {
    const fleet = ['/home/svc/.claude', '/home/svc/.lane-a-config'];
    expect(configDirRefusal('/srv/probe/config', fleet)).toBeNull();
    expect(configDirRefusal('/home/svc/.lane-a-config', fleet)).toBe('config-dir-fleet');
    expect(configDirRefusal('/home/svc/.lane-a-config/sub', fleet)).toBe('config-dir-fleet');
    expect(configDirRefusal('/home/svc', fleet), 'a directory holding a fleet one').toBe('config-dir-fleet');
    expect(configDirRefusal('/srv/x/.claude', fleet), 'Claude Code\'s default name, anywhere').toBe('config-dir-fleet');
    expect(configDirRefusal('/srv/x/.claude-lane-b/y', fleet), 'a lane\'s name, anywhere').toBe('config-dir-fleet');
    expect(configDirRefusal('/home/svc/.lane-a-config-2', fleet), 'a sibling with a longer name is not inside').toBeNull();
    for (const p of ['relative/dir', '/srv/../home', '/srv//x', '/srv/./x', '/', '/srv/x\n']) expect(configDirRefusal(p, fleet), p).toBe('config-dir-unsafe');
    expect(writeRefusal('/home/svc/.lane-a-config/settings.json', fleet)).toBe('config-dir-fleet');
    expect(writeRefusal('/srv/testbox/probes/budget.json', fleet)).toBeNull();
    expect(socketRefusal('default')).toBe('socket-fleet');
    expect(socketRefusal('ccrc-probe')).toBeNull();
  });

  it('fleetConfigDirs reads Claude Code\'s default and every roster lane of the home', () => {
    const b = fixtureBox();
    expect(fleetConfigDirs([b.home]).sort()).toEqual([path.join(b.home, '.claude'), path.join(b.home, '.lane-a-config')].sort());
  });

  it('a config directory that is a fleet lane\'s, or a symlink into one, is refused config-dir-fleet and nothing runs', () => {
    const b = fixtureBox();
    const link = path.join(b.base, 'scratch-link');
    symlinkSync(path.join(b.home, '.lane-a-config'), link);
    for (const dir of [path.join(b.home, '.lane-a-config'), link, path.join(link, 'sub')]) {
      const runner = new GatedRunner();
      const d = desk(b, { runner }, boxLines(b, { CCRC_TESTBOX_PROBE_CONFIG_DIR: dir }));
      const sink = new Sink();
      d.submit(SUBMIT(1), sink);
      expect(sink.refusal(ID(1)), dir).toBe('config-dir-fleet');
      expect(runner.specs, dir).toEqual([]);
      expect(d.view(), dir).toMatchObject({ enabled: false, refusal: 'config-dir-fleet', used: 0 });
    }
  });

  it('the fleet\'s own tmux socket is refused socket-fleet', () => {
    const b = fixtureBox();
    const sink = new Sink();
    desk(b, {}, boxLines(b, { CCRC_TESTBOX_PROBE_SOCKET: 'default' })).submit(SUBMIT(1), sink);
    expect(sink.refusal(ID(1))).toBe('socket-fleet');
  });

  it('a desk write into a fleet account\'s directory is refused, and the file is never written', () => {
    const b = fixtureBox();
    const store = fileBudgetStore(path.join(b.home, '.lane-a-config', 'budget.json'));
    const sink = new Sink();
    desk(b, { store }).submit(SUBMIT(1), sink);
    expect(sink.refusal(ID(1))).toBe('config-dir-fleet');
    expect(() => readFileSync(store.file, 'utf8')).toThrow();
  });

  it('a symlink swapped into a fleet directory while a probe waits is judged again at its start', async () => {
    const b = fixtureBox();
    const link = path.join(b.base, 'scratch-link');
    symlinkSync(b.scratch, link);
    const runner = new GatedRunner();
    const d = desk(b, { runner }, boxLines(b, { CCRC_TESTBOX_PROBE_CONFIG_DIR: link }));
    const s = new Sink();
    d.submit(SUBMIT(1), s);
    d.submit(SUBMIT(2), s);
    await tick();
    const { rmSync } = await import('node:fs');
    rmSync(link);
    symlinkSync(path.join(b.home, '.claude'), link);
    runner.release();
    await d.settled();
    expect(s.states(ID(2))).toEqual(['queued', 'refused']);
    expect(s.refusal(ID(2))).toBe('config-dir-fleet');
    expect(runner.specs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 4. The budget.
// ---------------------------------------------------------------------------------------------------------------

describe('the daily budget, from config (D-8290)', () => {
  it('the deciders: the count rolls at the UTC day, and reaching the budget refuses', () => {
    expect(utcDay(NOON)).toBe('2026-11-11');
    expect(budgetOn({ day: '2026-11-10', used: 9 }, NOON)).toEqual({ day: '2026-11-11', used: 0 });
    expect(budgetOn({ day: '2026-11-11', used: 2 }, NOON)).toEqual({ day: '2026-11-11', used: 2 });
    expect(budgetRefusal({ day: '2026-11-11', used: 2 }, 3)).toBeNull();
    expect(budgetRefusal({ day: '2026-11-11', used: 3 }, 3)).toBe('budget-spent');
  });

  it('the fourth probe of a three-a-day budget is refused budget-spent; the count is visible and survives a new desk', async () => {
    const b = fixtureBox();
    const runner: ProbeRunner = { run: async () => ({ exit: 0 }) };
    const d = desk(b, { runner });
    const s = new Sink();
    for (const n of [1, 2, 3]) d.submit(SUBMIT(n), s);
    await d.settled();
    expect(d.view()).toMatchObject({ used: 3, perDay: 3, day: '2026-11-11' });
    d.submit(SUBMIT(4), s);
    expect(s.frames.at(-1)).toEqual({ t: 'probe.state', probeId: ID(4), state: 'refused', refusal: 'budget-spent', detail: PROBE_REFUSAL_SENTENCE['budget-spent'], position: null, exit: null });
    expect(JSON.parse(readFileSync(path.join(b.probes, 'budget.json'), 'utf8'))).toEqual({ day: '2026-11-11', used: 3 });

    // A restarted service reads the same count.
    const again = new Sink();
    desk(b, { runner }).submit(SUBMIT(5), again);
    expect(again.refusal(ID(5))).toBe('budget-spent');

    // The next UTC day starts at zero.
    const tomorrow = new Sink();
    const next = desk(b, { runner, now: () => NOON + 86_400_000 });
    next.submit(SUBMIT(6), tomorrow);
    await next.settled();
    expect(tomorrow.states(ID(6))).toEqual(['queued', 'running', 'ended']);
    expect(next.view()).toMatchObject({ used: 1, day: '2026-11-12' });
  });

  it('a waiting probe holds its unit: with one left, a third request at once is refused', async () => {
    const b = fixtureBox();
    const runner = new GatedRunner();
    const d = desk(b, { runner }, boxLines(b, { CCRC_TESTBOX_PROBES_PER_DAY: '2' }));
    const s = new Sink();
    for (const n of [1, 2, 3]) d.submit(SUBMIT(n), s);
    expect(s.refusal(ID(3))).toBe('budget-spent');
    expect(d.view()).toMatchObject({ used: 2, perDay: 2, waiting: ['probe-2'] });
    runner.release();
    await tick();
    runner.release();
    await d.settled();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The service: the frame's handler and the status block.
// ---------------------------------------------------------------------------------------------------------------

describe('the test service takes probe.submit through the desk (D-8290)', () => {
  const SETTINGS = (root: string): ServiceSettings => ({
    root, workers: 2, runTmpdir: '/tmp', toolsDir: path.join(root, 'tools'), envForward: [], runUserPrefix: 'ccrc-tb-',
    reportMaxBytes: 1024, serviceUser: 'svc', runs: 2, sessionRuns: 1, logTail: 5, retentionMs: 3_600_000,
  });
  const service = (root: string, probes?: ProbeDesk): TestboxService => new TestboxService({
    settings: SETTINGS(root), rows: [], sys: {} as SystemManager, probe: async () => ({ ok: true }), mirror: {} as MirrorOps,
    now: () => NOON, chrome: '/x/chrome', release: 'v1.2.3', serviceVersion: '1.2.3', ...(probes === undefined ? {} : { probes }),
  });
  class ConnSink extends Sink implements Conn {
    readonly refused: string[] = [];
    override send(f: ProbeAnswer | RunLog | RunSummary): void { if (f.t === 'probe.state') super.send(f); }
    refuse(reason: string): void { this.refused.push(reason); }
  }
  const reread = (a: StatusAnswer): StatusAnswer => {
    const r = readTestboxFrame(JSON.stringify(a));
    if (!r.ok) throw new Error(r.reason);
    return r.value as StatusAnswer;
  };

  it('the handler routes the frame to the desk; the status answer carries the block and passes the reader', async () => {
    const b = fixtureBox();
    const runner = new GatedRunner();
    const svc = service(b.root, desk(b, { runner }));
    const conn = new ConnSink();
    await FRAME_HANDLERS['probe.submit']!(svc, SUBMIT(1, 'probe-one'), conn);
    await tick();
    expect(conn.states(ID(1))).toEqual(['queued', 'running']);
    expect(reread(svc.status()).probes).toEqual({ enabled: true, refusal: null, running: 'probe-one', waiting: [], day: '2026-11-11', used: 1, perDay: 3 });
    runner.release();
  });

  it('a box that names no probe config directory sends no block; a service without a desk refuses the frame', () => {
    const b = fixtureBox();
    expect('probes' in service(b.root, desk(b, {}, boxLines(b, { CCRC_TESTBOX_PROBE_CONFIG_DIR: '' }))).status()).toBe(false);
    const bare = service(b.root);
    expect('probes' in bare.status()).toBe(false);
    const conn = new ConnSink();
    bare.probe(SUBMIT(1), conn);
    expect(conn.refused).toEqual(['probe.submit is not a frame this service takes']);
  });
});

describe('probeSpec builds the environment from empty (D-8290)', () => {
  it('nothing from the service\'s own environment reaches it', () => {
    const prev = process.env.TMUX;
    process.env.TMUX = '/tmp/tmux-1000/default,1,0';
    try {
      const spec = probeSpec({ configDir: '/srv/scratch', socket: 'ccrc-probe', perDay: 3, root: '/srv/testbox/probes' }, ID(1), 'probe-1');
      expect(spec.env.map(([k]) => k)).not.toContain('TMUX');
    } finally {
      if (prev === undefined) delete process.env.TMUX; else process.env.TMUX = prev;
    }
  });
});

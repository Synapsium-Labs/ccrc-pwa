// D-5242 (`hibernate-long-idle-sessions`, plan Task 17a): the SHADOW sweep. It reads what the verdict needs, asks
// `hibernateVerdict`, and LOGS one `hibernate-shadow <id> idle=<h>h` line for a `hibernate` answer — and nothing else.
// Nothing in this task can hibernate a session: the pass is handed no ccd runner at all, and the watcher's own pass,
// run end to end below with a runner that records every command, reaches ccd for nothing whatever the markers say.
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  hibernatePass, type HibernateSweepMemory, type HibernateSweepDeps,
} from '../src/hibernateSweep.js';
import {
  HIBERNATE_AFTER_HOURS_FILE, HIBERNATE_DISABLED_MARKER, HIBERNATE_LIVE_MARKER, HIBERNATE_SWEEP_MS,
  NO_HIBERNATE_SUFFIX, type HibernateMark,
} from '../src/coord/hibernate.js';
import { PRESENCE_OPEN_TTL_MS, RUN_STATES, TERMINAL_RUN_STATES, type FleetSession, type RunState } from '../../shared/api.js';
import type { SessionRecord } from '../src/registry.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { Presence } from '../src/presence.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { readSessionRecord } from '../src/registry.js';
import { liveRowFor, turnReadDeps } from '../src/turnverdict.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP } from '../src/ccdargv.js';
import type { HibernateActPort } from '../src/hibernateSweep.js';
import type { CcdResult } from '../src/lifecycle.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const STARTED = NOW - PRESENCE_OPEN_TTL_MS - MIN;
const ID = 'project-a-quiet-basin';
const OTHER = 'lane-a-project-a';

const row = (id: string, o: Partial<FleetSession> = {}): FleetSession => ({
  id, status: 'idle', archivedAt: null, bucket: 'idle', held: null, unmeasured: [], statusUnmeasured: false,
  dialogPending: false, background: null, subagents: null, stranded: null, swapBlocked: null, substrate: null,
  statusUpdatedAt: NOW - 50 * MIN, ...o,
}) as unknown as FleetSession;
const rec = (id: string): SessionRecord => ({ id, uuid: `uuid-${id}` }) as unknown as SessionRecord;
/** A `done` marker whose Stop is `ageMs` old, nothing in the background, nothing scheduled. */
const mark = (ageMs: number, o: Partial<HibernateMark> = {}): HibernateMark =>
  ({ ok: true, state: 'done', bg: 0, crons: 0, turnAt: NOW - ageMs - MIN, stopAt: NOW - ageMs, restartAt: null, ...o }) as HibernateMark;

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-hib-'), '.ccrc', 'coord.db')));
/** The store port the sweep declares, over a real store, with any read overridden. */
const port = (s: CoordStore, o: Partial<NonNullable<HibernateSweepDeps['coord']>> = {}): NonNullable<HibernateSweepDeps['coord']> => ({
  openRunsForSession: (id) => s.openRunsForSession(id),
  openRunsClaimedBy: (id) => s.openRunsClaimedBy(id),
  activeClaims: () => s.activeClaims(),
  outstandingMailFor: (id, n) => s.outstandingMailFor(id, n),
  ...o,
});

interface Fake { deps: HibernateSweepDeps; lines: string[]; coord: CoordStore; clock: { now: number } }
function fake(o: { ageMs?: number; afterHours?: string | null; presence?: Pick<Presence, 'isOpen'> } = {}): Fake {
  const coord = store();
  const lines: string[] = [];
  const clock = { now: NOW };
  const deps: HibernateSweepDeps = {
    coord: port(coord),
    presence: o.presence ?? { isOpen: () => false },
    liveWord: async () => ({ ok: true, word: 'idle', since: null }),
    mark: async () => mark((o.ageMs ?? 7 * HOUR) + (clock.now - NOW)),
    readAfterHours: async () => o.afterHours ?? null,
    log: (l) => { lines.push(l); },
    startedAt: STARTED,
    now: () => clock.now,
    act: null,
  };
  return { deps, lines, coord, clock };
}
const mem = (): HibernateSweepMemory => ({ lastLine: new Map(), lastActLine: new Map() });
const pass = (f: Fake, m = mem(), names: readonly string[] = [], rows = [row(ID)], recs = [rec(ID)]) =>
  hibernatePass(f.deps, m, rows, recs, names);

describe('hibernatePass: the shadow line', () => {
  it('a hibernate verdict logs one shadow line naming the id and its idle hours', async () => {
    const f = fake();
    const out = await pass(f);
    expect(out).toEqual([{ id: ID, verdict: { act: 'hibernate', idleMs: 7 * HOUR } }]);
    expect(f.lines).toEqual([`ccrc-server: hibernate-shadow ${ID} idle=7h`]);
  });

  it('a held row logs nothing', async () => {
    const f = fake();
    await pass(f, mem(), [], [row(ID, { bucket: 'done' })]);
    expect(f.lines).toEqual([]);
  });

  it('with no act port the pass cannot act, whatever the markers say', async () => {
    const f = fake();
    const out = await pass(f, mem(), [HIBERNATE_LIVE_MARKER]);
    expect(out).toEqual([{ id: ID, verdict: { act: 'hibernate', idleMs: 7 * HOUR } }]);
    expect(f.lines).toEqual([`ccrc-server: hibernate-shadow ${ID} idle=7h`]);
  });

  it('hibernate-disabled: nothing is read and nothing is logged', async () => {
    const f = fake();
    const live = vi.fn(f.deps.liveWord);
    const after = vi.fn(f.deps.readAfterHours);
    expect(await hibernatePass({ ...f.deps, liveWord: live, readAfterHours: after }, mem(), [row(ID)], [rec(ID)],
      [HIBERNATE_DISABLED_MARKER, HIBERNATE_LIVE_MARKER])).toEqual([]);
    expect(f.lines).toEqual([]);
    expect(live).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('hibernate-after-hours of 2 logs a 3 h row; unlisted, it is not read and the default holds the same row', async () => {
    const two = fake({ ageMs: 3 * HOUR, afterHours: '2' });
    await pass(two, mem(), [HIBERNATE_AFTER_HOURS_FILE]);
    expect(two.lines).toEqual([`ccrc-server: hibernate-shadow ${ID} idle=3h`]);
    const unlisted = fake({ ageMs: 3 * HOUR, afterHours: '2' });
    const after = vi.fn(unlisted.deps.readAfterHours);
    await hibernatePass({ ...unlisted.deps, readAfterHours: after }, mem(), [row(ID)], [rec(ID)], []);
    expect(unlisted.lines).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });

  it('an out-of-range hibernate-after-hours is the default: a 3 h row is not logged', async () => {
    for (const bad of ['0', '169', 'two']) {
      const f = fake({ ageMs: 3 * HOUR, afterHours: bad });
      await pass(f, mem(), [HIBERNATE_AFTER_HOURS_FILE]);
      expect(f.lines, bad).toEqual([]);
    }
  });

  it('at most one shadow line per id per hour', async () => {
    const f = fake();
    const m = mem();
    await pass(f, m);
    f.clock.now += HIBERNATE_SWEEP_MS;
    await pass(f, m);
    expect(f.lines).toHaveLength(1);
    f.clock.now = NOW + HOUR;
    await pass(f, m);
    expect(f.lines).toHaveLength(2);
  });

  it('the opt-out marker $REG/<id>.no-hibernate holds that id only', async () => {
    const f = fake();
    await pass(f, mem(), [`${ID}.${NO_HIBERNATE_SUFFIX}`], [row(ID), row(OTHER)], [rec(ID), rec(OTHER)]);
    expect(f.lines).toEqual([`ccrc-server: hibernate-shadow ${OTHER} idle=7h`]);
  });

  it('a row with no registry record is not judged (nothing to read its marker by)', async () => {
    const f = fake();
    await pass(f, mem(), [], [row(ID)], []);
    expect(f.lines).toEqual([]);
  });
});

describe('hibernatePass: after a server start, presence is unknown', () => {
  it('an idle row with no open claim logs nothing inside PRESENCE_OPEN_TTL_MS of the start, and logs one sweep after', async () => {
    const f = fake();
    f.deps = { ...f.deps, startedAt: NOW };
    const m = mem();
    for (let t = NOW; t < NOW + PRESENCE_OPEN_TTL_MS; t += HIBERNATE_SWEEP_MS) {
      f.clock.now = t;
      await pass(f, m);
    }
    expect(f.lines).toEqual([]);
    f.clock.now = NOW + PRESENCE_OPEN_TTL_MS + HIBERNATE_SWEEP_MS;
    await pass(f, m);
    expect(f.lines).toHaveLength(1);
  });
});

describe('hibernatePass: the store reads, on a real store', () => {
  const OPEN = RUN_STATES.filter((s) => !(TERMINAL_RUN_STATES as readonly string[]).includes(s));
  let seq = 0;
  const openRun = (s: CoordStore, o: { worker?: string; claimedBy: string; state: RunState }): void => {
    const r = s.openRun({ program: `program-${++seq}`, title: 't', project: 'project-a', wave: 1, waveOf: 1, claimedBy: o.claimedBy });
    if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
    if (o.worker !== undefined) s.setSession(r.id, o.worker);
    s.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(o.state, r.id);
  };

  // The claimant's `awaiting-review` and `merging` first: a coordinator whose runs wait on review is the one an
  // `ACTIVE_RUN_STATES`-only read would put to sleep.
  const ORDERED = ['awaiting-review', 'merging', ...OPEN.filter((s) => s !== 'awaiting-review' && s !== 'merging')] as RunState[];

  it.each(ORDERED)('an open run as CLAIMANT in state %s holds', async (state) => {
    const f = fake();
    openRun(f.coord, { claimedBy: ID, state });
    expect((await pass(f))[0]!.verdict).toEqual({ act: 'hold', reason: 'run-claimant' });
    expect(f.lines).toEqual([]);
  });

  it.each(ORDERED)('an open run as WORKER in state %s holds', async (state) => {
    const f = fake();
    openRun(f.coord, { worker: ID, claimedBy: OTHER, state });
    expect((await pass(f))[0]!.verdict).toEqual({ act: 'hold', reason: 'run-worker' });
  });

  it('a claimant whose only runs are done or failed is logged', async () => {
    const f = fake();
    openRun(f.coord, { claimedBy: ID, state: 'done' });
    openRun(f.coord, { claimedBy: ID, state: 'failed' });
    openRun(f.coord, { worker: ID, claimedBy: OTHER, state: 'done' });
    await pass(f);
    expect(f.lines).toHaveLength(1);
  });

  it('a claimant read that fails holds runs-unreadable; so does a worker read, and a store read that throws', async () => {
    const f = fake();
    const bad = { ok: false as const, kind: 'run-unreadable' as const, detail: 'fixture' };
    for (const over of [{ openRunsClaimedBy: () => bad }, { openRunsForSession: () => bad },
      { activeClaims: () => { throw new Error('db gone'); } }, { outstandingMailFor: () => { throw new Error('db gone'); } }]) {
      const out = await hibernatePass({ ...f.deps, coord: port(f.coord, over) }, mem(), [row(ID)], [rec(ID)], []);
      expect(out[0]!.verdict).toEqual({ act: 'hold', reason: 'runs-unreadable' });
    }
    expect(f.lines).toEqual([]);
  });

  it('no coordination store at all holds every row runs-unreadable', async () => {
    const f = fake();
    expect((await hibernatePass({ ...f.deps, coord: undefined }, mem(), [row(ID)], [rec(ID)], []))[0]!.verdict)
      .toEqual({ act: 'hold', reason: 'runs-unreadable' });
  });

  it('a claim held and outstanding mail each hold', async () => {
    const f = fake();
    const claim = await hibernatePass({ ...f.deps, coord: port(f.coord, { activeClaims: () => [{ heldBy: ID }] as never }) },
      mem(), [row(ID)], [rec(ID)], []);
    expect(claim[0]!.verdict).toEqual({ act: 'hold', reason: 'claim' });
    const mail = await hibernatePass({ ...f.deps, coord: port(f.coord, { outstandingMailFor: (id) => (id === ID ? [{}] : []) as never }) },
      mem(), [row(ID)], [rec(ID)], []);
    expect(mail[0]!.verdict).toEqual({ act: 'hold', reason: 'mail' });
  });
});

describe('hibernatePass: the viewer is Presence.isOpen', () => {
  it('a connection that reported visible:false still holds its session (an open screen in a hidden tab)', async () => {
    let t = NOW;
    const presence = new Presence(() => t);
    const token = Symbol('fixture');
    presence.markOpen(token, ID);
    presence.setVisible(token, null);
    expect(presence.isVisible(ID)).toBe(false);
    const f = fake({ presence });
    expect((await pass(f))[0]!.verdict).toEqual({ act: 'hold', reason: 'viewer' });
    t = NOW + PRESENCE_OPEN_TTL_MS + 1;
    f.clock.now = t;
    expect((await pass(f))[0]!.verdict.act).toBe('hibernate');
  });
});

// The pass above is handed stubs; this one runs the watcher's REAL `sweepHibernate`, so the closures it wires
// (the registry listing, `turnMarkFor` judged against the live process, the store) decide, and one runner that
// answers tmux and ccd alike records every command: the shadow arm reaches ccd for nothing.
describe('the watcher\'s own shadow pass, its deps unmocked', () => {
  const WID = 'project-a-quiet-basin';
  const WUUID = `u-${WID}`;
  const WRAPPER = 'claude-a';
  const PANE = 4242;

  const harness = async () => {
    const home = mkTmp('ccrc-hib-real-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const coord = store();
    const fields: Record<string, string> = { wrapper: WRAPPER, project: 'project-a', workdir: `/w/${WID}`, uuid: WUUID, started: '1' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${WID}.${k}`), v);
    const startedAt = Date.now() - 24 * HOUR;
    const sessions = path.join(home, `.${WRAPPER}`, 'sessions');
    mkdirSync(sessions, { recursive: true });
    writeFileSync(path.join(sessions, `${PANE}.json`), JSON.stringify({
      pid: PANE, sessionId: WUUID, status: 'idle', statusUpdatedAt: Date.now() - 50 * MIN, startedAt }));
    const at = Date.now() - 7 * HOUR;
    writeFileSync(path.join(reg, `${WID}.turn.json`), `${JSON.stringify({
      v: 1, sessionId: WUUID, state: 'done', event: 'Stop', at, turnAt: at - 60_000, stopAt: at,
      bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', crons: 0 })}\n`);
    const calls: { cmd: string; args: string[] }[] = [];
    const run: Runner = async (cmd, args) => {
      calls.push({ cmd, args: [...args] });
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PANE}\n`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    // `runCcd` UNGUARDED (not `testDeps`'s whitelist-guarded one): a guarded runner throws on an argv outside the
    // agent's whitelist before it is recorded, and the sweep's catch would swallow that — so any ccd call at all,
    // granted or not, lands in `calls` here.
    const deps = { ...testDeps(home, run), runCcd: ccdRunner(run, cfg), cfg, coord, presence: new Presence() };
    const w = new FleetWatcher(deps as never, new Bus(), 10_000);
    (w as unknown as { hibernateStartedAt: number }).hibernateStartedAt = startedAt;
    const tick = async () => {
      const r = await readSessionRecord(deps.io, cfg, WID);
      if (r.kind !== 'found') throw new Error('fixture record not found');
      const row = await liveRowFor(turnReadDeps(deps as never, w), r.record, WUUID);
      if (row === null) throw new Error('fixture row not assembled');
      return { rows: [row], records: [r.record] };
    };
    const ccdCalls = () => calls.filter((c) => !c.cmd.endsWith('tmux'));
    return { reg, coord, w, tick, ccdCalls, calls };
  };

  it('an idle row 7 h past its Stop logs one shadow line, and no command but tmux reads ran — whatever the markers', async () => {
    const h = await harness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const t = await h.tick();
      expect(t.rows[0]).toMatchObject({ bucket: 'idle', status: 'idle' });
      await h.w.sweepHibernate(t.rows, t.records, [HIBERNATE_LIVE_MARKER]);
      const shadow = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('hibernate-shadow'));
      expect(shadow).toEqual([`ccrc-server: hibernate-shadow ${WID} idle=7h`]);
      expect(h.ccdCalls()).toEqual([]);
      expect(h.calls.some((c) => c.args.includes('hibernate') || c.args.includes('kill-session'))).toBe(false);
    } finally {
      warn.mockRestore();
      h.coord.db.close();
    }
  });

  it('armed, with the serialiser handed over: the real watcher composes one `ccd hibernate` through its own runner', async () => {
    const h = await harness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const order: string[] = [];
      h.w.useStopDoneSerialiser({ serial: async <T>(fn: () => Promise<T>): Promise<T> => { order.push('serial'); return fn(); } } as never);
      const t = await h.tick();
      await h.w.sweepHibernate(t.rows, t.records, [HIBERNATE_LIVE_MARKER]);
      expect(h.ccdCalls().map((c) => c.args.slice(-2))).toEqual([['hibernate', WID]]);
      expect(order).toEqual(['serial']);
      expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('hibernat'))).toEqual([`ccrc-server: hibernated ${WID} idle=7h (D-5242)`]);
    } finally {
      warn.mockRestore();
      h.coord.db.close();
    }
  });

  it('runs on its own clock: a second call inside HIBERNATE_SWEEP_MS reads nothing more', async () => {
    const h = await harness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const t = await h.tick();
      await h.w.sweepHibernate(t.rows, t.records, []);
      const n = h.calls.length;
      await h.w.sweepHibernate(t.rows, t.records, []);
      expect(h.calls.length).toBe(n);
    } finally {
      warn.mockRestore();
      h.coord.db.close();
    }
  });

  it('the tick runs the shadow pass, and not on the priming tick', async () => {
    const h = await harness();
    try {
      const spy = vi.spyOn(h.w, 'sweepHibernate').mockResolvedValue(undefined);
      await (h.w as unknown as { tick(): Promise<void> }).tick();
      expect(spy).not.toHaveBeenCalled();
      await (h.w as unknown as { tick(): Promise<void> }).tick();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      h.coord.db.close();
    }
  });
});

describe('hibernatePass: the store and presence are read again after the live reads', () => {
  // The live reads take real time (a tmux call, two file reads). What the store or a screen said BEFORE them is not
  // what holds AFTER them: Task 17b's act-time re-measure reuses this order, so a pass that read them once is red.
  it('a viewer who opens the session while the live reads run holds viewer', async () => {
    let calls = 0;
    const f = fake({ presence: { isOpen: () => { calls += 1; return calls > 1; } } });
    const out = await pass(f);
    expect(out).toEqual([{ id: ID, verdict: { act: 'hold', reason: 'viewer' } }]);
    expect(f.lines).toEqual([]);
  });

  it('a run opened for the session while the live reads run holds run-worker', async () => {
    const f = fake();
    let calls = 0;
    const real = f.deps.coord!;
    const coord: NonNullable<HibernateSweepDeps['coord']> = {
      ...real,
      openRunsForSession: (id) => {
        calls += 1;
        return calls > 1 ? { ok: true, siblings: [{ id: 1, program: 'program-a', wave: 1, waveOf: 1 }] } : real.openRunsForSession(id);
      },
    } as NonNullable<HibernateSweepDeps['coord']>;
    const out = await pass({ ...f, deps: { ...f.deps, coord } });
    expect(out).toEqual([{ id: ID, verdict: { act: 'hold', reason: 'run-worker' } }]);
    expect(f.lines).toEqual([]);
  });
});

describe('hibernatePass: no presence port at all', () => {
  it('holds viewer (fail closed): an unmeasured screen is never an empty one', async () => {
    const f = fake();
    const out = await pass({ ...f, deps: { ...f.deps, presence: undefined } });
    expect(out).toEqual([{ id: ID, verdict: { act: 'hold', reason: 'viewer' } }]);
    expect(f.lines).toEqual([]);
  });
});

// TASK 17b: THE LIVE ARM. Armed only by `$REG/hibernate-live` (with `hibernate-disabled` unlisted), on a box whose
// `ccd caps` lists `hibernate`, once the coordination serialiser is handed over; at most HIBERNATE_PER_SWEEP acts a
// sweep; ccd's `session-busy` refusal is a quiet skip.
describe('hibernatePass: the live act', () => {
  const CAPS = { ccdVerbs: ['hibernate', 'ensure', ACTOR_FLAGS_CAP] };
  const ok: CcdResult = { ok: true, stdout: '', stderr: '', killed: false, signal: null };
  interface Live { f: Fake; argvs: string[][]; order: string[]; port: HibernateActPort }
  const live = (o: { answer?: (argv: readonly string[]) => CcdResult; serial?: HibernateActPort['serial'] | 'none';
    fleetState?: { ccdVerbs: string[] | null }; rowAtAct?: HibernateActPort['rowAtAct']; ageMs?: number;
    presence?: Pick<Presence, 'isOpen'> } = {}): Live => {
    const f = fake({ ageMs: o.ageMs, presence: o.presence });
    const argvs: string[][] = [];
    const order: string[] = [];
    const port: HibernateActPort = {
      runCcd: async (argv) => { order.push('ccd'); argvs.push([...argv]); return o.answer?.(argv) ?? ok; },
      fleetState: (o.fleetState ?? CAPS) as never,
      serial: o.serial === 'none' ? null : (o.serial ?? (async (fn) => { order.push('serial'); return fn(); })),
      queueRun: async (_id, fn) => { order.push('queue'); return fn(); },
      rowAtAct: o.rowAtAct ?? (async (r) => ({ ok: true, row: row(r.id) })),
    };
    return { f: { ...f, deps: { ...f.deps, act: port } }, argvs, order, port };
  };
  const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `project-a-basin-${i}`);
  const passN = (l: Live, n: number, names: readonly string[], m = mem()) =>
    hibernatePass(l.f.deps, m, ids(n).map((id) => row(id)), ids(n).map((id) => rec(id)), names);

  it('no hibernate-live: shadow lines and no ccd call (17a\'s pin, kept)', async () => {
    const l = live();
    await passN(l, 2, []);
    expect(l.argvs).toEqual([]);
    expect(l.f.lines).toEqual(ids(2).map((id) => `ccrc-server: hibernate-shadow ${id} idle=7h`));
  });

  it('hibernate-live: one declared `ccd hibernate` per idle row, on the serialiser and then the session queue', async () => {
    const l = live();
    const out = await pass(l.f, mem(), [HIBERNATE_LIVE_MARKER]);
    expect(l.argvs).toEqual([['hibernate', ID, '--surface', 'agent', '--actor', 'sweep:hibernate']]);
    expect(l.order).toEqual(['serial', 'queue', 'ccd']);
    expect(out).toEqual([{ id: ID, verdict: { act: 'hibernate', idleMs: 7 * HOUR }, act: { kind: 'hibernated' } }]);
    expect(l.f.lines).toEqual([`ccrc-server: hibernated ${ID} idle=7h (D-5242)`]);
  });

  it('at most HIBERNATE_PER_SWEEP (3) acts a sweep, fleet-wide; the rest wait, unlogged, for the next sweep', async () => {
    const l = live();
    await passN(l, 5, [HIBERNATE_LIVE_MARKER]);
    expect(l.argvs.map((a) => a[1])).toEqual(ids(3));
    expect(l.f.lines.filter((x) => x.includes('hibernate-shadow'))).toEqual([]);
  });

  it('hibernate-disabled beside hibernate-live: nothing at all', async () => {
    const l = live();
    expect(await passN(l, 2, [HIBERNATE_LIVE_MARKER, HIBERNATE_DISABLED_MARKER])).toEqual([]);
    expect(l.argvs).toEqual([]);
    expect(l.f.lines).toEqual([]);
  });

  it('a box whose ccd caps do not list hibernate: no ccd call, shadow lines only', async () => {
    const l = live({ fleetState: { ccdVerbs: ['ensure', ACTOR_FLAGS_CAP] } });
    await pass(l.f, mem(), [HIBERNATE_LIVE_MARKER]);
    expect(l.argvs).toEqual([]);
    expect(l.f.lines).toEqual([`ccrc-server: hibernate-shadow ${ID} idle=7h`]);
  });

  it('no serialiser handed over yet: no ccd call, shadow lines only', async () => {
    const l = live({ serial: 'none' });
    await pass(l.f, mem(), [HIBERNATE_LIVE_MARKER]);
    expect(l.argvs).toEqual([]);
    expect(l.f.lines).toHaveLength(1);
  });

  it('ccd refusing session-busy (exit 3) is a quiet skip: one line per id per hour, never a warning per sweep', async () => {
    const l = live({ answer: () => ({ ok: false, stdout: '', stderr: 'ccd: session-busy: attached — 1 terminal(s) attached to the pane\n', killed: false, signal: null }) });
    const m = mem();
    const first = await pass(l.f, m, [HIBERNATE_LIVE_MARKER]);
    expect(first[0]!.act).toEqual({ kind: 'skipped', detail: 'attached' });
    for (let i = 0; i < 3; i++) { l.f.clock.now += HIBERNATE_SWEEP_MS; await pass(l.f, m, [HIBERNATE_LIVE_MARKER]); }
    expect(l.argvs, 'asked again every sweep: ccd re-measures cheaply').toHaveLength(4);
    expect(l.f.lines).toEqual([`ccrc-server: hibernate-skip ${ID}: ccd re-measured it as attached — asked again next sweep`]);
    l.f.clock.now = NOW + HOUR;
    await pass(l.f, m, [HIBERNATE_LIVE_MARKER]);
    expect(l.f.lines, 'and once more an hour later').toHaveLength(2);
  });

  it('any other failure is logged once per id per hour too, and the pass goes on', async () => {
    const l = live({ answer: () => ({ ok: false, stdout: '', stderr: 'boom', killed: false, signal: null }) });
    const m = mem();
    const out = await pass(l.f, m, [HIBERNATE_LIVE_MARKER]);
    expect(out[0]!.act).toEqual({ kind: 'failed', detail: 'boom' });
    await pass(l.f, m, [HIBERNATE_LIVE_MARKER]);
    expect(l.f.lines).toEqual([`ccrc-server: hibernate of ${ID} failed (boom) — asked again next sweep`]);
  });

  it('AT THE ACT, again: a screen opened inside the serialiser holds viewer and composes nothing', async () => {
    let open = false;
    const l = live({ presence: { isOpen: () => open } });
    const port: HibernateActPort = { ...l.port, serial: async (fn) => { open = true; return fn(); } };
    const out = await pass({ ...l.f, deps: { ...l.f.deps, act: port } }, mem(), [HIBERNATE_LIVE_MARKER]);
    expect(out[0]!.act).toEqual({ kind: 'held-at-act', verdict: { act: 'hold', reason: 'viewer' } });
    expect(l.argvs).toEqual([]);
  });

  it('AT THE ACT, again: the re-read row (a hold written since the tick) and an unreadable re-read both hold', async () => {
    const held = live({ rowAtAct: async (r) => ({ ok: true, row: row(r.id, { held: { reason: 'fixture' } as never }) }) });
    expect((await pass(held.f, mem(), [HIBERNATE_LIVE_MARKER]))[0]!.act)
      .toEqual({ kind: 'held-at-act', verdict: { act: 'hold', reason: 'held' } });
    const gone = live({ rowAtAct: async () => ({ ok: false }) });
    expect((await pass(gone.f, mem(), [HIBERNATE_LIVE_MARKER]))[0]!.act)
      .toEqual({ kind: 'held-at-act', verdict: { act: 'hold', reason: 'unmeasured' } });
    expect([...held.argvs, ...gone.argvs]).toEqual([]);
  });

  // The store, the live claims and the mail queue are read again INSIDE the serialiser (D-5428): what the tick read
  // is not what holds at the kill. Each case flips its read only once the serialiser has been entered.
  const atAct = (o: (inside: () => boolean) => Partial<NonNullable<HibernateSweepDeps['coord']>>) => {
    let inside = false;
    const l = live();
    const coord = { ...l.f.deps.coord!, ...o(() => inside) } as NonNullable<HibernateSweepDeps['coord']>;
    const port: HibernateActPort = { ...l.port, serial: async (fn) => { inside = true; return fn(); } };
    return { l, f: { ...l.f, deps: { ...l.f.deps, coord, act: port } } };
  };

  it('AT THE ACT the store is read again: a run opened onto the session inside the serialiser holds run-worker', async () => {
    const { l, f } = atAct((inside) => ({
      openRunsForSession: (id) => (inside()
        ? { ok: true, siblings: [{ id: 1, program: 'program-a', wave: 1, waveOf: 1 }] }
        : l.f.coord.openRunsForSession(id)) as never,
    }));
    expect((await pass(f, mem(), [HIBERNATE_LIVE_MARKER]))[0]!.act)
      .toEqual({ kind: 'held-at-act', verdict: { act: 'hold', reason: 'run-worker' } });
    expect(l.argvs).toEqual([]);
  });

  it('AT THE ACT the live claims are read again: a claim taken inside the serialiser holds claim', async () => {
    const { l, f } = atAct((inside) => ({
      activeClaims: () => (inside() ? [{ heldBy: ID }] : l.f.coord.activeClaims()) as never,
    }));
    expect((await pass(f, mem(), [HIBERNATE_LIVE_MARKER]))[0]!.act)
      .toEqual({ kind: 'held-at-act', verdict: { act: 'hold', reason: 'claim' } });
    expect(l.argvs).toEqual([]);
  });

  it('AT THE ACT the mail queue is read again: mail queued inside the serialiser holds mail', async () => {
    const { l, f } = atAct((inside) => ({
      outstandingMailFor: (id, n) => (inside() ? [{ id: 1 }] : l.f.coord.outstandingMailFor(id, n)) as never,
    }));
    expect((await pass(f, mem(), [HIBERNATE_LIVE_MARKER]))[0]!.act)
      .toEqual({ kind: 'held-at-act', verdict: { act: 'hold', reason: 'mail' } });
    expect(l.argvs).toEqual([]);
  });

  it('AT THE ACT, again: a turn that started since the pass read the marker holds marker', async () => {
    const l = live();
    let n = 0;
    const f = { ...l.f, deps: { ...l.f.deps, mark: async () => (++n > 1 ? { ok: true, state: 'working', bg: 0, crons: 0, turnAt: NOW, stopAt: null, restartAt: null } as HibernateMark : mark(7 * HOUR)) } };
    expect((await pass(f, mem(), [HIBERNATE_LIVE_MARKER]))[0]!.act)
      .toEqual({ kind: 'held-at-act', verdict: { act: 'hold', reason: 'marker' } });
    expect(l.argvs).toEqual([]);
  });
});

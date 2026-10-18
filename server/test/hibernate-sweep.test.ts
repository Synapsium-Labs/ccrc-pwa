// D-5242 (`hibernate-long-idle-sessions`, plan Task 17a): the SHADOW sweep. It reads what the verdict needs, asks
// `hibernateVerdict`, and LOGS one `hibernate-shadow <id> idle=<h>h` line for a `hibernate` answer — and nothing else.
// Nothing in this task can hibernate a session: the pass is handed no ccd runner at all, and the watcher's own pass,
// run end to end below with a runner that records every command, reaches ccd for nothing whatever the markers say.
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  hibernateShadowPass, type HibernateShadowMemory, type HibernateSweepDeps,
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
  };
  return { deps, lines, coord, clock };
}
const mem = (): HibernateShadowMemory => ({ lastLine: new Map() });
const pass = (f: Fake, m = mem(), names: readonly string[] = [], rows = [row(ID)], recs = [rec(ID)]) =>
  hibernateShadowPass(f.deps, m, rows, recs, names);

describe('hibernateShadowPass: the shadow line', () => {
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

  it('the deps carry no ccd runner: the pass has no way to act (17a has no live arm)', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/hibernateSweep.ts', import.meta.url)), 'utf8')
      .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(src).not.toMatch(/\brunCcd\b|\bCCD_ARGV\b|\bccdargv\b/);
  });

  it('with hibernate-live listed it still only logs: the live marker is 17b\'s', async () => {
    const f = fake();
    await pass(f, mem(), [HIBERNATE_LIVE_MARKER]);
    expect(f.lines).toHaveLength(1);
  });

  it('hibernate-disabled: nothing is read and nothing is logged', async () => {
    const f = fake();
    const live = vi.fn(f.deps.liveWord);
    const after = vi.fn(f.deps.readAfterHours);
    expect(await hibernateShadowPass({ ...f.deps, liveWord: live, readAfterHours: after }, mem(), [row(ID)], [rec(ID)],
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
    await hibernateShadowPass({ ...unlisted.deps, readAfterHours: after }, mem(), [row(ID)], [rec(ID)], []);
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

describe('hibernateShadowPass: after a server start, presence is unknown', () => {
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

describe('hibernateShadowPass: the store reads, on a real store', () => {
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
      const out = await hibernateShadowPass({ ...f.deps, coord: port(f.coord, over) }, mem(), [row(ID)], [rec(ID)], []);
      expect(out[0]!.verdict).toEqual({ act: 'hold', reason: 'runs-unreadable' });
    }
    expect(f.lines).toEqual([]);
  });

  it('no coordination store at all holds every row runs-unreadable', async () => {
    const f = fake();
    expect((await hibernateShadowPass({ ...f.deps, coord: undefined }, mem(), [row(ID)], [rec(ID)], []))[0]!.verdict)
      .toEqual({ act: 'hold', reason: 'runs-unreadable' });
  });

  it('a claim held and outstanding mail each hold', async () => {
    const f = fake();
    const claim = await hibernateShadowPass({ ...f.deps, coord: port(f.coord, { activeClaims: () => [{ heldBy: ID }] as never }) },
      mem(), [row(ID)], [rec(ID)], []);
    expect(claim[0]!.verdict).toEqual({ act: 'hold', reason: 'claim' });
    const mail = await hibernateShadowPass({ ...f.deps, coord: port(f.coord, { outstandingMailFor: (id) => (id === ID ? [{}] : []) as never }) },
      mem(), [row(ID)], [rec(ID)], []);
    expect(mail[0]!.verdict).toEqual({ act: 'hold', reason: 'mail' });
  });
});

describe('hibernateShadowPass: the viewer is Presence.isOpen', () => {
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

// The pass above is handed stubs; this one runs the watcher's REAL `sweepHibernateShadow`, so the closures it wires
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
      if (!r.found) throw new Error('fixture record not found');
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
      await h.w.sweepHibernateShadow(t.rows, t.records, [HIBERNATE_LIVE_MARKER]);
      const shadow = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('hibernate-shadow'));
      expect(shadow).toEqual([`ccrc-server: hibernate-shadow ${WID} idle=7h`]);
      expect(h.ccdCalls()).toEqual([]);
      expect(h.calls.some((c) => c.args.includes('hibernate') || c.args.includes('kill-session'))).toBe(false);
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
      await h.w.sweepHibernateShadow(t.rows, t.records, []);
      const n = h.calls.length;
      await h.w.sweepHibernateShadow(t.rows, t.records, []);
      expect(h.calls.length).toBe(n);
    } finally {
      warn.mockRestore();
      h.coord.db.close();
    }
  });

  it('the tick runs the shadow pass, and not on the priming tick', async () => {
    const h = await harness();
    try {
      const spy = vi.spyOn(h.w, 'sweepHibernateShadow').mockResolvedValue(undefined);
      await (h.w as unknown as { tick(): Promise<void> }).tick();
      expect(spy).not.toHaveBeenCalled();
      await (h.w as unknown as { tick(): Promise<void> }).tick();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      h.coord.db.close();
    }
  });
});

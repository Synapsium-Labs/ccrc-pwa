// Landing order wave 4b, Task 2: the radar lane (`FleetWatcher.sweepRadar`), its reader (`coord/lineageRead.ts`:
// `listRadarProjects`, `readRadarProbe`, `readRadarPass`) and the two derivations the lane matches against
// (`sessionBranchOf`, `sessionPrOf`). Real files in a fixture home, through `localIO`; an io double only where a fault
// cannot be made on disk. Review Focus 1 and 4 of the plan, case by case. Neutral names throughout.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { sessionBranchOf, sessionPrOf } from '../src/fleet.js';
import { RADAR_PASS_CONCURRENCY, listRadarProjects, readRadarPass, readRadarProbe, readRegular } from '../src/coord/lineageRead.js';
import { RADAR_PROBE_MAX_BYTES } from '../src/coord/radar.js';
import { readRegistry, type SessionRecord } from '../src/registry.js';
import { localIO, type FleetIO } from '../src/io.js';
import type { PrState } from '../../shared/api.js';
import { seedRoster, testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { openCoordDb } from '../src/coord/db.js';
import { landingStoreOver } from './landingFixture.js';
import type { CoordStore } from '../src/coord/store.js';

const NOW = Date.parse('2026-10-27T09:00:00Z');
const iso = (offsetS: number): string => new Date(NOW + offsetS * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const sha = (n: number): string => n.toString(16).padStart(40, '0');
const ALPHA = 'claude-a-proj-a-alpha';
const BETA = 'claude-a-proj-a-beta';
const GAMMA = 'claude-a-proj-a-gamma';

/** Wave 3b's worked example, with a third bound head (15) the radar did not pair: 12 and 14 conflict on src/x.ts, 13 is
 *  a fleet-less feature head. */
const worked = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, project: 'proj-a', at: iso(0), state: 'measured',
  base: { ref: 'main', sha: sha(9) },
  heads: [
    { pr: 12, head: sha(12), branch: 'ws/alpha', id: ALPHA, base: { state: 'clean' } },
    { pr: 13, head: sha(13), branch: 'feature/x', id: null, base: { state: 'clean' } },
    { pr: 14, head: sha(14), branch: 'ws/beta', id: BETA, base: { state: 'unmeasured', why: 'budget' } },
    { pr: 15, head: sha(15), branch: 'ws/gamma', id: GAMMA, base: { state: 'clean' } },
  ],
  headsCut: false,
  pairs: [{ a: 12, b: 14, state: 'conflict', paths: ['src/x.ts'], pathsCut: false }],
  pairHeads: [14, 12], pairsCut: false,
  ...over,
});

describe('the radar lane', () => {
  let home: string;
  let reg: string;
  let watchers: FleetWatcher[];

  beforeEach(() => {
    home = mkTmp('ccrc-radar-');
    seedRoster(home);
    reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    watchers = [];
  });
  afterEach(() => {
    for (const w of watchers) w.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** A watcher over the fixture home; `io` is the seam a fault is injected through. */
  const make = (io: FleetIO = localIO): FleetWatcher => {
    const deps = { ...testDeps(home), io };
    const w = new FleetWatcher(withFakeClock(deps), new Bus(), 10_000);
    watchers.push(w);
    return w;
  };
  const rows = (io: FleetIO = localIO): Promise<SessionRecord[]> => readRegistry(io, testDeps(home).cfg);

  const plantRow = (id: string, over: Record<string, string> = {}): void => {
    const fields: Record<string, string> = {
      uuid: `u-${id}`, wrapper: 'claude-a', project: 'proj-a', workdir: `/w/${id}`,
      workspace: id.slice('claude-a-proj-a-'.length), branch: `ws/${id.slice('claude-a-proj-a-'.length)}`,
      base: 'origin/main', started: '1', ...over,
    };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
  };
  const probeDir = (project = 'proj-a'): string => path.join(reg, 'landing', project);
  const probePath = (project = 'proj-a'): string => path.join(probeDir(project), 'probe');
  const plantProbe = (doc: unknown, project = 'proj-a'): void => {
    mkdirSync(probeDir(project), { recursive: true });
    writeFileSync(probePath(project), typeof doc === 'string' ? doc : JSON.stringify(doc));
  };
  const plantFleet = (): void => { plantRow(ALPHA); plantRow(BETA); plantRow(GAMMA); };
  const keys = (w: FleetWatcher): string[] => [...w.currentLandings().keys()].sort();
  /** Silences `console.warn` and hands back what was said: every warn call's first argument, and those that name the radar. */
  const warnSpy = (): { lines: () => string[]; said: () => string[] } => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const lines = (): string[] => warn.mock.calls.map((c) => String(c[0]));
    return { lines, said: () => lines().filter((m) => m.includes('landing radar')) };
  };

  /** An io whose answers for the probe files can be bent: `bend` sees the method and the path. */
  const bent = (bend: (method: string, p: string) => unknown | undefined, seen: string[] = []): FleetIO => {
    const wrap = <A extends unknown[], R>(method: string, f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
      seen.push(`${method} ${String(a[0])}`);
      const b = bend(method, String(a[0]));
      return b === undefined ? f(...a) : (b as R);
    };
    return {
      ...localIO,
      readdirMeasured: wrap('readdir', (p: string, t?: number, s?: AbortSignal) => localIO.readdirMeasured(p, t, s)),
      lstatMeasured: wrap('lstat', (p: string) => localIO.lstatMeasured(p)),
      statMeasured: wrap('stat', (p: string) => localIO.statMeasured(p)),
      readFileMeasured: wrap('read', (p: string, t?: number, s?: AbortSignal) => localIO.readFileMeasured(p, t, s)),
      // Wave 5i: the probe's bytes come through byte ranges; a bend on 'read' reaches them too.
      readFileFromBytesMeasured: wrap('read', (p: string, o: number, m: number, t?: number, s?: AbortSignal) => localIO.readFileFromBytesMeasured(p, o, m, t, s)),
    };
  };

  describe('a good doc', () => {
    it('gives each bound session its own landing, a pair on both PRs and on no third', async () => {
      plantFleet(); plantProbe(worked());
      const w = make();
      await w.sweepRadar(await rows(), NOW);
      expect(keys(w)).toEqual([ALPHA, BETA, GAMMA]);
      expect(w.currentLandings().get(ALPHA)).toEqual({
        at: iso(0), pr: 12, head: sha(12), baseRef: 'main', base: { state: 'clean' }, paired: true,
        conflicts: [{ pr: 14, paths: ['src/x.ts'], pathsCut: false }], unmeasuredWith: [],
        cut: { heads: false, pairs: false, unbound: false },
      });
      expect(w.currentLandings().get(BETA)).toMatchObject({
        pr: 14, base: { state: 'unmeasured' }, paired: true, conflicts: [{ pr: 12, paths: ['src/x.ts'], pathsCut: false }],
      });
      // Head 15 is outside `pairHeads`: it is not paired, and the conflict between 12 and 14 is not its own.
      expect(w.currentLandings().get(GAMMA)).toMatchObject({ pr: 15, paired: false, conflicts: [], unmeasuredWith: [] });
    });

    it('a session with an open PR of the head\'s number matches, and a merged PR keeping that number does not', async () => {
      plantRow(ALPHA, { prphase: 'open', prnumber: '12' });
      plantProbe(worked());
      const w = make();
      await w.sweepRadar(await rows(), NOW);
      expect(keys(w)).toEqual([ALPHA]);
      plantRow(ALPHA, { prphase: 'merged', prnumber: '12' });
      await w.sweepRadar(await rows(), NOW);
      expect(keys(w), 'a merged PR keeps its number and must match nothing').toEqual([]);
    });

    // D-7515: the radar lists drafts as open PRs, and the server's sweep calls the same PR `draft`.
    it('a session with a DRAFT PR of the head\'s number matches; a closed one does not', async () => {
      plantRow(ALPHA, { prphase: 'draft', prnumber: '12' });
      plantProbe(worked());
      const w = make();
      await w.sweepRadar(await rows(), NOW);
      expect(keys(w), 'a draft is an open PR to the radar').toEqual([ALPHA]);
      plantRow(ALPHA, { prphase: 'closed', prnumber: '12' });
      await w.sweepRadar(await rows(), NOW);
      expect(keys(w)).toEqual([]);
    });
  });

  describe('every condition in which the radar does not speak for a session gives no landing (Review Focus 1)', () => {
    const NOTHING = (w: FleetWatcher): void => expect(keys(w)).toEqual([]);
    const withHead = (i: number, over: Record<string, unknown>): Record<string, unknown> => {
      const heads = (worked().heads as Record<string, unknown>[]).map((h, k) => (k === i ? { ...h, ...over } : h));
      return worked({ heads });
    };
    const docs: [string, () => unknown, Record<string, string>?][] = [
      ['bad JSON', () => '{"v":1,'],
      ['a v other than 1', () => worked({ v: 2 })],
      ['a foreign project', () => worked({ project: 'proj-b' })],
      ['an at older than 1200 s', () => worked({ at: iso(-1201) })],
      ['an at more than 60 s ahead', () => worked({ at: iso(61) })],
      ['an unmeasured doc', () => worked({ state: 'unmeasured', why: 'fetch-failed', base: null, heads: [], pairs: [], pairHeads: [] })],
      ['a grammar fault (a short head sha)', () => withHead(0, { head: 'abc' })],
      ['a head whose id is null', () => withHead(0, { id: null })],
      ['a head whose id names another session', () => withHead(0, { id: 'claude-a-proj-a-other' })],
      ['a head on another branch than the session\'s', () => withHead(0, { branch: 'ws/other' })],
      ['a session whose open PR has another number', () => worked(), { prphase: 'open', prnumber: '99' }],
    ];
    it.each(docs)('%s', async (_name, doc, rowOver) => {
      plantRow(ALPHA, rowOver);
      plantProbe(doc());
      const w = make();
      await w.sweepRadar(await rows(), NOW);
      NOTHING(w);
      // CONTROL: the same fixture with the doc mended does give a landing, so the empty answer above was the doc's.
      plantProbe(worked());
      if (rowOver === undefined) {
        await w.sweepRadar(await rows(), NOW);
        expect(keys(w)).toEqual([ALPHA]);
      }
    });

    it('no landing directory at all', async () => {
      plantRow(ALPHA);
      const w = make();
      await w.sweepRadar(await rows(), NOW);
      NOTHING(w);
    });

    it('a project directory with no probe', async () => {
      plantRow(ALPHA);
      mkdirSync(probeDir(), { recursive: true });
      const w = make();
      await w.sweepRadar(await rows(), NOW);
      NOTHING(w);
    });

    it('a probe that is a symlink to a good doc is never read', async () => {
      plantRow(ALPHA);
      mkdirSync(probeDir(), { recursive: true });
      writeFileSync(path.join(reg, 'elsewhere.json'), JSON.stringify(worked()));
      symlinkSync(path.join(reg, 'elsewhere.json'), probePath());
      const w = make();
      await w.sweepRadar(await rows(), NOW);
      NOTHING(w);
    });

    it('a probe that is a FIFO is never read (and the pass does not hang on it)', async () => {
      plantRow(ALPHA);
      mkdirSync(probeDir(), { recursive: true });
      execFileSync('mkfifo', [probePath()]);
      const w = make();
      await w.sweepRadar(await rows(), NOW);
      NOTHING(w);
    });

    it('a probe over 512 KiB, measured by a real stat', async () => {
      plantRow(ALPHA);
      const body = JSON.stringify(worked());
      plantProbe(body + ' '.repeat(RADAR_PROBE_MAX_BYTES + 1 - Buffer.byteLength(body, 'utf8')));
      const w = make();
      await w.sweepRadar(await rows(), NOW);
      NOTHING(w);
    });

    it('a stat size over the cap makes no read at all', async () => {
      plantRow(ALPHA); plantProbe(worked());
      const seen: string[] = [];
      const io = bent((m, p) => (m === 'stat' && p.endsWith('/probe') ? { ok: true, mtimeMs: 0, size: RADAR_PROBE_MAX_BYTES + 1 } : undefined), seen);
      const w = make(io);
      await w.sweepRadar(await rows(io), NOW);
      NOTHING(w);
      expect(seen.filter((s) => s.startsWith('stat ') && s.endsWith('/probe')), 'the size was measured').toHaveLength(1);
      expect(seen.filter((s) => s.startsWith('read ') && s.endsWith('/probe')), 'the oversized probe was read').toEqual([]);
    });

    const faults: [string, string, unknown][] = [
      ['an lstat that cannot answer', 'lstat', { ok: false, reason: 'unreadable' }],
      ['an io that cannot lstat at all', 'lstat', { ok: false, reason: 'unmeasured' }],
      ['an lstat that proves absence', 'lstat', { ok: false, reason: 'absent' }],
      ['a stat that cannot answer', 'stat', { ok: false, reason: 'unreadable' }],
      ['a stat that proves absence (a race)', 'stat', { ok: false, reason: 'absent' }],
      ['a read that cannot answer', 'read', { ok: false, reason: 'unreadable' }],
      ['a read that proves absence (a race)', 'read', { ok: false, reason: 'absent' }],
    ];
    it.each(faults)('%s', async (_name, method, answer) => {
      plantRow(ALPHA); plantProbe(worked());
      const io = bent((m, p) => (m === method && p.endsWith('/probe') ? answer : undefined));
      const w = make(io);
      await w.sweepRadar(await rows(io), NOW);
      NOTHING(w);
    });

    it('a listing that cannot be read, and one that proves absence', async () => {
      plantRow(ALPHA); plantProbe(worked());
      for (const reason of ['unreadable', 'absent']) {
        const io = bent((m, p) => (m === 'readdir' && p.endsWith('/landing') ? { ok: false, reason } : undefined));
        const w = make(io);
        await w.sweepRadar(await rows(io), NOW);
        NOTHING(w);
      }
    });
  });

  describe('the reader keeps its answers apart', () => {
    it('a proven absence, every other fault, and the parser\'s own stale and unmeasured stay four answers', async () => {
      plantRow(ALPHA);
      expect(await readRadarProbe(localIO, reg, 'proj-a', NOW)).toEqual({ ok: false, reason: 'absent' });
      plantProbe('{');
      expect(await readRadarProbe(localIO, reg, 'proj-a', NOW)).toEqual({ ok: false, reason: 'unreadable' });
      plantProbe(worked({ at: iso(-1201) }));
      expect(await readRadarProbe(localIO, reg, 'proj-a', NOW)).toEqual({ ok: false, reason: 'stale' });
      plantProbe(worked({ state: 'unmeasured', why: 'rc-2', base: null, heads: [], pairs: [], pairHeads: [] }));
      expect(await readRadarProbe(localIO, reg, 'proj-a', NOW)).toEqual({ ok: false, reason: 'unmeasured' });
      plantProbe(worked());
      const ok = await readRadarProbe(localIO, reg, 'proj-a', NOW);
      expect(ok.ok).toBe(true);
    });

    // G9 (review 1225, F4), re-pointed at wave 5i's byte ranges: the cap is checked on the stat BEFORE any byte moves, and a
    // range that hands back more than it was asked is refused, whatever the stat said.
    it('readRegular asks for no more than the stat promised, and refuses a range that overruns it', async () => {
      const cap = 16;
      const io = {
        lstatMeasured: async () => ({ ok: true as const, kind: 'regular' as const }),
        statMeasured: async () => ({ ok: true as const, mtimeMs: 0, size: cap }),
        readFileFromBytesMeasured: async (_p: string, _o: number, m: number) => ({ ok: true as const, bytes: new Uint8Array(m + 1), size: cap }),
      };
      expect(await readRegular(io, '/f', undefined, cap)).toEqual({ ok: false, reason: 'unreadable' });
      const within = { ...io, readFileFromBytesMeasured: async (_p: string, _o: number, m: number) => ({ ok: true as const, bytes: new Uint8Array(m).fill(120), size: cap }) };
      expect(await readRegular(within, '/f', undefined, cap), 'a file at the cap reads').toEqual({ ok: true, content: 'x'.repeat(cap) });
    });

    it("the listing leaves out the lister's .lp.* temporaries, keeps an unsafe name apart, and says absent for no directory", async () => {
      expect(await listRadarProjects(localIO, reg)).toEqual({ ok: false, reason: 'absent' });
      mkdirSync(path.join(reg, 'landing', 'proj-a'), { recursive: true });
      mkdirSync(path.join(reg, 'landing', 'bad name'), { recursive: true });
      mkdirSync(path.join(reg, 'landing', '.lp.123'), { recursive: true });
      const r = await listRadarProjects(localIO, reg);
      expect(r.ok && { names: r.names, refused: [...r.refused].sort() }).toEqual({ names: ['proj-a'], refused: ['bad name'] });
    });
  });

  describe('a kept map ages (Review Focus 1, 4)', () => {
    it('a good pass followed 1201 s later by an unreadable listing gives no landing, and 1200 s later still keeps it', async () => {
      plantFleet(); plantProbe(worked());
      let blind = false;
      const io = bent((m, p) => (blind && m === 'readdir' && p.endsWith('/landing') ? { ok: false, reason: 'unreadable' } : undefined));
      const w = make(io);
      const recs = await rows(io);
      await w.sweepRadar(recs, NOW);
      expect(keys(w)).toEqual([ALPHA, BETA, GAMMA]);
      blind = true;
      await w.sweepRadar(recs, NOW + 1200_000);
      expect(keys(w), 'the map is kept, aged, while the doc is inside its window').toEqual([ALPHA, BETA, GAMMA]);
      await w.sweepRadar(recs, NOW + 1201_000);
      expect(keys(w)).toEqual([]);
    });

    it('a good pass followed 1201 s later by an unlisted registry gives no landing', async () => {
      plantFleet(); plantProbe(worked());
      const w = make();
      const recs = await rows();
      await w.sweepRadar(recs, NOW);
      await w.sweepRadar(null, NOW + 600_000);
      expect(keys(w)).toEqual([ALPHA, BETA, GAMMA]);
      await w.sweepRadar(null, NOW + 1201_000);
      expect(keys(w)).toEqual([]);
    });

    // G6 (review 1225, F4). The cases above hand `sweepRadar(null, …)` in directly, which is why a `[]` for the null in the
    // tick's hand-off survived: an empty record list is a LISTED registry with no sessions, and rebuilds the map empty.
    // This one drives `tick()`, twice, a lane beat (60 s) apart, the registry unlistable through its `readdir` alone.
    // It pins the null hand-off and the kept map. Its second tick runs at +61 s, inside the doc's window, so the re-ageing
    // is pinned by the direct `sweepRadar(null, …)` cases above (review 1226, F2).
    it('tick() hands an unlistable registry to the lane as null, and the lane keeps the map it holds (G6)', async () => {
      plantFleet(); plantProbe(worked());
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
      let blind = false;
      const io: FleetIO = { ...localIO, readdir: async (p, t, sg) => (blind && p === reg ? null : localIO.readdir(p, t, sg)) };
      const w = make(io);
      const passes: Array<Promise<void>> = [];
      const real = w.sweepRadar.bind(w);
      const sweep = vi.spyOn(w, 'sweepRadar');
      sweep.mockImplementation((...a) => { const p = real(...a); passes.push(p); return p; });
      await w.tick();
      await vi.waitFor(() => expect(passes).toHaveLength(1));
      await Promise.all(passes);
      expect(keys(w)).toEqual([ALPHA, BETA, GAMMA]);

      blind = true;
      vi.setSystemTime(NOW + 61_000);                       // past the lane's 60 s throttle, inside the doc's window
      await w.tick();
      await vi.waitFor(() => expect(passes).toHaveLength(2));
      await Promise.all(passes);
      expect(sweep.mock.calls[1]?.[0], 'an unlistable registry is null, not an empty list').toBeNull();
      expect(keys(w), 'the lane emptied the map for a registry it could not list').toEqual([ALPHA, BETA, GAMMA]);
    });

    it('a landing directory that disappears empties the map at once (no radar)', async () => {
      plantFleet(); plantProbe(worked());
      let gone = false;
      const io = bent((m, p) => (gone && m === 'readdir' && p.endsWith('/landing') ? { ok: false, reason: 'absent' } : undefined));
      const w = make(io);
      const recs = await rows(io);
      await w.sweepRadar(recs, NOW);
      gone = true;
      await w.sweepRadar(recs, NOW + 1000);
      expect(keys(w)).toEqual([]);
    });

    it('a doc that has since aged out of its window gives no landing even when the file reads', async () => {
      plantFleet(); plantProbe(worked());
      const w = make();
      const recs = await rows();
      await w.sweepRadar(recs, NOW);
      await w.sweepRadar(recs, NOW + 1201_000);   // the same file, now stale: the parser refuses it
      expect(keys(w)).toEqual([]);
    });
  });

  describe('the lane costs little and fails alone (Review Focus 4)', () => {
    it('one listing, then one lstat, two stats (before and after the ranges, wave 5i) and one read per project a session names', async () => {
      plantRow(ALPHA); plantRow('claude-a-proj-b-alpha', { project: 'proj-b' });
      plantProbe(worked()); plantProbe(worked({ project: 'proj-b', heads: [], pairs: [], pairHeads: [] }), 'proj-b');
      mkdirSync(probeDir('proj-c'), { recursive: true });   // a project no session names: never read
      const seen: string[] = [];
      const io = bent(() => undefined, seen);
      const w = make(io);
      await w.sweepRadar(await rows(io), NOW);
      const landing = seen.filter((s) => s.includes(`${path.sep}landing`));
      expect(landing.filter((s) => s.startsWith('readdir '))).toHaveLength(1);
      for (const project of ['proj-a', 'proj-b']) {
        const mine = landing.filter((s) => s.endsWith(`${path.sep}${project}${path.sep}probe`));
        expect(mine.map((s) => s.split(' ')[0]).sort(), project).toEqual(['lstat', 'read', 'stat', 'stat']);
      }
      expect(landing.filter((s) => s.includes('proj-c'))).toEqual([]);
    });

    it('a failed read of one project costs only that project\'s sessions', async () => {
      const BOB = 'claude-a-proj-b-alpha';
      plantRow(ALPHA); plantRow(BOB, { project: 'proj-b', branch: 'ws/bob' });
      const docB = (): Record<string, unknown> => worked({
        project: 'proj-b', heads: [{ pr: 21, head: sha(21), branch: 'ws/bob', id: BOB, base: { state: 'clean' } }], pairs: [], pairHeads: [21],
      });
      plantProbe(worked()); plantProbe(docB(), 'proj-b');
      let bad = false;
      const io = bent((m, p) => (bad && m === 'read' && p.includes(`${path.sep}proj-a${path.sep}`) ? { ok: false, reason: 'unreadable' } : undefined));
      const w = make(io);
      const recs = await rows(io);
      await w.sweepRadar(recs, NOW);
      expect(keys(w)).toEqual([ALPHA, BOB]);
      bad = true;
      await w.sweepRadar(recs, NOW + 1000);
      expect(keys(w), 'proj-a\'s failure cleared proj-b too, or proj-a kept its old entry').toEqual([BOB]);
    });

    it('a pass whose one project misses the deadline contributes nothing for it, and keeps the others', async () => {
      const BOB = 'claude-a-proj-b-alpha';
      plantRow(ALPHA); plantRow(BOB, { project: 'proj-b', branch: 'ws/bob' });
      plantProbe(worked());
      plantProbe(worked({
        project: 'proj-b', heads: [{ pr: 21, head: sha(21), branch: 'ws/bob', id: BOB, base: { state: 'clean' } }], pairs: [], pairHeads: [21],
      }), 'proj-b');
      let hang = false;
      let bobRead: () => void = () => undefined;
      const bobDone = new Promise<void>((r) => { bobRead = r; });
      const io: FleetIO = {
        ...localIO,
        statMeasured: (p) => (hang && p.includes(`${path.sep}proj-a${path.sep}`) ? new Promise<never>(() => undefined) : localIO.statMeasured(p)),
        readFileFromBytesMeasured: async (p, o, m, t, s) => {
          const r = await localIO.readFileFromBytesMeasured(p, o, m, t, s);
          if (hang && p.includes(`${path.sep}proj-b${path.sep}`)) bobRead();
          return r;
        },
      };
      const w = make(io);
      const recs = await rows(io);
      await w.sweepRadar(recs, NOW);
      expect(keys(w)).toEqual([ALPHA, BOB]);

      hang = true;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const pass = w.sweepRadar(recs, NOW + 1000);
      await bobDone;                                              // proj-b answered, on the real event loop
      await new Promise<void>((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(30_000);                  // half the lane's 60 s cadence
      await pass;
      expect(keys(w), 'the deadline kept the old map, or took proj-b with it').toEqual([BOB]);
    });

    it('readRadarPass answers late for a project that has not answered, and aborts its read', async () => {
      plantRow(ALPHA); plantProbe(worked());
      let signal: AbortSignal | undefined;
      const io: FleetIO = {
        ...localIO,
        readFileFromBytesMeasured: (_p, _o, _m, _t, s) => { signal = s; return new Promise<never>(() => undefined); },
      };
      const r = await readRadarPass(io, reg, new Set(['proj-a']), NOW, 20);
      expect(r).toEqual({ ok: true, reads: new Map([['proj-a', { ok: false, reason: 'late' }]]), controls: new Map() });
      expect(signal?.aborted).toBe(true);
    });

    it('a thrown listing is said once through the lane, never by the runner, and never stops the tick (4b F9 (5))', async () => {
      plantRow(ALPHA);
      const { lines, said } = warnSpy();
      let landingReaddirs = 0;
      const io: FleetIO = {
        ...localIO,
        readdirMeasured: (p, t, s) => {
          if (!p.endsWith(`${path.sep}landing`)) return localIO.readdirMeasured(p, t, s);
          landingReaddirs += 1;
          return Promise.reject(new Error('boom'));
        },
      };
      const w = make(io);
      const recs = await rows(io);
      await expect(w.sweepRadar(recs, NOW)).resolves.toBeUndefined();
      await expect(w.sweepRadar(recs, NOW + 1000)).resolves.toBeUndefined();
      await expect(w.tick()).resolves.toBeUndefined();
      await vi.waitFor(() => expect(landingReaddirs).toBeGreaterThanOrEqual(3), { timeout: 5000 });
      await new Promise<void>((r) => setImmediate(r));
      expect(said()).toEqual(["ccrc-server: the landing radar's listing is unreadable"]);
      expect(lines().join('\n')).not.toContain('the landing radar lane failed');
    });

    it('a fault the pass does not catch is still said by the runner: the landingRadar row\'s warnKey is the backstop (4b F9 (5))', async () => {
      plantRow(ALPHA);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const w = make();
      vi.spyOn(w, 'sweepRadar').mockRejectedValue(new Error('boom'));
      await expect(w.tick()).resolves.toBeUndefined();
      await vi.waitFor(() => expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('the landing radar lane failed'), { timeout: 5000 });
    });
  });

  describe('a head is bound only by a positive match on the CURRENT branch (D-7479, D-7484)', () => {
    it('a row with an unreadable .branch whose worktree HEAD is on a null-id head\'s branch sets unbound', async () => {
      plantRow(ALPHA); plantRow(BETA);
      const io = bent((m, p) => (m === 'read' && p.endsWith(`${BETA}.branch`) ? { ok: false, reason: 'unreadable' } : undefined));
      const doc = worked({
        heads: [
          { pr: 12, head: sha(12), branch: 'ws/alpha', id: ALPHA, base: { state: 'clean' } },
          { pr: 13, head: sha(13), branch: 'ws/beta-head', id: null, base: { state: 'clean' } },
        ],
        pairs: [], pairHeads: [12],
      });
      plantProbe(doc);
      const w = make(io);
      const recs = await rows(io);
      await w.sweepRadar(recs, NOW);
      expect(w.currentLandings().get(ALPHA)?.cut.unbound, 'no row is on ws/beta-head yet').toBe(false);

      // The divergence sweep measured the worktree's own HEAD: the row's branch is now known to be ws/beta-head.
      (w as unknown as { headBranches: Map<string, { project: string; branch: string | null }> })
        .headBranches.set(BETA, { project: 'proj-a', branch: 'ws/beta-head' });
      await w.sweepRadar(recs, NOW);
      expect(w.currentLandings().get(ALPHA)?.cut.unbound, 'the held row\'s HEAD branch was not read').toBe(true);
    });

    it('a row whose .project will not read puts its branch into every project: a null-id head there sets unbound (4b F5)', async () => {
      const BOB = 'claude-a-proj-b-alpha';
      plantRow(ALPHA); plantRow(BETA); plantRow(BOB, { project: 'proj-b', branch: 'ws/bob' });
      plantProbe(worked({
        heads: [
          { pr: 12, head: sha(12), branch: 'ws/alpha', id: ALPHA, base: { state: 'clean' } },
          { pr: 13, head: sha(13), branch: 'ws/beta', id: null, base: { state: 'clean' } },
        ],
        pairs: [], pairHeads: [12],
      }));
      plantProbe(worked({
        project: 'proj-b',
        heads: [
          { pr: 21, head: sha(21), branch: 'ws/bob', id: BOB, base: { state: 'clean' } },
          { pr: 22, head: sha(22), branch: 'ws/beta', id: null, base: { state: 'clean' } },
        ],
        pairs: [], pairHeads: [21],
      }), 'proj-b');
      const unread = (p: string): boolean => p.endsWith(`${BETA}.project`);
      const io: FleetIO = { ...bent((m, p) => (m === 'read' && unread(p) ? { ok: false, reason: 'unreadable' } : undefined)),
        readFile: (p) => (unread(p) ? Promise.resolve(null) : localIO.readFile(p)) };
      const w = make(io);
      await w.sweepRadar(await rows(io), NOW);
      expect(keys(w)).toEqual([ALPHA, BOB]);
      expect(w.currentLandings().get(ALPHA)?.cut.unbound, 'proj-a').toBe(true);
      expect(w.currentLandings().get(BOB)?.cut.unbound, 'proj-b, a project the held row may belong to').toBe(true);
      // CONTROL: with BETA's .project readable (localIO), BETA is proj-a's alone.
      const w2 = make();
      await w2.sweepRadar(await rows(), NOW);
      expect(w2.currentLandings().get(BOB)?.cut.unbound, "a readable .project is its own project's only").toBe(false);
    });

    it('a statusline branch wins over the registry\'s .branch: a session that moved branches matches the new head', async () => {
      plantRow(ALPHA);                        // the registry still says ws/alpha
      plantProbe(worked({ heads: [{ pr: 12, head: sha(12), branch: 'ws/moved', id: ALPHA, base: { state: 'clean' } }], pairs: [], pairHeads: [12] }));
      const w = make();
      const recs = await rows();
      await w.sweepRadar(recs, NOW);
      expect(keys(w), 'the registry branch alone must not match a head on another branch').toEqual([]);
      (w as unknown as { statuslines: Map<string, unknown> }).statuslines.set(ALPHA, { branch: 'ws/moved', retained: false });
      await w.sweepRadar(recs, NOW);
      expect(keys(w)).toEqual([ALPHA]);
    });
  });

  describe("wave 5a: the pass's hardening (4b F9)", () => {
    it('a project name that is not a safe segment is never read, and is said once on one line (4b F9 (1), (2))', async () => {
      const bad = 'proj\nccrc-server: forged';
      plantRow(ALPHA, { project: bad }); plantProbe(worked({ project: bad }), bad);
      const { said } = warnSpy();
      const seen: string[] = [];
      const io = bent(() => undefined, seen);
      const w = make(io);
      const recs = await rows(io);
      await w.sweepRadar(recs, NOW);
      await w.sweepRadar(recs, NOW + 1000);
      expect(seen.filter((s) => s.includes('forged') && !s.startsWith('readdir ')), 'a path was joined on an unsafe name').toEqual([]);
      expect(keys(w)).toEqual([]);
      expect(said()).toEqual(["ccrc-server: the landing radar's probe of proj ccrc-server: forged is refused"]);
    });

    it('an unsafe directory no session names is skipped without a word (4b F9 (1))', async () => {
      plantRow(ALPHA); plantProbe(worked());
      mkdirSync(path.join(reg, 'landing', 'bad name'), { recursive: true });
      const r = await readRadarPass(localIO, reg, new Set(['proj-a']), NOW, 5000);
      expect(r.ok && [...r.reads.keys()]).toEqual(['proj-a']);
    });

    it('a pass has at most RADAR_PASS_CONCURRENCY (8) probe reads in flight (4b F9 (3))', async () => {
      const projects = Array.from({ length: 20 }, (_, i) => `proj-${String(i).padStart(2, '0')}`);
      for (const p of projects) plantProbe(worked({ project: p, heads: [], pairs: [], pairHeads: [] }), p);
      const held: Array<() => void> = [];
      let issued = 0;
      const io: FleetIO = {
        ...localIO,
        lstatMeasured: (p) => {
          if (!p.endsWith(`${path.sep}probe`)) return localIO.lstatMeasured(p);
          issued += 1;
          return new Promise<Awaited<ReturnType<FleetIO['lstatMeasured']>>>((resolve) => {
            held.push(() => { void localIO.lstatMeasured(p).then(resolve); });
          });
        },
      };
      const pass = readRadarPass(io, reg, new Set(projects), NOW, 60_000);
      expect(RADAR_PASS_CONCURRENCY).toBe(8);
      await vi.waitFor(() => expect(issued).toBe(8), { timeout: 5000 });
      await new Promise<void>((r) => setImmediate(r));
      expect(issued, 'more than the bound went out at once').toBe(8);
      held.shift()!();
      await vi.waitFor(() => expect(issued).toBe(9), { timeout: 5000 });
      // release the rest, round by round
      let done = false;
      void pass.then(() => { done = true; });
      for (let guard = 0; guard < 400 && !done; guard++) {
        held.shift()?.();
        await new Promise<void>((r) => setTimeout(r, 5));
      }
      const r = await pass;
      expect(r.ok && r.reads.size).toBe(20);
      expect(r.ok && [...r.reads.values()].every((x) => x.ok)).toBe(true);
    });

    it('a hung read frees its slot at the deadline, and a name whose turn comes after it answers late with no io (4b F9 (3), (4))', async () => {
      const projects = Array.from({ length: 10 }, (_, i) => `proj-${String(i).padStart(2, '0')}`);
      for (const p of projects) plantProbe(worked({ project: p, heads: [], pairs: [], pairHeads: [] }), p);
      const lstats: string[] = [];
      const io: FleetIO = { ...localIO, lstatMeasured: (p) => { if (p.endsWith(`${path.sep}probe`)) lstats.push(p); return new Promise<never>(() => undefined); } };
      const r = await readRadarPass(io, reg, new Set(projects), NOW, 50);
      expect(r.ok && r.reads.size).toBe(10);
      expect(r.ok && [...r.reads.values()].every((x) => !x.ok && x.reason === 'late')).toBe(true);
      expect(lstats, 'a read was issued after the deadline').toHaveLength(8);
    });

    it('a listing that hangs settles as late at the deadline, and the kept map is re-aged (4b F9 (4))', async () => {
      plantFleet(); plantProbe(worked());
      const { said } = warnSpy();
      let hang = false;
      const io: FleetIO = {
        ...localIO,
        readdirMeasured: (p, t, s) => (hang && p.endsWith(`${path.sep}landing`) ? new Promise<never>(() => undefined) : localIO.readdirMeasured(p, t, s)),
      };
      const w = make(io);
      const recs = await rows(io);
      await w.sweepRadar(recs, NOW);
      expect(keys(w)).toEqual([ALPHA, BETA, GAMMA]);

      hang = true;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let settled = false;
      void w.sweepRadar(recs, NOW + 1000).then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(settled, 'the pass settled before its deadline').toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await new Promise<void>((r) => setImmediate(r));
      expect(settled, 'a hung listing held the pass past its deadline').toBe(true);
      expect(keys(w), 'a late listing re-ages the kept map').toEqual([ALPHA, BETA, GAMMA]);
      expect(said()).toEqual(["ccrc-server: the landing radar's listing is late"]);
    });

    it('readRadarPass answers late for a listing that has not answered, and aborts it', async () => {
      plantRow(ALPHA); plantProbe(worked());
      let signal: AbortSignal | undefined;
      const io: FleetIO = {
        ...localIO,
        readdirMeasured: (_p, _t, s) => { signal = s; return new Promise<never>(() => undefined); },
      };
      expect(await readRadarPass(io, reg, new Set(['proj-a']), NOW, 20)).toEqual({ ok: false, reason: 'late' });
      expect(signal?.aborted).toBe(true);
    });

    it('an abandoned pass released after a newer one started never overwrites its map (4b F9 (4))', async () => {
      plantFleet(); plantProbe(worked());
      let holdNext = false;
      const parked: Array<() => void> = [];
      const io: FleetIO = {
        ...localIO,
        readdirMeasured: (p, t, s) => {
          if (!(holdNext && p.endsWith(`${path.sep}landing`))) return localIO.readdirMeasured(p, t, s);
          holdNext = false;
          return new Promise<Awaited<ReturnType<FleetIO['readdirMeasured']>>>((resolve) => {
            parked.push(() => { void localIO.readdirMeasured(p, t, s).then(resolve); });
          });
        },
      };
      /** Starts a pass whose landing listing is parked until `parked.shift()` releases it. */
      const hold = async (w: FleetWatcher, recs: SessionRecord[], nowMs: number): Promise<{ pass: Promise<void> }> => {
        const before = parked.length;
        holdNext = true;
        const pass = w.sweepRadar(recs, nowMs);
        await vi.waitFor(() => expect(parked.length).toBe(before + 1), { timeout: 5000 });
        return { pass };
      };
      const w = make(io);
      const recs = await rows(io);

      const { pass: a } = await hold(w, recs, NOW);
      await w.sweepRadar(recs, NOW + 1000);
      expect(keys(w)).toEqual([ALPHA, BETA, GAMMA]);
      plantProbe(worked({ heads: [], pairs: [], pairHeads: [] }));
      parked.shift()!();
      await a;
      expect(keys(w), 'the older pass overwrote the newer map').toEqual([ALPHA, BETA, GAMMA]);

      plantProbe(worked());
      const { pass: c } = await hold(w, recs, NOW + 2000);
      plantProbe(worked({ heads: [], pairs: [], pairHeads: [] }));
      await w.sweepRadar(null, NOW + 3000);
      parked.shift()!();
      await c;
      expect(keys(w), 'a re-age-only pass did not count as newer').toEqual([ALPHA, BETA, GAMMA]);
    });
  });

  describe('a warning is said once per change, and never carries the doc\'s own words', () => {
    it('says it once for a standing fault, again after the fault clears and returns, and never the why', async () => {
      plantRow(ALPHA);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const w = make();
      const recs = await rows();
      const said = (): string[] => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('landing radar'));
      plantProbe(worked({ state: 'unmeasured', why: 'secret-why-text', base: null, heads: [], pairs: [], pairHeads: [] }));
      await w.sweepRadar(recs, NOW);
      await w.sweepRadar(recs, NOW + 1000);
      expect(said()).toHaveLength(1);
      expect(said()[0]).toContain('proj-a');
      expect(said()[0]).not.toContain('secret-why-text');
      plantProbe(worked());
      await w.sweepRadar(recs, NOW + 2000);
      expect(said()).toHaveLength(1);
      plantProbe('{');
      await w.sweepRadar(recs, NOW + 3000);
      expect(said()).toHaveLength(2);
    });

    it('a project with no probe yet is not a fault', async () => {
      plantRow(ALPHA); mkdirSync(probeDir(), { recursive: true });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const w = make();
      await w.sweepRadar(await rows(), NOW);
      expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('landing radar'))).toEqual([]);
    });
  });
});

describe('wave 5i: the control bundle through the pass', () => {
  let home: string;
  let reg: string;
  beforeEach(() => { home = mkTmp('ccrc-radar-ctl-'); reg = path.join(home, '.cc-sessions'); mkdirSync(reg, { recursive: true }); });
  afterEach(() => { vi.useRealTimers(); });

  const dirOf = (project: string): string => path.join(reg, 'landing', project);
  const plantAll = (project: string, probeBody?: string): void => {
    mkdirSync(dirOf(project), { recursive: true });
    writeFileSync(path.join(dirOf(project), 'probe'), probeBody ?? JSON.stringify(worked({ project, heads: [], pairs: [], pairHeads: [] })));
    writeFileSync(path.join(dirOf(project), 'lander'), JSON.stringify({ v: 1, project, lander: 'coordinator', at: iso(-2) }));
    writeFileSync(path.join(dirOf(project), 'main-health'), JSON.stringify({
      v: 1, project, at: iso(0), sha: sha(9), state: 'green', required: [{ name: 'required-a', app: null }], failing: [], pending: [],
    }));
  };
  const spied = (seen: string[], over: Partial<FleetIO> = {}): FleetIO => ({
    ...localIO,
    lstatMeasured: (p) => { seen.push(`lstat ${p}`); return localIO.lstatMeasured(p); },
    statMeasured: (p) => { seen.push(`stat ${p}`); return localIO.statMeasured(p); },
    readFileFromBytesMeasured: (p, o, m, t, s) => { seen.push(`range ${m} ${p}`); return localIO.readFileFromBytesMeasured(p, o, m, t, s); },
    ...over,
  });

  it('no controlsWanted: the existing reads only, an empty controls map', async () => {
    plantAll('proj-a');
    const r = await readRadarPass(localIO, reg, new Set(['proj-a']), NOW, 5000);
    expect(r.ok && r.controls.size).toBe(0);
    expect(r.ok && r.reads.get('proj-a')?.ok).toBe(true);
  });

  it('each wanted project gets one bundle, and its probe is read once', async () => {
    plantAll('proj-a'); plantAll('proj-b');
    const seen: string[] = [];
    const r = await readRadarPass(spied(seen), reg, new Set(['proj-a']), NOW, 5000, new Set(['proj-a', 'proj-b']));
    if (!r.ok) throw new Error('pass');
    expect([...r.reads.keys()]).toEqual(['proj-a']);
    expect([...r.controls.keys()].sort()).toEqual(['proj-a', 'proj-b']);
    const c = r.controls.get('proj-a')!;
    expect(c.lander.ok && c.health.ok && c.probe.ok).toBe(true);
    expect(c.probe).toBe(r.reads.get('proj-a'));
    for (const project of ['proj-a', 'proj-b']) {
      expect(seen.filter((x) => x.startsWith('range ') && x.endsWith(`${path.sep}${project}${path.sep}probe`)), project).toHaveLength(1);
    }
  });

  it('a wanted project the listing does not return is absent, a refused name is refused, and a failed listing yields none', async () => {
    plantAll('proj-a');
    mkdirSync(path.join(reg, 'landing', 'bad name'), { recursive: true });
    const r = await readRadarPass(localIO, reg, new Set(), NOW, 5000, new Set(['proj-z', 'bad name']));
    if (!r.ok) throw new Error('pass');
    const absent = { ok: false, reason: 'absent' } as const;
    expect(r.controls.get('proj-z')).toEqual({ lander: absent, probe: absent, health: absent });
    const refused = { ok: false, reason: 'refused' } as const;
    expect(r.controls.get('bad name')).toEqual({ lander: refused, probe: refused, health: refused });
    const gone = await readRadarPass(localIO, path.join(home, 'nowhere'), new Set(), NOW, 5000, new Set(['proj-a']));
    expect(gone).toEqual({ ok: false, reason: 'absent' });
  });

  it('a bundle that misses the deadline is late in all three documents', async () => {
    plantAll('proj-a');
    const io: FleetIO = { ...localIO, lstatMeasured: (p) => (p.endsWith(`${path.sep}probe`) ? new Promise<never>(() => undefined) : localIO.lstatMeasured(p)) };
    const r = await readRadarPass(io, reg, new Set(), NOW, 30, new Set(['proj-a']));
    const late = { ok: false, reason: 'late' } as const;
    expect(r.ok && r.controls.get('proj-a')).toEqual({ lander: late, probe: late, health: late });
  });

  it('M10: an oversize file moves no byte, and no range ever exceeds 262144', async () => {
    plantAll('proj-a');
    const seen: string[] = [];
    const over = spied(seen, { statMeasured: (p) => (p.endsWith('main-health') || p.endsWith('/probe') ? Promise.resolve({ ok: true as const, mtimeMs: 0, size: RADAR_PROBE_MAX_BYTES + 1 }) : localIO.statMeasured(p)) });
    const r = await readRadarPass(over, reg, new Set(['proj-a']), NOW, 5000, new Set(['proj-a']));
    if (!r.ok) throw new Error('pass');
    const c = r.controls.get('proj-a')!;
    expect(c.health).toEqual({ ok: false, reason: 'oversize', size: RADAR_PROBE_MAX_BYTES + 1 });
    expect(c.probe).toEqual({ ok: false, reason: 'oversize', size: RADAR_PROBE_MAX_BYTES + 1 });
    expect(seen.filter((x) => x.startsWith('range ') && !x.endsWith('lander')), 'an oversize file was read').toEqual([]);

    const body = JSON.stringify(worked({ project: 'proj-b', heads: [], pairs: [], pairHeads: [] }));
    plantAll('proj-b', body + ' '.repeat(RADAR_PROBE_MAX_BYTES - body.length));
    const seen2: string[] = [];
    const r2 = await readRadarPass(spied(seen2), reg, new Set(['proj-b']), NOW, 5000, new Set(['proj-b']));
    expect(r2.ok && r2.reads.get('proj-b')?.ok).toBe(true);
    const sizes = seen2.filter((x) => x.startsWith('range ')).map((x) => Number(x.split(' ')[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(262144);
    expect(seen2.filter((x) => x.startsWith('range ') && x.endsWith(`${path.sep}proj-b${path.sep}probe`)), 'a 524288-byte probe takes at most two ranges').toHaveLength(2);
  });

  it('M9: a symlinked marker ancestor is absent for the lander, and its target is never byte-read', async () => {
    plantAll('proj-a');
    const target = path.join(home, 'project-target');
    mkdirSync(target, { recursive: true });
    for (const n of ['probe', 'lander', 'main-health']) writeFileSync(path.join(target, n), readFileSync(path.join(dirOf('proj-a'), n)));
    execFileSync('mv', [dirOf('proj-a'), path.join(home, 'aside')]);
    symlinkSync(target, dirOf('proj-a'));
    const seen: string[] = [];
    const r = await readRadarPass(spied(seen), reg, new Set(['proj-a']), NOW, 5000, new Set(['proj-a']));
    if (!r.ok) throw new Error('pass');
    expect(r.controls.get('proj-a')!.lander).toEqual({ ok: false, reason: 'absent' });
    expect(seen.filter((x) => x.startsWith('range ') && x.endsWith(`${path.sep}lander`)), 'target bytes of the marker').toEqual([]);
  });
});

describe('the branch and PR derivations the lane and assembleFleet share (D-7484)', () => {
  const rec = (over: Partial<SessionRecord>): SessionRecord => ({ id: 'claude-a-proj-a-alpha', branch: 'ws/registry', workspace: 'alpha', prPhase: null, prNumber: null, prCheckedAt: null, ...over } as SessionRecord);
  const sl = (over: Record<string, unknown>) => ({ branch: 'ws/pane', retained: false, ...over }) as never;

  it('sessionBranchOf: a fresh pane branch, then the worktree HEAD, then a retained pane branch, then the registry', () => {
    expect(sessionBranchOf(rec({}), sl({}), 'ws/head')).toBe('ws/pane');
    expect(sessionBranchOf(rec({}), sl({ retained: true }), 'ws/head')).toBe('ws/head');
    expect(sessionBranchOf(rec({}), undefined, 'ws/head')).toBe('ws/head');
    expect(sessionBranchOf(rec({}), sl({ retained: true }), null)).toBe('ws/pane');
    expect(sessionBranchOf(rec({}), undefined, null)).toBe('ws/registry');
    expect(sessionBranchOf(rec({ branch: null }), undefined, undefined)).toBeNull();
  });

  it('sessionPrOf: the sweep\'s state wins, else what the registry holds, null for a main checkout', () => {
    const swept = { phase: 'open', number: 7 } as PrState;
    expect(sessionPrOf(rec({}), new Map([['claude-a-proj-a-alpha', swept]]))).toBe(swept);
    expect(sessionPrOf(rec({ prPhase: 'merged', prNumber: 3 }), undefined)).toMatchObject({ phase: 'merged', number: 3 });
    expect(sessionPrOf(rec({ workspace: null }), undefined)).toBeNull();
  });
});

// Landing order wave 5i, Task 6: the radar lane also reads each wanted project's control bundle in its one pass, applies it
// to the store synchronously (behind the generation fence), and keeps only the latest pass's bundle for the route.
function plantRowIn(reg: string, id: string): void {
  const fields: Record<string, string> = {
    uuid: `u-${id}`, wrapper: 'claude-a', project: 'proj-a', workdir: `/w/${id}`, workspace: 'alpha', branch: 'ws/alpha', base: 'origin/main', started: '1' };
  for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
}

describe('the radar lane composes the control bundle and the store apply', () => {
  let home: string;
  let reg: string;
  let watchers: FleetWatcher[];
  let coord: CoordStore;
  let dbHandle: ReturnType<typeof openCoordDb>;

  beforeEach(() => {
    home = mkTmp('ccrc-radar-ctl-');
    seedRoster(home);
    reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    watchers = [];
    const dbPath = path.join(home, '.ccrc', 'coord.db');
    dbHandle = openCoordDb(dbPath);
    coord = landingStoreOver(dbHandle, dbPath);
  });
  afterEach(() => { for (const w of watchers) w.stop(); vi.restoreAllMocks(); });

  const make = (io: FleetIO = localIO, over: Record<string, unknown> = {}): FleetWatcher => {
    const deps = { ...testDeps(home), io, coord, ...over };
    const w = new FleetWatcher(withFakeClock(deps as never), new Bus(), 10_000);
    watchers.push(w);
    return w;
  };
  const dir = (project: string): string => path.join(reg, 'landing', project);
  const plantControl = (project: string, healthOver: Record<string, unknown> = {}): void => {
    mkdirSync(dir(project), { recursive: true });
    writeFileSync(path.join(dir(project), 'probe'), JSON.stringify(worked({ project })));
    writeFileSync(path.join(dir(project), 'lander'), JSON.stringify({ v: 1, project, lander: 'coordinator', at: iso(-2) }));
    writeFileSync(path.join(dir(project), 'main-health'), JSON.stringify({
      v: 1, project, at: iso(0), sha: sha(9), state: 'green', required: [{ name: 'required-a', app: null }], failing: [], pending: [], ...healthOver }));
  };
  const seedOpen = (project: string, id: number, pr: number): void => {
    dbHandle.prepare(
      `INSERT INTO landing_entries (id, project, pr, pinnedSha, handoffCommit, runId, state, baseSha, ejectionKind, ejections, afterIds, fixesMain, setBy, pinnedAt)
       VALUES (?, ?, ?, ?, ?, NULL, 'pinned', NULL, NULL, 0, '[]', 0, 'lane-a-${project}', ?)`)
      .run(id, project, pr, sha(pr), sha(pr + 100), 1000 + id);
  };
  const applies = (): string[] => {
    const seen: string[] = [];
    const real = coord.applyLandingControl.bind(coord);
    vi.spyOn(coord, 'applyLandingControl').mockImplementation((input) => { seen.push(input.project); return real(input); });
    return seen;
  };
  const probeReads = (seen: string[], project: string): number =>
    seen.filter((x) => x === `read ${path.join(dir(project), 'probe')}`).length;
  const bentIo = (bend: (method: string, p: string) => unknown | undefined, seen: string[] = []): FleetIO => {
    const wrap = <A extends unknown[], R>(method: string, f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
      seen.push(`${method} ${String(a[0])}`);
      const b = bend(method, String(a[0]));
      return b === undefined ? f(...a) : (b as R);
    };
    return {
      ...localIO,
      readdirMeasured: wrap('readdir', (p: string, t?: number, s?: AbortSignal) => localIO.readdirMeasured(p, t, s)),
      lstatMeasured: wrap('lstat', (p: string) => localIO.lstatMeasured(p)),
      statMeasured: wrap('stat', (p: string) => localIO.statMeasured(p)),
      readFileMeasured: wrap('read', (p: string, t?: number, s?: AbortSignal) => localIO.readFileMeasured(p, t, s)),
      readFileFromBytesMeasured: wrap('read', (p: string, o: number, m: number, t?: number, s?: AbortSignal) => localIO.readFileFromBytesMeasured(p, o, m, t, s)),
    };
  };

  it('a project with an open entry and no fleet session is read once and applied once', async () => {
    plantControl('proj-b'); seedOpen('proj-b', 1, 12);
    const seen: string[] = []; const ap = applies();
    const w = make(bentIo(() => undefined, seen));
    await w.sweepRadar([], NOW);
    expect(probeReads(seen, 'proj-b')).toBe(1);
    expect(ap.filter((p) => p === 'proj-b')).toHaveLength(1);
    expect(w.currentLandingControl('proj-b')).toMatchObject({ lander: { ok: true }, probe: { ok: true }, health: { ok: true } });
    expect(w.currentLandingControl('proj-unknown')).toBeUndefined();
  });

  it('a registry project with no entry is read too, and the getter hands out a copy', async () => {
    plantRowIn(reg, 'claude-a-proj-a-alpha'); plantControl('proj-a');
    const w = make();
    await w.sweepRadar(await readRegistry(localIO, testDeps(home).cfg), NOW);
    const first = w.currentLandingControl('proj-a');
    expect(first).toMatchObject({ lander: { ok: true } });
    (first as { lander: unknown }).lander = { ok: false, reason: 'late' };
    expect(w.currentLandingControl('proj-a')).toMatchObject({ lander: { ok: true } });
  });

  it('an unlistable registry still reads and applies a DB-known project and keeps re-aging the chips', async () => {
    plantControl('proj-b'); seedOpen('proj-b', 1, 12);
    const ap = applies();
    const w = make();
    await w.sweepRadar(null, NOW);
    expect(ap).toEqual(['proj-b']);
    expect(w.currentLandingControl('proj-b')).toMatchObject({ health: { ok: true } });
  });

  it('a failed store inventory reads the registry projects but applies nothing', async () => {
    plantRowIn(reg, 'claude-a-proj-a-alpha'); plantControl('proj-a');
    const ap = applies();
    vi.spyOn(coord, 'landingReadProjects').mockReturnValue({ ok: false, error: 'landing-db-unavailable', recovery: 'restart' } as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = make();
    await w.sweepRadar(await readRegistry(localIO, testDeps(home).cfg), NOW);
    await w.sweepRadar(await readRegistry(localIO, testDeps(home).cfg), NOW + 1000);
    expect(ap).toEqual([]);
    expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('landing control inventory')), 'said once, deduped').toHaveLength(1);
    expect(w.currentLandingControl('proj-a')).toMatchObject({ lander: { ok: true } });
  });

  it('a failed listing replaces a retained green with explicit unavailable evidence, never a borrowed snapshot', async () => {
    plantControl('proj-b'); seedOpen('proj-b', 1, 12);
    let broken = false;
    const w = make(bentIo((m, p) => (broken && m === 'readdir' && p.endsWith(`${path.sep}landing`) ? { ok: false, reason: 'unreadable' } : undefined)));
    await w.sweepRadar([], NOW);
    expect(w.currentLandingControl('proj-b')).toMatchObject({ lander: { ok: true } });
    broken = true;
    await w.sweepRadar([], NOW + 1000);
    expect(w.currentLandingControl('proj-b')).toEqual({
      lander: { ok: false, reason: 'unreadable' }, probe: { ok: false, reason: 'unreadable' }, health: { ok: false, reason: 'unreadable' } });
  });

  it('a superseded pass cannot apply or cache: only the newer pass speaks', async () => {
    plantControl('proj-b'); seedOpen('proj-b', 1, 12);
    const ap = applies();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    const w = make(bentIo((m, p) => {
      if (m !== 'readdir' || !p.endsWith(`${path.sep}landing`) || !first) return undefined;
      first = false;
      return gate.then(() => localIO.readdirMeasured(p));
    }));
    const stale = w.sweepRadar([], NOW);
    await w.sweepRadar([], NOW + 1000);
    expect(ap).toEqual(['proj-b']);
    release();
    expect(await stale).toBeUndefined();
    expect(ap, 'the superseded pass cannot apply').toEqual(['proj-b']);
  });

  it('a remote box whose agent link is down answers no snapshot at all', async () => {
    plantControl('proj-b'); seedOpen('proj-b', 1, 12);
    const base = testDeps(home);
    const w = make(localIO, { cfg: { ...base.cfg, fleetMode: 'remote' as const }, fleetState: { connected: true } });
    await w.sweepRadar([], NOW);
    expect(w.currentLandingControl('proj-b')).toMatchObject({ lander: { ok: true } });
    (w as unknown as { deps: { fleetState: { connected: boolean } } }).deps.fleetState.connected = false;
    expect(w.currentLandingControl('proj-b')).toBeUndefined();
  });
});

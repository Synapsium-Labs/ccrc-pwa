// Landing order wave 4b, Task 2: the radar lane (`FleetWatcher.sweepRadar`), its reader (`coord/lineageRead.ts`:
// `listRadarProjects`, `readRadarProbe`, `readRadarPass`) and the two derivations the lane matches against
// (`sessionBranchOf`, `sessionPrOf`). Real files in a fixture home, through `localIO`; an io double only where a fault
// cannot be made on disk. Review Focus 1 and 4 of the plan, case by case. Neutral names throughout.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { sessionBranchOf, sessionPrOf } from '../src/fleet.js';
import { listRadarProjects, readRadarPass, readRadarProbe, readRegular } from '../src/coord/lineageRead.js';
import { RADAR_PROBE_MAX_BYTES } from '../src/coord/radar.js';
import { readRegistry, type SessionRecord } from '../src/registry.js';
import { localIO, type FleetIO } from '../src/io.js';
import type { PrState } from '../../shared/api.js';
import { seedRoster, testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

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

    // G9 (review 1225, F4). `parseProbe` checks the bytes against the cap again, so a case through `readRadarProbe`, the
    // pass or the lane cannot see `readRegular`'s own post-read check: call it directly, with an io whose stat says the
    // file is within the cap and whose read hands back more than the cap.
    it('readRegular checks the bytes it read against the cap, whatever the stat said', async () => {
      const cap = 16;
      const io = {
        lstatMeasured: async () => ({ ok: true as const, kind: 'regular' as const }),
        statMeasured: async () => ({ ok: true as const, mtimeMs: 0, size: cap }),
        readFileMeasured: async () => ({ ok: true as const, content: 'x'.repeat(cap + 1) }),
      };
      expect(await readRegular(io, '/f', undefined, cap)).toEqual({ ok: false, reason: 'unreadable' });
      const within = { ...io, readFileMeasured: async () => ({ ok: true as const, content: 'x'.repeat(cap) }) };
      expect(await readRegular(within, '/f', undefined, cap), 'a file at the cap reads').toEqual({ ok: true, content: 'x'.repeat(cap) });
    });

    it('the listing leaves out the lister\'s .lp.* temporaries and says absent for no directory', async () => {
      expect(await listRadarProjects(localIO, reg)).toEqual({ ok: false, reason: 'absent' });
      mkdirSync(path.join(reg, 'landing', 'proj-a'), { recursive: true });
      mkdirSync(path.join(reg, 'landing', '.lp.123'), { recursive: true });
      expect(await listRadarProjects(localIO, reg)).toEqual({ ok: true, names: ['proj-a'] });
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
    it('tick() hands an unlistable registry to the lane as null: the kept map is re-aged, never emptied', async () => {
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
    it('one listing, then one lstat, one stat and one read per project a session names', async () => {
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
        expect(mine.map((s) => s.split(' ')[0]).sort(), project).toEqual(['lstat', 'read', 'stat']);
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
        readFileMeasured: async (p, t, s) => {
          const r = await localIO.readFileMeasured(p, t, s);
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
        readFileMeasured: (_p, _t, s) => { signal = s; return new Promise<never>(() => undefined); },
      };
      const r = await readRadarPass(io, reg, new Set(['proj-a']), NOW, 20);
      expect(r).toEqual({ ok: true, reads: new Map([['proj-a', { ok: false, reason: 'late' }]]) });
      expect(signal?.aborted).toBe(true);
    });

    it('a lane failure is caught by the lane and never stops the tick', async () => {
      plantRow(ALPHA);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const io: FleetIO = {
        ...localIO,
        readdirMeasured: (p, t, s) => (p.endsWith(`${path.sep}landing`) ? Promise.reject(new Error('boom')) : localIO.readdirMeasured(p, t, s)),
      };
      const w = make(io);
      await expect(w.tick()).resolves.toBeUndefined();
      await vi.waitFor(() => expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('the landing radar lane failed'));
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

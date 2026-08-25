// D13: the allocator self-seeds from docs/superpowers/{plans,specs}/*.md of
// the MAIN checkout, hourly, through the already-granted io reads; the floor
// only ever rises; reconcile marks allocated -> landed off the plans dir
// every 15 minutes; stale numbers are REPORTED, never reclaimed.
//
// Fixture refs above the real ledger are spelled SPLIT (`D-${2611}`) on
// purpose — never contiguous. deviation-refs.test.ts runs the real
// floorFromScan over this repo's own tracked tree (this project is itself a
// fleet project the sweep scans), and a contiguous big ref here would poison
// the first live floor seed, permanently: the floor only rises.
import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { LedgerLog } from '../src/coord/ledgerlog.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_785_300_000_000;

afterEach(() => { vi.restoreAllMocks(); });

const at = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };

const fixture = () => {
  const home = mkTmp('ccrc-ledger-sweep-');
  const projectsRoot = mkTmp('ccrc-ledger-docs-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const reads: string[] = [];
  const io: FleetIO = {
    ...localIO,
    readdir: async (p: string) => { reads.push(p); return localIO.readdir(p); },
  };
  const watcher = new FleetWatcher({ ...testDeps(home), cfg, io, coord } as never, new Bus(), 10_000);
  const plantDoc = (project: string, dir: 'plans' | 'specs', name: string, text: string): void => {
    const d = path.join(projectsRoot, project, 'docs', 'superpowers', dir);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, name), text);
  };
  const plantRecord = (id: string, project: string): void => {
    const reg = path.join(home, '.cc-sessions');
    const fields: Record<string, string> = {
      uuid: `u-${id}`, wrapper: 'claude', project, workdir: `/w/${id}`,
      workspace: id.split('-').slice(1).join('-'), branch: `ws/${id}`,
      base: 'origin/main', started: '1',
    };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
  };
  const log = new LedgerLog(path.join(home, '.ccrc', 'ledger-alloc.log'));
  // `records` reads through the UNCOUNTED localIO, deliberately: the reads[]
  // tally is the sweep's own gate evidence, and the registry listing the test
  // itself triggers while building the sweep's argument is not the sweep's
  // read (claim-sweep.test.ts's `records` idiom).
  return { home, cfg, coord, watcher, log, plantDoc, plantRecord,
           reads: () => [...reads], records: () => readRegistry(localIO, cfg) };
};

describe('sweepLedgerFloor', () => {
  it('seeds floor = max(D-n) + LEDGER_SEED_GAP off plans AND specs, with evidence naming file and number', async () => {
    const h = fixture();
    h.plantRecord('demo-quiet-basin', 'demo');
    h.plantDoc('demo', 'plans', '2026-08-01-a.md', 'prose that carries D-208 in passing');
    h.plantDoc('demo', 'specs', '2026-08-02-b.md', 'and the high-water D-211 lives here');
    at(NOW);
    await h.watcher.sweepLedgerFloor(await h.records());
    expect(h.coord.ledgerFloor('demo')).toEqual({
      floor: 261,                                        // 211 + LEDGER_SEED_GAP(50)
      evidence: expect.stringContaining('D-211'),
      updatedAt: NOW,
    });
    expect(h.coord.ledgerFloor('demo')!.evidence).toContain('2026-08-02-b.md');
  });

  it('THE FLOOR ONLY RISES — a later, lower scan changes nothing', async () => {
    const h = fixture();
    h.plantRecord('demo-quiet-basin', 'demo');
    h.plantDoc('demo', 'plans', 'a.md', 'D-211');
    at(NOW);
    await h.watcher.sweepLedgerFloor(await h.records());
    h.plantDoc('demo', 'plans', 'a.md', 'D-100 only, the higher ref rewritten away');
    at(NOW + 2 * 3_600_000);
    await h.watcher.sweepLedgerFloor(await h.records());
    expect(h.coord.ledgerFloor('demo')!.floor).toBe(261);
  });

  it('a project with NO docs seeds nothing — allocation stays 409 not-seeded, which is the fail-shut arm', async () => {
    const h = fixture();
    h.plantRecord('demo-quiet-basin', 'demo');
    at(NOW);
    await h.watcher.sweepLedgerFloor(await h.records());
    expect(h.coord.ledgerFloor('demo')).toBeNull();
    expect(h.coord.allocateDeviations({ project: 'demo', count: 1, title: 't',
      allocatedTo: 'demo-quiet-basin', runId: null, now: NOW }, h.log))
      .toEqual({ ok: false, why: 'not-seeded' });
  });

  it('own clock: a second sweep inside the hour reads nothing', async () => {
    const h = fixture();
    h.plantRecord('demo-quiet-basin', 'demo');
    h.plantDoc('demo', 'plans', 'a.md', 'D-211');
    at(NOW);
    await h.watcher.sweepLedgerFloor(await h.records());
    const before = h.reads().length;
    at(NOW + 60_000);
    await h.watcher.sweepLedgerFloor(await h.records());
    expect(h.reads().length).toBe(before);               // the gate held: not one readdir
  });
});

describe('sweepLedgerReconcile', () => {
  const seedAndAllocate = async (h: ReturnType<typeof fixture>, count: number) => {
    h.coord.raiseLedgerFloor('demo', 261, 'seeded by test', NOW);
    const r = h.coord.allocateDeviations({ project: 'demo', count, title: 'the seam',
      allocatedTo: 'demo-quiet-basin', runId: null, now: NOW }, h.log);
    if (!r.ok) throw new Error('fixture allocation refused');
    return r.allocation.numbers;
  };

  it('allocated -> landed when the number appears in a PLAN of the main checkout', async () => {
    const h = fixture();
    await seedAndAllocate(h, 2);                          // 261, 262
    h.plantDoc('demo', 'plans', '2026-08-24-plan.md', `### D-${261} — the seam, landed`);
    at(NOW + 1000);
    await h.watcher.sweepLedgerReconcile();
    const rows = h.coord.ledgerAllocations('demo');
    expect(rows[0]).toMatchObject({ n: 261, state: 'landed',
      landedIn: 'docs/superpowers/plans/2026-08-24-plan.md' });
    expect(rows[1]).toMatchObject({ n: 262, state: 'allocated' });
  });

  it(`D-${261} does not land D-${2611} — the boundary is a word boundary`, async () => {
    const h = fixture();
    await seedAndAllocate(h, 1);                          // 261
    h.plantDoc('demo', 'plans', 'p.md', `only D-${2611} appears here`);
    at(NOW + 1000);
    await h.watcher.sweepLedgerReconcile();
    expect(h.coord.ledgerAllocations('demo')[0]!.state).toBe('allocated');
  });

  it('STALE AT 7 DAYS: reported (once per changing set), NEVER reclaimed', async () => {
    const h = fixture();
    await seedAndAllocate(h, 1);                          // 261, never lands
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(NOW + 8 * 24 * 3_600_000);
    await h.watcher.sweepLedgerReconcile();
    expect(warn.mock.calls.flat().join('\n')).toContain(`D-${261}`);
    expect(h.coord.ledgerAllocations('demo')[0]!.state).toBe('allocated');   // never reclaimed
    const callsAfterFirst = warn.mock.calls.length;
    at(NOW + 8 * 24 * 3_600_000 + 16 * 60_000);
    await h.watcher.sweepLedgerReconcile();
    expect(warn.mock.calls.length).toBe(callsAfterFirst); // same set: no re-report
  });

  it('own clock: a second sweep inside 15 minutes does not act', async () => {
    const h = fixture();
    await seedAndAllocate(h, 1);
    at(NOW + 1000);
    await h.watcher.sweepLedgerReconcile();
    h.plantDoc('demo', 'plans', 'p.md', `D-${261}`);
    at(NOW + 5 * 60_000);
    await h.watcher.sweepLedgerReconcile();               // inside the interval
    expect(h.coord.ledgerAllocations('demo')[0]!.state).toBe('allocated');
  });

  it('runs with NO coord at all', async () => {
    const w = new FleetWatcher(testDeps(mkTmp('ccrc-ledger-sweep-')), new Bus(), 10_000);
    await expect(w.sweepLedgerReconcile()).resolves.toBeUndefined();
    await expect(w.sweepLedgerFloor([])).resolves.toBeUndefined();
  });
});

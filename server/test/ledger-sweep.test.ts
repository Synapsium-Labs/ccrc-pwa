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
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

const fixture = (overIo?: (base: FleetIO) => FleetIO) => {
  const home = mkTmp('ccrc-ledger-sweep-');
  const projectsRoot = mkTmp('ccrc-ledger-docs-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const reads: string[] = [];
  const counted: FleetIO = {
    ...localIO,
    readdir: async (p: string) => { reads.push(p); return localIO.readdir(p); },
  };
  const io: FleetIO = overIo ? overIo(counted) : counted;
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

  it('SEEDS FROM specs WHEN plans WILL NOT LIST — the sweep takes what it got', async () => {
    // wave 2 review, the major finding. This lane must TOLERATE a partial scan
    // and keep walking: it mints nothing, so a floor it under-measures costs a
    // delay and the next hourly pass raises it. The synchronous seed is the
    // opposite and refuses — that asymmetry is the whole point of the split
    // policy, and NOTHING pinned this half before, which is why the abort
    // semantics slipped in under a green suite (D-1021).
    //
    // MUTATION: give the sweep call site SEED_POLICY (abort + budget) and this
    // reds — the project is skipped entirely and the floor stays null.
    const h = fixture((base) => ({
      ...base,
      readdir: async (p: string) => (p.endsWith(`${path.sep}plans`) ? null : base.readdir(p)),
    }));
    h.plantRecord('demo-quiet-basin', 'demo');
    // plans/ must EXIST so the parent listing names it — otherwise the reader
    // skips it as genuinely absent and the readdir override never fires.
    h.plantDoc('demo', 'plans', 'p.md', `### ${'D-' + '100'} unreachable`);
    h.plantDoc('demo', 'specs', 's.md', `### ${'D-' + '211'} in specs`);
    at(NOW);
    await h.watcher.sweepLedgerFloor(await h.records());
    // Old behaviour, restored: plans/ contributed nothing, specs/ still seeded.
    expect(h.coord.ledgerFloor('demo')?.floor).toBe(211 + 50);
  });

  it('SEEDS FROM the readable files when ONE file will not read', async () => {
    // The file-level half of the same tolerance. The unreadable file is the
    // one with the HIGHER ref, so a tolerant sweep genuinely under-measures
    // here — and that is accepted on THIS lane precisely because nothing
    // downstream of it mints a number.
    const h = fixture((base) => ({
      ...base,
      readFile: async (p: string) => (p.endsWith('a-high.md') ? null : base.readFile(p)),
    }));
    h.plantRecord('demo-quiet-basin', 'demo');
    // The unreadable file sorts FIRST, deliberately. An aborting reader
    // returns the prefix it had — which here is EMPTY, so the project is
    // skipped and the floor stays null. Had it sorted last, the abort would
    // have returned a usable prefix and this test would pass either way,
    // proving nothing (measured: it did).
    h.plantDoc('demo', 'plans', 'a-high.md', `### ${'D-' + '9000'} high`);
    h.plantDoc('demo', 'plans', 'b-low.md', `### ${'D-' + '211'} low`);
    at(NOW);
    await h.watcher.sweepLedgerFloor(await h.records());
    expect(h.coord.ledgerFloor('demo')?.floor).toBe(211 + 50);
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

  it('lands on the file that DEFINES the number, not on one that merely cites it', async () => {
    // BOTH DIRECTIONS IN ONE MEASUREMENT, because the fixture corpus here is a
    // bare directory tree with no repository at all (`fixture()`:33 is a mkTmp,
    // and readLedgerDocs reads it through FleetIO): "on the served ref" and "not
    // on it" are the same state, so a ref-based fixture is not constructible and
    // every existing green assertion in this file is compatible with the defect.
    // The SHAPE is constructible, and it is the live one — copied from the
    // blockquote that stamped two numbers against an unmerged file on 2026-09-02.
    //
    // The citing file sorts FIRST (`ledgerseed.ts:182` walks `[...names].sort()`),
    // so under the old matcher `files.find` returns it — which is what makes this
    // a measurement rather than a coin toss.
    const h = fixture();
    await seedAndAllocate(h, 1);                          // 261
    h.plantDoc('demo', 'plans', 'a-cites.md',
      `> **D-${261}..D-${299}** from \`POST /api/ledger/deviations\`.`);
    h.plantDoc('demo', 'plans', 'b-defines.md', `- **D-${261}** — the real entry`);
    at(NOW + 1000);
    await h.watcher.sweepLedgerReconcile();
    expect(h.coord.ledgerAllocations('demo')[0]).toMatchObject({
      n: 261, state: 'landed',
      landedIn: 'docs/superpowers/plans/b-defines.md',
    });
  });

  it('a citation ALONE lands nothing — the live shape, with no definition anywhere', async () => {
    const h = fixture();
    await seedAndAllocate(h, 1);                          // 261
    h.plantDoc('demo', 'plans', 'cite.md',
      `> **D-${261}..D-${299}** from \`POST /api/ledger/deviations\`.`);
    at(NOW + 1000);
    await h.watcher.sweepLedgerReconcile();
    expect(h.coord.ledgerAllocations('demo')[0])
      .toMatchObject({ n: 261, state: 'allocated', landedIn: null, landedAt: null });
  });

  it('REPORTS a number a plan defines that the allocator never issued (F7)', async () => {
    // The inverse of markLanded, and the half nothing has ever measured. Live
    // instance on main while this was written: D-1066..1069, defined in
    // 2026-08-30-d1066-dead-recipient-parks.md with no allocation row.
    const h = fixture();
    await seedAndAllocate(h, 1);                          // 261 IS issued
    h.plantDoc('demo', 'plans', 'p.md',
      `### D-${261} — issued and landed\n- **D-${299}** — never asked for`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(NOW + 1000);
    await h.watcher.sweepLedgerReconcile();
    expect(warn).toHaveBeenCalledTimes(1);
    const said = warn.mock.calls[0]![0] as string;
    expect(said, 'the orphan is not named').toContain(`D-${299}`);
    expect(said, 'the file that defines it is not named').toContain('p.md');
    // The issued one must NOT be reported — otherwise the warning says nothing.
    expect(said).not.toContain(`D-${261} `);
  });

  it('says nothing once every defined number IS issued — silence is the healthy state', async () => {
    const h = fixture();
    const ns = await seedAndAllocate(h, 2);               // 261, 262
    h.plantDoc('demo', 'plans', 'p.md',
      `### D-${ns[0]!} — one\n### D-${ns[1]!} — two`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(NOW + 1000);
    await h.watcher.sweepLedgerReconcile();
    expect(warn, 'a healthy ledger produced a warning').not.toHaveBeenCalled();
  });

  it('reports an unchanged orphan set ONCE, not on every sweep — the stale side is pinned, this was not', async () => {
    // Measured GREEN in review: deleting the `oJson !== lastOrphanReport.get(project)`
    // condition changed nothing, in any suite. The mirrored guard on the STALE side
    // has had a test since D13 ("reported (once per changing set)"), which is what
    // makes the omission on this side an omission rather than a policy.
    //
    // The live case it protects is on main right now: D-1066..1069 have no
    // allocation row, so without the dedupe every ccrc-server on the fleet logs
    // that line every 15 minutes, forever.
    const h = fixture();
    await seedAndAllocate(h, 1);
    h.plantDoc('demo', 'plans', 'p.md', `- **D-${299}** — never asked for`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(NOW + 1000);
    await h.watcher.sweepLedgerReconcile();
    at(NOW + 1000 + 15 * 60_000);
    await h.watcher.sweepLedgerReconcile();
    expect(warn, 'an unchanged orphan set was reported twice').toHaveBeenCalledTimes(1);
    // …and a CHANGED set speaks again, so the memo is a dedupe and not a mute.
    h.plantDoc('demo', 'plans', 'q.md', `- **D-${298}** — also never asked for`);
    at(NOW + 1000 + 30 * 60_000);
    await h.watcher.sweepLedgerReconcile();
    expect(warn, 'a CHANGED orphan set was swallowed by the memo').toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]![0] as string).toContain(`D-${298}`);
  });

  it('audits a project whose numbers have ALL landed — the corpus the old list could not reach', async () => {
    // The behaviour change stated in the sweep: the project list used to come
    // from OPEN allocations, so a project working correctly — everything landed,
    // nothing open — was never audited at all, which is precisely backwards.
    const h = fixture();
    await seedAndAllocate(h, 1);                          // 261
    h.plantDoc('demo', 'plans', 'p.md', `### D-${261} — landed`);
    at(NOW + 1000);
    await h.watcher.sweepLedgerReconcile();
    expect(h.coord.openAllocations(), 'the fixture still has an open row').toEqual([]);
    // Now add an orphan. With no open allocations left, the old loop would not
    // have read this project's plans at all.
    h.plantDoc('demo', 'plans', 'q.md', `- **D-${299}** — never asked for`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(NOW + 2 * 15 * 60_000);
    await h.watcher.sweepLedgerReconcile();
    expect(warn, 'a fully-landed project is never audited').toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0] as string).toContain(`D-${299}`);
  });

  it(`D-${261} does not land D-${2611} — the boundary is a word boundary`, async () => {
    const h = fixture();
    await seedAndAllocate(h, 1);                          // 261
    // A REAL DEFINITION, not a bare mention (D-1421). A bare mention cannot
    // land under the shared `definitionsIn` predicate for a reason that has
    // nothing to do with the word boundary this case is about, so the old
    // fixture would have passed with the boundary deleted. The warn spy is
    // here because the definition below is an unissued number, which the
    // orphan half now reports.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.plantDoc('demo', 'plans', 'p.md', `### D-${2611} — a different number, defined`);
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
    // A REAL DEFINITION (D-1421): under the shared `definitionsIn` predicate a
    // bare `D-261` can never land whatever the clock says, so the old fixture
    // was compatible with the 15-minute gate being deleted outright.
    h.plantDoc('demo', 'plans', 'p.md', `### D-${261} — would land, but for the clock`);
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

describe('what `landed` is allowed to claim', () => {
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');
  const flat = (s: string): string => s.replace(/\s+/g, ' ');

  /** A named slice between two literal anchors. An anchor that stopped matching
   *  yields '', and '' satisfies every assertion below it — box-token-census
   *  .test.ts:220's rule, copied for its reason as much as its shape. */
  const passage = (name: string, text: string, from: string, to: string): string => {
    const a = text.indexOf(from);
    expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
    const b = text.indexOf(to, a + from.length);
    expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
    const out = flat(text.slice(a, b));
    expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(120);
    return out;
  };

  // THIS FILE IS DELIBERATELY NOT A SITE. It makes no merge claim (measured: the
  // regex below scores zero against it at 5e9f650d), and it holds that regex as a
  // literal — scanning itself is the self-matching-guard failure, permanently red
  // for a reason that has nothing to do with the corpus.
  const SITES = ['server/src/watch.ts', 'server/src/coord/schema.ts',
                 'server/src/coord/store.ts', 'shared/api.ts'] as const;

  // ANCHORED PER SITE, not whole-file: `shared/api.ts` already contains a
  // lowercase "working tree" at :652 (`cmd_ws_audit reads the working tree
  // ITSELF`), so a whole-file presence check would be green before the change and
  // stay green if the corrected sentence were deleted — the exact mutation this
  // case exists to catch.
  const PASSAGES: ReadonlyArray<readonly [string, string, string, string]> = [
    ['watch.ts, sweepLedgerReconcile', 'server/src/watch.ts',
     '   * D13: allocated -> landed', '  async sweepLedgerReconcile'],
    ['watch.ts, sweepLedgerFloor', 'server/src/watch.ts',
     '   * D13: the allocator SELF-SEEDS', '  async sweepLedgerFloor'],
    ['schema.ts, the ledger_alloc DDL comment', 'server/src/coord/schema.ts',
     "  -- D13: the allocator's record.", '  CREATE TABLE ledger_alloc ('],
    ['store.ts, markLanded', 'server/src/coord/store.ts',
     '  /** allocated -> landed, once', '  markLanded(project: string'],
    ['shared/api.ts, DeviationAllocation', 'shared/api.ts',
     ' * One allocated deviation number, as `GET /api/ledger` reports it.',
     'export interface DeviationAllocation'],
  ];

  it('no site claims a merge the reader never performs', () => {
    // The read is io.readdir/io.readFile under ${projectsRoot}/${project}, on
    // whatever branch that checkout is on, uncommitted edits included — measured
    // 2026-09-02, when it stamped landedIn with a path that was then on no
    // merged ref (it merged 2026-09-03; the stamp was wrong for the citation,
    // not for the merge status).
    for (const rel of SITES) {
      expect(flat(read(rel)), `${rel} still says landed means merged`)
        .not.toMatch(/genuinely means merged|genuinely merged|in a merged plan|in a plan in the MAIN/);
    }
  });

  it('and each passage that used to lie says what IS measured', () => {
    // Absence is not enough: deleting the sentence would satisfy the case above.
    // Lowercase on purpose — the assertion is case-SENSITIVE, so the prose must
    // spell it `working tree`, not `WORKING TREE`.
    for (const [name, rel, from, to] of PASSAGES) {
      expect(passage(name, read(rel), from, to),
        `${name} dropped the claim instead of correcting it`).toMatch(/working tree/);
    }
  });

  it('markLanded carries its own docstring, and ledgerProjects is not described as landing', () => {
    const src = read('server/src/coord/store.ts');
    const i = src.indexOf('  markLanded(project: string');
    expect(i, 'markLanded moved — re-anchor this guard').toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, i - 700), i),
      'markLanded still has no docstring of its own').toMatch(/allocated -> landed, once/);
    const j = src.indexOf('  ledgerProjects(): string[]');
    expect(j, 'ledgerProjects moved — re-anchor this guard').toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, j - 700), j),
      'the landing docstring is still attached to ledgerProjects').not.toMatch(/allocated -> landed/);
  });
});

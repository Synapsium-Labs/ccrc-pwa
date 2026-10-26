// ARCH-62 (#797), slice 2: the W0 census of the consolidation wave (spec 2026-10-19 §5.9, §5.1 rule 3). It pins, by file
// and with an EXACT count, every server run/session equality site (`runSessionCensus.ts` says what counts and what it
// cannot see), and the store's binding readers by name. A pin is a ceiling that is also a floor: a slice that routes a
// site through `bindingOf`/`childrenOf` LOWERS its file's number in the same commit; a new site, in a new file or an
// old one, is red until it is justified here. The counted exit (spec §5.9): the sites all through `bindingOf`/`childrenOf`,
// the store's binding readers <= 4, and the #746 fixture. This file is the measure, not the exit.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_READS, NOT_BINDING_SITES, RUN_KEYED_READS, RUN_NAMES_SESSION_CALLERS, runNamesSessionCallers, runNamesSessionCallsOf, countsByFile, equalitySites, equalitySitesOf, REPO, storeBindingReaders, unroutedSites,
} from './runSessionCensus.js';
import { BINDING_WRITER_VERBS } from '../src/coord/runBinding.js';

/** The pinned count per file: the sites of the tree at this commit. Lower a number as its file's sites are routed. */
const SITES: Record<string, number> = {
  'server/src/archivedExpiry.ts': 2,
  'server/src/collectLane.ts': 2,
  'server/src/coord/childSpent.ts': 2,
  'server/src/coord/claims.ts': 1,
  'server/src/coord/close.ts': 1,
  'server/src/coord/delegation-correlation.ts': 4,
  'server/src/coord/delegation-ingest.ts': 2,
  'server/src/coord/delegation-model.ts': 1,
  'server/src/coord/fingerprint.ts': 1,
  'server/src/coord/heldFor.ts': 1,
  'server/src/coord/runBinding.ts': 4,
  'server/src/coord/stall.ts': 8,
  'server/src/coord/store.ts': 14,
  'server/src/hookstate.ts': 1,
  'server/src/stopDoneSweep.ts': 1,
  'server/src/tmpSweepLane.ts': 1,
  'server/src/transcript/parse.ts': 1,
  'server/src/turnmark.ts': 1,
  'server/src/watch.ts': 10,
};
const SITES_TOTAL = 58;

/** The store's session-keyed binding readers at this commit, by name (the raw detector's count, writers and attribute
 *  reads named apart). */
const READERS: readonly string[] = ['bindingRunsOf', 'lastRunBySession', 'openRunsForSession', 'runsNamingSession'];
/** The store's binding readers as the spec (K10) counts them at this commit: the four above plus the two run-keyed ones
 *  (`RUN_KEYED_READS`, `resolveCoordinator` and `resolveWorker`), which slice 4 folds onto `run(id)`. */
const COUNTED_READERS = 6;
/** The counted exit's number (spec §5.9): open-only, any state, last-closed, and the series the binding decides over. Met
 *  once slice 4 folds the run-keyed readers; not met at this commit (6 > 4). */
const READERS_CEILING = 4;

describe('the equality-site query (ARCH-62 census)', () => {
  const sites = (src: string) => equalitySitesOf(src, 'fixture.ts');

  it('counts a comparison of a session or claimant name, however the operand is spelt', () => {
    const found = sites([
      'if (a.sessionId === b) {}', 'if (x !== run.claimedBy) {}', 'if (c!.coordinatorId == d) {}',
      'if (o["sessionId"] != e) {}', 'const ok = sessionId === claimedBy;',
    ].join('\n'));
    expect(found.map((s) => s.line)).toEqual([1, 2, 3, 4, 5]);
    expect(found.every((s) => s.kind === 'comparison')).toBe(true);
  });

  it('passes over a null check, a comparison of other names, an includes test and a comment', () => {
    expect(sites([
      'if (run.sessionId === null) {}', 'if (run.claimedBy !== undefined) {}', 'if (a.id === b.id) {}',
      'const has = ids.includes(run.sessionId);', '// run.sessionId === other', '/* x.claimedBy === y */',
    ].join('\n'))).toEqual([]);
  });

  it('counts a store query that selects runs by session or claimant (the templated column included), and not one on another table', () => {
    const found = sites([
      "db.prepare('SELECT id FROM runs WHERE sessionId = ? ORDER BY id').all(a);",
      "db.prepare('SELECT id FROM runs WHERE sessionId = ? OR claimedBy = ?').all(a, a);",
      "db.prepare('SELECT 1 FROM runs r WHERE r.claimedBy IN (?, ?)').all(a, b);",
      "db.prepare(`SELECT id FROM runs WHERE ${where} ORDER BY id`).all(a);",
      "const t = (sql) => db.prepare(sql).get(); t('SELECT MAX(at) FROM run_events WHERE runId IN (SELECT id FROM runs WHERE sessionId = ?)', a);",
      "db.prepare('SELECT * FROM lifecycle_events WHERE sessionId = ?').all(a);",
      "db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(a, 1);",
    ].join('\n'));
    expect(found.map((s) => [s.line, s.kind])).toEqual([[1, 'query'], [2, 'query'], [3, 'query'], [4, 'query'], [5, 'query']]);
  });
});

describe('unroutedSites (ARCH-62 census)', () => {
  const site = (file: string, text: string) => ({ file, line: 1, kind: 'comparison' as const, text });
  const sites = [site('a.ts', 'x === a.sessionId'), site('a.ts', 'x === a.sessionId'), site('a.ts', 'y !== b.claimedBy'), site('b.ts', 'x === a.sessionId')];

  it('takes out the named sites by file, text and count, and no other', () => {
    const left = unroutedSites(sites, [{ file: 'a.ts', text: 'x === a.sessionId', count: 2, why: 'w' }]);
    expect(left.map((s) => `${s.file}:${s.text}`)).toEqual(['a.ts:y !== b.claimedBy', 'b.ts:x === a.sessionId']);
  });

  it('an entry covers only its count: a third site with the same text stays counted', () => {
    expect(unroutedSites(sites, [{ file: 'a.ts', text: 'x === a.sessionId', why: 'w' }])).toHaveLength(3);
  });
});

describe('the server run/session equality sites (ARCH-62 census)', () => {
  const sites = equalitySites();
  const unrouted = unroutedSites(sites);
  const counts = countsByFile(unrouted);

  it('every file holds exactly its pinned number of sites that still decide a binding by hand', () => {
    expect(counts).toEqual(SITES);
  });

  it('the total only goes down', () => {
    expect(unrouted.length).toBe(SITES_TOTAL);
    expect(Object.values(SITES).reduce((a, b) => a + b, 0)).toBe(SITES_TOTAL);
  });

  it('every site named as no binding is live, says why, and is no more than the file holds', () => {
    for (const n of NOT_BINDING_SITES) {
      expect(n.why.length, `${n.file}: ${n.text}`).toBeGreaterThan(30);
      expect(sites.filter((s) => s.file === n.file && s.text === n.text).length, `${n.file}: ${n.text}`).toBe(n.count ?? 1);
    }
  });
});

describe('the callers of runNamesSession (an id-string decision behind a name; ARCH-62 census)', () => {
  it('are exactly the pinned callers, each with its count and a reason', () => {
    expect(runNamesSessionCallers()).toEqual(Object.fromEntries(
      [...RUN_NAMES_SESSION_CALLERS].sort((a, b) => a.file.localeCompare(b.file)).map((c) => [c.file, c.count])));
    for (const c of RUN_NAMES_SESSION_CALLERS) expect(c.why.length, c.file).toBeGreaterThan(30);
  });

  it('counts a call, not an import', () => {
    const src = "import { runNamesSession } from './runBinding.js';\nif (runNamesSession(r, id)) {}\n";
    expect(runNamesSessionCallsOf(src, 'x.ts')).toBe(1);
  });
});

describe('the store binding readers (ARCH-62 census)', () => {
  const found = storeBindingReaders(readFileSync(`${REPO}/server/src/coord/store.ts`, 'utf8'));

  it('are exactly the pinned readers', () => {
    expect(found).toEqual([...READERS].sort());
  });

  it('count six with the run-keyed readers: the exit ceiling is four, pending slice 4', () => {
    expect(found.length + RUN_KEYED_READS.length).toBe(COUNTED_READERS);
    // What slice 4 must reach: with `resolveCoordinator`/`resolveWorker` folded onto `run(id)`, only these remain.
    expect(found.length).toBeLessThanOrEqual(READERS_CEILING);
  });

  it('a binding writer and an attribute read are named, not counted', () => {
    expect(ATTRIBUTE_READS).toEqual(['sessionProject', 'strandedClear', 'childStaleActivity']);
    expect(BINDING_WRITER_VERBS).toContain('openRun');
    expect(found.filter((n) => ATTRIBUTE_READS.includes(n) || BINDING_WRITER_VERBS.includes(n))).toEqual([]);
  });
});

describe('the run-keyed binding readers the spec counts (ARCH-62 census; folded onto run(id) in slice 4)', () => {
  const text = readFileSync(`${REPO}/server/src/coord/store.ts`, 'utf8');

  it('are exactly resolveCoordinator and resolveWorker, still on the store, each read by run id', () => {
    expect(RUN_KEYED_READS).toEqual(['resolveCoordinator', 'resolveWorker']);
    for (const n of RUN_KEYED_READS) expect(text).toMatch(new RegExp(`^  ${n}\\(runId: `, 'm'));
  });

  it('are counted by name, not by the raw detector, which sees only session-keyed queries', () => {
    expect(storeBindingReaders(text).filter((n) => RUN_KEYED_READS.includes(n))).toEqual([]);
  });
});

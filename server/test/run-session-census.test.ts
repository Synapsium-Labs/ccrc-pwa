// ARCH-62 (#797), slice 2: the W0 census of the consolidation wave (spec 2026-10-19 §5.9, §5.1 rule 3). It pins, by file
// and with an EXACT count, every server run/session equality site (`runSessionCensus.ts` says what counts and what it
// cannot see), and the store's binding readers by name. A pin is a ceiling that is also a floor: a slice that routes a
// site through `bindingOf`/`childrenOf` LOWERS its file's number in the same commit; a new site, in a new file or an
// old one, is red until it is justified here. The counted exit (spec §5.9): the sites all through `bindingOf`/`childrenOf`,
// the store's binding readers <= 4, and the #746 fixture. This file is the measure, not the exit.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_READS, FOLDED_RUN_KEYED_READS, NOT_BINDING_SITES, RUN_NAMES_SESSION_CALLERS, runNamesSessionCallers, runNamesSessionCallsOf, runNamesSessionEscapes, runNamesSessionEscapesOf, countsByFile, equalitySites, equalitySitesOf, REPO, storeBindingReaders, unroutedSites,
} from './runSessionCensus.js';
import { BINDING_WRITER_VERBS } from '../src/coord/runBinding.js';
import { coordinatorOfRun, workerOfRun } from '../src/coord/bindingReads.js';

/** The pinned count per file: the sites that still decide a binding by hand, at this commit. ARCH-62 slice 4 routed the last
 *  of them or named it in `NOT_BINDING_SITES` (with its reason), so no file holds one: the counted exit's first number. */
const SITES: Record<string, number> = {};
const SITES_TOTAL = 0;

/** The store's session-keyed binding readers at this commit, by name (the raw detector's count, writers and attribute
 *  reads named apart). */
const READERS: readonly string[] = ['bindingRunsOf', 'lastRunBySession', 'openRunsForSession', 'runsNamingSession'];
/** The counted exit's number (spec §5.9): open-only, any state, last-closed, and the series the binding decides over. The
 *  run-keyed readers (`resolveCoordinator`, `resolveWorker`) are folded onto `run(id)` (slice 4), so this is the whole count. */
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

  it('counts a call through an aliased import or a namespace import', () => {
    const aliased = "import { runNamesSession as names } from './coord/runBinding.js';\nif (names(r, id)) {}\n";
    expect(runNamesSessionCallsOf(aliased, 'x.ts')).toBe(1);
    const spaced = "import {\n  bindingOf,\n  runNamesSession  as  n2,\n} from './runBinding.js';\nn2(r, id); n2(q, id);\n";
    expect(runNamesSessionCallsOf(spaced, 'x.ts')).toBe(2);
    const ns = "import * as rb from './runBinding.js';\nif (rb.runNamesSession(r, id)) {}\n";
    expect(runNamesSessionCallsOf(ns, 'x.ts')).toBe(1);
  });

  it('names every use of the helper that is neither its import nor a call (a re-export, a copy, a value passed on)', () => {
    expect(runNamesSessionEscapesOf("import { runNamesSession } from './runBinding.js';\nrunNamesSession(r, id);\n", 'x.ts')).toEqual([]);
    expect(runNamesSessionEscapesOf("export { runNamesSession as names } from './coord/runBinding.js';\n", 'x.ts')).toHaveLength(1);
    expect(runNamesSessionEscapesOf("import { runNamesSession } from './runBinding.js';\nexport { runNamesSession as names };\n", 'x.ts')).toHaveLength(1);
    expect(runNamesSessionEscapesOf("import { runNamesSession } from './runBinding.js';\nconst f = runNamesSession;\nf(r, id);\n", 'x.ts')).toHaveLength(1);
    expect(runNamesSessionEscapesOf("import { runNamesSession as n } from './runBinding.js';\nruns.filter(n);\n", 'x.ts')).toHaveLength(1);
    expect(runNamesSessionEscapesOf("import * as rb from './runBinding.js';\nconst { runNamesSession: g } = rb;\nconst h = rb.runNamesSession;\n", 'x.ts')).toHaveLength(2);
  });

  it('has no such use under server/src, so the pinned calls are every way the helper is reached', () => {
    expect(runNamesSessionEscapes()).toEqual([]);
  });
});

describe('the store binding readers (ARCH-62 census)', () => {
  const found = storeBindingReaders(readFileSync(`${REPO}/server/src/coord/store.ts`, 'utf8'));

  it('are exactly the pinned readers', () => {
    expect(found).toEqual([...READERS].sort());
  });

  it('count four, the exit ceiling, with the run-keyed readers folded onto run(id) (slice 4)', () => {
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

  it('are gone from the store: neither resolveCoordinator nor resolveWorker is a method of CoordStore', () => {
    expect(FOLDED_RUN_KEYED_READS).toEqual(['resolveCoordinator', 'resolveWorker']);
    for (const n of FOLDED_RUN_KEYED_READS) expect(text).not.toMatch(new RegExp(`^  ${n}\\(`, 'm'));
  });

  it('are answered by the two functions over run(id), which read one run and no series', () => {
    expect([typeof coordinatorOfRun, typeof workerOfRun]).toEqual(['function', 'function']);
  });
});

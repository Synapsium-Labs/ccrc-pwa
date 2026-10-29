/**
 * The server tests a FAST pull request runs (operator ruling 2026-10-28), `.github/ci/fast-plan.mjs`: the tests
 * vitest relates to the change, the map's selection for the changed paths vitest cannot follow (select's
 * `untraced`), every guard suite that scans the whole tree or the diff, and the session-hook suites when the hook's
 * inputs changed, packed by measured duration. Any failure answers the fallback select handed in, never nothing.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs, { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fastSelection, relatedFromVitestList, guardTests, parseUntraced, scanShape, scansSourceTree, treeScanners, GUARD_TESTS, PIN_MAP_CARRIED, SCANNER_MAX_MS, TREE_READER, SESSION_HOOK_TRIGGERS } from '../../.github/ci/fast-plan.mjs';
import { liveTestFiles, vitestFollows } from '../../.github/ci/select-tests.mjs';
import { untracedOutput } from '../../.github/ci/select.mjs';
import { globBase, mergeScans, parseScanLines, readTreeScanners, rootOf, wrapListers } from '../../.github/ci/tree-scanners.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// The static detector's results over this tree, shared by every call below that reads it with readFileSync under ROOT:
// one scan of every live test costs seconds, and a case that asked it afresh four times ran past the 20 s test budget on
// a loaded full-suite shard. The answers are the same, since the memo holds only per-file results of the same source.
const ROOT_SCANS = new Map();
const PLAN = path.join(ROOT, '.github', 'ci', 'fast-plan.mjs');

/** The static detector's positive shapes. The scanShape row holds that the detector finds each; the SELF-CHECK runs each
 *  under the runtime capture and holds that the capture records it (the runtime set is a superset of the static set). */
const STATIC_SCANS: string[] = [
  "const SRC = path.join(here, '..', 'src');\nconst walk = (d) => readdirSync(d).flatMap((n) => walk(n));\nwalk(SRC);",
  "readdirSync(path.join(REPO, 'server', 'src'), { recursive: true });",
  "for (const d of ['server/src', 'shared']) {\n  walk(path.join(root, d));\n}\nfunction walk(x) { return readdirSync(x); }",
  "globSync('**/*.ts', { cwd: 'pwa/src' });",
  "const ccd = readdirSync(path.join(REPO, 'ccd'));",
  "const root = path.join(REPO, 'server/src');\nfs.readdirSync(root);",
  "fsp.readdir(path.join(REPO, 'shared'));",
  "fs.promises.readdir(path.join(REPO, 'pwa', 'src'));",
  "function walk(d) { return fs.readdirSync(d).flatMap((n) => walk(n)); }\nconst all = [...walk('ccd'), ...walk('server/src')];",
  "const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');\nreaddirSync(path.join(root, 'src'));",
  "describe('x', () => {\n  let SRC_DIR = '';\n  beforeAll(() => {\n    SRC_DIR = path.resolve(here, '..', '..', 'agent', 'src');\n  });\n  it('y', () => {\n    readdirSync(SRC_DIR);\n  });\n});",
  // A helper's path to a file directly in ccd/. Not the ccd script's own path: single-definition/core-vocab holds that
  // spelling to ccdWsHelpers.ts alone, and the shape is the same for any file directly in the root.
  "const API = path.resolve(__dirname, '../../ccd/ccrc-api');\nconst ccdDir = path.dirname(API);\nreaddirSync(ccdDir);",
  "const srcRoot = path.resolve(here, '..', 'src');\nconst sources = (dir = srcRoot) =>\n  readdirSync(dir);\nsources();",
  "['deploy', 'ccd'].flatMap((d) => walk(path.join(REPO, d)));\nfunction walk(x) { return readdirSync(x); }",
];

const LIVE = [
  'server/test/a.test.ts',
  'server/test/b.test.ts',
  'server/test/census-w5/redactors.test.ts',
  'server/test/consolidation-census.test.ts',
  'server/test/rings/totality.test.ts',
  'server/test/coord-policy-rings.test.ts',
  'server/test/single-definition/vocabularies.test.ts',
  'server/test/single-definition-pin.test.ts',
  'server/test/deviation-refs.test.ts',
  'server/test/growth-check.test.ts',
  'server/test/ownership.test.ts',
  'server/test/ccd-contexts.test.ts',
  'server/test/dtbd.test.ts',
  'server/test/typecheck-tests.test.ts',
  'server/test/session-hook.test.ts',
  'server/test/session-hook-account-deny.test.ts',
];
const GUARDS = LIVE.filter((f) => !/\/(a|b|session-hook[^/]*)\.test\.ts$/.test(f)).sort();

describe('fastSelection: the related tests, every guard suite, and the hook suites when the hook can be reached', () => {
  it('a change no test relates to still runs every guard suite, and nothing else', () => {
    const sel = fastSelection({ live: LIVE, related: [], guards: GUARDS, changed: ['docs/x.md'] });
    expect(sel.files).toEqual(GUARDS);
    expect(sel.related).toBe(0);
    expect(sel.guards).toBe(GUARDS.length);
    expect(sel.hook).toBe(false);
  });

  it('adds the related tests that are live, once, sorted', () => {
    const sel = fastSelection({ live: LIVE, related: ['server/test/b.test.ts', 'server/test/gone.test.ts', 'server/test/dtbd.test.ts'], guards: GUARDS, changed: ['server/src/x.ts'] });
    expect(sel.files).toEqual([...GUARDS, 'server/test/b.test.ts'].sort());
    expect(sel.related).toBe(2);
  });

  it('runs every session-hook suite when ccd/ccd, ccd/session-hook.sh or shared/api.ts changed, and only then', () => {
    expect(SESSION_HOOK_TRIGGERS).toEqual(['ccd/ccd', 'ccd/session-hook.sh', 'shared/api.ts']);
    for (const trigger of SESSION_HOOK_TRIGGERS) {
      const sel = fastSelection({ live: LIVE, related: [], guards: GUARDS, changed: ['docs/x.md', trigger] });
      expect(sel.hook, trigger).toBe(true);
      expect(sel.files, trigger).toContain('server/test/session-hook.test.ts');
      expect(sel.files, trigger).toContain('server/test/session-hook-account-deny.test.ts');
    }
    expect(fastSelection({ live: LIVE, related: [], guards: GUARDS, changed: ['ccd/ccd-lib.sh'] }).hook).toBe(false);
  });

  it('adds the map\'s untraced selection that is live, and counts it apart from vitest\'s', () => {
    const sel = fastSelection({ live: LIVE, related: ['server/test/a.test.ts'], untraced: ['server/test/a.test.ts', 'server/test/b.test.ts', 'server/test/gone.test.ts'], guards: GUARDS, changed: ['ccd/ccd-account-auth'] });
    expect(sel.files).toEqual([...GUARDS, 'server/test/a.test.ts', 'server/test/b.test.ts'].sort());
    expect(sel.related).toBe(1);
    expect(sel.untraced).toBe(2);
  });
});

describe('the guard suites: patterns, less the map-carried pins, plus every test that reads the tree or the diff itself', () => {
  const live = liveTestFiles(ROOT);
  const guards = guardTests(live, (f) => readFileSync(path.join(ROOT, f), 'utf8'), null, null, ROOT_SCANS);

  it('every guard family the ruling names matches a live test in this tree', () => {
    for (const family of ['census', 'single-definition', 'deviation-refs', 'growth-check', 'ownership', 'rings/', 'ccd-contexts',
      'consolidation-census', 'dtbd', 'typecheck-tests', 'oss-metadata', '-pin.test.ts']) {
      expect(guards.some((f) => f.includes(family)), family).toBe(true);
    }
    expect(guards.some((f) => f.includes('session-hook')), 'a session-hook suite is conditional, never a guard').toBe(false);
  });

  // The suites a review found missing (2026-10-28): each scans `git ls-files`, the diff or named files, so vitest
  // can never relate it, and a red there first showing in the merge queue costs a whole group re-run.
  it('carries topology-clean, oss-metadata, gitignore-secrets and consolidation-path-guard', () => {
    for (const f of ['topology-clean', 'oss-metadata', 'gitignore-secrets', 'consolidation-path-guard']) {
      expect(guards, f).toContain(`server/test/${f}.test.ts`);
    }
  });

  it('TREE_READER is what finds the tree readers: a direct git ls-files / diff / merge-base, never a fixture helper', () => {
    for (const f of ['topology-clean', 'gitignore-secrets', 'consolidation-path-guard', 'source-bytes', 'citations']) {
      expect(TREE_READER.test(readFileSync(path.join(ROOT, 'server', 'test', `${f}.test.ts`), 'utf8')), f).toBe(true);
    }
    expect(TREE_READER.test("execFileSync('git', ['ls-files', '-z'], { cwd: ROOT })")).toBe(true);
    expect(TREE_READER.test("spawnSync('git', ['-C', REPO, 'ls-files'])")).toBe(true);
    expect(TREE_READER.test("execSync('git ls-files -z', { cwd: ROOT })")).toBe(true);
    expect(TREE_READER.test("execFileSync('git', ['merge-base', 'origin/main', 'HEAD'])")).toBe(true);
    expect(TREE_READER.test("h.git(wt, 'ls-files', '-v')")).toBe(false);
    expect(TREE_READER.test("execFileSync('git', ['log', '-1'])")).toBe(false);
  });

  it('every pin suite is a guard or named in PIN_MAP_CARRIED, and every PIN_MAP_CARRIED entry is a live ccd-script pin', () => {
    const pins = live.filter((f) => /-pin\.test\.ts$/.test(f));
    expect(pins.length).toBeGreaterThan(0);
    for (const f of pins) expect(guards.includes(f) || PIN_MAP_CARRIED.includes(f), f).toBe(true);
    for (const f of PIN_MAP_CARRIED) {
      expect(live, `${f} is gone: drop it from PIN_MAP_CARRIED`).toContain(f);
      expect(guards, `${f} is map-carried, not a guard`).not.toContain(f);
      expect(readFileSync(path.join(ROOT, f), 'utf8'), `${f} must pin a ccd script`).toMatch(/\bccd\b/);
    }
  });

  it('an unreadable test file counts as a guard (the safe direction)', () => {
    expect(guardTests(['server/test/x.test.ts'], () => { throw new Error('EACCES'); })).toEqual(['server/test/x.test.ts']);
    expect(guardTests(['server/test/x.test.ts'], () => 'import { x } from "../src/x.js";')).toEqual([]);
    expect(GUARD_TESTS.length).toBeGreaterThan(0);
  });
});

// A whole-tree ratchet passed its pull request run and then ejected that PR from the merge queue: it walks
// server/src with readdirSync and reads every file as text, so vitest relates it to no change. Every test that lists
// a source tree itself is a guard, as long as its file is cheap enough to run on every pull request.
describe('the tree scanners: every test that lists a source tree itself runs on every fast pull request', () => {
  const live = liveTestFiles(ROOT);
  const read = (f: string): string => readFileSync(path.join(ROOT, f), 'utf8');

  it('a pull request touching only server/src/coord/childReclaim.ts runs the plain io.readdir ratchet (fleetio-contract)', () => {
    const guards = guardTests(live, read, null, null, ROOT_SCANS);
    const sel = fastSelection({ live, related: [], guards, changed: ['server/src/coord/childReclaim.ts'] });
    expect(sel.files).toContain('server/test/fleetio-contract.test.ts');
  });

  it('the scanners this tree has are found, each by the call that lists a source root', () => {
    const memo = new Map();
    for (const f of ['fleetio-contract', 'coord-routes-single-file', 'landing-words', 'no-routing-keystroke-from-server', 'readme-holds',
      'run-binding', 'license', 'module-format',
      // Namespaced and spread calls (`fs.readdirSync(`, `[...walk('ccd')]`), a package dir with 'src' joined on, a name
      // assigned in a beforeAll, `path.dirname(<a helper's ccd/ccd>)`, a default parameter aliasing a root.
      'ccd-id-cap', 'ws-collect-wiring', 'ccd-tmux-anchor', 'ccd-collect-recycle-pins', 'child-reclaim-generation',
      'transcript-ladder', 'whitelist-subset', 'ccd-reg-id-ok', 'macos-platform', 'registry-refused-census', 'fleet-health']) {
      expect(scansSourceTree(`server/test/${f}.test.ts`, read, memo), f).not.toBeNull();
    }
    // Through a census helper: the test calls a helper's scanner, and lists nothing itself.
    expect(scansSourceTree('server/test/census-w5/accountMarkers.test.ts', read, memo)).not.toBeNull();
    // A fixture suite that lists its own temp dirs, or a fixture tree's `ccd`, is not a scanner.
    for (const f of ['ccrc-update-kept', 'tmp-sweep', 'ccrc-sweep-window', 'history-lib']) {
      expect(scansSourceTree(`server/test/${f}.test.ts`, read, memo), f).toBeNull();
    }
  });

  it('scanShape: a lister called on a source root, a name bound to one, a loop over roots; never a fixture dir or a comment', () => {
    const scans = (src: string): boolean => scanShape(src).hit !== null;
    for (const src of STATIC_SCANS) expect(scans(src), src).toBe(true);
    // A file or a subdirectory under a root, a fixture base, a comment, a root that is only read: not a scan.
    expect(scans("readdirSync(path.join(REPO, 'shared', 'api.ts'));")).toBe(false);
    expect(scans("readdirSync(path.join(here, '..', 'src', 'coord'));")).toBe(false);
    expect(scans("readdirSync(join(home, 'ccd'));")).toBe(false);
    expect(scans("// readdirSync(path.join(REPO, 'server/src'))\nreaddirSync(tmp);")).toBe(false);
    expect(scans("readFileSync(path.join(REPO, 'shared'), 'utf8'); readdirSync(tmp);")).toBe(false);
    // A loop variable is bound for the loop's body only, not for a later call that reuses the name.
    expect(scans("for (const f of ['server/src']) {\n  x(f);\n}\nreaddirSync(f);")).toBe(false);
    // Reached through a namespace or an object, or spread: the name lists, whatever it is reached through.
    // A name bound to a package dir, with 'src' joined on; never with a subdirectory joined after it.
    expect(scans("const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');\nreaddirSync(path.join(root, 'src', 'coord'));")).toBe(false);
    // A name declared first and assigned a root later (a beforeAll): bound for its declaration's block.
    // The directory of a file directly in a root; a default parameter that aliases a root binding.
    // A root after another literal segment is a fixture's path, not the tree; an array of roots is still roots.
    expect(scans("readdirSync(join(home, '.local', 'bin', 'ccd'));")).toBe(false);
  });

  it('a scanner whose file measured over SCANNER_MAX_MS is left to the merge queue; an unmeasured one runs', () => {
    const light = 'server/test/fleetio-contract.test.ts';
    const scanners = treeScanners(live, read, null, null, ROOT_SCANS).map((s) => s.file);
    expect(scanners).toContain(light);
    // A scanner that is neither a pattern guard nor a TREE_READER, so the cap is the only thing that can drop it.
    const heavyOne = scanners.find((f) => !GUARD_TESTS.some((re) => re.test(f)) && !TREE_READER.test(read(f)) && f !== light) ?? '';
    expect(heavyOne).not.toBe('');
    const guards = guardTests(live, read, { [light]: 100, [heavyOne]: SCANNER_MAX_MS + 1 }, null, ROOT_SCANS);
    expect(guards).toContain(light);
    expect(guards).not.toContain(heavyOne);
    expect(guardTests(live, read, {}, null, ROOT_SCANS)).toContain(heavyOne);
    // The cap never drops a pattern guard.
    expect(guardTests(live, read, { 'server/test/deviation-refs.test.ts': 10 * SCANNER_MAX_MS }, null, ROOT_SCANS)).toContain('server/test/deviation-refs.test.ts');
  });

  // The capture holds the fallback: every shape the static detector finds, run for real under the runtime capture, is
  // recorded. A static shape the capture missed fails here, unit-level, instead of a scanner dropping out of the plan
  // when the artifact replaces the detector.
  it('SELF-CHECK: the runtime capture records every static positive shape (runtime is a superset of static)', async () => {
    const here = path.join(ROOT, 'server', 'test');
    const roots = new Set<string>();
    const match = rootOf(ROOT, tmpdir(), ROOT);
    const restore = wrapListers(fs, (listed: unknown, cwd: string | undefined) => { const r = match(listed, cwd); if (r) roots.add(r); });
    syncBuiltinESMExports();
    const missed: string[] = [];
    try {
      for (const src of STATIC_SCANS) {
        roots.clear();
        const run = (fn: () => void): void => { fn(); };
        const body = src.replace(/import\.meta\.url/g, 'importMetaUrl');
        // A fixture runs against the real tree; a recursive walk that wanders off it throws, after the first listing.
        try {
          const r = new Function('path', 'fs', 'fsp', 'readdirSync', 'globSync', 'fileURLToPath', 'REPO', 'here', 'root', '__dirname', 'importMetaUrl', 'home', 'tmp', 'describe', 'beforeAll', 'it', 'x', `return (async () => {\n${body}\n})();`)(
            path, fs, fs.promises, fs.readdirSync, fs.globSync, fileURLToPath, ROOT, here, ROOT, here, `file://${here}/x.test.ts`, tmpdir(), tmpdir(), (_: string, f: () => void) => run(f), run, (_: string, f: () => void) => run(f), () => {},
          ) as Promise<unknown>;
          await r.catch(() => {});
        } catch { /* recorded before it threw */ }
        if (roots.size === 0) missed.push(src);
      }
    } finally {
      restore();
      syncBuiltinESMExports();
    }
    expect(STATIC_SCANS.length).toBeGreaterThan(10);
    expect(missed, 'static shapes the capture does not record').toEqual([]);
  });

  it('the map-carried pins stay out even when they scan', () => {
    const scanners = treeScanners(live, read, null, null, ROOT_SCANS).map((s) => s.file);
    for (const f of PIN_MAP_CARRIED) expect(scanners, f).not.toContain(f);
  });
});

describe('the tree-scan capture (tree-scanners.mjs): what a full run records, and how the plan reads it', () => {
  /** Runs `fn` with fs's listers wrapped (and the ESM named imports synced), answering the roots it listed. */
  const captured = async (fn: () => unknown): Promise<string[]> => {
    const roots = new Set<string>();
    const match = rootOf(ROOT);
    const restore = wrapListers(fs, (listed: unknown, cwd: string | undefined) => { const r = match(listed, cwd); if (r) roots.add(r); });
    syncBuiltinESMExports();
    try { await fn(); } finally { restore(); syncBuiltinESMExports(); }
    return [...roots].sort();
  };

  it('a test that lists path.dirname(<a file in ccd/>) is recorded as a ccd scan, through the named import too', async () => {
    const API = path.join(ROOT, 'ccd', 'ccrc-api');
    expect(await captured(() => readdirSync(path.dirname(API)))).toEqual(['ccd']);
    expect(await captured(() => fs.promises.readdir(path.join(ROOT, 'server', 'src', 'coord')))).toEqual(['server/src']);
    expect(await captured(() => fs.globSync('**/*.ts', { cwd: path.join(ROOT, 'pwa', 'src') }))).toEqual(['pwa/src']);
    expect(await captured(() => fs.opendirSync(path.join(ROOT, 'shared')).closeSync())).toEqual(['shared']);
    // A listing that throws is still a listing, and the error reaches the caller unchanged.
    let err: unknown = null;
    expect(await captured(() => { try { readdirSync(path.join(ROOT, 'agent', 'src', 'no-such-dir')); } catch (e) { err = e; } })).toEqual(['agent/src']);
    expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
    // Under the full run's own capture (fs already wrapped), a second capture records too, and both see the listing.
    let inner: string[] = [];
    expect(await captured(async () => { inner = await captured(() => readdirSync(path.join(ROOT, 'shared'))); })).toEqual(['shared']);
    expect(inner).toEqual(['shared']);
  });

  it('a fixture temp dir is not recorded, even one holding a ccd/ or server/src', async () => {
    const box = mkdtempSync(path.join(tmpdir(), 'ccrc-scan-fixture-'));
    mkdirSync(path.join(box, 'ccd'));
    mkdirSync(path.join(box, 'server', 'src'), { recursive: true });
    expect(await captured(() => { readdirSync(path.join(box, 'ccd')); readdirSync(path.join(box, 'server', 'src')); readdirSync(box); })).toEqual([]);
    // Nor a file or directory outside the five roots, nor a read that lists nothing.
    expect(await captured(() => { readdirSync(path.join(ROOT, 'docs')); readFileSync(path.join(ROOT, 'shared', 'api.ts')); })).toEqual([]);
    // A repository that itself sits in the temp tree still has its roots.
    const repo = mkdtempSync(path.join(tmpdir(), 'ccrc-scan-repo-'));
    expect(rootOf(repo, tmpdir())(path.join(repo, 'ccd'))).toBe('ccd');
    expect(rootOf(repo, tmpdir())(path.join(box, 'ccd'))).toBeNull();
    // The documented blind spot: a listing of an ANCESTOR of the roots (the repository, `server/`) is not recorded,
    // which is why the plan unions the record with the static detector.
    expect(rootOf(ROOT)(ROOT)).toBeNull();
    expect(rootOf(ROOT)(path.join(ROOT, 'server'))).toBeNull();
  });

  it('globBase, the shard lines and their merge', () => {
    expect(globBase('**/*.ts')).toBe('.');
    expect(globBase('server/src/**/*.ts')).toBe('server/src');
    expect(globBase('/abs/ccd/*')).toBe('/abs/ccd');
    const lines = parseScanLines('{"file":"server/test/a.test.ts","roots":["ccd"]}\n{torn\n{"file":"server/test/a.test.ts","roots":["shared"]}\n{"file":"server/test/b.test.ts","roots":["docs"]}\n');
    expect(lines).toHaveLength(2);
    expect(mergeScans(lines)).toEqual({ 'server/test/a.test.ts': ['ccd', 'shared'] });
    // The CLI times-build runs: every shard's lines into one { file: roots }, which readTreeScanners reads back.
    const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-scans-merge-'));
    writeFileSync(path.join(dir, '1.jsonl'), '{"file":"server/test/a.test.ts","roots":["ccd"]}\n');
    writeFileSync(path.join(dir, '2.jsonl'), '{"file":"server/test/b.test.ts","roots":["server/src"]}\n{"file":"server/test/a.test.ts","roots":["ccd"]}\n');
    const r = spawnSync('node', [path.join(ROOT, '.github', 'ci', 'tree-scanners.mjs'), 'merge', '--out', path.join(dir, 'out', 'tree-scanners.json'), path.join(dir, '1.jsonl'), path.join(dir, '2.jsonl')], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(readTreeScanners(path.join(dir, 'out', 'tree-scanners.json'))).toEqual({ 'server/test/a.test.ts': ['ccd'], 'server/test/b.test.ts': ['server/src'] });
    expect(spawnSync('node', [path.join(ROOT, '.github', 'ci', 'tree-scanners.mjs'), 'merge', '--out', path.join(dir, 'x.json')], { encoding: 'utf8' }).status).not.toBe(0);
  });

  it('readTreeScanners reads the artifact, and answers null when it is missing or not that shape', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-tree-scanners-'));
    const ok = path.join(dir, 'ok.json');
    writeFileSync(ok, JSON.stringify({ 'server/test/a.test.ts': ['server/src'] }));
    expect(readTreeScanners(ok)).toEqual({ 'server/test/a.test.ts': ['server/src'] });
    expect(readTreeScanners(path.join(dir, 'missing.json'))).toBeNull();
    expect(readTreeScanners(undefined)).toBeNull();
    for (const [name, body] of [['torn', '{'], ['list', '[]'], ['root', '{"server/test/a.test.ts":["docs"]}'], ['key', '{"/etc/x":["ccd"]}']]) {
      writeFileSync(path.join(dir, `${name}.json`), body);
      expect(readTreeScanners(path.join(dir, `${name}.json`)), name).toBeNull();
    }
  });

  it('the plan adds every recorded scanner under SCANNER_MAX_MS, unioned with the static ones; a missing artifact falls back to static', () => {
    const live = liveTestFiles(ROOT);
    const read = (f: string): string => readFileSync(path.join(ROOT, f), 'utf8');
    // tmp-sweep is no scanner to the static detector; recorded, it is one. fleetio-contract is a static scanner the
    // recording left out (a lost shard, a listing the capture cannot see): the union keeps it.
    const recordedOnly = 'server/test/tmp-sweep.test.ts';
    const staticOnly = 'server/test/fleetio-contract.test.ts';
    const heavy = 'server/test/ccrc-sweep-window.test.ts';
    expect(scansSourceTree(recordedOnly, read, ROOT_SCANS)).toBeNull();
    const recorded = { [recordedOnly]: ['server/src'], [heavy]: ['ccd'] };
    const guards = guardTests(live, read, { [heavy]: SCANNER_MAX_MS + 1 }, recorded, ROOT_SCANS);
    expect(guards).toContain(recordedOnly);
    expect(guards).toContain(staticOnly);
    expect(guards).not.toContain(heavy);
    const staticSet = treeScanners(live, read, null, null, ROOT_SCANS).map((t) => t.file);
    expect(staticSet).toContain(staticOnly);
    expect(staticSet).not.toContain(recordedOnly);
    expect(treeScanners(live, read, null, recorded, ROOT_SCANS).map((t) => t.file).sort()).toEqual([...new Set([...staticSet, heavy, recordedOnly])].sort());
    // Every static scanner is in the guard set with the record as without it (none is over the cap here).
    for (const f of staticSet) expect(guards, f).toContain(f);
    // The pattern guards and the tree readers stay, whatever was recorded.
    expect(guards).toContain('server/test/deviation-refs.test.ts');
    // No artifact (or an unreadable one): the static detector, exactly as before.
    const fallback = guardTests(live, read, null, readTreeScanners(path.join(tmpdir(), 'no-such-tree-scanners.json')), ROOT_SCANS);
    expect(fallback).toEqual(guardTests(live, read, null, null, ROOT_SCANS));
    expect(fallback).toContain(staticOnly);
    expect(fallback).not.toContain(recordedOnly);
  });
});

describe('the untraced half: what the map selects for the paths vitest cannot follow', () => {
  it('vitestFollows is the JS/TS modules of server/ and shared/ only', () => {
    for (const p of ['server/src/x.ts', 'server/test/x.test.ts', 'shared/api.ts', 'shared/x.mjs', 'server/src/x.js']) expect(vitestFollows(p), p).toBe(true);
    for (const p of ['ccd/ccd', 'ccd/ccd-account-auth', 'ccd/x.py', 'server/test/fixtures/x.json', 'server/src/x.sql', 'pwa/src/x.ts', 'docs/x.md', 'deploy/x.sh']) {
      expect(vitestFollows(p), p).toBe(false);
    }
  });

  it('select\'s output: the list as JSON, `full` when nothing bounds it, empty off a pull request', () => {
    expect(untracedOutput({ isPr: false, untraced: ['a'], changedPaths: null })).toBe('');
    expect(untracedOutput({ isPr: true, untraced: ['server/test/a.test.ts'], changedPaths: null })).toBe('["server/test/a.test.ts"]');
    expect(untracedOutput({ isPr: true, untraced: 'full', changedPaths: ['ccd/ccd'] })).toBe('full');
    // No usable map: an all-TypeScript change needs none; anything else, or an unreadable diff, is unbounded.
    expect(untracedOutput({ isPr: true, untraced: undefined, changedPaths: ['server/src/x.ts'] })).toBe('[]');
    expect(untracedOutput({ isPr: true, untraced: undefined, changedPaths: ['server/src/x.ts', 'ccd/ccd'] })).toBe('full');
    expect(untracedOutput({ isPr: true, untraced: undefined, changedPaths: null })).toBe('full');
  });

  it('parseUntraced reads the list, and refuses `full`, nothing, or another shape', () => {
    expect(parseUntraced('["server/test/a.test.ts"]\n')).toEqual(['server/test/a.test.ts']);
    expect(parseUntraced('[]')).toEqual([]);
    expect(() => parseUntraced('full')).toThrow(/cannot bound/);
    expect(() => parseUntraced('')).toThrow(/no untraced/);
    expect(() => parseUntraced('{"a":1}')).toThrow(/not an array/);
  });
});

describe('relatedFromVitestList: a `vitest list --filesOnly --json` report, repo-relative', () => {
  it('turns absolute paths into repo-relative ones', () => {
    expect(relatedFromVitestList([{ file: path.join(ROOT, 'server', 'test', 'a.test.ts') }], ROOT)).toEqual(['server/test/a.test.ts']);
  });

  it('refuses a report that is not that shape, or a path outside the repository', () => {
    expect(() => relatedFromVitestList({ files: [] }, ROOT)).toThrow(/not an array/);
    expect(() => relatedFromVitestList([{ name: 'x' }], ROOT)).toThrow(/no file/);
    expect(() => relatedFromVitestList([{ file: '/elsewhere/x.test.ts' }], ROOT)).toThrow(/outside the repository/);
  });
});

describe('fast-plan.mjs: the CLI plans the shards, and falls back rather than answer nothing', () => {
  const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: cwd, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  const repo = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-fast-plan-'));
    for (const f of LIVE) {
      mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
      writeFileSync(path.join(dir, f), '');
    }
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'base');
    mkdirSync(path.join(dir, 'shared'), { recursive: true });
    writeFileSync(path.join(dir, 'shared', 'api.ts'), 'export {};\n');
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'change');
    return dir;
  };
  const run = (dir: string, related: string | null, extra: string[] = [], untraced = '[]'): { status: number | null, out: Record<string, string> } => {
    const out = path.join(dir, '..', `out-${path.basename(dir)}-${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(out, '');
    const untracedFile = path.join(dir, '..', `untraced-${path.basename(dir)}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(untracedFile, untraced);
    const args = [PLAN, '--repo', dir, '--base', 'HEAD~1', '--related', related ?? path.join(dir, 'missing.json'), '--untraced', untracedFile, ...extra];
    const r = spawnSync('node', args, { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: '' }, encoding: 'utf8' });
    const outputs = Object.fromEntries(readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    return { status: r.status, out: outputs };
  };

  it('an empty report plans the guards and the hook suites the shared/api.ts change reaches', () => {
    const dir = repo();
    const rel = path.join(dir, '..', `rel-${path.basename(dir)}.json`);
    writeFileSync(rel, '');
    const r = run(dir, rel, ['--fallback-matrix', '{"include":[]}', '--fallback-count', '9']);
    expect(r.status).toBe(0);
    expect(r.out.fallback).toBe('');
    expect(r.out.count).toBe(String(GUARDS.length + 2));
    const files = (JSON.parse(r.out.server_matrix) as { include: Array<{ files: string }> }).include.flatMap((s) => s.files.split(' '));
    expect(files.sort()).toEqual([...GUARDS, 'server/test/session-hook.test.ts', 'server/test/session-hook-account-deny.test.ts'].map((f) => f.replace(/^server\//, '')).sort());
  });

  it('a related report adds its tests', () => {
    const dir = repo();
    const rel = path.join(dir, '..', `rel-${path.basename(dir)}.json`);
    writeFileSync(rel, JSON.stringify([{ file: path.join(dir, 'server', 'test', 'a.test.ts') }]));
    const r = run(dir, rel, ['--fallback-matrix', '{"include":[]}', '--fallback-count', '9']);
    expect(r.out.count).toBe(String(GUARDS.length + 3));
    expect(r.out.server_matrix).toContain('test/a.test.ts');
  });

  it('an untraced list adds its tests; `full` answers the fallback', () => {
    const dir = repo();
    const rel = path.join(dir, '..', `rel-${path.basename(dir)}.json`);
    writeFileSync(rel, '[]');
    const r = run(dir, rel, ['--fallback-matrix', '{"include":[]}', '--fallback-count', '9'], '["server/test/b.test.ts"]');
    expect(r.out.count).toBe(String(GUARDS.length + 3));
    expect(r.out.server_matrix).toContain('test/b.test.ts');
    const f = run(dir, rel, ['--fallback-matrix', '{"include":[{"shard":1}]}', '--fallback-count', '9'], 'full');
    expect(f.status).toBe(0);
    expect(f.out.count).toBe('9');
    expect(f.out.fallback).toMatch(/cannot bound/);
  });

  it('no report (vitest list failed) answers the fallback, with the reason', () => {
    const dir = repo();
    const r = run(dir, null, ['--fallback-matrix', '{"include":[{"shard":1}]}', '--fallback-count', '9']);
    expect(r.status).toBe(0);
    expect(r.out.server_matrix).toBe('{"include":[{"shard":1}]}');
    expect(r.out.count).toBe('9');
    expect(r.out.fallback).not.toBe('');
  });

  it('--scanners hands in the recorded tree scanners; a missing file plans as without it', () => {
    const dir = repo();
    const rel = path.join(dir, '..', `rel-${path.basename(dir)}.json`);
    writeFileSync(rel, '[]');
    const scanners = path.join(dir, '..', `scanners-${path.basename(dir)}.json`);
    writeFileSync(scanners, JSON.stringify({ 'server/test/a.test.ts': ['server/src'] }));
    const r = run(dir, rel, ['--fallback-matrix', '{"include":[]}', '--fallback-count', '9', '--scanners', scanners]);
    expect(r.status).toBe(0);
    expect(r.out.count).toBe(String(GUARDS.length + 3));
    expect(r.out.server_matrix).toContain('test/a.test.ts');
    const none = run(dir, rel, ['--fallback-matrix', '{"include":[]}', '--fallback-count', '9', '--scanners', path.join(dir, 'missing.json')]);
    expect(none.out.count).toBe(String(GUARDS.length + 2));
    expect(none.out.server_matrix).not.toContain('test/a.test.ts');
  });

  it('a failure with no fallback handed in fails the step: never a green over nothing', () => {
    const dir = repo();
    const r = run(dir, null);
    expect(r.status).not.toBe(0);
    expect(r.out.server_matrix).toBeUndefined();
  });
});

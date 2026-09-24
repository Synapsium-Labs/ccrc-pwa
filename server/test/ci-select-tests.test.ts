// Task 5 (spec §6, CONTRACT.md `.github/ci/select-tests.mjs`): the selector.
// Mocked-`existsAt` unit tests cover every rule and every `fullTrigger`
// clause in isolation; the `--- git-backed integration ---` block builds real
// fixture repos (this repo's fixture-identity idiom: `GIT_AUTHOR_EMAIL
// fixture@example.invalid`, matching `buildinfo.test.ts`/`build-release.test.ts`)
// for `readChanges`/`liveTestFiles`/`gitExistsAt` themselves and for the
// Review Focus scenarios, which are about real ancestor existence on a real
// tree. Mutation table at the bottom.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import {
  readChanges, liveTestFiles, gitExistsAt, fullTrigger, selectTests, RULE_NAMES,
} from '../../.github/ci/select-tests.mjs';
import { buildMap, refreshMap, RECORDS_FORMAT } from '../../.github/ci/testmap.mjs';
import type { DepRecord, TestMap, TestRecord } from '../../.github/ci/testmap.mjs';

const SHA_A = 'a'.repeat(40);

function emptyDep(): DepRecord {
  return { read: [], probed: [], listed: [], subtree: [], git: false };
}

function rec(overrides: Partial<TestRecord> = {}): TestRecord {
  return { ...emptyDep(), unknown: false, ...overrides };
}

// ─── fullTrigger ────────────────────────────────────────────────────────

describe('fullTrigger', () => {
  const baseline = { read: ['shared/mark.mjs'], probed: ['server/probed-only.ts'], listed: ['server/test'], subtree: ['deploy/linked'], git: false };

  it('package.json anywhere', () => {
    const reason = fullTrigger([{ status: 'M', path: 'server/package.json', symlink: false }], baseline);
    expect(reason).toMatch(/package manifest/);
  });

  it('package-lock.json anywhere', () => {
    const reason = fullTrigger([{ status: 'M', path: 'server/package-lock.json', symlink: false }], baseline);
    expect(reason).toMatch(/package manifest/);
  });

  it('vitest config, including the exact-list config', () => {
    expect(fullTrigger([{ status: 'M', path: 'server/vitest.config.ts', symlink: false }], baseline))
      .toMatch(/vitest config/);
    expect(fullTrigger([{ status: 'A', path: 'server/vitest.select.config.ts', symlink: false }], baseline))
      .toMatch(/vitest config/);
  });

  it('tsconfig*.json', () => {
    expect(fullTrigger([{ status: 'M', path: 'server/tsconfig.json', symlink: false }], baseline))
      .toMatch(/tsconfig/);
  });

  it('anything under .github/', () => {
    expect(fullTrigger([{ status: 'M', path: '.github/workflows/ci.yml', symlink: false }], baseline))
      .toMatch(/pipeline path/);
  });

  it('.gitattributes at any depth (checkout applies it outside any traced process)', () => {
    expect(fullTrigger([{ status: 'A', path: '.gitattributes', symlink: false }], baseline)).toMatch(/checkout attributes/);
    expect(fullTrigger([{ status: 'M', path: 'ccd/.gitattributes', symlink: false }], baseline)).toMatch(/checkout attributes/);
  });

  it('.npmrc at any depth (npm ci reads it before any test runs)', () => {
    expect(fullTrigger([{ status: 'M', path: 'server/.npmrc', symlink: false }], baseline)).toMatch(/npm config/);
  });

  it('anything under server/scripts/ (the install lifecycle scripts)', () => {
    expect(fullTrigger([{ status: 'M', path: 'server/scripts/fix-node-pty-helper.mjs', symlink: false }], baseline))
      .toMatch(/install script/);
  });

  it('a symlinked path', () => {
    expect(fullTrigger([{ status: 'A', path: 'server/src/link.ts', symlink: true }], baseline))
      .toMatch(/symlink/);
  });

  it('a path in baseline.read', () => {
    expect(fullTrigger([{ status: 'M', path: 'shared/mark.mjs', symlink: false }], baseline))
      .toMatch(/baseline reads/);
  });

  it('a path in baseline.probed', () => {
    expect(fullTrigger([{ status: 'A', path: 'server/probed-only.ts', symlink: false }], baseline))
      .toMatch(/baseline probed/);
  });

  it('a path at or under a baseline.subtree directory (every test\'s startup linked it whole)', () => {
    expect(fullTrigger([{ status: 'M', path: 'deploy/linked/x.sh', symlink: false }], baseline))
      .toBe('baseline links this directory: deploy/linked/x.sh');
    expect(fullTrigger([{ status: 'A', path: 'deploy/linked-not/x.sh', symlink: false }], baseline)).toBeNull();
  });

  it('a file added directly in a baseline.listed dir is NOT a trigger (server/test/new.test.ts)', () => {
    // The baseline lists server/test because vitest's include glob walks it —
    // with a literal include too (measured). Were that listing a trigger,
    // every PR that adds or deletes a test file (29 of the last 60 merged)
    // would run the full suite. A test that walks server/test in its OWN
    // right keeps that listing in its record (records are split by process,
    // testmap.mjs) and is selected by rule 5 instead.
    expect(fullTrigger([{ status: 'A', path: 'server/test/new.test.ts', symlink: false }], baseline)).toBeNull();
    expect(fullTrigger([{ status: 'D', path: 'server/test/old.test.ts', symlink: false }], baseline)).toBeNull();
  });

  it('no trigger -> null', () => {
    expect(fullTrigger([{ status: 'M', path: 'server/src/unrelated.ts', symlink: false }], baseline)).toBeNull();
    expect(fullTrigger([], baseline)).toBeNull();
  });
});

// ─── selectTests: rule-by-rule (mocked existsAt) ───────────────────────────

describe('selectTests rule 1 (NEW)', () => {
  it('selects a test file absent from the map', () => {
    const map: TestMap = { format: 1, sha: SHA_A, baseline: emptyDep(), tests: {} };
    const sel = selectTests({
      map, changes: [{ status: 'A', path: 'server/test/new.test.ts', symlink: false }],
      liveTests: ['server/test/new.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/new.test.ts', rule: 1, path: 'server/test/new.test.ts' }] });
  });

  it('selects a test file absent from the map even with NO changes at all (isolates the absent-from-map clause from the own-change clause)', () => {
    const map: TestMap = { format: 1, sha: SHA_A, baseline: emptyDep(), tests: {} };
    const sel = selectTests({
      map, changes: [], liveTests: ['server/test/never-traced.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/never-traced.test.ts', rule: 1, path: 'server/test/never-traced.test.ts' }] });
  });

  it('selects a test file that is itself modified, even though it has a map entry', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/known.test.ts': rec() },
    };
    const sel = selectTests({
      map, changes: [{ status: 'M', path: 'server/test/known.test.ts', symlink: false }],
      liveTests: ['server/test/known.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/known.test.ts', rule: 1, path: 'server/test/known.test.ts' }] });
  });
});

describe('selectTests rule 2 (ALWAYS: unknown or git)', () => {
  it('selects an unknown-trace test on an unrelated change', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/flaky.test.ts': rec({ unknown: true, why: 'timeout' }) },
    };
    const sel = selectTests({
      map, changes: [{ status: 'M', path: 'server/src/unrelated.ts', symlink: false }],
      liveTests: ['server/test/flaky.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/flaky.test.ts', rule: 2, path: 'server/test/flaky.test.ts' }] });
  });

  it('selects a test that reads .git on an unrelated change', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/topology-clean.test.ts': rec({ git: true }) },
    };
    const sel = selectTests({
      map, changes: [{ status: 'M', path: 'server/src/unrelated.ts', symlink: false }],
      liveTests: ['server/test/topology-clean.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/topology-clean.test.ts', rule: 2, path: 'server/test/topology-clean.test.ts' }] });
  });
});

describe('selectTests rule 3 (READ)', () => {
  it('fires on a direct M match', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/known.test.ts': rec({ read: ['server/src/dep.ts'] }) },
    };
    const sel = selectTests({
      map, changes: [{ status: 'M', path: 'server/src/dep.ts', symlink: false }],
      liveTests: ['server/test/known.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/known.test.ts', rule: 3, path: 'server/src/dep.ts' }] });
  });

  it('fires via the gone-ancestor rule: a whole directory deleted, a test only read (stat\'ed) the directory (Review Focus a, mocked)', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/stats-dir.test.ts': rec({ read: ['server/src/gonedir'] }) },
    };
    // server/src/gonedir/inner/file.ts deleted; at HEAD neither
    // server/src/gonedir/inner nor server/src/gonedir exist any more, but
    // server/src still does.
    const existsAt = (ref: string, p: string) => {
      if (ref !== 'HEAD') return true;
      if (p === 'server/src/gonedir/inner' || p === 'server/src/gonedir') return false;
      return true;
    };
    const sel = selectTests({
      map, changes: [{ status: 'D', path: 'server/src/gonedir/inner/file.ts', symlink: false }],
      liveTests: ['server/test/stats-dir.test.ts'], existsAt,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/stats-dir.test.ts', rule: 3, path: 'server/src/gonedir/inner/file.ts' }] });
  });
});

describe('selectTests rule 4 (PROBED, added paths only)', () => {
  it('fires on an added path the test probed and found absent', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/probes.test.ts': rec({ probed: ['server/src/maybe.ts'] }) },
    };
    const sel = selectTests({
      map, changes: [{ status: 'A', path: 'server/src/maybe.ts', symlink: false }],
      liveTests: ['server/test/probes.test.ts'], existsAt: () => true, // parent pre-existed -> Pa = [path]
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/probes.test.ts', rule: 4, path: 'server/src/maybe.ts' }] });
  });

  it('does NOT fire for a deleted path in probed (spec: probed selects on ADD only)', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/probes.test.ts': rec({ probed: ['server/src/maybe.ts'] }) },
    };
    const sel = selectTests({
      map, changes: [{ status: 'D', path: 'server/src/maybe.ts', symlink: false }],
      liveTests: ['server/test/probes.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [] });
  });
});

describe('selectTests rule 5 (LISTED, added/deleted only)', () => {
  it('fires when a file lands directly inside a listed directory', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/lister.test.ts': rec({ listed: ['server/src/listed-dir'] }) },
    };
    const sel = selectTests({
      map, changes: [{ status: 'A', path: 'server/src/listed-dir/direct.ts', symlink: false }],
      liveTests: ['server/test/lister.test.ts'], existsAt: () => true, // dir already existed -> Pa = [path], E = the dir
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/lister.test.ts', rule: 5, path: 'server/src/listed-dir/direct.ts' }] });
  });

  it('fires when a brand-new subdirectory appears under a listed dir (Review Focus c, mocked)', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/lister.test.ts': rec({ listed: ['server/src/listed-dir'] }) },
    };
    const existsAt = (ref: string, p: string) => {
      if (ref !== SHA_A) return true;
      if (p === 'server/src/listed-dir/newsub') return false; // new subdirectory
      return true; // server/src/listed-dir itself already existed
    };
    const sel = selectTests({
      map, changes: [{ status: 'A', path: 'server/src/listed-dir/newsub/x.ts', symlink: false }],
      liveTests: ['server/test/lister.test.ts'], existsAt,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/lister.test.ts', rule: 5, path: 'server/src/listed-dir/newsub/x.ts' }] });
  });

  it('does NOT fire for a modified path', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/lister.test.ts': rec({ listed: ['server/src/listed-dir'] }) },
    };
    const sel = selectTests({
      map, changes: [{ status: 'M', path: 'server/src/listed-dir/direct.ts', symlink: false }],
      liveTests: ['server/test/lister.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [] });
  });

  it('handles a root-level entry directory (E = "." ) without crashing', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/root-lister.test.ts': rec({ listed: ['.'] }) },
    };
    const existsAt = (ref: string, p: string) => {
      if (ref !== SHA_A) return true;
      if (p === 'newroot') return false; // brand-new top-level directory
      return true;
    };
    const sel = selectTests({
      map, changes: [{ status: 'A', path: 'newroot/file.ts', symlink: false }],
      liveTests: ['server/test/root-lister.test.ts'], existsAt,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/root-lister.test.ts', rule: 5, path: 'newroot/file.ts' }] });
  });
});

describe('selectTests rule 6 (SUBTREE: a directory the test linked whole)', () => {
  // A test that symlinks a repo directory into a fixture home and then only stats or probes a file through the
  // link records the directory itself (trace-to-deps.mjs): no resolved path names the file. So ANY change at or
  // under that directory selects it — added, modified or deleted.
  const map: TestMap = {
    format: 1, sha: SHA_A, baseline: emptyDep(),
    tests: {
      'server/test/linker.test.ts': rec({ subtree: ['deploy'] }),
      'server/test/root-linker.test.ts': rec({ subtree: ['.'] }),
      'server/test/other.test.ts': rec({ read: ['server/src/other.ts'] }),
    },
  };
  const live = ['server/test/linker.test.ts', 'server/test/other.test.ts'];

  it('an added, a modified and a deleted path under the directory each select it, naming the path', () => {
    for (const status of ['A', 'M', 'D'] as const) {
      const sel = selectTests({ map, changes: [{ status, path: 'deploy/nested/x.mjs', symlink: false }], liveTests: live, existsAt: () => true });
      expect(sel, status).toEqual({ mode: 'selected', tests: [{ file: 'server/test/linker.test.ts', rule: 6, path: 'deploy/nested/x.mjs' }] });
    }
  });

  it('the directory path itself counts; a sibling that only shares its prefix does not', () => {
    expect(selectTests({ map, changes: [{ status: 'M', path: 'deploy', symlink: false }], liveTests: live, existsAt: () => true }))
      .toEqual({ mode: 'selected', tests: [{ file: 'server/test/linker.test.ts', rule: 6, path: 'deploy' }] });
    expect(selectTests({ map, changes: [{ status: 'M', path: 'deploy2/x.mjs', symlink: false }], liveTests: live, existsAt: () => true }))
      .toEqual({ mode: 'selected', tests: [] });
  });

  it('the rules are named for the reason table, 1 to 6', () => {
    expect(RULE_NAMES).toEqual({ 1: 'NEW', 2: 'ALWAYS', 3: 'READ', 4: 'PROBED', 5: 'LISTED', 6: 'SUBTREE' });
  });

  it('a link to the repository root (".") takes every change', () => {
    const sel = selectTests({ map, changes: [{ status: 'M', path: 'pwa/src/x.ts', symlink: false }], liveTests: ['server/test/root-linker.test.ts'], existsAt: () => true });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/root-linker.test.ts', rule: 6, path: 'pwa/src/x.ts' }] });
  });
});

describe('selectTests: fullTrigger takes precedence over everything', () => {
  it('a package.json change forces full even when another change would have selected a specific test via READ', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/known.test.ts': rec({ read: ['server/src/dep.ts'] }) },
    };
    const sel = selectTests({
      map,
      changes: [
        { status: 'M', path: 'server/package.json', symlink: false },
        { status: 'M', path: 'server/src/dep.ts', symlink: false },
      ],
      liveTests: ['server/test/known.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'full', reason: expect.stringMatching(/package manifest/) });
  });
});

describe('selectTests: unchanged tree (Review Focus e)', () => {
  it('selects only ALWAYS (unknown/git) tests when there are no changes', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: {
        'server/test/flaky.test.ts': rec({ unknown: true }),
        'server/test/git-scan.test.ts': rec({ git: true }),
        'server/test/quiet.test.ts': rec({ read: ['server/src/whatever.ts'] }),
      },
    };
    const sel = selectTests({
      map, changes: [],
      liveTests: ['server/test/flaky.test.ts', 'server/test/git-scan.test.ts', 'server/test/quiet.test.ts'],
      existsAt: () => true,
    });
    expect(sel).toEqual({
      mode: 'selected',
      tests: [
        { file: 'server/test/flaky.test.ts', rule: 2, path: 'server/test/flaky.test.ts' },
        { file: 'server/test/git-scan.test.ts', rule: 2, path: 'server/test/git-scan.test.ts' },
      ],
    });
  });
});

describe('selectTests: deterministic output order', () => {
  it('sorts the selection by file, independent of rule or input order', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: {
        'server/test/z-read.test.ts': rec({ read: ['server/src/dep.ts'] }),
        'server/test/a-git.test.ts': rec({ git: true }),
        'server/test/m-new.test.ts': rec(),
      },
    };
    const sel = selectTests({
      map,
      changes: [
        { status: 'A', path: 'server/test/m-new.test.ts', symlink: false },
        { status: 'M', path: 'server/src/dep.ts', symlink: false },
        { status: 'M', path: 'server/src/unrelated.ts', symlink: false },
      ],
      liveTests: ['server/test/z-read.test.ts', 'server/test/a-git.test.ts', 'server/test/m-new.test.ts'],
      existsAt: () => true,
    });
    if (sel.mode !== 'selected') throw new Error(`expected a selection, got full: ${sel.reason}`);
    expect(sel.tests.map((t) => t.file)).toEqual([
      'server/test/a-git.test.ts', 'server/test/m-new.test.ts', 'server/test/z-read.test.ts',
    ]);
  });
});

// ─── end to end with the map module (Tasks 4 + 5) ───────────────────────────

describe('end-to-end with testmap.mjs: what a real map selects', () => {
  const dep = (d: Partial<DepRecord> = {}): DepRecord => ({ ...emptyDep(), ...d });
  const split = (root: Partial<DepRecord> = {}, rest: Partial<DepRecord> = {}) => ({ root: dep(root), rest: dep(rest), unknown: false });
  // The baseline as measured: the include glob's walk of server/test is in
  // the ROOT process, so every test's root side lists it too.
  const baseline = { root: dep({ listed: ['server/test'], read: ['server/vitest.config.ts'] }), rest: dep() };

  it('a test that walks server/test itself is selected by LISTED when a test file is added — no full run', () => {
    const map = buildMap(SHA_A, {
      format: RECORDS_FORMAT, baseline,
      tests: {
        'server/test/single-definition.test.ts': split({ listed: ['server/test'] }, { listed: ['server/test'] }),
        'server/test/plain.test.ts': split({ listed: ['server/test'] }, { read: ['server/src/plain.ts'] }),
      },
    });
    const sel = selectTests({
      map, changes: [{ status: 'A', path: 'server/test/new.test.ts', symlink: false }],
      liveTests: ['server/test/new.test.ts', 'server/test/plain.test.ts', 'server/test/single-definition.test.ts'],
      existsAt: () => true,
    });
    expect(sel).toEqual({
      mode: 'selected',
      tests: [
        { file: 'server/test/new.test.ts', rule: 1, path: 'server/test/new.test.ts' },
        { file: 'server/test/single-definition.test.ts', rule: 5, path: 'server/test/new.test.ts' },
      ],
    });
  });

  it('a directory a test linked whole (records split by side) reaches the map, and a change under it selects the test (rule 6)', () => {
    const map = buildMap(SHA_A, {
      format: RECORDS_FORMAT, baseline,
      tests: { 'server/test/linker.test.ts': split({}, { subtree: ['deploy'] }) },
    });
    expect(map.tests['server/test/linker.test.ts'].subtree).toEqual(['deploy']);
    const sel = selectTests({
      map, changes: [{ status: 'M', path: 'deploy/present.mjs', symlink: false }],
      liveTests: ['server/test/linker.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/linker.test.ts', rule: 6, path: 'deploy/present.mjs' }] });
  });

  it('a refresh whose trace for a changed test never arrived leaves it ALWAYS selected (rule 2)', () => {
    const old = buildMap(SHA_A, {
      format: RECORDS_FORMAT, baseline,
      tests: { 'server/test/dep.test.ts': split({}, { read: ['server/src/dep.ts'] }) },
    });
    // The merge changed server/src/dep.ts, select meant to re-trace dep.test.ts,
    // and its shard left no record.
    const fresh = refreshMap(old, 'b'.repeat(40), { format: RECORDS_FORMAT, baseline, tests: {} },
      ['server/test/dep.test.ts'], ['server/test/dep.test.ts']);
    const sel = selectTests({
      map: fresh, changes: [{ status: 'M', path: 'server/src/unrelated.ts', symlink: false }],
      liveTests: ['server/test/dep.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/dep.test.ts', rule: 2, path: 'server/test/dep.test.ts' }] });
  });

  it('a rebuild whose trace for a test never arrived leaves it out of the map, and rule 1 selects it', () => {
    const map = buildMap(SHA_A, { format: RECORDS_FORMAT, baseline, tests: { 'server/test/traced.test.ts': split() } });
    const sel = selectTests({
      map, changes: [], liveTests: ['server/test/traced.test.ts', 'server/test/lost.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/lost.test.ts', rule: 1, path: 'server/test/lost.test.ts' }] });
  });

  it('a renamed test file (D old + A new): the new name is selected by rule 1, the old map entry is ignored', () => {
    const map = buildMap(SHA_A, {
      format: RECORDS_FORMAT, baseline,
      tests: {
        'server/test/old-name.test.ts': split({}, { read: ['server/src/x.ts'] }),
        'server/test/other.test.ts': split({}, { read: ['server/src/y.ts'] }),
      },
    });
    const sel = selectTests({
      map,
      changes: [
        { status: 'D', path: 'server/test/old-name.test.ts', symlink: false },
        { status: 'A', path: 'server/test/new-name.test.ts', symlink: false },
      ],
      // live tests come from HEAD, where the old name no longer exists
      liveTests: ['server/test/new-name.test.ts', 'server/test/other.test.ts'],
      existsAt: () => true,
    });
    expect(sel).toEqual({
      mode: 'selected',
      tests: [{ file: 'server/test/new-name.test.ts', rule: 1, path: 'server/test/new-name.test.ts' }],
    });
  });
});

// ─── git-backed integration: readChanges / liveTestFiles / gitExistsAt ────

function gitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
}
function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, env: gitEnv(), encoding: 'utf8' });
}
function initRepo(dir: string): void {
  git(dir, ['init', '-q']);
}
function commitAll(dir: string, msg: string): string {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', msg]);
  return git(dir, ['rev-parse', 'HEAD']).trim();
}
function writeIn(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('readChanges (git-backed)', () => {
  it('reports A, M, D with --no-renames (a rename is D+A)', () => {
    const dir = mkTmp('ccrc-ci-select-changes-');
    initRepo(dir);
    writeIn(dir, 'server/src/keep.ts', 'export const keep = 1;\n');
    writeIn(dir, 'server/src/mod.ts', 'export const v = 1;\n');
    writeIn(dir, 'server/src/gone.ts', 'export const g = 1;\n');
    const base = commitAll(dir, 'base');
    writeIn(dir, 'server/src/mod.ts', 'export const v = 2;\n');
    writeIn(dir, 'server/src/added.ts', 'export const a = 1;\n');
    execFileSync('git', ['rm', '-q', 'server/src/gone.ts'], { cwd: dir, env: gitEnv() });
    const head = commitAll(dir, 'change');
    const changes = readChanges(dir, base, head);
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c]));
    expect(byPath['server/src/mod.ts'].status).toBe('M');
    expect(byPath['server/src/added.ts'].status).toBe('A');
    expect(byPath['server/src/gone.ts'].status).toBe('D');
    expect(changes.every((c) => c.symlink === false)).toBe(true);
  });

  it('parses a path containing a space, via -z (Review Focus d)', () => {
    const dir = mkTmp('ccrc-ci-select-space-');
    initRepo(dir);
    writeIn(dir, 'server/src/seed.ts', 'export const seed = 1;\n');
    const base = commitAll(dir, 'base');
    writeIn(dir, 'server/src/has space.ts', 'export const s = 1;\n');
    const head = commitAll(dir, 'add spaced file');
    const changes = readChanges(dir, base, head);
    expect(changes).toEqual([{ status: 'A', path: 'server/src/has space.ts', symlink: false }]);
  });

  it('marks a symlink on the OLD side too: a deleted symlink, and a symlink turned into a file', () => {
    const dir = mkTmp('ccrc-ci-select-oldlink-');
    initRepo(dir);
    writeIn(dir, 'server/src/target.ts', 'export const t = 1;\n');
    symlinkSync('target.ts', path.join(dir, 'server/src/gone-link.ts'));
    symlinkSync('target.ts', path.join(dir, 'server/src/was-link.ts'));
    const base = commitAll(dir, 'two symlinks');
    execFileSync('git', ['rm', '-q', 'server/src/gone-link.ts'], { cwd: dir, env: gitEnv() });
    rmSync(path.join(dir, 'server/src/was-link.ts'));
    writeIn(dir, 'server/src/was-link.ts', 'export const now = 1;\n');
    const head = commitAll(dir, 'delete one, retype the other');
    const byPath = Object.fromEntries(readChanges(dir, base, head).map((c) => [c.path, c]));
    expect(byPath['server/src/gone-link.ts']).toEqual({ status: 'D', path: 'server/src/gone-link.ts', symlink: true });
    expect(byPath['server/src/was-link.ts']).toEqual({ status: 'M', path: 'server/src/was-link.ts', symlink: true });
  });

  it('marks a symlinked path', () => {
    const dir = mkTmp('ccrc-ci-select-symlink-');
    initRepo(dir);
    writeIn(dir, 'server/src/target.ts', 'export const t = 1;\n');
    const base = commitAll(dir, 'base');
    symlinkSync('target.ts', path.join(dir, 'server/src/link.ts'));
    const head = commitAll(dir, 'add symlink');
    const changes = readChanges(dir, base, head);
    const link = changes.find((c) => c.path === 'server/src/link.ts');
    expect(link).toEqual({ status: 'A', path: 'server/src/link.ts', symlink: true });
  });
});

describe('liveTestFiles (git-backed)', () => {
  // Final review FR-2: without `-z`, git C-QUOTES a path holding a non-ASCII byte, `"`, `\\` or a control
  // character (`"server/test/caf\\303\\251.test.ts"`), which fails the `.test.ts` suffix filter — and the test
  // silently leaves every list select.mjs builds (selected, full, trace, count). The listing is NUL-delimited and
  // unquoted; refusing the names a shard list cannot carry is select.mjs's job, never a silent drop here.
  it('lists a non-ASCII name, and a name holding a double quote or a backslash, exactly as they are (-z)', () => {
    const dir = mkTmp('ccrc-ci-select-live-quoted-');
    initRepo(dir);
    writeIn(dir, 'server/test/a.test.ts', '// a\n');
    writeIn(dir, 'server/test/café.test.ts', '// non-ASCII\n');
    writeIn(dir, 'server/test/q"uote.test.ts', '// a double quote\n');
    writeIn(dir, 'server/test/back\\slash.test.ts', '// a backslash\n');
    commitAll(dir, 'names git would quote');
    expect(liveTestFiles(dir)).toEqual([
      'server/test/a.test.ts', 'server/test/back\\slash.test.ts', 'server/test/café.test.ts', 'server/test/q"uote.test.ts',
    ]);
  });

  it('the live-tests subcommand prints the same one listing, one path per line (what map-build hands testmap.mjs)', () => {
    const dir = mkTmp('ccrc-ci-select-live-cli-');
    initRepo(dir);
    writeIn(dir, 'server/test/a.test.ts', '// a\n');
    writeIn(dir, 'server/test/café.test.ts', '// non-ASCII\n');
    writeIn(dir, 'server/test/helper.ts', '// not a test\n');
    commitAll(dir, 'seed');
    const cli = path.resolve(__dirname, '../../.github/ci/select-tests.mjs');
    const out = execFileSync(process.execPath, [cli, 'live-tests', '--repo', dir], { encoding: 'utf8' });
    expect(out).toBe('server/test/a.test.ts\nserver/test/café.test.ts\n');
  });

  it('the live-tests subcommand refuses a name a line cannot carry, rather than print it', () => {
    const dir = mkTmp('ccrc-ci-select-live-cli-nl-');
    initRepo(dir);
    writeIn(dir, 'server/test/a.test.ts', '// a\n');
    writeIn(dir, 'server/test/new\nline.test.ts', '// a newline\n');
    commitAll(dir, 'a newline in a name');
    const cli = path.resolve(__dirname, '../../.github/ci/select-tests.mjs');
    let status = 0; let stdout = ''; let stderr = '';
    try {
      stdout = execFileSync(process.execPath, [cli, 'live-tests', '--repo', dir], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      const err = e as { status?: number, stdout?: string, stderr?: string };
      status = err.status ?? -1; stdout = err.stdout ?? ''; stderr = err.stderr ?? '';
    }
    expect(status).not.toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain('server/test/new\\nline.test.ts');
  });

  it('finds test files recursively, including a brand-new subdirectory (Review Focus b), excludes non-test files', () => {
    const dir = mkTmp('ccrc-ci-select-live-');
    initRepo(dir);
    writeIn(dir, 'server/test/a.test.ts', '// a\n');
    writeIn(dir, 'server/test/tmpHelpers.ts', '// not a test\n');
    writeIn(dir, 'server/test/sub/x.test.ts', '// nested\n');
    writeIn(dir, 'server/src/not-a-test.test.ts.txt', '// outside server/test\n');
    commitAll(dir, 'seed');
    const live = liveTestFiles(dir);
    expect(live).toEqual(['server/test/a.test.ts', 'server/test/sub/x.test.ts']);
  });
});

describe('gitExistsAt (git-backed)', () => {
  it('answers true for a file and a directory that exist at a ref, false once removed', () => {
    const dir = mkTmp('ccrc-ci-select-exists-');
    initRepo(dir);
    writeIn(dir, 'server/src/sub/inner.ts', '// x\n');
    const base = commitAll(dir, 'base');
    const existsAt = gitExistsAt(dir);
    expect(existsAt(base, 'server/src/sub/inner.ts')).toBe(true);
    expect(existsAt(base, 'server/src/sub')).toBe(true);
    expect(existsAt(base, 'server/src/nope')).toBe(false);

    execFileSync('git', ['rm', '-rq', 'server/src/sub'], { cwd: dir, env: gitEnv() });
    const head = commitAll(dir, 'remove sub');
    expect(existsAt(head, 'server/src/sub')).toBe(false);
  });
});

// ─── Review Focus (b): a new test file in a brand-new subdirectory, end to end ──

describe('end-to-end: new test file in a brand-new subdirectory (Review Focus b)', () => {
  it('liveTestFiles finds it and selectTests rule 1 selects it', () => {
    const dir = mkTmp('ccrc-ci-select-e2e-newdir-');
    initRepo(dir);
    writeIn(dir, 'server/test/existing.test.ts', '// existing\n');
    const base = commitAll(dir, 'base');
    writeIn(dir, 'server/test/sub/x.test.ts', '// new, nested\n');
    const head = commitAll(dir, 'add nested test');

    const changes = readChanges(dir, base, head);
    const live = liveTestFiles(dir, head);
    expect(live).toEqual(['server/test/existing.test.ts', 'server/test/sub/x.test.ts']);

    const map: TestMap = {
      format: 1, sha: base, baseline: emptyDep(),
      tests: { 'server/test/existing.test.ts': rec() },
    };
    const sel = selectTests({ map, changes, liveTests: live, existsAt: gitExistsAt(dir) });
    expect(sel).toEqual({
      mode: 'selected',
      tests: [{ file: 'server/test/sub/x.test.ts', rule: 1, path: 'server/test/sub/x.test.ts' }],
    });
  });
});

/*
 * Mutation table (measured — see PLAN.md Task 5 Step 5 for the transcript;
 * every row below was actually deleted/mutated, run, observed red, and
 * reverted). "N reds" lists every case a mutation touched, not just the
 * first, when a mutation legitimately shares behaviour with another case.
 *
 * mutation                                                           -> reds observed
 * ----------------------------------------------------------------------------------
 * fullTrigger: drop PACKAGE_FILE_RE check                              -> 'package.json anywhere', 'package-lock.json anywhere', 'a package.json change forces full even when...' (3 — package.json/-lock share the regex, and the precedence test also uses a package.json change)
 * fullTrigger: drop VITEST_CONFIG_RE check                             -> 'vitest config, including the exact-list config' (1)
 * fullTrigger: drop TSCONFIG_RE check                                  -> 'tsconfig*.json' (1)
 * fullTrigger: drop the .github/ prefix check                          -> 'anything under .github/' (1)
 * fullTrigger: drop the c.symlink check                                -> 'a symlinked path' (1)
 * fullTrigger: drop the baseline.read membership check                 -> 'a path in baseline.read' (1)
 * fullTrigger: drop the baseline.probed membership check               -> 'a path in baseline.probed' (1)
 * fullTrigger: RESTORE a baseline.listed/parentOf trigger              -> 'a file added directly in a baseline.listed dir is NOT a trigger...', 'a test that walks server/test itself is selected by LISTED...' (2)
 * selectTests: drop rule 1's "absent from map" clause                  -> 'selects a test file absent from the map even with NO changes at all...' (1; this case has no accompanying change, isolating the clause from the own-change one below)
 * selectTests: drop rule 1's "own change A/M" clause                   -> 'selects a test file that is itself modified...', 'sorts the selection by file...' (2)
 * selectTests: drop rule 2's unknown check                             -> 'selects an unknown-trace test...', 'selects only ALWAYS (unknown/git) tests...' (2)
 * selectTests: drop rule 2's git check                                 -> 'selects a test that reads .git...', 'selects only ALWAYS...', 'sorts the selection by file...' (3)
 * selectTests: drop rule 3's M-direct branch                           -> 'fires on a direct M match', 'sorts the selection by file...' (2)
 * selectTests: drop rule 3's A/D ancestor (Pa) branch                  -> 'fires via the gone-ancestor rule...' (1)
 * selectTests: drop rule 4's `status !== 'A'` guard                    -> 'does NOT fire for a deleted path in probed...' (1)
 * selectTests: drop rule 4 entirely                                    -> 'fires on an added path the test probed...' (1)
 * selectTests: drop rule 5 entirely (Pa/E-driven; no separate M guard   -> 'fires when a file lands directly inside a listed directory',
 *   needed — `affectedSet` gives every M change `E: null`, so rule 5's      'fires when a brand-new subdirectory appears under a listed dir...',
 *   loop already excludes M changes without an extra status check)         'handles a root-level entry directory...' (3)
 * selectTests: drop the `fullTrigger` call at the top                  -> 'a package.json change forces full even when...' (1)
 * selectTests: drop the final `.sort()` on liveTests                   -> 'sorts the selection by file, independent of rule or input order' (1)
 * affectedSet: drop the ancestor-walk loop (Pa = [p], E = parentOf(p)  -> 'fires via the gone-ancestor rule...', 'fires when a brand-new subdirectory
 *   always)                                                               appears under a listed dir...', 'handles a root-level entry directory...' (3)
 */

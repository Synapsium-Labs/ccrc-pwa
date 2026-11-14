// D-8635 (large-file programme step 0, D-8615 §4 "From budgets to caps"): the growth check's three stages.
// A file is LISTED (40 net code lines per PR, waivers count), FROZEN (SPINE_LIMIT, 10 per PR, no waiver of any kind,
// only the operator's named exemption passes; Q8), or CAPPED (an absolute number of code lines that may only fall; the
// per-PR limit and every waiver are dropped). Caps live in `growth-caps/` and freezes in `growth-frozen/`, one JSON
// file per file, so two PRs never edit one line. The measure is the growth check's own `codeLines`; the armed rows
// that run against the merge-base stay in `growth-check.test.ts`, which reads every verdict `armedGrowth` answers.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  armedGrowth, codeLines, definedDNumbers, GROWTH_CAPS_DIR, GROWTH_EXEMPTIONS_FILE, GROWTH_FILES, GROWTH_FROZEN_DIR, GROWTH_LIMIT,
  growthFiles, growthOver, growthSummary, growthVerdicts, parseCapFiles, parseExemptions, parseFrozenFiles, SPINE_LIMIT,
  stageFileName, stagesAt, type GrowthRow, type Stage, type StageOf,
} from './growthCheck.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const today = new Date('2026-11-14T12:00:00Z');

type Item = { name: string; text: string };
const capItem = (over: Record<string, unknown> = {}): Item => {
  const o = { file: 'shared/api.ts', cap: 5140, d: 'D-8635', since: '2026-11-14', ...over };
  return { name: typeof o.file === 'string' ? stageFileName(o.file) : 'x.json', text: JSON.stringify(o, null, 2) };
};
const frozenItem = (over: Record<string, unknown> = {}): Item => {
  const o = { file: 'ccd/ccd', d: 'D-8635', since: '2026-11-14', ...over };
  return { name: typeof o.file === 'string' ? stageFileName(o.file) : 'x.json', text: JSON.stringify(o, null, 2) };
};
const row = (file: string, base: number, head: number): GrowthRow => ({ file, base, head, delta: head - base, atBoth: base > 0 && head > 0 });
const stages = (m: Record<string, Stage>): StageOf => (f) => m[f] ?? { stage: 'listed' };
const exemption = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  pr: 1100, file: 'shared/api.ts', cap: 60, reason: 'the wave raises the cap by design',
  ruling: 'operator, 2026-11-14: named exempt for this PR (D-8635)', since: '2026-11-14', ...over,
});

describe('growth caps: the files (D-8635)', () => {
  it('one file per capped file, named for its path', () => {
    expect(stageFileName('shared/api.ts')).toBe('shared-api-ts.json');
    expect(stageFileName('ccd/ccrc-testbox-admin')).toBe('ccd-ccrc-testbox-admin.json');
    expect(stageFileName('pwa/src/fleet/fleet.css')).toBe('pwa-src-fleet-fleet-css.json');
    expect(stageFileName('server/src/coord/stall.ts')).toBe('server-src-coord-stall-ts.json');
  });

  it('a well-formed cap directory parses', () => {
    expect(parseCapFiles([], today)).toEqual({ entries: [], problems: [] });
    const two = parseCapFiles([capItem(), capItem({ file: 'deploy/account-op.mjs', cap: 1879 })], today);
    expect(two.problems).toEqual([]);
    expect(two.entries.map((e) => [e.file, e.cap])).toEqual([['deploy/account-op.mjs', 1879], ['shared/api.ts', 5140]]);
  });

  it('every malformed cap is a problem, and then no cap is answered', () => {
    const table: [string, Item, string][] = [
      ['not JSON', { name: 'shared-api-ts.json', text: '{' }, 'not JSON'],
      ['not an object', { name: 'shared-api-ts.json', text: '[1]' }, 'not an object'],
      ['the wrong name', { ...capItem(), name: 'api.json' }, 'the name must be shared-api-ts.json'],
      ['an unknown key', capItem({ reason: 'x' }), 'unknown key `reason`'],
      ['a missing key', { name: 'shared-api-ts.json', text: JSON.stringify({ file: 'shared/api.ts', cap: 1, d: 'D-8635' }) }, 'missing `since`'],
      ['a cap of 0', capItem({ cap: 0 }), 'cap must be a positive integer'],
      ['a fractional cap', capItem({ cap: 10.5 }), 'cap must be a positive integer'],
      ['a cap as a string', capItem({ cap: '5140' }), 'cap must be a positive integer'],
      ['a bad D-number', capItem({ d: 'D8635' }), 'd must be a D-number'],
      ['a future since', capItem({ since: '2026-11-15' }), "since '2026-11-15' is in the future"],
      ['not a day', capItem({ since: '2026-02-30' }), "since '2026-02-30' is not a YYYY-MM-DD day"],
      ['an empty file', { name: '.json', text: JSON.stringify({ file: '', cap: 1, d: 'D-8635', since: '2026-11-14' }) }, 'file must be a repo path'],
    ];
    for (const [what, item, problem] of table) {
      const got = parseCapFiles([capItem({ file: 'deploy/account-op.mjs' }), item], today);
      expect(got.entries, what).toEqual([]);
      expect(got.problems.join('\n'), what).toContain(problem);
    }
  });

  it('a freeze names a listed file; every malformed freeze is a problem', () => {
    expect(parseFrozenFiles([frozenItem()], GROWTH_FILES, today)).toEqual({
      entries: [{ file: 'ccd/ccd', d: 'D-8635', since: '2026-11-14' }], problems: [] });
    const table: [string, Item, string][] = [
      ['not listed', frozenItem({ file: 'server/src/elsewhere.ts' }), 'file must be one of the listed files'],
      ['a cap key', frozenItem({ cap: 100 }), 'unknown key `cap`'],
      ['the wrong name', { ...frozenItem(), name: 'ccd.json' }, 'the name must be ccd-ccd.json'],
      ['a bad D-number', frozenItem({ d: 'x' }), 'd must be a D-number'],
    ];
    for (const [what, item, problem] of table) {
      const got = parseFrozenFiles([item], GROWTH_FILES, today);
      expect(got.entries, what).toEqual([]);
      expect(got.problems.join('\n'), what).toContain(problem);
    }
  });
});

describe('growth caps: the decision, per stage (D-8635)', () => {
  const e = parseExemptions(JSON.stringify({ exemptions: [exemption()] }), ['shared/api.ts', 'ccd/ccd'], today).entries;

  it('a frozen file is over at SPINE_LIMIT, and no waiver, new file or shrink passes it', () => {
    expect(SPINE_LIMIT).toBe(10);
    const frozen = stages({ 'ccd/ccd': { stage: 'frozen' } });
    const grew = (n: number) => [row('ccd/ccd', 1000, 1000 + n), row('ccd/ccrc', 1000, 500)];
    expect(growthOver(grew(SPINE_LIMIT), [], () => null, frozen)).toEqual([]);
    expect(growthOver(grew(SPINE_LIMIT + 1), [], () => null, frozen), 'a listed shrink waives nothing').toEqual(['ccd/ccd']);
    const home = () => ({ ring: 'L1' as const, context: 'C5' as const });
    expect(growthOver(grew(SPINE_LIMIT + 1), ['server/src/x.ts'], home, frozen), 'a new file at home waives nothing').toEqual(['ccd/ccd']);
    // A waiver the diff adds does not pass a frozen file; the operator's named exemption does.
    const waiver = { file: 'ccd/ccd', maxDelta: 100, d: 'D-6223', reason: 'x', added: '2026-11-14', createdAt: '2026-11-14' };
    const [w] = growthVerdicts([row('ccd/ccd', 1000, 1011)], ['ccd/ccd'], [], 1100, [], [waiver], frozen);
    expect({ fails: w!.fails, waiver: w!.waiver, why: w!.why }).toEqual({
      fails: true, waiver: undefined, why: 'ccd/ccd grew by 11 net code lines, over the frozen limit of 10' });
    const named = parseExemptions(JSON.stringify({ exemptions: [exemption({ file: 'ccd/ccd' })] }), ['ccd/ccd'], today).entries;
    const [x] = growthVerdicts([row('ccd/ccd', 1000, 1050)], ['ccd/ccd'], named, 1100, [], [], frozen);
    expect(x!.fails, 'the named exemption passes a frozen file').toBe(false);
    const [y] = growthVerdicts([row('ccd/ccd', 1000, 1061)], ['ccd/ccd'], named, 1100, [], [], frozen);
    expect(y!.fails, 'past the exemption cap').toBe(true);
  });

  it('a capped file drops the per-PR limit and its waivers, and holds its cap', () => {
    const capped = (base: number | null, head: number | null) =>
      stages({ 'shared/api.ts': { stage: 'capped', base, head, prior: 'listed' } });
    // +500 in one PR is not over the per-PR limit: a capped file has none.
    expect(growthOver([row('shared/api.ts', 4000, 4500)], [], () => null, capped(5140, 5140))).toEqual([]);
    const one = (r: GrowthRow, s: StageOf, pr: number | null = 1100, touched: string[] = []) => {
      const [v] = growthVerdicts([r], growthOver([r], [], () => null, s), e, pr, touched, [], s);
      return { fails: v!.fails, title: v!.title, why: v!.why };
    };
    expect(one(row('shared/api.ts', 4000, 5140), capped(5140, 5140))).toEqual({ fails: false,
      title: 'shared/api.ts: 5140 code lines, cap 5140', why: 'shared/api.ts holds 5140 code lines, within its cap of 5140' });
    expect(one(row('shared/api.ts', 5100, 5141), capped(5140, 5140))).toEqual({ fails: true,
      title: 'shared/api.ts: 5141 code lines, cap 5140 (GROWTH_CAP)', why: 'shared/api.ts holds 5141 code lines, over its cap of 5140' });
    // The cap may fall, never below the file.
    expect(one(row('shared/api.ts', 5100, 5100), capped(5140, 5100)).fails, 'lowered to the file').toBe(false);
    expect(one(row('shared/api.ts', 5100, 5100), capped(5140, 5099)).fails, 'lowered below the file').toBe(true);
    // A new cap is the code lines plus GROWTH_LIMIT at most.
    expect(one(row('shared/api.ts', 5100, 5100), capped(null, 5100 + GROWTH_LIMIT)).fails, 'a new cap at +40').toBe(false);
    expect(one(row('shared/api.ts', 5100, 5100), capped(null, 5100 + GROWTH_LIMIT + 1))).toEqual({ fails: true,
      title: 'shared/api.ts: 5100 code lines, cap 5141 (GROWTH_CAP)',
      why: 'shared/api.ts: a new cap is at most its code lines plus 40, 5140, not 5141' });
    // Raised: only the named exemption for this PR and file, within its cap, with the growth check untouched.
    expect(one(row('shared/api.ts', 5100, 5100), capped(5140, 5141), 1101)).toEqual({ fails: true,
      title: 'shared/api.ts: 5100 code lines, cap 5141, was 5140 (GROWTH_CAP)',
      why: 'shared/api.ts: its cap rose from 5140 to 5141, and no exemption names this PR' });
    expect(one(row('shared/api.ts', 5100, 5100), capped(5140, 5200))).toEqual({ fails: false,
      title: 'shared/api.ts: 5100 code lines, cap 5200, was 5140 (exempt: PR #1100, cap 60)',
      why: 'shared/api.ts holds 5100 code lines, within its cap of 5200' });
    expect(one(row('shared/api.ts', 5100, 5100), capped(5140, 5201)).why)
      .toBe('shared/api.ts: its cap rose from 5140 to 5201, over its exemption cap of 60 for PR #1100');
    expect(one(row('shared/api.ts', 5100, 5100), capped(5140, 5200), 1100, ['server/test/growthCheck.ts']).why)
      .toBe('shared/api.ts: its cap rose from 5140 to 5200, not exempt: the diff for PR #1100 edits the growth check\'s own server/test/growthCheck.ts');
    expect(one(row('shared/api.ts', 5100, 5100), capped(5140, 5200), null).fails, 'no PR number').toBe(true);
    // A removed cap: allowed only with the file gone.
    expect(one(row('shared/api.ts', 5100, 5100), capped(5140, null))).toEqual({ fails: true,
      title: 'shared/api.ts: 5100 code lines, cap removed, was 5140 (GROWTH_CAP)',
      why: 'shared/api.ts: its cap of 5140 is removed while it holds 5100 code lines; a cap may only fall' });
    expect(one(row('shared/api.ts', 5100, 0), capped(5140, null)).fails, 'the file is gone with its cap').toBe(false);
  });

  it('the PR that adds a cap is still judged by the stage the file held at the merge-base', () => {
    const fresh = (prior: 'listed' | 'frozen', head: number) => stages({ 'ccd/ccd': { stage: 'capped', base: null, head, prior } });
    const verdict = (r: GrowthRow, s: StageOf, entries = e, waivers: Parameters<typeof growthVerdicts>[5] = []) =>
      growthVerdicts([r], growthOver([r], [], () => null, s), entries, 1100, [], waivers, s)[0]!;
    // The review's case: a frozen ccd/ccd at 1000 code lines grows to 1500 in the PR that adds a cap of 1540.
    const big = row('ccd/ccd', 1000, 1500);
    expect(growthOver([big], [], () => null, fresh('frozen', 1540)), 'over the frozen limit').toEqual(['ccd/ccd']);
    expect({ fails: verdict(big, fresh('frozen', 1540)).fails, why: verdict(big, fresh('frozen', 1540)).why }).toEqual({
      fails: true, why: 'ccd/ccd grew by 500 net code lines, over the frozen limit of 10' });
    expect(verdict(big, fresh('listed', 1540)).fails, 'over the listed limit').toBe(true);
    expect(verdict(big, fresh('listed', 1540)).title).toBe('ccd/ccd: 1500 code lines, cap 1540, delta +500 (GROWTH_OVER)');
    // At the stage's limit the new cap passes; one past it fails.
    expect(verdict(row('ccd/ccd', 1000, 1000 + SPINE_LIMIT), fresh('frozen', 1050)).fails).toBe(false);
    expect(verdict(row('ccd/ccd', 1000, 1001 + SPINE_LIMIT), fresh('frozen', 1051)).fails).toBe(true);
    expect(verdict(row('ccd/ccd', 1000, 1000 + GROWTH_LIMIT), fresh('listed', 1080)).fails).toBe(false);
    expect(verdict(row('ccd/ccd', 1000, 1001 + GROWTH_LIMIT), fresh('listed', 1081)).fails).toBe(true);
    // A ledger waiver passes the listed stage and never the frozen one; the named exemption passes either.
    const waiver = { file: 'ccd/ccd', maxDelta: 100, d: 'D-6223', reason: 'x', added: '2026-11-14', createdAt: '2026-11-14' };
    const grew = row('ccd/ccd', 1000, 1050);
    expect(verdict(grew, fresh('listed', 1090), [], [waiver]).fails, 'listed, waived').toBe(false);
    expect(verdict(grew, fresh('frozen', 1090), [], [waiver]).fails, 'frozen, no waiver counts').toBe(true);
    const named = parseExemptions(JSON.stringify({ exemptions: [exemption({ file: 'ccd/ccd' })] }), ['ccd/ccd'], today).entries;
    expect(verdict(grew, fresh('frozen', 1090), named).fails, 'frozen, the named exemption').toBe(false);
    expect(verdict(row('ccd/ccd', 1000, 1061), fresh('frozen', 1101), named).fails, 'past the exemption cap').toBe(true);
    // The cap rule still holds beside the stage's: within the limit, a new cap past code lines + 40 fails.
    expect(verdict(row('ccd/ccd', 1000, 1005), fresh('frozen', 1046)).fails).toBe(true);
  });

  it('the summary names each capped file with its code lines and cap', () => {
    const md = growthSummary({ base: 'abcdef1234567', rows: [row('shared/api.ts', 5100, 5101)], over: [],
      methods: { base: 1, head: 1 }, armed: true, caps: [{ file: 'shared/api.ts', head: 5101, cap: 5140 }] });
    expect(md).toContain('Caps (D-8635): `shared/api.ts` 5101 of 5140');
    expect(growthSummary({ base: 'abcdef1234567', rows: [], over: [], methods: { base: 1, head: 1 }, armed: true }))
      .not.toContain('Caps (D-8635)');
  });
});

describe('growth caps: the armed path, end to end (D-8635)', () => {
  it('reads caps and freezes at both shas, and holds capped files the list does not name', () => {
    const dir = mkTmp('growth-caps-');
    const git = (...a: string[]): string => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
    const put = (rel: string, text: string): void => {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), text);
    };
    const commit = (m: string): string => { git('add', '-A'); git('commit', '-q', '-m', m); return git('rev-parse', 'HEAD'); };
    const pure = (n: number): string => Array.from({ length: n }, (_, i) => `export const a${i} = ${i};\n`).join('');
    const bash = (n: number): string => Array.from({ length: n }, (_, i) => `echo line-${i}\n`).join('');
    const cap = (file: string, n: number): void => put(`${GROWTH_CAPS_DIR}/${stageFileName(file)}`, capItem({ file, cap: n }).text);
    git('init', '-q');
    git('config', 'user.name', 'fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'gc.auto', '0');
    git('config', 'maintenance.auto', 'false');
    put('server/src/mid.ts', pure(100));
    put('ccd/ccd', bash(100));
    put('ccd/ccrc', bash(100));
    put(GROWTH_EXEMPTIONS_FILE, JSON.stringify({ exemptions: [] }));
    cap('server/src/mid.ts', 140);
    put(`${GROWTH_FROZEN_DIR}/${stageFileName('ccd/ccd')}`, frozenItem().text);
    const base = commit('base: mid.ts capped at 140, ccd/ccd frozen');
    git('update-ref', 'refs/remotes/origin/main', base);
    const vars = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1100/merge' };
    const run = (name: string, edit: () => void, from = base) => {
      git('checkout', '-q', '-B', name, from);
      edit();
      const head = commit(name);
      return armedGrowth(GROWTH_FILES, dir, git('merge-base', 'origin/main', head), head, vars, today);
    };
    const fails = (a: ReturnType<typeof armedGrowth>, file: string) => a.verdicts.find((v) => v.file === file)?.fails;

    expect(growthFiles(base, base, dir), 'a capped file joins the measured list').toContain('server/src/mid.ts');
    expect(stagesAt(GROWTH_FILES, base, dir, today).caps.map((c) => c.file)).toEqual(['server/src/mid.ts']);
    expect(fails(run('within', () => put('server/src/mid.ts', pure(140))), 'server/src/mid.ts'), '+40, at its cap').toBe(false);
    expect(fails(run('over', () => put('server/src/mid.ts', pure(141))), 'server/src/mid.ts'), 'past its cap').toBe(true);
    expect(fails(run('raised', () => { put('server/src/mid.ts', pure(150)); cap('server/src/mid.ts', 150); }),
      'server/src/mid.ts'), 'a raise with no exemption').toBe(true);
    expect(fails(run('uncapped', () => { put('server/src/mid.ts', pure(150)); rmSync(path.join(dir, GROWTH_CAPS_DIR), { recursive: true }); }),
      'server/src/mid.ts'), 'its cap file deleted').toBe(true);
    expect(fails(run('lowered', () => cap('server/src/mid.ts', 100)), 'server/src/mid.ts'), 'lowered to the file').toBe(false);
    // The frozen file: 10 per PR, and deleting its freeze in the same PR changes nothing.
    expect(fails(run('frozen-ok', () => put('ccd/ccd', bash(110))), 'ccd/ccd')).toBe(false);
    expect(fails(run('frozen-over', () => put('ccd/ccd', bash(111))), 'ccd/ccd')).toBe(true);
    expect(fails(run('unfreeze', () => { put('ccd/ccd', bash(111)); rmSync(path.join(dir, GROWTH_FROZEN_DIR), { recursive: true }); }),
      'ccd/ccd'), 'a PR cannot unfreeze itself').toBe(true);
    // The closing PR caps the frozen file: the freeze goes and the cap holds it from then on.
    expect(fails(run('closing', () => {
      put('ccd/ccd', bash(80)); rmSync(path.join(dir, GROWTH_FROZEN_DIR), { recursive: true }); cap('ccd/ccd', 120);
    }), 'ccd/ccd'), 'capped at its code lines plus 40').toBe(false);
    // A cap added in the PR that grows the file does not lift the stage the merge-base held (frozen 10, listed 40).
    expect(fails(run('frozen-capped-ok', () => { put('ccd/ccd', bash(110)); cap('ccd/ccd', 150); }), 'ccd/ccd')).toBe(false);
    expect(fails(run('frozen-capped-over', () => { put('ccd/ccd', bash(111)); cap('ccd/ccd', 151); }), 'ccd/ccd'),
      'a frozen file grows past 10 in the PR that adds its cap').toBe(true);
    expect(fails(run('frozen-capped-unfrozen', () => {
      put('ccd/ccd', bash(111)); rmSync(path.join(dir, GROWTH_FROZEN_DIR), { recursive: true }); cap('ccd/ccd', 151);
    }), 'ccd/ccd'), 'nor with its freeze removed').toBe(true);
    expect(fails(run('listed-capped-ok', () => { put('ccd/ccrc', bash(140)); cap('ccd/ccrc', 180); }), 'ccd/ccrc')).toBe(false);
    expect(fails(run('listed-capped-over', () => { put('ccd/ccrc', bash(141)); cap('ccd/ccrc', 181); }), 'ccd/ccrc'),
      'a listed file grows past 40 in the PR that adds its cap').toBe(true);
    // A malformed cap directory is a failing row of its own.
    const broken = run('broken', () => put(`${GROWTH_CAPS_DIR}/${stageFileName('server/src/mid.ts')}`, '{'));
    expect(broken.verdicts.filter((v) => v.fails).map((v) => v.file)).toContain(GROWTH_CAPS_DIR);
    // The operator names PR 1100 on main: the raise passes, once, for that PR only.
    git('checkout', '-q', '-B', 'main-side', base);
    put(GROWTH_EXEMPTIONS_FILE, JSON.stringify({ exemptions: [exemption({ file: 'server/src/mid.ts', cap: 50 })] }));
    const named = commit('the operator names PR 1100');
    git('update-ref', 'refs/remotes/origin/main', named);
    const raise = () => { put('server/src/mid.ts', pure(150)); cap('server/src/mid.ts', 150); };
    expect(fails(run('raised-named', raise, named), 'server/src/mid.ts'), 'the named PR').toBe(false);
    const other = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1101/merge' };
    git('checkout', '-q', '-B', 'raised-other', named);
    raise();
    const h = commit('raised-other');
    expect(armedGrowth(GROWTH_FILES, dir, named, h, other, today).verdicts.find((v) => v.file === 'server/src/mid.ts')!.fails,
      'another PR').toBe(true);
  });
});

const itemsIn = (rel: string): Item[] => {
  let names: string[] = [];
  try { names = readdirSync(path.join(ROOT, rel)); } catch { /* absent */ }
  return names.map((name) => ({ name, text: readFileSync(path.join(ROOT, rel, name), 'utf8') }));
};

describe('growth caps: the tree (D-8635)', () => {
  const listed = growthFiles('HEAD', 'HEAD', ROOT);

  it(`every file in ${GROWTH_CAPS_DIR} and ${GROWTH_FROZEN_DIR} is well formed and cites a D-number a plan defines`, () => {
    const caps = parseCapFiles(itemsIn(GROWTH_CAPS_DIR));
    const frozen = parseFrozenFiles(itemsIn(GROWTH_FROZEN_DIR), listed);
    expect([...caps.problems, ...frozen.problems]).toEqual([]);
    const defined = definedDNumbers(ROOT);
    expect([...caps.entries, ...frozen.entries].filter((c) => !defined.has(c.d)).map((c) => `${c.file} ${c.d}`)).toEqual([]);
  });

  it('every capped file is in the tree, within its cap', () => {
    const caps = parseCapFiles(itemsIn(GROWTH_CAPS_DIR)).entries;
    expect(caps.length, 'step 0 sets the first caps').toBeGreaterThan(0);
    for (const c of caps) {
      expect(existsSync(path.join(ROOT, c.file)), c.file).toBe(true);
      expect(codeLines(c.file, readFileSync(path.join(ROOT, c.file), 'utf8')), c.file).toBeLessThanOrEqual(c.cap);
    }
  });

  it('step 0 caps the cap-only files (Q5, Q6) and every source between 1,500 code lines and 3,000 lines', () => {
    const capped = parseCapFiles(itemsIn(GROWTH_CAPS_DIR)).entries.map((c) => c.file);
    for (const f of ['shared/api.ts', 'deploy/history-replay.mjs', 'deploy/account-op.mjs', 'pwa/src/fleet/fleet.css',
      'server/src/collectLane.ts', 'server/src/coord/stall.ts', 'ccd/ccrc-testbox-admin']) {
      expect(capped, f).toContain(f);
    }
  });
});

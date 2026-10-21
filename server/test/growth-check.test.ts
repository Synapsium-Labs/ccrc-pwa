// D-5848 (ARCH-01, #526; consolidation spec §5.2): the god-file growth check.
// Net code-line growth of the listed files against the merge-base with
// `origin/main`, one stripper per language (`growthCheck.ts`). It reported only
// (`console.warn` and the `GROWTH_OVER` list) until the operator armed it on
// 2026-10-21 (OA-C2, D-6178); a listed file that grows by more than
// GROWTH_LIMIT net code lines now fails its row. No per-file absolute constant
// lives here, so two PRs in flight cannot conflict on this file.
//
// It reads `.git` (`git merge-base`, `git show`), so the CI selector's rule 2
// (ALWAYS) runs it on every PR without a workflow edit. Outside CI (no `CI` in
// the environment; set GROWTH_CHECK=1 to run it locally) or with no
// `origin/main`, the growth rows skip with a printed notice and never fail
// falsely. The stripper's own rows below always run.
//
// D-6119 (ARCH-01 acceptance 3): when the rows measure, the absolute code lines
// of every listed file and FleetWatcher's method count go to the CI job summary
// (`$GITHUB_STEP_SUMMARY`), never into an assertion.
//
// D-6211: a PR the operator names in `growth-exemptions.json` may grow one
// listed file up to the entry's cap. The armed rows call one helper,
// `armedGrowth`, which reads `origin/main`'s copy of that list, never this
// checkout's, takes the PR number from `GITHUB_REF` and its event, and withholds
// every exemption when the diff the run measures edits the growth check's own
// files. The HEAD copy's shape is checked on every run, CI or not.
//
// D-6223: the reviewed waiver ledger, `growth-waivers.json`. A PR that must grow
// a listed file past the limit adds one dated entry for that file in its own
// diff; the entry waives that file only while the measured delta stays at or
// below its `maxDelta`, and an entry the merge-base already holds waives
// nothing. The ledger is debt consolidation W5 pays; entries cite D-numbers
// the plans define.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stripTs, measureBash, codeLines, netGrowth, growthOver, addedFiles,
  GROWTH_LIMIT, L1_L2_NEW_FILE_DIRS,
  classMethodCount, methodCounts, growthSummary, appendJobSummary, METHOD_COUNT_CLASS, METHOD_COUNT_FILE,
  prNumberFromEnv, parseExemptions, exemptionsOnMain, matchExemptions, GROWTH_EXEMPTIONS_FILE,
  GROWTH_EXEMPTIONS_STAMP, GROWTH_MACHINERY, overLine, growthVerdicts, armedGrowth, gitRead, type GrowthRow, type GrowthExemption,
  GROWTH_WAIVERS_FILE, parseWaivers, waiversAdded, waiversInDiff, type GrowthWaiver,
} from './growthCheck.js';
import { EXEMPTION_SET_STAMPS } from './rings/exemption-age.data.js';
import { parseFile } from './scan/parse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');

/** Armed by OA-C2 (D-6178), ruled by the operator on 2026-10-21: a listed file
 *  over the limit now fails its row. */
const GROWTH_ARMED = true;

/** The union of spec §5.2 and the ARCH-01 ticket. */
const GROWTH_FILES = [
  'ccd/ccd',
  'ccd/ccrc',
  'ccd/session-hook.sh',
  'server/src/watch.ts',
  'server/src/coord/store.ts',
  'server/src/coord/routes.ts',
  'server/src/server.ts',
  'server/src/sessionws.ts',
  'pwa/src/lib/api.ts',
] as const;

describe('growthCheck: the stripper (D-5848)', () => {
  it('a `//` inside a string keeps its line', () => {
    const src = "const url = 'http://example.invalid/a';\n";
    expect(codeLines('x.ts', src)).toBe(1);
  });

  it('a comment marker inside a string, template or regex does not swallow the next line', () => {
    expect(codeLines('x.ts', "const s = '/*';\nconst b = 1;\n")).toBe(2);
    expect(codeLines('x.ts', 'const t = `/* ${a} `;\nconst b = 1;\n')).toBe(2);
    expect(codeLines('x.ts', 'const r = /[/*]/;\nconst b = 1;\n')).toBe(2);
    expect(stripTs("const u = 'http://x'; // c\n")).toBe("const u = 'http://x'; \n");
  });

  it('a `//` comment line is not code', () => {
    const src = '// one\n  // two\nconst a = 1; // trailing\n';
    expect(codeLines('x.ts', src)).toBe(1);
  });

  it('a `/* */` spanning lines is stripped', () => {
    const src = 'const a = 1;\n/* one\n * two\n */\nconst b = 2; /* x\n y */ const c = 3;\n';
    expect(stripTs(src).split('\n').filter((l) => l.trim() !== '').length).toBe(3);
    expect(codeLines('x.ts', src)).toBe(3);
  });

  it('comment markers inside template literals and regex literals are code', () => {
    const src = 'const t = `a ${"/*"} //`;\nconst r = /\\/\\*/g;\nconst s = "*/";\n';
    expect(codeLines('x.ts', src)).toBe(3);
  });

  it('blank lines are not code, in either language', () => {
    expect(codeLines('x.ts', '\n  \nconst a = 1;\n\n')).toBe(1);
    expect(codeLines('x.sh', '\n  \necho a\n\n')).toBe(1);
  });

  it('a bash heredoc holding `#` lines counts as heredoc, not code', () => {
    const src = [
      '#!/usr/bin/env bash',
      '# a comment',
      "cat <<'EOF'",
      '# inside the heredoc',
      'body line',
      'EOF',
      'echo done  # trailing comment keeps the line',
      '',
    ].join('\n');
    expect(measureBash(src)).toEqual({ code: 2, heredoc: 2 });
  });

  it('a `<<-` heredoc ends at a tab-indented delimiter', () => {
    const src = 'f() {\n\tcat <<-EOF\n\t# kept\n\tEOF\n}\n';
    expect(measureBash(src)).toEqual({ code: 3, heredoc: 1 });
  });

  it('a `<<<` here-string opens no heredoc', () => {
    expect(measureBash('x=$(cat <<<EOF)\necho a\nEOF\n')).toEqual({ code: 3, heredoc: 0 });
  });

  it('a plain `<<` heredoc ends only at its exact delimiter', () => {
    expect(measureBash('cat <<EOF\n  EOF\nEOF\necho a\n')).toEqual({ code: 2, heredoc: 1 });
  });

  it('an empty diff is delta 0', (ctx) => {
    let head: string;
    try {
      head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch {
      console.log('growth-check: no git in this checkout, the empty-diff row skips');
      ctx.skip();
      return;
    }
    expect(netGrowth('server/src/watch.ts', head, head, ROOT).delta).toBe(0);
  });

  it('over the limit is named unless a new L1/L2 file or a listed shrink waives it', () => {
    const rows = [
      { file: 'server/src/watch.ts', base: 100, head: 100 + GROWTH_LIMIT + 1, delta: GROWTH_LIMIT + 1, atBoth: true },
      { file: 'server/src/server.ts', base: 100, head: 100 + GROWTH_LIMIT, delta: GROWTH_LIMIT, atBoth: true },
    ];
    expect(growthOver(rows, [])).toEqual(['server/src/watch.ts']);
    expect(growthOver(rows, [`${L1_L2_NEW_FILE_DIRS[0]}decider.ts`])).toEqual([]);
    expect(growthOver(rows, ['server/src/elsewhere.ts'])).toEqual(['server/src/watch.ts']);
    const shrunk = [...rows, { file: 'pwa/src/lib/api.ts', base: 200, head: 100, delta: -100, atBoth: true }];
    expect(growthOver(shrunk, [])).toEqual([]);
    // A listed file deleted or renamed away is no shrink: it waives nothing.
    const gone = [...rows, { file: 'pwa/src/lib/api.ts', base: 200, head: 0, delta: -200, atBoth: false }];
    expect(growthOver(gone, [])).toEqual(['server/src/watch.ts']);
  });
});

describe('growthCheck: the CI job summary (D-6119)', () => {
  it('counts a class\'s own methods by ARCH-00\'s parser: no getter, arrow property, constructor or nested method', () => {
    const src = [
      'export class Watcher {',
      '  constructor() {}',
      '  get size() { return 1; }',
      '  private onTick = () => 1;',
      '  tick() { const inner = { run() {} }; return inner; }',
      '  private async sweep(): Promise<void> { function helper() {} helper(); }',
      '  static make() { return new Watcher(); }',
      '  build() { const K = class Inner { run() {} }; return K; }',
      '}',
      'class Other { tick() {} }',
      'function tick() {}',
      '',
    ].join('\n');
    expect(classMethodCount(src, 'Watcher')).toBe(4);
    expect(classMethodCount(src, 'Other')).toBe(1);
    expect(classMethodCount(src, 'Missing')).toBe(0);
  });

  it(`${METHOD_COUNT_FILE} declares ${METHOD_COUNT_CLASS} with methods, so the summary's count is not a silent 0`, () => {
    const src = readFileSync(path.join(ROOT, METHOD_COUNT_FILE), 'utf8');
    expect(classMethodCount(src, METHOD_COUNT_CLASS)).toBeGreaterThan(0);
  });

  it('the summary carries every row\'s absolute code lines, the method count and GROWTH_OVER', () => {
    const rows = [
      { file: 'server/src/watch.ts', base: 900, head: 950, delta: 50, atBoth: true },
      { file: 'ccd/ccd', base: 300, head: 290, delta: -10, atBoth: true },
      { file: 'server/src/index.ts', base: 10, head: 10, delta: 0, atBoth: true },
    ];
    const md = growthSummary({ base: 'abcdef1234567', rows, over: ['server/src/watch.ts'],
      methods: { base: 12, head: 14 }, armed: false });
    expect(md).toContain('| `server/src/watch.ts` | 900 | 950 | +50 |');
    expect(md).toContain('| `ccd/ccd` | 300 | 290 | -10 |');
    // An unchanged file still gets its row: the summary lists every watched file.
    expect(md).toContain('| `server/src/index.ts` | 10 | 10 | +0 |');
    expect(md).toContain(`${METHOD_COUNT_CLASS} methods`);
    expect(md).toMatch(/base 12, head 14, delta \+2/);
    expect(md).toContain('GROWTH_OVER: `server/src/watch.ts`');
    expect(md).toContain('abcdef1');
    expect(md).toMatch(/reporting only/);
    const none = growthSummary({ base: 'abcdef1234567', rows, over: [], methods: { base: 12, head: 12 }, armed: true });
    expect(none).toContain('GROWTH_OVER: (none)');
    expect(none).not.toMatch(/reporting only/);
  });

  it('method counts are read at the base sha and at the head sha, and a file missing at a sha counts 0', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'growth-methods-'));
    try {
      const git = (...a: string[]): string => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
      git('init', '-q');
      git('config', 'user.name', 'fixture');
      git('config', 'user.email', 'fixture@example.invalid');
      git('commit', '-q', '--allow-empty', '-m', 'empty');
      const empty = git('rev-parse', 'HEAD');
      writeFileSync(path.join(dir, 'w.ts'), 'class W { a() {} }\n');
      git('add', 'w.ts');
      git('commit', '-q', '-m', 'one');
      const one = git('rev-parse', 'HEAD');
      writeFileSync(path.join(dir, 'w.ts'), 'class W { a() {} b() {} c() {} }\n');
      git('commit', '-q', '-am', 'three');
      const three = git('rev-parse', 'HEAD');
      expect(methodCounts('w.ts', 'W', one, three, dir)).toEqual({ base: 1, head: 3 });
      expect(methodCounts('w.ts', 'W', empty, one, dir)).toEqual({ base: 0, head: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the summary is appended to $GITHUB_STEP_SUMMARY when set, and nothing is written when it is not', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'growth-summary-'));
    try {
      const file = path.join(dir, 'summary.md');
      writeFileSync(file, 'earlier step\n');
      expect(appendJobSummary('## one\n', { GITHUB_STEP_SUMMARY: file })).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe('earlier step\n## one\n');
      expect(appendJobSummary('## two\n', {})).toBe(false);
      expect(appendJobSummary('## two\n', { GITHUB_STEP_SUMMARY: '' })).toBe(false);
      expect(readFileSync(file, 'utf8')).toBe('earlier step\n## one\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('growthCheck: a PR the operator names exempt (D-6211)', () => {
  const SHA = 'a'.repeat(40);
  const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    pr: 1100, file: 'ccd/ccd', cap: 400, reason: 'the wave grows ccd/ccd by design',
    ruling: 'operator, 2026-10-21: named exempt for ccd/ccd only', since: '2026-10-21', ...over,
  });
  const list = (...entries: unknown[]): string => JSON.stringify({ exemptions: entries });
  const today = new Date('2026-10-21T12:00:00Z');
  /** The growth check's own files as ruled (fix rounds 1 and 2), written out rather than read from the constant. */
  const MACHINERY = [
    'server/test/growthCheck.ts',
    'server/test/growth-check.test.ts',
    'server/test/growth-exemptions.json',
    'server/test/rings/exemption-age.test.ts',
    'server/test/rings/exemption-age.data.ts',
    'server/test/rings/exemptions.ts',
    'server/test/scan/parse.ts',
  ];

  it('the PR number comes from GITHUB_REF under its event: a pull request\'s merge ref or a merge-queue branch', () => {
    const PR = 'pull_request';
    const MQ = 'merge_group';
    const queue = (tail: string): string => `refs/heads/gh-readonly-queue/main/${tail}`;
    const table: [string, string | undefined, string | undefined, number | null][] = [
      ['pull request', PR, 'refs/pull/1100/merge', 1100],
      ['merge queue', MQ, queue(`pr-1100-${SHA}`), 1100],
      ['merge queue, a base with a slash', MQ, `refs/heads/gh-readonly-queue/release/x/pr-7-${SHA}`, 7],
      ['a merge ref under another event', 'workflow_dispatch', 'refs/pull/1100/merge', null],
      ['a merge ref under merge_group', MQ, 'refs/pull/1100/merge', null],
      ['a queue ref under pull_request', PR, queue(`pr-1100-${SHA}`), null],
      ['a workflow_dispatch on a queue-shaped branch', 'workflow_dispatch', queue(`pr-1100-${SHA}`), null],
      ['a queue ref with no event', undefined, queue(`pr-1100-${SHA}`), null],
      ['a merge ref with no event', undefined, 'refs/pull/1100/merge', null],
      ['push to main', 'push', 'refs/heads/main', null],
      ['schedule', 'schedule', 'refs/heads/main', null],
      ['workflow_dispatch on a branch', 'workflow_dispatch', 'refs/heads/ws/lane-a', null],
      ['a tag', 'push', 'refs/tags/v1.2.3', null],
      ['no env', undefined, undefined, null],
      ['an empty ref', PR, '', null],
      ['a pull request\'s head ref, not its merge ref', PR, 'refs/pull/1100/head', null],
      ['a merge ref with a trailing suffix', PR, 'refs/pull/1100/merge-x', null],
      ['PR 0', PR, 'refs/pull/0/merge', null],
      ['a leading zero', PR, 'refs/pull/01/merge', null],
      ['not a number', PR, 'refs/pull/abc/merge', null],
      ['a padded ref', PR, ' refs/pull/1100/merge', null],
      ['a queue branch with no sha', MQ, queue('pr-1100'), null],
      ['a queue branch with a trailing suffix', MQ, queue(`pr-1100-${SHA}-x`), null],
      ['a branch merely named like a queue entry', MQ, `refs/heads/ws/gh-readonly-queue/main/pr-1100-${SHA}`, null],
      ['a branch whose name embeds a queue ref', MQ, `refs/heads/lane-a/refs/heads/gh-readonly-queue/main/pr-1100-${SHA}`, null],
    ];
    for (const [what, event, ref, want] of table) {
      const vars: NodeJS.ProcessEnv = {};
      if (event !== undefined) vars['GITHUB_EVENT_NAME'] = event;
      if (ref !== undefined) vars['GITHUB_REF'] = ref;
      expect(prNumberFromEnv(vars), what).toBe(want);
    }
  });

  it('a well-formed list parses; two entries of one PR for two files are allowed', () => {
    expect(parseExemptions(list(), GROWTH_FILES, today)).toEqual({ entries: [], problems: [] });
    const two = parseExemptions(list(entry(), entry({ file: 'ccd/ccrc', cap: 41 })), GROWTH_FILES, today);
    expect(two.problems).toEqual([]);
    expect(two.entries.map((e) => `${e.pr} ${e.file} ${e.cap}`)).toEqual(['1100 ccd/ccd 400', '1100 ccd/ccrc 41']);
  });

  it('every malformed shape is a problem, and a list with one exempts nothing', () => {
    const noPr = entry();
    delete noPr['pr'];
    const shapes: [string, string, string][] = [
      ['not JSON', '{"exemptions": [', 'not JSON'],
      ['a top-level array', '[]', 'one key, `exemptions`'],
      ['no exemptions key', '{}', 'one key, `exemptions`'],
      ['exemptions not an array', '{"exemptions": {}}', 'one key, `exemptions`'],
      ['an unknown top-level key', '{"exemptions": [], "extra": 1}', 'one key, `exemptions`'],
      ['an entry that is not an object', list('ccd/ccd'), '#0: not an object'],
      ['a null entry', list(null), '#0: not an object'],
      ['a missing key', list(noPr), '#0: missing `pr`'],
      ['an unknown key', list(entry({ caps: 400 })), '#0: unknown key `caps`'],
      ['pr 0', list(entry({ pr: 0 })), '#0: pr must be a positive integer'],
      ['a negative pr', list(entry({ pr: -3 })), '#0: pr must be a positive integer'],
      ['a fractional pr', list(entry({ pr: 1.5 })), '#0: pr must be a positive integer'],
      ['a string pr', list(entry({ pr: '1100' })), '#0: pr must be a positive integer'],
      ['a file that is not listed', list(entry({ file: 'server/src/index.ts' })), '#0: file must be one of the listed files'],
      ['a cap at the limit', list(entry({ cap: GROWTH_LIMIT })), '#0: cap must be an integer above 40'],
      ['a cap under the limit', list(entry({ cap: 10 })), '#0: cap must be an integer above 40'],
      ['a fractional cap', list(entry({ cap: 100.5 })), '#0: cap must be an integer above 40'],
      ['a string cap', list(entry({ cap: '400' })), '#0: cap must be an integer above 40'],
      ['an empty reason', list(entry({ reason: '' })), '#0: the reason must be one non-empty line'],
      ['a blank reason', list(entry({ reason: '   ' })), '#0: the reason must be one non-empty line'],
      ['a two-line reason', list(entry({ reason: 'a\nb' })), '#0: the reason must be one non-empty line'],
      ['a reason that is not a string', list(entry({ reason: 7 })), '#0: reason and since must be strings'],
      ['an empty ruling', list(entry({ ruling: '' })), '#0: the ruling must be one non-empty line'],
      ['a two-line ruling', list(entry({ ruling: 'a\nb' })), '#0: the ruling must be one non-empty line'],
      ['a since that is not a day', list(entry({ since: '2026-02-30' })), "#0: since '2026-02-30' is not a YYYY-MM-DD day"],
      ['a since in another format', list(entry({ since: '21-10-2026' })), "#0: since '21-10-2026' is not a YYYY-MM-DD day"],
      ['a since in the future', list(entry({ since: '2026-10-22' })), "#0: since '2026-10-22' is in the future"],
      ['two entries for one PR and one file', list(entry(), entry({ cap: 500 })), '#1: a second entry for PR 1100 and ccd/ccd'],
    ];
    for (const [what, text, problem] of shapes) {
      const got = parseExemptions(text, GROWTH_FILES, today);
      expect(got.problems.some((p) => p.includes(problem)), `${what}: ${JSON.stringify(got.problems)}`).toBe(true);
      expect(got.entries, what).toEqual([]);
    }
  });

  it('an entry waives only its own file, only for its own PR, and only at or under its cap', () => {
    const e = parseExemptions(list(entry({ cap: 400 })), GROWTH_FILES, today).entries;
    const row = (file: string, delta: number) => ({ file, base: 1000, head: 1000 + delta, delta, atBoth: true });
    const atCap = [row('ccd/ccd', 400)];
    expect(matchExemptions(['ccd/ccd'], atCap, e, 1100)).toEqual([{ file: 'ccd/ccd', entry: e[0], applies: true, touched: [] }]);
    const overCap = [row('ccd/ccd', 401)];
    expect(matchExemptions(['ccd/ccd'], overCap, e, 1100)).toEqual([{ file: 'ccd/ccd', entry: e[0], applies: false, touched: [] }]);
    const edits = ['server/test/growthCheck.ts'];
    expect(matchExemptions(['ccd/ccd'], atCap, e, 1100, edits)).toEqual([{ file: 'ccd/ccd', entry: e[0], applies: false, touched: edits }]);
    expect(matchExemptions(['ccd/ccd'], atCap, e, 1101)).toEqual([]);
    expect(matchExemptions(['ccd/ccd'], atCap, e, null)).toEqual([]);
    const other = [row('ccd/ccd', 100), row('ccd/ccrc', 100)];
    expect(matchExemptions(['ccd/ccrc'], other, e, 1100)).toEqual([]);
    // A file that did not grow over the limit needs no entry, and is not reported as exempt.
    expect(matchExemptions([], atCap, e, 1100)).toEqual([]);
  });

  it('the list is read from origin/main, never from HEAD: a PR\'s own entry exempts nothing until it lands', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'growth-exempt-'));
    try {
      const git = (...a: string[]): string => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
      git('init', '-q');
      git('config', 'user.name', 'fixture');
      git('config', 'user.email', 'fixture@example.invalid');
      git('commit', '-q', '--allow-empty', '-m', 'no list');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      // Absent on origin/main: no entries, and nothing wrong.
      expect(exemptionsOnMain(GROWTH_FILES, dir, today)).toEqual({ entries: [], problems: [] });
      const file = path.join(dir, GROWTH_EXEMPTIONS_FILE);
      execFileSync('mkdir', ['-p', path.dirname(file)]);
      writeFileSync(file, list());
      git('add', '-A');
      git('commit', '-q', '-m', 'empty list');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      writeFileSync(file, list(entry()));
      git('commit', '-q', '-am', 'the PR adds its own entry');
      // The entry is on HEAD only: it is not read.
      expect(exemptionsOnMain(GROWTH_FILES, dir, today)).toEqual({ entries: [], problems: [] });
      // Once origin/main carries it (the entry landed; CI re-ran), it is.
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      expect(exemptionsOnMain(GROWTH_FILES, dir, today).entries.map((x) => x.pr)).toEqual([1100]);
      // A malformed copy on origin/main exempts nothing, and says why.
      writeFileSync(file, list(entry({ cap: 1 })));
      git('commit', '-q', '-am', 'malformed');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      const bad = exemptionsOnMain(GROWTH_FILES, dir, today);
      expect(bad.entries).toEqual([]);
      expect(bad.problems.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the growth check\'s own files are exactly the ruled seven', () => {
    expect([...GROWTH_MACHINERY]).toEqual(MACHINERY);
  });

  it('every module the growth check loads is one of its own files, and every load in them can be followed', () => {
    const roots = ['server/test/growthCheck.ts', 'server/test/scan/parse.ts', 'server/test/rings/exemptions.ts',
      'server/test/growth-check.test.ts'];
    const { modules, unfollowable } = importClosure(roots);
    expect(modules, 'the closure walk lost a root').toEqual(expect.arrayContaining(roots));
    expect(modules.filter((p) => !GROWTH_MACHINERY.includes(p) && !(p in DECIDES_NOTHING)),
      'a module the growth check loads is outside GROWTH_MACHINERY: add it there').toEqual([]);
    expect(unfollowable, 'a load the closure walk cannot follow: write it as a literal relative import').toEqual([]);
  });

  it('the decision: a row fails when its file is over and no entry applies to it', () => {
    const e = parseExemptions(list(entry({ cap: 400 })), GROWTH_FILES, today).entries;
    const row = (delta: number): GrowthRow => ({ file: 'ccd/ccd', base: 1000, head: 1000 + delta, delta, atBoth: true });
    const table: [string, GrowthRow, string[], GrowthExemption[], number | null, string[], boolean, string][] = [
      ['not over', row(10), [], e, 1100, [], false, 'ccd/ccd: delta +10'],
      ['over, no entry', row(400), ['ccd/ccd'], [], 1100, [], true, 'ccd/ccd: delta +400 (GROWTH_OVER)'],
      ['over, waived, so not over', row(400), [], e, 1100, [], false, 'ccd/ccd: delta +400'],
      ['over, its entry, at the cap', row(400), ['ccd/ccd'], e, 1100, [], false, 'ccd/ccd: delta +400 (GROWTH_OVER, exempt: PR #1100, cap 400)'],
      ['over, its entry, past the cap', row(401), ['ccd/ccd'], e, 1100, [], true,
        'ccd/ccd: delta +401 (GROWTH_OVER, over its exemption cap of 400 for PR #1100)'],
      ['over, another PR\'s entry', row(400), ['ccd/ccd'], e, 1101, [], true, 'ccd/ccd: delta +400 (GROWTH_OVER)'],
      ['over, no PR number', row(400), ['ccd/ccd'], e, null, [], true, 'ccd/ccd: delta +400 (GROWTH_OVER)'],
      ['over, the measured diff edits the growth check\'s own files', row(400), ['ccd/ccd'], e, 1100, ['server/test/growth-exemptions.json'], true,
        'ccd/ccd: delta +400 (GROWTH_OVER, not exempt: the diff for PR #1100 edits the growth check\'s own server/test/growth-exemptions.json)'],
    ];
    for (const [what, r, over, entries, pr, touched, fails, title] of table) {
      const [v] = growthVerdicts([r], over, entries, pr, touched);
      expect({ fails: v!.fails, title: v!.title }, what).toEqual({ fails, title });
    }
    // An entry for another file leaves an over file failing.
    const rows = [row(400), { ...row(100), file: 'ccd/ccrc' }];
    const other = parseExemptions(list(entry({ file: 'ccd/ccrc' })), GROWTH_FILES, today).entries;
    expect(growthVerdicts(rows, ['ccd/ccd'], other, 1100, []).map((v) => [v.file, v.fails])).toEqual([['ccd/ccd', true], ['ccd/ccrc', false]]);
    expect(growthVerdicts([row(401)], ['ccd/ccd'], e, 1100, [])[0]!.why)
      .toBe('ccd/ccd grew by 401 net code lines, over its exemption cap of 400 for PR #1100');
    expect(growthVerdicts([row(400)], ['ccd/ccd'], [], 1100, [])[0]!.why).toBe('ccd/ccd grew by 400 net code lines, over the limit of 40');
  });

  it('the armed path, end to end: only origin/main\'s entry exempts, and never a PR that edits the growth check', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'growth-armed-'));
    try {
      const git = (...a: string[]): string => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
      const put = (rel: string, text: string): void => {
        execFileSync('mkdir', ['-p', path.dirname(path.join(dir, rel))]);
        writeFileSync(path.join(dir, rel), text);
      };
      const lines = (n: number): string => Array.from({ length: n }, (_, i) => `echo line-${i}\n`).join('');
      git('init', '-q');
      git('config', 'user.name', 'fixture');
      git('config', 'user.email', 'fixture@example.invalid');
      put('ccd/ccd', lines(10));
      put(GROWTH_EXEMPTIONS_FILE, list());
      git('add', '-A');
      git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      const vars = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1100/merge' };
      const ccd = (head: string) => armedGrowth(GROWTH_FILES, dir, git('merge-base', 'origin/main', head), head, vars, today)
        .verdicts.find((v) => v.file === 'ccd/ccd')!;
      // The PR grows ccd/ccd by 100 and adds its own entry; origin/main holds none.
      git('update-ref', 'refs/remotes/origin/main', base);
      git('checkout', '-q', '-b', 'pr');
      put('ccd/ccd', lines(110));
      put(GROWTH_EXEMPTIONS_FILE, list(entry({ cap: 100 })));
      git('commit', '-q', '-am', 'the PR names itself');
      const selfNamed = ccd(git('rev-parse', 'HEAD'));
      expect({ fails: selfNamed.fails, exemption: selfNamed.exemption }).toEqual({ fails: true, exemption: undefined });
      // The same growth with the entry on origin/main, and a PR that touches nothing of the check: exempt.
      git('checkout', '-q', '-B', 'main-side', base);
      put(GROWTH_EXEMPTIONS_FILE, list(entry({ cap: 100 })));
      git('commit', '-q', '-am', 'the operator names PR 1100');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      git('checkout', '-q', '-B', 'pr2', base);
      put('ccd/ccd', lines(110));
      git('commit', '-q', '-am', 'the PR grows ccd/ccd');
      const named = ccd(git('rev-parse', 'HEAD'));
      expect({ fails: named.fails, applies: named.exemption?.applies }).toEqual({ fails: false, applies: true });
      // That PR also edits one of the growth check's own files: no exemption. The list is written out here, not
      // read from GROWTH_MACHINERY, so a member dropped from the constant reds its case. The list file's case is the
      // ruling's "its own entry included": the entry stands on origin/main, and the PR re-writes the same entry.
      for (const f of MACHINERY) {
        git('checkout', '-q', '-B', 'pr3', 'pr2');
        put(f, f === GROWTH_EXEMPTIONS_FILE ? JSON.stringify({ exemptions: [entry({ cap: 100 })] }, null, 2) : '// an edit\n');
        git('add', '-A');
        git('commit', '-q', '-m', `the PR edits ${f}`);
        const v = ccd(git('rev-parse', 'HEAD'));
        expect({ fails: v.fails, touched: v.exemption?.touched }, f).toEqual({ fails: true, touched: [f] });
      }
      // A branch cut while the entry stood, after main has removed it: HEAD still carries the entry, and the diff
      // touches nothing of the check, so only a read of HEAD or the working tree would exempt it.
      const withEntry = git('rev-parse', 'main-side');
      git('checkout', '-q', '-B', 'main-side', withEntry);
      put(GROWTH_EXEMPTIONS_FILE, list());
      git('commit', '-q', '-am', 'the entry goes');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      git('checkout', '-q', '-B', 'pr4', withEntry);
      put('ccd/ccd', lines(110));
      git('commit', '-q', '-am', 'a stale branch grows ccd/ccd');
      const stale = ccd(git('rev-parse', 'HEAD'));
      expect({ fails: stale.fails, exemption: stale.exemption }).toEqual({ fails: true, exemption: undefined });
      // A replace ref that swaps origin/main's list blob for one naming the PR changes nothing the check reads.
      const forged = execFileSync('git', ['hash-object', '-w', '--stdin'],
        { cwd: dir, encoding: 'utf8', stdio: 'pipe', input: list(entry({ cap: 100 })) }).trim();
      git('replace', '-f', git('rev-parse', `origin/main:${GROWTH_EXEMPTIONS_FILE}`), forged);
      expect(git('show', `origin/main:${GROWTH_EXEMPTIONS_FILE}`), 'the replace ref is live for a plain read').toContain('1100');
      const replaced = ccd(git('rev-parse', 'HEAD'));
      expect({ fails: replaced.fails, exemption: replaced.exemption }).toEqual({ fails: true, exemption: undefined });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the summary names an exempted file as exempt, with the PR number, the cap and the ruling', () => {
    const e = parseExemptions(list(entry({ cap: 400 }), entry({ file: 'ccd/ccrc', cap: 50 })), GROWTH_FILES, today).entries;
    const rows = [
      { file: 'ccd/ccd', base: 1000, head: 1350, delta: 350, atBoth: true },
      { file: 'ccd/ccrc', base: 100, head: 160, delta: 60, atBoth: true },
    ];
    const over = ['ccd/ccd', 'ccd/ccrc'];
    const md = growthSummary({ base: 'abcdef1234567', rows, over, methods: { base: 1, head: 1 }, armed: true,
      exemptions: matchExemptions(over, rows, e, 1100) });
    // GROWTH_OVER still lists what grew; the annotation says which is exempt and which passed its cap.
    expect(md).toContain('GROWTH_OVER: `ccd/ccd` (exempt: PR #1100, cap 400, ruling: operator, 2026-10-21: named exempt for ccd/ccd only), '
      + '`ccd/ccrc` (over its exemption cap of 50 for PR #1100)');
    const plain = growthSummary({ base: 'abcdef1234567', rows, over, methods: { base: 1, head: 1 }, armed: true });
    expect(plain).toContain('GROWTH_OVER: `ccd/ccd`, `ccd/ccrc`');
    const edits = matchExemptions(['ccd/ccd'], rows, e, 1100, ['server/test/growthCheck.ts']);
    expect(overLine(['ccd/ccd'], edits)).toBe('ccd/ccd (not exempt: the diff for PR #1100 edits the growth check\'s own server/test/growthCheck.ts)');
  });

  it(`the HEAD copy of ${GROWTH_EXEMPTIONS_FILE} is well formed, and stamped under the 60-day rule`, () => {
    const text = readFileSync(path.join(ROOT, GROWTH_EXEMPTIONS_FILE), 'utf8');
    expect(parseExemptions(text, GROWTH_FILES).problems).toEqual([]);
    expect(GROWTH_EXEMPTIONS_STAMP).toBe(`${GROWTH_EXEMPTIONS_FILE}#exemptions`);
    expect(EXEMPTION_SET_STAMPS[GROWTH_EXEMPTIONS_STAMP], 'stamp the list in exemption-age.data.ts').toBeDefined();
  });
});

describe('growthCheck: the reviewed waiver ledger (D-6223)', () => {
  const today = new Date('2026-10-21T12:00:00Z');
  const PAYER = 'consolidation W5 (ccd in place) pays every entry down';
  const waiver = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    file: 'ccd/ccd', maxDelta: 60, d: 'D-6223', reason: 'a fixture: the verb grows ccd/ccd by design', added: '2026-10-21', ...over,
  });
  const ledger = (...waivers: unknown[]): string => JSON.stringify({ payer: PAYER, waivers }, null, 2);

  it('a well-formed ledger parses; one file may carry entries under two D-numbers', () => {
    expect(parseWaivers(ledger(), GROWTH_FILES, today)).toEqual({ payer: PAYER, entries: [], problems: [] });
    const two = parseWaivers(ledger(waiver(), waiver({ d: 'D-6178', maxDelta: 41 })), GROWTH_FILES, today);
    expect(two.problems).toEqual([]);
    expect(two.entries.map((e) => `${e.file} ${e.d} ${e.maxDelta}`)).toEqual(['ccd/ccd D-6223 60', 'ccd/ccd D-6178 41']);
  });

  it('every malformed shape is a problem, and a ledger with one waives nothing', () => {
    const noD = waiver();
    delete noD['d'];
    const shapes: [string, string, string][] = [
      ['not JSON', '{"waivers": [', 'not JSON'],
      ['a top-level array', '[]', 'two keys, `payer` and `waivers`'],
      ['no payer', JSON.stringify({ waivers: [] }), 'two keys, `payer` and `waivers`'],
      ['an extra key', JSON.stringify({ payer: PAYER, waivers: [], x: 1 }), 'two keys, `payer` and `waivers`'],
      ['waivers not an array', JSON.stringify({ payer: PAYER, waivers: {} }), 'two keys, `payer` and `waivers`'],
      ['a payer that is not W5', JSON.stringify({ payer: 'someone, later', waivers: [] }), 'the payer must name consolidation W5'],
      ['a two-line payer', JSON.stringify({ payer: 'consolidation\nW5', waivers: [] }), 'the payer must name consolidation W5'],
      ['an entry that is not an object', ledger('ccd/ccd'), '#0: not an object'],
      ['a missing key', ledger(noD), '#0: missing `d`'],
      ['an unknown key', ledger(waiver({ pr: 1 })), '#0: unknown key `pr`'],
      ['a file that is not listed', ledger(waiver({ file: 'server/src/index.ts' })), '#0: file must be one of the listed files'],
      ['a maxDelta at the limit', ledger(waiver({ maxDelta: GROWTH_LIMIT })), '#0: maxDelta must be an integer above 40'],
      ['a fractional maxDelta', ledger(waiver({ maxDelta: 60.5 })), '#0: maxDelta must be an integer above 40'],
      ['a string maxDelta', ledger(waiver({ maxDelta: '60' })), '#0: maxDelta must be an integer above 40'],
      ['a d that is not a D-number', ledger(waiver({ d: 'ARCH-01' })), '#0: d must be a D-number'],
      ['a d with a suffix', ledger(waiver({ d: 'D-6223a' })), '#0: d must be a D-number'],
      ['an empty reason', ledger(waiver({ reason: '' })), '#0: the reason must be one non-empty line'],
      ['a two-line reason', ledger(waiver({ reason: 'a\nb' })), '#0: the reason must be one non-empty line'],
      ['a reason that is not a string', ledger(waiver({ reason: 7 })), '#0: reason and added must be strings'],
      ['an added that is not a day', ledger(waiver({ added: '2026-02-30' })), "#0: since '2026-02-30' is not a YYYY-MM-DD day"],
      ['an added in the future', ledger(waiver({ added: '2026-10-22' })), "#0: since '2026-10-22' is in the future"],
      ['two entries for one file and one D-number', ledger(waiver(), waiver({ maxDelta: 90 })), '#1: a second entry for ccd/ccd and D-6223'],
    ];
    for (const [what, text, problem] of shapes) {
      const got = parseWaivers(text, GROWTH_FILES, today);
      expect(got.problems.some((p) => p.includes(problem)), `${what}: ${JSON.stringify(got.problems)}`).toBe(true);
      expect(got.entries, what).toEqual([]);
    }
  });

  it('an entry counts as added only when the base holds no entry for its file and D-number', () => {
    const w = (o: Record<string, unknown> = {}): GrowthWaiver => waiver(o) as unknown as GrowthWaiver;
    expect(waiversAdded([], [w()])).toEqual([w()]);
    expect(waiversAdded([w()], [w()])).toEqual([]);
    // Raising an entry the base already holds is not adding one: it waives nothing.
    expect(waiversAdded([w()], [w({ maxDelta: 400 })])).toEqual([]);
    expect(waiversAdded([w()], [w(), w({ d: 'D-6178' })])).toEqual([w({ d: 'D-6178' })]);
    expect(waiversAdded([w()], [w(), w({ file: 'ccd/ccrc' })])).toEqual([w({ file: 'ccd/ccrc' })]);
  });

  it('the decision: an over row passes only on an added entry for its file whose maxDelta covers the delta', () => {
    const row = (delta: number, file = 'ccd/ccd'): GrowthRow => ({ file, base: 1000, head: 1000 + delta, delta, atBoth: true });
    const w = (o: Record<string, unknown> = {}): GrowthWaiver => waiver(o) as unknown as GrowthWaiver;
    const table: [string, GrowthRow, GrowthWaiver[], boolean, string][] = [
      ['+60, no entry', row(60), [], true, 'ccd/ccd: delta +60 (GROWTH_OVER)'],
      ['+60, an entry of maxDelta 60', row(60), [w()], false, 'ccd/ccd: delta +60 (GROWTH_OVER, waived: D-6223, max 60)'],
      ['+60, an entry of maxDelta 50', row(60), [w({ maxDelta: 50 })], true,
        'ccd/ccd: delta +60 (GROWTH_OVER, over its ledger max of 50 under D-6223)'],
      ['+60, an entry for another file', row(60), [w({ file: 'ccd/ccrc' })], true, 'ccd/ccd: delta +60 (GROWTH_OVER)'],
      ['+60, two entries, the larger covers', row(60), [w({ maxDelta: 50 }), w({ d: 'D-6178', maxDelta: 70 })], false,
        'ccd/ccd: delta +60 (GROWTH_OVER, waived: D-6178, max 70)'],
      ['+10, not over, no note', row(10), [w()], false, 'ccd/ccd: delta +10'],
    ];
    for (const [what, r, waivers, fails, title] of table) {
      const [v] = growthVerdicts([r], r.delta > GROWTH_LIMIT ? [r.file] : [], [], null, [], waivers);
      expect({ fails: v!.fails, title: v!.title }, what).toEqual({ fails, title });
    }
    expect(growthVerdicts([row(60)], ['ccd/ccd'], [], null, [], [w({ maxDelta: 50 })])[0]!.why)
      .toBe('ccd/ccd grew by 60 net code lines, over its ledger max of 50 under D-6223');
    expect(overLine(['ccd/ccd'], [], (f) => f, growthVerdicts([row(60)], ['ccd/ccd'], [], null, [], [w()]).flatMap((v) => (v.waiver ? [v.waiver] : []))))
      .toBe('ccd/ccd (waived: D-6223, max 60, ledger entry added 2026-10-21)');
  });

  it('the armed path, end to end: only an entry the PR\'s own diff adds waives, and only up to its maxDelta', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'growth-waiver-'));
    try {
      const git = (...a: string[]): string => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
      const put = (rel: string, text: string): void => {
        execFileSync('mkdir', ['-p', path.dirname(path.join(dir, rel))]);
        writeFileSync(path.join(dir, rel), text);
      };
      const lines = (n: number): string => Array.from({ length: n }, (_, i) => `echo line-${i}\n`).join('');
      git('init', '-q');
      git('config', 'user.name', 'fixture');
      git('config', 'user.email', 'fixture@example.invalid');
      put('ccd/ccd', lines(10));
      put(GROWTH_WAIVERS_FILE, ledger());
      git('add', '-A');
      git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      git('update-ref', 'refs/remotes/origin/main', base);
      const ccd = (head: string) => armedGrowth(GROWTH_FILES, dir, git('merge-base', 'origin/main', head), head, {}, today)
        .verdicts.find((v) => v.file === 'ccd/ccd')!;
      /** A PR off `from` that grows ccd/ccd by 60 and writes `text` as the ledger (unchanged when undefined). */
      const pr = (name: string, from: string, text?: string) => {
        git('checkout', '-q', '-B', name, from);
        put('ccd/ccd', lines(70));
        if (text !== undefined) put(GROWTH_WAIVERS_FILE, text);
        git('add', '-A');
        git('commit', '-q', '-m', name);
        return ccd(git('rev-parse', 'HEAD'));
      };
      expect(pr('no-entry', base).fails, '+60 with no entry').toBe(true);
      const sixty = pr('max-60', base, ledger(waiver()));
      expect({ fails: sixty.fails, max: sixty.waiver?.entry.maxDelta }, '+60 with maxDelta 60').toEqual({ fails: false, max: 60 });
      expect(pr('max-50', base, ledger(waiver({ maxDelta: 50 }))).fails, '+60 with maxDelta 50').toBe(true);
      expect(pr('other-file', base, ledger(waiver({ file: 'ccd/ccrc' }))).fails, 'an entry for another file').toBe(true);
      const malformed = pr('malformed', base, ledger(waiver({ maxDelta: 60.5 })));
      expect(malformed.fails, 'a malformed ledger waives nothing').toBe(true);
      // An entry an EARLIER commit on main added does not waive a later PR.
      git('checkout', '-q', '-B', 'main-side', base);
      put(GROWTH_WAIVERS_FILE, ledger(waiver()));
      git('commit', '-q', '-am', 'an earlier PR lands its entry');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      const onMain = git('rev-parse', 'HEAD');
      expect(pr('later', onMain).fails, 'an entry already on main').toBe(true);
      expect(pr('raised', onMain, ledger(waiver({ maxDelta: 400 }))).fails, 'raising main\'s entry').toBe(true);
      expect(pr('own-entry', onMain, ledger(waiver(), waiver({ d: 'D-6178' }))).fails, 'its own new entry beside main\'s').toBe(false);
      // A malformed ledger at the merge-base waives nothing either, so old entries cannot pass as new.
      git('checkout', '-q', '-B', 'main-bad', base);
      put(GROWTH_WAIVERS_FILE, '{"waivers": [');
      git('commit', '-q', '-am', 'main holds a broken ledger');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      const badBase = waiversInDiff(GROWTH_FILES, git('rev-parse', 'HEAD'), git('rev-parse', 'max-60'), dir, today);
      expect(badBase.added).toEqual([]);
      expect(badBase.problems.some((p) => p.startsWith('base: ')), JSON.stringify(badBase.problems)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it(`the HEAD copy of ${GROWTH_WAIVERS_FILE} is well formed, names W5 as the payer, and cites only D-numbers the plans define`, () => {
    const text = readFileSync(path.join(ROOT, GROWTH_WAIVERS_FILE), 'utf8');
    const got = parseWaivers(text, GROWTH_FILES);
    expect(got.problems).toEqual([]);
    expect(got.payer).toMatch(/\bconsolidation W5\b/);
    const defined = definedDNumbers();
    expect(got.entries.filter((e) => !defined.has(e.d)).map((e) => `${e.file} ${e.d}`), 'define the D-number in a plan first').toEqual([]);
    // The ledger's own number is defined once, in the W0 plan, and names W5 as the payer.
    const w0 = readFileSync(path.join(ROOT, 'docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md'), 'utf8')
      .split('\n').filter((l) => l.startsWith('- **D-6223**'));
    expect(w0).toHaveLength(1);
    expect(w0[0]).toContain('shrink-only debt that consolidation W5');
    expect(w0[0]).toMatch(/\) pays/);
  });
});

/** The D-numbers a plan defines: a `- **D-N**` bullet or a `## D-N` heading, deviation-refs' DEFINED shape. */
function definedDNumbers(): Set<string> {
  const dir = path.join(ROOT, 'docs/superpowers/plans');
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    for (const line of readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      const m = /^(?:#{2,4} |- \*\*)(D-\d+)\b/.exec(line);
      if (m) out.add(m[1]!);
    }
  }
  return out;
}

/** The base, or why the growth rows cannot measure. */
function resolveBase(): { base: string } | { skip: string } {
  if (!process.env['CI'] && !process.env['GROWTH_CHECK']) {
    return { skip: 'not in CI (set GROWTH_CHECK=1 to run locally)' };
  }
  try {
    gitRead(['rev-parse', '--verify', '--quiet', 'origin/main^{commit}'], ROOT);
  } catch {
    return { skip: 'no origin/main in this checkout' };
  }
  try {
    const base = gitRead(['merge-base', 'origin/main', 'HEAD'], ROOT).trim();
    return { base };
  } catch {
    return { skip: 'no merge-base between origin/main and HEAD' };
  }
}

/** Modules the growth check may load that decide nothing, each with why; empty today. */
const DECIDES_NOTHING: Readonly<Record<string, string>> = {};

/** The relative-import closure of `roots` (repo paths), and every load in it the walk cannot follow: a `require(…)` or
 *  `createRequire` call, an import of `node:module`, or an `import(…)` whose argument is not a literal. */
function importClosure(roots: readonly string[]): { modules: string[]; unfollowable: string[] } {
  const seen = new Set<string>();
  const unfollowable: string[] = [];
  const queue = [...roots];
  while (queue.length) {
    const rel = queue.shift()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(ROOT, rel);
    const parsed = parseFile(abs);
    for (const spec of parsed.imports.map((i) => i.specifier)) {
      if (spec === 'module' || spec === 'node:module') unfollowable.push(`${rel}: imports ${spec}`);
      if (!spec.startsWith('.')) continue;
      const target = path.resolve(path.dirname(abs), spec);
      const asTs = target.replace(/\.js$/, '.ts');
      queue.push(path.relative(ROOT, target !== asTs && existsSync(asTs) ? asTs : target));
    }
    for (const c of parsed.calls) {
      if (c.name === 'require' || c.name === 'createRequire') unfollowable.push(`${rel}:${c.line}: ${c.name}(…)`);
    }
    // The parser records an `import(…)` only when its argument is a literal, so any `import(` in the code (comments
    // stripped) beyond the ones it recorded has a computed specifier.
    const calls = stripTs(parsed.text).match(/\bimport\s*\(/g)?.length ?? 0;
    const literal = parsed.imports.filter((i) => i.kind === 'dynamic' || i.kind === 'type-query').length;
    if (calls > literal) unfollowable.push(`${rel}: ${calls - literal} dynamic imports of a computed specifier`);
  }
  return { modules: [...seen].sort(), unfollowable };
}

const resolved = resolveBase();
const measured = 'base' in resolved
  ? (() => {
      const head = gitRead(['rev-parse', 'HEAD'], ROOT).trim();
      // D-6211: one helper reads and decides; the exemption list is origin/main's copy, never this checkout's.
      const armed = armedGrowth(GROWTH_FILES, ROOT, resolved.base, head, process.env);
      // D-6119: absolute numbers go to the job summary only, never an assertion.
      const methods = methodCounts(METHOD_COUNT_FILE, METHOD_COUNT_CLASS, resolved.base, head, ROOT);
      const summaryWritten = appendJobSummary(growthSummary({ base: resolved.base, rows: armed.rows, over: armed.over,
        methods, armed: GROWTH_ARMED, exemptions: armed.exemptions, waivers: armed.waivers }));
      return { ...armed, summaryWritten };
    })()
  : null;

if (measured === null) {
  console.log(`growth-check: skipped, ${'skip' in resolved ? resolved.skip : ''}`);
} else {
  console.log(['growth-check: net code lines against the merge-base',
    ...measured.rows.map((r) => `  ${r.file.padEnd(28)} base ${String(r.base).padStart(6)}  head ${String(r.head).padStart(6)}  delta ${r.delta >= 0 ? '+' : ''}${r.delta}`),
    `GROWTH_OVER: ${overLine(measured.over, measured.exemptions, (f) => f, measured.waivers)}`,
    `PR: ${measured.pr === null ? '(none: no entry applies)' : `#${measured.pr}`}; `
      + `exemption entries on origin/main: ${measured.onMain.entries.length}; `
      + `growth-check files this diff edits: ${measured.touched.length ? measured.touched.join(', ') : '(none)'}; `
      + `ledger entries this diff adds: ${measured.ledger.added.map((w) => `${w.file} ${w.d} max ${w.maxDelta}`).join(', ') || '(none)'}`].join('\n'));
  for (const p of measured.ledger.problems) {
    console.warn(`growth-check: ${GROWTH_WAIVERS_FILE} is malformed, so it waives nothing: ${p}`);
  }
  for (const p of measured.onMain.problems) {
    console.warn(`growth-check: origin/main's ${GROWTH_EXEMPTIONS_FILE} is malformed, so it exempts nothing: ${p}`);
  }
  for (const f of measured.over) {
    if (!GROWTH_ARMED) console.warn(`growth-check: ${f} grew by more than ${GROWTH_LIMIT} net code lines (reporting only until OA-C2)`);
  }
}

describe.skipIf(measured === null)('growth-check: the listed files against the merge-base (D-5848)', () => {
  it('the job summary is written whenever the runner names a summary file (D-6119)', () => {
    expect(measured!.summaryWritten).toBe(Boolean(process.env['GITHUB_STEP_SUMMARY']));
  });
  it(`${GROWTH_WAIVERS_FILE} is shrink-only debt: no entry the merge-base holds is edited, and every added one cites a defined D-number (D-6223)`, () => {
    const at = (sha: string): GrowthWaiver[] => {
      const text = gitRead(['show', `${sha}:${GROWTH_WAIVERS_FILE}`], ROOT);
      return parseWaivers(text, GROWTH_FILES).entries;
    };
    let base: GrowthWaiver[] = [];
    // Absent at the merge-base (the ledger's own landing), the base holds no entry.
    try { base = at((resolved as { base: string }).base); } catch { base = []; }
    const head = parseWaivers(readFileSync(path.join(ROOT, GROWTH_WAIVERS_FILE), 'utf8'), GROWTH_FILES).entries;
    const edited = head.filter((h) => base.some((b) => b.file === h.file && b.d === h.d && JSON.stringify(b) !== JSON.stringify(h)));
    expect(edited.map((e) => `${e.file} ${e.d}`), 'an entry on the merge-base is never edited; add a new one under its own D-number').toEqual([]);
    const defined = definedDNumbers();
    expect(waiversAdded(base, head).filter((w) => !defined.has(w.d)).map((w) => w.d)).toEqual([]);
  });
  for (const v of measured?.verdicts ?? []) {
    it(v.title, () => {
      if (GROWTH_ARMED) expect(v.fails, v.why).toBe(false);
    });
  }
});

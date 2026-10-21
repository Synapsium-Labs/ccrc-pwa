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
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stripTs, measureBash, codeLines, netGrowth, growthOver, addedFiles,
  GROWTH_LIMIT, L1_L2_NEW_FILE_DIRS,
  classMethodCount, methodCounts, growthSummary, appendJobSummary, METHOD_COUNT_CLASS, METHOD_COUNT_FILE,
} from './growthCheck.js';

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

/** The base, or why the growth rows cannot measure. */
function resolveBase(): { base: string } | { skip: string } {
  if (!process.env['CI'] && !process.env['GROWTH_CHECK']) {
    return { skip: 'not in CI (set GROWTH_CHECK=1 to run locally)' };
  }
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main^{commit}'], { cwd: ROOT, stdio: 'pipe' });
  } catch {
    return { skip: 'no origin/main in this checkout' };
  }
  try {
    const base = execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();
    return { base };
  } catch {
    return { skip: 'no merge-base between origin/main and HEAD' };
  }
}

const resolved = resolveBase();
const measured = 'base' in resolved
  ? (() => {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
      const rows = GROWTH_FILES.map((f) => netGrowth(f, resolved.base, head, ROOT));
      const over = growthOver(rows, addedFiles(resolved.base, head, ROOT));
      // D-6119: absolute numbers go to the job summary only, never an assertion.
      const methods = methodCounts(METHOD_COUNT_FILE, METHOD_COUNT_CLASS, resolved.base, head, ROOT);
      const summaryWritten = appendJobSummary(growthSummary({ base: resolved.base, rows, over,
        methods, armed: GROWTH_ARMED }));
      return { rows, over, summaryWritten };
    })()
  : null;

if (measured === null) {
  console.log(`growth-check: skipped, ${'skip' in resolved ? resolved.skip : ''}`);
} else {
  console.log(['growth-check: net code lines against the merge-base',
    ...measured.rows.map((r) => `  ${r.file.padEnd(28)} base ${String(r.base).padStart(6)}  head ${String(r.head).padStart(6)}  delta ${r.delta >= 0 ? '+' : ''}${r.delta}`),
    `GROWTH_OVER: ${measured.over.length ? measured.over.join(', ') : '(none)'}`].join('\n'));
  for (const f of measured.over) {
    if (!GROWTH_ARMED) console.warn(`growth-check: ${f} grew by more than ${GROWTH_LIMIT} net code lines (reporting only until OA-C2)`);
  }
}

describe.skipIf(measured === null)('growth-check: the listed files against the merge-base (D-5848)', () => {
  it('the job summary is written whenever the runner names a summary file (D-6119)', () => {
    expect(measured!.summaryWritten).toBe(Boolean(process.env['GITHUB_STEP_SUMMARY']));
  });
  for (const r of measured?.rows ?? []) {
    const over = measured!.over.includes(r.file);
    it(`${r.file}: delta ${r.delta >= 0 ? '+' : ''}${r.delta}${over ? ' (GROWTH_OVER)' : ''}`, () => {
      if (GROWTH_ARMED) {
        expect(over, `${r.file} grew by ${r.delta} net code lines, over the limit of ${GROWTH_LIMIT}`).toBe(false);
      }
    });
  }
});

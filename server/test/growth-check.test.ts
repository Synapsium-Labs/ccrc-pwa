// D-5848 (ARCH-01, #526; consolidation spec §5.2): the god-file growth check.
// Net code-line growth of the listed files against the merge-base with
// `origin/main`, one stripper per language (`growthCheck.ts`). It REPORTS: a file
// that grew by more than GROWTH_LIMIT net code lines is printed with
// `console.warn` and named in the `GROWTH_OVER` list, and the suite stays green
// until the operator arms it (OA-C2), one commit that flips GROWTH_ARMED and
// nothing else. No per-file absolute constant lives here, so two PRs in flight
// cannot conflict on this file.
//
// It reads `.git` (`git merge-base`, `git show`), so the CI selector's rule 2
// (ALWAYS) runs it on every PR without a workflow edit. Outside CI (no `CI` in
// the environment; set GROWTH_CHECK=1 to run it locally) or with no
// `origin/main`, the growth rows skip with a printed notice and never fail
// falsely. The stripper's own rows below always run.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stripTs, measureBash, codeLines, netGrowth, growthOver, addedFiles,
  GROWTH_LIMIT, L1_L2_NEW_FILE_DIRS,
} from './growthCheck.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');

/** Flipped to `true` by OA-C2 in one commit and nothing else. */
const GROWTH_ARMED = false;

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
      return { rows, over };
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
  for (const r of measured?.rows ?? []) {
    const over = measured!.over.includes(r.file);
    it(`${r.file}: delta ${r.delta >= 0 ? '+' : ''}${r.delta}${over ? ' (GROWTH_OVER)' : ''}`, () => {
      if (GROWTH_ARMED) {
        expect(over, `${r.file} grew by ${r.delta} net code lines, over the limit of ${GROWTH_LIMIT}`).toBe(false);
      }
    });
  }
});

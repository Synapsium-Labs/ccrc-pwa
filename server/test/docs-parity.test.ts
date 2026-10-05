// Docs parity (spec 2026-10-01): a value the Docs feature spells in more than one place is held equal here, and a
// value it spells in one place is held to that one place where single-definition.test.ts cannot see it.
// Docs W1a Task 5 lands M7.3's TS half: one DOCS_PAGE_PREFIX across the four TS roots. Later W1 tasks append the
// helper's rows below (row 48, row 62, M3.12, helper hygiene); W4 appends M7.3's doctor half. APPEND ONLY.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_PAGE_PREFIX } from '../../shared/docs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');
const rel = (p: string): string => path.relative(ccrcRoot, p);

/** single-definition.test.ts's four ROOTS, walked the same way: `.ts`/`.tsx` only, and `__`-prefixed entries
 *  skipped, because those are transient mutants a parallel suite writes and deletes (`boot.test.ts`). */
const TS_ROOTS = ['shared', path.join('server', 'src'), path.join('pwa', 'src'), path.join('agent', 'src')]
  .map((r) => path.join(ccrcRoot, r));
function tsSources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e.startsWith('__')) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...tsSources(p)); continue; }
    if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** One entry per DECLARATION of DOCS_PAGE_PREFIX, named by its file: exported or not, const, let or var. An
 *  import, a use, a re-export and a comment declare nothing. */
const PREFIX_DEF = /^\s*(?:export\s+)?(?:const|let|var)\s+DOCS_PAGE_PREFIX\s*=/gm;
function prefixDefs(files: readonly (readonly [string, string])[]): string[] {
  const out: string[] = [];
  for (const [name, text] of files) {
    const n = text.match(PREFIX_DEF)?.length ?? 0;
    for (let i = 0; i < n; i++) out.push(name);
  }
  return out;
}

describe('M7.3 (TS half): one DOCS_PAGE_PREFIX across the four TS roots', () => {
  it('CONTROL: the scan counts every declaration shape, two in one file as two, and nothing else', () => {
    expect(prefixDefs([
      ['a.ts', "export const DOCS_PAGE_PREFIX = '/docs';"],
      ['b.ts', "  const DOCS_PAGE_PREFIX='/docs';\nlet DOCS_PAGE_PREFIX = p;"],
      ['c.ts', [
        "import { DOCS_PAGE_PREFIX } from '../../shared/docs.js';",
        "const p = DOCS_PAGE_PREFIX + '/';",
        "// const DOCS_PAGE_PREFIX = '/docs' (prose)",
        'export { DOCS_PAGE_PREFIX };',
        "if (u.startsWith(DOCS_PAGE_PREFIX)) return '/docs';",
      ].join('\n')],
    ])).toEqual(['a.ts', 'b.ts', 'b.ts']);
  });

  it('is declared exactly once, in shared/docs.ts', () => {
    const files = TS_ROOTS.flatMap(tsSources).map((f) => [rel(f), readFileSync(f, 'utf8')] as const);
    // Vacuity: the walk reached all four roots, so an empty result could not pass the pin below.
    for (const want of ['shared/docs.ts', 'server/src/index.ts', 'pwa/src/app.tsx', 'agent/src/server.ts']) {
      expect(files.map(([name]) => name), want).toContain(want);
    }
    expect(prefixDefs(files)).toEqual(['shared/docs.ts']);
  });

  it("its value is '/docs': the declaration is that literal, and the import reads it", () => {
    expect(DOCS_PAGE_PREFIX).toBe('/docs');
    expect(readFileSync(path.join(ccrcRoot, 'shared', 'docs.ts'), 'utf8'))
      .toMatch(/^export const DOCS_PAGE_PREFIX = '\/docs';$/m);
  });
});

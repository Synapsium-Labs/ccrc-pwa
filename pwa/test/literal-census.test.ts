// A SENTENCE WRITTEN TWICE is copy that drifts, and this is the census that
// will not let a third appear.
//
// WHY A FOURTH CENSUS. The three before it read STRUCTURE — stylesheet rules
// (`shape-census`), JSX trees, `className=` literals and leaf attribute sets
// (`markup-census`), hand-drawn controls (`control-census`). Every one of them
// is blind, by construction, to a string that is none of those. Measured, not
// argued: a single scan of this tree found SEVENTEEN duplicated literals, and
// eleven were real copy no census could see —
//
//   * `tmux unreachable — <reason>` in SEVEN files, three of them carrying a
//     comment that said the string was "never a second copy";
//   * `that run is gone — the board will catch up` in two refusal `Record`s;
//   * `This workspace is claimed` as a `title=` prop and as a computed title;
//   * `${reads} graphify read(s) this session` in two chips;
//   * three pool sentences across four surfaces;
//   * one `console.warn` in three pollers of one route;
//   * `(prefers-reduced-motion: reduce)` in the app's router and in the design
//     system's own hook;
//   * `merged, ready to clean up` in a header and in `StatusDot`'s map;
//   * two class strings assigned to CONSTANTS, which the markup census's
//     literal half cannot see because it reads `className=` attributes.
//
// WHAT IT READS. Every string literal, no-substitution template and template
// SKELETON (the head plus each span's literal, with the expressions replaced
// by one placeholder) in both packages and in `shared/`. A skeleton so that
// `Couldn't set the pool — ${a}` and `Couldn't set the pool — ${b}` are one
// sentence, which is what they are.
//
// THE TWO FLOORS, both measured. TWENTY-FIVE characters: at 15 the census
// fills with `data-testid` values and two-word labels that are the same word
// twice, not the same decision; at 40 it loses `This workspace is claimed`
// (25) and `merged, ready to clean up` (25), which are exactly the copies a
// reader wants named. And the literal must contain a SPACE or sentence
// punctuation: without that rule every `camelCaseIdentifier` and
// `kebab-case-slug` in the tree qualifies on length alone, and an identifier
// repeated is a vocabulary being USED, which is the point of a vocabulary.
//
// IMPORT SPECIFIERS ARE NOT COPY. `'../primitives/collapsible-strip'` in two
// files is two modules importing one module — the opposite of drift. They are
// excluded by their POSITION in the syntax tree, never by a path-shaped
// pattern, so a sentence that happens to look like a path still counts.
//
// MEASURED. Five mutations, each run against the whole file:
//
//   | mutation                                            | result     |
//   |-----------------------------------------------------|------------|
//   | a 30-char sentence copied into two app files        | 1 red      |
//   | the registry's one entry deleted                    | 1 red      |
//   | an entry for a literal that is not duplicated       | 1 red      |
//   | the file walk returns an empty list                 | 2 red      |
//   | the import-specifier exclusion removed              | 2 red      |
//
// Baseline: 4 passed.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const PKG = path.join(import.meta.dirname, '..', '..');

function sources(tag: string, root: string): [string, string][] {
  const out: [string, string][] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p) && !p.endsWith('.stories.tsx') && !p.endsWith('.d.ts')) {
        out.push([`${tag}/${path.relative(root, p)}`, p]);
      }
    }
  };
  walk(root);
  return out;
}

const FILES = [
  ...sources('pwa', path.join(PKG, 'pwa', 'src')),
  ...sources('ui', path.join(PKG, 'ui', 'src')),
  ...sources('shared', path.join(PKG, 'shared')),
];

const MIN_CHARS = 25;
/** The placeholder a template's expressions collapse to. A private-use code
 *  point, so no real string can contain it. */
const HOLE = '';

/** An import/export specifier, or a `import()` argument — the three positions
 *  where a string names a MODULE rather than saying something. Excluded by
 *  position, not by shape. */
function isSpecifier(n: ts.Node): boolean {
  const p = n.parent as ts.Node | undefined;
  if (p === undefined) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return p.moduleSpecifier === n;
  if (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isImportTypeNode(p) || (p.parent !== undefined && ts.isImportTypeNode(p.parent))) return true;
  return false;
}

function literals(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [name, file] of FILES) {
    const src = ts.createSourceFile(
      file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node): void => {
      let text: string | null = null;
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !isSpecifier(n)) {
        text = n.text;
      } else if (ts.isTemplateExpression(n)) {
        text = n.head.text + n.templateSpans.map((s) => HOLE + s.literal.text).join('');
      }
      if (text !== null) {
        const t = text.trim();
        if (t.length >= MIN_CHARS && /[ .?!—:]/.test(t)) {
          const line = src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
          const at = `${name}:${line}`;
          const prev = found.get(t);
          if (prev === undefined) found.set(t, [at]); else prev.push(at);
        }
      }
      n.forEachChild(visit);
    };
    visit(src);
  }
  return found;
}

/** ACROSS FILES, never within one. A literal repeated inside ONE file is that
 *  file's own business — two arms of a ternary, a fixture used twice — and the
 *  drift this census is about is between files that cannot see each other. */
const duplicated = (m: Map<string, string[]>): string[] =>
  [...m.entries()]
    .filter(([, v]) => new Set(v.map((a) => a.slice(0, a.lastIndexOf(':')))).size >= 2)
    .map(([k]) => k)
    .sort();

/** Every cross-file literal, with the reason it is still two literals.
 *
 *  An entry is a decision, not an exemption: either these two sentences are
 *  two decisions that happen to agree today, or this is the next fold and the
 *  reason says what it is waiting on. Checked in both directions. */
const REGISTERED: Record<string, string> = {
  // No NEXT. The one entry below is argued, not deferred.
  'The latest read failed — this is the last answer that landed.':
    'TWO SECTIONS, TWO COPIES, agreeing today. `SettingsScreen`\'s `STALE_TEXT` '
    + 'is the UPDATE plane\'s sentence for a poll that failed after one landed; '
    + '`STALL_SECTION_TEXT.stale` (shared/api.ts) is the stall-watch section\'s '
    + 'for its own read. They are two surfaces with two owners — the stall '
    + 'watch\'s whole copy table is in L0 because the SERVER composes some of '
    + 'it, and the update plane\'s is not — so folding them would make one '
    + 'section\'s rewording silently reword the other. The repo\'s own pattern '
    + 'is a copy table per surface (`ABANDON_COPY`, `RECLAIM_COPY`), and this '
    + 'is that pattern costing one duplicated sentence.',
};

describe('literal census', () => {
  it('registers every literal written in two files', () => {
    const dups = duplicated(literals());
    const missing = dups.filter((d) => REGISTERED[d] === undefined);
    expect(missing, 'a sentence spelled in two files is copy that drifts — register it or fold it')
      .toEqual([]);
  });

  it('keeps no stale entry', () => {
    const dups = new Set(duplicated(literals()));
    const stale = Object.keys(REGISTERED).filter((k) => !dups.has(k));
    expect(stale, 'this literal is no longer duplicated — drop the entry').toEqual([]);
  });

  it('gives every entry a reason long enough to be one', () => {
    for (const [k, why] of Object.entries(REGISTERED)) expect(why.length, k).toBeGreaterThan(60);
  });

  it('reads strings at all, and still excludes specifiers', () => {
    // The whole census is a parse away from a serene zero.
    expect(FILES.length).toBeGreaterThan(80);
    const all = literals();
    expect(all.size).toBeGreaterThan(300);
    // The exclusion is asserted rather than assumed: this path is imported by
    // two files in `@ccrc/ui` and would be a duplicate without it.
    expect([...all.keys()], 'an import specifier reached the census')
      .not.toContain('../primitives/collapsible-strip');
  });
});

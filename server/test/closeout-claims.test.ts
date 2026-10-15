// A CLOSE-OUT DOCUMENT IS PROSE, AND PROSE IS A REQUEST.
//
// `docs/superpowers/plans/2026-10-11-design-system-audit-closeout.md` maps every
// item of the design-system audit to what delivered it and the suite that keeps
// it true. That is exactly the shape of claim this repo does not accept on a
// document's word: a comment is a request; a red suite is a mechanism. A wave
// that renames a guard file, or rewrites the one test a row leans on, leaves the
// table pointing at nothing while it still reads as a complete audit trail.
//
// So the table is checked. Three claims, each the kind that rots quietly:
//
//   * every test file it names as a mechanism EXISTS — a renamed guard turns
//     the table into a list of reassurances;
//   * every test it names inside such a file, written `` `<file>` › "<title>" ``,
//     is still DECLARED there, and is not skipped — a file that exists but no
//     longer carries the assertion is the same reassurance one level down;
//   * the audit page it points at exists, since the document's one external
//     dependency is that file, and the whole reason both live in the tree is
//     that the link they used to be was deleted twice.
//
// WHAT THIS DOES NOT CHECK, AND WHY: the commit hashes. The document still
// cites them as provenance, but this repository only squash-merges, so a
// branch commit is never an ancestor of `main` once the branch lands. A check
// of `git merge-base --is-ancestor <hash> HEAD` passes on the pull request and
// is red on `main` for good after the squash (measured on #346: 12 of 12 cited
// hashes were ancestors of the branch and 0 of `main`). A citation that only
// resolves before the merge cannot be the thing a merged suite asserts. Files
// and test titles survive a squash unchanged, which is why they are what is
// checked.
//
// It also does not check whether each item was a good idea, or whether the
// mechanism named is the RIGHT one. Those are judgements, and a test that
// claimed to measure them would be lying about its scope.
//
// SCOPE: this file is about ONE document. If a second close-out is ever
// written, the honest move is to generalise the reader rather than to copy the
// file, and the `DOC` constant is the one line that would have to move.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const DOC = path.join(
  ROOT, 'docs', 'superpowers', 'plans', '2026-10-11-design-system-audit-closeout.md',
);

const text = (): string => readFileSync(DOC, 'utf8');

/** The roots a mechanism can live in. `ui/src/lib` is here because the first
 *  run of this test reported `cn.ts` missing — which it is not; it is the
 *  design system's class merger, and the defect that wave found lives inside
 *  it. The reader was wrong, not the document. */
const ROOTS = [
  'server/test', 'pwa/test', 'pwa/design', 'ui/design',
  'pwa/src/session', 'pwa/src/lib', 'ui/src/lib',
];

/** Every place under `ROOTS` a cited basename resolves to. */
function locate(file: string): string[] {
  return ROOTS.map((r) => path.join(ROOT, r, file)).filter((p) => existsSync(p));
}

/** Every `` `<name>.test.ts` `` / `.test.tsx` the document names as a
 *  mechanism, with the `.mjs` tools it cites beside them. */
function citedFiles(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/`([\w.-]+\.(?:test\.tsx?|mjs|ts))`/g)) out.add(m[1] ?? '');
  return [...out].sort();
}

interface TitleCitation { file: string; title: string }

/** Every `` `<file>.test.ts(x)` › "<title>" `` pair: a suite named together with
 *  one test it declares. The separator is the single right-pointing angle
 *  quote, so ordinary prose that happens to quote something beside a file name
 *  is never read as a citation. Deduplicated on the pair. */
function citedTitles(src: string): TitleCitation[] {
  const out = new Map<string, TitleCitation>();
  for (const m of src.matchAll(/`([\w.-]+\.test\.tsx?)` › "([^"\n]+)"/g)) {
    const file = m[1] ?? '';
    const title = m[2] ?? '';
    out.set(`${file}\0${title}`, { file, title });
  }
  return [...out.values()].sort((a, b) =>
    a.file === b.file ? a.title.localeCompare(b.title) : a.file.localeCompare(b.file));
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does `source` DECLARE a live test or block titled exactly `title`?
 *
 *  The title has to be the first argument of an `it`/`test`/`describe` call,
 *  in any of the three quote forms, so a comment or an assertion message that
 *  repeats the words does not count. Modifiers are allowed (`it.each`,
 *  `it.skipIf(cond)`, `describe.sequential`) except `skip` and `todo`: a
 *  skipped test keeps nothing true, so citing one is citing nothing. */
function declaresTitle(source: string, title: string): boolean {
  const call = new RegExp(
    String.raw`\b(?:it|test|describe)((?:\.\w+(?:\([^)]*\))?)*)\(\s*(['"\x60])`
      + escapeRe(title) + String.raw`\2`,
    'g',
  );
  for (const m of source.matchAll(call)) {
    if (!/\.(?:skip|todo)\b/.test(m[1] ?? '')) return true;
  }
  return false;
}

describe('the design-system audit close-out is checkable, not self-asserted', () => {
  it('exists, and so does the audit page it is the map to', () => {
    // The pair is the deliverable: the page is the measurement, this document
    // is what delivered which row of it. Either one alone is half a record.
    expect(existsSync(DOC), 'the close-out document is gone').toBe(true);
    expect(
      existsSync(path.join(
        ROOT, 'docs', 'superpowers', 'specs', '2026-10-11-design-system-audit.html',
      )),
      'the audit page is gone — the close-out points at nothing',
    ).toBe(true);
  });

  it('says in its own first lines that it is closed', () => {
    // The status is the one claim a reader acts on without reading further, so
    // it is the one claim worth pinning verbatim.
    expect(text().slice(0, 400)).toContain('**Status:** CLOSED');
  });

  it('cites mechanisms that exist', () => {
    const cited = citedFiles(text());
    expect(cited.length, 'the table names no suite — nothing keeps any row true').toBeGreaterThan(5);
    const missing = cited.filter((f) => locate(f).length === 0);
    expect(missing, 'the close-out names a file that does not exist — a renamed guard').toEqual([]);
  });

  it('cites, by title, tests those mechanisms still declare', () => {
    const cited = citedTitles(text());
    expect(cited.length, 'the document names no test by title — the rows lean on file names alone')
      .toBeGreaterThanOrEqual(10);
    const gone = cited.filter(({ file, title }) =>
      !locate(file).some((p) => declaresTitle(readFileSync(p, 'utf8'), title)));
    expect(
      gone.map(({ file, title }) => `${file} › "${title}"`),
      'a cited test is no longer declared (renamed, removed or skipped) — re-point the row',
    ).toEqual([]);
  });

  it('names every queue item, so a row cannot quietly go missing', () => {
    // The audit's queue was ten numbered items plus two rulings. A close-out
    // that dropped one would still read as complete, which is the failure this
    // assertion is for.
    const src = text();
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(src, `queue item ${n} is not in the table`).toMatch(new RegExp(`\\|\\s*${n}\\s*\\|`));
    }
    for (const v of ['V1', 'V2']) expect(src, `${v} is not in the table`).toContain(`| ${v} |`);
  });
});

// The guard that guards the guard. The corpus checks above pass vacuously if
// the reader finds nothing, or if the matcher matches anything at all.
describe('the title reader', () => {
  it('reads a citation, and only the citation form', () => {
    const doc = [
      '| 3 | x | LANDED | `audit-refusals.test.ts` › "reports a selector two sheets declare, naming both" |',
      'prose naming `fleet-css.test.ts` and then "a quoted phrase" is not a citation',
      'twice: `audit-refusals.test.ts` › "reports a selector two sheets declare, naming both"',
    ].join('\n');
    expect(citedTitles(doc)).toEqual([
      { file: 'audit-refusals.test.ts', title: 'reports a selector two sheets declare, naming both' },
    ]);
  });

  it('finds a declared title in every quote form, with or without modifiers', () => {
    expect(declaresTitle("  it('wins the width override', () => {", 'wins the width override')).toBe(true);
    expect(declaresTitle('describe("the fleet head", () => {', 'the fleet head')).toBe(true);
    expect(declaresTitle('  test(`a backticked title`, () => {', 'a backticked title')).toBe(true);
    expect(declaresTitle("it.skipIf(isRoot)('runs as a user', async () => {", 'runs as a user')).toBe(true);
  });

  it('reds on a renamed title, a title only a comment repeats, and a skipped test', () => {
    const src = [
      "it('wins the width override by REPLACING it', () => {",
      "  // wins the width override",
      "  expect(x, 'wins the width override').toBe(1);",
      "it.skip('a parked case', () => {});",
      "it.todo('a case nobody wrote');",
    ].join('\n');
    expect(declaresTitle(src, 'wins the width override')).toBe(false);
    expect(declaresTitle(src, 'a parked case')).toBe(false);
    expect(declaresTitle(src, 'a case nobody wrote')).toBe(false);
    expect(declaresTitle(src, 'wins the width override by REPLACING it')).toBe(true);
  });
});

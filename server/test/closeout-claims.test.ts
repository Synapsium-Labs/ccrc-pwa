// A CLOSE-OUT DOCUMENT IS PROSE, AND PROSE IS A REQUEST.
//
// `docs/superpowers/plans/2026-10-11-design-system-audit-closeout.md` maps every
// item of the design-system audit to the commit that delivered it and the suite
// that keeps it true. That is exactly the shape of claim this repo does not
// accept on a document's word: a comment is a request; a red suite is a
// mechanism. The reviewer of a close-out has no way to tell a real commit hash
// from a plausible one, and a wave that renamed a guard file leaves the table
// pointing at nothing while still reading as a complete audit trail.
//
// So the table is checked. Three claims, each the kind that rots quietly:
//
//   * every commit it names RESOLVES in this repository's history, and is an
//     ANCESTOR of the branch the document was written on — a hash from someone
//     else's branch, or a typo with a valid shape, is a citation to nowhere;
//   * every test file it names as a mechanism EXISTS — a renamed guard turns
//     the table into a list of reassurances;
//   * the audit page it points at exists, since the document's one external
//     dependency is that file, and the whole reason both live in the tree is
//     that the link they used to be was deleted twice.
//
// WHAT THIS DELIBERATELY DOES NOT CHECK is whether each item was a good idea,
// or whether the mechanism named is the RIGHT mechanism. Those are judgements
// and a test that claimed to measure them would be lying about its scope — the
// same line `design-declaration.test.ts` draws when it checks that a posture
// was declared and never which one.
//
// SCOPE: this file is about ONE document. If a second close-out is ever
// written, the honest move is to generalise the reader rather than to copy the
// file, and the `DOC` constant is the one line that would have to move.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const DOC = path.join(
  ROOT, 'docs', 'superpowers', 'plans', '2026-10-11-design-system-audit-closeout.md',
);

const text = (): string => readFileSync(DOC, 'utf8');

/** Every `` `<hash>` `` in the document that looks like a short commit id.
 *
 *  Eight to forty hex characters, which is git's own range, and the backticks
 *  are required — a hex-looking word in prose is not a citation. Deduplicated,
 *  because the same commit legitimately delivers two rows. */
function citedCommits(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/`([0-9a-f]{8,40})`/g)) out.add(m[1] ?? '');
  return [...out].sort();
}

/** Every `` `<name>.test.ts` `` / `.test.tsx` the document names as a
 *  mechanism, with the `.mjs` tools it cites beside them. */
function citedFiles(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/`([\w.-]+\.(?:test\.tsx?|mjs|ts))`/g)) out.add(m[1] ?? '');
  return [...out].sort();
}

/** Does this repository know `hash`, as a commit, in the current branch's
 *  history? `--is-ancestor` is the half that matters: `cat-file` alone accepts
 *  any object this clone has fetched, including one from a branch that was
 *  never merged. */
function isAncestorCommit(hash: string): boolean {
  try {
    const kind = execFileSync('git', ['cat-file', '-t', hash], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (kind !== 'commit') return false;
    execFileSync('git', ['merge-base', '--is-ancestor', hash, 'HEAD'], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('the design-system audit close-out is checkable, not self-asserted', () => {
  it('exists, and so does the audit page it is the map to', () => {
    // The pair is the deliverable: the page is the measurement, this document
    // is which commit delivered which row of it. Either one alone is half a
    // record.
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

  it('cites commits this repository actually has, in this branch', () => {
    const cited = citedCommits(text());
    expect(cited.length, 'the table cites no commit — the mapping is gone').toBeGreaterThan(8);
    const unknown = cited.filter((h) => !isAncestorCommit(h));
    expect(unknown, 'cited commit is unknown here or not in this history').toEqual([]);
  });

  it('cites mechanisms that exist', () => {
    const cited = citedFiles(text());
    expect(cited.length, 'the table names no suite — nothing keeps any row true').toBeGreaterThan(5);
    // The roots a mechanism can live in. `ui/src/lib` is here because the
    // first run of this test reported `cn.ts` missing — which it is not; it is
    // the design system's class merger, and the defect that wave found lives
    // inside it. The reader was wrong, not the document.
    const roots = [
      'server/test', 'pwa/test', 'pwa/design', 'ui/design',
      'pwa/src/session', 'pwa/src/lib', 'ui/src/lib',
    ];
    const missing = cited.filter(
      (f) => !roots.some((r) => existsSync(path.join(ROOT, r, f))),
    );
    expect(missing, 'the close-out names a file that does not exist — a renamed guard').toEqual([]);
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

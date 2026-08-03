// Structural guards for the "one definition, imported everywhere" findings.
//
// Both of these started life as a COMMENT asking the next reader not to copy
// something, and both were copied anyway — `UNCHECKED_PR`'s own docstring said
// "a second copy would drift" and by the time the integration review ran there
// were three. So the guard is a test that reads the sources, in the suite that
// already reaches outside its own package (`module-format.test.ts` walks
// `shared/`, the ccd tests execute `../../ccrc-portability/ccd`). A
// comment is a request; a red suite is a mechanism.
//
// These scan TEXT, deliberately, and that is a limitation worth stating: they
// catch the copy that looks like the original, which is the copy people
// actually write. A determined author can evade either one (build the object
// field-by-field, spell the union across a type alias in another file). The
// bar is "a reasonable person adding a fourth copy in the ordinary way is
// stopped before review", not "unforgeable".
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PR_REASONS, isPrReason } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');

/** Every source root any of the three definitions could be copied into. The
 *  pwa is in this list because that is where the ORIGINAL lived and where the
 *  drift began; the agent because it is the third consumer of `shared/`. */
const ROOTS = [
  path.join(ccrcRoot, 'shared'),
  path.join(ccrcRoot, 'server', 'src'),
  path.join(ccrcRoot, 'pwa', 'src'),
  path.join(ccrcRoot, 'agent', 'src'),
];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...sources(p)); continue; }
    if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const ALL = ROOTS.flatMap(sources);
const rel = (p: string): string => path.relative(ccrcRoot, p);

describe('the roots this scans', () => {
  it('actually found the four source trees, and the files the findings name', () => {
    // A scan over an empty list passes everything. This is the assertion that
    // the two tests below are looking at anything at all — a moved package or
    // a renamed directory must turn THIS red rather than silently disarm them.
    for (const r of ROOTS) expect(sources(r).length, rel(r)).toBeGreaterThan(0);
    for (const f of ['shared/api.ts', 'server/src/watch.ts', 'server/src/prstate.ts',
      'pwa/src/session/PrKeycap.tsx']) {
      expect(ALL.map(rel)).toContain(f);
    }
  });
});

describe('integration finding 6 — one UNCHECKED_PR', () => {
  // The literal's fingerprint: an object literal whose first field is the
  // phase. All three copies opened exactly this way, and so does the surviving
  // definition — which is why the assertion is "in one file", not "nowhere".
  const OPENING = /\bphase:\s*'unchecked'/;

  it('is defined in exactly one file, and that file is shared/api.ts', () => {
    const holders = ALL.filter((f) => OPENING.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('is what the three former copy sites now use', () => {
    // Not just "the copies are gone" — that is satisfied by deleting the
    // feature. Each site must still reach the shared object.
    for (const f of ['server/src/watch.ts', 'server/src/prstate.ts',
      'pwa/src/session/PrKeycap.tsx']) {
      const src = readFileSync(path.join(ccrcRoot, f), 'utf8');
      expect(src, f).toContain('UNCHECKED_PR');
      expect(src, f).toMatch(/import .*UNCHECKED_PR.*from '\.\.[^']*shared\/api(\.js)?'/);
    }
  });
});

describe('integration finding 7 — one reason vocabulary', () => {
  // The compile-time half of this finding cannot be asserted from a test at
  // all: `Record<PrReason, true>` and `Record<PrReason, string>` fail in `tsc`,
  // which is a gate, not a case. What a test CAN do is the two things tsc
  // cannot — check that the derived list really is derived and complete at
  // runtime, and check that nobody has restated the vocabulary somewhere the
  // compiler is not watching.

  it('derives the runtime list from the union rather than restating it', () => {
    // Nine, and every one of them recognised by the predicate that both
    // validators now use. If `PR_REASONS` were ever hand-written back into an
    // array this still passes — which is why the source scan below exists —
    // but a DERIVED list that has gone out of step with the union is
    // impossible to construct, and that is the point being recorded.
    expect(PR_REASONS).toHaveLength(9);
    expect(new Set(PR_REASONS).size).toBe(PR_REASONS.length);
    for (const r of PR_REASONS) expect(isPrReason(r), r).toBe(true);
    expect(isPrReason('not-a-reason')).toBe(false);
    // Cast the constant, never the input — the predicate takes `unknown`, so a
    // non-string is answered rather than smuggled through.
    expect(isPrReason(null)).toBe(false);
    expect(isPrReason(7)).toBe(false);
  });

  it('is enumerated only where the compiler enforces exhaustiveness', () => {
    // The rule, stated as the assertion: a file may list the whole vocabulary
    // ONLY if a `Record<PrReason, …>` over it makes a missing member a compile
    // error. Two files qualify — `shared/api.ts` (the union, and
    // `PR_REASON_MAP`) and `PrKeycap.tsx` (`REASON_TEXT`, the sentences a human
    // reads). `prstate.ts`'s `Set` and `shared/api.ts`'s second `readonly
    // string[]` were the two that did not, and both are gone.
    //
    // Membership is tested per token in ANY form, quoted or as an object key,
    // because `REASON_TEXT` writes five of the nine unquoted — a
    // quoted-literals-only scan would exclude it by accident rather than by
    // rule, and would then miss a real copy written the same way.
    const enumerates = (src: string): boolean =>
      PR_REASONS.every((r) => new RegExp(`(?:'${r}'|(?<![\\w'-])${r}\\s*:)`).test(src));
    const holders = ALL.filter((f) => enumerates(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(holders).toEqual(['pwa/src/session/PrKeycap.tsx', 'shared/api.ts']);
  });

  it('routes both validators through the shared predicate', () => {
    // Not just "the copies are gone": each former copy site must still be
    // validating, and validating against the derived list.
    for (const f of ['server/src/prstate.ts', 'shared/api.ts']) {
      expect(readFileSync(path.join(ccrcRoot, f), 'utf8'), f).toContain('isPrReason');
    }
    // And the map that carries the human sentences is typed over the union, so
    // a tenth reason cannot ship without one.
    expect(readFileSync(path.join(ccrcRoot, 'pwa/src/session/PrKeycap.tsx'), 'utf8'))
      .toContain('Record<PrReason, string>');
  });
});

describe('extraction finding — one path to the ccd script', () => {
  // Seven files each spelled this path, and the extraction has to repoint it.
  // One definition means one line changes and every other file in the moved
  // tree must be byte-identical to its origin — which is what makes the
  // extraction verifiable by checksum instead of by review.
  //
  // Scans server/test AND server/test-e2e, which the ROOTS above deliberately
  // do not cover. test-e2e is a real sibling TypeScript tree (helpers.ts,
  // session.e2e.test.ts) that talks about ccd and holds no copy today — but
  // an unscanned sibling directory is exactly the "clean and unchecked becomes
  // dirty and unchecked with nothing saying so" shape that
  // test/tsconfig.tests.json already closed for the typechecker by enumerating
  // its sibling directories rather than naming one; this scan does the same.
  const testDir = path.join(ccrcRoot, 'server', 'test');
  const testDirs = [testDir, path.join(ccrcRoot, 'server', 'test-e2e')];
  const testFiles = testDirs.flatMap(sources);

  // Matches any literal naming the script: the `../../../ccrc-portability/ccd`
  // form, the path.join(..., `ccrc-portability`, `ccd`) form that
  // wsaudit.test.ts used, the `../../ccd/ccd` form it becomes after the move,
  // and the parts form an author could just as easily reach for post-move —
  // two adjacent path.join arguments that both spell the four-letter script
  // name, the same split style wsaudit.test.ts (one of the original seven)
  // already used pre-move. That last shape needs its own case: relying on the
  // pre-move `ccrc-portability` alternative alone would miss it, since
  // that string stops existing the instant the extraction lands. All four
  // shapes must be caught, or the guard stops working the moment the
  // extraction lands.
  //
  // Anchored to these exact shapes rather than a bare 'ccrc-portability'
  // or a bare quoted 'ccd' — this file's server/test tree also legitimately
  // says "ccrc-portability" (extraction-manifest.test.ts's fixtures,
  // ccd-ccclip.test.ts's OTHER script) and legitimately quotes 'ccd' for
  // unrelated reasons (ccd-pr-state.test.ts's assertion label, remote-connect
  // and remote-runner stubbing a binary literally named ccd). A looser regex
  // over-matches this file's own comment too, describing the very literal it
  // hunts for. Backticks above, not quotes, keep this comment from being a
  // false positive of its own making — and this paragraph deliberately never
  // writes the two script-name arguments themselves, quoted and adjacent, for
  // the same reason.
  const NAMES_CCD = /['"]\.\.\/\.\.\/\.\.\/ccrc-portability\/ccd['"]|'ccrc-portability',\s*'ccd'|['"]\.\.\/\.\.\/ccd\/ccd['"]|['"]ccd['"]\s*,\s*['"]ccd['"]/;

  it('found the test tree it is scanning', () => {
    // A scan over an empty list passes everything. Each directory is checked
    // separately so a moved or renamed sibling turns this red on its own,
    // rather than the other directory's file count silently covering for it.
    for (const d of testDirs) expect(sources(d).length, rel(d)).toBeGreaterThan(0);
    expect(testFiles.length).toBeGreaterThan(40);
    expect(testFiles.map(rel)).toContain('server/test/ccdWsHelpers.ts');
    expect(testFiles.map(rel)).toContain('server/test-e2e/helpers.ts');
  });

  it('is spelled in exactly one file, and that file is ccdWsHelpers.ts', () => {
    const holders = testFiles
      .filter((f) => NAMES_CCD.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(holders).toEqual(['server/test/ccdWsHelpers.ts']);
  });

  it('is what the six former copy sites now import', () => {
    // Not merely "the copies are gone" — deleting the tests would satisfy that.
    // Each site must still reach the shared constant.
    for (const f of ['ccd-clip.test.ts', 'projected-home.test.ts',
      'ccd-limits.test.ts', 'ccd-ws-reap.test.ts', 'ccd-ws-audit.test.ts',
      'wsaudit.test.ts']) {
      const src = readFileSync(path.join(testDir, f), 'utf8');
      expect(src, f).toMatch(/import\s*\{[^}]*\bCCD\b[^}]*\}\s*from\s*'\.\/ccdWsHelpers\.js'/);
    }
  });
});

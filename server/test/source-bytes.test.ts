// A raw control byte in a source file is invisible, survives every test, and
// changes nothing at runtime — which is exactly what makes it worth a suite of
// its own.
//
// ── THE INCIDENT THIS EXISTS FOR (Stage 2c, Task 4, twice in one task) ────
// `shared/roster.ts`'s `LABEL_UNSAFE_RE` is written `/[\u0000-\u001f\u007f]/`.
// Moving that line into `shared/roster-json.mjs` produced a literal holding the
// ACTUAL NUL, 0x1f and 0x7f bytes instead of the eight-character escape text.
// The regex behaves IDENTICALLY either way — same range, same matches — so
// every existing test stayed green, `tsc` was happy, and a reviewer reading the
// diff in a terminal sees nothing. The implementer caught it only by diffing
// bytes on its own initiative, and then reproduced the same corruption a second
// time while writing its report about the first one. Two occurrences in one
// task is a hazard, not a slip: any tool that rewrites a line containing that
// escape can emit the bytes it describes.
//
// ── WHAT IS ALLOWED, AND WHY EACH ONE ────────────────────────────────────
// Tab, newline and carriage return are ordinary text. ESC (0x1b) is allowed
// because `server/test/statusline-script.test.ts` legitimately embeds real ANSI
// sequences — it is testing how a terminal renders the statusline, and the
// escape byte IS the subject. Measured before this rule was written: ESC is the
// ONLY control byte anywhere in the tracked sources today, so allowing it costs
// nothing and banning it would have meant an exception list on day one.
//
// Everything else — NUL above all, and the 0x1f/0x7f pair from the incident —
// is refused. If a future file genuinely needs one, write it as an escape
// sequence in the source; that is what the escape sequences are for, and it is
// precisely the form this test protects.
//
// ── WHY IT WALKS `git ls-files` AND NOT A DIRECTORY TREE ─────────────────
// `server/test/single-definition.test.ts` filters its walk to `/\.tsx?$/`, so
// it has never seen a `.mjs`, a `.d.mts` or a bash script (deviation D-76) —
// and the incident above was in a `.mjs`. A scan that inherited that filter
// would have been blind to the very defect it is named after. This one asks git
// for every TRACKED file under the source roots, which also means a generated
// or ignored artifact can never fail the build.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

/** No root list — EVERY tracked file is walked. The first version named eight
 *  source roots, and the Task 4 review had already found the flaw's shape when
 *  it caught `scripts/` missing: "a new top-level directory of hand-written
 *  source is invisible to it until someone adds the name". Then the flaw bit
 *  for real: the plan's own D-78 ledger entry shipped CARRYING the raw
 *  NUL/0x1f/0x7f bytes between its backticks — the fourth occurrence of the
 *  incident this file is named after, sitting in `docs/`, which no root
 *  covered, while this guard was green. A curated list of "directories that
 *  hold hand-written text" is itself the hazard: every tracked file is
 *  hand-written text until the BINARY list below says otherwise, so the walk
 *  now takes `git ls-files` whole. (`scratch/` is git-ignored, so the old
 *  list's "deliberate exclusion" of it was an illusion — git never offered
 *  it.) */

/** Files whose bytes are not text and must not be read as such. Kept as an
 *  extension list rather than a content sniff so that adding a binary asset is
 *  a deliberate edit here, not a silent exemption. */
const BINARY = /\.(png|jpg|jpeg|gif|ico|webp|woff2?|ttf|otf|pdf|zip|gz|db|sqlite)$/i;

/** Tab, newline, CR and ESC are permitted; every other C0 byte and DEL is not.
 *  Written as an explicit character class rather than a negated range so that
 *  the four exceptions are readable as four exceptions. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/;

function trackedSourceFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\0').filter((p) => p !== '' && !BINARY.test(p));
}

describe('no source file carries a raw control byte', () => {
  it('finds files to check at all', () => {
    // A scan over an empty list passes everything. `_check_wrappers` in
    // ccd/ccrc-doctor-checks refuses to report agreement nobody measured, for
    // the same reason; so does this.
    expect(trackedSourceFiles().length).toBeGreaterThan(100);
  });

  it('every tracked source file is free of NUL, DEL and the other C0 bytes', () => {
    const offenders: string[] = [];
    for (const rel of trackedSourceFiles()) {
      let text: string;
      try {
        text = readFileSync(path.join(REPO, rel), 'latin1');
      } catch {
        continue; // a symlink to nowhere is not this test's business
      }
      const m = FORBIDDEN.exec(text);
      if (m === null) continue;
      // Report the CODE POINT and the line, never the byte itself — printing it
      // into a terminal is how an invisible defect stays invisible in its own
      // failure message.
      const at = m.index;
      const line = text.slice(0, at).split('\n').length;
      const code = `0x${text.charCodeAt(at).toString(16).padStart(2, '0')}`;
      offenders.push(`${rel}:${line} carries ${code}`);
    }
    expect(offenders).toEqual([]);
  });
});

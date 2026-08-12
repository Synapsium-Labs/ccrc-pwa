import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { markGenerated, verifyMarker } from '../../shared/mark.mjs';
// The path to the ccd script is spelled in exactly ONE file in this tree, and
// `single-definition.test.ts` enforces it by scanning for the shapes a copy
// takes — including a `path.join` whose last two arguments both name the
// script. Joining that path here scored a hit as a second copy; so, on the
// next run, did this comment while trying to explain it, which is why it now
// describes the shape instead of writing it.
import { CCD } from './ccdWsHelpers.js';

const MARKER_RE = /^# ccrc:generated 1 sha256=([0-9a-f]{64})$/;

/** Pulls the embedded hash out of marked text, wherever the marker line
 *  landed — used by tests below that need to inspect or tamper with the
 *  hash itself rather than only the overall `verifyMarker` verdict. */
function extractHash(text: string): string {
  const line = text.split('\n').find((l) => MARKER_RE.test(l));
  const match = line !== undefined ? MARKER_RE.exec(line) : null;
  if (!match) throw new Error('extractHash: no marker line found in text');
  return match[1]!;
}

/** Flips the first hex character of a 64-char sha256 hex digest to a
 *  different, still well-formed hex digit — deterministic (unlike e.g.
 *  reversing the string, which could coincidentally reproduce the same
 *  value for a pathological input) so the result is guaranteed both valid
 *  hex and different from the input. */
function flipFirstHexChar(hash: string): string {
  const first = hash[0]!;
  return (first === '0' ? '1' : '0') + hash.slice(1);
}

describe('provenance marker', () => {
  const body = '#!/usr/bin/env bash\necho hi\n';

  it('keeps the shebang first — the file must stay executable', () => {
    const text = markGenerated(body);
    expect(text.split('\n')[0]).toBe('#!/usr/bin/env bash');
    expect(text.split('\n')[1]).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/);
  });

  it('round-trips its own output as unmodified', () => {
    expect(verifyMarker(markGenerated(body))).toBe('ccrc-unmodified');
  });

  it('detects a hand edit', () => {
    expect(verifyMarker(markGenerated(body) + 'echo tampered\n')).toBe('ccrc-edited');
  });

  it('calls an unmarked file foreign', () => {
    expect(verifyMarker(body)).toBe('foreign');
  });

  it('marks a body with no shebang on line 1', () => {
    expect(markGenerated('CCRC_ACCOUNTS=(a)\n').split('\n')[0])
      .toMatch(/^# ccrc:generated 1 sha256=/);
  });

  // --- Fix round 1: make the suite discriminate real SHA-256 from a
  // keyword-matching stub. The reviewer's stub (no hashing at all, just
  // checks the body for the substring "tampered") passed all five tests
  // above. Everything below is chosen so that stub — or any stub that
  // doesn't genuinely hash the body — fails.

  it('the marker hash is content-derived: same body twice -> same hash, different bodies -> different hash', () => {
    const bodyA = '#!/usr/bin/env bash\necho a\n';
    const bodyB = '#!/usr/bin/env bash\necho b\n';
    const hashA1 = extractHash(markGenerated(bodyA));
    const hashA2 = extractHash(markGenerated(bodyA));
    const hashB = extractHash(markGenerated(bodyB));
    expect(hashA1).toBe(hashA2);
    expect(hashA1).not.toBe(hashB);
  });

  it('rejects a well-formed marker whose hash does not match the body', () => {
    const text = markGenerated(body);
    const realHash = extractHash(text);
    const wrongHash = flipFirstHexChar(realHash);
    expect(wrongHash).not.toBe(realHash); // sanity: still guarding against a no-op flip
    expect(wrongHash).toMatch(/^[0-9a-f]{64}$/); // still well-formed, not malformed-shape

    const tampered = text.replace(
      `# ccrc:generated 1 sha256=${realHash}`,
      `# ccrc:generated 1 sha256=${wrongHash}`,
    );
    expect(verifyMarker(tampered)).toBe('ccrc-edited');
  });

  it('detects a single byte changed mid-body, not only an appended line', () => {
    const text = markGenerated(body);
    // Flip one character inside the existing 'echo hi' line — no new line,
    // no distinctive added word, nothing a keyword-matching stub could key
    // off. Only a real recompute-and-compare catches this.
    const mutated = text.replace('echo hi', 'echo hI');
    expect(mutated).not.toBe(text);
    expect(verifyMarker(mutated)).toBe('ccrc-edited');
  });

  // Optional edge cases flagged as reasoned-about-but-unpinned in the Task
  // 4 report; the reviewer independently confirmed the behaviour, so it
  // goes on the record here rather than staying only in prose.

  it('is idempotent: re-marking an already-marked body reproduces the same text', () => {
    const once = markGenerated(body);
    const twice = markGenerated(once);
    expect(twice).toBe(once);
  });

  it('marks and verifies an empty body', () => {
    expect(verifyMarker(markGenerated(''))).toBe('ccrc-unmodified');
  });

  it('marks and verifies a shebang-only body with nothing after it', () => {
    const shebangOnly = '#!/usr/bin/env bash\n';
    const marked = markGenerated(shebangOnly);
    expect(marked.split('\n')[0]).toBe('#!/usr/bin/env bash');
    expect(verifyMarker(marked)).toBe('ccrc-unmodified');
  });
});

// Task 10 stamped the COMMITTED `ccd/ccd` with the marker, which is what
// lets stage 2b's installer tell ccrc's own shipped ccd apart from one an
// operator has hand-edited on a box. That claim has a maintenance cost and
// no natural enforcement: `ccd` is edited constantly, every edit invalidates
// the hash, and a stale marker does not fail quietly — it makes ccrc's own,
// untouched, freshly-deployed ccd report `ccrc-edited` on every box forever,
// which is precisely the verdict that will tell 2b's installer NOT to
// replace it. So the re-stamp is a gate, not a convention.
//
//   Re-stamp after editing ccd:
//     node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
//       const { markGenerated } = await import('./shared/mark.mjs'); \
//       writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
//
// `markGenerated` is idempotent (it strips any existing marker before
// hashing), so that command is safe to run whether or not the file is
// already stamped.
describe('the committed ccd carries a marker that matches its own bytes', () => {
  const ccd = readFileSync(CCD, 'utf8');

  it('keeps the shebang on line 1 and the marker on line 2 — ccd is executed directly', () => {
    const lines = ccd.split('\n');
    expect(lines[0]).toBe('#!/usr/bin/env bash');
    expect(lines[1]).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/);
  });

  it('verifies as ccrc-unmodified — re-stamp ccd/ccd after editing it (see the note above)', () => {
    expect(verifyMarker(ccd),
      'ccd/ccd was edited without re-stamping its provenance marker; run the re-stamp '
      + 'command in the comment above this describe').toBe('ccrc-unmodified');
  });
});

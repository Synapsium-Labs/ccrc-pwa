import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { markGenerated, verifyMarker } from '../../shared/mark.mjs';
// The path to the ccd script is spelled in exactly ONE file in this tree, and
// `single-definition.test.ts` enforces it by scanning for the shapes a copy
// takes — including a `path.join` whose last two arguments both name the
// script. Joining that path here scored a hit as a second copy; so, on the
// next run, did this comment while trying to explain it, which is why it now
// describes the shape instead of writing it.
import { CCD, canonicalPython3 } from './ccdWsHelpers.js';

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

// Task 10 stamped the COMMITTED `ccd/ccd` with the marker, which is what lets the installer tell ccrc's own
// shipped ccd apart from one an operator has hand-edited on a box. That claim had a maintenance cost: `ccd` is
// edited constantly, every edit invalidated the hash, and the line conflicted in 85 of the 98 conflicted
// absorptions measured in 30 days. The stamp is therefore written AT INSTALL TIME: the committed file carries
// one fixed placeholder on line 2 (`# ccrc:stamp-at-install ...`), and `ccd/ccd-entry-install.py` writes the
// marker into the installed copy. The claim these cases hold is unchanged and now measured where it is made,
// on the installer's OUTPUT, never on the committed file: the installed ccd keeps the shebang on line 1 and the
// marker on line 2, carries exactly ONE line claiming provenance, and verifies as ccrc-unmodified.
// `ccd-install-stamp.test.ts` owns the rest of the install-time contract (placeholder, legacy stamp, restamp).
describe('the INSTALLED ccd carries a marker that matches its own bytes', () => {
  const REPO = path.resolve(path.dirname(CCD), '..');
  const home = mkTmp('ccrc-ownership-install-');
  const tree = path.join(home, 'ccrc');
  mkdirSync(path.join(tree, 'ccd'), { recursive: true });
  writeFileSync(path.join(tree, 'ccd', path.basename(CCD)), readFileSync(CCD, 'utf8'), { mode: 0o755 });
  for (const f of ['ccd-entry.py', 'ccd-entry-install.py']) copyFileSync(path.join(REPO, 'ccd', f), path.join(tree, 'ccd', f));
  // The library the body pins (D-6913): the installer renders its digest into the body, then stamps it.
  mkdirSync(path.join(tree, 'ccd', 'lib'), { recursive: true });
  copyFileSync(path.join(REPO, 'ccd', 'lib', 'disk-retention.sh'), path.join(tree, 'ccd', 'lib', 'disk-retention.sh'));
  const r = spawnSync(canonicalPython3(), ['-IS', path.join(tree, 'ccd', 'ccd-entry-install.py'), 'install', tree, home],
    { encoding: 'utf8', cwd: home, env: { HOME: home, PATH: process.env['PATH'] ?? '/usr/bin:/bin' } });
  const ccd = r.status === 0 ? readFileSync(path.join(home, '.local', 'libexec', 'ccrc', path.basename(CCD)), 'utf8') : '';
  afterAll(() => { rmSync(home, { recursive: true, force: true }); });

  it('installs (the fixture the cases below read)', () => {
    expect(r.status, String(r.stderr)).toBe(0);
  });

  // WHY THE SHEBANG STAYS (D-3696): `ccd/ccd` is no longer what a box executes
  // directly - `~/.local/bin/ccd` is the rendered Python launcher
  // (`ccd/ccd-entry.py`), which starts this file as `bash [-p] -- <body>` from
  // `~/.local/libexec/ccrc/ccd`. It keeps line 1 because it is still a Bash
  // file in its own right: SOURCEABLE (every `source ccd/ccd` harness), the
  // active Bash body, and the copy the shipped tree carries at `~/ccrc/ccd/ccd`.
  it('keeps the shebang on line 1 and the marker on line 2 - ccd stays a sourceable Bash file and the active body', () => {
    const lines = ccd.split('\n');
    expect(lines[0]).toBe('#!/usr/bin/env bash');
    expect(lines[1]).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/);
  });

  // A MARKER CHECK THAT PASSES IS NOT A CHECK THAT THE FILE HAS ONE MARKER
  // (D-2216). The case above reads line 2; the one below re-hashes the body.
  // Neither can see a SECOND marker line further down, because that line IS
  // part of the body both of them hash: two commits once shipped `ccd/ccd` with
  // a stray `# ccrc:generated 1 sha256=PLACEHOLDER` as line 3, and
  // `verifyMarker` answered `ccrc-unmodified` at both - `stripMarkerLine`
  // removes only the line at `markerLineIndex`, so the placeholder was hashed IN
  // and the digest covering it was correct.
  //
  // COUNT ON THE PREFIX, NOT ON `MARKER_RE`. The line that actually shipped
  // carries `PLACEHOLDER` where the digest goes, so it does not match the
  // 64-hex marker regex at all: what is wrong is a second line CLAIMING
  // provenance, whatever it claims. Now measured on the installer's output: the
  // installer writes exactly one, so a second can only be a line of the source.
  it('carries exactly ONE line claiming provenance - a second one is hashed in and verifies clean', () => {
    const claiming = ccd.split('\n').filter((l) => l.startsWith('# ccrc:generated'));
    expect(claiming,
      'the installed ccd carries more than one line beginning "# ccrc:generated". ccd/ccd must hold the '
      + 'placeholder on line 2 and no other such line; a COMMENT quoting the marker format at column 0 '
      + 'is a claim too - indent the example by one space and it stops being one.')
      .toHaveLength(1);
  });

  it('verifies as ccrc-unmodified', () => {
    expect(verifyMarker(ccd), 'the installer wrote a marker that does not match the body it installed').toBe('ccrc-unmodified');
  });
});

// D-8945 (plan docs/superpowers/plans/2026-11-22-testbox-light-parity.md): `server/load-flakes.txt` is the one machine-read
// copy of CLAUDE.md's known-load-flake list. The test box's parity check reads it from the worktree it tests, so a known load
// flake that differs is re-run alone once on both sides (`ccd/testbox-parity`). CLAUDE.md's bullet points to the file; this
// pin keeps the two lists equal and every entry a real test file, so a rename or a change to either list alone is red.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The backticked names of CLAUDE.md's `Known load flakes` bullet, up to the sentence's first full stop. */
function claudeMdFlakes(): string[] {
  const md = readFileSync(join(REPO, 'CLAUDE.md'), 'utf8');
  const at = md.indexOf('- **Known load flakes**');
  expect(at, "CLAUDE.md's load-flake bullet is missing").toBeGreaterThan(-1);
  const sentence = md.slice(at, md.indexOf('. ', at));
  return [...sentence.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]!);
}

/** The file's entries: one package-relative path per line, blank lines and `#` comments skipped (the parity tool's reading). */
function fileFlakes(): string[] {
  return readFileSync(join(REPO, 'server', 'load-flakes.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
}

describe("server/load-flakes.txt is CLAUDE.md's known-load-flake list (D-8945)", () => {
  it('the six names in CLAUDE.md are the file\'s entries, in order, as test/<name>.test.ts', () => {
    const names = claudeMdFlakes();
    expect(names).toHaveLength(6);
    expect(fileFlakes()).toEqual(names.map((n) => `test/${n}.test.ts`));
  });

  it('every entry is a test file of the server package', () => {
    for (const f of fileFlakes()) {
      expect(f, f).toMatch(/^test\/[a-z0-9-]+\.test\.ts$/);
      expect(existsSync(join(REPO, 'server', f)), f).toBe(true);
    }
  });

  it("CLAUDE.md's bullet points to the file", () => {
    const md = readFileSync(join(REPO, 'CLAUDE.md'), 'utf8');
    const at = md.indexOf('- **Known load flakes**');
    expect(md.slice(at, md.indexOf('\n- **', at + 1))).toContain('`server/load-flakes.txt`');
  });
});

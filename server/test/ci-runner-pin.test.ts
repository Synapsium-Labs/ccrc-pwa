/**
 * No workflow under `.github/` names the floating `ubuntu-latest` image.
 *
 * Why: GitHub moved `ubuntu-latest` from the Ubuntu 24.04 image to the 26.04
 * image in one morning (2026-11-05), and every pull request's `test (server)`
 * went red at once, in files no branch had touched (curl's exit code, the
 * UTF-8 locale, the fixture spawn's disk floor). A floating image moves under
 * every PR at the same moment, so the Linux runners name `ubuntu-24.04`. The
 * move to a newer image is its own change, made on purpose and proven first.
 *
 * Measured, not trusted to a comment: every line of every `.yml`/`.yaml` file
 * under `.github/` (workflows, composite actions) is read, and any mention of
 * the floating label, comment or key, flow list or matrix value, reds.
 * `macos-latest` is outside this guard.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GITHUB = join(REPO, '.github');

const FLOATING = /\bubuntu-latest\b/;

function yamlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...yamlFiles(p));
    else if (/\.ya?ml$/.test(e.name)) out.push(p);
  }
  return out.sort();
}

/** `file:line: text` for every line that names the floating image. */
function floatingRunners(files: Array<{ path: string; text: string }>): string[] {
  const hits: string[] = [];
  for (const f of files) {
    f.text.split('\n').forEach((line, i) => {
      if (FLOATING.test(line)) hits.push(`${f.path}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe('the Linux runners are pinned (a floating image moved under every PR at once)', () => {
  const files = yamlFiles(GITHUB).map((p) => ({ path: relative(REPO, p), text: readFileSync(p, 'utf8') }));

  it('reads the workflows (the scan is not vacuous)', () => {
    const names = files.map((f) => f.path);
    expect(names).toContain('.github/workflows/ci.yml');
    expect(names).toContain('.github/actions/server-deps/action.yml');
    const pinned = files.flatMap((f) => f.text.split('\n')).filter((l) => /^\s*runs-on:\s*ubuntu-24\.04\s*$/.test(l));
    expect(pinned.length).toBeGreaterThan(20);
  });

  it('no `ubuntu-latest` remains under .github/', () => {
    expect(floatingRunners(files)).toEqual([]);
  });

  it('mutants: the scan reds on a key, a flow list, a matrix value and a comment', () => {
    const mutants = [
      '    runs-on: ubuntu-latest\n',
      '    runs-on: [ubuntu-latest]\n',
      '        os: [ubuntu-latest, macos-latest]\n',
      '    # runs on ubuntu-latest today\n',
    ];
    for (const m of mutants) {
      expect(floatingRunners([{ path: 'x.yml', text: m }]), m).toHaveLength(1);
    }
    expect(floatingRunners([{ path: 'x.yml', text: '    runs-on: macos-latest\n    runs-on: ubuntu-24.04\n' }])).toEqual([]);
  });
});

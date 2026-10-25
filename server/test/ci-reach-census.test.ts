/**
 * Pins the light-PR reach list (`.github/ci/reach.mjs`) to what the tests
 * actually read. A package's FOREIGN list says what its tests never read; this
 * census scans every path literal in the pwa, ui and agent test/source trees
 * that leaves its own tree and goes red when one resolves under a FOREIGN
 * prefix without a READS entry, so the list cannot drift from the tests.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skipsTests } from '../../.github/ci/reach.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Each scanned tree, and the reach package whose tests it holds. */
const TREES: Array<{ dir: string; pkgs: string[] }> = [
  { dir: 'pwa/src', pkgs: ['pwa', 'browser'] },
  { dir: 'pwa/test', pkgs: ['pwa', 'browser'] },
  { dir: 'pwa/browser', pkgs: ['pwa', 'browser'] },
  { dir: 'ui/src', pkgs: ['pwa', 'browser'] },
  { dir: 'agent/src', pkgs: ['agent'] },
  { dir: 'agent/test', pkgs: ['agent'] },
];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every repo-relative path a file's `path.join/resolve` call or relative string literal points at. */
function targetsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const here = path.dirname(file);
  const found = new Set<string>();
  for (const m of text.matchAll(/path\.(?:join|resolve)\(([^;]*?)\)/gs)) {
    const segs = [...m[1].matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((x) => x[1] ?? x[2]);
    if (!segs.some((s) => s === '..' || s.startsWith('../'))) continue;
    found.add(path.relative(ROOT, path.resolve(here, ...segs)));
  }
  for (const m of text.matchAll(/['"`](\.\.\/[^'"`\n$]*)['"`]/g)) {
    found.add(path.relative(ROOT, path.resolve(here, m[1])));
  }
  return [...found];
}

describe('the reach list follows what the tests read across trees', () => {
  for (const { dir, pkgs } of TREES) {
    it(`${dir}: no path literal resolves under a foreign prefix of ${pkgs.join('/')}`, () => {
      const offenders: string[] = [];
      for (const file of walk(path.join(ROOT, dir))) {
        for (const target of targetsOf(file)) {
          if (target.startsWith('..')) continue;
          const probe = existsSync(path.join(ROOT, target)) && statSync(path.join(ROOT, target)).isDirectory() ? `${target}/x` : target;
          for (const pkg of pkgs) {
            if (skipsTests(pkg, [probe])) offenders.push(`${path.relative(ROOT, file)} reads ${target}, foreign to ${pkg}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  // The agent suite is all-or-nothing and skips when every change is under pwa/ or ui/, so an agent test that reads
  // either tree from disk by a ROOT-relative path (no `..` segment, so the scan above cannot see it) must go red here.
  // The server suite needs no such census: it is selected from a strace of each test (openat, stat, getdents64), so
  // a server test that reads pwa/src from disk carries those paths in its map record.
  it('agent: no fs path names pwa/ or ui/ from the repository root', () => {
    const offenders: string[] = [];
    for (const dir of ['agent/src', 'agent/test']) {
      for (const file of walk(path.join(ROOT, dir))) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/path\.(?:join|resolve)\(([^;]*?)\)/gs)) {
          const segs = [...m[1].matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((x) => x[1] ?? x[2]);
          if (segs.some((g) => g === 'pwa' || g === 'ui' || /^(?:pwa|ui)\//.test(g))) offenders.push(`${path.relative(ROOT, file)}: ${m[0].slice(0, 80)}`);
        }
        for (const m of text.matchAll(/['"`](?:pwa|ui)\/(?:src|test|browser|public)\b[^'"`\n]*['"`]/g)) offenders.push(`${path.relative(ROOT, file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('sees the two reads that motivated the list (a pane fixture and laneSchedule.ts)', () => {
    const all = TREES.filter((t) => t.dir.startsWith('pwa/')).flatMap((t) => walk(path.join(ROOT, t.dir))).flatMap(targetsOf);
    expect(all.some((t) => t.startsWith('server/test/fixtures/panes'))).toBe(true);
    expect(all).toContain('server/src/laneSchedule.ts');
  });
});

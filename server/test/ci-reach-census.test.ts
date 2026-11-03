/**
 * Pins the light-PR reach list (`.github/ci/reach.mjs`) to what the tests
 * actually read. A package's FOREIGN list says what its tests never read; this
 * census scans every path literal in the pwa, ui and agent test/source trees
 * that leaves its own tree and goes red when one resolves under a FOREIGN
 * prefix without a READS entry, so the list cannot drift from the tests.
 *
 * The browser leg is scanned over what it can actually load: pwa/src, ui/src,
 * pwa/browser, and the pwa/test modules the browser files import (followed
 * transitively), never the whole pwa/test tree. The pwa unit suite renders
 * docs/ (markdown-guard, markdown-parse, docs-markdown), and the browser tests
 * read nothing under it, which is what lets docs/ be foreign to `browser` and
 * never to `pwa` (the queue's browser skip, the owner's ruling of 2026-11-02).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skipsTests } from '../../.github/ci/reach.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Each scanned tree, and the reach package whose tests it holds. pwa/test is the pwa suite's; the browser leg's
 *  share of it is `browserImports()`, scanned below. */
const TREES: Array<{ dir: string; pkgs: string[] }> = [
  { dir: 'pwa/src', pkgs: ['pwa', 'browser'] },
  { dir: 'pwa/test', pkgs: ['pwa'] },
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

/** A relative module specifier in an import, a re-export, a dynamic import or a require. */
const RELATIVE_IMPORT = /(?:\bfrom|\bimport|\bimport\s*\(|\brequire\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g;
const RESOLVE_EXT = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '/index.ts', '/index.tsx'];

/** The pwa/test files the browser leg loads: every one a pwa/browser file imports, followed through pwa/test's own
 *  imports. Absolute paths, sorted. An import that leaves pwa/test (pwa/src, ui/src, shared/) is not followed:
 *  pwa/src and ui/src are scanned whole, and shared/ is foreign to nobody. */
function browserImports(): string[] {
  const testDir = path.join(ROOT, 'pwa', 'test') + path.sep;
  const seen = new Set<string>();
  const queue = walk(path.join(ROOT, 'pwa', 'browser'));
  while (queue.length > 0) {
    const file = queue.pop()!;
    for (const m of readFileSync(file, 'utf8').matchAll(RELATIVE_IMPORT)) {
      const base = path.resolve(path.dirname(file), m[1]!.replace(/\.js$/, ''));
      const hit = RESOLVE_EXT.map((e) => base + e).find((c) => existsSync(c) && statSync(c).isFile());
      if (hit === undefined || !hit.startsWith(testDir) || seen.has(hit)) continue;
      seen.add(hit);
      queue.push(hit);
    }
  }
  return [...seen].sort();
}

/** Every finding of `files` whose target `pkg` would skip on: a read the reach list does not know about. */
function offendersOf(files: string[], pkgs: string[]): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    for (const target of targetsOf(file)) {
      if (target.startsWith('..')) continue;
      const probe = existsSync(path.join(ROOT, target)) && statSync(path.join(ROOT, target)).isDirectory() ? `${target}/x` : target;
      for (const pkg of pkgs) {
        if (skipsTests(pkg, [probe])) offenders.push(`${path.relative(ROOT, file)} reads ${target}, foreign to ${pkg}`);
      }
    }
  }
  return offenders;
}

describe('the reach list follows what the tests read across trees', () => {
  for (const { dir, pkgs } of TREES) {
    it(`${dir}: no path literal resolves under a foreign prefix of ${pkgs.join('/')}`, () => {
      expect(offendersOf(walk(path.join(ROOT, dir)), pkgs)).toEqual([]);
    });
  }

  it('pwa/test, as far as the browser files import it: no path literal resolves under a foreign prefix of browser', () => {
    const files = browserImports();
    // Guard the guard: the browser files import the fleet fixture, so an empty closure means the walk went blind.
    expect(files.map((f) => path.relative(ROOT, f)), 'the browser files import no pwa/test module — the walk went blind')
      .toContain('pwa/test/fleetFixture.ts');
    expect(offendersOf(files, ['browser'])).toEqual([]);
  });

  it('the build the browser leg serves names no docs/ path: vite.config.ts and the browser config', () => {
    for (const f of ['pwa/vite.config.ts', 'pwa/vitest.browser.config.ts']) {
      const docs = targetsOf(path.join(ROOT, f)).filter((t) => t === 'docs' || t.startsWith('docs/'));
      expect(docs, `${f} reads docs/, so a docs-only change could change what the browser tests load`).toEqual([]);
    }
  });

  it('sees the docs/ reads that keep docs/ off the pwa suite\'s FOREIGN list, and none of them is a browser import', () => {
    const reads = walk(path.join(ROOT, 'pwa', 'test'))
      .filter((f) => targetsOf(f).some((t) => t === 'docs' || t.startsWith('docs/')))
      .map((f) => path.relative(ROOT, f));
    expect(reads, 'no pwa test reads docs/ any more — re-derive whether docs/ may be foreign to pwa').toContain('pwa/test/markdown-guard.test.ts');
    for (const f of reads) expect(skipsTests('pwa', [`${f}`]), f).toBe(false);
    expect(skipsTests('pwa', ['docs/superpowers/specs/x.md']), 'docs/ became foreign to the pwa suite, which renders it').toBe(false);
    const imported = browserImports().map((f) => path.relative(ROOT, f));
    expect(reads.filter((f) => imported.includes(f)), 'a browser file imports a pwa/test module that reads docs/').toEqual([]);
  });

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

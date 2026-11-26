// The PDF frame's one dependency (X2 spec 2026-11-18 section 4.4, "The dependency decision"; plan Task P3.1): `pdfjs-dist`
// at one exact version, its notices shipped byte for byte, nothing in its viewer or parser that needs an eval source, and
// the frame's assets taken from the installed package by a fixed list of imports. Version, integrity, provenance and the
// registry's signature audit are recorded in the plan's Results; a security release is adopted as its own scoped change
// with the same checks, which is when the constants below move.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PWA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(PWA, 'node_modules', 'pdfjs-dist');
const read = (...p: string[]): string => readFileSync(path.join(...p), 'utf8');

/** The pinned release and the registry's integrity for its tarball (recorded in X2's plan, Results, wave P3). */
const PDFJS_VERSION = '6.5.438';
const PDFJS_INTEGRITY = 'sha512-vg8Pw1x+AFKy4AMDvhuWl5cOYV8d698UoEANoFFhc79hqXDnZQqnOXoxw3HG907WHOg1JYOvLhP756boddFxpA==';

describe('pdf dependency', () => {
  it('pdf dependency: exact pin, no caret', () => {
    const pkg = JSON.parse(read(PWA, 'package.json')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.dependencies['pdfjs-dist']).toBe(PDFJS_VERSION);
    expect(pkg.dependencies['pdfjs-dist']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies['pdfjs-dist']).toBeUndefined();
    const lock = JSON.parse(read(PWA, 'package-lock.json')) as {
      packages: Record<string, { version?: string; integrity?: string; dependencies?: Record<string, string> }>;
    };
    expect(lock.packages['']!.dependencies!['pdfjs-dist']).toBe(PDFJS_VERSION);
    expect(lock.packages['node_modules/pdfjs-dist']).toMatchObject({ version: PDFJS_VERSION, integrity: PDFJS_INTEGRITY });
    expect((JSON.parse(read(PKG, 'package.json')) as { version: string }).version).toBe(PDFJS_VERSION);
  });

  it('pdf dependency: notice present', () => {
    // Shipped verbatim beside the app (public/licenses, as the Geist font's licence is): pdf.js's Apache-2.0 licence, and
    // the licences of the CMaps and the standard fonts the frame carries. A licence is only the licence while it is the
    // package's own bytes.
    const NOTICES: ReadonlyArray<readonly [string, string]> = [
      ['pdfjs-dist-LICENSE.txt', 'LICENSE'],
      ['pdfjs-dist-cmaps-LICENSE.txt', 'cmaps/LICENSE'],
      ['pdfjs-dist-LICENSE_FOXIT.txt', 'standard_fonts/LICENSE_FOXIT'],
      ['pdfjs-dist-LICENSE_LIBERATION.txt', 'standard_fonts/LICENSE_LIBERATION'],
    ];
    for (const [shipped, upstream] of NOTICES) {
      const ours = readFileSync(path.join(PWA, 'public', 'licenses', shipped));
      expect(ours.equals(readFileSync(path.join(PKG, upstream))), shipped).toBe(true);
    }
    expect(read(PWA, 'public', 'licenses', 'pdfjs-dist-LICENSE.txt')).toContain('Apache License');
  });

  it('pdf dependency: the viewer and the parser name no eval source', () => {
    // The frame's policy has no 'unsafe-eval' and no 'wasm-unsafe-eval'. A release whose display layer or parser builds code
    // from text would draw nothing there; this reds first, before a frame ever shows it.
    for (const file of ['build/pdf.min.mjs', 'build/pdf.worker.min.mjs']) {
      const text = read(PKG, file);
      expect(/\bnew Function\s*\(/.test(text), `${file}: new Function`).toBe(false);
      expect(/(?<![\w.$])eval\s*\(/.test(text), `${file}: eval(`).toBe(false);
      expect(/\bisEvalSupported\b/.test(text), `${file}: isEvalSupported`).toBe(false);
    }
  });

  it('pdf dependency: the frame takes its assets from the installed package, by these imports only', () => {
    const src = read(PWA, 'src', 'docs', 'pdf', 'pdfAssets.ts');
    const specifiers = [...src.matchAll(/^import [^;]*? from '([^']+)';$/gm)].map((m) => m[1]);
    expect(specifiers).toEqual(['pdfjs-dist/build/pdf.min.mjs?raw', 'pdfjs-dist/build/pdf.worker.min.mjs?raw', '../mockup/load', './pdfBoot', './pdfPolicy']);
    const globs = [...src.matchAll(/import\.meta\.glob\('([^']+)'/g)].map((m) => m[1]);
    expect(globs).toEqual(['/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', '/node_modules/pdfjs-dist/cmaps/*.bcmap']);
    // No other file of the PDF view names the package: it reaches the frame only through this module.
    for (const f of ['PdfFrame.tsx', 'PdfLeaf.tsx', 'pdfBoot.ts', 'pdfPolicy.ts', 'pdfSrcdoc.ts', 'pdfWords.ts']) {
      expect(read(PWA, 'src', 'docs', 'pdf', f), f).not.toContain('pdfjs-dist');
    }
  });
});

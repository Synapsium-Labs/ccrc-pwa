// W8a: the shared Markdown library is pinned exactly (rich-docs spec M8.12, pin half; A21).
// Reads files from disk only; nothing here imports the library.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const LIB = '@synapsium-labs/docserver';
const readJson = (rel: string): any => JSON.parse(readFileSync(path.join(root, rel), 'utf8'));

describe('W8a: the shared Markdown library is pinned exactly (M8.12, pin half)', () => {
  it('pwa/package.json pins @synapsium-labs/docserver at exactly 1.0.0', () => {
    const pkg = readJson('package.json');
    expect(pkg.dependencies[LIB]).toBe('1.0.0');
    expect(pkg.devDependencies?.[LIB]).toBeUndefined();
  });

  it('the lock root and its node_modules entry carry 1.0.0 with a sha512 integrity', () => {
    const lock = readJson('package-lock.json');
    expect(lock.packages[''].dependencies[LIB]).toBe('1.0.0');
    const entry = lock.packages[`node_modules/${LIB}`];
    expect(entry.version).toBe('1.0.0');
    expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    expect(entry.resolved.startsWith(`https://registry.npmjs.org/${LIB}/-/docserver-1.0.0.tgz`)).toBe(true);
  });

  it('the installed package reports version 1.0.0', () => {
    expect(readJson(`node_modules/${LIB}/package.json`).version).toBe('1.0.0');
  });

  it('the installed assets manifest is 1.0.0 with bridge protocol 1', () => {
    const m = readJson(`node_modules/${LIB}/assets/assets.json`);
    expect(m.manifest).toBe(1);
    expect(m.package).toBe(LIB);
    expect(m.version).toBe('1.0.0');
    expect(m.bridgeProtocol).toBe(1);
  });

  it('the lock holds exactly one highlight.js, at 11.12.0', () => {
    const lock = readJson('package-lock.json');
    const keys = Object.keys(lock.packages).filter((k) => k.endsWith('node_modules/highlight.js'));
    expect(keys).toEqual(['node_modules/highlight.js']);
    expect(lock.packages['node_modules/highlight.js'].version).toBe('11.12.0');
  });
});

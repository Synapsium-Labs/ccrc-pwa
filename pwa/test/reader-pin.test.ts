// W8a: the shared Markdown library is pinned exactly (rich-docs spec M8.12, pin half; A21).
// Reads files from disk only; nothing here imports the library.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const LIB = '@synapsium-labs/pinax-lib';
const readJson = (rel: string): any => JSON.parse(readFileSync(path.join(root, rel), 'utf8'));

describe('W8a: the shared Markdown library is pinned exactly (M8.12, pin half)', () => {
  it('pwa/package.json pins @synapsium-labs/pinax-lib at exactly 1.2.0', () => {
    const pkg = readJson('package.json');
    expect(pkg.dependencies[LIB]).toBe('1.2.0');
    expect(pkg.devDependencies?.[LIB]).toBeUndefined();
  });

  it('the lock root and its node_modules entry carry 1.2.0 with a sha512 integrity', () => {
    const lock = readJson('package-lock.json');
    expect(lock.packages[''].dependencies[LIB]).toBe('1.2.0');
    const entry = lock.packages[`node_modules/${LIB}`];
    expect(entry.version).toBe('1.2.0');
    expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    expect(entry.resolved.startsWith(`https://registry.npmjs.org/${LIB}/-/pinax-lib-1.2.0.tgz`)).toBe(true);
  });

  it('the installed package reports version 1.2.0', () => {
    expect(readJson(`node_modules/${LIB}/package.json`).version).toBe('1.2.0');
  });

  it('the installed assets manifest is 1.2.0 with bridge protocol 1', () => {
    const m = readJson(`node_modules/${LIB}/assets/assets.json`);
    expect(m.manifest).toBe(1);
    expect(m.package).toBe(LIB);
    expect(m.version).toBe('1.2.0');
    expect(m.bridgeProtocol).toBe(1);
  });

  it('the installed assets manifest records 1.2.0\'s moved hashes and keeps the three that did not move', () => {
    const m = readJson(`node_modules/${LIB}/assets/assets.json`);
    const sha = (p: string): string | undefined => m.files.find((f: { path: string; sha256: string }) => f.path === p)?.sha256;
    expect(sha('frame/bootstrap.js')).toBe('d0ab0f7e312251e25005b7c090dbb8129a971c0755d456cf35f82fe450d26c63');
    expect(sha('frame/enhance.js')).toBe('d2c7df4e3c29a12555c3324333a5a52def3c3f02290b510fd4abc658521f076b');
    expect(sha('frame/reader.css')).toBe('32aa81ef916560fe4a304599dfcebcd96cd4825e1d8c33d0e6ae81916d563529');
    expect(sha('reader.css')).toBe('816db9774bbda71b99b85d1404523c8c837866bee2072eae0806339405cc2996');
    expect(sha('frame/guard.js')).toBe('ff3c25da5703bc06d40ca0412b2e760c619a73a4153306f4d0f3b662bda65c4d');
    expect(sha('mermaid/mermaid.frame.js')).toBe('7585b2055ba386b9acff71b9c8a0c40b36dec79c2106a4aa56048c8fe59832c3');
    expect(sha('mermaid/mermaid.mjs')).toBe('dfba66fc5c75e030c35bf16d5e7a62bbee7be5496cabec94ec93f85d626b38df');
  });

  it('the lock holds exactly one highlight.js, at 11.12.0', () => {
    const lock = readJson('package-lock.json');
    const keys = Object.keys(lock.packages).filter((k) => k.endsWith('node_modules/highlight.js'));
    expect(keys).toEqual(['node_modules/highlight.js']);
    expect(lock.packages['node_modules/highlight.js'].version).toBe('11.12.0');
  });
});

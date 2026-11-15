// W8a: the shared Markdown library is pinned exactly (rich-docs spec M8.12, pin half; A21).
// Reads files from disk only; nothing here imports the library.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const LIB = '@synapsium-labs/docserver';
const readJson = (rel: string): any => JSON.parse(readFileSync(path.join(root, rel), 'utf8'));

describe('W8a: the shared Markdown library is pinned exactly (M8.12, pin half)', () => {
  it('pwa/package.json pins @synapsium-labs/docserver at exactly 1.1.0', () => {
    const pkg = readJson('package.json');
    expect(pkg.dependencies[LIB]).toBe('1.1.0');
    expect(pkg.devDependencies?.[LIB]).toBeUndefined();
  });

  it('the lock root and its node_modules entry carry 1.1.0 with a sha512 integrity', () => {
    const lock = readJson('package-lock.json');
    expect(lock.packages[''].dependencies[LIB]).toBe('1.1.0');
    const entry = lock.packages[`node_modules/${LIB}`];
    expect(entry.version).toBe('1.1.0');
    expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    expect(entry.resolved.startsWith(`https://registry.npmjs.org/${LIB}/-/docserver-1.1.0.tgz`)).toBe(true);
  });

  it('the installed package reports version 1.1.0', () => {
    expect(readJson(`node_modules/${LIB}/package.json`).version).toBe('1.1.0');
  });

  it('the installed assets manifest is 1.1.0 with bridge protocol 1', () => {
    const m = readJson(`node_modules/${LIB}/assets/assets.json`);
    expect(m.manifest).toBe(1);
    expect(m.package).toBe(LIB);
    expect(m.version).toBe('1.1.0');
    expect(m.bridgeProtocol).toBe(1);
  });

  it('the installed assets manifest records 1.1.0\'s moved hashes and keeps the three that did not move', () => {
    const m = readJson(`node_modules/${LIB}/assets/assets.json`);
    const sha = (p: string): string | undefined => m.files.find((f: { path: string; sha256: string }) => f.path === p)?.sha256;
    expect(sha('frame/bootstrap.js')).toBe('dc49ce7dffeb1d2f9ebba065ec6a53ecbdf3ab1439f67c63c17763dda459c424');
    expect(sha('frame/enhance.js')).toBe('6bcf14892e483f442f701c0ca9ff521c86e482c219485102b81927db9070eb64');
    expect(sha('frame/reader.css')).toBe('b065ff8f9e7d20cfd39bd33b9d4be8414554d4c2bfec8d18636efecad83f5c97');
    expect(sha('reader.css')).toBe('9643075331610addc88df72d55289be749fb4c991607c96c22f7bde63e22eeb5');
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

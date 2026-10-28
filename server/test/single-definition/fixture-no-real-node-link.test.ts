import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wrapRealTool } from '../wrapRealTool.js';

// A fixture must never LINK a user-owned real binary (nvm's node/npm/npx, process.execPath) into a fixture bin: a
// later stub write to that name follows the link and overwrites the operator's real file (incident 2026-10-26).
// Place it with `wrapRealTool` (test/wrapRealTool.ts) instead.
const ROOTS = [resolve(__dirname, '..'), resolve(__dirname, '..', '..', '..', 'agent', 'test')];
const SELF = 'fixture-no-real-node-link.test.ts';
// symlinkSync( <source naming node/npm/npx/execPath> ,
const BAD = /symlinkSync\(\s*(?:realPath\(\s*['"](?:node|npm|npx)['"]\s*\)|REAL_NODE|process\.execPath|which\(\s*['"](?:node|npm|npx)['"])/;

const files = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : files(p)) : /\.(ts|mjs)$/.test(n) && n !== SELF ? [p] : [];
});

describe('no fixture links a real node, npm, npx or execPath', () => {
  it('finds no symlinkSync whose source is one of them', () => {
    const holders = ROOTS.flatMap(files).filter((f) => BAD.test(readFileSync(f, 'utf8')));
    expect(holders).toEqual([]);
  });

  it('wrapRealTool: a write to the placed name leaves the real file untouched', () => {
    const d = mkdtempSync(join(tmpdir(), 'wrap-real-'));
    try {
      const real = join(d, 'real-tool'); writeFileSync(real, '#!/bin/sh\necho real\n'); chmodSync(real, 0o755);
      const dest = join(d, 'bin-tool');
      symlinkSync(real, dest);                       // a pre-existing link is replaced, not written through
      wrapRealTool(real, dest);
      writeFileSync(dest, 'recorder');
      expect(readFileSync(real, 'utf8')).toBe('#!/bin/sh\necho real\n');
      wrapRealTool(real, dest);
      expect(execFileSync(dest, { encoding: 'utf8' })).toBe('real\n');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

// The Windows port: registry paths arrive in MSYS spelling (`/c/Users/...`), which native node cannot open. localIO
// translates them at its edge (`nativePath`), once, for every reader: archive's worktree check, the projects list,
// a transcript's directory.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { localIO, nativePath } from '../src/io.js';

const msys = (p: string): string => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`);

describe('nativePath and localIO with an MSYS-spelled path', () => {
  it.skipIf(process.platform === 'win32')('is the identity off Windows', () => {
    expect(nativePath('/c/Users/u/x')).toBe('/c/Users/u/x');
  });

  it.skipIf(process.platform !== 'win32')('maps /<drive>/ to <DRIVE>: and leaves every other path alone', () => {
    expect(nativePath('/c/Users/u/x')).toBe('C:/Users/u/x');
    expect(nativePath('/d')).toBe('D:');
    expect(nativePath('C:/Users/u')).toBe('C:/Users/u');
    expect(nativePath('/cc/x')).toBe('/cc/x');
    expect(nativePath(String.raw`\c\Users\u\.git`)).toBe(String.raw`C:\Users\u\.git`);   // path.join's spelling on win32
  });

  it.skipIf(process.platform !== 'win32')('stat, readdir, readFile and realpath answer for an MSYS-spelled path', async () => {
    const dir = mkTmp('ccrc-native-path-');
    mkdirSync(path.join(dir, 'tree'));
    writeFileSync(path.join(dir, 'tree', 'f.txt'), 'hello');
    const m = msys(path.join(dir, 'tree'));
    expect((await localIO.statMeasured(m)).ok).toBe(true);
    expect(await localIO.readdir(m)).toEqual(['f.txt']);
    expect(await localIO.readFile(`${m}/f.txt`)).toBe('hello');
    expect(await localIO.realpath(m)).not.toBeNull();
    // A linked worktree's `.git` FILE, asked as lifecycle's isLinkedWorktree asks it: path.join over the MSYS spelling.
    writeFileSync(path.join(dir, 'tree', '.git'), 'gitdir: x\n');
    expect(await localIO.lstatMeasured(path.join(m, '.git'))).toEqual({ ok: true, kind: 'regular' });
  });
});

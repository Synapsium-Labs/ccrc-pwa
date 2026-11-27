// The Windows port's `mkdir` shim (ccd/ccd and ccd/ccrc): MSYS2's `mkdir -m` makes the directory and then fails its
// mode change, so the shim drops `-m <mode>` there. This file runs the block itself, cut from each script, under an
// `OSTYPE=msys` bash on any platform, over every `-m` spelling the two scripts and their libraries use.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mkTmp } from './tmpHelpers.js';

const ROOT = path.resolve(__dirname, '..', '..');
const block = (file: string): string => {
  const src = readFileSync(path.join(ROOT, 'ccd', file), 'utf8');
  // `mkdir() {` at column 0 inside the case: the only shape ccd-contexts.test.ts's definition census reads.
  const m = /^case "\$\{OSTYPE:-\}" in msys\*\|cygwin\*\)\nmkdir\(\) \{\n[\s\S]*?\n\}\n;; esac\n/m.exec(src);
  if (!m) throw new Error(`no mkdir shim in ccd/${file}`);
  return m[0];
};

describe('the MSYS mkdir shim', () => {
  it('is one block, the same bytes in ccd and ccrc', () => {
    expect(block('ccrc')).toBe(block('ccd'));
  });

  it('drops every -m spelling and still makes the directories, refusing an existing leaf as mkdir does', () => {
    const d = mkTmp('ccrc-msys-mkdir-');
    const script = `OSTYPE=msys\n${block('ccd')}\ncd "$1" || exit 9
mkdir -p -m 0700 a/b || exit 1
mkdir -m 0700 -- c || exit 2
mkdir -pm 700 d/e || exit 3
mkdir -m0700 f || exit 4
mkdir -p -m 0755 a/b || exit 5
mkdir -m 0700 c 2>/dev/null && exit 6
[ "$(type -t mkdir)" = function ] || exit 7
exit 0\n`;
    const r = spawnSync('bash', ['-c', script, 'shim', d], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    for (const p of ['a/b', 'c', 'd/e', 'f']) expect(existsSync(path.join(d, p)), p).toBe(true);
  });

  it('defines nothing off MSYS: on linux-gnu mkdir stays the real command', () => {
    const r = spawnSync('bash', ['-c', `OSTYPE=linux-gnu\n${block('ccd')}\ntype -t mkdir`], { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('file');
  });
});

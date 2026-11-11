// D-8166 (plan docs/superpowers/plans/2026-11-10-test-box-connect.md, Task TC7). Try again is idempotent after a failure
// at or after the install phase: the settings phase leaves the box file alone when its content is unchanged, so the
// real installer's "nothing to do" retry keeps the file the service user's group read (0640) and the service can read
// its settings. The settings phase's remote script is taken from ccd/ccrc-testbox-admin as written and run here as the
// test user (chown is a no-op shim, the installer runs under the TB_SYS fixture).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeBox, makeWorld, install, REPO, type Box, type World } from './testboxBoxFixture.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const ADMIN = readFileSync(path.join(REPO, 'ccd', 'ccrc-testbox-admin'), 'utf8');
const SNIPPET = /^\s*_tba_cx_out sh -c '(umask 077; p=\$1; d=\$\(dirname "\$p"\);[^']*)' sh "\$TBA_BOX_ENV_PATH"/m.exec(ADMIN)?.[1];

let W: World;
beforeAll(async () => { W = await makeWorld(); }, 180_000);
afterAll(async () => { await W?.close(); });

/** The settings phase's box-file write, with `content` on stdin. */
function writeBoxFile(b: Box, content: string, shim: string): { rc: number; err: string } {
  const r = spawnSync('sh', ['-c', SNIPPET!, 'sh', b.boxFile], { input: content, encoding: 'utf8', env: { ...process.env, PATH: `${shim}:${process.env.PATH ?? ''}` } });
  return { rc: r.status ?? -1, err: r.stderr };
}
/** chown does nothing, and install drops -o and -g, so the script runs as the test user. */
function shimOwners(dir: string): void {
  writeFileSync(path.join(dir, 'chown'), '#!/bin/sh\nexit 0\n');
  writeFileSync(path.join(dir, 'install'), '#!/bin/sh\na=\nwhile [ $# -gt 0 ]; do case $1 in -o|-g) shift 2;; *) a="$a \'$1\'"; shift;; esac; done\neval exec /usr/bin/install $a\n');
  // GNU chmod/chown --reference is not on every test host: chmod copies the mode by stat, chown (above) does nothing.
  // GNU's `stat -c` first: GNU `stat -f` succeeds too, printing the FILESYSTEM's status, and BSD `stat -c` fails.
  writeFileSync(path.join(dir, 'chmod'), '#!/bin/sh\ncase $1 in --reference=*) r=${1#--reference=}; m=$(stat -c %a "$r" 2>/dev/null || stat -f %Lp "$r"); shift; exec /bin/chmod "$m" "$@";; esac\nexec /bin/chmod "$@"\n');
  chmodSync(path.join(dir, 'chmod'), 0o755);
  chmodSync(path.join(dir, 'chown'), 0o755);
  chmodSync(path.join(dir, 'install'), 0o755);
}
const mode = (p: string): string => (statSync(p).mode & 0o777).toString(8);

describe('connect: try again against the real installer (D-8166, TC7)', () => {
  it('a retry with unchanged settings keeps the installed box file group-readable and the installer has nothing to do', async () => {
    expect(SNIPPET, 'the settings phase script is found').toBeDefined();
    const shim = mkTmp('ccrc-tb-chown-shim-');
    shimOwners(shim);
    const b = makeBox(W);
    const first = await install(b, { staging: W.staging });
    expect(first.code, first.stderr).toBe(0);
    expect(mode(b.boxFile)).toBe('640');
    const before = readFileSync(b.boxFile, 'utf8');

    const w = writeBoxFile(b, before, shim);
    expect(w.rc, w.err).toBe(0);
    expect(readFileSync(b.boxFile, 'utf8')).toBe(before);
    expect(mode(b.boxFile), 'the unchanged file keeps the installer\'s mode').toBe('640');

    const again = await install(b, { staging: W.staging });
    expect(again.code, again.stderr).toBe(0);
    expect(again.stderr + again.stdout).toContain('nothing to do');
    expect(mode(b.boxFile)).toBe('640');
  }, 240_000);

  it('changed settings replace the file but keep its mode and group, so the service can still read it if the installer refuses', () => {
    const shim = mkTmp('ccrc-tb-chown-shim-');
    shimOwners(shim);
    const b = makeBox(W);
    chmodSync(b.boxFile, 0o640);
    const w = writeBoxFile(b, `${readFileSync(b.boxFile, 'utf8')}CCRC_TESTBOX_EXTRA=1\n`, shim);
    expect(w.rc, w.err).toBe(0);
    expect(mode(b.boxFile)).toBe('640');
    expect(readFileSync(b.boxFile, 'utf8')).toContain('CCRC_TESTBOX_EXTRA=1');
  });

  it('a first write, with no file there yet, is root\'s at 0600 until the installer gives it the service user\'s group', () => {
    const shim = mkTmp('ccrc-tb-chown-shim-');
    shimOwners(shim);
    const b = makeBox(W);
    rmSync(b.boxFile);
    const w = writeBoxFile(b, 'CCRC_TESTBOX_EXTRA=1\n', shim);
    expect(w.rc, w.err).toBe(0);
    expect(mode(b.boxFile)).toBe('600');
  });
});

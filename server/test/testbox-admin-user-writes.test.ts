// The test box admin verb's box-side writes that land where a less privileged user of the box has a say
// (ccd/testbox-user-write; task note docs/superpowers/programs/overlord/testbox-admin-hardening.md). What is held here, one
// property at a time, each by a case that goes red when the property is broken:
//   P1  a write into a place a less privileged user controls is made with that user's identity, or it refuses;
//   P2  a link, a second name or a wrong kind of file at a name a step is about to write, own, mode or rename refuses with a
//       word of its own, and nothing is followed;
//   P3  a check and the act it guards are one step;
//   P4  for a box in order the step does what it did, and fails with the exit its caller maps to a closed code.
//
// The box programs run for real, under the box's own `sh`, against fixture folders. A test cannot run as root, so shims on PATH
// stand in where a box differs (the build copy's suite does the same, server/test/testbox-admin-acts.test.ts): `id` names the
// service user as this test's own user (or as root, when told); `setpriv` records how it was asked to drop privilege and starts
// what follows `--` as this user, marked dropped; `ls` can read a folder as another owner's; `chown` records what it was asked,
// where, and changes nothing; `find` reads root's owner as this user; the tools that write record whether they ran dropped and
// then run the real tool. What only a real box shows is in the task note.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HELPERS = join(REPO, 'ccd', 'testbox-user-write');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const UID = process.getuid?.() ?? 0;
const GID = process.getgid?.() ?? 0;
const SVC = 'ccrc-tb-svc';
const TOKEN = 'f0'.repeat(32);
const VICTIM = 'NOT-YOURS\n';
const real = (t: string): string => spawnSync('bash', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim();
const REAL = Object.fromEntries(['mkdir', 'mktemp', 'mv', 'chmod', 'cat', 'cp', 'ls', 'find', 'ln', 'rm'].map((t) => [t, real(t)]));

interface Box { dir: string; shims: string; log: string; owners: string; victim: string; victimDir: string; sealed: string }

/** A fixture folder with the shims, a file and a folder that are not the user's to touch, and an owner map for `ls`. */
function box(): Box {
  const dir = realpathSync(mkTmp('tb-uw-'));   // physical, as every `pwd -P` the programs compare is
  const shims = join(dir, 'shims');
  const log = join(dir, 'shim-log');
  const owners = join(dir, 'owners');
  const victim = join(dir, 'victim');
  const victimDir = join(dir, 'victim-dir');
  mkdirSync(shims);
  mkdirSync(victimDir);
  writeFileSync(join(victimDir, 'keep'), VICTIM);
  writeFileSync(victim, VICTIM, { mode: 0o640 });
  writeFileSync(owners, '');
  const sealed = join(dir, 'sealed');   // a file this user may not read: a step that reads through a link to it fails
  writeFileSync(sealed, VICTIM, { mode: 0o000 });
  const sh = (name: string, body: string): void => writeFileSync(join(shims, name), `#!/bin/sh\n${body}`, { mode: 0o755 });
  const rec = (tool: string): string => `printf '%s %s %s\\n' ${tool} "\${TB_DROPPED:-0}" "$*" >> '${log}'\nexec '${REAL[tool]}' "$@"\n`;
  for (const t of ['mkdir', 'mv', 'chmod', 'cat', 'cp']) sh(t, rec(t));
  // The user's own temporary file; with TB_PLANT_AT the user then plants a link to the victim folder at that name, between the
  // writer's checks and its rename.
  sh('mktemp', `o=$('${REAL['mktemp']}' "$@") || exit $?\nprintf 'mktemp %s %s\\n' "\${TB_DROPPED:-0}" "$*" >> '${log}'\n`
    + `if [ -n "\${TB_PLANT_AT-}" ]; then '${REAL['rm']}' -f -- "$TB_PLANT_AT"; '${REAL['ln']}' -s '${victimDir}' "$TB_PLANT_AT"; echo planted >> '${log}'; fi\nprintf '%s\\n' "$o"\n`);
  sh('id', `case "$1 $3" in "-u ${SVC}") echo "\${TB_SVC_UID:-${UID}}" ;; "-g ${SVC}") echo "\${TB_SVC_GID:-${GID}}" ;; *) exit 1 ;; esac\n`);
  sh('setpriv', `printf 'setpriv %s\\n' "$*" >> '${log}'\nwhile [ "$#" -gt 0 ] && [ "$1" != -- ]; do shift; done; shift\nTB_DROPPED=1 exec "$@"\n`);
  sh('chown', `printf 'chown %s %s in %s\\n' "\${TB_DROPPED:-0}" "$*" "$(pwd -P)" >> '${log}'\nexit 0\n`);
  // `ls -ldn <path>` for a path the owner map names (by its physical path): that owner, a plain directory's mode (or the map's).
  // With TB_ALL_ROOT every folder this case reads reads as root's unless the map says otherwise. With TB_SWAP_AT a read of `.`
  // standing at that physical path first moves the folder away and plants a link to the victim folder at its name.
  sh('ls', 'for a; do p=$a; done\n'
    + `case "$1" in -ldn) ;; *) exec '${REAL['ls']}' "$@" ;; esac\n`
    + 'if [ "$p" = . ]; then q=$(pwd -P); else q=$(cd -P -- "$(dirname -- "$p")" 2>/dev/null && pwd -P)/$(basename -- "$p"); fi\n'
    + `if [ -n "\${TB_SWAP_AT-}" ] && [ "$p" = . ] && [ "$q" = "$TB_SWAP_AT" ] && [ ! -e '${log}.swapped' ]; then '${REAL['mv']}' -- "$q" "$q.moved"; '${REAL['ln']}' -s '${victimDir}' "$q"; : > '${log}.swapped'; echo swapped >> '${log}'; fi\n`
    + `o=$(awk -F '\\t' -v q="$q" '$1 == q { print $2 "\\t" $3 }' '${owners}' | tail -n 1)\n`
    + `if [ -z "$o" ] && [ -n "\${TB_ALL_ROOT-}" ] && [ -d "$p" ] && [ ! -L "$p" ]; then o="0\tdrwxr-xr-x"; fi\n`
    + `if [ -n "$o" ]; then u=\${o%%\t*}; m=\${o#*\t}; [ -n "$m" ] || m=drwxr-xr-x; printf '%s 2 %s %s 4096 Jan  1 00:00 %s\\n' "$m" "$u" "$u" "$p"; exit 0; fi\n`
    + `exec '${REAL['ls']}' "$@"\n`);
  sh('find', `n=; for a; do if [ "$n" = 1 ] && [ "$a" = 0 ]; then a=${UID}; fi; n=; [ "$a" != -user ] || n=1; set -- "$@" "$a"; shift; done\nexec '${REAL['find']}' "$@"\n`);
  return { dir, shims, log, owners, victim, victimDir, sealed };
}
/** The owner map: this physical path reads as owned by <uid> (and with <mode>, an `ls -l` mode string). */
const own = (b: Box, p: string, uid: number, mode = ''): void => { writeFileSync(b.owners, `${readFileSync(b.owners, 'utf8')}${p}\t${uid}\t${mode}\n`); };
const shimLog = (b: Box): string[] => (existsSync(b.log) ? readFileSync(b.log, 'utf8').split('\n').filter((l) => l !== '') : []);
const victimAsWas = (b: Box): void => {
  expect(readFileSync(b.victim, 'utf8')).toBe(VICTIM);
  expect(statSync(b.victim).mode & 0o7777).toBe(0o640);
  expect(readdirSync(b.victimDir)).toEqual(['keep']);
  expect(readFileSync(join(b.victimDir, 'keep'), 'utf8')).toBe(VICTIM);
};
/** Every path under a folder with its kind, mode and bytes or link target: what "changed nothing" compares. */
function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const st = lstatSync(p);
      const r = `${rel}${n}`;
      if (st.isSymbolicLink()) out.push(`${r} -> ${readlinkSync(p)}`);
      else if (st.isDirectory()) { out.push(`${r}/ ${(st.mode & 0o7777).toString(8)}`); walk(p, `${r}/`); }
      else if (st.isFIFO()) out.push(`${r} fifo`);
      else out.push(`${r} ${(st.mode & 0o7777).toString(8)} ${st.nlink} ${readFileSync(p, 'utf8')}`);
    }
  };
  walk(dir, '');
  return out;
}
/** Run one of the helper file's programs under the box's `sh`: the program's name, its words, its stdin. */
function run(b: Box, program: string, words: string[], o: { input?: string; env?: NodeJS.ProcessEnv } = {}): { out: string; err: string; rc: number } {
  const r = spawnSync(BASH, ['-c', `. "$1"; p=$2; shift 2; exec sh -c "\${!p}" sh "$@"`, '_', HELPERS, program, ...words], {
    env: { PATH: `${b.shims}:/usr/bin:/bin`, HOME: b.dir, LANG: 'C', ...o.env }, encoding: 'utf8', cwd: b.dir, input: o.input ?? '',
  });
  return { out: r.stdout ?? '', err: r.stderr ?? '', rc: r.status ?? -1 };
}
const helper = (name: string): string => spawnSync(BASH, ['-c', `. "$1"; printf %s "\${!2}"`, '_', HELPERS, name], { encoding: 'utf8' }).stdout;

// ── the service token ───────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(UID === 0)('the service token is written as the service user (TBA_TOKEN_PUT_SH)', () => {
  /** The homes folder, the service user's home in it (this test's user's), and the token's default setting. */
  function homes(b: Box): { homes: string; home: string; ccrc: string; tok: string } {
    const homesDir = join(b.dir, 'homes');
    const home = join(homesDir, SVC);
    mkdirSync(home, { recursive: true });
    return { homes: homesDir, home, ccrc: join(home, '.ccrc'), tok: join(home, '.ccrc', 'testbox-service.token') };
  }
  const put = (b: Box, homesDir: string, setting = '~/.ccrc/testbox-service.token', env: NodeJS.ProcessEnv = {}) =>
    run(b, 'TBA_TOKEN_PUT_SH', [setting, SVC, helper('TBA_TOKEN_WRITE_SH'), homesDir], { input: TOKEN, env });
  const DROP = `setpriv --reuid=${UID} --regid=${GID} --clear-groups --inh-caps=-all --reset-env -- sh -c `;

  it('P4: a box in order gets the token, 0600, one name, its folder made; it says nothing and exits 0', () => {
    const b = box();
    const h = homes(b);
    const r = put(b, h.homes);
    expect([r.rc, r.out], r.err).toEqual([0, '']);
    expect(readFileSync(h.tok, 'utf8')).toBe(TOKEN);
    expect([statSync(h.tok).mode & 0o777, statSync(h.tok).nlink]).toEqual([0o600, 1]);
    expect(statSync(h.ccrc).mode & 0o777).toBe(0o755);
    expect(readdirSync(h.ccrc)).toEqual(['testbox-service.token']);
  });

  it('P4: a token already there is replaced whole, by a rename, and no temporary file is left', () => {
    const b = box();
    const h = homes(b);
    mkdirSync(h.ccrc);
    writeFileSync(h.tok, 'OLD', { mode: 0o600 });
    const ino = statSync(h.tok).ino;
    expect(put(b, h.homes).rc).toBe(0);
    expect(readFileSync(h.tok, 'utf8')).toBe(TOKEN);
    expect(statSync(h.tok).ino).not.toBe(ino);
    expect(readdirSync(h.ccrc)).toEqual(['testbox-service.token']);
  });

  it('P4: an absolute path in the service user\'s home is written the same way', () => {
    const b = box();
    const h = homes(b);
    expect(put(b, h.homes, join(h.home, 'deep', 'er', 'tok')).rc).toBe(0);
    expect(readFileSync(join(h.home, 'deep', 'er', 'tok'), 'utf8')).toBe(TOKEN);
  });

  it('P1: every write is the service user\'s own act through the one drop, and root changes no owner', () => {
    const b = box();
    const h = homes(b);
    expect(put(b, h.homes).rc).toBe(0);
    const log = shimLog(b);
    expect(log.filter((l) => l.startsWith('setpriv '))).toEqual([expect.stringMatching(new RegExp(`^${DROP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))]);
    const writes = log.filter((l) => /^(mkdir|mktemp|mv|chmod|cat|cp) /.test(l));
    expect(writes.map((l) => l.split(' ')[0])).toEqual(['mkdir', 'mktemp', 'chmod', 'cat', 'mv']);
    for (const l of writes) expect(l, l).toMatch(/^\w+ 1 /);
    expect(log.filter((l) => l.startsWith('chown '))).toEqual([]);
    // the drop is the one the build copy's writer runs under: the same words, from the same definition
    expect(helper('TBA_DROP')).toBe('setpriv --reuid="$u" --regid="$g" --clear-groups --inh-caps=-all --reset-env --');
    expect(spawnSync(BASH, ['-c', `. "$1"; . "$2"; case "$TBA_BUILD_COPY_SH" in *"exec $TBA_DROP sh -c"*"exec $TBA_DROP sh -c"*) echo twice ;; esac`, '_', HELPERS,
      join(REPO, 'ccd', 'testbox-build-copy')], { encoding: 'utf8' }).stdout).toBe('twice\n');
  });

  it('P1: a service user that resolves to root, or to no user, is refused token-user before any write', () => {
    const b = box();
    const h = homes(b);
    expect([put(b, h.homes, undefined, { TB_SVC_UID: '0' }).rc, put(b, h.homes, undefined, { TB_SVC_UID: '0' }).out]).toEqual([5, 'token-user\n']);
    const none = run(b, 'TBA_TOKEN_PUT_SH', ['~/t', 'nobody-here', helper('TBA_TOKEN_WRITE_SH'), h.homes], { input: TOKEN });
    expect([none.rc, none.out]).toEqual([5, 'token-user\n']);
    expect(tree(h.home)).toEqual([]);
    expect(shimLog(b).filter((l) => l.startsWith('setpriv '))).toEqual([]);
  });

  it.each([
    ['a link to a file of root\'s', (b: Box, t: string) => { symlinkSync(b.victim, t); }, 'put-link'],
    ['a dangling link', (b: Box, t: string) => { symlinkSync(join(b.dir, 'nowhere'), t); }, 'put-link'],
    ['a second name of a file of root\'s', (b: Box, t: string) => { linkSync(b.victim, t); }, 'put-names'],
    ['a directory', (_b: Box, t: string) => { mkdirSync(t); }, 'put-kind'],
    ['a named pipe', (_b: Box, t: string) => { expect(spawnSync('mkfifo', [t]).status).toBe(0); }, 'put-kind'],
  ])('P2: %s at the token\'s name refuses %s, follows nothing and changes nothing', (_n, arrange, word) => {
    const b = box();
    const h = homes(b);
    mkdirSync(h.ccrc);
    arrange(b, h.tok);
    const was = tree(h.home);
    const r = put(b, h.homes);
    expect([r.rc, r.out]).toEqual([5, `${word}\n`]);
    expect(tree(h.home)).toEqual(was);
    victimAsWas(b);
  });

  it('P2: a link at the token\'s folder refuses token-dir before the drop, and nothing is written through it', () => {
    const b = box();
    const h = homes(b);
    symlinkSync(b.victimDir, h.ccrc);
    const r = put(b, h.homes);
    expect([r.rc, r.out]).toEqual([5, 'token-dir\n']);
    expect(shimLog(b).filter((l) => l.startsWith('setpriv '))).toEqual([]);
    victimAsWas(b);
  });

  it('P2: a file where the token\'s folder goes refuses token-dir', () => {
    const b = box();
    const h = homes(b);
    writeFileSync(h.ccrc, 'x');
    expect(put(b, h.homes).out).toBe('token-dir\n');
  });

  it('P2: a path that climbs out of the home, or one outside it, refuses before any write', () => {
    const b = box();
    const h = homes(b);
    expect(put(b, h.homes, '~/../escaped').out).toBe('token-dir\n');
    expect(put(b, h.homes, join(b.dir, 'elsewhere')).out).toBe('token-path\n');
    expect(existsSync(join(h.homes, 'escaped'))).toBe(false);
    expect(existsSync(join(b.dir, 'elsewhere'))).toBe(false);
  });

  it('P2: a home that is a link, or that is not the service user\'s, refuses token-home', () => {
    const b = box();
    const h = homes(b);
    const other = homes(box());
    renameSync(h.home, join(b.dir, 'moved-home'));
    symlinkSync(other.home, h.home);
    expect(put(b, h.homes).out).toBe('token-home\n');
    expect(readdirSync(other.home)).toEqual([]);
    const c = box();
    const k = homes(c);
    own(c, k.home, UID + 1);
    expect(put(c, k.homes).out).toBe('token-home\n');
  });

  // A box this verb paired before it wrote as the service user has the token's folder as root's: root made it. Root hands that
  // folder, and only one that holds nothing but the token, to the user by changing the owner of the folder it stands in.
  it('P4: a token folder of root\'s holding only the token is handed to the service user, in place, and the token is written', () => {
    const b = box();
    const h = homes(b);
    mkdirSync(h.ccrc);
    writeFileSync(h.tok, 'OLD', { mode: 0o600 });
    own(b, h.ccrc, 0);
    const r = put(b, h.homes);
    expect(r.rc, r.out + r.err).toBe(0);
    expect(shimLog(b).filter((l) => l.startsWith('chown '))).toEqual([`chown 0 ${UID}:${GID} . in ${h.ccrc}`]);
    expect(readFileSync(h.tok, 'utf8')).toBe(TOKEN);
  });

  it('P4: an empty token folder of root\'s (an unpaired box) is handed over too', () => {
    const b = box();
    const h = homes(b);
    mkdirSync(h.ccrc);
    own(b, h.ccrc, 0);
    expect(put(b, h.homes).rc).toBe(0);
    expect(shimLog(b).filter((l) => l.startsWith('chown '))).toHaveLength(1);
  });

  it.each([
    ['root\'s, holding another entry', (b: Box, d: string) => { writeFileSync(join(d, 'other'), 'x'); own(b, d, 0); }],
    ['a third user\'s', (b: Box, d: string) => { own(b, d, UID + 1); }],
  ])('P1: a token folder that is %s refuses token-dir-owner, and no owner changes', (_n, arrange) => {
    const b = box();
    const h = homes(b);
    mkdirSync(h.ccrc);
    arrange(b, h.ccrc);
    const was = tree(h.home);
    expect(put(b, h.homes).out).toBe('token-dir-owner\n');
    expect(tree(h.home)).toEqual(was);
    expect(shimLog(b).filter((l) => l.startsWith('chown ') || l.startsWith('setpriv '))).toEqual([]);
  });

  // P3 for the writer: a link the user plants at the token's name after the checks is replaced by the token, in the one rename;
  // the folder it names gains nothing.
  it('P3: a link planted at the token\'s name after the writer\'s checks is replaced by the token; nothing is put through it', () => {
    const b = box();
    const h = homes(b);
    mkdirSync(h.ccrc);
    const r = put(b, h.homes, undefined, { TB_PLANT_AT: h.tok });
    expect(r.rc, r.out + r.err).toBe(0);
    expect(shimLog(b)).toContain('planted');
    expect(lstatSync(h.tok).isFile()).toBe(true);
    expect(readFileSync(h.tok, 'utf8')).toBe(TOKEN);
    victimAsWas(b);
  });

  // P3: root's owner change acts on the folder it stands in, never on a name: the user swaps the folder's name for a link at the
  // instant root reads the folder, and the change still reaches only the folder root stood in; the user's own write then meets
  // the link and refuses.
  it('P3: a swap of the token folder\'s name after root stood in it reaches only that folder, and the write then refuses', () => {
    const b = box();
    const h = homes(b);
    mkdirSync(h.ccrc);
    own(b, h.ccrc, 0);
    const r = put(b, h.homes, undefined, { TB_SWAP_AT: h.ccrc });
    expect(shimLog(b)).toContain('swapped');
    expect(shimLog(b).filter((l) => l.startsWith('chown '))).toEqual([`chown 0 ${UID}:${GID} . in ${h.ccrc}.moved`]);
    expect([r.rc, r.out]).toEqual([5, 'put-dir-link\n']);
    victimAsWas(b);
  });
});

// ── the access key file ────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(UID === 0)('the access key file\'s edits (TBA_AK_ADD, TBA_AK_DROP)', () => {
  const OTHER = 'ssh-ed25519 AAAAother person@laptop';
  const OURS = 'from="192.0.2.5",restrict ssh-ed25519 AAAAours ccrc-testbox-admin';
  const NEW = 'from="192.0.2.5",restrict ssh-ed25519 AAAAnew ccrc-testbox-admin';
  const AWK = (): string => spawnSync(BASH, ['-c', `. "$1"; printf %s "$TBA_AK_DROP_AWK"`, '_', join(REPO, 'ccd', 'ccrc-testbox-admin')], { encoding: 'utf8' }).stdout;
  function login(b: Box, lines: string[] = [OTHER, OURS]): { home: string; ak: string } {
    const home = join(b.dir, 'login');
    mkdirSync(join(home, '.ssh'), { recursive: true });
    const ak = join(home, '.ssh', 'authorized_keys');
    writeFileSync(ak, lines.map((l) => `${l}\n`).join(''), { mode: 0o640 });
    writeFileSync(join(b.shims, 'getent'), `#!/bin/sh\nprintf '%s:x:1:1::%s:/bin/sh\\n' "$2" '${home}'\n`, { mode: 0o755 });
    return { home, ak };
  }
  const add = (b: Box) => run(b, 'TBA_AK_ADD', ['admin', NEW, 'AAAAnew']);
  const drop = (b: Box, m: string, k: string, o = '') => run(b, 'TBA_AK_DROP', ['admin', m, k, AWK(), o]);

  it('P4: ADD appends the line once, keeps the other lines, the mode and the folder, and a repeat changes nothing', () => {
    const b = box();
    const l = login(b);
    expect(add(b).rc).toBe(0);
    expect(readFileSync(l.ak, 'utf8')).toBe(`${OTHER}\n${OURS}\n${NEW}\n`);
    expect(statSync(l.ak).mode & 0o777).toBe(0o640);
    expect(readdirSync(join(l.home, '.ssh'))).toEqual(['authorized_keys']);
    const ino = statSync(l.ak).ino;
    expect(add(b).rc).toBe(0);
    expect(statSync(l.ak).ino).toBe(ino);
  });

  it('P4: ADD with no file is exit 3, and makes none', () => {
    const b = box();
    const l = login(b);
    const ak = l.ak;
    spawnSync(REAL['rm']!, ['-f', ak]);
    expect(add(b).rc).toBe(3);
    expect(existsSync(ak)).toBe(false);
  });

  it('P4: DROP takes out ccrc\'s lines and keeps the others and the mode; taking every line leaves an empty file', () => {
    const b = box();
    const l = login(b);
    expect(drop(b, 'all', '').rc).toBe(0);
    expect(readFileSync(l.ak, 'utf8')).toBe(`${OTHER}\n`);
    expect(statSync(l.ak).mode & 0o777).toBe(0o640);
    const c = box();
    const k = login(c, [OURS]);
    expect(drop(c, 'all', '').rc).toBe(0);
    expect(readFileSync(k.ak, 'utf8')).toBe('');
  });

  it('P4: DROP with no file is exit 0, and makes none', () => {
    const b = box();
    const l = login(b);
    spawnSync(REAL['rm']!, ['-f', l.ak]);
    expect(drop(b, 'all', '').rc).toBe(0);
    expect(existsSync(l.ak)).toBe(false);
  });

  it.each([
    // the link names a file this user may not read, so an edit that read through it before its check would fail otherwise
    ['a link to a file of root\'s', (b: Box, ak: string) => { spawnSync(REAL['rm']!, ['-f', ak]); symlinkSync(b.sealed, ak); }, 'put-link'],
    ['a second name of a file of root\'s', (b: Box, ak: string) => { spawnSync(REAL['rm']!, ['-f', ak]); linkSync(b.victim, ak); }, 'put-names'],
    ['a directory', (_b: Box, ak: string) => { spawnSync(REAL['rm']!, ['-f', ak]); mkdirSync(ak); }, 'put-kind'],
  ])('P2: %s at the file\'s name: both edits refuse %s, read nothing through it and change nothing', (_n, arrange, word) => {
    for (const edit of [add, (b: Box) => drop(b, 'all', '')]) {
      const b = box();
      const l = login(b);
      arrange(b, l.ak);
      const was = tree(l.home);
      const r = edit(b);
      expect([r.rc, r.out]).toEqual([5, `${word}\n`]);
      expect(tree(l.home)).toEqual(was);
      victimAsWas(b);
      expect(shimLog(b).filter((x) => x.startsWith('cat ') || x.startsWith('mktemp '))).toEqual([]);
    }
  });

  it('P2: a login home that is a link refuses put-base, and nothing is read or written through it', () => {
    const b = box();
    const l = login(b);
    renameSync(l.home, join(b.dir, 'real-home'));
    mkdirSync(join(b.victimDir, '.ssh'));
    writeFileSync(join(b.victimDir, '.ssh', 'authorized_keys'), `${OURS}\n`);
    symlinkSync(b.victimDir, l.home);
    for (const r of [add(b), drop(b, 'all', '')]) expect([r.rc, r.out]).toEqual([5, 'put-base\n']);
    expect(readFileSync(join(b.victimDir, '.ssh', 'authorized_keys'), 'utf8')).toBe(`${OURS}\n`);
  });

  it('P2: a link at the key folder refuses put-dir-link, and nothing is written through it', () => {
    const b = box();
    const l = login(b);
    spawnSync(REAL['rm']!, ['-rf', join(l.home, '.ssh')]);
    writeFileSync(join(b.victimDir, 'authorized_keys'), `${OURS}\n`);
    symlinkSync(b.victimDir, join(l.home, '.ssh'));
    for (const r of [add(b), drop(b, 'all', '')]) expect([r.rc, r.out]).toEqual([5, 'put-dir-link\n']);
    expect(readFileSync(join(b.victimDir, 'authorized_keys'), 'utf8')).toBe(`${OURS}\n`);
  });
});

// ── the repair's copy over the installed tree ─────────────────────────────────────────────────────────────────────────
describe.skipIf(UID === 0)('the repair\'s copy over the installed tree runs only in folders of root\'s (TBA_TREE_COPY_SH)', () => {
  const TAG = 'v1.2.3';
  function tools(b: Box): { tools: string; rel: string; tree: string; stg: string } {
    const t = join(b.dir, 'tools');
    const rel = join(t, 'release');
    const tr = join(rel, TAG);
    const stg = join(b.dir, 'stage');
    mkdirSync(join(tr, 'deploy'), { recursive: true });
    writeFileSync(join(tr, 'deploy', 'a'), 'OLD\n', { mode: 0o644 });
    symlinkSync(TAG, join(rel, 'installed'));
    mkdirSync(join(stg, 'deploy'), { recursive: true });
    writeFileSync(join(stg, 'deploy', 'a'), 'NEW\n', { mode: 0o644 });
    for (const d of [b.dir, t, rel, tr, join(tr, 'deploy')]) chmodSync(d, 0o755);
    return { tools: t, rel, tree: tr, stg };
  }
  const copy = (b: Box, t: { tools: string; stg: string }, env: NodeJS.ProcessEnv = { TB_ALL_ROOT: '1' }) => run(b, 'TBA_TREE_COPY_SH', [t.tools, t.stg, TAG], { env });

  it('P4: a tree of root\'s is copied over, then given to root and stripped of group and other write', () => {
    const b = box();
    const t = tools(b);
    const r = copy(b, t);
    expect(r.rc, r.out + r.err).toBe(0);
    expect(readFileSync(join(t.tree, 'deploy', 'a'), 'utf8')).toBe('NEW\n');
    expect(shimLog(b).filter((l) => l.startsWith('chown '))).toEqual([expect.stringMatching(new RegExp(`^chown 0 -R -h root:root ${t.tree.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} in `))]);
  });

  it('P4: an installed tree that names another tag is exit 3, and nothing is copied', () => {
    const b = box();
    const t = tools(b);
    const r = run(b, 'TBA_TREE_COPY_SH', [t.tools, t.stg, 'v9.9.9'], { env: { TB_ALL_ROOT: '1' } });
    expect(r.rc).toBe(3);
    expect(readFileSync(join(t.tree, 'deploy', 'a'), 'utf8')).toBe('OLD\n');
  });

  it.each([
    ['the tree is not root\'s', (b: Box, t: { tree: string }) => { own(b, t.tree, UID); }, 'tree-owner'],
    ['the release folder is not root\'s', (b: Box, t: { rel: string }) => { own(b, t.rel, UID); }, 'tree-owner'],
    ['the tools folder may be written by its group', (b: Box, t: { tools: string }) => { own(b, t.tools, 0, 'drwxrwxr-x'); }, 'tree-mode'],
    ['a folder above the tools folder may be written by others', (b: Box) => { own(b, b.dir, 0, 'drwxrwxrwt'); }, 'tree-mode'],
    ['a folder above the tools folder is not root\'s', (b: Box) => { own(b, b.dir, UID); }, 'tree-owner'],
  ])('P1, P2: %s: refused %s with exit 4 before anything is written', (_n, arrange, word) => {
    const b = box();
    const t = tools(b);
    arrange(b, t as never);
    const was = tree(t.tools);
    const r = copy(b, t);
    expect([r.rc, r.out]).toEqual([4, `${word}\n`]);
    expect(tree(t.tools)).toEqual(was);
    expect(shimLog(b).filter((l) => l.startsWith('cp ') || l.startsWith('chown ') || l.startsWith('chmod '))).toEqual([]);
  });

  it('P2: the tree reached through a link (the tools folder is one) refuses tree-kind', () => {
    const b = box();
    const t = tools(b);
    const realTools = join(b.dir, 'real-tools');
    renameSync(t.tools, realTools);
    symlinkSync(realTools, t.tools);
    expect(copy(b, t).out).toBe('tree-kind\n');
    expect(readFileSync(join(realTools, 'release', TAG, 'deploy', 'a'), 'utf8')).toBe('OLD\n');
  });

  it('P2: an entry of the tree that is not root\'s, or that group or other may write, refuses tree-entry', () => {
    for (const arrange of [(t: { tree: string }) => { chmodSync(join(t.tree, 'deploy', 'a'), 0o666); }, (t: { tree: string }) => { chmodSync(join(t.tree, 'deploy'), 0o775); }]) {
      const b = box();
      const t = tools(b);
      arrange(t);
      expect(copy(b, t).out).toBe('tree-entry\n');
      expect(readFileSync(join(t.tree, 'deploy', 'a'), 'utf8')).toBe('OLD\n');
    }
    // a link inside the tree is not an entry the check reads: its own mode is every bit, and the copy never follows it
    const b = box();
    const t = tools(b);
    symlinkSync(b.victim, join(t.tree, 'deploy', 'link'));
    expect(copy(b, t).rc).toBe(0);
    victimAsWas(b);
  });
});

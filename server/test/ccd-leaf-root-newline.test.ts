// A root whose PHYSICAL path holds a newline (child reclamation wave 6, spec
// §5.6). A command substitution drops EVERY trailing newline, so a bare
// `$(cd -- "$root" && pwd -P)` read `<vol>\n` as `<vol>`: `_ws_leaf_remove`
// then removed `<vol>/<id>`, a directory OUTSIDE the root, answered 0, and
// left the real leaf standing; and `_ws_path_users` compared the wrong
// physical spelling, found nobody, and so let a leaf in use be removed; the
// expiry probe `_ws_expire_cwd_users` had the same twin. All three now resolve
// through ONE helper, `_ws_dir_physical`, which reads `pwd -P` through an `x`
// sentinel exactly as `_ws_reclaim_resolve` does, and refuses a physical path
// that holds a newline ANYWHERE; each site maps that to its own unmeasured
// answer (rc 2 for the first two, `_ws_reclaim_unmeasured` for the expiry
// probe): ccd mints no such root, and a name a line-oriented reader splits is
// never acted under.
// FIXTURE HOME ONLY: every path is under the harness's HOME; only a same-uid
// actor can make a root resolve so, which is what each case plants.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { holdProc, type Held } from './pathUsersFixture.js';

let h: CcdHarness;
let held: Held[] = [];
beforeEach(() => { h = makeCcdHarness('ccrc-leaf-root-newline-'); held = []; });
afterEach(() => { for (const p of held) p.stop(); h.cleanup(); });

const ID = 'demo-quiet-basin';
const LINUX = process.platform === 'linux';

/** `$HOME/<vol>/<id>` (the REAL leaf, holding `keep`), `$HOME/vol/<id>/precious` (the sibling a stripped
 *  spelling names), and `$HOME/root -> $HOME/<vol>`. `vol` is the name the newline-ended physical path
 *  loses its newline to. */
const plant = (vol: string): { root: string; real: string; precious: string } => {
  const real = path.join(h.home, vol, ID);
  fs.mkdirSync(real, { recursive: true });
  fs.writeFileSync(path.join(real, 'keep'), 'the real leaf');
  const precious = path.join(h.home, 'vol', ID, 'precious');
  fs.mkdirSync(path.dirname(precious), { recursive: true });
  fs.writeFileSync(precious, 'not under the root');
  const root = path.join(h.home, 'root');
  fs.symlinkSync(path.join(h.home, vol), root);
  return { root, real, precious };
};

interface Answer { rc: string; why: string }
const remove = (root: string): Answer => {
  const [rc = '', why = ''] = h.sh(`_ws_leaf_remove "${root}" "${ID}"; rc=$?; printf '%s\\x1f%s' "$rc" "$_WS_LEAF_WHY"`)
    .split('\x1f');
  return { rc, why };
};
const users = (p: string, pre = ''): Answer & { pids: string } => {
  const [rc = '', pids = '', why = ''] = h.sh(`${pre} _ws_path_users "${p}"; rc=$?;`
    + ` printf '%s\\x1f%s\\x1f%s' "$rc" "$_WS_PATH_USERS_PIDS" "$_WS_PATH_USERS_WHY"`).split('\x1f');
  return { rc, pids, why };
};

describe('_ws_leaf_remove: a root whose physical path holds a newline is refused, unmeasured — nothing is touched', () => {
  it('THE REVIEWER’S CASE: a root resolving to `vol\\n` never removes `vol/<id>` — rc 2, and both trees stand', () => {
    const t = plant('vol\n');
    const a = remove(t.root);
    expect(a.rc, a.why).toBe('2');
    expect(a.why).not.toBe('');
    expect(a.why).toContain('newline');
    expect(fs.readFileSync(t.precious, 'utf8'), 'the directory outside the root stands').toBe('not under the root');
    expect(fs.readFileSync(path.join(t.real, 'keep'), 'utf8'), 'the real leaf stands').toBe('the real leaf');
  }, 60_000);

  it('a newline ANYWHERE in the physical root — not only at its end — is refused the same way', () => {
    const t = plant('a\nb');
    const a = remove(t.root);
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('newline');
    expect(fs.readFileSync(path.join(t.real, 'keep'), 'utf8'), 'the real leaf stands').toBe('the real leaf');
    expect(fs.readFileSync(t.precious, 'utf8')).toBe('not under the root');
  }, 60_000);
});

describe('_ws_path_users: a parent whose physical path holds a newline is unmeasured — never "nobody"', () => {
  it.skipIf(!LINUX)('a LIVE process of this uid with its cwd in the REAL leaf, under a parent resolving to `vol\\n`: rc 2, never 0', () => {
    const t = plant('vol\n');
    const s = holdProc({ cwd: t.real });
    held.push(s);
    expect(fs.readlinkSync(`/proc/${s.pid}/cwd`), 'the CONTROL: the process lives in the real leaf').toBe(t.real);
    const a = users(path.join(t.root, ID));
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('newline');
  }, 60_000);

  it.skipIf(!LINUX)('the same with the newline mid-path: rc 2', () => {
    const t = plant('a\nb');
    const s = holdProc({ cwd: t.real });
    held.push(s);
    const a = users(path.join(t.root, ID));
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('newline');
  }, 60_000);

  it('a FAKE process table on any host: a cwd in the real leaf under a parent resolving to `vol\\n` is rc 2, never 0', () => {
    const t = plant('vol\n');
    const fake = [
      'CCD_OS=linux; rm -rf "$HOME/fp";',
      '_fpp() { mkdir -p "$HOME/fp/$1/fd";',
      ' printf "Name:\\tx\\nPPid:\\t%s\\nUid:\\t%s\\t%s\\t%s\\t%s\\n" "$2" "$3" "$3" "$3" "$3" > "$HOME/fp/$1/status";',
      ' : > "$HOME/fp/$1/environ"; ln -sfn / "$HOME/fp/$1/cwd"; };',
      '_fpp $$ 1 "$(id -u)";',
      '_ws_path_users_proc_root() { printf %s "$HOME/fp"; };',
      `_fpp 4242 1 "$(id -u)"; ln -sfn "$HOME/vol"$'\\n'"/${ID}" "$HOME/fp/4242/cwd";`,
    ].join(' ');
    expect(h.sh(`${fake} readlink "$HOME/fp/4242/cwd"; printf x`), 'the CONTROL: 4242’s cwd is the real leaf')
      .toBe(`${t.real}\nx`);
    const a = users(path.join(t.root, ID), fake);
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('newline');
  }, 60_000);
});

describe('_ws_expire_cwd_users: a parent whose physical path holds a newline is unmeasured — never "nobody"', () => {
  const EXP = 'demo-quiet-dune';
  const LEAF = 'quiet-dune';
  /** The expiry probe's answer: its rc, and the verdict and detail it leaves (`_ws_reclaim_unmeasured`, `_reap_refuse`). */
  const cwdUsers = (workdir: string, pre = ''): { rc: string; verdict: string; detail: string } => {
    const [rc = '', verdict = '', detail = ''] = h.sh(`_ws_reclaim_reset; ${pre} _ws_expire_cwd_users ${EXP} "${workdir}"; rc=$?;`
      + ` printf '%s\\x1f%s\\x1f%s' "$rc" "\${REAP_VERDICT-}" "\${REAP_DETAIL-}"`).split('\x1f');
    return { rc, verdict, detail };
  };
  /** A fake /proc (the seam `_ws_expire_proc_root`), ccd's own `$$` listed first; `_fp <pid> <cwd> <ppid>`. */
  const FAKE = [
    'CCD_OS=linux; rm -rf "$HOME/fp"; mkdir -p "$HOME/fp/$$"; ln -sfn "$HOME" "$HOME/fp/$$/cwd";',
    '_fp() { mkdir -p "$HOME/fp/$1"; ln -sfn "$2" "$HOME/fp/$1/cwd"; printf "%s (a b) S %s 1 1 0\\n" "$1" "$3" > "$HOME/fp/$1/stat"; };',
    '_ws_expire_proc_root() { printf %s "$HOME/fp"; };',
  ].join(' ');
  /** `$HOME/<vol>/<leaf>` (the REAL worktree) and `$HOME/root -> $HOME/<vol>`; the workdir asked is `$HOME/root/<leaf>`. */
  const plantWt = (vol: string): { workdir: string; real: string } => {
    const real = path.join(h.home, vol, LEAF);
    fs.mkdirSync(path.join(real, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(h.home, 'vol', LEAF), { recursive: true });
    fs.symlinkSync(path.join(h.home, vol), path.join(h.home, 'root'));
    return { workdir: path.join(h.home, 'root', LEAF), real };
  };

  it('a FAKE process table on any host: a cwd in the real worktree under a parent resolving to `vol\\n` is unmeasured (rc 1), never nobody', () => {
    const t = plantWt('vol\n');
    const pre = `${FAKE} _fp 4242 "$HOME/vol"$'\\n'"/${LEAF}/sub" 1;`;
    expect(h.sh(`${pre} readlink "$HOME/fp/4242/cwd"; printf x`), 'the CONTROL: 4242 works in the real worktree')
      .toBe(`${t.real}/sub\nx`);
    const a = cwdUsers(t.workdir, pre);
    expect(a.rc, a.detail).toBe('1');
    expect(a.verdict, a.detail).toBe('unmeasured');
    expect(a.detail).toContain('newline');
  }, 60_000);

  it('CONTROL: the same process under a parent with no newline is found — in-use', () => {
    const real = path.join(h.home, 'plain', LEAF);
    fs.mkdirSync(path.join(real, 'sub'), { recursive: true });
    const a = cwdUsers(real, `${FAKE} _fp 4242 "${real}/sub" 1;`);
    expect(a.rc, a.detail).toBe('1');
    expect(a.verdict, a.detail).toBe('in-use');
    expect(a.detail).toContain('process 4242 ');
  }, 60_000);

  it.skipIf(!LINUX)('a LIVE process of this uid with its cwd in the real worktree, under a parent resolving to `vol\\n`: unmeasured, never nobody', () => {
    const t = plantWt('vol\n');
    const s = holdProc({ cwd: path.join(t.real, 'sub') });
    held.push(s);
    const a = cwdUsers(t.workdir);
    expect(a.rc, a.detail).toBe('1');
    expect(a.verdict, a.detail).toBe('unmeasured');
    expect(a.detail).toContain('newline');
  }, 60_000);
});

describe('_ws_dir_physical — the one physical resolution of a directory, read through an `x` sentinel', () => {
  /** The helper's rc, `_WS_PHYS` and `_WS_PHYS_WHY`. */
  const phys = (dir: string, pre = ''): { rc: string; phys: string; why: string } => {
    const [rc = '', p = '', why = ''] = h.sh(`${pre} _ws_dir_physical "${dir}"; rc=$?;`
      + ` printf '%s\\x1f%s\\x1f%s' "$rc" "$_WS_PHYS" "$_WS_PHYS_WHY"`).split('\x1f');
    return { rc, phys: p, why };
  };

  it('CONTROL: a directory reached through a link answers its physical path — and a function named cd, pwd or printf cannot answer for it', () => {
    const vol = path.join(h.home, 'vol');
    fs.mkdirSync(vol);
    fs.symlinkSync(vol, path.join(h.home, 'root'));
    const a = phys(path.join(h.home, 'root'));
    expect(a.rc, a.why).toBe('0');
    expect(a.phys).toBe(fs.realpathSync(vol));
    expect(a.why).toBe('');
    const lying = phys(path.join(h.home, 'root'), 'cd() { :; }; pwd() { echo /elsewhere; }; printf() { if [[ "$*" == x ]]; then command printf y; else command printf "$@"; fi; };');
    expect(lying.phys, 'the shadowing functions were never called').toBe(fs.realpathSync(vol));
  }, 60_000);

  it('a directory that cannot be entered (missing, or a regular file) answers 1 and says so, `_WS_PHYS` empty', () => {
    fs.writeFileSync(path.join(h.home, 'file'), 'x');
    for (const d of [path.join(h.home, 'missing'), path.join(h.home, 'file')]) {
      const a = phys(d);
      expect(a.rc, `${d}: ${a.why}`).toBe('1');
      expect(a.phys).toBe('');
      expect(a.why).toContain(`${d} cannot be entered`);
    }
  }, 60_000);

  it('a read with no sentinel answers 1 and says so — a `builtin` function made readonly (BASH_ENV’s reach) prints no `x`', () => {
    fs.mkdirSync(path.join(h.home, 'vol'));
    // `unset -f builtin` fails on a readonly function, so `builtin printf x` reaches it: it prints `y`.
    const pre = 'builtin() { if [[ "$1" == printf ]]; then command printf y; else command "$@"; fi; }; readonly -f builtin;';
    const a = phys(path.join(h.home, 'vol'), pre);
    expect(a.rc, a.why).toBe('1');
    expect(a.phys).toBe('');
    expect(a.why).toContain('sentinel');
  }, 60_000);

  it.each([['at its end', 'vol\n'], ['mid-path', 'a\nb']])('a physical path holding a newline %s answers 1 and says so, `_WS_PHYS` empty', (_label, vol) => {
    fs.mkdirSync(path.join(h.home, vol));
    fs.symlinkSync(path.join(h.home, vol), path.join(h.home, 'root'));
    const a = phys(path.join(h.home, 'root'));
    expect(a.rc, a.why).toBe('1');
    expect(a.phys).toBe('');
    expect(a.why).toContain('newline');
  }, 60_000);
});

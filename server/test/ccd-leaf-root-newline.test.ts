// A root whose PHYSICAL path holds a newline (child reclamation wave 6, spec
// §5.6). A command substitution drops EVERY trailing newline, so a bare
// `$(cd -- "$root" && pwd -P)` read `<vol>\n` as `<vol>`: `_ws_leaf_remove`
// then removed `<vol>/<id>`, a directory OUTSIDE the root, answered 0, and
// left the real leaf standing; and `_ws_path_users` compared the wrong
// physical spelling, found nobody, and so let a leaf in use be removed. Both
// now read the resolution through an `x` sentinel, and refuse — unmeasured,
// rc 2 — a physical path that holds a newline ANYWHERE: ccd mints no such
// root, and a name that a line-oriented reader splits is never acted under.
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

// Two pins on `_ws_leaf_checkouts` (child reclamation, spec §5.5 and §5.6).
// (1) `_ws_leaf_read_small` tests `-f` BEFORE it opens a file, so a FIFO is
// never opened. A FIFO at `.git` itself never reaches that guard, because
// `_ws_leaf_checkout_one`'s own `! -f` arm answers it first. Here the FIFO
// is an OUTSIDE admin directory's `gitdir` back-link, which is read only
// through the helper: rc 2, at once. The ask runs under BOUNDED, so a build
// that opens the FIFO reds in seconds and never wedges the suite.
// (2) A refusal OUTRANKS an unmeasured entry WHATEVER ORDER the walk lists
// them in. A `find` shim sorts the walk by name, so the refusal is listed
// first, between and last on any file system, never by a directory hash.
// FIXTURE HOME ONLY: every repository, leaf, FIFO and shim is under the
// harness's HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, BOUNDED, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-leaf-checkouts-pins-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-basin';
const leafOf = (): string => path.join(h.home, 'root', ID);

interface Answer { rc: string; why: string }
const ask = (leaf: string, pre = ''): Answer => {
  const [rc = '', why = ''] = h.sh(`${pre} _ws_leaf_checkouts "${leaf}"; rc=$?;`
    + ' printf \'%s\\x1f%s\' "$rc" "$_WS_CHECKOUTS_WHY"').split('\x1f');
  return { rc, why };
};

/** A linked worktree of a repository OUTSIDE the leaf, then `mv`'d to `dest`: its `.git` still names the
 *  admin directory, whose `gitdir` back-link names the tree's OLD path, so the tree is refused. */
const movedTree = (dest: string, name = 'still-harbor'): { admin: string } => {
  const main = fs.existsSync(path.join(h.home, 'projects', 'demo2')) ? path.join(h.home, 'projects', 'demo2') : h.makeRepo('demo2');
  const wt = path.join(h.home, 'worktrees', 'demo2', name);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  h.git(main, 'worktree', 'add', '-q', '-b', `ws/${name}`, wt);
  fs.writeFileSync(path.join(wt, 'precious.txt'), 'uncommitted work of another session\n');
  const admin = h.git(wt, 'rev-parse', '--absolute-git-dir');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(wt, dest);
  expect(fs.readFileSync(path.join(dest, '.git'), 'utf8').trim(), 'the CONTROL: the moved tree names its admin dir')
    .toBe(`gitdir: ${admin}`);
  return { admin };
};

describe('the back-link is read only as a regular file — a FIFO there is never opened', () => {
  it('a FIFO as an OUTSIDE admin directory’s `gitdir` answers rc 2 at once — the walk never blocks on it', () => {
    const { admin } = movedTree(path.join(leafOf(), 'parked', 'still-harbor'));
    expect(ask(leafOf()).rc, 'the CONTROL: the fixture reaches the back-link read (a regular one naming another tree refuses)')
      .toBe('1');
    const back = path.join(admin, 'gitdir');
    fs.rmSync(back);
    execFileSync('mkfifo', [back]);
    expect(fs.statSync(back).isFIFO(), 'the CONTROL: a FIFO stands at the back-link').toBe(true);
    const inner = 'source "$1"; _ws_leaf_checkouts "$2"; rc=$?; printf "%s\\x1f%s" "$rc" "$_WS_CHECKOUTS_WHY"';
    const [body = '', bounded = ''] = h.sh(`${BOUNDED} 10 bash -c '${inner}' _ "${CCD}" "${leafOf()}"; printf '\\x1e%s' "$?"`)
      .split('\x1e');
    expect(bounded, 'the ask returned inside the 10 s bound — 142 means the FIFO was opened and blocked').toBe('0');
    const [rc = '', why = ''] = body.split('\x1f');
    expect(rc, why).toBe('2');
    expect(why).toContain(`${back} could not be read whole`);
  }, 60_000);
});

describe('a refusal OUTRANKS an unmeasured entry — in every order the walk can list them', () => {
  /** A `find` shim on PATH. THIS walk (it alone carries `-xdev` and `.git`) runs the real find, then lists its
   *  hits sorted by name (LC_ALL=C) and records that order; every other find is the real one. */
  const shimmed = (): string => {
    const realFind = execFileSync('sh', ['-c', 'command -v find'], { encoding: 'utf8', env: inheritedEnv() }).trim();
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'find'), [
      '#!/bin/sh',
      'case " $* " in *" -xdev "*" .git "*)',
      `  '${realFind}' "$@" > "$HOME/find-shim.out" || exit $?`,
      '  LC_ALL=C sort -z "$HOME/find-shim.out" > "$HOME/find-shim.order" || exit 1',
      '  exec cat "$HOME/find-shim.order" ;;',
      'esac',
      `exec '${realFind}' "$@"`,
      '',
    ].join('\n'), { mode: 0o755 });
    return `PATH="${shim}:$PATH"; hash -r;`;
  };

  it.each([['first', 'a'], ['between', 'm'], ['last', 'z']] as const)(
    'the refusal listed %s (the moved tree under `%s`), the two malformed `.git` files around it: rc 1',
    (_where, at) => {
      movedTree(path.join(leafOf(), at, 'still-harbor'));
      for (const d of ['a', 'm', 'z'].filter((n) => n !== at)) {
        fs.mkdirSync(path.join(leafOf(), d), { recursive: true });
        fs.writeFileSync(path.join(leafOf(), d, '.git'), 'not a gitdir line\n');
      }
      const a = ask(leafOf(), shimmed());
      const lp = fs.realpathSync(leafOf());
      const order = fs.readFileSync(path.join(h.home, 'find-shim.order'), 'utf8').split('\0').filter(Boolean);
      expect(order, 'the CONTROL: the shim fixed the walk’s order')
        .toEqual(['a', 'm', 'z'].map((d) => path.join(lp, d, d === at ? 'still-harbor/.git' : '.git')));
      expect(a.rc, a.why).toBe('1');
      expect(a.why).toContain(`${lp}/${at}/still-harbor/.git`);
    }, 60_000);
});

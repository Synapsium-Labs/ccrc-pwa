// path-identity W2, TR8: a back-link with a NUL INSIDE the path it names is refused (path-identity spec §3.6).
// `_ws_leaf_read_small` reads each NUL as a newline, so a hand-made admin `gitdir` back-link whose NUL sat at the
// offset of a newline in the `.git` path read as that path, and `_ws_leaf_checkout_one` accepted the tree as the
// leaf's own. Git never writes a NUL. The reader now says where the NULs stood (`_WS_SMALL_NUL`: `inner`,
// `trailing` or ''), and a back-link with an inner one is refused, rc 1, before any compare. A trailing NUL stays a
// line end, and a NUL in the `.git` FILE stays unmeasured (rc 2), as before.
// FIXTURE HOME ONLY (`makePrHarness`): every leaf, admin directory and file is under the harness's HOME, written by
// hand; no git runs (git would never write these bytes), and ccd runs as SOURCED functions, never against the live
// HOME. The `${_WS_SMALL_NUL-}` reads are deliberate: before this wave the global does not exist and ccd runs under
// `set -u`, so a bare read would abort the snippet instead of answering. The source-time case pins the initialiser.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-leaf-nul-backlink-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-basin';
/** A path component holding one newline: a `.git` path under it holds one too. */
const NL = 'a\nb';
const rootOf = (): string => path.join(h.home, 'root');
const leafOf = (): string => path.join(rootOf(), ID);
/** The admin directory OUTSIDE the leaf that every tree here names. */
const admOf = (): string => path.join(h.home, 'adm', 'wt');

interface Answer { rc: string; why: string }
/** The checkout question's own answer: its rc and `_WS_CHECKOUTS_WHY`. */
const ask = (leaf: string): Answer => {
  const [rc = '', why = ''] = h.sh(`_ws_leaf_checkouts "${leaf}"; rc=$?;`
    + ' printf \'%s\\x1f%s\' "$rc" "$_WS_CHECKOUTS_WHY"').split('\x1f');
  return { rc, why };
};
/** The removal helper's answer: its rc and `_WS_LEAF_WHY`. */
const remove = (root: string, id: string): Answer => {
  const [rc = '', why = ''] = h.sh(`_ws_leaf_remove "${root}" "${id}"; rc=$?;`
    + ' printf \'%s\\x1f%s\' "$rc" "$_WS_LEAF_WHY"').split('\x1f');
  return { rc, why };
};
/** After a `_ws_leaf_read_small` call: its rc, `_WS_SMALL_NUL`, and `_WS_SMALL` with each newline shown as N. */
const SHOW = ' rc=$?; printf \'%s\\x1f%s\\x1f%s\' "$rc" "${_WS_SMALL_NUL-}" "${_WS_SMALL//$\'\\n\'/N}"';
const readOf = (f: string, pre = ''): string[] => h.sh(`${pre} _ws_leaf_read_small "${f}";${SHOW}`).split('\x1f');
/** `head` failing on its Nth call in this shell, after writing a partial line. The content read is the 1st call and
 *  the NUL map the 2nd, so a read that fails part-way is reached with no fault in the file system. Each call is
 *  logged to `$HOME/head-calls`: the pipeline runs it in a subshell, so a shell variable would not count it. */
const HEAD_FAILS_AT = (n: number): string => `FAIL_AT=${n}; head() { local k; echo x >> "$HOME/head-calls";`
  + ' k=$(wc -l < "$HOME/head-calls"); if (( k == FAIL_AT )); then printf partial; return 1; fi; command head "$@"; };';

/** A tree at `<leaf>/<sub>/wt` whose `.git` FILE names the admin directory outside the leaf, `<HOME>/adm/wt`, whose
 *  `gitdir` back-link is `backlink(f)`; `f` is the physical `.git` path the walk lists. Written by hand. Returns `f`. */
const linked = (sub: string, backlink: (f: string) => string): string => {
  const wt = path.join(leafOf(), sub, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  fs.mkdirSync(admOf(), { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${admOf()}\n`);
  fs.writeFileSync(path.join(wt, 'precious.txt'), 'work of the tree\n');
  const f = path.join(fs.realpathSync(leafOf()), sub, 'wt', '.git');
  fs.writeFileSync(path.join(admOf(), 'gitdir'), backlink(f));
  return f;
};
/** The refusal's reason, uncut, for the tree whose `.git` is `f`. */
const nulWhy = (f: string): string => `${admOf()}/gitdir holds a NUL byte inside the path it names — git never writes one,`
  + ` so it is not git's record of the tree at ${path.dirname(f)}`;

describe('_ws_leaf_read_small says where the NULs stood (path-identity spec §3.6)', () => {
  it.each([
    ['a line with no NUL', 'gitdir: /a\n', '', 'gitdir: /aN'],
    ['a trailing NUL', '/a\0', 'trailing', '/aN'],
    ['a newline, then a NUL', '/a\n\0', 'trailing', '/aNN'],
    ['a NUL, then CR LF', '/a\0\r\n', 'trailing', '/aN\rN'],
    ['a NUL inside the line', '/a\0b\n', 'inner', '/aNbN'],
    ['a leading NUL', '\0/a', 'inner', 'N/a'],
    ['NULs alone', '\0\0', 'trailing', 'NN'],
    ['an empty file', '', '', ''],
  ] as const)('the NUL map of %s', (_what, body, nul, small) => {
    const f = path.join(h.home, 'small');
    fs.writeFileSync(f, body);
    expect(readOf(f), 'rc, _WS_SMALL_NUL, and _WS_SMALL with each newline shown as N').toEqual(['0', nul, small]);
  }, 60_000);

  it.each([
    ['2, over 4096 bytes', 'big', '2'],
    ['1, a directory', 'dir', '1'],
    ['1, no such file', 'gone', '1'],
  ] as const)('a read that answers %s after an inner NUL leaves both globals empty', (_what, second, rc) => {
    const inner = path.join(h.home, 'inner');
    fs.writeFileSync(inner, '/a\0b\n');
    fs.writeFileSync(path.join(h.home, 'big'), 'a'.repeat(5000));
    fs.mkdirSync(path.join(h.home, 'dir'));
    const out = h.sh(`_ws_leaf_read_small "${inner}"; a="\${_WS_SMALL_NUL-}"; _ws_leaf_read_small "${path.join(h.home, second)}"; rc=$?;`
      + ' printf \'%s|%s|%s|%s\' "$a" "$rc" "${_WS_SMALL_NUL-}" "$_WS_SMALL"');
    expect(out, 'the CONTROL (the first read said inner), then no stale value on the second').toBe(`inner|${rc}||`);
  }, 60_000);

  it('_WS_SMALL_NUL is defined once ccd is sourced, so a reader under `set -u` never meets an unbound name', () => {
    expect(h.sh('printf \'[%s]\' "$_WS_SMALL_NUL"')).toBe('[]');
  }, 60_000);

  it.each([
    ['the content read', 1],
    ['the NUL map', 2],
  ] as const)('a read that fails part-way answers 1 with both globals empty: %s', (_what, n) => {
    const f = path.join(h.home, 'small');
    fs.writeFileSync(f, '/a\0b\n');
    expect(readOf(f, HEAD_FAILS_AT(n)), 'rc 1, and no partial bytes left in _WS_SMALL').toEqual(['1', '', '']);
    expect(fs.readFileSync(path.join(h.home, 'head-calls'), 'utf8').split('\n').filter(Boolean).length,
      'the CONTROL: the shim ran up to its failing call').toBe(n);
  }, 60_000);
});

describe('a back-link with a NUL inside the path it names is refused (TR8)', () => {
  it('CONTROL: a literal back-link of a `.git` path holding a newline is the leaf’s own', () => {
    const f = linked(NL, (g) => `${g}\n`);
    expect(f.split('\n').length - 1, 'the CONTROL: the `.git` path holds exactly one newline').toBe(1);
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('a NUL at the offset of the path’s newline — accepted before this wave — is refused', () => {
    const f = linked(NL, (g) => `${g.replaceAll('\n', '\0')}\n`);
    expect(f.split('\n').length - 1, 'the CONTROL: the `.git` path holds exactly one newline').toBe(1);
    expect(fs.readFileSync(path.join(admOf(), 'gitdir'), 'utf8').replaceAll('\0', '\n'),
      'the CONTROL: read with its NUL as a newline, the back-link IS the `.git` path').toBe(`${f}\n`);
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toBe(nulWhy(f));
  }, 60_000);

  it('a NUL elsewhere, in a path holding a newline, is refused — no longer unmeasured', () => {
    const f = linked(NL, (g) => `${g.replace('/wt/.git', '/w\0t/.git')}\n`);
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toBe(nulWhy(f));
  }, 60_000);

  it('a NUL elsewhere, in a path holding none, is refused for the NUL', () => {
    const f = linked('x', (g) => `${g.replace('/wt/.git', '/w\0t/.git')}\n`);
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toBe(nulWhy(f));
  }, 60_000);

  it.each([
    ['a NUL', (g: string) => `${g}\0`, '0', ''],
    ['a newline, then a NUL', (g: string) => `${g}\n\0`, '0', ''],
    ['a NUL, then CR LF', (g: string) => `${g}\0\r\n`, '1', 'which git records as'],
  ] as const)('a trailing NUL stays a line end: %s', (_what, backlink, rc, whyHas) => {
    linked('x', backlink);
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe(rc);
    expect(a.why, 'never refused for the NUL').not.toContain('holds a NUL byte');
    expect(a.why, 'the CR is never stripped at the back-link: the compare refuses it').toContain(whyHas);
  }, 60_000);

  it('a `.git` FILE with an inner NUL stays unmeasured: the new flag is the back-link’s alone', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    fs.writeFileSync(path.join(leafOf(), 'x', '.git'), 'gitdir: /x\0/y\n');
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toBe(`${leafOf()}/x/.git is not one 'gitdir: <path>' line — git cannot tell what it names, so neither can ccd`);
  }, 60_000);
});

describe('_ws_leaf_remove keeps a leaf whose tree has such a back-link (the tail reaches it)', () => {
  it('a leaf holding a tree whose back-link has a NUL inside its path is refused, and every file stands', () => {
    const f = linked(NL, (g) => `${g.replaceAll('\n', '\0')}\n`);
    const r = remove(rootOf(), ID);
    expect(r.rc, r.why).toBe('1');
    expect(r.why).toBe(`${nulWhy(f)} — nothing under ${leafOf()} was removed`);
    expect(fs.existsSync(path.join(leafOf(), NL, 'wt', 'precious.txt')), 'the tree’s work stands').toBe(true);
    expect(fs.existsSync(path.join(leafOf(), NL, 'wt', '.git'))).toBe(true);
    expect(fs.existsSync(path.join(admOf(), 'gitdir'))).toBe(true);
  }, 60_000);

  it('CONTROL: a back-link whose only NUL trails it is the leaf’s own, and the leaf is removed', () => {
    linked(NL, (g) => `${g}\0`);
    const r = remove(rootOf(), ID);
    expect(r.rc, r.why).toBe('0');
    expect(fs.existsSync(leafOf()), 'the leaf is gone').toBe(false);
    expect(fs.existsSync(path.join(admOf(), 'gitdir')), 'the outside admin directory is never touched').toBe(true);
  }, 60_000);
});

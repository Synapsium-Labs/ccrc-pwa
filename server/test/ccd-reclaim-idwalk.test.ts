// path-identity W3, Task 2 (path-identity spec §4.5, §4.8 and §4.9): ONE bounded identity walk, and ONE identity rule.
// `_ws_reclaim_idwalk` is the one exec a rows pass makes (Task 3 wires the rung to it). It answers:
//   - the identity of each target it is asked against (`T`);
//   - the ancestry of a row's resolved spelling and of a recorded entry (`A`, `F`: every prefix stat'd, links followed);
//   - the m1 link walk of a row's literal spelling (`P`);
//   - the mount table (`M`) and the birth times (`B`).
// All of it runs under ONE `_plat_timeout` of `WS_RECLAIM_WALK_S`. A walk that does not finish, that fails, or that
// answers anything but one line per request, one per path and its `end` is unmeasured (rc 2), never "no row".
// `_ws_ident_compose`, `_ws_ident_eq` and `_ws_path_ident` are the one identity format, the one match rule and the one
// measure that every later compare uses.
// FIXTURE HOME ONLY (`makePrHarness`): every directory, link, FIFO, table and shim lives under the harness's HOME, and
// ccd runs as sourced functions, never against the live HOME. Nothing is mounted: the table is a copy of the kernel's
// own (`realMounts`) with lines appended or rewritten. No case reaches a process table: the walk reads none, and no
// case calls a probe, an audit or a verb. A case that narrows a directory's mode restores it in `finally`.
// A case whose bound is under test runs in a process group of its own (`spawnSyncGroup`, in the harness's own contained
// environment `h.env()`). A mutation that deletes the bound then ends at the group's ceiling instead of hanging the
// suite, because vitest's `testTimeout` cannot interrupt a synchronous spawn.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, ccdSource } from './ccdWsHelpers.js';
import { realMounts } from './wsCollectFixture.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { DARWIN_IDENT_SHIMS } from './worktreeIdentityFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-reclaim-idwalk-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
const DARWIN_HOST = process.platform === 'darwin';
const ROOT_USER = process.getuid?.() === 0;

/** A path under the fixture HOME, spelled PHYSICALLY: a rows pass hands the walk physical spellings. */
const at = (n: string): string => path.join(fs.realpathSync(h.home), n);
/** `at(n)`, made a directory. */
const dir = (n: string): string => { fs.mkdirSync(at(n), { recursive: true }); return at(n); };
const linesAt = (n: string): string[] => {
  const p = path.join(h.home, n);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
/** `p`'s dev:ino as stat(2) answers them, following links, in decimal. */
const devino = (p: string): string => { const s = fs.statSync(p, { bigint: true }); return `${s.dev}:${s.ino}`; };
/** glibc's `gnu_dev_major`:`gnu_dev_minor` of `p`'s device: the macros python's `os.major` and `os.minor` call.
 *  (`stat -c '%t:%T'` names a device FILE's numbers and prints `0:0` for a directory, measured.) */
const majmin = (p: string): string => {
  const d = fs.statSync(p, { bigint: true }).dev;
  return `${((d >> 8n) & 0xfffn) | ((d >> 32n) & 0xfffff000n)}:${(d & 0xffn) | ((d >> 12n) & 0xffffff00n)}`;
};
/** One bash single-quoted word. */
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
type Req = [kind: string, index: number, path: string];
/** The walk, asked in the current shell. Each request is NUL-terminated on its stdin, as a rows pass sends it. Then the
 *  snippet prints its rc, its reply and its reason: `[rc=N]`, the reply lines, `why=…`. */
const WALK = (reqs: Req[], mi = '', bt: string[] = []): string =>
  `_ws_reclaim_idwalk ${q(mi)}${bt.map((b) => ` ${q(b)}`).join('')}`
  + ` < <(printf '%s\\0'${reqs.map(([k, i, p]) => ` ${q(`${k}\t${i}\t${p}`)}`).join('')});`
  + ' rc=$?; echo "[rc=$rc]"; printf \'%s\\n\' "$_WS_IDWALK_OUT"; echo "why=$_WS_IDWALK_WHY";';
interface Walked { rc: string; lines: string[]; why: string; raw: string }
const parsed = (out: string): Walked => {
  const ls = out.split('\n');
  return {
    rc: ls[0] ?? '', lines: ls.slice(1, -1).filter((l) => l !== ''),
    why: (ls[ls.length - 1] ?? '').replace(/^why=/, ''), raw: out,
  };
};
/** `pre`, then the walk, through the harness. */
const walk = (reqs: Req[], o: { mi?: string; bt?: string[]; pre?: string } = {}): Walked => {
  const r = h.run(`${o.pre ?? ''} ${WALK(reqs, o.mi, o.bt)}`);
  expect(r.code, `the CONTROL: the snippet ran to its answer: ${r.stdout} ${r.stderr}`).toBe(0);
  return parsed(r.stdout);
};
/** `snippet`, sourced and run exactly as `h.sh` runs one, but in a process group of its own with a 20 s ceiling
 *  (`spawnSyncGroup`). Its environment is the harness's own `h.env()`, which `ghContainedEnv` builds with the gh,
 *  systemd, tmux and net poisons. Pass `strays: 'end'` for a case that leaves a process in the group on purpose. */
const grouped = (snippet: string, strays: 'throw' | 'end' = 'throw'): { out: string; timedOut: boolean } => {
  const r = spawnSyncGroup('bash', ['-c', 'ccd_h_src=$CCD_HARNESS_SRC ccd_h_snippet=$CCD_HARNESS_SNIPPET; '
    + 'unset CCD_HARNESS_SRC CCD_HARNESS_SNIPPET; source "$ccd_h_src"; eval "$ccd_h_snippet"'],
  { encoding: 'utf8', cwd: h.home, timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...h.env(), CCD_HARNESS_SRC: CCD, CCD_HARNESS_SNIPPET: snippet } }, { strays });
  return { out: (r.stdout ?? '').trim(), timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' };
};
/** A directory at `at(name)` holding one link per `tools` entry that the harness's own PATH resolves. */
const toolsDir = (name: string, tools: string[]): string => {
  const d = dir(name);
  for (const t of tools) {
    const real = h.sh(`command -v ${t} || true`);
    if (real.startsWith('/')) fs.symlinkSync(real, path.join(d, t));
  }
  return d;
};
/** A directory at `at(name)` holding a `python3` that is a shell script with `body`. */
const fakePython = (name: string, body: string): string => {
  const d = dir(name);
  fs.writeFileSync(path.join(d, 'python3'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return d;
};

/** A path as the kernel's table writes it: backslash, space, tab and newline as \134, \040, \011 and \012. */
const encoded = (p: string): string =>
  p.replace(/\\/g, '\\134').replace(/ /g, '\\040').replace(/\t/g, '\\011').replace(/\n/g, '\\012');
/** One line of the kernel's table naming a mount point at `p` (a PHYSICAL path). */
const MOUNT_LINE = (p: string): string => `9999 1 0:99 / ${encoded(p)} rw,relatime - tmpfs tmpfs rw`;
/** A mount of device `dev` whose root (field 4) is `root`, mounted where no child is. */
const ROOT_LINE = (dev: string, root: string): string => `9998 1 ${dev} ${root} /zz-w3-elsewhere rw,relatime - tmpfs zz rw`;
const table = (): string => path.join(h.home, 'mountinfo');
const tableLines = (): string[] => fs.readFileSync(table(), 'utf8').split('\n').filter((l) => l !== '');
const appendLine = (l: string): void => { fs.appendFileSync(table(), `${l}\n`); };
/** The line of the table that contains `phys`: the longest mount point that is `phys` or a component prefix of it, the
 *  last listed on a tie. This is the walk's own rule, so each expected answer below is derived, never typed. */
const containing = (phys: string): { idx: number; f: string[] } => {
  const enc = encoded(phys); const ls = tableLines();
  let best = -1;
  ls.forEach((l, i) => {
    const mp = l.split(' ')[4] ?? '';
    if ((mp === '/' || enc === mp || enc.startsWith(`${mp}/`))
      && (best < 0 || mp.length >= (ls[best]!.split(' ')[4] ?? '').length)) best = i;
  });
  expect(best, `the CONTROL: a line of the table contains ${phys}`).toBeGreaterThanOrEqual(0);
  return { idx: best, f: ls[best]!.split(' ') };
};
/** `phys`'s device-relative path: its containing line's root, then whatever follows that line's mount point. */
const devrelOf = (phys: string): string => {
  const { f } = containing(phys); const enc = encoded(phys);
  return `${f[3]!.replace(/\/+$/, '')}${f[4] === '/' ? enc : enc.slice(f[4]!.length)}` || '/';
};

/** One function's code lines in ccd: from its `name() {` line to the first line that opens with `}`, with whole-line
 *  comments dropped. This is the call graph's own region rule. */
const codeOf = (name: string): string => {
  const ls = ccdSource().split('\n');
  const at0 = ls.findIndex((l) => l.startsWith(`${name}() {`));
  expect(at0, `the CONTROL: ccd defines ${name}`).toBeGreaterThanOrEqual(0);
  const end = ls.findIndex((l, i) => i > at0 && l.startsWith('}'));
  return ls.slice(at0, end + 1).filter((l) => !/^\s*#/.test(l)).join('\n');
};

describe.skipIf(!LINUX)('_ws_reclaim_idwalk — T: a target’s identity and its device (path-identity spec §4.5)', () => {
  it('T: a standing directory answers ok with its dev:ino, which is _plat_devino’s, and its major:minor', () => {
    const c = dir('c');
    const r = walk([['T', 0, c]]);
    expect(r.rc).toBe('[rc=0]');
    expect(r.lines).toEqual([`T 0 ok ${devino(c)} ${majmin(c)}`, 'end 1']);
    expect(h.sh(`_plat_devino ${q(c)}`), 'parity: python’s dev:ino is _plat_devino’s').toBe(devino(c));
  });

  it('T: the device it answers is field 3 of the table line that contains it, the device-match CONTROL', () => {
    const c = dir('c'); realMounts(h);
    const t = walk([['T', 0, c]]).lines[0]!.split(' ');
    expect(t[4], 'major:minor, as python answers it').toBe(majmin(c));
    expect(containing(c).f[2], 'field 3 of the line that contains the child: R13’s device match holds on this box').toBe(t[4]);
  });

  it('T: an absent path answers gone', () => {
    expect(walk([['T', 0, at('nope')]]).lines).toEqual(['T 0 gone', 'end 1']);
  });

  it.skipIf(ROOT_USER)('T: a path under a directory that cannot be searched answers un eacces', () => {
    dir('locked/c'); fs.chmodSync(at('locked'), 0o000);
    try { expect(walk([['T', 0, at('locked/c')]]).lines).toEqual(['T 0 un eacces', 'end 1']); }
    finally { fs.chmodSync(at('locked'), 0o755); }
  });
});

describe('_ws_reclaim_idwalk — A and F: ancestry by device and inode, every prefix stat’d, links followed (path-identity spec §4.5)', () => {
  it('A: a path inside the child is in:0, the child itself eq:0, a sibling -', () => {
    const c = dir('c'); dir('c/x/y'); const c2 = dir('c2');
    const r = walk([['T', 0, c], ['A', 0, `${c}/x/y`], ['A', 1, c], ['A', 2, c2]]);
    expect(r.rc).toBe('[rc=0]');
    expect(r.lines.slice(1)).toEqual([`A 0 ok ${devino(`${c}/x/y`)} in:0`, `A 1 ok ${devino(c)} eq:0`,
      `A 2 ok ${devino(c2)} -`, 'end 4']);
  });

  it('A: a link standing in for a bind is followed, so a path through it is in:0', () => {
    const c = dir('c'); dir('c/server'); fs.symlinkSync(c, at('alias'));
    expect(walk([['T', 0, c], ['A', 0, `${at('alias')}/server`]]).lines[1])
      .toBe(`A 0 ok ${devino(`${c}/server`)} in:0`);
  });

  it('A: a component raced away before the walk answers gone, never -', () => {
    const c = dir('c'); dir('c/r/s'); fs.rmSync(at('c/r'), { recursive: true });
    expect(walk([['T', 0, c], ['A', 0, `${c}/r/s`]]).lines).toEqual([expect.stringMatching(/^T 0 ok /), 'A 0 gone', 'end 2']);
  });

  it('A: a path under a leaf target is in:1, and target 0 is asked before the leaves', () => {
    const c = dir('c'); const leaf = dir('leaf'); dir('leaf/z'); const inner = dir('c/inner');
    const r = walk([['T', 0, c], ['T', 1, leaf], ['T', 2, inner], ['A', 0, `${leaf}/z`], ['A', 1, inner]]);
    expect(r.lines.slice(3), 'inner IS target 2, but lies under target 0, which is asked first')
      .toEqual([`A 0 ok ${devino(`${leaf}/z`)} in:1`, `A 1 ok ${devino(inner)} in:0`, 'end 5']);
  });

  it.skipIf(ROOT_USER)('A: a prefix that cannot be searched answers un eacces', () => {
    const c = dir('c'); dir('locked/x'); fs.chmodSync(at('locked'), 0o000);
    try { expect(walk([['T', 0, c], ['A', 0, `${at('locked')}/x`]]).lines[1]).toBe('A 0 un eacces'); }
    finally { fs.chmodSync(at('locked'), 0o755); }
  });

  it('A: a path that is not absolute answers un error', () => {
    expect(walk([['A', 0, 'relative/x']]).lines).toEqual(['A 0 un error', 'end 1']);
  });

  it('F: a recorded path answers as A does, and one recreated answers its identity now', () => {
    const c = dir('c'); const rec = dir('c/rec');
    expect(walk([['T', 0, c], ['F', 0, rec]]).lines[1]).toBe(`F 0 ok ${devino(rec)} in:0`);
    fs.rmdirSync(rec); dir('c/rec');
    expect(walk([['T', 0, c], ['F', 0, rec]]).lines[1], 'the directory standing there now').toBe(`F 0 ok ${devino(rec)} in:0`);
    expect(walk([['F', 0, at('gone/rec')]]).lines).toEqual(['F 0 gone', 'end 1']);
  });
});

describe('_ws_reclaim_idwalk — P: the m1 link walk of a row’s literal spelling (path-identity spec §4.8)', () => {
  it.each(['/proc/self/cwd', '//proc/self/cwd', '///proc/self/cwd'])('P: a link to %s answers proc', (target) => {
    dir('elsewhere'); fs.symlinkSync(target, at('pl'));
    expect(walk([['P', 0, `${at('pl')}/elsewhere`]]).lines).toEqual(['P 0 proc', 'end 1']);
  });

  it('P: a link to /procx answers clean, never a prefix match', () => {
    fs.symlinkSync('/procx', at('px'));
    expect(walk([['P', 0, `${at('px')}/y`]]).lines).toEqual(['P 0 clean', 'end 1']);
  });

  it('P: a relative link whose walk enters /proc answers proc, by the position it forms', () => {
    dir('a/b'); dir('elsewhere');
    const depth = at('a/b').split('/').filter(Boolean).length;
    fs.symlinkSync(`${'../'.repeat(depth)}proc/self/cwd`, at('a/b/pl'));
    expect(walk([['P', 0, `${at('a/b/pl')}/elsewhere`]]).lines).toEqual(['P 0 proc', 'end 1']);
  });

  it('P: a plain chain of links answers clean', () => {
    dir('p2'); fs.symlinkSync(at('p2'), at('p1')); fs.symlinkSync('p1', at('p0'));
    expect(walk([['P', 0, `${at('p0')}/x`]]).lines).toEqual(['P 0 clean', 'end 1']);
  });

  it('P: a link loop answers un eloop', () => {
    fs.symlinkSync('loop', at('loop'));
    expect(walk([['P', 0, `${at('loop')}/x`]]).lines).toEqual(['P 0 un eloop', 'end 1']);
  });

  it('P: a .. in the literal spelling is resolved as cd -L resolves it, before the walk', () => {
    dir('far/away'); dir('elsewhere'); fs.symlinkSync(at('far/away'), at('a')); fs.symlinkSync('/proc/self/cwd', at('pl'));
    expect(walk([['P', 0, `${at('a')}/../pl/elsewhere`]]).lines, 'physically a/.. is far/, where no pl stands').toEqual(['P 0 proc', 'end 1']);
  });
});

describe.skipIf(!LINUX)('_ws_reclaim_idwalk — M: the mount table, read inside the bound (path-identity spec §4.5)', () => {
  const ask = (c: string): Walked => walk([['T', 0, c], ['M', 0, table()]], { mi: table() });

  it('M: the kernel’s own table, unaltered, answers clear and its line count', () => {
    const c = dir('c'); realMounts(h);
    expect(ask(c).lines).toEqual([expect.stringMatching(/^T 0 ok /), `M 0 clear ${tableLines().length}`, 'end 2']);
  });

  it('M: a mount point at or under the child answers hold point', () => {
    const c = dir('c'); realMounts(h); appendLine(MOUNT_LINE(`${c}/m`));
    expect(ask(c).lines[1]).toBe('M 0 hold point');
    realMounts(h); appendLine(MOUNT_LINE(c));
    expect(ask(c).lines[1], 'a mount at the child itself').toBe('M 0 hold point');
  });

  it('M: a mount of the child’s device whose root lies under the child answers hold root', () => {
    const c = dir('c'); realMounts(h);
    appendLine(ROOT_LINE(containing(c).f[2]!, `${devrelOf(c)}/sub`));
    expect(ask(c).lines[1]).toBe('M 0 hold root');
  });

  it('M: the same root ending //deleted answers hold deleted', () => {
    const c = dir('c'); realMounts(h);
    appendLine(ROOT_LINE(containing(c).f[2]!, `${devrelOf(c)}/sub//deleted`));
    expect(ask(c).lines[1]).toBe('M 0 hold deleted');
  });

  it('M: CONTROL, the same root on another device answers clear', () => {
    const c = dir('c'); realMounts(h);
    expect(containing(c).f[2], 'the CONTROL: the child is not on 0:98').not.toBe('0:98');
    appendLine(ROOT_LINE('0:98', `${devrelOf(c)}/sub`));
    expect(ask(c).lines[1]).toBe(`M 0 clear ${tableLines().length}`);
  });

  it('M: the containing line’s field 3 rewritten answers un devmismatch, never clear', () => {
    const c = dir('c'); realMounts(h);
    const { idx } = containing(c); const ls = tableLines(); const f = ls[idx]!.split(' ');
    expect(f[2], 'the CONTROL: the child is not on 0:999').not.toBe('0:999');
    f[2] = '0:999'; ls[idx] = f.join(' ');
    fs.writeFileSync(table(), `${ls.join('\n')}\n`);
    expect(ask(c).lines[1]).toBe('M 0 un devmismatch');
  });

  it('M: an empty table answers un empty', () => {
    const c = dir('c'); fs.writeFileSync(table(), '');
    expect(ask(c).lines[1]).toBe('M 0 un empty');
  });

  it('M: a line that is not a mount answers un malformed', () => {
    const c = dir('c'); realMounts(h); appendLine('not a mount line');
    expect(ask(c).lines[1]).toBe('M 0 un malformed');
  });

  it('M: a table that cannot be read answers un unreadable', () => {
    const c = dir('c'); const none = path.join(h.home, 'no-such-table');
    expect(walk([['T', 0, c], ['M', 0, none]], { mi: none }).lines[1]).toBe('M 0 un unreadable');
  });

  it('M: a request naming another table than mi answers un unreadable', () => {
    const c = dir('c'); realMounts(h);
    expect(walk([['T', 0, c], ['M', 0, path.join(h.home, 'other')]], { mi: table() }).lines[1]).toBe('M 0 un unreadable');
  });

  it('M: with no standing T 0 the table is not asked: un nochild', () => {
    realMounts(h);
    expect(walk([['T', 0, at('nope')], ['M', 0, table()]], { mi: table() }).lines)
      .toEqual(['T 0 gone', 'M 0 un nochild', 'end 2']);
  });

  it('M: a child spelled with a space is compared encoded, as the kernel writes it', () => {
    const c = dir('c d'); realMounts(h); appendLine(MOUNT_LINE(`${c}/m`));
    expect(ask(c).lines[1]).toBe('M 0 hold point');
  });
});

describe('_ws_reclaim_idwalk — B: birth times come from _plat_btime, inside the same bound, and un is never -', () => {
  it('B: the reply carries what _plat_btime answers, a stub included', () => {
    const c = dir('c');
    expect(walk([], { bt: [c], pre: '_plat_btime() { echo 1234; };' }).lines).toEqual(['B 0 1234', 'end 1']);
  });

  it('B: a _plat_btime that fails answers un, never -', () => {
    const c = dir('c');
    expect(walk([], { bt: [c], pre: '_plat_btime() { return 1; };' }).lines).toEqual(['B 0 un', 'end 1']);
  });

  it('B: a _plat_btime that prints a non-integer answers un', () => {
    const c = dir('c');
    expect(walk([], { bt: [c], pre: '_plat_btime() { echo x; };' }).lines).toEqual(['B 0 un', 'end 1']);
  });

  it('B: three paths with the middle one absent: each is asked alone, and only the absent one is un', () => {
    const c = dir('c'); const c2 = dir('c2');
    const n = (p: string): string => h.sh(`_plat_btime ${q(p)}`);
    expect(walk([], { bt: [c, at('nope'), c2] }).lines).toEqual([`B 0 ${n(c)}`, 'B 1 un', `B 2 ${n(c2)}`, 'end 3']);
  });

  it.skipIf(!LINUX)('B: one batch call when every path answers, one call per path when one does not', () => {
    const c = dir('c'); const c2 = dir('c2');
    const spy = '_plat_btime() { echo "$#" >> "$HOME/bt-calls"; stat -c %W "$@"; };';
    walk([], { bt: [c, c2], pre: spy });
    expect(linesAt('bt-calls'), 'one call, with both paths').toEqual(['2']);
    fs.rmSync(path.join(h.home, 'bt-calls'));
    walk([], { bt: [c, at('nope'), c2], pre: spy });
    expect(linesAt('bt-calls'), 'the batch, then each path alone').toEqual(['3', '1', '1', '1']);
  });
});

describe('_ws_reclaim_idwalk — one reply line per request, in request order, then the B lines, then end', () => {
  it.skipIf(!LINUX)('every kind in one walk: one line per request in request order, then the B lines, then end', () => {
    const c = dir('c'); dir('c/x'); fs.symlinkSync('/proc/self/cwd', at('pl')); realMounts(h);
    const r = walk([['P', 0, `${at('pl')}/y`], ['A', 0, `${c}/x`], ['M', 0, table()], ['T', 0, c], ['F', 0, at('gone')]],
      { mi: table(), bt: [c, `${c}/x`] });
    expect(r.rc).toBe('[rc=0]');
    expect(r.lines.map((l) => l.split(' ').slice(0, 2).join(' ')))
      .toEqual(['P 0', 'A 0', 'M 0', 'T 0', 'F 0', 'B 0', 'B 1', 'end 7']);
    expect(r.lines.slice(0, 5)).toEqual(['P 0 proc', `A 0 ok ${devino(`${c}/x`)} in:0`, `M 0 clear ${tableLines().length}`,
      `T 0 ok ${devino(c)} ${majmin(c)}`, 'F 0 gone']);
    expect(r.why).toBe('');
  });

  it('no request at all answers end 0', () => {
    const r = walk([]);
    expect([r.rc, r.lines, r.why]).toEqual(['[rc=0]', ['end 0'], '']);
  });

  it('a last request cut before its NUL: rc 2, a record without its end, and no answer for part of its path', () => {
    const c = dir('c');
    const whole = walk([['T', 0, c], ['T', 1, c]]);
    expect(whole.rc, 'the CONTROL: the same two records, each with its NUL, are answered').toBe('[rc=0]');
    const r = h.run(`_ws_reclaim_idwalk '' < <(printf '%s\\0%s' ${q(`T\t0\t${c}`)} ${q(`T\t1\t${c}`)});`
      + ' rc=$?; echo "[rc=$rc]"; printf \'%s\\n\' "$_WS_IDWALK_OUT"; echo "why=$_WS_IDWALK_WHY";');
    expect(r.code, `the CONTROL: the snippet ran to its answer: ${r.stdout} ${r.stderr}`).toBe(0);
    const w = parsed(r.stdout);
    expect([w.rc, w.lines, w.why]).toEqual(['[rc=2]', [], 'the identity walk\'s requests could not be read whole (a record without its end)']);
  });

  it.skipIf(!LINUX)('the reply never carries a path: every path planted holds ZZsecretZZ, and no reply line does', () => {
    const c = dir('ZZsecretZZc'); dir('ZZsecretZZc/x'); fs.symlinkSync('/proc/self/cwd', at('ZZsecretZZl'));
    realMounts(h); const mi = path.join(h.home, 'ZZsecretZZmi'); fs.copyFileSync(table(), mi);
    const r = walk([['T', 0, c], ['A', 0, `${c}/x`], ['P', 0, `${at('ZZsecretZZl')}/y`], ['F', 0, at('ZZsecretZZgone')],
      ['M', 0, mi]], { mi, bt: [c] });
    expect(r.rc).toBe('[rc=0]');
    expect(r.lines).toHaveLength(7);
    expect(r.raw).not.toContain('ZZsecretZZ');
    for (const l of r.lines) expect(l).toMatch(/^[\x20-\x7e]+$/);
  });

  it.skipIf(!LINUX)('the healthy wall time of one walk is far under WS_RECLAIM_WALK_S', () => {
    const c = dir('c'); dir('c/x'); realMounts(h);
    const reqs = [`T\t0\t${c}`, `A\t0\t${c}/x`, `P\t0\t${c}/x`, `M\t0\t${table()}`].map(q).join(' ');
    const ms = Number(h.sh(`a=$(_plat_epoch_ms); _ws_reclaim_idwalk ${q(table())} ${q(c)} < <(printf '%s\\0' ${reqs})`
      + ' || exit 9; b=$(_plat_epoch_ms); echo $(( b - a ))'));
    console.info(`idwalk: one healthy walk (T, A, P, M and one B) took ${ms} ms`);
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms, 'a healthy walk costs tens of milliseconds; the bound is 5 s').toBeLessThan(5000);
  });
});

describe.skipIf(!LINUX)('_ws_reclaim_idwalk — unmeasured, never "no row": the bound, a failed walk, a reply not read whole', () => {
  it('a FIFO table with no writer: rc 2, did not finish within 1s, inside the bound and its grace', () => {
    const c = dir('c'); const fifo = path.join(h.home, 'mi.fifo'); h.sh(`mkfifo ${q(fifo)}`);
    const r = grouped(`WS_RECLAIM_WALK_S=1; CCD_TIMEOUT_KILL_AFTER=3; a=$(_plat_epoch_ms); `
      + `${WALK([['T', 0, c], ['M', 0, fifo]], fifo)} b=$(_plat_epoch_ms); echo "ms=$(( b - a ))"`);
    expect(r.timedOut, 'the walk ended inside the group’s 20 s ceiling: the bound held').toBe(false);
    const out = r.out.split('\n'); const ms = Number((out.pop() ?? '').replace(/^ms=/, ''));
    const w = parsed(out.join('\n'));
    expect([w.rc, w.lines, w.why]).toEqual(['[rc=2]', [], 'the identity walk did not finish within 1s']);
    expect(ms, 'inside 1 s, plus the 3 s grace, plus 2 s').toBeLessThan((1 + 3 + 2) * 1000);
  }, 60_000);

  it.each([['on Linux', ''], ['forced Darwin', 'CCD_OS=darwin;']])('a python3 that sleeps 30 s, %s: rc 2, did not finish within 1s', (_os, pre) => {
    const c = dir('c'); const d = fakePython('slowpy', 'exec sleep 30');
    const r = grouped(`${pre} PATH=${q(d)}:"$PATH"; WS_RECLAIM_WALK_S=1; ${WALK([['T', 0, c]])}`);
    expect(r.timedOut).toBe(false);
    const w = parsed(r.out);
    expect([w.rc, w.why]).toEqual(['[rc=2]', 'the identity walk did not finish within 1s']);
  }, 60_000);

  it('a python3 that answers two of three requests: rc 2, the reply was not read whole', () => {
    const d = fakePython('shortpy', 'printf \'T 0 gone\\nT 1 gone\\n\'');
    const w = walk([['T', 0, at('a')], ['T', 1, at('b')], ['T', 2, at('c')]], { pre: `PATH=${q(d)}:"$PATH";` });
    expect([w.rc, w.lines, w.why]).toEqual(['[rc=2]', [], 'the identity walk\'s reply was not read whole']);
  });

  it('a python3 that answers one line too many: rc 2, the reply was not read whole', () => {
    const d = fakePython('longpy', 'printf \'T 0 gone\\nT 1 gone\\nT 2 gone\\n\'');
    const w = walk([['T', 0, at('a')], ['T', 1, at('b')]], { pre: `PATH=${q(d)}:"$PATH";` });
    expect([w.rc, w.lines, w.why]).toEqual(['[rc=2]', [], 'the identity walk\'s reply was not read whole']);
  });

  it('a python3 that answers out of order: rc 2, the reply was not read whole', () => {
    const d = fakePython('swappy', 'printf \'T 1 gone\\nT 0 gone\\n\'');
    const w = walk([['T', 0, at('a')], ['T', 1, at('b')]], { pre: `PATH=${q(d)}:"$PATH";` });
    expect([w.rc, w.lines, w.why]).toEqual(['[rc=2]', [], 'the identity walk\'s reply was not read whole']);
  });

  it('no python3 on PATH: rc 2, could not be measured (exit 127), and the earlier answer is cleared', () => {
    const c = dir('c'); const d = toolsDir('nopy', ['env', 'timeout', 'gtimeout', 'sleep', 'rm', 'stat']);
    const w = walk([['T', 0, c]], { pre: `_ws_reclaim_idwalk '' < <(printf '%s\\0' ${q(`T\t0\t${c}`)}); `
      + '[[ -n "$_WS_IDWALK_OUT" ]] || exit 9; '
      + `PATH=${q(d)}; ! command -v python3 >/dev/null 2>&1 || exit 91;` });
    expect([w.rc, w.lines, w.why]).toEqual(['[rc=2]', [], 'the identity walk could not be measured (exit 127)']);
  });

  it('the requests reach python under the pure-bash deadline arm, which gives its command /dev/null for stdin', () => {
    const c = dir('c'); const d = toolsDir('nodeadline', ['env', 'python3', 'sleep', 'rm']);
    const r = grouped(`PATH=${q(d)}; `
      + 'if command -v timeout >/dev/null 2>&1 || command -v gtimeout >/dev/null 2>&1; then echo "a deadline binary is reachable" >&2; exit 90; fi; '
      + WALK([['T', 0, c], ['A', 0, c]]), 'end');
    expect(r.timedOut).toBe(false);
    const w = parsed(r.out);
    expect([w.rc, w.lines]).toEqual(['[rc=0]', [`T 0 ok ${devino(c)} ${majmin(c)}`, `A 0 ok ${devino(c)} eq:0`, 'end 2']]);
  }, 60_000);

  it('a bash on PATH is never the walk’s interpreter: it runs the bash that runs ccd', () => {
    const c = dir('c'); const d = dir('bshim');
    fs.writeFileSync(path.join(d, 'bash'), '#!/bin/sh\necho called >> "$HOME/bash-called"\nexit 99\n', { mode: 0o755 });
    const w = walk([['T', 0, c]], { pre: `PATH=${q(d)}:"$PATH";` });
    expect([w.rc, w.lines]).toEqual(['[rc=0]', [`T 0 ok ${devino(c)} ${majmin(c)}`, 'end 1']]);
    expect(linesAt('bash-called'), 'the PATH bash never ran').toEqual([]);
  });
});

describe('_ws_path_ident — the one measure: dev:ino:btime, a decided not-a-tree, or unmeasured (path-identity spec §4.5)', () => {
  const ident = (p: string, o: { follow?: boolean; pre?: string } = {}): string =>
    h.run(`${o.pre ?? ''} _ws_path_ident ${q(p)}${o.follow ? ' follow' : ''}; rc=$?;`
      + ' echo "[rc=$rc] $_WS_IDENT|$_WS_IDENT_KIND|$_WS_IDENT_WHY"').stdout;
  /** What the real helpers make of `p`: its dev:ino, and its birth time or `-`. */
  const expected = (p: string): string => {
    const b = h.sh(`_plat_btime ${q(p)}`);
    return `${devino(p)}:${/^[1-9][0-9]*$/.test(b) ? b : '-'}`;
  };

  it('a directory: rc 0 with its dev:ino and birth time, printing nothing', () => {
    const c = dir('c');
    expect(ident(c)).toBe(`[rc=0] ${expected(c)}||`);
    expect(h.sh(`_ws_path_ident ${q(c)}`), 'it prints nothing').toBe('');
  });

  it('a link at the leaf: rc 1 link, never followed by default', () => {
    const c = dir('c'); fs.symlinkSync(c, at('lnk'));
    expect(ident(at('lnk'))).toBe('[rc=1] |link|');
  });

  it('with follow, a link is resolved first and answers the directory it names', () => {
    const c = dir('c'); fs.symlinkSync(c, at('lnk'));
    expect(ident(at('lnk'), { follow: true })).toBe(`[rc=0] ${expected(c)}||`);
  });

  it('a file: rc 1 notdir', () => {
    fs.writeFileSync(at('f'), 'x');
    expect(ident(at('f'))).toBe('[rc=1] |notdir|');
  });

  it('a PROVEN absence: rc 1 absent', () => {
    expect(ident(at('nope'))).toBe('[rc=1] |absent|');
  });

  it.skipIf(ROOT_USER)('an absence that cannot be proven, under a parent of mode 000: rc 2, never absent', () => {
    dir('locked/c'); fs.chmodSync(at('locked'), 0o000);
    try {
      expect(ident(at('locked/c'))).toMatch(/^\[rc=2\] \|\|whether .+ stands could not be proven \(.+cannot be searched/);
    } finally { fs.chmodSync(at('locked'), 0o755); }
  });

  it('a birth time of 0 reads -', () => {
    const c = dir('c');
    expect(ident(c, { pre: '_plat_btime() { echo 0; };' })).toBe(`[rc=0] ${devino(c)}:-||`);
  });

  it('a _plat_btime that fails: rc 2, never -', () => {
    const c = dir('c');
    expect(ident(c, { pre: '_plat_btime() { return 1; };' }))
      .toMatch(/^\[rc=2\] \|\|the birth time of .+ could not be read, so its identity was never read$/);
  });

  it('a _plat_devino that answers malformed: rc 2', () => {
    const c = dir('c');
    expect(ident(c, { pre: '_plat_devino() { echo x; };' }))
      .toMatch(/^\[rc=2\] \|\|.+ answered a device and inode, or a birth time, that is not a number, so its identity was never read$/);
  });

  it('a spelling that is not plain: rc 2', () => {
    dir('c');
    expect(ident(`${at('c')}/.`)).toMatch(/^\[rc=2\] \|\|.+\/c\/\. is not one plain absolute path, so its identity was never read$/);
  });

  it('the three globals are cleared at every call', () => {
    const c = dir('c');
    expect(h.sh(`_ws_path_ident ${q(c)}; _ws_path_ident ${q(at('nope'))}; echo "[$_WS_IDENT|$_WS_IDENT_KIND|$_WS_IDENT_WHY]"`))
      .toBe('[|absent|]');
  });

  it('forced Darwin with DARWIN_IDENT_SHIMS: rc 0', () => {
    const c = dir('c');
    expect(ident(c, { pre: `CCD_OS=darwin; ${DARWIN_IDENT_SHIMS}` })).toBe(`[rc=0] ${expected(c)}||`);
  });

  it.skipIf(DARWIN_HOST)('CONTROL: forced Darwin with no shims on a Linux host: rc 2, the reason the shims exist', () => {
    const c = dir('c');
    expect(ident(c, { pre: 'CCD_OS=darwin;' })).toMatch(/^\[rc=2\] \|\|/);
  });
});

describe('_ws_ident_eq and _ws_ident_compose: one match rule, one format (path-identity spec §4.5)', () => {
  it.each([
    ['1:2:3', '1:2:3', 0], ['1:2:3', '1:2:-', 0], ['1:2:-', '1:2:-', 0], ['1:2:3', '1:2:4', 1], ['1:2:3', '1:3:3', 1],
    ['1:2', '1:2:3', 2], ['x', '1:2:3', 2], ['1:2:3', '1:2:0', 2],
  ] as const)('_ws_ident_eq %s %s answers %i', (a, b, rc) => {
    expect(h.sh(`_ws_ident_eq ${q(a)} ${q(b)}; echo $?`)).toBe(String(rc));
  });

  it.each([
    ['1:2', '0', '1:2:-', 0], ['1:2', '-1', '1:2:-', 0], ['1:2', '9', '1:2:9', 0], ['1:2', '009', '1:2:9', 0],
    ['1:x', '9', '', 2], ['1:2', '?', '', 2], ['1:2', '-', '', 2],
  ] as const)('_ws_ident_compose %s %s prints %s', (di, bt, out, rc) => {
    expect(h.sh(`_ws_ident_compose ${q(di)} ${q(bt)}; echo "|$?"`)).toBe(`${out}|${rc}`);
  });
});

describe('the walk and the identity helpers, by their source', () => {
  it('the walk is ONE bounded exec of "$BASH" -c with its stdin /dev/null, never a bash found on PATH', () => {
    const code = codeOf('_ws_reclaim_idwalk');
    expect(code.split('_plat_timeout "$WS_RECLAIM_WALK_S" "$BASH" -c ').length - 1, 'one bounded exec').toBe(1);
    expect(code.split('_plat_timeout').length - 1, 'and no other').toBe(1);
    expect(code, 'never a bash resolved from PATH').not.toMatch(/\bbash -c\b/);
    expect(code, 'its stdin is /dev/null: the requests ride its arguments').toContain('"${req[@]}" </dev/null 2>/dev/null); rc=$?');
    expect(code.split('python3 -I -c').length - 1, 'python3, isolated, once').toBe(1);
  });

  it('WS_RECLAIM_WALK_S is defined once, at 5 s', () => {
    expect([...ccdSource().matchAll(/^WS_RECLAIM_WALK_S=(\d+)\b/gm)].map((m) => m[1])).toEqual(['5']);
  });

  it('the walk reads only the table its caller names: no /proc/self/mountinfo, no _ws_collect_mountinfo', () => {
    const code = codeOf('_ws_reclaim_idwalk');
    expect(code).not.toContain('/proc/self/mountinfo');
    expect(code).not.toContain('_ws_collect_mountinfo');
  });

  it('no identity helper reuses _ws_collect_ident, and none spells stat -c or stat -f', () => {
    for (const f of ['_ws_ident_compose', '_ws_ident_eq', '_ws_path_ident', '_ws_reclaim_idwalk']) {
      expect(codeOf(f), f).not.toContain('_ws_collect_ident');
      expect(codeOf(f), f).not.toMatch(/\bstat\s+-[cf]\b/);
    }
  });
});

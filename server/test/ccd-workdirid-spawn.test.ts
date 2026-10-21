// server/test/ccd-workdirid-spawn.test.ts
//
// path-identity W3, Task 5 (path-identity spec §4.3; R2, R7, R8): every spawn records where its pane entered. Before each
// `_tmux_new_session` in `_spawn_start`, the primary launch and its `--session-id` retry, the parent marks
// `$REG/<id>.workdirid` `pending` (`_spawn_workdirid_pending`), and the pane replaces that mark after its `cd` and before
// its `exec`, through the fragment `_plat_workdirid_pane` composes. A pane that cannot record where it entered leaves
// `pending`, a hold, and never the field an earlier pane of the row wrote. A pending write that fails unlinks the field,
// so the row reads `legacy-absent`, today's rule, and never a stale valid field.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). No tmux server is started or attached: `PANE_EXEC` is a bash `tmux()` stub that
// EXECUTES the pane command under the named shell inside the snippet, and the wrapper the pane execs is a fake that
// records `pwd -P`. A failure inside the pane is planted on the pane's PATH (a `stat` that exits 1, or a `mv` that kills the writer), because the pane's
// `/bin/sh` sees PATH, never a shell function. No case reaches a process-table walk: `PROC_SPY` records any, and every
// spawn asserts there was none, so this file joins no load-flake list. The spawn and parity cases run on Linux; the
// writer's rows, the fragment's CONTROLs and the source pins run on both platforms.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { CCD_FUNCTION_DEF, ccdCallGraph, ccdFunctionDefinitions } from './consolidationCensus.js';
import { DEFAULT_TEST_ROSTER } from './helpers/roster.js';
import { PANE_EXEC, paneFragment } from './worktreeIdentityFixture.js';

const LINUX = process.platform === 'linux';
const SRC = fs.readFileSync(CCD, 'utf8');
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const ID = 'demo-quiet-mesa';
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-workdirid-spawn-'); });
afterEach(() => { h.cleanup(); });

const at = (...p: string[]): string => path.join(h.home, ...p);
const reg = (name: string): string => at('.cc-sessions', name);
const real = (p: string): string => fs.realpathSync(p);
const linesOf = (name: string): string[] =>
  (fs.existsSync(at(name)) ? fs.readFileSync(at(name), 'utf8').split('\n').filter(Boolean) : []);
/** The grammar's pending form for `logical`, the line alone, with no trailing newline. */
const PENDING = (logical: string): RegExp => new RegExp(`^v1\\tpending\\t\\d{13}\\t-\\t${esc(logical)}$`);

/** The row `_spawn_start` reads: its wrapper, its `.workdir` (the logical spelling, byte for byte) and its uuid. */
const seed = (id: string, workdir: string, wrapper = 'claude'): void => {
  h.sh(`_reg_set ${id} wrapper ${wrapper}; _reg_set ${id} workdir '${workdir}'; _reg_set ${id} uuid ${UUID}`);
};
/** The wrapper the pane execs: it appends the directory it runs in (`pwd -P`) to `$HOME/wrapper-ran`, and exits. */
const fakeWrapper = (wrapper = 'claude'): void => {
  fs.writeFileSync(at('.local', 'bin', wrapper), `#!/bin/sh\npwd -P >> '${at('wrapper-ran')}'\n`, { mode: 0o755 });
};
/** A `stat` that records its call and fails, and the `PANE_PRE` text that puts it first on the pane's PATH only. */
const failingStat = (): string => {
  fs.mkdirSync(at('failbin'), { recursive: true });
  fs.writeFileSync(at('failbin', 'stat'), `#!/bin/sh\necho called >> '${at('stat-shim-ran')}'\nexit 1\n`, { mode: 0o755 });
  return 'PATH="$HOME/failbin:$PATH"; export PATH';
};
/** A `mv` that records its call and kills the shell that ran it, the pane's writer (`kill -9 "$PPID"`), and the
 *  `PANE_PRE` text that puts it first on the pane's PATH only: the writer dies by a signal before its rename (R56). */
const killingMv = (): string => {
  fs.mkdirSync(at('killbin'), { recursive: true });
  fs.writeFileSync(at('killbin', 'mv'), `#!/bin/sh\necho called >> '${at('mv-shim-ran')}'\nkill -9 "$PPID"\nexit 1\n`, { mode: 0o755 });
  return 'PATH="$HOME/killbin:$PATH"; export PATH';
};
/** The one reader's answer (Task 4): `[rc=<n>] <state>|<identity>|<physical>|<why>`. */
const field = (id: string, logical: string): string =>
  h.sh(`_ws_workdirid_read ${id} '${logical}'; echo "[rc=$?] $_WS_WDID_STATE|$_WS_WDID_IDENT|$_WS_WDID_PHYS|$_WS_WDID_WHY"`);
/** `_ws_path_ident`'s identity of a standing directory (Task 2): `<dev>:<ino>:<btime|->`. */
const ident = (p: string): string => {
  const out = h.sh(`_ws_path_ident '${p}'; echo "[rc=$?] $_WS_IDENT"`);
  expect(out, `the CONTROL: ${p} was measured`).toMatch(/^\[rc=0\] \d+:\d+:([1-9]\d*|-)$/);
  return out.slice('[rc=0] '.length);
};
/** A valid field, written by the statement `cmd_start`'s seed runs (Task 4), from inside `wd`. */
const seedValid = (id: string, wd: string): void => {
  h.sh(`( CDPATH= builtin cd -- '${wd}' >/dev/null 2>&1 && eval "$(_plat_workdirid_pane "$REG" ${id} '${wd}'):" ) || :`);
  expect(field(id, wd), 'the CONTROL: the seed wrote a valid field').toMatch(/^\[rc=0\] valid\|/);
};
/** Any process-table walk, recorded: a spawn makes none. */
const PROC_SPY = '_ws_path_users_proc_root() { echo walk >> "$HOME/proc-walks"; printf %s /proc; }; '
  + '_ws_expire_proc_root() { echo walk >> "$HOME/proc-walks"; printf %s /proc; };';
/** `_spawn_start <id> <mode>` over `PANE_EXEC(shell)`, after `vars` (the snippet's own assignments: `PANE_PRE`,
 *  `PANE_POST`, `PANE_UP`). The answer is the snippet's stdout, which holds only the echo it adds: `_spawn_start`
 *  prints nothing, its stderr goes to `$HOME/spawn-err`, and the pane's output to `$HOME/pane-out`. */
const spawnPane = (mode: 'new' | 'resume', vars = '', shell = 'bash', id = ID): string => {
  const out = h.sh(`${PANE_EXEC(shell)} ${PROC_SPY} ${vars} _spawn_start ${id} ${mode} 2>>"$HOME/spawn-err"; echo "[$SPAWN_FROMSWAP]"`);
  expect(fs.existsSync(at('proc-walks')), 'a spawn walks no process table').toBe(false);
  return out;
};
const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));
const composed = (line: string): string => {
  const m = /^tmux new-session -d -s \S+ -x \d+ -y \d+ (.*)$/.exec(line);
  expect(m, line).not.toBeNull();
  return m![1]!;
};

describe('_spawn_workdirid_pending: the parent’s pending line (path-identity spec §4.3; R2)', () => {
  const W = (): string => at('W');
  beforeEach(() => {
    fs.mkdirSync(W());
    h.sh(`_reg_set demo-x uuid ${UUID}; _reg_set demo-x workdir '${W()}'`);
  });
  const names = (): string[] => fs.readdirSync(at('.cc-sessions')).sort();
  const temps = (): string[] => names().filter((n) => n.startsWith('.demo-x.workdirid.'));
  /** The writer's rc. Its stderr goes to `$HOME/pending-err`, so a row can assert that it printed nothing. */
  const write = (pre = ''): string =>
    h.sh(`${pre} _spawn_workdirid_pending demo-x '${W()}' 2>"$HOME/pending-err"; echo "[rc=$?]"`);
  const err = (): string => fs.readFileSync(at('pending-err'), 'utf8');

  it('writes the pending line and nothing else: rc 0, the reader says pending, no temp is left, every other name unchanged', () => {
    const before = names();
    const uuid = fs.readFileSync(reg('demo-x.uuid'), 'utf8');
    expect(write()).toBe('[rc=0]');
    expect(err(), 'it prints nothing').toBe('');
    expect(fs.readFileSync(reg('demo-x.workdirid'), 'utf8'), 'the grammar’s pending form, the line alone')
      .toMatch(PENDING(W()));
    expect(field('demo-x', W())).toMatch(/^\[rc=2\] pending\|/);
    expect(temps()).toEqual([]);
    expect(names()).toEqual([...before, 'demo-x.workdirid'].sort());
    expect(fs.readFileSync(reg('demo-x.uuid'), 'utf8')).toBe(uuid);
  });

  it('a temp it cannot write, a VALID field standing: rc 1, the field unlinked (legacy-absent, never the stale valid one), nothing printed', () => {
    seedValid('demo-x', W());
    expect(write('mkdir -- "$REG/.demo-x.workdirid.$BASHPID.tmp";')).toBe('[rc=1]');
    expect(err(), 'it prints nothing').toBe('');
    expect(fs.existsSync(reg('demo-x.workdirid'))).toBe(false);
    expect(field('demo-x', W())).toMatch(/^\[rc=1\] legacy-absent\|/);
    expect(temps().map((n) => fs.statSync(reg(n)).isDirectory()), 'the planted directory stands, and only it')
      .toEqual([true]);
  });

  it('a directory at the field name: rc 2, it stands untouched, the reader says unmeasured, no temp is left, nothing printed', () => {
    fs.mkdirSync(reg('demo-x.workdirid'));
    fs.writeFileSync(reg('demo-x.workdirid/inside'), 'kept');
    expect(write()).toBe('[rc=2]');
    expect(err(), 'it prints nothing').toBe('');
    expect(fs.readFileSync(reg('demo-x.workdirid/inside'), 'utf8')).toBe('kept');
    expect(field('demo-x', W())).toMatch(/^\[rc=2\] unmeasured\|/);
    expect(temps()).toEqual([]);
  });

  it.each([
    ['this host’s arm', ''],
    ['the Darwin arm, forced', 'CCD_OS=darwin;'],
  ] as const)('a link at the field name is replaced by the pending line and never followed (%s)', (_arm, pre) => {
    const elsewhere = at('elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, 'inside'), 'kept');
    fs.symlinkSync(elsewhere, reg('demo-x.workdirid'));
    expect(write(pre)).toBe('[rc=0]');
    expect(err(), 'it prints nothing').toBe('');
    expect(fs.lstatSync(reg('demo-x.workdirid')).isFile(), 'the link was replaced by a file').toBe(true);
    expect(field('demo-x', W())).toMatch(/^\[rc=2\] pending\|/);
    expect(fs.readdirSync(elsewhere), 'what the link named is untouched').toEqual(['inside']);
    expect(temps()).toEqual([]);
  });
});

describe.skipIf(!LINUX)('every spawn records where its pane entered (path-identity spec §4.3; R2, R7)', () => {
  beforeEach(() => {
    fs.mkdirSync(at('A'));
    fs.mkdirSync(at('B'));
    fs.symlinkSync(at('A'), at('alias'));
    fakeWrapper();
    seed(ID, at('alias'));
  });

  it('the primary pane records the directory it reached after its cd, the alias re-pointed after the parent read it', () => {
    expect(ident(at('A')), 'the CONTROL: A and B are two directories').not.toBe(ident(at('B')));
    const out = spawnPane('new',
      `PANE_PRE='cp -- "$REG/${ID}.workdirid" "$HOME/field-at-pane-1"; ln -sfn "$HOME/B" "$HOME/alias"';`);
    expect(out).toBe('[0]');
    expect(newSessions()).toHaveLength(1);
    expect(composed(newSessions()[0]!), 'the command string carries the fragment between the cd and the exec')
      .toContain(`cd '${at('alias')}' && ${paneFragment(h, ID, at('alias'))}true; cd '${at('alias')}' && exec env `);
    expect(fs.readFileSync(at('field-at-pane-1'), 'utf8'), 'the parent wrote pending before the pane ran')
      .toMatch(PENDING(at('alias')));
    expect(field(ID, at('alias'))).toBe(`[rc=0] valid|${ident(at('B'))}|${real(at('B'))}|`);
    expect(linesOf('wrapper-ran'), 'the pane exec’d its wrapper in B').toEqual([real(at('B'))]);
  }, 60_000);

  it('the retry pane records its own entry: the first pane ran in A and died, the retry entered B', () => {
    const out = spawnPane('resume', `PANE_UP='*--session-id*'; `
      + `PANE_POST='if (( PANE_N == 1 )); then cp -- "$REG/${ID}.workdirid" "$HOME/field-after-pane-1"; fi'; `
      + `PANE_PRE='if (( PANE_N == 2 )); then cp -- "$REG/${ID}.workdirid" "$HOME/field-at-pane-2"; ln -sfn "$HOME/B" "$HOME/alias"; fi';`);
    expect(out).toBe('[0]');
    const news = newSessions();
    expect(news, 'the CONTROL: the --resume pane died and the --session-id retry ran').toHaveLength(2);
    expect(news[1]).toContain('--session-id');
    expect(fs.readFileSync(at('field-after-pane-1'), 'utf8'), 'the first pane recorded A')
      .toContain(`\t${real(at('A'))}\t`);
    expect(fs.readFileSync(at('field-at-pane-2'), 'utf8'), 'the retry’s pending replaced it before the retry pane ran')
      .toMatch(PENDING(at('alias')));
    expect(field(ID, at('alias'))).toBe(`[rc=0] valid|${ident(at('B'))}|${real(at('B'))}|`);
    expect(linesOf('wrapper-ran')).toEqual([real(at('A')), real(at('B'))]);
  }, 60_000);

  it('a pane whose stat fails leaves pending, a hold, and the spawn still execs its wrapper', () => {
    expect(spawnPane('new', `PANE_PRE='${failingStat()}';`)).toBe('[0]');
    expect(fs.existsSync(at('stat-shim-ran')), 'the CONTROL: the pane reached the failing stat').toBe(true);
    expect(field(ID, at('alias'))).toMatch(/^\[rc=2\] pending\|/);
    expect(linesOf('wrapper-ran')).toEqual([real(at('A'))]);
  }, 60_000);

  it('a writer killed before its rename leaves the exec to run (R56): the wrapper runs, and the field reads pending', () => {
    expect(spawnPane('new', `PANE_PRE='${killingMv()}';`)).toBe('[0]');
    expect(fs.existsSync(at('mv-shim-ran')), 'the CONTROL: the pane’s writer reached the killing mv').toBe(true);
    expect(linesOf('wrapper-ran'), 'the second cd and the exec ran').toEqual([real(at('A'))]);
    expect(field(ID, at('alias'))).toMatch(/^\[rc=2\] pending\|/);
  }, 60_000);

  it('an earlier VALID field never survives: the spawn’s pending replaces it, and a pane whose stat fails leaves pending (R2)', () => {
    seedValid(ID, at('alias'));
    expect(spawnPane('new', `PANE_PRE='${failingStat()}';`)).toBe('[0]');
    expect(fs.existsSync(at('stat-shim-ran')), 'the CONTROL: the pane reached the failing stat').toBe(true);
    expect(field(ID, at('alias'))).toMatch(/^\[rc=2\] pending\|/);
  }, 60_000);

  it('the retry too: the first pane wrote a valid A, the retry’s pane stat fails, and the field reads pending', () => {
    const fail = failingStat();
    expect(spawnPane('resume', `PANE_UP='*--session-id*'; `
      + `PANE_POST='if (( PANE_N == 1 )); then cp -- "$REG/${ID}.workdirid" "$HOME/field-after-pane-1"; fi'; `
      + `PANE_PRE='if (( PANE_N == 2 )); then ${fail}; fi';`)).toBe('[0]');
    expect(newSessions()).toHaveLength(2);
    expect(fs.readFileSync(at('field-after-pane-1'), 'utf8'), 'the CONTROL: the first pane wrote a valid A')
      .toContain(`\t${real(at('A'))}\t`);
    expect(fs.existsSync(at('stat-shim-ran')), 'the CONTROL: the retry’s pane reached the failing stat').toBe(true);
    expect(field(ID, at('alias'))).toMatch(/^\[rc=2\] pending\|/);
    expect(linesOf('wrapper-ran')).toEqual([real(at('A')), real(at('A'))]);
  }, 60_000);

  it('a pane whose cd fails execs nothing, and the field reads pending', () => {
    fs.mkdirSync(at('W'));
    seed(ID, at('W'));
    expect(spawnPane('new', `PANE_PRE='rmdir -- "$HOME/W"';`)).toBe('[0]');
    expect(fs.existsSync(at('W')), 'the CONTROL: the workdir was gone when the pane ran').toBe(false);
    expect(fs.existsSync(at('wrapper-ran')), 'no wrapper ran').toBe(false);
    expect(field(ID, at('W'))).toMatch(/^\[rc=2\] pending\|/);
  }, 60_000);

  it('a pending write that fails unlinks the field: with the pane’s write failing too the row reads legacy-absent, never the stale valid field', () => {
    seedValid(ID, at('alias'));
    expect(spawnPane('new', `mkdir -- "$REG/.${ID}.workdirid.$BASHPID.tmp"; PANE_PRE='${failingStat()}';`)).toBe('[0]');
    expect(fs.existsSync(at('stat-shim-ran')), 'the CONTROL: the pane reached the failing stat').toBe(true);
    expect(field(ID, at('alias'))).toMatch(/^\[rc=1\] legacy-absent\|/);
    expect(linesOf('wrapper-ran')).toEqual([real(at('A'))]);
  }, 60_000);

  it('a workdir spelled with a backslash (R54): the fragment carries it, the wrapper runs there, and the pane records it valid', () => {
    const wd = at('back\\slash');
    fs.mkdirSync(wd);
    seed(ID, wd);
    expect(paneFragment(h, ID, wd), 'the CONTROL: the composer carries a backslash, which .workdir accepts (R54)').not.toBe('');
    expect(spawnPane('new')).toBe('[0]');
    const [cmd] = newSessions().map(composed);
    expect(cmd, 'the command string carries the fragment')
      .toContain(`cd '${wd}' && ${paneFragment(h, ID, wd)}true; cd '${wd}' && exec env `);
    expect(linesOf('wrapper-ran')).toEqual([real(wd)]);
    expect(field(ID, wd), 'never a pending that a restart cannot clear (R54)').toBe(`[rc=0] valid|${ident(wd)}|${real(wd)}|`);
  }, 60_000);

  it('the composed primary command stays under 4096 bytes at the id cap and at a 222-byte id, and the pane still records', () => {
    const cap = Number(/^_REG_ID_MAX=(\d+)$/m.exec(SRC)?.[1]);
    expect(Number.isInteger(cap) && cap > 5, 'the CONTROL: ccd defines _REG_ID_MAX').toBe(true);
    const wrapper = DEFAULT_TEST_ROSTER.accounts.filter((a) => a.homeAble).map((a) => a.id)
      .reduce((a, b) => (b.length > a.length ? b : a));
    const id = `demo-${'x'.repeat(cap - 5)}`;
    fakeWrapper(wrapper);
    seed(id, at('A'), wrapper);
    expect(spawnPane('new', '', 'bash', id)).toBe('[0]');
    const [cmd] = newSessions().map(composed);
    const n = Buffer.byteLength(cmd!);
    const k = cmd!.split(id).length - 1;
    const at222 = n + (222 - cap) * k;
    console.log(`composed primary command: ${n} bytes at a ${cap}-byte id (the id ${k} time(s)); ${at222} bytes at a 222-byte id`);
    expect(cmd).toContain(paneFragment(h, id, at('A')));
    expect(k, 'the fragment names the id').toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(4096);
    expect(at222).toBeLessThanOrEqual(4096);
    expect(paneFragment(h, `demo-${'x'.repeat(217)}`, at('A')), 'the composer quotes a 222-byte id too').not.toBe('');
    expect(field(id, at('A'))).toMatch(/^\[rc=0\] valid\|/);
  }, 60_000);
});

describe.skipIf(!LINUX)('every writer’s line parses as the state it means (P3)', () => {
  /** One of the two seed statements, read from ccd's own source: the `( CDPATH= builtin cd -- … ) || :` group on the
   *  one line that holds `needle`. */
  const seedStatement = (needle: string): string => {
    const ls = SRC.split('\n').filter((l) => l.includes(needle));
    expect(ls, `the CONTROL: one line of ccd holds ${needle}`).toHaveLength(1);
    const from = ls[0]!.indexOf('( CDPATH= builtin cd -- ');
    const to = ls[0]!.indexOf(') || :', from);
    expect(from >= 0 && to > from, ls[0]).toBe(true);
    return ls[0]!.slice(from, to + ') || :'.length);
  };

  it('the pending writer: pending; the pane under sh: valid; the start and ws-add seeds, as ccd spells them: valid', () => {
    fs.mkdirSync(at('W'));
    h.sh(`_spawn_workdirid_pending demo-p '${at('W')}'`);
    expect(field('demo-p', at('W'))).toMatch(/^\[rc=2\] pending\|/);
    h.sh(`id=demo-s; workdir='${at('W')}'; ${seedStatement('eval "$(_plat_workdirid_pane "$REG" "$id" "$workdir"):"')}`);
    expect(field('demo-s', at('W'))).toMatch(/^\[rc=0\] valid\|/);
    h.sh(`id=demo-a; wt='${at('W')}'; ${seedStatement('eval "$(_plat_workdirid_pane "$REG" "$id" "$wt"):"')}`);
    expect(field('demo-a', at('W'))).toMatch(/^\[rc=0\] valid\|/);
    fakeWrapper();
    seed('demo-n', at('W'));
    expect(spawnPane('new', '', 'sh', 'demo-n')).toBe('[0]');
    expect(field('demo-n', at('W'))).toMatch(/^\[rc=0\] valid\|/);
    expect(linesOf('wrapper-ran')).toEqual([real(at('W'))]);
  }, 60_000);
});

describe('the fragment the launch statements splice (Task 4’s composer; CONTROLs, green before and after the edit)', () => {
  it('is one line from /bin/sh -c to a trailing "&& ", naming REG, the id and the workdir, with no exec env and no TMPDIR in it', () => {
    const f = paneFragment(h, ID, at('A'));
    expect(f.startsWith("/bin/sh -c '"), f).toBe(true);
    expect(f.endsWith(' 2>/dev/null && '), f).toBe(true);
    expect(f).toContain(` ccd-workdirid '${at('.cc-sessions')}' '${ID}' '${at('A')}' 2>/dev/null && `);
    expect(f, 'one line: the spawn suites read their command log line by line').not.toContain('\n');
    expect(f, 'ccd-child-tmpdir reads the first "exec env " as the command’s own').not.toContain('exec env ');
    expect(f, 'ccd-child-tmpdir counts TMPDIR exactly once').not.toContain('TMPDIR=');
  });

  it('is empty only for an argument it will not quote (a / in the id; a control character or a quote, both refused by .workdir), and carries a backslash (R54, R60)', () => {
    expect(paneFragment(h, 'demo/x', at('A')), 'a / in the id').toBe('');
    expect(paneFragment(h, ID, at('tab\there')), 'a control character, which .workdir refuses too').toBe('');
    expect(h.sh(`printf '[%s]' "$(_plat_workdirid_pane "$REG" '${ID}' "$HOME/it's")"`), 'a quote, which .workdir refuses too (R60)').toBe('[]');
    expect(paneFragment(h, ID, at('back\\slash')), 'a backslash, which .workdir accepts').not.toBe('');
  });
});

describe('R7’s two launch statements, by content (C3, R47)', () => {
  const body = ((): string[] => {
    const s = SRC.indexOf('\n_spawn_start() {');
    return SRC.slice(s + 1, SRC.indexOf('\n}\n', s)).split('\n');
  })();
  const PENDING_LINE = '_spawn_workdirid_pending "$id" "$workdir" || :';
  const pendingAt = (): number[] => body.flatMap((l, i) => (l.trim() === PENDING_LINE ? [i] : []));
  const indent = (l: string): number => l.length - l.trimStart().length;

  it('exactly two pending lines, each directly above a _tmux_new_session line at its own indent', () => {
    const pos = pendingAt();
    expect(pos).toHaveLength(2);
    for (const i of pos) {
      expect(body[i + 1]!.trim().startsWith('_tmux_new_session -d -s "$tname" '), body[i + 1]).toBe(true);
      expect(indent(body[i + 1]!)).toBe(indent(body[i]!));
    }
    expect(body.filter((l) => !/^\s*#/.test(l) && l.includes('_tmux_new_session -d -s "$tname"'))).toHaveLength(2);
  });

  it('exactly two command strings carry the fragment between the cd and a second cd, so the writer never gates the exec (R56)', () => {
    const text = body.join('\n');
    expect(text.split(`cd '$workdir' && $(_plat_workdirid_pane "$REG" "$id" "$workdir")true; cd '$workdir' && exec env \${genenv}COLORTERM=truecolor `)
      .length - 1).toBe(2);
    expect(text, 'no command string is left without the fragment').not.toContain(`"cd '$workdir' && exec env`);
  });

  it('the generation lock is released before each pending line', () => {
    const [first, second] = pendingAt();
    const line = (s: string): number => body.findIndex((l) => l.includes(s));
    const primary = line('_compact_lock_release "$genfd"; genfd=""');
    const retry = line('_compact_lock_release "$rgenfd"; rgenfd=""');
    expect(primary).toBeGreaterThan(-1);
    expect(primary).toBeLessThan(first!);
    expect(retry).toBeGreaterThan(first!);
    expect(retry).toBeLessThan(second!);
  });

  it('the pending writer is defined directly after _spawn, called only from _spawn_start, and calls only K', () => {
    const names = ccdFunctionDefinitions().map((s) => CCD_FUNCTION_DEF.exec(s.text)![1]!);
    expect(names[names.indexOf('_spawn') + 1]).toBe('_spawn_workdirid_pending');
    const graph = ccdCallGraph();
    expect(graph.filter((e) => e.callee === '_spawn_workdirid_pending').map((e) => e.caller)).toEqual(['_spawn_start']);
    expect(graph.filter((e) => e.caller === '_spawn_workdirid_pending').map((e) => e.callee).sort())
      .toEqual(['_plat_epoch_ms', '_plat_mv_notdir']);
  });
});

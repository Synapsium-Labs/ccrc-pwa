// path-identity W3, Task 4 (path-identity spec §4.3 and §4.4; PI1 B, PI2 L1): each session's entry identity has ONE
// field, `$REG/<id>.workdirid`, in ONE grammar held by ONE reader's regex (`_ws_workdirid_read`), and every VALID line
// is written by ONE composer, the platform block's `_plat_workdirid_pane`. The composer prints a brace-free
// `/bin/sh -c` fragment: the pane runs it after its `cd` and before its `exec`, and `start` and `ws-add` run it once to
// seed the row. The reader's answers are never folded: valid (0); legacy-absent, legacy-link, legacy-unparseable and
// legacy-stale (1); pending and unmeasured (2). The pending line's writer is the spawn's (the next task); here it is
// read by its grammar only.
// FIXTURE HOME ONLY (`makePrHarness`): every field, workdir, link, shim and wrapper lives under the harness's HOME,
// and ccd runs as sourced functions. No tmux server is started: ccd composes the pane's command, and the shell under
// test runs it from inside a harness snippet. Nothing here walks a process table.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, WS_ADD, ccdSource } from './ccdWsHelpers.js';
import { CCD_FUNCTION_DEF, bashCodeOf, ccdCallGraph, ccdFunctionDefinitions } from './consolidationCensus.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { writeField } from './worktreeIdentityFixture.js';

const CCRC = path.join(path.dirname(CCD), 'ccrc');
const ID = 'demo-x';
const T = '\t';
const AT = '1760000000000';
const ROOT_USER = process.getuid?.() === 0;
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The first executable `name` on the suite's own PATH, or '' (read from the file system: no shell is spawned). */
const onPath = (name: string): string => (process.env['PATH'] ?? '').split(':').filter(Boolean)
  .map((d) => path.join(d, name))
  .find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } }) ?? '';
/** The host's own tools, which a shim stands in front of. */
const REAL = { stat: onPath('stat'), mv: onPath('mv'), date: onPath('date') };
/** The host stat's device-and-inode format, for a shim that prints a birth time of its own. */
const DEVINO = process.platform === 'darwin' ? '-f %d:%i' : '-c %d:%i';

/** The functions whose CODE may spell `.workdirid` (the next task adds the spawn's pending writer here). */
const WORKDIRID_SPELLERS: readonly string[] = ['_plat_workdirid_pane', '_spawn_workdirid_pending', '_ws_workdirid_read'];
/** The grammar's one definition, as the reader spells it. */
const GRAMMAR = String.raw`local re=$'^v1\t(([0-9]+):([0-9]+):([1-9][0-9]*|-)|pending)\t([0-9]{13})\t([^[:cntrl:]]+)\t(/[^[:cntrl:]]*)$'`;

/** The function whose region holds line `i`, by the call graph's own rule: from a definition to the first column-0
 *  `}`, or to the next definition. */
const ownerIn = (lines: readonly string[]) => {
  const defs = lines.flatMap((l, i) => { const m = CCD_FUNCTION_DEF.exec(l); return m ? [{ name: m[1]!, at: i }] : []; });
  return (i: number): string => {
    const d = [...defs].reverse().find((x) => x.at <= i);
    if (d === undefined) return '<top level>';
    for (let j = d.at + 1; j < i; j++) if (lines[j]!.startsWith('}')) return '<top level>';
    return d.name;
  };
};

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-workdirid-'); });
afterEach(() => { h.cleanup(); });

const regDir = (): string => path.join(h.home, '.cc-sessions');
const field = (id: string = ID): string => path.join(regDir(), `${id}.workdirid`);
const W = (): string => path.join(h.home, 'w');
const tmps = (): string[] => fs.readdirSync(regDir()).filter((n) => n.endsWith('.tmp'));
/** A valid line for `logical`, its physical spelling `phys`. */
const line = (phys: string, logical: string = W(), ident = '11:22:33'): string =>
  `v1${T}${ident}${T}${AT}${T}${phys}${T}${logical}`;
/** A valid line of exactly `n` bytes, its physical spelling padded. */
const padded = (n: number): string => line(`/${'a'.repeat(n - line('/').length)}`);

/** The reader, and its answer on one line: `[rc=<n>] <state>|<ident>|<physical>|<why>`. */
const READ = (logical: string, id: string = ID): string =>
  `_ws_workdirid_read ${id} '${logical}'; echo "[rc=$?] $_WS_WDID_STATE|$_WS_WDID_IDENT|$_WS_WDID_PHYS|$_WS_WDID_WHY"`;
const read = (logical: string = W(), id: string = ID): string => h.sh(READ(logical, id));
/** `snippet` with ccd sourced, in the harness's own environment (`h.env()`, built by ghContainedEnv) and HOME, in a
 *  process group of its own that is killed whole at `ms`: for a case whose failure is a hang. */
const timed = (snippet: string, ms: number) => spawnSyncGroup('bash',
  ['-c', 'ccd_t_src=$T4_CCD ccd_t_snippet=$T4_SNIPPET; unset T4_CCD T4_SNIPPET; source "$ccd_t_src"; eval "$ccd_t_snippet"'],
  { cwd: h.home, encoding: 'utf8', timeout: ms, env: { ...h.env(), T4_CCD: CCD, T4_SNIPPET: snippet } });

/** A workdir reached through a link: `link` -> `real` (returned resolved). */
const linked = (): { link: string; real: string } => {
  const real = path.join(h.home, 'wreal');
  const link = path.join(h.home, 'wlink');
  fs.mkdirSync(real);
  fs.symlinkSync(real, link);
  return { link, real: fs.realpathSync(real) };
};
/** The pane's command as the spawn builds it, run by `shell`:
 *  `cd '<logical>' && <fragment>true; cd '<logical>' && exec '<wrapper>'`. The fragment ends `&& `, and `true; `
 *  closes it, so the writer's exit gates neither the second `cd` nor the `exec`. The wrapper records the physical
 *  directory it started in. `pre` runs first, in the composing bash. */
const pane = (shell: string, logical: string, pre = ''): string => {
  const wrap = path.join(h.home, 'fakewrap');
  fs.writeFileSync(wrap, '#!/bin/sh\npwd -P > "$HOME/wrapper-ran"\n', { mode: 0o755 });
  return h.sh(`${pre} frag=$(_plat_workdirid_pane "$REG" ${ID} '${logical}'); `
    + `printf '%s' "cd '${logical}' && \${frag}true; cd '${logical}' && exec '${wrap}'" > "$HOME/pane-cmd"; `
    + `'${shell}' -c "$(cat "$HOME/pane-cmd")"; echo "[pane rc=$?]"`);
};
const ran = (): string | null => {
  const p = path.join(h.home, 'wrapper-ran');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\n$/, '') : null;
};
let shimN = 0;
/** Executables in a directory of their own, returned as the PATH assignment that puts them first. */
const shims = (files: Readonly<Record<string, string>>): string => {
  shimN += 1;
  const d = path.join(h.home, `shims-${shimN}`);
  fs.mkdirSync(d, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(d, name), body, { mode: 0o755 });
  return `PATH='${d}':"$PATH";`;
};
const VALID_AT = (real: string): RegExp =>
  new RegExp(`^\\[rc=0\\] valid\\|[0-9]+:[0-9]+:(?:[1-9][0-9]*|-)\\|${esc(real)}\\|$`);

describe('the reader: one answer per rule, in its fixed order (path-identity spec §4.3)', () => {
  it('a valid line: valid, with its identity and its physical spelling', () => {
    writeField(h, ID, line('/phys/p'));
    expect(read()).toBe('[rc=0] valid|11:22:33|/phys/p|');
  });

  it('a valid line whose birth time is -: valid, the - kept', () => {
    writeField(h, ID, line('/phys/p', W(), '11:22:-'));
    expect(read()).toBe('[rc=0] valid|11:22:-|/phys/p|');
  });

  it('CONTROL: a valid line of exactly 8320 bytes is valid', () => {
    const body = padded(8320);
    expect(Buffer.byteLength(body)).toBe(8320);
    writeField(h, ID, body);
    expect(read()).toMatch(/^\[rc=0\] valid\|11:22:33\|\/a+\|$/);
  });

  it('no name and no link: legacy-absent', () => {
    expect(read()).toBe('[rc=1] legacy-absent|||');
  });

  it('a link at the name, to a valid line: legacy-link, and its target is never opened', () => {
    const target = path.join(h.home, 'a-valid-line');
    fs.writeFileSync(target, line('/phys/p'));
    const past = new Date(1_000_000_000_000);
    fs.utimesSync(target, past, new Date());   // atime before mtime: a read would move it under relatime
    fs.symlinkSync(target, field());
    expect(read()).toBe('[rc=1] legacy-link|||');
    expect(fs.statSync(target).atimeMs, 'the target was never read').toBe(past.getTime());
  });

  it('a directory at the name: unmeasured, never opened', () => {
    fs.mkdirSync(path.join(field(), 'inside'), { recursive: true });
    const out = read();
    expect(out).toMatch(/^\[rc=2\] unmeasured\|\|\|the entry field /);
    expect(out).toContain('is not a regular file');
  });

  it('a FIFO at the name: unmeasured, and the reader returns instead of blocking on the open', () => {
    h.sh(`mkfifo "$REG/${ID}.workdirid"`);
    const r = timed(READ(W()), 10_000);
    expect(r.error, 'the reader returned inside the group timeout').toBeUndefined();
    expect(r.stdout.trim()).toMatch(/^\[rc=2\] unmeasured\|\|\|the entry field .* is not a regular file/);
  }, 30_000);

  it.skipIf(ROOT_USER)('a field this process cannot open (mode 000): unmeasured', () => {
    writeField(h, ID, line('/phys/p'));
    fs.chmodSync(field(), 0o000);
    const out = read();
    expect(out).toMatch(/^\[rc=2\] unmeasured\|\|\|the entry field /);
    expect(out).toContain('could not be opened');
  });

  it('a read that fails after the open: unmeasured, never legacy', () => {
    writeField(h, ID, line('/phys/p'));
    const out = h.sh(`${shims({ head: '#!/bin/sh\nexit 1\n' })} ${READ(W())}`);
    expect(out).toMatch(/^\[rc=2\] unmeasured\|\|\|the entry field /);
    expect(out).toContain('could not be read');
  });

  it.each([
    ['a version other than v1', (): string => line('/phys/p').replace(/^v1/, 'v2')],
    ['a missing field', (): string => `v1${T}11:22:33${T}${AT}${T}/phys/p`],
    ['a birth time of 0', (): string => line('/phys/p', W(), '11:22:0')],
    ['a 12-digit time', (): string => line('/phys/p').replace(AT, AT.slice(1))],
    ['a relative physical spelling', (): string => line('phys/p')],
    ['a physical spelling that is not plain', (): string => line('/a/./b')],
    ['a trailing newline', (): string => `${line('/phys/p')}\n`],
    ['an inner TAB', (): string => line(`/ph${T}ys`)],
    ['an inner CR', (): string => line('/ph\rys')],
    ['a pending line whose physical field is not -', (): string => `v1${T}pending${T}${AT}${T}/x${T}${W()}`],
    ['a body of 8321 bytes', (): string => padded(8321)],
    ['an empty body', (): string => ''],
    ['a NUL byte', (): string => line('/ph\0ys')],
  ] as const)('%s: legacy-unparseable', (_what, body) => {
    writeField(h, ID, body());
    expect(read()).toBe('[rc=1] legacy-unparseable|||');
  });

  it('a valid line for another logical spelling: legacy-stale', () => {
    writeField(h, ID, line('/phys/p', `${W()}2`));
    expect(read()).toBe('[rc=1] legacy-stale|||');
  });

  it('a pending line for the current logical spelling: pending, a hold', () => {
    writeField(h, ID, `v1${T}pending${T}${AT}${T}-${T}${W()}`);
    expect(read()).toBe('[rc=2] pending|||');
  });

  it('a pending line for another logical spelling: legacy-stale, because stale is decided before pending', () => {
    writeField(h, ID, `v1${T}pending${T}${AT}${T}-${T}${W()}2`);
    expect(read()).toBe('[rc=1] legacy-stale|||');
  });

  it('every answer clears every global first: a valid read, then an absent one, leaves nothing standing', () => {
    writeField(h, ID, line('/phys/p'));
    const out = h.sh(`${READ(W())}; rm -f "$REG/${ID}.workdirid"; ${READ(W())}; echo "at=[$_WS_WDID_AT]"`);
    expect(out.split('\n')).toEqual(['[rc=0] valid|11:22:33|/phys/p|', '[rc=1] legacy-absent|||', 'at=[]']);
  });
});

describe('the composer: one line in the platform block, a brace-free fragment or nothing (path-identity spec §4.3)', () => {
  const COMPOSE = (args: string, os = 'linux'): string =>
    h.sh(`CCD_OS=${os}; o=$(_plat_workdirid_pane ${args}); echo "[$o] rc=$?"`);

  it('prints the /bin/sh fragment with its three arguments single-quoted, and no brace outside the script', () => {
    const out = COMPOSE(`"$REG" ${ID} "$HOME/w"`);
    const m = new RegExp(`^\\[/bin/sh -c '([^']+)' ccd-workdirid '${esc(regDir())}' '${ID}' '${esc(W())}' 2>/dev/null && \\] rc=0$`).exec(out);
    expect(m, out).not.toBeNull();
    const script = m![1]!;
    expect(out.replace(`'${script}'`, ''), 'no brace outside the quoted script').not.toMatch(/[{}]/);
    expect(script.startsWith('REG=$(printf %b "$1") id=$(printf %b "$2") l=$(printf %b "$3"); '), 'it decodes each argument once, first')
      .toBe(true);
    expect(script).toContain('p=$(pwd -P && echo .)');
    expect(script).toContain('s=$(stat -c %d:%i:%W . 2>/dev/null) || exit 0;');
    expect(script).toContain('t=$REG/.$id.workdirid.$$.tmp f=$REG/$id.workdirid;');
    expect(script.indexOf('>"$t"'), 'the line is written to the dot-leading temp').toBeGreaterThan(-1);
    expect(script.indexOf('>"$t"'), 'and then renamed over the field').toBeLessThan(script.indexOf('mv -fT "$t" "$f"'));
    expect(script.endsWith('; exit 0'), 'every path ends 0').toBe(true);
  });

  it('the Darwin arm, chosen from CCD_OS when the fragment is composed: BSD stat, and a rename that refuses a directory', () => {
    const out = COMPOSE(`"$REG" ${ID} "$HOME/w"`, 'darwin');
    const script = /^\[\/bin\/sh -c '([^']+)'/.exec(out)?.[1] ?? '';
    expect(script).toContain('s=$(stat -f %d:%i:%B . 2>/dev/null) || exit 0;');
    expect(script).toContain('if [ -d "$f" ] && [ ! -L "$f" ]; then rm -f "$t"; exit 0; fi; [ -L "$f" ] && rm -f "$f"; mv -f "$t" "$f" 2>/dev/null || rm -f "$t"');
    expect(script).not.toMatch(/stat -c|mv -fT/);
  });

  it.each([
    ['a REG holding a single quote', `"$HOME/re'g" ${ID} "$HOME/w"`],
    ['an id holding a TAB', `"$REG" demo$'\\t'x "$HOME/w"`],
    ['a logical spelling holding a newline', `"$REG" ${ID} "$HOME/w"$'\\n'x`],
    ['an id holding a slash', `"$REG" demo/x "$HOME/w"`],
    ['an empty REG', `'' ${ID} "$HOME/w"`],
    ['an empty id', `"$REG" '' "$HOME/w"`],
    ['an empty logical spelling', `"$REG" ${ID} ''`],
  ] as const)('prints nothing for %s, and answers 0', (_what, args) => {
    expect(COMPOSE(args)).toBe('[] rc=0');
  });

  it('is defined once, and calls no function: a call out of K would count', () => {
    expect(ccdFunctionDefinitions().filter((s) => s.text.startsWith('_plat_workdirid_pane()')).map((s) => s.file))
      .toEqual(['ccd/ccd']);
    expect(ccdCallGraph().filter((e) => e.caller === '_plat_workdirid_pane').map((e) => e.callee), 'it names no ccd function')
      .toEqual([]);
  });

  it('it is ONE line, in place of the blank line after _plat_epoch_ms, in ccd and in ccrc alike', () => {
    for (const [name, file] of [['ccd/ccd', CCD], ['ccd/ccrc', CCRC]] as const) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      const at = lines.flatMap((l, i) => (l.startsWith('_plat_workdirid_pane') ? [i] : []));
      expect(at, `${name}: one line defines it`).toHaveLength(1);
      const i = at[0]!;
      expect(lines[i], `${name}: the whole definition is that line`)
        .toMatch(/^_plat_workdirid_pane\(\) \{ .*; return 0; \}   # reg id logical -> /);
      expect(lines[i - 1], `${name}: the line above is a closing }`).toBe('}');
      expect(ownerIn(lines)(i - 1), `${name}: and that } closes _plat_epoch_ms`).toBe('_plat_epoch_ms');
      expect(lines[i + 1], `${name}: the line below is the comment the blank line stood above`)
        .toMatch(/^# `cp --remove-destination` IS GNU\./);
    }
  });

  it('the grammar is spelled once, as the regex of the reader', () => {
    const lines = ccdSource().split('\n');
    const at = lines.flatMap((l, i) => (bashCodeOf(l).includes('|pending)') ? [i] : []));
    expect(at, 'one code line spells the grammar').toHaveLength(1);
    expect(lines[at[0]!]!.trim()).toBe(GRAMMAR);
    expect(ownerIn(lines)(at[0]!)).toBe('_ws_workdirid_read');
    expect(fs.readFileSync(CCRC, 'utf8'), 'ccrc spells no grammar of its own').not.toContain('|pending)');
  });

  it('the spelling .workdirid stands in the code of these functions only', () => {
    const lines = ccdSource().split('\n');
    const owner = ownerIn(lines);
    const owners = new Set(lines.flatMap((l, i) => (bashCodeOf(l).includes('.workdirid') ? [owner(i)] : [])));
    expect([...owners].sort()).toEqual([...WORKDIRID_SPELLERS].sort());
  });
});

/** Each shell a pane may have: its name, its binary ('' when absent), and whether the suite needs it. */
const SHELLS: ReadonlyArray<readonly [string, string, boolean]> = [
  ['sh', '/bin/sh', true], ['bash', onPath('bash'), true],
  ['dash', onPath('dash'), false], ['zsh', onPath('zsh'), false], ['fish', onPath('fish'), false],
];

describe('the pane writes the field after its cd and before its exec, under each shell a pane may have', () => {
  for (const [name, bin, needed] of SHELLS) {
    it.skipIf(!needed && bin === '')(`under ${name}: a valid field naming the directory cd reached, and the wrapper ran`, () => {
      expect(bin, `${name} is on the suite's PATH`).not.toBe('');
      const { link, real } = linked();
      expect(pane(bin, link)).toBe('[pane rc=0]');
      expect(ran(), 'the wrapper ran, in the target').toBe(real);
      const [ans, ident] = h.sh(`${READ(link)}; _ws_path_ident '${real}'; echo "ident=$_WS_IDENT"`).split('\n');
      expect(ans).toMatch(VALID_AT(real));
      expect(ans!.split('|')[1], 'its identity is the target’s, measured as ccd measures it').toBe(ident!.replace(/^ident=/, ''));
      expect(tmps(), 'no temp is left').toEqual([]);
    });
  }
});

describe('every spelling .workdir accepts round-trips: a backslash rides as an escape the script decodes (path-identity spec §4.3)', () => {
  /** `logical`, a link spelled with `leaf` under HOME, to a directory made for it (returned resolved). */
  const backslashed = (leaf: string): { logical: string; real: string } => {
    const real = path.join(h.home, 'wreal');
    fs.mkdirSync(real);
    const logical = path.join(h.home, leaf);
    fs.symlinkSync(real, logical);
    return { logical, real: fs.realpathSync(real) };
  };
  /** The fragment for `logical`, composed with the registry word `reg`, run by `shell` from inside `logical`. Bash
   *  enters the directory, so the fragment is under test here, not the spawn's own `cd` quoting: `[rc=<n>]`. */
  const fromInside = (shell: string, logical: string, reg = '"$REG"'): string =>
    h.sh(`cd '${logical}' && frag=$(_plat_workdirid_pane ${reg} ${ID} '${logical}') && '${shell}' -c "\${frag}true"; echo "[rc=$?]"`);
  const SPELLINGS: ReadonlyArray<readonly [string, string]> = [
    ['a backslash inside it', 'w\\x'], ['two backslashes', 'w\\\\y'], ['a trailing backslash', 'w\\'],
  ];
  for (const [what, leaf] of SPELLINGS) {
    for (const [name, bin, needed] of SHELLS) {
      it.skipIf(!needed && bin === '')(`${what}, under ${name}: carried as \\0134, and the field is valid with .workdir byte for byte`, () => {
        expect(bin, `${name} is on the suite's PATH`).not.toBe('');
        const { logical, real } = backslashed(leaf);
        expect(h.sh(`printf '%s' "$(_plat_workdirid_pane "$REG" ${ID} '${logical}')"`), 'each backslash rides as \\0134')
          .toContain(` '${logical.split('\\').join('\\0134')}' 2>/dev/null &&`);
        expect(fromInside(bin, logical)).toBe('[rc=0]');
        expect(read(logical)).toMatch(VALID_AT(real));
        expect(fs.readFileSync(field(), 'utf8').split(T)[4], 'the logical spelling is .workdir, byte for byte').toBe(logical);
        expect(tmps(), 'no temp is left').toEqual([]);
      });
    }
  }

  it('a REG spelled with a backslash: the field lands in the registry that spelling names', () => {
    const { link, real } = linked();
    const alias = path.join(h.home, 're\\g');
    fs.symlinkSync(regDir(), alias);
    expect(fromInside('/bin/sh', link, `'${alias}'`)).toBe('[rc=0]');
    expect(read(link)).toMatch(VALID_AT(real));
    expect(tmps()).toEqual([]);
  });
});

describe('where the pane writes, and what it writes when it cannot measure', () => {
  it('CONTROL: the host stat, mv and date the shims stand in front of are on PATH', () => {
    for (const [n, p] of Object.entries(REAL)) expect(p, n).toMatch(new RegExp(`/${n}$`));
  });

  it('a stat that fails: no field and no temp, the wrapper still ran, and the fragment alone exits 0', () => {
    const { link, real } = linked();
    const failing = shims({ stat: '#!/bin/sh\nexit 1\n' });
    expect(pane('/bin/sh', link, failing)).toBe('[pane rc=0]');
    expect(fs.existsSync(field())).toBe(false);
    expect(tmps()).toEqual([]);
    expect(ran()).toBe(real);
    expect(h.sh(`${failing} cd '${link}' && { frag=$(_plat_workdirid_pane "$REG" ${ID} '${link}'); /bin/sh -c "\${frag}true"; }; echo "[rc=$?]"`),
      'every path of the script ends 0, though the launch line never reads its exit').toBe('[rc=0]');
  });

  it('a physical spelling holding a TAB: no field, and the wrapper still ran', () => {
    const real = path.join(h.home, `w${T}x`);
    fs.mkdirSync(real);
    const link = path.join(h.home, 'tlink');
    fs.symlinkSync(real, link);
    expect(pane('/bin/sh', link)).toBe('[pane rc=0]');
    expect(fs.existsSync(field())).toBe(false);
    expect(ran()).toBe(fs.realpathSync(real));
  });

  it('a date without %N: the time is whole seconds and 000, and the field is valid', () => {
    const { link, real } = linked();
    const pre = shims({ date: `#!/bin/sh\ncase "$1" in +%s%3N) printf '%s3N\\n' "$('${REAL.date}' +%s)" ;; *) exec '${REAL.date}' "$@" ;; esac\n` });
    expect(pane('/bin/sh', link, pre)).toBe('[pane rc=0]');
    const [ans, at] = h.sh(`${READ(link)}; echo "at=$_WS_WDID_AT"`).split('\n');
    expect(ans).toMatch(VALID_AT(real));
    expect(at).toMatch(/^at=[0-9]{10}000$/);
  });

  it('a directory at the field name stays, no temp is left, and the wrapper still ran', () => {
    const { link, real } = linked();
    fs.mkdirSync(path.join(field(), 'inside'), { recursive: true });
    expect(pane('/bin/sh', link)).toBe('[pane rc=0]');
    expect(fs.lstatSync(field()).isDirectory()).toBe(true);
    expect(fs.readdirSync(field())).toEqual(['inside']);
    expect(tmps()).toEqual([]);
    expect(ran()).toBe(real);
  });

  it('a link at the field name is replaced by the field, and the file it named is untouched', () => {
    const { link, real } = linked();
    const theirs = path.join(h.home, 'theirs');
    fs.writeFileSync(theirs, 'their bytes');
    fs.symlinkSync(theirs, field());
    expect(pane('/bin/sh', link)).toBe('[pane rc=0]');
    expect(fs.lstatSync(field()).isSymbolicLink(), 'the link was replaced').toBe(false);
    expect(read(link)).toMatch(VALID_AT(real));
    expect(fs.readFileSync(theirs, 'utf8'), 'the file the link named is untouched').toBe('their bytes');
  });

  it('a stat that prints - for the birth time: a valid field whose birth time is -', () => {
    const { link, real } = linked();
    const pre = shims({ stat: `#!/bin/sh\nprintf '%s:-\\n' "$('${REAL.stat}' ${DEVINO} "$3")"\n` });
    expect(pane('/bin/sh', link, pre)).toBe('[pane rc=0]');
    expect(read(link)).toMatch(new RegExp(`^\\[rc=0\\] valid\\|[0-9]+:[0-9]+:-\\|${esc(real)}\\|$`));
  });

  it('forced Darwin: BSD stat and the Darwin rename write a valid field over a link at the name', () => {
    const { link, real } = linked();
    const theirs = path.join(h.home, 'theirs');
    fs.writeFileSync(theirs, 'their bytes');
    fs.symlinkSync(theirs, field());
    const bsd = process.platform === 'darwin' ? '' : shims({
      stat: `#!/bin/sh\nif [ "$1" = -f ]; then exec '${REAL.stat}' -c "$(printf %s "$2" | sed 's/%B/%W/')" "$3"; fi\nexec '${REAL.stat}' "$@"\n`,
    });
    expect(pane('/bin/sh', link, `CCD_OS=darwin; ${bsd}`)).toBe('[pane rc=0]');
    expect(fs.lstatSync(field()).isSymbolicLink(), 'the link was replaced').toBe(false);
    expect(read(link)).toMatch(VALID_AT(real));
    expect(fs.readFileSync(theirs, 'utf8'), 'the file the link named is untouched').toBe('their bytes');
    expect(ran()).toBe(real);
  });

  it('BSD argument order (POSIXLY_CORRECT stat and mv): a valid field', () => {
    const { link, real } = linked();
    const pre = shims({
      stat: `#!/bin/sh\nPOSIXLY_CORRECT=1; export POSIXLY_CORRECT\nexec '${REAL.stat}' "$@"\n`,
      mv: `#!/bin/sh\nPOSIXLY_CORRECT=1; export POSIXLY_CORRECT\nexec '${REAL.mv}' "$@"\n`,
    });
    expect(pane('/bin/sh', link, pre)).toBe('[pane rc=0]');
    expect(read(link)).toMatch(VALID_AT(real));
  });
});

describe('the seeds: start and ws-add write one valid field through the same composer (R5, P4)', () => {
  const STUBS = '_supervised_start() { echo "supervised_start $*" >> "$HOME/ccd-calls"; }; _alive() { return 1; };';

  it('start on a fresh row whose workdir is a link: a valid field, its physical spelling the target, its logical the stored .workdir', () => {
    const { link, real } = linked();
    const r = h.run(`${STUBS} cmd_start claude-b demo '${link}'`);
    expect(r.code, r.stderr).toBe(0);
    const id = 'claude-b-demo';
    expect(h.reg(id, 'workdir'), 'the stored .workdir is the logical spelling').toBe(link);
    const [ans, ident] = h.sh(`${READ(link, id)}; _ws_path_ident '${real}'; echo "ident=$_WS_IDENT"`).split('\n');
    expect(ans).toMatch(VALID_AT(real));
    expect(ans!.split('|')[1]).toBe(ident!.replace(/^ident=/, ''));
  });

  it('start on a workdir spelled with a backslash: a valid field, its logical spelling byte-equal to .workdir', () => {
    const real = path.join(h.home, 'wreal');
    fs.mkdirSync(real);
    const link = path.join(h.home, 'w\\x');
    fs.symlinkSync(real, link);
    const r = h.run(`${STUBS} cmd_start claude-b demo '${link}'`);
    expect(r.code, r.stderr).toBe(0);
    const id = 'claude-b-demo';
    expect(h.reg(id, 'workdir'), 'the stored .workdir keeps its backslash').toBe(link);
    expect(read(link, id)).toMatch(VALID_AT(fs.realpathSync(real)));
    expect(fs.readFileSync(field(id), 'utf8').split(T)[4]).toBe(link);
  });

  it('start of a LIVE row returns before the seed: an existing field stays byte-identical', () => {
    const { link } = linked();
    expect(h.run(`${STUBS} cmd_start claude-b demo '${link}'`).code, 'the CONTROL: the row was made').toBe(0);
    writeField(h, 'claude-b-demo', 'the bytes a live pane wrote');
    const r = h.run('_supervised_start() { echo "supervised_start $*" >> "$HOME/ccd-calls"; }; _alive() { return 0; }; cmd_start claude-b-demo');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout, 'the CONTROL: the live-pane return was taken').toContain('already running: claude-b-demo');
    expect(fs.readFileSync(field('claude-b-demo'), 'utf8')).toBe('the bytes a live pane wrote');
  });

  it('ws-add seeds the new row before its spawn, on its .workdir line', () => {
    h.makeRepo('demo');
    const spy = '_spawn_start() { [[ -f "$REG/$1.workdirid" ]] && echo "seeded-before-spawn $1" >> "$HOME/ccd-calls"; SPAWN_FROMSWAP=0; };';
    h.sh(`${WS_ADD} ${spy} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    const id = 'demo-quiet-mesa';
    const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-mesa');
    expect(h.calls(), 'the field stood when the spawn was asked').toContain(`seeded-before-spawn ${id}`);
    expect(h.reg(id, 'workdir')).toBe(wt);
    expect(read(wt, id)).toMatch(VALID_AT(fs.realpathSync(wt)));
  });
});

describe('the purge takes the field, and a standing field keeps the slug taken (R6: no code change)', () => {
  it('_reg_purge removes <id>.workdirid, and _ws_slug_free refuses while it stands', () => {
    writeField(h, ID, line('/phys/p'));
    expect(h.sh('_ws_slug_free demo x && echo free || echo taken')).toBe('taken');
    h.sh(`_reg_purge ${ID}`);
    expect(fs.existsSync(field())).toBe(false);
    expect(h.sh('_ws_slug_free demo x && echo free || echo taken')).toBe('free');
  });
});

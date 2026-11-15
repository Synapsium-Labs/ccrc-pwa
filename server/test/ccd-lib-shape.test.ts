// The ccd file split, Task 4 (docs/superpowers/plans/2026-11-06-ccd-file-split.md; D-8048): one library table, and
// every scanner on it. ccd/ccd names its libraries once, in the literal `__CCD_LIBS=(…)` line, and `_ccd_lib_load` builds
// its file list from it; every test-side list derives from the same line.
//
// THE PIN (first commit, passing on the code before the table): what the load does today, so the table changes none of it.
//   * the source form loads disk-retention, train-proof, delegation-lease and pool-set, in that order (a move appends
//     its library to the table, so a later program loads these four first and then the table's other words, in order);
//   * the load refuses with these words and no others;
//   * every test-side library list names those four, in that order;
//   * when a diff changes ccd/ccd only in `_ccd_lib_load` and its table line, `programDump` is unchanged apart from
//     `_ccd_lib_load` (judged from `moveBase` at test time, as the split's other REAL rows are).
//
// THE ROWS (the split's Step 3): every test-side list follows the table; no library sets a global with a bare `declare`,
// reads a positional or returns at its top level (the load evaluates each inside a function, and Task 5 inlines it at the
// foot, so either form must mean the same); a library's header is comment lines only; the one-text guard
// (`ccdReadGuard.ts`) throws on a raw read, a helper read, a body copy and a flat listing, and no test hands ccd/ccd to a text
// tool in a shell string, which the guard cannot see; and `shared/hook-helpers.mjs` reads the same text `spliceCcd` does.
// This file is about the program's FILES: it copies ccd/ccd and its libraries into a fixture tree, and reads the loader's text.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, CCD_LIBS, ccdSource, ccdTreeCopy, ghContainedEnv, makeCcdHarness, spliceCcd, type CcdHarness } from './ccdWsHelpers.js';
import { CCD_LIB_FILES, ccdLibFilesIn, ccdSourceLines } from './consolidationCensus.js';
import { moveBase, programDump, treeAt, type Tree } from './ccdSplit.js';
import { ccdLibNames } from './ccdLibTable.js';
import { bashBodies, ccdProgramBodies } from './census-w5/accountMarkers.js';
import { heredocLines } from './census-w5/redactors.js';
import { FILE_READERS, PROGRAM_READERS, guardRefusal } from './ccdReadGuard.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { readCcdProgram } from '../../shared/hook-helpers.mjs';

const REPO = path.resolve(__dirname, '..', '..');
/** The four libraries the load read before the table, in their load order. */
const FOUR = ['disk-retention', 'train-proof', 'delegation-lease', 'pool-set'] as const;

/** The words of the one `__CCD_LIBS=(` line of a ccd text, or null when it has none (the code before Task 4). */
function tableWordsOf(text: string): string[] | null {
  const lines = text.split('\n').filter((l) => l.startsWith('__CCD_LIBS=('));
  if (lines.length === 0) return null;
  expect(lines, 'one `__CCD_LIBS=(` line').toHaveLength(1);
  const m = /^__CCD_LIBS=\(([a-z0-9 -]+)\)( .*)?$/.exec(lines[0]!);
  expect(m, 'the table line is one word list').not.toBeNull();
  return m![1]!.split(' ').filter(Boolean);
}

/** `_ccd_lib_load`'s definition in a ccd text: from its `() {` line to the first column-0 `}`. */
function loaderOf(text: string): string {
  const start = text.indexOf('\n_ccd_lib_load() {');
  expect(start, '_ccd_lib_load is defined in ccd/ccd').toBeGreaterThan(0);
  const end = text.indexOf('\n}\n', start + 1);
  return text.slice(start + 1, end + 3);
}

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lib-shape-'); });
afterEach(() => { h.cleanup(); });

describe('PIN: the load before and after the table (D-8048)', () => {
  it('PIN: the source form loads disk-retention, train-proof, delegation-lease, pool-set, in that order', () => {
    // A copy of ccd and every program library, each library ending in one line that records its own word as it is evaluated.
    // The source form checks no digest, so the marked copies load as the committed ones do.
    const tree = path.join(h.home, 'tree');
    fs.mkdirSync(path.join(tree, 'lib'), { recursive: true });
    fs.copyFileSync(CCD, path.join(tree, 'ccd'));
    const libDir = path.join(REPO, 'ccd', 'lib');
    for (const f of fs.readdirSync(libDir).filter((n) => n.endsWith('.sh') && !n.startsWith('ccrc-'))) {
      const word = f.slice(0, -'.sh'.length);
      fs.writeFileSync(path.join(tree, 'lib', f), `${fs.readFileSync(path.join(libDir, f), 'utf8')}__PIN_ORDER+=(${word})\n`);
    }
    const driver = path.join(h.home, 'order.sh');
    fs.writeFileSync(driver, 'source "$1" >/dev/null 2>&1; echo "rc=$?"; echo "order=${__PIN_ORDER[*]}"\n');
    const r = spawnSync('bash', [driver, path.join(tree, 'ccd')],
      { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, h.env(), { systemd: true, tmux: true, net: true }) });
    expect(r.stdout).toContain('rc=0');
    const order = (/^order=(.*)$/m.exec(r.stdout)?.[1] ?? '').split(' ').filter(Boolean);
    const want = tableWordsOf(fs.readFileSync(path.join(tree, 'ccd'), 'utf8')) ?? [...FOUR];
    expect(want.slice(0, FOUR.length), 'the table starts with the four, in their load order').toEqual([...FOUR]);
    expect(order, 'every library evaluated once, in table order').toEqual(want);
  });

  it('PIN: the load refuses with these words and no others', () => {
    const loader = loaderOf(fs.readFileSync(CCD, 'utf8'));
    const refusals = loader.split('\n').filter((l) => l.includes('ccd: refused (')).map((l) => l.trim().replace(/^.*?printf '/, '').replace(/' .*$/, ''));
    expect([...new Set(refusals.map((l) => /refused \(([a-z-]+)\)/.exec(l)?.[1]))].sort()).toEqual(['lib-digest', 'lib-hash', 'lib-missing', 'lib-unreadable']);
    expect(refusals.sort()).toEqual([
      'ccd: refused (lib-digest): %s is not the library this ccd pins (%s) — a half-published install or an edited file (re-run: ccrc update); nothing was run\\n',
      'ccd: refused (lib-digest): this ccd is stamped as installed but its library pin was never rendered, so %s cannot be checked — a broken install (re-run: ccrc update); nothing was run\\n',
      'ccd: refused (lib-hash): no hashing tool was found (on PATH or at %s), so the digest of %s cannot be checked; nothing was run\\n',
      'ccd: refused (lib-hash): the digest of %s could not be computed (no hashing tool, or it failed); nothing was run\\n',
      'ccd: refused (lib-missing): %s is not a readable regular file — ccd and its library install together (re-run: ccrc update); nothing was run\\n',
      'ccd: refused (lib-unreadable): %s could not be read; nothing was run\\n',
    ].sort());
  });

  it('PIN: every test-side library list names those four, in that order', () => {
    expect(CCD_LIB_FILES.slice(0, FOUR.length), 'consolidationCensus.ts').toEqual(FOUR.map((w) => `ccd/lib/${w}.sh`));
    expect(CCD_LIBS.slice(0, FOUR.length), 'ccdWsHelpers.ts').toEqual(FOUR.map((w) => path.join(REPO, 'ccd', 'lib', `${w}.sh`)));
  });

  it('PIN: programDump of the source form is unchanged by this PR, apart from _ccd_lib_load', (ctx) => {
    let base: string;
    try {
      base = moveBase(process.env, REPO);
    } catch (e) {
      if (process.env['GITHUB_EVENT_NAME'] === 'merge_group') throw e;
      console.log(`ccd-lib-shape: the REAL row skips: ${(e as Error).message.split('\n')[0]}`);
      return ctx.skip();
    }
    const before = treeAt(base, REPO);
    const after = treeAt('HEAD', REPO);
    // Judged only for a diff that leaves every library alone and changes ccd/ccd in `_ccd_lib_load`, its table line and
    // comment lines alone: then the program the load leaves must be the one it left before.
    const libs = (t: Tree): string => JSON.stringify(Object.entries(t).filter(([rel]) => rel !== 'ccd/ccd').sort());
    if (libs(before) !== libs(after)) return;
    const rest = (t: Tree): string => {
      const text = t['ccd/ccd'] ?? '';
      return text.replace(loaderOf(text), '').split('\n').filter((l) => !l.startsWith('__CCD_LIBS=(') && !/^\s*#/.test(l)).join('\n');
    };
    if (rest(before) !== rest(after)) return;
    const dropLoader = (dump: string): string => dump.replace(/^_ccd_lib_load \(\) \n\{\n[\s\S]*?\n\}\n/m, '');
    expect(dropLoader(programDump(after)), 'the program the load leaves').toBe(dropLoader(programDump(before)));
  });
});

// ── the table, and the libraries' shape ─────────────────────────────────────────────────────────────────────────────
/** Lines as bash reads their words: single-quoted text (which may run across lines) and comments blanked, so only what
 *  bash expands is left; double-quoted text stays, since `$1` inside double quotes is still read. */
function codeAcrossLines(lines: readonly string[]): string[] {
  let single = false;
  let double = false;
  return lines.map((line) => {
    let out = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (single) { if (c === "'") single = false; out += ' '; continue; }
      if (c === '\\') { out += '  '; i++; continue; }
      if (c === "'" && !double) { single = true; out += ' '; continue; }
      if (c === '"') double = !double;
      if (c === '#' && !double && (i === 0 || /\s/.test(line[i - 1]!))) break;
      out += c;
    }
    return out;
  });
}

/** Each top-level line of each library `words` names, under `root` (`census-w5/accountMarkers.ts`'s split; heredoc bodies
 *  and single-quoted text left out: they are data): `<file>:<line>` with its raw text and its code. */
function topLevelOf(words: readonly string[], root: string = REPO): { at: string; raw: string; code: string }[] {
  return words.flatMap((w) => {
    const file = `ccd/lib/${w}.sh`;
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const data = heredocLines(src);
    const top = bashBodies(src).find((b) => !b.fn)!.lines.filter((l) => !data.has(l.line));
    const code = codeAcrossLines(top.map((l) => l.raw));
    return top.map((l, i) => ({ at: `${file}:${l.line}`, raw: l.raw, code: code[i]! }));
  });
}

/** Top-level `declare`/`typeset` lines without `-g`, and top-level `local`: inside the load's function each is a local that
 *  vanishes when the load returns, while inlined at the foot it is a global. */
function topLevelDeclares(words: readonly string[], root: string = REPO): string[] {
  return topLevelOf(words, root).filter(({ code }) => /^\s*local\b/.test(code)
    || (/^\s*(?:declare|typeset)\b/.test(code) && !/^\s*(?:declare|typeset)((?:\s+-[A-Za-z]+)*)/.exec(code)![1]!.includes('g')))
    .map(({ at, raw }) => `${at}: ${raw}`);
}

/** Top-level reads of a positional parameter (`$1`, `${2}`, `$#`, `$@`, `$*`), and top-level `shift` or `return`: inside the
 *  load's function they reach the load's own arguments and return from the load, while inlined at the foot they reach ccd's. */
function topLevelPositionals(words: readonly string[], root: string = REPO): string[] {
  return topLevelOf(words, root).filter(({ code }) => /\$(?:[1-9#@*]|\{(?:[1-9@*]|#\}))/.test(code)
    || /(?:^|[;&|({]\s*|\s)(?:shift|return)(?:\s|;|$)/.test(code))
    .map(({ at, raw }) => `${at}: ${raw}`);
}

/** A fixture tree: a ccd whose table names `words`, each library holding one region its pointer splices back. */
function tableTree(dir: string, words: readonly string[]): string {
  fs.mkdirSync(path.join(dir, 'ccd', 'lib'), { recursive: true });
  const pointers = words.map((w) => `# @ccd-lib:${w.replace(/-/g, '_')} — moved to ccd/lib/${w}.sh`).join('\n');
  fs.writeFileSync(path.join(dir, 'ccd', 'ccd'), `#!/usr/bin/env bash\nfa() { :; }\n${pointers}\n__CCD_LIBS=(${words.join(' ')})   # load order\n`);
  for (const w of words) {
    fs.writeFileSync(path.join(dir, 'ccd', 'lib', `${w}.sh`), `# ccd/lib/${w}.sh — a fixture library\n# @ccd-lib:${w.replace(/-/g, '_')}\nf_${w.replace(/-/g, '_')}() {\n  echo ${w}\n}\n`);
  }
  return dir;
}

describe('one library table, and every list on it (D-8048)', () => {
  it('every test-side library list follows the table', () => {
    // The real tree: each list is the table's words, in its order, and the installer reads the same words.
    const words = ccdLibNames();
    expect(words.slice(0, FOUR.length)).toEqual([...FOUR]);
    expect(CCD_LIB_FILES).toEqual(words.map((w) => `ccd/lib/${w}.sh`));
    expect(CCD_LIBS).toEqual(words.map((w) => path.join(REPO, 'ccd', 'lib', `${w}.sh`)));
    const py = spawnSyncGroup('python3', ['-I', '-c', [
      'import importlib.util, sys',
      "s = importlib.util.spec_from_file_location('ccd_entry_install', sys.argv[1]); m = importlib.util.module_from_spec(s); s.loader.exec_module(m)",
      "print(' '.join(m.read_lib_table(open(sys.argv[2], 'rb').read())))",
    ].join('\n'), path.join(REPO, 'ccd', 'ccd-entry-install.py'), CCD], { encoding: 'utf8', timeout: 60_000 });
    expect(py.stderr).toBe('');
    expect(py.stdout.trim().split(' '), 'the installer\'s read_lib_table').toEqual(words);
    // A fixture tree whose table holds a word the repository has no library for: every reader follows that tree's table.
    const root = tableTree(path.join(h.home, 'fixture'), ['one', 'two', 'extra-word']);
    expect(ccdLibNames(root)).toEqual(['one', 'two', 'extra-word']);
    expect(ccdLibFilesIn(root)).toEqual(['ccd/lib/one.sh', 'ccd/lib/two.sh', 'ccd/lib/extra-word.sh']);
    expect(ccdSourceLines(root).filter((l) => l.text === 'f_extra_word() {').map((l) => l.file)).toEqual(['ccd/lib/extra-word.sh']);
    expect(ccdProgramBodies(root).filter((b) => b.fn).map((b) => `${b.file}#${b.name}`))
      .toEqual(['ccd/ccd#fa', 'ccd/lib/one.sh#f_one', 'ccd/lib/two.sh#f_two', 'ccd/lib/extra-word.sh#f_extra_word']);
    expect(readCcdProgram(path.join(root, 'ccd', 'ccd'))).toContain('f_extra_word() {\n  echo extra-word\n}');
    // And the load itself: a copy of ccd whose table gains a word loads that library too, after the others.
    const tree = path.join(h.home, 'tree');
    const body = ccdTreeCopy(tree);
    const src = fs.readFileSync(body, 'utf8');
    fs.writeFileSync(body, src.replace(/^__CCD_LIBS=\(([a-z0-9 -]+)\)/m, '__CCD_LIBS=($1 extra-word)'));
    fs.writeFileSync(path.join(tree, 'lib', 'extra-word.sh'), '# a fixture library\nf_extra_word() { echo extra-word; }\n');
    const driver = path.join(h.home, 'extra.sh');
    fs.writeFileSync(driver, 'source "$1" >/dev/null 2>&1; echo "rc=$?"; f_extra_word\n');
    const r = spawnSync('bash', [driver, body],
      { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, h.env(), { systemd: true, tmux: true, net: true }) });
    expect(r.stdout).toBe('rc=0\nextra-word\n');
  });

  it('no library sets a global with a bare declare', () => {
    expect(topLevelDeclares(ccdLibNames())).toEqual([]);   // needs -g: the load is inside a function, inlining is not
    // CONTROL: each form the row refuses, and the one it takes.
    const root = tableTree(path.join(h.home, 'decl'), ['d']);
    fs.appendFileSync(path.join(root, 'ccd', 'lib', 'd.sh'), 'declare -A _M=([k]=v)\ntypeset -a _L=()\nlocal z=1\ndeclare -gA _G=([k]=v)\n');
    expect(topLevelDeclares(['d'], root)).toEqual(['ccd/lib/d.sh:6: declare -A _M=([k]=v)', 'ccd/lib/d.sh:7: typeset -a _L=()', 'ccd/lib/d.sh:8: local z=1']);
  });

  it('no library reads a positional or returns at its top level', () => {
    expect(topLevelPositionals(ccdLibNames())).toEqual([]);
    // CONTROL: each form the row refuses; a positional inside a function or in single quotes is not one.
    const root = tableTree(path.join(h.home, 'pos'), ['p']);
    fs.appendFileSync(path.join(root, 'ccd', 'lib', 'p.sh'), 'X="$1"\nY=${2:-}\nN=$#\nshift\n[ -n "$X" ] || return 0\nA=\'$1\'\nB=${#X}\ng() { echo "$1"; }\n');
    expect(topLevelPositionals(['p'], root)).toEqual(['ccd/lib/p.sh:6: X="$1"', 'ccd/lib/p.sh:7: Y=${2:-}', 'ccd/lib/p.sh:8: N=$#',
      'ccd/lib/p.sh:9: shift', 'ccd/lib/p.sh:10: [ -n "$X" ] || return 0']);
  });

  it('a library header holds comment lines only', () => {
    // Everything above a library's first `# @ccd-lib:` marker is its header: comment and blank lines, nothing to run, so
    // nothing in it is lost when a pointer splices the regions back (the split's Task 1 header rule).
    for (const w of ccdLibNames()) {
      const lines = fs.readFileSync(path.join(REPO, 'ccd', 'lib', `${w}.sh`), 'utf8').split('\n');
      const first = lines.findIndex((l) => l.startsWith('# @ccd-lib:'));
      expect(first, `ccd/lib/${w}.sh opens a region`).toBeGreaterThan(0);
      expect(lines.slice(0, first).filter((l) => l !== '' && !l.startsWith('#')), `ccd/lib/${w}.sh's header`).toEqual([]);
    }
  });
});

// ── the one-text guard ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the one-text guard (ccdReadGuard.ts, D-8048)', () => {
  const frame = (rel: string, fn = 'x'): string => `    at ${fn} (${path.join(REPO, rel)}:10:5)`;
  const stack = (...frames: string[]): string => ['Error', `    at check (${path.join(REPO, 'server', 'test', 'ccdReadGuard.ts')}:1:1)`, ...frames].join('\n');
  const FILE = path.join(REPO, 'ccd', 'ccd');
  const DIR = path.join(REPO, 'ccd');

  it('FIXTURE: the guard throws on a raw read, a helper read, a body copy and a flat listing', () => {
    const test = 'server/test/some-scan.test.ts';
    expect(guardRefusal('read', FILE, stack(frame(test)))).toMatch(/^ccdReadGuard: server\/test\/some-scan\.test\.ts reads ccd\/ccd alone/);
    // A `read()` helper in a shared test module is the first repository frame, and it is not listed either.
    expect(guardRefusal('read', FILE, stack(frame('server/test/someHelpers.ts', 'read'), frame(test)))).toMatch(/someHelpers\.ts reads ccd\/ccd alone/);
    expect(guardRefusal('copy', FILE, stack(frame(test)))).toMatch(/copies ccd\/ccd alone.*ccdTreeCopy\(\)/);
    expect(guardRefusal('list', DIR, stack(frame(test)))).toMatch(/lists ccd\/ flat/);
    // A frame in node_modules is passed over; a listed reader is let through; another file, or a library, is not guarded.
    expect(guardRefusal('read', FILE, stack(`    at f (${path.join(REPO, 'server', 'node_modules', 'x', 'i.js')}:1:1)`, frame(test)))).not.toBeNull();
    expect(guardRefusal('read', FILE, stack(frame('server/test/ccdWsHelpers.ts', 'ccdSource'), frame(test)))).toBeNull();
    expect(guardRefusal('list', DIR, stack(frame('server/test/consolidationCensus.ts'), frame(test)))).toBeNull();
    expect(guardRefusal('read', path.join(REPO, 'ccd', 'lib', 'docs.sh'), stack(frame(test)))).toBeNull();
    expect(guardRefusal('read', path.join(REPO, 'ccd', 'ccrc'), stack(frame(test)))).toBeNull();
    expect(guardRefusal('list', path.join(REPO, 'ccd', 'lib'), stack(frame(test)))).toBeNull();
    // A stack with no repository frame (vitest's own reads) is not attributed.
    expect(guardRefusal('read', FILE, stack('    at f (node:internal/fs:1:1)'))).toBeNull();
  });

  it('the guard is live in this process and set up for both test packages, and every listed file exists', () => {
    expect(() => fs.readFileSync(FILE, 'utf8')).not.toThrow();   // this file is a listed reader
    expect(fs.readFileSync.name).toBe('guardedReadFileSync');
    expect(fs.copyFileSync.name).toBe('guardedCopyFileSync');
    expect(fs.readdirSync.name).toBe('guardedReaddirSync');
    expect(fs.promises.readFile.name).toBe('guardedReadFile');
    expect(fs.readFileSync(path.join(REPO, 'server', 'vitest.config.ts'), 'utf8')).toMatch(/setupFiles: \[[^\]]*'test\/ccdReadGuard\.ts'/);
    expect(fs.readFileSync(path.join(REPO, 'agent', 'vitest.config.ts'), 'utf8')).toMatch(/setupFiles: \[[^\]]*'\.\.\/server\/test\/ccdReadGuard\.ts'/);
    for (const f of [...FILE_READERS, ...PROGRAM_READERS]) expect(fs.existsSync(path.join(REPO, f)), f).toBe(true);
    expect(FILE_READERS.filter((f) => PROGRAM_READERS.includes(f)), 'a file is listed once').toEqual([]);
  });

  it('no test hands ccd/ccd to grep, sed, awk, wc, cat, head or tail in a shell string', () => {
    // The guard cannot see a child process, so this one is spelled: a text tool, its options and operands, then ccd/ccd by
    // any of its names. 0 today. NOT_A_RUN is prose and data that only look like one: an assertion message quoting the
    // command a person would run, a command string fed to the merge-deny hook as data, never run, and this row's CONTROL.
    const NOT_A_RUN = new Set([
      'server/test/ccd-lib-shape.test.ts',
      'server/test/ccd-pool-ok.test.ts', 'server/test/ccd-project-pool.test.ts', 'server/test/session-hook-merge-deny.test.ts',
    ]);
    const arg = String.raw`(?:\s+(?:-[-\w=]*|'[^']*'|"[^"]*"|[^\s"'$;|&<>()]+))*?`;
    const RUN = new RegExp(String.raw`(?:^|[\s"'\x60(;|&])(?:grep|sed|awk|wc|cat|head|tail)${arg}\s+["']?`
      + String.raw`(?:\$\{CCD(?::\?)?\}|\$CCD\b|\$\{CCD_PATH\}|[^\s"'\x60]*\bccd\/ccd(?![-\w./]))`);
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
      ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : (/\.(ts|mjs)$/.test(e.name) ? [path.join(d, e.name)] : [])));
    const hits = [...walk(path.join(REPO, 'server', 'test')), ...walk(path.join(REPO, 'agent', 'test'))]
      .map((f) => path.relative(REPO, f).split(path.sep).join('/'))
      .filter((rel) => !NOT_A_RUN.has(rel))
      .flatMap((rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n')
        .flatMap((l, i) => (!/^\s*(?:\/\/|\/?\*)/.test(l) && RUN.test(l) ? [`${rel}:${i + 1}: ${l.trim()}`] : [])));
    expect(hits).toEqual([]);
    // CONTROL: the shapes it finds, and two it leaves.
    for (const run of ['grep -c x "${CCD}"', 'execSync(`sed -n 1,9p ccd/ccd`)', "awk '/x/' $CCD", 'wc -l ../../ccd/ccd']) expect(RUN.test(run), run).toBe(true);
    for (const not of ['source "${CCD}"; _lanes | wc -l', 'cat ccd/ccd-account-health']) expect(RUN.test(not), not).toBe(false);
  });
});

// ── the generated helpers read the program ─────────────────────────────────────────────────────────────────────────
describe('shared/hook-helpers.mjs reads the program (D-8048)', () => {
  it('hook-helpers.mjs reads the same text as spliceCcd', () => {
    expect(readCcdProgram(CCD), 'the repository').toBe(ccdSource());
    // A tree whose function sits in a library: the generated region's source is still found.
    const root = tableTree(path.join(h.home, 'hh'), ['alpha', 'beta']);
    const libs = ['alpha', 'beta'].map((w) => fs.readFileSync(path.join(root, 'ccd', 'lib', `${w}.sh`), 'utf8'));
    const main = fs.readFileSync(path.join(root, 'ccd', 'ccd'), 'utf8');
    expect(readCcdProgram(path.join(root, 'ccd', 'ccd'))).toBe(spliceCcd(main, libs));
    expect(readCcdProgram(path.join(root, 'ccd', 'ccd'))).toContain('f_beta() {');
  });
});

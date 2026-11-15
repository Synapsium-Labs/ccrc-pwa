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
// This file is about the program's FILES: it copies ccd/ccd and its libraries into a fixture tree, and reads the loader's text.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, CCD_LIBS, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { CCD_LIB_FILES } from './consolidationCensus.js';
import { moveBase, programDump, treeAt, type Tree } from './ccdSplit.js';

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

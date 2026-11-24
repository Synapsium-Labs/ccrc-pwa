// docs-folder-read (X2 spec 2026-11-18 sections 4.1 and 4.3, plan Task P2.2, ccd half): the four reads of a registered outside
// folder (a tree of its six section directories, a show by fingerprint, a snapshot prepare and the frames of it), each
// re-resolving the label from the registry and re-running admission first. Every end-to-end case runs the SHIPPED
// dispatcher in a fixture HOME through `runCcdDocs` (the three poisons are `runCcdDocs`'s), never the live HOME; a folder is
// registered through `ccd docs-folder --add` in that HOME, as P2.1's cases do. Units import the helper (`unitJson`) for what
// a fixture cannot produce without root: a directory loop (a bind mount) and a mount below the folder that shows a
// protected directory, each made by swapping the one `fstat` the walker takes of an opened directory (`H.Sys.fstat`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { REAL_PYTHON3, parseOneLine, runCcdDocs, runCcdDocsEntry, type DocsRun } from './ccdDocsHelpers.js';
import { unitJson } from './docsHelperPy.js';
import { DOCS_RANGE_FRAME_BYTES } from '../../shared/docs.js';

type Answer = Record<string, unknown>;
type Entry = { section: string; path: string; kind: string; size: number | null; mtimeNs: string | null; fp: string | null };

const SECTION_DIR: Record<string, string> = {
  specs: 'docs/superpowers/specs', plans: 'docs/superpowers/plans', 'product-design': 'docs/product-design',
  conventions: 'docs/conventions', vision: 'docs/vision', promise: 'docs/promise',
};
const SHOW_MAX = 2_097_152;

let h: CcdHarness;
/** Every ccd run this case made, for the scan of what the answers carry. */
let runs: DocsRun[];
beforeEach(() => { h = makeCcdHarness('ccd-docs-folder-read-'); runs = []; });
afterEach(() => { h.cleanup(); });

const sha = (b: Buffer | string): string => crypto.createHash('sha256').update(b).digest('hex');
const registryDir = (): string => path.join(h.home, '.cc-sessions', 'docs-folders');
const cacheDir = (): string => path.join(h.home, '.cc-docs-range');
const mkdir = (...parts: string[]): string => {
  const p = path.join(h.home, ...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
};
const sleepMs = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/** A folder under the fixture HOME with the six section directories made, and `files` (section -> rel -> bytes) in them. */
function mkFolder(name: string, files: Record<string, Record<string, Buffer | string>> = {}): string {
  const root = mkdir('zqfix', name);
  for (const dir of Object.values(SECTION_DIR)) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const [section, rels] of Object.entries(files)) {
    for (const [rel, body] of Object.entries(rels)) put(root, section, rel, body);
  }
  return root;
}
/** One file of a section of the folder at `root`; the absolute path. */
function put(root: string, section: string, rel: string, body: Buffer | string): string {
  const p = path.join(root, SECTION_DIR[section]!, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}
const secPath = (root: string, section: string, rel = ''): string => path.join(root, SECTION_DIR[section]!, rel);

const ccd = (args: readonly string[], env: NodeJS.ProcessEnv = {}): DocsRun => {
  // `docs-folder` is protected (X2 P2.3) and starts privileged, as the installed direct entry starts it; the read verb
  // `docs-folder-read` stays ordinary and starts plain.
  const r = args[0] === 'docs-folder' ? runCcdDocsEntry(h, args, env) : runCcdDocs(h, args, env);
  runs.push(r);
  return r;
};
const addFolder = (label: string, p: string): Answer => parseOneLine(ccd(['docs-folder', '--add', label, '--path', p]));
const removeFolder = (label: string): Answer => parseOneLine(ccd(['docs-folder', '--remove', label]));
const rd = (label: string, op: string, rest: readonly string[] = []): DocsRun => ccd(['docs-folder-read', '--label', label, '--op', op, ...rest]);
const treeRun = (label: string): DocsRun => rd(label, 'tree');
const tree = (label: string): Answer => parseOneLine(treeRun(label));
const entriesOf = (a: Answer): Entry[] => a['entries'] as Entry[];
const showArgs = (section: string, rel: string, fp: string, max = SHOW_MAX): string[] =>
  ['--section', section, '--path', rel, '--fingerprint', fp, '--max-bytes', String(max)];
const show = (label: string, section: string, rel: string, fp: string, max = SHOW_MAX): Answer =>
  parseOneLine(rd(label, 'show', showArgs(section, rel, fp, max)));
const prepArgs = (section: string, rel: string, pin: string): string[] => ['--section', section, '--path', rel, '--pin', pin];
const prepare = (label: string, section: string, rel: string, pin: string): Answer =>
  parseOneLine(rd(label, 'prepare', prepArgs(section, rel, pin)));
const frameArgs = (section: string, rel: string, pin: string, snapshot: string, offset: number, length: number): string[] =>
  [...prepArgs(section, rel, pin), '--snapshot', snapshot, '--offset', String(offset), '--length', String(length)];
const frame = (label: string, section: string, rel: string, pin: string, snapshot: string, offset: number, length: number): Answer =>
  parseOneLine(rd(label, 'range', frameArgs(section, rel, pin, snapshot, offset, length)));
const statOf = (p: string): { size: bigint; mtimeNs: bigint } => {
  const st = fs.statSync(p, { bigint: true });
  return { size: st.size, mtimeNs: st.mtimeNs };
};
const statPin = (p: string): string => { const s = statOf(p); return `stat:${s.size}:${s.mtimeNs}`; };
const noSideEffects = (): void => {
  expect(fs.existsSync(registryDir()), 'no registry directory was made').toBe(false);
  expect(fs.existsSync(cacheDir()), 'no range cache was made').toBe(false);
};
/** One unit run on the helper's functions, on a ctx for the fixture HOME's own roots (the verb `docs-folder-read`). */
const ctxPy = (): string => [
  'import os',
  `home = ${JSON.stringify(h.home)}`,
  "ctx = H.Ctx('docs-folder-read', home + '/projects', home + '/worktrees', home + '/.cc-sessions', 0)",
].join('\n');
/** Python that swaps the one `fstat` the walker takes of a directory: any directory whose real inode is `target` is
 *  reported with the overrides `over` (a dict of st_ fields), which is what a bind mount at that place would show. */
const fakeFstatPy = (target: string, over: string): string => [
  'class Fake(object):',
  '    def __init__(self, st, over):',
  '        self._st = st',
  '        self.__dict__.update(over)',
  '    def __getattr__(self, n):',
  '        return getattr(self._st, n)',
  'class Mounted(H.Sys):',
  '    def fstat(self, fd):',
  '        st = os.fstat(fd)',
  `        return Fake(st, ${over}) if st.st_ino == ${target} else st`,
  'H.SYS = Mounted()',
].join('\n');

describe('docs-folder-read: the parser (X2 P2.2)', () => {
  const FP = 'f'.repeat(64);
  const PIN = `fp:${FP}`;
  it('folder read parser: every malformed shape and a second op is refused with the usage line, rc 1, empty stdout, no side effect', () => {
    const bad: string[][] = [
      [],
      ['--label'], ['--label', 'alpha'], ['--label', 'alpha', '--op'], ['--op', 'tree', '--label', 'alpha'],
      ['--label', 'alpha', '--op', 'tree', '--op', 'tree'], ['--label', 'alpha', '--op', 'tree', 'x'],
      ['--label', 'alpha', '--op', 'tree', '--op', 'show'], ['--label', 'alpha', '--op', 'show', '--op', 'tree'],
      ['--label', 'alpha', '--op', 'bogus'], ['--label', 'alpha', '--op', 'list'], ['--label', 'alpha', '--op', 'Tree'],
      ['--label', 'alpha', '--op', 'tree', '--section', 'specs'], ['--label', 'alpha', '--op', 'tree', '--label', 'alpha'],
      ['--label', 'alpha', '--label', 'beta', '--op', 'tree'], ['--lable', 'alpha', '--op', 'tree'],
      // show: 12 tokens in this order
      ['--label', 'alpha', '--op', 'show', ...showArgs('specs', 'a.md', FP).slice(0, 6)],
      ['--label', 'alpha', '--op', 'show', '--section', 'specs', '--path', 'a.md', '--pin', PIN, '--max-bytes', '9'],
      ['--label', 'alpha', '--op', 'show', ...showArgs('specs', 'a.md', FP), '--prepare'],
      ['--label', 'alpha', '--op', 'show', '--path', 'a.md', '--section', 'specs', '--fingerprint', FP, '--max-bytes', '9'],
      ...['0', '01', '012', '123456789', '-1', 'x', '', '1.5', '1 2'].map((n) => ['--label', 'alpha', '--op', 'show', ...showArgs('specs', 'a.md', FP, 1).slice(0, 7), n]),
      // prepare: 10 tokens
      ['--label', 'alpha', '--op', 'prepare', '--section', 'specs', '--path', 'a.md'],
      ['--label', 'alpha', '--op', 'prepare', ...prepArgs('specs', 'a.md', PIN), '--prepare'],
      ['--label', 'alpha', '--op', 'prepare', '--section', 'specs', '--path', 'a.md', '--fingerprint', FP],
      // range: 16 tokens
      ['--label', 'alpha', '--op', 'range', ...prepArgs('specs', 'a.md', PIN)],
      ['--label', 'alpha', '--op', 'range', ...prepArgs('specs', 'a.md', PIN), '--snapshot', 'a'.repeat(32), '--offset', '0'],
      ['--label', 'alpha', '--op', 'range', ...prepArgs('specs', 'a.md', PIN), '--snapshot', 'a'.repeat(32), '--length', '5', '--offset', '0'],
      ...[['01', '5'], ['-1', '5'], ['0', '0'], ['0', '05'], ['x', '5'], ['0', 'x'], ['', '5'], ['0', ''], ['00', '5']]
        .map(([o, l]) => ['--label', 'alpha', '--op', 'range', ...prepArgs('specs', 'a.md', PIN), '--snapshot', 'a'.repeat(32), '--offset', o!, '--length', l!]),
    ];
    for (const args of bad) {
      const r = ccd(['docs-folder-read', ...args]);
      const where = JSON.stringify(args);
      expect(r.code, `rc for ${where}`).toBe(1);
      expect(r.stdout, `stdout for ${where}`).toBe('');
      expect(r.stderr, `usage for ${where}`).toContain('usage: ccd docs-folder-read');
    }
    noSideEffects();
  });

  it('folder read parser: the label is checked first, then each value by its own word, and an unregistered label last', () => {
    const w = (args: readonly string[]): Answer => parseOneLine(ccd(['docs-folder-read', ...args]));
    for (const label of ['..', 'a/b', '.x', 'Upper', 'a'.repeat(33), '--op', '../victim', 'a b']) {
      expect(w(['--label', label, '--op', 'tree']), JSON.stringify(label)).toMatchObject({ v: 1, verb: 'docs-folder-read', ok: false, failure: 'bad-label' });
    }
    // the label first: a bad label before a bad section
    expect(w(['--label', 'Bad', '--op', 'prepare', ...prepArgs('nosuch', 'a.md', PIN)])).toMatchObject({ failure: 'bad-label' });
    // then argv order
    expect(w(['--label', 'alpha', '--op', 'show', ...showArgs('nosuch', '../x', 'zz')])).toMatchObject({ failure: 'bad-section' });
    expect(w(['--label', 'alpha', '--op', 'show', ...showArgs('specs', '../x', 'zz')])).toMatchObject({ failure: 'bad-path' });
    expect(w(['--label', 'alpha', '--op', 'show', ...showArgs('specs', 'a.md', 'zz')])).toMatchObject({ failure: 'bad-fingerprint' });
    expect(w(['--label', 'alpha', '--op', 'prepare', ...prepArgs('specs', 'a.md', 'blob:' + 'b'.repeat(40))])).toMatchObject({ failure: 'bad-fingerprint' });
    expect(w(['--label', 'alpha', '--op', 'prepare', ...prepArgs('specs', 'a.md', 'fp:zz')])).toMatchObject({ failure: 'bad-fingerprint' });
    expect(w(['--label', 'alpha', '--op', 'prepare', ...prepArgs('specs', 'a.md', 'stat:01:5')])).toMatchObject({ failure: 'bad-fingerprint' });
    expect(w(['--label', 'alpha', '--op', 'range', ...frameArgs('specs', 'a.md', PIN, 'nothex', 0, 1)])).toMatchObject({ failure: 'snapshot-gone' });
    // every value good, no such folder: unknown-folder, and nothing was created
    expect(w(['--label', 'alpha', '--op', 'tree'])).toMatchObject({ ok: false, failure: 'unknown-folder' });
    expect(w(['--label', 'alpha', '--op', 'show', ...showArgs('specs', 'a.md', FP)])).toMatchObject({ failure: 'unknown-folder' });
    expect(w(['--label', 'alpha', '--op', 'prepare', ...prepArgs('specs', 'a.md', PIN)])).toMatchObject({ failure: 'unknown-folder' });
    expect(w(['--label', 'alpha', '--op', 'range', ...frameArgs('specs', 'a.md', PIN, 'a'.repeat(32), 0, 1)])).toMatchObject({ failure: 'unknown-folder' });
    noSideEffects();
  });

  it('folder read parser: the verb is in ccd caps beside docs-folder', () => {
    const lines = runCcdDocs(h, ['caps']).stdout.split('\n');
    expect(lines).toContain('docs-folder-read');
    expect(lines).toContain('docs-folders-v1');
  });
});

describe('docs-folder-read: the tree and its wall (X2 P2.2)', () => {
  it('folder read: only the six sections list', () => {
    const root = mkFolder('zqproj', {
      specs: { 'a.md': 'A\n', 'sub/deep.md': 'deep\n' }, plans: { 'b.md': 'B\n' }, 'product-design': { 'c.md': 'C\n' },
      conventions: { 'd.md': 'D\n' }, vision: { 'e.md': 'E\n' }, promise: { 'f.md': 'F\n' },
    });
    // Files beside the sections, in docs/ outside them, and at the folder's root: none may ever appear.
    for (const rel of ['README.md', 'docs/x.md', 'docs/superpowers/y.md', 'docs/superpowers/specs-extra/z.md', 'notes/n.md', 'src/main.ts', 'docs/product-design-extra/q.md']) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), 'outside\n');
    }
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const r = treeRun('alpha');
    const a = parseOneLine(r);
    expect(a).toMatchObject({ v: 1, verb: 'docs-folder-read', ok: true, label: 'alpha', unlisted: { count: 0, byReason: {} } });
    expect(entriesOf(a).map((e) => `${e.section}:${e.path}`)).toEqual([
      'specs:a.md', 'specs:sub/deep.md', 'plans:b.md', 'product-design:c.md', 'conventions:d.md', 'vision:e.md', 'promise:f.md']);
    const e = entriesOf(a)[1]!;
    const file = secPath(root, 'specs', 'sub/deep.md');
    expect(e).toEqual({ section: 'specs', path: 'sub/deep.md', kind: 'file', size: 5, mtimeNs: String(statOf(file).mtimeNs), fp: sha('deep\n') });
    expect(Object.keys(e)).toEqual(['section', 'path', 'kind', 'size', 'mtimeNs', 'fp']);
    // A section directory that is absent is empty, and does not refuse.
    fs.rmSync(path.join(root, 'docs', 'promise'), { recursive: true });
    fs.rmSync(path.join(root, 'docs', 'superpowers', 'plans'), { recursive: true });
    const b = tree('alpha');
    expect(b).toMatchObject({ ok: true });
    expect(entriesOf(b).map((x) => x.section)).toEqual(['specs', 'specs', 'product-design', 'conventions', 'vision']);
  });

  it('folder read: a file above the hash ceiling or past the aggregate budget lists with its size and mtimeNs and no fp', () => {
    const big = Buffer.alloc(4_194_305, 7);
    const root = mkFolder('zqproj', { specs: { 'big.bin': big, 'small.md': 'S\n' } });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const es = entriesOf(tree('alpha'));
    expect(es.find((x) => x.path === 'big.bin')).toEqual({
      section: 'specs', path: 'big.bin', kind: 'file', size: 4_194_305, mtimeNs: String(statOf(secPath(root, 'specs', 'big.bin')).mtimeNs), fp: null });
    expect(es.find((x) => x.path === 'small.md')).toMatchObject({ kind: 'file', size: 2, fp: sha('S\n') });
    // Past the 32 MiB aggregate budget the rest list with no fp: nine files of the ceiling's size (4 MiB each) fill it.
    const fill = Buffer.alloc(4_194_304, 1);
    const files: Record<string, Buffer> = {};
    for (let i = 0; i < 10; i++) files[`f${i}.bin`] = fill;
    const root2 = mkFolder('zqbudget', { plans: files });
    expect(addFolder('beta', root2)).toMatchObject({ ok: true });
    const hashed = entriesOf(tree('beta')).filter((x) => x.fp !== null).length;
    expect(hashed, 'eight files of 4 MiB fit the 32 MiB budget, the other two list without a fingerprint').toBe(8);
    expect(entriesOf(tree('beta')).filter((x) => x.fp === null && x.size === 4_194_304 && x.mtimeNs !== null)).toHaveLength(2);
  });

  it('folder read: a hardlinked file lists as hardlink with no size and no fingerprint, never read', () => {
    const root = mkFolder('zqproj', { specs: { 'a.md': 'A\n' } });
    fs.linkSync(secPath(root, 'specs', 'a.md'), path.join(h.home, 'zqfix', 'zqotherlink'));
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    expect(entriesOf(tree('alpha'))).toEqual([{ section: 'specs', path: 'a.md', kind: 'hardlink', size: null, mtimeNs: null, fp: null }]);
  });

  it('folder read: a component swapped for a symlink after add refuses', () => {
    const outer = mkdir('zqfix', 'zqouter', 'zqinner');
    const root = path.join(outer, 'zqproj');
    fs.mkdirSync(root);
    for (const dir of Object.values(SECTION_DIR)) fs.mkdirSync(path.join(root, dir), { recursive: true });
    put(root, 'specs', 'a.md', 'A\n');
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    expect(tree('alpha')).toMatchObject({ ok: true });
    // A component of the registered path itself is replaced by a symlink to a real copy.
    fs.renameSync(outer, `${outer}-real`);
    fs.symlinkSync(`${outer}-real`, outer);
    const fp = sha('A\n');
    for (const r of [treeRun('alpha'), rd('alpha', 'show', showArgs('specs', 'a.md', fp)), rd('alpha', 'prepare', prepArgs('specs', 'a.md', `fp:${fp}`))]) {
      expect(parseOneLine(r)).toMatchObject({ ok: false, failure: 'symlink-in-path' });
      expect(r.stdout).not.toContain('zqouter');
    }
  });

  it('folder read: docs/superpowers below the folder swapped for a symlink after add refuses', () => {
    // M11.2: admission from `/` never sees a directory BELOW the folder, so the walk below the held descriptor is the wall.
    const root = mkFolder('zqproj', { specs: { 'a.md': 'A\n' }, plans: { 'p.md': 'P\n' } });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    expect(entriesOf(tree('alpha'))).toHaveLength(2);
    // The symlink points at a real directory that holds docs, so a walk by path string would read and list them.
    const elsewhere = mkdir('zqfix', 'zqelsewhere', 'superpowers');
    fs.mkdirSync(path.join(elsewhere, 'specs'), { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'specs', 'secret.md'), 'S\n');
    fs.writeFileSync(path.join(elsewhere, 'specs', 'a.md'), 'A\n');
    fs.rmSync(path.join(root, 'docs', 'superpowers'), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(root, 'docs', 'superpowers'));
    const r = treeRun('alpha');
    expect(parseOneLine(r)).toMatchObject({ ok: false, failure: 'symlink-in-path' });
    expect(r.stdout).not.toContain('secret.md');
    expect(r.stdout).not.toContain('zqelsewhere');
    // A show, and a prepare, of a file the symlink would reach refuse as well, with the same word.
    for (const run of [rd('alpha', 'show', showArgs('specs', 'secret.md', sha('S\n'))), rd('alpha', 'prepare', prepArgs('specs', 'a.md', `fp:${sha('A\n')}`))]) {
      expect(parseOneLine(run)).toMatchObject({ ok: false, failure: 'symlink-in-path' });
    }
    // `docs` itself, and a section directory itself, swapped alike.
    fs.rmSync(path.join(root, 'docs', 'superpowers'));
    fs.mkdirSync(path.join(root, 'docs', 'superpowers', 'specs'), { recursive: true });
    expect(tree('alpha')).toMatchObject({ ok: true });
    fs.rmSync(path.join(root, 'docs', 'superpowers', 'specs'), { recursive: true });
    fs.symlinkSync(path.join(elsewhere, 'specs'), path.join(root, 'docs', 'superpowers', 'specs'));
    expect(tree('alpha')).toMatchObject({ ok: false, failure: 'symlink-in-path' });
    fs.rmSync(path.join(root, 'docs', 'superpowers', 'specs'));
    fs.mkdirSync(path.join(root, 'docs', 'superpowers', 'specs'));
    const real = mkdir('zqfix', 'zqdocs', 'product-design');
    fs.rmSync(path.join(root, 'docs'), { recursive: true });
    fs.symlinkSync(path.dirname(real), path.join(root, 'docs'));
    expect(tree('alpha')).toMatchObject({ ok: false, failure: 'symlink-in-path' });
  });

  it('folder read: an escaping symlink is listed, never read', () => {
    const outside = path.join(h.home, 'zqfix', 'zqoutside.txt');
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, 'outside secret\n');
    const outDir = mkdir('zqfix', 'zqoutdir');
    fs.writeFileSync(path.join(outDir, 'inner.md'), 'inner\n');
    const root = mkFolder('zqproj', { specs: { 'a.md': 'A\n' } });
    fs.symlinkSync(outside, secPath(root, 'specs', 'esc.md'));
    fs.symlinkSync(outDir, secPath(root, 'specs', 'escdir'));
    fs.symlinkSync('a.md', secPath(root, 'specs', 'inside.md'));
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const r = treeRun('alpha');
    expect(entriesOf(parseOneLine(r))).toEqual([
      { section: 'specs', path: 'a.md', kind: 'file', size: 2, mtimeNs: String(statOf(secPath(root, 'specs', 'a.md')).mtimeNs), fp: sha('A\n') },
      { section: 'specs', path: 'esc.md', kind: 'symlink', size: null, mtimeNs: null, fp: null },
      { section: 'specs', path: 'escdir', kind: 'symlink', size: null, mtimeNs: null, fp: null },
      { section: 'specs', path: 'inside.md', kind: 'symlink', size: null, mtimeNs: null, fp: null },
    ]);
    expect(r.stdout).not.toContain('inner.md');
    // A show, a prepare and a frame of a symlink refuse, and what they say names no byte of the target.
    const fpOutside = sha('outside secret\n');
    for (const rel of ['esc.md', 'inside.md']) {
      const s = rd('alpha', 'show', showArgs('specs', rel, fpOutside));
      expect(parseOneLine(s), `show ${rel}`).toMatchObject({ ok: false, failure: 'not-a-file', kind: 'symlink' });
      expect(s.stdout).not.toContain('outside secret');
      expect(parseOneLine(rd('alpha', 'prepare', prepArgs('specs', rel, `fp:${fpOutside}`))), `prepare ${rel}`).toMatchObject({ failure: 'not-a-file', kind: 'symlink' });
      expect(parseOneLine(rd('alpha', 'prepare', prepArgs('specs', rel, statPin(outside)))), `stat prepare ${rel}`).toMatchObject({ failure: 'not-a-file', kind: 'symlink' });
    }
    // A file below a symlinked directory is not reached either.
    expect(parseOneLine(rd('alpha', 'show', showArgs('specs', 'escdir/inner.md', sha('inner\n'))))).toMatchObject({ ok: false, failure: 'symlink-in-path' });
    expect(fs.existsSync(cacheDir()), 'a refused prepare made no cache').toBe(false);
  });

  it('folder read: a FIFO is listed, never opened', () => {
    const root = mkFolder('zqproj', { specs: { 'a.md': 'A\n' } });
    execFileSync('mkfifo', [secPath(root, 'specs', 'pipe')]);
    execFileSync('mkfifo', [secPath(root, 'plans', 'pipe2')]);
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    // PROOF THAT NOTHING OPENED IT: a writer blocks in its open(O_WRONLY) of `pipe` until some process opens the FIFO for
    // reading, and then writes a marker file. A reader's open (even a non-blocking one that closes at once) would release it,
    // so a marker that is absent after the calls says no call opened the FIFO.
    const marker = path.join(h.home, 'zqfifo-opened');
    const writer = spawn(REAL_PYTHON3, ['-c', [
      'import os',
      `fd = os.open(${JSON.stringify(secPath(root, 'specs', 'pipe'))}, os.O_WRONLY)`,
      `open(${JSON.stringify(marker)}, 'w').close()`,
    ].join('\n')], { stdio: 'ignore' });
    sleepMs(500);
    try {
      expect(fs.existsSync(marker), 'the writer is blocked in its open before any call').toBe(false);
      const probe = rd('alpha', 'show', showArgs('specs', 'pipe', 'a'.repeat(64)));
      expect(parseOneLine(probe)).toMatchObject({ ok: false, failure: 'not-a-file', kind: 'special' });
      expect(parseOneLine(rd('alpha', 'prepare', prepArgs('specs', 'pipe', 'stat:0:5')))).toMatchObject({ ok: false, failure: 'not-a-file', kind: 'special' });
      expect(parseOneLine(treeRun('alpha'))).toMatchObject({ ok: true });
      sleepMs(700);
      expect(fs.existsSync(marker), 'no call opened the FIFO: its writer is still blocked').toBe(false);
    } finally {
      // Release the writer by reading, then reap it.
      try { fs.closeSync(fs.openSync(secPath(root, 'specs', 'pipe'), fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)); } catch { /* gone */ }
      writer.kill('SIGKILL');
    }
    const t0 = Date.now();
    const r = treeRun('alpha');
    expect(Date.now() - t0, 'the call came back well inside its deadline: nothing opened the FIFO').toBeLessThan(15_000);
    expect(parseOneLine(r)).toMatchObject({ ok: true });
    expect(entriesOf(parseOneLine(r)).filter((e) => e.kind === 'special')).toEqual([
      { section: 'specs', path: 'pipe', kind: 'special', size: null, mtimeNs: null, fp: null },
      { section: 'plans', path: 'pipe2', kind: 'special', size: null, mtimeNs: null, fp: null },
    ]);
    // A show or a prepare of one refuses at once: the leaf opens non-blocking and its kind is withheld.
    const t1 = Date.now();
    expect(parseOneLine(rd('alpha', 'show', showArgs('specs', 'pipe', 'a'.repeat(64))))).toMatchObject({ ok: false, failure: 'not-a-file', kind: 'special' });
    expect(parseOneLine(rd('alpha', 'prepare', prepArgs('specs', 'pipe', 'stat:0:5')))).toMatchObject({ ok: false, failure: 'not-a-file', kind: 'special' });
    expect(Date.now() - t1).toBeLessThan(15_000);
  });

  it('folder read: a directory loop ends', () => {
    // Without root a bind mount cannot be made, so the walker's visited set is tested by swapping the one fstat it takes of
    // an opened directory: `specs/a/loop` is reported with the identity of `specs/a`, which is what a bind mount of `a` at
    // `a/loop` shows. The walk skips the revisit, counts it unlisted, and ends.
    const root = mkFolder('zqloop', { specs: { 'a/ok.md': 'ok\n', 'a/loop/inner.md': 'inner\n' } });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const got = unitJson<Answer>(h.home, [
      ctxPy(),
      "a = H.read_args('docs-folder-read', ['0', '--label', 'alpha', '--op', 'tree'])",
      `target = os.stat(${JSON.stringify(secPath(root, 'specs', 'a/loop'))}).st_ino`,
      `ancestor = os.stat(${JSON.stringify(secPath(root, 'specs', 'a'))}).st_ino`,
      fakeFstatPy('target', '{"st_ino": ancestor}'),
      'out(H.verb_folder_read(ctx, a))',
    ].join('\n'));
    expect(entriesOf(got).map((e) => e.path)).toEqual(['a/ok.md']);
    expect(got['unlisted']).toEqual({ count: 1, byReason: { 'too-deep': 1 } });
    // CONTROL: the same walk with no swap lists the file below `loop`.
    expect(entriesOf(tree('alpha')).map((e) => e.path)).toEqual(['a/loop/inner.md', 'a/ok.md']);
  });

  it('folder read: a directory below the folder that shows a protected directory refuses protected', () => {
    // A mount below the folder needs root. The walker compares each directory it opens with the protected set by device
    // and inode, so the same fstat swap stands in for a mount of `~/.ssh` at `specs/mnt`.
    const root = mkFolder('zqmnt', { specs: { 'a.md': 'A\n', 'mnt/x.md': 'x\n' } });
    const ssh = mkdir('.ssh');
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const got = unitJson<[string, unknown]>(h.home, [
      ctxPy(),
      "a = H.read_args('docs-folder-read', ['0', '--label', 'alpha', '--op', 'tree'])",
      `target = os.stat(${JSON.stringify(secPath(root, 'specs', 'mnt'))}).st_ino`,
      `real = os.stat(${JSON.stringify(ssh)})`,
      fakeFstatPy('target', '{"st_ino": real.st_ino, "st_dev": real.st_dev}'),
      'try:',
      "    out(['ok', H.verb_folder_read(ctx, a)])",
      'except H.Fail as f:',
      '    out([f.word, f.ctx])',
    ].join('\n'));
    expect(got).toEqual(['protected', { reason: 'ssh' }]);
  });

  it('protected comparison: a directory below the folder is compared by identity, HOME exactly refused', () => {
    const got = unitJson<(string | null)[]>(h.home, [
      ctxPy(),
      'prot = [((5, 99), "ssh"), ((5, 20), "dot-config"), ((5, 1), "home")]',
      'def below(ident):',
      '    return H.folder_protected_hit([ident], ident, prot)',
      'out([below((5, 20)), below((5, 99)), below((5, 1)), below((5, 2)), below((6, 20))])',
    ].join('\n'));
    expect(got).toEqual(['dot-config', 'ssh', 'home', null, null]);
  });

  it('folder read: dot components skipped', () => {
    // M11.4: a dot name is never listed and never opened, at any level.
    const root = mkFolder('zqproj', { specs: { 'a.md': 'A\n', 'sub/ok.md': 'ok\n' } });
    for (const [rel, body] of Object.entries({
      '.env': 'SECRET=1\n', '.x.md': 'x\n', '.git/config': 'cfg\n', '.hidden/x.md': 'h\n', 'sub/.secret.md': 's\n',
      'sub/.keys/id.md': 'k\n', 'sub/ok.md.bak': 'b\n',
    })) put(root, 'specs', rel, body);
    put(root, 'plans', '.dot.md', 'd\n');
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const a = tree('alpha');
    expect(entriesOf(a).map((e) => `${e.section}:${e.path}`)).toEqual(['specs:a.md', 'specs:sub/ok.md', 'specs:sub/ok.md.bak']);
    expect(a['unlisted'], 'a dot name is counted nowhere, so its existence is not told').toEqual({ count: 0, byReason: {} });
    // A show, a prepare and a frame of a dot path answer as an absent one does.
    for (const rel of ['.env', '.hidden/x.md', 'sub/.secret.md', 'sub/.keys/id.md']) {
      expect(parseOneLine(rd('alpha', 'show', showArgs('specs', rel, sha('x\n')))), `show ${rel}`).toMatchObject({ ok: false, failure: 'absent-path' });
      expect(parseOneLine(rd('alpha', 'prepare', prepArgs('specs', rel, `fp:${sha('x\n')}`))), `prepare ${rel}`).toMatchObject({ ok: false, failure: 'absent-path' });
    }
    expect(fs.existsSync(cacheDir()), 'no refused prepare made a cache entry').toBe(false);
  });

  it('folder read: a name the wire cannot carry is counted unlisted and never listed', () => {
    const root = mkFolder('zqproj', { specs: { 'a.md': 'A\n' } });
    fs.writeFileSync(secPath(root, 'specs', 'tab\there.md'), 't\n');
    // A name that is not UTF-8, written by its bytes (a string path would be encoded as UTF-8).
    fs.writeFileSync(Buffer.concat([Buffer.from(`${secPath(root, 'specs')}/`), Buffer.from([0x62, 0xff, 0x2e, 0x6d, 0x64])]), 'x\n');
    fs.mkdirSync(secPath(root, 'specs', 'new\nline'));
    fs.writeFileSync(path.join(secPath(root, 'specs', 'new\nline'), 'x.md'), 'x\n');
    // A path past 1024 bytes: fifteen nested directories of 70 bytes each, the last of which is already too long.
    const nest = Array.from({ length: 15 }, (_, i) => `${String(i).padStart(2, '0')}${'n'.repeat(68)}`).join('/');
    put(root, 'specs', `${nest}/y.md`, 'y\n');
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const a = tree('alpha');
    expect(entriesOf(a).map((e) => e.path)).toEqual(['a.md']);
    expect(a['unlisted']).toEqual({ count: 4, byReason: { 'invalid-utf8': 1, 'unsafe-char': 2, 'too-long': 1 } });
  });

  it('folder read: more than 5000 entries answers too-many-entries', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 5001; i++) files[`f${String(i).padStart(4, '0')}.md`] = 'x';
    const root = mkFolder('zqmany', { specs: files });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const a = tree('alpha');
    expect(a).toMatchObject({ v: 1, verb: 'docs-folder-read', ok: false, failure: 'too-many-entries' });
    expect(a['count'] as number).toBeGreaterThan(5000);
    // CONTROL: exactly 5000 lists.
    fs.rmSync(secPath(root, 'specs', 'f5000.md'));
    expect(entriesOf(tree('alpha'))).toHaveLength(5000);
  });

  it('folder read: an answer past the 1 MiB wire bound answers too-many-entries with fewer than 5000 entries', () => {
    // 2700 entries of 247-byte names frame past DOCS_MAX_LISTING_WIRE_BYTES (1 048 576), far below the entry cap.
    const files: Record<string, string> = {};
    for (let i = 0; i < 2700; i++) files[`${'n'.repeat(240)}${String(i).padStart(4, '0')}.md`] = 'x';
    const root = mkFolder('zqwide', { specs: files });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const a = tree('alpha');
    expect(a).toMatchObject({ v: 1, verb: 'docs-folder-read', ok: false, failure: 'too-many-entries', count: 2700 });
    expect(a['bytes'] as number, 'the framed bytes of the answer it would have been').toBeGreaterThan(1_048_576);
    // CONTROL: half of them frame inside the bound and list.
    for (let i = 1350; i < 2700; i++) fs.rmSync(secPath(root, 'specs', `${'n'.repeat(240)}${String(i).padStart(4, '0')}.md`));
    expect(entriesOf(tree('alpha'))).toHaveLength(1350);
  });

  it('folder read: a directory that cannot be opened lists as unreadable with its errno and the walk goes on', (ctx) => {
    if ((process.geteuid?.() ?? -1) === 0) ctx.skip(); // root opens any directory
    const root = mkFolder('zqproj', { specs: { 'a.md': 'A\n', 'locked/inner.md': 'i\n', 'z.md': 'Z\n' } });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const locked = secPath(root, 'specs', 'locked');
    const plans = secPath(root, 'plans');
    try {
      fs.chmodSync(locked, 0o000);
      const a = tree('alpha');
      expect(a).toMatchObject({ ok: true });
      expect(entriesOf(a).map((e) => `${e.path}:${e.kind}`)).toEqual(['a.md:file', 'locked:unreadable', 'z.md:file']);
      expect(entriesOf(a)[1]).toEqual({ section: 'specs', path: 'locked', kind: 'unreadable', size: null, mtimeNs: null, fp: null, errno: 'EACCES' });
      // The section's own chain is not a directory below it: an unreadable section directory still refuses the tree.
      fs.chmodSync(locked, 0o755);
      fs.chmodSync(plans, 0o000);
      expect(tree('alpha')).toMatchObject({ ok: false, failure: 'unreadable', reason: 'EACCES' });
    } finally {
      fs.chmodSync(locked, 0o755);
      fs.chmodSync(plans, 0o755);
    }
  });

  it('folder read: a directory on another device than the folder lists as other-device and is not opened', () => {
    // Without root no second device can be mounted, so the two arms are made by swapping what the walker is told:
    // `mnt1`'s lstat reports another device (and the walker must never open it), `mnt2`'s fstat does (opened, then listed).
    const root = mkFolder('zqdev', { specs: { 'a.md': 'A\n', 'mnt1/x.md': 'x\n', 'mnt2/y.md': 'y\n' } });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const got = unitJson<{ entries: Entry[]; opened: string[]; unlisted: unknown }>(h.home, [
      ctxPy(),
      "a = H.read_args('docs-folder-read', ['0', '--label', 'alpha', '--op', 'tree'])",
      `target = os.stat(${JSON.stringify(secPath(root, 'specs', 'mnt2'))}).st_ino`,
      'opened = []',
      'class Fake(object):',
      '    def __init__(self, st, over):',
      '        self._st = st',
      '        self.__dict__.update(over)',
      '    def __getattr__(self, n):',
      '        return getattr(self._st, n)',
      'class Mounted(H.Sys):',
      '    def lstat(self, path, dir_fd=None):',
      '        st = os.lstat(path, dir_fd=dir_fd)',
      "        return Fake(st, {'st_dev': st.st_dev + 1}) if path == 'mnt1' else st",
      '    def fstat(self, fd):',
      '        st = os.fstat(fd)',
      "        return Fake(st, {'st_dev': st.st_dev + 1}) if st.st_ino == target else st",
      '    def open(self, path, flags, dir_fd=None):',
      '        opened.append(path)',
      '        return os.open(path, flags, dir_fd=dir_fd)',
      'H.SYS = Mounted()',
      'r = H.verb_folder_read(ctx, a)',
      "out({'entries': r['entries'], 'opened': opened, 'unlisted': r['unlisted']})",
    ].join('\n'));
    expect(got.entries.map((e) => `${e.path}:${e.kind}`)).toEqual(['a.md:file', 'mnt1:other-device', 'mnt2:other-device']);
    expect(got.entries[1]).toEqual({ section: 'specs', path: 'mnt1', kind: 'other-device', size: null, mtimeNs: null, fp: null });
    expect(got.opened, 'mnt1 was never opened; mnt2 was, and its fstat then said another device').not.toContain('mnt1');
    expect(got.opened).toContain('mnt2');
    expect(got.unlisted).toEqual({ count: 0, byReason: {} });
  });

  it('folder read: the section chain is compared with the protected set and with the directories already visited', () => {
    // Each arm swaps the one fstat of one component of the section's own path (`docs`, `docs/superpowers`), as a mount of
    // another directory there would show it. Deleting either check of folder_section_open reds its arm.
    const root = mkFolder('zqchain', { specs: { 'a.md': 'A\n' }, plans: { 'p.md': 'P\n' }, 'product-design': { 'c.md': 'C\n' } });
    const ssh = mkdir('.ssh');
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const got = unitJson<[string, Answer][]>(h.home, [
      ctxPy(),
      "a = H.read_args('docs-folder-read', ['0', '--label', 'alpha', '--op', 'tree'])",
      `docs = os.stat(${JSON.stringify(path.join(root, 'docs'))}).st_ino`,
      `superpowers = os.stat(${JSON.stringify(path.join(root, 'docs', 'superpowers'))}).st_ino`,
      `rootst = os.stat(${JSON.stringify(root)})`,
      `sshst = os.stat(${JSON.stringify(ssh)})`,
      'class Fake(object):',
      '    def __init__(self, st, over):',
      '        self._st = st',
      '        self.__dict__.update(over)',
      '    def __getattr__(self, n):',
      '        return getattr(self._st, n)',
      'def run(target, over):',
      '    class Mounted(H.Sys):',
      '        def fstat(self, fd):',
      '            st = os.fstat(fd)',
      '            return Fake(st, over) if st.st_ino == target else st',
      '    H.SYS = Mounted()',
      '    try:',
      "        return ['ok', H.verb_folder_read(ctx, a)]",
      '    except H.Fail as f:',
      '        return [f.word, f.ctx]',
      "out([run(docs, {'st_ino': sshst.st_ino, 'st_dev': sshst.st_dev}), run(superpowers, {'st_ino': rootst.st_ino, 'st_dev': rootst.st_dev})])",
    ].join('\n'));
    expect(got[0]).toEqual(['protected', { reason: 'ssh' }]);
    // `docs/superpowers` shown as the folder itself is a loop: specs and plans, which reach it, are skipped and counted; the
    // sections that do not (product-design) list.
    expect(got[1]![0]).toBe('ok');
    expect(entriesOf(got[1]![1] as Answer).map((e) => `${e.section}:${e.path}`)).toEqual(['product-design:c.md']);
    expect((got[1]![1] as Answer)['unlisted']).toEqual({ count: 2, byReason: { 'too-deep': 2 } });
  });

  it('folder read: show and prepare of a file below a directory that shows a protected one refuse protected', () => {
    // The leaf's own walk compares each directory it opens with the protected set, as the tree walk does: `specs/mnt` is
    // reported as `~/.ssh` (the fstat swap), and a file that is really there below it is not read.
    const root = mkFolder('zqmnt', { specs: { 'a.md': 'A\n', 'mnt/x.md': 'x\n' } });
    const ssh = mkdir('.ssh');
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const fp = sha('x\n');
    expect(show('alpha', 'specs', 'mnt/x.md', fp), 'CONTROL: unswapped, the file is read').toMatchObject({ ok: true });
    const got = unitJson<[string, unknown][]>(h.home, [
      ctxPy(),
      `target = os.stat(${JSON.stringify(secPath(root, 'specs', 'mnt'))}).st_ino`,
      `real = os.stat(${JSON.stringify(ssh)})`,
      fakeFstatPy('target', '{"st_ino": real.st_ino, "st_dev": real.st_dev}'),
      `fp = ${JSON.stringify(fp)}`,
      "show = ['0', '--label', 'alpha', '--op', 'show', '--section', 'specs', '--path', 'mnt/x.md', '--fingerprint', fp, '--max-bytes', '1000']",
      "prep = ['0', '--label', 'alpha', '--op', 'prepare', '--section', 'specs', '--path', 'mnt/x.md', '--pin', 'fp:' + fp]",
      'res = []',
      'for argv in (show, prep):',
      '    a = H.read_args("docs-folder-read", argv)',
      '    try:',
      "        res.append(['ok', sorted(H.verb_folder_read(ctx, a))])",
      '    except H.Fail as f:',
      '        res.append([f.word, f.ctx])',
      'out(res)',
    ].join('\n'));
    expect(got).toEqual([['protected', { reason: 'ssh' }], ['protected', { reason: 'ssh' }]]);
    expect(fs.existsSync(cacheDir()), 'the refused prepare made no cache').toBe(false);
  });

  it('folder read: a section deeper than 16 levels is unlisted too-deep, never opened', () => {
    const deep = Array.from({ length: 16 }, (_, i) => `d${i}`).join('/');
    const root = mkFolder('zqproj', { specs: { 'a.md': 'A\n', [`${deep}/x.md`]: 'x\n' } });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const a = tree('alpha');
    expect(entriesOf(a).map((e) => e.path)).toEqual(['a.md']);
    expect(a['unlisted']).toEqual({ count: 1, byReason: { 'too-deep': 1 } });
    // CONTROL: one level less lists.
    const ok15 = Array.from({ length: 15 }, (_, i) => `e${i}`).join('/');
    put(root, 'specs', `${ok15}/y.md`, 'y\n');
    expect(entriesOf(tree('alpha')).map((e) => e.path)).toContain(`${ok15}/y.md`);
  });
});

describe('docs-folder-read: show, prepare and the frames (X2 P2.2)', () => {
  it('folder read: show by fingerprint ok, a changed file refused', () => {
    const root = mkFolder('zqproj', { specs: { 'a.md': '# A\n' } });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const file = secPath(root, 'specs', 'a.md');
    const fp = sha('# A\n');
    const ok = show('alpha', 'specs', 'a.md', fp);
    expect(ok).toMatchObject({
      v: 1, verb: 'docs-folder-read', ok: true, label: 'alpha', source: 'folder', section: 'specs', path: 'a.md', size: 4,
      sha256: fp, fp, encoding: 'utf8', text: '# A\n', mtimeNs: String(statOf(file).mtimeNs),
    });
    // A binary file comes back as base64.
    const bin = Buffer.from([0, 1, 2, 255, 254]);
    put(root, 'specs', 'b.bin', bin);
    expect(show('alpha', 'specs', 'b.bin', sha(bin))).toMatchObject({ ok: true, encoding: 'base64', b64: bin.toString('base64'), size: 5 });
    // The file changes: the same fingerprint no longer names it, and the answer says neither what it is nor how long.
    fs.writeFileSync(file, '# A changed\n');
    const changed = parseOneLine(rd('alpha', 'show', showArgs('specs', 'a.md', fp)));
    expect(changed).toMatchObject({ ok: false, failure: 'draft-changed', now: 'present' });
    expect(JSON.stringify(changed)).not.toContain(sha('# A changed\n'));
    fs.rmSync(file);
    expect(show('alpha', 'specs', 'a.md', fp)).toMatchObject({ ok: false, failure: 'draft-changed', now: 'absent' });
    // The class cap the server chose: a file over min(--max-bytes, the ceiling) is too-large before any read.
    put(root, 'specs', 'c.md', 'x'.repeat(100));
    expect(show('alpha', 'specs', 'c.md', sha('x'.repeat(100)), 99)).toMatchObject({ ok: false, failure: 'too-large', size: 100, cap: 99 });
    expect(show('alpha', 'specs', 'c.md', sha('x'.repeat(100)), 100)).toMatchObject({ ok: true, size: 100 });
    // A directory, and a path below a file, are not files.
    put(root, 'specs', 'dir/x.md', 'x\n');
    expect(show('alpha', 'specs', 'dir', fp)).toMatchObject({ ok: false, failure: 'not-a-file', kind: 'special' });
    expect(show('alpha', 'specs', 'c.md/x', fp)).toMatchObject({ ok: false, failure: 'not-a-file', kind: 'file-in-path' });
  });

  it('folder range: prepare then frames reassemble the file, by fingerprint and by stat', () => {
    const body = crypto.randomBytes(1_300_000);
    const root = mkFolder('zqproj', { plans: { 'big.bin': body } });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const file = secPath(root, 'plans', 'big.bin');
    for (const pin of [`fp:${sha(body)}`, statPin(file)]) {
      const prep = prepare('alpha', 'plans', 'big.bin', pin);
      expect(prep, pin).toMatchObject({ v: 1, verb: 'docs-folder-read', ok: true, size: body.length, digest: sha(body) });
      expect(String(prep['snapshot'])).toMatch(/^[0-9a-f]{32}$/);
      const parts: Buffer[] = [];
      for (let offset = 0; offset < body.length; offset += DOCS_RANGE_FRAME_BYTES) {
        const length = Math.min(DOCS_RANGE_FRAME_BYTES, body.length - offset);
        const f = frame('alpha', 'plans', 'big.bin', pin, String(prep['snapshot']), offset, length);
        expect(f).toMatchObject({ ok: true, snapshot: prep['snapshot'], offset, total: body.length });
        const raw = Buffer.from(String(f['bytesB64']), 'base64');
        expect(f['digest']).toBe(sha(raw));
        parts.push(raw);
      }
      expect(Buffer.concat(parts).equals(body), pin).toBe(true);
    }
    // A pin that does not name the file's bytes refuses, and a blob pin is not a pin of a folder file.
    expect(prepare('alpha', 'plans', 'big.bin', `fp:${'0'.repeat(64)}`)).toMatchObject({ ok: false, failure: 'draft-changed', now: 'present' });
    expect(prepare('alpha', 'plans', 'big.bin', `stat:${body.length}:1`)).toMatchObject({ ok: false, failure: 'draft-changed', now: 'present' });
    expect(prepare('alpha', 'plans', 'big.bin', `blob:${'b'.repeat(40)}`)).toMatchObject({ ok: false, failure: 'bad-fingerprint' });
  });

  it('folder range: a stat-pinned file above the hash ceiling prepares, and a frame of it is exact', () => {
    const big = Buffer.alloc(4_194_305, 3);
    big[4_194_304] = 9;
    const root = mkFolder('zqproj', { specs: { 'huge.bin': big } });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const e = entriesOf(tree('alpha'))[0]!;
    expect(e).toMatchObject({ path: 'huge.bin', size: 4_194_305, fp: null });
    const pin = `stat:${e.size}:${e.mtimeNs}`;
    // A show reads only by fingerprint, so the file is read through the range path.
    const prep = prepare('alpha', 'specs', 'huge.bin', pin);
    expect(prep).toMatchObject({ ok: true, size: 4_194_305, digest: sha(big) });
    const last = frame('alpha', 'specs', 'huge.bin', pin, String(prep['snapshot']), 4_194_304, 1);
    expect(last).toMatchObject({ ok: true, total: 4_194_305 });
    expect(Buffer.from(String(last['bytesB64']), 'base64')).toEqual(Buffer.from([9]));
    // The file changes after the listing: the stat pin no longer holds.
    fs.utimesSync(secPath(root, 'specs', 'huge.bin'), new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    expect(prepare('alpha', 'specs', 'huge.bin', pin)).toMatchObject({ ok: false, failure: 'draft-changed', now: 'present' });
  });

  it('folder range: a project snapshot id used in a folder frame refuses, and a folder snapshot in a project frame', () => {
    const root = mkFolder('zqproj', { specs: { 'a.md': 'A\n' } });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const pin = `fp:${sha('A\n')}`;
    const prep = prepare('alpha', 'specs', 'a.md', pin);
    const snap = String(prep['snapshot']);
    // The folder frame, as asked: served (the control that the refusals below are the binding).
    expect(frame('alpha', 'specs', 'a.md', pin, snap, 0, 2)).toMatchObject({ ok: true });
    // A project snapshot, planted in the cache's own format, bound to a project doc.
    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(cacheDir(), `${id}.bin`), 'A\n', { mode: 0o400 });
    const st = fs.statSync(path.join(cacheDir(), `${id}.bin`));
    fs.writeFileSync(path.join(cacheDir(), `${id}.meta`), JSON.stringify({
      id, size: 2, digest: sha('A\n'), used: Date.now(), ino: st.ino, mtime_ns: Math.floor(st.mtimeMs) * 1_000_000, ctime_ns: Math.floor(st.ctimeMs) * 1_000_000,
      bind: { project: 'demo', commit: 'c'.repeat(40), branch: null, head: null, section: 'specs', path: 'a.md', pin: `blob:${'b'.repeat(40)}` },
    }));
    expect(frame('alpha', 'specs', 'a.md', pin, id, 0, 2)).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    // The folder snapshot named in a project frame (committed shape), and in a draft frame.
    const committed = ['docs-show-range', '--project', 'demo', '--commit', 'c'.repeat(40), '--section', 'specs', '--path', 'a.md',
      '--pin', `blob:${'b'.repeat(40)}`, '--snapshot', snap, '--offset', '0', '--length', '2'];
    expect(parseOneLine(ccd(committed))).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    const draft = ['docs-show-range', '--project', 'demo', '--draft-branch', 'ws/a', '--head', 'c'.repeat(40), '--section', 'specs', '--path', 'a.md',
      '--pin', pin, '--snapshot', snap, '--offset', '0', '--length', '2'];
    expect(parseOneLine(ccd(draft))).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    // The folder snapshot is still served to its own request, so neither refusal dropped it.
    expect(frame('alpha', 'specs', 'a.md', pin, snap, 0, 2)).toMatchObject({ ok: true });
    // And a frame of another doc, another pin or another label names none of it.
    expect(frame('alpha', 'specs', 'b.md', pin, snap, 0, 2)).toMatchObject({ failure: 'snapshot-gone' });
    expect(frame('alpha', 'plans', 'a.md', pin, snap, 0, 2)).toMatchObject({ failure: 'snapshot-gone' });
    expect(frame('alpha', 'specs', 'a.md', statPin(secPath(root, 'specs', 'a.md')), snap, 0, 2)).toMatchObject({ failure: 'snapshot-gone' });
    const other = mkFolder('zqother', { specs: { 'a.md': 'A\n' } });
    expect(addFolder('beta', other)).toMatchObject({ ok: true });
    expect(frame('beta', 'specs', 'a.md', pin, snap, 0, 2)).toMatchObject({ failure: 'snapshot-gone' });
  });

  it('folder range: a frame after remove refuses', () => {
    // Remove purges the label's snapshots, so a frame with no admission would answer snapshot-gone. The word asserted is
    // `unknown-folder`, which only the label's re-resolution gives (folder_open runs before the cache is opened): M11.72.
    const root = mkFolder('zqproj', { specs: { 'a.md': 'A\n' } });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const pin = `fp:${sha('A\n')}`;
    const snap = String(prepare('alpha', 'specs', 'a.md', pin)['snapshot']);
    expect(removeFolder('alpha')).toMatchObject({ ok: true, removed: true });
    expect(frame('alpha', 'specs', 'a.md', pin, snap, 0, 2)).toMatchObject({ ok: false, failure: 'unknown-folder' });
    expect(fs.readdirSync(cacheDir()).filter((n) => n.startsWith(snap)), 'the purge removed the snapshot').toEqual([]);
  });

  it('folder range: a frame after the registry entry is gone refuses unknown-folder, though the snapshot survives', () => {
    // M11.72: standing in for a remove whose purge did not run. Only the label's re-resolution refuses here.
    const root = mkFolder('zqproj', { specs: { 'a.md': 'A\n' } });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const pin = `fp:${sha('A\n')}`;
    const snap = String(prepare('alpha', 'specs', 'a.md', pin)['snapshot']);
    fs.rmSync(path.join(registryDir(), 'alpha'));
    expect(fs.existsSync(path.join(cacheDir(), `${snap}.meta`)), 'the snapshot is still in the cache').toBe(true);
    const r = rd('alpha', 'range', frameArgs('specs', 'a.md', pin, snap, 0, 2));
    expect(parseOneLine(r)).toMatchObject({ ok: false, failure: 'unknown-folder' });
  });

  it('folder range: a frame after a component of the folder path is swapped for a symlink refuses symlink-in-path', () => {
    // M11.72: admission at the frame, which no snapshot or binding can stand in for.
    const outer = mkdir('zqfix', 'zqouter', 'zqinner');
    const root = path.join(outer, 'zqproj');
    fs.mkdirSync(root);
    for (const dir of Object.values(SECTION_DIR)) fs.mkdirSync(path.join(root, dir), { recursive: true });
    put(root, 'specs', 'a.md', 'A\n');
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const pin = `fp:${sha('A\n')}`;
    const snap = String(prepare('alpha', 'specs', 'a.md', pin)['snapshot']);
    expect(frame('alpha', 'specs', 'a.md', pin, snap, 0, 2), 'before the swap the frame is served').toMatchObject({ ok: true });
    fs.renameSync(path.join(h.home, 'zqfix', 'zqouter'), path.join(h.home, 'zqfix', 'zqouter-real'));
    fs.mkdirSync(path.join(h.home, 'zqfix', 'zqouter'));
    fs.symlinkSync(path.join(h.home, 'zqfix', 'zqouter-real', 'zqinner'), path.join(h.home, 'zqfix', 'zqouter', 'zqinner'));
    expect(fs.existsSync(path.join(cacheDir(), `${snap}.meta`)), 'the snapshot is still in the cache').toBe(true);
    expect(frame('alpha', 'specs', 'a.md', pin, snap, 0, 2)).toMatchObject({ ok: false, failure: 'symlink-in-path' });
  });

  it('folder range: a snapshot of a removed folder is not served to the same label re-added for another directory', () => {
    // The race the review named: a prepare in flight during Remove commits after the purge, so its snapshot survives the
    // remove. Standing in for it: the registry file is deleted directly (no purge) and the label added again for another
    // directory within the hour. The snapshot is bound to the folder's identity, so the frame refuses.
    const one = mkFolder('zqone', { specs: { 'a.md': 'A\n' } });
    const two = mkFolder('zqtwo', { specs: { 'a.md': 'A\n' } });
    expect(addFolder('alpha', one)).toMatchObject({ ok: true });
    const pin = `fp:${sha('A\n')}`;
    const snap = String(prepare('alpha', 'specs', 'a.md', pin)['snapshot']);
    fs.rmSync(path.join(registryDir(), 'alpha'));
    expect(addFolder('alpha', two)).toMatchObject({ ok: true });
    expect(fs.existsSync(path.join(cacheDir(), `${snap}.meta`))).toBe(true);
    expect(frame('alpha', 'specs', 'a.md', pin, snap, 0, 2)).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    // CONTROL: the same label back on the same directory serves it again (nothing dropped the snapshot).
    fs.rmSync(path.join(registryDir(), 'alpha'));
    expect(addFolder('alpha', one)).toMatchObject({ ok: true });
    expect(frame('alpha', 'specs', 'a.md', pin, snap, 0, 2)).toMatchObject({ ok: true });
  });

  it('folder range: a frame resolves its label before it takes the cache lock', () => {
    const root = mkFolder('zqproj', { specs: { 'a.md': 'A\n' } });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const pin = `fp:${sha('A\n')}`;
    const snap = String(prepare('alpha', 'specs', 'a.md', pin)['snapshot']);
    fs.rmSync(path.join(registryDir(), 'alpha'));
    const ready = path.join(h.home, 'zqholder-ready');
    // Another process holds the cache's own lock, as a prepare committing does.
    const child = spawn(REAL_PYTHON3, ['-c', [
      'import fcntl, os, time',
      `fd = os.open(${JSON.stringify(path.join(cacheDir(), 'lock'))}, os.O_RDWR | os.O_CREAT, 0o600)`,
      'fcntl.flock(fd, fcntl.LOCK_EX)',
      `open(${JSON.stringify(ready)}, 'w').close()`,
      'time.sleep(120)',
    ].join('\n')], { stdio: 'ignore' });
    try {
      for (let i = 0; i < 100 && !fs.existsSync(ready); i++) sleepMs(100);
      expect(fs.existsSync(ready), 'the holder has the cache lock').toBe(true);
      const t0 = Date.now();
      const f = frame('alpha', 'specs', 'a.md', pin, snap, 0, 2);
      expect(f, 'the label is refused before the cache lock is asked for, so a busy cache is never met').toMatchObject({ ok: false, failure: 'unknown-folder' });
      expect(Date.now() - t0).toBeLessThan(4_500);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('folder read: no read takes the registry lock', () => {
    // The lock order is registry then cache, and only a Remove holds both. A read resolves its label WITHOUT the registry's
    // lock, so one held by another process (an Add or Remove in flight) never delays a tree, a show, a prepare or a frame.
    const root = mkFolder('zqproj', { specs: { 'a.md': 'A\n' } });
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const pin = `fp:${sha('A\n')}`;
    const snap = String(prepare('alpha', 'specs', 'a.md', pin)['snapshot']);
    const ready = path.join(h.home, 'zqregholder-ready');
    const child = spawn(REAL_PYTHON3, ['-c', [
      'import fcntl, os, time',
      `fd = os.open(${JSON.stringify(path.join(registryDir(), '.lock'))}, os.O_RDWR | os.O_CREAT, 0o600)`,
      'fcntl.flock(fd, fcntl.LOCK_EX)',
      `open(${JSON.stringify(ready)}, 'w').close()`,
      'time.sleep(120)',
    ].join('\n')], { stdio: 'ignore' });
    try {
      for (let i = 0; i < 100 && !fs.existsSync(ready); i++) sleepMs(100);
      expect(fs.existsSync(ready), 'the holder has the registry lock').toBe(true);
      const t0 = Date.now();
      expect(tree('alpha')).toMatchObject({ ok: true });
      expect(show('alpha', 'specs', 'a.md', sha('A\n'))).toMatchObject({ ok: true });
      expect(prepare('alpha', 'specs', 'a.md', pin)).toMatchObject({ ok: true });
      expect(frame('alpha', 'specs', 'a.md', pin, snap, 0, 2)).toMatchObject({ ok: true });
      expect(Date.now() - t0, 'four reads, none waiting five seconds on the registry lock').toBeLessThan(4_500);
      // CONTROL: a writer does wait for it, and answers registry-busy once its wait is spent.
      expect(removeFolder('alpha')).toMatchObject({ ok: false, failure: 'unreadable', reason: 'registry-busy' });
    } finally {
      child.kill('SIGKILL');
    }
  });
});

describe('docs-folder-read: no path leaves ccd (X2 P2.2)', () => {
  it('folder read: no absolute path in any answer', () => {
    // M11.5: every answer shape of the verb, ok and refused, scanned for the fixture HOME, the folder's path and each
    // component of either longer than 3 characters.
    const outer = mkdir('zqfix', 'zqsecretouter');
    const root = path.join(outer, 'zqsecretfolder');
    fs.mkdirSync(root);
    for (const dir of Object.values(SECTION_DIR)) fs.mkdirSync(path.join(root, dir), { recursive: true });
    const body = 'A\n'.repeat(100);
    const file = put(root, 'specs', 'a.md', body);
    put(root, 'specs', 'sub/b.md', 'B\n');
    fs.symlinkSync(file, secPath(root, 'specs', 'link.md'));
    execFileSync('mkfifo', [secPath(root, 'specs', 'pipe')]);
    fs.writeFileSync(secPath(root, 'specs', `bad\tname.md`), 'x\n');
    expect(addFolder('alpha', root)).toMatchObject({ ok: true });
    const pin = `fp:${sha(body)}`;
    // Every answer shape of the verb.
    expect(tree('alpha')).toMatchObject({ ok: true });
    expect(show('alpha', 'specs', 'a.md', sha(body))).toMatchObject({ ok: true });
    const prep = prepare('alpha', 'specs', 'a.md', pin);
    expect(prep).toMatchObject({ ok: true });
    expect(frame('alpha', 'specs', 'a.md', pin, String(prep['snapshot']), 0, 10)).toMatchObject({ ok: true });
    // Every refusal shape: bad values, an unknown label, a symlink, a FIFO, an absent file, a changed file, a stale snapshot, a
    // too-large file, a snapshot of another doc, and a swapped component.
    rd('Bad', 'tree');
    rd('nosuch', 'tree');
    rd('alpha', 'show', showArgs('nosuch', 'a.md', sha(body)));
    show('alpha', 'specs', 'link.md', sha(body));
    show('alpha', 'specs', 'pipe', sha(body));
    show('alpha', 'specs', 'absent.md', sha(body));
    show('alpha', 'specs', 'sub/../a.md', sha(body));
    show('alpha', 'specs', 'a.md', '0'.repeat(64));
    show('alpha', 'specs', 'a.md', sha(body), 5);
    prepare('alpha', 'specs', 'a.md', `fp:${'0'.repeat(64)}`);
    prepare('alpha', 'specs', 'link.md', statPin(file));
    frame('alpha', 'specs', 'a.md', pin, 'f'.repeat(32), 0, 1);
    frame('alpha', 'specs', 'sub/b.md', pin, String(prep['snapshot']), 0, 1);
    frame('alpha', 'specs', 'a.md', pin, String(prep['snapshot']), 0, 99999);
    fs.renameSync(outer, `${outer}-gone`);
    fs.mkdirSync(outer);
    fs.symlinkSync(path.join(`${outer}-gone`, 'zqsecretfolder'), root);
    tree('alpha');
    show('alpha', 'specs', 'a.md', sha(body));
    frame('alpha', 'specs', 'a.md', pin, String(prep['snapshot']), 0, 1);
    fs.rmSync(root);
    fs.renameSync(`${outer}-gone`, `${outer}-swapped`);
    tree('alpha');
    prepare('alpha', 'specs', 'a.md', pin);
    // The scan.
    const words = new Set([...Object.keys(SECTION_DIR), 'docs', 'superpowers']);
    const needles = [h.home, root, outer, path.dirname(h.home), ...[h.home, root].flatMap((p) => p.split('/')).filter((c) => c.length > 3 && !words.has(c))];
    expect(runs.length, 'every shape ran').toBeGreaterThan(20);
    const seen = runs.flatMap((r) => needles.filter((n) => (r.stdout + r.stderr).includes(n)).map((n) => `${n} in ${r.stdout.slice(0, 160)}`));
    expect(seen).toEqual([]);
    // CONTROL: the same needles find the registered path in the list answer of docs-folder, the one answer that carries it.
    const listed = ccd(['docs-folder', '--list']);
    expect(needles.some((n) => listed.stdout.includes(n))).toBe(true);
    expect(listed.stdout).toContain(root);
  });
});

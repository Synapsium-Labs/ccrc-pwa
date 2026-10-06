// docs-show, the COMMITTED pin (spec 2026-10-01 §2 (e) CommittedPin and its provenance, §2 (f) Committed and
// Encoding, §2 (b)'s show guard, §6.1 `--max-bytes`; rows 15, 16, 24, 25, 26, 29, 58 and 65, M6.6 and M6.7).
// Every end-to-end case runs the SHIPPED dispatcher in a fixture HOME through `runCcdDocs`. The helper's git calls
// are python subprocesses, which the bash-function stub idiom cannot see, so the PATH recorder
// (`plantGitRecorder`) is what proves a call did or did not happen. Units import the helper itself (`unitJson`)
// for what a fixture repository cannot produce. Task 17 appends the draft pin's cases below this file's end.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import {
  commitDocs, docsRepo, parseOneLine, plantGitRecorder, runCcdDocs, type DocsRun, type RecordedGitCall,
} from './ccdDocsHelpers.js';
import { unitJson } from './docsHelperPy.js';
import {
  DOCS_ENVELOPE_RESERVE, DOCS_MAX_ANSWER_BYTES, DOCS_MAX_DOC_BYTES, DOCS_MAX_FILE_BYTES, DOCS_MAX_IMAGE_BYTES,
} from '../../shared/docs.js';

const MAIN = 'refs/remotes/origin/main';
const SPECS = 'docs/superpowers/specs';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccd-docs-'); });
afterEach(() => { h.cleanup(); });

interface ShowOpts { ref?: string; max?: string; env?: NodeJS.ProcessEnv }

/** The committed argv, exactly the 12 tokens `docs-v1` names. `--max-bytes` defaults to the class cap the server
 *  sends for Markdown. */
const showArgs = (commit: string, section: string, p: string, o: ShowOpts = {}): string[] => [
  'docs-show', '--project', 'demo', '--commit', commit, '--ref', o.ref ?? MAIN,
  '--section', section, '--path', p, '--max-bytes', o.max ?? String(DOCS_MAX_DOC_BYTES)];
const show = (commit: string, section: string, p: string, o: ShowOpts = {}): DocsRun =>
  runCcdDocs(h, showArgs(commit, section, p, o), o.env ?? {});

const head = (dir: string): string => h.git(dir, 'rev-parse', 'HEAD');
const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');
/** The bytes an ok answer carries, decoded the way the server decodes them. */
const bytesOf = (o: Record<string, unknown>): Buffer => (o['encoding'] === 'utf8'
  ? Buffer.from(String(o['text']), 'utf8') : Buffer.from(String(o['b64']), 'base64'));
/** The stdout line's length once the agent JSON-encodes it inside its frame (§2 (b)). */
const framed = (r: DocsRun): number => Buffer.byteLength(JSON.stringify(r.stdout.slice(0, -1)), 'utf8');
/** A PNG signature followed by filler: `size` bytes, and not UTF-8 (0x89 cannot start a sequence). */
const pngOf = (size: number): Buffer =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size - 8, 0x41)]);

/** A recorded call's subcommand and its arguments: what follows the hardened prefix's `-C <dir>`. */
const sub = (c: RecordedGitCall): string[] => c.argv.slice(c.argv.indexOf('-C') + 2);
const blobReads = (calls: RecordedGitCall[]): RecordedGitCall[] =>
  calls.filter((c) => sub(c)[0] === 'cat-file' && sub(c)[1] === 'blob');

describe('docs-show committed: size before read (M6.6, row 26)', () => {
  it('a PNG one byte over --max-bytes answers too-large {size, cap}, and git never reads the blob', () => {
    const main = docsRepo(h, 'demo', { [`${SPECS}/big.png`]: pngOf(DOCS_MAX_IMAGE_BYTES + 1) });
    const rec = plantGitRecorder(h.home);
    const o = parseOneLine(show(head(main), 'specs', 'big.png', { max: String(DOCS_MAX_IMAGE_BYTES) }));
    expect(o).toMatchObject({
      v: 1, verb: 'docs-show', ok: false, failure: 'too-large', size: DOCS_MAX_IMAGE_BYTES + 1, cap: DOCS_MAX_IMAGE_BYTES,
    });
    // The recorder saw this run (a recorder that saw nothing would pass the next line vacuously).
    expect(rec.calls().some((c) => sub(c)[0] === 'ls-tree')).toBe(true);
    expect(blobReads(rec.calls())).toEqual([]);
  });

  it('exactly --max-bytes is served whole, as base64, with the sha256 of its bytes', () => {
    const png = pngOf(DOCS_MAX_IMAGE_BYTES);
    const main = docsRepo(h, 'demo', { [`${SPECS}/edge.png`]: png });
    const rec = plantGitRecorder(h.home);
    const o = parseOneLine(show(head(main), 'specs', 'edge.png', { max: String(DOCS_MAX_IMAGE_BYTES) }));
    expect(o).toMatchObject({ ok: true, source: 'committed', size: DOCS_MAX_IMAGE_BYTES, encoding: 'base64', sha256: sha(png) });
    expect(bytesOf(o).equals(png)).toBe(true);
    expect(blobReads(rec.calls())).toHaveLength(1);
  });

  it('--max-bytes 99999999 still meets the built-in ceiling: a ceiling-plus-one blob is too-large {cap: 4194304}', () => {
    const main = docsRepo(h, 'demo', { [`${SPECS}/huge.md`]: Buffer.alloc(DOCS_MAX_FILE_BYTES + 1, 0x61) });
    const rec = plantGitRecorder(h.home);
    expect(parseOneLine(show(head(main), 'specs', 'huge.md', { max: '99999999' }))).toMatchObject({
      ok: false, failure: 'too-large', size: DOCS_MAX_FILE_BYTES + 1, cap: DOCS_MAX_FILE_BYTES,
    });
    expect(blobReads(rec.calls())).toEqual([]);
  });

  it('a bad N is the front\'s usage error: rc 1, an empty stdout and a usage line', () => {
    const r = show('a'.repeat(40), 'specs', 'a.md', { max: '012' });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('usage: ccd docs-show');
  });

  it('CCD_DOCS_MAX_FILE_BYTES=1000 lowers the ceiling: 1001 bytes are too-large {cap: 1000} unread, 1000 are served', () => {
    const main = docsRepo(h, 'demo', { [`${SPECS}/k1001.md`]: 'x'.repeat(1001), [`${SPECS}/k1000.md`]: 'x'.repeat(1000) });
    const rec = plantGitRecorder(h.home);
    const env = { CCD_DOCS_MAX_FILE_BYTES: '1000' };
    expect(parseOneLine(show(head(main), 'specs', 'k1001.md', { env }))).toMatchObject({
      ok: false, failure: 'too-large', size: 1001, cap: 1000,
    });
    expect(blobReads(rec.calls())).toEqual([]);
    expect(parseOneLine(show(head(main), 'specs', 'k1000.md', { env }))).toMatchObject({ ok: true, size: 1000 });
  });

  it('CCD_DOCS_MAX_FILE_BYTES=999999999 cannot raise the ceiling', () => {
    const main = docsRepo(h, 'demo', { [`${SPECS}/huge.md`]: Buffer.alloc(DOCS_MAX_FILE_BYTES + 1, 0x61) });
    const o = parseOneLine(show(head(main), 'specs', 'huge.md',
      { max: '99999999', env: { CCD_DOCS_MAX_FILE_BYTES: '999999999' } }));
    expect(o).toMatchObject({ ok: false, failure: 'too-large', size: DOCS_MAX_FILE_BYTES + 1, cap: DOCS_MAX_FILE_BYTES });
  });

  it.each(['abc', '-1', '1e3'])('a CCD_DOCS_MAX_FILE_BYTES that is not all digits (%s) is ignored', (v) => {
    const main = docsRepo(h, 'demo', { [`${SPECS}/k1001.md`]: 'x'.repeat(1001) });
    expect(parseOneLine(show(head(main), 'specs', 'k1001.md', { env: { CCD_DOCS_MAX_FILE_BYTES: v } })))
      .toMatchObject({ ok: true, size: 1001 });
  });
});

describe('docs-show committed: exact lookup, and the records never served (rows 24, 25)', () => {
  it('A.md asked for while a.md is committed is absent-path; a directory is not-a-file {directory}', () => {
    const main = docsRepo(h, 'demo', { [`${SPECS}/a.md`]: '# A\n', [`${SPECS}/sub/b.md`]: '# B\n' });
    const c = head(main);
    // CONTROL: both committed files are served, so the refusals below are about the lookup, not the fixture.
    expect(parseOneLine(show(c, 'specs', 'a.md'))).toMatchObject({ ok: true, text: '# A\n' });
    expect(parseOneLine(show(c, 'specs', 'sub/b.md'))).toMatchObject({ ok: true, text: '# B\n' });
    expect(parseOneLine(show(c, 'specs', 'A.md'))).toMatchObject({ ok: false, failure: 'absent-path' });
    expect(parseOneLine(show(c, 'specs', 'sub'))).toMatchObject({ ok: false, failure: 'not-a-file', kind: 'directory' });
    expect(parseOneLine(show(c, 'specs', 'su'))).toMatchObject({ ok: false, failure: 'absent-path' });
  });

  it('a committed symlink is not-a-file {symlink}, and neither its target nor the target\'s bytes reach stdout', () => {
    const main = docsRepo(h, 'demo', { 'outside-target.txt': 'TARGET-BYTES-NEVER-SERVED\n' });
    fs.mkdirSync(path.join(main, SPECS), { recursive: true });
    fs.symlinkSync('../../../outside-target.txt', path.join(main, SPECS, 'link.md'));
    h.git(main, 'add', '--', `${SPECS}/link.md`);
    h.git(main, 'commit', '-q', '-m', 'link');
    const rec = plantGitRecorder(h.home);
    const r = show(head(main), 'specs', 'link.md');
    expect(parseOneLine(r)).toMatchObject({ ok: false, failure: 'not-a-file', kind: 'symlink' });
    expect(r.stdout).not.toContain('TARGET-BYTES');
    expect(r.stdout).not.toContain('outside-target');
    expect(blobReads(rec.calls())).toEqual([]);
  });

  it('a gitlink is not-a-file {submodule}', () => {
    const main = docsRepo(h, 'demo');
    h.git(main, 'update-index', '--add', '--cacheinfo', `160000,${head(main)},${SPECS}/mod`);
    h.git(main, 'commit', '-q', '-m', 'gitlink');
    expect(parseOneLine(show(head(main), 'specs', 'mod'))).toMatchObject({ ok: false, failure: 'not-a-file', kind: 'submodule' });
  });

  it('a section committed as a symlink is not-a-file {section-not-a-directory}, though the link resolves on disk', () => {
    const main = docsRepo(h, 'demo', { [`${SPECS}/a.md`]: '# A\n' });
    fs.symlinkSync('specs', path.join(main, 'docs', 'superpowers', 'plans'));
    h.git(main, 'add', '--', 'docs/superpowers/plans');
    h.git(main, 'commit', '-q', '-m', 'plans is a link');
    // On disk plans/a.md IS specs/a.md; the committed lookup must never follow the link.
    expect(fs.readFileSync(path.join(main, 'docs', 'superpowers', 'plans', 'a.md'), 'utf8')).toBe('# A\n');
    expect(parseOneLine(show(head(main), 'plans', 'a.md')))
      .toMatchObject({ ok: false, failure: 'not-a-file', kind: 'section-not-a-directory' });
  });

  it('the `--` after --end-of-options is a literal pathspec, and its record is never served', () => {
    // Measured on git 2.43.0: `ls-tree ... --end-of-options <C> -- <section>` also lists a top-level path named
    // `--`, and it sorts before `docs/`, so a lookup that took the first record would serve it.
    const main = docsRepo(h, 'demo', { '--': 'DASHDASH-BYTES\n', [`${SPECS}/a.md`]: '# A\n' });
    const r = show(head(main), 'specs', 'a.md');
    expect(parseOneLine(r)).toMatchObject({ ok: true, text: '# A\n' });
    expect(r.stdout).not.toContain('DASHDASH');
  });
});

describe('docs-show committed: path values read by fixed index (row 58)', () => {
  it.each(['--commit', '-x'])('--path %s is a value, not a flag: absent-path, rc 0, one line', (p) => {
    const main = docsRepo(h, 'demo');
    const r = show(head(main), 'specs', p);
    expect(r.code, r.stderr).toBe(0);
    expect(parseOneLine(r)).toMatchObject({ v: 1, verb: 'docs-show', ok: false, failure: 'absent-path' });
  });
});

describe('docs-show committed: the encoding (row 29, M6.7)', () => {
  it('Markdown answers utf8, and size and sha256 are those of the decoded bytes', () => {
    const md = '# A\n\nprose, café — and "a quote"\n';
    const main = docsRepo(h, 'demo', { [`${SPECS}/a.md`]: md });
    const o = parseOneLine(show(head(main), 'specs', 'a.md'));
    expect(o).toMatchObject({ ok: true, source: 'committed', section: 'specs', path: 'a.md', encoding: 'utf8', text: md });
    expect(o).not.toHaveProperty('b64');
    const b = bytesOf(o);
    expect(o['size']).toBe(b.length);
    expect(o['sha256']).toBe(sha(b));
    expect(b.equals(Buffer.from(md, 'utf8'))).toBe(true);
  });

  it('a NUL byte forces base64, though the bytes are valid UTF-8 and utf8 would frame shorter', () => {
    // One NUL in 241 bytes of prose: the utf8 line frames shorter than the base64 one, so only the NUL rule can
    // choose base64 here (a short `ab\0` would go base64 on the framed comparison alone, and pin nothing).
    const raw = Buffer.from(`${'prose '.repeat(20)}\u0000${'prose '.repeat(20)}`, 'utf8');
    const main = docsRepo(h, 'demo', { [`${SPECS}/nul.md`]: raw });
    const o = parseOneLine(show(head(main), 'specs', 'nul.md'));
    expect(o).toMatchObject({ ok: true, encoding: 'base64', size: raw.length, sha256: sha(raw) });
    expect(o).not.toHaveProperty('text');
    expect(bytesOf(o).equals(raw)).toBe(true);
  });

  it('a ceiling-sized file of quote bytes answers base64, and the whole stdout stays under DOCS_MAX_ANSWER_BYTES', () => {
    const quotes = Buffer.alloc(DOCS_MAX_FILE_BYTES, 0x22);
    const main = docsRepo(h, 'demo', { [`${SPECS}/q.md`]: quotes });
    const r = show(head(main), 'specs', 'q.md', { max: String(DOCS_MAX_FILE_BYTES) });
    const o = parseOneLine(r);
    expect(o).toMatchObject({ ok: true, encoding: 'base64', size: DOCS_MAX_FILE_BYTES, sha256: sha(quotes) });
    expect(Buffer.byteLength(r.stdout, 'utf8')).toBeLessThan(DOCS_MAX_ANSWER_BYTES);
    expect(framed(r)).toBeLessThanOrEqual(4 * Math.ceil(DOCS_MAX_FILE_BYTES / 3) + DOCS_ENVELOPE_RESERVE);
  });

  it('M6.7: a 3 MiB text with a quote in every three characters answers base64, framed within the bound', () => {
    const text = Buffer.from('ab"'.repeat(1048576), 'utf8');
    const main = docsRepo(h, 'demo', { [`${SPECS}/third.md`]: text });
    const r = show(head(main), 'specs', 'third.md', { max: String(DOCS_MAX_FILE_BYTES) });
    const o = parseOneLine(r);
    expect(o).toMatchObject({ ok: true, encoding: 'base64', size: text.length, sha256: sha(text) });
    expect(framed(r)).toBeLessThanOrEqual(4 * Math.ceil(text.length / 3) + DOCS_ENVELOPE_RESERVE);
  });

  it('CONTROL (M6.7): the singly escaped comparison would have picked utf8 for it, at a frame over the answer cap', () => {
    const o = unitJson<{ picked: string; singly: string; framedUtf8: number; framedB64: number }>(h.home, [
      'import base64, hashlib',
      "data = b'ab\"' * 1048576",
      "base = {'source': 'committed', 'section': 'specs', 'path': 'third.md', 'size': len(data),",
      "        'sha256': hashlib.sha256(data).hexdigest()}",
      "u = H.line_of(dict(base, encoding='utf8', text=data.decode('utf-8')))",
      "b = H.line_of(dict(base, encoding='base64', b64=base64.b64encode(data).decode('ascii')))",
      "out({'picked': H.encode_show(data, base)['encoding'], 'singly': 'utf8' if len(u) <= len(b) else 'base64',",
      "     'framedUtf8': H.framed_len(u), 'framedB64': H.framed_len(b)})",
    ].join('\n'));
    expect(o.picked).toBe('base64');
    expect(o.singly).toBe('utf8');
    expect(o.framedUtf8).toBeGreaterThan(DOCS_MAX_ANSWER_BYTES);
    expect(o.framedB64).toBeLessThanOrEqual(4 * Math.ceil(3145728 / 3) + DOCS_ENVELOPE_RESERVE);
  });

  it('encode_show: utf8 only for strict UTF-8 with no NUL; the other shapes are base64, carrying base through', () => {
    const rows: [string, string][] = [
      ['prose', Buffer.from('# prose\n', 'utf8').toString('hex')],
      ['two-byte UTF-8', Buffer.from('café', 'utf8').toString('hex')],
      ['one NUL in prose that utf8 would frame shorter', `${'78'.repeat(64)}00${'79'.repeat(64)}`],
      ['a lone 0xff', 'ff'],
      ['an encoded surrogate, which only a lax decoder admits', 'eda080'],
      ['an overlong slash', 'c0af'],
    ];
    const got = unitJson<[string, boolean, boolean, number][]>(h.home, [
      `rows = ${JSON.stringify(rows.map((r) => r[1]))}`,
      'res = []',
      'for hx in rows:',
      "    o = H.encode_show(bytes.fromhex(hx), {'k': 1})",
      "    res.append([o['encoding'], 'text' in o, 'b64' in o, o['k']])",
      'out(res)',
    ].join('\n'));
    expect(got).toEqual([
      ['utf8', true, false, 1], ['utf8', true, false, 1],
      ['base64', false, true, 1], ['base64', false, true, 1], ['base64', false, true, 1], ['base64', false, true, 1],
    ]);
  });
});

describe('docs-show committed: the final guard (§2 (b))', () => {
  it('a line framed over DOCS_MAX_ANSWER_BYTES becomes too-large {bytes, cap}; a line under it is returned as is', () => {
    const o = unitJson<{ raw: number; framed: number; guarded: Record<string, unknown>; same: boolean }>(h.home, [
      'import json',
      "big = H.line_of({'v': 1, 'verb': 'docs-show', 'ok': True, 'elapsedMs': 7, 'encoding': 'utf8', 'text': '\"' * 1600000})",
      "small = H.line_of({'v': 1, 'verb': 'docs-show', 'ok': True, 'elapsedMs': 7, 'encoding': 'utf8', 'text': 'x'})",
      "out({'raw': len(big), 'framed': H.framed_len(big), 'guarded': json.loads(H.guard_show(big).decode('utf-8')),",
      "     'same': H.guard_show(small) == small})",
    ].join('\n'));
    // CONTROL: the raw line is under the cap, so a raw-length guard would have let it through.
    expect(o.raw).toBeLessThan(DOCS_MAX_ANSWER_BYTES);
    expect(o.framed).toBeGreaterThan(DOCS_MAX_ANSWER_BYTES);
    expect(o.guarded).toEqual({
      v: 1, verb: 'docs-show', ok: false, elapsedMs: 7, failure: 'too-large', bytes: o.framed, cap: DOCS_MAX_ANSWER_BYTES,
    });
    expect(o.same).toBe(true);
  });
});

describe('docs-show committed: onRef, the pin\'s provenance (row 65)', () => {
  it('a commit on --ref is contains', () => {
    const main = docsRepo(h, 'demo');
    expect(parseOneLine(show(head(main), 'specs', 'a.md'))).toMatchObject({ ok: true, onRef: 'contains', text: '# A\n' });
  });

  it('a commit reachable only from refs/remotes/fork/x is not-contained, and its own bytes are still served', () => {
    const main = docsRepo(h, 'demo');
    h.git(main, 'checkout', '-q', '-b', 'side');
    const fork = commitDocs(h, main, { [`${SPECS}/a.md`]: '# FORK\n' }, 'fork only');
    h.git(main, 'update-ref', 'refs/remotes/fork/x', fork);
    h.git(main, 'checkout', '-q', 'main');
    h.git(main, 'branch', '-q', '-D', 'side');
    // The bytes are C's, whatever --ref says: --ref only ever feeds onRef.
    expect(parseOneLine(show(fork, 'specs', 'a.md')))
      .toMatchObject({ ok: true, commit: fork, onRef: 'not-contained', text: '# FORK\n' });
  });

  it('a commit reachable only from refs/stash is not-contained', () => {
    const main = docsRepo(h, 'demo');
    fs.writeFileSync(path.join(main, 'README.md'), 'dirty\n');
    h.git(main, 'stash', 'push', '-q');
    const stash = h.git(main, 'rev-parse', 'refs/stash');
    expect(parseOneLine(show(stash, 'specs', 'a.md'))).toMatchObject({ ok: true, onRef: 'not-contained' });
  });

  it('an absent --ref is unmeasured, never either answer', () => {
    const main = docsRepo(h, 'demo');
    expect(parseOneLine(show(head(main), 'specs', 'a.md', { ref: 'refs/remotes/origin/gone' })))
      .toMatchObject({ ok: true, onRef: 'unmeasured' });
  });

  it('a merge-base that sleeps past the 2 s soft bound is unmeasured, within the bound plus 2 s', () => {
    const main = docsRepo(h, 'demo');
    const rec = plantGitRecorder(h.home, { sleepWhen: ['merge-base'], sleepS: 30 });
    const o = parseOneLine(show(head(main), 'specs', 'a.md'));
    expect(o).toMatchObject({ ok: true, onRef: 'unmeasured', text: '# A\n' });
    expect(o['elapsedMs'] as number).toBeLessThan(2000 + 2000);
    expect(rec.calls().filter((c) => sub(c)[0] === 'merge-base')).toHaveLength(1);
  });

  it('a shallow repository\'s rc 1 is unmeasured, and its rc 0 is still contains (unit)', () => {
    const main = docsRepo(h, 'demo');
    const tip = head(main);
    const fork = h.git(main, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'fork only');
    const got = unitJson<string[]>(h.home, [
      `ctx = H.Ctx('docs-show', ${JSON.stringify(path.join(h.home, 'projects'))}, `
        + `${JSON.stringify(path.join(h.home, 'worktrees'))}, ${JSON.stringify(path.join(h.home, '.cc-sessions'))}, `
        + 'H.SYS.monotonic())',
      'dl = H.Deadline(7)',
      "repo = H.discover(ctx, 'demo', dl)",
      'cut = repo._replace(shallow=True)',
      `out([H.on_ref(repo, ${JSON.stringify(fork)}, ${JSON.stringify(MAIN)}, dl),`,
      `     H.on_ref(cut, ${JSON.stringify(fork)}, ${JSON.stringify(MAIN)}, dl),`,
      `     H.on_ref(cut, ${JSON.stringify(tip)}, ${JSON.stringify(MAIN)}, dl)])`,
    ].join('\n'));
    expect(got).toEqual(['not-contained', 'unmeasured', 'contains']);
  });
});

describe('docs-show committed: the commit pin (row 15)', () => {
  it('serves the ORIGINAL bytes after `git replace`; CONTROL: a plain cat-file serves the replacement', () => {
    const main = docsRepo(h, 'demo');
    const orig = h.git(main, 'rev-parse', `HEAD:${SPECS}/a.md`);
    const replFile = path.join(h.home, 'replacement.txt');
    fs.writeFileSync(replFile, 'REPLACED-BYTES\n');
    h.git(main, 'replace', orig, h.git(main, 'hash-object', '-w', replFile));
    expect(h.git(main, 'cat-file', 'blob', orig)).toBe('REPLACED-BYTES');
    const r = show(head(main), 'specs', 'a.md');
    expect(parseOneLine(r)).toMatchObject({ ok: true, blob: orig, size: 4, text: '# A\n' });
    expect(r.stdout).not.toContain('REPLACED');
  });

  it('a missing 40-hex commit is unknown-commit', () => {
    docsRepo(h, 'demo');
    expect(parseOneLine(show('deadbeef'.repeat(5), 'specs', 'a.md'))).toMatchObject({ ok: false, failure: 'unknown-commit' });
  });

  it('a 64-hex commit in a sha1 repository is bad-commit, before any object is read', () => {
    docsRepo(h, 'demo');
    const rec = plantGitRecorder(h.home);
    expect(parseOneLine(show('ab'.repeat(32), 'specs', 'a.md'))).toMatchObject({ ok: false, failure: 'bad-commit' });
    expect(rec.calls().some((c) => sub(c)[0] === 'rev-parse')).toBe(true);
    expect(rec.calls().filter((c) => sub(c)[0] === 'cat-file' || sub(c)[0] === 'ls-tree')).toEqual([]);
  });

  it('a tree id passed as the commit is not-a-commit', () => {
    const main = docsRepo(h, 'demo');
    expect(parseOneLine(show(h.git(main, 'rev-parse', 'HEAD^{tree}'), 'specs', 'a.md')))
      .toMatchObject({ ok: false, failure: 'not-a-commit' });
  });

  it('a sha256 repository serves its 64-hex pins, and a 40-hex commit there is bad-commit', () => {
    const dir = path.join(h.home, 'projects', 'demo');
    fs.mkdirSync(path.join(h.home, 'projects'), { recursive: true });
    h.git(path.join(h.home, 'projects'), 'init', '-q', '--object-format=sha256', '-b', 'main', 'demo');
    const c = commitDocs(h, dir, { [`${SPECS}/a.md`]: '# A\n' });
    expect(c).toMatch(/^[0-9a-f]{64}$/);
    const o = parseOneLine(show(c, 'specs', 'a.md'));
    expect(o).toMatchObject({ ok: true, commit: c, text: '# A\n', mode: '100644', onRef: 'unmeasured' });
    expect(String(o['blob'])).toMatch(/^[0-9a-f]{64}$/);
    expect(parseOneLine(show(c.slice(0, 40), 'specs', 'a.md'))).toMatchObject({ ok: false, failure: 'bad-commit' });
  });

  it.each([
    ['a blob gone between ls-tree and cat-file is object-missing', 'gone', { failure: 'object-missing' }],
    ['a cat-file rc 128 on a blob the store still holds is git-failed', 'unreadable',
      { failure: 'git-failed', step: 'cat-file', rc: 128 }],
    ['a short read is git-failed {step: cat-file}', 'short', { failure: 'git-failed', step: 'cat-file' }],
    ['a read past the listed size is git-failed {step: cat-file}', 'long', { failure: 'git-failed', step: 'cat-file' }],
    ['an expiry is git-timeout {step: cat-file}', 'expired', { failure: 'git-timeout', step: 'cat-file' }],
  ] as const)('%s (unit, canned cat-file)', (_label, mode, want) => {
    const main = docsRepo(h, 'demo');
    const blob = h.git(main, 'rev-parse', `HEAD:${SPECS}/a.md`);
    const argv = ['docs-show', path.join(h.home, 'projects'), path.join(h.home, 'worktrees'),
      path.join(h.home, '.cc-sessions'), ...showArgs(head(main), 'specs', 'a.md').slice(1)];
    const o = unitJson<Record<string, unknown>>(h.home, [
      'import json',
      `MODE = ${JSON.stringify(mode)}`,
      `BLOB = ${JSON.stringify(blob)}`,
      'class Canned(H.Sys):',
      '    def spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin=None):',
      "        s = argv[argv.index('-C') + 2:]",
      "        if s[:2] == ['cat-file', 'blob']:",
      "            if MODE in ('gone', 'unreadable'):",
      "                return H.Spawned(128, b'', b'fatal: unable to read https://u:tok@example.invalid/x: bad file\\n', False, False)",
      "            if MODE == 'short':",
      "                return H.Spawned(0, b'# ', b'', False, False)",
      "            if MODE == 'long':",
      "                return H.Spawned(0, b'# A\\nX'[:stdout_cap], b'', False, False)",
      "            return H.Spawned(None, b'', b'', True, False)",
      "        if MODE == 'gone' and s[:2] == ['cat-file', '--batch-check'] and stdin == (BLOB + '\\n').encode('ascii'):",
      "            return H.Spawned(0, (BLOB + ' missing\\n').encode('ascii'), b'', False, False)",
      '        return H.Sys.spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin)',
      'H.SYS = Canned()',
      `out(json.loads(H.run(${JSON.stringify(argv)}).decode('utf-8')))`,
    ].join('\n'));
    expect(o).toMatchObject({ v: 1, verb: 'docs-show', ok: false, ...want });
    // A stderrHead, where one is carried, is redacted (row 62).
    expect(JSON.stringify(o)).not.toContain('tok@');
    if (mode === 'unreadable') expect(String(o['stderrHead'])).toContain('://***@');
  });
});

describe('docs-show committed: a read never mutates, and never names <commit>:<path> (row 16)', () => {
  it('every git call is an allowlisted read, under GIT_NO_REPLACE_OBJECTS, with no colon and no caller path in its argv', () => {
    const main = docsRepo(h, 'demo', { [`${SPECS}/a.md`]: '# A\n', [`${SPECS}/big.md`]: 'x'.repeat(1001) });
    const rec = plantGitRecorder(h.home);
    const c = head(main);
    expect(parseOneLine(show(c, 'specs', 'a.md'))).toMatchObject({ ok: true });
    expect(parseOneLine(show(c, 'specs', 'nope.md'))).toMatchObject({ failure: 'absent-path' });
    expect(parseOneLine(show(c, 'specs', 'big.md', { max: '1000' }))).toMatchObject({ failure: 'too-large' });
    const calls = rec.calls();
    // CONTROL: the reads a committed show makes were all seen, so the loop below is not running over nothing.
    for (const verb of ['cat-file', 'ls-tree', 'merge-base']) expect(calls.some((x) => sub(x)[0] === verb), verb).toBe(true);
    const READS = [['rev-parse'], ['config', '-z', '--get-regexp'], ['cat-file', '--batch-check'],
      ['cat-file', 'blob'], ['ls-tree'], ['merge-base', '--is-ancestor']];
    for (const x of calls) {
      const s = sub(x);
      expect(READS.some((row) => row.every((t, i) => s[i] === t)), s.join(' ')).toBe(true);
      expect(s.some((t) => t.includes(':')), s.join(' ')).toBe(false);
      expect(x.argv.some((t) => t === '--textconv' || t === '--filters'), s.join(' ')).toBe(false);
      // The caller's path never enters an argv or a pathspec: the lookup is by bytes in ls-tree's own output.
      for (const asked of ['a.md', 'nope.md', 'big.md']) expect(x.argv.some((t) => t.includes(asked)), s.join(' ')).toBe(false);
      expect(x.env['GIT_NO_REPLACE_OBJECTS']).toBe('1');
    }
  });
});

describe('docs-show committed: guards the cases above leave open (G8: each goes red when its guard is deleted)', () => {
  // A canned Sys answers ONE git call and lets the rest reach the real git, so the fixture repository still serves
  // the calls the case does not name. `CAPS` records the stdout cap each `cat-file blob` was given.
  it.each([
    ['an ls-tree expiry is git-timeout {step: ls-tree}', "if s[0] == 'ls-tree': return H.Spawned(None, b'', b'', True, False)",
      { failure: 'git-timeout', step: 'ls-tree' }],
    ['an ls-tree past the runner cap is too-many-entries {bytes}', "if s[0] == 'ls-tree': return H.Spawned(0, b'x' * 9, b'', False, True)",
      { failure: 'too-many-entries', bytes: 9 }],
    ['an ls-tree rc 128 is git-failed {step: ls-tree, rc}', "if s[0] == 'ls-tree': return H.Spawned(128, b'', b'fatal: bad object\\n', False, False)",
      { failure: 'git-failed', step: 'ls-tree', rc: 128 }],
    ['a batch-check expiry is git-timeout {step: cat-file}',
      "if s[:2] == ['cat-file', '--batch-check']: return H.Spawned(None, b'', b'', True, False)",
      { failure: 'git-timeout', step: 'cat-file' }],
    ['a batch-check rc 128 is git-failed {step: cat-file, rc}',
      // A well-formed commit line beside rc 128: only the rc check can refuse it.
      "if s[:2] == ['cat-file', '--batch-check']: return H.Spawned(128, stdin.rstrip(b'\\n') + b' commit 1\\n', b'fatal: x\\n', False, False)",
      { failure: 'git-failed', step: 'cat-file', rc: 128 }],
    ['a batch-check line git would never write is git-failed {step: cat-file}',
      "if s[:2] == ['cat-file', '--batch-check']: return H.Spawned(0, b'garbage\\n', b'', False, False)",
      { failure: 'git-failed', step: 'cat-file', detail: 'unexpected cat-file --batch-check output' }],
    ['a cat-file that overflows its size + 1 bound is git-failed even when it exits 0',
      "if s[:2] == ['cat-file', 'blob']: return H.Spawned(0, b'# A\\n', b'', False, True)",
      { failure: 'git-failed', step: 'cat-file' }],
  ] as const)('%s (unit, canned git)', (_label, rule, want) => {
    const main = docsRepo(h, 'demo');
    const argv = ['docs-show', path.join(h.home, 'projects'), path.join(h.home, 'worktrees'),
      path.join(h.home, '.cc-sessions'), ...showArgs(head(main), 'specs', 'a.md').slice(1)];
    const o = unitJson<Record<string, unknown>>(h.home, [
      'import json',
      `ARGV = ${JSON.stringify(argv)}`,
      'class Canned(H.Sys):',
      '    def spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin=None):',
      "        s = argv[argv.index('-C') + 2:]",
      `        ${rule}`,
      '        return H.Sys.spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin)',
      'H.SYS = Canned()',
      "out(json.loads(H.run(ARGV).decode('utf-8')))",
    ].join('\n'));
    expect(o).toMatchObject({ v: 1, verb: 'docs-show', ok: false, ...want });
  });

  it('a merge-base that overflows its output is onRef unmeasured, though it exits 0', () => {
    const main = docsRepo(h, 'demo');
    const argv = ['docs-show', path.join(h.home, 'projects'), path.join(h.home, 'worktrees'),
      path.join(h.home, '.cc-sessions'), ...showArgs(head(main), 'specs', 'a.md').slice(1)];
    const o = unitJson<Record<string, unknown>>(h.home, [
      'import json',
      `ARGV = ${JSON.stringify(argv)}`,
      'class Canned(H.Sys):',
      '    def spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin=None):',
      "        if argv[argv.index('-C') + 2] == 'merge-base': return H.Spawned(0, b'', b'', False, True)",
      '        return H.Sys.spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin)',
      'H.SYS = Canned()',
      "out(json.loads(H.run(ARGV).decode('utf-8')))",
    ].join('\n'));
    expect(o).toMatchObject({ ok: true, onRef: 'unmeasured', text: '# A\n' });
  });

  it('cat-file blob is bounded at the listed size + 1 bytes, never at the runner\'s 16 MiB', () => {
    const main = docsRepo(h, 'demo');
    const argv = ['docs-show', path.join(h.home, 'projects'), path.join(h.home, 'worktrees'),
      path.join(h.home, '.cc-sessions'), ...showArgs(head(main), 'specs', 'a.md').slice(1)];
    const o = unitJson<{ caps: number[]; ok: boolean }>(h.home, [
      'import json',
      `ARGV = ${JSON.stringify(argv)}`,
      'CAPS = []',
      'class Canned(H.Sys):',
      '    def spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin=None):',
      "        if argv[argv.index('-C') + 2:][:2] == ['cat-file', 'blob']: CAPS.append(stdout_cap)",
      '        return H.Sys.spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin)',
      'H.SYS = Canned()',
      "out({'caps': CAPS, 'ok': json.loads(H.run(ARGV).decode('utf-8'))['ok']})",
    ].join('\n'));
    // `# A\n` is 4 bytes.
    expect(o).toEqual({ caps: [5], ok: true });
  });

  it('a line framed at exactly DOCS_MAX_ANSWER_BYTES is returned as is; one byte more becomes too-large', () => {
    const o = unitJson<{ atLen: number; atSame: boolean; overOk: boolean }>(h.home, [
      'import json',
      `CAP = ${DOCS_MAX_ANSWER_BYTES}`,
      "def mk(n): return H.line_of({'v': 1, 'verb': 'docs-show', 'ok': True, 'elapsedMs': 7, 'encoding': 'utf8', 'text': 'x' * n})",
      'room = CAP - H.framed_len(mk(0))',
      'at = mk(room)',
      'over = mk(room + 1)',
      "out({'atLen': H.framed_len(at), 'atSame': H.guard_show(at) == at,",
      "     'overOk': json.loads(H.guard_show(over).decode('utf-8'))['ok']})",
    ].join('\n'));
    expect(o).toEqual({ atLen: DOCS_MAX_ANSWER_BYTES, atSame: true, overOk: false });
  });

  it('encode_show: at a tie in framed length the answer is utf8 (CONTROL: the two framed lengths are equal)', () => {
    const o = unitJson<{ framedUtf8: number; framedB64: number; picked: string }>(h.home, [
      'import base64',
      "data = b'\"abcde'",
      "base = {'k': 1}",
      "u = H.line_of(dict(base, encoding='utf8', text=data.decode('utf-8')))",
      "b = H.line_of(dict(base, encoding='base64', b64=base64.b64encode(data).decode('ascii')))",
      "out({'framedUtf8': H.framed_len(u), 'framedB64': H.framed_len(b), 'picked': H.encode_show(data, base)['encoding']})",
    ].join('\n'));
    expect(o.framedUtf8).toBe(o.framedB64);
    expect(o.picked).toBe('utf8');
  });
});

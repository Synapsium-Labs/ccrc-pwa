// docs-log: one doc's commits from a commit back, newest first (rich-docs spec G4; refinements (a) and (e);
// M9.4-M9.7 and M9.13). Every end-to-end case runs the SHIPPED dispatcher in a fixture HOME through `runCcdDocs`, with
// the helper's git recorded at PATH level (`plantGitRecorder`), because the helper's git is a python subprocess the
// bash-function stub idiom cannot see. Units import the helper itself (`unitJson`) for what a fixture repository cannot
// produce: a stdout cap or an expiry that ends the walk, the final guard, and the runner's argv checks. The expected
// `git log` argv is written out token for token here and never read from the helper's own constants.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import {
  commitDocs, parseOneLine, plantGitRecorder, plantPython3, runCcdDocs, type DocsRun, type RecordedGitCall,
} from './ccdDocsHelpers.js';
import { unitJson } from './docsHelperPy.js';
import { docsAnswerShape } from '../src/docs/policy.js';

const SPECS = 'docs/superpowers/specs';
const VISION = 'docs/vision';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccd-docs-'); });
afterEach(() => { h.cleanup(); });

interface LogEntry { sha: string; parent: string | null; date: string; author: string; subject: string }
type Answer = Record<string, unknown>;

/** A repository with no commits at `<home>/projects/<name>`, made by the fixture's own git (never recorded). */
function freshRepo(name = 'demo'): string {
  const dir = path.join(h.home, 'projects', name);
  fs.mkdirSync(dir, { recursive: true });
  h.git(dir, 'init', '-q', '-b', 'main');
  return dir;
}

const head = (dir: string): string => h.git(dir, 'rev-parse', 'HEAD');

/** Rewrites `rel` (one line of text) and commits every tracked change: a commit that changes only that file. */
function touch(dir: string, rel: string, text: string, msg: string): string {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), `${text}\n`);
  h.git(dir, 'add', '--', rel);
  h.git(dir, 'commit', '-q', '-m', msg);
  return head(dir);
}

/** Like `commitDocs`, with an explicit author (`Name <email>`). */
function commitAs(dir: string, rel: string, author: string, msg: string): string {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), `${msg}\n`);
  h.git(dir, 'add', '--', rel);
  h.git(dir, 'commit', '-q', `--author=${author}`, '-m', msg);
  return head(dir);
}

/** `n` commits that each change `rel`, oldest first; returns their shas in that order. */
function many(dir: string, rel: string, n: number, tag: string): string[] {
  const shas: string[] = [];
  for (let i = 0; i < n; i++) shas.push(touch(dir, rel, `${tag} ${i}`, `${tag} ${i}`));
  return shas;
}

const logArgs = (commit: string, section: string, p: string, project = 'demo'): string[] => [
  'docs-log', '--project', project, '--commit', commit, '--section', section, '--path', p];
const log = (commit: string, section: string, p: string, project = 'demo'): DocsRun =>
  runCcdDocs(h, logArgs(commit, section, p, project));
const answer = (commit: string, section: string, p: string, project = 'demo'): Answer =>
  parseOneLine(log(commit, section, p, project));
const entriesOf = (o: Answer): LogEntry[] => o['entries'] as LogEntry[];

/** A recorded call's subcommand and its arguments: what follows the hardened prefix's `-C <dir>`. */
const sub = (c: RecordedGitCall): string[] => c.argv.slice(c.argv.indexOf('-C') + 2);
const logCalls = (calls: RecordedGitCall[]): RecordedGitCall[] => calls.filter((c) => sub(c)[0] === 'log');

/** The python every unit starts with: the argv `docs-log` is run with, built from the fixture HOME's roots. */
const unitArgv = (commit: string, p = 'a.md', section = 'specs'): string[] => [
  'import json',
  'import os',
  "HOME = os.environ['HOME']",
  `ARGV = ['docs-log', os.path.join(HOME, 'projects'), os.path.join(HOME, 'worktrees'), os.path.join(HOME, '.cc-sessions'),`,
  `        '--project', 'demo', '--commit', ${JSON.stringify(commit)}, '--section', ${JSON.stringify(section)}, '--path', ${JSON.stringify(p)}]`,
  "def ask():",
  "    return json.loads(H.run(ARGV).decode('utf-8'))",
];

/** A `Sys` whose `log` spawn is answered by `body` (python, indented four spaces; it sees `real`, git's complete
 *  answer, and `end`, the byte just after the FIRST whole record) and every other call runs for real. */
const logPlant = (body: string[]): string[] => [
  'class PlantedLog(H.Sys):',
  '    def spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin=None):',
  "        i = argv.index('-C')",
  "        if argv[i + 2] != 'log':",
  '            return H.Sys.spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin)',
  '        real = H.Sys.spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin)',
  "        end = real.out.index(b'\\0', real.out.index(b'\\n')) + 1",
  ...body.map((l) => `        ${l}`),
  'H.SYS = PlantedLog()',
];

describe('docs-log: the listing (M9.4 through M9.7)', () => {
  it('lists the commits that changed the doc, newest first, with sha, parent, date, author and subject', () => {
    const dir = freshRepo();
    const a1 = commitDocs(h, dir, { [`${SPECS}/a.md`]: 'one\n' }, 'first');
    const a2 = touch(dir, `${SPECS}/a.md`, 'two', 'second');
    const b1 = touch(dir, `${SPECS}/b.md`, 'other', 'other doc');
    const a3 = touch(dir, `${SPECS}/a.md`, 'three', 'third');
    const o = answer(a3, 'specs', 'a.md');
    expect(o).toMatchObject({ v: 1, verb: 'docs-log', ok: true, commit: a3, section: 'specs', path: 'a.md', truncated: false });
    const es = entriesOf(o);
    expect(es.map((e) => e.sha)).toEqual([a3, a2, a1]);
    expect(es.map((e) => e.parent)).toEqual([b1, a1, null]);
    expect(es.map((e) => e.subject)).toEqual(['third', 'second', 'first']);
    for (const e of es) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/);
      expect(e.author).toBe('T');
    }
    expect(Object.keys(es[0]!)).toEqual(['sha', 'parent', 'date', 'author', 'subject']);
  });

  it('git log runs once with exactly the fixed flags, the commit and the section path', () => {
    const dir = freshRepo();
    commitDocs(h, dir, { [`${SPECS}/a.md`]: 'one\n' }, 'first');
    const tip = touch(dir, `${SPECS}/a.md`, 'two', 'second');
    const rec = plantGitRecorder(h.home);
    expect(answer(tip, 'specs', 'a.md')).toMatchObject({ ok: true });
    const calls = rec.calls();
    expect(calls.length).toBeGreaterThan(0);
    const logs = logCalls(calls);
    expect(logs).toHaveLength(1);
    const argv = logs[0]!.argv;
    const at = argv.indexOf('-C');
    // The expected list, token for token: the hardened prefix, the four log pairs, `-C <project>`, the fixed head, then
    // the end-of-options marker, the commit and the SECTION path (never the doc's).
    expect(argv.slice(0, at)).toEqual([
      '--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
      '-c', 'log.showSignature=false', '-c', 'log.follow=false', '-c', 'log.mailmap=false', '-c', 'log.showRoot=true',
    ]);
    expect(fs.realpathSync(argv[at + 1]!)).toBe(fs.realpathSync(dir));
    expect(argv.slice(at + 2)).toEqual([
      'log', '--no-show-signature', '--encoding=UTF-8', '--no-merges', '--format=%H%x00%P%x00%cI%x00%an%x00%s',
      '-z', '--name-only', '--end-of-options', tip, '--', 'docs/superpowers/specs',
    ]);
    for (const c of calls) {
      const s = sub(c);
      expect(s.some((t) => t === '-n' || t.startsWith('--max-count') || /^-\d+$/.test(t)), s.join(' ')).toBe(false);
      expect(['fetch', 'show', 'diff'], s.join(' ')).not.toContain(s[0]);
      expect(s[0] === 'cat-file' && s[1] === 'blob', s.join(' ')).toBe(false);
    }
  });

  it('the caller path never appears in any argv', () => {
    const dir = freshRepo();
    const tip = commitDocs(h, dir, { [`${SPECS}/a.md`]: 'one\n' }, 'first');
    const rec = plantGitRecorder(h.home);
    expect(entriesOf(answer(tip, 'specs', 'a.md'))).toHaveLength(1);
    const calls = rec.calls();
    expect(logCalls(calls)).toHaveLength(1);
    for (const c of calls) expect(c.argv.join('\n')).not.toContain('a.md');
  });

  it('a path holding * matches only itself', () => {
    const dir = freshRepo();
    const s1 = commitDocs(h, dir, { [`${SPECS}/x*.md`]: 'star\n' }, 'star one');
    touch(dir, `${SPECS}/xy.md`, 'y', 'y one');
    const s2 = touch(dir, `${SPECS}/x*.md`, 'star two', 'star two');
    const tip = touch(dir, `${SPECS}/xy.md`, 'y two', 'y two');
    expect(entriesOf(answer(tip, 'specs', 'x*.md')).map((e) => e.sha)).toEqual([s2, s1]);
  });

  it('a doc whose name prefixes another lists only its own commits', () => {
    const dir = freshRepo();
    const own1 = commitDocs(h, dir, { [`${SPECS}/a.md`]: 'one\n' }, 'own one');
    touch(dir, `${SPECS}/a.md.bak`, 'bak', 'bak one');
    const own2 = touch(dir, `${SPECS}/a.md`, 'two', 'own two');
    const tip = touch(dir, `${SPECS}/a.md.bak`, 'bak two', 'bak two');
    expect(entriesOf(answer(tip, 'specs', 'a.md')).map((e) => e.sha)).toEqual([own2, own1]);
    expect(entriesOf(answer(tip, 'specs', 'a.md.bak')).map((e) => e.subject)).toEqual(['bak two', 'bak one']);
  });

  it('a merge commit is not listed', () => {
    const dir = freshRepo();
    const base = commitDocs(h, dir, { [`${SPECS}/a.md`]: 'base\n', [`${SPECS}/b.md`]: 'base\n' }, 'base');
    h.git(dir, 'checkout', '-q', '-b', 'side');
    const side = touch(dir, `${SPECS}/a.md`, 'side', 'side edit');
    h.git(dir, 'checkout', '-q', 'main');
    const main1 = touch(dir, `${SPECS}/b.md`, 'main', 'main edit');
    // A merge that itself changes the doc, so it is no mere bookkeeping merge.
    h.git(dir, 'merge', '-q', '--no-ff', '--no-commit', 'side');
    fs.writeFileSync(path.join(dir, SPECS, 'a.md'), 'merged\n');
    h.git(dir, 'add', '--', `${SPECS}/a.md`);
    h.git(dir, 'commit', '-q', '-m', 'the merge');
    const merge = head(dir);
    expect(h.git(dir, 'rev-list', '--parents', '-n', '1', merge).split(' ')).toHaveLength(3);
    const es = entriesOf(answer(merge, 'specs', 'a.md'));
    expect(es.map((e) => e.sha)).not.toContain(merge);
    expect(es.map((e) => e.sha)).toContain(side);
    expect(es.map((e) => e.sha)).toContain(base);
    expect(es.map((e) => e.subject)).not.toContain('the merge');
    // CONTROL: the other doc's own commit is there for b.md, so the merge's absence is not the fixture's.
    expect(entriesOf(answer(merge, 'specs', 'b.md')).map((e) => e.sha)).toContain(main1);
  });

  it('a subject holding a token is redacted, then cut to 200 code points', () => {
    const dir = freshRepo();
    const token = `ghp_${'A'.repeat(36)}`;
    const tip = commitDocs(h, dir, { [`${SPECS}/a.md`]: 'one\n' }, `leak ${token} ${'x'.repeat(300)}`);
    const e = entriesOf(answer(tip, 'specs', 'a.md'))[0]!;
    expect(e.subject).not.toContain(token);
    expect(e.subject).not.toContain('ghp_AAAA');
    expect(e.subject.startsWith('leak ')).toBe(true);
    expect(Array.from(e.subject)).toHaveLength(200);
  });

  it('an author is the name only, redacted, at most 100 code points', () => {
    const dir = freshRepo();
    const token = `ghp_${'B'.repeat(36)}`;
    const tip = commitAs(dir, `${SPECS}/a.md`, `Ann ${token} ${'y'.repeat(200)} <ann@example.invalid>`, 'by ann');
    const e = entriesOf(answer(tip, 'specs', 'a.md'))[0]!;
    expect(e.author.startsWith('Ann ')).toBe(true);
    expect(e.author).not.toContain(token);
    expect(e.author).not.toContain('ghp_BBBB');
    expect(e.author).not.toContain('ann@example.invalid');
    expect(e.author).not.toContain('<');
    expect(Array.from(e.author)).toHaveLength(100);
    // CONTROL: a short name is carried as it is, with its email left behind.
    const t2 = commitAs(dir, `${SPECS}/a.md`, 'Bo Short <bo@example.invalid>', 'by bo');
    expect(entriesOf(answer(t2, 'specs', 'a.md'))[0]!.author).toBe('Bo Short');
  });

  it('a token straddling the subject and author caps is redacted before the cut', () => {
    const dir = freshRepo();
    const token = `ghp_${'C'.repeat(36)}`;
    // Each token starts 15 code points before its cap, so a cut taken first would leave `ghp_` and eleven token
    // characters, too short for the redactor to match; redacted first, the mask (`ghp_***`) is what the cut meets.
    const subject = `${'s'.repeat(185)}${token} ${'t'.repeat(60)}`;
    const author = `${'a'.repeat(85)}${token} ${'u'.repeat(60)}`;
    const tip = commitAs(dir, `${SPECS}/a.md`, `${author} <who@example.invalid>`, subject);
    const e = entriesOf(answer(tip, 'specs', 'a.md'))[0]!;
    for (const [label, text, cap] of [['subject', e.subject, 200], ['author', e.author, 100]] as const) {
      expect(text, label).not.toContain('CCCC');
      expect(text, label).toContain('ghp_***');
      expect(Array.from(text), label).toHaveLength(cap);
    }
    expect(e.subject.startsWith('s'.repeat(185))).toBe(true);
    expect(e.author.startsWith('a'.repeat(85))).toBe(true);
  });

  it("a token mask cut at the cap still passes the server's shape check", () => {
    const dir = freshRepo();
    // The mask `?token=***` starts at code point 192 of the subject and 92 of the author, so each cap (200 and 100)
    // ends it as `?token=*`: ccd redacts first and cuts second, and the server's check must accept what that makes.
    const subject = `${'s'.repeat(192)}?token=abcdef`;
    const author = `${'a'.repeat(92)}?token=xyz`;
    const tip = commitAs(dir, `${SPECS}/a.md`, `${author} <who@example.invalid>`, subject);
    const o = answer(tip, 'specs', 'a.md');
    const e = entriesOf(o)[0]!;
    expect(Array.from(e.subject)).toHaveLength(200);
    expect(Array.from(e.author)).toHaveLength(100);
    expect(e.subject.endsWith('?token=*')).toBe(true);
    expect(e.author.endsWith('?token=*')).toBe(true);
    expect(e.subject).not.toContain('abcdef');
    expect(e.author).not.toContain('xyz');
    expect(docsAnswerShape('docs-log', o)).toStrictEqual({ ok: true });
  });

  it('a doc whose last change is older than the newest 100 commits in its section still lists its history', () => {
    const dir = freshRepo();
    const a1 = commitDocs(h, dir, { [`${SPECS}/a.md`]: 'one\n', [`${SPECS}/b.md`]: 'b\n' }, 'the doc');
    many(dir, `${SPECS}/b.md`, 120, 'later');
    const tip = head(dir);
    const o = answer(tip, 'specs', 'a.md');
    expect(entriesOf(o).map((e) => e.sha)).toEqual([a1]);
    expect(o['truncated']).toBe(false);
    // CONTROL: the other doc IS capped, so the 120 commits were really there to push the doc out of a window.
    const b = answer(tip, 'specs', 'b.md');
    expect(entriesOf(b)).toHaveLength(100);
  });

  it('101 matching commits list 100, truncated false', () => {
    const dir = freshRepo();
    const shas = many(dir, `${SPECS}/a.md`, 101, 'edit');
    const o = answer(head(dir), 'specs', 'a.md');
    const es = entriesOf(o);
    expect(es).toHaveLength(100);
    expect(es[0]!.sha).toBe(shas[100]);
    expect(es[99]!.sha).toBe(shas[1]);
    expect(o['truncated']).toBe(false);
  });

  it('a shallow repository with more than 100 matching commits above its boundary lists 100, truncated false', () => {
    const dir = freshRepo();
    const shas = many(dir, `${SPECS}/a.md`, 103, 'edit');
    // The boundary is the second commit: the walk reaches 101 commits above it, so the list is full and nothing older
    // is hidden from it (a full list is never `truncated`, shallow or not).
    fs.writeFileSync(path.join(dir, '.git', 'shallow'), `${shas[1]}\n`);
    expect(h.git(dir, 'rev-parse', '--is-shallow-repository')).toBe('true');
    const o = answer(head(dir), 'specs', 'a.md');
    const es = entriesOf(o);
    expect(es).toHaveLength(100);
    expect(es[0]!.sha).toBe(shas[102]);
    expect(es[99]!.sha).toBe(shas[3]);
    expect(o['truncated']).toBe(false);
  });
});

describe('docs-log: a walk that ends short is truncated', () => {
  it('a walk the stdout cap ends answers truncated', () => {
    const dir = freshRepo();
    const [c1, c2, c3] = many(dir, `${SPECS}/a.md`, 3, 'edit');
    const got = unitJson<{ full: Answer; cut: Answer }>(h.home, [
      ...unitArgv(c3!),
      'full = ask()',
      ...logPlant(['return H.Sys.spawn(self, argv, env, cwd, timeout_s, end + 10, stdin)']),
      "out({'full': full, 'cut': ask()})",
    ].join('\n'));
    // CONTROL: the same unit without the cap lists all three and is not truncated.
    expect((got.full['entries'] as LogEntry[]).map((e) => e.sha)).toEqual([c3, c2, c1]);
    expect(got.full['truncated']).toBe(false);
    expect(got.cut).toMatchObject({ ok: true, truncated: true });
    expect((got.cut['entries'] as LogEntry[]).map((e) => e.sha)).toEqual([c3]);
  });

  it('a walk the deadline ends answers truncated', () => {
    const dir = freshRepo();
    const [c1, c2, c3] = many(dir, `${SPECS}/a.md`, 3, 'edit');
    const got = unitJson<{ full: Answer; cut: Answer; planted: number }>(h.home, [
      ...unitArgv(c3!),
      'full = ask()',
      'PLANTED = [0]',
      ...logPlant([
        'PLANTED[0] += 1',
        'return H.Spawned(None, real.out[:end + 10], b"", True, False)',
      ]),
      "out({'full': full, 'cut': ask(), 'planted': PLANTED[0]})",
    ].join('\n'));
    expect((got.full['entries'] as LogEntry[]).map((e) => e.sha)).toEqual([c3, c2, c1]);
    expect(got.full['truncated']).toBe(false);
    // The plant took effect for the log call, and for it alone: discovery and cat-file ran for real (the answer is ok).
    expect(got.planted).toBe(1);
    expect(got.cut).toMatchObject({ ok: true, truncated: true });
    expect((got.cut['entries'] as LogEntry[]).map((e) => e.sha)).toEqual([c3]);
  });

  it('a buffer cut inside a name keeps only the whole records before it', () => {
    const dir = freshRepo();
    const [c1, c2, c3] = many(dir, `${SPECS}/a.md`, 3, 'edit');
    const got = unitJson<{ full: Answer; cut: Answer }>(h.home, [
      ...unitArgv(c3!),
      'full = ask()',
      ...logPlant([
        "nl = real.out.index(b'\\n', end)",
        "cut = nl + 1 + len(b'docs/superpowers/specs/') + 2",
        'return H.Spawned(None, real.out[:cut], b"", True, False)',
      ]),
      "out({'full': full, 'cut': ask()})",
    ].join('\n'));
    expect((got.full['entries'] as LogEntry[]).map((e) => e.sha)).toEqual([c3, c2, c1]);
    expect(got.cut).toMatchObject({ ok: true, truncated: true });
    expect((got.cut['entries'] as LogEntry[]).map((e) => e.sha)).toEqual([c3]);
  });

  it('a buffer cut right after the fifth NUL of a record keeps only the whole records before it', () => {
    const dir = freshRepo();
    const [c1, c2, c3] = many(dir, `${SPECS}/a.md`, 3, 'edit');
    const got = unitJson<{ full: Answer; cut: Answer }>(h.home, [
      ...unitArgv(c3!),
      'full = ask()',
      ...logPlant([
        'j = end',
        'for _ in range(5):',
        "    j = real.out.index(b'\\0', j) + 1",
        'return H.Spawned(None, real.out[:j], b"", True, False)',
      ]),
      "out({'full': full, 'cut': ask()})",
    ].join('\n'));
    expect((got.full['entries'] as LogEntry[]).map((e) => e.sha)).toEqual([c3, c2, c1]);
    expect(got.cut).toMatchObject({ ok: true, truncated: true });
    expect((got.cut['entries'] as LogEntry[]).map((e) => e.sha)).toEqual([c3]);
  });

  it('a non-zero rc from the log call with no cut answers git-failed, step log', () => {
    const dir = freshRepo();
    const [, , c3] = many(dir, `${SPECS}/a.md`, 3, 'edit');
    const got = unitJson<Answer>(h.home, [
      ...unitArgv(c3!),
      ...logPlant(['return H.Spawned(128, b"", b"fatal: planted", False, False)']),
      'out(ask())',
    ].join('\n'));
    expect(got).toMatchObject({ v: 1, verb: 'docs-log', ok: false, failure: 'git-failed', step: 'log', rc: 128 });
    expect(String(got['stderrHead'])).toContain('fatal: planted');
  });

  it('a shallow repository whose walk ends short answers truncated', () => {
    const dir = freshRepo();
    const [c1, c2, c3] = many(dir, `${SPECS}/a.md`, 3, 'edit');
    const before = answer(c3!, 'specs', 'a.md');
    expect(entriesOf(before).map((e) => e.sha)).toEqual([c3, c2, c1]);
    expect(before['truncated']).toBe(false);
    // A shallow boundary at c2: git stops the walk there, and an older commit may be hidden.
    fs.writeFileSync(path.join(dir, '.git', 'shallow'), `${c2}\n`);
    expect(h.git(dir, 'rev-parse', '--is-shallow-repository')).toBe('true');
    const after = answer(c3!, 'specs', 'a.md');
    // The boundary is a root to git and is never listed (next case), so only the commit above it is.
    expect(entriesOf(after).map((e) => e.sha)).toEqual([c3]);
    expect(after['truncated']).toBe(true);
  });

  it('a shallow walk that ends short is truncated when its boundary does not hold the doc', () => {
    const dir = freshRepo();
    touch(dir, `${SPECS}/b.md`, 'root', 'the root');
    const boundary = touch(dir, `${SPECS}/b.md`, 'other', 'the boundary');
    const a1 = touch(dir, `${SPECS}/a.md`, 'one', 'add the doc');
    const a2 = touch(dir, `${SPECS}/a.md`, 'two', 'edit the doc');
    fs.writeFileSync(path.join(dir, '.git', 'shallow'), `${boundary}\n`);
    expect(h.git(dir, 'rev-parse', '--is-shallow-repository')).toBe('true');
    // CONTROL: git prints the boundary as a root with the section's files, and the doc is not among them, so the
    // parser reads past no parentless record that touched the doc: only the shallow arm can make this answer truncated.
    const raw = h.git(dir, '-c', 'log.showRoot=true', 'log', '--no-merges', '--format=%H%x00%P%x00%cI%x00%an%x00%s', '-z', '--name-only', '--', SPECS);
    expect(raw).toContain(`${boundary}\0`);
    const rec = raw.slice(raw.indexOf(`${boundary}\0\0`));
    expect(rec).toContain(`${SPECS}/b.md`);
    expect(rec).not.toContain(`${SPECS}/a.md`);
    const o = answer(a2, 'specs', 'a.md');
    expect(entriesOf(o).map((e) => e.sha)).toEqual([a2, a1]);
    expect(entriesOf(o)[1]).toMatchObject({ parent: boundary });
    expect(o['truncated']).toBe(true);
  });

  it('a shallow repository never lists its boundary commit, and every listed parent is a full sha', () => {
    const dir = freshRepo();
    commitDocs(h, dir, { [`${SPECS}/a.md`]: 'one\n' }, 'doc one');
    const boundary = touch(dir, `${SPECS}/b.md`, 'other', 'other doc');
    const top = touch(dir, `${SPECS}/a.md`, 'two', 'doc two');
    // CONTROL: before the repository is shallow, the other doc's commit is not a change to a.md either.
    expect(entriesOf(answer(top, 'specs', 'a.md')).map((e) => e.sha)).not.toContain(boundary);
    fs.writeFileSync(path.join(dir, '.git', 'shallow'), `${boundary}\n`);
    expect(h.git(dir, 'rev-parse', '--is-shallow-repository')).toBe('true');
    // CONTROL: git itself prints the boundary as a root with every file of the section, the doc included.
    expect(h.git(dir, '-c', 'log.showRoot=true', 'log', '--no-merges', '--format=%H', '--name-only', '--', SPECS).split('\n'))
      .toContain(`${SPECS}/a.md`);
    const o = answer(top, 'specs', 'a.md');
    const es = entriesOf(o);
    expect(es.map((e) => e.sha)).toEqual([top]);
    expect(es.map((e) => e.sha)).not.toContain(boundary);
    for (const e of es) expect(e.parent).toMatch(/^[0-9a-f]{40}$/);
    expect(o['truncated']).toBe(true);
  });

  it('a shallow walk that reads past a parentless record touching the doc is truncated, even with a full list', () => {
    const dir = freshRepo();
    const mainRoot = touch(dir, `${SPECS}/a.md`, 'root', 'the main root');
    many(dir, `${SPECS}/a.md`, 100, 'old');
    // A true second root, made after the hundred `old` commits (so it is never older than they are), then merged
    // with the first parent on its side: the walk meets it ahead of every `old` commit.
    h.git(dir, 'checkout', '-q', '--orphan', 'side');
    h.git(dir, 'rm', '-rq', '--cached', '.');
    fs.rmSync(path.join(dir, 'docs'), { recursive: true, force: true });
    const orphan = touch(dir, `${SPECS}/a.md`, 'orphan', 'the second root');
    // The merge's tree differs from both parents', so git's history simplification follows both sides of it.
    h.git(dir, 'merge', '-q', '-s', 'ours', '--no-commit', '--allow-unrelated-histories', 'main');
    fs.writeFileSync(path.join(dir, SPECS, 'a.md'), 'merged\n');
    h.git(dir, 'add', '--', `${SPECS}/a.md`);
    h.git(dir, 'commit', '-q', '-m', 'merge main');
    touch(dir, `${SPECS}/a.md`, 'one', 't1');
    const t2 = touch(dir, `${SPECS}/a.md`, 'two', 't2');
    // CONTROL: before the repository is shallow, the second root is listed (a true root, parent null) near the top,
    // the list is full, and the walk is complete.
    const before = answer(t2, 'specs', 'a.md');
    expect(entriesOf(before)).toHaveLength(100);
    expect(entriesOf(before).slice(0, 5).map((e) => e.sha)).toContain(orphan);
    expect(entriesOf(before).find((e) => e.sha === orphan)).toMatchObject({ parent: null });
    expect(before['truncated']).toBe(false);
    // Mark the repository shallow without cutting anything: the boundary is the main root, already parentless.
    fs.writeFileSync(path.join(dir, '.git', 'shallow'), `${mainRoot}\n`);
    expect(h.git(dir, 'rev-parse', '--is-shallow-repository')).toBe('true');
    const o = answer(t2, 'specs', 'a.md');
    const es = entriesOf(o);
    expect(es).toHaveLength(100);
    expect(es.map((e) => e.sha)).not.toContain(orphan);
    for (const e of es) expect(e.parent).toMatch(/^[0-9a-f]{40}$/);
    // The list is full, yet a change (the second root) was read past: the answer says so.
    expect(o['truncated']).toBe(true);
  });
});

describe('docs-log: output the helper refuses to read', () => {
  it('a record whose sha or parent is not a full object id answers git-failed, step log', () => {
    const dir = freshRepo();
    const [, , c3] = many(dir, `${SPECS}/a.md`, 3, 'edit');
    const got = unitJson<{ whole: Answer; sha: Answer; parent: Answer }>(h.home, [
      ...unitArgv(c3!),
      'MODE = [None]',
      ...logPlant([
        'out = real.out',
        "if MODE[0] == 'sha':",
        '    out = out[:10] + b"a" + out[10:]',
        "elif MODE[0] == 'parent':",
        "    k = out.index(b'\\0') + 5",
        '    out = out[:k] + b"a" + out[k:]',
        'return H.Spawned(0, out, b"", False, False)',
      ]),
      "answers = {}",
      "for m in (None, 'sha', 'parent'):",
      '    MODE[0] = m',
      "    answers[m or 'whole'] = ask()",
      'out(answers)',
    ].join('\n'));
    // CONTROL: the unchanged bytes through the same plant list the three commits.
    expect(got.whole).toMatchObject({ ok: true, truncated: false });
    expect(entriesOf(got.whole)).toHaveLength(3);
    // One extra byte inside the first record's sha (41 characters) or inside its parent.
    for (const [label, a] of [['sha', got.sha], ['parent', got.parent]] as const) {
      expect(a, label).toMatchObject({ v: 1, verb: 'docs-log', ok: false, failure: 'git-failed', step: 'log' });
    }
  });

  it('a redactor that changes the line count answers helper-failed', () => {
    const dir = freshRepo();
    const [, , c3] = many(dir, `${SPECS}/a.md`, 3, 'edit');
    const got = unitJson<{ whole: Answer; planted: Answer }>(h.home, [
      ...unitArgv(c3!),
      'whole = ask()',
      'class PlantedRedact(H.Sys):',
      '    def redact(self, s):',
      "        return H.Sys.redact(self, s) + '\\nextra'",
      'H.SYS = PlantedRedact()',
      "out({'whole': whole, 'planted': ask()})",
    ].join('\n'));
    // CONTROL: the real redactor lists the three commits, so the plant is what fails the second ask.
    expect(got.whole).toMatchObject({ ok: true });
    expect(entriesOf(got.whole)).toHaveLength(3);
    expect(got.planted).toMatchObject({ v: 1, verb: 'docs-log', ok: false, failure: 'helper-failed' });
  });
});

describe('docs-log: the final guard (M9.7)', () => {
  const SHA = "'a' * 40";
  /** Python that builds a docs-log ok object with `entries` and returns (obj, line). */
  const mk = [
    "def mk(entries, path='a.md'):",
    "    obj = {'v': 1, 'verb': 'docs-log', 'ok': True, 'elapsedMs': 7, 'commit': " + SHA + ", 'section': 'specs',",
    "           'path': path, 'entries': entries, 'truncated': False}",
    '    return obj, H.line_of(obj)',
    "def entry(subject):",
    "    return {'sha': " + SHA + ", 'parent': None, 'date': '2026-01-02T03:04:05+00:00', 'author': 'T', 'subject': subject}",
  ];

  it('over the wire cap answers too-many-entries {count, bytes}', () => {
    const got = unitJson<{
      big: Record<string, unknown>; bigBytes: number; many: Record<string, unknown>; same: boolean;
      atCap: boolean; overCap: Record<string, unknown>; capFramed: number;
    }>(h.home, [
      'import json',
      ...mk,
      // 60 entries of 3000 characters: under the count cap, over the wire cap.
      "obj, line = mk([entry('x' * 3000) for _ in range(60)])",
      'bigFramed = H.framed_len(line)',
      "big = json.loads(H.guard_log(obj, line).decode('utf-8'))",
      // 101 small entries: over the count cap, far under the wire cap.
      "obj2, line2 = mk([entry('s') for _ in range(101)])",
      "many = json.loads(H.guard_log(obj2, line2).decode('utf-8'))",
      // A short list is returned as it is.
      "obj3, line3 = mk([entry('s')])",
      'same = H.guard_log(obj3, line3) == line3',
      // The bound itself: exactly DOCS_LOG_MAX_WIRE_BYTES passes, one byte more does not.
      'k = 1000',
      "obj4, line4 = mk([entry('x' * k)])",
      'k += H.DOCS_LOG_MAX_WIRE_BYTES - H.framed_len(line4)',
      "obj4, line4 = mk([entry('x' * k)])",
      "obj5, line5 = mk([entry('x' * (k + 1))])",
      "out({'big': big, 'bigBytes': bigFramed, 'many': many, 'same': same,",
      "     'atCap': H.framed_len(line4) == H.DOCS_LOG_MAX_WIRE_BYTES and H.guard_log(obj4, line4) == line4,",
      "     'overCap': json.loads(H.guard_log(obj5, line5).decode('utf-8')), 'capFramed': H.framed_len(line5)})",
    ].join('\n'));
    expect(got.bigBytes).toBeGreaterThan(131072);
    expect(got.big).toEqual({
      v: 1, verb: 'docs-log', ok: false, elapsedMs: 7, failure: 'too-many-entries', count: 60, bytes: got.bigBytes,
    });
    expect(got.many).toMatchObject({ ok: false, failure: 'too-many-entries', count: 101 });
    expect(got.same).toBe(true);
    expect(got.atCap).toBe(true);
    expect(got.overCap).toMatchObject({ ok: false, failure: 'too-many-entries', count: 1, bytes: 131073 });
    expect(got.capFramed).toBe(131073);
  });

  it('a hundred entries of four-byte authors and subjects answer too-many-entries; of three-byte ones, the list', () => {
    const got = unitJson<{
      four: Record<string, unknown>; fourFramed: number; three: Record<string, unknown>; threeFramed: number;
      lens: [number, number];
    }>(h.home, [
      'import json',
      ...mk,
      'def rows(ch):',
      "    return [(b'a' * 40, b'b' * 40, b'2026-01-02T03:04:05+00:00', (ch * 100).encode('utf-8'), (ch * 200).encode('utf-8'))",
      '            for _ in range(100)]',
      // The caps hold in code points, so four-byte characters reach 1200 bytes an entry, three-byte ones 900.
      "def ask(ch):",
      "    es = H.log_entries(rows(ch))",
      "    obj, line = mk(es, 'a' * 1024)",
      "    return json.loads(H.guard_log(obj, line).decode('utf-8')), H.framed_len(line), (len(es[0]['author']), len(es[0]['subject']))",
      "four, fourFramed, lens = ask('\\U0001F600')",
      "three, threeFramed, _ = ask('\\u20ac')",
      "out({'four': four, 'fourFramed': fourFramed, 'three': three, 'threeFramed': threeFramed, 'lens': lens})",
    ].join('\n'));
    expect(got.lens).toEqual([100, 200]);
    expect(got.fourFramed).toBeGreaterThan(131072);
    expect(got.four).toEqual({
      v: 1, verb: 'docs-log', ok: false, elapsedMs: 7, failure: 'too-many-entries', count: 100, bytes: got.fourFramed,
    });
    expect(got.threeFramed).toBeLessThanOrEqual(131072);
    expect(got.three).toMatchObject({ v: 1, verb: 'docs-log', ok: true, path: 'a'.repeat(1024) });
    expect((got.three['entries'] as LogEntry[])).toHaveLength(100);
  });
});

describe('docs-log: refusals and the argument shape (M9.4)', () => {
  it('grammar refusals make no git call: bad-project, bad-commit (short, uppercase), bad-section (vision passes, wiki fails), bad-path', () => {
    const dir = freshRepo();
    const tip = commitDocs(h, dir, { [`${SPECS}/a.md`]: 'one\n' }, 'first');
    const rec = plantGitRecorder(h.home);
    const cases: [string, string[], string][] = [
      ['bad-project', logArgs(tip, 'specs', 'a.md', '-h'), 'bad-project'],
      ['bad-project (a space)', logArgs(tip, 'specs', 'a.md', 'de mo'), 'bad-project'],
      ['bad-commit (short)', logArgs('abc1234', 'specs', 'a.md'), 'bad-commit'],
      ['bad-commit (uppercase)', logArgs(tip.toUpperCase(), 'specs', 'a.md'), 'bad-commit'],
      ['bad-section', logArgs(tip, 'wiki', 'a.md'), 'bad-section'],
      ['bad-path (dot-dot)', logArgs(tip, 'specs', '../a.md'), 'bad-path'],
      ['bad-path (absolute)', logArgs(tip, 'specs', '/a.md'), 'bad-path'],
      ['bad-path (empty)', logArgs(tip, 'specs', ''), 'bad-path'],
      // CONTROL: `vision` is a section, so the refusal here is the project's, reached with no git call either.
      ['vision passes the section grammar', logArgs(tip, 'vision', 'a.md', 'nope'), 'unknown-project'],
    ];
    for (const [label, args, word] of cases) {
      const r = runCcdDocs(h, args);
      expect(r.code, `${label}: ${r.stderr}`).toBe(0);
      expect(parseOneLine(r), label).toMatchObject({ v: 1, verb: 'docs-log', ok: false, failure: word });
    }
    expect(rec.calls()).toEqual([]);
    // CONTROL: the recorder does see a run that reaches git.
    expect(answer(tip, 'specs', 'a.md')).toMatchObject({ ok: true });
    expect(rec.calls().length).toBeGreaterThan(0);
  });

  it('an unknown commit is unknown-commit; a tree id is not-a-commit', () => {
    const dir = freshRepo();
    const tip = commitDocs(h, dir, { [`${SPECS}/a.md`]: 'one\n' }, 'first');
    const tree = h.git(dir, 'rev-parse', `${tip}^{tree}`);
    expect(answer('f'.repeat(40), 'specs', 'a.md')).toMatchObject({ ok: false, failure: 'unknown-commit' });
    expect(answer(tree, 'specs', 'a.md')).toMatchObject({ ok: false, failure: 'not-a-commit' });
    expect(answer(tip, 'specs', 'a.md')).toMatchObject({ ok: true });
  });

  it('a commit of the wrong object length is bad-commit after discovery', () => {
    const dir = freshRepo();
    commitDocs(h, dir, { [`${SPECS}/a.md`]: 'one\n' }, 'first');
    expect(h.git(dir, 'rev-parse', '--show-object-format')).toBe('sha1');
    const rec = plantGitRecorder(h.home);
    expect(answer('a'.repeat(64), 'specs', 'a.md')).toMatchObject({ ok: false, failure: 'bad-commit' });
    // Discovery's two calls and nothing after them: no cat-file, no log.
    expect(rec.calls().map((c) => sub(c)[0])).toEqual(['rev-parse', 'config']);
  });

  it('a ninth token, a missing flag or flags out of order is a usage error, rc 1, empty stdout', () => {
    const c = 'a'.repeat(40);
    const shapes: [string, string[]][] = [
      ['a ninth token', [...logArgs(c, 'specs', 'a.md'), 'extra']],
      ['no --path', ['docs-log', '--project', 'demo', '--commit', c, '--section', 'specs']],
      ['--path with no value', ['docs-log', '--project', 'demo', '--commit', c, '--section', 'specs', '--path']],
      ['--section and --commit swapped', ['docs-log', '--project', 'demo', '--section', 'specs', '--commit', c, '--path', 'a.md']],
      ['--path first', ['docs-log', '--path', 'a.md', '--project', 'demo', '--commit', c, '--section', 'specs']],
      ['a stray token for a flag', ['docs-log', '--project', 'demo', '--commit', c, '--section', 'specs', 'x', 'a.md']],
      // Only the first and the fifth flag checks refuse these two: every other token is in its place.
      ['a stray token in place of --project', ['docs-log', 'X', 'demo', '--commit', c, '--section', 'specs', '--path', 'a.md']],
      ['a stray token in place of --section', ['docs-log', '--project', 'demo', '--commit', c, 'X', 'specs', '--path', 'a.md']],
      ['no arguments', ['docs-log']],
    ];
    for (const [label, args] of shapes) {
      const r = runCcdDocs(h, args);
      expect(r.code, label).toBe(1);
      expect(r.stdout, label).toBe('');
      expect(r.stderr, label).toContain('usage: ccd docs-log --project P --commit C --section S --path X');
    }
    // CONTROL: the eight-token shape is no usage error.
    expect(runCcdDocs(h, logArgs(c, 'specs', 'a.md')).code).toBe(0);
  });

  it('helper-unavailable when python3 is too old', () => {
    const FIXED = (why: string): string =>
      `{"v":1,"verb":"docs-log","ok":false,"elapsedMs":0,"failure":"helper-unavailable","detail":"${why}"}\n`;
    for (const [mode, why] of [['too-old', 'python-too-old'], ['missing', 'python-missing']] as const) {
      const hh = makeCcdHarness('ccd-docs-');
      try {
        plantPython3(hh.home, mode);
        const r = runCcdDocs(hh, logArgs('a'.repeat(40), 'specs', 'a.md'));
        expect(r.code, r.stderr).toBe(0);
        expect(r.stdout).toBe(FIXED(why));
      } finally { hh.cleanup(); }
    }
  });
});

describe('docs-log: the runner refuses any other tail (M9.5)', () => {
  it('the runner refuses log with any other tail', () => {
    const got = unitJson<{ ok: boolean; refused: (string | null)[] }>(h.home, [
      "SEC = 'docs/superpowers/specs'",
      "SHA = 'a' * 40",
      "HEAD = ['log', '--no-show-signature', '--encoding=UTF-8', '--no-merges', '--format=%H%x00%P%x00%cI%x00%an%x00%s', '-z', '--name-only']",
      "PAIRS = ['-c', 'log.showSignature=false', '-c', 'log.follow=false', '-c', 'log.mailmap=false', '-c', 'log.showRoot=true']",
      "TAIL = ['--end-of-options', SHA, '--', SEC]",
      'def verdict(args):',
      '    try:',
      "        H.git_argv('/r', args)",
      '        return None',
      '    except H.GitRefused as e:',
      '        return str(e)',
      'rows = [',
      '    PAIRS + HEAD + TAIL,',
      "    PAIRS + HEAD + ['-n', '1'] + TAIL,",
      "    PAIRS + ['log', '-n', '1'] + HEAD[1:] + TAIL,",
      "    PAIRS + HEAD + TAIL + ['docs/superpowers/plans'],",
      "    PAIRS + HEAD + ['--end-of-options', SHA, '--', SEC + '/a.md'],",
      "    PAIRS + HEAD + ['--end-of-options', SHA, '--', 'docs'],",
      "    PAIRS + HEAD + ['--end-of-options', 'C:' + SEC, '--', SEC],",
      "    PAIRS + HEAD + ['--end-of-options', SHA + ':a.md', '--', SEC],",
      '    PAIRS[2:] + HEAD + TAIL,',
      '    PAIRS[:-2] + HEAD + TAIL,',
      '    PAIRS + ["-c", "log.showRoot=false"] + HEAD + TAIL,',
      '    HEAD + TAIL,',
      "    PAIRS + HEAD + ['--', SEC],",
      "    PAIRS + HEAD + [SHA, '--', SEC],",
      ']',
      "out({'ok': verdict(rows[0]) is None, 'refused': [verdict(r) for r in rows[1:]]})",
    ].join('\n'));
    // CONTROL: the exact tail is accepted, so every refusal below is about its own deviation.
    expect(got.ok).toBe(true);
    expect(got.refused).toHaveLength(13);
    got.refused.forEach((v, i) => expect(v, `refusal ${i + 1}`).not.toBeNull());
    // The C:path argument is refused by the object-name rule, whatever the shape check says.
    expect(got.refused[5]).toContain('<rev>:<path>');
    expect(got.refused[6]).toContain('<rev>:<path>');
  });
});

describe('docs-log: history git config would hide (refinement (e))', () => {
  it('a repository whose config sets log.showRoot=false still lists the root commit', () => {
    const dir = freshRepo();
    h.git(dir, 'config', 'log.showRoot', 'false');
    // Root one holds the doc; root two (an unrelated history) adds another doc to the same section.
    const docRoot = commitDocs(h, dir, { [`${SPECS}/a.md`]: 'one\n' }, 'the doc root');
    h.git(dir, 'checkout', '-q', '--orphan', 'second');
    h.git(dir, 'rm', '-rq', '--cached', '.');
    fs.rmSync(path.join(dir, 'docs'), { recursive: true, force: true });
    const otherRoot = commitDocs(h, dir, { [`${SPECS}/other.md`]: 'two\n' }, 'the second root');
    h.git(dir, 'merge', '-q', '--allow-unrelated-histories', '--no-edit', 'main');
    const tip = head(dir);
    // CONTROL: the repository's own git, with its config, hides the root's names (so the pair is what saves it).
    expect(h.git(dir, 'config', '--get', 'log.showRoot')).toBe('false');
    expect(h.git(dir, 'log', '--no-merges', '--format=%H', '--name-only', docRoot)).toBe(docRoot);
    const rec = plantGitRecorder(h.home);
    const o = answer(tip, 'specs', 'a.md');
    expect(o).toMatchObject({ ok: true, truncated: false });
    expect(entriesOf(o)).toHaveLength(1);
    expect(entriesOf(o)[0]).toMatchObject({ sha: docRoot, parent: null, subject: 'the doc root' });
    expect(entriesOf(answer(tip, 'specs', 'other.md'))[0]).toMatchObject({ sha: otherRoot, parent: null });
    expect(logCalls(rec.calls())).toHaveLength(2);
  });

  it('a commit that git prints without names (a submodule ignored by .gitmodules) is read past, not a failure', () => {
    const dir = freshRepo();
    const root = commitDocs(h, dir, { [`${VISION}/a.md`]: 'one\n' }, 'the doc root');
    fs.writeFileSync(path.join(dir, '.gitmodules'), `[submodule "sub"]\n\tpath = ${VISION}/sub\n\turl = ./nowhere\n\tignore = all\n`);
    h.git(dir, 'add', '--', '.gitmodules');
    h.git(dir, 'commit', '-q', '-m', 'declare the submodule');
    const s1 = '1'.repeat(40);
    const s2 = '2'.repeat(40);
    h.git(dir, 'update-index', '--add', '--cacheinfo', `160000,${s1},${VISION}/sub`);
    h.git(dir, 'commit', '-q', '-m', 'add the gitlink');
    h.git(dir, 'update-index', '--cacheinfo', `160000,${s2},${VISION}/sub`);
    h.git(dir, 'commit', '-q', '-m', 'bump the gitlink');
    const bump = head(dir);
    const edit = touch(dir, `${VISION}/a.md`, 'two', 'edit the doc');
    // CONTROL: git itself prints the two gitlink commits with no names (the ignore setting hides the gitlink), so the
    // fixture really produces the record shape this case is about.
    const raw = h.git(dir, '-c', 'log.showRoot=true', 'log', '--no-merges', '--format=%H%x00%P%x00%cI%x00%an%x00%s', '-z', '--name-only', '--', VISION);
    expect(raw).toContain(`${bump}\0`);
    expect(raw).not.toContain(`${VISION}/sub`);
    const o = answer(edit, 'vision', 'a.md');
    expect(o).toMatchObject({ ok: true, section: 'vision', truncated: false });
    expect(entriesOf(o).map((e) => e.sha)).toEqual([edit, root]);
  });

  it('a commit that git prints without names at the newest position is read past', () => {
    const dir = freshRepo();
    const root = commitDocs(h, dir, { [`${VISION}/a.md`]: 'one\n' }, 'the doc root');
    fs.writeFileSync(path.join(dir, '.gitmodules'), `[submodule "sub"]\n\tpath = ${VISION}/sub\n\turl = ./nowhere\n\tignore = all\n`);
    h.git(dir, 'add', '--', '.gitmodules');
    h.git(dir, 'commit', '-q', '-m', 'declare the submodule');
    const edit = touch(dir, `${VISION}/a.md`, 'two', 'edit the doc');
    h.git(dir, 'update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},${VISION}/sub`);
    h.git(dir, 'commit', '-q', '-m', 'add the gitlink');
    h.git(dir, 'update-index', '--cacheinfo', `160000,${'2'.repeat(40)},${VISION}/sub`);
    h.git(dir, 'commit', '-q', '-m', 'bump the gitlink');
    const bump = head(dir);
    // CONTROL: git itself starts its output with the newest commit (a gitlink bump) and prints no name for it or for
    // the commit below it, so the record the parser meets first is the nameless shape.
    const raw = h.git(dir, '-c', 'log.showRoot=true', 'log', '--no-merges', '--format=%H%x00%P%x00%cI%x00%an%x00%s', '-z', '--name-only', '--', VISION);
    expect(raw.startsWith(`${bump}\0`)).toBe(true);
    expect(raw).not.toContain(`${VISION}/sub`);
    const o = answer(bump, 'vision', 'a.md');
    expect(o).toMatchObject({ ok: true, section: 'vision', truncated: false });
    expect(entriesOf(o).map((e) => e.sha)).toEqual([edit, root]);
  });

  it('a root commit that git prints without names, as the last record, is read past', () => {
    const dir = freshRepo();
    // The root holds only the declaration (outside the section) and the gitlink: it prints no name in the section.
    fs.writeFileSync(path.join(dir, '.gitmodules'), `[submodule "sub"]\n\tpath = ${VISION}/sub\n\turl = ./nowhere\n\tignore = all\n`);
    h.git(dir, 'add', '--', '.gitmodules');
    h.git(dir, 'update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},${VISION}/sub`);
    h.git(dir, 'commit', '-q', '-m', 'the nameless root');
    const root = head(dir);
    const first = touch(dir, `${VISION}/a.md`, 'one', 'add the doc');
    const second = touch(dir, `${VISION}/a.md`, 'two', 'edit the doc');
    // CONTROL: git's output ends with the root's record and no name: the sha is there, the gitlink's path is not.
    const raw = h.git(dir, '-c', 'log.showRoot=true', 'log', '--no-merges', '--format=%H%x00%P%x00%cI%x00%an%x00%s', '-z', '--name-only', '--', VISION);
    expect(raw).toContain(`${root}\0`);
    expect(raw).not.toContain(`${VISION}/sub`);
    expect(raw.lastIndexOf(root)).toBeGreaterThan(raw.lastIndexOf(first));
    expect(raw.slice(raw.lastIndexOf(root))).toMatch(/^[0-9a-f]{40}\0\0[^\0]*\0[^\0]*\0the nameless root\0?\n?$/);
    const o = answer(second, 'vision', 'a.md');
    expect(o).toMatchObject({ ok: true, section: 'vision', truncated: false });
    expect(entriesOf(o).map((e) => e.sha)).toEqual([second, first]);
  });

  it('a section path that was once a file still lists the doc\'s history', () => {
    const dir = freshRepo();
    commitDocs(h, dir, { [VISION]: 'once a file\n' }, 'vision as a file');
    h.git(dir, 'rm', '-q', '--', VISION);
    const a1 = commitDocs(h, dir, { [`${VISION}/a.md`]: 'one\n' }, 'vision as a directory');
    const a2 = touch(dir, `${VISION}/a.md`, 'two', 'edit the doc');
    const o = answer(a2, 'vision', 'a.md');
    expect(o).toMatchObject({ ok: true, section: 'vision', truncated: false });
    expect(entriesOf(o).map((e) => e.sha)).toEqual([a2, a1]);
    // The commit that removed the file and added the doc names the bare section path first: read past, never a hit.
    expect(h.git(dir, 'log', '-1', '--format=%H', '--name-only', a1).split('\n').filter((l) => l !== '')).toEqual([a1, VISION, `${VISION}/a.md`]);
    expect(entriesOf(answer(a2, 'vision', 'missing.md'))).toEqual([]);
  });
});

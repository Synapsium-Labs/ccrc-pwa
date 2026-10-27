// The docs helper's redactor (D-7077; ARCH-67; W5 Task C5h, built from its design note
// `docs/superpowers/plans/2026-10-27-w5-c5h-design.md`; spec K7, §5.13, O2 (b)). C5h moves the helper's redaction off
// its python copy of the rules (`REDACT_RULES`) onto `shared/redact.mjs`'s `docs` profile, run through
// `shared/redact-cli.mjs` as one node process per docs verb.
//
// THE CHARACTERIZATION (commit 1, green on the python copy, before anything moves). Every answer below is pinned byte for
// byte, its run-dependent values (elapsedMs, a fixture HOME's path, a commit id) replaced by named placeholders, so a
// later commit that changes one byte of what the helper writes reds here:
//   - the corpus row: the helper's `redact` equals `redactDocsText` over `fixtures/redact/profiles.json`'s docs and cross
//     rows (the rows `redact.test.ts` holds the TS redactor to), plus the shapes the wire carries back (a lone surrogate,
//     a multi-line stderr);
//   - the double-redaction rows: a `git-failed` and a `docs-fetch` failure whose stderr carries a secret. The head is
//     redacted where it is read, and `failure_line` redacts `detail` and `stderrHead` again, so each answer is the
//     redactor applied twice;
//   - the fan-out fixtures the redactor's own rows reuse: a `docs-index` root of N = 40 projects whose discovery fails
//     (40 `repo-unreadable` rows, 40 redactions of a stderr the rows then drop), and a `docs-tree` whose draft phase
//     answers `unreadable` with a git stderr in its `detail`. Each prints its elapsed time.
// The fixtures plant a `git` in the harness's own bin (first on every contained PATH) that answers ONE subcommand with
// canned stderr and execs the real git for every other call: a file, never a `bash -c` string built from a path.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactDocsText } from '../../shared/docs.js';
import { harnessBin, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { docsRepo, REAL_GIT, runCcdDocs, type DocsRun } from './ccdDocsHelpers.js';
import { unitJson } from './docsHelperPy.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** A single-quoted sh word. */
const shWord = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** Plant `harnessBin(home)/git`: a call whose argv holds the word `sub` prints `stderr` and exits `rc`; every other call
 *  execs the real git by its absolute path. Planting again replaces the wrapper. */
function plantGitStderr(home: string, sub: string, rc: number, stderr: string): void {
  const f = path.join(harnessBin(home), 'git');
  fs.writeFileSync(f, [
    '#!/bin/sh',
    '# A canned-stderr git (server/test/ccd-docs-helper-redactor.test.ts): one subcommand fails, every other call is real.',
    'case " $* " in',
    `  *${shWord(` ${sub} `)}*) printf '%s' ${shWord(stderr)} >&2; exit ${rc} ;;`,
    'esac',
    `exec ${shWord(REAL_GIT)} "$@"`,
    '',
  ].join('\n'), { mode: 0o755 });
  fs.chmodSync(f, 0o755);
}

/** The fan-out root's size: one redaction per project. */
const FANOUT_N = 40;

/** `FANOUT_N` projects `p00`..`p39` under the harness's projects root, each a directory holding an empty `.git`
 *  directory: discovery's `rev-parse` fails on each (rc 128), so each is a `repo-unreadable` row whose stderr head was
 *  redacted and then dropped. */
function plantFanoutRoot(h: CcdHarness): string[] {
  const names = Array.from({ length: FANOUT_N }, (_v, i) => `p${String(i).padStart(2, '0')}`);
  for (const n of names) fs.mkdirSync(path.join(h.home, 'projects', n, '.git'), { recursive: true });
  return names;
}

/** The secret-bearing stderr the draft phase's `worktree list` answers with in the drafts fixture. */
const DRAFTS_STDERR = "fatal: unable to access 'https://u:tok@example.invalid/x.git/': planted\nAuthorization: Bearer y\n";

/** One docs repository `demo` whose `worktree list` fails with `DRAFTS_STDERR`: `docs-tree --project demo` answers ok
 *  with drafts `unreadable {step:worktree-list}` and the redacted stderr head in its `detail`. Returns the main
 *  checkout's real path. */
function plantDraftsFixture(h: CcdHarness): string {
  const main = docsRepo(h, 'demo');
  plantGitStderr(h.home, 'worktree', 128, DRAFTS_STDERR);
  return fs.realpathSync(main);
}

/** A run's stdout with its run-dependent values replaced: `elapsedMs` by 0, then each `[value, placeholder]` pair. */
function normalized(stdout: string, subs: ReadonlyArray<readonly [string, string]> = []): string {
  let s = stdout.replace(/"elapsedMs":\d+/g, '"elapsedMs":0');
  for (const [v, p] of subs) s = s.split(v).join(p);
  return s;
}

/** The fan-out index's whole answer, normalized. */
const FANOUT_INDEX_LINE = `{"v":1,"verb":"docs-index","ok":true,"elapsedMs":0,"unlisted":0,"duplicates":[],"projects":[${
  Array.from({ length: FANOUT_N }, (_v, i) => `{"project":"p${String(i).padStart(2, '0')}","state":"repo-unreadable","github":{"state":"none"}}`).join(',')
}]}\n`;

/** The drafts fixture's whole answer, normalized (`<M>` the main checkout's real path, `<C>` the one commit). */
const DRAFTS_TREE_LINE = '{"v":1,"verb":"docs-tree","ok":true,"elapsedMs":0,"project":"demo","repo":{"key":"<K>","objectFormat":"sha1","shallow":false},"github":{"state":"none"},"ref":{"requested":null,"served":"refs/remotes/origin/main","name":"main","side":"origin","commit":"<C>","via":"default:origin-head","tried":[{"ref":"refs/remotes/origin/HEAD","result":"resolved"}],"relation":"equal","counterpart":{"ref":"refs/heads/main","commit":"<C>","ahead":0,"behind":0,"count":"measured"}},"mainCheckout":{"path":"<M>","branch":"main","head":"<C>"},"sections":[{"slug":"specs","path":"docs/superpowers/specs","state":"present","count":1},{"slug":"plans","path":"docs/superpowers/plans","state":"absent","count":0},{"slug":"product-design","path":"docs/product-design","state":"absent","count":0},{"slug":"conventions","path":"docs/conventions","state":"absent","count":0}],"entries":[{"section":"specs","path":"a.md","committed":{"kind":"file","blob":"7f3b95d297183eca8f6cf38ceaa253bee8c2d7cd","size":4},"draft":null}],"unlisted":{"count":0,"byReason":{}},"drafts":{"state":"unreadable","branch":"main","worktree":null,"step":"worktree-list","detail":"worktree list rc 128: fatal: unable to access \'https://***@example.invalid/x.git/\': planted\\nAuthorization: ***"},"freshness":{"remote":"origin","trackedRef":"refs/remotes/origin/main","stamp":null,"fetchHead":null}}\n';

/** The drafts fixture's run-dependent values: the main checkout's path, its one commit and its repo key. */
function draftsSubs(h: CcdHarness, main: string, r: DocsRun): Array<[string, string]> {
  const key = /"repo":\{"key":"([0-9a-f]{32})"/.exec(r.stdout)?.[1] ?? '<no key>';
  return [[main, '<M>'], [h.git(main, 'rev-parse', 'HEAD'), '<C>'], [key, '<K>']];
}

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccd-docs-'); });
afterEach(() => { h.cleanup(); });

/** profiles.json's docs and cross rows, the shapes `redact.test.ts` pins the TS redactor to. */
const PROFILES: { docs: [string, string, string][]; cross: [string, string, string][] } =
  JSON.parse(fs.readFileSync(path.join(here, 'fixtures/redact/profiles.json'), 'utf8'));

/** Every string the corpus row compares: each docs row's input and output, each cross row's input, and the shapes the
 *  helper's own strings take on the way back (a lone surrogate from a decoded stderr, a multi-line head). */
const REDACTOR_CORPUS: readonly string[] = [
  ...PROFILES.docs.flatMap(([, input, output]) => [input, output]),
  ...PROFILES.cross.map(([input]) => input),
  'fatal: https://u:tok@h/r \udcff',
  DRAFTS_STDERR,
  "fatal: unable to access 'https://u:tok@example.invalid/x.git/': Could not resolve host\n",
];

describe('characterization: the helper redactor before it moves (D-7077; C5h commit 1)', () => {
  it('the corpus row: H.redact equals redactDocsText over profiles.json\'s docs and cross rows', () => {
    const file = path.join(h.home, 'c5h-corpus.json');
    fs.writeFileSync(file, JSON.stringify(REDACTOR_CORPUS));
    const py = unitJson<string[]>(h.home, [
      'import json',
      `C = json.load(open(${JSON.stringify(file)}, encoding='utf-8'))`,
      'out([H.redact(s) for s in C])',
    ].join('\n'));
    const ts = REDACTOR_CORPUS.map(redactDocsText);
    expect(py).toHaveLength(REDACTOR_CORPUS.length);
    expect(REDACTOR_CORPUS.filter((_s, i) => py[i] !== ts[i])).toEqual([]);
    // Vacuity: the corpus holds strings each rule changes and strings no rule changes.
    expect(REDACTOR_CORPUS.filter((s, i) => ts[i] !== s).length).toBeGreaterThanOrEqual(10);
    expect(REDACTOR_CORPUS.filter((s, i) => ts[i] === s).length).toBeGreaterThanOrEqual(10);
  });

  it('double redaction: a git-failed whose stderr carries a secret, pinned byte for byte', () => {
    h.makeRepo('demo');
    // Token bodies are built at run time, so this public file never carries a contiguous token-shaped literal.
    const body = 'A1b2'.repeat(6);
    plantGitStderr(h.home, 'for-each-ref', 128, `fatal: https://u:tok@example.invalid/x?token=abc gho_${body}\nAuthorization: Bearer y\n`);
    const r = runCcdDocs(h, ['docs-tree', '--project', 'demo']);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(normalized(r.stdout)).toBe(
      '{"v":1,"verb":"docs-tree","ok":false,"elapsedMs":0,"failure":"git-failed","step":"for-each-ref","rc":128,'
      + '"stderrHead":"fatal: https://***@example.invalid/x?token=*** gho_***\\nAuthorization: ***"}\n');
  });

  it('double redaction: a docs-fetch failure whose stderr carries a secret, pinned byte for byte', () => {
    h.makeRepo('demo');
    plantGitStderr(h.home, 'fetch', 128, "fatal: unable to access 'https://u:tok@example.invalid/x.git/': Could not resolve host\n");
    const r = runCcdDocs(h, ['docs-fetch', '--project', 'demo']);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    const head = "fatal: unable to access 'https://***@example.invalid/x.git/': Could not resolve host";
    expect(normalized(r.stdout)).toBe(
      `{"v":1,"verb":"docs-fetch","ok":false,"elapsedMs":0,"failure":"fetch-transport","branch":"main","detail":${JSON.stringify(head)},"stderrHead":${JSON.stringify(head)}}\n`);
  });

  it('failure_line redacts detail BEFORE its 2 KiB cut: a secret the cut would split never leaks a prefix', () => {
    // The cut at 2048 bytes falls inside the userinfo; cut-then-redact would leave `https://user:secre`, which no rule
    // matches any more because its `@` was cut away.
    const got = unitJson<string>(h.home, [
      `detail = 'fatal: ' + 'x' * 2023 + 'https://user:secrettoken@example.invalid/x.git/'`,
      "out(H.failure_line('docs-fetch', None, H.Fail('fetch-failed', {'detail': detail})).decode('utf-8'))",
    ].join('\n'));
    const detail = String((JSON.parse(got) as Record<string, unknown>)['detail']);
    expect(Buffer.byteLength(detail)).toBeLessThanOrEqual(2048);
    expect(detail).not.toContain('secre');
    expect(detail).toContain('https://***@');
  });

  it(`the fan-out index: ${FANOUT_N} projects whose discovery fails, pinned byte for byte`, () => {
    plantFanoutRoot(h);
    const t0 = Date.now();
    const r = runCcdDocs(h, ['docs-index', '--all']);
    console.log(`c5h fan-out docs-index (N = ${FANOUT_N}): ${Date.now() - t0} ms through ccd, elapsedMs ${/"elapsedMs":(\d+)/.exec(r.stdout)?.[1]}`);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(normalized(r.stdout)).toBe(FANOUT_INDEX_LINE);
  });

  it('the drafts fixture: a docs-tree whose draft phase is unreadable with a git stderr, pinned byte for byte', () => {
    const main = plantDraftsFixture(h);
    const t0 = Date.now();
    const r = runCcdDocs(h, ['docs-tree', '--project', 'demo']);
    console.log(`c5h drafts docs-tree: ${Date.now() - t0} ms through ccd, elapsedMs ${/"elapsedMs":(\d+)/.exec(r.stdout)?.[1]}`);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(normalized(r.stdout, draftsSubs(h, main, r))).toBe(DRAFTS_TREE_LINE);
  });
});

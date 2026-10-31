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

// ---- C5h commit 7: the redactor process and its failure path (O2 (b), spec §5.13; D-7127; design note §3.2-§3.4) ----
// The helper redacts through ONE node per docs verb, started lazily at the first redaction by `Sys._redactor` (never
// `self.spawn`), fed the CLI's and `redact.mjs`'s bytes that python read once and checked against the pins, and bounded
// by one per-verb budget. A redactor that fails answers the whole verb `helper-failed` / `redactor-failed`: no python copy
// of the rules stands behind it.
//
// THE STUB CLIs. Each stub holds the specifier './redact.mjs' exactly once (its one import) and no other spelling of it,
// sits beside a copy of the repository's `redact.mjs`, and writes a START MARKER (its pid, one line appended per start) as
// its first statement, so a row can tell a stub that ran from a redactor refused before node started. Each stub row
// asserts its marker before its answer.
import { execFileSync, spawnSync as spawnSyncC7 } from 'node:child_process';
import crypto from 'node:crypto';
import { DOCS_MAX_DOC_BYTES } from '../../shared/docs.js';
import { CCD, CCD_REDACT, CCD_REDACT_CLI, ghContainedEnv, installDirectEntry } from './ccdWsHelpers.js';
import { REAL_PYTHON3 } from './ccdDocsHelpers.js';
import { docsHelperSource, runDocsUnit } from './docsHelperPy.js';

const REPO_C7 = path.resolve(here, '..', '..');
const roots = (): string[] => [path.join(h.home, 'projects'), path.join(h.home, 'worktrees'), path.join(h.home, '.cc-sessions')];
const pyStr = (s: string): string => JSON.stringify(s);
const sha256 = (p: string): string => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const SECRET_FETCH = "fatal: unable to access 'https://u:tok@example.invalid/x.git/': Could not resolve host\n";
/** The failure line every redactor failure answers, elapsedMs normalized. */
const failedLine = (verb: string): string =>
  `{"v":1,"verb":"${verb}","ok":false,"elapsedMs":0,"failure":"helper-failed","detail":"redactor-failed"}\n`;
const fetchArgv = (project = 'demo'): string[] => ['docs-fetch', ...roots(), '--project', project];
const treeArgv = (): string[] => ['docs-tree', ...roots(), '--project', 'demo'];
const indexArgv = (): string[] => ['docs-index', ...roots(), '--all'];
/** A docs-fetch whose git fetch fails with a secret in its stderr: four redactions (the head, fetch_detail, then
 *  failure_line's detail and stderrHead). One project per fetch: a project fetched under 10 s ago is fetch-too-soon. */
const plantFetchFailure = (...projects: string[]): void => {
  for (const p of projects.length ? projects : ['demo']) h.makeRepo(p);
  plantGitStderr(h.home, 'fetch', 128, SECRET_FETCH);
};

/** The helper as a file, run through main() as a process: `python3 <helper> <cli> <pins> <argv...>`, contained, with the
 *  fixture HOME. */
function mainRun(cli: string, pins: string, argv: readonly string[], env: NodeJS.ProcessEnv = {}): DocsRun {
  const file = path.join(h.home, 'c5h-helper', 'docs_helper.py');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, docsHelperSource());
  }
  const r = spawnSyncC7(REAL_PYTHON3, [file, cli, pins, ...argv], {
    cwd: h.home, encoding: 'utf8', timeout: 120_000,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, PYTHONDONTWRITEBYTECODE: '1', ...env }, { systemd: true, tmux: true }),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: `${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}

type StubMode = 'mask' | 'mask-linger' | 'exit-at-line' | 'exit-now' | 'hang-after-read' | 'slow-150' | 'never-read' | 'answer-once-exit' | 'env';
/** A stub CLI in its own directory beside a copy of the repository's redact.mjs (unless `sibling` is false). Returns its
 *  path and its start marker. */
function stubCli(name: string, mode: StubMode, sibling = true): { cli: string; marker: string; envFile: string } {
  const dir = path.join(h.home, 'c5h-stubs', name);
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, 'started');
  const envFile = path.join(dir, 'env-keys');
  if (sibling) fs.copyFileSync(CCD_REDACT, path.join(dir, 'redact.mjs'));
  const body = {
    'mask': 'lines((l) => answer(l));',
    'mask-linger': 'lines((l) => answer(l)); setInterval(() => {}, 1 << 30);',
    'exit-at-line': 'lines(() => process.exit(1));',
    'exit-now': 'process.exit(1);',
    'hang-after-read': 'lines(() => {}); setInterval(() => {}, 1 << 30);',
    'slow-150': 'lines((l) => setTimeout(() => answer(l), 150));',
    'never-read': 'setInterval(() => {}, 1 << 30);',
    'answer-once-exit': 'lines((l) => { answer(l); process.stdout.end(() => process.exit(0)); });',
    'env': `writeFileSync(${pyStr(envFile)}, JSON.stringify(Object.keys(process.env).sort())); lines((l) => answer(l));`,
  }[mode];
  fs.writeFileSync(path.join(dir, 'redact-cli.mjs'), [
    "import { appendFileSync, writeFileSync } from 'node:fs';",
    "import { redact } from './redact.mjs';",
    `appendFileSync(${pyStr(marker)}, process.pid + '\\n');`,
    'const answer = (l) => process.stdout.write(JSON.stringify(redact(\'docs\', JSON.parse(l))) + \'\\n\');',
    "const lines = (f) => { let b = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { b += c; let i; while ((i = b.indexOf('\\n')) >= 0) { const l = b.slice(0, i); b = b.slice(i + 1); f(l); } }); };",
    'void writeFileSync;',
    body,
    '',
  ].join('\n'));
  return { cli: path.join(dir, 'redact-cli.mjs'), marker, envFile };
}
/** The pids a stub's marker recorded, one per start. */
const startsOf = (marker: string): number[] =>
  fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean).map(Number) : [];
/** Whether any process of the group `pgid` stands. */
const groupAlive = (pgid: number): boolean => { try { process.kill(-pgid, 0); return true; } catch { return false; } };

/** A unit body's prologue: a `Sys` subclass that counts `_redactor` starts (and optional class overrides), bound as SYS. */
const counting = (overrides: readonly string[] = []): string => [
  'class Counting(H.Sys):',
  '    starts = 0',
  ...overrides.map((o) => `    ${o}`),
  '    def _redactor(self):',
  '        type(self).starts += 1',
  '        return super()._redactor()',
  'H.SYS = Counting()',
].join('\n');

describe('the redactor process: one node per verb, bounded, failing closed (D-7077; O2 (b), spec §5.13)', () => {
  it.each(['docs-fetch', 'docs-tree'] as const)('CLI non-zero: a stub that exits 1 at its first line answers %s helper-failed / redactor-failed, rc 0, stderr empty', (verb) => {
    if (verb === 'docs-fetch') plantFetchFailure(); else plantDraftsFixture(h);
    const s = stubCli('exit-at-line', 'exit-at-line');
    const r = mainRun(s.cli, '-', verb === 'docs-fetch' ? fetchArgv() : treeArgv());
    expect(startsOf(s.marker), 'the stub started').toHaveLength(1);
    expect([r.code, normalized(r.stdout), r.stderr]).toEqual([0, failedLine(verb), '']);
  });

  it.each(['docs-tree', 'docs-fetch'] as const)('CLI exits before reading (%s): one line, one node start, no drafts row, stderr empty', (verb) => {
    if (verb === 'docs-fetch') plantFetchFailure(); else plantDraftsFixture(h);
    const s = stubCli('exit-now', 'exit-now');
    const r = runDocsUnit(h.home, [
      `H.Sys.redact_cli = ${pyStr(s.cli)}`,
      counting(),
      `line = H.run(${JSON.stringify(verb === 'docs-fetch' ? fetchArgv() : treeArgv())})`,
      "out({'line': line.decode('utf-8'), 'starts': Counting.starts})",
    ].join('\n'));
    expect(startsOf(s.marker), 'the stub started').toHaveLength(1);
    expect(r.stderr).toBe('');
    const got = JSON.parse(r.stdout) as { line: string; starts: number };
    expect(got.starts).toBe(1);
    expect(normalized(got.line)).toBe(failedLine(verb));
    expect(got.line).not.toContain('drafts');
  });

  it('a pipe error from a node that exited before reading is RedactorFailed, which is no OSError (so no `except OSError` swallows it)', () => {
    const s = stubCli('exit-now-big', 'exit-now');
    const r = runDocsUnit(h.home, [
      `H.Sys.redact_cli = ${pyStr(s.cli)}`,
      'try:',
      "    H.SYS.redact('x' * (1 << 20))",
      "    got = ['answered', False]",
      'except Exception as e:',
      '    got = [type(e).__name__, isinstance(e, OSError)]',
      'out(got)',
    ].join('\n'));
    expect(startsOf(s.marker), 'the stub started').toHaveLength(1);
    expect(JSON.parse(r.stdout)).toEqual(['RedactorFailed', false]);
  });

  it('CLI absent: main() given a CLI path that does not exist answers the same one line', () => {
    plantFetchFailure();
    const r = mainRun(path.join(h.home, 'no-such-dir', 'redact-cli.mjs'), '-', fetchArgv());
    expect([r.code, normalized(r.stdout), r.stderr]).toEqual([0, failedLine('docs-fetch'), '']);
  });

  it('the marker CONTROL: a stub whose sibling redact.mjs is missing answers redactor-failed with no marker, so a marker tells the two causes apart', () => {
    plantFetchFailure();
    const s = stubCli('no-sibling', 'mask', false);
    const r = mainRun(s.cli, '-', fetchArgv());
    expect([r.code, normalized(r.stdout), r.stderr]).toEqual([0, failedLine('docs-fetch'), '']);
    expect(startsOf(s.marker), 'no node started').toEqual([]);
  });

  it('redact_cli None: a unit that runs H.run without setting it gets the same one line from run()', () => {
    plantFetchFailure();
    const r = runDocsUnit(h.home, ['H.Sys.redact_cli = None', `out(H.run(${JSON.stringify(fetchArgv())}).decode('utf-8'))`].join('\n'));
    expect(r.stderr).toBe('');
    expect(normalized(JSON.parse(r.stdout) as string)).toBe(failedLine('docs-fetch'));
  });

  it('budget spent on a read: a stub that reads and never answers, under a 200 ms budget, answers the same line and leaves no group', () => {
    plantFetchFailure();
    const s = stubCli('hang', 'hang-after-read');
    const r = runDocsUnit(h.home, [`H.Sys.redact_cli = ${pyStr(s.cli)}`, counting(['redact_budget_ms = 200']),
      `out(H.run(${JSON.stringify(fetchArgv())}).decode('utf-8'))`].join('\n'));
    const [pid] = startsOf(s.marker);
    expect(pid, 'the stub started').toBeGreaterThan(0);
    expect(normalized(JSON.parse(r.stdout) as string)).toBe(failedLine('docs-fetch'));
    expect(groupAlive(pid!), 'the stub\'s group still stands').toBe(false);
  });

  it('budget spent across calls: four answers 150 ms apart under a 400 ms budget fail the verb; the budget is the verb\'s, not each call\'s', () => {
    plantFetchFailure('demo', 'demo2');
    const s = stubCli('slow', 'slow-150');
    const run = (budget: string[], project: string): string => {
      const r = runDocsUnit(h.home, [`H.Sys.redact_cli = ${pyStr(s.cli)}`, counting(budget),
        `out(H.run(${JSON.stringify(fetchArgv(project))}).decode('utf-8'))`].join('\n'));
      return normalized(JSON.parse(r.stdout) as string);
    };
    expect(run(['redact_budget_ms = 400'], 'demo')).toBe(failedLine('docs-fetch'));
    expect(startsOf(s.marker), 'one node for the verb').toHaveLength(1);
    // CONTROL: the same stub inside the verb's default budget answers the verb.
    expect(JSON.parse(run([], 'demo2'))).toMatchObject({ ok: false, failure: 'fetch-transport' });
  });

  it('budget spent on a write: a stub that never reads, and a 2 MiB request under a 300 ms budget, fails within the budget plus 1 s and leaves no group', () => {
    const s = stubCli('never-read', 'never-read');
    const r = runDocsUnit(h.home, [
      'import os, time',
      `H.Sys.redact_cli = ${pyStr(s.cli)}`,
      counting(['redact_budget_ms = 300']),
      't0 = time.perf_counter()',
      'try:',
      "    H.redact('x' * (2 * 1024 * 1024))",
      "    got = 'answered'",
      'except H.RedactorFailed:',
      "    got = 'RedactorFailed'",
      "out({'got': got, 'ms': (time.perf_counter() - t0) * 1000})",
    ].join('\n'), { timeoutMs: 60_000 });
    const got = JSON.parse(r.stdout) as { got: string; ms: number };
    const [pid] = startsOf(s.marker);
    expect(pid, 'the stub started').toBeGreaterThan(0);
    expect(got.got).toBe('RedactorFailed');
    expect(got.ms).toBeLessThan(1300);
    expect(groupAlive(pid!)).toBe(false);
  });

  it.each(['mask', 'exit-at-line'] as const)('no node left after a verb through main() (a %s stub)', (mode) => {
    plantFetchFailure();
    const s = stubCli(mode, mode);
    const r = mainRun(s.cli, '-', fetchArgv());
    const [pid] = startsOf(s.marker);
    expect(pid, 'the stub started').toBeGreaterThan(0);
    expect(r.code).toBe(0);
    expect(groupAlive(pid!), 'the stub\'s group outlived the verb').toBe(false);
  });

  it('run()\'s finally closes the redactor: its group is gone when run() returns, before python exits', () => {
    plantFetchFailure();
    const s = stubCli('closed', 'mask');
    const r = runDocsUnit(h.home, [
      'import os',
      `H.Sys.redact_cli = ${pyStr(s.cli)}`,
      `H.run(${JSON.stringify(fetchArgv())})`,
      `pid = int(open(${pyStr(s.marker)}).read().split()[0])`,
      'try:',
      '    os.killpg(pid, 0)',
      "    out('stands')",
      'except ProcessLookupError:',
      "    out('gone')",
    ].join('\n'));
    expect(JSON.parse(r.stdout)).toBe('gone');
  });

  it('the failure is sticky: a second redact after a RedactorFailed raises at once and starts no second node', () => {
    const s = stubCli('sticky', 'exit-at-line');
    const r = runDocsUnit(h.home, [
      `H.Sys.redact_cli = ${pyStr(s.cli)}`,
      'got = []',
      'for _ in range(2):',
      '    try:',
      "        H.SYS.redact('https://u:tok@h/x')",
      "        got.append('answered')",
      '    except H.RedactorFailed:',
      "        got.append('RedactorFailed')",
      'out(got)',
    ].join('\n'));
    expect(JSON.parse(r.stdout)).toEqual(['RedactorFailed', 'RedactorFailed']);
    expect(startsOf(s.marker), 'one node, never a second').toHaveLength(1);
  });

  it('no node left after a unit: three H.Sys instances redact outside run(), and the atexit hook closes all three', () => {
    // A stub that keeps running after its input closes, so only the hook can end it.
    const s = stubCli('three', 'mask-linger');
    const r = runDocsUnit(h.home, [
      `H.Sys.redact_cli = ${pyStr(s.cli)}`,
      'class A(H.Sys):', '    pass',
      "out([A().redact('https://u:tok@h/%d' % i) for i in range(3)])",
    ].join('\n'));
    expect(JSON.parse(r.stdout)).toEqual(['https://***@h/0', 'https://***@h/1', 'https://***@h/2']);
    const pids = startsOf(s.marker);
    expect(pids, 'three nodes started').toHaveLength(3);
    expect(pids.filter(groupAlive), 'a redactor outlived its unit').toEqual([]);
  });

  it(`docs-index fails closed: the ${FANOUT_N}-project root with a stub that exits 1 answers redactor-failed for the whole verb`, () => {
    plantFanoutRoot(h);
    const s = stubCli('index-exit', 'exit-at-line');
    const r = mainRun(s.cli, '-', indexArgv());
    expect(startsOf(s.marker)).toHaveLength(1);
    expect([r.code, normalized(r.stdout), r.stderr]).toEqual([0, failedLine('docs-index'), '']);
  });

  it('the budget is time inside the redactor, not wall time: four redactions 500 ms of git apart answer ok, through one node', () => {
    for (const p of ['a', 'b', 'c', 'd']) fs.mkdirSync(path.join(h.home, 'projects', p, '.git'), { recursive: true });
    fs.writeFileSync(path.join(harnessBin(h.home), 'git'),
      ['#!/bin/sh', 'case " $* " in *" rev-parse "*) sleep 0.5 ;; esac', `exec ${shWord(REAL_GIT)} "$@"`, ''].join('\n'), { mode: 0o755 });
    const t0 = Date.now();
    const r = runDocsUnit(h.home, [counting(), `line = H.run(${JSON.stringify(indexArgv())})`,
      "out({'line': line.decode('utf-8'), 'starts': Counting.starts})"].join('\n'));
    const got = JSON.parse(r.stdout) as { line: string; starts: number };
    expect(Date.now() - t0, 'the verb\'s wall time is past the redactor budget').toBeGreaterThan(2000);
    expect(got.starts).toBe(1);
    expect(JSON.parse(got.line)).toMatchObject({ ok: true, projects: [{ project: 'a', state: 'repo-unreadable' },
      { project: 'b', state: 'repo-unreadable' }, { project: 'c', state: 'repo-unreadable' }, { project: 'd', state: 'repo-unreadable' }] });
  });

  it('close_redactor never raises: a stub that exits right after its one answer leaves run() one line, rc 0, stderr empty, no group', () => {
    const main = plantDraftsFixture(h);
    const s = stubCli('once', 'answer-once-exit');
    const r = mainRun(s.cli, '-', treeArgv());
    const [pid] = startsOf(s.marker);
    expect(pid, 'the stub started').toBeGreaterThan(0);
    expect([r.code, r.stderr]).toEqual([0, '']);
    expect(normalized(r.stdout, draftsSubs(h, main, r))).toBe(DRAFTS_TREE_LINE);
    expect(groupAlive(pid!)).toBe(false);
  });

  it('state resets per run(): a failed run, then a run with the real CLI on the same SYS, answers as a fresh process does', () => {
    plantFetchFailure('demo', 'demo2', 'demo3');
    const s = stubCli('reset', 'exit-at-line');
    const r = runDocsUnit(h.home, [
      `H.Sys.redact_cli = ${pyStr(s.cli)}`,
      `first = H.run(${JSON.stringify(fetchArgv('demo'))}).decode('utf-8')`,
      `H.Sys.redact_cli = ${pyStr(CCD_REDACT_CLI)}`,
      `second = H.run(${JSON.stringify(fetchArgv('demo2'))}).decode('utf-8')`,
      'out([first, second])',
    ].join('\n'));
    const [first, second] = JSON.parse(r.stdout) as [string, string];
    expect(normalized(first)).toBe(failedLine('docs-fetch'));
    const fresh = mainRun(CCD_REDACT_CLI, '-', fetchArgv('demo3'));
    expect(normalized(second)).toBe(normalized(fresh.stdout));
    expect(JSON.parse(second)).toMatchObject({ ok: false, failure: 'fetch-transport' });
  });

  it('the redactor never goes through self.spawn: a unit\'s spawn override sees git, and never node', () => {
    plantDraftsFixture(h);
    const r = runDocsUnit(h.home, [
      'seen = []',
      'class Rec(H.Sys):',
      '    starts = 0',
      '    def spawn(self, argv, *a, **k):',
      '        seen.append(list(argv))',
      '        return super().spawn(argv, *a, **k)',
      '    def _redactor(self):',
      '        type(self).starts += 1',
      '        return super()._redactor()',
      'H.SYS = Rec()',
      `o = H.json.loads(H.run(${JSON.stringify(treeArgv())}).decode('utf-8'))`,
      "out({'ok': o['ok'], 'starts': Rec.starts, 'argv0': sorted(set(a[0] for a in seen)), 'node': [a for a in seen if 'node' in a[:1] or '--input-type=module' in a]})",
    ].join('\n'));
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, starts: 1, argv0: ['git'], node: [] });
  });

  it('spawn count: one node for all 40 projects, one for the drafts fixture, none for an ok docs-show', () => {
    plantFanoutRoot(h);
    const main = plantDraftsFixture(h);
    const commit = h.git(main, 'rev-parse', 'HEAD');
    const show = ['docs-show', ...roots(), '--project', 'demo', '--commit', commit, '--ref', 'refs/remotes/origin/main',
      '--section', 'specs', '--path', 'a.md', '--max-bytes', String(DOCS_MAX_DOC_BYTES)];
    const counts = (argv: readonly string[]): { starts: number; ok: boolean } => JSON.parse(runDocsUnit(h.home, [counting(),
      `o = H.json.loads(H.run(${JSON.stringify(argv)}).decode('utf-8'))`, "out({'starts': Counting.starts, 'ok': o['ok']})"].join('\n')).stdout);
    expect(counts(indexArgv())).toEqual({ starts: 1, ok: true });
    expect(counts(treeArgv())).toEqual({ starts: 1, ok: true });
    expect(counts(show)).toEqual({ starts: 0, ok: true });
  });
});

/** A scratch copy of the repository's CLI and redact.mjs in its own directory, for the read-once rows. */
function scratchPair(name: string): { dir: string; cli: string; mjs: string; pins: string } {
  const dir = path.join(h.home, 'c5h-pair', name);
  fs.mkdirSync(dir, { recursive: true });
  const cli = path.join(dir, 'redact-cli.mjs');
  const mjs = path.join(dir, 'redact.mjs');
  fs.copyFileSync(CCD_REDACT_CLI, cli);
  fs.copyFileSync(CCD_REDACT, mjs);
  return { dir, cli, mjs, pins: `${sha256(mjs)},${sha256(cli)}` };
}
/** One byte of the docs userinfo rule's mask changed: `***@` becomes `**!@`. */
const editRule = (mjs: string): void => {
  const t = fs.readFileSync(mjs, 'utf8');
  if (!t.includes("'***@']")) throw new Error('the docs userinfo mask moved');
  fs.writeFileSync(mjs, t.replace("'***@']", "'**!@']"));
};
const LEAK = 'fatal: https://u:tok@h/r \udcff';
const MASKED = 'fatal: https://***@h/r \udcff';
/** A unit that redacts LEAK once through `cli` with `pins`, counting Popen calls: its answer (or the exception's class),
 *  the Popen count and whether a process was left on the instance. */
function readOnce(cli: string, pins: string, pre: readonly string[] = [], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): { got: string; popens: number; proc: boolean } {
  const r = runDocsUnit(h.home, [
    'import subprocess',
    `H.Sys.redact_cli, H.Sys.redact_pins = ${pyStr(cli)}, ${pyStr(pins)}`,
    'popens = []',
    '_real_popen = H.subprocess.Popen',
    'def _counting_popen(*a, **k):',
    '    popens.append(1)',
    '    return _real_popen(*a, **k)',
    'H.subprocess.Popen = _counting_popen',
    ...pre,
    'try:',
    `    got = H.SYS.redact(${pyStr(LEAK)})`,
    'except Exception as e:',
    '    got = type(e).__name__',
    'finally:',
    '    H.subprocess.Popen = _real_popen',
    "out({'got': got, 'popens': len(popens), 'proc': H.SYS._rd_proc is not None})",
  ].join('\n'), { env: opts.env });
  if (r.code !== 0) throw new Error(`readOnce unit exited ${r.code}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

describe('the read-once start: python checks the bytes it hands node, and node opens no file (D-7127; design note §3.3)', () => {
  it('the checked pair redacts, through exactly one _redactor call', () => {
    const p = scratchPair('ok');
    const r = runDocsUnit(h.home, [`H.Sys.redact_cli, H.Sys.redact_pins = ${pyStr(p.cli)}, ${pyStr(p.pins)}`, counting(),
      `out({'got': [H.SYS.redact(s) for s in ${JSON.stringify([LEAK, 'GET /x?token=abc', 'plain'])}], 'starts': Counting.starts})`].join('\n'));
    expect(JSON.parse(r.stdout)).toEqual({ got: [MASKED, 'GET /x?token=***', 'plain'], starts: 1 });
  });

  it('redact.mjs changed by one byte after the pins were taken: RedactorFailed, and no node started', () => {
    const p = scratchPair('edited-mjs');
    editRule(p.mjs);
    expect(readOnce(p.cli, p.pins)).toEqual({ got: 'RedactorFailed', popens: 0, proc: false });
  });

  it('the CLI changed after the pins were taken (an echo CLI that writes each line back unmasked): RedactorFailed, no node', () => {
    const p = scratchPair('echo-cli');
    fs.appendFileSync(p.cli, "process.stdin.on('data', (c) => process.stdout.write(c));\n");
    expect(readOnce(p.cli, p.pins)).toEqual({ got: 'RedactorFailed', popens: 0, proc: false });
  });

  it('a mixed pair (this CLI beside another tree\'s redact.mjs): RedactorFailed', () => {
    const a = scratchPair('mixed');
    const pins = a.pins;
    editRule(a.mjs);
    expect(readOnce(a.cli, pins)).toEqual({ got: 'RedactorFailed', popens: 0, proc: false });
  });

  it('pins `-` (a source checkout) with the same edited redact.mjs redacts by the edited rules: `-` is "unchecked" and nothing else', () => {
    const p = scratchPair('dash');
    editRule(p.mjs);
    expect(readOnce(p.cli, '-')).toMatchObject({ got: 'fatal: https://**!@h/r \udcff', popens: 1 });
  });

  it('node is given bytes, not a path: redact.mjs edited on disk right after python read it still answers by the checked rules', () => {
    const p = scratchPair('swap');
    expect(readOnce(p.cli, p.pins, [
      '_real_rd_read = H._rd_read',
      'def _edit_after_read(path):',
      '    data = _real_rd_read(path)',
      "    if path.rsplit('/', 1)[-1] == 'redact.mjs':",
      "        t = open(path).read()",
      "        open(path, 'w').write(t.replace(\"'***@']\", \"'**!@']\"))",
      '    return data',
      'H._rd_read = _edit_after_read',
    ])).toMatchObject({ got: MASKED, popens: 1 });
    expect(fs.readFileSync(p.mjs, 'utf8'), 'the file on disk was edited').toContain("'**!@']");
  });

  it.each(['the CLI', 'redact.mjs'] as const)('%s as a link to an identical file: RedactorFailed, and no node started', (which) => {
    const p = scratchPair(`link-${which === 'the CLI' ? 'cli' : 'mjs'}`);
    const other = scratchPair(`link-target-${which === 'the CLI' ? 'cli' : 'mjs'}`);
    const at = which === 'the CLI' ? p.cli : p.mjs;
    fs.rmSync(at);
    fs.symlinkSync(which === 'the CLI' ? other.cli : other.mjs, at);
    expect(readOnce(p.cli, p.pins)).toEqual({ got: 'RedactorFailed', popens: 0, proc: false });
  });

  it.each([
    ['no \'./redact.mjs\' spelling', (t: string) => t.replace("from './redact.mjs';", "from './rules.mjs';")],
    ['two \'./redact.mjs\' spellings', (t: string) => t.replace("import { redact } from './redact.mjs';", "import { redact } from './redact.mjs';\nimport './redact.mjs';")],
  ])('a CLI with %s: RedactorFailed, and no node started', (_why, edit) => {
    const p = scratchPair(`spell-${_why.length}`);
    fs.writeFileSync(p.cli, edit(fs.readFileSync(p.cli, 'utf8')));
    expect(readOnce(p.cli, '-')).toEqual({ got: 'RedactorFailed', popens: 0, proc: false });
  });

  it.each([
    ['a comment spelling plus a double-quoted import', (t: string) => t.replace("import { redact } from './redact.mjs';", "// see './redact.mjs'\nimport { redact } from \"./redact.mjs\";")],
    ['a dynamic import(', (t: string) => `${t}void import('./x.mjs');\n`],
  ])('the residue check: %s is refused before any Popen', (_why, edit) => {
    const p = scratchPair(`residue-${_why.length}`);
    fs.writeFileSync(p.cli, edit(fs.readFileSync(p.cli, 'utf8')));
    expect(readOnce(p.cli, '-')).toEqual({ got: 'RedactorFailed', popens: 0, proc: false });
  });

  it('the planted cwd: a redact.mjs that masks nothing in python\'s cwd is never what node runs', () => {
    fs.writeFileSync(path.join(h.home, 'redact.mjs'), 'export function redact(p, s) { return s; }\n');
    expect(readOnce(CCD_REDACT_CLI, '-')).toMatchObject({ got: MASKED, popens: 1 });
  });

  it('the end-to-end swap: an installed docs-index whose redact.mjs changes after the front and before node answers redactor-failed, never the edited rules', () => {
    plantFanoutRoot(h);
    const { body } = installDirectEntry(h.home);
    const mjs = path.join(path.dirname(body), 'shared', 'redact.mjs');
    const wrapper = (rewrite: boolean): void => {
      fs.writeFileSync(path.join(harnessBin(h.home), 'python3'), [
        '#!/bin/sh',
        // Only the helper's start (`/dev/fd/3`), never the front's `-c` probe: the rewrite lands after the front's check.
        ...(rewrite ? [`[ "$1" = /dev/fd/3 ] && ${shWord(REAL_PYTHON3)} -c 'import sys; p = sys.argv[1]; t = open(p).read(); open(p, "w").write(t.replace("\\x27***@\\x27]", "\\x27**!@\\x27]", 1))' ${shWord(mjs)}`] : []),
        `exec ${shWord(REAL_PYTHON3)} "$@"`,
        '',
      ].join('\n'), { mode: 0o755 });
    };
    const run = (): DocsRun => {
      const r = spawnSyncC7('bash', [body, 'docs-index', '--all'], { cwd: h.home, encoding: 'utf8', timeout: 120_000,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    wrapper(false);
    const control = run();
    expect([control.code, normalized(control.stdout), control.stderr], 'CONTROL: no rewrite answers the pinned index').toEqual([0, FANOUT_INDEX_LINE, '']);
    wrapper(true);
    const swapped = run();
    expect(fs.readFileSync(mjs, 'utf8'), 'the installed redact.mjs was rewritten').toContain("'**!@']");
    expect([swapped.code, normalized(swapped.stdout), swapped.stderr]).toEqual([0, failedLine('docs-index'), '']);
  });
});

describe('what node is started with: its environment and the files python reads (D-7127; design note §3.4)', () => {
  const PRELOAD = '--import data:text/javascript,String.prototype.replace=function(){return%20String(this)}';

  it('an inherited NODE_OPTIONS preload never reaches the redactor: rc 0 and exactly the masked line', () => {
    expect(readOnce(CCD_REDACT_CLI, '-', [], { env: { NODE_OPTIONS: PRELOAD } })).toMatchObject({ got: MASKED, popens: 1 });
  });

  it('CONTROL: the same preload given to a node started on the redactor\'s own argv with the inherited environment answers exactly the unmasked line', () => {
    const r = runDocsUnit(h.home, [
      'import base64, json, os, subprocess',
      `cli = ${pyStr(CCD_REDACT_CLI)}`,
      "mjs = open(os.path.join(os.path.dirname(cli), 'redact.mjs'), 'rb').read()",
      "src = open(cli, 'rb').read().decode('utf-8').replace(\"'./redact.mjs'\", \"'data:text/javascript;base64,%s'\" % base64.b64encode(mjs).decode('ascii'))",
      "p = subprocess.run(['node', '--input-type=module', '-e', src, '--', cli, '--profile', 'docs'], cwd='/',",
      `                   input=(json.dumps(${pyStr(LEAK)}) + '\\n').encode('ascii'), stdout=subprocess.PIPE, stderr=subprocess.PIPE)`,
      "out([p.returncode, json.loads(p.stdout.decode('utf-8')) if p.stdout else None])",
    ].join('\n'), { env: { NODE_OPTIONS: PRELOAD } });
    expect(JSON.parse(r.stdout)).toEqual([0, LEAK]);
  });

  it('node reports the environment it received: no NODE_* key, and PATH', () => {
    const s = stubCli('env', 'env');
    expect(readOnce(s.cli, '-', [], { env: { NODE_PATH: path.join(h.home, 'nm'), NODE_DEBUG: 'module' } })).toMatchObject({ got: MASKED });
    expect(startsOf(s.marker), 'the stub started').toHaveLength(1);
    const keys = JSON.parse(fs.readFileSync(s.envFile, 'utf8')) as string[];
    expect(keys.filter((k) => k.startsWith('NODE_'))).toEqual([]);
    expect(keys).toContain('PATH');
  });

  it('a FIFO at the redact.mjs path: RedactorFailed at once, inside the budget, with no node started', () => {
    const p = scratchPair('fifo');
    fs.rmSync(p.mjs);
    execFileSync('mkfifo', [p.mjs]);
    const t0 = Date.now();
    expect(readOnce(p.cli, '-')).toEqual({ got: 'RedactorFailed', popens: 0, proc: false });
    expect(Date.now() - t0).toBeLessThan(15_000);
  });

  it('a redact.mjs of REDACT_FILE_MAX + 1 bytes: RedactorFailed, and no node started', () => {
    const p = scratchPair('big');
    fs.writeFileSync(p.mjs, `${fs.readFileSync(p.mjs, 'utf8')}\n//${'x'.repeat(98_304)}\n`);
    expect(fs.statSync(p.mjs).size).toBeGreaterThan(98_304);
    expect(readOnce(p.cli, '-')).toEqual({ got: 'RedactorFailed', popens: 0, proc: false });
  });

  it('the orphan kill: a raise right after Popen kills node\'s group, and nothing is left on the instance or in _REDACT_LIVE', () => {
    const r = runDocsUnit(h.home, [
      'import os',
      'seen = []',
      '_real = H.os.set_blocking',
      'def _fails(fd, flag):',
      '    seen.extend(p.pid for p in H._REDACT_LIVE)',
      "    raise OSError(5, 'planted')",
      'H.os.set_blocking = _fails',
      'try:',
      "    H.SYS.redact('x')",
      "    got = 'answered'",
      'except H.RedactorFailed:',
      "    got = 'RedactorFailed'",
      'finally:',
      '    H.os.set_blocking = _real',
      '    left = [p.pid for p in H._REDACT_LIVE]',
      '    for p in list(H._REDACT_LIVE):',
      '        H._redact_kill(p)',
      '    proc = H.SYS._rd_proc is not None',
      '    H.SYS.reset_redactor()',
      'try:',
      '    os.killpg(seen[0], 0)',
      "    group = 'stands'",
      'except ProcessLookupError:',
      "    group = 'gone'",
      "out({'got': got, 'seen': len(seen), 'left': left, 'proc': proc, 'group': group})",
    ].join('\n'));
    expect(JSON.parse(r.stdout)).toEqual({ got: 'RedactorFailed', seen: 1, left: [], proc: false, group: 'gone' });
  });
});

describe('_docs_redact_cli hands python an absolute CLI path, whatever cwd ccd ran from (D-7125; design note §2)', () => {
  it('from the repository root, `bash ccd/ccd docs-index` gives python an absolute first argument: the checkout\'s CLI', () => {
    const rec = path.join(h.home, 'python3-argv2');
    fs.writeFileSync(path.join(harnessBin(h.home), 'python3'), [
      '#!/bin/sh',
      `[ "$1" = /dev/fd/3 ] && printf '%s\\n%s\\n' "$2" "$3" > ${shWord(rec)}`,
      `exec ${shWord(REAL_PYTHON3)} "$@"`,
      '',
    ].join('\n'), { mode: 0o755 });
    const r = spawnSyncC7('bash', [path.relative(REPO_C7, CCD), 'docs-index', '--all'], { cwd: REPO_C7, encoding: 'utf8', timeout: 120_000,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    expect(r.status, r.stderr).toBe(0);
    const [cli, pins] = fs.readFileSync(rec, 'utf8').split('\n');
    expect(path.isAbsolute(cli!), `python's first argument is ${cli}`).toBe(true);
    expect(path.resolve(cli!)).toBe(CCD_REDACT_CLI);
    expect(pins).toBe('-');
  });
});

// ---- C5h commit 9: the docs front's node and redactor probe, with its digest check (O2 (b), spec §5.13; OA-C11 (a);
// D-7125; design note §2) ----
// Before any work, the front answers `helper-unavailable` with `node-missing` (no node on PATH), `redactor-missing` (the CLI
// or the redact.mjs beside it is not a readable regular file; installed, a link at either path too) or `redactor-mismatch`
// (installed: a file whose SHA-256, through the hashing command the library loader chose, is not its pin, an empty digest
// included). The source checkout checks no digest.
const unavailable = (verb: string, why: string): string =>
  `{"v":1,"verb":"${verb}","ok":false,"elapsedMs":0,"failure":"helper-unavailable","detail":"${why}"}\n`;

/** Every command on this process's PATH except `missing`, as one link farm: one absent tool, and nothing else lost. */
function pathWithout(...missing: string[]): string {
  const farm = path.join(h.home, `no-${missing.join('-')}-bin`);
  fs.mkdirSync(farm, { recursive: true });
  const seen = new Set<string>(missing);
  for (const dir of (process.env['PATH'] ?? '/usr/bin:/bin').split(path.delimiter)) {
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      fs.symlinkSync(path.join(dir, name), path.join(farm, name));
    }
  }
  return farm;
}

/** An installed ccd (the shipped pair, its library and its redactor beside the body) under the fixture HOME, run as the
 *  agent's launcher would run its body. */
function installed(): { run: (args: readonly string[], env?: NodeJS.ProcessEnv) => DocsRun; cli: string; mjs: string } {
  const { body } = installDirectEntry(h.home);
  const run = (args: readonly string[], env: NodeJS.ProcessEnv = {}): DocsRun => {
    const r = spawnSyncC7('bash', [body, ...args], { cwd: h.home, encoding: 'utf8', timeout: 120_000,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, ...env }, { systemd: true, tmux: true }) });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  return { run, cli: path.join(path.dirname(body), 'shared', 'redact-cli.mjs'), mjs: path.join(path.dirname(body), 'shared', 'redact.mjs') };
}
const INDEX = ['docs-index', '--all'];

describe('the docs front probes node and the pinned redactor before any work (D-7077; O2 (b), spec §5.13)', () => {
  it('no node on the PATH ccd runs with answers helper-unavailable / node-missing', () => {
    const r = runCcdDocs(h, INDEX, { PATH: pathWithout('node') });
    expect([r.code, r.stdout, r.stderr]).toEqual([0, unavailable('docs-index', 'node-missing'), '']);
  });

  it('CONTROL: the unedited installed redactor answers the verb', () => {
    plantFanoutRoot(h);
    const r = installed().run(INDEX);
    expect([r.code, normalized(r.stdout), r.stderr]).toEqual([0, FANOUT_INDEX_LINE, '']);
  });

  it.each(['redact-cli.mjs', 'redact.mjs'] as const)('an installed tree without shared/%s answers redactor-missing', (f) => {
    const t = installed();
    fs.rmSync(f === 'redact.mjs' ? t.mjs : t.cli);
    const r = t.run(INDEX);
    expect([r.code, r.stdout, r.stderr]).toEqual([0, unavailable('docs-index', 'redactor-missing'), '']);
  });

  it('an installed redact.mjs with one byte changed answers redactor-mismatch, before any work', () => {
    const t = installed();
    editRule(t.mjs);
    const r = t.run(INDEX);
    expect([r.code, r.stdout, r.stderr]).toEqual([0, unavailable('docs-index', 'redactor-mismatch'), '']);
  });

  it('an installed CLI changed (an echo CLI that writes each line back unmasked) answers redactor-mismatch', () => {
    const t = installed();
    fs.appendFileSync(t.cli, "process.stdin.on('data', (c) => process.stdout.write(c));\n");
    const r = t.run(INDEX);
    expect([r.code, r.stdout, r.stderr]).toEqual([0, unavailable('docs-index', 'redactor-mismatch'), '']);
  });

  it('an installed CLI replaced by a link to an identical CLI beside an edited redact.mjs answers redactor-missing, not the verb', () => {
    plantFanoutRoot(h);
    const t = installed();
    const other = scratchPair('linked-elsewhere');
    editRule(other.mjs);
    fs.rmSync(t.cli);
    fs.symlinkSync(other.cli, t.cli);
    const r = t.run(INDEX);
    expect([r.code, r.stdout, r.stderr]).toEqual([0, unavailable('docs-index', 'redactor-missing'), '']);
  });

  describe('a PATH with no sha256sum and no shasum: the front hashes with the tool the loader chose', () => {
    const stripped = (): NodeJS.ProcessEnv => ({ PATH: pathWithout('sha256sum', 'shasum') });
    it('the unedited tree answers the verb, never redactor-mismatch', () => {
      plantFanoutRoot(h);
      const r = installed().run(INDEX, stripped());
      expect([r.code, normalized(r.stdout), r.stderr]).toEqual([0, FANOUT_INDEX_LINE, '']);
    });
    it.each(['redact.mjs', 'redact-cli.mjs'] as const)('one byte of %s changed answers redactor-mismatch (the fallback tool really hashed)', (f) => {
      const t = installed();
      if (f === 'redact.mjs') editRule(t.mjs); else fs.appendFileSync(t.cli, '// edited\n');
      const r = t.run(INDEX, stripped());
      expect([r.code, r.stdout, r.stderr]).toEqual([0, unavailable('docs-index', 'redactor-mismatch'), '']);
    });
  });

  it('a hashing tool that answers the loader and then prints an empty digest answers redactor-mismatch', () => {
    const count = path.join(h.home, 'hash-calls');
    for (const tool of ['sha256sum', 'shasum']) {
      const real = execFileSync('sh', ['-c', `command -v ${tool} || true`], { encoding: 'utf8' }).trim();
      fs.writeFileSync(path.join(harnessBin(h.home), tool), [
        '#!/bin/sh',
        `echo x >> ${shWord(count)}`,
        // The loader hashes each of its two libraries (D-7463); every later call is the front's.
        `[ "$(wc -l < ${shWord(count)})" -le 2 ] && ${real ? `exec ${shWord(real)} "$@"` : 'exit 127'}`,
        'cat >/dev/null; exit 0',
        '',
      ].join('\n'), { mode: 0o755 });
    }
    const r = installed().run(INDEX);
    expect(fs.readFileSync(count, 'utf8').split('\n').filter(Boolean).length, 'the loader and the front both hashed').toBeGreaterThanOrEqual(3);
    expect([r.code, r.stdout, r.stderr]).toEqual([0, unavailable('docs-index', 'redactor-mismatch'), '']);
  });

  it('the source checkout resolves ../shared/redact-cli.mjs and checks no digest', () => {
    expect(h.sh('_docs_redact_cli path; _docs_redact_cli pins')).toBe(`${path.dirname(CCD)}/../shared/redact-cli.mjs\n-`);
    const r = runCcdDocs(h, INDEX);
    expect([r.code, r.stderr]).toEqual([0, '']);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true });
  });
});

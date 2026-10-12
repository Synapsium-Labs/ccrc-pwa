// `docs-fetch` (docs reader spec 2026-10-01 §2 (g); §2 rows 41, 42, 43 and 59, and the ccd halves of rows 61
// and 62). End to end through the shipped dispatcher (`runCcdDocs`) wherever a fixture HOME can build the
// condition, and as helper units (`unitJson`, which imports `_docs_py` out of `ccd/ccd` as a module) where it
// cannot: a fetch that outlives a lowered bound, a lock that vanishes before its lstat, a canned stderr, and the
// pure classifier. Fixture refs move only through `h.git` (the real binary with the fixture identity, never the
// PATH recorder), and every origin change is made inside the bare origin itself, so nothing but the verb under
// test touches the main checkout's refs, its FETCH_HEAD or its hooks.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { harnessBin, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { parseOneLine, plantGitRecorder, REAL_GIT, runCcdDocs, type RecordedGitCall } from './ccdDocsHelpers.js';
import { unitJson } from './docsHelperPy.js';

type Answer = Record<string, unknown>;
type Stamp = {
  v: number; branch: string; attemptMs: number; lastOutcome: string; okMs: number | null; okCommit: string | null;
};

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccd-docs-'); });
afterEach(() => { h.cleanup(); });

const originOf = (name: string): string => path.join(h.home, 'origins', `${name}.git`);
const rev = (dir: string, ref: string): string => h.git(dir, 'rev-parse', ref);
/** The full refnames `for-each-ref` lists under `pattern` in `dir`. */
const refsUnder = (dir: string, pattern: string): string[] =>
  h.git(dir, 'for-each-ref', '--format=%(refname)', pattern).split('\n').filter((l) => l !== '');

let advanceSeq = 0;
/** A new commit on the bare origin's `branch`, by `commit-tree` and `update-ref` in the origin itself, so the main
 *  checkout learns of it only through a fetch. The counter keeps two advances in one second distinct: identical
 *  tree, parent and message would be the same commit. */
const advanceOrigin = (name: string, branch = 'main'): string => {
  advanceSeq += 1;
  const o = originOf(name);
  const c = h.git(o, 'commit-tree', `refs/heads/${branch}^{tree}`, '-p', `refs/heads/${branch}`, '-m', `advance ${advanceSeq}`);
  h.git(o, 'update-ref', `refs/heads/${branch}`, c);
  return c;
};

/** §2 (g) step 6's line, transcribed token for token from the spec: the argv after `git` that the recorder logs. */
const SPEC_FETCH_LINE = (main: string, b: string): string[] => [
  '--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'gc.auto=0',
  '-c', 'maintenance.auto=false', '-c', 'fetch.writeCommitGraph=false', '-c', 'submodule.recurse=false',
  '-c', 'fetch.recurseSubmodules=false', '-c', 'fetch.fsckObjects=true', '-c', 'transfer.fsckObjects=true',
  '-c', 'remote.origin.followRemoteHEAD=never',
  '-C', main,
  'fetch', '--quiet', '--no-tags', '--no-prune', '--no-recurse-submodules', '--no-write-fetch-head',
  '--no-auto-gc', '--no-auto-maintenance', '--no-show-forced-updates', '--refmap=',
  '--end-of-options', 'origin', `+refs/heads/${b}:refs/remotes/origin/${b}`,
];

/** The recorded calls whose subcommand (the token after `-C <dir>`) is `fetch`. */
const fetchCalls = (calls: RecordedGitCall[]): RecordedGitCall[] =>
  calls.filter((c) => { const i = c.argv.indexOf('-C'); return i >= 0 && c.argv[i + 2] === 'fetch'; });

/** `ccd docs-fetch --project <project> [--branch <branch>]` through the dispatcher, as its one parsed line. */
const fetchDocs = (project: string, branch: string | null = null, env: NodeJS.ProcessEnv = {}): Answer =>
  parseOneLine(runCcdDocs(h, ['docs-fetch', '--project', project, ...(branch === null ? [] : ['--branch', branch])], env));

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
/** Where §2 (g) step 4 keeps a stamp, derived here independently of the helper: `$REG/docs/fetch/<32 hex of
 *  sha256(realpath(common dir))>/<32 hex of sha256(branch)>.json`. */
const stampFile = (main: string, branch: string): string => path.join(h.home, '.cc-sessions', 'docs', 'fetch',
  sha256(fs.realpathSync(path.join(main, '.git'))).slice(0, 32), `${sha256(branch).slice(0, 32)}.json`);
const readStampFile = (p: string): Stamp => JSON.parse(fs.readFileSync(p, 'utf8')) as Stamp;
/** Moves a stamp's attempt `ms` into the past: the floor's only input, so this stands in for waiting. */
const ageStamp = (p: string, ms: number): void => {
  const s = readStampFile(p);
  fs.writeFileSync(p, JSON.stringify({ ...s, attemptMs: s.attemptMs - ms }));
};

/** Python that answers `docs-fetch --project <project>` through the helper's own `run` (the envelope and the
 *  failure body included) and prints that line parsed. `pre` runs first, after `H` is loaded: a `Sys` swap, or
 *  a `VERBS` entry that lowers a bound by passing it. */
const fetchUnit = (project: string, pre: string[] = [], branch: string | null = null): string => [
  'import json',
  'import os',
  ...pre,
  "HOME = os.environ['HOME']",
  "argv = ['docs-fetch', os.path.join(HOME, 'projects'), os.path.join(HOME, 'worktrees'),",
  `        os.path.join(HOME, '.cc-sessions'), '--project', ${JSON.stringify(project)}${branch === null ? '' : `, '--branch', ${JSON.stringify(branch)}`}]`,
  "out(json.loads(H.run(argv).decode('utf-8')))",
].join('\n');

/** A `Sys` whose `spawn` answers the fetch itself with `rc` and `stderr`, and runs every other git call for real. */
const cannedFetch = (rc: number, stderr: string): string[] => [
  'class CannedFetch(H.Sys):',
  '    def spawn(self, argv, *a, **k):',
  "        i = argv.index('-C') if '-C' in argv else -1",
  "        if i >= 0 and argv[i + 2:i + 3] == ['fetch']:",
  `            return H.Spawned(rc=${rc}, out=b'', err=${JSON.stringify(stderr)}.encode('utf-8'), timed_out=False, overflow=False)`,
  '        return H.Sys.spawn(self, argv, *a, **k)',
  'H.SYS = CannedFetch()',
];

/** A `Sys` whose `lstat` of any `*.lock` path fails with `errnoName`, and stats everything else for real. */
const lockLstatFails = (errnoName: 'ENOENT' | 'EACCES'): string[] => [
  'import errno',
  'class LockLstat(H.Sys):',
  '    def lstat(self, path, *a, **k):',
  "        if str(path).endswith('.lock'):",
  `            raise OSError(errno.${errnoName}, 'planted by the unit', path)`,
  '        return H.Sys.lstat(self, path, *a, **k)',
  'H.SYS = LockLstat()',
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

describe('docs-fetch hygiene: the exact line, and nothing but one ref moves (rows 41 and 16, R7)', () => {
  it('records step 6 byte for byte, leaves FETCH_HEAD, tags, other branches, local refs and hooks alone (ctl: a plain fetch)', () => {
    const main = h.makeRepo('demo');
    const o = originOf('demo');
    const old = rev(main, 'refs/remotes/origin/main');
    const next = advanceOrigin('demo');
    h.git(o, 'update-ref', 'refs/tags/v1', next);
    h.git(o, 'update-ref', 'refs/heads/ws/x', next);
    h.git(main, 'branch', 'ws/x', old);
    const fetchHead = path.join(main, '.git', 'FETCH_HEAD');
    fs.writeFileSync(fetchHead, 'sentinel: no fetch may rewrite this\n');
    const pinned = new Date('2001-02-03T04:05:06Z');
    fs.utimesSync(fetchHead, pinned, pinned);
    const marker = path.join(h.home, 'reference-transaction-fired');
    fs.mkdirSync(path.join(main, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(main, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\necho fired >> '${marker}'\n`, { mode: 0o755 });
    const rec = plantGitRecorder(h.home);

    const a = fetchDocs('demo', null, { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes', GIT_DIR: path.join(h.home, 'decoy.git') });
    expect(a).toMatchObject({
      v: 1, verb: 'docs-fetch', ok: true, branch: 'main', trackedRef: 'refs/remotes/origin/main',
      defaultVia: 'default:origin-head', before: old, after: next, moved: 'updated', stamp: 'written',
    });
    const fetches = fetchCalls(rec.calls());
    expect(fetches.map((c) => c.argv)).toEqual([SPEC_FETCH_LINE(path.join(h.home, 'projects', 'demo'), 'main')]);
    // The fetch environment: the read runner's scrub and pins, plus the transport keep-list (§2 (a)).
    expect(fetches[0]!.env).toMatchObject({ LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1',
      GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' });
    expect(fetches[0]!.env).not.toHaveProperty('GIT_DIR');
    expect(rev(main, 'refs/remotes/origin/main')).toBe(next);
    expect(fs.readFileSync(fetchHead, 'utf8')).toBe('sentinel: no fetch may rewrite this\n');
    expect(fs.statSync(fetchHead).mtimeMs).toBe(pinned.getTime());
    expect(refsUnder(main, 'refs/tags')).toEqual([]);
    expect(refsUnder(main, 'refs/remotes/origin/ws')).toEqual([]);
    expect(rev(main, 'refs/heads/ws/x')).toBe(old);
    expect(fs.existsSync(marker), 'core.hooksPath=/dev/null kept the reference-transaction hook from firing').toBe(false);

    // CONTROL (security M1): a plain fetch of the same origin fires the hook, follows the tag, takes the second
    // branch and rewrites FETCH_HEAD, so each absence above was the line's doing, not the fixture's.
    advanceOrigin('demo');
    h.git(main, 'fetch', '-q', 'origin');
    expect(fs.existsSync(marker)).toBe(true);
    expect(refsUnder(main, 'refs/tags')).toEqual(['refs/tags/v1']);
    expect(refsUnder(main, 'refs/remotes/origin/ws')).toEqual(['refs/remotes/origin/ws/x']);
    expect(fs.readFileSync(fetchHead, 'utf8')).not.toBe('sentinel: no fetch may rewrite this\n');
  });

  it('defaultVia is present iff --branch is absent, and moved tells created, updated and unchanged apart', () => {
    const main = h.makeRepo('demo');
    const tip = rev(main, 'refs/remotes/origin/main');
    const a = fetchDocs('demo', 'main');
    expect(a).toMatchObject({ ok: true, branch: 'main', before: tip, after: tip, moved: 'unchanged', stamp: 'written' });
    expect(a).not.toHaveProperty('defaultVia');
    h.git(main, 'update-ref', '-d', 'refs/remotes/origin/main');
    ageStamp(stampFile(main, 'main'), 60_000);
    expect(fetchDocs('demo', 'main')).toMatchObject({ ok: true, before: null, after: tip, moved: 'created' });
    ageStamp(stampFile(main, 'main'), 60_000);
    const next = advanceOrigin('demo');
    expect(fetchDocs('demo')).toMatchObject({ ok: true, defaultVia: 'default:origin-head', before: tip, after: next, moved: 'updated' });
  });

  it('configured fetch refspecs move nothing: only origin/<b> moves, local b and mirror/b stay (--refmap=, D-4163; ctl: without it both move)', () => {
    const main = h.makeRepo('demo');
    const o = originOf('demo');
    const old = rev(main, 'refs/heads/main');
    h.git(o, 'update-ref', 'refs/heads/b', old);
    h.git(main, 'branch', 'b', old);
    h.git(main, 'update-ref', 'refs/remotes/mirror/b', old);
    h.git(main, 'config', '--add', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*');
    h.git(main, 'config', '--add', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/mirror/*');
    const next = advanceOrigin('demo', 'b');
    const allRefs = (): Map<string, string> => new Map(h.git(main, 'for-each-ref', '--format=%(refname) %(objectname)')
      .split('\n').filter((l) => l !== '').map((l) => l.split(' ') as [string, string]));
    const before = allRefs();

    expect(fetchDocs('demo', 'b')).toMatchObject({
      ok: true, branch: 'b', trackedRef: 'refs/remotes/origin/b', before: null, after: next, moved: 'created',
    });
    const after = allRefs();
    const moved = [...new Set([...before.keys(), ...after.keys()])].filter((r) => before.get(r) !== after.get(r));
    expect(moved).toEqual(['refs/remotes/origin/b']);
    expect(rev(main, 'refs/heads/b')).toBe(old);
    expect(rev(main, 'refs/remotes/mirror/b')).toBe(old);

    // CONTROL: the same explicit refspec WITHOUT --refmap= lets both configured lines map the fetched ref too, so
    // the local branch and the mirror are force-moved, which is exactly what the empty refmap holds back.
    const again = advanceOrigin('demo', 'b');
    h.git(main, 'fetch', '-q', '--no-write-fetch-head', 'origin', '+refs/heads/b:refs/remotes/origin/b');
    expect(rev(main, 'refs/heads/b')).toBe(again);
    expect(rev(main, 'refs/remotes/mirror/b')).toBe(again);
  });
});

describe('docs-fetch refusals before any fetch (steps 1-3)', () => {
  it('no remote.origin.url answers remote-absent, and nothing is fetched or stamped', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'remote', 'remove', 'origin');
    const rec = plantGitRecorder(h.home);
    expect(fetchDocs('demo')).toMatchObject({ v: 1, verb: 'docs-fetch', ok: false, failure: 'remote-absent' });
    expect(fetchCalls(rec.calls())).toEqual([]);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'docs'))).toBe(false);
  });

  it('an origin but no default chain answers no-default-branch, with no fetch', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'remote', 'set-head', 'origin', '-d');
    h.git(main, 'update-ref', '-d', 'refs/remotes/origin/main');
    h.git(main, 'branch', '-m', 'main', 'trunk');
    const rec = plantGitRecorder(h.home);
    expect(fetchDocs('demo')).toMatchObject({ ok: false, failure: 'no-default-branch' });
    expect(fetchCalls(rec.calls())).toEqual([]);
  });

  it('a partial clone is refused in discovery, before any fetch', () => {
    h.makeRepo('demo');
    h.git(originOf('demo'), 'config', 'uploadpack.allowFilter', 'true');
    execFileSync(REAL_GIT, ['clone', '-q', '--filter=blob:none', `file://${originOf('demo')}`, path.join(h.home, 'projects', 'pc')],
      { env: { ...process.env, HOME: h.home }, stdio: 'ignore' });
    const rec = plantGitRecorder(h.home);
    expect(fetchDocs('pc')).toMatchObject({ ok: false, failure: 'partial-clone' });
    expect(fetchCalls(rec.calls())).toEqual([]);
  });
});

describe('docs-fetch classifier (row 42; R6: measured on git 2.43 under LC_ALL=C)', () => {
  it('a branch origin does not have answers remote-branch-absent, and is stamped', () => {
    const main = h.makeRepo('demo');
    expect(fetchDocs('demo', 'nosuch')).toMatchObject({ ok: false, failure: 'remote-branch-absent', branch: 'nosuch' });
    expect(readStampFile(stampFile(main, 'nosuch'))).toMatchObject({
      v: 1, branch: 'nosuch', lastOutcome: 'remote-branch-absent', okMs: null, okCommit: null });
  });

  it('an origin URL at a missing path answers fetch-transport, with the redacted stderr in detail and stderrHead', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'remote', 'set-url', 'origin', path.join(h.home, 'nowhere.git'));
    const a = fetchDocs('demo');
    expect(a).toMatchObject({ ok: false, failure: 'fetch-transport', branch: 'main' });
    expect(String(a['stderrHead'])).toContain('does not appear to be a git repository');
    expect(String(a['detail'])).toContain('does not appear to be a git repository');
  });

  it('userinfo in the fetch stderr reaches detail and stderrHead only as ***@ (row 62)', () => {
    h.makeRepo('demo');
    const a = unitJson<Answer>(h.home, fetchUnit('demo', cannedFetch(128,
      "fatal: unable to access 'https://u:tok@example.invalid/x.git/': Could not resolve host: example.invalid\n")));
    expect(a).toMatchObject({ ok: false, failure: 'fetch-transport', branch: 'main' });
    for (const k of ['detail', 'stderrHead']) {
      expect(String(a[k]), k).toContain('https://***@example.invalid/x.git/');
      expect(String(a[k]), k).not.toContain('tok');
    }
  });

  it('detail is redacted BEFORE its 2 KiB cut, so a token the cut would split never leaks a prefix (row 62)', () => {
    h.makeRepo('demo');
    // The cut at 2048 bytes falls inside the userinfo: a cut-then-redact order would leave `https://user:secre`,
    // which no pattern matches any more because its `@` was cut away.
    const a = unitJson<Answer>(h.home, fetchUnit('demo', cannedFetch(128,
      `fatal: ${'x'.repeat(2023)}https://user:secrettoken@example.invalid/x.git/\n`)));
    expect(a).toMatchObject({ ok: false, failure: 'fetch-transport' });
    const detail = String(a['detail']);
    expect(Buffer.byteLength(detail)).toBeLessThanOrEqual(2048);
    expect(detail).not.toContain('secre');
    expect(detail).toContain('https://***@');
  });

  it('the pure classifier keeps every arm apart, in step 7 order', () => {
    h.makeRepo('demo');
    const FSCK_INDEX_PACK = 'error: object 59a23ae80cdb80f2ad9bff6a77ddbe720c0842bd: duplicateEntries: contains duplicate file entries\n'
      + 'fatal: fsck error in packed object\nfatal: index-pack failed\n';
    const FSCK_FETCH_PACK = 'error: object 59a23ae80cdb80f2ad9bff6a77ddbe720c0842bd: duplicateEntries: contains duplicate file entries\n'
      + 'fatal: fsck error in packed object\nfatal: fetch-pack: invalid index-pack output\n';
    const LOCK = "error: cannot lock ref 'refs/remotes/origin/main': Unable to create '/r/.git/refs/remotes/origin/main.lock': File exists.\n";
    const DIRFILE = "error: cannot lock ref 'refs/remotes/origin/foo/bar': 'refs/remotes/origin/foo' exists; cannot create 'refs/remotes/origin/foo/bar'\n";
    // The lab case below's stderr on git 2.55.0, measured in a container under the docs argv and LC_ALL=C.
    const DIRFILE_255 = 'warning: fetch normally indicates which branches had a forced update,\n'
      + "but that check has been disabled; to re-enable, use '--show-forced-updates'\n"
      + "flag or run 'git config fetch.showForcedUpdates true'\n"
      + "error: some local refs could not be updated; try running\n 'git remote prune origin' to remove any old, conflicting branches\n";
    const CASES: [string, number | null, string, boolean, string | null][] = [
      ['rc 0', 0, '', false, null],
      ['rc 0 with the forced-update warning', 0, 'warning: fetch normally indicates which branches had a forced update,\n', false, null],
      ['the bound ran out', null, '', true, 'fetch-timeout'],
      ['the bound wins over any message', 128, "fatal: couldn't find remote ref refs/heads/x\n", true, 'fetch-timeout'],
      // Step 7's table lists rc 0 first: git itself completed (a SIGTERMed git never exits 0), so a bound that
      // expired on a grandchild's pipe after a clean exit is still an ok, and the ref is read to say what moved.
      ['the bound and rc 0', 0, '', true, null],
      ['missing remote branch', 128, "fatal: couldn't find remote ref refs/heads/nosuch\n", false, 'remote-branch-absent'],
      ['missing-ref text needs rc 128', 1, "fatal: couldn't find remote ref refs/heads/nosuch\n", false, 'fetch-failed'],
      ['fsck refusal, index-pack failed', 128, FSCK_INDEX_PACK, false, 'fetch-rejected-objects'],
      ['fsck refusal, invalid index-pack output', 128, FSCK_FETCH_PACK, false, 'fetch-rejected-objects'],
      ['fsck text without a pack step is not a refusal', 128, 'fatal: fsck error in packed object\n', false, 'fetch-transport'],
      ['a pack step without fsck text is not a refusal', 128, 'fatal: index-pack failed\n', false, 'fetch-transport'],
      ['auth: https', 128, "fatal: Authentication failed for 'https://example.invalid/x.git/'\n", false, 'fetch-auth-failed'],
      ['auth: no prompt', 128, "fatal: could not read Username for 'https://example.invalid': terminal prompts disabled\n", false, 'fetch-auth-failed'],
      ['auth: ssh', 128, 'git@example.invalid: Permission denied (publickey).\r\nfatal: Could not read from remote repository.\n', false, 'fetch-auth-failed'],
      ['lock', 1, LOCK, false, 'ref-locked'],
      // A directory/file conflict says "cannot lock ref" too, but no other process holds anything: only a prune
      // cures it, so it is not the retried word. Measured on git 2.43.0 (see the lab case below).
      ['a ref directory/file conflict is not a lock', 1, DIRFILE, false, 'fetch-failed'],
      // git 2.55.0 (CI's runner image) prints no per-ref line for the same conflict, only the summary.
      ['a ref directory/file conflict, git 2.55 wording, is not a lock', 1, DIRFILE_255, false, 'fetch-failed'],
      ['lock evidence alone is not a lock', 1, "fatal: Unable to create '/r/.git/index.lock': File exists.\n", false, 'fetch-failed'],
      ['a lock that cannot be created for another reason', 1,
        "error: cannot lock ref 'refs/remotes/origin/main': Unable to create '/r/.git/refs/remotes/origin/main.lock': Permission denied\n",
        false, 'fetch-failed'],
      ['lock text needs rc 1', 128, LOCK, false, 'fetch-transport'],
      ['other rc 128', 128, "fatal: '/r/nowhere.git' does not appear to be a git repository\n", false, 'fetch-transport'],
      ['other rc 1', 1, 'error: something else\n', false, 'fetch-failed'],
      ['killed by a signal', -9, '', false, 'fetch-failed'],
      ['nothing ran, yet no timeout', null, '', false, 'fetch-failed'],
    ];
    const got = unitJson<(string | null)[]>(h.home, [
      'import json',
      `cases = json.loads(${JSON.stringify(JSON.stringify(CASES))})`,
      'out([H.classify_fetch(rc, err, to) for _name, rc, err, to, _want in cases])',
    ].join('\n'));
    expect(CASES.map((c, i) => [c[0], got[i]])).toEqual(CASES.map((c) => [c[0], c[4]]));
  });

  it('a stale ref where a remote branch needs a directory answers fetch-failed with git\'s own message, never ref-locked (lab)', () => {
    // refs/remotes/origin/foo is a stale ref (the remote branch was deleted); the remote now has foo/bar. git cannot
    // create the directory refs/remotes/origin/foo/, says "cannot lock ref", and --no-prune never removes the stale
    // ref, so a retry cannot succeed. Measured on git 2.43.0: rc 1, no lock file is involved. git 2.55.0 (CI's runner
    // image) also answers rc 1, but drops the per-ref "cannot lock ref ... exists; cannot create" line and keeps only
    // the summary and its prune hint; the classification is the same on both.
    const main = h.makeRepo('demo');
    const tip = rev(main, 'refs/remotes/origin/main');
    h.git(main, 'update-ref', 'refs/remotes/origin/foo', tip);
    h.git(originOf('demo'), 'update-ref', 'refs/heads/foo/bar', tip);
    const a = fetchDocs('demo', 'foo/bar');
    expect(a).toMatchObject({ ok: false, failure: 'fetch-failed', branch: 'foo/bar', rc: 1 });
    expect(a, 'not the transient word').not.toHaveProperty('lockAgeMs');
    // git's own message, in either version's form: the summary and its prune hint always; a per-ref line, when
    // git prints one (2.43 does, 2.55 does not), is the directory/file form and never lock-file evidence.
    const detail = String(a['detail']);
    expect(detail).toContain('error: some local refs could not be updated; try running');
    expect(detail).toContain("'git remote prune origin'");
    if (detail.includes('cannot lock ref')) {
      expect(detail).toContain("'refs/remotes/origin/foo' exists; cannot create");
    }
    expect(detail, 'no lock-file evidence').not.toMatch(/\.lock': File exists/);
    expect(readStampFile(stampFile(main, 'foo/bar')), 'a failed attempt is still stamped').toMatchObject({
      lastOutcome: 'fetch-failed' });
  });

  it('a fetch that outlives a lowered bound answers fetch-timeout, and its grandchild is gone (killpg)', async () => {
    const main = h.makeRepo('demo');
    const pidFile = path.join(h.home, 'fetch-grandchild.pid');
    fs.writeFileSync(path.join(harnessBin(h.home), 'git'), [
      '#!/bin/sh',
      '# A git whose fetch never finishes: it backgrounds a sleeping grandchild, records its pid, and waits on it.',
      'case " $* " in',
      `  *' fetch --quiet '*) sleep 30 & echo "$!" > '${pidFile}'; wait; exit 0 ;;`,
      'esac',
      `exec '${REAL_GIT}' "$@"`,
      '',
    ].join('\n'), { mode: 0o755 });
    const a = unitJson<Answer>(h.home, fetchUnit('demo', [
      "H.VERBS['docs-fetch'] = lambda ctx, a: H.verb_fetch(ctx, a, fetch_s=1)",
    ]), { timeoutMs: 30_000 });
    expect(a).toMatchObject({ ok: false, failure: 'fetch-timeout', branch: 'main' });
    expect(a['elapsedMs'] as number, 'the lowered 1 s bound fired, not the 40 s one').toBeLessThan(10_000);
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    expect(pid).toBeGreaterThan(1);
    for (let i = 0; i < 80 && alive(pid); i++) await sleep(50);
    expect(alive(pid), `grandchild ${pid} outlived the fetch`).toBe(false);
    expect(readStampFile(stampFile(main, 'main')), 'a timed-out attempt is still an attempt').toMatchObject({
      v: 1, branch: 'main', lastOutcome: 'fetch-timeout', okMs: null, okCommit: null });
  });
});

describe('docs-fetch ref-locked and its lock age (rows 42 and 61, ccd half)', () => {
  const lockedFetch = (ageMs: number): { a: Answer; spanMs: number } => {
    const main = h.makeRepo('demo');
    advanceOrigin('demo');
    const lock = path.join(main, '.git', 'refs', 'remotes', 'origin', 'main.lock');
    fs.writeFileSync(lock, '');
    const t0 = Date.now();
    const then = new Date(t0 - ageMs);
    fs.utimesSync(lock, then, then);
    const a = fetchDocs('demo');
    return { a, spanMs: Date.now() - t0 };
  };

  it('a lock touched 5 s ago answers ref-locked with lockAgeMs about 5000', () => {
    const { a, spanMs } = lockedFetch(5_000);
    expect(a).toMatchObject({ ok: false, failure: 'ref-locked', branch: 'main' });
    expect(String(a['detail'])).toContain('cannot lock ref');
    // The true age lies between 5000 and 5000 plus the run's own length; 10 ms covers clock rounding.
    expect(a['lockAgeMs'] as number).toBeGreaterThanOrEqual(5_000 - 10);
    expect(a['lockAgeMs'] as number).toBeLessThanOrEqual(5_000 + spanMs + 10);
  });

  it('a 120 s old lock answers lockAgeMs about 120000', () => {
    const { a, spanMs } = lockedFetch(120_000);
    expect(a).toMatchObject({ ok: false, failure: 'ref-locked' });
    expect(a['lockAgeMs'] as number).toBeGreaterThanOrEqual(120_000 - 10);
    expect(a['lockAgeMs'] as number).toBeLessThanOrEqual(120_000 + spanMs + 10);
  });

  it('a lock stamped in the future (the clock stepped back) answers lockAgeMs 0, never a negative age', () => {
    const { a } = lockedFetch(-3_600_000);
    expect(a).toMatchObject({ ok: false, failure: 'ref-locked', lockAgeMs: 0 });
  });

  it('a lock gone before its lstat answers lockAgeMs null; an lstat that fails otherwise leaves the field out', () => {
    const main = h.makeRepo('demo');
    advanceOrigin('demo');
    fs.writeFileSync(path.join(main, '.git', 'refs', 'remotes', 'origin', 'main.lock'), '');
    const gone = unitJson<Answer>(h.home, fetchUnit('demo', lockLstatFails('ENOENT')));
    expect(gone).toMatchObject({ ok: false, failure: 'ref-locked', lockAgeMs: null });
    ageStamp(stampFile(main, 'main'), 60_000);
    const unseen = unitJson<Answer>(h.home, fetchUnit('demo', lockLstatFails('EACCES')));
    expect(unseen).toMatchObject({ ok: false, failure: 'ref-locked' });
    expect(unseen, '"could not look" is not "gone"').not.toHaveProperty('lockAgeMs');
  });
});

describe('docs-fetch fsck (row 59, R16)', () => {
  it('an origin holding a malformed tree answers fetch-rejected-objects and the ref does not move (ctl: no fsck flags)', () => {
    const main = h.makeRepo('demo');
    const o = originOf('demo');
    const blob = Buffer.from(h.git(o, 'rev-parse', 'refs/heads/main:README.md'), 'hex');
    const entry = Buffer.concat([Buffer.from('100644 a\0', 'latin1'), blob]);
    const treeFile = path.join(h.home, 'duplicate-entries.tree');
    fs.writeFileSync(treeFile, Buffer.concat([entry, entry]));
    const tree = h.git(o, 'hash-object', '--literally', '-t', 'tree', '-w', treeFile);
    const bad = h.git(o, 'commit-tree', tree, '-p', 'refs/heads/main', '-m', 'malformed');
    h.git(o, 'update-ref', 'refs/heads/main', bad);
    const before = rev(main, 'refs/remotes/origin/main');
    const rec = plantGitRecorder(h.home);

    expect(fetchDocs('demo')).toMatchObject({ ok: false, failure: 'fetch-rejected-objects', branch: 'main' });
    expect(rev(main, 'refs/remotes/origin/main')).toBe(before);
    const argv = fetchCalls(rec.calls()).map((c) => c.argv.join(' '));
    expect(argv).toHaveLength(1);
    expect(argv[0]).toContain('-c fetch.fsckObjects=true');
    expect(argv[0]).toContain('-c transfer.fsckObjects=true');

    // CONTROL: without the two fsck settings git takes the malformed object and moves the ref onto it.
    h.git(main, 'fetch', '-q', '--no-write-fetch-head', 'origin', '+refs/heads/main:refs/remotes/origin/main');
    expect(rev(main, 'refs/remotes/origin/main')).toBe(bad);
  });
});

describe('docs-fetch stamp and floor (row 43)', () => {
  it('ok writes okMs and okCommit; a later failure keeps them; files are 0600 and directories 0700', () => {
    const main = h.makeRepo('demo');
    const next = advanceOrigin('demo');
    const t0 = Date.now();
    expect(fetchDocs('demo')).toMatchObject({ ok: true, after: next, stamp: 'written' });
    const t1 = Date.now();
    const p = stampFile(main, 'main');
    const ok = readStampFile(p);
    expect(ok).toEqual({ v: 1, branch: 'main', attemptMs: ok.attemptMs, lastOutcome: 'ok', okMs: ok.attemptMs, okCommit: next });
    expect(ok.attemptMs).toBeGreaterThanOrEqual(t0);
    expect(ok.attemptMs).toBeLessThanOrEqual(t1);
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
    for (const d of [path.dirname(p), path.dirname(path.dirname(p)), path.dirname(path.dirname(path.dirname(p)))]) {
      expect(fs.statSync(d).mode & 0o777, d).toBe(0o700);
    }
    expect(path.dirname(path.dirname(path.dirname(p)))).toBe(path.join(h.home, '.cc-sessions', 'docs'));

    ageStamp(p, 60_000);
    h.git(main, 'remote', 'set-url', 'origin', path.join(h.home, 'nowhere.git'));
    expect(fetchDocs('demo')).toMatchObject({ ok: false, failure: 'fetch-transport' });
    const failed = readStampFile(p);
    expect(failed).toMatchObject({ v: 1, branch: 'main', lastOutcome: 'fetch-transport', okMs: ok.okMs, okCommit: next });
    expect(failed.attemptMs, 'the failed attempt is stamped as an attempt of its own').toBeGreaterThanOrEqual(ok.attemptMs);
  });

  it('docs-index reads back what docs-fetch wrote: no fetch key before, ok after a fetch, the failed attempt after that (round trip)', () => {
    const main = h.makeRepo('demo');
    const demoRow = (): Answer => {
      const rows = parseOneLine(runCcdDocs(h, ['docs-index', '--all']))['projects'] as Answer[];
      const row = rows.find((r) => r['project'] === 'demo');
      expect(row, 'the index lists demo').toBeDefined();
      return row!;
    };
    expect(demoRow(), 'no stamp, no fetch key').not.toHaveProperty('fetch');

    expect(fetchDocs('demo')).toMatchObject({ ok: true, stamp: 'written' });
    const okRow = demoRow();
    expect(okRow['fetch']).toMatchObject({ lastOutcome: 'ok' });
    expect(typeof (okRow['fetch'] as Answer)['okAgeMs'], 'the ok stamp carries a numeric okAgeMs').toBe('number');

    // Age BOTH clocks of the stamp, so the failed attempt below is past the floor and okAgeMs has a known lower bound.
    const aged = 60_000;
    const p = stampFile(main, 'main');
    const s = readStampFile(p);
    fs.writeFileSync(p, JSON.stringify({ ...s, attemptMs: s.attemptMs - aged, okMs: (s.okMs as number) - aged }));
    h.git(main, 'remote', 'set-url', 'origin', path.join(h.home, 'nowhere.git'));
    expect(fetchDocs('demo')).toMatchObject({ ok: false, failure: 'fetch-transport' });
    const failedRow = demoRow();
    expect(failedRow['fetch']).toMatchObject({ lastOutcome: 'fetch-transport' });
    expect((failedRow['fetch'] as Answer)['okAgeMs'] as number, 'the last success is carried over, and it is that old').toBeGreaterThanOrEqual(aged);
  });

  it('every word classify_fetch can return is a word read_stamp accepts (STAMP_OUTCOMES), and every failure word is reachable', () => {
    h.makeRepo('demo');
    const got = unitJson<{ words: (string | null)[]; outcomes: string[] }>(h.home, [
      'import itertools',
      'stderrs = ["", "fatal: x\\n", "fatal: couldn\'t find remote ref refs/heads/x\\n",',
      '           "error: object 59a23ae80cdb80f2ad9bff6a77ddbe720c0842bd: duplicateEntries: x\\nfatal: fsck error in packed object\\nfatal: index-pack failed\\n",',
      '           "fatal: Authentication failed for x\\n",',
      '           "error: cannot lock ref \'r\': Unable to create \'r.lock\': File exists.\\n"]',
      'words = sorted({str(H.classify_fetch(rc, e, to)) for rc, e, to in itertools.product((None, 0, 1, 2, 128, -9), stderrs, (False, True))})',
      "out({'words': words, 'outcomes': sorted(H.STAMP_OUTCOMES)})",
    ].join('\n'));
    const failures = got.words.filter((w) => w !== 'None');
    for (const w of failures) expect(got.outcomes, `classify_fetch can answer ${w}`).toContain(w);
    expect(failures, 'each of the seven failure words is reachable').toEqual(got.outcomes.filter((w) => w !== 'ok'));
  });

  it('a second call within 10 s answers fetch-too-soon {retryAfterMs} with no fetch; the floor is per branch', () => {
    const main = h.makeRepo('demo');
    expect(fetchDocs('demo')).toMatchObject({ ok: true });
    const first = readStampFile(stampFile(main, 'main'));
    const rec = plantGitRecorder(h.home);
    const a = fetchDocs('demo');
    expect(a).toMatchObject({ v: 1, verb: 'docs-fetch', ok: false, failure: 'fetch-too-soon', branch: 'main' });
    expect(a['retryAfterMs'] as number).toBeGreaterThan(0);
    expect(a['retryAfterMs'] as number).toBeLessThanOrEqual(10_000);
    expect(fetchCalls(rec.calls()), 'the floor answers before any network call').toEqual([]);
    expect(readStampFile(stampFile(main, 'main')), 'a refused call is not an attempt').toEqual(first);
    // Another branch of the same repository has a stamp, and so a floor, of its own.
    expect(fetchDocs('demo', 'nosuch')).toMatchObject({ ok: false, failure: 'remote-branch-absent' });
  });

  it('a stamp from the future (the clock stepped back) holds no floor, and is rewritten', () => {
    const main = h.makeRepo('demo');
    const p = stampFile(main, 'main');
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    const ahead = Date.now() + 3_600_000;
    fs.writeFileSync(p, JSON.stringify({ v: 1, branch: 'main', attemptMs: ahead, lastOutcome: 'ok', okMs: ahead,
      okCommit: rev(main, 'refs/remotes/origin/main') }));
    expect(fetchDocs('demo')).toMatchObject({ ok: true, stamp: 'written' });
    expect(readStampFile(p).attemptMs).toBeLessThan(ahead);
  });

  it('a stamp for ANOTHER branch at this branch\'s path holds no floor and carries no okMs', () => {
    const main = h.makeRepo('demo');
    const p = stampFile(main, 'main');
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    const now = Date.now();
    fs.writeFileSync(p, JSON.stringify({ v: 1, branch: 'other', attemptMs: now, lastOutcome: 'ok', okMs: now,
      okCommit: rev(main, 'refs/remotes/origin/main') }));
    expect(fetchDocs('demo', 'main'), 'fetch-too-soon would mean another branch\'s stamp set the floor').toMatchObject({
      ok: true, stamp: 'written' });
    // And a failure after it carries nothing over from the foreign stamp.
    fs.writeFileSync(p, JSON.stringify({ v: 1, branch: 'other', attemptMs: now - 60_000, lastOutcome: 'ok', okMs: now - 60_000,
      okCommit: rev(main, 'refs/remotes/origin/main') }));
    h.git(main, 'remote', 'set-url', 'origin', path.join(h.home, 'nowhere.git'));
    expect(fetchDocs('demo', 'main')).toMatchObject({ ok: false, failure: 'fetch-transport' });
    expect(readStampFile(p)).toMatchObject({ branch: 'main', lastOutcome: 'fetch-transport', okMs: null, okCommit: null });
  });

  it('a tracked ref that is absent after a fetch that exited 0 answers git-failed {step: for-each-ref}, never a silent ok', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'update-ref', '-d', 'refs/remotes/origin/main');
    const a = unitJson<Answer>(h.home, fetchUnit('demo', cannedFetch(0, ''), 'main'));
    expect(a).toMatchObject({ ok: false, failure: 'git-failed', step: 'for-each-ref' });
    expect(a).not.toHaveProperty('okCommit');
    expect(fs.existsSync(stampFile(main, 'main')), 'no stamp for an attempt that could not be read back').toBe(false);
  });

  it('a for-each-ref that fails answers git-failed {step: for-each-ref} before any fetch, and stamps nothing', () => {
    const main = h.makeRepo('demo');
    const rec = plantGitRecorder(h.home, { failWhen: ['--end-of-options refs/remotes/origin/main'] });
    expect(fetchDocs('demo', 'main')).toMatchObject({ ok: false, failure: 'git-failed', step: 'for-each-ref' });
    // Without tracked_oid's rc check the failure reads as an absent ref and the fetch goes ahead.
    expect(fetchCalls(rec.calls()), 'the failed read of `before` stops the verb before the network').toEqual([]);
    expect(fs.existsSync(stampFile(main, 'main'))).toBe(false);
  });

  it('a directory at the stamp leaf answers stamp unwritten and leaves no temporary file behind', () => {
    const main = h.makeRepo('demo');
    const p = stampFile(main, 'main');
    fs.mkdirSync(p, { recursive: true, mode: 0o700 });
    expect(fetchDocs('demo', 'main')).toMatchObject({ ok: true, stamp: 'unwritten' });
    expect(fs.lstatSync(p).isDirectory(), 'the directory was not replaced').toBe(true);
    expect(fs.readdirSync(path.dirname(p)).filter((n) => /^\..*\.tmp$/.test(n)), 'the rename failed, and its temporary file went').toEqual([]);
  });

  it('a FIFO at the stamp path neither hangs the call nor is opened: it is replaced', () => {
    const main = h.makeRepo('demo');
    const p = stampFile(main, 'main');
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    execFileSync('mkfifo', [p]);
    // A unit, not the dispatcher: its spawn carries a timeout, so a regression is a red test rather than a hang.
    const a = unitJson<Answer>(h.home, fetchUnit('demo'), { timeoutMs: 30_000 });
    expect(a).toMatchObject({ ok: true, stamp: 'written' });
    expect(fs.lstatSync(p).isFile()).toBe(true);
    expect(readStampFile(p)).toMatchObject({ v: 1, branch: 'main', lastOutcome: 'ok' });
  });

  it('a symlink at the stamp path is replaced, never written through: its target is unchanged', () => {
    const main = h.makeRepo('demo');
    const p = stampFile(main, 'main');
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    const victim = path.join(h.home, 'victim');
    fs.writeFileSync(victim, 'victim\n');
    fs.symlinkSync(victim, p);
    expect(fetchDocs('demo')).toMatchObject({ ok: true, stamp: 'written' });
    expect(fs.readFileSync(victim, 'utf8')).toBe('victim\n');
    expect(fs.lstatSync(p).isSymbolicLink()).toBe(false);
    expect(readStampFile(p)).toMatchObject({ lastOutcome: 'ok' });
  });

  it('a symlinked stamp directory refuses the write: stamp unwritten, and nothing lands where it points', () => {
    h.makeRepo('demo');
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(h.home, '.cc-sessions', 'docs'));
    expect(fetchDocs('demo')).toMatchObject({ ok: true, moved: 'unchanged', stamp: 'unwritten' });
    expect(fs.readdirSync(elsewhere)).toEqual([]);
    expect(fs.lstatSync(path.join(h.home, '.cc-sessions', 'docs')).isSymbolicLink()).toBe(true);
  });

  it('$REG/docs is invisible to the registry globs and to _reg_purge', () => {
    const main = h.makeRepo('demo');
    expect(fetchDocs('demo')).toMatchObject({ ok: true, stamp: 'written' });
    const p = stampFile(main, 'main');
    const globbed = h.sh('_reg_set demo-a uuid abc; _reg_set demo-a project demo; shopt -s nullglob; '
      + 'printf "%s\\n" "$REG"/*.uuid "$REG"/*.workspace "$REG"/*.project').split('\n').filter((l) => l !== '');
    expect(globbed).toEqual([path.join(h.home, '.cc-sessions', 'demo-a.uuid'), path.join(h.home, '.cc-sessions', 'demo-a.project')]);
    h.sh('_reg_purge demo-a');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-a.uuid')), 'the purge ran').toBe(false);
    expect(readStampFile(p)).toMatchObject({ v: 1, branch: 'main', lastOutcome: 'ok' });
  });
});

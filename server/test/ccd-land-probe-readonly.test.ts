// ccd-land-probe is read-only BY CODE (landing-order wave 3b, spec section 7): the literal source pins, and the
// validate-only self-test of git_ro's refusals. The behaviour is in ccd-land-probe.test.ts.
//
// The pins read ccd/ccd-land-probe's whole text. A pin is a request until a planted violation turns it red; the
// plan's mutation table plants each one.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghPoisonAt, type CcdHarness } from './ccdWsHelpers.js';
import { makeLandFixture, until, PROBE } from './ccdLandProbeFixture.js';

const src = fs.readFileSync(PROBE, 'utf8');
const MARK = "<<'PY'";
/** The bash head: everything before the heredoc that carries the program. */
const head = src.slice(0, src.indexOf(MARK));
const headCode = head.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/** The quoted strings of a tuple literal `NAME = ( ... )`, read from the source text. */
function tuple(name: string): string[] {
  const m = new RegExp(`^${name} = \\(([^)]*)\\)$`, 'm').exec(src);
  if (!m) throw new Error(`no literal tuple ${name}`);
  return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
}

describe('ccd-land-probe: the literal source pins', () => {
  it('R1 never says push', () => {
    expect(src).not.toMatch(/\bpush\b/i);
  });

  it('R2 never names a PR merge', () => {
    expect(src).not.toMatch(/\bpr\b[\s'",]*\bmerge\b/i);
  });

  it('R3 gh has exactly two call sites, the two read forms, and none in the bash head\'s code', () => {
    expect(src.match(/\[GH,/g) ?? []).toHaveLength(2);
    expect(src.match(/\[GH, 'api', '--method', 'GET', path\]/g) ?? []).toHaveLength(1);
    expect(src.match(/\[GH, 'pr', 'list', '--repo', slug, [^\]]*\]/g) ?? []).toHaveLength(1);
    // The one allowed extension of the GET form, and no other use of the flag.
    expect(src.match(/--paginate/g) ?? []).toHaveLength(1);
    expect(src).toContain("argv = argv + ['--paginate']");
    expect(headCode).not.toMatch(/(^|[\s;|&(])gh\s/m);
  });

  it('R4 no method or field flag but GET', () => {
    for (const re of [/['"]--method['"],\s*['"](?!GET['"])/, /--method=(?!GET\b)/i, /['"]-X/, /['"]--(raw-)?field/, /['"]--input/, /['"]-[fF]['"]/]) {
      expect(src, String(re)).not.toMatch(re);
    }
  });

  it('R5 git has one call site, its prefix and its allowlists are the plan\'s', () => {
    expect(src.match(/\[['"]git['"]/g) ?? []).toHaveLength(1);
    const fn = /^def git_ro\([\s\S]*?\n\n\n/m.exec(src);
    expect(fn, 'git_ro is findable').not.toBeNull();
    expect(fn![0]).toContain("['git']");
    expect(tuple('GIT_PREFIX')).toEqual(['--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false']);
    expect(tuple('PROJECT_LOCKS')).toEqual(['--no-optional-locks']);
    expect(tuple('FETCH_PREFIX')).toEqual(['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'transfer.unpackLimit=1', '-c', 'fetch.writeCommitGraph=false']);
    expect(tuple('FETCH_KEEP')).toEqual(['GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'GIT_SSL_CAINFO', 'GIT_SSL_CAPATH']);
    expect(tuple('PROJECT_ALLOW')).toEqual(['rev-parse', 'rev-list', 'for-each-ref', 'cat-file', 'merge-base', 'count-objects', 'ls-remote', 'config']);
    expect(tuple('SCRATCH_ALLOW')).toEqual(['init', 'fetch', 'merge-tree', 'merge-base', 'rev-parse', 'rev-list', 'cat-file']);
    expect(tuple('OPTION_PREFIXES')).toEqual(['-c', '--config-env', '-C', '--git-dir', '--work-tree', '--exec', '--upload-pack', '--receive-pack', '-u']);
    expect(tuple('PINNED_KEYS')).toEqual(['core.hooksPath', 'core.fsmonitor']);
  });

  it('R5b every child process is spawned in one place: one Popen, three callers of run_child, and no other way to start a process', () => {
    // The pin above sees the ['git' spelling; this one closes a respelled third call site, for git and gh alike.
    expect(src.match(/\bsubprocess\.Popen\b/g) ?? [], 'subprocess.Popen').toHaveLength(1);
    // The def, git_ro, gh_get and gh_pr_list: a fifth is a new way to start a child, and is reviewed as one.
    expect(src.match(/\brun_child\(/g) ?? [], 'run_child( sites').toHaveLength(4);
    expect(src).toMatch(/^def run_child\(/m);
    for (const fn of ['git_ro', 'gh_get', 'gh_pr_list']) {
      const body = new RegExp(`^def ${fn}\\([\\s\\S]*?\\n\\n\\n`, 'm').exec(src);
      expect(body?.[0], `${fn} is findable`).toBeDefined();
      expect(body![0].match(/\brun_child\(/g) ?? [], `${fn} calls run_child once`).toHaveLength(1);
    }
    expect(src).not.toMatch(/\bsubprocess\.(run|call|check_output|check_call|getoutput|getstatusoutput)\b/);
    expect(src).not.toMatch(/\bos\.(system|popen|exec\w*|spawn\w*|posix_spawn\w*|fork\w*|forkpty)\b/);
    expect(src).not.toMatch(/^\s*from\s+(subprocess|os)\s+import\b/m);
  });

  it('R6 never names update-branch', () => {
    expect(src).not.toMatch(/update[-_]branch|updatePullRequestBranch/i);
  });
});

describe('ccd-land-probe: the git_ro self-test', () => {
  let h: CcdHarness | undefined;
  afterEach(() => {
    if (!h) return;
    const poison = ghPoisonAt(h.home);
    h.cleanup();
    h = undefined;
    expect(poison).toEqual([]);
  });

  it('S1 allows the plan\'s calls and refuses the rest, each by its own rule', () => {
    h = makeCcdHarness('land-probe-ro');
    const fx = makeLandFixture(h);
    // Every call the program makes, recorded by a git wrapper over a full run (rows, heads, a pair), is allowed.
    fx.addHead(1, { 'README.md': 'one\n' }, { branch: 'ws/alpha' });
    fx.addHead(2, { 'README.md': 'two\n' }, { branch: 'ws/beta' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.addRow('lane-a-proj-a-beta', 'ws/beta');
    fx.mergeBase('ws/alpha');   // a real merge, so the lineage walk makes every call it can
    fx.conf(fx.project, 'lineage=on\n');
    const log = path.join(h.home, 'git-argv.log');
    fx.wrapGit(`printf '%s\\t' "$@" >> '${log}'; printf '\\n' >> '${log}'`);
    expect(fx.run().status).toBe(0);
    expect(fx.readJson('probe').state).toBe('measured');
    const prefix = tuple('GIT_PREFIX');
    const fetchPrefix = tuple('FETCH_PREFIX');
    const calls: Array<[string, string[]]> = [];
    for (const line of fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)) {
      let argv = line.split('\t').slice(0, -1);
      expect(argv.slice(0, prefix.length)).toEqual(prefix);
      argv = argv.slice(prefix.length);
      let where = 'scratch';
      if (argv[0] === '--no-optional-locks') { where = 'project'; argv = argv.slice(1); }
      expect(argv[0]).toBe('-C');
      argv = argv.slice(2);
      if (argv.slice(0, fetchPrefix.length).join('\t') === fetchPrefix.join('\t')) argv = argv.slice(fetchPrefix.length);
      if (argv[0] === 'init') argv = argv.slice(0, -1).concat('/scratch');
      calls.push([where, argv]);
    }
    const subs = new Set(calls.map(([w, a]) => `${w} ${a[0]}`));
    for (const want of ['project config', 'project count-objects', 'project ls-remote', 'project rev-parse', 'scratch init', 'scratch fetch', 'scratch rev-parse', 'scratch merge-tree', 'scratch rev-list', 'scratch merge-base']) {
      expect(subs, want).toContain(want);
    }
    const mine = fx.selftest(calls);
    expect(mine.status).toBe(0);
    expect(mine.stdout.split('\n').filter(Boolean)).toEqual(calls.map(() => 'allowed'));

    const refusals: Array<[string, string[], string]> = [
      ['project', ['fetch', 'x'], 'refused subcommand fetch'],
      ['project', ['init'], 'refused subcommand init'],
      ['project', ['-c', 'x=y', 'rev-parse'], 'refused subcommand -c'],
      ['project', ['config', 'remote.origin.url', 'x'], 'refused form config'],
      ['scratch', ['init', '-q', '--bare', '/elsewhere'], 'refused form init'],
      ['scratch', ['merge-tree', '-c', 'x=y', 'a', 'b'], 'refused option -c'],
      ['project', ['rev-parse', '-cfoo'], 'refused option -c'],
      ['scratch', ['fetch', '--upload-pack=x', 'u'], 'refused option --upload-pack'],
      ['scratch', ['fetch', '-u', 'x', 'u'], 'refused option -u'],
      ['project', ['rev-parse', '--git-dir=/tmp'], 'refused option --git-dir'],
      ['project', ['for-each-ref', '--format=%(refname)', '-C', '/'], 'refused option -C'],
      ['scratch', ['merge-tree', 'core.hooksPath', 'b'], 'refused key core.hooksPath'],
    ];
    const out = fx.selftest(refusals.map(([w, a]) => [w, a]));
    expect(out.stdout.split('\n').filter(Boolean)).toEqual(refusals.map((r) => r[2]));
    // The refusals above are each one only that rule catches: a case the rule before it would answer is a different line.
    expect(fx.selftest([['scratch', ['init', '-q', '--bare', '/scratch']]]).stdout.trim()).toBe('allowed');
    expect(fx.selftest([['project', ['config', '--get', 'remote.origin.url']], ['project', ['ls-remote', '--get-url', 'origin']]]).stdout.split('\n').filter(Boolean)).toEqual(['allowed', 'allowed']);
  });

  it('S1 reads no pause, takes no lock, and creates no file', async () => {
    h = makeCcdHarness('land-probe-ro');
    const fx = makeLandFixture(h);
    fx.pause('global');
    const home = h.home;
    const lock = path.join(home, '.ccrc', 'land-probe.lock');
    // The lock is HELD while the self-test prints every verdict: a self-test that took it (flock -n) would exit 0
    // without printing, and one that read the pause marker would stop at "paused".
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const holder = spawn('flock', ['--no-fork', lock, 'sleep', '30'], { stdio: 'ignore' });
    try {
      const held = (): boolean => {
        try { execFileSync('flock', ['-n', lock, 'true']); return false; } catch { return true; }
      };
      expect(await until(held, 5000), 'the test never took the lock').toBe(true);
      const snap = (): string => [fx.tmp, fx.reg, path.join(home, '.ccrc')].map((d) => fs.readdirSync(d).sort().join(',')).join('|');
      const before = snap();
      const r = fx.selftest([['project', ['rev-parse', 'HEAD']], ['project', ['push']]]);
      expect(r.status).toBe(0);
      expect(r.stdout.split('\n').filter(Boolean)).toEqual(['allowed', 'refused subcommand push']);
      expect(held(), 'the lock is still the holder\'s').toBe(true);
      expect(snap()).toBe(before);
    } finally {
      holder.kill('SIGKILL');
    }
  });
});

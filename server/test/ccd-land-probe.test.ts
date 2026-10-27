// ccd-land-probe, the read-only conflict radar (landing-order wave 3b): behaviour, over fixture git and a stub forge CLI.
// The literal source pins and the git_ro self-test are in ccd-land-probe-readonly.test.ts.
//
// Every probe spawn goes through the fixture (ccdLandProbeFixture.ts), which spells ghContainedEnv with all three
// poisons at its call sites. The harness's poison `gh` stays on PATH and its record must be empty after each case:
// the probe reaches the forge only through CCD_LAND_PROBE_GH.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghPoisonAt, type CcdHarness } from './ccdWsHelpers.js';
import { makeLandFixture, pidGone, until, PROBE, type LandFixture } from './ccdLandProbeFixture.js';

let h: CcdHarness;
let fx: LandFixture;
beforeEach(() => { h = makeCcdHarness('land-probe'); fx = makeLandFixture(h); });
afterEach(() => {
  const poison = ghPoisonAt(h.home);
  h.cleanup();
  expect(poison, 'the real gh was reached').toEqual([]);
});

const tmpLeft = (): string[] => fs.readdirSync(fx.tmp).filter((n) => n.startsWith('ccd-land-probe.'));
const ls = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

/** One head per entry, newest PR last added: files are disjoint unless a case makes them collide. */
function threeHeads(): void {
  fx.addHead(1, { 'README.md': 'one\n' });
  fx.addHead(2, { 'docs/a.md': 'a\n' });
  fx.addHead(3, { 'docs/b.md': 'b\n' });
}

describe('ccd-land-probe: the radar', () => {
  it('a project with no conf is not probed, and nothing is written under $REG/landing', () => {
    threeHeads();
    const r = fx.run();
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(fx.reg, 'landing'))).toBe(false);
    expect(fx.ghCalls()).toEqual([]);
    expect(tmpLeft()).toEqual([]);
  });

  it('base x each head: clean, conflict with only its paths, and the PR order', () => {
    threeHeads();
    fx.advanceMain({ 'README.md': 'main moved\n' });
    fx.conf(fx.project, '');
    const r = fx.run();
    expect(r.status).toBe(0);
    const p = fx.readJson('probe');
    expect(p).toMatchObject({ v: 1, project: 'proj-a', state: 'measured', headsCut: false, pairs: [], pairHeads: [], pairsCut: false });
    expect(p.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(p.base).toEqual({ ref: 'main', sha: fx.originMain() });
    expect(p.heads.map((x: any) => x.pr)).toEqual([3, 2, 1]);
    const by = Object.fromEntries(p.heads.map((x: any) => [x.pr, x]));
    expect(by[1].base).toEqual({ state: 'conflict', paths: ['README.md'], pathsCut: false });
    expect(by[2].base).toEqual({ state: 'clean' });
    expect(by[3].base).toEqual({ state: 'clean' });
    expect(by[1]).toMatchObject({ branch: 'feature/pr-1', id: null });
    expect(p.store.before.count).toEqual(expect.any(Number));
    expect(p.store.after.count).toBe(p.store.before.count);
    expect(p.scratch.sizeKiB).toBeGreaterThan(0);
    expect(fx.readJson('main-health')).toMatchObject({ v: 1, project: 'proj-a', sha: fx.originMain(), state: 'unmeasured', why: 'no-required-set', required: [], failing: [], pending: [] });
    expect(tmpLeft()).toEqual([]);
    expect(ls(fx.landDir).filter((n) => n.startsWith('.lp.'))).toEqual([]);
  });

  it('the pairwise set is the bound heads, newest first, at most 10', { timeout: 60_000 }, () => {
    for (let n = 1; n <= 12; n++) {
      const files: Record<string, string> = { [`f${n}.txt`]: `${n}\n` };
      if (n === 8) files['src/x.ts'] = 'eight\n';
      if (n === 9) files['src/x.ts'] = 'nine\n';
      fx.addHead(n, files, { branch: `ws/h${n}` });
      fx.addRow(`lane-a-proj-a-h${n}`, `ws/h${n}`);
    }
    fx.addHead(13, { 'f13.txt': 'x\n' });
    fx.conf(fx.project, '');
    expect(fx.run().status).toBe(0);
    const p = fx.readJson('probe');
    expect(p.state).toBe('measured');
    expect(p.heads).toHaveLength(13);
    expect(p.pairHeads).toHaveLength(10);
    expect(p.pairHeads).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect(p.pairsCut).toBe(true);
    expect(p.pairs).toHaveLength(45);
    expect(p.pairs.some((x: any) => x.a === 13 || x.b === 13 || x.a === 2 || x.b === 1)).toBe(false);
    expect(p.pairs.every((x: any) => x.a < x.b)).toBe(true);
    const bad = p.pairs.filter((x: any) => x.state !== 'clean');
    expect(bad).toEqual([{ a: 8, b: 9, state: 'conflict', paths: ['src/x.ts'], pathsCut: false }]);
    expect(p.heads.find((x: any) => x.pr === 12).id).toBe('lane-a-proj-a-h12');
    expect(p.heads.find((x: any) => x.pr === 13).id).toBeNull();
  });

  it('a failed fetch writes probe, main-health and every lineage unmeasured', () => {
    threeHeads();
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.addRow('lane-a-proj-a-beta', 'ws/beta');
    fx.addRow('lane-a-other', 'feature/not-ws');
    fx.conf(fx.project, '');
    fs.rmSync(fx.origin, { recursive: true, force: true });
    const r = fx.run();
    expect(r.status).toBe(0);
    const p = fx.readJson('probe');
    expect(p).toMatchObject({ state: 'unmeasured', why: 'fetch-failed', heads: [], pairs: [] });
    expect(fx.readJson('main-health')).toMatchObject({ state: 'unmeasured', why: 'fetch-failed' });
    for (const [id, br] of [['lane-a-proj-a-alpha', 'ws/alpha'], ['lane-a-proj-a-beta', 'ws/beta']]) {
      const l = fx.readJson(`${id}.lineage`);
      expect(l).toMatchObject({ v: 1, project: 'proj-a', id, state: 'unmeasured', why: 'fetch-failed', branch: br, base: null, chain: [], stop: null });
      expect(l.tip).toBe(fx.gitIn(fx.repo, 'rev-parse', `refs/heads/${br}`));
    }
    expect(fx.exists('lane-a-other.lineage')).toBe(false);
    expect(tmpLeft()).toEqual([]);
  });

  it('a failed list of open PRs is unmeasured gh-failed, and the base is still fetched alone', () => {
    threeHeads();
    fx.stubGh({ prList: 'fail' });
    fx.conf(fx.project, '');
    expect(fx.run().status).toBe(0);
    const p = fx.readJson('probe');
    expect(p).toMatchObject({ state: 'unmeasured', why: 'gh-failed', heads: [], pairs: [] });
    expect(p.base).toEqual({ ref: 'main', sha: fx.originMain() });
    expect(fx.readJson('main-health')).toMatchObject({ sha: fx.originMain(), state: 'unmeasured', why: 'no-required-set' });
  });

  it('a merge-tree past its deadline is unmeasured, and its process group is gone', { timeout: 60_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    const pidFile = path.join(h.home, 'sleep.pid');
    fx.wrapGit(`case " $* " in *" merge-tree "*) sleep 30 & echo $! > '${pidFile}'; wait;; esac`);
    const r = fx.run({ CCD_LAND_PROBE_GIT_TIMEOUT: '1' });
    expect(r.status).toBe(0);
    expect(fx.readJson('probe').heads[0].base).toEqual({ state: 'unmeasured', why: 'timeout' });
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    expect(pid).toBeGreaterThan(1);
    expect(await until(() => pidGone(pid), 5000), 'the forked sleep outlived the deadline').toBe(true);
  });

  it('the project budget marks what it did not reach as unmeasured', { timeout: 60_000 }, () => {
    for (let n = 1; n <= 3; n++) fx.addHead(n, { [`f${n}.txt`]: 'x\n' });
    fx.conf(fx.project, '');
    fx.wrapGit('case " $* " in *" merge-tree "*) sleep 6;; esac');
    expect(fx.run({ CCD_LAND_PROBE_BUDGET: '10' }).status).toBe(0);
    const p = fx.readJson('probe');
    expect(p.state).toBe('measured');
    const whys = p.heads.map((x: any) => x.base.why);
    expect(whys.filter((w: string) => w === 'budget').length).toBeGreaterThanOrEqual(1);
    expect(p.heads.filter((x: any) => x.base.state === 'unmeasured').length).toBeGreaterThanOrEqual(1);
  });

  it('the tick budget leaves an unreached project\'s files as they were', { timeout: 90_000 }, () => {
    const b = makeLandFixture(h, { project: 'proj-b', slug: 'o/r2' });
    for (let n = 1; n <= 6; n++) fx.addHead(n, { [`f${n}.txt`]: 'x\n' });
    b.addHead(1, { 'b.txt': 'b\n' });
    fx.conf('proj-a', '');
    fx.conf('proj-b', '');
    expect(fx.run().status).toBe(0);
    const before = fs.statSync(path.join(b.landDir, 'probe'));
    const text = fs.readFileSync(path.join(b.landDir, 'probe'), 'utf8');
    fx.wrapGit('case " $* " in *" merge-tree "*) sleep 6;; esac');
    expect(fx.run({ CCD_LAND_PROBE_TICK_BUDGET: '30' }).status).toBe(0);
    const aProbe = fx.readJson('probe');
    expect(aProbe.heads.some((x: any) => x.base.why === 'budget')).toBe(true);
    const after = fs.statSync(path.join(b.landDir, 'probe'));
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ino).toBe(before.ino);
    expect(fs.readFileSync(path.join(b.landDir, 'probe'), 'utf8')).toBe(text);
  });

  it('the tick budget clips the project budget', { timeout: 90_000 }, () => {
    for (let n = 1; n <= 8; n++) fx.addHead(n, { [`f${n}.txt`]: 'x\n' });
    fx.conf(fx.project, '');
    fx.wrapGit('case " $* " in *" merge-tree "*) sleep 6;; esac');
    const t0 = Date.now();
    const r = fx.run({ CCD_LAND_PROBE_TICK_BUDGET: '30', CCD_LAND_PROBE_BUDGET: '240' });
    const took = (Date.now() - t0) / 1000;
    expect(r.status).toBe(0);
    expect(took).toBeLessThan(45);
    const p = fx.readJson('probe');
    expect(p.heads.filter((x: any) => x.base.why === 'budget').length).toBeGreaterThanOrEqual(1);
    expect(fx.readJson('main-health')).toMatchObject({ state: 'unmeasured', why: 'budget' });
    expect(tmpLeft()).toEqual([]);
  });

  it('SIGTERM mid-tick leaves no scratch, and no writer survives', { timeout: 60_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    const pidFile = path.join(h.home, 'writer.pid');
    fx.wrapGit([
      'case " $* " in *" fetch "*)',
      '  sc=""; prev=""; for a in "$@"; do [ "$prev" = -C ] && sc=$a; prev=$a; done',
      `  ( while :; do echo x >> "$sc/writer.log"; sleep 0.05; done ) & echo $! > '${pidFile}'`,
      '  sleep 120;;',
      'esac',
    ].join('\n'));
    const run = fx.start();
    const writerLog = (): string | null => {
      const d = tmpLeft()[0];
      return d && fs.existsSync(path.join(fx.tmp, d, 'writer.log')) ? path.join(fx.tmp, d, 'writer.log') : null;
    };
    expect(await until(() => writerLog() !== null, 20_000), 'the fetch never started').toBe(true);
    run.child.kill('SIGTERM');
    await run.done;
    expect(tmpLeft()).toEqual([]);
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    expect(await until(() => pidGone(pid), 5000), 'the writer outlived the probe').toBe(true);
    // The scratch stays gone: nothing is still writing into where it was.
    await new Promise((r) => setTimeout(r, 300));
    expect(tmpLeft()).toEqual([]);
  });

  it('enabled mirrors lineage=on, carries its time, and every other answer removes it', () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    const enable = (): void => {
      fx.conf(fx.project, 'lineage=on\n');
      expect(fx.run().status).toBe(0);
    };
    enable();
    const doc = fx.readJson('enabled');
    expect(doc).toMatchObject({ v: 1, project: 'proj-a' });
    expect(Math.abs(Date.parse(doc.at) - Date.now())).toBeLessThan(60_000);

    fx.conf(fx.project, 'lineage=off\n');
    expect(fx.run().status).toBe(0);
    expect(fx.exists('enabled')).toBe(false);

    enable();
    expect(fx.exists('enabled')).toBe(true);
    fx.conf(fx.project, 'lineage=on\nbogus=1\n');
    const bad = fx.run();
    expect(bad.status).toBe(0);
    expect(bad.stderr).toContain('conf-invalid proj-a: unknown-key');
    expect(fx.exists('enabled')).toBe(false);

    enable();
    expect(fx.exists('enabled')).toBe(true);
    const real = path.join(h.home, 'real.conf');
    fs.writeFileSync(real, 'lineage=on\n');
    fs.rmSync(fx.confPath());
    fs.symlinkSync(real, fx.confPath());
    expect(fx.run().status).toBe(0);
    expect(fx.exists('enabled')).toBe(false);

    fs.rmSync(fx.confPath());
    enable();
    expect(fx.exists('enabled')).toBe(true);
    fs.rmSync(fx.confPath());
    expect(fx.run().status).toBe(0);
    expect(fx.exists('enabled')).toBe(false);

    enable();
    expect(fx.exists('enabled')).toBe(true);
    fx.pause('project');
    expect(fx.run().status).toBe(0);
    expect(fx.exists('enabled')).toBe(false);
  });

  it('the global pause exits 0 before the lock and writes nothing', () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, 'lineage=on\n');
    fx.pause('global');
    const lock = path.join(h.home, '.ccrc', 'land-probe.lock');
    expect(fs.existsSync(lock)).toBe(false);
    const r = fx.run();
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(fx.reg, 'landing'))).toBe(false);
    expect(fs.existsSync(lock)).toBe(false);
    expect(fx.ghCalls()).toEqual([]);
  });

  it('a held lock exits 0 quietly', async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    const lock = path.join(h.home, '.ccrc', 'land-probe.lock');
    const holder = spawn('flock', [lock, 'sleep', '30'], { stdio: 'ignore' });
    try {
      const held = (): boolean => {
        try { execFileSync('flock', ['-n', lock, 'true']); return false; } catch { return true; }
      };
      expect(await until(held, 5000), 'the test never took the lock').toBe(true);
      const r = fx.run();
      expect(r).toEqual({ status: 0, stdout: '', stderr: '' });
      expect(fs.existsSync(path.join(fx.reg, 'landing'))).toBe(false);
    } finally {
      holder.kill('SIGKILL');
    }
  });

  it('an argument is a usage error', () => {
    const r = fx.run({}, ['--now']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage');
  });

  it('a bad knob refuses', () => {
    fx.conf(fx.project, '');
    const r = fx.run({ CCD_LAND_PROBE_PAIR_HEADS: '11' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CCD_LAND_PROBE_PAIR_HEADS');
    expect(fs.existsSync(path.join(fx.reg, 'landing'))).toBe(false);
    const nan = fx.run({ CCD_LAND_PROBE_BUDGET: 'soon' });
    expect(nan.status).toBe(1);
    expect(nan.stderr).toContain('CCD_LAND_PROBE_BUDGET');
  });

  it('the project repository is not written, and no hook or fsmonitor runs', () => {
    fx.addHead(1, { 'README.md': 'one\n' }, { branch: 'ws/alpha' });
    fx.addHead(2, { 'README.md': 'two\n' }, { branch: 'ws/beta' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.addRow('lane-a-proj-a-beta', 'ws/beta');
    fx.advanceMain({ 'other.txt': 'moved\n' });
    fx.conf(fx.project, 'lineage=on\n');
    const canary = fx.armHooks();
    const before = fx.snapshot();
    const r = fx.run();
    expect(r.status).toBe(0);
    const p = fx.readJson('probe');
    expect(p.state, 'the fetch really ran').toBe('measured');
    expect(p.pairs).toHaveLength(1);
    expect(p.pairs[0]).toMatchObject({ a: 1, b: 2, state: 'conflict', paths: ['README.md'] });
    expect(fx.snapshot()).toEqual(before);
    expect(fs.existsSync(canary)).toBe(false);
    expect(tmpLeft()).toEqual([]);
  });

  it('a second remote does not change the repository measured', () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.gitIn(fx.repo, 'remote', 'add', 'upstream', 'https://github.com/x/other.git');
    fx.conf(fx.project, '');
    expect(fx.run().status).toBe(0);
    expect(fx.readJson('probe').state).toBe('measured');
    const calls = fx.ghCalls();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c, c).toMatch(/--repo o\/r( |$)|(^| )repos\/o\/r\//);
  });

  it('the slug follows _gh_repo_slug', () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    fx.setOrigin('ssh://git@github.com/o/r.git');
    expect(fx.run().status).toBe(0);
    expect(fx.readJson('probe').state).toBe('measured');
    for (const url of ['https://github.com/o/..', 'https://github.com/.x/y', 'https://example.com/o/r']) {
      fx.setOrigin(url);
      expect(fx.run().status, url).toBe(0);
      const p = fx.readJson('probe');
      expect(p, url).toMatchObject({ state: 'unmeasured', why: 'repo-unreadable', heads: [], pairs: [] });
      expect(fx.readJson('main-health'), url).toMatchObject({ state: 'unmeasured' });
    }
  });

  it('the scratch is removed, and only an owned, sentineled old scratch is cleared', () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    const old = new Date(Date.now() - 2 * 3600_000);
    const aside = path.join(h.home, 'aside');
    fs.mkdirSync(aside);
    const mk = (n: string): string => { const d = path.join(fx.tmp, `ccd-land-probe.${n}`); fs.mkdirSync(d); return d; };
    const d1 = mk('real'); fs.writeFileSync(path.join(d1, '.ccd-land-probe-scratch'), 's\n'); fs.writeFileSync(path.join(d1, 'junk'), 'j');
    const d2 = mk('nosentinel'); fs.writeFileSync(path.join(d2, 'junk'), 'j');
    const d3 = mk('linksentinel'); fs.writeFileSync(path.join(aside, 'real-sentinel'), 's'); fs.symlinkSync(path.join(aside, 'real-sentinel'), path.join(d3, '.ccd-land-probe-scratch'));
    const target = path.join(aside, 'target'); fs.mkdirSync(target); fs.writeFileSync(path.join(target, '.ccd-land-probe-scratch'), 's\n'); fs.writeFileSync(path.join(target, 'keep'), 'k');
    const d4 = path.join(fx.tmp, 'ccd-land-probe.linkdir'); fs.symlinkSync(target, d4);
    for (const d of [d1, d2, d3]) fs.utimesSync(d, old, old);
    fs.lutimesSync(d4, old, old);
    expect(fx.run().status).toBe(0);
    expect(fs.existsSync(d1)).toBe(false);
    expect(fs.existsSync(d2)).toBe(true);
    expect(fs.lstatSync(d3).isDirectory()).toBe(true);
    expect(fs.lstatSync(d4).isSymbolicLink()).toBe(true);
    expect(ls(target)).toEqual(['.ccd-land-probe-scratch', 'keep']);
    expect(tmpLeft().sort()).toEqual(['ccd-land-probe.linkdir', 'ccd-land-probe.linksentinel', 'ccd-land-probe.nosentinel']);
  });

  it('a symlinked $REG/landing/proj-a is left alone', () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, 'lineage=on\n');
    const target = path.join(h.home, 'landing-target');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep'), 'k');
    fs.mkdirSync(path.join(fx.reg, 'landing'), { recursive: true });
    fs.symlinkSync(target, fx.landDir);
    const r = fx.run();
    expect(r.status).toBe(0);
    expect(ls(target)).toEqual(['keep']);
    expect(fs.readFileSync(path.join(target, 'keep'), 'utf8')).toBe('k');
    const lines = r.stderr.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('proj-a');
    expect(tmpLeft()).toEqual([]);
  });

  it('only the two read forms reached gh, and the poison saw nothing', () => {
    for (let n = 1; n <= 2; n++) fx.addHead(n, { [`f${n}.txt`]: 'x\n' });
    fx.conf(fx.project, '');
    expect(fx.run().status).toBe(0);
    const calls = fx.ghCalls();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c, c).toMatch(/^(api --method GET repos\/o\/r\/|pr list --repo o\/r --state open )/);
    expect(ghPoisonAt(h.home)).toEqual([]);
  });
});

describe('ccd-land-probe: the slug rule', () => {
  // The rule is _gh_repo_slug's, and docs-parity.test.ts binds the docs helper's copy to it over this same corpus.
  const CORPUS: ReadonlyArray<readonly [string, string | null]> = [
    ['https://github.com/o/r', 'o/r'], ['https://github.com/o/r.git', 'o/r'], ['git@github.com:o/r.git', 'o/r'],
    ['ssh://git@github.com/o/r.git', 'o/r'], ['https://example.invalid/o/r', null], ['https://github.com/o/r/x', null],
    ['https://github.com/o/r r', null], ['', null], ['https://github.com/o', null], ['http://github.com/o/r', null],
    ['git@github.com:https://github.com/o/r', null], ['https://github.com/o/r.git.git', 'o/r.git'],
    ['example-org/example-repo', null], ['../x', null], ['./x', null], ['.x/y', null], ['x/.y', null],
    ['https://github.com/../x', null], ['git@github.com:./x', null], ['ssh://git@github.com/.x/y.git', null],
    ['https://github.com/x/.y', 'x/.y'], ['ssh://git@github.com/x/.y', 'x/.y'], ['git@github.com:user/.dotfiles.git', 'user/.dotfiles'],
    ['https://github.com/x/..', null], ['git@github.com:o.x/r..y.git', 'o.x/r..y'], ['https://github.com/o/r.', 'o/r.'],
    ['https://github.com/o/..git', null], ['https://github.com/./x', null], ['https://github.com/org/.github', 'org/.github'],
    ['git@github.com:.x/y.git', null], [`https://github.com/o/r${String.fromCharCode(0xe9)}`, null],
    [`https://github.com/${String.fromCharCode(0xf3)}/r`, null],
  ];

  it('gives the shared verdict on every origin URL', () => {
    const src = fs.readFileSync(PROBE, 'utf8');
    const program = src.slice(src.indexOf("<<'PY'\n") + "<<'PY'\n".length, src.lastIndexOf('\nPY'));
    // Imported, not run: __name__ is not __main__, so the tick never starts.
    const driver = 'import json, sys\nns = {"__name__": "probe"}\nexec(compile(open(sys.argv[1]).read(), "probe", "exec"), ns)\n'
      + 'print(json.dumps([ns["repo_slug"](u) for u in json.loads(sys.argv[2])]))\n';
    const progFile = path.join(h.home, 'program.py');
    fs.writeFileSync(progFile, program);
    const out = execFileSync('python3', ['-I', '-c', driver, progFile, JSON.stringify(CORPUS.map((c) => c[0]))], { encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual(CORPUS.map((c) => c[1]));
  });
});

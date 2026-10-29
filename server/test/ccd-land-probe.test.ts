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
import { makeLandFixture, pidGone, until, PROBE, type LandFixture, type CheckRun } from './ccdLandProbeFixture.js';

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
/** A `.lp.*` temp file of write_json left in the landing directory or the project's. */
const landLeft = (): string[] => [path.join(fx.reg, 'landing'), fx.landDir].flatMap((d) => ls(d).filter((n) => n.startsWith('.lp.')));

const run = (id: number, name: string, status: string, conclusion: string | null, app?: number): CheckRun =>
  ({ id, name, status, conclusion, ...(app === undefined ? {} : { app: { id: app } }) });
/** A required_status_checks rule of the branch rules, one entry per {context, integration_id?}. */
const REQ_RULE = (checks: Array<{ context: string; integration_id?: number }>): unknown =>
  ({ type: 'required_status_checks', parameters: { required_status_checks: checks } });

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
    // No REST answers are stubbed here: the base's required checks cannot be read, which is unmeasured, never green.
    expect(fx.readJson('main-health')).toMatchObject({ v: 1, project: 'proj-a', sha: fx.originMain(), state: 'unmeasured', why: 'gh-failed', required: [], failing: [], pending: [] });
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
    fx.stubChecks({ rules: [REQ_RULE([{ context: 'ci/test' }])], runs: [run(1, 'ci/test', 'completed', 'success')] });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.conf(fx.project, '');
    expect(fx.run().status).toBe(0);
    const p = fx.readJson('probe');
    expect(p).toMatchObject({ state: 'unmeasured', why: 'gh-failed', heads: [], pairs: [] });
    expect(p.base).toEqual({ ref: 'main', sha: fx.originMain() });
    // The PR list is not what main-health and the lineage read: both go on against the base alone (R6).
    expect(fx.readJson('main-health')).toMatchObject({ sha: fx.originMain(), state: 'green', required: [{ name: 'ci/test', app: null }] });
    expect(fx.readJson('lane-a-proj-a-alpha.lineage')).toMatchObject({ state: 'measured', base: fx.originMain(), chain: [], stop: 'not-a-merge' });
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
      `  ( while [ $SECONDS -lt $DEADLINE ]; do echo x >> "$sc/writer.log"; sleep 0.05; done ) & echo $! > '${pidFile}'`,
      '  sleep 100;;',
      'esac',
    ].join('\n'));
    const run = fx.start();
    const writerLog = (): string | null => {
      const d = tmpLeft()[0];
      return d && fs.existsSync(path.join(fx.tmp, d, 'writer.log')) ? path.join(fx.tmp, d, 'writer.log') : null;
    };
    expect(await until(() => writerLog() !== null, 20_000), 'the fetch never started').toBe(true);
    run.child.kill('SIGTERM');
    expect((await run.done).status).toBe(143);
    expect(tmpLeft()).toEqual([]);
    // The killed fetch is never read as a failed one: the interruption is raised as its child returns, before any write.
    expect(fx.exists('probe')).toBe(false);
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
    // --no-fork: flock execs the sleep itself, so the SIGKILL below ends the holder and leaves no orphan behind.
    const holder = spawn('flock', ['--no-fork', lock, 'sleep', '30'], { stdio: 'ignore' });
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

  // What this case can and cannot see. Its snapshot is refs, the object counts, the config and the hooks listing, and
  // the canary: every hook in ~/.gitconfig's hooks path would write it. It cannot see an object's modification time:
  // git freshens an object already in the project (its loose file's or pack's mtime) instead of writing a copy; no
  // content, ref, config, hook or object set changes; every object it touches is one the project already holds.
  // Nor can it see the fsmonitor setting: no allowlisted subcommand reads the index, so no fsmonitor could run here.
  // That half is held by the literal tuple pin on GIT_PREFIX in ccd-land-probe-readonly.test.ts (R5).
  it('the project repository is not written, and no hook runs (the fsmonitor setting is held by the prefix pin)', () => {
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
      // No gh call was made, so the why is not gh-failed: the plan's set has fetch-failed for a project that was not reached.
      expect(fx.readJson('main-health'), url).toMatchObject({ state: 'unmeasured', why: 'fetch-failed' });
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
    const r = fx.run();
    expect(r.status).toBe(0);
    // The lstat check, not rmtree's own refusal of a symlink, decides: only d1 is cleared.
    expect(r.stderr.split('\n').filter((l) => l.includes('cleared a stale scratch'))).toHaveLength(1);
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

/** The embedded program, imported (not run: __name__ is not __main__) in a python3 -I child, and the named pure
 *  functions called with JSON arguments: one process per batch, no git, no forge. */
function pyCall(calls: Array<[string, unknown[]]>): any[] {
  const src = fs.readFileSync(PROBE, 'utf8');
  const program = src.slice(src.indexOf("<<'PY'\n") + "<<'PY'\n".length, src.lastIndexOf('\nPY'));
  const progFile = path.join(h.home, 'program-pure.py');
  fs.writeFileSync(progFile, program);
  const driver = 'import json, sys\nns = {"__name__": "probe"}\nexec(compile(open(sys.argv[1]).read(), "probe", "exec"), ns)\n'
    + 'print(json.dumps([ns[f](*a) for f, a in json.loads(sys.argv[2])]))\n';
  return JSON.parse(execFileSync('python3', ['-I', '-c', driver, progFile, JSON.stringify(calls)], { encoding: 'utf8' }));
}
const required = (...e: Array<[string, number | null]>): Array<{ name: string; app: number | null }> => e.map(([name, app]) => ({ name, app }));
const judge = (req: unknown, runs: unknown[] = [], statuses: unknown[] = []): any => pyCall([['judge_required', [req, runs, statuses]]])[0];
const status = (id: number, context: string, state: string): unknown => ({ id, context, state });

describe('ccd-land-probe: the lineage walk', () => {
  const ALPHA = 'lane-a-proj-a-alpha';
  const lineage = (id = ALPHA): any => fx.readJson(`${id}.lineage`);
  const lineageFiles = (): string[] => ls(fx.landDir).filter((n) => n.endsWith('.lineage'));
  function alpha(): string {
    fx.addRow(ALPHA, 'ws/alpha');
    const own = fx.commitOn('ws/alpha', { 'alpha.txt': 'a\n' });
    fx.conf(fx.project, '');
    return own;
  }

  it('a clean merge of the fetched base is one chain step, and the old tip is its p1', { timeout: 90_000 }, () => {
    const own = alpha();
    const tip = fx.mergeBase('ws/alpha');
    expect(fx.run().status).toBe(0);
    expect(lineage()).toMatchObject({
      v: 1, project: 'proj-a', id: ALPHA, state: 'measured', branch: 'ws/alpha', tip, base: fx.originMain(),
      chain: [{ merge: tip, p1: own, p2: fx.originMain() }], stop: 'not-a-merge',
    });
    expect(lineage().at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(lineage().why).toBeUndefined();
  });

  it('a hand-edited merge stops at tree-differs', { timeout: 90_000 }, () => {
    alpha();
    const tip = fx.handMerge('ws/alpha', { 'hand.txt': 'slipped in\n' });
    expect(fx.run().status).toBe(0);
    expect(lineage()).toMatchObject({ state: 'measured', tip, chain: [], stop: 'tree-differs' });
  });

  it('a resolved conflict stops at conflict', { timeout: 90_000 }, () => {
    fx.addRow(ALPHA, 'ws/alpha');
    fx.conf(fx.project, '');
    const tip = fx.conflictMerge('ws/alpha');
    expect(fx.run().status).toBe(0);
    expect(lineage()).toMatchObject({ state: 'measured', tip, chain: [], stop: 'conflict' });
  });

  it('a merge of another workspace branch stops at second-parent-not-on-base', { timeout: 90_000 }, () => {
    alpha();
    fx.addRow('lane-a-proj-a-other', 'ws/other');
    fx.commitOn('ws/other', { 'other.txt': 'o\n' });
    const tip = fx.mergeOther('ws/alpha', 'ws/other');
    expect(fx.run().status).toBe(0);
    expect(lineage()).toMatchObject({ state: 'measured', tip, chain: [], stop: 'second-parent-not-on-base' });
    // Its own tip is a plain commit: no merge to walk.
    expect(lineage('lane-a-proj-a-other')).toMatchObject({ state: 'measured', chain: [], stop: 'not-a-merge' });
  });

  it('a rebase leaves a single-parent tip: not-a-merge, empty chain', { timeout: 90_000 }, () => {
    alpha();
    const tip = fx.rebaseOnto('ws/alpha');
    expect(fx.gitIn(fx.repo, 'rev-list', '--parents', '-n', '1', tip).split(' ')).toHaveLength(2);
    expect(fx.run().status).toBe(0);
    expect(lineage()).toMatchObject({ state: 'measured', tip, chain: [], stop: 'not-a-merge' });
  });

  it('nine clean base merges stop at limit after eight', { timeout: 120_000 }, () => {
    alpha();
    let tip = '';
    for (let i = 0; i < 9; i++) tip = fx.mergeBase('ws/alpha');
    expect(fx.run().status).toBe(0);
    const l = lineage();
    expect(l).toMatchObject({ state: 'measured', tip, stop: 'limit' });
    expect(l.chain).toHaveLength(8);
    expect(l.chain[0].merge).toBe(tip);
    for (let i = 0; i < 7; i++) expect(l.chain[i].p1).toBe(l.chain[i + 1].merge);
  });

  it('CCD_LAND_PROBE_LINEAGE_STEPS=0 writes an empty chain with stop limit', { timeout: 90_000 }, () => {
    alpha();
    const tip = fx.mergeBase('ws/alpha');
    expect(fx.run({ CCD_LAND_PROBE_LINEAGE_STEPS: '0' }).status).toBe(0);
    expect(lineage()).toMatchObject({ state: 'measured', tip, chain: [], stop: 'limit' });
  });

  it('a git failure inside the walk is unmeasured, and the chain keeps what was proven first', { timeout: 90_000 }, () => {
    alpha();
    fx.mergeBase('ws/alpha');
    const tip = fx.mergeBase('ws/alpha');
    const cnt = path.join(h.home, 'ancestor.count');
    fx.wrapGit(`case " $* " in *" merge-base --is-ancestor "*) n=$(cat '${cnt}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${cnt}'; [ $n -ge 2 ] && exit 128;; esac`);
    expect(fx.run().status).toBe(0);
    const l = lineage();
    expect(l).toMatchObject({ state: 'unmeasured', why: 'rc-128', tip, stop: 'unmeasured' });
    expect(l.chain).toHaveLength(1);
    expect(l.chain[0].merge).toBe(tip);
  });

  it('a row of another project, a branch outside ws/, an id isRegistryId refuses, or a missing ref, writes no lineage', { timeout: 90_000 }, () => {
    alpha();
    // Another project's row: its own project file, a branch that exists here.
    fs.writeFileSync(path.join(fx.reg, 'lane-a-other-x.project'), 'proj-b\n');
    fs.writeFileSync(path.join(fx.reg, 'lane-a-other-x.branch'), 'ws/alpha\n');
    fx.addRow('lane-a-proj-a-feat', 'feature/f');
    fx.addRow('lane-a-proj-a-ghost', 'ws/ghost', { local: false });
    // Ids isRegistryId refuses: a leading dot, a leading dash, a space.
    for (const bad of ['.hidden-row', '-dash-row', 'has space']) {
      fs.writeFileSync(path.join(fx.reg, `${bad}.project`), 'proj-a\n');
      fs.writeFileSync(path.join(fx.reg, `${bad}.branch`), 'ws/alpha\n');
    }
    expect(fx.run().status).toBe(0);
    expect(lineageFiles()).toEqual([`${ALPHA}.lineage`]);
  });

  it('a 247-character id, the longest a registry row can carry, gets a lineage', { timeout: 90_000 }, () => {
    const id = 'lane-a-proj-a-' + 'x'.repeat(247 - 'lane-a-proj-a-'.length);
    expect(id).toHaveLength(247);
    fx.addRow(id, 'ws/long');
    fx.conf(fx.project, '');
    const tip = fx.gitIn(fx.repo, 'rev-parse', 'refs/heads/ws/long');
    expect(fx.run().status).toBe(0);
    expect(lineageFiles()).toEqual([`${id}.lineage`]);
    expect(lineage(id)).toMatchObject({ id, state: 'measured', tip, stop: 'not-a-merge' });
    expect(ls(fx.landDir).filter((n) => n.startsWith('.lp.'))).toEqual([]);
  });

  it('a lineage file whose row is gone is removed; a symlink named x.lineage and a file not named *.lineage are not touched', { timeout: 90_000 }, () => {
    alpha();
    expect(fx.run().status).toBe(0);
    expect(lineageFiles()).toEqual([`${ALPHA}.lineage`]);
    const outside = path.join(h.home, 'outside.txt');
    fs.writeFileSync(outside, 'keep\n');
    fs.writeFileSync(path.join(fx.landDir, 'gone.lineage'), '{}\n');
    fs.symlinkSync(outside, path.join(fx.landDir, 'x.lineage'));
    fs.writeFileSync(path.join(fx.landDir, 'notes.txt'), 'n\n');
    fs.writeFileSync(path.join(fx.landDir, 'gone.lineage.bak'), 'b\n');
    fs.mkdirSync(path.join(fx.landDir, 'dir.lineage'));
    // And the row itself goes: its registry files are removed.
    fs.rmSync(path.join(fx.reg, `${ALPHA}.project`));
    fs.rmSync(path.join(fx.reg, `${ALPHA}.branch`));
    expect(fx.run().status).toBe(0);
    expect(lineageFiles()).toEqual(['dir.lineage', 'x.lineage']);
    expect(fs.lstatSync(path.join(fx.landDir, 'x.lineage')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep\n');
    expect(fs.lstatSync(path.join(fx.landDir, 'dir.lineage')).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(fx.landDir, 'notes.txt'))).toBe(true);
    expect(fs.existsSync(path.join(fx.landDir, 'gone.lineage.bak'))).toBe(true);
  });

  it('one bad registry row costs only its own lineage, never the others, enabled or the final probe', { timeout: 90_000 }, () => {
    alpha();
    const tip = fx.mergeBase('ws/alpha');
    // A branch the git door refuses to name: it cannot qualify, and it must not stop the project.
    fx.addRow('lane-a-proj-a-bad', 'ws/core.hooksPath');
    fx.conf(fx.project, 'lineage=on\n');
    const r = fx.run();
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('lineage-skip');
    expect(r.stderr).not.toContain('project-error');
    expect(lineage()).toMatchObject({ state: 'measured', tip, stop: 'not-a-merge' });
    expect(lineage().chain).toHaveLength(1);
    expect(lineageFiles()).toEqual([`${ALPHA}.lineage`]);
    expect(fx.exists('enabled')).toBe(true);
    const p = fx.readJson('probe');
    expect(p.store.after.count).toEqual(expect.any(Number));
    expect(p.scratch.sizeKiB).toBeGreaterThan(0);
  });

  it('a row whose read times out keeps its previous file, and the other rows are measured', { timeout: 90_000 }, () => {
    alpha();
    fx.addRow('lane-a-proj-a-slow', 'ws/slow');
    fs.mkdirSync(fx.landDir, { recursive: true });
    const seeded = path.join(fx.landDir, 'lane-a-proj-a-slow.lineage');
    fs.writeFileSync(seeded, '{"v":1,"seeded":true}\n');
    fx.wrapGit('case " $* " in *"refs/heads/ws/slow"*) sleep 30;; esac');
    const r = fx.run({ CCD_LAND_PROBE_GIT_TIMEOUT: '3' });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(seeded, 'utf8')).toBe('{"v":1,"seeded":true}\n');
    expect(lineage()).toMatchObject({ state: 'measured', stop: 'not-a-merge' });
    expect(fx.readJson('probe').state).toBe('measured');
  });
});

describe('ccd-land-probe: main-health, the required set and its judge', () => {
  it('the required set is the union of the rules and the branch view, with each name\'s App', () => {
    const rules = [
      REQ_RULE([{ context: 'ci/test', integration_id: 15368 }, { context: 'ci/build' }]),
      { type: 'pull_request', parameters: {} },
    ];
    const branch = {
      protection: {
        required_status_checks: {
          contexts: ['ci/lint', 'ci/build', 'ci/test'],
          checks: [{ context: 'ci/lint', app_id: -1 }, { context: 'ci/e2e', app_id: 77 }],
        },
      },
    };
    const [union, rulesOnly, garbage] = pyCall([['required_set', [rules, branch]], ['required_set', [rules, {}]], ['required_set', [{}, 'x']]]);
    // ci/test: the rule's pin wins over the branch view's pin-less twin; ci/lint: -1 is no App.
    expect(union).toEqual(required(['ci/build', null], ['ci/e2e', 77], ['ci/lint', null], ['ci/test', 15368]));
    expect(rulesOnly).toEqual(required(['ci/build', null], ['ci/test', 15368]));
    expect(garbage).toEqual([]);
  });

  it('every required name passing on a completed run is green', () => {
    const v = judge(required(['ci/a', null], ['ci/b', 15368], ['ci/c', null]), [
      run(1, 'ci/a', 'completed', 'success'), run(2, 'ci/b', 'completed', 'neutral', 15368), run(3, 'ci/c', 'completed', 'skipped'),
      run(4, 'ci/unrelated', 'completed', 'failure'),
    ]);
    expect(v).toMatchObject({ state: 'green', failing: [], pending: [] });
    expect(v.why).toBeUndefined();
    expect(v.required).toHaveLength(3);
  });

  it('a failing completed run is red, and names it', () => {
    for (const conclusion of ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']) {
      const v = judge(required(['ci/a', null], ['ci/b', null]), [run(1, 'ci/a', 'completed', 'success'), run(2, 'ci/b', 'completed', conclusion)]);
      expect(v, conclusion).toMatchObject({ state: 'red', failing: ['ci/b'], pending: [] });
    }
    // A failure is a verdict even beside a name that is still pending.
    expect(judge(required(['ci/a', null], ['ci/b', null]), [run(1, 'ci/a', 'completed', 'failure')])).toMatchObject({ state: 'red', failing: ['ci/a'], pending: ['ci/b'] });
  });

  it('a queued, in-progress or completed-without-conclusion required run is unmeasured pending, never green', () => {
    for (const [st, concl] of [['queued', null], ['in_progress', null], ['completed', null], ['waiting', null], ['completed', 'something-new']] as const) {
      const v = judge(required(['ci/a', null]), [run(1, 'ci/a', st, concl)]);
      expect(v, `${st}/${concl}`).toMatchObject({ state: 'unmeasured', why: 'pending', failing: [], pending: ['ci/a'] });
    }
  });

  it('a run that reports success before it completes is pending', () => {
    const v = judge(required(['ci/early', null], ['ci/queued', null]), [run(1, 'ci/early', 'in_progress', 'success'), run(2, 'ci/queued', 'queued', 'success')]);
    expect(v.state).toBe('unmeasured');
    expect(v).toMatchObject({ why: 'pending', pending: ['ci/early', 'ci/queued'], failing: [] });
  });

  it('an App-pinned name passes only on that App\'s run', () => {
    const req = required(['ci/test', 15368]);
    // The same name from another App, newer and green, leaves the pinned name pending.
    expect(judge(req, [run(9, 'ci/test', 'completed', 'success', 999)])).toMatchObject({ state: 'unmeasured', why: 'pending', pending: ['ci/test'] });
    expect(judge(req, [run(9, 'ci/test', 'completed', 'success')])).toMatchObject({ state: 'unmeasured', why: 'pending' });
    // And a failure from another App is not this name's failure.
    expect(judge(req, [run(9, 'ci/test', 'completed', 'failure', 999)])).toMatchObject({ state: 'unmeasured', why: 'pending', failing: [] });
    // The pinned App's run counts, however many newer runs another App has.
    expect(judge(req, [run(3, 'ci/test', 'completed', 'success', 15368), run(9, 'ci/test', 'completed', 'failure', 999)])).toMatchObject({ state: 'green' });
  });

  it('an App-pinned name seen only as a status is unmeasured app-unverifiable', () => {
    const v = judge(required(['ci/test', 15368]), [], [status(1, 'ci/test', 'success')]);
    expect(v).toMatchObject({ state: 'unmeasured', why: 'app-unverifiable', pending: ['ci/test'], failing: [] });
  });

  it('an unpinned name seen only as a status counts; a failing status is red', () => {
    const req = required(['ci/legacy', null]);
    expect(judge(req, [], [status(1, 'ci/legacy', 'success')])).toMatchObject({ state: 'green' });
    expect(judge(req, [], [status(1, 'ci/legacy', 'failure')])).toMatchObject({ state: 'red', failing: ['ci/legacy'] });
    expect(judge(req, [], [status(1, 'ci/legacy', 'error')])).toMatchObject({ state: 'red', failing: ['ci/legacy'] });
    expect(judge(req, [], [status(1, 'ci/legacy', 'pending')])).toMatchObject({ state: 'unmeasured', why: 'pending' });
    // A name with neither a run nor a status is pending.
    expect(judge(req, [run(1, 'ci/other', 'completed', 'success')], [status(2, 'ci/other2', 'success')])).toMatchObject({ state: 'unmeasured', why: 'pending', pending: ['ci/legacy'] });
  });

  it('a name pinned to two Apps is unmeasured app-conflict', () => {
    const v = judge(required(['ci/test', 1], ['ci/test', 2]), [run(1, 'ci/test', 'completed', 'success', 1), run(2, 'ci/test', 'completed', 'success', 2)]);
    expect(v).toMatchObject({ state: 'unmeasured', why: 'app-conflict', pending: ['ci/test'] });
    expect(v.required).toEqual(required(['ci/test', 1], ['ci/test', 2]));
  });

  it('an empty required set is unmeasured no-required-set', () => {
    const v = judge([], [run(1, 'ci/a', 'completed', 'success')], [status(1, 'ci/a', 'success')]);
    expect(v).toEqual({ state: 'unmeasured', why: 'no-required-set', required: [], failing: [], pending: [] });
  });

  it('the newest run of a name wins', () => {
    const req = required(['ci/a', null]);
    const older = run(1, 'ci/a', 'completed', 'success');
    const newer = run(2, 'ci/a', 'completed', 'failure');
    expect(judge(req, [older, newer])).toMatchObject({ state: 'red' });
    expect(judge(req, [newer, older])).toMatchObject({ state: 'red' });
    const re = run(3, 'ci/a', 'completed', 'success');
    expect(judge(req, [newer, re])).toMatchObject({ state: 'green' });
    expect(judge(req, [re, newer])).toMatchObject({ state: 'green' });
    // A re-run still in progress is the newest, and the name is pending until it ends.
    expect(judge(req, [re, run(4, 'ci/a', 'in_progress', null)])).toMatchObject({ state: 'unmeasured', why: 'pending' });
  });
});

describe('ccd-land-probe: main-health, from the forge', () => {
  const RULES = [REQ_RULE([{ context: 'ci/test', integration_id: 15368 }, { context: 'ci/build' }])];
  const BRANCH = { protection: { required_status_checks: { contexts: ['ci/lint'], checks: [] } } };

  it('reads the rules, the branch view, the check runs (paginated) and the status of the fetched base, and judges them', { timeout: 60_000 }, () => {
    const runs = [
      run(1, 'ci/test', 'completed', 'success', 15368), run(2, 'ci/build', 'completed', 'success', 5), run(3, 'ci/noise', 'completed', 'failure'),
      run(4, 'ci/other', 'completed', 'success'), run(5, 'ci/more', 'completed', 'success'),
    ];
    fx.stubChecks({ rules: RULES, branch: BRANCH, runs, statuses: [status(1, 'ci/lint', 'success')] });
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    expect(fx.run().status).toBe(0);
    const sha = fx.originMain();
    expect(fx.readJson('main-health')).toMatchObject({
      v: 1, project: 'proj-a', sha, state: 'green', failing: [], pending: [],
      required: [{ name: 'ci/build', app: null }, { name: 'ci/lint', app: null }, { name: 'ci/test', app: 15368 }],
    });
    expect(fx.readJson('main-health').why).toBeUndefined();
    const api = fx.ghCalls().filter((c) => c.startsWith('api '));
    expect(api).toEqual([
      'api --method GET repos/o/r/rules/branches/main --paginate',
      'api --method GET repos/o/r/branches/main',
      `api --method GET repos/o/r/commits/${sha}/check-runs?per_page=100 --paginate`,
      `api --method GET repos/o/r/commits/${sha}/status`,
    ]);
  });

  it('a failing required run on the base is red and named in the file', { timeout: 60_000 }, () => {
    fx.stubChecks({ rules: RULES, runs: [run(1, 'ci/test', 'completed', 'failure', 15368), run(2, 'ci/build', 'queued', null)] });
    fx.conf(fx.project, '');
    expect(fx.run().status).toBe(0);
    expect(fx.readJson('main-health')).toMatchObject({ state: 'red', failing: ['ci/test'], pending: ['ci/build'], sha: fx.originMain() });
  });

  it('a gh failure is unmeasured gh-failed, whichever read it was', { timeout: 120_000 }, () => {
    fx.conf(fx.project, '');
    for (const bad of [{ rules: 'fail' }, { branch: 'fail' }, { runs: 'fail' }, { statuses: 'fail' }] as const) {
      fx.stubChecks({ rules: RULES, branch: BRANCH, runs: [], statuses: [], ...bad });
      expect(fx.run().status).toBe(0);
      expect(fx.readJson('main-health'), JSON.stringify(bad)).toMatchObject({ state: 'unmeasured', why: 'gh-failed', sha: fx.originMain(), required: [], failing: [], pending: [] });
    }
  });

  it('a base with a slash is %2F-encoded in both REST paths', { timeout: 60_000 }, () => {
    fx.gitIn(fx.origin, 'branch', 'release/1.0', 'main');
    fx.stubChecks({ rules: [REQ_RULE([{ context: 'ci/build' }])], runs: [run(1, 'ci/build', 'completed', 'success')] });
    fx.conf(fx.project, 'base=release/1.0\n');
    expect(fx.run().status).toBe(0);
    expect(fx.readJson('probe').base.ref).toBe('release/1.0');
    expect(fx.readJson('main-health')).toMatchObject({ state: 'green' });
    const api = fx.ghCalls().filter((c) => c.startsWith('api '));
    expect(api.slice(0, 2)).toEqual(['api --method GET repos/o/r/rules/branches/release%2F1.0 --paginate', 'api --method GET repos/o/r/branches/release%2F1.0']);
    for (const c of api) expect(c, c).not.toContain('release/1.0');
  });
});

describe('ccd-land-probe: a failed or partial measurement is never clean', () => {
  it('a merge-tree that exits 128 is unmeasured rc-128, and one that prints no tree is unmeasured no-tree', { timeout: 90_000 }, () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    fx.wrapGit('case " $* " in *" merge-tree "*) exit 128;; esac');
    expect(fx.run().status).toBe(0);
    expect(fx.readJson('probe').heads[0].base).toEqual({ state: 'unmeasured', why: 'rc-128' });
    fx.wrapGit('case " $* " in *" merge-tree "*) echo "not a tree"; exit 0;; esac');
    expect(fx.run().status).toBe(0);
    expect(fx.readJson('probe').heads[0].base).toEqual({ state: 'unmeasured', why: 'no-tree' });
  });

  it('a fetch past its deadline is fetch-timeout for the probe and fetch-failed for the lineage', { timeout: 60_000 }, () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.conf(fx.project, '');
    fx.wrapGit('case " $* " in *" fetch "*) sleep 30;; esac');
    expect(fx.run({ CCD_LAND_PROBE_FETCH_TIMEOUT: '1' }).status).toBe(0);
    expect(fx.readJson('probe')).toMatchObject({ state: 'unmeasured', why: 'fetch-timeout', heads: [], pairs: [] });
    expect(fx.readJson('main-health')).toMatchObject({ state: 'unmeasured', why: 'fetch-failed' });
    expect(fx.readJson('lane-a-proj-a-alpha.lineage')).toMatchObject({ state: 'unmeasured', why: 'fetch-failed', chain: [] });
  });

  it('every git child runs with no lazy fetch, no replace objects and a ceiling at its repository\'s parent', { timeout: 60_000 }, () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.conf(fx.project, '');
    const log = path.join(h.home, 'git-env.log');
    fx.wrapGit([
      'case " $* " in *" --no-optional-locks "*) k=project;; *) k=scratch;; esac',
      `printf '%s|%s|%s|%s\\n' "$k" "\${GIT_NO_LAZY_FETCH-unset}" "\${GIT_NO_REPLACE_OBJECTS-unset}" "\${GIT_CEILING_DIRECTORIES-unset}" >> '${log}'`,
    ].join('\n'));
    expect(fx.run().status).toBe(0);
    const rows = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => l.split('|'));
    expect(rows.length).toBeGreaterThan(5);
    const ceiling = { project: fs.realpathSync(path.join(h.home, 'projects')), scratch: fs.realpathSync(fx.tmp) };
    for (const [k, lazy, replace, ceil] of rows) {
      expect([lazy, replace]).toEqual(['1', '1']);
      expect(ceil, `${k} ceiling`).toBe(ceiling[k as 'project' | 'scratch']);
    }
    expect(new Set(rows.map((r) => r[0]))).toEqual(new Set(['project', 'scratch']));
  });

  /** A decoy repository, and every file in it with its size: what a stray write would change. */
  const decoyListing = (decoy: string): string => fs.readdirSync(decoy, { recursive: true, encoding: 'utf8' })
    .map((n) => { const st = fs.lstatSync(path.join(decoy, n)); return `${n} ${st.isFile() ? st.size : 'd'}`; }).sort().join('\n');

  it('a hostile GIT_DIR, GIT_OBJECT_DIRECTORY, GIT_CONFIG_PARAMETERS and GIT_INDEX_FILE change nothing: the measurement is right and the project and a decoy repository are untouched', { timeout: 90_000 }, () => {
    fx.addHead(1, { 'README.md': 'one\n' });
    fx.addHead(2, { 'docs/a.md': 'a\n' });
    fx.advanceMain({ 'README.md': 'main moved\n' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.conf(fx.project, 'lineage=on\n');
    const decoy = path.join(h.home, 'decoy');
    execFileSync('git', ['init', '-q', decoy], { env: { PATH: process.env['PATH'] ?? '', HOME: h.home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    const decoyBefore = decoyListing(decoy);
    const projectBefore = fx.snapshot();
    const indexFile = path.join(h.home, 'decoy-index');
    const hostile = {
      GIT_DIR: path.join(decoy, '.git'),
      GIT_OBJECT_DIRECTORY: path.join(decoy, '.git', 'objects'),
      // A config the probe's fetch cannot survive if it reaches it: no fetch over the file protocol.
      GIT_CONFIG_PARAMETERS: "'protocol.file.allow'='never'",
      GIT_INDEX_FILE: indexFile,
      GIT_WORK_TREE: decoy,
    };
    expect(fx.run(hostile).status).toBe(0);
    const p = fx.readJson('probe');
    expect(p.state).toBe('measured');
    expect(p.base.sha).toBe(fx.originMain());
    const by = Object.fromEntries(p.heads.map((x: any) => [x.pr, x]));
    expect(by[1].base).toEqual({ state: 'conflict', paths: ['README.md'], pathsCut: false });
    expect(by[2].base).toEqual({ state: 'clean' });
    expect(fx.readJson('lane-a-proj-a-alpha.lineage').state).toBe('measured');
    expect(fx.snapshot()).toEqual(projectBefore);
    expect(decoyListing(decoy)).toBe(decoyBefore);
    expect(fs.existsSync(indexFile)).toBe(false);
    expect(tmpLeft()).toEqual([]);
  });

  it('GH_REPO and GH_HOST never reach the forge CLI, and --repo still names the repository; neither does a GIT_* variable, and no prompt is possible', { timeout: 60_000 }, () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    expect(fx.run({ GH_REPO: 'evil/other', GH_HOST: 'evil.example', GIT_DIR: path.join(h.home, 'nowhere'), GIT_TERMINAL_PROMPT: '1' }).status).toBe(0);
    const calls = fx.ghCalls();
    expect(calls.filter((c) => c.startsWith(`pr list --repo ${fx.slug} `))).toHaveLength(1);
    expect(fx.readJson('probe').heads).toHaveLength(1);
    const envs = fx.ghEnvs();
    expect(envs.length).toBe(calls.length);
    expect(envs.length).toBeGreaterThan(1);
    for (const e of envs) {
      expect(e['GH_REPO']).toBeUndefined();
      expect(e['GH_HOST']).toBeUndefined();
      expect(e['GIT_DIR']).toBeUndefined();
      expect(e['GIT_TERMINAL_PROMPT']).toBe('0');
      expect(e['GH_PROMPT_DISABLED']).toBe('1');
    }
  });
});

describe('ccd-land-probe: a required set read whole, or not at all (final review t2m1, t2m2, M3)', () => {
  const GREEN_RUNS = [run(1, 'ci/ok', 'completed', 'success')];
  const tick = (): any => { expect(fx.run().status).toBe(0); return fx.readJson('main-health'); };

  it('bound_name survives a lone surrogate and holds a name to 120 bytes on a character boundary', () => {
    const [lone, long, plain, empty, multi] = pyCall([
      ['bound_name', ['ci/\ud800x']], ['bound_name', ['y'.repeat(130)]], ['bound_name', ['ci/test']], ['bound_name', ['']], ['bound_name', ['é'.repeat(100)]],
    ]);
    expect(lone).toBe('ci/?x');
    expect(long).toBe('y'.repeat(120));
    expect(plain).toBe('ci/test');
    expect(empty).toBeNull();
    expect(multi).toBe('é'.repeat(60));   // 2 bytes each: 120 bytes, never half a character
  });

  it('a required name with a lone surrogate is judged by its full name and does not stop the project', { timeout: 60_000 }, () => {
    const name = 'ci/\ud800';
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.stubChecks({ rules: [REQ_RULE([{ context: name }, { context: 'ci/ok' }])], runs: [run(1, name, 'completed', 'success'), ...GREEN_RUNS] });
    fx.conf(fx.project, 'lineage=on\n');
    const r = fx.run();
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('project-error');
    expect(fx.readJson('main-health')).toMatchObject({ state: 'green', required: [{ name: 'ci/ok', app: null }, { name: 'ci/?', app: null }] });
    expect(fx.exists('lane-a-proj-a-alpha.lineage')).toBe(true);
    expect(fx.exists('enabled')).toBe(true);
    expect(fx.readJson('probe').store.after).not.toBeNull();
  });

  it('a required entry the probe cannot read whole makes main-health unmeasured gh-failed, never a partial set that reads green', { timeout: 150_000 }, () => {
    fx.conf(fx.project, '');
    const shapes: Array<[string, unknown[], Record<string, unknown> | undefined]> = [
      ['a rule context that is a number', [REQ_RULE([{ context: 'ci/ok' }, { context: 5 as unknown as string }])], undefined],
      ['a rule context that is missing', [REQ_RULE([{ context: 'ci/ok' }, {} as unknown as { context: string }])], undefined],
      ['a rule entry that is not an object', [REQ_RULE([{ context: 'ci/ok' }, 'ci/other' as unknown as { context: string }])], undefined],
      ['a rule integration_id that is a string', [REQ_RULE([{ context: 'ci/ok' }, { context: 'ci/x', integration_id: '15368' as unknown as number }])], undefined],
      ['a rule integration_id that is a boolean', [REQ_RULE([{ context: 'ci/ok' }, { context: 'ci/x', integration_id: true as unknown as number }])], undefined],
      ['a rule integration_id that is a float', [REQ_RULE([{ context: 'ci/ok' }, { context: 'ci/x', integration_id: 1.5 as unknown as number }])], undefined],
      ['a contexts[] item that is a number', [REQ_RULE([{ context: 'ci/ok' }])], { protection: { required_status_checks: { contexts: ['ci/lint', 7], checks: [] } } }],
      ['a checks[] context that is null', [REQ_RULE([{ context: 'ci/ok' }])], { protection: { required_status_checks: { contexts: [], checks: [{ context: null, app_id: 1 }] } } }],
      ['a checks[] app_id that is a string', [REQ_RULE([{ context: 'ci/ok' }])], { protection: { required_status_checks: { contexts: [], checks: [{ context: 'ci/x', app_id: 'one' }] } } }],
    ];
    for (const [what, rules, branch] of shapes) {
      fx.stubChecks({ rules, ...(branch ? { branch } : {}), runs: GREEN_RUNS });
      expect(tick(), what).toMatchObject({ state: 'unmeasured', why: 'gh-failed', required: [], failing: [], pending: [] });
    }
    // The same entries well formed (an absent, a null or an integer App) read green: the refusals above are the shape's, not the stub's.
    fx.stubChecks({
      rules: [REQ_RULE([{ context: 'ci/ok' }, { context: 'ci/x', integration_id: null as unknown as number }])],
      branch: { protection: { required_status_checks: { contexts: ['ci/lint'], checks: [{ context: 'ci/y', app_id: -1 }] } } },
      runs: [...GREEN_RUNS, run(2, 'ci/x', 'completed', 'success'), run(3, 'ci/lint', 'completed', 'success'), run(4, 'ci/y', 'completed', 'success')],
    });
    expect(tick()).toMatchObject({ state: 'green' });
  });

  it('a failing name is red beside an app-conflict name, and beside an app-unverifiable name', () => {
    const conflict = judge(required(['ci/a', 1], ['ci/a', 2], ['ci/b', null]), [run(1, 'ci/a', 'completed', 'success', 1), run(2, 'ci/b', 'completed', 'failure')]);
    expect(conflict).toMatchObject({ state: 'red', failing: ['ci/b'], pending: ['ci/a'] });
    expect(conflict.why).toBeUndefined();
    const unverifiable = judge(required(['ci/a', 15368], ['ci/b', null]), [run(2, 'ci/b', 'completed', 'failure')], [status(1, 'ci/a', 'success')]);
    expect(unverifiable).toMatchObject({ state: 'red', failing: ['ci/b'], pending: ['ci/a'] });
    expect(unverifiable.why).toBeUndefined();
    // And without the failure each is the unmeasured it was: the red is what outranks, not a changed reading.
    expect(judge(required(['ci/a', 1], ['ci/a', 2]), [])).toMatchObject({ state: 'unmeasured', why: 'app-conflict' });
    expect(judge(required(['ci/a', 15368]), [], [status(1, 'ci/a', 'success')])).toMatchObject({ state: 'unmeasured', why: 'app-unverifiable' });
  });

  it('M3 a required name longer than 120 bytes matches its runs on the full name: a failing one is red, a passing one green, and the file holds 120 bytes', { timeout: 60_000 }, () => {
    const long = 'z'.repeat(130);
    fx.conf(fx.project, '');
    fx.stubChecks({ rules: [REQ_RULE([{ context: long }, { context: 'ci/ok' }])], runs: [run(1, long, 'completed', 'failure'), ...GREEN_RUNS] });
    expect(tick()).toMatchObject({ state: 'red', failing: ['z'.repeat(120)], pending: [] });
    fx.stubChecks({ rules: [REQ_RULE([{ context: long }, { context: 'ci/ok' }])], runs: [run(1, long, 'completed', 'success'), ...GREEN_RUNS] });
    const green = tick();
    expect(green).toMatchObject({ state: 'green', failing: [], pending: [] });
    expect(green.required.map((e: any) => e.name)).toEqual(['ci/ok', 'z'.repeat(120)]);
  });
});

describe('ccd-land-probe: the journal names every unmeasured outcome (final review M2)', () => {
  /** The journal lines (stderr) that match, whole: a doubled line shows as two. */
  const journal = (r: { stderr: string }, re: RegExp): string[] => r.stderr.split('\n').filter((l) => re.test(l));
  it('a failed list of open PRs leaves one line per file with the child\'s exit code, and never the child\'s output', () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.stubGh({ prList: 'fail' });
    fx.stubChecks({ rules: [REQ_RULE([{ context: 'ci/ok' }])], runs: [run(1, 'ci/ok', 'completed', 'success')] });
    fx.conf(fx.project, '');
    const r = fx.run();
    expect(r.status).toBe(0);
    expect(journal(r, /^land-probe: unmeasured proj-a probe gh-failed rc=1$/)).toHaveLength(1);
    expect(journal(r, /^land-probe: unmeasured /), 'one line for the one unmeasured outcome').toHaveLength(1);
    expect(r.stderr, 'the stub prints "stub: pr list failed" on its stderr: none of it reaches the journal').not.toContain('stub:');
    expect(r.stderr).not.toMatch(/^land-probe: unmeasured proj-a main-health /m);   // the PR list is not what main-health reads (R6)
  });

  it('a forge CLI that cannot be executed reads spawn-failed', () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    const r = fx.run({ CCD_LAND_PROBE_GH: path.join(h.home, 'no-such-gh') });
    expect(r.status).toBe(0);
    expect(journal(r, /^land-probe: unmeasured proj-a probe gh-failed spawn-failed$/)).toHaveLength(1);
    expect(journal(r, /^land-probe: unmeasured proj-a main-health gh-failed spawn-failed$/)).toHaveLength(1);
    expect(journal(r, /^land-probe: unmeasured /), 'one line per outcome, no more').toHaveLength(2);
    expect(fx.readJson('probe')).toMatchObject({ state: 'unmeasured', why: 'gh-failed' });
  });

  it('a failed fetch names the probe, the main-health and each lineage, with the fetch\'s exit code', () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.conf(fx.project, '');
    fs.rmSync(fx.origin, { recursive: true, force: true });
    const r = fx.run();
    expect(r.status).toBe(0);
    expect(journal(r, /^land-probe: unmeasured proj-a probe fetch-failed rc=\d+$/)).toHaveLength(1);
    expect(journal(r, /^land-probe: unmeasured proj-a main-health fetch-failed rc=\d+$/)).toHaveLength(1);
    expect(journal(r, /^land-probe: unmeasured proj-a lane-a-proj-a-alpha\.lineage fetch-failed$/)).toHaveLength(1);
    expect(journal(r, /^land-probe: unmeasured /), 'one line per outcome, no more').toHaveLength(3);
  });

  it('a main-health that could not be read says which read, by its exit code', () => {
    fx.stubChecks({ rules: 'fail', runs: [] });
    fx.conf(fx.project, '');
    const r = fx.run();
    expect(journal(r, /^land-probe: unmeasured proj-a main-health gh-failed rc=1$/)).toHaveLength(1);
    expect(journal(r, /^land-probe: unmeasured /), 'one line per outcome, no more').toHaveLength(1);
  });
});

describe('ccd-land-probe: the closing probe rewrite is unconditional (final review I1, ruling R7)', () => {
  it('a failed tick still closes its store and scratch figures, and keeps its first write\'s time, why and shape', () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    fs.rmSync(fx.origin, { recursive: true, force: true });
    expect(fx.run().status).toBe(0);
    const p = fx.readJson('probe');
    expect(p).toMatchObject({ state: 'unmeasured', why: 'fetch-failed', heads: [], pairs: [], base: null });
    expect(p.store.after).not.toBeNull();
    expect(p.store.after.count).toBe(p.store.before.count);
    expect(p.scratch.sizeKiB).toEqual(expect.any(Number));
    expect(p.at <= fx.readJson('main-health').at, 'the probe is stamped when its tick started, before the main-health beside it').toBe(true);
  });

  it('an exception after the first write is logged, closes the record with what was measured, and does not stop the next project', { timeout: 90_000 }, () => {
    const b = makeLandFixture(h, { project: 'proj-b', slug: 'o/r2' });
    fx.addHead(1, { 'a.txt': 'a\n' });
    b.addHead(1, { 'b.txt': 'b\n' });
    fx.conf('proj-a', 'lineage=on\n');
    fx.conf('proj-b', '');
    const r = fx.runPatched('def bad(slug, *a):\n    if slug == "o/r":\n        raise RuntimeError("planted")\n    return orig(slug, *a)\norig = ns["read_checks"]\nns["read_checks"] = bad');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('project-error proj-a: RuntimeError');
    const p = fx.readJson('probe');
    expect(p).toMatchObject({ state: 'measured' });
    expect(p.heads).toHaveLength(1);
    expect(p.store.after).not.toBeNull();
    expect(p.scratch.sizeKiB).toBeGreaterThan(0);
    expect(fx.exists('main-health')).toBe(false);   // the raise came before it
    expect(b.readJson('main-health')).toMatchObject({ project: 'proj-b' });
    expect(b.readJson('probe').store.after).not.toBeNull();
    expect(tmpLeft()).toEqual([]);
  });

  it('a figure that cannot be measured stays null in a closed record', { timeout: 60_000 }, () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    // count-objects answers nothing: both store readings and nothing else are null.
    fx.wrapGit('case " $* " in *" count-objects "*) exit 3;; esac');
    expect(fx.run().status).toBe(0);
    const p = fx.readJson('probe');
    expect(p).toMatchObject({ state: 'measured' });
    expect(p.store).toEqual({ before: { count: null, size: null, inPack: null, packs: null }, after: { count: null, size: null, inPack: null, packs: null } });
    expect(p.scratch.sizeKiB).toBeGreaterThan(0);
  });
});

describe('ccd-land-probe: the rules read, whole (fix round 1, review 1109 F1)', () => {
  it('a required_status_checks rule that is only on the second page is read: its failing check is red, never green', { timeout: 60_000 }, () => {
    // The stub pages this endpoint by two, as the forge does by thirty, and answers its first page alone to a read
    // without --paginate. The required rule is the third rule, so it is on page 2.
    fx.stubChecks({
      rules: [{ type: 'pull_request', parameters: {} }, { type: 'creation' }, REQ_RULE([{ context: 'ci/test' }])],
      runs: [run(1, 'ci/test', 'completed', 'failure')],
    });
    fx.conf(fx.project, '');
    expect(fx.run().status).toBe(0);
    expect(fx.readJson('main-health')).toMatchObject({ state: 'red', failing: ['ci/test'], required: [{ name: 'ci/test', app: null }] });
    expect(fx.ghCalls().filter((c) => c.includes('/rules/branches/'))).toEqual(['api --method GET repos/o/r/rules/branches/main --paginate']);
  });

  it('several pages of rules are one set: a rule on each page counts', { timeout: 60_000 }, () => {
    fx.stubChecks({
      rules: [REQ_RULE([{ context: 'ci/a' }]), { type: 'creation' }, { type: 'deletion' }, REQ_RULE([{ context: 'ci/b' }])],
      runs: [run(1, 'ci/a', 'completed', 'success'), run(2, 'ci/b', 'completed', 'success')],
    });
    fx.conf(fx.project, '');
    expect(fx.run().status).toBe(0);
    expect(fx.readJson('main-health')).toMatchObject({ state: 'green', required: [{ name: 'ci/a', app: null }, { name: 'ci/b', app: null }] });
  });
});

describe('ccd-land-probe: the exit paths leave nothing behind (fix round 1, review 1109 F4, A1, A2)', () => {
  /** Stop a fixture process group that is still alive: a mutant that breaks the probe's cleanup leaves one. */
  const reap = (pid: number): void => { if (!pidGone(pid)) { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } } };

  it('a SIGTERM during the closing rewrite leaves no scratch and no live child', { timeout: 60_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    const cnt = path.join(h.home, 'count-objects.n');
    const wrapperPid = path.join(h.home, 'closing-wrapper.pid');
    const sleepPid = path.join(h.home, 'closing-sleep.pid');
    // The first count-objects (store.before) passes; the second is the closing rewrite's, and it hangs (bounded: 100 s).
    fx.wrapGit([
      'case " $* " in *" count-objects "*)',
      `  n=$(cat '${cnt}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${cnt}'`,
      `  if [ $n -ge 2 ]; then echo $$ > '${wrapperPid}'; sleep 100 & echo $! > '${sleepPid}'; wait; fi;;`,
      'esac',
    ].join('\n'));
    const run = fx.start();
    let wp = 0; let sp = 0;
    try {
      expect(await until(() => fs.existsSync(sleepPid) && fs.readFileSync(sleepPid, 'utf8').trim() !== '', 30_000), 'the closing rewrite never started').toBe(true);
      wp = Number(fs.readFileSync(wrapperPid, 'utf8').trim());
      sp = Number(fs.readFileSync(sleepPid, 'utf8').trim());
      expect(tmpLeft(), 'the scratch stands while the rewrite runs').toHaveLength(1);
      run.child.kill('SIGTERM');
      const done = await run.done;
      expect(done.status).toBe(143);
      expect(tmpLeft()).toEqual([]);
      expect(await until(() => pidGone(wp) && pidGone(sp), 5000), 'the count-objects child outlived the probe').toBe(true);
      expect(landLeft(), 'a .lp.* temp file').toEqual([]);
      // What this tick measured stands, and the rewrite the signal landed in still ends: an interrupted record (R7),
      // never four null counts beside a measured scratch size (fix round 2, review 1125 item 1).
      const p = fx.readJson('probe');
      expect(p).toMatchObject({ state: 'measured' });
      expect(p.store.after).toBeNull();
      expect(p.scratch.sizeKiB).toBeNull();
      expect(p.store.before).not.toBeNull();
    } finally {
      run.child.kill('SIGKILL');
      reap(wp);
      reap(sp);
    }
  });

  it('SIGTERM and SIGINT are blocked from the fork until the child is recorded, and the child itself does not inherit the block', { timeout: 60_000 }, () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    const blk = path.join(h.home, 'sigblk.log');
    fx.wrapGit(`grep '^SigBlk' /proc/$$/status >> '${blk}'`);
    const maskLog = path.join(h.home, 'sigmask.log');
    // The mask at the moment Popen is called, from inside the probe's own process: the two signals, and only them.
    const r = fx.runPatched([
      'import json, signal',
      'real = ns["subprocess"].Popen',
      'def spy(*a, **k):',
      '    m = sorted(int(x) for x in signal.pthread_sigmask(signal.SIG_BLOCK, []))',
      `    open(${JSON.stringify(maskLog)}, "a").write(json.dumps(m, separators=(",", ":")) + "\\n")`,
      '    return real(*a, **k)',
      'ns["subprocess"].Popen = spy',
    ].join('\n'));
    expect(r.status).toBe(0);
    const masks = fs.readFileSync(maskLog, 'utf8').split('\n').filter(Boolean);
    expect(masks.length).toBeGreaterThan(5);
    expect(new Set(masks)).toEqual(new Set(['[2,15]']));
    const childMasks = fs.readFileSync(blk, 'utf8').split('\n').filter(Boolean);
    expect(childMasks.length).toBeGreaterThan(5);
    // Bit n-1 is signal n: SIGINT (2) is 0x2, SIGTERM (15) is 0x4000. (The shell may hold SIGCHLD itself while it forks.)
    for (const l of childMasks) expect(Number.parseInt(l.split('\t')[1]!, 16) & 0x4002, l).toBe(0);
  });

  it('a scratch that cannot get its sentinel removes the directory it made, and the old records become unmeasured', { timeout: 90_000 }, () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.stubChecks({ rules: [REQ_RULE([{ context: 'ci/test' }])], runs: [run(1, 'ci/test', 'completed', 'success')] });
    fx.conf(fx.project, 'lineage=on\n');
    expect(fx.run().status).toBe(0);
    expect(fx.readJson('probe').state).toBe('measured');
    expect(fx.readJson('main-health').state).toBe('green');
    expect(fx.readJson('lane-a-proj-a-alpha.lineage').state).toBe('measured');
    // The sentinel's open fails (ENOSPC) after mkdtemp made the directory.
    const r = fx.runPatched([
      'real = ns["os"].open',
      'def bad(p, *a, **k):',
      '    if str(p).endswith(".ccd-land-probe-scratch"):',
      '        raise OSError(28, "no space")',
      '    return real(p, *a, **k)',
      'ns["os"].open = bad',
    ].join('\n'));
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('project-error proj-a: OSError');
    expect(tmpLeft(), 'the directory mkdtemp made').toEqual([]);
    // An exception before the first write must not leave the old files standing as this tick's.
    expect(fx.readJson('probe')).toMatchObject({ state: 'unmeasured', why: 'fetch-failed', heads: [], pairs: [] });
    expect(fx.readJson('main-health')).toMatchObject({ state: 'unmeasured', why: 'fetch-failed', required: [] });
    expect(fx.readJson('lane-a-proj-a-alpha.lineage')).toMatchObject({ state: 'unmeasured', why: 'fetch-failed', chain: [] });
  });
});

describe('ccd-land-probe: a signal is recorded where it lands and raised only at a checkpoint (fix round 2, review 1125 items 1-4)', () => {
  // Each case sends the probe a SIGTERM at one named point (CCD_LAND_PROBE_SELFSIGNAL, test-only) and ends with the
  // ruling's four: no scratch, no .lp.* file, no live child, exit 143. Each has a single project, so each also holds the
  // checkpoint after the projects loop. The git wrapper records every git child's pid (and the pids it starts), the
  // stub forge its own.
  let pidLog = '';
  const trackGit = (body = ''): void => {
    pidLog = path.join(h.home, 'git-pids');
    fx.wrapGit(`echo $$ >> '${pidLog}'\n${body}`);
  };
  const childPids = (): number[] =>
    [...(fs.existsSync(pidLog) ? fs.readFileSync(pidLog, 'utf8').split('\n').filter(Boolean).map(Number) : []), ...fx.ghPids()];
  /** Stop what a mutant may leave behind: each recorded pid leads its own process group. */
  const reapAll = (): void => {
    for (const pid of childPids()) if (!pidGone(pid)) { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
  };
  beforeEach(() => { pidLog = ''; });
  afterEach(() => reapAll());
  type RunLike = { status: number | null; stderr: string };
  const SIG = (point: string): NodeJS.ProcessEnv => ({ CCD_LAND_PROBE_SELFSIGNAL: point });
  /** The ruling's four, and (point given) the named point fired: the self-signal says so in the journal. */
  async function endsClean(r: RunLike, point?: string): Promise<void> {
    if (point !== undefined) expect(r.stderr).toContain(`test-only self-signal at ${point}`);
    expect(r.status).toBe(143);
    expect(tmpLeft(), 'a scratch').toEqual([]);
    expect(landLeft(), 'a .lp.* temp file').toEqual([]);
    const pids = childPids();
    expect(await until(() => pids.every(pidGone), 5000), `a live child among ${pids.join(',')}`).toBe(true);
  }

  it('a SIGTERM in the closing path\'s except body, at its log (A1b), still removes the scratch', { timeout: 60_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    trackGit();
    // The closing rewrite raises, so its except body runs; the signal lands at that body's log.
    const r = fx.runPatched('def bad(*a):\n    raise RuntimeError("planted")\nns["scratch_kib"] = bad', SIG('except-log'));
    expect(r.stderr).toContain('project-error proj-a: the closing probe rewrite stopped (RuntimeError)');
    await endsClean(r, 'except-log');
  });

  it('a SIGTERM right after mkdtemp (A4a) leaves no directory', { timeout: 60_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    trackGit();
    const r = fx.run(SIG('mkdtemp'));
    await endsClean(r, 'mkdtemp');
  });

  it('a SIGTERM right after mkstemp (A4c) leaves no temp file, and the record is an interrupted one', { timeout: 60_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');   // lineage off: the first write is the probe's own, while the scratch stands
    trackGit();
    const r = fx.run(SIG('mkstemp'));
    await endsClean(r, 'mkstemp');
    const p = fx.readJson('probe');
    expect(p).toMatchObject({ state: 'measured' });
    expect(p.store.after).toBeNull();
    expect(p.scratch.sizeKiB).toBeNull();
    // No child is started once the signal is recorded: the first forge read was refused, and its checkpoint raised.
    expect(fx.ghCalls().filter((c) => c.startsWith('api'))).toEqual([]);
    expect(fx.exists('main-health')).toBe(false);
  });

  it('a SIGTERM during the before-first-write fallback lets it finish its records, then ends the tick', { timeout: 90_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.conf(fx.project, 'lineage=on\n');
    expect(fx.run().status).toBe(0);
    expect(fx.readJson('lane-a-proj-a-alpha.lineage').state).toBe('measured');
    trackGit();
    // An exception before the first write starts the fallback; the signal lands as it builds main-health.
    const r = fx.runPatched([
      'import os, signal',
      'def bad(*a):',
      '    raise RuntimeError("planted")',
      'ns["fetch_into_scratch"] = bad',
      'orig = ns["unmeasured_health"]',
      'def health(*a):',
      '    os.kill(os.getpid(), signal.SIGTERM)',
      '    return orig(*a)',
      'ns["unmeasured_health"] = health',
    ].join('\n'));
    await endsClean(r);
    expect(fx.readJson('main-health')).toMatchObject({ state: 'unmeasured', why: 'fetch-failed' });
    // The fallback's lineage pass ran to its end: the row's read was refused (no child after the signal), so its old
    // file is rewritten unmeasured with an unknown tip, never left standing as this tick's.
    expect(fx.readJson('lane-a-proj-a-alpha.lineage')).toMatchObject({ state: 'unmeasured', why: 'fetch-failed', tip: null });
  });

  it('an exception that follows a recorded signal is an interrupted tick: no fallback runs, and the old records stand', { timeout: 90_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    expect(fx.run().status).toBe(0);
    const before = fx.readJson('probe');
    trackGit();
    // The signal is recorded inside the scratch's making; the exception is raised before the next checkpoint.
    const r = fx.runPatched([
      'import os, signal',
      'orig = ns["make_scratch"]',
      'def bad():',
      '    d = orig()',
      '    os.kill(os.getpid(), signal.SIGTERM)',
      '    ns["SCRATCH"] = d',
      '    raise RuntimeError("planted")',
      'ns["make_scratch"] = bad',
    ].join('\n'));
    await endsClean(r);
    expect(r.stderr).not.toContain('unmeasured proj-a probe');
    expect(fx.readJson('probe')).toEqual(before);
  });

  it('a SIGTERM inside the stale sweep\'s removal (A4b) removes the stale scratch entirely, and nothing is measured or written', { timeout: 60_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, 'lineage=on\n');
    trackGit();
    // An `enabled` an earlier tick wrote: the checkpoint before the pre-pass raises, so this tick writes no fresh one.
    fs.mkdirSync(fx.landDir, { recursive: true });
    const oldEnabled = JSON.stringify({ v: 1, project: fx.project, at: '2020-01-01T00:00:00Z' }) + '\n';
    fs.writeFileSync(path.join(fx.landDir, 'enabled'), oldEnabled);
    const stale = path.join(fx.tmp, 'ccd-land-probe.stale');
    fs.mkdirSync(path.join(stale, 'objects', 'pack'), { recursive: true });
    fs.writeFileSync(path.join(stale, '.ccd-land-probe-scratch'), 's\n');
    for (const n of ['a', 'b', 'c', 'd']) fs.writeFileSync(path.join(stale, 'objects', 'pack', n), n);
    const old = new Date(Date.now() - 2 * 3600_000);
    fs.utimesSync(stale, old, old);
    // The signal lands INSIDE rmtree: right after the first unlink it makes (shutil calls os.unlink at call time).
    const marker = path.join(h.home, 'unlink-signal');
    const r = fx.runPatched([
      'import os, signal',
      'real_unlink = os.unlink',
      'armed = [False]',
      'def spy(*a, **k):',
      '    real_unlink(*a, **k)',
      '    if armed[0]:',
      '        armed[0] = False',
      `        open(${JSON.stringify(marker)}, "w").write(str(a[0]))`,
      '        os.kill(os.getpid(), signal.SIGTERM)',
      'os.unlink = spy',
      'real_sweep = ns["clear_stale_scratch"]',
      'def sweep():',
      '    armed[0] = True',
      '    try:',
      '        real_sweep()',
      '    finally:',
      '        armed[0] = False',
      'ns["clear_stale_scratch"] = sweep',
    ].join('\n'));
    expect(fs.existsSync(marker), 'the signal was sent inside the removal').toBe(true);
    expect(fs.existsSync(stale), 'the stale scratch, or what is left of it').toBe(false);
    expect(r.stderr).toContain('cleared a stale scratch');
    await endsClean(r);
    // The checkpoint before the pre-pass raised: no enabled written, nothing measured.
    expect(fs.readFileSync(path.join(fx.landDir, 'enabled'), 'utf8')).toBe(oldEnabled);
    expect(fx.exists('probe')).toBe(false);
    expect(childPids()).toEqual([]);
  });

  it('a second SIGTERM at the handler\'s kill of the child in flight (A2): the handler kills it, and nothing else has to', { timeout: 60_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    // The fetch starts a helper, then signals the probe itself; the handler sends the second signal at its killpg.
    trackGit([
      'case " $* " in *" fetch "*)',
      `  sleep 100 & echo $! >> '${path.join(h.home, 'git-pids')}'`,
      '  kill -TERM $PPID; wait;;',
      'esac',
    ].join('\n'));
    // Every later kill of a child (a deadline's, the closing path's kill_inflight) goes through kill_group: it must
    // never be needed, because the handler's own killpg already ended the fetch.
    const killed = path.join(h.home, 'kill-group.log');
    const t0 = Date.now();
    const r = fx.runPatched([
      'real_kg = ns["kill_group"]',
      'def kg(proc):',
      `    open(${JSON.stringify(killed)}, "a").write(str(proc.pid) + "\\n")`,
      '    real_kg(proc)',
      'ns["kill_group"] = kg',
    ].join('\n'), SIG('killpg'));
    expect(Date.now() - t0, 'the fetch was killed, not waited out').toBeLessThan(30_000);
    expect(fs.existsSync(killed) ? fs.readFileSync(killed, 'utf8') : '', 'a kill the handler should have made').toBe('');
    await endsClean(r, 'killpg');
    expect(childPids().length).toBeGreaterThanOrEqual(2);
  });

  it('a SIGTERM during a merge-tree ends the tick at that child: the killed merge is never written as a measurement', { timeout: 60_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    trackGit([
      'case " $* " in *" merge-tree "*)',
      `  sleep 100 & echo $! >> '${path.join(h.home, 'git-pids')}'`,
      '  kill -TERM $PPID; wait;;',
      'esac',
    ].join('\n'));
    const r = fx.run();
    await endsClean(r);
    expect(fx.exists('probe'), 'a probe written from a killed merge-tree').toBe(false);
  });

  it('a signal in one project\'s closing path ends the tick before the next project is started', { timeout: 90_000 }, async () => {
    const b = makeLandFixture(h, { project: 'proj-b', slug: 'o/r2' });
    fx.addHead(1, { 'a.txt': 'a\n' });
    b.addHead(1, { 'b.txt': 'b\n' });
    fx.conf('proj-a', '');
    fx.conf('proj-b', '');
    trackGit();
    const r = fx.runPatched('def bad(*a):\n    raise RuntimeError("planted")\nns["scratch_kib"] = bad', SIG('except-log'));
    await endsClean(r, 'except-log');
    expect(fx.readJson('probe').project).toBe('proj-a');
    expect(fs.existsSync(b.landDir), 'proj-b was started').toBe(false);
    expect(fx.ghCalls().filter((c) => c.includes('o/r2'))).toEqual([]);
  });

  it('a closing path that raises does not leave a later signal unraisable (CLOSING is let go in a finally)', { timeout: 90_000 }, async () => {
    const b = makeLandFixture(h, { project: 'proj-b', slug: 'o/r2' });
    fx.addHead(1, { 'a.txt': 'a\n' });
    b.addHead(1, { 'b.txt': 'b\n' });
    fx.conf('proj-a', '');
    fx.conf('proj-b', '');
    trackGit();
    // proj-a's closing path raises after it removed its scratch; proj-b is then signalled as its measuring starts.
    const r = fx.runPatched([
      'import os, signal',
      'real_rm = ns["remove_scratch"]',
      'once = [True]',
      'def rm(path):',
      '    real_rm(path)',
      '    if once[0]:',
      '        once[0] = False',
      '        raise RuntimeError("planted")',
      'ns["remove_scratch"] = rm',
      'real_heads = ns["open_heads"]',
      'def heads(slug, base):',
      '    if slug == "o/r2":',
      '        os.kill(os.getpid(), signal.SIGTERM)',
      '    return real_heads(slug, base)',
      'ns["open_heads"] = heads',
    ].join('\n'));
    expect(r.stderr).toContain('project-error proj-a: RuntimeError');
    await endsClean(r);
    // The checkpoint after proj-b's refused forge read raised: nothing of proj-b was written.
    expect(b.exists('probe'), 'proj-b measured on with its checkpoints dead').toBe(false);
  });

  it('a signal that kills the fallback\'s own read of a row leaves that row undecided: its old lineage is rewritten unmeasured, never pruned (review 1140 F1)', { timeout: 90_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.conf(fx.project, 'lineage=on\n');
    expect(fx.run().status).toBe(0);
    expect(fx.readJson('lane-a-proj-a-alpha.lineage').state).toBe('measured');
    // Only the fallback reads refs/heads/ws/alpha in this run (the measuring path raises before its lineage pass), so
    // the wrapper needs no marker: on that read it starts a helper and signals the probe, whose handler kills the read.
    trackGit([
      'case " $* " in *"refs/heads/ws/alpha"*)',
      `  sleep 100 & echo $! >> '${path.join(h.home, 'git-pids')}'`,
      '  kill -TERM $PPID; wait;;',
      'esac',
    ].join('\n'));
    const r = fx.runPatched('def bad(*a):\n    raise RuntimeError("planted")\nns["fetch_into_scratch"] = bad');
    await endsClean(r);
    expect(fx.readJson('lane-a-proj-a-alpha.lineage')).toMatchObject({ state: 'unmeasured', why: 'fetch-failed', tip: null, chain: [] });
  });

  it('a signal after the last checkpoint is held, and still sets the exit status', { timeout: 60_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    trackGit();
    const r = fx.run(SIG('exit'));
    await endsClean(r, 'exit');
    expect(fx.readJson('probe')).toMatchObject({ state: 'measured' });
  });

  it('a SIGTERM between the fork and the record of the child (F1) is held to the unblock, and kills that child', { timeout: 120_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    // The first child (store.before's count-objects) would hang for its whole 60 s deadline unless it is killed.
    trackGit([
      'case " $* " in *" count-objects "*)',
      `  sleep 100 & echo $! >> '${path.join(h.home, 'git-pids')}'; wait;;`,
      'esac',
    ].join('\n'));
    const t0 = Date.now();
    const r = fx.run({ ...SIG('spawn'), CCD_LAND_PROBE_GIT_TIMEOUT: '60' });
    expect(Date.now() - t0, 'the handler found no child to kill, and the deadline ended it').toBeLessThan(30_000);
    await endsClean(r, 'spawn');
    expect(fx.exists('probe')).toBe(false);
  });

  // A popen spy (runPatched) that hands the forge's `pr list` child a preexec of its own, around the probe's.
  const prListPreexec = (body: string): string => [
    'import os, signal',
    'real = ns["subprocess"].Popen',
    'def spy(argv, *a, **k):',
    '    if argv[1:3] == ["pr", "list"]:',
    '        mine = k["preexec_fn"]',
    body,
    '    return real(argv, *a, **k)',
    'ns["subprocess"].Popen = spy',
  ].join('\n');

  it('the forked child resets SIGTERM and SIGINT to their defaults before it unblocks them (A6): a signal held for it kills it', { timeout: 90_000 }, () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    for (const [name, rc] of [['SIGTERM', -15], ['SIGINT', -2]] as const) {
      // The signal is sent to the child before the probe's preexec runs, so it is pending under the inherited mask;
      // the probe's preexec must deliver it to the default action, never to the parent's handler.
      const r = fx.runPatched(prListPreexec([
        '        def pre():',
        `            os.kill(os.getpid(), signal.${name})`,
        '            mine()',
        '        k["preexec_fn"] = pre',
      ].join('\n')));
      expect(r.status, name).toBe(0);
      expect(r.stderr, name).toContain(`unmeasured proj-a probe gh-failed rc=${rc}`);
      expect(fx.readJson('probe'), name).toMatchObject({ state: 'unmeasured', why: 'gh-failed' });
    }
  });

  it('a preexec that fails is a spawn failure (A6): the forge child reads spawn-failed, and the project goes on', { timeout: 90_000 }, () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    const r = fx.runPatched(prListPreexec([
      '        def pre():',
      '            raise RuntimeError("planted")',
      '        k["preexec_fn"] = pre',
    ].join('\n')));
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('unmeasured proj-a probe gh-failed spawn-failed');
    expect(r.stderr).not.toContain('project-error');
    expect(fx.readJson('probe')).toMatchObject({ state: 'unmeasured', why: 'gh-failed' });
    expect(fx.readJson('main-health').project).toBe('proj-a');   // the base was still fetched, and its checks read
  });

  it('the before-first-write fallback kills the child in flight before it starts one of its own (A3)', { timeout: 90_000 }, async () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');   // so the fallback's lineage pass starts a git child
    fx.conf(fx.project, 'lineage=on\n');
    const sleepPid = path.join(h.home, 'inflight.pid');
    const seen = path.join(h.home, 'inflight-at-fallback.log');
    // The fallback's first child records whether the in-flight child is still there when it starts.
    trackGit([
      'case " $* " in *"refs/heads/ws/alpha"*)',
      `  p=$(cat '${sleepPid}'); [ -e /proc/$p ] && echo alive >> '${seen}';;`,
      'esac',
    ].join('\n'));
    // An exception that leaves a child in flight (CHILD set, never reaped), before the first write.
    const r = fx.runPatched([
      'def bad(*a):',
      '    sp = ns["subprocess"]',
      '    proc = sp.Popen(["sleep", "60"], stdin=sp.DEVNULL, stdout=sp.PIPE, start_new_session=True)',
      `    open(${JSON.stringify(sleepPid)}, "w").write(str(proc.pid))`,
      '    ns["CHILD"] = proc',
      '    raise RuntimeError("planted")',
      'ns["fetch_into_scratch"] = bad',
    ].join('\n'));
    const pid = Number(fs.readFileSync(sleepPid, 'utf8').trim());
    try {
      expect(r.status).toBe(0);
      expect(r.stderr).toContain('project-error proj-a: RuntimeError');
      expect(fx.readJson('lane-a-proj-a-alpha.lineage')).toMatchObject({ state: 'unmeasured', why: 'fetch-failed' });
      expect(fs.existsSync(seen) ? fs.readFileSync(seen, 'utf8') : '', 'the in-flight child at the fallback\'s first child').toBe('');
      expect(await until(() => pidGone(pid), 5000), 'the in-flight child outlived the probe').toBe(true);
    } finally {
      if (!pidGone(pid)) { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }
    }
  });
});

describe('ccd-land-probe: only rc 0 and rc 1 decide a row (fix round 3, review 1140 F1)', () => {
  const ALPHA = 'lane-a-proj-a-alpha.lineage';
  /** A measured tick with one ws/ row, so the row has an old lineage file; then the wrapper is cleared again. */
  const measuredOnce = (): string => {
    fx.wrapGit('');
    expect(fx.run().status).toBe(0);
    expect(fx.readJson(ALPHA).state).toBe('measured');
    return fs.readFileSync(path.join(fx.landDir, ALPHA), 'utf8');
  };

  it('an unreadable answer (rc 128) or a read killed by its own SIGTERM (rc -15) leaves the row undecided: the old file stays on a measured base and is rewritten unmeasured on a failed fetch', { timeout: 120_000 }, () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.conf(fx.project, 'lineage=on\n');
    const answers: Array<[string, string]> = [['rc 128', 'exit 128'], ['rc -15', 'kill -TERM $$; sleep 5; exit 0']];
    for (const [name, act] of answers) {
      const old = measuredOnce();
      fx.wrapGit(`case " $* " in *"refs/heads/ws/alpha"*) ${act};; esac`);
      expect(fx.run().status, `${name}, measured base`).toBe(0);
      expect(fx.readJson('probe').state, name).toBe('measured');
      expect(fs.readFileSync(path.join(fx.landDir, ALPHA), 'utf8'), `${name}, measured base: the old file`).toBe(old);

      measuredOnce();
      fx.wrapGit(`case " $* " in *" fetch "*) exit 1;; *"refs/heads/ws/alpha"*) ${act};; esac`);
      const r = fx.run();
      expect(r.status, `${name}, failed fetch`).toBe(0);
      expect(fx.readJson('probe'), name).toMatchObject({ state: 'unmeasured', why: 'fetch-failed' });
      expect(fx.readJson(ALPHA), `${name}, failed fetch`).toMatchObject({ state: 'unmeasured', why: 'fetch-failed', tip: null, chain: [] });
    }
  });

  it('a ws/ row whose branch is missing (rc 1) is decided: it does not qualify, and its old file is pruned', { timeout: 90_000 }, () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.conf(fx.project, 'lineage=on\n');
    measuredOnce();
    fx.gitIn(fx.repo, 'branch', '-D', 'ws/alpha');
    expect(fx.run().status).toBe(0);
    expect(fx.readJson('probe').state).toBe('measured');
    expect(fx.exists(ALPHA), 'the old file of a row whose branch is gone').toBe(false);
  });

  /** One answer of the row's `rev-parse` that must leave it undecided: the old file byte-identical after a measured
   *  tick, and rewritten unmeasured with `tip: null` after a failed-fetch tick (review 1143 F7). */
  const undecidedEverywhere = (name: string, act: string): void => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.conf(fx.project, 'lineage=on\n');
    const old = measuredOnce();
    fx.wrapGit(`case " $* " in *"refs/heads/ws/alpha"*) ${act};; esac`);
    expect(fx.run().status, `${name}, measured base`).toBe(0);
    expect(fx.readJson('probe').state, name).toBe('measured');
    expect(fs.readFileSync(path.join(fx.landDir, ALPHA), 'utf8'), `${name}, measured base: the old file`).toBe(old);

    measuredOnce();
    fx.wrapGit(`case " $* " in *" fetch "*) exit 1;; *"refs/heads/ws/alpha"*) ${act};; esac`);
    expect(fx.run().status, `${name}, failed fetch`).toBe(0);
    expect(fx.readJson('probe'), name).toMatchObject({ state: 'unmeasured', why: 'fetch-failed' });
    expect(fx.readJson(ALPHA), `${name}, failed fetch`).toMatchObject({ state: 'unmeasured', why: 'fetch-failed', tip: null, chain: [] });
  };

  it('F7-a an answer of rc 0 that is not 40 hex leaves the row undecided: kept on a measured base, rewritten with tip null on a failed fetch (review 1143 F7)', { timeout: 120_000 }, () => {
    undecidedEverywhere('rc 0, not hex', 'echo not-a-sha; exit 0');
  });

  it('F7-b an answer of rc 2 leaves the row undecided: kept on a measured base, rewritten with tip null on a failed fetch (review 1143 F7)', { timeout: 120_000 }, () => {
    undecidedEverywhere('rc 2', 'exit 2');
  });
});

describe('ccd-land-probe: a registry the probe cannot read decides no row (fix round 4, review 1143 F5, F6)', () => {
  const ALPHA = 'lane-a-proj-a-alpha';
  const BETA = 'lane-a-proj-a-beta';
  const FAIL_FETCH = 'case " $* " in *" fetch "*) exit 1;; esac';
  const file = (id: string): string => path.join(fx.landDir, `${id}.lineage`);
  const bytes = (id: string): string => fs.readFileSync(file(id), 'utf8');
  /** The given ws/ rows, measured once so each has an old lineage file; the old bytes, by id. */
  const seeded = (ids: string[]): Record<string, string> => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    for (const id of ids) fx.addRow(id, `ws/${id.slice('lane-a-proj-a-'.length)}`);
    fx.conf(fx.project, 'lineage=on\n');
    expect(fx.run().status).toBe(0);
    const old: Record<string, string> = {};
    for (const id of ids) {
      expect(fx.readJson(`${id}.lineage`).state, id).toBe('measured');
      old[id] = bytes(id);
    }
    return old;
  };
  const unchanged = (old: Record<string, string>, what: string): void => {
    for (const [id, text] of Object.entries(old)) {
      expect(fs.existsSync(file(id)), `${what}: ${id}.lineage is still there`).toBe(true);
      expect(bytes(id), `${what}: ${id}.lineage is byte-identical`).toBe(text);
    }
  };
  const lines = (stderr: string): string[] => stderr.split('\n').filter(Boolean);
  /** The fixed skip line is said, and no line names a path, nor any of `ids`. */
  const said = (stderr: string, line: string, ids: string[], what: string): void => {
    expect(lines(stderr), `${what}: the skip line`).toContain(`land-probe: lineage-skip: ${line}`);
    for (const l of lines(stderr)) {
      expect(l, `${what}: a line names a path`).not.toContain(h.home);
      expect(l, `${what}: a line names a path`).not.toContain('.cc-sessions');
      for (const id of ids) expect(l, `${what}: a line names ${id}`).not.toContain(id);
    }
  };

  it('F5-a a registry that can be traversed but not listed (mode 0311) keeps every old lineage byte-identical, on a measured tick and on a failed fetch', { timeout: 120_000 }, () => {
    const old = seeded([ALPHA, BETA]);
    fs.chmodSync(fx.reg, 0o311);
    try {
      const m = fx.run();
      expect(m.status, 'measured tick').toBe(0);
      expect(fx.readJson('probe').state, 'measured tick').toBe('measured');
      unchanged(old, 'measured tick');
      said(m.stderr, 'the registry could not be listed', [ALPHA, BETA], 'measured tick');

      fx.wrapGit(FAIL_FETCH);
      const f = fx.run();
      expect(f.status, 'failed fetch').toBe(0);
      expect(fx.readJson('probe'), 'failed fetch').toMatchObject({ state: 'unmeasured', why: 'fetch-failed' });
      unchanged(old, 'failed fetch');
      said(f.stderr, 'the registry could not be listed', [ALPHA, BETA], 'failed fetch');
    } finally {
      fs.chmodSync(fx.reg, 0o755);
    }
  });

  it('F6-a a .branch that cannot be read (mode 000) holds its row: the old file is byte-identical on a measured tick and on a failed fetch, and the other row is measured', { timeout: 120_000 }, () => {
    const old = seeded([ALPHA, BETA]);
    const branch = path.join(fx.reg, `${ALPHA}.branch`);
    fs.chmodSync(branch, 0o000);
    try {
      const m = fx.run();
      expect(m.status, 'measured tick').toBe(0);
      unchanged({ [ALPHA]: old[ALPHA]! }, 'measured tick');
      expect(fx.readJson(`${BETA}.lineage`).state, 'the other row').toBe('measured');
      said(m.stderr, 'a registry row could not be read', [ALPHA], 'measured tick');

      fx.wrapGit(FAIL_FETCH);
      const f = fx.run();
      expect(f.status, 'failed fetch').toBe(0);
      unchanged({ [ALPHA]: old[ALPHA]! }, 'failed fetch');
      expect(fx.readJson(`${BETA}.lineage`), 'the other row').toMatchObject({ state: 'unmeasured', why: 'fetch-failed' });
      said(f.stderr, 'a registry row could not be read', [ALPHA], 'failed fetch');
    } finally {
      fs.chmodSync(branch, 0o644);
    }
  });

  it('F6-b a .branch holding two lines holds its row: the old file is byte-identical on a measured tick', { timeout: 90_000 }, () => {
    const old = seeded([ALPHA]);
    fs.writeFileSync(path.join(fx.reg, `${ALPHA}.branch`), 'ws/alpha\nws/other\n');
    const m = fx.run();
    expect(m.status).toBe(0);
    unchanged(old, 'measured tick');
    said(m.stderr, 'a registry row could not be read', [ALPHA], 'measured tick');
  });

  it('F6-c a .project that cannot be read (mode 000) holds its row: the old file is byte-identical on a measured tick', { timeout: 90_000 }, () => {
    const old = seeded([ALPHA]);
    const project = path.join(fx.reg, `${ALPHA}.project`);
    fs.chmodSync(project, 0o000);
    try {
      const m = fx.run();
      expect(m.status).toBe(0);
      unchanged(old, 'measured tick');
      said(m.stderr, 'a registry row could not be read', [ALPHA], 'measured tick');
    } finally {
      fs.chmodSync(project, 0o644);
    }
  });

  it('F6-d (control) a .branch that is absent is decided: the row has no branch, and its old file is pruned', { timeout: 90_000 }, () => {
    seeded([ALPHA]);
    fs.rmSync(path.join(fx.reg, `${ALPHA}.branch`));
    const m = fx.run();
    expect(m.status).toBe(0);
    expect(fx.exists(`${ALPHA}.lineage`), 'the old file of a row with no .branch').toBe(false);
    expect(m.stderr).not.toContain('lineage-skip');
  });
});

describe('ccd-land-probe: a failure never leaves an old record (fix round 1, review 1109 F6, A3, A5, A12)', () => {
  it('a fetch the project budget cut says budget in probe and main-health, and every old lineage becomes unmeasured', { timeout: 90_000 }, () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.addRow('lane-a-proj-a-beta', 'ws/beta');
    fx.stubChecks({ rules: [REQ_RULE([{ context: 'ci/test' }])], runs: [run(1, 'ci/test', 'completed', 'success')] });
    fx.conf(fx.project, '');
    expect(fx.run().status).toBe(0);
    for (const id of ['lane-a-proj-a-alpha', 'lane-a-proj-a-beta']) expect(fx.readJson(`${id}.lineage`).state, id).toBe('measured');
    expect(fx.readJson('main-health').state).toBe('green');
    fx.addRow('lane-a-proj-a-new', 'ws/new');   // a row with no old file: the failure must not invent one
    // The fetch outlives the whole project budget (bounded: 30 s), so every read after it has no time left.
    fx.wrapGit('case " $* " in *" fetch "*) sleep 30;; esac');
    const r = fx.run({ CCD_LAND_PROBE_BUDGET: '10' });
    expect(r.status).toBe(0);
    expect(fx.readJson('probe')).toMatchObject({ state: 'unmeasured', why: 'budget', heads: [], pairs: [] });
    expect(fx.readJson('main-health')).toMatchObject({ state: 'unmeasured', why: 'budget', required: [] });
    for (const id of ['lane-a-proj-a-alpha', 'lane-a-proj-a-beta']) {
      expect(fx.readJson(`${id}.lineage`), id).toMatchObject({ state: 'unmeasured', why: 'fetch-failed', chain: [] });
      // The budget is spent by the time the rows are read, so each row's local read is undecided: its tip is unknown
      // (null), never a sha (review 1125 F6; the decided row of a failed fetch keeps its tip: the failed-fetch case).
      expect(fx.readJson(`${id}.lineage`).tip, `${id} tip`).toBeNull();
    }
    expect(fx.exists('lane-a-proj-a-new.lineage'), 'no old file, so none is invented').toBe(false);
    expect(tmpLeft()).toEqual([]);
  });

  // A7 (review 1125): every child the budget can cut answers `budget`, not its call's own failure word.
  describe.each([
    ['the scratch\'s init', ' init ', 'init'],
    ['the project\'s ls-remote', ' ls-remote ', 'ls-remote'],
    ['the base rev-parse after the fetch', ' rev-parse --verify -q refs/probe/base', 'rev-parse'],
  ])('a budget that cuts %s', (_name, needle, sub) => {
    it('says budget in probe and main-health, and the lineage stays fetch-failed', { timeout: 60_000 }, () => {
      fx.addHead(1, { 'a.txt': 'a\n' });
      fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
      fx.conf(fx.project, '');
      expect(fx.run().status).toBe(0);
      expect(fx.readJson('probe').state).toBe('measured');
      // The child outlives the whole project budget (bounded: 30 s), so the budget cuts it mid-call.
      fx.wrapGit(`case " $* " in *"${needle}"*) sleep 30;; esac`);
      const r = fx.run({ CCD_LAND_PROBE_BUDGET: '10' });
      expect(r.status).toBe(0);
      expect(r.stderr).toContain(`unmeasured proj-a probe budget rc=none`);
      expect(fx.readJson('probe'), sub).toMatchObject({ state: 'unmeasured', why: 'budget', heads: [], pairs: [] });
      expect(fx.readJson('main-health'), sub).toMatchObject({ state: 'unmeasured', why: 'budget' });
      expect(fx.readJson('lane-a-proj-a-alpha.lineage'), sub).toMatchObject({ state: 'unmeasured', why: 'fetch-failed' });
      expect(tmpLeft()).toEqual([]);
    });
  });

  it('a merge-tree the project budget cut mid-call is unmeasured budget, not timeout (review 1125 A7)', { timeout: 60_000 }, () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, '');
    fx.wrapGit('case " $* " in *" merge-tree "*) sleep 30;; esac');
    expect(fx.run({ CCD_LAND_PROBE_BUDGET: '10' }).status).toBe(0);
    const p = fx.readJson('probe');
    expect(p.state).toBe('measured');
    expect(p.heads[0].base).toEqual({ state: 'unmeasured', why: 'budget' });
  });

  it('a conf whose base the key rule would refuse is an invalid conf: nothing is measured, enabled goes', () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, 'lineage=on\n');
    expect(fx.run().status).toBe(0);
    expect(fx.exists('enabled')).toBe(true);
    for (const base of ['core.hooksPath', 'refs/CORE.FSMONITOR']) {
      fx.conf(fx.project, `base=${base}\nlineage=on\n`);
      fs.rmSync(path.join(fx.landDir, 'probe'));
      const calls = fx.ghCalls().length;
      const r = fx.run();
      expect(r.status, base).toBe(0);
      expect(r.stderr, base).toContain('conf-invalid proj-a: bad-value');
      expect(fx.exists('enabled'), base).toBe(false);
      expect(fx.exists('probe'), `${base}: nothing was measured`).toBe(false);
      expect(fx.ghCalls().length, base).toBe(calls);
      fx.conf(fx.project, 'lineage=on\n');
      expect(fx.run().status).toBe(0);
    }
  });
});

describe('ccd-land-probe: the enabled mirror is reconciled before any project is measured (fix round 1, review 1109 item 4)', () => {
  it('a second project\'s enabled carries the tick\'s start, though the first project spent its whole budget', { timeout: 90_000 }, () => {
    const b = makeLandFixture(h, { project: 'proj-b', slug: 'o/r2' });
    for (let n = 1; n <= 3; n++) fx.addHead(n, { [`f${n}.txt`]: 'x\n' });
    b.addHead(1, { 'b.txt': 'b\n' });
    fx.conf('proj-a', 'lineage=on\n');
    fx.conf('proj-b', 'lineage=on\n');
    fx.wrapGit('case " $* " in *" merge-tree "*) sleep 6;; esac');
    const t0 = Date.now();
    expect(fx.run({ CCD_LAND_PROBE_BUDGET: '10' }).status).toBe(0);
    expect(fx.readJson('probe').elapsedMs, 'project a spent its budget').toBeGreaterThanOrEqual(8000);
    const bEnabled = Date.parse(b.readJson('enabled').at);
    expect(Date.parse(fx.readJson('enabled').at) - t0).toBeLessThan(5000);
    expect(bEnabled - t0, 'b\'s enabled is the tick start\'s, not the time after a').toBeLessThan(5000);
    expect(Date.parse(b.readJson('probe').at) - t0, 'b was really measured after a').toBeGreaterThanOrEqual(8000);
  });

  it('removal reaches every other case in the same pass: lineage=off, paused, not a checkout, and a directory with no conf', { timeout: 90_000 }, () => {
    const plant = (name: string): string => {
      const d = path.join(fx.reg, 'landing', name);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'enabled'), '{}\n');
      return path.join(d, 'enabled');
    };
    // A paused project (the plain one), a lineage=off project, a lineage=on project that is no checkout, and an orphan.
    const off = makeLandFixture(h, { project: 'proj-off', slug: 'o/off' });
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf('proj-a', 'lineage=on\n');
    fx.pause('project');
    fx.conf('proj-off', 'lineage=off\n');
    fx.conf('proj-nocheckout', 'lineage=on\n');
    const files = ['proj-a', 'proj-off', 'proj-nocheckout', 'orphan'].map(plant);
    expect(off.exists('enabled')).toBe(true);
    expect(fx.run().status).toBe(0);
    for (const f of files) expect(fs.existsSync(f), f).toBe(false);
  });
});

describe('ccd-land-probe: the pause read checks $REG/landing/ itself (fix round 2, review 1125 A10)', () => {
  it('a landing directory that is a symlink to an owned directory holding proj-a/paused is not read: the pause is not honoured, and nothing is measured', () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, 'lineage=on\n');
    const target = path.join(h.home, 'landing-target');
    fs.mkdirSync(path.join(target, 'proj-a'), { recursive: true });
    fs.writeFileSync(path.join(target, 'proj-a', 'paused'), '');
    fs.mkdirSync(fx.reg, { recursive: true });
    fs.symlinkSync(target, path.join(fx.reg, 'landing'));
    const r = fx.run();
    expect(r.status).toBe(0);
    // is_paused is false through a symlinked landing directory (a symlink is no directory this probe reads a marker
    // from), so the tick does not say `paused`; the project then stops at the directory check, and writes nothing.
    expect(r.stderr).not.toContain('paused proj-a');
    expect(r.stderr).toContain('skip landing: not a real directory owned by this user');
    expect(ls(path.join(target, 'proj-a'))).toEqual(['paused']);
  });
});

describe('ccd-land-probe: every removal of enabled checks $REG/landing/ itself (fix round 1, review 1109 A4)', () => {
  it('a landing directory that is a symlink to an owned directory keeps the enabled files in its target', () => {
    fx.addHead(1, { 'a.txt': 'a\n' });
    fx.conf(fx.project, 'lineage=off\n');
    const target = path.join(h.home, 'landing-target');
    const files = ['proj-a', 'orphan'].map((n) => {
      fs.mkdirSync(path.join(target, n), { recursive: true });
      const f = path.join(target, n, 'enabled');
      fs.writeFileSync(f, '{}\n');
      return f;
    });
    fs.mkdirSync(fx.reg, { recursive: true });
    fs.symlinkSync(target, path.join(fx.reg, 'landing'));
    expect(fx.run().status).toBe(0);
    for (const f of files) expect(fs.readFileSync(f, 'utf8'), f).toBe('{}\n');
    expect(ls(path.join(target, 'proj-a'))).toEqual(['enabled']);
  });
});

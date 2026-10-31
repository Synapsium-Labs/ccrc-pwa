// The contract between ccd-land-probe and the doctor's land-probe check (landing-order wave 3b, final review I1): the
// doctor is fed the landing directory the REAL probe wrote, not a record a test synthesized. The probe writes `probe`
// twice per tick (the second write closes its store and scratch figures, from a finally), a figure it cannot measure is
// null, and a tick that dies after the first write leaves a main-health from an earlier tick; the doctor must read each
// of those as what it is. Every probe spawn goes through the fixture's contained env (poison gh record asserted empty).
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { describeLinux } from './platformFixtures.js';
import { makeCcdHarness, ghPoisonAt, type CcdHarness } from './ccdWsHelpers.js';
import { makeLandFixture, type LandFixture } from './ccdLandProbeFixture.js';
import { installDoctorHooks, runDoctor, healthy, anyVerdictFor, lineFor } from './ccrc-doctorFixture.js';

removeTmpFixturesEachTest();
installDoctorHooks();

describeLinux('ccd-land-probe -> doctor: the records the probe writes are the records the doctor reads', () => {
  let h: CcdHarness | undefined;
  afterEach(() => {
    if (!h) return;
    const poison = ghPoisonAt(h.home);
    h.cleanup();
    h = undefined;
    expect(poison, 'the real gh was reached').toEqual([]);
  });

  /** One real tick over `projects` (each with two heads and green checks). */
  function realTick(projects: string[] = ['proj-a']): LandFixture[] {
    h = makeCcdHarness('land-probe-doctor');
    const fxs = projects.map((p, i) => makeLandFixture(h!, { project: p, slug: `o/r${i}` }));
    for (const fx of fxs) {
      fx.addHead(1, { 'a.txt': 'a\n' });
      fx.addHead(2, { 'b.txt': 'b\n' });
      fx.stubChecks({ rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci/test' }] } }], runs: [{ id: 1, name: 'ci/test', status: 'completed', conclusion: 'success' }] });
      fx.conf(fx.project, '');
    }
    return fxs;
  }

  /** A doctor box holding a copy of the probe's landing directory, with the confs that opt the projects in. */
  function doctorHome(fx: LandFixture, projects: string[] = ['proj-a']): string {
    const home = healthy('ccrc-land-probe-contract-');
    fs.mkdirSync(path.join(home, '.ccrc', 'landing'), { recursive: true });
    for (const p of projects) {
      fs.writeFileSync(path.join(home, '.ccrc', 'landing', `${p}.conf`), 'lineage=off\n');
      const old = new Date(Date.now() - 3600_000);
      fs.utimesSync(path.join(home, '.ccrc', 'landing', `${p}.conf`), old, old);
    }
    fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    fs.cpSync(path.join(fx.reg, 'landing'), path.join(home, '.cc-sessions', 'landing'), { recursive: true });
    return home;
  }
  const edit = (home: string, project: string, name: string, f: (doc: any) => void): void => {
    const p = path.join(home, '.cc-sessions', 'landing', project, name);
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    f(doc);
    fs.writeFileSync(p, JSON.stringify(doc));
  };
  const verdict = (home: string): string => anyVerdictFor(runDoctor(home).stdout, 'land-probe') ?? '';

  it('C1 a complete tick, as the probe wrote it, is a PASS', () => {
    const [fx] = realTick();
    expect(fx!.run().status).toBe(0);
    const probe = fx!.readJson('probe');
    expect(probe.store.after).not.toBeNull();
    expect(probe.scratch.sizeKiB).toBeGreaterThan(0);
    const home = doctorHome(fx!);
    expect(lineFor(runDoctor(home).stdout, 'land-probe')).toMatch(/^PASS land-probe: proj-a: 2 heads, 0 conflicting with main, main green; store \+0 objects, scratch [1-9][0-9]* KiB this tick$/);
  });

  it('C2 the interim probe (store.after and scratch null) is not unreadable: with a main-health beside it, the figures read unmeasured', () => {
    const [fx] = realTick();
    expect(fx!.run().status).toBe(0);
    const home = doctorHome(fx!);
    edit(home, 'proj-a', 'probe', (d) => { d.store.after = null; d.scratch.sizeKiB = null; });
    const v = verdict(home);
    expect(v).toBe('PASS land-probe: proj-a: 2 heads, 0 conflicting with main, main green; store not measured, scratch not measured this tick');
  });

  it('C3 the interim probe of a first tick, with no main-health yet, is a tick running: a SKIP, never land-probe-unreadable', () => {
    const [fx] = realTick();
    expect(fx!.run().status).toBe(0);
    const home = doctorHome(fx!);
    edit(home, 'proj-a', 'probe', (d) => { d.store.after = null; d.scratch.sizeKiB = null; });
    fs.rmSync(path.join(home, '.cc-sessions', 'landing', 'proj-a', 'main-health'));
    const v = verdict(home);
    expect(v).toMatch(/^SKIP land-probe: proj-a: a tick is running, so there is no reading yet/);
    expect(v).not.toContain('unreadable');
  });

  it('C4 null counts (count-objects timed out or the budget ran out) read as an unmeasured store, not as a malformed record', () => {
    const [fx] = realTick();
    expect(fx!.run().status).toBe(0);
    const nulls = { count: null, size: null, inPack: null, packs: null };
    const a = doctorHome(fx!);
    edit(a, 'proj-a', 'probe', (d) => { d.store.after = nulls; });
    expect(verdict(a)).toMatch(/^PASS land-probe: proj-a: 2 heads, .*; store not measured, scratch [0-9]+ KiB this tick$/);
    const b = doctorHome(fx!);
    edit(b, 'proj-a', 'probe', (d) => { d.store.before = nulls; d.store.after = nulls; d.scratch.sizeKiB = null; });
    expect(verdict(b)).toMatch(/^PASS land-probe: proj-a: 2 heads, .*; store not measured, scratch not measured this tick$/);
  });

  it('C5 a tick that raised after the first probe write still leaves a complete probe, and the doctor names the stale main-health', async () => {
    const [fa, fb] = realTick(['proj-a', 'proj-b']);
    expect(fa!.run().status).toBe(0);   // one whole tick: both projects, both main-health files
    await new Promise((r) => setTimeout(r, 1100));   // the next tick's times are a second later at least
    const r = fa!.runPatched([
      'orig = ns["read_checks"]',
      'def bad(slug, *a):',
      '    if slug == "o/r0":',
      '        raise RuntimeError("planted")',
      '    return orig(slug, *a)',
      'ns["read_checks"] = bad',
    ].join('\n'));
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('project-error proj-a: RuntimeError');   // logged, and the other project went on
    const probe = fa!.readJson('probe');
    expect(probe).toMatchObject({ state: 'measured', project: 'proj-a' });
    expect(probe.heads).toHaveLength(2);
    expect(probe.store.after).not.toBeNull();   // the closing rewrite ran from the finally
    expect(probe.scratch.sizeKiB).toBeGreaterThan(0);
    expect(Date.parse(fb!.readJson('main-health').at)).toBeGreaterThan(Date.parse(fa!.readJson('main-health').at));
    const home = doctorHome(fa!, ['proj-a', 'proj-b']);
    const v = verdict(home);
    expect(v).toMatch(/^WARN land-probe: land-probe-incomplete: proj-a: the main-health file is [0-9]+s older than the probe file, so the last tick wrote its probe and stopped before its main-health/);
    expect(v).not.toContain('proj-b');
    const out = runDoctor(home).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(out[i + 1]).toMatch(/^ {2}remedy: read why the tick stopped partway: journalctl --user -u ccd-land-probe\.service/);
  });
});

// `ccrc install`, part 6 of the ccrc-install-*.test.ts family (D-6767): the codex runtime, tier and usage steps and
// the cutover rehearsal. Shared fixtures and the original file header live in ccrc-installFixture.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync, lstatSync, readlinkSync, appendFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { describeLinux } from './platformFixtures.js';
import { verifyMarker } from '../../shared/mark.mjs';
import { codexRoster, plantSystemd, killLaneProcesses, spawnListener, managerCalls, spineRunCalls, ccrcFunction, freeLanes, portAccepts, laneAnswer, plantLaneAuth, laneUnits, registerLaneCleanup, codexAuthDir, authDirOf, plantForeignUsage, externalCodexRow, plantExternalLauncher, EXTERNAL_LAUNCHER, doctorClasses, stateCallsNaming, type LanePorts } from './codexLaneFixture.js';
import { here, treeFile, placed, freshBox, runInstall, read, dotCcrc, mtime, unitDir, systemctlCalls, READY, REPO_CCRC, runtimeDir, laneDir, generations, venvCalls, stateChanges, doctorCode, runtimePython, writeRuntimeFixture, plantRuntimeTemplate, codexBox, startLane, runStepHarness, FIXTURE_REQUIREMENT, runRuntimeStep, runTiersStep, runUsageStep, USAGE_DEGRADED, argvOf, usageEnables, usageRow, fleetBox, PROVISIONED_BOX_TOKEN, FLEET_BOX_CLASSES, expectFleetBoxClasses, plantFlippedLaneModels, type StepRun } from './ccrc-installFixture.js';

removeTmpFixturesEachTest();

describe('ccrc install: the codex runtime step, measured in isolation (_inst_codex_runtime)', () => {
  const G1 = 'gen-20260101T000000Z-1';
  const G2 = 'gen-20260101T000000Z-2';

  it('a server-role box: silent, and the builder is never run', () => {
    const r = runRuntimeStep({ role: 'server', after: G1 });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.calls).toEqual([]);
    expect(r.degraded).toEqual([]);
  });

  it('no codex lane in the roster: one line, and the builder is never run', () => {
    const r = runRuntimeStep({ lanes: [], after: G1 });
    expect(r.stdout).toBe('install: codex runtime: none — no codex lane in the roster\n');
    expect(r.calls).toEqual([]);
  });

  it('a roster that cannot be read is never "no codex lane": its own line, degraded, and nothing is built', () => {
    // Task 4's `_codex_lanes` answers rc 1 with `roster-invalid` there; the
    // `after` generation is the CONTROL — a step that read rc 1 as "none"
    // would say "none", and one that built anyway would name it.
    const r = runRuntimeStep({ lanesRc: 1, after: G1 });
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: /m);
    expect(r.stdout).toBe('install: codex runtime: NOT BUILT — $HOME/.ccrc/accounts.json could not be read as a roster (the ccrc codex: roster-invalid line above says why), so this step cannot tell whether any codex lane needs a runtime. This install continues. Fix the roster (ccrc wrappers prints the validator\'s sentence), then re-run: ccrc install\n');
    expect(r.calls).toEqual([]);
    expect(r.degraded).toEqual(['codex-runtime']);
  });

  // Review C2: `_codex_lanes` rc 2 is a missing jq (`cmd_install` probes
  // node and systemctl by name, never jq), and the roster it could not read
  // is VALID — `_inst_accounts_sh` validated it through node. So the step
  // names jq, never the roster.
  it('a missing jq (rc 2) is its own line, never "fix the roster": degraded, and nothing is built (review C2)', () => {
    const r = runRuntimeStep({ lanesRc: 2, after: G1 });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('install: codex runtime: NOT BUILT — jq is not on PATH (the ccrc codex: missing-dependency line above says so), so this step cannot read which roster lanes are codex lanes. This install continues. Install jq, then re-run: ccrc install\n');
    expect(r.calls).toEqual([]);
    expect(r.degraded).toEqual(['codex-runtime']);
  });

  // Ruling R33's line: said before every build, naming what the builder declares.
  const BUILDING = `install: codex runtime: building ${FIXTURE_REQUIREMENT} — pip may take minutes`;

  it('a build that produces a new generation says so, named by what ccgpt-runtime python resolves — never by parsing the builder', () => {
    const r = runRuntimeStep({ after: G2 });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`${BUILDING}\ninstall: codex runtime: ${G2} built, probed and current for 1 codex lane(s)\n`);
    expect(r.calls).toEqual(['python', 'build', 'python']);
    expect(r.degraded).toEqual([]);
  });

  it('says the build is running BEFORE the build starts, naming the requirement the builder declares, and the result line comes after it (ruling R33)', () => {
    // `merge` joins the step's stderr to its stdout, so the builder's own
    // `build running` line lands in order between the step's two lines. A
    // `building` line printed after the build returned would follow it.
    const r = runRuntimeStep({ after: G2, merge: true });
    expect(r.stdout.split('\n').filter(Boolean)).toEqual([
      BUILDING,
      'fixture ccgpt-runtime: build running',
      `install: codex runtime: ${G2} built, probed and current for 1 codex lane(s)`,
    ]);
  });

  it('a builder whose requirement line cannot be read still builds, and the building line says it could not be read rather than naming nothing', () => {
    const r = runRuntimeStep({ after: G2, requirement: null });
    expect(r.stdout.split('\n')[0]).toMatch(/^install: codex runtime: building \(the requirement \S+\/\.local\/bin\/ccgpt-runtime declares could not be read\) — pip may take minutes$/);
    expect(r.calls).toEqual(['python', 'build', 'python']);
    expect(r.degraded).toEqual([]);
  });

  it('a build that changed nothing says the runtime was re-measured current', () => {
    const r = runRuntimeStep({ lanes: ['codex-a', 'codex-b'], before: G1 });
    expect(r.stdout).toBe(`${BUILDING}\ninstall: codex runtime: ${G1} already current (requirement, probe and litellm version re-measured unchanged) for 2 codex lane(s)\n`);
  });

  it('a failed build DEGRADES: the builder\'s own sentence reaches stderr, the previous runtime is named as still current, and the step returns 0', () => {
    const r = runRuntimeStep({ before: G1, buildRc: 2 });
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/^ccgpt-runtime: build failed at probe: fixture refusal/m);
    expect(r.stdout).toBe(`${BUILDING}\ninstall: codex runtime: NOT BUILT — ccgpt-runtime build exited 2 (its reason is the ccgpt-runtime line on stderr); the previous runtime ${G1} stays current. This install continues. Re-run: ccgpt-runtime build\n`);
    expect(r.degraded).toEqual(['codex-runtime']);
  });

  it('a failed first build says there is no runtime at all', () => {
    const r = runRuntimeStep({ buildRc: 2 });
    expect(r.stdout).toMatch(/; there is no runtime at all, so no codex lane can start until a build passes\. This install continues\./);
    expect(r.degraded).toEqual(['codex-runtime']);
  });

  it('a build that exits 0 while nothing resolves is NOT a build — an overloaded success is refused', () => {
    const r = runRuntimeStep({});
    expect(r.stdout).toMatch(/^install: codex runtime: NOT BUILT — ccgpt-runtime build exited 0 but no runtime resolves \(ccgpt-runtime python answers nothing\)/m);
    expect(r.degraded).toEqual(['codex-runtime']);
  });

  it('a box with no builder on PATH degrades and names the missing file', () => {
    const r = runRuntimeStep({ builder: false });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^install: codex runtime: NOT BUILT — \S+\/\.local\/bin\/ccgpt-runtime is not on this box/m);
    // No builder, so nothing is building: the R33 line is never said.
    expect(r.stdout).not.toMatch(/: building /);
    expect(r.degraded).toEqual(['codex-runtime']);
  });
});

describe('ccrc install: the codex tier restart step, measured in isolation (_inst_codex_tiers)', () => {
  const LOCK_A = '_codex_lock codex-a';
  const LOCK_B = '_codex_lock codex-b';
  const UNLOCK_A = '_codex_unlock codex-a';
  const UNLOCK_B = '_codex_unlock codex-b';
  const A_L = '_codex_tier_ours codex-a litellm';
  const A_S = '_codex_tier_ours codex-a shim';
  const B_L = '_codex_tier_ours codex-b litellm';
  const B_S = '_codex_tier_ours codex-b shim';

  it('the isolation harness contains the user manager too: systemctl and systemd-run resolve to its wall, inside this HOME', () => {
    // `runStepHarness` runs with the caller's PATH, where both names resolve
    // to the REAL binaries on a Linux box. The wall's stubs must come first.
    const home = mkTmp('ccrc-codex-step-contained-');
    const r = runStepHarness(home, 'command -v systemctl; command -v systemd-run');
    expect(r.stdout).toBe(`${join(home, 'isolation-bin', 'systemctl')}\n${join(home, 'isolation-bin', 'systemd-run')}\n`);
  });

  it('a server-role box: silent, and the lane library is never asked', () => {
    const r = runTiersStep({ role: 'server', ours: { 'codex-a shim': 0 }, stale: { 'codex-a shim': 0 } });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.calls).toEqual([]);
  });

  it('no codex lane in the roster: one line', () => {
    const r = runTiersStep({ lanes: [] });
    expect(r.stdout).toBe('install: codex tiers: none — no codex lane in the roster\n');
    expect(r.calls).toEqual([]);
  });

  it('a roster that cannot be read is never "no codex lane": its own line, degraded, and no lane is asked', () => {
    const r = runTiersStep({ lanesRc: 1 });
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: /m);
    expect(r.stderr).toMatch(/^install: codex tiers: NOT measured — \$HOME\/\.ccrc\/accounts\.json could not be read as a roster \(the ccrc codex: roster-invalid line above says why\), so no codex lane's tiers were checked or restarted/m);
    expect(r.stdout).not.toMatch(/no codex lane in the roster/);
    expect(r.calls).toEqual([]);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a missing jq (rc 2) is its own line, never "fix the roster": degraded, and nothing is measured (review C2)', () => {
    const r = runTiersStep({ lanesRc: 2, ours: { 'codex-a litellm': 0 } });
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/^install: codex tiers: NOT measured — jq is not on PATH \(the ccrc codex: missing-dependency line above says so\), so no codex lane's tiers were checked or restarted; install jq, then re-run: ccrc install$/m);
    expect(r.stderr).not.toMatch(/^install: codex tiers: .*could not be read as a roster/m);
    expect(r.calls).toEqual([]);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a tier that is not running is never started, even when it would count as stale — a lazy lane stays lazy', () => {
    // `stale: 0` is the CONTROL: with the tiers reading not-stale, a step
    // that wrongly treated rc 1 as a candidate would stay green here.
    const r = runTiersStep({ stale: { 'codex-a litellm': 0, 'codex-a shim': 0 } });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, UNLOCK_A]);
    // Review round 1, item 3: the lock-wait line (R33's spirit) is printed
    // BEFORE every `_codex_lock`, even when it returns at once.
    expect(r.stdout).toBe('install: codex tiers: codex-a: waiting up to 31s for its lane lock\n'
      + 'install: codex tiers: 1 codex lane(s) — 0 restarted, 0 left as they were, 0 not restarted\n');
    expect(r.degraded).toEqual([]);
  });

  it('a tier whose port or unit answers as another lane is left alone, and said so', () => {
    const r = runTiersStep({ ours: { 'codex-a shim': 2 }, stale: { 'codex-a shim': 0 },
      oursWhy: { 'codex-a shim': 'listener-answers-other-lane' } });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, UNLOCK_A]);
    // Review A2: named in `_codex_foreign_what`'s words (the real helper),
    // with its remedy — never a "not this lane" sentence of the step's own.
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: left alone — port 45011 \(codex-a's shim tier\) is held by a listener that is not this lane's: it answers as another lane, and this step never stops what it cannot prove it started\. Stop whatever holds port 45011, or give codex-a other ports in ~\/\.ccrc\/accounts\.json\. \(read: ccrc codex status codex-a\)$/m);
    expect(r.stdout).toMatch(/^install: codex tiers: 1 codex lane\(s\) — 0 restarted, 1 left as they were, 0 not restarted$/m);
  });

  // Review A2/E2 (ruling PF-13): this lane's own crash-looping tier reads
  // `unit-unproven` between two restarts, so the gate says UNPROVEN, with
  // the retry, never "not this lane".
  it('a proven lane process whose port belongs to another process is left alone because restart cannot rebind, with its lane-stop remedy', () => {
    const r = runTiersStep({ ours: { 'codex-a shim': 2 }, stale: { 'codex-a shim': 0 },
      oursWhy: { 'codex-a shim': 'listener-other-process' } });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("codex-a shim: left alone — port 45011 (codex-a's shim tier) is held by a process that is not this lane's shim: pid ? is this lane's by its command line, and another process holds the port's listening socket");
    expect(r.stdout).toContain("another process owns its port, so restarting this proven lane process could not rebind it; stop this lane's process with: ccrc codex stop codex-a");
    expect(r.stdout).not.toContain('and this step never stops what it cannot prove it started');
  });

  it('a unit whose identity is only unproven is left alone, named as unproven with its retry — never "not this lane" (review A2)', () => {
    const r = runTiersStep({ ours: { 'codex-a shim': 2 }, stale: { 'codex-a shim': 0 },
      oursWhy: { 'codex-a shim': 'unit-unproven' } });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, UNLOCK_A]);
    expect(r.stdout).toContain('install: codex tiers: codex-a shim: left alone — the unit ccgpt-codex-a-shim.service is active, but its identity as codex-a\'s shim tier is unproven: '
      + 'a unit of that name is live with no process that proves this lane, and port 45011 does not answer, and this step never stops what it cannot prove it started. '
      + 'Re-run in a few seconds: this lane\'s own tier reads this way between two of its restarts, and proves itself once its process is back. '
      + 'If it still reads this way, \'systemctl --user status ccgpt-codex-a-shim.service\' shows what the unit runs. (read: ccrc codex status codex-a)\n');
    expect(r.stdout).not.toMatch(/not this lane/);
    expect(r.stdout).toMatch(/— 0 restarted, 1 left as they were, 0 not restarted$/m);
  });

  it('an identity answer the step cannot read is left alone too — the safe direction, with its own sentence', () => {
    const r = runTiersStep({ ours: { 'codex-a shim': 3 }, stale: { 'codex-a shim': 0 } });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, UNLOCK_A]);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: left alone — whether it is this lane's could not be measured, and this step never stops what it cannot prove it started/m);
    expect(r.stdout).not.toMatch(/codex-a shim: left alone — port /);
  });

  it('a tier of this lane\'s that is still STARTING (4) is never restarted, even when stale — it is named with its remedy', () => {
    // A 4 is ours, not foreign (a live handle proves the lane; the port does
    // not answer yet). `stale: 0` is the control: a step that treated 4 like
    // 0 would ask staleness and stop it mid-import.
    const r = runTiersStep({ ours: { 'codex-a shim': 4 }, stale: { 'codex-a shim': 0 } });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, UNLOCK_A]);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: left alone — it is this lane's own tier and still starting \(its port does not answer yet\), and this step never restarts a tier mid-start; if it runs code this install replaced, restart it once it answers: ccrc codex stop codex-a, then ccrc codex start codex-a$/m);
    expect(r.stdout).toMatch(/— 0 restarted, 1 left as they were, 0 not restarted$/m);
    expect(r.degraded).toEqual([]);
  });

  it('a running tier this install did not replace is not touched', () => {
    const r = runTiersStep({ ours: { 'codex-a litellm': 0, 'codex-a shim': 0 } });
    expect(r.calls).toEqual([LOCK_A, A_L, '_codex_tier_stale codex-a litellm', A_S, '_codex_tier_stale codex-a shim', UNLOCK_A]);
    expect(r.stdout).toMatch(/— 0 restarted, 2 left as they were, 0 not restarted$/m);
  });

  it('a running tier whose staleness cannot be measured (2) is left running, and said so — never restarted', () => {
    const r = runTiersStep({ ours: { 'codex-a shim': 0 }, stale: { 'codex-a shim': 2 } });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim', UNLOCK_A]);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: left alone — whether it runs code this install replaced could not be measured/m);
    expect(r.stdout).toMatch(/— 0 restarted, 1 left as they were, 0 not restarted$/m);
    expect(r.degraded).toEqual([]);
  });

  it('a running stale tier is stopped, then started, then re-measured until it answers as this lane', () => {
    // Review round 1, item 5 (class fix): a NEW `_codex_tier_ours` call sits
    // between the stop and the start — the re-ask that proves the port is
    // free (1) before this step ever starts over it. The sequence's 2nd
    // value (1) is that re-ask; the 3rd (4) and 4th (0) are the readiness
    // wait's own two calls, preserving "waits through an intermediate state
    // before succeeding".
    const r = runTiersStep({ ours: { 'codex-a shim': [0, 1, 4, 0] }, stale: { 'codex-a shim': 0 }, readyS: '5' });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim',
      '_codex_stop_tier codex-a shim', A_S, '_codex_start_tier codex-a shim', A_S, A_S, UNLOCK_A]);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: started, waiting up to 5s for it to answer$/m);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: restarted — it was running code this install replaced$/m);
    expect(r.stdout).toMatch(/— 1 restarted, 0 left as they were, 0 not restarted$/m);
    expect(r.degraded).toEqual([]);
  });

  it('a restart that re-measures STARTING (4) keeps waiting; only 0 is "restarted"', () => {
    // The class-fix re-ask (2nd value) must read 1 (free) or the start is
    // refused before it ever happens; the wait loop's own three calls (4, 4,
    // then 0) are what this case is actually about.
    const r = runTiersStep({ ours: { 'codex-a shim': [0, 1, 4, 4, 0] }, stale: { 'codex-a shim': 0 }, readyS: '10' });
    expect(r.calls.filter((l) => l === A_S)).toHaveLength(5);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: restarted — /m);
  });

  it('a stop that fails is reported and never followed by a start', () => {
    const r = runTiersStep({ ours: { 'codex-a shim': 0 }, stale: { 'codex-a shim': 0 }, stopRc: { 'codex-a shim': 1 } });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim', '_codex_stop_tier codex-a shim', UNLOCK_A]);
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: restart FAILED — it could not be stopped/m);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a stop that finds the tier no longer provably this lane\'s counts as not restarted, and no start follows (ruling PF-21)', () => {
    // `_codex_stop_tier` returns rc 0 for BOTH "stopped" and "foreign" — only
    // its stdout WORD tells them apart (PF-21). `foreign` is never folded
    // into a successful stop, so this step CAPTURES the word rather than only
    // the rc. `stopForeign` is this harness's own knob (Task 10; Task 6 has
    // its own): it makes the stub print "foreign" at rc 0 for this one
    // id+tier key, modelling the narrow race where the tier stopped being
    // provably this lane's between this step's own identity gate and the
    // stop call — extremely rare, but D-3488 governs it too: ccrc never
    // starts over something it can no longer prove it stopped.
    const r = runTiersStep({ ours: { 'codex-a shim': 0 }, stale: { 'codex-a shim': 0 }, stopForeign: ['codex-a shim'] });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim', '_codex_stop_tier codex-a shim', UNLOCK_A]);
    expect(r.calls).not.toContain('_codex_start_tier codex-a shim');
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: NOT restarted — /m);
    expect(r.stdout).toMatch(/— 0 restarted, 0 left as they were, 1 not restarted$/m);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a stop that answers rc 0 without saying "foreign" is re-measured right before the start, and a foreign holder there is NAMED and leaves the tier DOWN (review round 2, N2/N3)', () => {
    // CLASS FIX: `_codex_stop_tier` answers `foreign` only when it stopped
    // nothing — after a REAL stop it answers `stopped`, and a taker that
    // arrives after its own second measurement is invisible to it. This
    // step's own re-ask, right before the start, is what catches that: the
    // 2nd `ours` value (2) models a foreign holder arriving after a real
    // stop. `stopForeign` is NOT set here — the stop's own word never says
    // foreign, on purpose, so this case binds the re-ask and not PF-21's own
    // guard above. `oursWhy` sets CX_TIER_WHY (`listener-other-process`,
    // real function's own contract) right before the fake returns 2, so
    // `_codex_foreign_what` — real, unstubbed — resolves a real holder
    // description from it (N2): nothing here hand-writes the message text.
    const r = runTiersStep({
      ours: { 'codex-a shim': [0, 2] }, stale: { 'codex-a shim': 0 },
      oursWhy: { 'codex-a shim': 'listener-other-process' },
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim',
      '_codex_stop_tier codex-a shim', A_S, UNLOCK_A]);
    expect(r.calls).not.toContain('_codex_start_tier codex-a shim');
    // The holder description is `_codex_foreign_what`'s own text for
    // `listener-other-process`, never re-typed here — only its distinctive
    // substring is asserted, so this case still binds if that wording moves.
    // Since the fix wave the real library yields `listener-other-process`
    // for the shim too (its proven pid while another process holds the
    // port), and names it by the tier's own name.
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: NOT restarted — the stop said "[^"]*", but a re-measurement right before the start found port \d+ \(codex-a's shim tier\) is held by a process that is not this lane's shim.*this tier is DOWN.*ccrc codex start codex-a$/m);
    expect(r.stdout).toMatch(/— 0 restarted, 0 left as they were, 1 not restarted$/m);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a re-ask that cannot tell whether the port is free (not 1, not 2) also leaves the tier DOWN, named as unmeasured (review round 2, N3)', () => {
    const r = runTiersStep({ ours: { 'codex-a shim': [0, 3] }, stale: { 'codex-a shim': 0 } });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim',
      '_codex_stop_tier codex-a shim', A_S, UNLOCK_A]);
    expect(r.calls).not.toContain('_codex_start_tier codex-a shim');
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: NOT restarted — the stop said "[^"]*", but a re-measurement right before the start could not tell whether the port is free \(answered 3\).*this tier is DOWN.*ccrc codex start codex-a$/m);
    expect(r.stdout).toMatch(/— 0 restarted, 0 left as they were, 1 not restarted$/m);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a start that fails is reported distinctly — the tier is DOWN', () => {
    // The 2nd `ours` value (1) is the class-fix re-ask, proving the port
    // free right before the start that then fails.
    const r = runTiersStep({ ours: { 'codex-a shim': [0, 1] }, stale: { 'codex-a shim': 0 }, startRc: { 'codex-a shim': 1 } });
    expect(r.calls.slice(-2)).toEqual(['_codex_start_tier codex-a shim', UNLOCK_A]);
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: restart FAILED — it was stopped and would not start again/m);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a start that never answers as this lane is a failed restart, not a restart', () => {
    // TREE OVERRIDE (re-derived, not the brief's own text): `_codex_ready_secs`
    // (Task 5, read at `ccd/ccrc:10246-10252`) falls back to 90 for `0` too —
    // `[ "$s" -ge 1 ] || s=90` — not only for an empty or non-digit value. The
    // brief's own `readyS: '0'` therefore does not bound this case at 0s: it
    // waits the full 90s default (measured — this case took ~90s before this
    // fix). `1` is the smallest valid bound, so the case still runs fast. At
    // that bound the wait loop's own shape (it checks the deadline only AFTER
    // `sleep 1`) can make ONE or TWO `_codex_tier_ours` calls before it gives
    // up, depending on real elapsed time between computing the deadline and
    // the first check (measured both ways on this box) — so this case asserts
    // the SHAPE of the tail (start, one-or-more identical ours calls, unlock)
    // rather than an exact count, which a 1s deadline cannot promise.
    const r = runTiersStep({ ours: { 'codex-a shim': [0, 1] }, stale: { 'codex-a shim': 0 }, readyS: '1' });
    const startAt = r.calls.indexOf('_codex_start_tier codex-a shim');
    expect(startAt).toBeGreaterThan(-1);
    const tail = r.calls.slice(startAt);
    expect(tail[0]).toBe('_codex_start_tier codex-a shim');
    expect(tail.at(-1)).toBe(UNLOCK_A);
    const waited = tail.slice(1, -1);
    expect(waited.length).toBeGreaterThanOrEqual(1);
    expect(waited.every((c) => c === A_S)).toBe(true);
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: restart FAILED — it was started again and did not answer as this lane within 1s/m);
    expect(r.stdout).not.toMatch(/codex-a shim: restarted/);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('with no runtime resolving, a stale tier is NOT stopped — it is never stopped when it could not be started again', () => {
    const r = runTiersStep({ runtime: false, ours: { 'codex-a shim': 0 }, stale: { 'codex-a shim': 0 } });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim', UNLOCK_A]);
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: NOT restarted — it runs code this install replaced, but no codex runtime resolves/m);
    expect(r.degraded).toEqual(['codex-tiers']);
  });

  it('a failed runtime build this run never restarts a stale litellm tier: one line, left as it was; the shim is restarted (D-6691)', () => {
    // `stale: 0` on litellm stands for its record's library hash having moved
    // (`_codex_started_json` hashes the stamp and the placed auth library):
    // stale, while the build that would have given it new code did not pass.
    // The shim is the control: the same run restarts it, so the skip is the
    // litellm tier's alone. The litellm record names the generation that
    // resolves now, the one shape the skip covers.
    const r = runTiersStep({
      runtimeBuildFails: true, startedGen: { 'codex-a litellm': 'gen-20260101T000000Z-1' },
      ours: { 'codex-a litellm': 0, 'codex-a shim': [0, 1, 0] },
      stale: { 'codex-a litellm': 0, 'codex-a shim': 0 }, readyS: '5',
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: codex runtime: NOT BUILT — ccgpt-runtime build exited 1 /m);
    expect(r.calls).toEqual([LOCK_A, A_L, '_codex_tier_stale codex-a litellm', A_S, '_codex_tier_stale codex-a shim',
      '_codex_stop_tier codex-a shim', A_S, '_codex_start_tier codex-a shim', A_S, UNLOCK_A]);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a litellm: left alone — it runs code this install replaced, but this run's codex runtime build did not pass \(the codex runtime: NOT BUILT line above\), so it keeps its running code until a build passes; then re-run: ccrc install$/m);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: restarted — /m);
    expect(r.stdout).toMatch(/— 1 restarted, 1 left as they were, 0 not restarted$/m);
    expect(r.degraded).toEqual(['codex-runtime']);
  });

  it('a failed runtime build still restarts a litellm tier whose record names an older generation onto the current one (D-6691)', () => {
    // The previous build's generation is current, and this tier's record
    // names an older one: a restart moves it onto the current generation, so
    // the skip does not cover it.
    const r = runTiersStep({
      runtimeBuildFails: true, startedGen: { 'codex-a litellm': 'gen-20251201T000000Z-1' },
      ours: { 'codex-a litellm': [0, 1, 0] }, stale: { 'codex-a litellm': 0 }, readyS: '5',
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: codex runtime: NOT BUILT — ccgpt-runtime build exited 1 /m);
    expect(r.calls).toEqual([LOCK_A, A_L, '_codex_tier_stale codex-a litellm', '_codex_stop_tier codex-a litellm', A_L,
      '_codex_start_tier codex-a litellm', A_L, A_S, UNLOCK_A]);
    expect(r.stdout).not.toMatch(/codex-a litellm: left alone/);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a litellm: restarted — /m);
    expect(r.stdout).toMatch(/— 1 restarted, 0 left as they were, 0 not restarted$/m);
    expect(r.degraded).toEqual(['codex-runtime']);
  });

  it('two failed restarts degrade the step once, and the summary counts both', () => {
    const r = runTiersStep({
      lanes: ['codex-a', 'codex-b'],
      ours: { 'codex-a shim': 0, 'codex-b shim': 0 },
      stale: { 'codex-a shim': 0, 'codex-b shim': 0 },
      stopRc: { 'codex-a shim': 1, 'codex-b shim': 1 },
    });
    expect(r.degraded).toEqual(['codex-tiers']);
    expect(r.stdout).toMatch(/^install: codex tiers: 2 codex lane\(s\) — 0 restarted, 0 left as they were, 2 not restarted$/m);
  });

  it('each lane is asked and acted on under ITS lock, released through _codex_unlock before the next lane\'s is taken', () => {
    // The lock is held from the first question to the last act (a check made
    // outside it is a check-then-act race), and released per lane so no later
    // spawn inherits it. The release is `_codex_unlock`, its ONLY release
    // (ruling R19): the stub records it, so an inline close shows as a missing
    // `_codex_unlock` line. `LOCK-STILL-HELD` is the stub's record of a lock
    // entered while the previous one was never released; `lockAfter` is the
    // last lane's `CX_LOCK_FD` and `CX_LOCK_ID`.
    // The 2nd `ours` value (1) is the class-fix re-ask; the 3rd (0) is the
    // readiness wait's own call.
    const r = runTiersStep({
      lanes: ['codex-a', 'codex-b'],
      ours: { 'codex-b shim': [0, 1, 0] }, stale: { 'codex-b shim': 0 }, readyS: '5',
    });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, UNLOCK_A, LOCK_B, B_L, B_S, '_codex_tier_stale codex-b shim',
      '_codex_stop_tier codex-b shim', B_S, '_codex_start_tier codex-b shim', B_S, UNLOCK_B]);
    expect(r.lockAfter).toBe('');
    expect(r.stdout).toMatch(/— 1 restarted, 0 left as they were, 0 not restarted$/m);
  });

  it('a lane whose lock cannot be taken is not asked at all: its own line, counted, degraded — and the next lane still runs', () => {
    const r = runTiersStep({
      lanes: ['codex-a', 'codex-b'], lockRefuse: ['codex-a'],
      ours: { 'codex-a shim': 0 }, stale: { 'codex-a shim': 0 },
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LOCK_A, LOCK_B, B_L, B_S, UNLOCK_B]);
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a: NOT measured — its lane lock could not be taken/m);
    expect(r.stdout).toMatch(/^install: codex tiers: 2 codex lane\(s\) — 0 restarted, 0 left as they were, 2 not restarted$/m);
    expect(r.degraded).toEqual(['codex-tiers']);
    expect(r.lockAfter).toBe('');
  });

  it('a box with no flock: the lock answers 0 with nothing held, and the lane is still measured and restarted, unserialised', () => {
    // Task 5's contract (ruling R19): rc 0 with CX_LOCK_FD EMPTY means "no
    // flock on this box", never a refusal. A step that read the empty
    // descriptor as a failed lock would leave every lane of such a box
    // untouched and degraded. `_codex_unlock -` is the release of nothing.
    // The 2nd `ours` value (1) is the class-fix re-ask; the 3rd (0) is the
    // readiness wait's own call.
    const r = runTiersStep({ lockNoFlock: ['codex-a'], ours: { 'codex-a shim': [0, 1, 0] }, stale: { 'codex-a shim': 0 }, readyS: '5' });
    expect(r.calls).toEqual([LOCK_A, A_L, A_S, '_codex_tier_stale codex-a shim',
      '_codex_stop_tier codex-a shim', A_S, '_codex_start_tier codex-a shim', A_S, '_codex_unlock -']);
    expect(r.stderr).not.toMatch(/its lane lock could not be taken/);
    expect(r.stdout).toMatch(/— 1 restarted, 0 left as they were, 0 not restarted$/m);
    expect(r.degraded).toEqual([]);
    expect(r.lockAfter).toBe('');
  });
});

describe('ccrc install: the codex usage converge, measured in isolation (_inst_codex_usage, Plan 3a Task 6)', () => {
  const T = (id: string): string => `ccrc-codex-usage@${id}.timer`;
  const EN = (id: string): string => `systemctl --user enable --now ${T(id)}`;
  const DIS = (id: string): string => `systemctl --user disable --now ${T(id)}`;
  const ctl = (r: StepRun): string[] => r.calls.filter((l) => l.startsWith('systemctl '));
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  it('a server-role box: silent, and the manager is never asked', () => {
    const r = runUsageStep({ role: 'server', lanes: ['codex-a'], enabled: ['ext-a'] });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual([T('ext-a')]);
    expect(r.degraded).toEqual([]);
  });

  it('no codex lane and no ccrc timer enabled: one line, and the manager is never asked', () => {
    const r = runUsageStep({ lanes: [] });
    expect(r.stdout).toBe('install: codex-usage: none — no codex lane in the roster\n');
    expect(ctl(r)).toEqual([]);
    expect(r.degraded).toEqual([]);
  });

  it('one timer per codex lane, in roster order, and none for any other id', () => {
    const r = runUsageStep({ lanes: ['codex-a', 'codex-b'] });
    expect(ctl(r)).toEqual([EN('codex-a'), EN('codex-b')]);
    expect(r.links).toEqual([T('codex-a'), T('codex-b')]);
    expect(r.degraded).toEqual([]);
    expect(r.stdout).toBe('install: codex-usage: enabled for codex-a codex-b; withheld from no lane; withdrawn from no lane\n');
  });

  it('a ccrc timer whose id is no longer a codex lane is DISABLED first — a flip-back converges on the next install', () => {
    const r = runUsageStep({ lanes: ['codex-a'], enabled: ['codex-a', 'ext-a'] });
    expect(ctl(r)).toEqual([DIS('ext-a'), EN('codex-a')]);
    expect(r.links).toEqual([T('codex-a')]);
    expect(r.degraded).toEqual([]);
    expect(r.stdout).toMatch(/; withdrawn from ext-a$/m);
  });

  it('the last codex lane gone: its timer is withdrawn, nothing is enabled, and the line says so', () => {
    const r = runUsageStep({ lanes: [], enabled: ['codex-a'] });
    expect(ctl(r)).toEqual([DIS('codex-a')]);
    expect(r.links).toEqual([]);
    expect(r.stdout).toBe('install: codex-usage: enabled for no lane; withheld from no lane; withdrawn from codex-a\n');
  });

  it('ANOTHER repository\'s timer enabled for a codex lane: ccrc\'s is withheld and withdrawn, the step degrades, and the foreign unit is never named to the manager (R6)', () => {
    const r = runUsageStep({ lanes: ['codex-a', 'codex-b'], enabled: ['codex-a'], foreign: ['codex-a'] });
    expect(ctl(r)).toEqual([DIS('codex-a'), EN('codex-b')]);
    expect(ctl(r).join('\n'), 'the converge asked the manager about another repository\'s unit').not.toContain('ccgpt-usage');
    expect(r.links, 'the foreign link was touched, or ccrc\'s was left beside it')
      .toEqual(['ccgpt-usage@codex-a.timer', T('codex-b')]);
    expect(r.degraded).toEqual(['codex-usage']);
    // Fix round 1: the transcript names the withdrawal it made, in the
    // lane's own line and in the summary.
    expect(r.stdout).toMatch(/^install: codex-usage: NOT ENABLED for codex-a — another repository's ccgpt-usage@codex-a\.timer is enabled on this box, and two publishers would race this lane's ~\/\.cc-limits row\. ccrc's own ccrc-codex-usage@codex-a\.timer was enabled, and this run disabled it\. ccrc never disables another tool's unit: once this lane's cutover retires it, run: systemctl --user disable --now ccgpt-usage@codex-a\.timer — then re-run: ccrc install$/m);
    expect(r.stdout).toMatch(/^install: codex-usage: enabled for codex-b; withheld from codex-a; withdrawn from codex-a$/m);
  });

  it('two lanes withheld, one of them withdrawn: each line says what this run did to that lane, and codex-usage is ONE degraded step (fix round 1)', () => {
    const r = runUsageStep({ lanes: ['codex-a', 'codex-b'], enabled: ['codex-a'], foreign: ['codex-a', 'codex-b'] });
    expect(ctl(r)).toEqual([DIS('codex-a')]);
    expect(r.links).toEqual(['ccgpt-usage@codex-a.timer', 'ccgpt-usage@codex-b.timer']);
    expect(r.degraded, 'codex-usage was counted once per withheld lane, not once per step').toEqual(['codex-usage']);
    const lines = r.stdout.split('\n');
    expect(lines.find((l) => l.startsWith('install: codex-usage: NOT ENABLED for codex-a ')))
      .toContain("ccrc's own ccrc-codex-usage@codex-a.timer was enabled, and this run disabled it.");
    expect(lines.find((l) => l.startsWith('install: codex-usage: NOT ENABLED for codex-b ')), 'a withdrawal was claimed for a lane whose timer was never on')
      .toMatch(/~\/\.cc-limits row\. ccrc never disables another tool's unit: /);
    expect(r.stdout).toMatch(/^install: codex-usage: enabled for no lane; withheld from codex-a codex-b; withdrawn from codex-a$/m);
  });

  it('a withdrawal refused on the foreign arm: the lane\'s line says both publishers are armed, a NOT CONVERGED line names what is still on, and codex-usage is ONE step (fix round 1)', () => {
    const r = runUsageStep({ lanes: ['codex-a'], enabled: ['codex-a', 'ext-a'], foreign: ['codex-a'],
      refuse: [T('codex-a'), T('ext-a')] });
    expect(ctl(r)).toEqual([DIS('ext-a'), DIS('codex-a')]);
    expect(r.links).toEqual(['ccgpt-usage@codex-a.timer', T('codex-a'), T('ext-a')]);
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stdout).toMatch(/^install: codex-usage: NOT ENABLED for codex-a — .* ccrc's own ccrc-codex-usage@codex-a\.timer is enabled too, and this run could not disable it, so both publishers are armed\. ccrc never disables another tool's unit: /m);
    expect(r.stdout).toMatch(/^install: codex-usage: enabled for no lane; withheld from codex-a; withdrawn from no lane$/m);
    expect(r.stdout).toMatch(/^install: codex-usage: NOT CONVERGED — ccrc's own usage timer is still enabled for ext-a codex-a, which this run had to withdraw and systemd would not disable/m);
  });

  it('another repository\'s FLAT timer names no lane: said once, unattributed, and it blocks nothing', () => {
    const r = runUsageStep({ lanes: ['codex-a'], flatForeign: true });
    expect(ctl(r)).toEqual([EN('codex-a')]);
    expect(r.degraded).toEqual([]);
    expect(r.stdout).toMatch(/^install: codex-usage: note — another repository's ccgpt-usage\.timer is enabled on this box\. It names no lane, so ccrc cannot tell which lane's ~\/\.cc-limits row it writes; if it is one of codex-a, two publishers race that row\. ccrc leaves it alone; once no lane on this box relies on it, run: systemctl --user disable --now ccgpt-usage\.timer$/m);
    expect(r.links).toContain('ccgpt-usage.timer');
  });

  it('on a box with no codex lane the foreign timers are not the converge\'s business at all — the live fleet box\'s shape after this merge', () => {
    const r = runUsageStep({ lanes: [], foreign: ['ext-b'], flatForeign: true });
    expect(r.stdout).toBe('install: codex-usage: none — no codex lane in the roster\n');
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual(['ccgpt-usage.timer', 'ccgpt-usage@ext-b.timer']);
    expect(r.degraded).toEqual([]);
  });

  it('an unreadable roster is never "no codex lane": NOT CONVERGED, degraded, and a ccrc timer already on is NOT withdrawn', () => {
    const r = runUsageStep({ lanesRc: 1, enabled: ['codex-a'] });
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual([T('codex-a')]);
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stdout).toMatch(/^install: codex-usage: NOT CONVERGED — \$HOME\/\.ccrc\/accounts\.json could not be read as a roster/m);
  });

  it('no jq (rc 2): the same refusal to act, in its own sentence', () => {
    const r = runUsageStep({ lanesRc: 2, enabled: ['codex-a'] });
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual([T('codex-a')]);
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stdout).toMatch(/^install: codex-usage: NOT CONVERGED — jq is not on PATH/m);
  });

  it('an enable systemd refuses: the helper\'s line on stderr, and the degraded step is that unit', () => {
    const r = runUsageStep({ lanes: ['codex-a', 'codex-b'], refuse: [T('codex-b')] });
    expect(ctl(r)).toEqual([EN('codex-a'), EN('codex-b')]);
    expect(r.degraded).toEqual([T('codex-b')]);
    expect(r.stderr).toMatch(new RegExp(`^install: codex-usage: could not enable ${esc(T('codex-b'))} — run: systemctl --user enable --now ${esc(T('codex-b'))}$`, 'm'));
    expect(r.stdout).toMatch(/^install: codex-usage: enabled for codex-a; withheld from no lane; withdrawn from no lane$/m);
  });

  it('a withdrawal systemd refuses: its own line, degraded, and the timer is still there to name', () => {
    const r = runUsageStep({ lanes: [], enabled: ['ext-a'], refuse: [T('ext-a')] });
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stderr).toMatch(/^install: codex-usage: could not disable ccrc-codex-usage@ext-a\.timer — account ext-a is no longer a codex lane, so its timer must not poll; run: systemctl --user disable --now ccrc-codex-usage@ext-a\.timer$/m);
    expect(r.links).toEqual([T('ext-a')]);
    // Fix round 1: `none` is the line a box with no codex lane reads as "this
    // step did nothing"; over a ccrc timer still enabled it would be false.
    expect(r.stdout, 'a refused withdrawal was reported as `none`').toBe(
      'install: codex-usage: NOT CONVERGED — ccrc\'s own usage timer is still enabled for ext-a, which this run had to withdraw and systemd would not disable (the could-not-disable line above names each, with its command). This install continues. Run those commands, then re-run: ccrc install\n');
  });

  it('no shape contract: NOT CONVERGED, degraded, and nothing enabled or withdrawn — an unread id set is not an empty one (fix round 1)', () => {
    const r = runUsageStep({ shape: false, lanes: ['codex-a'], enabled: ['ext-a'] });
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual([T('ext-a')]);
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stdout).toBe('install: codex-usage: NOT CONVERGED — the wrapper shape contract could not be read (the ccrc codex: line above says so), so ccrc\'s own usage timers cannot be told from anything else, and none was enabled or disabled. This install continues. Re-run: ccrc install\n');
    expect(r.stderr).toMatch(/^ccrc codex: install-incomplete: /m);
  });

  it('a wants link whose instance is not an account id is not ccrc\'s: never disabled, never named to the manager, and the step says none (fix round 1)', () => {
    // The grammar filter is an ownership boundary on the path that issues
    // `disable --now`, and Task 7's uninstall reuses the same reader.
    const r = runUsageStep({ lanes: [], enabled: ['EXT-A'] });
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual(['ccrc-codex-usage@EXT-A.timer']);
    expect(r.stdout).toBe('install: codex-usage: none — no codex lane in the roster\n');
    expect(r.degraded).toEqual([]);
  });

  it('forced Darwin: one not-applicable line naming the lanes, the manager never asked, and NOT a degraded step (R2)', () => {
    const r = runUsageStep({ os: 'darwin', lanes: ['codex-a', 'codex-b'], enabled: ['ext-a'] });
    expect(r.stdout).toBe('install: codex-usage: not applicable on macOS — ccrc places no launchd job for a codex lane\'s usage poller (decision 17: macOS is not centrally managed), so this box publishes no ~/.cc-limits row for: codex-a, codex-b\n');
    expect(ctl(r)).toEqual([]);
    expect(r.degraded).toEqual([]);
  });

  it('forced Darwin with no codex lane: silent', () => {
    const r = runUsageStep({ os: 'darwin', lanes: [] });
    expect(r.stdout).toBe('');
    expect(ctl(r)).toEqual([]);
  });

  it('a withdrawal the manager answers 0 while its link stays is NOT withdrawn: the could-not-disable line, NOT CONVERGED, and one degraded step — measured, never read off the exit code (Plan 3b Task A2)', () => {
    const r = runUsageStep({ lanes: [], enabled: ['ext-a'], keepLink: [T('ext-a')] });
    expect(ctl(r)).toEqual([DIS('ext-a')]);
    expect(r.links, 'the stand-in removed the link it was told to keep').toEqual([T('ext-a')]);
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stderr).toMatch(/^install: codex-usage: could not disable ccrc-codex-usage@ext-a\.timer — account ext-a is no longer a codex lane, so its timer must not poll; run: systemctl --user disable --now ccrc-codex-usage@ext-a\.timer$/m);
    expect(r.stdout, 'a withdrawal the link contradicts was claimed').toBe(
      'install: codex-usage: NOT CONVERGED — ccrc\'s own usage timer is still enabled for ext-a, which this run had to withdraw and systemd would not disable (the could-not-disable line above names each, with its command). This install continues. Run those commands, then re-run: ccrc install\n');
  });

  it('on the foreign arm too: a disable answered 0 with the link still there says both publishers are armed, never "this run disabled it" (Plan 3b Task A2)', () => {
    const r = runUsageStep({ lanes: ['codex-a'], enabled: ['codex-a'], foreign: ['codex-a'], keepLink: [T('codex-a')] });
    expect(ctl(r)).toEqual([DIS('codex-a')]);
    expect(r.links).toEqual(['ccgpt-usage@codex-a.timer', T('codex-a')]);
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stderr).toMatch(/^install: codex-usage: could not disable ccrc-codex-usage@codex-a\.timer — run: systemctl --user disable --now ccrc-codex-usage@codex-a\.timer$/m);
    expect(r.stdout).toMatch(/^install: codex-usage: NOT ENABLED for codex-a — .* ccrc's own ccrc-codex-usage@codex-a\.timer is enabled too, and this run could not disable it, so both publishers are armed\. ccrc never disables another tool's unit: /m);
    expect(r.stdout).not.toMatch(/this run disabled it/);
    expect(r.stdout).toMatch(/^install: codex-usage: enabled for no lane; withheld from codex-a; withdrawn from no lane$/m);
    expect(r.stdout).toMatch(/^install: codex-usage: NOT CONVERGED — ccrc's own usage timer is still enabled for codex-a, which this run had to withdraw and systemd would not disable/m);
  });
});

describe('ccrc install: the codex runtime step on a real spine (Plan 2b-2 Task 10)', () => {
  it('the runtime template answers pip itself behind interpreter flags, and never hands pip to the box\'s real python (final review F4)', () => {
    // No spine: the template's own venv python, run directly. `--version` is
    // the argv measured here because, on the pre-fix template, it is the one
    // pip argv that reaches the REAL pip harmlessly (it prints a version).
    const home = mkTmp('ccrc-codex-template-pip-');
    plantRuntimeTemplate(home, { verdict: 'pass', version: '1.101.0' });
    const py = join(home, 'fixture-runtime', 'gen-template', 'bin', 'python');
    for (const argv of [['-m', 'pip', '--version'], ['-I', '-m', 'pip', '--version'], ['-I', '-B', '-m', 'pip', '--version']]) {
      const r = spawnSync(py, argv, { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home } });
      expect(r.status, `${argv.join(' ')}: ${r.stderr}`).toBe(0);
      expect(r.stdout, `${argv.join(' ')} reached the box's real pip`).not.toMatch(/^pip /m);
    }
    expect(read(join(home, 'fixture-runtime', 'calls'))).toMatch(/^-I -B -m pip --version$/m);
  });

  it('a roster with no codex lane: one line from each step, and nothing is built', () => {
    const home = freshBox('ccrc-codex-steps-none-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('install: codex runtime:')))
      .toEqual(['install: codex runtime: none — no codex lane in the roster']);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('install: codex tiers:')))
      .toEqual(['install: codex tiers: none — no codex lane in the roster']);
    expect(existsSync(join(home, '.ccrc', 'runtime'))).toBe(false);
    expect(venvCalls(home)).toEqual([]);
    expect(spineRunCalls(home)).toEqual([]);
  });

  it('--role server builds nothing and restarts nothing, and says nothing about either', async () => {
    const home = codexBox('ccrc-codex-steps-server-', await freeLanes(['codex-a']));
    const r = runInstall(home, ['install', '--role', 'server']);
    expect(existsSync(dotCcrc(home, 'installed')), r.stderr).toBe(true);
    expect(r.stdout).not.toMatch(/^install: codex (runtime|tiers):/m);
    expect(existsSync(join(home, '.ccrc', 'runtime'))).toBe(false);
    expect(venvCalls(home)).toEqual([]);
    expect(r.code).toBe(doctorCode(home));
  });

  it('a codex lane and a passing runtime: built, stamped from the declared requirement and probe; a re-run re-measures it current and builds nothing', async () => {
    const home = codexBox('ccrc-codex-steps-built-', await freeLanes(['codex-a']));
    const r = runInstall(home);
    expect(existsSync(dotCcrc(home, 'installed')), `${r.stdout}\n${r.stderr}`).toBe(true);
    expect(r.stdout).toMatch(/^install: codex runtime: gen-\d{8}T\d{6}Z-\d+ built, probed and current for 1 codex lane\(s\)$/m);
    expect(r.stdout).not.toMatch(/^install: done — converged with .*\bcodex-runtime\b/m);
    expect(r.code).toBe(doctorCode(home));
    const py = runtimePython(home);
    const gen = py.replace(/\/bin\/python$/, '');
    expect(generations(home)).toEqual([gen.split('/').at(-1)]);
    // The stamp names what the builder DECLARES and what the probe IS, both
    // read out of the placed builder rather than typed here.
    const builder = read(join(home, '.local', 'bin', 'ccgpt-runtime'));
    const requirement = /^LITELLM_REQUIREMENT='([^']+)'/m.exec(builder)?.[1];
    expect(requirement, 'ccgpt-runtime declares no LITELLM_REQUIREMENT').toBeDefined();
    // One env for both spawns: ccrc-containment's census allows this suite exactly
    // three bare parent envs, each a ccgpt-runtime spawn.
    const rtEnv = { ...process.env, HOME: home };
    const probe = spawnSync(join(home, '.local', 'bin', 'ccgpt-runtime'), ['probe-source'], { env: rtEnv });
    expect(probe.status).toBe(0);
    const patch = spawnSync(join(home, '.local', 'bin', 'ccgpt-runtime'), ['patch-source'], { env: rtEnv });
    expect(patch.status).toBe(0);
    const stamp = JSON.parse(read(join(gen, '.ccrc-runtime.json'))) as Record<string, unknown>;
    expect(stamp['requirement']).toBe(requirement);
    // The probe's bytes, then the LiteLLM patch's (spec §22.2, D-4859).
    expect(stamp['probeSha256']).toBe(createHash('sha256').update(probe.stdout).update(patch.stdout).digest('hex'));
    expect(stamp['litellm']).toBe('1.101.0');
    // Ruling R33 against the REAL builder: the building line names the
    // requirement the placed builder declares (the step reads that same line),
    // and comes before the result line.
    const out = r.stdout.split('\n');
    const buildingAt = out.indexOf(`install: codex runtime: building ${requirement!} — pip may take minutes`);
    const builtAt = out.findIndex((l) => /^install: codex runtime: gen-\S+ built, probed and current /.test(l));
    expect(buildingAt, r.stdout).toBeGreaterThan(-1);
    expect(builtAt).toBeGreaterThan(buildingAt);
    const built = venvCalls(home).length;
    expect(built).toBe(1);

    const again = runInstall(home);
    expect(again.stdout).toMatch(/^install: codex runtime: gen-\S+ already current \(requirement, probe and litellm version re-measured unchanged\) for 1 codex lane\(s\)$/m);
    expect(venvCalls(home)).toHaveLength(built);
    expect(runtimePython(home)).toBe(py);
    // AN EXPLICIT BOUND (final review F4, Task 10 residue C3): two install spines plus doctorCode's.
    // Measured alone (one file, `-t`): 7.4 s at load average 12 (2026-09-28); its sibling below timed
    // out once at the 20 s default under load 40-80 (Task 10's gate).
  }, 60_000);

  it('a runtime whose probe FAILS degrades the install, never fails it, and the previous runtime stays current', async () => {
    const home = codexBox('ccrc-codex-steps-probe-fails-', await freeLanes(['codex-a']));
    const first = runInstall(home);
    expect(first.stdout, first.stderr).toMatch(/^install: codex runtime: \S+ built, probed and current/m);
    const before = runtimePython(home);
    const gensBefore = generations(home);
    // A new litellm under the old generation (`check` answers `mutated`),
    // and a verdict that fails a gate the spec names.
    writeRuntimeFixture(home, { verdict: 'fail:tool-survives', version: '1.101.1' });
    const r = runInstall(home);
    expect(existsSync(dotCcrc(home, 'installed')), 'a failed runtime build must not stop the spine').toBe(true);
    expect(r.stderr).toMatch(/^ccgpt-runtime: build failed at probe: /m);
    expect(r.stdout).toMatch(/^install: codex runtime: NOT BUILT — ccgpt-runtime build exited \d+ .*the previous runtime gen-\S+ stays current/m);
    expect(r.stdout).toMatch(/^install: done — converged with \d+ degraded steps? \([^)]*\bcodex-runtime\b[^)]*\)$/m);
    expect(r.code).toBe(doctorCode(home));
    expect(runtimePython(home)).toBe(before);
    expect(generations(home)).toEqual(gensBefore);
    // AN EXPLICIT BOUND (final review F4, Task 10 residue C3): two install spines plus doctorCode's.
    // Measured alone (one file, `-t`): 7.7 s at load average 12 (2026-09-28), 8.7 s at load 30 (the
    // final review), about 12 s at load 40-80, where it timed out once at the 20 s default (Task 10).
  }, 60_000);

  it('the stock venv python, which answers nothing, fails the probe: degraded, and no generation is left behind', async () => {
    // m-spine H5 at the spine: a runtime python that exits 0 for every argv
    // must never become current. `template: false` leaves the stub's vacuous
    // python in place.
    const home = codexBox('ccrc-codex-steps-vacuous-', await freeLanes(['codex-a']), { template: false });
    const r = runInstall(home);
    expect(existsSync(dotCcrc(home, 'installed')), r.stderr).toBe(true);
    expect(r.stderr).toMatch(/^ccgpt-runtime: build failed at probe: /m);
    expect(r.stdout).toMatch(/^install: codex runtime: NOT BUILT — .*there is no runtime at all/m);
    expect(r.stdout).toMatch(/^install: done — converged with \d+ degraded steps? \([^)]*\bcodex-runtime\b[^)]*\)$/m);
    expect(existsSync(join(runtimeDir(home), 'current'))).toBe(false);
    expect(generations(home)).toEqual([]);
  });
});

// PLATFORM-ONLY: the restart path measured here is the user-manager arm, whose
// fake is Task 4's `plantSystemd`; on Darwin `_svc_have_user_manager` is always
// false, the nohup arm is taken, and that arm is Task 5's subject.
describeLinux('ccrc install: the codex tier restart step on a real spine (Plan 2b-2 Task 10)', () => {
  const homes: string[] = [];
  // `killLaneProcesses` first runs the registered product stop while fixture
  // state exists, then ends every current-run child Task 4's fixture tracked.
  afterEach(async () => {
    for (const h of homes.splice(0)) await killLaneProcesses(h);
  });

  /** codex-a RUNNING through the fake user manager: first install (builds the
   *  runtime from the passing template), then `startLane` (registry,
   *  credential, rendered config, `ccrc codex start`). Clears both recordings
   *  so the NEXT install's calls are all they hold. */
  async function runningLane(prefix: string): Promise<{
    home: string; lane: LanePorts; units: { litellm: string; shim: string }; py: string;
  }> {
    const [lane] = await freeLanes(['codex-a']);
    const home = codexBox(prefix, [lane!], { systemd: true });
    homes.push(home);
    const first = runInstall(home, ['install'], READY);
    expect(existsSync(dotCcrc(home, 'installed')), `the first install did not complete:\n${first.stdout}\n${first.stderr}`).toBe(true);
    expect(existsSync(join(home, '.local', 'bin', '.codex-systemctl')),
      'plantSystemd did not plant into ~/.local/bin, so no spine harness can adopt it (Task 10 Interfaces)').toBe(true);
    const s = startLane(home, 'codex-a');
    expect(s.code, `ccrc codex start codex-a:\n${s.stdout}\n${s.stderr}`).toBe(0);
    const units = laneUnits(home, 'codex-a');
    // The lane really took the user-manager arm: both tiers went through the recorder.
    expect(spineRunCalls(home).filter((l) => l.includes(`--unit=${units.litellm}`) || l.includes(`--unit=${units.shim}`)))
      .toHaveLength(2);
    const ans = await laneAnswer(lane!.proxyPort);   // Task 5's {status, type, body} (ruling R30)
    expect(ans?.type).toMatch(/^application\/json/);
    expect(JSON.parse(ans!.body)).toEqual({ lane: 'codex-a' });
    expect(await portAccepts(lane!.litellmPort)).toBe(true);
    rmSync(join(home, 'manager-calls'), { force: true });
    rmSync(join(home, 'spine-systemd-run-calls'), { force: true });
    return { home, lane: lane!, units, py: runtimePython(home) };
  }

  it('a running shim whose code this install replaced is stopped, then started from the resolved generation; the litellm tier it did not replace is untouched', async () => {
    const { home, lane, units, py } = await runningLane('ccrc-codex-tiers-shim-');
    const litellmBefore = read(join(laneDir(home, 'codex-a'), 'litellm.started'));
    appendFileSync(treeFile(home, 'ccd/ccgpt-proxy.py'), '\n# fixture: the next release of the shim\n');
    const r = runInstall(home, ['install'], READY);
    expect(existsSync(dotCcrc(home, 'installed')), r.stderr).toBe(true);
    expect(r.stdout).toMatch(/^install: codex runtime: \S+ already current /m);
    expect(r.stdout).toMatch(/^install: codex tiers: codex-a shim: restarted — /m);
    expect(r.stdout).not.toMatch(/^install: codex tiers: codex-a litellm: restarted/m);
    expect(r.stdout).toMatch(/^install: codex tiers: 1 codex lane\(s\) — 1 restarted, 1 left as they were, 0 not restarted$/m);
    const runs = spineRunCalls(home);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toContain(`--unit=${units.shim}`);
    expect(runs[0]).toContain(`${py} -I ${join(home, '.local', 'bin', 'ccgpt-proxy.py')}`);
    expect(runs[0]).not.toContain('/current/');
    expect(runs[0]).not.toMatch(/sk-[0-9a-f]{48}|MASTER_KEY/);
    const mc = managerCalls(home);
    const stopAt = mc.findIndex((l) => /^systemctl --user stop\b/.test(l) && l.includes(units.shim));
    const runAt = mc.findIndex((l) => l.startsWith('systemd-run ') && l.includes(`--unit=${units.shim}`));
    expect(stopAt, mc.join('\n')).toBeGreaterThan(-1);
    expect(runAt).toBeGreaterThan(stopAt);
    expect(stateChanges(home).filter((l) => l.includes(units.litellm))).toEqual([]);
    expect(mc.filter((l) => /^systemctl --user restart\b/.test(l) && l.includes('ccgpt-'))).toEqual([]);
    expect(read(join(laneDir(home, 'codex-a'), 'litellm.started'))).toBe(litellmBefore);
    const shimStarted = JSON.parse(read(join(laneDir(home, 'codex-a'), 'shim.started'))) as { code?: string };
    expect(shimStarted.code).toBe(createHash('sha256')
      .update(readFileSync(join(home, '.local', 'bin', 'ccgpt-proxy.py'))).digest('hex'));
    const ans = await laneAnswer(lane.proxyPort);   // Task 5's {status, type, body} (ruling R30)
    expect(ans?.type).toMatch(/^application\/json/);
    expect(JSON.parse(ans!.body)).toEqual({ lane: 'codex-a' });
  }, 180_000);

  it('a rebuilt runtime restarts both tiers onto the NEW generation, because the build runs before the restart step', async () => {
    const { home, lane, units, py: oldPy } = await runningLane('ccrc-codex-tiers-rebuild-');
    writeRuntimeFixture(home, { version: '1.101.1' });   // the running generation now measures `mutated`
    const r = runInstall(home, ['install'], READY);
    expect(existsSync(dotCcrc(home, 'installed')), r.stderr).toBe(true);
    expect(r.stdout).toMatch(/^install: codex runtime: \S+ built, probed and current for 1 codex lane\(s\)$/m);
    const py = runtimePython(home);
    expect(py).not.toBe(oldPy);
    for (const tier of ['litellm', 'shim'] as const) {
      expect(r.stdout).toMatch(new RegExp(`^install: codex tiers: codex-a ${tier}: restarted — `, 'm'));
      const run = spineRunCalls(home).find((l) => l.includes(`--unit=${units[tier]}`));
      expect(run, `${tier} was not started again`).toBeDefined();
      expect(run!).toContain(py);
      const started = JSON.parse(read(join(laneDir(home, 'codex-a'), `${tier}.started`))) as { generation?: string };
      expect(started.generation).toBe(py.replace(/\/bin\/python$/, ''));
    }
    const ans = await laneAnswer(lane.proxyPort);   // Task 5's {status, type, body} (ruling R30)
    expect(ans?.type).toMatch(/^application\/json/);
    expect(JSON.parse(ans!.body)).toEqual({ lane: 'codex-a' });
    expect(await portAccepts(lane.litellmPort)).toBe(true);
  }, 180_000);

  it('a rostered lane with no tier running is left lazy: nothing is stopped, started or listening', async () => {
    // This lane was never materialised: no `~/.ccrc/codex/codex-a/` exists
    // when the step takes its lock. So this case is ALSO the spine-level pin of
    // one behaviour of Task 5's `_codex_lock` (Interfaces): a lane with no
    // directory yet can be locked, because the lock creates it. If it cannot,
    // the step's `NOT measured — its lane lock could not be taken` line
    // appears here and the summary counts 2 not restarted.
    const [lane] = await freeLanes(['codex-a']);
    const home = codexBox('ccrc-codex-tiers-lazy-', [lane!], { systemd: true });
    homes.push(home);
    const r = runInstall(home, ['install'], READY);
    expect(existsSync(dotCcrc(home, 'installed')), r.stderr).toBe(true);
    expect(r.stderr).not.toMatch(/its lane lock could not be taken/);
    expect(r.stdout).toMatch(/^install: codex tiers: 1 codex lane\(s\) — 0 restarted, 0 left as they were, 0 not restarted$/m);
    expect(stateChanges(home)).toEqual([]);
    expect(await portAccepts(lane!.proxyPort)).toBe(false);
    expect(await portAccepts(lane!.litellmPort)).toBe(false);
  }, 120_000);

  it('a foreign listener on the shim port is left running, and the transcript says so', async () => {
    // The OTHER repository's shim shape on this lane's shim port: `text/plain`
    // with the bare id (m-tiers §1), Task 4's `spawnListener` — which resolves
    // only once it has bound.
    const [lane] = await freeLanes(['codex-a']);
    const home = codexBox('ccrc-codex-tiers-foreign-', [lane!], { systemd: true });
    homes.push(home);
    const foreign = await spawnListener(home, { answer: 'text', lane: 'codex-a', port: lane!.proxyPort });
    const r = runInstall(home, ['install'], READY);
    expect(existsSync(dotCcrc(home, 'installed')), r.stderr).toBe(true);
    // Review A2: the REAL `_codex_foreign_what` sentence, end to end.
    expect(r.stdout).toMatch(new RegExp(`^install: codex tiers: codex-a shim: left alone — port ${lane!.proxyPort} \\(codex-a's shim tier\\) is held by a listener that is not this lane's: its identity check failed, and this step never stops`, 'm'));
    expect(stateChanges(home)).toEqual([]);
    expect(() => process.kill(foreign.pid, 0)).not.toThrow();
    expect(await portAccepts(lane!.proxyPort)).toBe(true);
  }, 120_000);

  it('a restart the user manager refuses is its own FAILED line, and the closing line names codex-tiers', async () => {
    const { home, lane, units } = await runningLane('ccrc-codex-tiers-refused-');
    appendFileSync(treeFile(home, 'ccd/ccgpt-proxy.py'), '\n# fixture: the next release of the shim\n');
    writeFileSync(join(home, 'fixture-systemd-run-fail'), `${units.shim}\n`);
    const r = runInstall(home, ['install'], READY);
    expect(existsSync(dotCcrc(home, 'installed')), 'a failed tier restart must not stop the spine').toBe(true);
    expect(r.stderr).toMatch(/^install: codex tiers: codex-a shim: restart FAILED — it was stopped and would not start again/m);
    expect(r.stdout).not.toMatch(/^install: codex tiers: codex-a shim: restarted/m);
    expect(r.stdout).toMatch(/^install: done — converged with \d+ degraded steps? \([^)]*\bcodex-tiers\b[^)]*\)$/m);
    expect(r.code).toBe(doctorCode(home));
    expect(await laneAnswer(lane.proxyPort)).toBeNull();
  }, 180_000);
});

describeLinux('ccrc install: the codex usage converge on a real spine (Plan 3a Task 6)', () => {
  it('one usage timer per codex lane and none for an external lane; a re-run arms the same one again and nothing else', async () => {
    const lanes = await freeLanes(['codex-a']);
    const home = codexBox('ccrc-codex-usage-spine-', lanes);
    // `ext-a`: the live lanes' shape before the cutover (exec.kind external, telemetry codex; retired by Plan 4), a fixture id.
    codexRoster(home, lanes, [{ id: 'ext-a', label: 'ext-a', configDirSuffix: '.claude-ext-a',
      exec: { kind: 'external', provider: 'openai' }, homeAble: false, telemetry: 'codex' }]);
    const usage = (): string[] => systemctlCalls(home).map((c) => c.argv).filter((a) => a.includes('usage@'));
    const r = runInstall(home);
    expect(existsSync(dotCcrc(home, 'installed')), `${r.stdout}\n${r.stderr}`).toBe(true);
    expect(usage()).toEqual(['--user enable --now ccrc-codex-usage@codex-a.timer']);
    expect(lstatSync(unitDir(home, 'timers.target.wants', 'ccrc-codex-usage@codex-a.timer')).isSymbolicLink()).toBe(true);
    expect(r.stdout).toMatch(/^install: codex-usage: enabled for codex-a; withheld from no lane; withdrawn from no lane$/m);
    expect(r.code).toBe(doctorCode(home));
    runInstall(home);
    expect(usage(), 'a re-run did more than re-arm the same timer').toEqual([
      '--user enable --now ccrc-codex-usage@codex-a.timer', '--user enable --now ccrc-codex-usage@codex-a.timer']);
  }, 60_000);
});

describeLinux('ccrc install: a timer systemd refuses is a COUNTED degraded step (Plan 3a Task 6; 2b-2 carry-forward 10)', () => {
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** The names the closing line gives, split on the `,` cmd_install joins with. */
  const degradedNamed = (stdout: string): string[] => {
    const m = /^install: done — converged with \d+ degraded steps? \(([^)]*)\)$/m.exec(stdout);
    return m === null ? [] : m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
  };

  it('every timer enable systemd refuses is NAMED in the closing line — derived from what the run asked, nine across both and fleet', () => {
    // Until Plan 3a nine refusals printed a remedy and appended nothing, so
    // the closing line said "every step above converged" over a timer that
    // never armed. The expected set is what THIS run asked systemd to enable,
    // never a list typed here, so a tenth timer is measured the day it lands.
    const seen = new Set<string>();
    for (const role of ['both', 'fleet'] as const) {
      const home = freshBox(`ccrc-install-timer-degrades-${role}-`);
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'agent.env'),
        'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
      writeFileSync(join(home, 'fixture-enable-fail-timers'), '');
      const r = runInstall(home, ['install', '--role', role]);
      expect(r.code, `--role ${role}: a refused timer failed the install\n${r.stderr}`).toBe(0);
      const asked = [...new Set(systemctlCalls(home)
        .map((c) => /^--user enable --now (\S+\.timer)$/.exec(c.argv)?.[1])
        .filter((u): u is string => u !== undefined && u !== 'ccd-cap-scopes.timer'))].sort();
      expect(asked.length, `--role ${role}: the run asked for too few timer enables — this harness has gone stale`)
        .toBeGreaterThanOrEqual(7);
      expect(degradedNamed(r.stdout).filter((n) => n.endsWith('.timer')).sort(),
        `--role ${role}: the closing line does not name every timer systemd refused`).toEqual(asked);
      for (const u of asked) {
        expect(r.stderr, `--role ${role}: ${u}'s refusal carries no remedy line`)
          .toMatch(new RegExp(`^install: [a-z-]+: could not enable ${esc(u)} — run: systemctl --user enable --now ${esc(u)}$`, 'm'));
        seen.add(u);
      }
    }
    expect(seen.size, 'both roles together reach fewer degrading timer enables than the nine measured on main at 1f9fa22d')
      .toBeGreaterThanOrEqual(9);
  }, 60_000);

  it('every timer `_inst_enable` arms after ccd-cap-scopes goes through `_inst_enable_timer`, which counts its refusal', () => {
    const body = ccrcFunction('_inst_enable');
    const via = [...body.matchAll(/^ {2}\[ "\$INST_ROLE" !?= [a-z]+ \] \|\| _inst_enable_timer [a-z-]+ \S+\.timer$/gm)];
    expect(via.length, 'fewer helper-routed timer enables than the nine on main — the reader has gone stale, or a timer left the helper')
      .toBeGreaterThanOrEqual(9);
    const code = body.split('\n').filter((l) => !/^\s*#/.test(l));
    expect(code.filter((l) => /could not enable/.test(l)),
      'a timer in _inst_enable still degrades through its own echo, outside the helper that counts it').toEqual([]);
    expect(code.filter((l) => /systemctl --user enable --now [A-Za-z0-9@._-]+\.timer/.test(l)),
      'a literal timer enable in _inst_enable bypasses _inst_enable_timer').toEqual([]);
    expect(ccrcFunction('_inst_enable_timer'), 'the helper no longer counts the step it degrades')
      .toMatch(/^ {2}INST_DEGRADED\+=\("\$2"\)$/m);
  });
});

describeLinux('Plan 3a Task 10 — what the cutover rehearsal still holds: box-token on a new and a provisioned fleet box, and a codex lane\'s flip', () => {
  const homes: string[] = [];
  afterEach(async () => {
    for (const h of homes.splice(0)) await killLaneProcesses(h);
  });

  interface Flip { lane: LanePorts }
  /** What `lstat` alone says of a file: mode, size, mtime and inode. */
  const sealedStat = (p: string): { mode: number; size: number; mtimeMs: number; ino: number } => {
    const st = lstatSync(p);
    return { mode: st.mode & 0o7777, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino };
  };
  const isLink = (p: string): boolean => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

  /** Plan 3b's per-lane steps for the lane-1 analog, in the runbook's order,
   *  from the roster edit on. */
  async function flipCodexA(home: string): Promise<Flip> {
    const [lane] = await freeLanes(['codex-a']);
    const bin = join(home, '.local', 'bin');
    // e. the roster edit: kind codex, provider openai, a port pair and an
    //    authDir, the lane's own OAuth planted there (`ccrc codex start` checks
    //    that it exists). From here the lane takes the codex path with no other
    //    act (ruling Z8). codex-b stays external, with the launcher such a row owes.
    codexRoster(home, [lane!], [externalCodexRow('codex-b')]);
    plantExternalLauncher(home, 'codex-b');
    expect(authDirOf(home, 'codex-a')).toBe(join(home, codexAuthDir('codex-a')));
    plantLaneAuth(home, 'codex-a');
    //    neither file is ccrc's to write: codex-a's OAuth file is measured by
    //    lstat alone (never opened, so a rewrite of the same bytes still shows),
    //    and codex-b's launcher by its bytes and mode
    const auth = join(authDirOf(home, 'codex-a'), 'auth.json');
    const launcher = join(bin, 'codex-b');
    const authBefore = sealedStat(auth);
    expect(read(launcher)).toBe(EXTERNAL_LAUNCHER);
    const launcherMode = statSync(launcher).mode & 0o7777;
    // f. wrappers; `init codex` and the refresh, stood in by the files they
    //    leave; litellm
    const w = runInstall(home, ['wrappers'], READY);
    expect(w.code, `ccrc wrappers:\n${w.stdout}\n${w.stderr}`).toBe(0);
    expect(verifyMarker(read(join(bin, 'codex-a'))), 'ccrc wrappers did not write codex-a').toBe('ccrc-unmodified');
    plantFlippedLaneModels(home, 'codex-a');
    const lit = runInstall(home, ['models', 'litellm', 'codex-a'], READY, { from: REPO_CCRC });
    expect(lit.code, `ccrc models litellm codex-a:\n${lit.stdout}\n${lit.stderr}`).toBe(0);
    //    the usage enable: the spine's own converge (R-C10's targeted route is
    //    this by design), run the way the next auto-update runs it
    rmSync(join(home, 'systemctl-calls'), { force: true });
    const inst = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(inst.stdout, `the converge did not complete:\n${inst.stderr}`).toMatch(/^install: done — /m);
    // g. start, the product stop registered first
    registerLaneCleanup(home, 'rehearsal:codex-a', () => {
      runInstall(home, ['codex', 'stop', 'codex-a'], READY, { from: REPO_CCRC });
    });
    const start = runInstall(home, ['codex', 'start', 'codex-a'], READY, { from: REPO_CCRC });
    expect(start.code, `ccrc codex start codex-a:\n${start.stdout}\n${start.stderr}`).toBe(0);
    expect(sealedStat(auth), 'wrappers, install or start rewrote codex-a\'s OAuth file').toEqual(authBefore);
    expect(read(launcher), 'wrappers, install or start rewrote codex-b\'s external launcher').toBe(EXTERNAL_LAUNCHER);
    expect(statSync(launcher).mode & 0o7777, 'the external launcher\'s mode changed').toBe(launcherMode);
    // h. the one publisher run, stood in by the row it leaves
    mkdirSync(join(home, '.cc-limits'), { recursive: true });
    writeFileSync(join(home, '.cc-limits', 'codex-a.json'), usageRow());
    return { lane: lane! };
  }

  it('a fresh fleet box (no fleet token file, generation file or sync report) keeps box-token measured: PASS with its sentence and no remedy (D-139), and the install exits 0 (4553)', () => {
    const home = fleetBox('ccrc-rehearsal-fresh-');
    homes.push(home);
    const r = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(r.code, `a fresh box's install:\n${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/^PASS box-token: fleet: fleet-token-absent — .* no value has been handed to this box yet, and the server's next rotation hands one$/m);
    expect(r.stdout).not.toMatch(/box-token: .*(no-generation|never-synced)/);
    // The fleet-token-absent FAIL's remedy is the one line that must not appear. Doctor prints `  remedy: …` (`_dr_fail`), so
    // the live half of the pattern is the second one; the CONTROL line shows it matches that remedy's text.
    const CARD_REMEDY = /remedy:[^\n]*Box token card/;
    expect("  remedy: the server writes it at its next rotation (Rotate now on the console's Box token card)").toMatch(CARD_REMEDY);
    expect(r.stdout).not.toMatch(CARD_REMEDY);
    expect(r.stdout).not.toMatch(/^FAIL /m);
    expectFleetBoxClasses(r.stdout, FLEET_BOX_CLASSES, 'a fresh fleet box\'s install');
  }, 120_000);

  it('box-token live shape: a provisioned fleet box keeps box-token PASS through two fleet installs and doctor (Plan 4)', () => {
    const home = fleetBox('ccrc-rehearsal-provisioned-', { fleetFiles: true });
    homes.push(home);
    // `~/.cc-secrets` exists here, so `credentials` is owed and PASSes: the one class that differs (measured)
    const provisioned = { ...FLEET_BOX_CLASSES, credentials: 'PASS', 'snapshot-posture': 'PASS' };   // and `snapshot-posture` reads its stated `none` (A11b)
    // two installs: the second is what every update's staged spine runs
    for (const pass of [1, 2]) {
      const r = runInstall(home, ['install', '--role', 'fleet'], READY);
      expect(r.code, `install pass ${pass}:\n${r.stdout}\n${r.stderr}`).toBe(0);
      expect(r.stdout, `install pass ${pass}: the provisioned fleet arm did not PASS`).toMatch(PROVISIONED_BOX_TOKEN);
      expect(r.stdout, `install pass ${pass}`).not.toMatch(/^FAIL /m);
      expectFleetBoxClasses(r.stdout, provisioned, `install pass ${pass}`);
    }
    const d = runInstall(home, ['doctor'], READY);
    expect(d.code, d.stdout).toBe(0);
    expect(d.stdout, 'doctor: the provisioned fleet arm did not PASS').toMatch(PROVISIONED_BOX_TOKEN);
    expect(d.stdout).not.toMatch(/^FAIL /m);
    expectFleetBoxClasses(d.stdout, provisioned, 'doctor');
  }, 180_000);

  it('the flip, in Plan 3b\'s order: only codex-a\'s ccrc instance is enabled, codex-b and its foreign timer are untouched, and doctor answers PASS for the lane', async () => {
    const home = fleetBox('ccrc-rehearsal-flip-', { systemd: true });
    homes.push(home);
    // the other repository's instance timer for the lane that stays external
    const foreign = plantForeignUsage(home, 'codex-b');
    const foreignTarget = readlinkSync(foreign);
    const i0 = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(i0.code, `${i0.stdout}\n${i0.stderr}`).toBe(0);
    const f = await flipCodexA(home);
    expect(usageEnables(home), 'the converge enabled the wrong instance set')
      .toEqual(['--user enable --now ccrc-codex-usage@codex-a.timer']);
    expect(stateCallsNaming(argvOf(home), /ccgpt-usage|ccgpt-codex-b-/), 'ccrc changed a unit that is not codex-a\'s own')
      .toEqual([]);
    const units = laneUnits(home, 'codex-a');
    expect(spineRunCalls(home).map((l) => /--unit=(\S+)/.exec(l)?.[1]).filter((u) => u?.startsWith('ccgpt-')).sort(),
      'a ccgpt- unit other than codex-a\'s two tiers was started').toEqual([units.litellm, units.shim].sort());
    expect(isLink(foreign), 'the other repository\'s timer for codex-b is gone').toBe(true);
    expect(readlinkSync(foreign), 'the other repository\'s timer for codex-b was moved').toBe(foreignTarget);
    const ans = await laneAnswer(f.lane.proxyPort);
    expect(JSON.parse(ans!.body)).toEqual({ lane: 'codex-a' });
    const d = runInstall(home, ['doctor'], READY);
    expect(d.code, d.stdout).toBe(0);
    // `models` moves too, from SKIP to PASS: the flip gives this box its first model registry
    expect(doctorClasses(d.stdout), 'a check other than codex and models moved at the flip')
      .toEqual({ ...doctorClasses(i0.stdout), codex: 'PASS', models: 'PASS' });
    const codexLines = d.stdout.split('\n').filter((l) => /^(PASS|WARN|FAIL|SKIP) codex: /.test(l)).join('\n');
    expect(codexLines).toMatch(/codex-a/);
    expect(codexLines, 'doctor measured an external lane as a codex lane').not.toMatch(/codex-b/);
  }, 300_000);

  it('out of order: a flip made while the other repository\'s instance timer for that lane is still enabled withholds ccrc\'s enable, and doctor names the operator\'s own disable (ruling R6)', async () => {
    const home = fleetBox('ccrc-rehearsal-second-writer-');
    homes.push(home);
    plantForeignUsage(home, 'codex-b');
    const i0 = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(i0.code, `${i0.stdout}\n${i0.stderr}`).toBe(0);
    const [lane] = await freeLanes(['codex-b']);
    // step c (the operator's disable of ccgpt-usage@codex-b.timer) is SKIPPED
    codexRoster(home, [lane!], [externalCodexRow('codex-a')]);
    plantExternalLauncher(home, 'codex-a');
    plantLaneAuth(home, 'codex-b');
    // the lane has no registry: 3b's `init codex` after the flip (ruling Z3
    // forces that order) and its refresh, stood in by the files they leave
    plantFlippedLaneModels(home, 'codex-b');
    expect(runInstall(home, ['wrappers'], READY).code).toBe(0);
    expect(runInstall(home, ['models', 'litellm', 'codex-b'], READY, { from: REPO_CCRC }).code).toBe(0);
    // the other repository's publisher is still writing this lane's row
    mkdirSync(join(home, '.cc-limits'), { recursive: true });
    writeFileSync(join(home, '.cc-limits', 'codex-b.json'), usageRow());
    rmSync(join(home, 'systemctl-calls'), { force: true });
    const inst = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(inst.stdout, inst.stderr).toMatch(/^install: done — /m);
    expect(usageEnables(home), 'ccrc enabled a second writer over one limits row').toEqual([]);
    expect(stateCallsNaming(argvOf(home), /\bccgpt-usage/), 'ccrc touched the other repository\'s timer').toEqual([]);
    expect(inst.stdout).toMatch(new RegExp(
      `^install: done — converged with \\d+ degraded steps? \\([^)]*\\b${USAGE_DEGRADED}\\b[^)]*\\)$`, 'm'));
    const d = runInstall(home, ['doctor'], READY);
    const lines = d.stdout.split('\n');
    const w = lines.findIndex((l) => l.startsWith('WARN codex: ') && l.includes('ccgpt-usage@codex-b.timer'));
    expect(w, d.stdout).toBeGreaterThan(-1);
    expect(lines[w + 1]).toMatch(/^ {2}remedy: .*systemctl --user disable --now ccgpt-usage@codex-b\.timer/);
    // the operator's disable; then the converge enables ccrc's instance and the WARN is gone
    rmSync(unitDir(home, 'timers.target.wants', 'ccgpt-usage@codex-b.timer'));
    rmSync(join(home, 'systemctl-calls'), { force: true });
    const again = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(usageEnables(home)).toEqual(['--user enable --now ccrc-codex-usage@codex-b.timer']);
    expect(again.stdout, 'the second-writer finding outlived the operator\'s disable').not.toMatch(/ccgpt-usage@codex-b\.timer/);
  }, 240_000);
});
